/**
 * SPC Service — Integração com API consultanegativacao.com.br v2
 *
 * Fluxo assíncrono:
 * 1. POST /consultas/assincrona → recebe protocolo
 * 2. Poll GET /consultas/assincrona?protocolo=X até resultado
 *
 * Auth: headers cnpjSh, tokenSh, cnpjUsuario, login, password
 * Env: SPC_API_BASE_URL, SPC_CNPJ_SH, SPC_TOKEN_SH, SPC_OPERATOR_LOGIN, SPC_OPERATOR_PASSWORD
 */

import { logger } from "../logger";
import { CircuitBreaker, withResilience } from "../erp/resilience";

// ── Environment ──────────────────────────────────────────────────────────────

const SPC_API_BASE_URL = process.env.SPC_API_BASE_URL || "https://api.consultanegativacao.com.br/v2";
const SPC_CNPJ_SH = process.env.SPC_CNPJ_SH || "";
const SPC_TOKEN_SH = process.env.SPC_TOKEN_SH || "";
const SPC_OPERATOR_LOGIN = process.env.SPC_OPERATOR_LOGIN || "";
const SPC_OPERATOR_PASSWORD = process.env.SPC_OPERATOR_PASSWORD || "";
const SPC_ENABLED = !!(SPC_CNPJ_SH && SPC_TOKEN_SH && SPC_OPERATOR_LOGIN && SPC_OPERATOR_PASSWORD);

// ── Circuit breaker ─────────────────────────────────────────────────────────

const spcCircuit = new CircuitBreaker({ maxFailures: 3, resetTimeMs: 60_000 });

// ── Types ────────────────────────────────────────────────────────────────────

export interface SpcResult {
  cpfCnpj: string;
  cadastralData: {
    nome: string;
    cpfCnpj: string;
    dataNascimento?: string;
    dataFundacao?: string;
    nomeMae?: string;
    situacaoRf: string;
    obitoRegistrado: boolean;
    tipo: "PF" | "PJ";
  };
  score: number;
  riskLevel: string;
  riskLabel: string;
  recommendation: string;
  status: string;
  restrictions: {
    type: string;
    description: string;
    severity: string;
    creditor: string;
    value: string;
    date: string;
    origin: string;
  }[];
  totalRestrictions: number;
  previousConsultations: {
    total: number;
    last90Days: number;
    bySegment: Record<string, number>;
  };
  alerts: { type: string; message: string; severity: string }[];
  rawHtml?: string;
}

// ── Códigos de consulta ──────────────────────────────────────────────────────

export const SPC_CONSULTATION_TYPES = {
  PF_BASICA: 1,
  PF_DETALHADA: 4,
  SCORE_601: 601,
  COMPLETA_602: 602,
  PREMIUM_603: 603,
} as const;

// ── Public API ───────────────────────────────────────────────────────────────

export function isSpcConfigured(): boolean {
  return SPC_ENABLED;
}

/**
 * Consultar SPC via API consultanegativacao.com.br
 * @param cpfCnpj CPF ou CNPJ a consultar
 * @param cnpjProvedor CNPJ do provedor que está fazendo a consulta
 * @param codConsulta Código da consulta (default: 601 = Score)
 * @param retorno "HTML" ou "JSON" (default: "JSON")
 */
export async function consultarSpc(
  cpfCnpj: string,
  cnpjProvedor?: string,
  codConsulta: number = SPC_CONSULTATION_TYPES.SCORE_601,
  retorno: "HTML" | "JSON" = "JSON",
): Promise<SpcResult> {
  if (!SPC_ENABLED) {
    throw new Error("SPC nao configurado. Verifique as variaveis SPC_CNPJ_SH, SPC_TOKEN_SH, SPC_OPERATOR_LOGIN, SPC_OPERATOR_PASSWORD no .env");
  }

  const cleanDoc = cpfCnpj.replace(/\D/g, "");
  const uf = "PR"; // Default UF — pode ser parametrizado depois

  logger.info({ cpfCnpj: cleanDoc.slice(0, 3) + "***", codConsulta }, "SPC consultation started");

  // Step 1: Iniciar consulta assíncrona
  const protocolo = await iniciarConsulta(cleanDoc, cnpjProvedor || SPC_CNPJ_SH, codConsulta, uf, retorno);
  logger.info({ protocolo }, "SPC protocolo received");

  // Step 2: Poll resultado
  const resultado = await buscarResultado(protocolo, cnpjProvedor || SPC_CNPJ_SH);
  logger.info({ protocolo, hasData: !!resultado }, "SPC result received");

  // Step 3: Parse resultado
  return parseResultado(cleanDoc, resultado, retorno);
}

