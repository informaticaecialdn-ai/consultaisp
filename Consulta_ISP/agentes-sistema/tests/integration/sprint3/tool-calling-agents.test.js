// Milestone 1 / B8: testes da arquitetura de tool-calling agents.
// Cobre: tools registry, handlers, loop tool_use em platform-agent-client,
// persistencia em agent_tool_calls.

vi.mock('../../../src/services/zapi', () => ({
  default: undefined,
  sendText: vi.fn().mockResolvedValue({ ok: true, messageId: 'zapi-msg-1' }),
  formatPhone: (p) => String(p).replace(/\D/g, ''),
  setWebhook: vi.fn()
}));

// Mock do wrapper claude — usamos fake pra controlar sequencia tool_use -> text
const mockCreate = vi.fn();
vi.mock('../../../src/utils/claude-client', () => ({
  default: undefined,
  messages: { create: (...args) => mockCreate(...args) },
  createAndTrack: (...args) => mockCreate(...args),
  client: {}
}));

const { freshDb, seedLead, canUseSqlite } = require('../../helpers/db');
const toolsRegistry = require('../../../src/tools');

beforeEach(() => {
  if (!canUseSqlite) return;
  freshDb();
  mockCreate.mockReset();
});

describe.skipIf(!canUseSqlite)('tools registry', () => {
  it('carrega 10 tools core para Carlos', () => {
    const defs = toolsRegistry.getDefinitionsForAgent('carlos');
    expect(defs.length).toBeGreaterThanOrEqual(10);
    const names = defs.map((d) => d.name);
    expect(names).toContain('send_whatsapp');
    expect(names).toContain('check_consent');
    expect(names).toContain('check_window_24h');
    expect(names).toContain('mark_qualified');
    expect(names).toContain('handoff_to_agent');
  });

  it('agente sem autorizacao nao pode chamar send_whatsapp', () => {
    expect(toolsRegistry.isAllowed('marcos', 'send_whatsapp')).toBe(false);
    expect(toolsRegistry.isAllowed('carlos', 'send_whatsapp')).toBe(true);
  });
});

describe.skipIf(!canUseSqlite)('handlers de tools individuais', () => {
  it('send_whatsapp bloqueia lead com opt-out', async () => {
    const lead = seedLead({ telefone: '5511999990002' });
    const consent = require('../../../src/services/consent');
    consent.markOptOut('5511999990002', 'teste');

    const handler = toolsRegistry.getHandler('send_whatsapp');
    const r = await handler({ lead_id: lead.id, text: 'ola' });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('optout');
  });

  it('check_consent retorna status correto', async () => {
    seedLead({ telefone: '5511999990003' });
    const handler = toolsRegistry.getHandler('check_consent');
    const r = await handler({ phone: '5511999990003' });
    expect(r.allowed).toBe(true);
  });

  it('mark_qualified atualiza score e classificacao', async () => {
    const lead = seedLead({ telefone: '5511999990004' });
    const handler = toolsRegistry.getHandler('mark_qualified');
    const r = await handler(
      {
        lead_id: lead.id,
        resumo: 'BANT ok: tem budget, e dono, dor clara, 90 dias',
        score_delta: 25
      },
      { agente: 'carlos' }
    );
    expect(r.ok).toBe(true);
    expect(r.score_total).toBeGreaterThanOrEqual(25);

    const { getDb } = require('../../../src/models/database');
    const updated = getDb().prepare('SELECT * FROM leads WHERE id = ?').get(lead.id);
    expect(updated.observacoes).toContain('BANT');
  });

  it('handoff_to_agent move lead pra outro agente e registra em handoffs', async () => {
    const lead = seedLead({ telefone: '5511999990005' });
    const handler = toolsRegistry.getHandler('handoff_to_agent');
    const r = await handler(
      {
        lead_id: lead.id,
        to: 'lucas',
        reason: 'BANT qualificado, score 75',
        context_summary: 'Decisor confirmado, 1200 clientes, usa IXC, quer resolver inadimplencia.'
      },
      { agente: 'carlos' }
    );
    expect(r.ok).toBe(true);
    expect(r.to).toBe('lucas');

    const { getDb } = require('../../../src/models/database');
    const db = getDb();
    const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id);
    expect(updated.agente_atual).toBe('lucas');
    expect(updated.etapa_funil).toBe('negociacao');

    const handoffs = db.prepare('SELECT * FROM handoffs WHERE lead_id = ?').all(lead.id);
    expect(handoffs.length).toBe(1);
    expect(handoffs[0].de_agente).toBe('carlos');
    expect(handoffs[0].para_agente).toBe('lucas');
  });
});

