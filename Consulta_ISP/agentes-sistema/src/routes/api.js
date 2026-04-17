const express = require('express');
const router = express.Router();
const orchestrator = require('../services/orchestrator');
const claude = require('../services/claude');
const zapi = require('../services/zapi');
const { getDb } = require('../models/database');

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

router.post('/leads', (req, res) => {
  const db = getDb();
  const { telefone, nome, provedor, cidade, estado, regiao, porte, erp, origem } = req.body;
  if (!telefone) return res.status(400).json({ error: 'Telefone obrigatorio' });
  
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
router.post('/send', async (req, res) => {
  try {
    const { phone, message, agente } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'phone e message sao obrigatorios' });
    
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
router.post('/prospectar', async (req, res) => {
  try {
    const { telefones, regiao, mensagem_base } = req.body;
    if (!telefones?.length) return res.status(400).json({ error: 'Lista vazia' });
    
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

// === CAMPANHAS ===
router.get('/campanhas', (req, res) => {
  const db = getDb();
  res.json({ campanhas: db.prepare('SELECT * FROM campanhas ORDER BY criado_em DESC').all() });
});

router.post('/campanhas', (req, res) => {
  const db = getDb();
  const { nome, tipo, agente, regiao, mensagem_template } = req.body;
  const result = db.prepare('INSERT INTO campanhas (nome, tipo, agente, regiao, mensagem_template) VALUES (?,?,?,?,?)').run(nome, tipo, agente || 'carlos', regiao, mensagem_template);
  res.json({ success: true, id: result.lastInsertRowid });
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
