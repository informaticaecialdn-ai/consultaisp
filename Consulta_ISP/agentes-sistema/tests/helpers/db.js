// Helper de banco de dados para testes Vitest (Sprint 3 / T3).
// Usa :memory: (via DB_PATH no tests/setup.js).
// Em ambientes sem better-sqlite3 binding compativel (ex: Node 24 local sem build tools),
// exportamos `canUseSqlite=false` para permitir describe.skipIf() nos testes.

let database, runMigrations, canUseSqlite;

try {
  database = require('../../src/models/database');
  ({ runMigrations } = require('../../src/models/migrations'));
  // Smoke-load para detectar erro de bindings/ABI
  database._resetForTests();
  // eslint-disable-next-line no-unused-vars
  const probe = database.getDb();
  database._resetForTests();
  canUseSqlite = true;
} catch (err) {
  if (/bindings|NODE_MODULE_VERSION|better-sqlite3/i.test(err.message)) {
    canUseSqlite = false;
    console.warn('[TESTS] better-sqlite3 indisponivel neste Node — tests sqlite serao pulados:', err.message);
  } else {
    throw err;
  }
}

function freshDb() {
  if (!canUseSqlite) throw new Error('SQLITE_UNAVAILABLE');
  database._resetForTests();
  const conn = database.getDb();
  database.initialize();
  try { runMigrations(conn); } catch { /* migrations best-effort em :memory: */ }
  return conn;
}

function seedLead({ telefone = '5511999990001', nome = 'Test Lead', provedor = 'TestISP' } = {}) {
  const conn = database.getDb();
  conn.prepare(
    `INSERT OR IGNORE INTO leads (telefone, nome, provedor, agente_atual, etapa_funil, origem)
     VALUES (?, ?, ?, 'carlos', 'novo', 'teste')`
  ).run(telefone, nome, provedor);
  return conn.prepare('SELECT * FROM leads WHERE telefone = ?').get(telefone);
}

module.exports = { freshDb, seedLead, database, canUseSqlite };