describe.skipIf(!canUseSqlite)('platform-agent-client — loop tool_use', () => {
  it('executa tool e persiste em agent_tool_calls', async () => {
    const lead = seedLead({ telefone: '5511999990006' });

    // Primeira resposta: tool_use de check_consent
    // Segunda: end_turn com texto final.
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'check_consent',
            input: { lead_id: lead.id }
          }
        ],
        usage: { input_tokens: 100, output_tokens: 20 },
        model: 'claude-sonnet-4-6'
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Oi! Em que posso ajudar?' }],
        usage: { input_tokens: 120, output_tokens: 15 },
        model: 'claude-sonnet-4-6'
      });

    const platformAgent = require('../../../src/services/platform-agent-client');
    const result = await platformAgent.invokeAgent('carlos', 'Ola, quero saber mais', {
      leadData: lead,
      correlationId: 'test-corr-1'
    });

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].name).toBe('check_consent');
    expect(result.tool_calls[0].status).toBe('ok');
    expect(result.resposta).toContain('Em que posso ajudar');

    const { getDb } = require('../../../src/models/database');
    const calls = getDb()
      .prepare('SELECT * FROM agent_tool_calls WHERE correlation_id = ?')
      .all('test-corr-1');
    expect(calls.length).toBe(1);
    expect(calls[0].tool_name).toBe('check_consent');
    expect(calls[0].agente).toBe('carlos');
  });

  it('bloqueia tool call nao autorizada para o agente', async () => {
    const lead = seedLead({ telefone: '5511999990007' });

    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_block',
            name: 'send_whatsapp',
            input: { lead_id: lead.id, text: 'vai' }
          }
        ],
        usage: { input_tokens: 80, output_tokens: 10 },
        model: 'claude-opus-4-6'
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Nao posso enviar.' }],
        usage: { input_tokens: 90, output_tokens: 10 },
        model: 'claude-opus-4-6'
      });

    const platformAgent = require('../../../src/services/platform-agent-client');
    const r = await platformAgent.invokeAgent('marcos', 'envie uma msg', {
      leadData: lead,
      correlationId: 'test-block'
    });

    const { getDb } = require('../../../src/models/database');
    const calls = getDb()
      .prepare('SELECT * FROM agent_tool_calls WHERE correlation_id = ?')
      .all('test-block');
    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe('blocked');
    expect(r.tool_calls[0].status).toBe('blocked');
  });

  it('respeita max_iterations (protege contra loops infinitos)', async () => {
    const lead = seedLead({ telefone: '5511999990008' });

    // Sempre retorna tool_use = loop infinito
    mockCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tu_loop',
          name: 'query_lead_detail',
          input: { lead_id: lead.id }
        }
      ],
      usage: { input_tokens: 50, output_tokens: 5 },
      model: 'claude-sonnet-4-6'
    });

    const platformAgent = require('../../../src/services/platform-agent-client');
    const r = await platformAgent.invokeAgent('carlos', 'loop', {
      leadData: lead,
      correlationId: 'test-loop',
      maxIterations: 3
    });

    expect(r.iterations).toBeLessThanOrEqual(3);
  });
});