/**
 * Negativar devedor no SPC
 */
export async function negativarSpc(
  dados: {
    nome: string;
    documento: string;
    endereco: string;
    bairro: string;
    municipio: string;
    uf: string;
    cep: string;
    divida: {
      nossoNumero: string;
      especieTitulo: string;
      numDocumento: string;
      dataEmissao: string;
      dataVencimento: string;
      valorTitulo: number;
      codAlinea: string;
      codEndosso: string;
      codAceite: string;
    };
  },
  cnpjProvedor: string,
): Promise<any> {
  if (!SPC_ENABLED) {
    throw new Error("SPC nao configurado");
  }

  const url = `${SPC_API_BASE_URL}/negativacao`;
  const response = await fetchSpc(url, "POST", cnpjProvedor, JSON.stringify(dados));
  return response;
}

/**
 * Consultar consumo de créditos SPC
 */
export async function consultarConsumo(
  inicio: string,
  fim: string,
): Promise<any> {
  if (!SPC_ENABLED) throw new Error("SPC nao configurado");
  const url = `${SPC_API_BASE_URL}/consumo?inicio=${inicio}&final=${fim}`;
  return fetchSpc(url, "GET", SPC_CNPJ_SH);
}

// ── Internal ─────────────────────────────────────────────────────────────────

function buildHeaders(cnpjUsuario: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "cnpjSh": SPC_CNPJ_SH,
    "tokenSh": SPC_TOKEN_SH,
    "cnpjUsuario": cnpjUsuario,
    "login": SPC_OPERATOR_LOGIN,
    "password": SPC_OPERATOR_PASSWORD,
  };
}

async function fetchSpc(url: string, method: string, cnpjUsuario: string, body?: string): Promise<any> {
  return withResilience(
    async () => {
      const response = await fetch(url, {
        method,
        headers: buildHeaders(cnpjUsuario),
        body: method === "POST" ? body : undefined,
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`SPC API HTTP ${response.status}: ${text.slice(0, 500)}`);
      }

      return response.json();
    },
    { retries: 2, minTimeout: 2000, circuit: spcCircuit },
  );
}

async function iniciarConsulta(
  documento: string,
  cnpjUsuario: string,
  codConsulta: number,
  uf: string,
  retorno: string,
): Promise<string> {
  const url = `${SPC_API_BASE_URL}/consultas/assincrona`;
  const body = JSON.stringify({ documento, codConsulta, uf, retorno });

  const data = await fetchSpc(url, "POST", cnpjUsuario, body);

  if (data.protocolo) {
    return data.protocolo;
  }

  if (data.error || data.mensagem) {
    throw new Error(`SPC erro ao iniciar consulta: ${data.error || data.mensagem}`);
  }

  throw new Error("SPC resposta inesperada ao iniciar consulta: " + JSON.stringify(data).slice(0, 500));
}

