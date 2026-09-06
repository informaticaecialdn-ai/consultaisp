/**
 * O atendimento humano dentro do modulo: assumir, responder, encerrar, e a
 * chegada da resposta do cliente quando o assistente nao a tratou.
 *
 * Regra do follow-up (dono, 05/09/2026): todo contato termina com a proxima
 * acao, o dono, o quando e o status. O chat e um contato como qualquer outro,
 * entao cada acao daqui tambem grava no CASO de cobranca — pelo mesmo
 * `storage.atualizarCasoDeCobranca` da rota de eventos, nunca por SQL proprio:
 *
 *  - cliente mandou mensagem (e o assistente nao respondeu) → "Responder no
 *    chat", agora; o dono e quem assumiu, ou ninguem (volta a fila);
 *  - atendente assumiu → o dono do caso passa a ser ele;
 *  - atendente respondeu → a proxima acao que ele escreveu, ou o padrao
 *    "Aguardar resposta do cliente" no proximo dia util;
 *  - atendente encerrou → a proxima acao e a data sao OBRIGATORIAS, a menos
 *    que o caso ja esteja fechado (pago, baixado, encerrado, cancelamento) ou
 *    a conversa nao tenha caso de cobranca (so recuperacao de equipamento,
 *    que nao tem essas colunas).
 *
 * A validacao acontece ANTES de qualquer chamada ao Chat BullQ: recusar
 * depois de encerrar la deixaria a conversa fechada e o caso sem follow-up.
 */
import { storage } from "../../storage";
import type { Mensagem, Resultado } from "./chat-bullq.client";
import { clienteDoChat, ErroDaPonteDoChat } from "./chat-ponte.service";
import { orientarContato } from "@shared/cobranca/contato";
import { resolverEtapas } from "@shared/cobranca/regua";
import { casoFechado } from "@shared/cobranca/estados";
import { comTravaDoChat } from "./chat-trava";
import { autonomiaStorage } from "../../storage/chat-autonomia.storage";
import type { ChatBullqConversa } from "@shared/schema";

/** O que o caso ganha quando o cliente escreve e ninguem respondeu ainda. */
export const ACAO_AO_RECEBER_MENSAGEM = "Responder no chat";
/** O padrao de quem respondeu sem dizer o que vem depois. */
export const ACAO_PADRAO_APOS_RESPOSTA = "Aguardar resposta do cliente";
export const TAMANHO_MAXIMO_DA_ACAO = 120;
/** Folga para relogio de navegador atrasado — a mesma da rota de eventos. */
const FOLGA_DE_RELOGIO_MS = 5 * 60 * 1000;

function valor<T>(resultado: Resultado<T>): T {
  if (!resultado.ok)
    throw new ErroDaPonteDoChat(
      "CHAT_FALHOU",
      "O chat não confirmou a operação. Atualize a conversa antes de tentar novamente.",
    );
  return resultado.valor;
}

async function acesso(providerId: number, conversationId: string) {
  const vinculo = await storage.getConversaDoChat(providerId, conversationId);
  if (!vinculo)
    throw new ErroDaPonteDoChat(
      "CASO_NAO_ENCONTRADO",
      "Conversa não encontrada neste provedor",
    );
  const cliente = clienteDoChat();
  const intg = await storage.getIntegracaoDoChat(providerId);
  if (!cliente || !intg)
    throw new ErroDaPonteDoChat(
      "CHAT_DESLIGADO",
      "Configure o Chat BullQ no Painel do Provedor para atender por aqui",
    );
  return { vinculo, cliente, org: intg.organizationId };
}

function textoDaMensagem(mensagem: Mensagem): string | null {
  if (typeof mensagem.content?.text === "string" && mensagem.content.text.trim()) return mensagem.content.text;
  if (mensagem.type !== "TEMPLATE") return null;
  const nome = typeof mensagem.content?.name === "string" ? mensagem.content.name.trim() : "";
  const idioma = typeof mensagem.content?.language?.code === "string" ? mensagem.content.language.code.trim() : "";
  return `Template de abertura${nome ? `: ${nome}` : ""}${idioma ? ` (${idioma})` : ""}`;
}

/* ── Follow-up ─────────────────────────────────────────────────────── */

const UM_DIA_MS = 24 * 60 * 60 * 1000;

/** O dia da semana no fuso do provedor (0 domingo … 6 sabado), nunca no do servidor. */
function diaDaSemanaEmBrasilia(instante: Date): number {
  const dia = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
  return new Date(`${dia}T12:00:00Z`).getUTCDay();
}

