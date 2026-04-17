const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function applied(db, name) {
  const row = db.prepare('SELECT name FROM schema_migrations WHERE name = ?').get(name);
  return !!row;
}

function markApplied(db, name) {
  db.prepare('INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)').run(name);
}

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

function hasColumn(db, table, column) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some(c => c.name === column);
  } catch {
    return false;
  }
}

function tableExists(db, table) {
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(table);
    return !!row;
  } catch {
    return false;
  }
}

function prepareLegacyCampanhas(db) {
  // Guard 1 (existencia): so age se a tabela campanhas existir.
  // Em bancos novos a tabela e criada pela migration 009, entao aqui nao faz nada.
  if (!tableExists(db, 'campanhas')) return;

  // Guard 2 (version check explicito): se a migration 009 ja foi aplicada,
  // o schema v2 esta em uso e nao ha legado a preservar.
  if (applied(db, '009-campanhas.sql')) return;

  // Guard 3 (version check estrutural): schema v2 (Sprint 5) possui audiencia_id; schema v1 nao.
  // Defende contra bancos onde 009 foi aplicada manualmente sem marcar schema_migrations.
  if (hasColumn(db, 'campanhas', 'audiencia_id')) return;

  // Upgrade path real: temos uma tabela campanhas v1 herdada de uma instalacao antiga.
  // Preserva dados para historico e libera o nome para a migration 009 criar o schema v2.
  const legacyExists = tableExists(db, 'campanhas_legacy');
  if (!legacyExists) {
    console.log('[MIGRATIONS] Renomeando campanhas (schema v1) -> campanhas_legacy');
    db.exec('ALTER TABLE campanhas RENAME TO campanhas_legacy');
  } else {
    console.log('[MIGRATIONS] campanhas_legacy ja existe, removendo campanhas v1 orfa');
    db.exec('DROP TABLE campanhas');
  }
}

function runMigrations(db) {
  ensureMigrationsTable(db);

  // Trata schema legado antes de aplicar 009
  prepareLegacyCampanhas(db);

  const files = listMigrations();
  let count = 0;
  for (const file of files) {
    if (applied(db, file)) continue;
    const sqlPath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    const exec = db.transaction(() => {
      db.exec(sql);
      markApplied(db, file);
    });
    try {
      exec();
      console.log(`[MIGRATIONS] Aplicada: ${file}`);
      count++;
    } catch (err) {
      // Alguns ALTER TABLE podem falhar se coluna ja existe (migracao antiga aplicada manualmente)
      // Se o erro for "duplicate column", apenas marca como aplicada
      if (/duplicate column/i.test(err.message) || /already exists/i.test(err.message)) {
        markApplied(db, file);
        console.log(`[MIGRATIONS] Ja aplicada (detectada por state): ${file}`);
        continue;
      }
      console.error(`[MIGRATIONS] Erro em ${file}:`, err.message);
      throw err;
    }
  }
  if (count === 0) console.log('[MIGRATIONS] Nenhuma migration pendente');
  return count;
}

module.exports = { runMigrations, tableExists, hasColumn };
