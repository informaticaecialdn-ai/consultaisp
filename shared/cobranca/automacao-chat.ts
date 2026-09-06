import { z } from "zod";
import { POLITICA_PADRAO, JanelaContatoSchema } from "./politica";

export const AutomacaoChatSchema = z.object({
  ligada: z.boolean().default(false),
  cobranca: z.boolean().default(true),
  equipamentos: z.boolean().default(false),
  limiteDiario: z.number().int().min(1).max(100).default(10),
  carteiras: z
    .array(z.enum(["ativo", "ex_cliente"]))
    .min(1)
    .default(["ativo", "ex_cliente"]),
  diasPausados: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .max(366)
    .default([]),
});
export type AutomacaoChat = z.infer<typeof AutomacaoChatSchema>;
/** Calendário operacional nacional; feriados estaduais/municipais entram em diasPausados. */
export function feriadosDoChat(ano: number): string[] {
  const fixos = [
    "01-01",
    "04-21",
    "05-01",
    "09-07",
    "10-12",
    "11-02",
    "11-15",
    "11-20",
    "12-25",
  ].map((d) => `${ano}-${d}`);
  // Computus gregoriano: Paixão de Cristo = dois dias antes da Páscoa.
  const a = ano % 19,
    b = Math.floor(ano / 100),
    c = ano % 100;
  const d = Math.floor(b / 4),
    e = b % 4,
    f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4),
    k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31),
    dia = ((h + l - 7 * m + 114) % 31) + 1;
  fixos.push(
    new Date(Date.UTC(ano, mes - 1, dia - 2)).toISOString().slice(0, 10),
  );
  return fixos;
}
export function lerAutomacaoChat(config: unknown): AutomacaoChat {
  const r = AutomacaoChatSchema.safeParse(config);
  return r.success ? r.data : AutomacaoChatSchema.parse({});
}
/** A janela é avaliada no fuso do provedor brasileiro, nunca no fuso UTC do worker. */
export function janelaDoChat(
  agora: Date,
  janela: unknown,
  diasPausados: string[] = [],
) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const p = Object.fromEntries(partes.map((a) => [a.type, a.value]));
  const dia = `${p.year}-${p.month}-${p.day}`;
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  const validada = JanelaContatoSchema.safeParse(janela);
  const j = validada.success ? validada.data : POLITICA_PADRAO.janelaContato;
  const hora = Number(p.hour);
  const permitida =
    semana !== 0 &&
    (semana !== 6 || j.sabado) &&
    !feriadosDoChat(Number(p.year)).includes(dia) &&
    !diasPausados.includes(dia) &&
    hora >= Math.max(8, j.horaInicio) &&
    hora <
      Math.min(
        semana === 6 ? j.sabadoHoraFim : j.horaFim,
        semana === 6 ? 14 : 20,
      );
  return { permitida, dia, inicioDoDia: new Date(`${dia}T00:00:00-03:00`) };
}
