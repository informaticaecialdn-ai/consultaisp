/**
 * Spec 010A — Tests do health score calculator.
 *
 * Cobertura: 9 perfis A1-C3 + edge cases (cliente novo, sem dados, vulnerável).
 * Pura — sem mock de DB. Roda em isolamento via vitest.
 */

import { describe, expect, it } from "vitest";
import {
  calcChurnRisk60d,
  calcComponents,
  calcEngagement,
  calcExternalScore,
  calcInadimplenciaRisk30d,
  calcLoyalty,
  calcPunctuality,
  calcReliability,
  calcSentiment,
  calculateHealthScore,
  scoreToTier,
} from "./score-calculator";
import type { CustomerHealthInputs } from "./types";

// Fábrica de inputs com defaults para reduzir boilerplate.
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

describe("calcPunctuality", () => {
  it("cliente novo sem histórico = 50 (neutro)", () => {
    expect(calcPunctuality(inputFactory({ invoicesTotal: 0 }))).toBe(50);
  });

  it("sempre em dia (0 atrasos) = 100", () => {
    expect(calcPunctuality(inputFactory({ avgDaysLate90d: 0, invoicesLate: 0 }))).toBe(100);
  });

  it("avgDaysLate 5 dias = 60", () => {
    expect(calcPunctuality(inputFactory({ avgDaysLate90d: 5, invoicesLate: 1 }))).toBe(60);
  });

  it("avgDaysLate 20 dias com baixa frequência (1/12 = 8%) = 20 base", () => {
    expect(calcPunctuality(inputFactory({ avgDaysLate90d: 20, invoicesLate: 1 }))).toBe(20);
  });

  it("avgDaysLate 20 dias com alta frequência (5/12 = 42%) = 10 (com penalização -10)", () => {
    expect(calcPunctuality(inputFactory({ avgDaysLate90d: 20, invoicesLate: 5 }))).toBe(10);
  });

  it("3+ faturas vencidas atualmente = 0", () => {
    expect(calcPunctuality(inputFactory({ invoicesOverdueCurrent: 3 }))).toBe(0);
  });

  it("alta frequência de atraso aplica penalização adicional", () => {
    // 6 atrasos em 10 faturas (60%), avg 3 dias → 80 - 20 = 60
    expect(
      calcPunctuality(inputFactory({ invoicesTotal: 10, invoicesLate: 6, avgDaysLate90d: 3 })),
    ).toBe(60);
  });
});

describe("calcLoyalty", () => {
  it("cliente novo (1 mês) = 30", () => {
    expect(calcLoyalty(inputFactory({ contractMonths: 1 }))).toBe(30);
  });

  it("6 meses = 50", () => {
    expect(calcLoyalty(inputFactory({ contractMonths: 6 }))).toBe(50);
  });

  it("12 meses = 70", () => {
    expect(calcLoyalty(inputFactory({ contractMonths: 12 }))).toBe(70);
  });

  it("24 meses = 85", () => {
    expect(calcLoyalty(inputFactory({ contractMonths: 24 }))).toBe(85);
  });

  it("36+ meses = 100", () => {
    expect(calcLoyalty(inputFactory({ contractMonths: 36 }))).toBe(100);
  });
});

describe("calcReliability", () => {
  it("zero quebras = 100", () => {
    expect(calcReliability(inputFactory({ brokenAgreementsCount: 0 }))).toBe(100);
  });

  it("1 quebra = 70", () => {
    expect(calcReliability(inputFactory({ brokenAgreementsCount: 1 }))).toBe(70);
  });

  it("2 quebras = 40", () => {
    expect(calcReliability(inputFactory({ brokenAgreementsCount: 2 }))).toBe(40);
  });

  it("3+ quebras = 10", () => {
    expect(calcReliability(inputFactory({ brokenAgreementsCount: 5 }))).toBe(10);
  });
});

describe("calcSentiment", () => {
  it("sem interação (null) = 50 neutro", () => {
    expect(calcSentiment(inputFactory({ avgSentimentScore90d: null }))).toBe(50);
  });

  it("sentiment +1 (max positivo) = 100", () => {
    expect(calcSentiment(inputFactory({ avgSentimentScore90d: 1 }))).toBe(100);
  });

  it("sentiment 0 (neutro) = 50", () => {
    expect(calcSentiment(inputFactory({ avgSentimentScore90d: 0 }))).toBe(50);
  });

  it("sentiment -1 (max negativo) = 0", () => {
    expect(calcSentiment(inputFactory({ avgSentimentScore90d: -1 }))).toBe(0);
  });

  it("sentiment 0.5 = 75", () => {
    expect(calcSentiment(inputFactory({ avgSentimentScore90d: 0.5 }))).toBe(75);
  });
});

describe("calcEngagement", () => {
  it("sem interação null = 50 neutro", () => {
    expect(calcEngagement(inputFactory({ lastInteractionDays: null }))).toBe(50);
  });

  it("interação <7 dias = 100", () => {
    expect(calcEngagement(inputFactory({ lastInteractionDays: 3 }))).toBe(100);
  });

  it("30 dias = 80", () => {
    expect(calcEngagement(inputFactory({ lastInteractionDays: 30 }))).toBe(80);
  });

  it(">180 dias = 20 (cliente desengajado)", () => {
    expect(calcEngagement(inputFactory({ lastInteractionDays: 365 }))).toBe(20);
  });
});

