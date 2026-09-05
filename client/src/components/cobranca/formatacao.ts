/**
 * Formatação da cobrança — datas, atraso, tempo de casa, situação do ERP.
 *
 * Um lugar só porque cinco telas (carteira, 360, fila, régua, política)
 * mostram o mesmo dado e duas delas arredondando por conta própria acabam
 * discordando na frente do operador. Tudo puro e testado; o "—" é o único
 * sinal de ausência — zero é zero e é outra coisa (regra do dono).
 */
import { mesesDeContrato } from "@shared/cobranca";
import { TRACO } from "@/components/localizacao/ui";

export { TRACO };

const dois = (n: number) => String(n).padStart(2, "0");

/** Hoje no calendário do operador, para `<input type="date">` e `value` de datetime-local. */
export function hojeInput(agora: Date = new Date()): string {
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`;
}

/** "AAAA-MM-DD" → "dd/mm/aaaa" SEM `new Date`: a coluna DATE lida como UTC vira o dia anterior em Brasília. */
export function dataCivilBr(iso: string | null | undefined): string {
  if (!iso) return TRACO;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return TRACO;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Instante ISO → "dd/mm/aaaa" no fuso do navegador. */
export function dataBr(iso: string | null | undefined): string {
  if (!iso) return TRACO;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return TRACO;
  return d.toLocaleDateString("pt-BR");
}

/** Instante ISO → "dd/mm/aaaa hh:mm". */
export function dataHoraBr(iso: string | null | undefined): string {
  if (!iso) return TRACO;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return TRACO;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Instante ISO → valor de `<input type="datetime-local">` no fuso do navegador. */
export function paraInputDataHora(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${hojeInput(d)}T${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/** Valor de datetime-local → ISO com o fuso resolvido aqui, não no servidor (a VPS está em UTC). */
export function deInputDataHora(valor: string): string | null {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Agora, no minuto, para o `min` de um `<input type="datetime-local">`. */
export function agoraInput(agora: Date = new Date()): string {
  return paraInputDataHora(agora.toISOString());
}

export const MOTIVO_CONTATO_NO_PASSADO = "O próximo contato precisa ser daqui para a frente: uma data passada nunca voltaria à fila.";

/**
 * O que o submit recusa: próximo contato no passado. Vazio é válido (não há
 * agendamento); inválido é recusado. O `min` do input só ajuda quem usa o
 * seletor — quem digita passa por ele, e o servidor grava o que receber.
 */
export function validarProximoContato(valor: string, agora: Date = new Date()): string | null {
  if (!valor) return null;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "Data do próximo contato inválida.";
  return d.getTime() < agora.getTime() ? MOTIVO_CONTATO_NO_PASSADO : null;
}

/* ── Atraso ──────────────────────────────────────────────────────────── */

export type TomDoAtraso = "ok" | "gated" | "past" | "danger";

export interface FaixaDoAtraso {
  tom: TomDoAtraso;
  /** Nome curto da faixa para o selo — o número sozinho não diz a gravidade a quem não distingue cor. */
  rotulo: string;
}

/**
 * As faixas seguem as janelas da régua padrão, e não a escala do Provedor.ai
 * (>10 / >30): aqui o operador lê o atraso ao lado da etapa, e uma faixa
 * "alerta" que começasse em D+11 enquanto o lembrete vai até D+14 faria o
 * selo brigar com a etapa na mesma linha.
 */
export function faixaDoAtraso(dias: number): FaixaDoAtraso {
  if (dias >= 90) return { tom: "danger", rotulo: "grave" };
  if (dias >= 30) return { tom: "past", rotulo: "crítico" };
  if (dias >= 15) return { tom: "gated", rotulo: "alerta" };
  return { tom: "ok", rotulo: "recente" };
}

/** "D+45" — o mesmo vocabulário da régua. */
export function rotuloDoAtraso(dias: number): string {
  if (dias <= 0) return "D0";
  return `D+${dias}`;
}

/* ── Tempo de casa ───────────────────────────────────────────────────── */

/**
 * "cliente há 3 anos", "cliente há 8 meses", "cliente há menos de um mês".
 * `null` sem data de contrato: a tela mostra "—", nunca inventa antiguidade.
 * Para ex-cliente o prefixo é "adesão há": dizer "cliente há" a quem cancelou
 * afirmaria continuidade que não existe.
 */
export function tempoDeCasa(
  inicio: string | null | undefined,
  hoje: Date,
  exCliente = false,
): string | null {
  const meses = mesesDeContrato(inicio, hoje);
  if (meses === null) return null;
  const prefixo = exCliente ? "adesão há" : "cliente há";
  if (meses < 1) return `${prefixo} menos de um mês`;
  if (meses < 12) return `${prefixo} ${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(meses / 12);
  return `${prefixo} ${anos} ${anos === 1 ? "ano" : "anos"}`;
}

/* ── Situação do ERP ─────────────────────────────────────────────────── */

export type TomDoErp = "ok" | "gated" | "past" | "neutro";

export const ROTULO_STATUS_ERP: Record<string, { rotulo: string; tom: TomDoErp }> = {
  active: { rotulo: "Ativo", tom: "ok" },
  suspended: { rotulo: "Suspenso", tom: "gated" },
  cancelled: { rotulo: "Cancelado", tom: "past" },
  inactive: { rotulo: "Inativo", tom: "past" },
};

export function situacaoDoErp(status: string | null | undefined): { rotulo: string; tom: TomDoErp } {
  return ROTULO_STATUS_ERP[status ?? ""] ?? { rotulo: status || TRACO, tom: "neutro" };
}

/* ── Próximo contato ─────────────────────────────────────────────────── */

export type UrgenciaDoContato = "vencido" | "hoje" | "futuro" | "sem_data";

export interface ProximoContato {
  urgencia: UrgenciaDoContato;
  texto: string;
}

const DIA_MS = 24 * 60 * 60 * 1000;

function inicioDoDia(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Como a fila lê `proximo_contato_em`: sem data é "na fila" (o servidor já a
 * ordena junto com os vencidos); passado é vencido; hoje é hoje; o resto é
 * "em N d". Contado em dias CIVIS do fuso do navegador, não em 24h — 23h59 de
 * ontem é ontem.
 */
export function proximoContato(iso: string | null | undefined, hoje: Date): ProximoContato {
  if (!iso) return { urgencia: "sem_data", texto: "sem data" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { urgencia: "sem_data", texto: "sem data" };
  const dias = Math.round((inicioDoDia(d) - inicioDoDia(hoje)) / DIA_MS);
  if (dias < 0) return { urgencia: "vencido", texto: `vencido há ${-dias} ${-dias === 1 ? "dia" : "dias"}` };
  if (dias === 0) return { urgencia: "hoje", texto: "hoje" };
  return { urgencia: "futuro", texto: `em ${dias} ${dias === 1 ? "dia" : "dias"}` };
}

/* ── Nome e telefone ─────────────────────────────────────────────────── */

/** Só dígitos com 55 na frente, para `https://wa.me/`. `null` para telefone curto demais. */
export function whatsappDe(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  return digitos.startsWith("55") && digitos.length >= 12 ? digitos : `55${digitos}`;
}

/** Score 0–1000 → faixa do DESIGN_SYSTEM (mesmos cortes de `--score-*`). */
export type FaixaDoScore = "alto" | "medio" | "baixo" | "critico";

export function faixaDoScore(score: number): { faixa: FaixaDoScore; rotulo: string; cor: string } {
  if (score >= 701) return { faixa: "alto", rotulo: "baixo risco", cor: "var(--score-high)" };
  if (score >= 501) return { faixa: "medio", rotulo: "médio", cor: "var(--score-medium)" };
  if (score >= 301) return { faixa: "baixo", rotulo: "alto risco", cor: "var(--score-low)" };
  return { faixa: "critico", rotulo: "crítico", cor: "var(--score-critical)" };
}

/** `customers.risk_tier` (low · medium · high · critical) em português; valor desconhecido sai como veio, nunca chuta. */
export const ROTULO_RISK_TIER: Record<string, string> = {
  low: "baixo",
  medium: "médio",
  high: "alto",
  critical: "crítico",
};

export function rotuloDoRiskTier(tier: string | null | undefined): string | null {
  if (!tier) return null;
  return ROTULO_RISK_TIER[tier] ?? tier;
}
