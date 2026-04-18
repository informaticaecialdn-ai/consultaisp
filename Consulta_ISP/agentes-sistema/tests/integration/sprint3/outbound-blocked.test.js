// Sprint 3 / T3: sendOutbound bloqueado para telefones com opt-out.
// Mocka zapi para nao chamar rede em caso de nao-bloqueio
vi.mock('../../../src/services/zapi', () => ({
  sendText: vi.fn().mockResolvedValue({ ok: true }),
  setWebhook: vi.fn(),
  formatPhone: (p) => String(p).replace(/\D/g, ''),
}));
// Mocka claude para nao chamar Anthropic
vi.mock('../../../src/services/claude', () => ({
  sendToAgent: vi.fn().mockResolvedValue({ resposta: 'mock', agente: 'carlos' }),
  client: { messages: { create: vi.fn() } },
}));

const { freshDb } = require('../../helpers/db');
const { canUseSqlite } = require('../../helpers/db');

beforeAll(() => {
  if (!canUseSqlite) return; freshDb(); });

describe.skipIf(!canUseSqlite)('orchestrator.sendOutbound', () => {
  it('retorna {blocked:true} para telefone com opt-out', async () => {
    const consent = require('../../../src/services/consent');
    const orchestrator = require('../../../src/services/orchestrator');

    const phone = '5511988880099';
    consent.markOptOut(phone, 'teste', 'unit');
    expect(consent.canSendTo(phone).allowed).toBe(false);

    const result = await orchestrator.sendOutbound(phone, 'carlos', 'mensagem teste');
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('optout');
  });
});
