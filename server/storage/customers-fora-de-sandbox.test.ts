import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Duas leituras de clientes que cruzam provedores e, na demonstração, pegavam
 * também o sandbox de OUTRO visitante (varredura de 12/09/2026): o mapa de calor
 * regional e o alerta de endereço que roda dentro de toda Consulta ISP. O
 * Postgres não entra: o que se prende é o WHERE que sai.
 */
const capturado = vi.hoisted(() => ({ where: [] as unknown[] }));

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (pred: unknown) => { capturado.where.push(pred); return Promise.resolve([]); },
      }),
    }),
  },
  pool: {},
}));

import { CustomersStorage } from "./customers.storage";
import { PADRAO_DE_SANDBOX_NO_SQL } from "../utils/fora-de-sandbox";

const render = (q: unknown) => new PgDialect().sqlToQuery(q as any);

beforeEach(() => { capturado.where = []; });

describe("getHeatmapAll — o mapa de calor regional", () => {
  it("com o observador: tira todo sandbox menos o dele", async () => {
    await new CustomersStorage().getHeatmapAll(42);
    const q = render(capturado.where[0]);
    expect(q.sql.toLowerCase()).toContain("not in (select");
    expect(q.sql.toLowerCase()).toContain("<>");
    expect(q.params).toContain(PADRAO_DE_SANDBOX_NO_SQL);
    expect(q.params).toContain(42);
  });

  it("sem observador: tira todos os sandboxes", async () => {
    await new CustomersStorage().getHeatmapAll();
    const q = render(capturado.where[0]);
    expect(q.sql.toLowerCase()).toContain("not in (select");
    expect(q.sql.toLowerCase()).not.toContain("<>");
    expect(q.params).toContain(PADRAO_DE_SANDBOX_NO_SQL);
  });
});

describe("getCustomersByAddressForAlert — o alerta de endereço da Consulta ISP", () => {
  it("com o observador: o inadimplente do sandbox de outro visitante não conta", async () => {
    await new CustomersStorage().getCustomersByAddressForAlert({
      cep: "86025169", address: "Rua Um", addressNumber: "10", city: "Londrina",
      excludeCpfCnpj: "00752477714", observadorId: 42,
    });
    const q = render(capturado.where[0]);
    expect(q.sql.toLowerCase()).toContain("not in (select");
    expect(q.params).toContain(PADRAO_DE_SANDBOX_NO_SQL);
    expect(q.params).toContain(42);
  });

  it("sem número no endereço nem chega ao banco", async () => {
    await new CustomersStorage().getCustomersByAddressForAlert({ excludeCpfCnpj: "00752477714" });
    expect(capturado.where).toHaveLength(0);
  });
});
