import { randomInt } from "crypto";
import { XMLParser } from "fast-xml-parser";
import { withResilience, CircuitBreaker } from "../erp/resilience";
import { logger } from "../logger";

// ── Environment ──────────────────────────────────────────────────────────────

const SPC_API_URL = process.env.SPC_API_URL || "https://webservice.mma.com.br/sivng/webservice/ws_spc.php";
const SPC_API_TOKEN = process.env.SPC_API_TOKEN || "";
const SPC_PRODUCT_CODE = process.env.SPC_PRODUCT_CODE || "";
const SPC_ENABLED = process.env.SPC_API_ENABLED === "true";

// ── Circuit breaker for SPC API ──────────────────────────────────────────────

const spcCircuit = new CircuitBreaker({ maxFailures: 3, resetTimeMs: 60_000 });

// ── XML Parser ───────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: false,
  trimValues: true,
});

// ── Mappings ─────────────────────────────────────────────────────────────────

const OCCURRENCE_TYPE_NAMES: Record<string, string> = {
  "100": "DEBITO",
  "105": "CHEQUE",
  "110": "ALERTA",
  "115": "DEVOLUCAO_CHEQUE",
  "120": "PENDENCIA_FINANCEIRA",
  "150": "PROTESTO",
  "155": "ACAO_JUDICIAL",
  "160": "FALENCIA_CONCORDATA",
  "165": "EMPRESA_FALIDA",
  "170": "REFIN",
  "175": "ACHEI",
  "180": "CCF",
  "185": "PEFIN",
  "210": "CREDISCORE",
  "220": "CREDISCORE_SERVER",
  "230": "CREDISCORE_PLANO",
};

const OCCURRENCE_SEVERITY: Record<string, string> = {
  "100": "high",
  "105": "high",
  "110": "medium",
  "115": "high",
  "120": "high",
  "150": "critical",
  "155": "critical",
  "160": "critical",
  "165": "critical",
  "170": "high",
  "175": "medium",
  "180": "high",
  "185": "high",
};

const MOTIVO_DESCRIPTIONS: Record<string, string> = {
  "01": "Crediario",
  "02": "Credito pessoal",
  "03": "Cartao de credito",
  "06": "Aluguel",
  "07": "Condominio",
  "08": "Taxas",
  "09": "Reparos",
  "11": "Cheque sem fundos - 1a apresentacao",
  "12": "Cheque sem fundos - 2a apresentacao",
  "13": "Conta encerrada",
  "14": "Pratica espuria",
  "20": "Cheque cancelado por solicitacao",
  "21": "Contra-ordem ao pagamento",
  "22": "Divergencia de assinatura",
  "24": "Bloqueio judicial",
  "25": "Cancelamento talonario pelo banco",
  "28": "Contra-ordem por furto/roubo",
  "29": "Talao bloqueado",
  "30": "Cancelamento por furto/roubo de malote",
  "31": "Erro formal",
  "43": "Cheque devolvido anteriormente",
  "44": "Cheque prescrito",
  "47": "Ausencia de dados obrigatorios",
  "48": "Cheque superior a R$100 sem identificacao",
  "49": "Reapresentacao cheque devolvido",
};

const SPC_STATUS_ERRORS: Record<string, string> = {
  "900": "Acesso nao permitido. Token invalido ou servico nao contratado.",
  "901": "CPF/CNPJ com quantidade de digitos incorreta.",
  "902": "Codigo do produto SPC invalido.",
  "903": "NSU com mais de 10 digitos.",
  "904": "Codigo do produto nao e um numero inteiro valido.",
  "905": "Tipo de consulta incorreto.",
  "906": "ID de solicitacao ja utilizado em outra consulta.",
  "907": "CPF/CNPJ informado difere do retornado na consulta.",
  "908": "Valor da transacao invalido.",
  "909": "ID de solicitacao difere do retornado.",
  "910": "Produto SPC nao homologado para utilizacao.",
  "999": "Erro nao catalogado no SPC.",
};

// ── Types ────────────────────────────────────────────────────────────────────

interface ParsedOccurrence {
  tpocorrencia: string;
  dcinformante: string;
  dcorigem: string;
  cdmotocorrencia: string;
  dtocorrencia: string;
  dtvencimento: string;
  vlocorrencia: number;
  tpdevedor: string;
}

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
}

