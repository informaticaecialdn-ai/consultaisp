// Sprint 5 / T3 - Testes: retry exponencial, falha permanente, auto-pause.
// Rodar: cd agentes-sistema && node tests/integration/broadcast-retry.test.js

const assert = require('assert');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
process.env.BROADCAST_RETRY_DELAYS_SEC = '30,120,600';
process.env.BROADCAST_FAILURE_THRESHOLD_PCT = '20';

function skip(reason) {
  console.log(`\n[SKIP] ${reason}`);
  console.log('\n=== DONE (skipped) ===');
  process.exit(0);
}

let initialize, getDb, broadcast, campanhas, audiencias, templates;
try {
  ({ initialize, getDb } = require('../../src/models/database'));
  broadcast = require('../../src/workers/broadcast');
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
const PREFIX = `__retry_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

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

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

try {
  console.log('\n=== SETUP ===');
  const lA = insertLead(`${PREFIX}_001`, 'A');
  const lB = insertLead(`${PREFIX}_002`, 'B');
  const lC = insertLead(`${PREFIX}_003`, 'C');

  const aud = audiencias.create({ nome: `${PREFIX}_aud`, tipo: 'estatica' });
  audienciaId = aud.id;
  audiencias.addLeads(audienciaId, [lA, lB, lC]);

  const tpl = templates.create({ nome: `${PREFIX}_tpl`, conteudo: 'Oi {{primeiro_nome}}', agente: 'carlos' });
  templateId = tpl.id;

  console.log('\n=== 1. RETRY TRANSIENT ===');
  const camp = campanhas.create({
    nome: `${PREFIX}_camp`,
    audiencia_id: audienciaId,
    template_id: templateId,
    agente_remetente: 'carlos',
    rate_limit_per_min: 10
  });
  createdCampanhaIds.push(camp.id);
  campanhas.expand(camp.id);
  campanhas.start(camp.id);

  const envio = db.prepare('SELECT * FROM campanha_envios WHERE campanha_id = ? LIMIT 1').get(camp.id);
  assert(envio, 'deveria existir envio');

  // Erro transiente (sem statusCode 4xx): deve agendar retry
  const transientErr = new Error('timeout upstream');
  transientErr.statusCode = 500;
  broadcast.handleEnvioError(envio, transientErr, silentLog);

  const after1 = db.prepare('SELECT * FROM campanha_envios WHERE id = ?').get(envio.id);
  assert.strictEqual(after1.status, 'pendente', 'deveria voltar para pendente para retry');
  assert.strictEqual(after1.tentativas, 1, 'tentativas deveria incrementar');
  assert(after1.proximo_retry, 'proximo_retry deveria ser preenchido');
  assert(/timeout/i.test(after1.erro), 'erro deveria ser persistido');
  console.log('[OK] erro transiente agenda retry (tentativa 1)');

  // Segundo retry
  broadcast.handleEnvioError(after1, transientErr, silentLog);
  const after2 = db.prepare('SELECT * FROM campanha_envios WHERE id = ?').get(envio.id);
  assert.strictEqual(after2.tentativas, 2, 'tentativas deveria ser 2');
  console.log('[OK] retry 2 agendado');

  // Terceiro retry (ultimo permitido: 3 delays na lista)
  broadcast.handleEnvioError(after2, transientErr, silentLog);
  const after3 = db.prepare('SELECT * FROM campanha_envios WHERE id = ?').get(envio.id);
  assert.strictEqual(after3.tentativas, 3, 'tentativas deveria ser 3');
  assert.strictEqual(after3.status, 'pendente', 'ainda pendente apos tentativa 3');
  console.log('[OK] retry 3 agendado');

  // Quarto erro: nao ha mais retry (tentativas=3 >= retryDelays.length=3)
  broadcast.handleEnvioError(after3, transientErr, silentLog);
  const after4 = db.prepare('SELECT * FROM campanha_envios WHERE id = ?').get(envio.id);
  assert.strictEqual(after4.status, 'falhou', 'deveria ir para falhou quando esgota retries');
  const campAfterFail = db.prepare('SELECT falhas_count FROM campanhas WHERE id = ?').get(camp.id);
  assert.strictEqual(campAfterFail.falhas_count, 1, 'falhas_count deveria incrementar');
  console.log('[OK] apos esgotar retries -> falhou definitivo');

  console.log('\n=== 2. FALHA PERMANENTE (sem retry) ===');
  const envioPerm = db.prepare(
    'SELECT * FROM campanha_envios WHERE campanha_id = ? AND status = \'pendente\' LIMIT 1'
  ).get(camp.id);
  assert(envioPerm, 'deveria ter outro envio pendente');

  const permErr = new Error('invalid_phone number bad');
  permErr.statusCode = 400;
  broadcast.handleEnvioError(envioPerm, permErr, silentLog);

  const afterPerm = db.prepare('SELECT * FROM campanha_envios WHERE id = ?').get(envioPerm.id);
  assert.strictEqual(afterPerm.status, 'falhou', 'erro permanente vai direto pra falhou');
  assert.strictEqual(afterPerm.tentativas, 0, 'erro permanente nao incrementa tentativas');
  console.log('[OK] erro 400 -> falhou sem retry');

  console.log('\n=== 3. AUTO-PAUSE POR TAXA DE FALHA ===');
  // Agora: 2 falhas, 0 enviados. Precisamos totalProcessado>=10 para trigger.
  // Usamos incrementCounter direto para atingir 8 enviados + 2 falhas = 10 total, 20% falha: NAO trigger (>= nao maior)
  // Precisamos de >20% -> 8 enviados + 3 falhas = 11 total, 3/11 = 27%
  campanhas.incrementCounter(camp.id, 'enviados_count', 8);
  // Adiciona 1 falha mais (total 3 falhas, 8 enviados = 11 total, 27% > 20%)
  const envioFail3 = db.prepare(
    'SELECT * FROM campanha_envios WHERE campanha_id = ? AND status = \'pendente\' LIMIT 1'
  ).get(camp.id);
  if (envioFail3) {
    broadcast.handleEnvioError(envioFail3, permErr, silentLog);
  } else {
    // Se nao ha mais pendente, simula direto
    campanhas.incrementCounter(camp.id, 'falhas_count', 1);
    broadcast.checkAutoPause(camp.id);
  }

  const finalCamp = db.prepare('SELECT * FROM campanhas WHERE id = ?').get(camp.id);
  assert.strictEqual(finalCamp.status, 'pausada', `deveria auto-pausar (atual=${finalCamp.status})`);
  console.log(`[OK] auto-pause: ${finalCamp.falhas_count} falhas / ${finalCamp.enviados_count + finalCamp.falhas_count} total`);

  // Quando totalProcessado < 10, auto-pause nao trigger
  console.log('\n=== 4. SEM AUTO-PAUSE QUANDO BASE PEQUENA ===');
  const campSmall = campanhas.create({
    nome: `${PREFIX}_small`,
    audiencia_id: audienciaId,
    template_id: templateId,
    agente_remetente: 'carlos'
  });
  createdCampanhaIds.push(campSmall.id);
  campanhas.expand(campSmall.id);
  campanhas.start(campSmall.id);

  // 2 falhas em 3 envios (66%) mas base < 10 -> nao pausa
  campanhas.incrementCounter(campSmall.id, 'falhas_count', 2);
  campanhas.incrementCounter(campSmall.id, 'enviados_count', 1);
  broadcast.checkAutoPause(campSmall.id);

  const campSmallFinal = db.prepare('SELECT status FROM campanhas WHERE id = ?').get(campSmall.id);
  assert.strictEqual(campSmallFinal.status, 'enviando', 'nao pausa com base < 10 mesmo com 66% de falha');
  console.log('[OK] auto-pause protege contra bases pequenas (threshold de 10 amostras)');

  console.log('\n=== DONE: retry + falha permanente + auto-pause OK ===');
} catch (err) {
  console.error('\n[FAIL]', err && err.stack ? err.stack : err);
  cleanup();
  process.exit(1);
}
