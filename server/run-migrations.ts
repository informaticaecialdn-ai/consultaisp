import "dotenv/config";
import { runMigrations, verifySchema } from "./migrate";
import { pool } from "./db";

async function main() {
  try {
    await runMigrations();
    await verifySchema();
    console.log("All migrations applied and schema verified.");
  } catch (err) {
    console.error("Migration failed:", (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
