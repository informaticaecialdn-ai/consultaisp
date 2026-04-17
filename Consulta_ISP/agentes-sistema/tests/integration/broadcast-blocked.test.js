// Sprint 5 / T3 - Testes: mid-flight blocks (opt-out + janela 24h expirada).
// Rodar: cd agentes-sistema && node tests/integration/broadcast-blocked.test.js

const assert = require('assert');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';

function skip(reason) {
  console.log(`\n[SKIP] ${reason}`);
  console.log('\n=== DONE (skipped) ===');
  process.exit(0);
}

let initialize, getDb, broadcast, campanhas, audiencias, templates, consent, windowChecker, zapiModule;
try {
  ({ initialize, getDb } = require('../../src/models/database'));
  broadcast = require('../../src/workers/broadcast');
  campanhas = require('../../src/services/campanhas');
  audiencias = require('../../src/services/audiencias');
  templates = require('../../src/services/templates');
  consent = require('../../src/services/consent');
  windowChecker = require('../../src/services/window-checker');
  zapiModule = require('../../src/services/zapi');
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
const PREFIX = `__blocked_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

// Stub zapi.sendText para nao chamar API real
const originalSendText = zapiModule.sendText;
zapiModule.sendText = async () => ({ id: 'stub-msg-id', messageId: 'stub-msg-id' });

// Stub windowChecker (restaurado entre casos)
const originalCanSendFreeForm = windowChecker.canSendFreeForm;

const createdLeadIds = [];
let audienciaId = null;
let templateIdNonHsm = null;
let templateIdHsm = null;
const createdCampanhaIds = [];
const createdOptOutPhones = [];

function cleanup() {
  try {
    zapiModule.sendText = originalSendText;
    windowChecker.canSendFreeForm = originalCanSendFreeForm;
    for (const id of createdCampanhaIds) {
      try { db.prepare('DELETE FROM campanha_envios WHERE campanha_id = ?').run(id); } catch {}
      try { db.prepare('DELETE FROM campanhas WHERE id = ?').run(id); } catch {}
    }
    if (audienciaId) {
      try { db.prepare('DELETE FROM audiencia_leads WHERE audiencia_id = ?').run(audienciaId); } catch {}
      try { db.prepare('DELETE FROM audiencias WHERE id = ?').run(audienciaId); } catch {}
    }
    for (const tid of [templateIdNonHsm, templateIdHsm]) {
      if (tid) { try { db.prepare('DELETE FROM templates WHERE id = ?').run(tid); } catch {} }
    }
    for (const id of createdLeadIds) {
      try { db.prepare('DELETE FROM leads WHERE id = ?').run(id); } catch {}
    }
    for (const tel of createdOptOutPhones) {
      try { db.prepare('DELETE FROM lead_opt_out WHERE telefone = ?').run(tel); } catch {}
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

async function run() {
  console.log('\n=== SETUP ===');
  const telOptOut = `${PREFIX}_99900001`;
  const telNormal = `${PREFIX}_99900002`;
  const telWindow = `${PREFIX}_99900003`;

  const lOptOut = insertLead(telOptOut, 'Lead OptOut');
  const lNormal = insertLead(telNormal, 'Lead Normal');
  const lWindow = insertLead(telWindow, 'Lead Window');

  const aud = audiencias.create({ nome: `${PREFIX}_aud`, tipo: 'estatica' });
  audienciaId = aud.id;
  audiencias.addLeads(audienciaId, [lOptOut, lNormal, lWindow]);

  // Template non-HSM (sujeito a janela 24h)
  const tplNon = templates.create({
    nome: `${PREFIX}_tpl_non_hsm`,
    conteudo: 'Oi {{primeiro_nome}}',
    agente: 'carlos'
  });
  templateIdNonHsm = tplNon.id;
  db.prepare('UPDATE templates SET ja_aprovado_meta = 0 WHERE id = ?').run(templateIdNonHsm);

  // Template HSM (nao checa janela)
  const tplHsm = templates.create({
    nome: `${PREFIX}_tpl_hsm`,
    conteudo: 'Oi {{primeiro_nome}} (HSM)',
    agente: 'carlos'
  });
  templateIdHsm = tplHsm.id;
  db.prepare('UPDATE templates SET ja_aprovado_meta = 1 WHERE id = ?').run(templateIdHsm);

  // Registra opt-out ANTES do envio (mid-flight check deve bloquear)
  consent.markOptOut(telOptOut, 'test-optout', 'whatsapp');
  createdOptOutPhones.push(consent.normalizePhone(telOptOut));

  console.log('\n=== 1. OPT-OUT MID-FLIGHT BLOQUEIA ===');
  const camp1 = campanhas.create({
    nome: `${PREFIX}_camp_optout`,
    audiencia_id: audienciaId,
    template_id: templateIdHsm,
    agente_remetente: 'carlos'
  });
  createdCampanhaIds.push(camp1.id);
  campanhas.expand(camp1.id);
  campanhas.start(camp1.id);

  const envioOptOut = db.prepare(
    'SELECT e.*, c.id AS campanha_id_c FROM campanha_envios e INNER JOIN campanhas c ON c.id = e.campanha_id WHERE e.campanha_id = ? AND e.telefone = ? LIMIT 1'
  ).get(camp1.id, telOptOut);
  assert(envioOptOut, 'envio para lead opt-out deveria existir');

  // processEnvio espera envio enriquecido com .campanha
  const campRow = db.prepare('SELECT * FROM campanhas WHERE id = ?').get(camp1.id);
  await broadcast.processEnvio({ ...envioOptOut, campanha: campRow });

  const afterOptOut = db.prepare('SELECT * FROM campanha_envios WHERE id = ?').get(envioOptOut.id);
  assert.strictEqual(afterOptOut.status, 'bloqueado_optout', `status esperado bloqueado_optout, foi ${afterOptOut.status}`);
  const campCheck1 = db.prepare('SELECT bloqueados_count FROM campanhas WHERE id = ?').get(camp1.id);
  assert(campCheck1.bloqueados_count >= 1, 'bloqueados_count deveria incrementar');
  console.log('[OK] opt-out mid-flight -> status=bloqueado_optout + contador incrementa');

  console.log('\n=== 2. HSM NAO CHECA JANELA 24H ===');
  const envioHsm = db.prepare(
    'SELECT * FROM campanha_envios WHERE campanha_id = ? AND telefone = ? LIMIT 1'
  ).get(camp1.id, telNormal);
  assert(envioHsm, 'envio HSM deveria existir');

  // windowChecker retornaria false normalmente (sem mensagem inbound), mas HSM ignora
  await broadcast.processEnvio({ ...envioHsm, campanha: campRow });

  const afterHsm = db.prepare('SELECT * FROM campanha_envios WHERE id = ?').get(envioHsm.id);
  assert.strictEqual(afterHsm.status, 'enviado', `HSM deveria enviar sem checar janela, status=${afterHsm.status}`);
  console.log('[OK] template HSM (ja_aprovado_meta=1) ignora janela 24h');

  console.log('\n=== 3. NON-HSM FORA DA JANELA BLOQUEIA ===');
  const camp2 = campanhas.create({
    nome: `${PREFIX}_camp_window`,
    audiencia_id: audienciaId,
    template_id: templateIdNonHsm,
    agente_remetente: 'carlos'
  });
  createdCampanhaIds.push(camp2.id);
  campanhas.expand(camp2.id);
  campanhas.start(camp2.id);

  // Forca windowChecker a dizer "expirada" (o default ja retorna false sem inbound)
  windowChecker.canSendFreeForm = async () => ({ allowed: false, reason: 'janela 24h expirada (48h)' });

  const envioWin = db.prepare(
    'SELECT * FROM campanha_envios WHERE campanha_id = ? AND telefone = ? LIMIT 1'
  ).get(camp2.id, telWindow);
  assert(envioWin, 'envio window deveria existir');

  const camp2Row = db.prepare('SELECT * FROM campanhas WHERE id = ?').get(camp2.id);
  await broadcast.processEnvio({ ...envioWin, campanha: camp2Row });

  const afterWin = db.prepare('SELECT * FROM campanha_envios WHERE id = ?').get(envioWin.id);
  assert.strictEqual(afterWin.status, 'bloqueado_window', `status esperado bloqueado_window, foi ${afterWin.status}`);
  const camp2Check = db.prepare('SELECT bloqueados_count FROM campanhas WHERE id = ?').get(camp2.id);
  assert(camp2Check.bloqueados_count >= 1, 'bloqueados_count camp2 deveria incrementar');
  console.log('[OK] template non-HSM com janela expirada -> bloqueado_window');

  console.log('\n=== 4. NON-HSM DENTRO DA JANELA ENVIA ===');
  windowChecker.canSendFreeForm = async () => ({ allowed: true });

  const envioNon = db.prepare(
    'SELECT * FROM campanha_envios WHERE campanha_id = ? AND telefone = ? AND status = \'pendente\' LIMIT 1'
  ).get(camp2.id, telNormal);
  if (envioNon) {
    await broadcast.processEnvio({ ...envioNon, campanha: camp2Row });
    const afterNon = db.prepare('SELECT * FROM campanha_envios WHERE id = ?').get(envioNon.id);
    assert.strictEqual(afterNon.status, 'enviado', `non-HSM dentro da janela deveria enviar, status=${afterNon.status}`);
    assert(afterNon.zapi_message_id, 'zapi_message_id deveria ser preenchido');
    console.log('[OK] non-HSM + janela ativa -> enviado + zapi_message_id');
  } else {
    console.log('[SKIP] envio nao-hsm para lead normal nao encontrado (ja processado)');
  }

  console.log('\n=== DONE: opt-out + window + HSM bypass OK ===');
}

run().catch(err => {
  console.error('\n[FAIL]', err && err.stack ? err.stack : err);
  cleanup();
  process.exit(1);
});
