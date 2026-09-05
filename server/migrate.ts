import fs from "fs";
import path from "path";
import { pool } from "./db";
import { logger } from "./logger";

// Use process.cwd() — works in both ESM (dev) and CJS (production bundle)
const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

function log(message: string) {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  });
  console.log(`${time} [migrate] ${message}`);
}

/**
 * A mensagem inteira do erro do Postgres — nao so a primeira linha dela.
 *
 * O node-pg NAO junta HINT e DETAIL em `.message`: sao campos separados do
 * `DatabaseError`, e ler so a mensagem joga fora justamente a parte que foi
 * escrita para quem esta lendo o log as 3h da manha. A 0020 e o exemplo vivo:
 * a mensagem diz QUAIS provedores colidiram ("23864873000148 -> provedores
 * 6, 10") e o HINT diz que a escolha e de negocio e o que fazer para sair do
 * impasse. Com `(err as Error).message` o operador via a colisao e nao via a
 * instrucao — e ficava sem saber se podia mexer.
 *
 * Vale para toda migracao futura, nao so para a 0020: em erro de indice unico
 * o Postgres nao poe a chave na mensagem, poe no DETAIL ("Key (cnpj)=(...)
 * already exists"), que e o unico lugar que diz QUAL linha derrubou o deploy.
 *
 * Vai tudo para dentro da `message` (em vez de so anexar campos ao Error)
 * porque ha consumidor que imprime somente `.message` — `server/run-migrations.ts`
 * e o log de boot. O erro original segue em `cause` para quem quiser os campos.
 */
function descreverErroDoPostgres(err: unknown): string {
  const pg = err as { message?: unknown; detail?: unknown; hint?: unknown } | null;
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");

  const partes = [texto(pg?.message) || String(err)];
  const detail = semAChave(texto(pg?.detail));
  const hint = texto(pg?.hint);
  if (detail) partes.push(`DETAIL: ${detail}`);
  if (hint) partes.push(`HINT: ${hint}`);
  return partes.join(" | ");
}

/**
 * Tira o VALOR de dentro do DETAIL, mantendo a coluna.
 *
 * O DETAIL de violacao de indice unico vem no formato
 * `Key (coluna)=(valor) already exists.` — e o `valor` e o dado da linha. Numa
 * migracao que crie indice unico sobre uma coluna de CPF, isso e um CPF em
 * claro dentro de `logger.fatal`, que vai para o stdout e para
 * `consulta-isp-error.log`.
 *
 * O `redact` do pino (server/logger.ts) NAO alcanca isto: ele censura CAMINHOS
 * de objeto (`*.cpf`, `*.cpfCnpj`), e aqui o documento e uma substring dentro
 * de `err.message`. E o resto do projeto ja trunca CPF em todo log de rota, o
 * que faria do boot o unico lugar que nao trunca.
 *
 * A COLUNA fica, e ela e o que importa para operar: saber que foi `cpf_cnpj`
 * que colidiu resolve o deploy. Saber QUAL documento nao — quem precisa disso
 * consulta o banco, autenticado, e deixa rastro.
 */
