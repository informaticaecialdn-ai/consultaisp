/**
 * Spec 010A — Context enricher para agents managed.
 *
 * Helper que monta JSON com tudo que Marcos/Helena/Rafael precisam saber
 * antes de despachar/conversar com cliente. Inclui:
 *   - Customer health score + tier + componentes
 *   - Predições heurísticas (inadimplência, churn)
 *   - Recomendação (qual agente atuar + ação)
 *   - Inputs brutos (para auditabilidade no log do agente)
 *
 * Uso típico no adapter:
 *   const context = await buildCustomerContext(providerId, customerId);
 *   const userMessage = JSON.stringify({ instruction: "...", customerContext: context });
 *   const result = await invokeAgent({ agent: "bruno", providerId, userMessage });
 *
 * Função NÃO modifica platform-client.ts nem invokeAgent — é aditiva.
 * Adapter escolhe se quer enriquecer ou não.
 *
 * Falha graciosa: se cliente não existe ou erro de DB, retorna null.
 * Caller decide se aborta ou continua com contexto vazio.
 */

import { logger } from "../../logger";
import { calculateHealthScore } from "../customer-health/score-calculator";
import { recommendAction } from "../customer-health/recommendation-engine";
import {
  buildCustomerHealthInputs,
  CustomerNotFoundError,
} from "../customer-health/snapshot-builder";

/**
 * Resultado completo do contexto enriquecido.
 * Estrutura JSON-serializável (sem Date objects).
 */
export interface AgentCustomerContext {
  customerId: number;
  health: {
    score: number;
    tier: "gold" | "healthy" | "warning" | "critical";
    components: {
      punctuality: number;
      loyalty: number;
      reliability: number;
      sentiment: number;
      engagement: number;
      externalScore: number;
    };
    predictions: {
      inadimplenciaRisk30dPercent: number;
      churnRisk60dPercent: number;
    };
    recommendedAction: string;
    recommendedAgent: string;
    severity: "none" | "monitor" | "act" | "human_intervention";
  };
  /** Snapshot dos inputs brutos (auditabilidade) */
  rawInputs: {
    contractMonths: number;
    invoicesTotal: number;
    invoicesLate: number;
    invoicesOverdueCurrent: number;
    avgDaysLate90d: number | null;
    brokenAgreementsCount: number;
    lastInteractionDays: number | null;
    totalRevenueAccumulatedCents: number;
  };
  computedAt: string;
}

/**
 * Monta contexto enriquecido para agente managed.
 *
 * @returns AgentCustomerContext ou null se cliente não encontrado / erro
 */
export async function buildCustomerContext(
  providerId: number,
  customerId: number,
): Promise<AgentCustomerContext | null> {
  try {
    const inputs = await buildCustomerHealthInputs(providerId, customerId);
    const score = calculateHealthScore(inputs);
    const recommendation = recommendAction(inputs, score);

    return {
      customerId,
      health: {
        score: score.healthScore,
        tier: score.healthTier,
        components: score.components,
        predictions: {
          inadimplenciaRisk30dPercent: score.inadimplenciaRisk30dPercent,
          churnRisk60dPercent: score.churnRisk60dPercent,
        },
        recommendedAction: recommendation.recommendedAction,
        recommendedAgent: recommendation.recommendedAgent,
        severity: recommendation.severity,
      },
      rawInputs: {
        contractMonths: inputs.contractMonths,
        invoicesTotal: inputs.invoicesTotal,
        invoicesLate: inputs.invoicesLate,
        invoicesOverdueCurrent: inputs.invoicesOverdueCurrent,
        avgDaysLate90d: inputs.avgDaysLate90d,
        brokenAgreementsCount: inputs.brokenAgreementsCount,
        lastInteractionDays: inputs.lastInteractionDays,
        totalRevenueAccumulatedCents: inputs.totalRevenueAccumulatedCents,
      },
      computedAt: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof CustomerNotFoundError) {
      logger.warn(
        { action: "agent_context_customer_not_found", providerId, customerId },
        "Customer not found while building agent context",
      );
      return null;
    }
    logger.error(
      {
        action: "agent_context_build_error",
        providerId,
        customerId,
        err: err instanceof Error ? err.message : String(err),
      },
      "Failed to build agent context",
    );
    return null;
  }
}

/**
 * Versão "lite" — só health summary, sem rawInputs. Útil para incluir
 * em user messages curtas sem inflar contexto.
 */
export async function buildCustomerContextLite(
  providerId: number,
  customerId: number,
): Promise<{
  customerId: number;
  healthScore: number;
  healthTier: string;
  inadimplenciaRisk30dPercent: number;
  churnRisk60dPercent: number;
  recommendedAction: string;
} | null> {
  const full = await buildCustomerContext(providerId, customerId);
  if (!full) return null;
  return {
    customerId: full.customerId,
    healthScore: full.health.score,
    healthTier: full.health.tier,
    inadimplenciaRisk30dPercent: full.health.predictions.inadimplenciaRisk30dPercent,
    churnRisk60dPercent: full.health.predictions.churnRisk60dPercent,
    recommendedAction: full.health.recommendedAction,
  };
}
