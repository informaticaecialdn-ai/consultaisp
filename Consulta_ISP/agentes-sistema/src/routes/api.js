const express = require('express');
const router = express.Router();
const orchestrator = require('../services/orchestrator');
const claude = require('../services/claude');
const zapi = require('../services/zapi');
const { getDb } = require('../models/database');
const { validate } = require('../middleware/validate');
const schemas = require('../schemas/api');

// === HEALTHCHECK ===
router.get('/health', (req, res) => {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
  } catch (error) {
    res.status(503).json({ status: 'error', error: error.message });
  }
});

// === DIAGNOSE (relatorio completo de saude do sistema) ===
// Use: curl http://localhost:3080/api/diagnose  (ou do dominio publico)
// Retorna status de TODOS os subsistemas e integridade do index.html
router.get('/diagnose', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const out = {
    timestamp: new Date().toISOString(),
    uptime_sec: Math.round(process.uptime()),
    node_version: process.version,
    env: process.env.NODE_ENV || 'development',
    checks: {}
  };

  // 1) Database
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
    const contagens = {};
    for (const t of ['leads','conversas','atividades_agentes','tarefas','handoffs','avaliacoes','followups','ab_tests','campanhas','treinamento_agentes']) {
      try { contagens[t] = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c; } catch { contagens[t] = 'MISSING'; }
    }
    out.checks.database = { status: 'ok', tabelas_count: tabelas.length, tabelas, contagens };
  } catch (e) { out.checks.database = { status: 'error', error: e.message }; }

  // 2) Env / credenciais
  const envVars = ['ANTHROPIC_API_KEY','ZAPI_INSTANCE_ID','ZAPI_TOKEN','ZAPI_CLIENT_TOKEN','AGENT_SOFIA_ID','AGENT_CARLOS_ID','PORT','WEBHOOK_URL'];
  const envStatus = {};
  for (const k of envVars) {
    const v = process.env[k];
    envStatus[k] = v ? { set: true, length: v.length, preview: v.substring(0,6) + '...' } : { set: false };
  }
  out.checks.env = envStatus;

  // 3) Integridade do index.html (detecta corrupcao de escape de comentarios)
  try {
    const htmlPath = path.join(__dirname, '../../public/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const size = html.length;
    const tagsAbertas = (html.match(/<!--/g) || []).length;
    const tagsFechadas = (html.match(/-->/g) || []).length;
    // Detecta a corrupcao classica: `<\!--` (backslash antes do !)
    const escapadas = (html.match(/<\\!--/g) || []).length;
    // Procura se o script principal esta presente
    const temScript = html.includes('loadDashboard()') && html.includes('addEventListener');
    const temNavItems = (html.match(/data-page=/g) || []).length;
    out.checks.index_html = {
      status: (escapadas === 0 && temScript && temNavItems >= 10) ? 'ok' : 'CORROMPIDO',
      size_bytes: size,
      comentarios_abertos: tagsAbertas,
      comentarios_fechados: tagsFechadas,
      comentarios_escapados_erro: escapadas,
      tem_script: temScript,
      nav_items_count: temNavItems,
      first_50_chars: html.substring(0, 50),
      last_50_chars: html.substring(size - 50)
    };
  } catch (e) { out.checks.index_html = { status: 'error', error: e.message }; }

  // 4) Scheduler / workers
  try {
    const followup = require('../services/followup');
    const pendentes = followup.getPending ? followup.getPending().length : 'n/a';
    out.checks.followup_scheduler = { status: 'ok', pendentes };
  } catch (e) { out.checks.followup_scheduler = { status: 'error', error: e.message }; }

  // 5) Servicos Claude/Z-API (so verifica se carregam)
  try { require('../services/claude'); out.checks.claude_service = { status: 'ok' }; }
  catch (e) { out.checks.claude_service = { status: 'error', error: e.message }; }
  try { require('../services/zapi'); out.checks.zapi_service = { status: 'ok' }; }
  catch (e) { out.checks.zapi_service = { status: 'error', error: e.message }; }

  // 6) Sumario global
  const erros = Object.entries(out.checks).filter(([k,v]) => v.status !== 'ok').map(([k,v]) => ({ subsistema: k, status: v.status, erro: v.error || null }));
  out.summary = {
    total_checks: Object.keys(out.checks).length,
    passed: Object.values(out.checks).filter(v => v.status === 'ok').length,
    failed: erros.length,
    problemas: erros
  };

  res.json(out);
});

// === STATS / DASHBOARD ===
router.get('/stats', (req, res) => {
  const db = getDb();
  // Cada query e isolada pra que falha em uma nao quebre o endpoint todo.
  // Defaults conservadores quando a tabela/coluna nao existe ainda.
  const safe = (fn, fallback) => { try { return fn(); } catch (e) {
    if (req.logger) req.logger.warn({ err: e.message }, '[STATS] query falhou');
    return fallback;
  }};

  const total_leads = safe(() => db.prepare('SELECT COUNT(*) as c FROM leads').get().c, 0);
  const msgs_hoje = safe(() => db.prepare("SELECT COUNT(*) as c FROM conversas WHERE DATE(criado_em) = DATE('now')").get().c, 0);
  const tarefas_pendentes = safe(() => db.prepare("SELECT COUNT(*) as c FROM tarefas WHERE status = 'pendente'").get().c, 0);

  const por_classificacao = safe(() => db.prepare('SELECT classificacao, COUNT(*) as c FROM leads GROUP BY classificacao').all(), []);
  const por_agente = safe(() => db.prepare('SELECT agente_atual as agente, COUNT(*) as c FROM leads GROUP BY agente_atual').all(), []);
  const por_etapa = safe(() => db.prepare('SELECT etapa_funil as etapa, COUNT(*) as c FROM leads GROUP BY etapa_funil').all(), []);
  const por_regiao = safe(() => db.prepare("SELECT COALESCE(regiao, estado, 'Sem regiao') as regiao, COUNT(*) as c FROM leads GROUP BY regiao ORDER BY c DESC LIMIT 10").all(), []);

  const valor_pipeline = safe(() => db.prepare("SELECT COALESCE(SUM(valor_estimado),0) as v FROM leads WHERE etapa_funil NOT IN ('perdido','convertido')").get().v, 0);
  const leads_hoje = safe(() => db.prepare("SELECT COUNT(*) as c FROM leads WHERE DATE(criado_em) = DATE('now')").get().c, 0);
  const conversoes_mes = safe(() => db.prepare("SELECT COUNT(*) as c FROM leads WHERE etapa_funil='convertido' AND criado_em >= DATE('now','start of month')").get().c, 0);

  const atividades_recentes = safe(() => db.prepare('SELECT * FROM atividades_agentes ORDER BY criado_em DESC LIMIT 20').all(), []);

  const handoffs_recentes = safe(() => db.prepare(`
    SELECT h.*, l.nome, l.provedor, l.telefone
    FROM handoffs h JOIN leads l ON h.lead_id = l.id
    ORDER BY h.criado_em DESC LIMIT 10
  `).all(), []);

  // 11B-3: Metricas de avaliacoes do supervisor
  let avaliacoes_resumo = [];
  try {
    avaliacoes_resumo = db.prepare(`
      SELECT agente,
        COUNT(*) as total,
        ROUND(AVG(nota), 1) as nota_media,
        SUM(CASE WHEN nota >= 4 THEN 1 ELSE 0 END) as boas,
        SUM(CASE WHEN nota <= 2 THEN 1 ELSE 0 END) as ruins
      FROM avaliacoes GROUP BY agente
    `).all();
  } catch { /* tabela pode nao existir ainda */ }

  // Tarefa 4: Followups e A/B tests no stats
  let followups_pendentes = 0;
  try { followups_pendentes = db.prepare("SELECT COUNT(*) as c FROM followups WHERE status = 'pendente'").get().c; } catch {}
  let ab_tests_ativos = 0;
  try { ab_tests_ativos = db.prepare("SELECT COUNT(*) as c FROM ab_tests WHERE status = 'ativo'").get().c; } catch {}

  res.json({
    total_leads, msgs_hoje, tarefas_pendentes, valor_pipeline,
    leads_hoje, conversoes_mes,
    por_classificacao, por_agente, por_etapa, por_regiao,
    atividades_recentes, handoffs_recentes,
    avaliacoes_resumo, followups_pendentes, ab_tests_ativos
  });
});

// === METRICAS HISTORICAS (para graficos) ===
router.get('/metricas/historico', (req, res) => {
  const db = getDb();
  const { dias = 30, agente } = req.query;
  
  let query = `SELECT * FROM metricas_diarias WHERE data >= DATE('now', '-${parseInt(dias)} days')`;
  const params = [];
  if (agente) { query += ' AND agente = ?'; params.push(agente); }
  query += ' ORDER BY data ASC';
  
  const metricas = db.prepare(query).all(...params);
  
  // Agrupa por data
  const porDia = {};
  metricas.forEach(m => {
    if (!porDia[m.data]) porDia[m.data] = { data: m.data, msgs_env: 0, msgs_rec: 0, leads_novos: 0, leads_qual: 0, leads_conv: 0, leads_perd: 0, tokens: 0, valor: 0 };
    porDia[m.data].msgs_env += m.mensagens_enviadas;
    porDia[m.data].msgs_rec += m.mensagens_recebidas;
    porDia[m.data].leads_novos += m.leads_novos;
    porDia[m.data].leads_qual += m.leads_qualificados;
    porDia[m.data].leads_conv += m.leads_convertidos;
    porDia[m.data].leads_perd += m.leads_perdidos;
    porDia[m.data].tokens += m.tokens_consumidos;
    porDia[m.data].valor += m.valor_pipeline;
  });
  
  res.json({ historico: Object.values(porDia), raw: metricas });
});

// Performance por agente
router.get('/metricas/agentes', (req, res) => {
  const db = getDb();
  
  const agentes = ['sofia', 'leo', 'carlos', 'lucas', 'rafael'];
  const resultado = agentes.map(a => {
    const leads = db.prepare('SELECT COUNT(*) as c FROM leads WHERE agente_atual = ?').get(a).c;
    const msgs = db.prepare('SELECT COUNT(*) as c FROM conversas WHERE agente = ?').get(a).c;
    const atividades = db.prepare("SELECT COUNT(*) as c FROM atividades_agentes WHERE agente = ? AND DATE(criado_em) = DATE('now')").get(a).c;
    const handoffs_out = db.prepare('SELECT COUNT(*) as c FROM handoffs WHERE de_agente = ?').get(a).c;
    const handoffs_in = db.prepare('SELECT COUNT(*) as c FROM handoffs WHERE para_agente = ?').get(a).c;
    const ultima_atividade = db.prepare('SELECT criado_em FROM atividades_agentes WHERE agente = ? ORDER BY criado_em DESC LIMIT 1').get(a);
    
    return {
      agente: a,
      leads_ativos: leads,
      total_mensagens: msgs,
      atividades_hoje: atividades,
      handoffs_enviados: handoffs_out,
      handoffs_recebidos: handoffs_in,
      ultima_atividade: ultima_atividade?.criado_em || null
    };
  });
  
  res.json({ agentes: resultado });
});

