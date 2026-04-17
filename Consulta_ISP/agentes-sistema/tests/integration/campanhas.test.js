// Sprint 5 / T1 - Integration tests for campanhas (Broadcast Engine) service.
// Rodar: cd agentes-sistema && node tests/integration/campanhas.test.js
// NOTA: better-sqlite3 precisa Node 20 (Docker). No Node 24 local, esses testes sao pulados.

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
const PREFIX = `__itest_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

// IDs criados, para limpeza no final
const createdLeadIds = [];
let audienciaId = null;
let templateId = null;
const createdCampanhaIds = [];

function cleanup() {
  try {
    const delEnv = db.prepare('DELETE FROM campanha_envios WHERE campanha_id = ?');
    const delCam = db.prepare('DELETE FROM campanhas WHERE id = ?');
    for (const id of createdCampanhaIds) {
      try { delEnv.run(id); } catch {}
      try { delCam.run(id); } catch {}
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
  } catch (err) {
    console.warn('[CLEANUP WARN]', err.message);
  }
}

process.on('exit', cleanup);

function insertLead({ telefone, nome }) {
  const info = db.prepare(
    `INSERT INTO leads (telefone, nome, classificacao, etapa_funil, agente_atual)
     VALUES (?, ?, 'quente', 'qualificado', 'carlos')`
  ).run(telefone, nome);
  createdLeadIds.push(info.lastInsertRowid);
  return info.lastInsertRowid;
}

try {
  console.log('\n=== 1. SETUP: leads + audiencia + template ===');

  const leadA = insertLead({ telefone: `${PREFIX}_11999990001`, nome: 'Provedor Alpha' });
  const leadB = insertLead({ telefone: `${PREFIX}_11999990002`, nome: 'Provedor Bravo' });
  const leadC = insertLead({ telefone: `${PREFIX}_11999990003`, nome: 'Provedor Charlie' });

  const aud = audiencias.create({
    nome: `${PREFIX}_aud`,
    descricao: 'Audiencia de teste',
    tipo: 'estatica'
  });
  audienciaId = aud.id;
  const added = audiencias.addLeads(audienciaId, [leadA, leadB, leadC]);
  assert.strictEqual(added, 3, 'deveria ter adicionado 3 leads');
  const refreshed = audiencias.getById(audienciaId);
  assert.strictEqual(refreshed.total_leads, 3, 'total_leads deveria ser 3');
  console.log(`[OK] audiencia ${audienciaId} com 3 leads`);

  const tpl = templates.create({
    nome: `${PREFIX}_tpl`,
    conteudo: 'Oi {{primeiro_nome}}, aqui e da Consulta ISP.',
    agente: 'carlos'
  });
  templateId = tpl.id;
  assert(templateId > 0, 'template deveria ter id');
  console.log(`[OK] template ${templateId}`);

  console.log('\n=== 2. CREATE: validacoes + status inicial ===');

  assert.throws(() => campanhas.create({}), /nome obrigatorio/, 'deveria exigir nome');
  assert.throws(
    () => campanhas.create({ nome: 'x', audiencia_id: 9999999, template_id: templateId, agente_remetente: 'carlos' }),
    /audiencia 9999999 nao encontrada/,
    'deveria validar audiencia'
  );
  assert.throws(
    () => campanhas.create({ nome: 'x', audiencia_id: audienciaId, template_id: 9999999, agente_remetente: 'carlos' }),
    /template 9999999 nao encontrado/,
    'deveria validar template'
  );
  console.log('[OK] validacoes de entrada');

  const camp = campanhas.create({
    nome: `${PREFIX}_camp`,
    audiencia_id: audienciaId,
    template_id: templateId,
    agente_remetente: 'carlos',
    rate_limit_per_min: 10
  });
  createdCampanhaIds.push(camp.id);
  assert.strictEqual(camp.status, 'rascunho', 'status inicial deve ser rascunho');
  assert.strictEqual(camp.total_envios, 0, 'total_envios inicial = 0');
  assert.strictEqual(camp.rate_limit_per_min, 10, 'rate_limit preservado');
  console.log(`[OK] campanha ${camp.id} criada em rascunho`);

  const campAgendada = campanhas.create({
    nome: `${PREFIX}_camp_agendada`,
    audiencia_id: audienciaId,
    template_id: templateId,
    agente_remetente: 'carlos',
    agendada_para: new Date(Date.now() + 60000).toISOString()
  });
  createdCampanhaIds.push(campAgendada.id);
  assert.strictEqual(campAgendada.status, 'agendada', 'campanha com agendada_para deve iniciar agendada');
  console.log('[OK] campanha agendada inicia com status=agendada');

  console.log('\n=== 3. UPDATE: so permite em rascunho ===');

  const upd = campanhas.update(camp.id, { nome: `${PREFIX}_camp_renamed`, rate_limit_per_min: 15 });
  assert.strictEqual(upd.nome, `${PREFIX}_camp_renamed`, 'nome atualizado');
  assert.strictEqual(upd.rate_limit_per_min, 15, 'rate_limit atualizado');
  console.log('[OK] update em rascunho funciona');

  console.log('\n=== 4. EXPAND: cria envios + idempotencia ===');

  const exp1 = campanhas.expand(camp.id);
  assert.strictEqual(exp1.inserted, 3, 'deveria inserir 3 envios');
  assert.strictEqual(exp1.skipped, 0, 'nao deveria pular nada');

  const campAfterExpand = campanhas.getById(camp.id);
  assert.strictEqual(campAfterExpand.total_envios, 3, 'total_envios deveria ser 3');

  const envios = campanhas.listEnvios(camp.id, { limit: 100 });
  assert.strictEqual(envios.length, 3, 'deveria ter 3 envios');
  for (const e of envios) {
    assert.strictEqual(e.status, 'pendente', 'todo envio deveria comecar pendente');
    assert(e.mensagem_renderizada.startsWith('Oi '), 'mensagem deveria ser renderizada');
    assert(!e.mensagem_renderizada.includes('{{'), 'mensagem nao deveria ter placeholders');
  }
  console.log('[OK] expand criou 3 envios pendentes com mensagem renderizada');

  // Idempotencia: rodar de novo nao cria duplicatas
  const exp2 = campanhas.expand(camp.id);
  assert.strictEqual(exp2.inserted, 0, 'segundo expand nao deveria inserir nada');
  assert.strictEqual(exp2.skipped, 3, 'segundo expand deveria pular 3 (ja existem)');

  const countAgain = db.prepare(
    'SELECT COUNT(*) AS c FROM campanha_envios WHERE campanha_id = ?'
  ).get(camp.id).c;
  assert.strictEqual(countAgain, 3, 'total envios deveria permanecer 3 apos reexpand');
  console.log('[OK] expand e idempotente (UNIQUE campanha_id+lead_id)');

  console.log('\n=== 5. STATUS TRANSITIONS ===');

  const started = campanhas.start(camp.id);
  assert.strictEqual(started.status, 'enviando', 'start deveria mover para enviando');
  assert(started.iniciada_em, 'iniciada_em deveria ser preenchido');
  console.log('[OK] rascunho -> enviando (start)');

  // update agora deve falhar (nao e mais rascunho)
  assert.throws(
    () => campanhas.update(camp.id, { nome: 'x' }),
    /nao e editavel/,
    'update deveria falhar fora de rascunho'
  );
  console.log('[OK] update bloqueado fora de rascunho');

  const paused = campanhas.pause(camp.id);
  assert.strictEqual(paused.status, 'pausada', 'pause deveria mover para pausada');
  console.log('[OK] enviando -> pausada (pause)');

  const resumed = campanhas.resume(camp.id);
  assert.strictEqual(resumed.status, 'enviando', 'resume deveria voltar para enviando');
  console.log('[OK] pausada -> enviando (resume)');

  // Transicao invalida: nao pode cancelar de concluida (nao ha concluida ainda, tenta outro caminho)
  assert.throws(
    () => campanhas.resume(camp.id), // ja esta enviando, nao pausada
    /transicao invalida/,
    'resume de enviando deveria falhar'
  );
  console.log('[OK] transicoes invalidas rejeitadas');

  console.log('\n=== 6. STATS + TIMELINE ===');

  // Simular progresso: marcar 1 envio como enviado e 1 como falhou
  const enviosIds = envios.map(e => e.id).sort((a, b) => a - b);
  db.prepare(
    "UPDATE campanha_envios SET status = 'enviado', enviado_em = datetime('now') WHERE id = ?"
  ).run(enviosIds[0]);
  db.prepare(
    "UPDATE campanha_envios SET status = 'falhou', erro = 'teste' WHERE id = ?"
  ).run(enviosIds[1]);
  campanhas.incrementCounter(camp.id, 'enviados_count', 1);
  campanhas.incrementCounter(camp.id, 'falhas_count', 1);

  const stats = campanhas.getStats(camp.id);
  assert.strictEqual(stats.total_envios, 3, 'stats.total_envios');
  assert.strictEqual(stats.enviados, 1, 'stats.enviados');
  assert.strictEqual(stats.falhas, 1, 'stats.falhas');
  assert.strictEqual(stats.pendentes, 1, 'stats.pendentes = 1 (1 restante)');
  assert.strictEqual(stats.restantes, 1, 'stats.restantes = 1');
  const esperadoPct = Math.round(((1 + 1 + 0) / 3) * 100);
  assert.strictEqual(stats.progresso_pct, esperadoPct, 'progresso_pct calculado');
  console.log(`[OK] stats: ${stats.enviados} enviados / ${stats.falhas} falhas / ${stats.pendentes} pendentes (${stats.progresso_pct}%)`);

  assert.throws(
    () => campanhas.incrementCounter(camp.id, 'coluna_invalida', 1),
    /nao e um contador valido/,
    'incrementCounter deve rejeitar colunas nao-whitelisted'
  );
  console.log('[OK] incrementCounter rejeita colunas fora do whitelist');

  const timeline = campanhas.getTimeline(camp.id, { lastMinutes: 60 });
  assert(Array.isArray(timeline), 'timeline deveria ser array');
  console.log(`[OK] timeline retornou ${timeline.length} bucket(s)`);

  console.log('\n=== 7. CHECK CONCLUSION ===');

  // Com 1 pendente ainda, checkConclusion nao deveria concluir
  campanhas.checkConclusion(camp.id);
  let c = campanhas.getById(camp.id);
  assert.strictEqual(c.status, 'enviando', 'nao deveria concluir com pendentes');

  // Fechar o ultimo envio
  db.prepare(
    "UPDATE campanha_envios SET status = 'enviado', enviado_em = datetime('now') WHERE id = ?"
  ).run(enviosIds[2]);
  campanhas.incrementCounter(camp.id, 'enviados_count', 1);

  campanhas.checkConclusion(camp.id);
  c = campanhas.getById(camp.id);
  assert.strictEqual(c.status, 'concluida', 'deveria concluir quando nao ha mais pendentes');
  assert(c.concluida_em, 'concluida_em deveria ser preenchido');
  console.log('[OK] checkConclusion move para concluida quando zera pendentes');

  console.log('\n=== 8. CANCEL + DELETE ===');

  // camp esta concluida, nao pode mais cancelar
  assert.throws(
    () => campanhas.cancel(camp.id),
    /transicao invalida/,
    'cancel de concluida deveria falhar'
  );

  // campAgendada esta agendada, pode cancelar
  const canceled = campanhas.cancel(campAgendada.id);
  assert.strictEqual(canceled.status, 'cancelada', 'cancel deveria mover para cancelada');
  assert(canceled.concluida_em, 'concluida_em deveria ser preenchido no cancel');
  console.log('[OK] cancel de agendada funciona');

  // remove so permite em rascunho
  assert.throws(
    () => campanhas.remove(camp.id),
    /so e possivel deletar/,
    'remove fora de rascunho deveria falhar'
  );
  console.log('[OK] delete bloqueado fora de rascunho');

  const rascunho = campanhas.create({
    nome: `${PREFIX}_camp_delete`,
    audiencia_id: audienciaId,
    template_id: templateId,
    agente_remetente: 'carlos'
  });
  createdCampanhaIds.push(rascunho.id);
  const delRes = campanhas.remove(rascunho.id);
  assert.strictEqual(delRes.changes, 1, 'deveria ter deletado 1 linha');
  assert.strictEqual(campanhas.getById(rascunho.id), null, 'campanha nao deveria mais existir');
  console.log('[OK] delete em rascunho funciona');

  console.log('\n=== 9. PAUSE ALL (kill switch) ===');

  const campKill1 = campanhas.create({
    nome: `${PREFIX}_kill1`,
    audiencia_id: audienciaId,
    template_id: templateId,
    agente_remetente: 'carlos'
  });
  createdCampanhaIds.push(campKill1.id);
  campanhas.start(campKill1.id);

  const campKill2 = campanhas.create({
    nome: `${PREFIX}_kill2`,
    audiencia_id: audienciaId,
    template_id: templateId,
    agente_remetente: 'carlos',
    agendada_para: new Date(Date.now() + 60000).toISOString()
  });
  createdCampanhaIds.push(campKill2.id);
  // campKill2 ja e 'agendada' por causa de agendada_para

  const affected = campanhas.pauseAll();
  assert(affected >= 2, `pauseAll deveria afetar >=2 campanhas (afetou ${affected})`);
  assert.strictEqual(campanhas.getById(campKill1.id).status, 'pausada', 'kill1 deveria estar pausada');
  assert.strictEqual(campanhas.getById(campKill2.id).status, 'pausada', 'kill2 (agendada) deveria estar pausada');
  console.log(`[OK] pauseAll pausou ${affected} campanhas em voo`);

  console.log('\n=== 10. MASK PHONE (LGPD helper) ===');

  assert.strictEqual(campanhas.maskPhone('11999991234'), '1199***34', 'mascara formato padrao');
  assert.strictEqual(campanhas.maskPhone(''), '', 'mascara vazio -> vazio');
  assert.strictEqual(campanhas.maskPhone('123'), '***', 'mascara <=4 digitos -> ***');
  console.log('[OK] maskPhone protege identidade do lead');

  console.log('\n=== DONE: todos os testes do servico campanhas passaram ===');
} catch (err) {
  console.error('\n[FAIL]', err && err.stack ? err.stack : err);
  cleanup();
  process.exit(1);
}
