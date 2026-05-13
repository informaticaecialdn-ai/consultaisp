/**
 * Spec 010A — Customer Health Score 360º (Fase A)
 *
 * Types puros (sem dependência de schema/DB) para o motor de cálculo
 * de health score. Permite implementar + testar a lógica antes da
 * autorização do schema `customer_health_snapshots`.
 *
 * Princípio: função pura testável. DB plumbing fica em snapshot-builder.ts
 * (Batch 2, depende de schema autorizado).
 */

export type HealthTier = "gold" | "healthy" | "warning" | "critical";

/**
 * Sinais brutos extraídos do estado atual do cliente.
 * Cada sinal é opcional para permitir cálculo gracioso quando dado falta.
 */
export interface CustomerHealthInputs {
  /** Tempo de contrato em meses. 0 para cliente novo. */
  contractMonths: number;

  /** Total de faturas emitidas para o cliente. */
  invoicesTotal: number;
  /** Faturas pagas no histórico. */
  invoicesPaid: number;
  /** Faturas pagas com atraso. */
  invoicesLate: number;
  /** Faturas vencidas e ainda em aberto agora. */
  invoicesOverdueCurrent: number;

  /** Média de dias de atraso nos últimos 30 dias. null se não houve faturas. */
  avgDaysLate30d: number | null;
  /** Média de dias de atraso nos últimos 90 dias. */
  avgDaysLate90d: number | null;
  /** Média de dias de atraso nos últimos 365 dias. */
  avgDaysLate365d: number | null;

  /** Receita acumulada total em centavos (cobrança paga ao longo da relação). */
  totalRevenueAccumulatedCents: number;

  /** Quebras de acordo (Agreement.status = BROKEN) no histórico. */
  brokenAgreementsCount: number;

  /** Tickets/comunicações inbound nos últimos 30 dias. */
  ticketCount30d: number;
  /** Tickets nos últimos 90 dias (para baseline). */
  ticketCount90d: number;

  /** Dias desde última interação (inbound ou outbound respondido). null se nunca. */
  lastInteractionDays: number | null;

  /**
   * Média de sentiment score (-1 a +1) das interações dos últimos 90 dias.
   * null quando não há histórico suficiente.
   */
  avgSentimentScore90d: number | null;

  /** Score Consulta ISP (0-1000). null se não consultado. */
  consultaIspScore: number | null;
}

/**
 * Resultado intermediário do cálculo — cada componente normalizado a 0-100
 * para auditabilidade. Mostra ao operador exatamente por que o score saiu X.
 */
export interface HealthScoreComponents {
  /** Pontualidade: 0 = sempre atrasa muito, 100 = sempre em dia */
  punctuality: number;
  /** Fidelidade: 0 = cliente novo, 100 = 24+ meses */
  loyalty: number;
  /** Confiabilidade: 0 = 3+ quebras de acordo, 100 = nenhuma */
  reliability: number;
  /** Sentiment: 0 = histórico negativo, 100 = positivo */
  sentiment: number;
  /** Engajamento: 0 = sem interação >180d, 100 = recente */
  engagement: number;
  /** Score externo (Consulta ISP): 0 = score baixo, 100 = alto */
  externalScore: number;
}

/**
 * Output completo do calculator.
 */
export interface HealthScoreResult {
  /** Score consolidado 0-100, soma ponderada dos componentes. */
  healthScore: number;
  /** Categorização para uso por agentes. */
  healthTier: HealthTier;
  /** Componentes individuais — para auditabilidade e UI. */
  components: HealthScoreComponents;
  /** Probabilidade heurística de atrasar nos próximos 30 dias. */
  inadimplenciaRisk30dPercent: number;
  /** Probabilidade heurística de cancelar nos próximos 60 dias. */
  churnRisk60dPercent: number;
}

/**
 * Recomendação humano-legível derivada do score + componentes mais fracos.
 */
export interface HealthRecommendation {
  /** Texto curto explicando o que fazer. Vai no UI + audit log. */
  recommendedAction: string;
  /** Agente sugerido para próxima ação. */
  recommendedAgent:
    | "sofia"
    | "bruno"
    | "rafael"
    | "helena"
    | "lucas"
    | "marcos"
    | "pedro"
    | "human_marcos"
    | "none";
  /** Severidade: nenhuma | observar | agir | intervir humano */
  severity: "none" | "monitor" | "act" | "human_intervention";
}

/**
 * Pesos dos componentes do health score.
 * Soma deve ser 1.0 (validar antes de passar para calculator).
 */
export interface HealthWeights {
  punctuality: number;
  loyalty: number;
  reliability: number;
  sentiment: number;
  engagement: number;
  externalScore: number;
}

/**
 * Pesos default — calibrados na Spec 010A após análise comportamental ISP.
 * Soma = 1.0 (100%). Owner pode override via Fase B (config tenant).
 */
export const DEFAULT_HEALTH_WEIGHTS: HealthWeights = {
  punctuality: 0.35,
  loyalty: 0.15,
  reliability: 0.15,
  sentiment: 0.1,
  engagement: 0.1,
  externalScore: 0.15,
};