// ── Public API ───────────────────────────────────────────────────────────────

export function isSpcConfigured(): boolean {
  return SPC_ENABLED && !!SPC_API_TOKEN && SPC_API_TOKEN.length >= 10 && !!SPC_PRODUCT_CODE;
}

export async function consultarSpc(cpfCnpj: string, _retryCount = 0): Promise<SpcResult> {
  if (!isSpcConfigured()) {
    throw new Error("SPC nao configurado. Verifique as variaveis de ambiente.");
  }

  // Generate unique idsolicitacao (Date.now + crypto.randomInt — MUST never repeat)
  const idsolicitacao = `${Date.now()}${randomInt(1000, 9999)}`;

  const url = new URL(SPC_API_URL);
  url.searchParams.set("method", "SPCConsultaAnalitica");
  url.searchParams.set("token", SPC_API_TOKEN);
  url.searchParams.set("idsolicitacao", idsolicitacao);
  url.searchParams.set("nocnpjcpf", cpfCnpj);
  url.searchParams.set("cdprodutospc", SPC_PRODUCT_CODE);
  url.searchParams.set("vltransacao", "0.00");

  logger.info({ idsolicitacao }, "SPC consultation started");

  const xmlText = await withResilience(
    async () => {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "ConsultaISP/1.0",
          "Accept": "application/xml, text/xml",
        },
      });

      if (!response.ok) {
        const err = new Error(`SPC API HTTP ${response.status}`);
        (err as any).statusCode = response.status;
        throw err;
      }

      return response.text();
    },
    { retries: 2, minTimeout: 2000, circuit: spcCircuit },
  );

  const parsed = xmlParser.parse(xmlText);
  const spc = parsed?.spc;

  if (!spc) {
    throw new Error("Resposta SPC invalida: elemento <spc> nao encontrado");
  }

  const statusCode = String(spc.cdstatusconsulta || "");

  // Handle error 906 (duplicate idsolicitacao) — retry once with new ID
  if (statusCode === "906") {
    if (_retryCount >= 2) {
      throw new Error("Erro SPC: ID de solicitacao duplicado apos 3 tentativas. Tente novamente.");
    }
    logger.warn({ attempt: _retryCount + 1 }, "SPC idsolicitacao duplicado, retentando com novo ID");
    return consultarSpc(cpfCnpj, _retryCount + 1);
  }

  if (statusCode !== "100") {
    const errorMsg = SPC_STATUS_ERRORS[statusCode] || `Erro SPC desconhecido (status ${statusCode})`;
    throw new Error(`Erro SPC: ${errorMsg}`);
  }

  // Parse occurrences
  const occurrences = parseOccurrences(spc);
  const situacao = parseInt(String(spc.tpsitconsulta || "1"), 10);

  // Calculate score and risk
  const score = calculateSyntheticScore(situacao, occurrences);
  const { riskLevel, riskLabel, recommendation } = getRiskInfo(score);

  // Build status description
  const status = situacao === 1 ? "clean" : "restricted";

  // Calculate total monetary value of restrictions
  const restrictionOccurrences = occurrences.filter(o => !["110", "210", "220", "230"].includes(o.tpocorrencia));
  const totalRestrictionsValue = restrictionOccurrences.reduce((sum, o) => sum + (o.vlocorrencia || 0), 0);

  // Build restrictions from occurrences (excluding alerts and crediscore types)
  const restrictions = restrictionOccurrences
    .map(o => ({
      type: OCCURRENCE_TYPE_NAMES[o.tpocorrencia] || `TIPO_${o.tpocorrencia}`,
      description: buildOccurrenceDescription(o),
      severity: OCCURRENCE_SEVERITY[o.tpocorrencia] || "medium",
      creditor: o.dcinformante || "Nao informado",
      value: o.vlocorrencia ? o.vlocorrencia.toFixed(2) : "0.00",
      date: o.dtocorrencia || "N/A",
      origin: o.dcorigem || "N/A",
    }));

  // Build alerts from type 110 (ALERTA) occurrences
  const alerts = occurrences
    .filter(o => o.tpocorrencia === "110")
    .map(o => ({
      type: "ALERTA",
      message: buildOccurrenceDescription(o),
      severity: "medium",
    }));

  const result: SpcResult = {
    cpfCnpj,
    cadastralData: {
      nome: "Consulta SPC",
      cpfCnpj,
      situacaoRf: situacao === 1 ? "Regular" : "Com restricoes",
      obitoRegistrado: false,
      tipo: cpfCnpj.length === 11 ? "PF" : "PJ",
    },
    score,
    riskLevel,
    riskLabel,
    recommendation,
    status,
    restrictions,
    totalRestrictions: totalRestrictionsValue,
    previousConsultations: { total: 0, last90Days: 0, bySegment: {} },
    alerts,
  };

  logger.info(
    { score, riskLevel, totalRestrictions: restrictions.length, statusCode },
    "SPC consultation completed",
  );

  return result;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function parseOccurrences(spc: any): ParsedOccurrence[] {
  if (!spc.ocorrencia) return [];

  const raw = Array.isArray(spc.ocorrencia) ? spc.ocorrencia : [spc.ocorrencia];

  return raw.map((o: any) => ({
    tpocorrencia: String(o.tpocorrencia || ""),
    dcinformante: String(o.dcinformante || ""),
    dcorigem: String(o.dcorigem || ""),
    cdmotocorrencia: String(o.cdmotocorrencia || ""),
    dtocorrencia: String(o.dtocorrencia || ""),
    dtvencimento: String(o.dtvencimento || ""),
    vlocorrencia: parseFloat(String(o.vlocorrencia || "0")) || 0,
    tpdevedor: String(o.tpdevedor || ""),
  }));
}

