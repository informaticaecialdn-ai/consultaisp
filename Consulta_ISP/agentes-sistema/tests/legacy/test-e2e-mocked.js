/**
 * Testes E2E com mocks — simula fluxo completo sem APIs externas.
 * Rodar: cd agentes-sistema && node tests/test-e2e-mocked.js
 * NOTA: Requer Node 20 (Docker) por causa do better-sqlite3.
 */

const assert = require('assert');
process.env.ANTHROPIC_API_KEY = 'sk-test-mock';

// Mock Z-API
const zapi = require('../src/services/zapi');
const zapiSent = [];
zapi.sendText = async (phone, msg) => { zapiSent.push({ phone, msg }); return { success: true }; };

// Mock Instagram
const instagram = require('../src/services/instagram');
instagram.sendDM = async (id, msg) => { console.log(`[MOCK IG] DM to ${id}`); return { success: true }; };
instagram.isConfigured = () => true;

// Mock Email
const emailSender = require('../src/services/email-sender');
emailSender.sendEmail = async (to, s, b) => { console.log(`[MOCK EMAIL] to ${to}`); return { success: true }; };
emailSender.isConfigured = () => true;

// Mock Claude
const claude = require('../src/services/claude');
claude.analyzeAndDecide = async (agentKey, message, leadData) => ({
  resposta_whatsapp: `Oi! Sou o ${agentKey}. Recebi: ${message.substring(0, 50)}`,
  score_update: { perfil: 5, comportamento: 10 },
  acao: 'responder',
  notas_internas: 'Teste automatico',
  dados_extraidos: { nome: 'Lead Teste', provedor: 'ISP Teste', cidade: 'SP' }
});
claude.sendToAgent = async (agentKey, msg) => ({ resposta: `[${agentKey}] ${msg.substring(0, 50)}`, tokensUsados: 100 });

// Mock Training
const training = require('../src/services/training');
training.evaluateResponse = async () => ({ nota: 4, sentimento_lead: 'positivo' });
training.analyzeConversation = async () => [];

const { initialize, getDb } = require('../src/models/database');
initialize();

const orchestrator = require('../src/services/orchestrator');
const abTesting = require('../src/services/ab-testing');
const followupSvc = require('../src/services/followup');

async function runTests() {
  console.log('\n=== TESTES E2E COMPLETOS (MOCKED) ===\n');

  // 1. Novo lead WhatsApp
  console.log('--- 1. Novo Lead WhatsApp ---');
  const r1 = await orchestrator.processIncoming('5511999990001', 'Oi, quero saber sobre o Consulta ISP');
  assert(r1.lead_id, 'Lead nao criado');
  console.log(`[OK] Lead ${r1.lead_id}, agente=${r1.agente}`);

  // 2. Dados extraidos e score
  const db = getDb();
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(r1.lead_id);
  assert(lead.nome === 'Lead Teste', 'Dados nao extraidos');
  assert(lead.score_total === 15, `Score: ${lead.score_total}`);
  console.log(`[OK] Score=${lead.score_total}, class=${lead.classificacao}`);

  // 3. Conversas registradas
  const convs = db.prepare('SELECT COUNT(*) as c FROM conversas WHERE lead_id = ?').get(r1.lead_id).c;
  assert(convs >= 2, `Conversas: ${convs}`);
  console.log(`[OK] ${convs} conversas`);

  // 4. Follow-up agendado
  console.log('\n--- 2. Follow-up ---');
  const fups = db.prepare("SELECT * FROM followups WHERE lead_id = ? AND status = 'pendente'").all(r1.lead_id);
  assert(fups.length > 0, 'Follow-up nao agendado');
  console.log(`[OK] Follow-up agendado: tentativa ${fups[0].tentativa}, proximo ${fups[0].proximo_envio}`);

  // 5. Follow-up cancelado quando lead responde
  await orchestrator.processIncoming('5511999990001', 'Sim tenho interesse');
  const fupsAfter = db.prepare("SELECT * FROM followups WHERE lead_id = ? AND status = 'pendente'").all(r1.lead_id);
  // Pode ter novo followup agendado, mas o anterior foi cancelado
  const cancelados = db.prepare("SELECT COUNT(*) as c FROM followups WHERE lead_id = ? AND status = 'cancelado'").get(r1.lead_id).c;
  assert(cancelados > 0, 'Follow-up nao cancelado');
  console.log(`[OK] ${cancelados} followups cancelados, ${fupsAfter.length} novos pendentes`);

  // 6. A/B Testing
  console.log('\n--- 3. A/B Testing ---');
  const testId = abTesting.createTest('carlos', 'prospeccao', 'Variante A: Oi, tudo bem?', 'Variante B: Sabia que voce perde com inadimplencia?', 5);
  assert(testId, 'A/B test nao criado');
  console.log(`[OK] A/B test criado: id=${testId}`);

  const variant = abTesting.getVariant('carlos', 'prospeccao');
  assert(variant, 'Variante nao retornada');
  assert(variant.variante === 'a' || variant.variante === 'b', 'Variante invalida');
  console.log(`[OK] Variante: ${variant.variante} → "${variant.mensagem.substring(0, 40)}..."`);

  abTesting.recordSend(testId, 'a');
  abTesting.recordSend(testId, 'b');
  abTesting.recordResponse(testId, 'a');
  const detail = abTesting.getDetail(testId);
  assert(detail.envios_a === 1, 'Envios A errado');
  assert(detail.respostas_a === 1, 'Respostas A errado');
  console.log(`[OK] Tracking: A=${detail.envios_a}/${detail.respostas_a}, B=${detail.envios_b}/${detail.respostas_b}`);

  // Simular envios suficientes pra concluir
  for (let i = 0; i < 5; i++) { abTesting.recordSend(testId, 'a'); abTesting.recordSend(testId, 'b'); }
  abTesting.recordResponse(testId, 'a');
  abTesting.recordResponse(testId, 'a');
  const vencedor = abTesting.conclude(testId);
  assert(vencedor, 'Vencedor nao definido');
  console.log(`[OK] Vencedor: ${vencedor}`);

  // 7. Multi-canal: lead Instagram
  console.log('\n--- 4. Multi-canal ---');
  const r2 = await orchestrator.processIncoming('ig_12345', 'Oi pelo Instagram', { type: 'texto', canal: 'instagram' });
  assert(r2.lead_id, 'Lead IG nao criado');
  const leadIG = db.prepare('SELECT * FROM leads WHERE telefone = ?').get('ig_12345');
  console.log(`[OK] Lead Instagram: id=${r2.lead_id}, canal=${leadIG?.canal_preferido || 'whatsapp'}`);

  // 8. Stats com novos campos
  console.log('\n--- 5. Stats ---');
  const stats = orchestrator.getStats();
  assert(stats.total_leads >= 2, 'Stats faltando leads');
  console.log(`[OK] Stats: ${stats.total_leads} leads, ${stats.mensagens_hoje} msgs`);

  // 9. Z-API mock tracking
  console.log('\n--- 6. Z-API Mock ---');
  console.log(`[OK] Z-API: ${zapiSent.length} mensagens (mock)`);

  console.log('\n=== TODOS OS TESTES E2E PASSARAM ===');
}

runTests().catch(err => {
  console.error('\n[FAIL]', err.message);
  console.error(err.stack);
  process.exit(1);
});
