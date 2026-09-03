import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * Foco: excluir um usuario tem de derrubar as sessoes dele.
 *
 * A tela do Painel do Provedor promete que "o acesso e perdido na hora" e isso
 * era mentira: `requireAuth` so olha `req.session`, e a linha da sessao vive na
 * tabela do connect-pg-simple, que ninguem tocava. O excluido continuava
 * navegando e consultando ate o cookie vencer, 48h depois.
 *
 * O Postgres nao entra aqui — o que precisa de prova e a FORMA: o DELETE da
 * sessao existe, filtra pelo userId, sai parametrizado e roda na MESMA
 * transacao do DELETE do usuario (senao a FK que barra a exclusao deixaria o
 * usuario no lugar e as sessoes destruidas).
 */
const chamadas = vi.hoisted(() => ({
  transacoes: 0,
  deletes: [] as unknown[],
  execute: [] as unknown[],
  foraDaTransacao: [] as string[],
}));

const dbMock = vi.hoisted(() => {
  const tx = {
    delete: (tabela: unknown) => ({
      where: async (cond: unknown) => { chamadas.deletes.push({ tabela, cond }); },
    }),
    execute: async (q: unknown) => { chamadas.execute.push(q); },
  };
  return {
    db: {
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
        chamadas.transacoes++;
        return fn(tx);
      },
      delete: () => { chamadas.foraDaTransacao.push("delete"); throw new Error("delete fora da transacao"); },
      execute: () => { chamadas.foraDaTransacao.push("execute"); throw new Error("execute fora da transacao"); },
      select: () => { throw new Error("select fora da transacao"); },
    },
    pool: {},
  };
});
vi.mock("../db", () => dbMock);

import { UsersStorage } from "./users.storage";

const dialeto = new PgDialect();
const paraSql = (q: unknown) => dialeto.sqlToQuery(q as SQL);

let storage: UsersStorage;

beforeEach(() => {
  vi.clearAllMocks();
  chamadas.transacoes = 0;
  chamadas.deletes.length = 0;
  chamadas.execute.length = 0;
  chamadas.foraDaTransacao.length = 0;
  storage = new UsersStorage();
});

describe("deleteUser", () => {
  it("apaga o usuario e as sessoes dele na mesma transacao", async () => {
    await storage.deleteUser(9);

    expect(chamadas.transacoes).toBe(1);
    expect(chamadas.deletes).toHaveLength(1);
    expect(chamadas.execute).toHaveLength(1);
    expect(chamadas.foraDaTransacao).toEqual([]);
  });

  it("o DELETE da sessao filtra pelo userId, e o id vai como parametro", async () => {
    await storage.deleteUser(9);

    const comando = paraSql(chamadas.execute[0]);
    expect(comando.sql).toContain('DELETE FROM "session"');
    expect(comando.sql).toContain("userId");
    // Parametrizado: o id nunca entra interpolado no texto do comando.
    expect(comando.params).toEqual(["9"]);
    expect(comando.sql).not.toContain("'9'");
  });

  it("nao apaga sessao de outro usuario", async () => {
    await storage.deleteUser(42);

    expect(paraSql(chamadas.execute[0]).params).toEqual(["42"]);
  });

  /**
   * A violacao de chave estrangeira (23503) sobe intacta: quem decide o que o
   * admin le e a rota, que responde 409 com o motivo. Engolir aqui devolveria
   * "usuario removido com sucesso" para um usuario que continua no banco.
   */
  it("erro do banco sobe para quem chamou, com o codigo preservado", async () => {
    const violacao = Object.assign(new Error("update or delete on table \"users\" violates foreign key"), { code: "23503" });
    chamadas.transacoes = 0;
    dbMock.db.transaction = async () => { throw violacao; };

    await expect(storage.deleteUser(9)).rejects.toMatchObject({ code: "23503" });
  });
});
