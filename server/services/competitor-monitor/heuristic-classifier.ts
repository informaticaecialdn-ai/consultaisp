/**
 * Spec 014 — Heuristic classifier (pré-LLM).
 *
 * Reduz volume de chamadas LLM ao filtrar resultados de busca obviamente
 * irrelevantes (redes sociais, marketplaces) e marcar matches óbvios
 * (provedores já conhecidos).
 *
 * Classifications:
 *   - 'unrelated': domínio é noise ou marketplace ou sem nenhum ISP term
 *   - 'existing_provider': matches knownCompetitor da tenant
 *   - 'new_provider': ISP terms + região do tenant + coverage terms (heurística)
 *   - 'noise': nada útil
 *
 * Quando confidence < 0.7, recomenda chamar LLM (Batch 2) para refinar.
 */

import type {
  HeuristicClassificationResult,
  SearchResult,
  TenantContext,
} from "./types";
import {
  COVERAGE_TERMS,
  ISP_INDICATOR_TERMS,
  MARKETPLACE_DOMAINS,
  NOISE_DOMAINS,
} from "./types";

const LLM_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Extrai o domain de uma URL (ex: "https://www.fibra-x.com.br/londrina" → "fibra-x.com.br").
 */
export function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Lowercase + remove acentos para matching robusto. */
function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Verifica se TODOS os termos abaixo aparecem no texto. */
function findMatches(text: string, terms: ReadonlyArray<string>): string[] {
  const lower = normalize(text);
  return terms.filter((t) => lower.includes(normalize(t)));
}

/**
 * Classifica um único SearchResult via heurística.
 */
export function classifyHeuristic(
  result: SearchResult,
  context: TenantContext,
): HeuristicClassificationResult {
  const domain = result.domain ?? extractDomain(result.url);
  const fullText = `${result.title} ${result.snippet}`;
  const matched: string[] = [];

  // 1. Domínio noise → unrelated com alta confidence
  if (NOISE_DOMAINS.some((d) => domain.includes(d))) {
    return {
      classification: "unrelated",
      confidence: 0.95,
      reasoning: `Domínio noise: ${domain}`,
      matchedTerms: [domain],
      needsLlmReview: false,
    };
  }

  // 2. Marketplace → unrelated alta confidence (vendendo roteador, não provedor)
  if (MARKETPLACE_DOMAINS.some((d) => domain.includes(d))) {
    return {
      classification: "unrelated",
      confidence: 0.9,
      reasoning: `Domínio marketplace: ${domain}`,
      matchedTerms: [domain],
      needsLlmReview: false,
    };
  }

  // 3. Match com provedor já conhecido → existing_provider
  for (const known of context.knownCompetitors) {
    if (normalize(fullText).includes(normalize(known)) || domain.includes(normalize(known))) {
      return {
        classification: "existing_provider",
        confidence: 0.85,
        reasoning: `Match com competidor conhecido: ${known}`,
        matchedTerms: [known],
        needsLlmReview: false,
      };
    }
  }

  // 4. Sem ISP terms → unrelated
  const ispMatches = findMatches(fullText, ISP_INDICATOR_TERMS);
  if (ispMatches.length === 0) {
    return {
      classification: "unrelated",
      confidence: 0.7,
      reasoning: "Nenhum termo ISP/telecom detectado",
      matchedTerms: [],
      needsLlmReview: true,  // tem chance pequena de termos custom
    };
  }
  matched.push(...ispMatches);

  // 5. ISP terms + região do tenant + coverage terms → provável new_provider
  const cityMatches = findMatches(
    fullText,
    context.cities,
  );
  const coverageMatches = findMatches(fullText, COVERAGE_TERMS);
  matched.push(...cityMatches, ...coverageMatches);

  if (ispMatches.length >= 1 && cityMatches.length >= 1 && coverageMatches.length >= 1) {
    return {
      classification: "new_provider",
      confidence: 0.75,
      reasoning: `ISP terms (${ispMatches.length}) + região (${cityMatches.join(",")}) + cobertura (${coverageMatches.length})`,
      matchedTerms: matched,
      needsLlmReview: false,
    };
  }

  // 6. ISP terms + região mas SEM coverage terms → possível existing
  if (ispMatches.length >= 1 && cityMatches.length >= 1) {
    return {
      classification: "existing_provider",
      confidence: 0.55,  // baixa confidence → LLM revisa
      reasoning: "ISP + região mas sem termos de expansão — provável existente",
      matchedTerms: matched,
      needsLlmReview: true,
    };
  }

  // 7. ISP terms sem região → unrelated (não é nosso mercado)
  if (ispMatches.length >= 1 && cityMatches.length === 0) {
    return {
      classification: "unrelated",
      confidence: 0.6,
      reasoning: "ISP terms presentes mas fora da região do tenant",
      matchedTerms: matched,
      needsLlmReview: false,
    };
  }

  // 8. Default: noise
  return {
    classification: "noise",
    confidence: 0.5,
    reasoning: "Sinais insuficientes para classificação heurística",
    matchedTerms: matched,
    needsLlmReview: true,
  };
}

/**
 * Decide se um resultado heurístico precisa LLM follow-up.
 */
export function needsLlmReview(result: HeuristicClassificationResult): boolean {
  return result.needsLlmReview || result.confidence < LLM_CONFIDENCE_THRESHOLD;
}

/**
 * Filtra batch de resultados, retornando apenas os que precisam LLM
 * (economiza tokens — Spec 014 Batch 2).
 */
export function partitionForLlm<T extends SearchResult>(
  results: Array<{ search: T; heuristic: HeuristicClassificationResult }>,
): {
  certain: Array<{ search: T; heuristic: HeuristicClassificationResult }>;
  uncertain: Array<{ search: T; heuristic: HeuristicClassificationResult }>;
} {
  const certain: typeof results = [];
  const uncertain: typeof results = [];

  for (const item of results) {
    if (needsLlmReview(item.heuristic)) {
      uncertain.push(item);
    } else {
      certain.push(item);
    }
  }

  return { certain, uncertain };
}