function semAChave(detail: string): string {
  return detail.replace(/(\)=\()[^)]*(\))/g, "$1…$2");
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

  // A tabela de sessao NAO esta no shared/schema.ts (e infraestrutura do
  // connect-pg-simple, nao dominio), entao todo `drizzle-kit push --force` a
  // enxerga como sobra e DERRUBA — foi assim que o login de producao quebrou
  // em 2026-08-26. E o fallback do proprio connect-pg-simple nao funciona em
  // producao: ele le um table.sql interno do pacote que o esbuild nao empacota.
  // Garantir aqui, a cada boot, fecha os dois buracos de uma vez.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`);

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
      // O ROLLBACK tambem pode falhar (conexao caida no meio da transacao). Se
      // ele estourar solto, o erro que sobe e o DELE e o da migracao se perde —
      // com o HINT junto. Engolir a falha do rollback preserva o diagnostico que
      // importa; a transacao morre de qualquer forma quando o client volta ao
      // pool, entao nao ha nada a salvar aqui alem da explicacao.
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(
        `Migration ${file} failed: ${descreverErroDoPostgres(err)}`,
        { cause: err },
      );
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
  const criticalColumns: Array<{ table: string; column: string }> = [
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
    { table: "equipment", column: "provider_id" },
    { table: "equipment", column: "source" },
    { table: "equipment_recovery_cases", column: "provider_id" },
    { table: "equipment_recovery_cases", column: "deadline_at" },
    { table: "equipment_recovery_cases", column: "bureau_status" },
    { table: "equipment_recovery_events", column: "case_id" },
  ];

  const optionalColumns: Array<{ table: string; column: string }> = [
    { table: "titular_requests", column: "updated_by" },
    { table: "titular_requests", column: "updated_at" },
    { table: "titular_requests", column: "execution_result" },
    { table: "titular_requests", column: "prazo_limite" },
  ];

  const allColumns = [...criticalColumns, ...optionalColumns];

  const { rows } = await pool.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (${allColumns.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ")})
  `, allColumns.flatMap(c => [c.table, c.column]));

  const found = new Set(rows.map(r => `${r.table_name}.${r.column_name}`));

  const missingOptional = optionalColumns.filter(c => !found.has(`${c.table}.${c.column}`));
  if (missingOptional.length > 0) {
    const list = missingOptional.map(c => `${c.table}.${c.column}`).join(", ");
    log(`WARNING: Optional columns missing: ${list} — some features may be unavailable`);
  }

  const missingCritical = criticalColumns.filter(c => !found.has(`${c.table}.${c.column}`));
  if (missingCritical.length > 0) {
    const list = missingCritical.map(c => `${c.table}.${c.column}`).join(", ");
    throw new Error(
      `Schema verification failed — missing critical columns: ${list}. ` +
      `Run migrations before starting.`
    );
  }

  log("Schema verification passed");
}

/**
 * O passo de boot que decide se este processo pode servir trafego: aplica as
 * migracoes, confere o schema, e DERRUBA O PROCESSO se qualquer um dos dois
 * falhar.
 *
 * O que mudou e por que
 * ---------------------
 * Ate aqui a falha de `runMigrations` era engolida em server/index.ts —
 * `logger.error({ err }, "Migration failed — continuing with existing schema")`
 * — e o app subia assim mesmo. A razao registrada no commit que criou esse
 * catch (7bd72b6, "migrations e LGPD services nao-fatais") era o bundle CJS de
 * producao nao achar a pasta `migrations/`. Essa razao NAO VALE MAIS — e, olhando
 * o codigo, nunca chegou a valer: pasta ausente retorna calado la dentro
 * ("No migrations directory found, skipping"), sem lancar nada. O unico erro que
 * alcancava aquele catch era migracao que falhou DE VERDADE, que e exatamente o
 * caso em que continuar e a pior escolha possivel.
 *
 * O custo, assumido: uma migracao ruim passa a derrubar o site no deploy, em vez
 * de degradar em silencio. O rollback vira urgencia da madrugada.
 *
 * O beneficio, maior: o codigo da aplicacao assume o schema DEPOIS da migracao.
 * Servir com o schema de antes nao e "modo degradado" — e um sistema que
 * responde 200 com resposta errada. O caso concreto que forcou a troca: se a
 * 0020 falhar, `providers.cnpj` continua com duas formas do mesmo dado, e
 * `getProviderByCnpj` — que agora normaliza o argumento e compara por igualdade
 * exata — deixa de alcancar as linhas mascaradas: nem os digitos nem a mascara
 * as acham. O cadastro nao encontra a duplicata, o indice UNIQUE nao barra (para
 * o Postgres sao strings diferentes), e nasce um SEGUNDO tenant para a mesma
 * empresa — com metade da carteira cada um. Deploy nenhum desfaz isso depois.
 *
 * O agravante que fecha a discussao: `runMigrations` para no primeiro arquivo
 * que falha e so registra em `_migrations` o que aplicou. Engolir a falha nao
 * atrasa UMA migracao: congela todas as seguintes, para sempre. A cada boot ela
 * e retentada, falha de novo, e nada novo entra — o site fica de pe por meses
 * sobre um schema parado, e o unico sinal e uma linha de erro que rolou para
 * fora da tela no boot.
 *
 * O precedente ja estava no proprio arquivo: `verifySchema`, que apenas confere
 * se a COLUNA existe — sintoma, e sintoma parcial — sempre derrubou o processo.
 * Tratar o sintoma como fatal e a causa como aviso era a inversao.
 *
 * (A alternativa considerada era levar a canonicidade do CNPJ para dentro de
 * `verifySchema`, que ja e fatal. Ela cobre a 0020 e mais nada: a proxima
 * migracao a falhar voltaria a ser engolida, e `verifySchema` viraria uma lista
 * crescente de consultas de dado — caro a cada boot e sempre atrasada em relacao
 * as migracoes. Fatal na origem cobre todas de uma vez.)
 */
export async function prepararSchemaOuCair(): Promise<void> {
  try {
    await runMigrations();
  } catch (err) {
    logger.fatal(
      { err },
      "Migracao falhou — o processo nao sobe com um schema que o codigo nao assume",
    );
    process.exit(1);
  }

  try {
    await verifySchema();
  } catch (err) {
    logger.fatal({ err }, "Critical schema verification failed — cannot serve traffic safely");
    process.exit(1);
  }
}
