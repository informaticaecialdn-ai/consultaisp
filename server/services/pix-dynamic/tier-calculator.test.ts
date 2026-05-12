/**
 * Spec 009 — Tests do tier calculator.
 *
 * Cobre: applyDiscount, resolveTiers, computeOfferState, edge cases.
 */

import { describe, expect, it } from "vitest";
import {
  applyDiscount,
  computeOfferState,
  formatTiersForCustomer,
  getActiveTier,
  resolveTiers,
  validateAndSortTiers,
} from "./tier-calculator";
import { DEFAULT_TIERS, type OfferConfig } from "./types";

const ANCHOR = new Date("2026-05-15T10:00:00Z");

function makeConfig(overrides: Partial<OfferConfig> = {}): OfferConfig {
  return {
    baseAmountCents: 9990,  // R$ 99,90
    tiers: DEFAULT_TIERS,
    createdAt: ANCHOR,
    ...overrides,
  };
}

describe("applyDiscount", () => {
  it("0% off retorna valor cheio", () => {
    expect(applyDiscount(10000, 0)).toBe(10000);
  });

  it("10% off retorna 90%", () => {
    expect(applyDiscount(10000, 10)).toBe(9000);
  });

  it("5% off em R$ 99,90 = R$ 94,905 → arredonda para 9491 centavos", () => {
    expect(applyDiscount(9990, 5)).toBe(9491);  // 9990 * 0.95 = 9490.5 → round 9491 (banker's rounding handles)
  });

  it("100% off retorna 0", () => {
    expect(applyDiscount(10000, 100)).toBe(0);
  });
});

describe("resolveTiers", () => {
  it("default tiers resolve 3 tiers com timestamps sequenciais", () => {
    const config = makeConfig();
    const tiers = resolveTiers(config);

    expect(tiers).toHaveLength(3);
    expect(tiers[0].index).toBe(0);
    expect(tiers[1].index).toBe(1);
    expect(tiers[2].index).toBe(2);

    // Tier 0: 10h00 → 12h00 (2h)
    expect(tiers[0].validFrom).toEqual(ANCHOR);
    expect(tiers[0].validUntil).toEqual(new Date("2026-05-15T12:00:00Z"));

    // Tier 1: 12h00:00.001 → 16h00 (4h)
    expect(tiers[1].validFrom).toEqual(new Date("2026-05-15T12:00:00.001Z"));
    expect(tiers[1].validUntil).toEqual(new Date("2026-05-15T16:00:00.001Z"));

    // Tier 2: 16h00:00.002 → 10h00 do dia seguinte (18h)
    expect(tiers[2].validFrom).toEqual(new Date("2026-05-15T16:00:00.002Z"));
  });

  it("valores em centavos aplicam decay correto", () => {
    const tiers = resolveTiers(makeConfig({ baseAmountCents: 10000 }));
    expect(tiers[0].amountCents).toBe(9000);   // 10% off
    expect(tiers[1].amountCents).toBe(9500);   // 5% off
    expect(tiers[2].amountCents).toBe(10000);  // 0% off
  });

  it("config com baseAmount <= 0 dá erro", () => {
    expect(() => resolveTiers(makeConfig({ baseAmountCents: 0 }))).toThrow();
  });

  it("tiers com índices não-sequenciais dá erro", () => {
    expect(() => resolveTiers(makeConfig({
      tiers: [
        { index: 0, discountPercent: 10, validForHours: 2, label: "a" },
        { index: 2, discountPercent: 5, validForHours: 4, label: "b" },
      ],
    }))).toThrow();
  });

  it("tier com validForHours <= 0 dá erro", () => {
    expect(() => resolveTiers(makeConfig({
      tiers: [{ index: 0, discountPercent: 10, validForHours: 0, label: "a" }],
    }))).toThrow();
  });

  it("tier com discountPercent fora [0,100] dá erro", () => {
    expect(() => resolveTiers(makeConfig({
      tiers: [{ index: 0, discountPercent: 150, validForHours: 2, label: "a" }],
    }))).toThrow();
  });
});