async function buscarResultado(protocolo: string, cnpjUsuario: string, maxAttempts = 10): Promise<any> {
  const url = `${SPC_API_BASE_URL}/consultas/assincrona?protocolo=${encodeURIComponent(protocolo)}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const data = await fetchSpc(url, "GET", cnpjUsuario);

    // Se tem resultado, retorna
    if (data.resultado || data.html || data.data || data.score !== undefined) {
      return data;
    }

    // Se ainda está processando, espera e tenta de novo
    if (data.status === "processando" || data.status === "pending" || data.pendente) {
      logger.info({ protocolo, attempt }, "SPC result pending, waiting...");
      await new Promise(r => setTimeout(r, 2000 + attempt * 500));
      continue;
    }

    // Se deu erro, lança
    if (data.error || data.mensagem) {
      throw new Error(`SPC erro ao buscar resultado: ${data.error || data.mensagem}`);
    }

    // Resposta inesperada — pode ser o próprio resultado
    return data;
  }

  throw new Error(`SPC timeout: resultado nao ficou pronto apos ${maxAttempts} tentativas para protocolo ${protocolo}`);
}

function parseResultado(cpfCnpj: string, data: any, retorno: string): SpcResult {
  const isPF = cpfCnpj.length <= 11;

  // Se retorno HTML, salvar o HTML e extrair o que puder
  if (retorno === "HTML" && (data.html || data.resultado)) {
    const html = data.html || data.resultado || "";
    return {
      cpfCnpj,
      cadastralData: {
        nome: data.nome || "Consulta SPC",
        cpfCnpj,
        situacaoRf: "Consulte o relatorio",
        obitoRegistrado: false,
        tipo: isPF ? "PF" : "PJ",
      },
      score: data.score || 0,
      riskLevel: "unknown",
      riskLabel: "Consulte o relatorio",
      recommendation: "Analisar relatorio completo",
      status: "consulted",
      restrictions: [],
      totalRestrictions: 0,
      previousConsultations: { total: 0, last90Days: 0, bySegment: {} },
      alerts: [],
      rawHtml: html,
    };
  }

  // Parse JSON response
  const resultado = data.resultado || data.data || data;
  const score = resultado.score || resultado.pontuacao || 0;
  const hasRestrictions = resultado.restricoes || resultado.has_restrictions || resultado.pendencias;
  const nome = resultado.nome || resultado.razaoSocial || resultado.nomeConsultado || "Consulta SPC";

  // Build restrictions
  const rawRestrictions = resultado.restricoes || resultado.pendencias || resultado.debitos || [];
  const restrictions = (Array.isArray(rawRestrictions) ? rawRestrictions : []).map((r: any) => ({
    type: r.tipo || r.type || r.natureza || "DEBITO",
    description: r.descricao || r.description || r.informante || "",
    severity: (r.valor || 0) > 1000 ? "high" : "medium",
    creditor: r.informante || r.credor || r.empresa || "Nao informado",
    value: String(r.valor || r.value || "0"),
    date: r.data || r.dataInclusao || r.date || "",
    origin: r.origem || r.origin || "",
  }));

  const totalValue = restrictions.reduce((s: number, r: any) => s + parseFloat(r.value || "0"), 0);

  const { riskLevel, riskLabel, recommendation } = getRiskInfo(score);

  return {
    cpfCnpj,
    cadastralData: {
      nome,
      cpfCnpj,
      dataNascimento: resultado.dataNascimento || resultado.nascimento,
      nomeMae: resultado.nomeMae,
      situacaoRf: resultado.situacaoRf || resultado.situacao || (hasRestrictions ? "Com restricoes" : "Regular"),
      obitoRegistrado: resultado.obito === true,
      tipo: isPF ? "PF" : "PJ",
    },
    score,
    riskLevel,
    riskLabel,
    recommendation,
    status: hasRestrictions ? "restricted" : "clean",
    restrictions,
    totalRestrictions: totalValue,
    previousConsultations: {
      total: resultado.consultasAnteriores || 0,
      last90Days: resultado.consultas90dias || 0,
      bySegment: {},
    },
    alerts: [],
    rawHtml: resultado.html,
  };
}

function getRiskInfo(score: number): { riskLevel: string; riskLabel: string; recommendation: string } {
  if (score >= 901) return { riskLevel: "very_low", riskLabel: "Risco Muito Baixo", recommendation: "Aprovar" };
  if (score >= 701) return { riskLevel: "low", riskLabel: "Risco Baixo", recommendation: "Aprovar" };
  if (score >= 501) return { riskLevel: "medium", riskLabel: "Risco Medio", recommendation: "Aprovar com ressalvas" };
  if (score >= 301) return { riskLevel: "high", riskLabel: "Risco Alto", recommendation: "Analisar com cautela" };
  return { riskLevel: "very_high", riskLabel: "Risco Muito Alto", recommendation: "Recusar" };
}