// === LEADS (CRM) ===
router.get('/leads', (req, res) => {
  const db = getDb();
  const { agente, classificacao, etapa, busca, regiao, porte, ordenar = 'atualizado_em', dir = 'DESC', limit = 100, offset = 0 } = req.query;
  
  let query = 'SELECT * FROM leads WHERE 1=1';
  const params = [];
  
  if (agente) { query += ' AND agente_atual = ?'; params.push(agente); }
  if (classificacao) { query += ' AND classificacao = ?'; params.push(classificacao); }
  if (etapa) { query += ' AND etapa_funil = ?'; params.push(etapa); }
  if (regiao) { query += ' AND (regiao LIKE ? OR estado LIKE ?)'; params.push(`%${regiao}%`, `%${regiao}%`); }
  if (porte) { query += ' AND porte = ?'; params.push(porte); }
  if (busca) { query += ' AND (nome LIKE ? OR provedor LIKE ? OR cidade LIKE ? OR telefone LIKE ?)'; params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`); }
  
  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
  const total = db.prepare(countQuery).get(...params).total;
  
  const allowed = ['atualizado_em','criado_em','score_total','nome','valor_estimado'];
  const col = allowed.includes(ordenar) ? ordenar : 'atualizado_em';
  const direction = dir === 'ASC' ? 'ASC' : 'DESC';
  query += ` ORDER BY ${col} ${direction} LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));
  
  const leads = db.prepare(query).all(...params);
  res.json({ leads, total });
});

router.get('/leads/:id', (req, res) => {
  const db = getDb();
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' });

  const conversas = db.prepare('SELECT * FROM conversas WHERE lead_id = ? ORDER BY criado_em ASC').all(lead.id);
  const tarefas = db.prepare('SELECT * FROM tarefas WHERE lead_id = ? ORDER BY criado_em DESC').all(lead.id);
  const handoffs = db.prepare(`SELECT * FROM handoffs WHERE lead_id = ? ORDER BY criado_em DESC`).all(lead.id);
  const atividades = db.prepare('SELECT * FROM atividades_agentes WHERE lead_id = ? ORDER BY criado_em DESC LIMIT 20').all(lead.id);

  res.json({ lead, conversas, tarefas, handoffs, atividades });
});

// Sprint 7 polish: export CSV de leads (com filtros aplicaveis via query string).
router.get('/leads/export.csv', (req, res) => {
  const db = getDb();
  const { agente, classificacao, etapa, regiao, porte, busca, origem } = req.query;
  let query = 'SELECT id, telefone, nome, provedor, cidade, estado, regiao, porte, erp, classificacao, etapa_funil, agente_atual, score_total, valor_estimado, origem, criado_em FROM leads WHERE 1=1';
  const params = [];
  if (agente) { query += ' AND agente_atual = ?'; params.push(agente); }
  if (classificacao) { query += ' AND classificacao = ?'; params.push(classificacao); }
  if (etapa) { query += ' AND etapa_funil = ?'; params.push(etapa); }
  if (origem) { query += ' AND origem = ?'; params.push(origem); }
  if (regiao) { query += ' AND (regiao LIKE ? OR estado LIKE ?)'; params.push(`%${regiao}%`, `%${regiao}%`); }
  if (porte) { query += ' AND porte = ?'; params.push(porte); }
  if (busca) { query += ' AND (nome LIKE ? OR provedor LIKE ? OR cidade LIKE ? OR telefone LIKE ?)'; params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`); }
  query += ' ORDER BY criado_em DESC LIMIT 50000';
  const rows = db.prepare(query).all(...params);

  const cols = ['id','telefone','nome','provedor','cidade','estado','regiao','porte','erp','classificacao','etapa_funil','agente_atual','score_total','valor_estimado','origem','criado_em'];
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => escape(r[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send('\uFEFF' + csv); // BOM pra Excel abrir UTF-8 corretamente
});

// Sprint 7 polish: bulk delete (transacao, retorna quantos foram excluidos).
router.post('/leads/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (ids.length === 0) return bad(res, 'lista de ids vazia');
  if (ids.length > 5000) return bad(res, 'max 5000 ids por batch');
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM conversas WHERE lead_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM tarefas WHERE lead_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM handoffs WHERE lead_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM atividades_agentes WHERE lead_id IN (${placeholders})`).run(...ids);
    return db.prepare(`DELETE FROM leads WHERE id IN (${placeholders})`).run(...ids).changes;
  });
  const removed = tx();
  res.json({ success: true, removed });
});

// Sprint 7 polish: bulk transfer (atribuir agente em N leads).
router.post('/leads/bulk-transfer', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  const para_agente = String(req.body?.para_agente || '').trim();
  const VALID = ['carlos','lucas','rafael','sofia','marcos','leo','iani'];
  if (ids.length === 0) return bad(res, 'lista de ids vazia');
  if (!VALID.includes(para_agente)) return bad(res, 'para_agente invalido');
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const r = db.prepare(
    `UPDATE leads SET agente_atual = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`
  ).run(para_agente, ...ids);
  res.json({ success: true, atualizados: r.changes });
});

// Sprint 4 / T3: check de janela 24h + consent para decidir freeform vs template.
router.get('/leads/:id/can-send', async (req, res) => {
  const windowChecker = require('../services/window-checker');
  const consent = require('../services/consent');
  const db = getDb();
  const lead = db.prepare('SELECT id, telefone FROM leads WHERE id = ?').get(parseInt(req.params.id));
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' });

  const freeform = await windowChecker.canSendFreeForm(lead.id);
  const consentStatus = consent.getStatus(lead.telefone);
  const anyOutbound = !consentStatus || consentStatus.status !== 'optout';

  res.json({
    lead_id: lead.id,
    freeform,
    any_outbound: { allowed: anyOutbound, reason: anyOutbound ? null : 'optout' },
    consent: consentStatus,
  });
});

router.put('/leads/:id', (req, res) => {
  const db = getDb();
  const fields = ['nome','provedor','cidade','estado','regiao','porte','erp','num_clientes','decisor','email','cargo','site','agente_atual','classificacao','etapa_funil','valor_estimado','observacoes','data_proxima_acao','motivo_perda'];
  const updates = [];
  const values = [];
  
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
  }
  
  if (updates.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
  updates.push('atualizado_em = CURRENT_TIMESTAMP');
  values.push(req.params.id);
  
  db.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ success: true });
});

router.post('/leads', validate(schemas.createLead), (req, res) => {
  const db = getDb();
  const { telefone, nome, provedor, cidade, estado, regiao, porte, erp, origem } = req.body;

  try {
    db.prepare(`INSERT INTO leads (telefone, nome, provedor, cidade, estado, regiao, porte, erp, origem) VALUES (?,?,?,?,?,?,?,?,?)`).run(telefone, nome, provedor, cidade, estado, regiao, porte, erp, origem || 'manual');
    const lead = db.prepare('SELECT * FROM leads WHERE telefone = ?').get(telefone);
    res.json({ success: true, lead });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Telefone ja cadastrado' });
    throw e;
  }
});

// === ATIVIDADES DOS AGENTES (monitor) ===
router.get('/atividades', (req, res) => {
  const db = getDb();
  const { agente, tipo, limit = 50 } = req.query;
  let query = `SELECT a.*, l.nome as lead_nome, l.provedor as lead_provedor, l.telefone as lead_telefone 
    FROM atividades_agentes a LEFT JOIN leads l ON a.lead_id = l.id WHERE 1=1`;
  const params = [];
  if (agente) { query += ' AND a.agente = ?'; params.push(agente); }
  if (tipo) { query += ' AND a.tipo = ?'; params.push(tipo); }
  query += ` ORDER BY a.criado_em DESC LIMIT ?`;
  params.push(parseInt(limit));
  
  res.json({ atividades: db.prepare(query).all(...params) });
});

// === CONVERSAS ===
router.get('/conversas/recentes', (req, res) => {
  const db = getDb();
  const { limit = 50 } = req.query;
  const conversas = db.prepare(`
    SELECT c.*, l.nome, l.provedor, l.telefone, l.classificacao, l.agente_atual
    FROM conversas c JOIN leads l ON c.lead_id = l.id 
    ORDER BY c.criado_em DESC LIMIT ?
  `).all(parseInt(limit));
  res.json({ conversas });
});

