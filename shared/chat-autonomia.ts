import { z } from "zod";
import { TIPOS_DE_AGENTE } from "./chat-agentes";

export const ConfigAutonomiaSchema = z.object({
  ativa: z.boolean().default(false),
  maxTurnos: z.number().int().min(1).max(20).default(12),
  permitirPromessa: z.boolean().default(true),
  permitirSegundaVia: z.boolean().default(true),
  permitirAgendamento: z.boolean().default(true),
  permitirNegociacao: z.boolean().optional(),
  tipos: z.array(z.enum(TIPOS_DE_AGENTE)).min(1).max(3).default([...TIPOS_DE_AGENTE]),
}).strict();
export type ConfigAutonomia = z.infer<typeof ConfigAutonomiaSchema>;
export interface VinculoIdentidade { providerId: number; conversationId: string; customerId: number; telefone: string }
export interface EstadoIdentidade extends VinculoIdentidade {
  cadastroHash: string;
  tentativas: number;
  desafiadaEm: string;
  ultimaMensagemId: string;
  confirmadaEm: string | null;
  validaAte: string | null;
}
/**
 * Os balões que a funcionária escreve quando o pedido leva `escrever` (vps/009).
 * São os limites do CONTRATO com o fork — de 1 a 3, cada um com até 600
 * caracteres; o total (≤ 1.200) e o conteúdo são do verificador
 * (`shared/chat-funcionaria-digital.ts`), que recusa com código. O fork já
 * descarta o que sai do formato; repetir aqui impede que um fork diferente
 * entregue um balão de 2.000 caracteres a quem monta o envio.
 */
export const LIMITES_DO_PLANO_ESCRITO = { baloes: 3, caracteresPorBalao: 600 } as const;
export const MensagensDoPlanoSchema = z.array(z.string().min(1).max(LIMITES_DO_PLANO_ESCRITO.caracteresPorBalao)).min(1).max(LIMITES_DO_PLANO_ESCRITO.baloes);
export const PlanoRespostaSchema = z.object({
  acao: z.enum(["responder", "transferir", "segunda_via", "promessa", "agendar"]),
  resposta: z.enum(["acolher", "informar_divida", "pedir_data", "pedir_confirmacao", "orientar_devolucao", "agradecer"]).optional(),
  texto: z.string().max(2000).optional(),
  motivo: z.string().max(500).optional(),
  data: z.string().max(40).optional(),
  valor: z.number().finite().positive().optional(),
  faturaId: z.string().min(1).max(160).optional(),
  /** Só com `escrever` no pedido. Sem ele o fork devolve o plano byte a byte do 008, sem esta chave. */
  mensagens: MensagensDoPlanoSchema.optional(),
}).strict();
export type PlanoResposta = z.infer<typeof PlanoRespostaSchema>;
export interface PedidoPlanoAutonomia {
  requestId: string;
  operation: "cobranca" | "recuperacao";
  context: string;
  history: { role: "user" | "assistant"; content: string }[];
  allowedActions: PlanoResposta["acao"][];
  /**
   * Pede ao planejador os balões da funcionária (vps/009). Só vai no corpo
   * quando é `true`: o 008 recusa QUALQUER chave fora do envelope com 400, até
   * `escrever: false` — e o cliente a remove nesse caso.
   */
  escrever?: boolean;
}
export interface PropostaAutonomia { acao: "promessa" | "agendar"; data: string; valor?: number; criadaEm: string; messageId: string }
/**
 * A LEITURA é tolerante a chave desconhecida (achado e9): a gravação continua
 * estrita na rota, mas um JSON salvo por uma versão mais nova — com uma chave
 * que esta versão não conhece — não pode derrubar a autonomia para o padrão
 * desligado numa volta de deploy. Valor inválido continua caindo no padrão.
 */
const ConfigAutonomiaDaLeituraSchema = ConfigAutonomiaSchema.strip();
export function lerConfigAutonomia(v: unknown): ConfigAutonomia {
  const r = ConfigAutonomiaDaLeituraSchema.safeParse(v ?? {});
  return r.success ? r.data : ConfigAutonomiaSchema.parse({});
}

/**
 * D9 — a chave da funcionária digital, por provedor.
 *
 * Mora em `chat_bullq_integracoes.agente_config.funcionariaDigital`, FORA do
 * `ConfigAutonomiaSchema`: aquele objeto é estrito, e uma chave nova ali faria
 * o código anterior (volta de deploy, ou o worker antigo no deploy "API antes
 * do worker") ler o padrão e desligar a autonomia inteira em silêncio.
 *
 * Nasce DESLIGADA. Desligada, a autonomia segue o fluxo atual: sem `escrever`
 * no planejador e sem `aiAgentId` no envio. Ligada, a funcionária escreve os
 * balões e eles saem como o agente (vps/009 e vps/010) — e, se o fork não tiver
 * os patches, o servidor cai no modo antigo sozinho.
 */
export const FuncionariaDigitalSchema = z.object({ ativa: z.boolean() }).strict();
export type FuncionariaDigital = z.infer<typeof FuncionariaDigitalSchema>;
/** Leitura tolerante: só `ativa === true` liga; ausência, lixo ou tipo errado = desligada. Campos de auditoria ao lado são ignorados. */
export function lerFuncionariaDigital(agenteConfig: unknown): FuncionariaDigital {
  const config = agenteConfig && typeof agenteConfig === "object" && !Array.isArray(agenteConfig) ? (agenteConfig as Record<string, unknown>) : {};
  const chave = config.funcionariaDigital;
  const ativa = !!chave && typeof chave === "object" && !Array.isArray(chave) && (chave as Record<string, unknown>).ativa === true;
  return { ativa };
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
  parcelar_fora_da_politica: "parcelar fora da política de cobrança",
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
