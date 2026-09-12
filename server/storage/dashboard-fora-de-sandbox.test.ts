import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * `partnerCount` do /api/dashboard/stats contava todo provedor ativo menos o
 * próprio — na demonstração, cada sandbox de outro visitante virava "parceiro"
 * (varredura de 12/09/2026). O card do painel usa outro número, mas o campo sai
 * no JSON de qualquer jeito.
 */
const chamadas = vi.hoisted(() => [] as Array<{ tabela: unknown; where: unknown }>);

vi.mock("../db", () => {
  const cadeia = (tabela: unknown) => {
    const c: any = {
      innerJoin: () => c,
      where: (pred: unknown) => {
        chamadas.push({ tabela, where: pred });
        return Promise.resolve([{ count: 0, total: "0" }]);
      },
    };
    return c;
  };
  return { db: { select: () => ({ from: (t: unknown) => cadeia(t) }) }, pool: {} };
});

import { providers } from "@shared/schema";
import { DashboardStorage } from "./dashboard.storage";
import { PADRAO_DE_SANDBOX_NO_SQL } from "../utils/fora-de-sandbox";

describe("getDashboardStats — partnerCount", () => {
  it("sandbox de demonstração não é parceiro de ninguém", async () => {
    await new DashboardStorage().getDashboardStats(42);
    const lidasEmProvedores = chamadas
      .filter(c => c.tabela === providers)
      .map(c => new PgDialect().sqlToQuery(c.where as any));
    // A contagem de parceiros é a leitura de providers que exclui o próprio id.
    const parceiros = lidasEmProvedores.find(q => q.sql.includes("!="));
    expect(parceiros, "a contagem de parceiros não foi encontrada").toBeTruthy();
    expect(parceiros!.sql.toLowerCase()).toContain("not like");
    expect(parceiros!.params).toContain(PADRAO_DE_SANDBOX_NO_SQL);
  });
});
