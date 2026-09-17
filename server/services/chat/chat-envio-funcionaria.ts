/**
 * A porta da funcionária digital para o fork — o planejador que escreve e o
 * envio dos balões — com as degradações que deixam uma volta do fork (sem o
 * vps/009 ou o vps/010) ser absorvida sem deploy (spec §5, achados e8 e e10).
 *
 * Com a chave D9 desligada nada daqui muda o fluxo atual: sem `escrever` o
 * planejador é o do 008, e sem a chave o envio é o `enviarTexto` de sempre.
 *
 * Contrato do envio, para quem decide avisar ou transferir:
 * - `envio: "nao_saiu"` — recusa definitiva ANTES de qualquer mensagem sair
 *   (4xx do HTTP, menos 408). O `status` numérico só vai nesse caso, e o
 *   orçamento grava a tentativa como `falhou`.
 * - `envio: "incerto"` — timeout, queda de rede, 5xx, 408 ou resposta aceita
 *   sem confirmação: algum balão PODE ter saído. Sai SEM status numérico
 *   (o orçamento grava `incerto`, que conta no dia) e nada é reenviado.
 *
 * Log: só ids, contagens, tempos e códigos — nunca texto, nome ou telefone.
 */
import { comOrcamentoContato } from "../cobranca/gestao-operacional.service";
import { logger } from "../../logger";
import { MensagensDoPlanoSchema, PlanoRespostaSchema, type PedidoPlanoAutonomia, type PlanoResposta } from "@shared/chat-autonomia";
import type { ChatBullqClient, Resultado } from "./chat-bullq.client";

/** Máximo de balões num lote do agente (vps/010, `LOTE_MAX_MENSAGENS`). */
export const MAX_BALOES_POR_LOTE = 4;
/** Como os balões viram UMA mensagem quando saem pelo envio comum: linha em branco entre eles. */
export const SEPARADOR_DE_BALOES = "\n\n";

export type ClienteDoEnvio = Pick<ChatBullqClient, "enviarComoAgente" | "enviarTexto">;
export type ClienteDoPlanejador = Pick<ChatBullqClient, "planejarAutonomia">;

export interface EnvioDaFuncionaria {
  cliente: ClienteDoEnvio;
  providerId: number;
  customerId: number;
  organizationId: string;
  conversationId: string;
  /** Os balões de UM turno, já verificados, na ordem de leitura. */
  baloes: readonly string[];
  /** A chave D9 lida no começo da rodada. */
  funcionariaDigitalAtiva: boolean;
  /** O agente do perfil no fork. Sem ele, mesmo com a chave ligada, sai pelo envio comum. */
  aiAgentId: string | null;
}

export type ViaDoEnvio = "agente" | "texto";
export interface EnvioConfirmado {
  via: ViaDoEnvio;
  /** A chave pedia o lote do agente e o fork o recusou (404, ou 400 de agente não controlado): saiu pelo envio comum, num balão só. */
  degradado: boolean;
  /** Como o fork devolveu: aceito na fila, não entregue. */
  mensagens: { messageId: string; status: string }[];
}
export type ResultadoDoEnvioDaFuncionaria =
  | { ok: true; valor: EnvioConfirmado }
  | { ok: false; erro: string; envio: "nao_saiu"; status?: number }
  | { ok: false; erro: string; envio: "incerto" };

/** Recusa definitiva é 4xx (menos 408): o fork respondeu e disse não antes de enfileirar. */
const recusaDefinitiva = (status: number | undefined): status is number =>
  typeof status === "number" && status >= 400 && status < 500 && status !== 408;

function falha(r: { erro: string; status?: number }): ResultadoDoEnvioDaFuncionaria {
  return recusaDefinitiva(r.status)
    ? { ok: false, erro: r.erro, envio: "nao_saiu", status: r.status }
    // Sem status numérico de propósito: é o que faz o orçamento gravar `incerto`.
    : { ok: false, erro: r.erro, envio: "incerto" };
}

/**
 * A recusa do vps/010 para agente fora do contrato do lote (sem a capability,
 * ligado nos canais ou com resposta direta). O fork não manda código no corpo,
 * só a mensagem — então é por ela. Se o texto do fork mudar, o lote recusado
 * deixa de cair no envio comum e fica `nao_saiu`: o lado seguro.
 */
