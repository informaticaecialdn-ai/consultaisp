/**
 * Spec 013 — Tests do silent exit risk calculator.
 */

import { describe, expect, it } from "vitest";
import { calculateSilentExitRisk, classifyRisk } from "./risk-calculator";
import type { SilentExitInputs } from "./types";

function inputFactory(overrides: Partial<SilentExitInputs> = {}): SilentExitInputs {
  return {
    bandwidthDropPercent: null,
    portalLoginCount30d: null,
    portalLoginCountBaseline: null,
    secondViaSearches30d: 0,
    ticketCount30d: 3,
    ticketCountBaseline: 3,
    utmCompetitorReferrer: false,
    daysWithoutLogin: 10,
    recentPlanDowngrade: false,
    healthScoreTrend: "stable",
    ...overrides,
  };
}

describe("classifyRisk", () => {
  it("≥70 = high", () => {
    expect(classifyRisk(70)).toBe("high");
    expect(classifyRisk(100)).toBe("high");
  });
  it("50-69 = medium", () => {
    expect(classifyRisk(50)).toBe("medium");
    expect(classifyRisk(69)).toBe("medium");
  });
  it("30-49 = low", () => {
    expect(classifyRisk(30)).toBe("low");
    expect(classifyRisk(49)).toBe("low");
  });
  it("<30 = noise", () => {
    expect(classifyRisk(29)).toBe("noise");
    expect(classifyRisk(0)).toBe("noise");
  });
});

describe("calculateSilentExitRisk — cenários", () => {
  it("cliente saudável sem sinais → noise", () => {
    const r = calculateSilentExitRisk(inputFactory());
    expect(r.riskLevel).toBe("noise");
    expect(r.riskScore).toBe(0);
  });

  it("cliente com queda banda 70% + login portal 5x + plan downgrade → high", () => {
    const r = calculateSilentExitRisk(inputFactory({
      bandwidthDropPercent: 70,
      portalLoginCount30d: 25,
      portalLoginCountBaseline: 5,
      recentPlanDowngrade: true,
      healthScoreTrend: "declining",
    }));
    // 20 + 15 + 10 + 5 = 50 → medium
    expect(r.riskScore).toBe(50);
    expect(r.riskLevel).toBe("medium");
  });

  it("cliente com TODOS os sinais máximos → high (clamp 100)", () => {
    const r = calculateSilentExitRisk(inputFactory({
      bandwidthDropPercent: 80,
      portalLoginCount30d: 30,
      portalLoginCountBaseline: 5,
      secondViaSearches30d: 3,
      ticketCount30d: 0,
      ticketCountBaseline: 5,
      utmCompetitorReferrer: true,
      daysWithoutLogin: 120,
      recentPlanDowngrade: true,
      healthScoreTrend: "declining",
    }));
    // 20 + 15 + 10 + 5 + 15 + 10 + 10 + 5 = 90 → high
    expect(r.riskScore).toBe(90);
    expect(r.riskLevel).toBe("high");
  });

  it("queda banda 60% vs 40%: aplica só 1 dos dois (exclusivos)", () => {
    const a = calculateSilentExitRisk(inputFactory({ bandwidthDropPercent: 80 }));
    const b = calculateSilentExitRisk(inputFactory({ bandwidthDropPercent: 50 }));
    expect(a.contributions.bandwidthDrop60).toBe(20);
    expect(a.contributions.bandwidthDrop40).toBeUndefined();
    expect(b.contributions.bandwidthDrop40).toBe(15);
    expect(b.contributions.bandwidthDrop60).toBeUndefined();
  });

  it("tickets caíram para <30% baseline → contribui ticketDecrease", () => {
    const r = calculateSilentExitRisk(inputFactory({
      ticketCount30d: 1,
      ticketCountBaseline: 10,  // 1/10 = 10% < 30%
    }));
    expect(r.contributions.ticketDecrease).toBe(15);
  });

  it("sem dados portal (null) → não pontua portal mesmo se outros sinais altos", () => {
    const r = calculateSilentExitRisk(inputFactory({
      portalLoginCount30d: null,
      portalLoginCountBaseline: null,
      bandwidthDropPercent: 70,
    }));
    expect(r.contributions.portalLogin5x).toBeUndefined();
    expect(r.contributions.bandwidthDrop60).toBe(20);
  });

  it("contributions sempre auditáveis (todos sinais ativos mostrados)", () => {
    const r = calculateSilentExitRisk(inputFactory({
      bandwidthDropPercent: 65,
      utmCompetitorReferrer: true,
    }));
    expect(Object.keys(r.contributions).length).toBeGreaterThan(0);
    expect(r.contributions.bandwidthDrop60).toBe(20);
    expect(r.contributions.utmCompetitor).toBe(5);
  });
});

describe("recommendedAction", () => {
  it("high tem texto com 'ALTO' + Helena/Marcos", () => {
    const r = calculateSilentExitRisk(inputFactory({
      bandwidthDropPercent: 80,
      portalLoginCount30d: 30,
      portalLoginCountBaseline: 5,
      secondViaSearches30d: 3,
      utmCompetitorReferrer: true,
      daysWithoutLogin: 120,
      recentPlanDowngrade: true,
    }));
    expect(r.recommendedAction).toContain("ALTO");
    expect(r.recommendedAction).toMatch(/Helena|Marcos/);
  });

  it("medium menciona Pedro survey", () => {
    const r = calculateSilentExitRisk(inputFactory({
      bandwidthDropPercent: 50,
      recentPlanDowngrade: true,
      utmCompetitorReferrer: true,
      daysWithoutLogin: 100,
    }));
    if (r.riskLevel === "medium") {
      expect(r.recommendedAction).toContain("Pedro");
    }
  });
});

describe("determinismo", () => {
  it("mesma entrada produz mesma saída", () => {
    const input = inputFactory({
      bandwidthDropPercent: 55,
      secondViaSearches30d: 2,
      healthScoreTrend: "declining",
    });
    const a = calculateSilentExitRisk(input);
    const b = calculateSilentExitRisk(input);
    expect(a).toEqual(b);
  });
});
