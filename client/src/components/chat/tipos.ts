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
  /**
   * A prévia da última mensagem e quem a escreveu, como na lista do Provedor.ai.
   * A fila (`listarAtendimentosDoChat`) AINDA NÃO a traz: o texto das mensagens
   * mora no Chat BullQ, não no nosso banco, e a consulta da fila só junta
   * `customers` e `cobranca_casos`. Por isso o campo é OPCIONAL e a linha mostra
   * o telefone enquanto ele não existir — ausência nunca vira prévia inventada.
   */
  ultimaMensagem?: { texto: string | null; de: "cliente" | "provedor"; quem: string | null } | null;
  /** Quadrante do DNA do caso, quando a fila passar a selecioná-lo. Ausente = a coluna não veio. */
  quadrante?: string | null;
}

/** O corpo de `GET /api/chat-bullq/atendimentos`. */
export interface FilaDeAtendimentos {
  itens: ResumoChat[];
  temMais: boolean;
  pagina?: number;
  /**
   * Total real da consulta. A fila pagina com `limit 31` e NÃO conta o conjunto,
   * então hoje vem ausente — e o título fica só "Conversas", sem número. Contagem
   * no título só quando o servidor a devolver.
   */
  total?: number;
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

/* ── Como a lista e o cabeçalho falam de tempo ────────────────────────── */

/** "há 31 d" da lista do Provedor.ai. Null quando não há instante legível — quem chama desenha traço. */
export function tempoRelativo(iso: string | null | undefined, agora: Date = new Date()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const seg = Math.round((agora.getTime() - t) / 1000);
  if (seg < 60) return "agora";
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias < 365) return `há ${dias} d`;
  return `há ${Math.floor(dias / 365)} a`;
}

export type TomDoStatusChat = "ok" | "gated" | "info" | "marca" | "neutro";
/** O tom de cada estado da conversa; o rótulo continua em STATUS_CHAT. */
export const TOM_DO_STATUS_CHAT: Record<string, TomDoStatusChat> = {
  WAITING: "info",
  PENDING: "gated",
  OPEN: "ok",
  BOT: "marca",
  CLOSED: "neutro",
};

export const MOTIVO_SEM_HISTORICO = "Nenhum evento registrado nesta conversa desde que ela foi aberta.";
export const MOTIVO_SEM_PREVIA =
  "A fila não traz a prévia da última mensagem: o texto das mensagens vive no Chat BullQ e é lido ao abrir a conversa. Aqui fica o telefone.";

/* ── Janela de 24 h do WhatsApp ───────────────────────────────────────── */

export const JANELA_WHATSAPP_MS = 24 * 60 * 60 * 1000;

export interface JanelaDaConversa {
  aberta: boolean;
  /** ISO do último recebimento, quando ele está no histórico carregado. */
  ultimoRecebimentoEm: string | null;
  /** O porquê, palavra por palavra, para o `title` do cabeçalho. */
  motivo: string;
}

export const MOTIVO_JANELA_DESCONHECIDA =
  "O histórico carregado não tem mensagem recebida do cliente: não dá para saber se a sessão de 24 h do WhatsApp está aberta. Carregue as mensagens anteriores.";

/**
 * A janela de 24 h do WhatsApp a partir do que o servidor REALMENTE mandou: a
 * direção e o instante de cada mensagem. Três respostas, e nenhuma é um chute:
 *
 *  - achou recebimento → aberta se ele tem menos de 24 h;
 *  - não achou recebimento, mas a mensagem mais antiga do histórico carregado já
 *    passou das 24 h → fechada com certeza (qualquer recebimento seria ainda
 *    mais velho que ela);
 *  - não achou e o histórico é recente → `null`, e o cabeçalho escreve
 *    "janela —" com o motivo no `title`. Nunca "aberta" por otimismo.
 */
export function janelaDaConversa(
  mensagens: ReadonlyArray<{ direcao: string; em: string }>,
  agora: Date = new Date(),
): JanelaDaConversa | null {
  let ultimoRecebido: { t: number; em: string } | null = null;
  let maisAntiga: number | null = null;
  for (const m of mensagens) {
    const t = new Date(m.em).getTime();
    if (!Number.isFinite(t)) continue;
    if (maisAntiga === null || t < maisAntiga) maisAntiga = t;
    if (m.direcao !== "INBOUND") continue;
    if (!ultimoRecebido || t > ultimoRecebido.t) ultimoRecebido = { t, em: m.em };
  }
  if (ultimoRecebido) {
    const aberta = agora.getTime() - ultimoRecebido.t < JANELA_WHATSAPP_MS;
    return {
      aberta,
      ultimoRecebimentoEm: ultimoRecebido.em,
      motivo: aberta
        ? "O cliente escreveu há menos de 24 h: o WhatsApp aceita texto livre."
        : "Mais de 24 h sem mensagem do cliente: o WhatsApp só aceita template aprovado.",
    };
  }
  if (maisAntiga !== null && agora.getTime() - maisAntiga >= JANELA_WHATSAPP_MS)
    return {
      aberta: false,
      ultimoRecebimentoEm: null,
      motivo: "Nenhuma mensagem recebida nas últimas 24 h: o WhatsApp só aceita template aprovado.",
    };
  return null;
}

/* ── Rodapé honesto do compositor ─────────────────────────────────────── */

export const MOTIVO_SEM_JANELA_DE_CONTATO =
  "A política de cobrança não foi lida: a janela de contato do provedor não está disponível nesta tela.";
export const AVISO_CDC_42 =
  "CDC art. 42: a cobrança respeita a janela de contato do provedor — fora dela o envio espera a próxima janela.";

/** "8–20h" a partir da janela gravada na política. Sem política, null e a tela escreve traço. */
export function faixaDeContato(
  janela: { horaInicio: number; horaFim: number } | null | undefined,
): string | null {
  if (!janela) return null;
  const { horaInicio, horaFim } = janela;
  if (!Number.isFinite(horaInicio) || !Number.isFinite(horaFim)) return null;
  return `${horaInicio}–${horaFim}h`;
}
