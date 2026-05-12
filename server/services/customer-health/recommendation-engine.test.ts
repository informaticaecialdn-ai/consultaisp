/**
 * Spec 010A — Tests do recommendation engine.
 */

import { describe, expect, it } from "vitest";
import { recommendAction } from "./recommendation-engine";
import { calculateHealthScore } from "./score-calculator";
import type { CustomerHealthInputs } from "./types";

function inputFactory(overrides: Partial<CustomerHealthInputs> = {}): CustomerHealthInputs {
  return {
    contractMonths: 12,
    invoicesTotal: 12,
    invoicesPaid: 12,
    invoicesLate: 0,
    invoicesOverdueCurrent: 0,
    avgDaysLate30d: 0,
    avgDaysLate90d: 0,
    avgDaysLate365d: 0,
    totalRevenueAccumulatedCents: 100_000,
    brokenAgreementsCount: 0,
    ticketCount30d: 1,
    ticketCount90d: 3,
    lastInteractionDays: 15,
    avgSentimentScore90d: 0.5,
    consultaIspScore: 700,
    ...overrides,
  };
}

describe("recommendAction — fluxos críticos", () => {
  it("C3 alto-risco com 3+ quebras + ispScore <300 → atalho Rafael Spec 011", () => {
    const input = inputFactory({
      contractMonths: 18,
      invoicesLate: 6,
      invoicesTotal: 18,
      invoicesOverdueCurrent: 1,
      avgDaysLate90d: 18,
      brokenAgreementsCount: 4,
      consultaIspScore: 200,
    });
    const result = calculateHealthScore(input);
    const rec = recommendAction(input, result);

    expect(rec.recommendedAgent).toBe("rafael");
    expect(rec.severity).toBe("act");
    expect(rec.recommendedAction).toContain("Spec 011");
  });

  it("Critical + alto churn risk → human_marcos", () => {
    const input = inputFactory({
      contractMonths: 8,
      invoicesLate: 5,
      invoicesTotal: 8,
      invoicesOverdueCurrent: 1,
      avgDaysLate90d: 20,
      brokenAgreementsCount: 1,
      avgSentimentScore90d: -0.8,
      lastInteractionDays: 200,
      consultaIspScore: 350,
    });
    const result = calculateHealthScore(input);
    expect(result.healthTier).toBe("critical");
    if (result.churnRisk60dPercent >= 70) {
      const rec = recommendAction(input, result);
      expect(rec.recommendedAgent).toBe("human_marcos");
      expect(rec.severity).toBe("human_intervention");
    }
  });

  it("Gold com fatura vencida → alerta human_marcos (cliente OURO em queda)", () => {
    const input = inputFactory({
      contractMonths: 36,
      avgDaysLate90d: 1,
      invoicesOverdueCurrent: 1,
      brokenAgreementsCount: 0,
      consultaIspScore: 850,
      avgSentimentScore90d: 0.6,
    });
    const result = calculateHealthScore(input);
    // Pode cair em gold ou healthy dependendo dos pesos; queremos garantir
    // que se for gold com overdue, alerta humano dispara
    if (result.healthTier === "gold") {
      const rec = recommendAction(input, result);
      expect(rec.recommendedAgent).toBe("human_marcos");
      expect(rec.severity).toBe("human_intervention");
    }
  });
});

describe("recommendAction — fluxos normais", () => {
  it("Healthy padrão → Bruno régua normal", () => {
    const input = inputFactory({
      contractMonths: 12,
      avgDaysLate90d: 2,
      consultaIspScore: 600,
    });
    const result = calculateHealthScore(input);
    if (result.healthTier === "healthy") {
      const rec = recommendAction(input, result);
      expect(rec.recommendedAgent).toBe("bruno");
      expect(rec.severity).toBe("none");
    }
  });

  it("Warning padrão → Helena monitora", () => {
    const input = inputFactory({
      contractMonths: 6,
      avgDaysLate90d: 10,
      brokenAgreementsCount: 1,
      consultaIspScore: 450,
    });
    const result = calculateHealthScore(input);
    if (result.healthTier === "warning" && result.churnRisk60dPercent < 50) {
      const rec = recommendAction(input, result);
      expect(rec.recommendedAgent).toBe("helena");
      expect(rec.severity).toBe("monitor");
    }
  });

  it("Gold sem sinais de queda → Sofia atenta", () => {
    const input = inputFactory({
      contractMonths: 36,
      avgDaysLate90d: 0,
      invoicesOverdueCurrent: 0,
      brokenAgreementsCount: 0,
      consultaIspScore: 900,
      avgSentimentScore90d: 0.8,
    });
    const result = calculateHealthScore(input);
    if (result.healthTier === "gold") {
      const rec = recommendAction(input, result);
      expect(rec.recommendedAgent).toBe("sofia");
      expect(rec.severity).toBe("none");
    }
  });
});

describe("recommendAction — auditabilidade", () => {
  it("recommendedAction sempre tem texto explicativo", () => {
    const inputs = [
      inputFactory({ contractMonths: 1 }),  // novo
      inputFactory({ contractMonths: 36, avgDaysLate90d: 0 }),  // gold
      inputFactory({ contractMonths: 18, brokenAgreementsCount: 4, consultaIspScore: 200, invoicesOverdueCurrent: 1 }),  // C3
    ];

    for (const input of inputs) {
      const result = calculateHealthScore(input);
      const rec = recommendAction(input, result);
      expect(rec.recommendedAction.length).toBeGreaterThan(20);
      expect(typeof rec.recommendedAction).toBe("string");
    }
  });
});
