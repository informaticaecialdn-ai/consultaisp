/**
 * A FICHA 360 DO CLIENTE — as fórmulas do Provedor.ai, portadas ao pé da letra.
 *
 * Decisão do dono (05/09/2026): o Cliente 360 daqui é "exatamente igual" ao
 * do Provedor.ai. Este módulo carrega o que lá vive em `packages/cliente360`
 * (health), `apps/api/src/shared/cobranca/selo-pagamento.ts` (selo),
 * `packages/scoring/src/propensao*.ts` (propensão) e
 * `modules/cobranca/cliente360/domain.ts` (metas, risco, resumo, prescrição).
 * Nomes, limiares e arredondamentos são os de lá; o que muda é só de onde
 * vem o insumo — e insumo que esta base não tem entra como `null`/`hadData:
 * false`, nunca como zero disfarçado.
 *
 * Módulo puro: sem banco, sem React, sem I/O.
 */

/* ── Tons (os seis do Provedor.ai; aqui `now` = --info, `future` = --ok, `care` = --danger) ── */

export type Tom360 = "ok" | "now" | "past" | "gold" | "care" | "future";

/* ── Health score — packages/cliente360/src/{dimension-scores,health}.ts ── */

export const NEUTRAL_SCORE = 50;
export const PESOS_HEALTH = { financeiro: 0.4, tecnico: 0.3, relacionamento: 0.3 } as const;

const clamp100 = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : Math.round(v));

/** Sem dívida → 100 (não NEUTRAL). Penalidades com teto: atraso 60, faturas 30, razão dívida/ticket 30. */
export function deriveFinancialScore(p: { faturasEmAberto: number; valorEmAberto: number; valorMensal: number; diasAtrasoMax: number }): number {
  if (p.faturasEmAberto <= 0) return 100;
  const atrasoPenalty = Math.min((p.diasAtrasoMax / 90) * 60, 60);
  const faturasPenalty = Math.min(p.faturasEmAberto * 10, 30);
  const ratioPenalty = p.valorMensal > 0 ? Math.min((p.valorEmAberto / p.valorMensal) * 10, 30) : 0;
  return clamp100(100 - atrasoPenalty - faturasPenalty - ratioPenalty);
}

/** Sem equipamento algum = SEM DADO → 50. Extraviado penaliza 40 cada, teto 80. */
export function deriveTechnicalScore(p: { equipamentosAtivos: number; equipamentosExtraviados: number }): number {
  if (p.equipamentosAtivos === 0 && p.equipamentosExtraviados === 0) return NEUTRAL_SCORE;
  return clamp100(100 - Math.min(p.equipamentosExtraviados * 40, 80));
}

/** NPS é o sinal primário (−100..+100 → 0..100); CSAT o secundário; sem os dois, NEUTRAL ajustado pela atividade. */
export function deriveRelationshipScore(p: { comunicacoes30d: number; totalComunicacoes: number; nps?: number; csatRecente?: { classe: string } }): number {
  if (p.nps !== undefined) {
    const base = (p.nps + 100) / 2;
    if (p.csatRecente !== undefined) {
      if (p.csatRecente.classe === "insatisfeito") return clamp100(base - 10);
      if (p.csatRecente.classe === "satisfeito") return clamp100(base + 5);
    }
    return clamp100(base);
  }
  if (p.csatRecente !== undefined) {
    if (p.csatRecente.classe === "satisfeito") return clamp100(NEUTRAL_SCORE + 15);
    if (p.csatRecente.classe === "insatisfeito") return clamp100(NEUTRAL_SCORE - 20);
    return clamp100(NEUTRAL_SCORE);
  }
  let score = NEUTRAL_SCORE;
  if (p.comunicacoes30d >= 3) score += 10;
  else if (p.comunicacoes30d >= 1) score += 5;
  if (p.totalComunicacoes === 0) score -= 5;
  return clamp100(score);
}

export type HealthBand = "saudavel" | "atencao" | "risco" | "critico";

export function computeHealthScore(i: { health_financial: number; health_technical: number; health_relationship: number }): { health_score: number; health_band: HealthBand } {
  const raw = PESOS_HEALTH.financeiro * i.health_financial + PESOS_HEALTH.tecnico * i.health_technical + PESOS_HEALTH.relacionamento * i.health_relationship;
  const health_score = Math.round(raw);
  return { health_score, health_band: healthBandOf(health_score) };
}

export function healthBandOf(h: number, band?: string | null): HealthBand {
  const b = band?.toLowerCase();
  if (b === "saudavel" || b === "atencao" || b === "risco" || b === "critico") return b;
  if (h >= 75) return "saudavel";
  if (h >= 50) return "atencao";
  if (h >= 25) return "risco";
  return "critico";
}

