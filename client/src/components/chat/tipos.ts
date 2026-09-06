export const API_ATENDIMENTOS = "/api/chat-bullq/atendimentos";
/** Estado e configuração do assistente autônomo (GET) e a devolução de uma conversa a ele (POST …/conversas/:id/devolver). */
export const API_AUTONOMIA = "/api/chat-bullq/autonomia";
export type OrigemChat = "cobranca" | "equipamentos";

/* ── Follow-up: todo contato pelo chat termina com a próxima ação e o quando ── */

/** O que o servidor grava no caso quando o atendente responde sem dizer o depois (próximo dia útil). */
export const ACAO_PADRAO_APOS_RESPOSTA = "Aguardar resposta do cliente";
/** O que o caso ganha quando o cliente escreve e ninguém respondeu ainda. */
export const ACAO_AO_RECEBER_MENSAGEM = "Responder no chat";
/** As próximas ações que só fazem sentido no chat — somam-se às comuns da cobrança. */
export const ACOES_COMUNS_DO_CHAT = [ACAO_PADRAO_APOS_RESPOSTA, "Retomar a conversa"] as const;
export const TAMANHO_MAXIMO_DA_ACAO = 120;

export interface FollowUpChat {
  proximaAcao: string;
  /** ISO — o fuso é resolvido no navegador, não na VPS (que está em UTC). */
  proximoContatoEm: string;
}

/** O corpo de `POST /api/chat-bullq/atendimentos/:id/acoes`. */
export type AcaoChat =
  | { acao: "assumir" }
  | ({ acao: "encerrar" } & Partial<FollowUpChat>)
  | ({ acao: "enviar"; texto: string } & Partial<FollowUpChat>);

export const STATUS_FECHADOS_DE_CASO_CHAT = ["pago", "baixado", "encerrado", "cancelamento"] as const;

/**
 * Encerrar sem follow-up só quando não há onde gravá-lo: conversa sem caso de
 * cobrança (só recuperação) ou caso já fechado (pago, baixado, encerrado,
 * cancelamento). É o mesmo critério do servidor — a tela só decide se abre o
 * diálogo ou encerra direto.
 */
export function encerrarDispensaFollowUp(cobranca: { status: string } | null | undefined): boolean {
  if (!cobranca) return true;
  return (STATUS_FECHADOS_DE_CASO_CHAT as readonly string[]).includes(cobranca.status);
}

/** O que a tela lê de `GET /api/chat-bullq/autonomia` para saber se há assistente a quem devolver. */
export interface EstadoAutonomiaChat {
  config: { ativa: boolean };
}
export const STATUS_CHAT: Record<string, string> = {
  WAITING: "Aguardando cliente",
  PENDING: "Aguardando atendente",
  OPEN: "Atendimento humano",
  BOT: "Com agente",
  CLOSED: "Encerrada",
};
export interface ResumoChat {
  conversationId: string;
  customerId: number;
  casoId: number | null;
  recuperacaoId: number | null;
  nome: string;
  telefone: string | null;
  status: string;
  ultimoEventoEm: string | null;
  carteira: string | null;
}
export interface DetalheChat {
  conversa: ResumoChat;
  cliente: {
    id: number;
    nome: string;
    telefone: string | null;
    endereco: string | null;
    cidade: string | null;
  } | null;
  cobranca: {
    id: number;
    carteira: string;
    status: string;
    valor: number;
    diasAtraso: number;
    quadrante: string | null;
    tom: string | null;
    responsavel: string | null;
    /** Follow-up gravado no caso; nulo = caso parado, sem próxima ação. */
    proximaAcao: string | null;
    proximoContatoEm: string | null;
    orientacao: {
      etapa?: { id: string; rotulo: string; diaMin: number; diaMax: number | null } | null;
      agente: string;
      diretiva: string;
      proximoPasso: string;
      propensao: number | null;
    };
  } | null;
  recuperacao: {
    id: number;
    status: string;
    agendadoEm: string | null;
    prazo: string;
    equipmentId: number;
  } | null;
  equipamentos: Array<{
    id: number;
    tipo: string;
    marca: string | null;
    modelo: string | null;
    serial: string | null;
    mac: string | null;
    status: string;
  }>;
  mensagens: Array<{
    id: string;
    direcao: string;
    texto: string | null;
    tipo: string;
    status: string;
    quem: string | null;
    em: string;
  }>;
  pagina: number;
  temMais: boolean;
}
export function rotaChat(
  origem: OrigemChat,
  conversationId?: string,
  carteira?: string,
) {
  const params = new URLSearchParams();
  if (conversationId) params.set("conversa", conversationId);
  if (origem === "cobranca")
    params.set("carteira", carteira === "ex_cliente" ? "ex_cliente" : "ativo");
  return `${origem === "cobranca" ? "/cobranca/chat" : "/equipamentos/chat"}${params.size ? `?${params}` : ""}`;
}