/**
 * O proximo dia util (segunda a sexta), na mesma hora. Feriado nao entra:
 * o calendario de feriados nao existe no sistema, e inventar um seria dado
 * nao verificavel — o operador troca a data no campo se precisar.
 *
 * O dia da semana e decidido em America/Sao_Paulo, NUNCA no fuso do processo:
 * a VPS roda em UTC, e ali uma resposta de sexta 23:30 em Brasilia ja e sabado
 * — o "proximo dia util" caia em domingo. Somar 24h preserva a hora local
 * brasileira (o Brasil nao tem mais horario de verao desde 2019).
 */
export function proximoDiaUtil(agora: Date = new Date()): Date {
  let d = new Date(agora.getTime() + UM_DIA_MS);
  while ([0, 6].includes(diaDaSemanaEmBrasilia(d))) d = new Date(d.getTime() + UM_DIA_MS);
  return d;
}

export interface FollowUpInformado {
  proximaAcao?: string | null;
  /** ISO vindo do navegador (o fuso e resolvido la) ou Date. */
  proximoContatoEm?: string | Date | null;
}

export interface FollowUpResolvido {
  proximaAcao: string;
  proximoContatoEm: Date;
}

/**
 * Recusa de DADO, nao de estado. Sai como 400 na rota, junto com as outras
 * recusas de corpo do sistema: 409 dizia "conflito com o estado atual" quando
 * nao havia conflito nenhum — faltava (ou veio impossivel) o que o atendente
 * escreveu no dialogo de follow-up.
 */
export class ErroDeDadosDoAtendimento extends Error {
  readonly codigo = "DADOS_INVALIDOS" as const;
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeDadosDoAtendimento";
  }
}

const invalido = (mensagem: string) => new ErroDeDadosDoAtendimento(mensagem);

/**
 * Le o que o atendente mandou. Acao vazia e data vazia sao "nao informado";
 * o que veio precisa ser valido: acao ate 120 caracteres, data legivel e
 * daqui para a frente (uma data passada nunca voltaria a fila).
 */
export function lerFollowUp(dado: FollowUpInformado | undefined, agora: Date = new Date()): Partial<FollowUpResolvido> {
  const r: Partial<FollowUpResolvido> = {};
  const acao = typeof dado?.proximaAcao === "string" ? dado.proximaAcao.trim() : "";
  if (acao) {
    if (acao.length > TAMANHO_MAXIMO_DA_ACAO) throw invalido(`A próxima ação tem no máximo ${TAMANHO_MAXIMO_DA_ACAO} caracteres`);
    r.proximaAcao = acao;
  }
  const bruto = dado?.proximoContatoEm;
  if (bruto !== undefined && bruto !== null && bruto !== "") {
    const d = bruto instanceof Date ? bruto : new Date(bruto);
    if (Number.isNaN(d.getTime())) throw invalido("Data do próximo contato inválida");
    if (d.getTime() < agora.getTime() - FOLGA_DE_RELOGIO_MS) throw invalido("O próximo contato precisa ser daqui para a frente: uma data passada nunca voltaria à fila");
    r.proximoContatoEm = d;
  }
  return r;
}

/** Ao responder: o que faltou ganha o padrao — "Aguardar resposta do cliente", proximo dia util. */
export function followUpAoResponder(dado: FollowUpInformado | undefined, agora: Date = new Date()): FollowUpResolvido {
  const lido = lerFollowUp(dado, agora);
  return {
    proximaAcao: lido.proximaAcao ?? ACAO_PADRAO_APOS_RESPOSTA,
    proximoContatoEm: lido.proximoContatoEm ?? proximoDiaUtil(agora),
  };
}

export const MOTIVO_ENCERRAR_SEM_FOLLOW_UP =
  "Todo atendimento termina com a próxima ação e a data em que ela acontece — sem isso o caso fica parado na fila";

/** Ao encerrar: nada de padrao. Quem encerra diz o que vem depois, ou nao encerra. */
export function followUpAoEncerrar(dado: FollowUpInformado | undefined, agora: Date = new Date()): FollowUpResolvido {
  const lido = lerFollowUp(dado, agora);
  if (!lido.proximaAcao || !lido.proximoContatoEm) throw invalido(MOTIVO_ENCERRAR_SEM_FOLLOW_UP);
  return { proximaAcao: lido.proximaAcao, proximoContatoEm: lido.proximoContatoEm };
}

/** O caso de cobranca da conversa, se existe e ainda esta vivo. Fechado nao recebe follow-up. */
async function casoVivoDaConversa(providerId: number, vinculo: ChatBullqConversa) {
  if (!vinculo.casoId) return null;
  const caso = await storage.obterCasoDeCobranca(providerId, vinculo.casoId);
  if (!caso || casoFechado(caso.status)) return null;
  return caso;
}

/* ── Leitura ───────────────────────────────────────────────────────── */

