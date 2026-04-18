// Sprint 3 / T3: HMAC webhook Z-API.
const request = require('supertest');
const { freshDb } = require('../../helpers/db');
const { canUseSqlite } = require('../../helpers/db');
const { zapiHeader } = require('../../helpers/auth');
const { buildApp } = require('../../helpers/app');

let app;

beforeAll(() => {
  if (!canUseSqlite) return;
  freshDb();
  // Enforce true para forcar rejeicao sem header
  process.env.ZAPI_WEBHOOK_ENFORCE = 'true';
  app = buildApp();
});

describe.skipIf(!canUseSqlite)('webhook HMAC Z-API', () => {
  it('rejeita POST sem x-z-api-token com 401 (enforce)', async () => {
    const res = await request(app)
      .post('/webhook/zapi')
      .send({ phone: '5511988887777', text: { message: 'oi' } });
    expect(res.status).toBe(401);
  });

  it('aceita POST com header correto e responde 200', async () => {
    const res = await request(app)
      .post('/webhook/zapi')
      .set(zapiHeader())
      .send({ phone: '5511988887777', fromMe: true }); // fromMe evita orchestrator
    expect(res.status).toBe(200);
  });
});
