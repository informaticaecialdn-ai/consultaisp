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
  const hoje = new Date().toISOString().split('T')[0];
  
  const total_leads = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
  const msgs_hoje = db.prepare("SELECT COUNT(*) as c FROM conversas WHERE DATE(criado_em) = DATE('now')").get().c;
  const tarefas_pendentes = db.prepare("SELECT COUNT(*) as c FROM tarefas WHERE status = 'pendente'").get().c;
  
  const por_classificacao = db.prepare('SELECT classificacao, COUNT(*) as c FROM leads GROUP BY classificacao').all();
  const por_agente = db.prepare('SELECT agente_atual as agente, COUNT(*) as c FROM leads GROUP BY agente_atual').all();
  const por_etapa = db.prepare('SELECT etapa_funil as etapa, COUNT(*) as c FROM leads GROUP BY etapa_funil').all();
  const por_regiao = db.prepare('SELECT COALESCE(regiao, estado, "Sem regiao") as regiao, COUNT(*) as c FROM leads GROUP BY regiao ORDER BY c DESC LIMIT 10').all();
  
  const valor_pipeline = db.prepare('SELECT COALESCE(SUM(valor_estimado),0) as v FROM leads WHERE etapa_funil NOT IN ("perdido","convertido")').get().v;
  const leads_hoje = db.prepare("SELECT COUNT(*) as c FROM leads WHERE DATE(criado_em) = DATE('now')").get().c;
  const conversoes_mes = db.prepare("SELECT COUNT(*) as c FROM leads WHERE etapa_funil='convertido' AND criado_em >= DATE('now','start of month')").get().c;
  
  // Atividades recentes dos agentes
  const atividades_recentes = db.prepare('SELECT * FROM atividades_agentes ORDER BY criado_em DESC LIMIT 20').all();
  
  // Handoffs recentes
  const handoffs_recentes = db.prepare(`
    SELECT h.*, l.nome, l.provedor, l.telefone 
    FROM handoffs h JOIN leads l ON h.lead_id = l.id 
    ORDER BY h.criado_em DESC LIMIT 10
  `).all();

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

const VALID_AGENTES = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'diana'];

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

// ---- helpers de criacao para testes/smoke ----
// POST /api/audiencias (endpoint minimal para Sprint 5 standalone)
router.post('/audiencias', (req, res) => {
  const { nome, descricao, tipo, filtros, lead_ids } = req.body;
  if (!nome) return bad(res, 'nome obrigatorio');
  try {
    const aud = audienciasService.create({ nome, descricao, tipo, filtros });
    if (Array.isArray(lead_ids) && lead_ids.length > 0) {
      audienciasService.addLeads(aud.id, lead_ids);
    }
    const refreshed = audienciasService.getById(aud.id);
    res.status(201).json({ audiencia: refreshed });
  } catch (err) {
    bad(res, err.message);
  }
});

router.get('/audiencias', (req, res) => {
  res.json({ audiencias: audienciasService.list(req.query) });
});

router.get('/audiencias/:id', (req, res) => {
  const aud = audienciasService.getById(parseInt(req.params.id));
  if (!aud) return bad(res, 'audiencia nao encontrada', 404);
  res.json({ audiencia: aud });
});

// POST /api/templates
router.post('/templates', (req, res) => {
  const { nome, conteudo, agente, descricao, ja_aprovado_meta } = req.body;
  if (!nome || !conteudo) return bad(res, 'nome e conteudo obrigatorios');
  try {
    const tpl = templatesService.create({ nome, conteudo, agente, descricao, ja_aprovado_meta });
    res.status(201).json({ template: tpl });
  } catch (err) {
    bad(res, err.message);
  }
});

router.get('/templates', (req, res) => {
  res.json({ templates: templatesService.list(req.query) });
});

router.get('/templates/:id', (req, res) => {
  const tpl = templatesService.getById(parseInt(req.params.id));
  if (!tpl) return bad(res, 'template nao encontrado', 404);
  res.json({ template: tpl });
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
router.get('/health/deep', (req, res) => {
  const db = getDb();
  const checks = {};

  try {
    db.prepare('SELECT 1').get();
    checks.database = { status: 'ok' };
  } catch (err) {
    checks.database = { status: 'error', error: err.message };
  }

  try {
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
    checks.broadcast_worker = {
      status: stale ? 'stale' : 'ok',
      last_heartbeat: heartbeat?.ts || null,
      heartbeat_age_sec: ageSec,
      campanhas_ativas: ativas,
      envios_pendentes: pendentes,
      kill_switch_active: process.env.BROADCAST_WORKER_ENABLED === 'false'
    };
  } catch (err) {
    checks.broadcast_worker = { status: 'error', error: err.message };
  }

  const overall = Object.values(checks).every(c => c.status === 'ok') ? 'ok' : 'degraded';
  res.status(overall === 'ok' ? 200 : 503).json({
    status: overall,
    timestamp: new Date().toISOString(),
    checks
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
  const agents = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'diana'];
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
    const agentes = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'diana'];
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