export async function detalheDoAtendimento(
  providerId: number,
  conversationId: string,
  pagina = 1,
) {
  const { vinculo, cliente, org } = await acesso(providerId, conversationId);
  const [pessoa, caso, recuperacao, equipamentos, mensagens, politica] =
    await Promise.all([
      storage.clienteDoAtendimento(providerId, vinculo.customerId),
      vinculo.casoId
        ? storage.obterCasoDeCobranca(providerId, vinculo.casoId)
        : null,
      vinculo.recuperacaoId
        ? storage.getRecoveryCaseById(vinculo.recuperacaoId, providerId)
        : null,
      storage.getEquipmentByCustomer(vinculo.customerId, providerId),
      cliente.listarMensagens(org, conversationId, { page: pagina, limit: 40 }),
      storage.getPoliticaDeCobranca(providerId),
    ]);
  const historico = valor(mensagens);
  return {
    conversa: vinculo,
    cliente: pessoa,
    cobranca: caso
      ? {
          id: caso.id,
          carteira: caso.carteira,
          status: caso.status,
          valor: caso.valorAtual,
          diasAtraso: caso.cliente.diasAtraso,
          quadrante: caso.quadranteDna,
          tom: caso.tom,
          responsavel: caso.responsavelNome,
          proximaAcao: caso.proximaAcao,
          proximoContatoEm: caso.proximoContatoEm,
          orientacao: orientarContato({
            diasAtraso: caso.cliente.diasAtraso,
            tom: caso.tom,
            quadrante: caso.quadranteDna,
            carteira: caso.carteira,
            status: caso.status,
            etapas: resolverEtapas(politica),
          }),
        }
      : null,
    recuperacao: recuperacao
      ? {
          id: recuperacao.id,
          status: recuperacao.status,
          agendadoEm: recuperacao.scheduledAt,
          prazo: recuperacao.deadlineAt,
          equipmentId: recuperacao.equipmentId,
        }
      : null,
    equipamentos: equipamentos.map((e) => ({
      id: e.id,
      tipo: e.type,
      marca: e.brand,
      modelo: e.model,
      serial: e.serialNumber,
      mac: e.mac,
      status: e.status,
    })),
    mensagens: historico.map((m) => ({
      id: m.id,
      direcao: m.direction,
      texto: textoDaMensagem(m),
      tipo: m.type,
      status: m.status,
      quem: m.senderName ?? null,
      em: m.createdAt,
    })),
    pagina,
    temMais: historico.length === 40,
  };
}

export type AcaoDoAtendimento =
  | { acao: "assumir" }
  | ({ acao: "encerrar" } & FollowUpInformado)
  | ({ acao: "enviar"; texto: string } & FollowUpInformado);

