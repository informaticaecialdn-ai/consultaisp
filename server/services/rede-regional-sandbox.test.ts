import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * A camada Rede do mapa (`bairrosDaRede`) lê ex-clientes com dívida de TODOS os
 * provedores. Na demonstração, o do sandbox de OUTRO visitante não pode entrar.
 * Hoje ela só está vazia porque todo cancelado da demo nasce sem dívida, e isso
 * vai mudar (varredura de 12/09/2026). O teste prende o WHERE que sai.
 */
const capturado = vi.hoisted(() => ({ where: null as unknown }));

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (pred: unknown) => { capturado.where = pred; return Promise.resolve([]); },
      }),
    }),
  },
  pool: {},
}));

vi.mock("./geo-bases.service", async (original) => ({
  ...(await original() as object),
  carregarCentroidesDeBairro: vi.fn(async () => new Map()),
}));

import { bairrosDaRede } from "./rede-regional.service";
import { PADRAO_DE_SANDBOX_NO_SQL } from "../utils/fora-de-sandbox";

const render = () => new PgDialect().sqlToQuery(capturado.where as any);

describe("bairrosDaRede — o sandbox de outro visitante não é rede", () => {
  it("o WHERE tira todo sandbox menos o do observador", async () => {
    await bairrosDaRede(["Londrina - PR"], 42);
    const q = render();
    expect(q.sql.toLowerCase()).toContain("not in (select");
    expect(q.params).toContain(PADRAO_DE_SANDBOX_NO_SQL);
    expect(q.params).toContain(42);
  });

  it("o observador só aparece dentro da subconsulta: a rede não vira a carteira própria", async () => {
    await bairrosDaRede(["Londrina - PR"], 42);
    const q = render();
    expect(q.sql.toLowerCase()).not.toMatch(/"customers"\."provider_id" = \$/);
    expect(q.params.filter(p => p === 42)).toHaveLength(1);
  });
});