// === MENSAGENS ===
router.post('/send', validate(schemas.send), async (req, res) => {
  try {
    const { phone, message, agente } = req.body;
    if (agente) {
      const result = await orchestrator.sendOutbound(phone, agente, message);
      res.json(result);
    } else {
      await zapi.sendText(phone, message);
      res.json({ success: true });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === PROSPECCAO ===
router.post('/prospectar', validate(schemas.prospectar), async (req, res) => {
  try {
    const { telefones, regiao, mensagem_base } = req.body;

    const resultados = [];
    for (const tel of telefones) {
      try {
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        const msg = mensagem_base || `Gerar mensagem de prospeccao fria para provedor da regiao ${regiao || 'Brasil'}`;
        const result = await orchestrator.sendOutbound(tel, 'carlos', msg);
        resultados.push({ telefone: tel, status: 'enviado', resposta: result.resposta });
      } catch (err) {
        resultados.push({ telefone: tel, status: 'erro', erro: err.message });
      }
    }
    res.json({ total: telefones.length, resultados });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === CONTEUDO (Leo) ===
router.post('/conteudo', async (req, res) => {
  try {
    const { tipo, briefing } = req.body;
    const result = await claude.requestContent(tipo, briefing);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === ESTRATEGIA (Sofia) ===
router.post('/estrategia', async (req, res) => {
  try {
    const { tipo, dados } = req.body;
    const result = await claude.requestStrategy(tipo, dados);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === TRANSFERENCIAS ===
router.post('/transferir', async (req, res) => {
  try {
    const { lead_id, para_agente, motivo } = req.body;
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead_id);
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' });
    
    await orchestrator.transferLead(lead_id, lead.agente_atual, para_agente, motivo || 'Transferencia manual');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === TAREFAS ===
router.get('/tarefas', (req, res) => {
  const db = getDb();
  const { status = 'pendente', agente } = req.query;
  let query = `SELECT t.*, l.nome as lead_nome, l.telefone as lead_telefone, l.provedor as lead_provedor
    FROM tarefas t LEFT JOIN leads l ON t.lead_id = l.id WHERE t.status = ?`;
  const params = [status];
  if (agente) { query += ' AND t.agente = ?'; params.push(agente); }
  query += ' ORDER BY t.prioridade DESC, t.criado_em ASC';
  res.json({ tarefas: db.prepare(query).all(...params) });
});

router.put('/tarefas/:id', (req, res) => {
  const db = getDb();
  const { status } = req.body;
  db.prepare('UPDATE tarefas SET status = ?, concluido_em = CASE WHEN ? = "concluida" THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?').run(status, status, req.params.id);
  res.json({ success: true });
});

// === CAMPANHAS (Sprint 5 — Broadcast Engine) ===
const campanhasService = require('../services/campanhas');
const audienciasService = require('../services/audiencias');
const templatesService = require('../services/templates');
const templateEngine = require('../services/template-engine');
const consent = require('../services/consent');
const broadcastWorker = require('../workers/broadcast');

const VALID_AGENTES = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'iani'];

function bad(res, msg, code = 400) {
  return res.status(code).json({ error: msg });
}

function validateCreatePayload(body) {
  const errors = [];
  if (!body.nome || typeof body.nome !== 'string' || body.nome.length > 200) errors.push('nome invalido');
  if (!Number.isInteger(body.audiencia_id) || body.audiencia_id <= 0) errors.push('audiencia_id invalido');
  if (!Number.isInteger(body.template_id) || body.template_id <= 0) errors.push('template_id invalido');
  if (!VALID_AGENTES.includes(body.agente_remetente)) errors.push('agente_remetente invalido');
  const rate = body.rate_limit_per_min;
  if (rate !== undefined && (!Number.isInteger(rate) || rate < 1 || rate > 60)) errors.push('rate_limit_per_min 1..60');
  const jmin = body.jitter_min_sec;
  if (jmin !== undefined && (!Number.isInteger(jmin) || jmin < 0 || jmin > 60)) errors.push('jitter_min_sec 0..60');
  const jmax = body.jitter_max_sec;
  if (jmax !== undefined && (!Number.isInteger(jmax) || jmax < 0 || jmax > 60)) errors.push('jitter_max_sec 0..60');
  return errors;
}

// GET /api/campanhas (paginada)
router.get('/campanhas', (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;
  const campanhas = campanhasService.list({
    status,
    limit: parseInt(limit),
    offset: parseInt(offset)
  });
  const enriquecidas = campanhas.map(c => {
    const aud = audienciasService.getById(c.audiencia_id);
    const tpl = templatesService.getById(c.template_id);
    return {
      ...c,
      audiencia_nome: aud?.nome || null,
      audiencia_total: aud?.total_leads || 0,
      template_nome: tpl?.nome || null,
      template_hsm: tpl?.ja_aprovado_meta === 1
    };
  });
  res.json({ campanhas: enriquecidas, total: enriquecidas.length });
});

// PUT /api/campanhas/pause-all — declarado ANTES de /:id para nao ser interpretado como id
router.put('/campanhas/pause-all', (req, res) => {
  const affected = campanhasService.pauseAll();
  res.json({ affected });
});

// POST /api/campanhas (rascunho) - validado via Zod (Sprint 2 / T4)
router.post('/campanhas', validate(schemas.campanha), (req, res) => {
  try {
    const campanha = campanhasService.create({
      nome: req.body.nome,
      audiencia_id: req.body.audiencia_id,
      template_id: req.body.template_id,
      agente_remetente: req.body.agente_remetente,
      rate_limit_per_min: req.body.rate_limit_per_min,
      jitter_min_sec: req.body.jitter_min_sec,
      jitter_max_sec: req.body.jitter_max_sec,
      agendada_para: req.body.agendada_para || null,
      criada_por: req.body.criada_por || req.headers['x-user'] || null
    });
    res.status(201).json({ campanha });
  } catch (err) {
    bad(res, err.message);
  }
});

// GET /api/campanhas/:id (detalhe + stats)
router.get('/campanhas/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const stats = campanhasService.getStats(id);
  if (!stats) return bad(res, 'campanha nao encontrada', 404);
  const campanha = campanhasService.getById(id);
  const aud = audienciasService.getById(campanha.audiencia_id);
  const tpl = templatesService.getById(campanha.template_id);
  res.json({ campanha, stats, audiencia: aud, template: tpl });
});

// PUT /api/campanhas/:id (apenas rascunho)
router.put('/campanhas/:id', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const campanha = campanhasService.update(id, req.body);
    res.json({ campanha });
  } catch (err) {
    bad(res, err.message);
  }
});

// POST /api/campanhas/:id/expand (resolve audiencia -> cria envios)
router.post('/campanhas/:id/expand', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const result = campanhasService.expand(id);
    const stats = campanhasService.getStats(id);
    res.json({ ...result, stats });
  } catch (err) {
    bad(res, err.message);
  }
});

// POST /api/campanhas/:id/start
router.post('/campanhas/:id/start', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const campanha = campanhasService.getById(id);
    if (!campanha) return bad(res, 'campanha nao encontrada', 404);

    // Garante que envios foram criados antes de iniciar
    if (campanha.total_envios === 0) {
      campanhasService.expand(id);
    }
    const started = campanhasService.start(id);
    res.json({ campanha: started, stats: campanhasService.getStats(id) });
  } catch (err) {
    bad(res, err.message);
  }
});

// POST /api/campanhas/:id/pause
router.post('/campanhas/:id/pause', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const campanha = campanhasService.pause(id);
    res.json({ campanha });
  } catch (err) {
    bad(res, err.message);
  }
});

// POST /api/campanhas/:id/resume
router.post('/campanhas/:id/resume', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const campanha = campanhasService.resume(id);
    res.json({ campanha });
  } catch (err) {
    bad(res, err.message);
  }
});

// POST /api/campanhas/:id/cancel
router.post('/campanhas/:id/cancel', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const campanha = campanhasService.cancel(id);
    res.json({ campanha });
  } catch (err) {
    bad(res, err.message);
  }
});

// DELETE /api/campanhas/:id (soft delete, apenas rascunho)
router.delete('/campanhas/:id', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    campanhasService.remove(id);
    res.json({ success: true });
  } catch (err) {
    bad(res, err.message);
  }
});

// GET /api/campanhas/:id/envios
router.get('/campanhas/:id/envios', (req, res) => {
  const id = parseInt(req.params.id);
  const { status, limit = 100, offset = 0 } = req.query;
  const envios = campanhasService.listEnvios(id, {
    status,
    limit: parseInt(limit),
    offset: parseInt(offset)
  });
  res.json({ envios, total: envios.length });
});

// GET /api/campanhas/:id/stats
router.get('/campanhas/:id/stats', (req, res) => {
  const id = parseInt(req.params.id);
  const stats = campanhasService.getStats(id);
  if (!stats) return bad(res, 'campanha nao encontrada', 404);
  res.json(stats);
});

// GET /api/campanhas/:id/timeline?last=60
router.get('/campanhas/:id/timeline', (req, res) => {
  const id = parseInt(req.params.id);
  const lastMinutes = parseInt(req.query.last) || 60;
  const buckets = campanhasService.getTimeline(id, { lastMinutes });
  res.json({ buckets, lastMinutes });
});

// POST /api/campanhas/:id/preview (renderiza 3 amostras de leads)
router.post('/campanhas/:id/preview', (req, res) => {
  const id = parseInt(req.params.id);
  const campanha = campanhasService.getById(id);
  if (!campanha) return bad(res, 'campanha nao encontrada', 404);
  const template = templatesService.getById(campanha.template_id);
  if (!template) return bad(res, 'template nao encontrado', 404);
  const leads = audienciasService.getLeads(campanha.audiencia_id, { limit: 3 });
  const samples = leads.map(lead => ({
    lead: { id: lead.id, nome: lead.nome, telefone: campanhasService.maskPhone(lead.telefone) },
    mensagem: templateEngine.render(template.conteudo, lead)
  }));
  res.json({ samples, total_leads: leads.length });
});

// === AUDIENCIAS (Sprint 4 / T4) — CRUD completo com Zod ===
router.get('/audiencias', (req, res) => {
  res.json({ audiencias: audienciasService.list(req.query) });
});

router.post('/audiencias', validate(schemas.audienciaCreate), (req, res) => {
  try {
    const body = req.body;
    let aud;
    if (body.tipo === 'estatica') {
      aud = audienciasService.createEstatica(
        body.nome, body.descricao || null, body.lead_ids || [], body.criada_por || null
      );
    } else {
      aud = audienciasService.createDinamica(
        body.nome, body.descricao || null, body.filtros, body.criada_por || null
      );
    }
    res.status(201).json({ audiencia: aud });
  } catch (err) { bad(res, err.message); }
});

router.get('/audiencias/:id', (req, res) => {
  const aud = audienciasService.getById(parseInt(req.params.id));
  if (!aud) return bad(res, 'audiencia nao encontrada', 404);
  res.json({ audiencia: aud });
});

router.put('/audiencias/:id', validate(schemas.audienciaUpdate), (req, res) => {
  const id = parseInt(req.params.id);
  const current = audienciasService.getById(id);
  if (!current) return bad(res, 'audiencia nao encontrada', 404);
  try {
    const aud = audienciasService.update(id, req.body);
    res.json({ audiencia: aud });
  } catch (err) { bad(res, err.message); }
});

router.delete('/audiencias/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const aud = audienciasService.getById(id);
  if (!aud) return bad(res, 'audiencia nao encontrada', 404);
  audienciasService.remove(id); // soft delete
  res.json({ success: true, soft_deleted: true });
});

router.get('/audiencias/:id/leads', (req, res) => {
  const id = parseInt(req.params.id);
  const limit = Math.min(10000, parseInt(req.query.limit) || 100);
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const aud = audienciasService.getById(id);
  if (!aud) return bad(res, 'audiencia nao encontrada', 404);
  const leads = audienciasService.getLeads(id, { limit, offset });
  res.json({ leads, total: aud.total_leads, limit, offset });
});

router.get('/audiencias/:id/preview', (req, res) => {
  const id = parseInt(req.params.id);
  const n = Math.min(20, Math.max(1, parseInt(req.query.n) || 5));
  const aud = audienciasService.getById(id);
  if (!aud) return bad(res, 'audiencia nao encontrada', 404);
  res.json({ preview: audienciasService.previewLeads(id, n) });
});

router.post('/audiencias/:id/refresh-count', (req, res) => {
  const id = parseInt(req.params.id);
  const aud = audienciasService.getById(id);
  if (!aud) return bad(res, 'audiencia nao encontrada', 404);
  const total = audienciasService.resolveCount(id);
  res.json({ success: true, total_leads: total });
});

router.post('/audiencias/:id/leads', (req, res) => {
  const id = parseInt(req.params.id);
  const leadIds = Array.isArray(req.body.lead_ids) ? req.body.lead_ids.map(Number).filter(Number.isFinite) : [];
  if (leadIds.length === 0) return bad(res, 'lead_ids array vazio');
  if (leadIds.length > 10000) return bad(res, 'max 10000 leads por request');
  const aud = audienciasService.getById(id);
  if (!aud) return bad(res, 'audiencia nao encontrada', 404);
  if (aud.tipo !== 'estatica') return bad(res, 'so audiencia estatica aceita add-leads');
  const added = audienciasService.addLeads(id, leadIds);
  res.json({ success: true, added });
});

router.delete('/audiencias/:id/leads/:leadId', (req, res) => {
  const id = parseInt(req.params.id);
  const leadId = parseInt(req.params.leadId);
  const aud = audienciasService.getById(id);
  if (!aud) return bad(res, 'audiencia nao encontrada', 404);
  const removed = audienciasService.removeLead(id, leadId);
  res.json({ success: removed });
});

// Live count para UI (dinamica sem persistir): POST /api/audiencias/count
router.post('/audiencias/count', (req, res) => {
  try {
    const total = audienciasService.countByFiltros(req.body?.filtros || {});
    res.json({ total });
  } catch (err) { bad(res, err.message); }
});

