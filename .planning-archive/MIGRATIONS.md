# Migration Workflow

## Schema Change Flow

1. Edit `shared/schema.ts` with the new table or column changes.
2. Generate a versioned SQL migration:
   ```bash
   npm run db:generate
   ```
3. Review the generated SQL file in `migrations/`.
4. Commit both the schema change and the migration file together.

## Applying Migrations

Migrations run automatically on application boot (`server/index.ts` calls `runMigrations()`).

To apply migrations manually without starting the server:
```bash
npm run db:migrate
```

Each migration runs inside a transaction. If it fails, the transaction is rolled back and the app exits with code 1 — no traffic is served with an invalid schema.

## Migration File Naming

Files are sorted lexicographically. Use zero-padded prefixes:
- `0000_initial_schema.sql` — baseline (all tables with `CREATE TABLE IF NOT EXISTS`)
- `0001_add_titular_requests_update_columns.sql` — incremental ALTER
- `0002_add_titular_prazo_limite.sql` — incremental ALTER

## Tracking Table

Applied migrations are recorded in the `_migrations` table:
```sql
SELECT * FROM _migrations ORDER BY applied_at;
```
Each row contains the migration filename and the timestamp it was applied. A migration is only applied once — re-running is safe.

## `db:push` — Development Only

```bash
npm run db:push
```

**WARNING:** `db:push` uses `drizzle-kit push` which directly syncs the schema to the database without generating migration files. It is convenient for local development but **must never be used in production** — it can drop columns or tables without warning. Always use versioned migrations (`db:generate` + `db:migrate`) for production deployments.

## Idempotency

- `0000_initial_schema.sql` uses `CREATE TABLE IF NOT EXISTS` — safe to run on existing databases.
- Incremental migrations use `ADD COLUMN IF NOT EXISTS` — they become no-ops when columns already exist.
