/**
 * Spec 014 — Geo-Monitor Competitivo.
 *
 * Tipos puros para classificação de resultados de busca.
 * Sem LLM ainda — heurística pré-filtro determinística que reduz
 * volume de chamadas LLM downstream (Batch 2 integra Haiku).
 */

/** Resultado de busca (de Serper API ou similar). */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Domain extraído da URL para classificação. */
  domain?: string;
}

/** Contexto regional do tenant para cross-check de relevância. */
export interface TenantContext {
  cities: string[];        // ex: ["Londrina", "Ibiporã", "Cambé"]
  state: string;           // ex: "PR"
  /** Provedores já conhecidos na região (whitelist) para distinguir new vs existing. */
  knownCompetitors: string[];
}

/** Veredito da classificação. */
export type CompetitorClassification =
  | "new_provider"
  | "existing_provider"
  | "unrelated"
  | "noise";

/** Resultado da classificação heurística (pré-LLM). */
export interface HeuristicClassificationResult {
  classification: CompetitorClassification;
  /** 0-1, confidence apenas na heurística. LLM pode override. */
  confidence: number;
  reasoning: string;
  /** Termos detectados que levaram à classificação. Auditável. */
  matchedTerms: string[];
  /** Se confidence < limiar, recomenda chamar LLM para refinar. */
  needsLlmReview: boolean;
}

/** Tokens ISP/telecom que indicam provedor de internet. */
export const ISP_INDICATOR_TERMS = [
  "provedor",
  "internet",
  "banda larga",
  "fibra",
  "fibra óptica",
  "wi-fi",
  "wifi",
  "conexão",
  "isp",
  "telecomunicações",
  "telecom",
] as const;

/** Termos que indicam cobertura de uma região nova. */
export const COVERAGE_TERMS = [
  "cobertura",
  "chegamos",
  "agora em",
  "atendemos",
  "expansão",
  "nova região",
  "novo bairro",
  "instalamos",
  "ativamos",
  "lançamento",
] as const;

/** Domínios que indicam "ruído" (não-relacionado). */
export const NOISE_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "wikipedia.org",
  "reclameaqui.com.br",
  "google.com",
] as const;

/** Domínios de marketplace que indicam "não é provedor". */
export const MARKETPLACE_DOMAINS = [
  "mercadolivre.com.br",
  "amazon.com.br",
  "magazineluiza.com.br",
  "americanas.com.br",
  "shopee.com.br",
  "olx.com.br",
] as const;
