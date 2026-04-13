/**
 * SPC Service — Integração direta com SPC Brasil via SOAP/WSDL
 *
 * Endpoint: https://servicos.spc.org.br/spc/remoting/ws/consulta/consultaWebService
 * Auth: Basic Auth (base64 username:password)
 * Protocolo: SOAP 1.1 com XML envelope
 * Produto: 257 (consulta padrão)
 */

import { logger } from "../logger";
import { CircuitBreaker, withResilience } from "../erp/resilience";

// ── Environment ──────────────────────────────────────────────────────────────

const SPC_WSDL_URL = process.env.SPC_WSDL_URL || "https://servicos.spc.org.br/spc/remoting/ws/consulta/consultaWebService";
const SPC_USERNAME = process.env.SPC_USERNAME || "";
const SPC_PASSWORD = process.env.SPC_PASSWORD || "";
const SPC_PRODUCT_CODE = process.env.SPC_PRODUCT_CODE || "257";
const SPC_ENABLED = !!(SPC_USERNAME && SPC_PASSWORD);

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
  rawXml?: string;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function isSpcConfigured(): boolean {
  return SPC_ENABLED;
}

/**
 * Consultar SPC Brasil via SOAP
 * @param cpfCnpj CPF ou CNPJ
 * @param codigoProduto Código do produto SPC (default: 257)
 */
export async function consultarSpc(
  cpfCnpj: string,
  _cnpjProvedor?: string,
  codigoProduto?: number,
): Promise<SpcResult> {
  if (!SPC_ENABLED) {
    throw new Error("SPC nao configurado. Defina SPC_USERNAME e SPC_PASSWORD no .env");
  }

  const cleanDoc = cpfCnpj.replace(/\D/g, "");
  const tipoConsumidor = cleanDoc.length === 11 ? "F" : "J";
  const produto = codigoProduto || parseInt(SPC_PRODUCT_CODE) || 257;

  logger.info({ doc: cleanDoc.slice(0, 3) + "***", produto, tipo: tipoConsumidor }, "[SPC] Consulta iniciada");

  const soapBody = buildSoapEnvelope(produto, tipoConsumidor, cleanDoc);
  const auth = Buffer.from(`${SPC_USERNAME}:${SPC_PASSWORD}`).toString("base64");

  const xmlResponse = await withResilience(
    async () => {
      const response = await fetch(SPC_WSDL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "Authorization": `Basic ${auth}`,
          "SOAPAction": "consultar",
        },
        body: soapBody,
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`SPC API HTTP ${response.status}: ${errText.slice(0, 500)}`);
      }

      return response.text();
    },
    { retries: 2, minTimeout: 2000, circuit: spcCircuit },
  );

  logger.info({ responseLength: xmlResponse.length }, "[SPC] Resposta recebida");

  return parseXmlResponse(cleanDoc, xmlResponse);
}

// ── SOAP Envelope ────────────────────────────────────────────────────────────

