// Sprint 5 / T4 - Teste: lifecycle end-to-end (create -> expand -> start -> pause -> resume -> cancel + pauseAll).
// Rodar: cd agentes-sistema && node tests/integration/campanhas-lifecycle.test.js

const assert = require('assert');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';

function skip(reason) {
  console.log(`\n[SKIP] ${reason}`);
  console.log('\n=== DONE (skipped) ===');
  process.exit(0);
}

let initialize, getDb, campanhas, audiencias, templates;
try {
  ({ initialize, getDb } = require('../../src/models/database'));
  campanhas = require('../../src/services/campanhas');
  audiencias = require('../../src/services/audiencias');
  templates = require('../../src/services/templates');
} catch (err) {
  if (/bindings|better-sqlite3/i.test(err.message)) {
    skip('SQLite nao disponivel neste Node (precisa Node 20 / Docker)');
  }
  throw err;
}

try {
  initialize();
} catch (err) {
  if (/bindings|better-sqlite3/i.test(err.message)) {
    skip('SQLite nao disponivel neste Node (precisa Node 20 / Docker)');
  }
  throw err;
}

const db = getDb();
const PREFIX = `__lifecycle_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

const createdLeadIds = [];
let audienciaId = null;
let templateId = null;
const createdCampanhaIds = [];

function cleanup() {
  try {
    for (const id of createdCampanhaIds) {
      try { db.prepare('DELETE FROM campanha_envios WHERE campanha_id = ?').run(id); } catch {}
      try { db.prepare('DELETE FROM campanhas WHERE id = ?').run(id); } catch {}
    }
    if (audienciaId) {
      try { db.prepare('DELETE FROM audiencia_leads WHERE audiencia_id = ?').run(audienciaId); } catch {}
      try { db.prepare('DELETE FROM audiencias WHERE id = ?').run(audienciaId); } catch {}
    }
    if (templateId) {
      try { db.prepare('DELETE FROM templates WHERE id = ?').run(templateId); } catch {}
    }
    for (const id of createdLeadIds) {
      try { db.prepare('DELETE FROM leads WHERE id = ?').run(id); } catch {}
    }
  } catch {}
}
process.on('exit', cleanup);

function insertLead(tel, nome) {
  const info = db.prepare(
    `INSERT INTO leads (telefone, nome, classificacao, etapa_funil, agente_atual)
     VALUES (?, ?, 'quente', 'qualificado', 'carlos')`
  ).run(tel, nome);
  createdLeadIds.push(info.lastInsertRowid);
  return info.lastInsertRowid;
}

try {
  console.log('\n=== SETUP ===');
  const lA = insertLead(`${PREFIX}_001`, 'A');
  const lB = insertLead(`${PREFIX}_002`, 'B');

  const aud = audiencias.create({ nome: `${PREFIX}_aud`, tipo: 'estatica' });
  audienciaId = aud.id;
  audiencias.addLeads(audienciaId, [lA, lB]);

  const tpl = templates.create({ nome: `${PREFIX}_tpl`, conteudo: 'Oi {{primeiro_nome}}', agente: 'carlos' });
  templateId = tpl.id;

  console.log('\n=== 1. CREATE (rascunho) ===');
  const camp = campanhas.create({
    nome: `${PREFIX}_lifecycle`,
    audiencia_id: audienciaId,
    template_id: templateId,
    agente_remetente: 'carlos',
    rate_limit_per_min: 15
  });
  createdCampanhaIds.push(camp.id);
  assert.strictEqual(camp.status, 'rascunho');
  assert.strictEqual(camp.total_envios, 0);
  console.log(`[OK] campanha ${camp.id} em rascunho`);

  console.log('\n=== 2. EXPAND (idempotente) ===');
  const exp1 = campanhas.expand(camp.id);
  assert.strictEqual(exp1.inserted, 2);
  const exp2 = campanhas.expand(camp.id);
  assert.strictEqual(exp2.inserted, 0, 'segundo expand nao deve inserir nada');
  const c1 = campanhas.getById(camp.id);
  assert.strictEqual(c1.total_envios, 2);
  console.log('[OK] expand idempotente');

  console.log('\n=== 3. START -> ENVIANDO ===');
  const started = campanhas.start(camp.id);
  assert.strictEqual(started.status, 'enviando');
  assert(started.iniciada_em, 'iniciada_em preenchido');
  console.log('[OK] start move para enviando');

  console.log('\n=== 4. PAUSE -> RESUME ===');
  const paused = campanhas.pause(camp.id);
  assert.strictEqual(paused.status, 'pausada');
  const resumed = campanhas.resume(camp.id);
  assert.strictEqual(resumed.status, 'enviando');
  console.log('[OK] pause -> pausada -> resume -> enviando');

  console.log('\n=== 5. CANCEL ===');
  const canceled = campanhas.cancel(camp.id);
  assert.strictEqual(canceled.status, 'cancelada');
  assert(canceled.concluida_em, 'concluida_em preenchido no cancel');
  console.log('[OK] cancel -> cancelada');

  console.log('\n=== 6. TRANSICOES INVALIDAS REJEITADAS ===');
  assert.throws(() => campanhas.resume(camp.id), /transicao invalida/);
  assert.throws(() => campanhas.start(camp.id), /transicao invalida/);
  console.log('[OK] transicoes invalidas bloqueadas');

  console.log('\n=== 7. PAUSE-ALL (kill switch) ===');
  const camp2 = campanhas.create({
    nome: `${PREFIX}_kill1`,
    audiencia_id: audienciaId,
    template_id: templateId,
    agente_remetente: 'carlos'
  });
  createdCampanhaIds.push(camp2.id);
  campanhas.expand(camp2.id);
  campanhas.start(camp2.id);

  const camp3 = campanhas.create({
    nome: `${PREFIX}_kill2`,
    audiencia_id: audienciaId,
    template_id: templateId,
    agente_remetente: 'carlos',
    agendada_para: new Date(Date.now() + 60000).toISOString()
  });
  createdCampanhaIds.push(camp3.id);

  const affected = campanhas.pauseAll();
  assert(affected >= 2, `pauseAll deveria afetar >=2 campanhas (afetou ${affected})`);
  assert.strictEqual(campanhas.getById(camp2.id).status, 'pausada');
  assert.strictEqual(campanhas.getById(camp3.id).status, 'pausada');
  console.log(`[OK] pauseAll pausou ${affected} campanhas (enviando + agendada)`);

  console.log('\n=== 8. LIST + STATS + TIMELINE ===');
  const lista = campanhas.list({ limit: 100 });
  const nossas = lista.filter(c => createdCampanhaIds.includes(c.id));
  assert(nossas.length >= 3, `list deveria incluir nossas 3 campanhas (achou ${nossas.length})`);

  const stats = campanhas.getStats(camp2.id);
  assert(stats, 'getStats nao deveria retornar null');
  assert.strictEqual(stats.status, 'pausada');

  const timeline = campanhas.getTimeline(camp2.id, { lastMinutes: 60 });
  assert(Array.isArray(timeline), 'timeline deveria ser array');
  console.log('[OK] list + stats + timeline funcionam');

  console.log('\n=== 9. LIST ENVIOS COM PAGINACAO ===');
  const envios = campanhas.listEnvios(camp2.id, { limit: 10, offset: 0 });
  assert.strictEqual(envios.length, 2, 'deveria listar 2 envios expandidos');
  const enviosPendentes = campanhas.listEnvios(camp2.id, { status: 'pendente' });
  assert.strictEqual(enviosPendentes.length, 2, 'todos 2 envios deveriam estar pendentes');
  console.log('[OK] listEnvios filtra por status');

  console.log('\n=== DONE: lifecycle completo (CRUD + kill switch) ===');
} catch (err) {
  console.error('\n[FAIL]', err && err.stack ? err.stack : err);
  cleanup();
  process.exit(1);
}