// === TEMPLATES (Sprint 4 / T5) — CRUD completo com Zod ===
router.get('/templates', (req, res) => {
  res.json({ templates: templatesService.list(req.query) });
});

router.post('/templates', validate(schemas.template), (req, res) => {
  try {
    const tpl = templatesService.create(req.body);
    res.status(201).json({ template: tpl });
  } catch (err) { bad(res, err.message); }
});

router.get('/templates/:id', (req, res) => {
  const tpl = templatesService.getById(parseInt(req.params.id));
  if (!tpl) return bad(res, 'template nao encontrado', 404);
  res.json({ template: tpl });
});

router.put('/templates/:id', validate(schemas.templateUpdate), (req, res) => {
  const id = parseInt(req.params.id);
  const current = templatesService.getById(id);
  if (!current) return bad(res, 'template nao encontrado', 404);
  try {
    const tpl = templatesService.update(id, req.body);
    res.json({ template: tpl });
  } catch (err) { bad(res, err.message); }
});

router.delete('/templates/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const current = templatesService.getById(id);
  if (!current) return bad(res, 'template nao encontrado', 404);
  templatesService.remove(id); // soft delete ativo=0
  res.json({ success: true, soft_deleted: true });
});

// GET /api/templates/:id/render?leadId=X
router.get('/templates/:id/render', (req, res) => {
  const id = parseInt(req.params.id);
  const leadId = parseInt(req.query.leadId);
  if (!leadId) return bad(res, 'leadId obrigatorio');
  const result = templatesService.renderForLead(id, leadId);
  if (!result) return bad(res, 'template nao encontrado', 404);
  res.json(result);
});

// GET /api/templates/:id/preview?audienciaId=Y&n=3
router.get('/templates/:id/preview', (req, res) => {
  const id = parseInt(req.params.id);
  const audienciaId = parseInt(req.query.audienciaId);
  const n = Math.min(10, Math.max(1, parseInt(req.query.n) || 3));
  if (!audienciaId) return bad(res, 'audienciaId obrigatorio');
  const samples = templatesService.previewWithSamples(id, audienciaId, n);
  if (!samples) return bad(res, 'template nao encontrado', 404);
  res.json({ samples });
});

// POST /api/templates/:id/clone
router.post('/templates/:id/clone', (req, res) => {
  const id = parseInt(req.params.id);
  const cloned = templatesService.clone(id, { nome: req.body?.nome });
  if (!cloned) return bad(res, 'template nao encontrado', 404);
  res.status(201).json({ template: cloned });
});

// POST /api/templates/render-preview — render live no editor (sem persistir)
router.post('/templates/render-preview', (req, res) => {
  const { conteudo, vars } = req.body || {};
  if (typeof conteudo !== 'string') return bad(res, 'conteudo obrigatorio (string)');
  if (conteudo.length > 4096) return bad(res, 'conteudo max 4096 chars');
  res.json(templatesService.renderPreview(conteudo, vars || {}));
});

// ---- Smoke test endpoint (Sprint 5 / T5) ----
// POST /api/campanhas/smoke-test
// Cria audiencia + template + campanha de teste com ate 10 telefones
router.post('/campanhas/smoke-test', (req, res) => {
  const telefones = Array.isArray(req.body.telefones) ? req.body.telefones : [];
  if (telefones.length < 1 || telefones.length > 10) {
    return bad(res, 'Forneca 1-10 telefones de teste');
  }
  try {
    const db = getDb();
    // 1. Cria leads se nao existirem
    const leadIds = [];
    const insertLead = db.prepare(`
      INSERT INTO leads (telefone, nome, origem)
      VALUES (?, ?, 'smoke_test')
      ON CONFLICT(telefone) DO UPDATE SET atualizado_em = CURRENT_TIMESTAMP
    `);
    const getLead = db.prepare('SELECT id FROM leads WHERE telefone = ?');
    telefones.forEach((tel, idx) => {
      const clean = String(tel).replace(/\D/g, '');
      if (!clean) return;
      insertLead.run(clean, `Smoke Test ${idx + 1}`);
      const row = getLead.get(clean);
      if (row) leadIds.push(row.id);
    });

    // 2. Cria audiencia estatica
    const audNome = `Smoke Test ${new Date().toISOString().slice(0, 16)}`;
    const aud = audienciasService.create({
      nome: audNome,
      descricao: 'Audiencia gerada automaticamente pelo endpoint smoke-test',
      tipo: 'estatica'
    });
    audienciasService.addLeads(aud.id, leadIds);

    // 3. Cria template simples
    const tpl = templatesService.create({
      nome: 'Smoke Test Template',
      conteudo: 'Ola {{primeiro_nome}}! Teste interno do Broadcast Engine (Sprint 5).',
      agente: req.body.agente_remetente || 'carlos',
      descricao: 'Template gerado para smoke test'
    });

    // 4. Cria campanha em rascunho (nao dispara)
    const campanha = campanhasService.create({
      nome: `Smoke Test ${new Date().toISOString().slice(0, 16)}`,
      audiencia_id: aud.id,
      template_id: tpl.id,
      agente_remetente: req.body.agente_remetente || 'carlos',
      rate_limit_per_min: 5,
      jitter_min_sec: 3,
      jitter_max_sec: 5,
      criada_por: 'smoke-test'
    });

    res.status(201).json({
      campanha_id: campanha.id,
      audiencia_id: aud.id,
      template_id: tpl.id,
      lead_ids: leadIds,
      instrucoes: 'Campanha criada em rascunho. Chame POST /api/campanhas/:id/start para disparar.'
    });
  } catch (err) {
    bad(res, err.message, 500);
  }
});

// POST /api/consent/opt-out { telefone, motivo }
router.post('/consent/opt-out', (req, res) => {
  const { telefone, motivo } = req.body;
  if (!telefone) return bad(res, 'telefone obrigatorio');
  consent.markOptOut(telefone, motivo || 'manual');
  res.json({ success: true });
});

router.delete('/consent/opt-out/:telefone', (req, res) => {
  consent.clearOptOut(req.params.telefone);
  res.json({ success: true });
});

router.get('/consent/:telefone', (req, res) => {
  res.json(consent.canSendTo(req.params.telefone));
});

// === CONSENTIMENTO (Sprint 2 / T3) - CRUD admin sobre lead_opt_out ===
// GET /api/consentimento - lista paginada
router.get('/consentimento', (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const items = consent.listOptOuts({ limit, offset });
  res.json({ items, total: items.length });
});

// GET /api/consentimento/:telefone - detalhe
router.get('/consentimento/:telefone', (req, res) => {
  const row = consent.getOptOut(req.params.telefone);
  if (!row) return res.status(404).json({ error: 'telefone nao encontrado em lead_opt_out' });
  res.json({ optout: row });
});

// POST /api/consentimento/:telefone/optout - admin marca opt-out manualmente
router.post('/consentimento/:telefone/optout', (req, res) => {
  const { motivo, canal } = req.body || {};
  const ok = consent.markOptOut(req.params.telefone, motivo || 'admin_manual', canal || 'admin');
  if (!ok) return bad(res, 'telefone invalido');
  res.json({ success: true });
});

// DELETE /api/consentimento/:telefone - admin reverte opt-out
router.delete('/consentimento/:telefone', (req, res) => {
  const ok = consent.clearOptOut(req.params.telefone);
  res.json({ success: ok });
});

// ---- Admin / kill switch (Sprint 5 / T5) ----
function requireAdminConfirm(req, res, next) {
  if (req.headers['x-admin-confirm'] !== 'yes') {
    return bad(res, 'X-Admin-Confirm: yes requerido', 403);
  }
  next();
}

const envFile = require('../utils/env-file');
const path = require('path');
const ENV_PATH = process.env.ENV_FILE_PATH || path.join(__dirname, '../../.env');

function notifyAlertWebhook(message) {
  const url = process.env.ERROR_REPORT_WEBHOOK;
  if (!url) return;
  const body = JSON.stringify({ content: message, ts: new Date().toISOString() });
  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    }).catch(err => console.warn('[ALERT-WEBHOOK] falhou:', err.message));
  } catch (err) {
    console.warn('[ALERT-WEBHOOK] falhou:', err.message);
  }
}

// POST /api/admin/kill-broadcast — exige header X-Admin-Confirm: yes
router.post('/admin/kill-broadcast', requireAdminConfirm, async (req, res) => {
  // Pausa todas campanhas ativas (efeito imediato observavel)
  const affected = campanhasService.pauseAll();

  // Persiste flag no .env (kill switch global reconhecido pelo worker em <=10s)
  try {
    envFile.setEnvVar(ENV_PATH, 'BROADCAST_WORKER_ENABLED', 'false');
    process.env.BROADCAST_WORKER_ENABLED = 'false';
  } catch (err) {
    console.warn('[KILL-SWITCH] falha ao atualizar .env:', err.message);
  }

  // Alerta (fail-safe)
  notifyAlertWebhook(`[KILL-SWITCH] Broadcast desligado via API. ${affected} campanha(s) pausada(s).`);

  res.json({
    success: true,
    action: 'kill-broadcast',
    campanhas_pausadas: affected,
    pending_restart: true,
    observacao: 'Worker lê .env a cada iteração e ficará idle em <=10s. Para restart total do container, rode: docker compose restart worker'
  });
});

// POST /api/admin/resume-broadcast
router.post('/admin/resume-broadcast', requireAdminConfirm, (req, res) => {
  try {
    envFile.setEnvVar(ENV_PATH, 'BROADCAST_WORKER_ENABLED', 'true');
    process.env.BROADCAST_WORKER_ENABLED = 'true';
  } catch (err) {
    console.warn('[RESUME] falha ao atualizar .env:', err.message);
  }
  res.json({ success: true, action: 'resume-broadcast' });
});

// GET /api/admin/broadcast-status
router.get('/admin/broadcast-status', (req, res) => {
  const db = getDb();
  const ativas = db.prepare(
    "SELECT id, nome, status, enviados_count, falhas_count, total_envios FROM campanhas WHERE status IN ('enviando','pausada','agendada')"
  ).all();
  res.json({
    kill_switch: process.env.BROADCAST_WORKER_ENABLED === 'false',
    worker: broadcastWorker.status(),
    campanhas_ativas: ativas
  });
});