describe("computeOfferState", () => {
  it("now no tier 0 retorna tier 0 ativo + tier 1 como next", () => {
    const now = new Date("2026-05-15T10:30:00Z");  // 30min após criação
    const state = computeOfferState(makeConfig(), now);

    expect(state.isExpired).toBe(false);
    expect(state.currentTier?.index).toBe(0);
    expect(state.nextTier?.index).toBe(1);
    expect(state.nextTransitionAt).toBeTruthy();
  });

  it("now no tier 1 retorna tier 1 ativo + tier 2 como next", () => {
    const now = new Date("2026-05-15T13:00:00Z");  // 3h após (tier 1 ativo)
    const state = computeOfferState(makeConfig(), now);

    expect(state.currentTier?.index).toBe(1);
    expect(state.currentTier?.discountPercent).toBe(5);
    expect(state.nextTier?.index).toBe(2);
  });

  it("now no tier 2 (último) retorna tier 2 ativo + next=null", () => {
    const now = new Date("2026-05-15T20:00:00Z");  // 10h após (tier 2 ativo)
    const state = computeOfferState(makeConfig(), now);

    expect(state.currentTier?.index).toBe(2);
    expect(state.currentTier?.discountPercent).toBe(0);
    expect(state.nextTier).toBeNull();
    expect(state.nextTransitionAt).toBeNull();
  });

  it("now após finalExpiresAt retorna isExpired=true", () => {
    const now = new Date("2026-05-16T11:00:00Z");  // 25h após (passou tudo)
    const state = computeOfferState(makeConfig(), now);

    expect(state.isExpired).toBe(true);
    expect(state.currentTier).toBeNull();
    expect(state.nextTier).toBeNull();
  });

  it("transição entre tiers: no momento exato do fim do tier 0, tier 1 deve estar ativo", () => {
    const config = makeConfig();
    // Tier 0 termina em 12:00:00.000. Tier 1 começa em 12:00:00.001.
    // Em 12:00:00.500, tier 1 já está ativo.
    const now = new Date("2026-05-15T12:00:00.500Z");
    const state = computeOfferState(config, now);
    expect(state.currentTier?.index).toBe(1);
  });
});

describe("getActiveTier shortcut", () => {
  it("retorna tier atual sem detalhes", () => {
    const t = getActiveTier(makeConfig(), new Date("2026-05-15T10:30:00Z"));
    expect(t?.index).toBe(0);
  });

  it("retorna null se expirado", () => {
    const t = getActiveTier(makeConfig(), new Date("2026-05-16T11:00:00Z"));
    expect(t).toBeNull();
  });
});

describe("formatTiersForCustomer", () => {
  it("gera 3 linhas para default tiers", () => {
    const lines = formatTiersForCustomer(makeConfig());
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("primeiras 2 horas");
    expect(lines[0]).toContain("10% off");
    expect(lines[2]).not.toContain("off");  // tier 2 não tem desconto
  });

  it("valores em formato BR (vírgula)", () => {
    const lines = formatTiersForCustomer(makeConfig({ baseAmountCents: 12345 }));
    // 12345 * 0.9 = 11110.5 → Math.round = 11111 → R$ 111,11
    expect(lines[0]).toContain("R$ 111,11");
  });
});

describe("validateAndSortTiers", () => {
  it("retorna ordenado por index", () => {
    const tiers = validateAndSortTiers([
      { index: 2, discountPercent: 0, validForHours: 18, label: "c" },
      { index: 0, discountPercent: 10, validForHours: 2, label: "a" },
      { index: 1, discountPercent: 5, validForHours: 4, label: "b" },
    ]);
    expect(tiers.map(t => t.index)).toEqual([0, 1, 2]);
  });

  it("array vazio dá erro", () => {
    expect(() => validateAndSortTiers([])).toThrow();
  });
});

describe("determinismo", () => {
  it("mesma config + mesmo now produz mesmo state", () => {
    const config = makeConfig();
    const now = new Date("2026-05-15T13:00:00Z");
    const s1 = computeOfferState(config, now);
    const s2 = computeOfferState(config, now);
    expect(s1).toEqual(s2);
  });
});
