import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * As consultas recentes de um documento alimentam o score ao vivo (consultas em
 * 30 e 90 dias por provedores distintos), o chip de migrador, o alerta de
 * consultas repetidas e a "Rede colaborativa" do 360. Na demonstração, cada
 * sandbox nasce com consultas de custo 1 sobre CPFs da rede: sem o filtro, o
 * score ao vivo de um CPF compartilhado passava a depender de quantos OUTROS
 * visitantes existiam (revisão da fase B, 13/09/2026: dois sandboxes no mesmo
 * CPF acendiam "3+ consultas de ISPs diferentes"). Fora da demonstração a query
 * é a de sempre. O Postgres não entra: o que se prende é o WHERE que sai.
 *
 * A contagem de alertas do benchmark regional segue a mesma regra (auditoria de
 * isolamento de 13/09/2026, L2): o alerta nasce da consulta de alguém, e o que
 * a consulta de OUTRO visitante criou — no mundo base ou no próprio sandbox —
 * não entra no número de quem observa.
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

import { ConsultationsStorage } from "./consultations.storage";
import { PADRAO_DE_SANDBOX_NO_SQL } from "../utils/fora-de-sandbox";

const render = (q: unknown) => new PgDialect().sqlToQuery(q as any);

beforeEach(() => { capturado.where = []; });

describe("getRecentConsultationsForDocument — quem mais consultou o documento", () => {
  it("na demonstração, com o observador: tira as consultas de todo sandbox menos o dele", async () => {
    capturado.demo = true;
    await new ConsultationsStorage().getRecentConsultationsForDocument("99950005639", 30, 56);
    const q = render(capturado.where[0]);
    expect(q.sql.toLowerCase()).toContain("not in (select");
    expect(q.sql.toLowerCase()).toContain("<>");
    expect(q.params).toContain(PADRAO_DE_SANDBOX_NO_SQL);
    expect(q.params).toContain(56);
    expect(q.params).toContain("99950005639");
  });

  it("fora da demonstração: a mesma query de antes, byte a byte, com ou sem observador", async () => {
    capturado.demo = false;
    await new ConsultationsStorage().getRecentConsultationsForDocument("99950005639", 30, 56);
    await new ConsultationsStorage().getRecentConsultationsForDocument("99950005639", 30);
    const [comObservador, semObservador] = capturado.where.map(render);
    expect(comObservador.sql).toBe('("isp_consultations"."cpf_cnpj" = $1 and "isp_consultations"."created_at" >= $2)');
    expect(semObservador.sql).toBe(comObservador.sql);
    expect(comObservador.params[0]).toBe("99950005639");
    expect(comObservador.params).toHaveLength(2);
  });
});

describe("getRegionalAlertCount — os alertas do benchmark regional", () => {
  it("na demonstração, com o observador: o alerta criado pela consulta de outro visitante não conta", async () => {
    capturado.demo = true;
    await new ConsultationsStorage().getRegionalAlertCount([56, 1, 2], 30, 56);
    const q = render(capturado.where[0]);
    const texto = q.sql.toLowerCase();
    expect(texto).toContain("not in (select");
    expect(texto).toContain("<>");
    expect(q.params).toContain(PADRAO_DE_SANDBOX_NO_SQL);
    expect(q.params).toContain(56);
  });

  it("na demonstração, o alerta sem consulente (não nasceu de consulta) continua contando", async () => {
    capturado.demo = true;
    await new ConsultationsStorage().getRegionalAlertCount([56], 30, 56);
    // `NOT IN` com NULL dá NULL e descartaria a linha em silêncio.
    expect(render(capturado.where[0]).sql.toLowerCase()).toContain('"anti_fraud_alerts"."consulting_provider_id" is null or');
  });

  it("fora da demonstração: a mesma query de antes, byte a byte, com ou sem observador", async () => {
    capturado.demo = false;
    await new ConsultationsStorage().getRegionalAlertCount([56, 1], 30, 56);
    await new ConsultationsStorage().getRegionalAlertCount([56, 1], 30);
    const [comObservador, semObservador] = capturado.where.map(render);
    expect(comObservador.sql).toBe('("anti_fraud_alerts"."provider_id" in ($1, $2) and "anti_fraud_alerts"."created_at" >= $3)');
    expect(semObservador.sql).toBe(comObservador.sql);
    expect(comObservador.params).toHaveLength(3);
  });
});
