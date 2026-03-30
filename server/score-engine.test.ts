import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateIspScore, getRiskTier, getDecisionReco } from "./score-engine.js";

describe("calculateIspScore", () => {
  it("returns score >= 100 (capped) for a perfect client", () => {
    const result = calculateIspScore({
      maxDaysOverdue: 0,
      totalOverdueAmount: 0,
      unreturnedEquipmentCount: 0,
      contractAgeDays: 365,
      recentConsultationsCount: 0,
      providersWithDebt: 0,
      clientYears: 3,
      neverLate: true,
      allEquipmentReturned: true,
    });
    assert.ok(result.score >= 100, `Expected score >= 100, got ${result.score}`);
  });

  it("returns score 0 (capped) for a worst-case client", () => {
    const result = calculateIspScore({
      maxDaysOverdue: 120,
      totalOverdueAmount: 500,
      unreturnedEquipmentCount: 2,
      contractAgeDays: 30,
      recentConsultationsCount: 5,
      providersWithDebt: 3,
      clientYears: 0,
      neverLate: false,
      allEquipmentReturned: false,
    });
    assert.equal(result.score, 0, `Expected score 0, got ${result.score}`);
  });
});

describe("getRiskTier", () => {
  it("returns low risk for score 85", () => {
    const result = getRiskTier(85);
    assert.equal(result.tier, "low");
    assert.equal(result.label, "BAIXO RISCO");
  });

  it("returns high risk for score 40", () => {
    const result = getRiskTier(40);
    assert.equal(result.tier, "high");
    assert.equal(result.label, "ALTO RISCO");
  });
});

describe("getDecisionReco", () => {
  it("returns Accept for score >= 80", () => {
    assert.equal(getDecisionReco(85), "Accept");
  });

  it("returns Reject for score < 50", () => {
    assert.equal(getDecisionReco(40), "Reject");
  });

  it("returns Review for score 50-79", () => {
    assert.equal(getDecisionReco(60), "Review");
  });
});