export function healthLabelMeta(h: number, band?: string | null): { label: string; tone: Tom360 } {
  const b = healthBandOf(h, band);
  if (b === "saudavel") return { label: "Saudável", tone: "ok" };
  if (b === "atencao") return { label: "Atenção", tone: "gold" };
  if (b === "risco") return { label: "Risco", tone: "past" };
  return { label: "Crítico", tone: "past" };
}

/* ── Selo de pagamento — apps/api/src/shared/cobranca/selo-pagamento.ts ── */

export const PCT_PONTUAL = 90;
export const MESES_NOVO = 3;

export type TipoDeSelo = "inadimplente" | "novo" | "pontual" | "paga_atrasado" | "em_dia";
export interface SeloPagamento { tipo: TipoDeSelo; rotulo: string; tom: Tom360; motivo: string }

/** Ordem: estado atual > sem histórico > comportamento histórico > em dia. `emAberto` é o VENCIDO. */
export function classificarSeloPagamento(i: { emAberto: number; atraso: number; pagas: number; pctEmDia: number | null; mesesCliente: number | null }): SeloPagamento {
  const { emAberto, atraso, pagas, pctEmDia, mesesCliente } = i;
  if (emAberto > 0) {
    return { tipo: "inadimplente", rotulo: "Inadimplente", tom: "past", motivo: atraso > 0 ? `${atraso} dias em atraso` : "fatura vencida em aberto" };
  }
  if (pagas <= 0) {
    const veterano = mesesCliente != null && mesesCliente >= MESES_NOVO;
    return {
      tipo: "novo",
      rotulo: veterano ? "Sem histórico" : "Novo",
      tom: "now",
      motivo: veterano
        ? "pagamentos ainda não sincronizados do ERP"
        : mesesCliente != null ? `${mesesCliente} ${mesesCliente === 1 ? "mês" : "meses"} de casa` : "sem histórico de pagamento ainda",
    };
  }
  if (pctEmDia != null) {
    if (pctEmDia >= PCT_PONTUAL) return { tipo: "pontual", rotulo: "Pontual", tom: "ok", motivo: `${Math.round(pctEmDia)}% pagas em dia (${pagas})` };
    return { tipo: "paga_atrasado", rotulo: "Paga atrasado", tom: "gold", motivo: `${Math.round(pctEmDia)}% em dia de ${pagas} faturas` };
  }
  return { tipo: "em_dia", rotulo: "Em dia", tom: "ok", motivo: `${pagas} pagas · sem débito` };
}

/* ── Propensão a pagar — packages/scoring/src/propensao*.ts ── */

export const PROPENSAO_WEIGHTS = { creditoBase: 0.45, valorVsTicket: 0.15, posicaoCiclo: 0.15, responsividade: 0.15, sazonalidade: 0.1 } as const;
export const PROPENSAO_BAND_THRESHOLDS = { alta: 66, media: 33 } as const;
const DECAY_TAU = 40;
const DECAY_AMPLITUDE = 0.85;
const DECAY_FLOOR = 0.05;
const NEUTRAL_FACTOR = 0.5;

export type SinalDePropensao = keyof typeof PROPENSAO_WEIGHTS;
export interface PropensaoInput {
  creditScore0a1000: number | null;
  valorDivida: number;
  valorMensal: number;
  diasAtraso: number;
  /** Contatos feitos (saída) e respostas (entrada) nos últimos 90 dias. */
  contatos: number;
  respostas: number;
  /** ISO `YYYY-MM-DD`. */
  hoje: string;
  diaPagamentoPreferido: number | null;
}
export interface FatorDePropensao { factor: SinalDePropensao; normalized: number; weight: number; contribution: number; hadData: boolean }
export interface Propensao { score: number; band: "alta" | "media" | "baixa"; fatores: FatorDePropensao[] }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function sinaisDePropensao(i: PropensaoInput): Record<SinalDePropensao, { normalized: number; hadData: boolean }> {
  const creditoBase = i.creditScore0a1000 === null
    ? { normalized: NEUTRAL_FACTOR, hadData: false }
    : { normalized: clamp01(i.creditScore0a1000 / 1000), hadData: true };
  const valorVsTicket = i.valorMensal <= 0
    ? { normalized: NEUTRAL_FACTOR, hadData: false }
    : { normalized: clamp01(1 - (i.valorDivida / i.valorMensal) / 3), hadData: true };
  const posicaoCiclo = {
    normalized: i.diasAtraso <= 0 ? 0.9 : Math.max(DECAY_FLOOR, DECAY_AMPLITUDE * Math.exp(-i.diasAtraso / DECAY_TAU)),
    hadData: true,
  };
  const responsividade = i.contatos === 0
    ? { normalized: NEUTRAL_FACTOR, hadData: false }
    : { normalized: clamp01(i.respostas / i.contatos), hadData: true };
  const dia = Number(i.hoje.slice(8, 10)) || 1;
  let saz: number;
  if (i.diaPagamentoPreferido !== null) {
    const diff = Math.abs(dia - i.diaPagamentoPreferido);
    const circular = Math.min(diff, 30 - diff);
    saz = clamp01(1 - (circular / 15) * 0.7);
  } else {
    saz = dia <= 10 ? 0.8 : dia <= 20 ? 0.5 : 0.3;
  }
  return { creditoBase, valorVsTicket, posicaoCiclo, responsividade, sazonalidade: { normalized: saz, hadData: true } };
}