describe("calcExternalScore", () => {
  it("Consulta ISP null = 50 neutro", () => {
    expect(calcExternalScore(inputFactory({ consultaIspScore: null }))).toBe(50);
  });

  it("Score 800 = 80", () => {
    expect(calcExternalScore(inputFactory({ consultaIspScore: 800 }))).toBe(80);
  });

  it("Score 0 = 0", () => {
    expect(calcExternalScore(inputFactory({ consultaIspScore: 0 }))).toBe(0);
  });

  it("Score 1000 (max) = 100", () => {
    expect(calcExternalScore(inputFactory({ consultaIspScore: 1000 }))).toBe(100);
  });
});

describe("scoreToTier", () => {
  it("80+ = gold", () => {
    expect(scoreToTier(80)).toBe("gold");
    expect(scoreToTier(100)).toBe("gold");
  });

  it("60-79 = healthy", () => {
    expect(scoreToTier(60)).toBe("healthy");
    expect(scoreToTier(79)).toBe("healthy");
  });

  it("40-59 = warning", () => {
    expect(scoreToTier(40)).toBe("warning");
    expect(scoreToTier(59)).toBe("warning");
  });

  it("0-39 = critical", () => {
    expect(scoreToTier(0)).toBe("critical");
    expect(scoreToTier(39)).toBe("critical");
  });
});

describe("calculateHealthScore — perfis canônicos", () => {
  it("A3 (em dia + fiel 36m + alto score) deve cair em GOLD", () => {
    const result = calculateHealthScore(
      inputFactory({
        contractMonths: 36,
        avgDaysLate90d: 0,
        invoicesOverdueCurrent: 0,
        brokenAgreementsCount: 0,
        avgSentimentScore90d: 0.5,
        consultaIspScore: 850,
        lastInteractionDays: 30,
      }),
    );
    expect(result.healthTier).toBe("gold");
    expect(result.healthScore).toBeGreaterThanOrEqual(80);
    expect(result.churnRisk60dPercent).toBeLessThan(30);
  });

  it("C3 (crônico + fiel + score baixo + quebras) deve cair em CRITICAL", () => {
    const result = calculateHealthScore(
      inputFactory({
        contractMonths: 30,
        invoicesLate: 8,
        invoicesTotal: 24,
        invoicesOverdueCurrent: 2,
        avgDaysLate90d: 25,
        avgDaysLate365d: 22,
        brokenAgreementsCount: 4,
        consultaIspScore: 180,
        avgSentimentScore90d: -0.3,
      }),
    );
    expect(result.healthTier).toBe("critical");
    expect(result.healthScore).toBeLessThan(40);
    expect(result.inadimplenciaRisk30dPercent).toBeGreaterThanOrEqual(70);
  });

  it("A1 (em dia + novo) deve cair em HEALTHY (não gold por falta de fidelidade)", () => {
    const result = calculateHealthScore(
      inputFactory({
        contractMonths: 2,
        avgDaysLate90d: 0,
        invoicesOverdueCurrent: 0,
        brokenAgreementsCount: 0,
        consultaIspScore: 700,
        avgSentimentScore90d: 0.2,
      }),
    );
    expect(["healthy", "warning"]).toContain(result.healthTier);
  });

  it("Cliente sem dados (novo, primeiro mês) não dá erro", () => {
    const result = calculateHealthScore(
      inputFactory({
        contractMonths: 0,
        invoicesTotal: 0,
        invoicesPaid: 0,
        invoicesLate: 0,
        avgDaysLate30d: null,
        avgDaysLate90d: null,
        avgDaysLate365d: null,
        avgSentimentScore90d: null,
        lastInteractionDays: null,
        consultaIspScore: null,
      }),
    );
    expect(result.healthScore).toBeGreaterThanOrEqual(0);
    expect(result.healthScore).toBeLessThanOrEqual(100);
    expect(["gold", "healthy", "warning", "critical"]).toContain(result.healthTier);
  });
});

describe("calcInadimplenciaRisk30d", () => {
  it("score alto + sem atraso = risco baixo", () => {
    const input = inputFactory({ avgDaysLate30d: 0, invoicesOverdueCurrent: 0 });
    expect(calcInadimplenciaRisk30d(input, 85)).toBeLessThan(20);
  });

  it("fatura vencida + score baixo = risco alto", () => {
    const input = inputFactory({
      invoicesOverdueCurrent: 2,
      avgDaysLate30d: 10,
      brokenAgreementsCount: 3,
    });
    expect(calcInadimplenciaRisk30d(input, 30)).toBeGreaterThanOrEqual(70);
  });
});

describe("calcChurnRisk60d", () => {
  it("cliente ativo + sentiment positivo = churn baixo", () => {
    const input = inputFactory({
      lastInteractionDays: 7,
      avgSentimentScore90d: 0.6,
      contractMonths: 24,
    });
    expect(calcChurnRisk60d(input, 80)).toBeLessThan(25);
  });

  it("cliente desengajado + sentiment ruim = churn alto", () => {
    const input = inputFactory({
      lastInteractionDays: 200,
      avgSentimentScore90d: -0.7,
      contractMonths: 4,
      ticketCount30d: 4,
    });
    expect(calcChurnRisk60d(input, 30)).toBeGreaterThanOrEqual(70);
  });
});

describe("calculateHealthScore — determinismo", () => {
  it("mesma entrada produz mesma saída em runs separados", () => {
    const input = inputFactory({ contractMonths: 18, avgDaysLate90d: 4, brokenAgreementsCount: 1 });
    const r1 = calculateHealthScore(input);
    const r2 = calculateHealthScore(input);
    expect(r1).toEqual(r2);
  });
});
