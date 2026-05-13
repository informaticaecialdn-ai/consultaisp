/**
 * Spec 010A — Calculator do health score.
 *
 * Função pura: dado um CustomerHealthInputs, produz HealthScoreResult.
 * Sem dependência de DB. Determinística (mesma entrada = mesma saída).
 * Testável em isolamento.
 *
 * Os pesos default vêm de DEFAULT_HEALTH_WEIGHTS em types.ts.
 * Tenant pode override (Fase B+), mas MVP usa defaults.
 */

import type {
  CustomerHealthInputs,
  HealthScoreComponents,
  HealthScoreResult,
  HealthTier,
  HealthWeights,
} from "./types";
import { DEFAULT_HEALTH_WEIGHTS } from "./types";

/* ─────────────────── Sub-cálculos por componente ─────────────────── */

/**
 * Pontualidade 0-100 baseado em avgDaysLate90d + frequência de atraso.
 * Cliente sem histórico (invoicesTotal=0) recebe 50 (neutro).
 */
export function calcPunctuality(input: CustomerHealthInputs): number {
  if (input.invoicesTotal === 0) return 50;

  // Se há fatura vencida agora, penaliza forte
  if (input.invoicesOverdueCurrent >= 3) return 0;
  if (input.invoicesOverdueCurrent >= 1) return Math.min(30, baselinePunctuality(input));

  return baselinePunctuality(input);
}

function baselinePunctuality(input: CustomerHealthInputs): number {
  const avgDays = input.avgDaysLate90d ?? input.avgDaysLate365d ?? 0;
  const lateRate = input.invoicesTotal > 0 ? input.invoicesLate / input.invoicesTotal : 0;

  // Score base por avgDays
  let score: number;
  if (avgDays <= 1) score = 100;
  else if (avgDays <= 3) score = 80;
  else if (avgDays <= 7) score = 60;
  else if (avgDays <= 15) score = 40;
  else if (avgDays <= 30) score = 20;
  else score = 0;

  // Penalização adicional por frequência (cliente que atrasa pouco mas SEMPRE)
  if (lateRate > 0.5) score = Math.max(0, score - 20);
  else if (lateRate > 0.3) score = Math.max(0, score - 10);

  return score;
}

/**
 * Fidelidade 0-100 baseado em tempo de contrato.
 */
export function calcLoyalty(input: CustomerHealthInputs): number {
  const months = input.contractMonths;
  if (months <= 3) return 30;
  if (months <= 6) return 50;
  if (months <= 12) return 70;
  if (months <= 24) return 85;
  return 100;
}

/**
 * Confiabilidade 0-100 inverso de quebras de acordo.
 */
export function calcReliability(input: CustomerHealthInputs): number {
  const broken = input.brokenAgreementsCount;
  if (broken === 0) return 100;
  if (broken === 1) return 70;
  if (broken === 2) return 40;
  return 10;
}

/**
 * Sentiment 0-100 baseado em avg sentiment score (-1 a +1).
 * Mapeia linearmente: -1 → 0, 0 → 50, +1 → 100.
 * null (sem interação) → 50 (neutro).
 */
export function calcSentiment(input: CustomerHealthInputs): number {
  if (input.avgSentimentScore90d === null) return 50;
  const s = clamp(input.avgSentimentScore90d, -1, 1);
  return Math.round(((s + 1) / 2) * 100);
}

/**
 * Engajamento 0-100 inverso de tempo desde última interação.
 */
export function calcEngagement(input: CustomerHealthInputs): number {
  if (input.lastInteractionDays === null) return 50;
  const d = input.lastInteractionDays;
  if (d <= 7) return 100;
  if (d <= 30) return 80;
  if (d <= 90) return 60;
  if (d <= 180) return 40;
  return 20;
}

/**
 * Score externo 0-100 do Consulta ISP (que é 0-1000).
 * null (sem consulta) → 50 (neutro).
 */
export function calcExternalScore(input: CustomerHealthInputs): number {
  if (input.consultaIspScore === null) return 50;
  return Math.round(clamp(input.consultaIspScore, 0, 1000) / 10);
}

