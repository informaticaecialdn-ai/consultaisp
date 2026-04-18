// Sprint 3 / T3: _buildMessages colapsa roles consecutivos.
vi.mock('../../../src/services/zapi', () => ({
  sendText: vi.fn(), setWebhook: vi.fn(), formatPhone: (p) => p,
}));

const { freshDb } = require('../../helpers/db');
const { canUseSqlite } = require('../../helpers/db');
beforeAll(() => {
  if (!canUseSqlite) return; freshDb(); });

describe.skipIf(!canUseSqlite)('claude._buildMessages', () => {
  let claudeSvc;
  beforeAll(() => {
  if (!canUseSqlite) return;
    // Instancia direto a classe por require (singleton ok)
    claudeSvc = require('../../../src/services/claude');
  });

  it('colapsa 2 user seguidos em um unico turno', () => {
    const messages = claudeSvc._buildMessages(
      [
        { role: 'user', content: 'ola' },
        { role: 'user', content: 'voce esta ai?' },
      ],
      'preciso de ajuda'
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('ola');
    expect(messages[0].content).toContain('voce esta ai?');
    expect(messages[0].content).toContain('preciso de ajuda');
  });

  it('remove assistant se for a primeira msg', () => {
    const messages = claudeSvc._buildMessages(
      [
        { role: 'assistant', content: 'mensagem fantasma' },
        { role: 'user', content: 'ola' },
      ],
      'pergunta final'
    );
    expect(messages[0].role).toBe('user');
    // 2 user colapsam em um, total 1
    expect(messages).toHaveLength(1);
  });

  it('alterna user/assistant/user corretamente', () => {
    const messages = claudeSvc._buildMessages(
      [
        { role: 'user', content: 'oi' },
        { role: 'assistant', content: 'ola, como posso ajudar' },
      ],
      'quanto custa?'
    );
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[2].role).toBe('user');
  });
});
