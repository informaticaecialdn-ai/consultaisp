/**
 * O filtro por faixa de atraso, no SQL.
 *
 * As seis faixas são pedido do dono (06/09/2026). O ponto deste teste é que
 * elas filtram no BANCO, e não na página: o quadro mostra o total exato da
 * coluna no rodapé, e um filtro aplicado só no navegador faria esse total
 * mentir — a coluna diria "23 casos" mostrando 4.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  db: null as any,
}));
vi.mock("../db", () => ({ db: new Proxy({} as any, { get: (_a, k) => banco.db[k] }), pool: {} }));

import { drizzle } from "drizzle-orm/pg-proxy";
import { CobrancaStorage } from "./cobranca.storage";
import { LIMITES_DA_FAIXA_DE_ATRASO, FAIXAS_DE_ATRASO } from "@shared/cobranca/faixa-atraso";

const PROVEDOR = 42;
let storage: CobrancaStorage;

beforeEach(() => {
  banco.consultas.length = 0;
  banco.db = drizzle(async (sql, params) => {
    banco.consultas.push({ sql, params });
    return { rows: [] };
  });
  storage = new CobrancaStorage();
});

/** A consulta que lista as linhas (a primeira que menciona a tabela de casos). */
function consultaDaListagem() {
  const c = banco.consultas.find(x => /from "cobranca_casos"/.test(x.sql));
  expect(c, "nenhuma consulta em cobranca_casos").toBeDefined();
  return c!;
}

describe("faixa de atraso no SQL", () => {
  it.each(FAIXAS_DE_ATRASO)("%s vira comparação sobre max_days_overdue, com o provedor junto", async (faixa) => {
    await storage.listarCasosDeCobranca(PROVEDOR, { faixaAtraso: faixa }, { pagina: 1, porPagina: 10 });
    const c = consultaDaListagem();
    const { min, max } = LIMITES_DA_FAIXA_DE_ATRASO[faixa];

    // A comparação existe e é sobre a coluna do cliente, com coalesce.
    expect(c.sql).toContain('coalesce("customers"."max_days_overdue", 0)');
    expect(c.params).toContain(min);
    if (max === null) {
      // A última faixa não tem teto: uma comparação só.
      expect((c.sql.match(/coalesce\("customers"\."max_days_overdue", 0\)/g) ?? []).length).toBe(1);
    } else {
      expect(c.params).toContain(max);
      expect((c.sql.match(/coalesce\("customers"\."max_days_overdue", 0\)/g) ?? []).length).toBe(2);
    }

    // Multi-tenant: o provedor entra em toda consulta, sempre.
    const ocorrencias = Array.from(c.sql.matchAll(/"provider_id" = \$(\d+)/g));
    expect(ocorrencias.length).toBeGreaterThan(0);
    for (const o of ocorrencias) expect(c.params[Number(o[1]) - 1]).toBe(PROVEDOR);
  });

  it("sem faixa, nenhuma comparação de atraso entra na consulta", async () => {
    await storage.listarCasosDeCobranca(PROVEDOR, {}, { pagina: 1, porPagina: 10 });
    // A coluna aparece no SELECT (o card mostra D+N); o que não pode existir é a
    // COMPARAÇÃO do filtro.
    expect(consultaDaListagem().sql).not.toContain(`coalesce("customers"."max_days_overdue", 0)`);
  });

  it("a faixa convive com os outros filtros do quadro", async () => {
    await storage.listarCasosDeCobranca(
      PROVEDOR,
      { faixaAtraso: "31-60", carteira: "ativo", etapa: "negociacao_recuperacao", meusMaisFilaGeral: 8 },
      { pagina: 1, porPagina: 10 },
    );
    const c = consultaDaListagem();
    expect(c.sql).toContain('coalesce("customers"."max_days_overdue", 0)');
    expect(c.params).toEqual(expect.arrayContaining([31, 60, "ativo", "negociacao_recuperacao", 8]));
  });
});