/** Pesos re-normalizados só sobre os sinais com dado; nenhum sinal com dado → neutro. */
export function computePropensao(i: PropensaoInput): Propensao {
  const sinais = sinaisDePropensao(i);
  const keys = Object.keys(PROPENSAO_WEIGHTS) as SinalDePropensao[];
  const activeWeightSum = keys.reduce((s, k) => s + (sinais[k].hadData ? PROPENSAO_WEIGHTS[k] : 0), 0);
  const raw = activeWeightSum > 0
    ? keys.reduce((s, k) => s + (sinais[k].hadData ? sinais[k].normalized * PROPENSAO_WEIGHTS[k] : 0), 0) / activeWeightSum
    : NEUTRAL_FACTOR;
  const score = Math.round(clamp01(raw) * 100);
  const fatores = keys.map(k => {
    const effWeight = activeWeightSum === 0 ? PROPENSAO_WEIGHTS[k] : sinais[k].hadData ? PROPENSAO_WEIGHTS[k] / activeWeightSum : 0;
    return { factor: k, normalized: sinais[k].normalized, weight: effWeight, contribution: Math.round(sinais[k].normalized * effWeight * 100), hadData: sinais[k].hadData };
  });
  return { score, band: score >= PROPENSAO_BAND_THRESHOLDS.alta ? "alta" : score >= PROPENSAO_BAND_THRESHOLDS.media ? "media" : "baixa", fatores };
}

/* ── Metas de exibição — cliente360/domain.ts ── */

export const DASH = "—";

export function bandLabel(band: string | null | undefined): string {
  if (!band) return DASH;
  return band.replace(/_/g, " ");
}

export function clienteStatusMeta(raw: string | null | undefined): { label: string; tone: Tom360 } | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s === "ex-cliente" || s === "cancelado" || s === "cancelled" || s === "rescindido" || s === "inativo") return { label: "Ex-cliente", tone: "past" };
  if (s === "suspenso" || s === "suspended") return { label: "Suspenso", tone: "gold" };
  if (s === "em-cobrança" || s === "em-cobranca" || s === "inadimplente") return { label: "Em cobrança", tone: "gold" };
  if (s === "ativo" || s === "ativa" || s === "active") return { label: "Ativo", tone: "ok" };
  return { label: raw, tone: "now" };
}

export function dnaToneOf(dna: string): Tom360 {
  const l = dna.charAt(0).toUpperCase();
  if (l === "A") return "ok";
  if (l === "B") return "gold";
  return "past";
}

export function npsClasseMeta(classe: string): { tone: Tom360; label: string } {
  const c = classe.toLowerCase();
  if (c === "promotor") return { tone: "ok", label: "Promotor" };
  if (c === "detrator") return { tone: "past", label: "Detrator" };
  return { tone: "gold", label: "Neutro" };
}

export function csatClasseMeta(classe: string): { tone: Tom360; label: string } {
  const c = classe.toLowerCase();
  if (c === "satisfeito") return { tone: "ok", label: "Satisfeito" };
  if (c === "insatisfeito") return { tone: "past", label: "Insatisfeito" };
  return { tone: "gold", label: "Neutro" };
}

/** Banda do score de crédito (0–1000) → cor, como `<ScoreMini>` do Provedor.ai. */
export function corDaBandaDeCredito(score: number | null, band: string | null): "success" | "warning" | "danger" | "muted" {
  if (score == null || band == null) return "muted";
  if (band === "bom" || band === "excelente" || band === "baixo_risco" || band === "muito_baixo_risco" || band === "low") return "success";
  if (band === "regular" || band === "medio" || band === "medium") return "warning";
  return "danger";
}

/* ── Prescrição CC 206 §5º — apps/api/src/routes/cliente360.ts:822-844 ── */

export interface Prescricao360 { fatura_mais_antiga: string; data_prescricao: string; prescrita: boolean; dias_restantes: number }

