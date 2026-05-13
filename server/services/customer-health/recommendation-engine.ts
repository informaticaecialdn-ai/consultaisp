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
  // ───────────────────────────────────────────────────────────────────────
  // BRANCH PRINCIPAL — status do contrato.
  // Cliente cancelado tem semantica completamente diferente: ja fez churn
  // (não há "risco churn"), risco inadimplencia ja se materializou (nao é
  // probabilidade futura), e agentes corretos sao Daniel (cobranca consul-
  // tiva) ou Lucas (equipamento), nao Bruno/Rafael/Helena que atuam em vigentes.
  // ───────────────────────────────────────────────────────────────────────
  if (input.contractStatus === "cancelled") {
    return recommendForCancelled(input, result);
  }
  if (input.contractStatus === "suspended") {
    return recommendForSuspended(input, result);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Cliente ATIVO — logica padrao (retenção + cobranca preventiva)
  // ───────────────────────────────────────────────────────────────────────

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

/**
 * Recomendação para cliente CANCELADO (ex-cliente com cobrança pendente).
 * Aqui não há "risco futuro" — o dano já se materializou. Foco é RECUPERAÇÃO,
 * não retenção/cobrança preventiva.
 *
 * Lógica:
 *   - Dívida alta (R$ 500+) ou equipamento envolvido → Lucas (recuperação comodato)
 *   - Dívida média → Daniel (cobrança consultiva D+60+, acordo amigável)
 *   - Dívida muito antiga (>3 anos) → considerar prescrita (CC 206 §5 I) → Júlia avalia
 *   - Múltiplas quebras de acordo → arquivar (ROI negativo previsto)
 */
function recommendForCancelled(
  input: CustomerHealthInputs,
  result: HealthScoreResult,
): HealthRecommendation {
  const valorAberto = input.invoicesOverdueCurrent;
  const diasAtrasoMaximo = input.avgDaysLate30d ?? input.avgDaysLate90d ?? input.avgDaysLate365d ?? 0;

  // Múltiplas quebras de acordo + dívida antiga → arquivar
  if (input.brokenAgreementsCount >= 2 && diasAtrasoMaximo > 365) {
    return {
      recommendedAction:
        "Ex-cliente com histórico de quebras de acordo (2+) e dívida >1 ano. " +
        "ROI esperado da cobrança baixo (provavelmente <30%). Considerar arquivar caso ou " +
        "ofertar parcelamento 50% off via Daniel (último esforço).",
      recommendedAgent: "daniel",
      severity: "monitor",
    };
  }

  // Dívida muito antiga (3+ anos) — possivel prescricao CC 206 §5 I
  if (diasAtrasoMaximo > 1095) {
    return {
      recommendedAction:
        "ATENÇÃO LEGAL: dívida > 3 anos. Possível prescrição CC art. 206 §5 I (5 anos). " +
        "Júlia avalia se ainda é cobrável. Não negativar SPC sem revisão legal.",
      recommendedAgent: "human_marcos",
      severity: "human_intervention",
    };
  }

  // Dívida alta — provavelmente inclui equipamento — Lucas
  // (saldo > R$ 500 em valor inteiro = 500 reais, sem usar centavos aqui pois invoicesOverdueCurrent é qty)
  // Critério heurístico: cancelado + 1+ faturas indica multa rescisória/equipamento.
  if (valorAberto >= 1 && diasAtrasoMaximo >= 60) {
    return {
      recommendedAction:
        "Ex-cliente cancelado com cobrança pendente. Provável composição: multa rescisória + " +
        "equipamento em comodato não devolvido. Lucas atua na recuperação física do equipamento " +
        "(ONU, roteador). Daniel oferece acordo amigável (50% off à vista, ou 30% off 3x).",
      recommendedAgent: "lucas",
      severity: "act",
    };
  }

  // Cancelado recente, dívida pequena — Daniel oferta amigável
  return {
    recommendedAction:
      "Ex-cliente recém-cancelado com saldo aberto. Daniel oferta acordo amigável " +
      "(20-30% off à vista). Sem pressão — recuperação suave para preservar reputação.",
    recommendedAgent: "daniel",
    severity: "act",
  };
}

/**
 * Recomendação para cliente SUSPENSO (D+15 Anatel ou bloqueio temporário).
 * Carla gerencia timeline regulatória; Rafael oferta acordo pra religar.
 */
function recommendForSuspended(
  input: CustomerHealthInputs,
  result: HealthScoreResult,
): HealthRecommendation {
  void result;
  if (input.invoicesOverdueCurrent >= 3) {
    return {
      recommendedAction:
        "Cliente SUSPENSO com 3+ faturas. Janela crítica antes do cancelamento (D+60). " +
        "Rafael oferta acordo agressivo (40% off 6x) com religamento imediato pós-Pix. " +
        "Carla monitora timeline Anatel 765.",
      recommendedAgent: "rafael",
      severity: "act",
    };
  }
  return {
    recommendedAction:
      "Cliente suspenso. Carla gerencia notificações Anatel 765. " +
      "Religamento <60s ao confirmar pagamento (Spec 010 Religamento Inteligente).",
    recommendedAgent: "carla",
    severity: "act",
  };
}
