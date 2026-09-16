import { ETAPAS_PADRAO, etapaParaAtraso, type Etapa } from "./regua";
import { z } from "zod";

export const AvisosFaturasSchema = z.object({
  ligada: z.boolean().default(false),
  diasAntes: z.array(z.number().int().min(0).max(30)).min(1).max(10)
    .refine(dias => new Set(dias).size === dias.length, "Não repita dias")
    .default([7, 3, 1]),
  canal: z.enum(["whatsapp", "sms", "email"]).default("whatsapp"),
  incluirLinkFatura: z.boolean().default(false),
  limiteDiario: z.number().int().min(1).max(10000).default(10),
});
export type ConfigAvisosFaturas = z.infer<typeof AvisosFaturasSchema>;

/** Timestamp das faturas é meia-noite UTC; diaContato é dia civil do provedor. */
export function planejarPreAviso(providerId: number, fatura: {
  id: number; status: string; vencimento: Date; valor: number;
}, diaContato: string, etapas: readonly Etapa[] = ETAPAS_PADRAO, diasAntes?: readonly number[]) {
  const etapa = etapas.find(e => e.id === "lembrete_pre_vencimento" && e.ativa);
  if ((!diasAntes && !etapa) || !["aberta", "pending", "overdue"].includes(fatura.status) || !(fatura.valor > 0)) return null;
  const dia = new Date(`${diaContato}T00:00:00Z`);
  if (!Number.isFinite(dia.getTime()) || !Number.isFinite(fatura.vencimento.getTime()) || dia.toISOString().slice(0, 10) !== diaContato) return null;
  const vencimento = fatura.vencimento.toISOString().slice(0, 10);
  const diasAtraso = Math.round((dia.getTime() - new Date(`${vencimento}T00:00:00Z`).getTime()) / 86_400_000);
  if (diasAntes ? diasAtraso > 0 || !diasAntes.includes(-diasAtraso) : etapaParaAtraso(diasAtraso, "ativo", etapas, true).etapa?.id !== "lembrete_pre_vencimento") return null;
  return { faturaId: fatura.id, diaContato, vencimento, diasAtraso, valor: fatura.valor, chave: `${providerId}:${fatura.id}:${diaContato}` };
}
