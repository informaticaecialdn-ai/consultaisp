import fs from "fs";
import path from "path";
import { pool } from "./db";

// CJS-compatible __dirname (esbuild bundles to CJS, so import.meta.url is undefined)
const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

function log(message: string) {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  });
  console.log(`${time} [migrate] ${message}`);
}

/**
 * Run pending SQL migrations from the migrations/ directory.
 * Tracks applied migrations in a `_migrations` table.
 */
export async function runMigrations(): Promise<void> {
  // Ensure tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    log("No migrations directory found, skipping");
    return;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    log("No migration files found");
    return;
  }

  const { rows: applied } = await pool.query<{ name: string }>(
    "SELECT name FROM _migrations ORDER BY name"
  );
  const appliedSet = new Set(applied.map(r => r.name));

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8").trim();
    if (!sql) continue;

    log(`Applying migration: ${file}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      log(`Migration applied: ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
}

/**
 * Verify that critical columns exist before the app serves traffic.
 * Throws if any required column is missing — prevents SQL errors at runtime.
 */
export async function verifySchema(): Promise<void> {
  const requiredColumns: Array<{ table: string; column: string }> = [
    { table: "titular_requests", column: "updated_by" },
    { table: "titular_requests", column: "updated_at" },
    { table: "titular_requests", column: "execution_result" },
    { table: "titular_requests", column: "prazo_limite" },
    { table: "users", column: "id" },
    { table: "users", column: "email" },
    { table: "users", column: "role" },
    { table: "providers", column: "id" },
    { table: "providers", column: "name" },
    { table: "providers", column: "cnpj" },
    { table: "isp_consultations", column: "id" },
    { table: "isp_consultations", column: "provider_id" },
    { table: "isp_consultations", column: "cpf_cnpj" },
    { table: "erp_integrations", column: "id" },
    { table: "erp_integrations", column: "provider_id" },
    { table: "erp_integrations", column: "erp_source" },
  ];

  const { rows } = await pool.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (${requiredColumns.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ")})
  `, requiredColumns.flatMap(c => [c.table, c.column]));

  const found = new Set(rows.map(r => `${r.table_name}.${r.column_name}`));
  const missing = requiredColumns.filter(c => !found.has(`${c.table}.${c.column}`));

  if (missing.length > 0) {
    const list = missing.map(c => `${c.table}.${c.column}`).join(", ");
    throw new Error(
      `Schema verification failed — missing columns: ${list}. ` +
      `Run migrations before starting the application.`
    );
  }

  log("Schema verification passed");
}