// GET /api/health/deep (Sprint 5 / T5 + Sprint 3 / T4)
// Publico: retorna apenas { status }. Autenticado (Bearer): retorna JSON completo.
const healthChecker = require('../services/health-checker');
router.get('/health/deep', async (req, res) => {
  const authz = req.get('authorization') || '';
  const isAuthed = /^Bearer\s+(.+)$/i.test(authz) &&
    authz.split(/\s+/)[1] === process.env.API_AUTH_TOKEN;

  let extra = {};
  try {
    const db = getDb();
    const heartbeat = broadcastWorker.readHeartbeat();
    const now = Date.now();
    const ageSec = heartbeat ? Math.round((now - new Date(heartbeat.ts).getTime()) / 1000) : null;
    const stale = ageSec == null || ageSec > 60;
    const pendentes = db.prepare(
      "SELECT COUNT(*) AS c FROM campanha_envios WHERE status = 'pendente'"
    ).get().c;
    const ativas = db.prepare(
      "SELECT COUNT(*) AS c FROM campanhas WHERE status = 'enviando'"
    ).get().c;
    extra.broadcast_worker = {
      status: stale ? 'degraded' : 'ok',
      last_heartbeat: heartbeat?.ts || null,
      heartbeat_age_sec: ageSec,
      campanhas_ativas: ativas,
      envios_pendentes: pendentes,
      kill_switch_active: process.env.BROADCAST_WORKER_ENABLED === 'false',
    };
  } catch (err) {
    extra.broadcast_worker = { status: 'down', error: err.message };
  }

  const deep = await healthChecker.runAll();
  const checks = { ...deep.checks, ...extra };

  // overall leva em conta os extras
  let overall = deep.status;
  for (const v of Object.values(extra)) {
    if (v.status === 'down') { overall = 'down'; break; }
    if (v.status === 'degraded' && overall === 'ok') overall = 'degraded';
  }

  const httpStatus = overall === 'down' ? 503 : 200;
  if (!isAuthed) {
    return res.status(httpStatus).json({ status: overall });
  }
  res.status(httpStatus).json({
    status: overall,
    timestamp: deep.timestamp,
    checks,
  });
});

// === FUNIL / PIPELINE REPORT ===
router.get('/funil', (req, res) => {
  const db = getDb();
  
  const etapas = ['novo','prospeccao','qualificacao','demo_agendada','proposta_enviada','negociacao','fechamento','convertido','nurturing','perdido'];
  const funil = etapas.map(e => {
    const dados = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(valor_estimado),0) as valor FROM leads WHERE etapa_funil = ?').get(e);
    return { etapa: e, ...dados };
  });
  
  // Taxa de conversao entre etapas
  const totalNovos = db.prepare('SELECT COUNT(*) as c FROM leads').get().c || 1;
  const taxas = funil.map(f => ({ ...f, taxa: ((f.count / totalNovos) * 100).toFixed(1) }));
  
  res.json({ funil: taxas });
});

