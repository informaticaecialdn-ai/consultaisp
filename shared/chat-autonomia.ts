import { z } from "zod";
import { TIPOS_DE_AGENTE } from "./chat-agentes";

export const ConfigAutonomiaSchema = z.object({
  ativa: z.boolean().default(false),
  maxTurnos: z.number().int().min(1).max(20).default(12),
  permitirPromessa: z.boolean().default(true),
  permitirSegundaVia: z.boolean().default(true),
  permitirAgendamento: z.boolean().default(true),
  tipos: z.array(z.enum(TIPOS_DE_AGENTE)).min(1).max(3).default([...TIPOS_DE_AGENTE]),
}).strict();
export type ConfigAutonomia = z.infer<typeof ConfigAutonomiaSchema>;
export const PlanoRespostaSchema = z.object({
  acao: z.enum(["responder", "transferir", "segunda_via", "promessa", "agendar"]),
  resposta: z.enum(["acolher", "informar_divida", "pedir_data", "pedir_confirmacao", "orientar_devolucao", "agradecer"]).optional(),
  texto: z.string().max(2000).optional(),
  motivo: z.string().max(500).optional(),
  data: z.string().max(40).optional(),
  valor: z.number().finite().positive().optional(),
  faturaId: z.string().min(1).max(160).optional(),
}).strict();
export type PlanoResposta = z.infer<typeof PlanoRespostaSchema>;
export interface PedidoPlanoAutonomia {
  requestId: string;
  operation: "cobranca" | "recuperacao";
  context: string;
  history: { role: "user" | "assistant"; content: string }[];
  allowedActions: PlanoResposta["acao"][];
}
export interface PropostaAutonomia { acao: "promessa" | "agendar"; data: string; valor?: number; criadaEm: string; messageId: string }
export function lerConfigAutonomia(v: unknown): ConfigAutonomia {
  const r = ConfigAutonomiaSchema.safeParse(v ?? {});
  return r.success ? r.data : ConfigAutonomiaSchema.parse({});
}

/* A fila por status e o que a IA nunca faz — nomes compartilhados entre a rota e a tela. */
export const STATUS_DA_FILA = ["pendente", "processando", "enviando", "concluido", "humano", "cancelado"] as const;
export type StatusDaFila = (typeof STATUS_DA_FILA)[number];
export const ROTULOS_DA_FILA: Record<StatusDaFila, string> = {
  pendente: "aguardando", processando: "em análise", enviando: "enviando", concluido: "respondidas", humano: "para o atendente", cancelado: "canceladas",
};
/** As palavras da tela para cada item de `LIMITES_DA_AUTONOMIA.nunca` do servidor. */
export const O_QUE_A_IA_NUNCA_FAZ: Record<string, string> = {
  negativar: "negativar o cliente",
  baixar: "dar baixa em fatura ou equipamento",
  desconto_fora_da_politica: "conceder desconto fora da política de cobrança",
  parcelar: "parcelar a dívida",
  confirmar_pagamento: "confirmar pagamento sem o ERP",
  confirmar_devolucao: "confirmar a devolução do equipamento",
};
export interface FilaDaAutonomia { porStatus: Record<StatusDaFila, number>; total: number; lidoEm: string }
/** Só aceita a fila inteira, contada no banco; qualquer buraco vira `null` e a tela mostra o traço. */
export function lerFilaDaAutonomia(v: unknown): FilaDaAutonomia | null {
  if (!v || typeof v !== "object") return null;
  const porStatus = (v as { porStatus?: unknown }).porStatus;
  if (!porStatus || typeof porStatus !== "object") return null;
  const lida = {} as Record<StatusDaFila, number>;
  for (const s of STATUS_DA_FILA) {
    const n = (porStatus as Record<string, unknown>)[s];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return null;
    lida[s] = n;
  }
  const lidoEm = (v as { lidoEm?: unknown }).lidoEm;
  return { porStatus: lida, total: STATUS_DA_FILA.reduce((a, s) => a + lida[s], 0), lidoEm: typeof lidoEm === "string" ? lidoEm : "" };
}
