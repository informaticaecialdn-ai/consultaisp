/**
 * Spec 013 — Detector de Saída Silenciosa.
 *
 * Tipos puros (sem DB) para cálculo de risco de saída silenciosa.
 * Cliente psicologicamente saindo dá sinais antes do cancelamento formal.
 *
 * Sinais combinados:
 *   - Queda de banda significativa
 *   - Aumento de logins consultando conta
 *   - Buscas por 2ª via
 *   - Redução de tickets (cliente desistiu de reclamar)
 *   - UTM referrer com termos competidores
 *   - Plan downgrade recente
 *   - Tempo sem login portal
 *   - healthScore declinando
 */

/**
 * Sinais brutos coletados no momento de avaliação.
 * Todos opcionais — função degrada graciosamente quando sinais faltam.
 */
export interface SilentExitInputs {
  /** Queda de uso de banda nos últimos 14d vs baseline 90d. 0-100. null se não temos dados. */
  bandwidthDropPercent: number | null;

  /** Logins no portal nos últimos 30 dias. null se portal não instrumentado. */
  portalLoginCount30d: number | null;
  /** Média histórica de logins/30d (baseline). null se não temos. */
  portalLoginCountBaseline: number | null;

  /** Buscas por 2ª via nos últimos 30 dias. */
  secondViaSearches30d: number;

  /** Tickets/inbound nos últimos 30 dias. */
  ticketCount30d: number;
  /** Média histórica de tickets/30d. */
  ticketCountBaseline: number | null;

  /** UTM/referrer com termos de competidor detectado nos últimos 30 dias. */
  utmCompetitorReferrer: boolean;

  /** Dias desde último login. null se nunca. */
  daysWithoutLogin: number | null;

  /** Houve downgrade de plano nos últimos 60 dias? */
  recentPlanDowngrade: boolean;

  /** healthScore tendência: 'declining' | 'stable' | 'improving'. null se não calculado. */
  healthScoreTrend: "declining" | "stable" | "improving" | null;
}

/** Resultado do cálculo. */
export interface SilentExitResult {
  /** Score 0-100. ≥70 high, 50-69 medium, 30-49 low, <30 noise. */
  riskScore: number;
  /** Faixa categorizada. */
  riskLevel: "noise" | "low" | "medium" | "high";
  /** Quais sinais contribuíram (key → pontos). Para auditabilidade. */
  contributions: Record<string, number>;
  /** Ação sugerida em texto humano. */
  recommendedAction: string;
}

/**
 * Pesos default — pontos máximos por sinal.
 * Soma teórica máxima = 100 (alguns sinais não cumulativos).
 */
export const DEFAULT_SILENT_EXIT_WEIGHTS = {
  bandwidthDrop60: 20,    // queda ≥60%
  bandwidthDrop40: 15,    // queda 40-60% (atribui só um dos dois)
  portalLogin5x: 15,      // logins ≥5x baseline
  secondVia2plus: 10,
  utmCompetitor: 5,
  ticketDecrease: 15,     // tickets <30% do baseline (desistiu de reclamar)
  daysWithoutLogin90: 10, // ≥90 dias sem login
  planDowngrade: 10,
  healthTrendDeclining: 5,
} as const;
