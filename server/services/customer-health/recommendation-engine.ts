/**
 * Spec 010A — Recommendation engine.
 *
 * Função pura: dado o resultado do health score + sinais brutos, produz
 * recomendação humano-legível de qual agente atuar + ação sugerida.
 *
 * Sem dependência de DB. Determinística. Auditável.
 */

import type {
  CustomerHealthInputs,
  HealthScoreResult,
  HealthRecommendation,
} from "./types";

/**
 * Gera recomendação textual + agente sugerido.
 *
 * Lógica de prioridade (top-down):
 *   1. Cliente em situação crítica + quebras de acordo → atalho confissão D+1 (Spec 011)
 *   2. Gold com queda recente → Marcos alerta humano (cliente fiel virou risco)
 *   3. Critical + alto churn risk → retenção humana ANTES de cobrar
 *   4. Critical + baixo churn → Rafael negociação calibrada
 *   5. Warning → Marcos analisa
 *   6. Healthy → Bruno régua normal
 *   7. Gold padrão → Sofia atenta + considera upsell
 */
export function recommendAction(
  input: CustomerHealthInputs,
  result: HealthScoreResult,
): HealthRecommendation {
  // Atalho Spec 011 — C3 alto risco
  if (
    result.healthTier === "critical" &&
    input.brokenAgreementsCount >= 3 &&
    input.invoicesOverdueCurrent >= 1 &&
    (input.consultaIspScore ?? 1000) < 300 &&
    input.contractMonths >= 6
  ) {
    return {
      recommendedAction:
        "Atalho Spec 011: oferecer confissão de dívida D+1 com 30% off em 6x via ZapSign. " +
        "Cliente C3 alto-risco — pular régua tradicional, resolver em 1 ato.",
      recommendedAgent: "rafael",
      severity: "act",
    };
  }

  // Critical + alto churn → humano antes de cobrar
  if (result.healthTier === "critical" && result.churnRisk60dPercent >= 70) {
    return {
      recommendedAction:
        "ALERTA: alto risco de churn em cliente crítico. Retenção humana PRIMEIRO, " +
        "cobrança DEPOIS. Marcos contata owner para análise caso a caso.",
      recommendedAgent: "human_marcos",
      severity: "human_intervention",
    };
  }

  // Critical padrão → Rafael negocia (com cuidado)
  if (result.healthTier === "critical") {
    return {
      recommendedAction:
        "Cliente em situação crítica. Rafael negocia com desconto até 20% + Júlia valida cada envio. " +
        "Tom respeitoso, sem pressão excessiva.",
      recommendedAgent: "rafael",
      severity: "act",
    };
  }

  // Warning + tendência deteriorando → Marcos investiga
  if (result.healthTier === "warning" && result.churnRisk60dPercent >= 50) {
    return {
      recommendedAction:
        "Cliente em deterioração (warning + churn risk médio-alto). " +
        "Marcos investiga sinais cross-source e decide próximo passo (retenção vs cobrança).",
      recommendedAgent: "marcos",
      severity: "monitor",
    };
  }

  // Warning padrão → Helena monitora, Rafael calibra
  if (result.healthTier === "warning") {
    return {
      recommendedAction:
        "Cliente em alerta moderado. Helena atenta a inbound, Rafael pode oferecer até 15% off " +
        "se cliente pedir negociação.",
      recommendedAgent: "helena",
      severity: "monitor",
    };
  }

  // Healthy padrão → Bruno régua normal
  if (result.healthTier === "healthy") {
    return {
      recommendedAction: "Régua de cobrança normal. Bruno envia D-1 lembrete preventivo.",
      recommendedAgent: "bruno",
      severity: "none",
    };
  }

  // Gold — verificar se houve queda recente (gold para warning seria detectado por trend, mas no MVP olhamos sinais)
  if (
    result.healthTier === "gold" &&
    (input.invoicesOverdueCurrent >= 1 || result.churnRisk60dPercent >= 40)
  ) {
    return {
      recommendedAction:
        "ALERTA CRÍTICO: cliente OURO com sinais de queda. " +
        "Marcos LIGA pessoalmente em 24h, sem cobrança automatizada. Investigar causa.",
      recommendedAgent: "human_marcos",
      severity: "human_intervention",
    };
  }

  // Gold padrão
  return {
    recommendedAction:
      "Cliente OURO — proteger com cuidado. Considerar upsell sutil em pagamentos. " +
      "Sofia agradece, ofertas suaves apenas.",
    recommendedAgent: "sofia",
    severity: "none",
  };
}
