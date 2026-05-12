/**
 * Spec 013 — Risk calculator (pura).
 *
 * Dado SilentExitInputs, produz SilentExitResult com score + breakdown.
 *
 * Função pura. Sem DB. Determinística. Auditável (contributions explícitas).
 */

import type {
  SilentExitInputs,
  SilentExitResult,
} from "./types";
import { DEFAULT_SILENT_EXIT_WEIGHTS } from "./types";

/**
 * Calcula risco de saída silenciosa.
 */
export function calculateSilentExitRisk(input: SilentExitInputs): SilentExitResult {
  const contributions: Record<string, number> = {};
  const W = DEFAULT_SILENT_EXIT_WEIGHTS;

  // ─── Sinais técnicos (queda de banda) ───
  // Aplicação exclusiva: 60+ ganha 20pts, 40-60 ganha 15pts, <40 ganha 0
  if (input.bandwidthDropPercent !== null) {
    if (input.bandwidthDropPercent >= 60) {
      contributions.bandwidthDrop60 = W.bandwidthDrop60;
    } else if (input.bandwidthDropPercent >= 40) {
      contributions.bandwidthDrop40 = W.bandwidthDrop40;
    }
  }

  // ─── Sinais comportamentais portal ───
  if (
    input.portalLoginCount30d !== null &&
    input.portalLoginCountBaseline !== null &&
    input.portalLoginCountBaseline > 0
  ) {
    const ratio = input.portalLoginCount30d / input.portalLoginCountBaseline;
    if (ratio >= 5) {
      contributions.portalLogin5x = W.portalLogin5x;
    }
  }

  if (input.secondViaSearches30d >= 2) {
    contributions.secondVia2plus = W.secondVia2plus;
  }

  if (input.utmCompetitorReferrer) {
    contributions.utmCompetitor = W.utmCompetitor;
  }

  // ─── Sinais relacionais (parou de reclamar) ───
  if (
    input.ticketCountBaseline !== null &&
    input.ticketCountBaseline > 0 &&
    input.ticketCount30d < 0.3 * input.ticketCountBaseline
  ) {
    contributions.ticketDecrease = W.ticketDecrease;
  }

  if (input.daysWithoutLogin !== null && input.daysWithoutLogin >= 90) {
    contributions.daysWithoutLogin90 = W.daysWithoutLogin90;
  }

  // ─── Sinais contratuais ───
  if (input.recentPlanDowngrade) {
    contributions.planDowngrade = W.planDowngrade;
  }

  if (input.healthScoreTrend === "declining") {
    contributions.healthTrendDeclining = W.healthTrendDeclining;
  }

  // Soma e clamp
  const rawScore = Object.values(contributions).reduce((s, v) => s + v, 0);
  const riskScore = Math.min(100, rawScore);

  const riskLevel = classifyRisk(riskScore);
  const recommendedAction = recommendForLevel(riskLevel, contributions);

  return {
    riskScore,
    riskLevel,
    contributions,
    recommendedAction,
  };
}

/**
 * Classifica score em faixa nomeada.
 */
export function classifyRisk(score: number): SilentExitResult["riskLevel"] {
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  if (score >= 30) return "low";
  return "noise";
}

/**
 * Recomendação textual por nível.
 */
function recommendForLevel(
  level: SilentExitResult["riskLevel"],
  contributions: Record<string, number>,
): string {
  const topSignal = Object.entries(contributions)
    .sort(([, a], [, b]) => b - a)[0]?.[0];

  switch (level) {
    case "high":
      return (
        `Risco ALTO de saída silenciosa. Sinal principal: ${topSignal ?? "múltiplos"}. ` +
        "Helena assume retenção proativa com oferta pré-aprovada (até -15% por 3 meses). " +
        "Marcos cross-check com geo-cluster antes de cobrar."
      );
    case "medium":
      return (
        `Risco MÉDIO. Pedro envia survey proativa não-invasiva. ` +
        "Atualiza sinal próximo ciclo (deteriora ou estabiliza?)."
      );
    case "low":
      return (
        "Risco BAIXO. Apenas monitorar. Sinal pode evoluir — re-avaliar em 14 dias."
      );
    case "noise":
    default:
      return "Ruído — sinais insuficientes. Sem ação.";
  }
}