export const RECUSA_DE_AGENTE_NAO_CONTROLADO = /agente de autonomia controlada/i;
/** Lote recusado ANTES de enfileirar e por motivo que não é o texto: o envio comum ainda pode mandar os mesmos balões. */
const loteRecusadoPeloAgente = (r: { erro: string; status?: number }) =>
  r.status === 404 || (r.status === 400 && RECUSA_DE_AGENTE_NAO_CONTROLADO.test(r.erro));

/** Apara, descarta vazio e, acima do teto do lote, junta o excedente no último balão — nunca dois lotes, que poderiam chegar trocados. */
function baloesDoTurno(baloes: readonly string[]): string[] {
  const limpos = baloes.map(b => (typeof b === "string" ? b.trim() : "")).filter(Boolean);
  if (limpos.length <= MAX_BALOES_POR_LOTE) return limpos;
  return [...limpos.slice(0, MAX_BALOES_POR_LOTE - 1), limpos.slice(MAX_BALOES_POR_LOTE - 1).join(SEPARADOR_DE_BALOES)];
}

/**
 * Os balões de um turno, com UM `comOrcamentoContato` em volta do turno inteiro.
 *
 * - Chave ligada e agente conhecido → `enviarComoAgente` (lote ordenado, sem
 *   assinatura, com "digitando…").
 * - O fork recusa o lote por um motivo que não é o texto — 404 (sem o vps/010,
 *   ou agente apagado) ou 400 de agente não controlado — → nada foi
 *   enfileirado, e os balões saem pelo `enviarTexto`, juntos numa mensagem só
 *   (em série, a fila de saída do fork pode inverter a ordem).
 * - 400 que recusa o TEXTO (meta-talk do vps/010, formato) é `nao_saiu`: o
 *   mesmo texto pelo envio comum, que não tem essa checagem e sai assinado
 *   pelo dono, seria contornar a recusa.
 * - Qualquer outra falha do lote (timeout, 5xx, 409 de conversa com humano)
 *   NÃO cai no envio comum: depois de uma falha ambígua, mandar de novo seria
 *   reenviar; e 409 quer dizer que um atendente está na conversa.
 * - Chave desligada → `enviarTexto`, como hoje.
 *
 * O bloqueio do orçamento (contestação aberta, pedido para não contatar, cota
 * do dia) é LANÇADO como `ErroGestao`, antes de qualquer envio — quem chama
 * transfere sem aviso. Qualquer OUTRA exceção vale como `incerto`: pode ter
 * vindo depois do envio (a gravação do desfecho no orçamento, por exemplo), e
 * o orçamento já a registra assim; quem chama transfere, sem reenviar.
 */
export async function enviarBaloesDaFuncionaria(e: EnvioDaFuncionaria): Promise<ResultadoDoEnvioDaFuncionaria> {
  const baloes = baloesDoTurno(e.baloes);
  // Nada a enviar não é contato: não reserva orçamento e não chama o fork.
  if (!baloes.length) return { ok: false, erro: "Nenhuma mensagem para enviar", envio: "nao_saiu" };
  const inicio = Date.now();
  let via: ViaDoEnvio = e.funcionariaDigitalAtiva && e.aiAgentId ? "agente" : "texto";
  let degradado = false;

  const resultado = await comOrcamentoContato(e.providerId, e.customerId, "whatsapp", false, async (): Promise<ResultadoDoEnvioDaFuncionaria> => {
    if (via === "agente") {
      const lote = await e.cliente.enviarComoAgente(e.organizationId, e.conversationId, e.aiAgentId!, baloes);
      if (lote.ok) return { ok: true, valor: { via, degradado, mensagens: lote.valor.mensagens } };
      if (!loteRecusadoPeloAgente(lote)) return falha(lote);
      via = "texto"; degradado = true;
      logger.warn({ providerId: e.providerId, status: lote.status }, "Autonomia: o fork recusou o lote do agente; os balões saem pelo envio comum, numa mensagem só");
    }
    const texto = await e.cliente.enviarTexto(e.organizationId, e.conversationId, baloes.join(SEPARADOR_DE_BALOES));
    if (!texto.ok) return falha(texto);
    return { ok: true, valor: { via, degradado, mensagens: [{ messageId: texto.valor.messageId, status: texto.valor.status }] } };
  });

  logger.info({
    providerId: e.providerId, etapa: "envio", ms: Date.now() - inicio, baloes: baloes.length, via, degradado,
    envio: resultado.ok ? "aceito" : resultado.envio, status: !resultado.ok && "status" in resultado ? resultado.status : undefined,
  }, "Autonomia: envio da rodada");
  return resultado;
}

