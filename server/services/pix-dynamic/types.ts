/**
 * Spec 009 — Pix Dinâmico com Decay Temporal.
 *
 * Tipos puros para a lógica de tiers temporais.
 * Sem dependência de DB/Asaas. Testável em isolamento.
 *
 * Conceito:
 *   - Cliente recebe oferta em camadas (tiers) com validade temporal e desconto decay
 *   - Tier 0: criado agora, valor com 10% off, válido por 2h
 *   - Tier 1: ativado após 2h, valor com 5% off, válido por mais 4h
 *   - Tier 2: ativado após 6h, valor cheio + multa, sem expiração até dueDate
 *
 * Workaround Asaas (validado 2026-05-12): cada tier = charge separada via
 * POST /v3/payments + worker temporal cancela charge anterior na transição.
 */

/**
 * Definição estática de um tier (config do tenant ou default).
 */
export interface TierDefinition {
  /** Ordem (0 = primeiro, mais barato). */
  index: number;
  /** Desconto % sobre o valor base. 0-100. */
  discountPercent: number;
  /** Duração em horas desde a criação da oferta. */
  validForHours: number;
  /** Texto humano usado em mensagens (ex: "primeiras 2 horas"). */
  label: string;
}

/**
 * Default tiers — Spec 009 recomendação MVP.
 * Soma de validForHours = janela total da oferta.
 */
export const DEFAULT_TIERS: ReadonlyArray<TierDefinition> = [
  { index: 0, discountPercent: 10, validForHours: 2, label: "primeiras 2 horas" },
  { index: 1, discountPercent: 5, validForHours: 4, label: "próximas 4 horas" },
  { index: 2, discountPercent: 0, validForHours: 18, label: "restante do dia (valor cheio)" },
];

/**
 * Config completa de uma oferta no momento da criação.
 */
export interface OfferConfig {
  /** Valor total devido (sem desconto), em centavos. */
  baseAmountCents: number;
  /** Tiers ordenados por index (0 = primeiro). */
  tiers: ReadonlyArray<TierDefinition>;
  /** Momento de criação da oferta. */
  createdAt: Date;
}

/**
 * Tier individual com valor calculado.
 */
export interface ResolvedTier {
  index: number;
  discountPercent: number;
  amountCents: number;
  label: string;
  /** Início de validade (relativo a createdAt). */
  validFrom: Date;
  /** Fim de validade. Inclusive — última hora antes da transição. */
  validUntil: Date;
}

/**
 * Estado atual de uma oferta em um momento específico.
 */
export interface OfferState {
  /** Tier ativo agora. null se já expirou. */
  currentTier: ResolvedTier | null;
  /** Próximo tier que será ativado. null se este é o último. */
  nextTier: ResolvedTier | null;
  /** Quando o próximo tier ativa (= currentTier.validUntil + 1ms). null se este é último. */
  nextTransitionAt: Date | null;
  /** Quando a oferta inteira expira (último tier.validUntil). */
  finalExpiresAt: Date;
  /** True se now > finalExpiresAt — fluxo padrão de cobrança assume. */
  isExpired: boolean;
}