const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Sem fatura a fatura, a mais antiga vencida é `hoje − diasAtraso`; a
 * prescrição é cinco anos depois dela. `null` sem dívida vencida.
 */
export function prescricaoPorAtraso(diasAtraso: number, hoje: Date): Prescricao360 | null {
  if (diasAtraso <= 0) return null;
  const maisAntiga = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - diasAtraso);
  const dataPrescricao = new Date(maisAntiga.getFullYear() + 5, maisAntiga.getMonth(), maisAntiga.getDate());
  const diasRestantes = Math.ceil((dataPrescricao.getTime() - hoje.getTime()) / 86_400_000);
  return { fatura_mais_antiga: isoDia(maisAntiga), data_prescricao: isoDia(dataPrescricao), prescrita: diasRestantes <= 0, dias_restantes: Math.max(diasRestantes, 0) };
}

/* ── Projeção de risco do próximo vencimento — domain.ts:298-335 ── */

export interface ProjecaoRisco360 { vencimento: string; valor: number; risco_pct: number | null; fonte: "propensao" | "historico" | null }

export function projecaoRisco(i: { aVencer: Array<{ vencimento: string; total: number }>; propensao: number | null | undefined; pctEmDia: number | null | undefined }): ProjecaoRisco360 | null {
  if (i.aVencer.length === 0) return null;
  const prox = i.aVencer.reduce((a, b) => (a.vencimento <= b.vencimento ? a : b));
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  if (i.propensao !== null && i.propensao !== undefined) return { vencimento: prox.vencimento, valor: prox.total, risco_pct: clamp(100 - i.propensao), fonte: "propensao" };
  if (i.pctEmDia !== null && i.pctEmDia !== undefined) return { vencimento: prox.vencimento, valor: prox.total, risco_pct: clamp(100 - i.pctEmDia), fonte: "historico" };
  return { vencimento: prox.vencimento, valor: prox.total, risco_pct: null, fonte: null };
}

/* ── Resumo executivo — domain.ts:341-376 ── */

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);
const num = (n: number) => new Intl.NumberFormat("pt-BR").format(n ?? 0);

export function resumoExecutivo(v: {
  selo: SeloPagamento | null;
  situacaoReal: "ativo" | "suspenso" | "ex-cliente" | null;
  anosCliente: number | null;
  vencido: number;
  atraso: number;
  temFaturas: boolean;
  historicoPagamento: { pagas: number; pct_em_dia: number } | null;
  ltvReceita: number | null;
}): string | null {
  const partes: string[] = [];
  const lead: string[] = [];
  if (v.selo) lead.push(v.selo.rotulo);
  else if (v.situacaoReal === "ex-cliente") lead.push("Ex-cliente");
  if (v.anosCliente !== null && v.anosCliente > 0) lead.push(`${num(v.anosCliente)} ${v.anosCliente >= 2 ? "anos" : "ano"} de casa`);
  if (lead.length > 0) partes.push(lead.join(" · "));

  if (v.vencido > 0) partes.push(`${brl(v.vencido)} vencido${v.atraso > 0 ? ` há ${num(v.atraso)}d` : ""}`);
  else if (v.temFaturas || v.historicoPagamento) partes.push("sem débito vencido");

  if (v.historicoPagamento) partes.push(`${Math.round(v.historicoPagamento.pct_em_dia)}% em dia de ${num(v.historicoPagamento.pagas)} faturas`);
  if (v.ltvReceita !== null && v.ltvReceita > 0) partes.push(`LTV ${brl(v.ltvReceita)}`);
  return partes.length > 0 ? partes.join(" · ") : null;
}

/** `anos_cliente` do Provedor.ai: `ROUND((hoje − adesão)/365, 1)`. */
export function anosDeCliente(inicio: Date | string | null | undefined, hoje: Date): number | null {
  if (!inicio) return null;
  const d = inicio instanceof Date ? inicio : new Date(inicio);
  if (Number.isNaN(d.getTime()) || d > hoje) return null;
  return Math.round(((hoje.getTime() - d.getTime()) / 86_400_000 / 365) * 10) / 10;
}

/** A situação CONTRATUAL, que vence a situação da pessoa no ERP. */
export function situacaoRealDe(statusErp: string | null | undefined, carteira: string | null | undefined): "ativo" | "suspenso" | "ex-cliente" | null {
  const s = (statusErp ?? "").toLowerCase();
  if (s === "active" || s === "ativo") return "ativo";
  if (s === "suspended" || s === "suspenso") return "suspenso";
  if (s === "cancelled" || s === "cancelado" || s === "inactive" || s === "inativo") return "ex-cliente";
  if (carteira === "ex_cliente") return "ex-cliente";
  if (carteira === "ativo") return "ativo";
  return null;
}