function buildOccurrenceDescription(o: ParsedOccurrence): string {
  const typeName = OCCURRENCE_TYPE_NAMES[o.tpocorrencia] || `Tipo ${o.tpocorrencia}`;
  const motivo = MOTIVO_DESCRIPTIONS[o.cdmotocorrencia];
  const parts = [typeName];
  if (motivo) parts.push(`- ${motivo}`);
  if (o.dcinformante) parts.push(`(${o.dcinformante})`);
  if (o.vlocorrencia > 0) parts.push(`R$ ${o.vlocorrencia.toFixed(2)}`);
  if (o.dtvencimento) parts.push(`venc. ${o.dtvencimento}`);
  return parts.join(" ");
}

function calculateSyntheticScore(situacao: number, occurrences: ParsedOccurrence[]): number {
  // If there's a CREDISCORE occurrence, use its value directly
  const crediscore = occurrences.find(o => ["210", "220", "230"].includes(o.tpocorrencia));
  if (crediscore && crediscore.vlocorrencia) {
    return Math.min(1000, Math.max(0, Math.round(crediscore.vlocorrencia)));
  }

  // Synthetic score based on situation
  if (situacao === 1) return 850; // NADA CONSTA

  // Filter real restriction occurrences (exclude alertas 110 and crediscore 210+)
  const restrictions = occurrences.filter(o => !["110", "210", "220", "230"].includes(o.tpocorrencia));

  if (situacao === 3 && restrictions.length === 0) return 550; // Only alerts

  // Has restrictions — calculate based on count, total value, and severity
  const totalValue = restrictions.reduce((sum, o) => sum + (o.vlocorrencia || 0), 0);
  const hasCONCENTRE = restrictions.some(o => {
    const code = parseInt(o.tpocorrencia);
    return code >= 150 && code <= 185;
  });

  let score: number;
  if (restrictions.length === 1 && totalValue < 500) score = 400;
  else if (restrictions.length <= 3 && totalValue <= 5000) score = 300;
  else score = 150;

  if (hasCONCENTRE) score = Math.max(50, score - 100);

  return score;
}

function getRiskInfo(score: number): { riskLevel: string; riskLabel: string; recommendation: string } {
  if (score >= 901) return { riskLevel: "very_low", riskLabel: "Risco Muito Baixo", recommendation: "Aprovar" };
  if (score >= 701) return { riskLevel: "low", riskLabel: "Risco Baixo", recommendation: "Aprovar" };
  if (score >= 501) return { riskLevel: "medium", riskLabel: "Risco Medio", recommendation: "Aprovar com ressalvas" };
  if (score >= 301) return { riskLevel: "high", riskLabel: "Risco Alto", recommendation: "Analisar com cautela" };
  return { riskLevel: "very_high", riskLabel: "Risco Muito Alto", recommendation: "Recusar" };
}
