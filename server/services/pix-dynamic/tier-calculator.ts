/**
 * Spec 009 — Tier calculator (pura).
 *
 * Dado um OfferConfig + momento atual, resolve:
 *   - Quais tiers existem (cada um com validFrom/validUntil/amountCents calculados)
 *   - Qual tier está ativo AGORA
 *   - Qual será o próximo tier e quando ativa
 *   - Se a oferta já expirou completamente
 *
 * Função pura: determinística, sem side effects, testável em isolamento.
 */

import type {
  OfferConfig,
  OfferState,
  ResolvedTier,
  TierDefinition,
} from "./types";

/**
 * Calcula valor após aplicar desconto. Centavos, arredondado.
 */
export function applyDiscount(baseAmountCents: number, discountPercent: number): number {
  const factor = 1 - discountPercent / 100;
  return Math.round(baseAmountCents * factor);
}

/**
 * Resolve cada tier estático para um ResolvedTier com timestamps + valores.
 * Útil para preview e cálculos posteriores.
 */
export function resolveTiers(config: OfferConfig): ResolvedTier[] {
  if (config.tiers.length === 0) return [];
  if (config.baseAmountCents <= 0) {
    throw new Error("baseAmountCents must be > 0");
  }

  // Validar tiers em ordem index 0, 1, 2... (sem gaps)
  const sorted = [...config.tiers].sort((a, b) => a.index - b.index);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].index !== i) {
      throw new Error(`tier indexes must be sequential starting at 0; got ${sorted.map(t => t.index).join(",")}`);
    }
  }

  const resolved: ResolvedTier[] = [];
  let cursor = new Date(config.createdAt);

  for (const tier of sorted) {
    if (tier.validForHours <= 0) {
      throw new Error(`tier ${tier.index}: validForHours must be > 0`);
    }
    if (tier.discountPercent < 0 || tier.discountPercent > 100) {
      throw new Error(`tier ${tier.index}: discountPercent must be in [0, 100]`);
    }

    const validFrom = new Date(cursor);
    const validUntil = new Date(cursor.getTime() + tier.validForHours * 3600 * 1000);

    resolved.push({
      index: tier.index,
      discountPercent: tier.discountPercent,
      amountCents: applyDiscount(config.baseAmountCents, tier.discountPercent),
      label: tier.label,
      validFrom,
      validUntil,
    });

    cursor = new Date(validUntil.getTime() + 1); // próximo tier inicia 1ms após
  }

  return resolved;
}

/**
 * Dado config + momento atual, retorna estado da oferta.
 */
export function computeOfferState(config: OfferConfig, now: Date): OfferState {
  const resolved = resolveTiers(config);
  const finalExpiresAt = resolved.length > 0
    ? resolved[resolved.length - 1].validUntil
    : new Date(config.createdAt);

  if (now >= finalExpiresAt) {
    return {
      currentTier: null,
      nextTier: null,
      nextTransitionAt: null,
      finalExpiresAt,
      isExpired: true,
    };
  }

  // Encontrar tier atual
  let currentTier: ResolvedTier | null = null;
  let nextTier: ResolvedTier | null = null;

  for (let i = 0; i < resolved.length; i++) {
    const t = resolved[i];
    if (now >= t.validFrom && now < t.validUntil) {
      currentTier = t;
      nextTier = resolved[i + 1] ?? null;
      break;
    }
  }

  // Edge case: now < createdAt (oferta no futuro). Não esperado em prod, mas tratamos.
  if (!currentTier && now < resolved[0].validFrom) {
    nextTier = resolved[0];
  }

  return {
    currentTier,
    nextTier,
    nextTransitionAt: currentTier && nextTier ? new Date(currentTier.validUntil.getTime() + 1) : null,
    finalExpiresAt,
    isExpired: false,
  };
}

/**
 * Lookup direto: dado um momento, retorna o tier ativo. null se já expirou.
 */
export function getActiveTier(config: OfferConfig, now: Date): ResolvedTier | null {
  return computeOfferState(config, now).currentTier;
}

/**
 * Helper: gera texto humano com todos os tiers para enviar ao cliente.
 *
 * Exemplo de saída (3 tiers default):
 *   "Pague nas primeiras 2 horas: R$ 89,90 (10% off)
 *    Próximas 4 horas: R$ 94,90 (5% off)
 *    Restante do dia (valor cheio): R$ 99,90"
 */
export function formatTiersForCustomer(config: OfferConfig): string[] {
  return resolveTiers(config).map((t) => {
    const amountBrl = (t.amountCents / 100).toFixed(2).replace(".", ",");
    const discountPart = t.discountPercent > 0 ? ` (${t.discountPercent}% off)` : "";
    return `${t.label}: R$ ${amountBrl}${discountPart}`;
  });
}

/**
 * Helper: convert TierDefinition[] para ReadonlyArray<TierDefinition> (validação).
 * Útil para receber config customizada do tenant.
 */
export function validateAndSortTiers(tiers: TierDefinition[]): ReadonlyArray<TierDefinition> {
  if (tiers.length === 0) {
    throw new Error("must have at least 1 tier");
  }
  return [...tiers].sort((a, b) => a.index - b.index);
}
