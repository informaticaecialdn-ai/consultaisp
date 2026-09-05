/**
 * O boot e o schema: o que acontece quando uma migracao falha.
 *
 * Estes testes prendem dois defeitos que andavam juntos.
 *
 * 1. A falha era ENGOLIDA. `server/index.ts` fazia `logger.error(... "continuing
 *    with existing schema")` e o app subia. Como `runMigrations` para no primeiro
 *    arquivo que falha e so registra em `_migrations` o que aplicou, o efeito nao
 *    era "uma migracao atrasada": era o schema congelado, retentado e falhando a
 *    cada boot, com o site de pe servindo dado que o codigo novo nao assume.
 *
 * 2. A explicacao do erro era JOGADA FORA. O node-pg entrega HINT e DETAIL em
 *    campos separados do `DatabaseError`, e o erro era montado so com `.message`.
 *    A 0020 escreve um HINT dizendo que a colisao de CNPJ e decisao de negocio e
 *    o que fazer com os ids que ela nomeia — e esse HINT nunca chegava ao log.
 *
 * O pool e o `fs` sao dublês: o que se mede aqui e a decisao do codigo diante da
 * resposta do Postgres, nao o Postgres. A SQL da 0020 ja foi provada contra o
 * banco de producao, em transacao com ROLLBACK.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** Arquivos que o `fs` dublê enxerga em migrations/, por nome -> conteudo. */
const cenario = vi.hoisted(() => ({
  arquivos: new Map<string, string>(),
  /** Migracoes ja em `_migrations` (o que a tabela responde). */
  aplicadas: [] as string[],
  /** Conteudo de migracao -> erro que o Postgres devolve ao executa-la. */
  errosPorSql: new Map<string, unknown>(),
  /** Se o proprio ROLLBACK falha (conexao caida no meio da transacao). */
  rollbackFalha: false,
  /** Se `verifySchema` acha todas as colunas criticas. */
  schemaCompleto: true,
  /** Toda migracao que chegou a ser gravada em `_migrations`. */
  gravadas: [] as string[],
}));

vi.mock("fs", () => {
  const dublê = {
    existsSync: () => true,
    readdirSync: () => [...cenario.arquivos.keys()],
    readFileSync: (caminho: unknown) => {
      const nome = String(caminho).split(/[\\/]/).pop() ?? "";
      return cenario.arquivos.get(nome) ?? "";
    },
  };
  return { ...dublê, default: dublê };
});

const poolMock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
const clientMock = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("./db", () => ({ pool: poolMock, db: {} }));

const fatal = vi.hoisted(() => vi.fn());
vi.mock("./logger", () => ({
  logger: { fatal, error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { runMigrations, prepararSchemaOuCair } from "./migrate";

/** Sentinela: `process.exit` nao encerra o vitest, mas tem que interromper o fluxo. */
class SaidaDoProcesso extends Error {
  constructor(readonly codigo: number | undefined) {
    super(`process.exit(${codigo})`);
  }
}

/** Um erro com a forma do `DatabaseError` do node-pg: hint e detail SEPARADOS. */
function erroDoPostgres(campos: { message: string; detail?: string; hint?: string; code?: string }) {
  const err = new Error(campos.message) as Error & Record<string, unknown>;
  if (campos.detail) err.detail = campos.detail;
  if (campos.hint) err.hint = campos.hint;
  if (campos.code) err.code = campos.code;
  return err;
}

let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cenario.arquivos.clear();
  cenario.aplicadas = [];
  cenario.errosPorSql.clear();
  cenario.rollbackFalha = false;
  cenario.schemaCompleto = true;
  cenario.gravadas = [];
  fatal.mockReset();

  // O `log()` de migrate.ts escreve no console; nao poluir a saida do vitest.
  vi.spyOn(console, "log").mockImplementation(() => {});

  poolMock.query.mockReset();
  poolMock.query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/information_schema/.test(sql)) {
      // Devolve exatamente as colunas perguntadas quando o schema esta completo:
      // assim o teste nao precisa repetir a lista de `verifySchema`, que muda.
      if (!cenario.schemaCompleto) return { rows: [] };
      const rows = [];
      for (let i = 0; i < (params?.length ?? 0); i += 2) {
        rows.push({ table_name: params![i], column_name: params![i + 1] });
      }
      return { rows };
    }
    if (/FROM _migrations/.test(sql)) {
      return { rows: cenario.aplicadas.map(name => ({ name })) };
    }
    return { rows: [] };
  });

  poolMock.connect.mockReset();
  poolMock.connect.mockResolvedValue(clientMock);

  clientMock.query.mockReset();
  clientMock.release.mockReset();
  clientMock.query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
    if (sql === "ROLLBACK") {
      if (cenario.rollbackFalha) throw new Error("connection terminated unexpectedly");
      return { rows: [] };
    }
    if (/INSERT INTO _migrations/.test(sql)) {
      cenario.gravadas.push(String(params?.[0]));
      return { rows: [] };
    }
    const erro = cenario.errosPorSql.get(sql);
    if (erro) throw erro;
    return { rows: [] };
  });

  exitSpy = vi.spyOn(process, "exit").mockImplementation(((codigo?: number) => {
    throw new SaidaDoProcesso(codigo);
  }) as never);
});