export async function midiaDoAtendimento(
  providerId: number,
  conversationId: string,
  messageId: string,
  pagina: number,
) {
  const { cliente, org } = await acesso(providerId, conversationId);
  const mensagens = valor(
    await cliente.listarMensagens(org, conversationId, {
      page: pagina,
      limit: 40,
    }),
  );
  const mensagem = mensagens.find((m) => m.id === messageId);
  if (!mensagem)
    throw new ErroDaPonteDoChat(
      "CASO_NAO_ENCONTRADO",
      "Mensagem não encontrada nesta conversa. Atualize o histórico.",
    );
  if (mensagem.type === "TEMPLATE") throw new ErroDaPonteDoChat("CONFLITO", "Este template não possui um anexo para abrir");
  const midia = valor(await cliente.obterMidia(org, messageId));
  let url: URL;
  try {
    url = new URL(midia.url);
  } catch {
    throw new ErroDaPonteDoChat("CHAT_FALHOU", "Endereço de anexo inválido");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new ErroDaPonteDoChat("CHAT_FALHOU", "Endereço de anexo inválido");
  return { url: url.href, mimeType: midia.mimeType ?? null };
}

/* ── Acoes do atendente ────────────────────────────────────────────── */

export async function acaoNaConversa(
  providerId: number,
  conversationId: string,
  userId: number,
  acao: AcaoDoAtendimento,
) {
  const resultado = await comTravaDoChat(`autonomia:${providerId}:${conversationId}`, async () => {
    // Autorização pelo vínculo antes de qualquer efeito; o bloqueio do
    // assistente é persistido lá dentro, DEPOIS de validar o follow-up.
    await acesso(providerId, conversationId);
    return { valor: await acaoNaConversaSobTrava(providerId, conversationId, userId, acao) };
  });
  if (!resultado) throw new ErroDaPonteDoChat("CONFLITO", "O assistente está finalizando uma rodada. Tente assumir novamente em instantes.");
  return resultado.valor;
}

async function acaoNaConversaSobTrava(
  providerId: number,
  conversationId: string,
  userId: number,
  acao: AcaoDoAtendimento,
) {
  const { vinculo, cliente, org } = await acesso(providerId, conversationId);
  if (acao.acao === "enviar" && vinculo.status !== "OPEN")
    throw new ErroDaPonteDoChat(
      "CONFLITO",
      "Assuma o atendimento antes de responder",
    );
  if (
    acao.acao === "enviar" &&
    (!acao.texto.trim() || acao.texto.trim().length > 2000)
  )
    throw new ErroDaPonteDoChat("CONFLITO", "Mensagem inválida");

  // O follow-up e decidido ANTES de falar com o Chat BullQ: recusar depois
  // deixaria a conversa encerrada la e o caso sem proxima acao aqui.
  const caso = await casoVivoDaConversa(providerId, vinculo);
  const agora = new Date();
  let followUp: FollowUpResolvido | null = null;
  if (acao.acao === "enviar") followUp = caso ? followUpAoResponder(acao, agora) : null;
  else if (acao.acao === "encerrar") followUp = caso ? followUpAoEncerrar(acao, agora) : null;

  // Só agora o assistente é bloqueado: um "encerrar" recusado por falta de
  // follow-up não pode deixar a conversa marcada como humana (o assistente
  // pararia de responder sem que ninguém tivesse assumido de fato).
  await autonomiaStorage.cancelar(providerId, conversationId, "Operador assumiu o controle do atendimento");

  // Falha fechada: não disputa a resposta com um agente ativado no inbox externo.
  valor(await cliente.desligarIa(org, conversationId));
  if (acao.acao === "enviar") {
    const enviada = valor(
      await cliente.enviarTexto(org, conversationId, acao.texto.trim()),
    );
    await storage.atualizarConversaDoChat(providerId, conversationId, {});
    await storage.registrarEventoDoChat(
      providerId,
      vinculo,
      userId,
      "Atendente enviou mensagem pelo chat integrado",
      followUp ?? undefined,
    );
    if (caso && followUp) await storage.atualizarCasoDeCobranca(providerId, caso.id, followUp, userId);
    return { ...enviada, statusConversa: "OPEN", followUp };
  }
  const status = acao.acao === "assumir" ? "OPEN" : "CLOSED";
  if (acao.acao === "assumir")
    valor(await cliente.atribuir(org, conversationId, { status }));
  else valor(await cliente.encerrar(org, conversationId));
  await storage.atualizarConversaDoChat(providerId, conversationId, { status });
  await storage.registrarEventoDoChat(
    providerId,
    vinculo,
    userId,
    acao.acao === "assumir"
      ? "Atendente assumiu a conversa; resposta automática pausada"
      : "Conversa encerrada; situação do caso preservada",
    followUp ?? undefined,
  );
  if (acao.acao === "assumir") {
    // Quem assumiu e o dono do caso a partir de agora (o evento responsavel_mudou sai do storage).
    if (caso && caso.responsavelUserId !== userId)
      await storage.atualizarCasoDeCobranca(providerId, caso.id, { responsavelUserId: userId }, userId);
  } else if (caso && followUp) {
    await storage.atualizarCasoDeCobranca(providerId, caso.id, followUp, userId);
  }
  return { statusConversa: status, followUp };
}

/* ── Resposta do cliente ───────────────────────────────────────────── */

/**
 * Webhook assinado; primeira resposta inclui texto, áudio ou anexo. Nunca deixa o LLM negociar.
 *
 * Em qualquer estado o caso ganha "Responder no chat" para agora: com a
 * conversa em atendimento humano o dono continua sendo quem assumiu; fora
 * disso (fila, aguardando, encerrada) o dono sai e o caso volta a fila.
 */
export async function receberRespostaDoCliente(
  providerId: number,
  conversationId: string,
) {
  const { vinculo, cliente, org } = await acesso(providerId, conversationId);
  const pedirResposta = async () => {
    const caso = await casoVivoDaConversa(providerId, vinculo);
    if (!caso) return;
    await storage.atualizarCasoDeCobranca(providerId, caso.id, {
      proximaAcao: ACAO_AO_RECEBER_MENSAGEM,
      proximoContatoEm: new Date(),
      ...(vinculo.status === "OPEN" ? {} : { responsavelUserId: null }),
    }, null);
  };
  if (vinculo.status === "OPEN" || vinculo.status === "PENDING") {
    await storage.atualizarConversaDoChat(providerId, conversationId, {});
    await pedirResposta();
    return;
  }
  valor(await cliente.desligarIa(org, conversationId));
  valor(await cliente.atribuir(org, conversationId, { status: "PENDING" }));
  const movida = await storage.moverConversaDoChat(
    providerId,
    conversationId,
    vinculo.status,
    "PENDING",
  );
  if (movida) {
    await storage.registrarEventoDoChat(
      providerId,
      vinculo,
      null,
      "Cliente respondeu ao primeiro contato. Aguardando atendimento humano com o histórico completo.",
    );
    await pedirResposta();
  }
}
