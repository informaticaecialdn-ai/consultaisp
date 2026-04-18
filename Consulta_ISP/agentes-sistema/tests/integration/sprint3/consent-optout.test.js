// Sprint 3 / T3: opt-out por mensagem STOP.
// Mocka zapi ANTES de require-ar webhook para evitar chamada de rede
vi.mock('../../../src/services/zapi', () => ({
  default: undefined,
  sendText: vi.fn().mockResolvedValue({ ok: true }),
  setWebhook: vi.fn(),
  formatPhone: (p) => String(p).replace(/\D/g, ''),
}));

const request = require('supertest');
const { freshDb } = require('../../helpers/db');
const { canUseSqlite } = require('../../helpers/db');
const { zapiHeader } = require('../../helpers/auth');
const { buildApp } = require('../../helpers/app');
const consent = require('../../../src/services/consent');

let app;

beforeAll(() => {
  if (!canUseSqlite) return;
  freshDb();
  process.env.ZAPI_WEBHOOK_ENFORCE = 'true';
  app = buildApp();
});

describe.skipIf(!canUseSqlite)('opt-out via webhook', () => {
  it('mensagem STOP registra opt-out em lead_opt_out', async () => {
    const phone = '5511988880001';
    expect(consent.canSendTo(phone).allowed).toBe(true);

    const res = await request(app)
      .post('/webhook/zapi')
      .set(zapiHeader())
      .send({ phone, text: { message: 'STOP' } });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('optout');

    const check = consent.canSendTo(phone);
    expect(check.allowed).toBe(false);
  });

  it('mensagem "vou parar de fumar" NAO marca opt-out (regex estrita)', async () => {
    const phone = '5511988880002';
    expect(consent.detectOptOutFromMessage('vou parar de fumar')).toBe(false);
    expect(consent.detectOptOutFromMessage('STOP')).toBe(true);
    expect(consent.canSendTo(phone).allowed).toBe(true);
  });
});