/** Teto e alfabeto do `requestId` no fork (`parsePlanRequest`, vps/003): até 120 caracteres de `[a-zA-Z0-9_:-]`. */
const MAX_REQUEST_ID = 120;
const SUFIXO_SEM_ESCRITA = "_sem_escrita";
/**
 * O `requestId` da repetição sem escrita. Não pode ser o mesmo: quando o 400
 * nasce DENTRO do planejamento (modelo indisponível na credencial, por exemplo),
 * o fork já guardou o pedido com escrita sob aquele id, e a repetição — outro
 * conteúdo — voltaria 409 "requestId reutilizado", escondendo o erro real no
 * status e no log. Cortado pelo começo para caber no teto.
 */
export const requestIdSemEscrita = (requestId: string) =>
  `${requestId.slice(0, MAX_REQUEST_ID - SUFIXO_SEM_ESCRITA.length)}${SUFIXO_SEM_ESCRITA}`;

export interface PlanoDaFuncionaria {
  plano: PlanoResposta;
  /** O plano veio com `escrever` atendido — só então `plano.mensagens` pode existir. */
  escreveu: boolean;
  /** O pedido era com escrita e o fork o recusou (400): o plano é o do modo antigo, e quem escreve é a reserva. */
  degradado: boolean;
}

/**
 * O planejador com a degradação do §5: pedido com `escrever` recusado com 400
 * (fork ainda no 008, que não conhece a chave) é repetido UMA vez sem ela, com
 * `requestId` derivado (`requestIdSemEscrita`), e o plano volta como do modo
 * antigo — a reserva do servidor escreve — em vez de mandar a conversa ao atendente.
 *
 * A saída é conferida contra o contrato: sem escrita pedida, `mensagens` é
 * ignorada; com escrita, balões fora do formato são DESCARTADOS (como o fork
 * faz) e o plano segue. Só decisão malformada — ação, data, valor, fatura —
 * recusa o plano, e aí sem status: quem chama transfere.
 */
export async function planejarDaFuncionaria(
  cliente: ClienteDoPlanejador,
  providerId: number,
  organizationId: string,
  agenteId: string,
  pedido: PedidoPlanoAutonomia,
): Promise<Resultado<PlanoDaFuncionaria>> {
  const inicio = Date.now();
  const pediuEscrita = pedido.escrever === true;
  let r = await cliente.planejarAutonomia(organizationId, agenteId, pedido);
  let degradado = false;
  if (!r.ok && pediuEscrita && r.status === 400) {
    degradado = true;
    logger.warn({ providerId, status: r.status }, "Autonomia: o planejador recusou o pedido com escrita; repetindo sem escrever");
    const { escrever: _semEscrita, ...modoAntigo } = pedido;
    r = await cliente.planejarAutonomia(organizationId, agenteId, { ...modoAntigo, requestId: requestIdSemEscrita(pedido.requestId) });
  }
  const ms = Date.now() - inicio;
  if (!r.ok) {
    logger.warn({ providerId, etapa: "planejador", ms, degradado, status: r.status }, "Autonomia: planejador sem plano");
    return r;
  }

  const escreveu = pediuEscrita && !degradado;
  const bruto: unknown = r.valor && typeof r.valor === "object" && !Array.isArray(r.valor) ? { ...(r.valor as Record<string, unknown>) } : r.valor;
  if (bruto && typeof bruto === "object" && "mensagens" in bruto) {
    const comMensagens = bruto as Record<string, unknown>;
    if (!escreveu) delete comMensagens.mensagens;
    else if (!MensagensDoPlanoSchema.safeParse(comMensagens.mensagens).success) {
      delete comMensagens.mensagens;
      logger.warn({ providerId, codigo: "mensagens_fora_do_contrato" }, "Autonomia: balões do planejador descartados; o plano segue com a reserva");
    }
  }
  const plano = PlanoRespostaSchema.safeParse(bruto);
  if (!plano.success) {
    logger.warn({ providerId, etapa: "planejador", ms, codigo: "plano_fora_do_contrato" }, "Autonomia: plano fora do contrato");
    return { ok: false, erro: "O planejador devolveu um plano fora do contrato" };
  }
  logger.info({ providerId, etapa: "planejador", ms, acao: plano.data.acao, escreveu, degradado, baloes: plano.data.mensagens?.length ?? 0 }, "Autonomia: plano recebido");
  return { ok: true, valor: { plano: plano.data, escreveu, degradado } };
}