function buildSoapEnvelope(codigoProduto: number, tipoConsumidor: string, documento: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://webservice.consulta.spcjava.spcbrasil.org/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:filtro>
      <codigo-produto>${codigoProduto}</codigo-produto>
      <tipo-consumidor>${tipoConsumidor}</tipo-consumidor>
      <documento-consumidor>${documento}</documento-consumidor>
    </web:filtro>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ── XML Parser (sem dependencia externa) ─────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

function extractAllTags(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function extractTagValue(xml: string, tag: string): string {
  // Handles both <tag>value</tag> and <tag><valor>value</valor></tag>
  const content = extractTag(xml, tag);
  if (!content) return "";
  // Se contem sub-tags, extrair <valor> ou <descricao>
  if (content.includes("<")) {
    return extractTag(content, "valor") || extractTag(content, "descricao") || extractTag(content, "nome") || content.replace(/<[^>]+>/g, "").trim();
  }
  return content;
}

// ── Response Parser ──────────────────────────────────────────────────────────

function parseXmlResponse(cpfCnpj: string, xml: string): SpcResult {
  const isPF = cpfCnpj.length <= 11;

  // Extract main data from SOAP response
  const body = extractTag(xml, "soapenv:Body") || extractTag(xml, "soap:Body") || extractTag(xml, "S:Body") || xml;
  const resultado = extractTag(body, "return") || extractTag(body, "resultado") || body;

  // Nome do consumidor
  const nome = extractTagValue(resultado, "nome-consumidor")
    || extractTagValue(resultado, "nome")
    || extractTagValue(resultado, "razao-social")
    || "Consulta SPC";

  // Score
  const scoreStr = extractTagValue(resultado, "score")
    || extractTagValue(resultado, "pontuacao")
    || extractTagValue(resultado, "classe-risco");
  const score = parseInt(scoreStr) || 0;

  // Data nascimento
  const dataNasc = extractTagValue(resultado, "data-nascimento")
    || extractTagValue(resultado, "nascimento");

  // Nome da mae
  const nomeMae = extractTagValue(resultado, "nome-mae");

  // Situacao RF
  const situacaoRf = extractTagValue(resultado, "situacao-documento")
    || extractTagValue(resultado, "situacao");

  // Obito
  const obitoStr = extractTagValue(resultado, "indicador-obito") || extractTagValue(resultado, "obito");
  const obitoRegistrado = obitoStr === "S" || obitoStr === "true" || obitoStr === "1";

  // Restricoes / ocorrencias
  const restrictions: SpcResult["restrictions"] = [];
  const ocorrencias = extractAllTags(resultado, "ocorrencia");

  for (const occ of ocorrencias) {
    const tipo = extractTagValue(occ, "tipo-ocorrencia") || extractTagValue(occ, "tipo") || "DEBITO";
    const informante = extractTagValue(occ, "nome-informante") || extractTagValue(occ, "informante") || "";
    const valor = extractTagValue(occ, "valor") || extractTagValue(occ, "valor-ocorrencia") || "0";
    const data = extractTagValue(occ, "data-ocorrencia") || extractTagValue(occ, "data-inclusao") || "";
    const origem = extractTagValue(occ, "origem") || extractTagValue(occ, "cidade-associado") || "";
    const motivo = extractTagValue(occ, "motivo") || extractTagValue(occ, "descricao") || "";
    const vencimento = extractTagValue(occ, "data-vencimento") || "";

    const numValor = parseFloat(valor.replace(/[^\d.,]/g, "").replace(",", ".")) || 0;

    restrictions.push({
      type: mapTipoOcorrencia(tipo),
      description: motivo || `${mapTipoOcorrencia(tipo)} - ${informante}`,
      severity: numValor > 1000 ? "high" : numValor > 0 ? "medium" : "low",
      creditor: informante || "Nao informado",
      value: String(numValor.toFixed(2)),
      date: data || vencimento || "",
      origin: origem,
    });
  }

  // Alertas
  const alertas = extractAllTags(resultado, "alerta");
  const alerts = alertas.map(a => ({
    type: "ALERTA",
    message: extractTagValue(a, "descricao") || extractTagValue(a, "mensagem") || a.replace(/<[^>]+>/g, "").trim(),
    severity: "medium" as const,
  }));

  // Consultas anteriores
  const qtdConsultas = parseInt(extractTagValue(resultado, "quantidade-consulta-anterior") || "0") || 0;
  const qtdConsultas90 = parseInt(extractTagValue(resultado, "quantidade-consulta-90-dias") || "0") || 0;

  // Total valor restricoes
  const totalValue = restrictions.reduce((s, r) => s + parseFloat(r.value || "0"), 0);

  // Status
  const hasRestrictions = restrictions.length > 0;
  const status = hasRestrictions ? "restricted" : "clean";

  // Risk
  const { riskLevel, riskLabel, recommendation } = score > 0
    ? getRiskInfo(score)
    : getSyntheticRisk(restrictions);

  const result: SpcResult = {
    cpfCnpj,
    cadastralData: {
      nome,
      cpfCnpj,
      dataNascimento: dataNasc || undefined,
      nomeMae: nomeMae || undefined,
      situacaoRf: situacaoRf || (hasRestrictions ? "Com restricoes" : "Regular"),
      obitoRegistrado,
      tipo: isPF ? "PF" : "PJ",
    },
    score: score || (hasRestrictions ? 300 : 850),
    riskLevel,
    riskLabel,
    recommendation,
    status,
    restrictions,
    totalRestrictions: totalValue,
    previousConsultations: { total: qtdConsultas, last90Days: qtdConsultas90, bySegment: {} },
    alerts,
    rawXml: xml,
  };

  logger.info(
    { score: result.score, riskLevel, restrictions: restrictions.length },
    "[SPC] Consulta parseada",
  );

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIPO_MAP: Record<string, string> = {
  "100": "DEBITO", "105": "CHEQUE", "110": "ALERTA",
  "115": "DEVOLUCAO_CHEQUE", "120": "PENDENCIA_FINANCEIRA",
  "150": "PROTESTO", "155": "ACAO_JUDICIAL",
  "160": "FALENCIA", "170": "REFIN", "180": "CCF", "185": "PEFIN",
};

function mapTipoOcorrencia(tipo: string): string {
  return TIPO_MAP[tipo] || tipo;
}

function getRiskInfo(score: number): { riskLevel: string; riskLabel: string; recommendation: string } {
  if (score >= 901) return { riskLevel: "very_low", riskLabel: "Risco Muito Baixo", recommendation: "Aprovar" };
  if (score >= 701) return { riskLevel: "low", riskLabel: "Risco Baixo", recommendation: "Aprovar" };
  if (score >= 501) return { riskLevel: "medium", riskLabel: "Risco Medio", recommendation: "Aprovar com ressalvas" };
  if (score >= 301) return { riskLevel: "high", riskLabel: "Risco Alto", recommendation: "Analisar com cautela" };
  return { riskLevel: "very_high", riskLabel: "Risco Muito Alto", recommendation: "Recusar" };
}

function getSyntheticRisk(restrictions: SpcResult["restrictions"]): { riskLevel: string; riskLabel: string; recommendation: string } {
  if (restrictions.length === 0) return { riskLevel: "very_low", riskLabel: "Nada Consta", recommendation: "Aprovar" };
  const total = restrictions.reduce((s, r) => s + parseFloat(r.value || "0"), 0);
  if (restrictions.length <= 2 && total < 1000) return { riskLevel: "high", riskLabel: "Risco Alto", recommendation: "Analisar com cautela" };
  return { riskLevel: "very_high", riskLabel: "Risco Muito Alto", recommendation: "Recusar" };
}
