import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Leituras de clientes que cruzam provedores e, na demonstração, pegavam
 * também o sandbox de OUTRO visitante: o mapa de calor regional e o alerta de
 * endereço que roda dentro de toda Consulta ISP (varredura de 12/09/2026), e o
 * dono do CPF que o alerta de fuga procura na base sincronizada (auditoria de
 * 13/09/2026, L1). As duas primeiras filtram sempre; a do dono, só na
 * demonstração — fora dela a query é a de antes, byte a byte. O Postgres não
 * entra: o que se prende é o WHERE que sai.
 */
const capturado = vi.hoisted(() => ({ where: [] as unknown[], demo: false }));

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
vi.mock("../demo/modo-demo", () => ({ emModoDemo: () => capturado.demo }));

import { CustomersStorage } from "./customers.storage";
import { PADRAO_DE_SANDBOX_NO_SQL } from "../utils/fora-de-sandbox";

const render = (q: unknown) => new PgDialect().sqlToQuery(q as any);

beforeEach(() => { capturado.where = []; capturado.demo = false; });

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

describe("getCustomerByCpfCnpj — o dono do CPF para o alerta de fuga", () => {
  it("na demonstração, com o observador: o cliente do sandbox de outro visitante não vira dono", async () => {
    capturado.demo = true;
    await new CustomersStorage().getCustomerByCpfCnpj("999.504.000-07", 56);
    const q = render(capturado.where[0]);
    expect(q.sql.toLowerCase()).toContain("not in (select");
    expect(q.sql.toLowerCase()).toContain("<>");
    expect(q.params).toContain(PADRAO_DE_SANDBOX_NO_SQL);
    expect(q.params).toContain(56);
    expect(q.params).toContain("99950400007");
  });

  it("fora da demonstração: a mesma query de antes, byte a byte, com ou sem observador", async () => {
    await new CustomersStorage().getCustomerByCpfCnpj("999.504.000-07", 56);
    await new CustomersStorage().getCustomerByCpfCnpj("999.504.000-07");
    const [comObservador, semObservador] = capturado.where.map(render);
    expect(comObservador.sql).toBe(`("customers"."cpf_cnpj" = $1 or regexp_replace("customers"."cpf_cnpj", '[^0-9]', '', 'g') = $2)`);
    expect(semObservador.sql).toBe(comObservador.sql);
    expect(comObservador.params).toEqual(["99950400007", "99950400007"]);
  });

  it("documento vazio nem chega ao banco", async () => {
    capturado.demo = true;
    expect(await new CustomersStorage().getCustomerByCpfCnpj("", 56)).toEqual([]);
    expect(capturado.where).toHaveLength(0);
  });
});
