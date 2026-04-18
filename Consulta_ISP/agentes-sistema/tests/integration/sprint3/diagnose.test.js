// Sprint 3 / T3: GET /api/diagnose retorna a estrutura esperada.
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

describe.skipIf(!canUseSqlite)('/api/diagnose', () => {
  it('retorna status, checks e summary', async () => {
    const res = await request(app).get('/api/diagnose').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('checks');
    expect(res.body).toHaveProperty('summary');
    expect(res.body.checks).toHaveProperty('database');
    expect(res.body.checks.database).toHaveProperty('status');
    expect(typeof res.body.summary.total_checks).toBe('number');
    expect(typeof res.body.summary.passed).toBe('number');
  });

  it('responde com 401 sem auth', async () => {
    const res = await request(app).get('/api/diagnose');
    expect(res.status).toBe(401);
  });
});