// Webhook setup
router.post('/setup-webhook', async (req, res) => {
  try {
    const webhookUrl = req.body.url || process.env.WEBHOOK_URL;
    await zapi.setWebhook(`${webhookUrl}/webhook/zapi`);
    res.json({ success: true, webhook: `${webhookUrl}/webhook/zapi` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === SKILLS / KNOWLEDGE STATUS ===
const training = require('../services/training');
const skillsKnowledge = require('../services/skills-knowledge');

router.get('/skills/status', (req, res) => {
  const agents = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'iani'];
  const status = {};
  for (const agent of agents) {
    const k = skillsKnowledge.getKnowledgeForAgent(agent);
    status[agent] = { loaded: !!k, chars: k ? k.length : 0, tokens_est: k ? Math.round(k.length / 4) : 0 };
  }
  res.json({ agents: status });
});

router.get('/skills/test/:agent/:taskType?', (req, res) => {
  const { agent, taskType } = req.params;
  const ctx = skillsKnowledge.getCompactContext(agent, taskType || 'general');
  res.json({ agent, taskType: taskType || 'general', length: ctx.length, preview: ctx.substring(0, 500) });
});

// === TRAINING ===
router.get('/training/stats', (req, res) => {
  res.json(training.getStats());
});

router.get('/training/rules/:agent', (req, res) => {
  const rules = training.getRulesForAgent(req.params.agent, 50);
  res.json({ agent: req.params.agent, total: rules.length, rules });
});

router.post('/training/learn', (req, res) => {
  const { agente, tipo, regra, contexto } = req.body;
  if (!agente || !tipo || !regra) return res.status(400).json({ error: 'agente, tipo e regra sao obrigatorios' });
  const id = training.learn(agente, tipo, regra, contexto);
  res.json({ id, message: 'Regra registrada' });
});

router.delete('/training/rules/:id', (req, res) => {
  training.disable(req.params.id);
  res.json({ message: 'Regra desativada' });
});

// Avaliacoes do supervisor
router.get('/training/avaliacoes', (req, res) => {
  const db = getDb();
  const { agente, limit } = req.query;
  let query = 'SELECT a.*, l.nome as lead_nome, l.provedor FROM avaliacoes a LEFT JOIN leads l ON a.lead_id = l.id';
  const params = [];
  if (agente) { query += ' WHERE a.agente = ?'; params.push(agente); }
  query += ' ORDER BY a.criado_em DESC LIMIT ?';
  params.push(parseInt(limit) || 50);
  res.json(db.prepare(query).all(...params));
});

// Nota media por agente
router.get('/training/avaliacoes/resumo', (req, res) => {
  const db = getDb();
  res.json(db.prepare(`
    SELECT agente,
      COUNT(*) as total,
      ROUND(AVG(nota), 1) as nota_media,
      SUM(CASE WHEN nota >= 4 THEN 1 ELSE 0 END) as boas,
      SUM(CASE WHEN nota <= 2 THEN 1 ELSE 0 END) as ruins
    FROM avaliacoes GROUP BY agente
  `).all());
});

// === FOLLOW-UPS ===
const followup = require('../services/followup');

router.get('/followups', (req, res) => {
  res.json({ followups: followup.getPending() });
});

router.delete('/followups/:leadId', (req, res) => {
  followup.cancelFollowups(parseInt(req.params.leadId));
  res.json({ message: 'Followups cancelados' });
});

// === A/B TESTING ===
const abTesting = require('../services/ab-testing');

router.get('/ab-tests', (req, res) => {
  const { status } = req.query;
  res.json({ tests: abTesting.list(status || null) });
});

router.post('/ab-tests', async (req, res) => {
  try {
    const { agente, tipo_mensagem, variante_a, variante_b, min_envios } = req.body;
    if (!agente || !tipo_mensagem || !variante_a || !variante_b) {
      return res.status(400).json({ error: 'agente, tipo_mensagem, variante_a e variante_b obrigatorios' });
    }
    const id = abTesting.createTest(agente, tipo_mensagem, variante_a, variante_b, min_envios || 20);
    res.json({ id, message: 'Teste A/B criado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ab-tests/:id', (req, res) => {
  const detail = abTesting.getDetail(parseInt(req.params.id));
  if (!detail) return res.status(404).json({ error: 'Teste nao encontrado' });
  res.json(detail);
});

router.post('/ab-tests/:id/conclude', (req, res) => {
  const vencedor = abTesting.conclude(parseInt(req.params.id));
  if (!vencedor) return res.status(400).json({ error: 'Teste nao pode ser concluido' });
  res.json({ vencedor });
});

// === RELATORIOS ===
const pdfReport = require('../services/pdf-report');

router.get('/relatorios/performance', async (req, res) => {
  try {
    const { periodo, agente } = req.query;
    const report = await pdfReport.generatePerformanceReport(periodo || 'mensal', agente || 'todos');
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tarefa 3: Download PDF real
router.get('/relatorios/pdf', async (req, res) => {
  try {
    const { periodo } = req.query;
    const pdfBuffer = await pdfReport.generatePDF(periodo || 'mensal');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio-${periodo || 'mensal'}-${new Date().toISOString().split('T')[0]}.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === SETTINGS / SYSTEM INFO (Sprint 7 polish) ===
// Retorna estado das integracoes + flags. NAO expoe secrets.
router.get('/settings/system', (req, res) => {
  const env = process.env;
  const mask = v => !v ? null : `${v.slice(0, 4)}****${v.slice(-4)}`;
  res.json({
    environment: env.NODE_ENV || 'development',
    integrations: {
      anthropic: { configured: !!env.ANTHROPIC_API_KEY, key_preview: mask(env.ANTHROPIC_API_KEY) },
      zapi: {
        configured: !!(env.ZAPI_INSTANCE_ID && env.ZAPI_TOKEN),
        instance_preview: mask(env.ZAPI_INSTANCE_ID),
        webhook_enforce: env.ZAPI_WEBHOOK_ENFORCE === 'true',
      },
      apify: { configured: !!env.APIFY_TOKEN, token_preview: mask(env.APIFY_TOKEN) },
      resend: { configured: !!env.RESEND_API_KEY },
      google_maps: { configured: !!env.GOOGLE_MAPS_API_KEY },
    },
    flags: {
      broadcast_worker_enabled: env.BROADCAST_WORKER_ENABLED !== 'false',
      followup_worker_enabled: env.FOLLOWUP_WORKER_ENABLED !== 'false',
      run_workers_in_server: env.RUN_WORKERS_IN_SERVER === 'true',
    },
    limits: {
      cost_alert_daily_usd: parseFloat(env.COST_ALERT_DAILY_USD || '25'),
      broadcast_rate_per_min: parseInt(env.BROADCAST_RATE_PER_MIN || '20'),
      broadcast_max_retries: parseInt(env.BROADCAST_MAX_RETRIES || '3'),
      broadcast_failure_threshold_pct: parseInt(env.BROADCAST_FAILURE_THRESHOLD_PCT || '20'),
    },
    auth: {
      api_token_present: !!env.API_AUTH_TOKEN,
      login_password_set: !!env.LOGIN_PASSWORD,
      zapi_webhook_token_present: !!env.ZAPI_WEBHOOK_TOKEN,
    },
    sistema: {
      version: '1.0.0',
      uptime_sec: Math.round(process.uptime()),
      node_version: process.version,
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  });
});

// === APIFY PROSPECCAO (Sprint 7) ===
const apifyService = require('../services/apify');
const leadImporter = require('../services/lead-importer');

// GET /api/apify/catalog — lista actors pre-configurados
router.get('/apify/catalog', (req, res) => {
  res.json({
    configured: apifyService.client.isConfigured(),
    actors: apifyService.listCatalog(),
  });
});

// POST /api/apify/ping — valida APIFY_TOKEN
router.post('/apify/ping', async (req, res) => {
  if (!apifyService.client.isConfigured()) {
    return res.status(503).json({ error: 'apify_not_configured', hint: 'set APIFY_TOKEN no .env' });
  }
  try {
    const me = await apifyService.client.ping();
    res.json({ ok: true, user: { username: me?.data?.username, email: me?.data?.email, plan: me?.data?.plan } });
  } catch (err) { bad(res, err.message); }
});

// GET /api/apify/runs — historico
router.get('/apify/runs', (req, res) => {
  const db = getDb();
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const items = db.prepare(
    `SELECT id, actor_id, actor_label, apify_run_id, status, items_count,
            leads_novos, leads_dup, leads_invalidos, cost_usd, duracao_ms,
            iniciado_em, finalizado_em, importado_em, erro
     FROM apify_runs ORDER BY iniciado_em DESC LIMIT ?`
  ).all(limit);
  res.json({ items, total: items.length });
});

// GET /api/apify/runs/:id — detalhe + params
router.get('/apify/runs/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM apify_runs WHERE id = ?').get(parseInt(req.params.id));
  if (!row) return bad(res, 'run nao encontrado', 404);
  res.json({ run: row });
});

// POST /api/apify/run — dispara actor (sync com timeout, ou async)
router.post('/apify/run', validate(schemas.apifyRun), async (req, res) => {
  if (!apifyService.client.isConfigured()) {
    return res.status(503).json({ error: 'apify_not_configured' });
  }

  const { actor_id, input = {}, sync = false, timeout_sec = 240, iniciada_por = null, auto_import = true } = req.body;
  const catalogEntry = apifyService.getCatalogEntry(actor_id);
  const finalInput = Object.keys(input).length > 0 ? input : (catalogEntry?.default_input || {});

  const db = getDb();
  const ins = db.prepare(`
    INSERT INTO apify_runs
      (actor_id, actor_label, params, status, iniciada_por)
    VALUES (?, ?, ?, 'running', ?)
  `).run(actor_id, catalogEntry?.label || actor_id, JSON.stringify(finalInput), iniciada_por);
  const runId = ins.lastInsertRowid;

  const t0 = Date.now();
  try {
    if (sync) {
      // Modo sincrono: bloqueia ate o actor terminar (max timeout_sec)
      const items = await apifyService.client.runSyncGetItems(actor_id, finalInput, { timeoutSec: timeout_sec });
      const duracao_ms = Date.now() - t0;
      let stats = { novos: 0, dup: 0, invalidos: 0, total: items.length, shape: 'unknown' };
      if (auto_import) {
        stats = leadImporter.importItems(items, { runId });
      }
      db.prepare(`
        UPDATE apify_runs SET
          status = 'imported', items_count = ?, leads_novos = ?, leads_dup = ?,
          leads_invalidos = ?, duracao_ms = ?, finalizado_em = CURRENT_TIMESTAMP,
          importado_em = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(items.length, stats.novos, stats.dup, stats.invalidos, duracao_ms, runId);
      return res.json({ run_id: runId, mode: 'sync', items_count: items.length, stats, shape: stats.shape });
    } else {
      // Modo async: dispara e retorna imediato. Cliente faz polling via GET /runs/:id
      const meta = await apifyService.client.startRun(actor_id, finalInput);
      db.prepare(`UPDATE apify_runs SET apify_run_id = ?, status = 'running' WHERE id = ?`)
        .run(meta.id, runId);
      return res.status(202).json({ run_id: runId, mode: 'async', apify_run_id: meta.id, status: meta.status });
    }
  } catch (err) {
    db.prepare(`
      UPDATE apify_runs SET status = 'failed', erro = ?,
        duracao_ms = ?, finalizado_em = CURRENT_TIMESTAMP WHERE id = ?
    `).run(err.message.slice(0, 500), Date.now() - t0, runId);
    return res.status(500).json({ error: err.message, run_id: runId });
  }
});

// POST /api/apify/runs/:id/refresh — busca status na Apify e importa se terminou
router.post('/apify/runs/:id/refresh', async (req, res) => {
  if (!apifyService.client.isConfigured()) {
    return res.status(503).json({ error: 'apify_not_configured' });
  }
  const db = getDb();
  const id = parseInt(req.params.id);
  const run = db.prepare('SELECT * FROM apify_runs WHERE id = ?').get(id);
  if (!run) return bad(res, 'run nao encontrado', 404);
  if (!run.apify_run_id) return bad(res, 'run nao tem apify_run_id (foi sync ou erro inicial)');

  try {
    const meta = await apifyService.client.getRun(run.apify_run_id);
    const status = (meta.status || 'unknown').toLowerCase();
    let updates = { status };

    if (status === 'succeeded') {
      const datasetId = meta.defaultDatasetId;
      const items = await apifyService.client.getDatasetItems(datasetId);
      const stats = leadImporter.importItems(items, { runId: id });
      db.prepare(`
        UPDATE apify_runs SET
          status = 'imported', items_count = ?, leads_novos = ?, leads_dup = ?,
          leads_invalidos = ?, finalizado_em = CURRENT_TIMESTAMP, importado_em = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(items.length, stats.novos, stats.dup, stats.invalidos, id);
      return res.json({ run_id: id, status: 'imported', stats });
    }

    db.prepare('UPDATE apify_runs SET status = ? WHERE id = ?').run(status, id);
    res.json({ run_id: id, status, apify_meta: { startedAt: meta.startedAt, finishedAt: meta.finishedAt } });
  } catch (err) { bad(res, err.message); }
});

// === ERRORS LOG (Sprint 3 / T5) ===
const errorTracker = require('../services/error-tracker');

router.get('/errors', (req, res) => {
  const db = getDb();
  const limit = Math.min(500, parseInt(req.query.limit) || 100);
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const includeResolved = req.query.all === 'true';
  const where = includeResolved ? '1=1' : 'resolvido = 0';
  const items = db.prepare(
    `SELECT id, tipo, mensagem, correlation_id, resolvido, criado_em
     FROM errors_log WHERE ${where} ORDER BY criado_em DESC LIMIT ? OFFSET ?`
  ).all(limit, offset);
  const total = db.prepare(
    `SELECT COUNT(*) AS c FROM errors_log WHERE ${where}`
  ).get().c;
  res.json({ items, total, limit, offset });
});

router.get('/errors/count', (req, res) => {
  const db = getDb();
  const unresolved = db.prepare('SELECT COUNT(*) AS c FROM errors_log WHERE resolvido = 0').get().c;
  const last24h = db.prepare(
    "SELECT COUNT(*) AS c FROM errors_log WHERE criado_em >= DATETIME('now','-1 day')"
  ).get().c;
  res.json({ unresolved, last_24h: last24h });
});

// === REGIOES IBGE (regionalizacao da prospeccao) ===
router.get('/regioes/estados', (req, res) => {
  try {
    const regioes = require('../services/regioes');
    res.json({ estados: regioes.listEstados() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/regioes/:uf/mesorregioes', (req, res) => {
  try {
    const regioes = require('../services/regioes');
    const uf = req.params.uf.toUpperCase();
    const mesorregioes = regioes.listMesorregioes(uf);
    res.json({ uf, mesorregioes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/regioes/:uf/mesorregioes/:slug', (req, res) => {
  try {
    const regioes = require('../services/regioes');
    const detalhe = regioes.getMesorregiao(req.params.uf.toUpperCase(), req.params.slug);
    if (!detalhe) return res.status(404).json({ error: 'mesorregiao_nao_encontrada' });
    res.json(detalhe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Breakdown por ERP — quantas ISPs prospectadas usam cada ERP
router.get('/regioes/erp-breakdown', (req, res) => {
  const db = getDb();
  try {
    const erpDetector = require('../services/erp-detector');
    const suportados = erpDetector.listSuportados();
    const porErp = db
      .prepare(
        `SELECT erp, COUNT(*) AS total,
                SUM(CASE WHEN classificacao IN ('quente','ultra_quente') THEN 1 ELSE 0 END) AS quentes,
                SUM(CASE WHEN etapa_funil = 'ganho' THEN 1 ELSE 0 END) AS ganhos
         FROM leads
         WHERE erp IS NOT NULL AND erp != ''
         GROUP BY erp ORDER BY total DESC`
      )
      .all();
    const totalComErp = porErp.reduce((s, x) => s + (x.total || 0), 0);
    const totalSemErp = db
      .prepare(
        "SELECT COUNT(*) AS c FROM leads WHERE origem = 'prospector_auto' AND (erp IS NULL OR erp = '')"
      )
      .get().c;

    res.json({
      por_erp: porErp,
      total_com_erp: totalComErp,
      total_sem_erp: totalSemErp,
      erps_suportados: suportados
    });
  } catch (err) {
    res.json({ por_erp: [], total_com_erp: 0, total_sem_erp: 0, erps_suportados: [], _error: err.message });
  }
});

// Cobertura por mesorregiao — quantas leads ja prospectadas por regiao
router.get('/regioes/cobertura', (req, res) => {
  try {
    const regioes = require('../services/regioes');
    const db = getDb();
    const all = regioes.listAllMesorregioes();

    // Agrega leads por mesorregiao
    const stats = db.prepare(`
      SELECT estado, mesorregiao, mesorregiao_nome,
             COUNT(*) AS total,
             SUM(CASE WHEN classificacao IN ('quente','ultra_quente') THEN 1 ELSE 0 END) AS quentes,
             SUM(CASE WHEN etapa_funil = 'ganho' THEN 1 ELSE 0 END) AS ganhos,
             SUM(CASE WHEN enriched_at IS NOT NULL THEN 1 ELSE 0 END) AS enriquecidos
      FROM leads
      WHERE mesorregiao IS NOT NULL
      GROUP BY 1,2,3
    `).all();

    const byKey = new Map();
    for (const s of stats) byKey.set(`${s.estado}:${s.mesorregiao}`, s);

    const cobertura = all.map((m) => {
      const s = byKey.get(`${m.uf}:${m.slug}`) || {};
      return {
        uf: m.uf,
        uf_nome: m.uf_nome,
        slug: m.slug,
        nome: m.nome,
        total_cidades: m.total_cidades,
        leads_prospectados: s.total || 0,
        leads_quentes: s.quentes || 0,
        ganhos: s.ganhos || 0,
        enriquecidos: s.enriquecidos || 0,
        densidade: s.total || 0 // proxy simples: total leads na regiao
      };
    });

    res.json({ cobertura });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === PROSPECTOR AUTONOMO (Milestone 1 / C) — config + stats + manual trigger ===
router.get('/prospector/config', (req, res) => {
  const db = getDb();
  try {
    const row = db.prepare('SELECT * FROM prospector_config WHERE id = 1').get();
    if (!row) return res.json({ enabled: false, regioes: [], mesorregioes: [], termos: [], _missing: true });
    res.json({
      enabled: !!row.enabled,
      regioes: JSON.parse(row.regioes || '[]'),
      mesorregioes: JSON.parse(row.mesorregioes || '[]'),
      termos: JSON.parse(row.termos || '[]'),
      max_leads_por_run: row.max_leads_por_run,
      min_rating: row.min_rating,
      min_reviews: row.min_reviews,
      scraping_cron: row.scraping_cron,
      validation_cron: row.validation_cron,
      atualizado_em: row.atualizado_em
    });
  } catch (err) {
    res.json({ enabled: false, _migration_pending: true });
  }
});

router.patch('/prospector/config', (req, res) => {
  const body = req.body || {};
  const db = getDb();
  try {
    const existing = db.prepare('SELECT * FROM prospector_config WHERE id = 1').get();
    const updates = {
      enabled:
        body.enabled !== undefined
          ? body.enabled
            ? 1
            : 0
          : existing?.enabled ?? 0,
      regioes:
        body.regioes !== undefined
          ? JSON.stringify(Array.isArray(body.regioes) ? body.regioes : [])
          : existing?.regioes ?? '[]',
      mesorregioes:
        body.mesorregioes !== undefined
          ? JSON.stringify(Array.isArray(body.mesorregioes) ? body.mesorregioes : [])
          : existing?.mesorregioes ?? '[]',
      termos:
        body.termos !== undefined
          ? JSON.stringify(Array.isArray(body.termos) ? body.termos : [])
          : existing?.termos ?? '[]',
      max_leads_por_run: Number(body.max_leads_por_run) || existing?.max_leads_por_run || 50,
      min_rating: Number(body.min_rating) || existing?.min_rating || 3.5,
      min_reviews: Number(body.min_reviews) || existing?.min_reviews || 3,
      scraping_cron: body.scraping_cron || existing?.scraping_cron || '0 8 * * 1,3,5',
      validation_cron: body.validation_cron || existing?.validation_cron || '0 9 * * *'
    };
    db.prepare(
      `INSERT INTO prospector_config (id, enabled, regioes, mesorregioes, termos, max_leads_por_run, min_rating, min_reviews, scraping_cron, validation_cron, atualizado_em)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         enabled = excluded.enabled,
         regioes = excluded.regioes,
         mesorregioes = excluded.mesorregioes,
         termos = excluded.termos,
         max_leads_por_run = excluded.max_leads_por_run,
         min_rating = excluded.min_rating,
         min_reviews = excluded.min_reviews,
         scraping_cron = excluded.scraping_cron,
         validation_cron = excluded.validation_cron,
         atualizado_em = CURRENT_TIMESTAMP`
    ).run(
      updates.enabled,
      updates.regioes,
      updates.mesorregioes,
      updates.termos,
      updates.max_leads_por_run,
      updates.min_rating,
      updates.min_reviews,
      updates.scraping_cron,
      updates.validation_cron
    );
    res.json({ success: true, config: updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/prospector/stats', (req, res) => {
  const db = getDb();
  try {
    const validator = require('../services/lead-validator');
    const queueStats = validator.stats();
    const leadsAuto = db
      .prepare(
        "SELECT COUNT(*) AS total FROM leads WHERE origem = 'prospector_auto'"
      )
      .get();
    const ultimos7d = db
      .prepare(
        "SELECT COUNT(*) AS c FROM leads WHERE origem = 'prospector_auto' AND criado_em > DATE('now','-7 day')"
      )
      .get();
    const runsRecentes = db
      .prepare(
        "SELECT id, status, items_count, leads_novos, iniciado_em, duracao_ms, iniciada_por FROM apify_runs WHERE iniciada_por = 'prospector_cron' ORDER BY id DESC LIMIT 10"
      )
      .all();
    res.json({
      queue: queueStats,
      leads_importados: leadsAuto?.total || 0,
      leads_ultimos_7d: ultimos7d?.c || 0,
      runs_recentes: runsRecentes
    });
  } catch (err) {
    res.json({
      queue: { by_status: [] },
      leads_importados: 0,
      leads_ultimos_7d: 0,
      runs_recentes: [],
      _migration_pending: true
    });
  }
});

// Trigger manual: pra testar sem esperar cron
router.post('/prospector/run-scraping', async (req, res) => {
  try {
    const prospector = require('../workers/prospector');
    const result = await prospector.runScraping();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/prospector/run-validation', async (req, res) => {
  try {
    const prospector = require('../workers/prospector');
    const result = await prospector.runValidation();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ENRICHER (Apify contact-info-scraper + ReceitaWS) ===
router.get('/enricher/stats', (req, res) => {
  try {
    const enricher = require('../services/enricher');
    res.json(enricher.stats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/enricher/run', async (req, res) => {
  try {
    const enricher = require('../services/enricher');
    const limit = Math.min(Math.max(parseInt(req.body?.limit) || 20, 1), 100);
    const force = !!req.body?.force;
    const result = await enricher.enrichBatch({ limit, force });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/leads/:id/enrich-site', async (req, res) => {
  try {
    const enricher = require('../services/enricher');
    const result = await enricher.enrichLead(parseInt(req.params.id));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === RECEITAWS (enriquecimento CNPJ) ===
router.get('/receitaws/cnpj/:cnpj', async (req, res) => {
  try {
    const receitaws = require('../services/receitaws');
    const result = await receitaws.lookup(req.params.cnpj);
    if (!result.ok) return res.status(404).json(result);
    res.json({ ok: true, cached: result.cached, summary: receitaws.summarize(result.data), raw: result.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/receitaws/stats', (req, res) => {
  const receitaws = require('../services/receitaws');
  res.json({
    has_token: receitaws.hasToken(),
    cache: receitaws.cacheStats()
  });
});

// Enriquece 1 lead pelo CNPJ salvo (ou passado no body).
router.post('/leads/:id/enrich-cnpj', async (req, res) => {
  try {
    const leadId = parseInt(req.params.id);
    const cnpj = req.body?.cnpj || null;
    const tool = require('../tools/lookup_cnpj');
    const result = await tool.handler({ lead_id: leadId, cnpj, force_refresh: !!req.body?.force_refresh });
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === AUTONOMIA — KILL SWITCHES + AUTO-HEALER (Milestone 3 / G) ===
router.get('/autonomy/kill-switches', (req, res) => {
  try {
    const autoHealer = require('../services/auto-healer');
    res.json(autoHealer.snapshot());
  } catch (err) {
    res.json({ kill_switches: {}, _error: err.message });
  }
});

router.post('/autonomy/kill-switches/:worker', (req, res) => {
  try {
    const autoHealer = require('../services/auto-healer');
    const worker = req.params.worker;
    if (worker === 'all') {
      autoHealer.killAll(req.body?.reason || 'manual kill-all');
    } else {
      autoHealer.setKill(worker, req.body?.reason || 'manual');
    }
    res.json({ success: true, snapshot: autoHealer.snapshot() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/autonomy/kill-switches/:worker', (req, res) => {
  try {
    const autoHealer = require('../services/auto-healer');
    const worker = req.params.worker;
    if (worker === 'all') {
      const cleared = autoHealer.clearAll();
      res.json({ success: true, cleared });
    } else {
      const was = autoHealer.clearKill(worker);
      res.json({ success: true, was_killed: was });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/autonomy/healer/check', async (req, res) => {
  try {
    const autoHealer = require('../services/auto-healer');
    const snap = await autoHealer.runCheck();
    res.json({ success: true, snapshot: snap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ATIVIDADE 360° — TIMELINE UNIFICADA DE TUDO QUE OS AGENTES FIZERAM ===
// Junta: atividades_agentes + agent_tool_calls + handoffs + conversas +
// tarefas + apify_runs em uma ordenacao temporal unica.
router.get('/atividade/timeline', (req, res) => {
  const db = getDb();
  const {
    agente,
    lead_id,
    tipo,          // 'all' | 'tool_call' | 'conversa' | 'handoff' | 'atividade' | 'tarefa' | 'run'
    since,         // ISO timestamp
    limit = 100,
    offset = 0
  } = req.query;

  try {
    const lim = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
    const off = Math.max(parseInt(offset) || 0, 0);
    const tipoFilter = tipo || 'all';
    const sinceSql = since ? `AND criado_em >= ?` : '';
    const agenteSql = agente ? `AND agente = ?` : '';
    const leadSql = lead_id ? `AND lead_id = ?` : '';

    const unions = [];
    const queries = {};

    // 1. Atividades (atividades_agentes)
    if (tipoFilter === 'all' || tipoFilter === 'atividade') {
      queries.atividade = `
        SELECT 'atividade' AS kind, id, agente, lead_id, tipo AS subtipo, descricao,
               decisao AS meta1, score_depois AS meta2, tempo_ms AS duracao_ms,
               criado_em
        FROM atividades_agentes
        WHERE 1=1 ${agenteSql} ${leadSql} ${sinceSql}
      `;
    }

    // 2. Tool calls (agent_tool_calls)
    if (tipoFilter === 'all' || tipoFilter === 'tool_call') {
      queries.tool_call = `
        SELECT 'tool_call' AS kind, id, agente, lead_id, tool_name AS subtipo,
               COALESCE(SUBSTR(tool_input, 1, 200), '') AS descricao,
               status AS meta1, erro AS meta2, duracao_ms,
               criado_em
        FROM agent_tool_calls
        WHERE 1=1 ${agenteSql} ${leadSql} ${sinceSql}
      `;
    }

    // 3. Conversas (conversas) — agrupa direcao na descricao
    if (tipoFilter === 'all' || tipoFilter === 'conversa') {
      queries.conversa = `
        SELECT 'conversa' AS kind, id, agente, lead_id, direcao AS subtipo,
               SUBSTR(mensagem, 1, 300) AS descricao,
               canal AS meta1, tipo AS meta2, tempo_resposta_ms AS duracao_ms,
               criado_em
        FROM conversas
        WHERE 1=1 ${agenteSql} ${leadSql} ${sinceSql}
      `;
    }

    // 4. Handoffs
    if (tipoFilter === 'all' || tipoFilter === 'handoff') {
      queries.handoff = `
        SELECT 'handoff' AS kind, id, de_agente AS agente, lead_id,
               para_agente AS subtipo,
               COALESCE(motivo, '') AS descricao,
               de_agente AS meta1, CAST(score_no_momento AS TEXT) AS meta2,
               NULL AS duracao_ms,
               criado_em
        FROM handoffs
        WHERE 1=1 ${leadSql} ${sinceSql}
      `;
    }

    // 5. Tarefas
    if (tipoFilter === 'all' || tipoFilter === 'tarefa') {
      queries.tarefa = `
        SELECT 'tarefa' AS kind, id, agente, lead_id, tipo AS subtipo,
               descricao, status AS meta1, prioridade AS meta2,
               NULL AS duracao_ms, criado_em
        FROM tarefas
        WHERE 1=1 ${agenteSql} ${leadSql} ${sinceSql}
      `;
    }

    // 6. Apify runs (nao tem lead_id, mas e relevante pra auditoria geral)
    if ((tipoFilter === 'all' || tipoFilter === 'run') && !lead_id) {
      queries.run = `
        SELECT 'run' AS kind, id, COALESCE(iniciada_por, 'apify') AS agente,
               NULL AS lead_id, actor_label AS subtipo,
               COALESCE(status || ' — ' || items_count || ' items, ' || leads_novos || ' novos', '') AS descricao,
               status AS meta1, CAST(cost_usd AS TEXT) AS meta2, duracao_ms,
               iniciado_em AS criado_em
        FROM apify_runs
        WHERE 1=1 ${sinceSql ? 'AND iniciado_em >= ?' : ''}
      `;
    }

    const sources = Object.values(queries).filter(Boolean);
    if (sources.length === 0) return res.json({ items: [], total: 0 });

    const combined = `
      SELECT * FROM (
        ${sources.join(' UNION ALL ')}
      ) AS combined
      ORDER BY criado_em DESC
      LIMIT ? OFFSET ?
    `;

    // Monta params na ordem exata de cada subquery
    const params = [];
    for (const key of Object.keys(queries)) {
      if (key === 'run') {
        if (since) params.push(since);
        continue;
      }
      if (agente && (key !== 'handoff')) params.push(agente);
      if (lead_id) params.push(parseInt(lead_id));
      if (since) params.push(since);
    }
    params.push(lim, off);

    const items = db.prepare(combined).all(...params);
    res.json({ items, count: items.length, limit: lim, offset: off });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Summary agregado pro header do painel 360°
router.get('/atividade/summary', (req, res) => {
  const db = getDb();
  const { since } = req.query;
  try {
    const sinceClause = since ? since : "datetime('now','-24 hours')";
    const row = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM atividades_agentes WHERE criado_em >= ${since ? '?' : sinceClause}) AS atividades,
        (SELECT COUNT(*) FROM agent_tool_calls WHERE criado_em >= ${since ? '?' : sinceClause}) AS tool_calls,
        (SELECT COUNT(*) FROM conversas WHERE criado_em >= ${since ? '?' : sinceClause}) AS conversas,
        (SELECT COUNT(*) FROM handoffs WHERE criado_em >= ${since ? '?' : sinceClause}) AS handoffs,
        (SELECT COUNT(*) FROM tarefas WHERE criado_em >= ${since ? '?' : sinceClause}) AS tarefas
    `).get(...(since ? [since, since, since, since, since] : []));

    const porAgente = db.prepare(`
      SELECT agente, COUNT(*) AS total
      FROM atividades_agentes
      WHERE criado_em >= ${since ? '?' : sinceClause}
      GROUP BY agente ORDER BY total DESC
    `).all(...(since ? [since] : []));

    res.json({ ...row, por_agente: porAgente });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === AUTONOMIA — DASHBOARD UNIFICADO (Frente H) ===
router.get('/autonomy/dashboard', async (req, res) => {
  const db = getDb();
  try {
    const autoHealer = require('../services/auto-healer');

    // Status de cada worker (precisa ir ate o worker.js health, nao temos aqui)
    // Usamos info indireta: kill switches + dados no DB
    const flags = {
      USE_TOOL_CALLING_AGENTS: String(process.env.USE_TOOL_CALLING_AGENTS) === 'true',
      PROSPECTOR_WORKER_ENABLED: String(process.env.PROSPECTOR_WORKER_ENABLED) === 'true',
      OUTBOUND_WORKER_ENABLED: String(process.env.OUTBOUND_WORKER_ENABLED) === 'true',
      SUPERVISOR_WORKER_ENABLED: String(process.env.SUPERVISOR_WORKER_ENABLED) === 'true',
      BROADCAST_WORKER_ENABLED: String(process.env.BROADCAST_WORKER_ENABLED) !== 'false',
      FOLLOWUP_WORKER_ENABLED: String(process.env.FOLLOWUP_WORKER_ENABLED) !== 'false'
    };

    // Pipeline E2E — leads por hora em cada etapa (ultimas 24h)
    const pipeline = db
      .prepare(
        `SELECT
           SUM(CASE WHEN origem = 'prospector_auto' AND criado_em > DATETIME('now','-24 hours') THEN 1 ELSE 0 END) AS prospectados_24h,
           SUM(CASE WHEN etapa_funil = 'qualificacao' THEN 1 ELSE 0 END) AS em_qualificacao,
           SUM(CASE WHEN etapa_funil = 'negociacao' THEN 1 ELSE 0 END) AS em_negociacao,
           SUM(CASE WHEN etapa_funil = 'proposta_enviada' THEN 1 ELSE 0 END) AS com_proposta,
           SUM(CASE WHEN etapa_funil = 'ganho' AND atualizado_em > DATETIME('now','-7 days') THEN 1 ELSE 0 END) AS ganhos_7d,
           SUM(CASE WHEN etapa_funil = 'perdido' AND atualizado_em > DATETIME('now','-7 days') THEN 1 ELSE 0 END) AS perdidos_7d
         FROM leads`
      )
      .get();

    // Ultima acao de cada agente
    const ultimaAcao = db
      .prepare(
        `SELECT agente, MAX(criado_em) AS ultima, COUNT(*) AS total
         FROM atividades_agentes
         WHERE DATE(criado_em) = DATE('now')
         GROUP BY agente`
      )
      .all();

    // Tool calls ultimas 24h por agente
    let toolCalls24h = [];
    try {
      toolCalls24h = db
        .prepare(
          `SELECT agente, tool_name, COUNT(*) AS c
           FROM agent_tool_calls
           WHERE criado_em > DATETIME('now','-24 hours')
           GROUP BY agente, tool_name ORDER BY c DESC LIMIT 20`
        )
        .all();
    } catch {
      /* migration 016 pode nao estar */
    }

    res.json({
      flags,
      kill_switches: autoHealer.snapshot(),
      pipeline,
      ultima_acao_por_agente: ultimaAcao,
      tool_calls_24h: toolCalls24h
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === OUTBOUND WORKER (Milestone 2 / D1) — Carlos SDR autonomo ===
router.get('/outbound/stats', (req, res) => {
  const db = getDb();
  try {
    const outbound = require('../workers/outbound');
    const hoje = db
      .prepare(
        `SELECT COUNT(*) AS c FROM conversas
         WHERE agente = 'carlos' AND direcao = 'enviada'
         AND DATE(criado_em) = DATE('now')
         AND metadata LIKE '%cold_outbound%'`
      )
      .get();
    const qualificados7d = db
      .prepare(
        "SELECT COUNT(*) AS c FROM handoffs WHERE de_agente = 'carlos' AND para_agente = 'lucas' AND criado_em > DATE('now','-7 day')"
      )
      .get();
    const descartados7d = db
      .prepare(
        "SELECT COUNT(*) AS c FROM leads WHERE etapa_funil IN ('nurturing','perdido') AND atualizado_em > DATE('now','-7 day') AND motivo_perda IS NOT NULL"
      )
      .get();
    res.json({
      worker: outbound.status(),
      cold_hoje: hoje?.c || 0,
      qualificados_7d: qualificados7d?.c || 0,
      descartados_7d: descartados7d?.c || 0
    });
  } catch (err) {
    res.json({ worker: { running: false }, _error: err.message });
  }
});

router.post('/outbound/run-batch', async (req, res) => {
  try {
    const outbound = require('../workers/outbound');
    const r = await outbound.runBatch();
    res.json({ success: true, ...r });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/outbound/reset-circuit', (req, res) => {
  const outbound = require('../workers/outbound');
  res.json(outbound.resetCircuit());
});

// === TOOL CALLS (Milestone 1 / B8) — observabilidade da autonomia ===
router.get('/tool-calls/stats', (req, res) => {
  const db = getDb();
  try {
    const hoje = db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS erro,
              SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
       FROM agent_tool_calls WHERE DATE(criado_em) = DATE('now')`
    ).get();
    const porAgente = db.prepare(
      `SELECT agente, COUNT(*) AS chamadas
       FROM agent_tool_calls
       WHERE DATE(criado_em) = DATE('now')
       GROUP BY agente ORDER BY chamadas DESC`
    ).all();
    const porTool = db.prepare(
      `SELECT tool_name, COUNT(*) AS chamadas
       FROM agent_tool_calls
       WHERE DATE(criado_em) = DATE('now')
       GROUP BY tool_name ORDER BY chamadas DESC`
    ).all();
    const ultimas = db.prepare(
      `SELECT id, agente, tool_name, status, duracao_ms, criado_em
       FROM agent_tool_calls
       ORDER BY id DESC LIMIT 10`
    ).all();
    res.json({ hoje, por_agente: porAgente, por_tool: porTool, ultimas });
  } catch (err) {
    // Tabela pode nao existir (migration 016 nao aplicada)
    res.json({
      hoje: { total: 0, ok: 0, erro: 0, blocked: 0 },
      por_agente: [],
      por_tool: [],
      ultimas: [],
      migration_pending: true
    });
  }
});

router.get('/errors/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM errors_log WHERE id = ?').get(parseInt(req.params.id));
  if (!row) return res.status(404).json({ error: 'nao encontrado' });
  res.json(row);
});

router.post('/errors/:id/resolve', (req, res) => {
  const db = getDb();
  const r = db.prepare('UPDATE errors_log SET resolvido = 1 WHERE id = ?').run(parseInt(req.params.id));
  res.json({ success: r.changes > 0 });
});

router.delete('/errors/cleanup', (req, res) => {
  const days = Math.max(1, parseInt(req.query.days) || 90);
  const removidos = errorTracker.cleanupOldResolved({ days });
  res.json({ success: true, removidos, days });
});

// === CUSTO CLAUDE (Sprint 3 / T2) ===
function aggregateUsage(where, params = []) {
  const db = getDb();
  const totals = db.prepare(
    `SELECT COALESCE(SUM(custo_usd),0) AS total_usd,
            COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COUNT(*) AS chamadas
     FROM claude_usage WHERE ${where}`
  ).get(...params);
  const porAgente = db.prepare(
    `SELECT agente,
            COALESCE(SUM(custo_usd),0) AS total_usd,
            COUNT(*) AS chamadas
     FROM claude_usage WHERE ${where}
     GROUP BY agente ORDER BY total_usd DESC`
  ).all(...params);
  const porModelo = db.prepare(
    `SELECT modelo,
            COALESCE(SUM(custo_usd),0) AS total_usd,
            COUNT(*) AS chamadas
     FROM claude_usage WHERE ${where}
     GROUP BY modelo ORDER BY total_usd DESC`
  ).all(...params);
  return { totals, por_agente: porAgente, por_modelo: porModelo };
}

router.get('/costs/today', (req, res) => {
  const data = aggregateUsage("DATE(criado_em) = DATE('now')");
  res.json({ period: 'today', ...data });
});

router.get('/costs/month', (req, res) => {
  const data = aggregateUsage("criado_em >= DATE('now','start of month')");
  res.json({ period: 'month', ...data });
});

router.get('/costs/range', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return bad(res, 'parametros from e to sao obrigatorios (YYYY-MM-DD)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return bad(res, 'from/to devem ser YYYY-MM-DD');
  }
  const data = aggregateUsage('DATE(criado_em) BETWEEN ? AND ?', [from, to]);
  res.json({ period: { from, to }, ...data });
});

router.get('/costs/timeseries', (req, res) => {
  const db = getDb();
  const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
  const rows = db.prepare(
    `SELECT DATE(criado_em) AS dia,
            COALESCE(SUM(custo_usd),0) AS total_usd,
            COUNT(*) AS chamadas
     FROM claude_usage
     WHERE criado_em >= DATE('now', ?)
     GROUP BY dia ORDER BY dia ASC`
  ).all(`-${days} days`);
  res.json({ days, serie: rows });
});

// === METRICAS DE ENTREGA ===
router.get('/metricas/entrega', (req, res) => {
  try {
    const db = getDb();
    const agentes = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'iani'];
    const result = agentes.map(a => {
      const total = db.prepare("SELECT COUNT(*) as c FROM conversas WHERE agente = ? AND direcao = 'enviada'").get(a).c;
      let entregues = 0, lidos = 0;
      try {
        entregues = db.prepare("SELECT COUNT(*) as c FROM conversas WHERE agente = ? AND direcao = 'enviada' AND status_entrega = 'entregue'").get(a).c;
        lidos = db.prepare("SELECT COUNT(*) as c FROM conversas WHERE agente = ? AND direcao = 'enviada' AND status_entrega = 'lido'").get(a).c;
      } catch { /* campo pode nao existir */ }
      return {
        agente: a, total, entregues, lidos,
        taxa_entrega: total > 0 ? ((entregues + lidos) / total * 100).toFixed(1) + '%' : '0%',
        taxa_leitura: total > 0 ? (lidos / total * 100).toFixed(1) + '%' : '0%'
      };
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
