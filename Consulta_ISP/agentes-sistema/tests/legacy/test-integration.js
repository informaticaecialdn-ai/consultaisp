// Rodar: cd agentes-sistema && node tests/test-integration.js
// NOTA: better-sqlite3 precisa Node 20 (Docker). No Node 24 local, os testes de DB falham.

const assert = require('assert');
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';

console.log('\n=== 1. SKILLS KNOWLEDGE ===');
const sk = require('../src/services/skills-knowledge');
const agents = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'diana'];
for (const a of agents) {
  const k = sk.getKnowledgeForAgent(a);
  assert(k && k.length > 100, `${a}: sem knowledge`);
  console.log(`[OK] ${a}: ${k.length} chars`);
}

// Testar multi-secao
const marcosCtx = sk.getCompactContext('marcos', 'ad-campaign');
assert(marcosCtx.length > 0, 'Marcos ad-campaign vazio');
console.log(`[OK] marcos/ad-campaign: ${marcosCtx.length} chars`);

// Testar MAX_CONTEXT_CHARS
for (const a of agents) {
  const ctx = sk.getCompactContext(a, 'general');
  assert(ctx.length <= 9000, `${a}: contexto muito grande (${ctx.length})`);
}
console.log('[OK] Todos dentro do limite de chars');

console.log('\n=== 2. INFERENCIA TASK TYPE ===');
const claude = require('../src/services/claude');
if (typeof claude._inferTaskType === 'function') {
  assert(claude._inferTaskType('quanto custa o plano?') === 'pricing', 'pricing nao detectado');
  assert(claude._inferTaskType('quero uma demo') === 'sales', 'sales nao detectado');
  assert(claude._inferTaskType('vamos fechar o contrato') === 'closing', 'closing nao detectado');
  assert(claude._inferTaskType('oi tudo bem') === 'general', 'general nao detectado');
  console.log('[OK] _inferTaskType funciona');
} else {
  console.log('[FAIL] _inferTaskType NAO existe');
}

console.log('\n=== 3. DATABASE + TRAINING (requer SQLite) ===');
try {
  const { initialize, getDb } = require('../src/models/database');
  initialize();
  const db = getDb();

  // Tabela avaliacoes
  try {
    db.prepare('SELECT COUNT(*) as c FROM avaliacoes').get();
    console.log('[OK] Tabela avaliacoes existe');
  } catch (e) {
    console.log('[FAIL] Tabela avaliacoes NAO existe');
  }

  // Tabela treinamento_agentes
  try {
    db.prepare('SELECT COUNT(*) as c FROM treinamento_agentes').get();
    console.log('[OK] Tabela treinamento_agentes existe');
  } catch (e) {
    console.log('[FAIL] Tabela treinamento_agentes NAO existe');
  }

  // Training service
  const training = require('../src/services/training');

  const id = training.learn('carlos', 'abordagem_eficaz', 'ISPs de MG respondem melhor com ROI');
  assert(id, 'learn falhou');
  console.log(`[OK] learn: id=${id}`);

  const id2 = training.learn('carlos', 'abordagem_eficaz', 'ISPs de MG respondem melhor com ROI');
  assert(id2 === id, 'deduplicacao falhou');
  console.log('[OK] deduplicacao');

  training.recordSuccess(id);
  console.log('[OK] recordSuccess');

  const rules = training.getRulesForAgent('carlos');
  assert(rules.length > 0, 'sem regras');
  console.log(`[OK] getRulesForAgent: ${rules.length} regras`);

  const ctx = training.getTrainingContext('carlos');
  assert(ctx.includes('ISPs de MG'), 'contexto nao contem regra');
  console.log(`[OK] getTrainingContext: ${ctx.length} chars`);

  // evaluateResponse existe
  assert(typeof training.evaluateResponse === 'function', 'evaluateResponse nao existe');
  console.log('[OK] evaluateResponse existe');

  // _analyzePatterns existe
  assert(typeof training._analyzePatterns === 'function', '_analyzePatterns nao existe');
  console.log('[OK] _analyzePatterns existe');

  // _inferRuleTaskType existe
  assert(typeof training._inferRuleTaskType === 'function', '_inferRuleTaskType nao existe');
  assert(training._inferRuleTaskType('preco muito alto') === 'pricing', 'pricing nao inferido');
  console.log('[OK] _inferRuleTaskType funciona');

  training.disable(id);
  console.log('[OK] disable');

  const stats = training.getStats();
  console.log(`[OK] stats: ${stats.total} regras ativas`);

} catch (e) {
  if (e.message.includes('bindings') || e.message.includes('better-sqlite3')) {
    console.log('[SKIP] SQLite nao disponivel neste Node (precisa Node 20 / Docker)');
  } else {
    console.log('[FAIL]', e.message);
  }
}

console.log('\n=== DONE ===');