afterEach(() => {
  exitSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("runMigrations — o erro do Postgres chega inteiro", () => {
  it("o HINT e o DETAIL da migracao aparecem no erro, nao so a primeira linha", async () => {
    const sql = "DO $$ BEGIN RAISE EXCEPTION ...; END $$;";
    cenario.arquivos.set("0020_cnpj_canonico.sql", sql);
    cenario.errosPorSql.set(sql, erroDoPostgres({
      message: "CNPJ duplicado ao normalizar: 23864873000148 -> provedores 6, 10. A migracao 0020 nao continua.",
      detail: "Key (cnpj)=(23864873000148) already exists.",
      hint: "Sao dois provedores para a mesma empresa. Resolva os ids acima a mao e suba de novo.",
      code: "P0001",
    }));

    const erro = await runMigrations().catch(e => e as Error);

    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toContain("Migration 0020_cnpj_canonico.sql failed");
    // A mensagem: QUAIS ids colidiram.
    expect(erro.message).toContain("provedores 6, 10");
    /**
     * O DETAIL diz QUAL COLUNA derrubou o deploy — e nao qual VALOR.
     *
     * A coluna e o que resolve o deploy: saber que foi `cnpj` que colidiu basta
     * para agir. O valor nao acrescenta nada a operacao e e dado de titular: em
     * `Key (cpf_cnpj)=(...)` de uma migracao futura isso seria um CPF em claro
     * dentro de `logger.fatal`, no stdout e no arquivo de log. O `redact` do
     * pino nao alcanca (ele censura CAMINHOS de objeto, e aqui o documento e
     * substring de `err.message`), e o resto do projeto ja trunca CPF em todo
     * log de rota — o boot seria o unico lugar sem truncar.
     */
    expect(erro.message).toContain("DETAIL: Key (cnpj)=(…) already exists.");
    expect(erro.message).not.toContain("23864873000148) already exists");
    // O HINT: O QUE FAZER. Era isto que nunca chegava ao operador.
    expect(erro.message).toContain("HINT: Sao dois provedores para a mesma empresa");
    // O erro cru sobrevive para quem quiser os campos separados (ex.: `code`).
    expect((erro.cause as Record<string, unknown>)?.code).toBe("P0001");
  });

  it("sem hint e sem detail, a mensagem nao ganha rotulo vazio", async () => {
    const sql = "ALTER TABLE providers ADD COLUMN x TEXT;";
    cenario.arquivos.set("0021_qualquer.sql", sql);
    cenario.errosPorSql.set(sql, erroDoPostgres({ message: "syntax error at or near \"x\"" }));

    const erro = await runMigrations().catch(e => e as Error);

    expect(erro.message).toBe("Migration 0021_qualquer.sql failed: syntax error at or near \"x\"");
    expect(erro.message).not.toContain("HINT");
    expect(erro.message).not.toContain("DETAIL");
  });

  it("ROLLBACK que tambem falha nao apaga o diagnostico da migracao", async () => {
    // Sem a guarda, o erro que subia era o do ROLLBACK — e o HINT sumia junto
    // com a unica pista de por que o deploy caiu.
    const sql = "UPDATE providers SET cnpj = ...;";
    cenario.arquivos.set("0020_cnpj_canonico.sql", sql);
    cenario.rollbackFalha = true;
    cenario.errosPorSql.set(sql, erroDoPostgres({
      message: "CNPJ duplicado ao normalizar",
      hint: "resolva os ids a mao",
    }));

    const erro = await runMigrations().catch(e => e as Error);

    expect(erro.message).toContain("CNPJ duplicado ao normalizar");
    expect(erro.message).toContain("HINT: resolva os ids a mao");
    expect(erro.message).not.toContain("connection terminated");
    // O client volta ao pool mesmo com o rollback quebrado.
    expect(clientMock.release).toHaveBeenCalled();
  });

  it("erro sem `message` (throw de objeto cru) ainda descreve alguma coisa", async () => {
    const sql = "SELECT 1;";
    cenario.arquivos.set("0022_estranha.sql", sql);
    cenario.errosPorSql.set(sql, "falhou feio");

    const erro = await runMigrations().catch(e => e as Error);

    expect(erro.message).toContain("Migration 0022_estranha.sql failed: falhou feio");
  });

  it("a migracao que falha nao entra em _migrations e as seguintes nao rodam", async () => {
    // E por isso que engolir a falha congela o schema: a 0020 e retentada a cada
    // boot, falha de novo, e a 0021 nunca chega a ser aplicada.
    cenario.arquivos.set("0020_cnpj_canonico.sql", "SQL DA 0020");
    cenario.arquivos.set("0021_depois.sql", "SQL DA 0021");
    cenario.errosPorSql.set("SQL DA 0020", erroDoPostgres({ message: "CNPJ duplicado" }));

    await expect(runMigrations()).rejects.toThrow("Migration 0020_cnpj_canonico.sql failed");

    expect(cenario.gravadas).toEqual([]);
    expect(clientMock.query).not.toHaveBeenCalledWith("SQL DA 0021", undefined);
    expect(clientMock.query.mock.calls.some(([sql]) => sql === "SQL DA 0021")).toBe(false);
  });

  it("migracao pendente que passa e gravada; a ja aplicada nao roda de novo", async () => {
    cenario.arquivos.set("0019_motivo_do_corte.sql", "SQL DA 0019");
    cenario.arquivos.set("0020_cnpj_canonico.sql", "SQL DA 0020");
    cenario.aplicadas = ["0019_motivo_do_corte.sql"];

    await runMigrations();

    expect(cenario.gravadas).toEqual(["0020_cnpj_canonico.sql"]);
    expect(clientMock.query.mock.calls.some(([sql]) => sql === "SQL DA 0019")).toBe(false);
  });
});

describe("prepararSchemaOuCair — a falha de migracao derruba o processo", () => {
  it("migracao que falha e fatal: exit(1), e verifySchema nem chega a rodar", async () => {
    const sql = "DO $$ ... $$;";
    cenario.arquivos.set("0020_cnpj_canonico.sql", sql);
    cenario.errosPorSql.set(sql, erroDoPostgres({
      message: "CNPJ duplicado ao normalizar: 23864873000148 -> provedores 6, 10",
      hint: "resolva os ids a mao e suba de novo",
    }));

    const saida = await prepararSchemaOuCair().catch(e => e as SaidaDoProcesso);

    expect(saida).toBeInstanceOf(SaidaDoProcesso);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fatal).toHaveBeenCalledTimes(1);

    // O log fatal leva o erro inteiro — com o HINT — e nao so "falhou".
    const [contexto] = fatal.mock.calls[0] as [{ err: Error }, string];
    expect(contexto.err.message).toContain("provedores 6, 10");
    expect(contexto.err.message).toContain("HINT: resolva os ids a mao");

    // Nao adianta conferir colunas de um schema que nao terminou de migrar.
    const conferiuSchema = poolMock.query.mock.calls.some(([sql]) => /information_schema/.test(String(sql)));
    expect(conferiuSchema).toBe(false);
  });

  it("com as migracoes em dia e o schema completo, sobe calado", async () => {
    cenario.arquivos.set("0020_cnpj_canonico.sql", "SQL DA 0020");

    await expect(prepararSchemaOuCair()).resolves.toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(fatal).not.toHaveBeenCalled();
    expect(cenario.gravadas).toEqual(["0020_cnpj_canonico.sql"]);
  });

  it("coluna critica faltando continua sendo fatal (nao regredir verifySchema)", async () => {
    cenario.schemaCompleto = false;

    const saida = await prepararSchemaOuCair().catch(e => e as SaidaDoProcesso);

    expect(saida).toBeInstanceOf(SaidaDoProcesso);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect((fatal.mock.calls[0][0] as { err: Error }).err.message).toContain("missing critical columns");
  });
});

describe("o boot usa o caminho fatal", () => {
  /**
   * Confere o FONTE de server/index.ts, e nao o comportamento: importar index.ts
   * sobe o servidor inteiro (Vite, rotas, WebSocket, pool). O que precisa ficar
   * preso e a fiacao — se alguem recolocar o try/catch que engolia a falha, a
   * funcao acima continua correta e inutil.
   */
  it("server/index.ts chama prepararSchemaOuCair e nao engole mais a falha", async () => {
    const fsReal = await vi.importActual<typeof import("fs")>("fs");
    const pathReal = await vi.importActual<typeof import("path")>("path");
    const fonte = fsReal.readFileSync(pathReal.resolve(process.cwd(), "server/index.ts"), "utf-8");

    expect(fonte).toContain("prepararSchemaOuCair()");
    expect(fonte).not.toContain("continuing with existing schema");
    expect(fonte).not.toMatch(/await\s+runMigrations\(\)/);
  });
});
