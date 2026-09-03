/**
 * Datas do caso de recuperação, formatadas para o operador.
 *
 * Duas famílias chegam no mesmo formato ISO e pedem tratamento oposto:
 *
 * - data CIVIL (rescisão, prazo, notificação, tentativa registrada só pela
 *   data): entra por `<input type="date">` e o servidor guarda à meia-noite
 *   UTC. Formatar no fuso do navegador (UTC-3) mostra o dia ANTERIOR —
 *   "rescisão 15/08" para um caso rescindido em 16/08, enquanto o kanban
 *   conta os dias a partir de 16/08. Tem que sair em UTC.
 * - INSTANTE (encerrado em, agendamento, mudança de etapa): é `now()` do
 *   servidor, e o operador quer ver na hora dele.
 *
 * O que distingue as duas é a meia-noite UTC exata: nenhum instante real cai
 * ali por acaso com precisão de milissegundo.
 */
import { TRACO } from "@/components/localizacao/ui";

export const ehDataCivil = (iso: string): boolean => iso.endsWith("T00:00:00.000Z");

const fusoDe = (iso: string): Intl.DateTimeFormatOptions => (ehDataCivil(iso) ? { timeZone: "UTC" } : {});

/** dd/mm/aaaa. */
export const dataBr = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", fusoDe(iso)) : TRACO;

/** dd/mm, para o card. */
export const dataCurta = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", ...fusoDe(iso) }) : TRACO;

/** Instante com hora; data civil sai só como data — meia-noite não é hora de nada. */
export const dataHoraBr = (iso: string | null | undefined): string => {
  if (!iso) return TRACO;
  if (ehDataCivil(iso)) return dataBr(iso);
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

/** dd/mm hh:mm, para o card. */
export const dataHoraCurta = (iso: string | null | undefined): string => {
  if (!iso) return TRACO;
  if (ehDataCivil(iso)) return dataCurta(iso);
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const dois = (n: number) => String(n).padStart(2, "0");

/**
 * Hoje no calendário do operador, no formato de `<input type="date">`.
 * `toISOString().slice(0, 10)` daria o dia UTC: às 22h de Brasília já seria
 * amanhã, e o operador veria uma rescisão "no futuro" que o servidor recusa.
 */
export function hojeInput(agora: Date = new Date()): string {
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`;
}

/**
 * Instante ISO → valor de `<input type="datetime-local">`, no fuso do
 * navegador. `iso.slice(0, 16)` mostraria a hora em UTC, três horas à frente.
 */
export function paraInputDataHora(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${hojeInput(d)}T${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/**
 * Valor de `<input type="datetime-local">` → ISO com o fuso do navegador
 * resolvido. Mandar a string crua ("2026-09-05T14:30") deixa o SERVIDOR
 * interpretá-la no fuso dele — na VPS, em UTC, a visita marcada para as 14h30
 * viraria 11h30 no card.
 */
export function deInputDataHora(valor: string): string {
  return new Date(valor).toISOString();
}
