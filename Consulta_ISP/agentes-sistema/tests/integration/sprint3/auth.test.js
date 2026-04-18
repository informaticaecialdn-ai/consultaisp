// Sprint 3 / T3: auth Bearer em /api/*.
const request = require('supertest');
const { freshDb } = require('../../helpers/db');
const { canUseSqlite } = require('../../helpers/db');
const { authHeader } = require('../../helpers/auth');
const { buildApp } = require('../../helpers/app');

let app;

beforeAll(() => {
  if (!canUseSqlite) return;
  freshDb();
  app = buildApp();
});

describe.skipIf(!canUseSqlite)('auth Bearer', () => {
  it('rejeita /api/leads sem token com 401', async () => {
    const res = await request(app).get('/api/leads');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('aceita /api/leads com Bearer correto', async () => {
    const res = await request(app).get('/api/leads').set(authHeader());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.leads)).toBe(true);
  });

  it('bypass auth para /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
