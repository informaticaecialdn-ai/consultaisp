// Sprint 3 / T3: lock in-memory em processFollowups evita execucao concorrente.
vi.mock('../../../src/services/zapi', () => ({
  sendText: vi.fn().mockResolvedValue({ ok: true }),
  setWebhook: vi.fn(),
  formatPhone: (p) => String(p).replace(/\D/g, ''),
}));
vi.mock('../../../src/services/claude', () => ({
  sendToAgent: vi.fn().mockResolvedValue({ resposta: 'mock followup', agente: 'carlos' }),
  client: { messages: { create: vi.fn() } },
}));

const { freshDb } = require('../../helpers/db');
const { canUseSqlite } = require('../../helpers/db');

beforeAll(() => {
  if (!canUseSqlite) return; freshDb(); });

describe.skipIf(!canUseSqlite)('followup lock', () => {
  it('duas execucoes concorrentes nao duplicam envios', async () => {
    const db = require('../../../src/models/database').getDb();
    const followup = require('../../../src/services/followup');

    // Cria lead + followup pendente
    db.prepare(
      `INSERT INTO leads (telefone, agente_atual, etapa_funil, origem)
       VALUES (?, 'carlos', 'qualificacao', 'teste')`
    ).run('5511966660001');
    const lead = db.prepare('SELECT id FROM leads WHERE telefone = ?').get('5511966660001');
    db.prepare(
      `INSERT INTO followups (lead_id, agente, mensagem_original, tentativa, proximo_envio, status)
       VALUES (?, 'carlos', 'teste', 1, DATETIME('now','-1 minutes'), 'pendente')`
    ).run(lead.id);

    // Duas chamadas concorrentes
    await Promise.all([followup.processFollowups(), followup.processFollowups()]);

    const enviados = db.prepare(
      "SELECT COUNT(*) AS c FROM followups WHERE lead_id = ? AND status = 'enviado'"
    ).get(lead.id).c;
    // Exatamente um envio (a segunda chamada nao duplicou)
    expect(enviados).toBe(1);
  });
});