/* ─────────────────── Cálculos consolidados ─────────────────── */

export function calcComponents(input: CustomerHealthInputs): HealthScoreComponents {
  return {
    punctuality: calcPunctuality(input),
    loyalty: calcLoyalty(input),
    reliability: calcReliability(input),
    sentiment: calcSentiment(input),
    engagement: calcEngagement(input),
    externalScore: calcExternalScore(input),
  };
}

/**
 * Aplica pesos e retorna score consolidado 0-100.
 */
export function applyWeights(
  components: HealthScoreComponents,
  weights: HealthWeights = DEFAULT_HEALTH_WEIGHTS,
): number {
  const score =
    components.punctuality * weights.punctuality +
    components.loyalty * weights.loyalty +
    components.reliability * weights.reliability +
    components.sentiment * weights.sentiment +
    components.engagement * weights.engagement +
    components.externalScore * weights.externalScore;
  return Math.round(clamp(score, 0, 100));
}

/**
 * Mapeia score 0-100 para tier.
 */
export function scoreToTier(score: number): HealthTier {
  if (score >= 80) return "gold";
  if (score >= 60) return "healthy";
  if (score >= 40) return "warning";
  return "critical";
}

/* ─────────────────── Predições heurísticas (Fase A) ─────────────────── */

/**
 * inadimplenciaRisk30d (0-100) — heurística não-ML.
 *
 * Para cliente CANCELADO: o risco já se materializou (cliente já está inadimplente).
 * "Risco futuro" não faz sentido. Retornamos 100 (já é inadimplente) — útil para
 * ordenação mas com semantica diferente. UI deve diferenciar com label "Já inadimplente".
 *
 * Substituível por modelo treinado na Fase C (Spec 010C).
 */
export function calcInadimplenciaRisk30d(input: CustomerHealthInputs, healthScore: number): number {
  if (input.contractStatus === "cancelled") return 100; // já materializado

  let risk = 100 - healthScore;

  if (input.invoicesOverdueCurrent >= 1) risk += 20;
  if ((input.avgDaysLate30d ?? 0) > 5) risk += 15;
  if (input.brokenAgreementsCount >= 2) risk += 10;
  if (input.contractMonths > 24 && healthScore > 80) risk -= 10;

  return Math.round(clamp(risk, 0, 100));
}

/**
 * churnRisk60d (0-100) — heurística não-ML.
 *
 * Para cliente CANCELADO: churn já ocorreu. Retornamos 100 (materializado).
 * Para cliente SUSPENSO: alto risco de virar cancelado se não houver acordo.
 */
export function calcChurnRisk60d(input: CustomerHealthInputs, healthScore: number): number {
  if (input.contractStatus === "cancelled") return 100; // já churnou
  if (input.contractStatus === "suspended") return Math.min(100, 70 + (100 - healthScore) * 0.3);

  let risk = (100 - healthScore) * 0.7;

  if ((input.lastInteractionDays ?? 0) > 180) risk += 25;
  if ((input.avgSentimentScore90d ?? 0) < -0.5) risk += 20;
  if (input.contractMonths < 6) risk += 15;
  if (input.ticketCount30d >= 3 && (input.avgSentimentScore90d ?? 0) < 0) risk += 10;

  return Math.round(clamp(risk, 0, 100));
}

/* ─────────────────── Função principal ─────────────────── */

/**
 * Calcula o resultado completo do health score.
 * Função pura, determinística, testável.
 */
export function calculateHealthScore(
  input: CustomerHealthInputs,
  weights: HealthWeights = DEFAULT_HEALTH_WEIGHTS,
): HealthScoreResult {
  const components = calcComponents(input);
  const healthScore = applyWeights(components, weights);
  const healthTier = scoreToTier(healthScore);

  return {
    healthScore,
    healthTier,
    components,
    inadimplenciaRisk30dPercent: calcInadimplenciaRisk30d(input, healthScore),
    churnRisk60dPercent: calcChurnRisk60d(input, healthScore),
  };
}

/* ─────────────────── Utilities ─────────────────── */

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
