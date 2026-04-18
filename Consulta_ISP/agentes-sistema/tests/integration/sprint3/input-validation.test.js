// Sprint 3 / T3: validacao Zod em POST /api/leads.
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

describe.skipIf(!canUseSqlite)('input validation (Zod)', () => {
  it('POST /api/leads sem telefone retorna 400 com issues', async () => {
    const res = await request(app).post('/api/leads').set(authHeader()).send({ nome: 'Sem fone' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.some(i => i.path === 'telefone')).toBe(true);
  });

  it('POST /api/leads com telefone invalido retorna 400', async () => {
    const res = await request(app).post('/api/leads').set(authHeader()).send({ telefone: 'abc' });
    expect(res.status).toBe(400);
  });

  it('POST /api/leads valido retorna 200', async () => {
    const res = await request(app).post('/api/leads').set(authHeader()).send({
      telefone: '5511977770001',
      nome: 'Lead Valido',
      origem: 'manual',
    });
    expect([200, 409]).toContain(res.status);
  });

  it('POST /api/prospectar com 150 telefones retorna 400', async () => {
    const telefones = Array.from({ length: 150 }, (_, i) => `551199999${String(i).padStart(4, '0')}`);
    const res = await request(app).post('/api/prospectar').set(authHeader()).send({ telefones });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});
