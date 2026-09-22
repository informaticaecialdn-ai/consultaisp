import { randomUUID } from "crypto";
import { ConfigAutonomiaSchema, lerFuncionariaDigital, type ConfigAutonomia, type FuncionariaDigital, type PedidoPlanoAutonomia, type PlanoResposta, type PropostaAutonomia } from "@shared/chat-autonomia";
import { agentePodeOperar, CATALOGO_DE_AGENTES, type AgenteDoChat, type TipoDeAgente } from "@shared/chat-agentes";
import type { OfertasAutonomia } from "@shared/chat-autonomia-seguranca";
import { mensagemDePagamento } from "@shared/cobranca/pagamento-chat";
import { lerAutomacaoChat } from "@shared/cobranca/automacao-chat";
import {
  avisoDeTransferencia, primeiroNomeDoCliente, reservaPosIdentidade, textoPreIdentidade,
  type BaloesDoServidor, type CarteiraDoTexto, type CategoriaDeTransferencia, type DadosDaConversa, type PedidoDeReserva, type SementeDoTexto, type SituacaoPreIdentidade,
} from "@shared/chat-funcionaria-textos";
import { classificarEncerramento, classificarMensagemPreIdentidade, classificarTransferencia, decidirPreIdentidade, detectarPerguntaDeRobo, tipoDaMensagem } from "@shared/chat-funcionaria-triagem";
import { normalizarParaVerificacao, ofertaVerificavel, verificarMensagens, type ContextoDaVerificacao, type FatosDaRodada, type GravadoVerificavel, type SituacaoDaRodada } from "@shared/chat-funcionaria-digital";
import { storage } from "../../storage";
import { logger } from "../../logger";
import { autonomiaStorage, type EstadoAutonomia, type TrabalhoAutonomia } from "../../storage/chat-autonomia.storage";
import { segurancaAutonomiaStorage } from "../../storage/chat-autonomia-seguranca.storage";
import { pausarComunicacao } from "../../storage/cobranca-comunicacao.storage";
import { avaliarIdentidade, identidadeVigente, pedirIdentidadeDeNovo, protegerHistorico, type EstadoIdentidade } from "./chat-autonomia-identidade";
import { normalizarTelefoneParaChat, type ChatBullqClient, type Mensagem } from "./chat-bullq.client";
import { mesmoTelefoneWhatsapp } from "./telefone-whatsapp";
import { orientarContato } from "@shared/cobranca/contato";
import { resolverEtapas } from "@shared/cobranca/regua";
import { processarNegociacaoAutonoma } from "./chat-autonomia-negociacao.service";
import { FaturasStorage } from "../../storage/faturas.storage";
import { clienteDoChat, ErroDaPonteDoChat } from "./chat-ponte.service";
import { comTravaDoChat } from "./chat-trava";
import { listarAgentesDoChat, comTravaDaConfiguracaoDoChat, modelosDosAgentesDoChat } from "./chat-agentes.service";
import { contextoDoAtendimento, segundaViaDoAtendimento } from "./chat-contexto.service";
import { casoParaAgente, registrarPromessaDoAgente } from "./chat-agente.service";
import { confirmacaoTolerante, dataLocal, propostaConfirmada, reservaDaProposta, reservaDaResposta, validarProposta, VALIDADE_DA_PROPOSTA_MS, type ContextoDaResposta } from "./chat-autonomia-politica";
import { enviarBaloesDaFuncionaria, planejarDaFuncionaria, requestIdSemEscrita, type PlanoDaFuncionaria, type ResultadoDoEnvioDaFuncionaria } from "./chat-envio-funcionaria";
import { ACAO_AO_RECEBER_MENSAGEM } from "./chat-atendimento.service";
import { casoFechado } from "@shared/cobranca/estados";
import type { ChatBullqConversa, ChatBullqIntegracao } from "@shared/schema";
import type { Resultado } from "./chat-bullq.client";

/**
 * A recusa do Chat BullQ sobe como erro da ponte, com a razão que o cliente
 * já devolve segura (só o `message` da API, nunca o corpo cru) e o HTTP de
 * lá — a rota responde 502 com ela. Como `Error` genérico, a rota a escondia
 * atrás do 503 "confira as migrações" (VPS, 16/09/2026: era um 400 da máquina
 * de estados do fork ao OPEN→BOT).
 */
const valor = <T>(r: Resultado<T>): T => { if (!r.ok) throw new ErroDaPonteDoChat("CHAT_FALHOU", r.erro || "O Chat BullQ recusou a operação", r.status); return r.valor; };
/** Os status da conversa no Chat BullQ, como o operador os lê — depois de "está" e de "ficar". */
const ESTADO_NO_CHAT: Record<string, string> = { PENDING: "na fila", OPEN: "em atendimento humano", BOT: "com o assistente", WAITING: "aguardando o cliente", CLOSED: "encerrada" };
/**
 * A razão do fork em português quando é a máquina de estados dele — a string
 * REAL é "Invalid transition: OPEN → BOT" (`conversation-fsm.service.ts`), que
 * chegava crua ao toast do operador. O resto já é só o `message` da API ou a
 * frase fixa do cliente ("O Chat BullQ respondeu 500") e passa como veio.
 */
function razaoDoChat(mensagem: string): string {
  const m = /^Invalid transition: (\w+) → (\w+)$/.exec(mensagem);
  return m ? `a conversa está ${ESTADO_NO_CHAT[m[1]] ?? m[1]} no Chat BullQ e de lá não passa direto a ficar ${ESTADO_NO_CHAT[m[2]] ?? m[2]}` : mensagem;
}
/** "“A”", "“A” e “B”", "“A”, “B” e “C”". */
const nomesDe = (tipos: TipoDeAgente[]) => { const n = tipos.map(t => `“${CATALOGO_DE_AGENTES[t].nome}”`); return n.length === 1 ? n[0] : `${n.slice(0, -1).join(", ")} e ${n.at(-1)}`; };
/**
 * A recusa diz QUAL agente e POR QUÊ, no vocabulário da tela ("agente", seção
 * "Agentes do chat"): sem provisionar (provisione) ou provisionado mas pausado
 * (habilite) — o mesmo predicado da tela, `agentePodeOperar`. Vazio quando
 * todos os marcados operam.
 */
function recusaPorAgente(agentes: AgenteDoChat[], tipos: TipoDeAgente[]): string {
  const de = (tipo: TipoDeAgente) => agentes.find(a => a.tipo === tipo);
  const pausados = tipos.filter(t => { const a = de(t); return a && !agentePodeOperar(a) && a.etapa === "pronto" && a.id && a.modelo; });
  const semProvisao = tipos.filter(t => { const a = de(t); return !pausados.includes(t) && !(a && agentePodeOperar(a)); });
  const frases: string[] = [];
  if (semProvisao.length === 1) frases.push(`O agente ${nomesDe(semProvisao)} ainda não está provisionado. Provisione-o em Agentes do chat ou desmarque-o.`);
  else if (semProvisao.length) frases.push(`Os agentes ${nomesDe(semProvisao)} ainda não estão provisionados. Provisione-os em Agentes do chat ou desmarque-os.`);
  if (pausados.length === 1) frases.push(`O agente ${nomesDe(pausados)} está pausado. Marque “Habilitado para abrir contato” em Agentes do chat ou desmarque-o aqui.`);
  else if (pausados.length) frases.push(`Os agentes ${nomesDe(pausados)} estão pausados. Marque “Habilitado para abrir contato” em Agentes do chat ou desmarque-os aqui.`);
  return frases.join(" ");
}
/**
 * A marcação gravada de um agente BLOQUEADO não se perde ao salvar. Na tela a
 * caixa dele fica desabilitada — o operador não consegue desmarcá-la, e por
 * isso o envio vem sem ela; gravar só o que chegou apagaria de vez a cobertura
 * de uma carteira inteira de quem só queria mudar o limite diário. Preservada
 * aqui, ela reaparece sozinha quando o agente for provisionado ou habilitado,
 * exatamente como a tela promete. Só o que está bloqueado: desmarcar um agente
 * que OPERA continua sendo decisão do operador.
 */
function tiposBloqueadosAPreservar(gravada: ConfigAutonomia, enviada: ConfigAutonomia, agentes: AgenteDoChat[]): TipoDeAgente[] {
  return gravada.tipos.filter(t => !enviada.tipos.includes(t) && !agentes.some(a => a.tipo === t && agentePodeOperar(a)));
}
const faturasDaAutonomia = new FaturasStorage();
export const chaveDaAutonomia = (providerId: number, conversationId: string) => `autonomia:${providerId}:${conversationId}`;

/** O que a IA NUNCA faz sozinha, dito pelo servidor — a tela repete estas palavras, não inventa as suas. */
export const LIMITES_DA_AUTONOMIA = {
  maxTurnos: 20, maxPlanosPorMensagem: 1, confirmacaoExplicita: true,
  agendamento: "local_sem_reserva_erp", pagamento: "somente_erp", envioAmbiguo: "humano_sem_reenvio",
  identidade: "final_cpf_por_episodio_6h_teto_24h_acordo_2h", negociacao: "oferta_calculada_e_revalidada_com_aceite_explicito",
  nunca: ["negativar", "baixar", "desconto_fora_da_politica", "parcelar_fora_da_politica", "confirmar_pagamento", "confirmar_devolucao"],
} as const;

export async function estadoDaAutonomia(providerId: number) {
  const [config, fila] = await Promise.all([autonomiaStorage.config(providerId), autonomiaStorage.resumo(providerId)]);
  return { config, fila, limites: LIMITES_DA_AUTONOMIA };
}
/** A fila por status, contada no banco — nunca zero por falta de leitura: se a leitura falhar, a rota responde 503 e a tela mostra o traço. */
export async function filaDaAutonomia(providerId: number) {
  const porStatus = await autonomiaStorage.resumo(providerId);
  return { porStatus, total: Object.values(porStatus).reduce((a, b) => a + b, 0), lidoEm: new Date().toISOString() };
}
/**
 * O atendente DEVOLVE a conversa ao assistente (humano=false), sob a mesma
 * trava que `assumir` usa. Só volta o que pode voltar: conversa deste
 * provedor, não encerrada, com a autonomia ligada. O Chat BullQ é atualizado
 * ANTES do estado local — se ele não confirmar, o humano continua dono. A IA
 * de lá fica desligada: quem responde é o motor daqui.
 */
export async function devolverAoAssistente(providerId: number, conversationId: string, userId: number | null) {
  const r = await comTravaDoChat(chaveDaAutonomia(providerId, conversationId), async () => {
    const vinculo = await storage.getConversaDoChat(providerId, conversationId);
    if (!vinculo) throw new ErroDaPonteDoChat("CASO_NAO_ENCONTRADO", "Conversa não encontrada neste provedor");
    if (vinculo.status === "CLOSED") throw new ErroDaPonteDoChat("CONFLITO", "Conversa encerrada não volta ao assistente");
    const config = await autonomiaStorage.config(providerId);
    if (!config.ativa) throw new ErroDaPonteDoChat("CONFLITO", "Ative a autonomia antes de devolver a conversa ao assistente");
    const c = clienteDoChat(); const intg = await storage.getIntegracaoDoChat(providerId);
    if (!c || !intg) throw new ErroDaPonteDoChat("CHAT_DESLIGADO", "Configure o Chat BullQ no Painel do Provedor para atender por aqui");
    try {
      valor(await c.desligarIa(intg.organizationId, conversationId));
      valor(await c.atribuir(intg.organizationId, conversationId, { status: "BOT" }));
    } catch (e) {
      if (!(e instanceof ErroDaPonteDoChat) || e.codigo !== "CHAT_FALHOU") throw e;
      // O que o operador lê no toast: o que se tentava, a razão em português e o que fazer — não "Invalid transition: OPEN → BOT".
      throw new ErroDaPonteDoChat("CHAT_FALHOU", `Não foi possível devolver a conversa ao assistente: ${razaoDoChat(e.message)}. Confira o status dela lá e tente de novo.`, e.status);
    }
    await segurancaAutonomiaStorage.revogar(providerId, conversationId);
    await marcarLidasPeloAtendente(providerId, conversationId);
    await autonomiaStorage.devolver(providerId, conversationId, "Atendente devolveu a conversa ao assistente");
    const atualizado = await storage.atualizarConversaDoChat(providerId, conversationId, { status: "BOT" });
    await storage.registrarEventoDoChat(providerId, atualizado ?? vinculo, userId, "Atendente devolveu a conversa ao assistente autônomo");
    return { valor: { conversationId, status: "BOT" as const, humano: false } };
  });
  if (!r) throw new ErroDaPonteDoChat("CONFLITO", "O assistente está finalizando uma rodada. Tente novamente em instantes.");
  return r.valor;
}
export async function configurarAutonomia(providerId: number, dados: ConfigAutonomia, userId: number | null = null) {
  let config = ConfigAutonomiaSchema.parse(dados);
  return comTravaDaConfiguracaoDoChat(providerId, async () => {
    if (config.ativa) {
      const [{ agentes }, modelos] = await Promise.all([listarAgentesDoChat(providerId), modelosDosAgentesDoChat(providerId)]);
      if (!modelos.configured) throw new ErroDaPonteDoChat("CONFLITO", "Configure a credencial de IA no Chat BullQ antes de ativar a autonomia");
      // A recusa diz QUAL agente e por quê (sem provisionar ou pausado), pelo nome
      // do catálogo: a frase genérica mandava "deixar os agentes prontos" sem dizer qual.
      const recusa = recusaPorAgente(agentes, config.tipos);
      if (recusa) throw new ErroDaPonteDoChat("CONFLITO", recusa);
      config = { ...config, tipos: [...config.tipos, ...tiposBloqueadosAPreservar(await autonomiaStorage.config(providerId), config, agentes)] };
    }
    if (config.permitirNegociacao) {
      const autor = userId ? await storage.getUser(userId) : null;
      if (!autor || autor.providerId !== providerId || autor.role !== "admin") throw new ErroDaPonteDoChat("CONFLITO", "Um administrador deste provedor precisa autorizar a negociação autônoma");
      await segurancaAutonomiaStorage.autorizar(providerId, autor.id);
    }
    await autonomiaStorage.salvarConfig(providerId, config);
    return estadoDaAutonomia(providerId);
  });
}
/** Retorna false só quando o modo não está habilitado. O chamador mantém o fluxo humano legado. */
export async function receberMensagemAutonoma(providerId: number, conversationId: string, messageId: string): Promise<boolean> {
  const config = await autonomiaStorage.config(providerId);
  if (!config.ativa) return false;
  const vinculo = await storage.getConversaDoChat(providerId, conversationId);
  if (!vinculo) return true;
  // A mensagem chegou, mas esta rodada nao vai responde-la (ja esta com o
  // humano, ou a conversa saiu do assistente): o caso recebe o mesmo follow-up
  // do caminho humano em vez de ficar sem nada — ninguem la fora sabe que o
  // modo autonomo estava ligado.
  if (["OPEN", "PENDING", "CLOSED"].includes(vinculo.status)) {
    await pedirRespostaNoCaso(providerId, vinculo);
    return true;
  }
  if ((await autonomiaStorage.estado(providerId, conversationId)).humano) {
    await pedirRespostaNoCaso(providerId, vinculo);
    return true;
  }
  await autonomiaStorage.enfileirar(providerId, conversationId, messageId);
  return true;
}

/**
 * O MESMO follow-up do caminho humano, quando o assistente nao resolve a
 * mensagem: "Responder no chat", agora, e o caso volta a fila (sem dono).
 * Sem isso, com a autonomia ligada, `receberRespostaDoCliente` nao roda e o
 * caso ficava parado — cliente esperando, ninguem com o cartao na mao.
 * Com o atendimento humano em curso (OPEN) o dono continua sendo quem assumiu.
 *
 * Falha aqui nao derruba a transferencia: o cliente sendo entregue ao humano
 * vale mais que a coluna, e a falha vai ao log em vez de virar um reenvio.
 */
async function pedirRespostaNoCaso(providerId: number, vinculo: ChatBullqConversa | null | undefined) {
  if (!vinculo?.casoId) return;
  try {
    const caso = await storage.obterCasoDeCobranca(providerId, vinculo.casoId);
    if (!caso || casoFechado(caso.status)) return;
    await storage.atualizarCasoDeCobranca(providerId, caso.id, {
      proximaAcao: ACAO_AO_RECEBER_MENSAGEM,
      proximoContatoEm: new Date(),
      ...(vinculo.status === "OPEN" ? {} : { responsavelUserId: null }),
    }, null);
  } catch (err) {
    logger.warn({ err, providerId }, "Autonomia: follow-up do caso não gravado; a conversa seguiu para o atendente");
  }
}

async function transferir(job: TrabalhoAutonomia, motivo: string, atualizarFollowUp = true) {
  // Bloqueio local primeiro: se o BullQ falhar, nenhuma próxima rodada responde.
  await autonomiaStorage.cancelar(job.provider_id, job.conversation_id, motivo);
  const lido = await storage.getConversaDoChat(job.provider_id, job.conversation_id);
  const vinculo = lido?.providerId === job.provider_id && lido.conversationId === job.conversation_id ? lido : null;
  if (vinculo && !["OPEN", "CLOSED"].includes(vinculo.status)) {
    await storage.atualizarConversaDoChat(job.provider_id, job.conversation_id, { status: "PENDING" });
    await storage.registrarEventoDoChat(job.provider_id, vinculo, null, `Assistente autônomo transferiu ao atendente: ${motivo}`);
    const c = clienteDoChat(); const i = await storage.getIntegracaoDoChat(job.provider_id);
    if (c && i?.providerId === job.provider_id) { valor(await c.desligarIa(i.organizationId, job.conversation_id)); valor(await c.atribuir(i.organizationId, job.conversation_id, { status: "PENDING" })); }
  }
  // Quem recebe a conversa precisa do caso pedindo resposta, como no fluxo humano.
  if (atualizarFollowUp) await pedirRespostaNoCaso(job.provider_id, vinculo);
  await autonomiaStorage.marcar(job, "humano", motivo);
}

/**
 * Uma tomada humana durante a leitura externa prevalece até sobre a resposta já preparada. `preservarFollowUp`: o caso
 * já recebeu o follow-up desta rodada (acordo, promessa, "conferir telefone") — "Responder no chat" não passa por cima.
 */
async function aindaComAssistente(job: TrabalhoAutonomia, customerId: number, preservarFollowUp = false): Promise<boolean> {
  const [estado, conversa] = await Promise.all([
    autonomiaStorage.estado(job.provider_id, job.conversation_id),
    storage.getConversaDoChat(job.provider_id, job.conversation_id),
  ]);
  if (!estado.humano && conversa?.providerId === job.provider_id && conversa.conversationId === job.conversation_id && conversa.customerId === customerId && ["BOT", "WAITING"].includes(conversa.status)) return true;
  if (!preservarFollowUp && conversa?.providerId === job.provider_id && conversa.conversationId === job.conversation_id) await pedirRespostaNoCaso(job.provider_id, conversa);
  await autonomiaStorage.marcar(job, "cancelado", "Atendimento humano ou vínculo alterado antes do envio");
  return false;
}

/* ───────────────────────── a funcionária na rodada ───────────────────────── */

/**
 * O que a rodada sabe depois de ler conversa, caso, agente e cadastro — tudo o que um balão, um aviso ou uma reserva
 * precisa. `voz` são os nomes (persona do perfil, provedor, cliente) e o canal oficial do cadastro do provedor.
 */
interface RodadaEmCurso {
  job: TrabalhoAutonomia;
  rodada: RodadaDaFila;
  c: ChatBullqClient;
  intg: ChatBullqIntegracao;
  vinculo: ChatBullqConversa;
  providerId: number;
  conversationId: string;
  customerId: number;
  mensagens: Mensagem[];
  /** Os balões que já saíram nesta conversa (OUTBOUND), para nenhuma frase se repetir (f13). */
  enviados: string[];
  voz: DadosDaConversa;
  agente: AgenteDoChat | undefined;
  carteira: CarteiraDoTexto;
  /** A identidade confirmada NESTA rodada ou vigente do episódio: decide se o aviso é neutro (§3.4). */
  identidadeConfirmada: boolean;
  /** A mensagem do cliente desta rodada (só é lida; nunca vai a log). */
  texto: string | null;
  politica: () => Promise<Awaited<ReturnType<typeof storage.getPoliticaDeCobranca>>>;
  /**
   * O caso já recebeu o follow-up desta rodada (acordo, promessa, agendamento): nenhum caminho de borda — autonomia
   * pausada, humano que assumiu, envio que falhou, exceção — o troca por "Responder no chat".
   */
  efeitos: { followUpGravado: boolean };
}

/** Balão comparável: sem caixa, acento e pontuação — "Tô aqui!" e "to aqui" são a mesma frase para quem lê. */
const chaveDoBalao = (t: string) => normalizarParaVerificacao(t).replace(/[^a-z0-9]+/g, " ").trim();
const baloesDe = (texto: string | undefined | null) => (texto ?? "").split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);

/**
 * A frase do servidor sem repetir a usada por último (f13, §7): a variação é determinística por conversa, então a
 * MESMA situação duas vezes daria a mesma frase — o que denuncia o robô. Das duas variações que a semente alcança (a
 * da conversa e a seguinte), sai a que apareceu há mais tempo nos balões enviados, ou nunca. Evitar só a primeira
 * fazia A → B → B: na terceira vez, "a outra" era justamente a última.
 */
function semRepetir(gerar: (semente: SementeDoTexto) => BaloesDoServidor, r: Pick<RodadaEmCurso, "conversationId" | "enviados">): BaloesDoServidor {
  const primeira = gerar({ conversationId: r.conversationId });
  const outra = gerar({ conversationId: r.conversationId, ultimaVariacao: primeira.variacao });
  const enviados = r.enviados.map(chaveDoBalao);
  /** A posição do uso mais recente de algum balão da variação; -1 = nunca saiu. */
  const ultimoUso = (baloes: readonly string[]) => baloes.reduce((mais, b) => Math.max(mais, enviados.lastIndexOf(chaveDoBalao(b))), -1);
  return ultimoUso(outra) < ultimoUso(primeira) ? outra : primeira;
}

/**
 * O que a rodada grava no estado da identidade além do que `avaliarIdentidade` monta (JSONB, sem migração):
 * - `lidasComIdentidadeAte`: o `createdAt` da última mensagem do cliente que passou pela triagem de DEPOIS da
 *   identidade — ou o instante em que o atendente devolveu a conversa. O que chegou depois disso e antes da mensagem
 *   atual ainda não foi lido com a identidade (s10): o "já paguei" respondido com o pedido dos dígitos, ou cancelado
 *   por uma mensagem mais nova.
 * - `confirmadaNaMensagem`: a mensagem cujos dígitos confirmaram. A rodada que volta à fila (503 "ocupado", parada do
 *   worker) encontra a identidade já vigente e, sem isto, perdia o "recém-confirmada" — e citava o valor (f20).
 */
type EstadoIdentidadeDaRodada = EstadoIdentidade & { lidasComIdentidadeAte?: string | null; confirmadaNaMensagem?: string | null };
/** O teto do episódio (D10): mensagem mais velha que isto não é pedido pendente de ninguém. */
export const JANELA_DOS_PEDIDOS_SEM_TRIAGEM_MS = 24 * 60 * 60_000;

/** Até onde as mensagens do cliente já passaram pela triagem com a identidade. `null` = nunca (a janela de 24 h vale). */
function lidasComIdentidadeAte(estado: EstadoIdentidade | null, mensagens: readonly Mensagem[]): string | null {
  const marcado = (estado as EstadoIdentidadeDaRodada | null)?.lidasComIdentidadeAte;
  if (typeof marcado === "string" && Number.isFinite(Date.parse(marcado))) return marcado;
  // Estado gravado antes desta marca: com a confirmação ainda nele, a última mensagem avaliada foi lida com a identidade.
  if (estado?.confirmadaEm) return mensagens.find(m => m.id === estado.ultimaMensagemId)?.createdAt ?? null;
  return null;
}

/**
 * Os textos do cliente que chegaram antes da mensagem atual e ainda não passaram pela triagem de depois da identidade
 * (s10, §3.3). Antes dos dígitos, "já paguei", "já devolvi" e "vão me negativar?" recebem o pedido de identidade — a
 * conferência precisa saber de quem é —, e a regra do §3.3 é que os leva à equipe com o aviso certo. Lendo só a
 * mensagem atual, o "8909" seguinte ia ao planejador, e quem pagou continuava sendo cobrado.
 */
export function pedidosSemTriagem(mensagens: readonly Mensagem[], atual: Mensagem, lidasAte: string | null): string[] {
  const fim = Date.parse(atual.createdAt);
  const marca = lidasAte ? Date.parse(lidasAte) : NaN;
  const desde = Number.isFinite(marca) ? Math.max(marca, fim - JANELA_DOS_PEDIDOS_SEM_TRIAGEM_MS) : fim - JANELA_DOS_PEDIDOS_SEM_TRIAGEM_MS;
  const posicao = mensagens.indexOf(atual);
  return mensagens.slice(0, Math.max(0, posicao))
    .filter(m => m.direction === "INBOUND" && Date.parse(m.createdAt) > desde && tipoDaMensagem(m.type, m.content?.text) === "texto")
    .map(m => (m.content?.text ?? "").trim())
    .filter(Boolean);
}

/** O atendente devolveu a conversa: o que o cliente escreveu até aqui foi lido por ele, e não é pedido pendente do assistente. */
async function marcarLidasPeloAtendente(providerId: number, conversationId: string) {
  try {
    const lido = await segurancaAutonomiaStorage.ler(providerId, conversationId);
    if (!lido?.identidade) return;
    const estado: EstadoIdentidadeDaRodada = { ...lido.identidade, lidasComIdentidadeAte: new Date().toISOString() };
    await segurancaAutonomiaStorage.identidade(providerId, conversationId, estado);
  } catch (err) {
    // Melhor esforço: sem a marca, a janela de 24 h vale — no pior caso, um pedido já atendido volta à equipe.
    logger.warn({ providerId, etapa: "devolver", causa: causaDoErro(err) }, "Autonomia: marca de leitura do atendente não gravada");
  }
}

/**
 * A fala que sai DEPOIS de a conversa ir à equipe — o aviso de transferência (§3.4), a frase de encerramento (§3.2) e a
 * confirmação do acordo (§3.3) — e só nessa ordem. Com a chave D9 ligada, o lote do agente (vps/010) PARA quando a IA
 * da conversa é desligada depois de ele ser aceito (`aiDisabledAt` posterior ao lote), e desligar a IA é justamente o
 * que `transferir` faz: enviada antes da transferência, a frase entrava na fila e morria no "digitando…" — quem aceitou
 * o acordo não recebia a data e o valor registrados, e quem pediu para parar ficava sem resposta (revisão final).
 * Transferida antes, a conversa é conferida AGORA: do mesmo cliente, sem atendente (OPEN) e não encerrada — o PENDING
 * desta rodada vale —, `ativa` relida (pausada, nada sai) e a chave D9 decide a voz (`montar` recebe a chave lida).
 * Devolve o envio, ou `null` quando nada foi enviado por decisão.
 */
async function falarDepoisDeTransferir(
  r: RodadaEmCurso,
  montar: (ligada: boolean) => Promise<readonly string[] | null> | readonly string[] | null,
  log: { etapa: string } & Record<string, unknown>,
  mensagem: string,
): Promise<ResultadoDoEnvioDaFuncionaria | null> {
  const lido = await storage.getConversaDoChat(r.providerId, r.conversationId);
  if (!lido || lido.providerId !== r.providerId || lido.conversationId !== r.conversationId || lido.customerId !== r.customerId || ["OPEN", "CLOSED"].includes(lido.status)) return null;
  const atual = await lerConfiguracaoDaRodada(r.providerId);
  if (!atual.config.ativa) {
    logger.info({ providerId: r.providerId, jobId: r.job.id, ...log, desfecho: "autonomia_pausada" }, `${mensagem} — nada enviado, a autonomia foi pausada`);
    return null;
  }
  // Desligada no meio da rodada, a fala sai sem o agente.
  const ligada = atual.funcionariaDigital.ativa;
  const baloes = await montar(ligada);
  if (!baloes?.length) return null;
  const envio = await enviarBaloesDaFuncionaria({
    cliente: r.c, providerId: r.providerId, customerId: r.customerId, organizationId: r.intg.organizationId, conversationId: r.conversationId,
    baloes, funcionariaDigitalAtiva: ligada, aiAgentId: ligada ? r.agente?.id ?? null : null,
  });
  logger.info({ providerId: r.providerId, jobId: r.job.id, ...log, desfecho: envio.ok ? "aceito" : envio.envio }, mensagem);
  return envio;
}

/**
 * §3.4: o aviso de transferência, por frase fixa e sem prazo, DEPOIS de a conversa estar com a equipe
 * (`marcar(job,'humano')`) e em melhor esforço — dentro do orçamento de contato e de um try/catch (achado e1). Um
 * aviso que falha não volta a rodada nem a transferência. Quem chama só avisa nos motivos permitidos; o resto das
 * conferências é de `falarDepoisDeTransferir`.
 */
async function avisarTransferencia(r: RodadaEmCurso, categoria: CategoriaDeTransferencia) {
  try {
    await falarDepoisDeTransferir(r, async () => {
      const politica = await r.politica();
      const automacao = lerAutomacaoChat((r.intg.agenteConfig as Record<string, unknown> | null | undefined)?.primeiroContato);
      const baloes = semRepetir(s => avisoDeTransferencia(categoria, {
        ...r.voz, identidadeConfirmada: r.identidadeConfirmada, agora: new Date(), janela: politica?.janelaContato,
        diasPausados: automacao.diasPausados, ultimaMensagemDoCliente: r.texto, carteira: r.carteira,
      }, s), r);
      return baloes.aprovada === false ? null : baloes;
    }, { etapa: "aviso", categoria }, "Autonomia: aviso de transferência");
  } catch (err) {
    logger.warn({ providerId: r.providerId, jobId: r.job.id, etapa: "aviso", causa: causaDoErro(err) }, "Autonomia: aviso de transferência não enviado; a conversa já está com a equipe");
  }
}
/** Transfere e, depois, avisa o cliente (§3.4). Para os motivos que NÃO avisam, a rodada chama `transferir`. */
async function transferirComAviso(r: RodadaEmCurso, motivo: string, categoria: CategoriaDeTransferencia, atualizarFollowUp = true) {
  await transferir(r.job, motivo, atualizarFollowUp && !r.efeitos.followUpGravado);
  await avisarTransferencia(r, categoria);
}

/** O turno pronto: os balões da reserva (sempre) e, com a chave D9 ligada e o verificador de acordo, os da funcionária. */
interface TurnoDaFuncionaria { reserva: readonly string[]; comIA?: readonly string[] | null }
interface OpcoesDoTurno {
  /**
   * Algo que não se repete já aconteceu nesta rodada — promessa, acordo, agendamento, tentativa gasta, ofertas ou
   * escolha gravadas: a parada do worker não devolve a rodada à fila, que refaria o efeito ou o trataria como velho.
   */
  houveEfeito: boolean;
  /**
   * O turno só é debitado quando a rodada se compromete a enviar (áudio e desafio, que não chamam a IA): a rodada
   * devolvida à fila pela parada do worker não conta duas vezes.
   */
  debitarTurno?: () => Promise<void>;
}

/**
 * O envio do turno (§9): a trava do operador (`aindaComAssistente`), a reconferência de `ativa` e da chave D9, a
 * parada do worker (só se nada irreversível aconteceu nesta rodada) e UM orçamento de contato em volta dos balões.
 * Falha de envio — recusa ou incerteza — vai à equipe SEM aviso e sem reenvio: o mesmo canal acabou de falhar, e
 * algum balão pode ter saído. Com o follow-up desta rodada já gravado no caso, nenhuma dessas saídas o sobrescreve.
 */
async function enviarTurno(r: RodadaEmCurso, turno: TurnoDaFuncionaria, evento: string, opcoes: OpcoesDoTurno): Promise<boolean> {
  const preservar = r.efeitos.followUpGravado;
  if (!await aindaComAssistente(r.job, r.customerId, preservar)) return false;
  const atual = await lerConfiguracaoDaRodada(r.providerId);
  if (!atual.config.ativa) {
    if (preservar) {
      // O registro já foi gravado e o cliente não recebeu a confirmação: a equipe confirma, com o follow-up que já está no caso.
      await transferir(r.job, "Autonomia pausada antes de confirmar ao cliente o que foi registrado; a equipe confirma por aqui", false);
      return false;
    }
    await pedirRespostaNoCaso(r.providerId, r.vinculo);
    await autonomiaStorage.marcar(r.job, "cancelado", "Autonomia pausada antes do envio");
    return false;
  }
  if (!opcoes.houveEfeito && await devolverSeParando(r.job, r.rodada)) return false;
  if (opcoes.debitarTurno) await opcoes.debitarTurno();
  const ligada = atual.funcionariaDigital.ativa;
  const baloes = ligada && turno.comIA?.length ? turno.comIA : turno.reserva;
  // Marcado ANTES do HTTP: nunca repetir envio ambíguo.
  await autonomiaStorage.marcar(r.job, "enviando");
  const envio = await enviarBaloesDaFuncionaria({
    cliente: r.c, providerId: r.providerId, customerId: r.customerId, organizationId: r.intg.organizationId, conversationId: r.conversationId,
    baloes, funcionariaDigitalAtiva: ligada, aiAgentId: ligada ? r.agente?.id ?? null : null,
  });
  if (!envio.ok) {
    await transferir(r.job, envio.envio === "nao_saiu" ? "Envio recusado pelo chat; conferir antes de nova tentativa" : "Falha na rodada ou envio não confirmado; conferir histórico, sem reenvio automático", !preservar);
    return false;
  }
  await autonomiaStorage.marcar(r.job, "concluido");
  await storage.registrarEventoDoChat(r.providerId, r.vinculo, null, evento);
  return true;
}

/**
 * Número errado, pedido para parar, contestação de titularidade e tentativas esgotadas (§3.2): uma frase própria e a
 * conversa vai à equipe EM SILÊNCIO — sem aviso de transferência, que chamaria um estranho a continuar.
 * - número errado: o telefone a conferir vai ao caso ANTES da frase (s9), e o follow-up fica "conferir telefone";
 * - parar: a frase sai e `nao_contatar` é gravado pelo caminho das preferências de contato (`pausarComunicacao`).
 *   A ordem é essa de propósito: gravado antes, o orçamento de contato recusaria a própria confirmação do pedido.
 *   Gravado sempre — também se a frase não sair, se alguém tiver assumido a conversa ou se a autonomia tiver sido pausada.
 * Autonomia pausada no meio da rodada: a frase não sai (§3.4), e o registro e a transferência acontecem do mesmo jeito.
 * A conversa vai à equipe ANTES da frase (`falarDepoisDeTransferir`): enviada antes, o lote do agente parava na
 * transferência e a frase não chegava.
 */
async function encerrarComFrase(r: RodadaEmCurso, situacao: SituacaoPreIdentidade, opcoes: { gravarNaoContatar?: boolean; conferirTelefone?: boolean }, motivo: string, estado: EstadoAutonomia) {
  if (opcoes.conferirTelefone) {
    const notas = "Quem respondeu disse que o número não é do cliente: conferir o telefone do cadastro antes de novo contato";
    try {
      const followUp = { proximaAcao: ACAO_CONFERIR_TELEFONE, proximoContatoEm: new Date() };
      await storage.registrarEventoDoChat(r.providerId, r.vinculo, null, notas, followUp);
      const caso = r.vinculo.casoId ? await storage.obterCasoDeCobranca(r.providerId, r.vinculo.casoId) : null;
      if (caso && !casoFechado(caso.status)) await storage.atualizarCasoDeCobranca(r.providerId, caso.id, { ...followUp, responsavelUserId: null }, null);
      // "Conferir telefone" está no caso: nenhum caminho de borda — humano que assumiu, transferência que lança e cai no
      // catch da rodada — o troca por "Responder no chat". Caso encerrado não recebe follow-up de ninguém.
      r.efeitos.followUpGravado = true;
      // A retirada não tem "próxima ação": o equivalente é a tentativa "Número inválido", que o quadro de recuperação mostra
      // como o último resultado do caso — a nota sozinha ficava na linha do tempo, sem ninguém com o cartão na mão.
      if (r.vinculo.recuperacaoId) await storage.addRecoveryAttempt({ providerId: r.providerId, caseId: r.vinculo.recuperacaoId, userId: null, channel: "whatsapp", result: "numero_invalido", occurredAt: new Date(), notes: notas });
    } catch (err) {
      logger.warn({ providerId: r.providerId, jobId: r.job.id, etapa: "conferir_telefone", causa: causaDoErro(err) }, "Autonomia: follow-up de telefone não gravado; a conversa segue para a equipe");
    }
  }
  // Gravado DEPOIS da frase (senão o orçamento a recusaria) e sempre: também sem frase, com a transferência que falha
  // ou com alguém que assumiu a conversa.
  const gravarNaoContatar = async () => {
    if (!opcoes.gravarNaoContatar) return;
    try { await pausarComunicacao(r.providerId, r.customerId, null, "nao_contatar"); }
    catch (err) { logger.warn({ providerId: r.providerId, jobId: r.job.id, etapa: "nao_contatar", causa: causaDoErro(err) }, "Autonomia: pedido para parar não gravado; conferir as preferências de contato do cliente"); }
  };
  let frase: BaloesDoServidor | null = null;
  try {
    const baloes = semRepetir(s => textoPreIdentidade(situacao, r.voz, s), r);
    if (baloes.aprovada !== false && baloes.length) {
      // Um atendente assumiu: a conversa já é dele — nem frase, nem transferência por cima.
      if (!await aindaComAssistente(r.job, r.customerId, r.efeitos.followUpGravado)) { await gravarNaoContatar(); return; }
      frase = baloes;
    }
  } catch (err) {
    logger.warn({ providerId: r.providerId, jobId: r.job.id, etapa: "encerramento", causa: causaDoErro(err) }, "Autonomia: frase de encerramento não confirmada; nada é reenviado");
  }
  try { await transferir(r.job, motivo, !r.efeitos.followUpGravado); }
  catch (err) { await gravarNaoContatar(); throw err; }
  try {
    const baloes = frase;
    if (baloes) {
      await falarDepoisDeTransferir(r, async () => {
        await autonomiaStorage.turno(r.providerId, r.conversationId, estado.episodioNovo === true);
        return baloes;
      }, { etapa: "encerramento", situacao }, "Autonomia: frase de encerramento");
    }
  } catch (err) {
    logger.warn({ providerId: r.providerId, jobId: r.job.id, etapa: "encerramento", causa: causaDoErro(err) }, "Autonomia: frase de encerramento não confirmada; nada é reenviado");
  } finally {
    await gravarNaoContatar();
  }
}

/**
 * O acordo aceito (§3.3): a conversa vai à equipe, que prepara a cobrança, e SÓ DEPOIS a confirmação da data e do valor
 * registrados sai ao cliente (`falarDepoisDeTransferir`). As travas de `enviarTurno` valem antes: o atendente que
 * assumiu não recebe transferência por cima, e a autonomia pausada transfere sem confirmar. O follow-up "Preparar
 * cobrança do acordo aceito no chat" já está no caso, e nenhum desses caminhos o troca. A linha do tempo diz se a
 * confirmação saiu: sem ela, a equipe confere o histórico antes de confirmar por aqui (nunca há reenvio automático).
 */
async function confirmarAcordoDepoisDeTransferir(r: RodadaEmCurso, turno: TurnoDaFuncionaria) {
  if (!await aindaComAssistente(r.job, r.customerId, true)) return;
  if (!(await lerConfiguracaoDaRodada(r.providerId)).config.ativa) {
    await transferir(r.job, "Autonomia pausada antes de confirmar ao cliente o que foi registrado; a equipe confirma por aqui", false);
    return;
  }
  await transferir(r.job, "Acordo aceito; equipe precisa preparar a cobrança e orientar pagamento", false);
  let enviada = false;
  try {
    const envio = await falarDepoisDeTransferir(r, ligada => (ligada && turno.comIA?.length ? turno.comIA : turno.reserva), { etapa: "confirmacao" }, "Autonomia: confirmação do acordo");
    enviada = envio?.ok === true;
  } catch (err) {
    logger.warn({ providerId: r.providerId, jobId: r.job.id, etapa: "confirmacao", causa: causaDoErro(err) }, "Autonomia: confirmação do acordo não enviada; a conversa já está com a equipe");
  }
  await storage.registrarEventoDoChat(r.providerId, r.vinculo, null, enviada
    ? "Assistente autônomo registrou o acordo aceito pelo cliente"
    : "Acordo aceito registrado; o chat não confirmou o envio da data e do valor ao cliente — conferir o histórico antes de confirmar por aqui");
}
export const ACAO_CONFERIR_TELEFONE = "Conferir telefone do cadastro";

/** Uma frase de encerramento (§3.2): qual, e o que ela grava. */
interface EncerramentoDaMensagem { situacao: "numero_errado" | "pediu_para_parar" | "contesta_titularidade"; gravarNaoContatar: boolean; conferirTelefone: boolean }
/**
 * A mensagem pede o encerramento (s6)? Com a identidade vigente vale o critério de depois dela (`classificarEncerramento`:
 * só o número errado inequívoco — o titular que diz "não conheço o técnico" não recebe a desculpa por engano); sem ela,
 * o da triagem de antes: número errado, pedido para parar e contestação de titularidade.
 */
export function encerramentoDaMensagem(texto: string | null, identidadeConfirmada: boolean, nomeDoCliente: string | null): EncerramentoDaMensagem | null {
  if (!texto) return null;
  if (identidadeConfirmada) {
    const situacao = classificarEncerramento(texto);
    return situacao ? { situacao, gravarNaoContatar: situacao === "pediu_para_parar", conferirTelefone: situacao === "numero_errado" } : null;
  }
  const decisao = decidirPreIdentidade(classificarMensagemPreIdentidade({ texto, nomeDoCliente }).categoria);
  if (decisao.acao !== "encerrar" || !["numero_errado", "pediu_para_parar", "contesta_titularidade"].includes(decisao.situacao)) return null;
  return { situacao: decisao.situacao as EncerramentoDaMensagem["situacao"], gravarNaoContatar: decisao.gravarNaoContatar === true, conferirTelefone: decisao.conferirTelefone === true };
}

/**
 * A rodada falhou DEPOIS de gravar o follow-up no caso (acordo, promessa, "conferir telefone") e a própria transferência
 * do catch também falhou (fork fora): quem desiste do trabalho não troca o follow-up por "Responder no chat".
 */
class FalhaDepoisDoFollowUp extends Error {
  constructor(causa: unknown) {
    super("Rodada falhou depois de gravar o follow-up do caso");
    this.name = causaDoErro(causa);
  }
}

/** Os motivos das frases de encerramento, como a linha do tempo mostra ao atendente. */
const MOTIVO_DO_ENCERRAMENTO: Partial<Record<SituacaoPreIdentidade, string>> = {
  numero_errado: "Quem respondeu informou número errado; conferir o telefone do cadastro",
  pediu_para_parar: "Cliente pediu para não receber mensagens; contato bloqueado nas preferências",
  contesta_titularidade: "Quem respondeu contesta a titularidade do cadastro; conferir com a equipe",
  tentativas_esgotadas: "Identificação não confirmada: tentativas esgotadas; atendimento humano necessário",
};

/**
 * 12 itens, balões seguidos da funcionária num item só (até 1.200). `caracteresNoTotal` é o teto do FORK para o
 * `context` MAIS o histórico (`parsePlanRequest`, vps/003 e vps/009): quem monta o pedido desconta o `context`.
 */
export const HISTORICO_DO_PLANEJADOR = { itens: 12, caracteresPorItem: 1200, caracteresNoTotal: 14_000 } as const;
/**
 * O histórico que o planejador lê. Contado em ITENS, 8 mensagens cobriam uns dois turnos quando a resposta vem em
 * balões: a funcionária "esquecia" o "tô desempregado" de três mensagens antes. OUTBOUND consecutivos viram um item.
 * Documento e os dígitos do desafio saem antes (`protegerHistorico`).
 *
 * `orcamento` é o que sobra para o histórico depois do `context` (e11): o fork soma os dois e recusa com 400 acima de
 * 14.000 — com 12 itens de até 1.200 e um contexto de 20 faturas, o histórico sozinho cabia e o pedido não. O 400
 * repetido sem `escrever` recebia 400 de novo, e a conversa ia à equipe sem motivo.
 */
export function historicoDoPlanejador(mensagens: readonly Mensagem[], documento: string, orcamento: number = HISTORICO_DO_PLANEJADOR.caracteresNoTotal): PedidoPlanoAutonomia["history"] {
  const { itens: maxItens, caracteresPorItem } = HISTORICO_DO_PLANEJADOR;
  const caracteresNoTotal = Math.max(0, Math.min(orcamento, HISTORICO_DO_PLANEJADOR.caracteresNoTotal));
  const itens: PedidoPlanoAutonomia["history"] = [];
  for (const m of mensagens) {
    const role = m.direction === "INBOUND" ? "user" as const : "assistant" as const;
    const conteudo = protegerHistorico(m.content?.text?.trim() || "[mídia]", documento).slice(0, caracteresPorItem);
    const anterior = itens.at(-1);
    if (role === "assistant" && anterior?.role === "assistant" && anterior.content.length + 2 + conteudo.length <= caracteresPorItem) {
      anterior.content = `${anterior.content}\n\n${conteudo}`;
      continue;
    }
    itens.push({ role, content: conteudo });
  }
  let recorte = itens.slice(-maxItens);
  // Sai do mais antigo; nunca acima do orçamento — nem que sobre nenhum item (só com um `context` que o fork já recusaria).
  while (recorte.length && recorte.reduce((soma, i) => soma + i.content.length, 0) > caracteresNoTotal) recorte = recorte.slice(1);
  return recorte;
}
/** O histórico que cabe junto com ESTE `context` no teto do fork. */
const historicoComContexto = (mensagens: readonly Mensagem[], documento: string, context: string) =>
  historicoDoPlanejador(mensagens, documento, HISTORICO_DO_PLANEJADOR.caracteresNoTotal - context.length);

/** O último balão que saiu é pergunta? `undefined` quando nada saiu na leitura (a confirmação não fica mais estrita por falta de dado). */
function ultimaSaidaEhPergunta(mensagens: readonly Mensagem[]): boolean | undefined {
  const ultima = [...mensagens].reverse().find(m => m.direction === "OUTBOUND" && m.content?.text?.trim());
  if (!ultima) return undefined;
  return /\?\s*\S{0,3}\s*$/u.test(ultima.content.text!.trim());
}

const centavosDe = (valor: number | null | undefined) => (typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) : null);
const propostaPendente = (p: PropostaAutonomia | null | undefined, agora: Date) => !!p && agora.getTime() - Date.parse(p.criadaEm) < VALIDADE_DA_PROPOSTA_MS;
const ofertasPendentes = (o: OfertasAutonomia | null | undefined, agora: Date) => !!o && agora.getTime() - Date.parse(o.criadaEm) < VALIDADE_DA_PROPOSTA_MS;
/** A opção já escolhida espera o "sim": um novo desafio de identidade não a apaga (o aceite pede os dígitos de novo, D10). */
const aceitePendente = (o: OfertasAutonomia | null | undefined, agora: Date) => ofertasPendentes(o, agora) && o!.selecionada !== null;
/** Planejador ocupado (fork sem vaga): a rodada volta à fila se a mensagem é recente; depois disso, a equipe. */
const ADIAMENTO_MAXIMO_MS = 2 * 60_000;

async function processar(job: TrabalhoAutonomia, rodada: RodadaDaFila) {
  if (job.status !== "pendente") { await transferir(job, "Rodada interrompida; conferir histórico antes de qualquer reenvio"); return; }
  if (!await autonomiaStorage.assumir(job)) return;
  const providerId = job.provider_id, conversationId = job.conversation_id;
  // Fora do try: a exceção que cai no catch também não troca o follow-up que a rodada já gravou no caso.
  const efeitos = { followUpGravado: false };
  try {
    // Configuração e integração vêm da leitura feita sob a trava `config:` (achado e5).
    const { config, integracao: intg } = rodada;
    const [estado, vinculo] = await Promise.all([autonomiaStorage.estado(providerId, conversationId), storage.getConversaDoChat(providerId, conversationId)]);
    // A conversa saiu do assistente entre a chegada e a rodada: ninguem mais vai
    // responder esta mensagem, entao o caso fica pedindo resposta no chat.
    if (!config.ativa || estado.humano || !vinculo || ["OPEN", "PENDING", "CLOSED"].includes(vinculo.status)) { await pedirRespostaNoCaso(providerId, vinculo); await autonomiaStorage.marcar(job, "cancelado", "Autonomia pausada ou atendimento humano"); return; }
    const c = clienteDoChat();
    if (!c || !intg || intg.providerId !== providerId || vinculo.providerId !== providerId || vinculo.conversationId !== conversationId) throw new Error("Vínculo do chat indisponível ou divergente");
    // A identidade é lida junto com a conversa: é ela que diz se um 👍 é o "sim" de uma proposta ou só uma reação.
    const [listadas, seguranca] = await Promise.all([
      c.listarMensagens(intg.organizationId, conversationId, { page: 1, limit: 40 }),
      segurancaAutonomiaStorage.ler(providerId, conversationId),
    ]);
    const mensagens = valor(listadas).sort((a,b) => new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime());
    const inbound = mensagens.find(m => m.id === job.message_id && m.direction === "INBOUND");
    if (!inbound) { await transferir(job, "Mensagem do cliente indisponível na leitura; conferir histórico"); return; }
    const agora = new Date();
    const identidadeGravada = seguranca?.identidade ?? null;
    const identidadeDoCliente = (e: EstadoIdentidade | null) => !!e && e.providerId === providerId && e.conversationId === conversationId && e.customerId === vinculo.customerId;
    const identidadeVigenteNaLeitura = identidadeDoCliente(identidadeGravada) && identidadeVigente(identidadeGravada, agora);
    /**
     * f12 (§3.2, item 1): figurinha, reação, mensagem vazia e só emoji não pedem nada. O 👍/✅ é a exceção: com a
     * identidade vigente e uma proposta esperando confirmação, é o "sim" (§3.3). Um 😊 não confirma e não apaga a proposta.
     */
    const semPedido = (m: Mensagem) => {
      const tipo = tipoDaMensagem(m.type, m.content?.text);
      if (tipo === "figurinha_ou_reacao" || tipo === "vazia") return true;
      return tipo === "so_emoji" && !(confirmacaoTolerante((m.content?.text ?? "").trim()) && identidadeVigenteNaLeitura && propostaPendente(estado.proposta, agora));
    };
    // Não pede nada: nem resposta, nem transferência, nem rodada — em qualquer situação da conversa (no limite, com o
    // caso encerrado): nada sai por ela, então nenhuma trava de envio precisa ser conferida.
    if (semPedido(inbound)) { await autonomiaStorage.marcar(job, "concluido", "Mensagem sem pedido (figurinha, reação ou só emoji); nada a responder"); return; }
    // A mensagem mais nova cancela esta — mas só a que pede algo. Contada a figurinha, o "já paguei" seguido de uma
    // figurinha era cancelado e a figurinha, ignorada: ninguém lia o pedido (revisão B5, rodada 2).
    const ultima = mensagens.filter(m => m.direction === "INBOUND" && !semPedido(m)).at(-1);
    if (ultima?.id !== job.message_id) { await autonomiaStorage.marcar(job, "cancelado", "Outra mensagem do cliente já recebida"); return; }
    const tipoDaEntrada = tipoDaMensagem(inbound.type, inbound.content?.text);
    const texto = tipoDaEntrada === "texto" || tipoDaEntrada === "so_emoji" ? (inbound.content.text ?? "").trim() : "";
    // O que o modelo lê termina nesta mensagem: a figurinha que chegou depois não vira a "última fala" do cliente.
    const posicaoDaEntrada = mensagens.indexOf(inbound);
    const conversaDoModelo = mensagens.filter((m, i) => i <= posicaoDaEntrada || m.direction !== "INBOUND" || !semPedido(m));

    const recuperacao = !!vinculo.recuperacaoId;
    // Pré-aviso preventivo: conversa sem caso nem retirada. A resposta vai à equipe com o aviso (§12) — DEPOIS da
    // identidade: a abertura pede os 4 dígitos, e é o servidor que os confere antes de a equipe ler a conversa. Antes,
    // ia direto, e o cliente que não deve nada digitava parte do CPF sem ninguém conferir.
    const preAviso = !recuperacao && !vinculo.casoId;
    const caso = vinculo.casoId ? await storage.obterCasoDeCobranca(providerId, vinculo.casoId) : null;
    const tipo: TipoDeAgente = recuperacao ? "recuperacao_equipamentos" : caso?.carteira === "ex_cliente" ? "cobranca_ex_clientes" : "cobranca_ativos";
    const [{ agentes }, provedor, cadastro] = await Promise.all([
      listarAgentesDoChat(providerId), storage.getProvider(providerId), storage.clienteDoAtendimento(providerId, vinculo.customerId),
    ]);
    const agente = agentes.find(a => a.tipo === tipo);
    let politicaLida: Promise<Awaited<ReturnType<typeof storage.getPoliticaDeCobranca>>> | null = null;
    const r: RodadaEmCurso = {
      job, rodada, c, intg, vinculo, providerId, conversationId, customerId: vinculo.customerId, mensagens, agente,
      enviados: mensagens.filter(m => m.direction === "OUTBOUND").flatMap(m => baloesDe(m.content?.text)),
      voz: {
        nomeDaPersona: agente?.nomeDaPersona ?? null,
        nomeDoProvedor: provedor?.tradeName || provedor?.name || null,
        nomeDoCliente: cadastro?.nome ?? null,
        funcionariaJaFalou: mensagens.some(m => m.direction === "OUTBOUND"),
        canalOficial: { site: provedor?.website ?? null, telefone: provedor?.contactPhone ?? null },
      },
      carteira: recuperacao ? "equipamentos" : caso?.carteira === "ex_cliente" ? "ex_cliente" : "ativo",
      identidadeConfirmada: identidadeVigenteNaLeitura,
      texto: texto || null,
      politica: () => (politicaLida ??= storage.getPoliticaDeCobranca(providerId)),
      efeitos,
    };

    // Caso de outro cliente: não se sabe de quem é a conversa — nada sai por ela.
    if (!recuperacao && !preAviso && (!caso || caso.id !== vinculo.casoId || caso.cliente.id !== vinculo.customerId)) { await transferir(job, "Vínculo entre caso e cliente exige conferência humana"); return; }
    // Devolução também revela uma relação contratual; o desafio antecede as
    // três carteiras e nenhum dado financeiro entra na operação de equipamentos.
    const telefone = normalizarTelefoneParaChat(cadastro?.telefone);
    const conversaDoTelefone = telefone ? valor(await c.buscarConversaPorTelefone(intg.organizationId, telefone, vinculo.canalId)) : null;
    // O contato que o WhatsApp devolve pode vir sem o nono dígito (55 43 8821-9420) enquanto o
    // cadastro traz o 9: é o mesmo número, e a comparação precisa saber disso (16/09/2026).
    // Sem esse vínculo não se sabe quem está do outro lado: nada sai pela conversa — nem o aviso, nem a frase de
    // encerramento (também no pré-aviso). Por isso vem antes das transferências que avisam.
    if (!cadastro || !telefone || cadastro.id !== vinculo.customerId || conversaDoTelefone?.id !== conversationId || !mesmoTelefoneWhatsapp(conversaDoTelefone.contact.phone, telefone)) { await transferir(job, "Vínculo de identificação entre cliente, telefone e conversa exige conferência"); return; }

    // s6 (§3.2 e §3.4): as transferências que correm ANTES da triagem — caso encerrado ou em acordo, agente fora, limite
    // de rodadas — não convidam a continuar com a equipe quem disse que é engano ou pediu para parar. Essas mensagens
    // têm a frase própria e o silêncio, e o `nao_contatar` e o "conferir telefone" são gravados do mesmo jeito.
    const encerramentoCedo = encerramentoDaMensagem(texto || null, r.identidadeConfirmada, cadastro.nome);
    const transferirAntesDaTriagem = async (motivo: string) => {
      if (encerramentoCedo) { await encerrarComFrase(r, encerramentoCedo.situacao, encerramentoCedo, MOTIVO_DO_ENCERRAMENTO[encerramentoCedo.situacao]!, estado); return; }
      await transferirComAviso(r, motivo, "generica");
    };
    if (!recuperacao && caso && (casoFechado(caso.status) || ["negociando", "acordo_ativo"].includes(caso.status))) { await transferirAntesDaTriagem("Caso encerrado ou acordo em andamento exige acompanhamento humano"); return; }
    if (!config.tipos.includes(tipo) || !agente?.habilitado || agente.etapa !== "pronto" || !agente.id || !agente.modelo) { await transferirAntesDaTriagem("Agente da carteira não está habilitado e pronto"); return; }

    // f16: as rodadas contam por episódio, e o limite nunca corta uma proposta ou uma escolha esperando o "sim".
    if (estado.turnos >= config.maxTurnos && !propostaPendente(estado.proposta, agora) && !ofertasPendentes(seguranca?.ofertas, agora)) { await transferirAntesDaTriagem("Limite de rodadas atingido"); return; }

    const debitarTurno = () => autonomiaStorage.turno(providerId, conversationId, estado.episodioNovo === true);
    if (tipoDaEntrada === "audio") {
      const inicioDoEpisodio = agora.getTime() - 6 * 60 * 60_000;
      const audioAnterior = mensagens.some(m => m.id !== inbound.id && m.direction === "INBOUND" && tipoDaMensagem(m.type, m.content?.text) === "audio" && Date.parse(m.createdAt) >= inicioDoEpisodio);
      if (audioAnterior) { await transferirComAviso(r, "Cliente mandou áudio de novo; leitura humana necessária", "generica"); return; }
      const baloes = r.identidadeConfirmada
        ? semRepetir(s => reservaPosIdentidade({ tipo: "audio" }, { ...r.voz, carteira: r.carteira, hoje: dataLocal(agora) }, s), r)
        : semRepetir(s => textoPreIdentidade("audio", r.voz, s), r);
      if (baloes.aprovada === false) { await transferir(job, "Frase de identificação indisponível; atendimento humano necessário"); return; }
      await enviarTurno(r, { reserva: baloes }, "Cliente mandou áudio: pedido para escrever", { houveEfeito: false, debitarTurno });
      return;
    }
    if (tipoDaEntrada === "imagem_ou_documento") { await transferirComAviso(r, "Imagem ou documento recebido (possível comprovante); conferência humana", "pagamento_informado"); return; }
    if (tipoDaEntrada === "outra_midia" || !texto) { await transferirComAviso(r, "Mensagem com mídia ou texto indisponível exige leitura humana", "generica"); return; }

    // ── identidade (§3.2): a triagem e o desafio são do SERVIDOR; o modelo não vê nada antes dos dígitos ──
    // As tentativas contam por CLIENTE, somadas em todas as conversas do provedor (D10, s7).
    const tentativasDoCliente = await segurancaAutonomiaStorage.tentativasDoCliente(providerId, vinculo.customerId);
    // A mesma mensagem já passou por aqui numa rodada que voltou à fila (503 "ocupado", parada do worker): a identidade
    // e o turno daquela vez valem — nem o "recém-confirmada" se perde (f20), nem a rodada conta duas vezes.
    const reprocessada = identidadeDoCliente(identidadeGravada) && identidadeGravada!.ultimaMensagemId === job.message_id;
    const identificacao = avaliarIdentidade(identidadeGravada, { providerId, conversationId, customerId: vinculo.customerId, telefone }, cadastro, texto, job.message_id, { tentativasDoCliente, dados: r.voz });
    const confirmada = identificacao.acao === "confirmada";
    const recemConfirmada = identificacao.recemConfirmada
      || (confirmada && reprocessada && (identidadeGravada as EstadoIdentidadeDaRodada).confirmadaNaMensagem === job.message_id);
    // s10: o que o cliente escreveu desde a última leitura com identidade — lido ANTES de a marca avançar.
    const lidasAte = lidasComIdentidadeAte(identidadeGravada, mensagens);
    const pendentes = pedidosSemTriagem(mensagens, inbound, lidasAte);
    const estadoDaIdentidade: EstadoIdentidadeDaRodada | null = identificacao.estado && {
      ...identificacao.estado,
      lidasComIdentidadeAte: confirmada ? inbound.createdAt : lidasAte,
      confirmadaNaMensagem: recemConfirmada ? job.message_id : confirmada ? (identificacao.estado as EstadoIdentidadeDaRodada).confirmadaNaMensagem ?? null : null,
    };
    await segurancaAutonomiaStorage.identidade(providerId, conversationId, estadoDaIdentidade);
    if (identificacao.acao === "ignorar") { await autonomiaStorage.marcar(job, "concluido", "Mensagem sem pedido (só emoji); nada a responder"); return; }
    if (identificacao.acao === "humano") {
      const decisao = identificacao.decisao;
      if (identificacao.motivo === "tentativas_esgotadas") { await encerrarComFrase(r, "tentativas_esgotadas", {}, MOTIVO_DO_ENCERRAMENTO.tentativas_esgotadas!, estado); return; }
      if (decisao?.acao === "encerrar") {
        await encerrarComFrase(r, decisao.situacao, { gravarNaoContatar: decisao.gravarNaoContatar === true, conferirTelefone: decisao.conferirTelefone === true }, MOTIVO_DO_ENCERRAMENTO[decisao.situacao] ?? "Identificação não confirmada; atendimento humano necessário", estado);
        return;
      }
      // Pedido de pessoa, jurídico, vulnerabilidade, contestação ou cadastro incompleto: o aviso antes da identidade é neutro.
      await transferirComAviso(r, "Identificação não confirmada; atendimento humano necessário", decisao?.acao === "transferir" ? decisao.aviso : "generica");
      return;
    }
    if (identificacao.acao === "desafiar") {
      const situacao = identificacao.situacao;
      const baloes = situacao ? semRepetir(s => textoPreIdentidade(situacao, r.voz, s), r) : null;
      // A frase do servidor pode reprovar no verificador (um pedaço do nome do cadastro): nunca enviar; vai à equipe sem aviso.
      if (!baloes || baloes.aprovada === false || !baloes.length) { await transferir(job, "Frase de identificação indisponível; atendimento humano necessário"); return; }
      await autonomiaStorage.proposta(providerId, conversationId, null);
      if (!aceitePendente(seguranca?.ofertas, agora)) await segurancaAutonomiaStorage.ofertas(providerId, conversationId, null);
      await enviarTurno(r, { reserva: baloes }, "Confirmação de identidade solicitada no chat; sem divulgação financeira", { houveEfeito: identificacao.tentativaGasta, debitarTurno });
      return;
    }
    r.identidadeConfirmada = true;
    if (identificacao.recemConfirmada) await storage.registrarEventoDoChat(providerId, vinculo, null, "Identidade confirmada por desafio no chat; vale pelo episódio (6 h sem mensagem, até 24 h)");

    // ── depois da identidade (§3.3) ──
    // A triagem lê a mensagem atual e, depois dela, os pedidos que chegaram sem identidade (s10) — do mais novo ao
    // mais velho. Encerrar (número errado, parar) vem antes de transferir: quem pediu para parar não recebe aviso.
    const hoje = dataLocal(agora);
    if (texto.length > 1200) { await transferirComAviso(r, "Mensagem longa exige leitura humana", "generica"); return; }
    const textosDaTriagem = [texto, ...[...pendentes].reverse()];
    const encerramento = textosDaTriagem.map(t => classificarEncerramento(t)).find(Boolean) ?? null;
    if (encerramento) {
      await encerrarComFrase(r, encerramento, { gravarNaoContatar: encerramento === "pediu_para_parar", conferirTelefone: encerramento === "numero_errado" }, MOTIVO_DO_ENCERRAMENTO[encerramento]!, estado);
      return;
    }
    const opcoesDaTriagem = { hoje, permitirNegociacao: config.permitirNegociacao === true && !recuperacao && !preAviso, nomeDoCliente: cadastro.nome };
    const categoria = textosDaTriagem.map(t => classificarTransferencia(t, opcoesDaTriagem)).find(Boolean) ?? null;
    if (categoria) { await transferirComAviso(r, "Cliente pediu atendimento ou informou uma exceção que exige conferência", categoria); return; }
    if (preAviso) { await transferirComAviso(r, "Resposta ao pré-aviso: identidade confirmada; atendimento da equipe", "generica"); return; }

    const inicioDoErp = Date.now();
    const contexto = await contextoDoAtendimento(providerId, conversationId, true);
    logger.info({ providerId, jobId: job.id, etapa: "erp", ms: Date.now() - inicioDoErp, financeiroAoVivo: contexto.erp?.financeiroAoVivo === true }, "Autonomia: leitura ao vivo do cliente");
    // A ficha agora devolve null quando ninguém leu o valor/atraso; null não é zero.
    const saldoLido = contexto.cliente.divida, atrasoLido = contexto.cliente.diasAtraso;
    const recuperacaoCaso = recuperacao ? await storage.getRecoveryCaseById(vinculo.recuperacaoId!, providerId) : null;
    // Retirada contestada é contestação aberta: não avisa (§3.4).
    if (recuperacao && recuperacaoCaso?.disputedAt) { await transferir(job, "Caso de devolução contestado; conferir com a equipe"); return; }
    if (recuperacao && (!recuperacaoCaso || recuperacaoCaso.providerId !== providerId || recuperacaoCaso.customerId !== vinculo.customerId || recuperacaoCaso.closedAt)) { await transferirComAviso(r, "Caso de devolução encerrado, contestado ou sem vínculo com este cliente", "generica"); return; }
    if (!recuperacao && (contexto.erp.status !== "disponivel" || !caso || saldoLido == null || saldoLido <= 0 || atrasoLido == null || atrasoLido > 1825)) { await transferirComAviso(r, "Saldo não confirmado no ERP ou caso requer conferência", "generica"); return; }
    // O ERP responder NÃO é o mesmo que ter lido o financeiro: quando o cliente
    // pagou tudo, o ERP devolve zero fatura e a ficha cai para a varredura das
    // 03:00 — com `status: "disponivel"` do mesmo jeito. Falar aquele saldo é
    // cobrar por WhatsApp quem já pagou. Sem leitura ao vivo, vai ao atendente.
    if (!recuperacao && !contexto.erp.financeiroAoVivo) { await transferirComAviso(r, `Saldo não confirmado no ERP nesta leitura: o valor disponível é o da ${contexto.erp.valoresDe === "base_sincronizada" ? "base sincronizada" : "leitura anterior"}, e o assistente não fala valor que não leu`, "generica"); return; }
    const carteira = contexto.cliente.carteira ?? null;
    if (!recuperacao && (!contexto.erp.carteiraAoVivo || !carteira || carteira !== caso?.carteira || contexto.cliente.id !== vinculo.customerId)) {
      await transferirComAviso(r, "Carteira do caso e situação contratual atual do ERP exigem conferência humana", "generica"); return;
    }
    if (!recuperacao && (contexto.temMaisFaturas || await faturasDaAutonomia.faturasQuitadasAindaAbertas(providerId, vinculo.customerId, contexto.faturas.map(f => f.ref), contexto.erp.fonte ?? undefined))) {
      await transferirComAviso(r, "Financeiro exige conciliação: quitação comprovada ainda aparece no ERP ou há títulos além da leitura detalhada", "generica"); return;
    }
    // Só se fala em valor o que foi lido AGORA. Na recuperação o saldo não é
    // afirmado a ninguém: a reserva e a proposta de agendamento o ignoram.
    const saldo: number | null = recuperacao || !contexto.erp.financeiroAoVivo ? null : saldoLido;
    const politica = !recuperacao ? await r.politica() : null;
    // Política pausada é a autonomia em pausa: não avisa (§3.4).
    if (politica?.pausada) { await transferir(job, "Política de cobrança pausada; conferir com a equipe"); return; }
    const orientacao = orientarContato({ diasAtraso: atrasoLido ?? 0, tom: caso?.tom, quadrante: caso?.quadranteDna, carteira: carteira ?? undefined, status: caso?.status, etapas: resolverEtapas(politica), modoAtendimento: "autonomo" });
    if (!recuperacao && !orientacao.automatizavel) { await transferirComAviso(r, "A etapa da régua ou a condição do cliente exige revisão humana", "generica"); return; }
    const abordagem = { carteira, tom: recuperacao ? null : orientacao.tom, quadrante: recuperacao ? null : orientacao.quadrante, vulneravel: orientacao.tom === "humanizado_vulneravel", etapa: recuperacao ? null : orientacao.etapa?.id ?? null, objetivo: recuperacao ? "orientar devolução do equipamento identificado no caso" : orientacao.etapa?.acao ?? "atender solicitação do cliente", diretiva: recuperacao ? "Tratar apenas a devolução do equipamento; não tratar pendências financeiras." : orientacao.diretiva };

    // Os fatos que um balão pode citar: o saldo e cada fatura lida agora (valor e vencimento com o MESMO id), ou a
    // retirada já agendada. É contra eles que o verificador confere número e data (§6.13).
    const faturasLidas = recuperacao ? [] : contexto.faturas.slice(0, 20);
    const agendada = recuperacaoCaso?.scheduledAt ? new Date(recuperacaoCaso.scheduledAt) : null;
    const horaDeBrasilia = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    const fatos: FatosDaRodada = recuperacao
      ? (agendada && Number.isFinite(agendada.getTime()) ? { datas: [{ id: "agendamento", data: dataLocal(agendada) }], horas: [horaDeBrasilia(agendada)] } : {})
      : {
          valores: [
            ...(centavosDe(saldo) ? [{ id: "saldo", centavos: centavosDe(saldo)! }] : []),
            ...faturasLidas.flatMap(f => (centavosDe(f.valor) ? [{ id: `fatura:${f.ref}`, centavos: centavosDe(f.valor)! }] : [])),
          ],
          datas: faturasLidas.flatMap(f => (/^\d{4}-\d{2}-\d{2}$/.test(f.vencimento ?? "") ? [{ id: `fatura:${f.ref}`, data: f.vencimento }] : [])),
        };
    const nomesDaVerificacao = { persona: agente.nomeDaPersona ?? "", provedor: r.voz.nomeDoProvedor ?? "", primeiroNomeCliente: primeiroNomeDoCliente(cadastro.nome) };
    const situacaoDaConversa: SituacaoDaRodada = recemConfirmada ? "identidade_recem_confirmada" : "conversa";
    const contextoDaVerificacao = (extra: Partial<ContextoDaVerificacao> & Pick<ContextoDaVerificacao, "acao">): ContextoDaVerificacao => ({
      fase: "pos_identidade", situacao: situacaoDaConversa, carteira: r.carteira, fatos, nomes: nomesDaVerificacao, hoje,
      ultimaMensagemDoCliente: texto, baloesJaEnviados: r.enviados, ...extra,
    });
    /** Os balões da funcionária, se passarem no verificador; recusados, `null` — e a reserva escreve (D6). Log só do código. */
    const verificados = (mensagens: readonly string[] | undefined, ctx: ContextoDaVerificacao): string[] | null => {
      if (!mensagens?.length) return null;
      const v = verificarMensagens(mensagens, ctx);
      if (v.ok) return v.mensagens;
      logger.info({ providerId, jobId: job.id, etapa: "verificador", codigo: v.motivo }, "Autonomia: balões da funcionária recusados; sai a reserva");
      return null;
    };
    const contextoDaResposta = (s: SementeDoTexto): ContextoDaResposta => ({
      carteira: carteira ?? undefined, permitirPromessa: config.permitirPromessa, permitirSegundaVia: config.permitirSegundaVia,
      permitirAgendamento: config.permitirAgendamento && !recuperacaoCaso?.scheduledAt,
      nomeDaPersona: r.voz.nomeDaPersona, nomeDoProvedor: r.voz.nomeDoProvedor, nomeDoCliente: cadastro.nome, funcionariaJaFalou: r.voz.funcionariaJaFalou,
      hoje, identidadeRecemConfirmada: recemConfirmada, ultimaMensagemDoCliente: texto, semente: s,
    });
    const reserva = (pedido: PedidoDeReserva) => semRepetir(s => reservaPosIdentidade(pedido, { ...r.voz, carteira: r.carteira, hoje, saldoCentavos: centavosDe(saldo), permitirPromessa: config.permitirPromessa, permitirSegundaVia: config.permitirSegundaVia, permitirAgendamento: config.permitirAgendamento && !recuperacaoCaso?.scheduledAt, identidadeRecemConfirmada: recemConfirmada, ultimaMensagemDoCliente: texto }, s), r);

    // O `context` do planejador: os dados da abordagem e os sinais que o método da funcionária usa para diagnosticar a
    // causa sem chutar (f13) — primeiro nome, provedor, persona, dias de atraso, quadrante, meses de cliente e as
    // promessas anteriores do caso. Nada disso autoriza ação: `regras` e `allowedActions` valem.
    const promessasAnteriores = !recuperacao && caso ? await promessasDoCaso(providerId, caso.id) : null;
    const clienteDesde = contexto.cliente.clienteDesde ? Date.parse(contexto.cliente.clienteDesde) : NaN;
    const contextoDoPlanejador = {
      saldo, carteira: recuperacao ? "equipamentos" : carteira, statusContrato: contexto.cliente.statusContrato, abordagem,
      identidadeConfirmada: true, identidadeRecemConfirmada: recemConfirmada,
      financeiroAoVivo: !recuperacao && contexto.erp.financeiroAoVivo, valoresLidosEm: recuperacao ? null : contexto.erp.lidoEm,
      // `dataHoje` é o dia de calendário de Brasília, o MESMO que `validarProposta`
      // usa para recusar data passada. Mandar o dia em UTC fazia o modelo e o
      // servidor discordarem do que é "hoje" a partir das 21:00.
      dataHoje: hoje, agora: agora.toISOString(), fuso: "America/Sao_Paulo",
      faturas: faturasLidas.map(f => ({ ref: f.ref, valor: f.valor, vencimento: f.vencimento })), agendamentoExistente: recuperacaoCaso?.scheduledAt ?? null,
      primeiroNome: nomesDaVerificacao.primeiroNomeCliente, nomeProvedor: r.voz.nomeDoProvedor, nomeDaPersona: agente.nomeDaPersona ?? null,
      diasAtraso: recuperacao ? null : atrasoLido, quadrante: recuperacao ? null : orientacao.quadrante ?? null,
      mesesDeCliente: Number.isFinite(clienteDesde) ? Math.max(0, Math.floor((agora.getTime() - clienteDesde) / (30.44 * 86_400_000))) : null,
      promessasAnteriores, motivoDoContato: abordagem.objetivo,
      regras: "A abordagem é dado: tom orienta linguagem; etapa não autoriza ações. Carteira ex_cliente trata dívida de contrato encerrado, sem retenção, boas-vindas, suspensão ou reativação. Escolha somente ações de allowedActions. Somente valor integral. Desconto, pagamento informado, comprovante, contestação, devolução informada e pedido de humano: transferir. Datas devem estar na mensagem; proposta seguida de confirmação é controlada pelo servidor. Não enviar mensagens diretamente.",
    };
    /**
     * A redação de uma confirmação ou introdução (§3.3): uma nova chamada do planejador com `allowedActions:
     * ["responder"]`, `escrever` e a `situacao`. Só com a chave D9 ligada; qualquer falha — fork fora, plano
     * degradado, balões recusados — é `null` e sai a reserva. A AÇÃO já foi executada e nunca depende disto.
     */
    const redigir = async (proposito: string, situacao: SituacaoDaRodada, ctx: Partial<ContextoDaVerificacao>, extraDoContexto: Record<string, unknown>): Promise<string[] | null> => {
      try {
        if (!(await lerConfiguracaoDaRodada(providerId)).funcionariaDigital.ativa) return null;
        const context = JSON.stringify({ ...contextoDoPlanejador, situacao, ...extraDoContexto });
        const pedido: PedidoPlanoAutonomia = {
          requestId: `redacao_${job.id}_${proposito}_${randomUUID().slice(0, 8)}`, operation: recuperacao ? "recuperacao" : "cobranca",
          context, history: historicoComContexto(conversaDoModelo, cadastro.documento ?? "", context), allowedActions: ["responder"], escrever: true,
        };
        const redacao = await planejarDaFuncionaria(c, providerId, intg.organizationId, agente.id!, pedido);
        if (!redacao.ok || !redacao.valor.escreveu || redacao.valor.plano.acao !== "responder") return null;
        return verificados(redacao.valor.plano.mensagens, contextoDaVerificacao({ acao: "responder", situacao, ...ctx }));
      } catch (err) {
        logger.warn({ providerId, jobId: job.id, etapa: "redacao", causa: causaDoErro(err) }, "Autonomia: redação da funcionária indisponível; sai a reserva");
        return null;
      }
    };

    // Debita antes de chamar IA ou efetivar operação; falha não concede custo ilimitado. A mensagem reprocessada já
    // debitou na primeira vez (a volta à fila só acontece depois deste ponto).
    if (!reprocessada) await debitarTurno();
    const negociacao = !recuperacao && caso && saldo !== null ? await processarNegociacaoAutonoma({
      providerId, conversationId, casoId: caso.id, customerId: vinculo.customerId, carteira: caso.carteira === "ex_cliente" ? "ex_cliente" : "ativo",
      saldo, diasAtraso: atrasoLido!, mensalidade: contexto.cliente.mensalidade ?? null, vulneravel: abordagem.vulneravel,
      permitir: config.permitirNegociacao === true, permitirSegundaVia: config.permitirSegundaVia, ofertas: seguranca?.ofertas ?? null, texto, messageId: job.message_id,
      identidadeRecemConfirmada: recemConfirmada,
    }) : null;
    if (negociacao?.acao === "humano") { await transferirComAviso(r, negociacao.motivo, "generica"); return; }
    if (negociacao?.acao === "pedir_identidade") {
      // D10: aceite de acordo com identidade de mais de 2 h — os dígitos de novo, e a opção escolhida continua.
      const atual = (await segurancaAutonomiaStorage.ler(providerId, conversationId))?.identidade ?? null;
      if (atual) await segurancaAutonomiaStorage.identidade(providerId, conversationId, pedirIdentidadeDeNovo(atual, new Date()));
      const baloes = semRepetir(s => textoPreIdentidade("re_pedido", { ...r.voz, funcionariaJaFalou: true }, s), r);
      if (baloes.aprovada === false || !baloes.length) { await transferir(job, "Frase de identificação indisponível; atendimento humano necessário"); return; }
      await enviarTurno(r, { reserva: baloes }, "Aceite de acordo: identidade pedida de novo (confirmação com mais de 2 horas)", { houveEfeito: true });
      return;
    }
    if (negociacao?.acao === "responder") {
      if (estado.proposta) await autonomiaStorage.proposta(providerId, conversationId, null);
      if (negociacao.etapa === "ofertas") {
        const ofertas = negociacao.ofertas.ofertas.map(ofertaVerificavel);
        const introducao = await redigir("ofertas", "apresentar_ofertas", { ofertas }, { quantidadeDeOpcoes: ofertas.length });
        await enviarTurno(r, { reserva: [...reserva({ tipo: "introducao_ofertas" }), negociacao.linhas], comIA: introducao ? [...introducao, negociacao.linhas] : null }, "Assistente autônomo apresentou as opções calculadas pela política", { houveEfeito: true });
        return;
      }
      if (negociacao.etapa === "acordo_registrado") {
        // A negociação já gravou o acordo e o follow-up "Preparar cobrança do acordo aceito no chat".
        efeitos.followUpGravado = true;
        const gravado: GravadoVerificavel = { tipo: "acordo", data: negociacao.gravado.data, ...(negociacao.gravado.valorCentavos ? { valorCentavos: negociacao.gravado.valorCentavos } : {}) };
        const confirmacao = await redigir("confirmacao", "acordo_registrado", { gravado }, { gravado: { tipo: "acordo", data: gravado.data, valor: gravado.valorCentavos ? gravado.valorCentavos / 100 : null } });
        await confirmarAcordoDepoisDeTransferir(r, { reserva: reserva({ tipo: "registrado", gravado: negociacao.gravado }), comIA: confirmacao });
        return;
      }
      // "aceite" gravou a escolha: refeita pela volta à fila, a mesma mensagem não escolheria de novo e iria à equipe.
      await enviarTurno(r, { reserva: negociacao.baloes }, "Assistente autônomo respondeu dentro das permissões do provedor", { houveEfeito: negociacao.etapa === "aceite" });
      return;
    }

    if (propostaConfirmada(estado.proposta, texto, job.message_id, agora, { ultimoBalaoEraAPergunta: ultimaSaidaEhPergunta(mensagens) })) {
      const p = estado.proposta;
      let gravado: GravadoVerificavel;
      if (p.acao === "promessa") {
        // `saldo == null` é a trava do valor não lido; a data é comparada com HOJE
        // em America/Sao_Paulo — às 21:00 de Brasília o UTC já virou o dia, e a
        // promessa feita para hoje seria recusada como passada.
        if (recuperacao || !config.permitirPromessa || saldo == null || p.valor !== saldo || p.data < hoje) { await transferirComAviso(r, "A promessa precisa de nova conferência de saldo/data", "generica"); return; }
        const telefoneDoContexto = contexto.cliente.telefone;
        const atual = await casoParaAgente(providerId, telefoneDoContexto);
        if (!telefoneDoContexto || atual.caso?.id !== vinculo.casoId || atual.promessaAberta || atual.caso.prescrita) { await transferirComAviso(r, "Caso ou promessa existente exige conferência humana", "generica"); return; }
        const gravada = await registrarPromessaDoAgente(providerId, { telefone: telefoneDoContexto, dataPrometida: p.data, valor: saldo, observacao: "Confirmada pelo cliente após oferta explícita do assistente", conversaId: conversationId });
        if (!gravada.ok) throw new Error("Promessa não confirmada");
        efeitos.followUpGravado = true;
        gravado = { tipo: "promessa", data: p.data, ...(centavosDe(saldo) ? { valorCentavos: centavosDe(saldo)! } : {}) };
      } else {
        if (!recuperacao || !config.permitirAgendamento || new Date(p.data).getTime() <= Date.now() || !await autonomiaStorage.agendar(providerId, vinculo.recuperacaoId!, vinculo.customerId, p.data, job.message_id)) { await transferirComAviso(r, "Agendamento existente ou indisponível; a equipe precisa conferir", "generica"); return; }
        efeitos.followUpGravado = true;
        gravado = { tipo: "agendamento", data: p.data.slice(0, 10), hora: p.data.slice(11, 16) };
      }
      await autonomiaStorage.proposta(providerId, conversationId, null);
      const situacao: SituacaoDaRodada = gravado.tipo === "promessa" ? "promessa_registrada" : "agendamento_registrado";
      const confirmacao = await redigir("confirmacao", situacao, { gravado }, { gravado: { tipo: gravado.tipo, data: gravado.data, valor: gravado.valorCentavos ? gravado.valorCentavos / 100 : null, hora: gravado.hora ?? null } });
      await enviarTurno(r, { reserva: reserva({ tipo: "registrado", gravado }), comIA: confirmacao }, gravado.tipo === "promessa" ? "Assistente autônomo registrou a promessa confirmada pelo cliente" : "Assistente autônomo registrou o agendamento local confirmado pelo cliente", { houveEfeito: true });
      return;
    }

    // Uma nova intenção invalida a oferta antiga, impedindo um “sim” tardio.
    if (estado.proposta) await autonomiaStorage.proposta(providerId, conversationId, null);
    const allowedActions: PlanoResposta["acao"][] = ["responder", "transferir"];
    if (!recuperacao && config.permitirSegundaVia) allowedActions.push("segunda_via");
    if (!recuperacao && config.permitirPromessa) allowedActions.push("promessa");
    if (recuperacao && config.permitirAgendamento && !recuperacaoCaso?.scheduledAt) allowedActions.push("agendar");
    // Reconferência antes do planejador (§9): a autonomia pausada ou o humano que assumiu durante a leitura do ERP
    // encerram a rodada aqui; a chave D9 lida AGORA decide se a funcionária escreve.
    const antesDoPlanejador = await lerConfiguracaoDaRodada(providerId);
    if (!antesDoPlanejador.config.ativa || (await autonomiaStorage.estado(providerId, conversationId)).humano) {
      await pedirRespostaNoCaso(providerId, vinculo);
      await autonomiaStorage.marcar(job, "cancelado", "Autonomia pausada ou atendimento humano antes do planejador");
      return;
    }
    if (await devolverSeParando(job, rodada)) return;
    const escrever = antesDoPlanejador.funcionariaDigital.ativa;
    // O histórico cabe junto com o `context` no teto do fork (e11): o 400 "acima do limite" mandava a conversa à equipe.
    const context = JSON.stringify({ ...contextoDoPlanejador, situacao: situacaoDaConversa });
    const pedido: PedidoPlanoAutonomia = {
      requestId: `autonomia_${job.id}_${randomUUID()}`, operation: recuperacao ? "recuperacao" : "cobranca",
      context, history: historicoComContexto(conversaDoModelo, cadastro.documento ?? "", context), allowedActions,
      ...(escrever ? { escrever: true } : {}),
    };
    const planejado = await planejarComDegradacao(c, providerId, intg.organizationId, agente.id, pedido);
    if (!planejado.ok) {
      // 503 "Planejador ocupado": nada irreversível aconteceu — a rodada volta à fila enquanto a mensagem é recente.
      const criado = job.criado_em ? new Date(job.criado_em).getTime() : NaN;
      if (planejado.status === 503 && /ocupad/i.test(planejado.erro) && Number.isFinite(criado) && Date.now() - criado < ADIAMENTO_MAXIMO_MS && await autonomiaStorage.devolverParaPendente(job)) {
        logger.info({ providerId, jobId: job.id, etapa: "planejador" }, "Autonomia: planejador ocupado; a rodada volta à fila");
        return;
      }
      // Fork ou modelo fora: a equipe recebe a conversa, sem aviso pelo canal que acabou de falhar (§3.4).
      await transferir(job, "Planejador indisponível; conferir histórico antes de responder");
      return;
    }
    const { plano, escreveu } = planejado.valor;
    if (!allowedActions.includes(plano.acao)) { await transferirComAviso(r, "Plano fora das permissões do provedor", "generica"); return; }
    if (plano.acao === "transferir") { await transferirComAviso(r, "A solicitação exige atendimento humano", "generica"); return; }
    const daFuncionaria = (ctx: ContextoDaVerificacao) => (escreveu ? verificados(plano.mensagens, ctx) : null);
    if (plano.acao === "segunda_via") {
      if (!plano.faturaId) { await transferirComAviso(r, "Fatura não identificada", "generica"); return; }
      // s9: o instrumento é buscado e validado ANTES de qualquer balão. Sem PIX, boleto ou linha, nenhum balão da IA sai.
      let instrumento: string;
      try { instrumento = mensagemDePagamento(await segundaViaDoAtendimento(providerId, conversationId, plano.faturaId)); }
      catch (err) {
        logger.info({ providerId, jobId: job.id, etapa: "segunda_via", causa: causaDoErro(err) }, "Autonomia: segunda via indisponível; a equipe confere");
        await transferirComAviso(r, "Segunda via indisponível no ERP para esta fatura", "generica"); return;
      }
      const introducao = daFuncionaria(contextoDaVerificacao({ acao: "segunda_via" }));
      await enviarTurno(r, { reserva: [...reserva({ tipo: "introducao_segunda_via" }), instrumento], comIA: introducao ? [...introducao, instrumento] : null }, "Assistente autônomo enviou a segunda via lida no ERP", { houveEfeito: false });
      return;
    }
    if (plano.acao === "promessa" || plano.acao === "agendar") {
      // A data pode ter vindo antes dos 4 dígitos ("pago dia 20" → "8909"): as mensagens pendentes do episódio contam.
      const proposta = validarProposta(plano, textosDaTriagem.join("\n"), saldo, job.message_id);
      if (!proposta) { await transferirComAviso(r, "Data, valor ou horário não confirmados dentro dos limites", "generica"); return; }
      await autonomiaStorage.proposta(providerId, conversationId, proposta);
      const verificavel = proposta.acao === "promessa"
        ? { data: proposta.data, ...(centavosDe(proposta.valor) ? { valorCentavos: centavosDe(proposta.valor)! } : {}) }
        : { data: proposta.data.slice(0, 10), hora: proposta.data.slice(11, 16) };
      const pergunta = daFuncionaria(contextoDaVerificacao({ acao: proposta.acao, proposta: verificavel }));
      await enviarTurno(r, { reserva: semRepetir(s => reservaDaProposta(proposta, contextoDaResposta(s)), r), comIA: pergunta }, "Assistente autônomo pediu a confirmação da proposta do cliente", { houveEfeito: false });
      return;
    }
    // responder. D1: perguntada se é robô, a reserva confirma a automação — nunca uma resposta que a ignore.
    const resposta = detectarPerguntaDeRobo(texto) ? reserva({ tipo: "pergunta_robo" }) : semRepetir(s => reservaDaResposta(plano, saldo, recuperacao, contextoDaResposta(s)), r);
    await enviarTurno(r, { reserva: resposta, comIA: daFuncionaria(contextoDaVerificacao({ acao: "responder" })) }, "Assistente autônomo respondeu dentro das permissões do provedor", { houveEfeito: false });
  } catch (e) {
    logger.warn({ providerId: job.provider_id, jobId: job.id, causa: causaDoErro(e) }, "Autonomia: rodada não confirmada; encaminhando ao humano");
    try {
      await transferir(job, "Falha na rodada ou envio não confirmado; conferir histórico, sem reenvio automático", !efeitos.followUpGravado);
    } catch (falha) {
      throw efeitos.followUpGravado ? new FalhaDepoisDoFollowUp(falha) : falha;
    }
  }
}

/** As promessas anteriores do caso, para o diagnóstico da causa (f13). Sem leitura, `null` — nunca "nenhuma". */
async function promessasDoCaso(providerId: number, casoId: number): Promise<{ total: number; ultimaData: string | null } | null> {
  try {
    const eventos = await storage.listarEventosDoCaso(providerId, casoId);
    const promessas = eventos.filter(e => e.tipo === "promessa");
    const datas = promessas.map(e => (e.metadata as Record<string, unknown> | null)?.dataPrometida).filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    return { total: promessas.length, ultimaData: datas.at(-1) ?? null };
  } catch (err) {
    logger.warn({ providerId, casoId, causa: causaDoErro(err) }, "Autonomia: promessas anteriores do caso não lidas");
    return null;
  }
}

/**
 * O planejador com a degradação do achado e2: com `escrever`, o 400 já é repetido sem ele dentro de
 * `planejarDaFuncionaria`; timeout e 503 também são repetidos UMA vez sem escrever — o plano sai do modo antigo e
 * quem escreve é a reserva. Sem `escrever`, nada é repetido aqui.
 */
async function planejarComDegradacao(c: ChatBullqClient, providerId: number, organizationId: string, agenteId: string, pedido: PedidoPlanoAutonomia): Promise<Resultado<PlanoDaFuncionaria>> {
  const primeiro = await planejarDaFuncionaria(c, providerId, organizationId, agenteId, pedido);
  if (primeiro.ok || pedido.escrever !== true) return primeiro;
  const repetivel = primeiro.status === 503 || (primeiro.status === undefined && /não respondeu em/i.test(primeiro.erro));
  if (!repetivel) return primeiro;
  const { escrever: _semEscrita, ...modoAntigo } = pedido;
  const segundo = await planejarDaFuncionaria(c, providerId, organizationId, agenteId, { ...modoAntigo, requestId: requestIdSemEscrita(pedido.requestId) });
  return segundo.ok ? { ok: true, valor: { ...segundo.valor, escreveu: false, degradado: true } } : segundo;
}

/** Quantas rodadas correm juntas, sempre em conversas distintas (D11). */
export const PARALELISMO_DA_AUTONOMIA = 3;
/**
 * Quantas rodadas do MESMO provedor correm juntas. O fork sem o vps/009 — o de
 * produção antes da implantação, e o da volta do §11.6 — recusa um segundo plano
 * simultâneo da mesma organização com 503 "Planejador ocupado", e a rodada
 * recusada iria ao atendente: três rodadas da NsLink ao mesmo tempo mandariam
 * duas conversas à equipe sem motivo.
 *
 * Quem declara o 009 é a chave D9: ela só é ligada DEPOIS do 009 no fork, e
 * desligá-la é o primeiro passo da volta. Desligada, vale uma rodada por
 * provedor — o comportamento de hoje —, e provedores diferentes seguem em
 * paralelo. Enquanto a leva não leu a chave do provedor, vale a desligada.
 */
export const RODADAS_SIMULTANEAS_POR_PROVEDOR = { chaveDesligada: 1, chaveLigada: PARALELISMO_DA_AUTONOMIA } as const;
/** Quanto o desligamento do worker espera as rodadas (achado e14): o pm2 mata em 35 s, e o dreno do sync corre junto, não depois. */
export const ESPERA_MAXIMA_NA_PARADA_MS = 15_000;
/**
 * Depois de uma varredura que não trouxe nada que pudesse começar, a leva não
 * volta ao banco antes disto. Com rodadas em curso, quem está sem serviço
 * espera este intervalo e varre de novo — não sai (achado e4).
 */
export const INTERVALO_ENTRE_VARREDURAS_MS = 3_000;
/**
 * Uma leva não pega trabalho novo depois disto: com mensagens chegando sem parar
 * ela nunca terminaria, e quem a chama no próprio laço (o chat-worker confere o
 * SIGTERM entre uma leva e outra) ficaria sem vez. As rodadas em curso terminam;
 * a próxima volta começa em 3 s.
 */
export const DURACAO_MAXIMA_DA_LEVA_MS = 60_000;

/**
 * O que a rodada recebe da fila. `config`, `integracao` e `funcionariaDigital`
 * são lidos sob a trava `config:` — e SÓ a leitura fica sob ela (achado e5):
 * antes a trava durava a rodada inteira (ERP, modelo, envio), e salvar a
 * autonomia, provisionar um agente ou o "Enviar para cobrança" davam conflito
 * enquanto houvesse fila. Quem vier depois reconfere `ativa`, a chave D9 e
 * `estado.humano` antes do planejador e antes do envio.
 */
export interface RodadaDaFila {
  config: ConfigAutonomia;
  integracao: ChatBullqIntegracao | undefined;
  /** D9, lida da integração do provedor; desligada quando não há integração. */
  funcionariaDigital: FuncionariaDigital;
  /** O sinal de parada do worker. A rodada o confere antes de enviar (`devolverSeParando`). */
  deveParar: () => boolean;
}

/**
 * A leitura que a fila faz sob a trava `config:`. Exportada porque é também a
 * RECONFERÊNCIA: antes do planejador e antes do envio a rodada lê de novo
 * `ativa` e a chave D9 — sem trava, uma leitura só de linha.
 */
export async function lerConfiguracaoDaRodada(providerId: number): Promise<Omit<RodadaDaFila, "deveParar">> {
  const [config, integracao] = await Promise.all([autonomiaStorage.config(providerId), storage.getIntegracaoDoChat(providerId)]);
  return { config, integracao, funcionariaDigital: lerFuncionariaDigital(integracao?.providerId === providerId ? integracao.agenteConfig : null) };
}

/** Só o nome ou o código do erro: a mensagem de um erro do banco pode trazer o valor de uma coluna. */
const causaDoErro = (err: unknown) => (err as { code?: string } | null)?.code ?? (err as { name?: string } | null)?.name ?? "erro";

let trabalhosEmAndamento = 0;

/**
 * Parada do worker, conferida pela rodada ANTES de enviar: com o sinal dado, o
 * trabalho volta a `pendente` (CAS a partir de `processando`) e é refeito no
 * próximo boot. Devolve `true` quando a rodada deve parar ali.
 *
 * Só serve ANTES de qualquer efeito que não se repete: com promessa, acordo ou
 * agendamento já gravados, refazer a rodada gravaria de novo — a partir desse
 * ponto a rodada termina (a parada espera até 15 s) ou, morta pelo pm2, fica
 * `processando` e vai ao atendente sem reenvio.
 */
export async function devolverSeParando(job: TrabalhoAutonomia, rodada: Pick<RodadaDaFila, "deveParar">): Promise<boolean> {
  if (!rodada.deveParar()) return false;
  const devolvido = await autonomiaStorage.devolverParaPendente(job);
  logger.info({ providerId: job.provider_id, jobId: job.id, devolvido }, "Autonomia: worker parando; a rodada que não enviou volta à fila");
  return true;
}

/**
 * Try/catch por trabalho (achado e1). Uma exceção que escapa da rodada — até
 * de dentro da transferência, como a do orçamento no aviso — não derruba a
 * leva nem deixa o trabalho `processando`, de onde ele voltaria a cada 5 min
 * na frente de todos os provedores. O trabalho vai ao atendente e a fila segue.
 * Cada passo é melhor esforço: com o banco fora, nada se grava, o trabalho
 * fica onde estava e a próxima volta decide.
 */
async function desistirDoTrabalho(job: TrabalhoAutonomia, err: unknown) {
  const motivo = "Falha inesperada na rodada; conferir histórico, sem reenvio automático";
  logger.warn({ providerId: job.provider_id, jobId: job.id, causa: causaDoErro(err) }, "Autonomia: rodada falhou fora do tratamento; o trabalho vai ao atendente e a fila segue");
  try {
    // O bloqueio local primeiro, como em `transferir`: nenhuma rodada seguinte responde esta conversa.
    await autonomiaStorage.cancelar(job.provider_id, job.conversation_id, motivo);
    // O follow-up que a rodada já gravou (acordo, promessa, "conferir telefone") fica: "Responder no chat" não passa por cima.
    if (!(err instanceof FalhaDepoisDoFollowUp)) {
      const vinculo = await storage.getConversaDoChat(job.provider_id, job.conversation_id);
      await pedirRespostaNoCaso(job.provider_id, vinculo?.providerId === job.provider_id && vinculo.conversationId === job.conversation_id ? vinculo : null);
    }
  } catch (e) {
    logger.warn({ providerId: job.provider_id, jobId: job.id, causa: causaDoErro(e) }, "Autonomia: bloqueio local da conversa não gravado");
  }
  try { await autonomiaStorage.marcar(job, "humano", motivo); }
  catch (e) { logger.warn({ providerId: job.provider_id, jobId: job.id, causa: causaDoErro(e) }, "Autonomia: trabalho não marcado; a próxima volta decide"); }
}

type LeituraSobTrava = { valor: Omit<RodadaDaFila, "deveParar"> } | null;
type DesfechoDoTrabalho = "rodada" | "configuracao_ocupada" | "leitura_falhou" | "conversa_ocupada" | "falhou";
/** Desfechos em que a rodada nem começou: o trabalho segue `pendente` e pode voltar na mesma leva, depois do intervalo. */
const ADIADOS: ReadonlySet<DesfechoDoTrabalho> = new Set<DesfechoDoTrabalho>(["configuracao_ocupada", "leitura_falhou", "conversa_ocupada"]);

async function executarTrabalho(job: TrabalhoAutonomia, deveParar: () => boolean, lerSobTrava: (providerId: number) => Promise<LeituraSobTrava>): Promise<DesfechoDoTrabalho> {
  const inicio = Date.now();
  const criado = job.criado_em ? new Date(job.criado_em).getTime() : NaN;
  let desfecho: DesfechoDoTrabalho = "rodada";
  trabalhosEmAndamento += 1;
  try {
    let leitura: LeituraSobTrava;
    try { leitura = await lerSobTrava(job.provider_id); }
    catch (err) {
      // Nada foi feito ainda (o trabalho nem foi assumido): fica `pendente` e a próxima volta tenta de novo.
      desfecho = "leitura_falhou";
      logger.warn({ providerId: job.provider_id, jobId: job.id, causa: causaDoErro(err) }, "Autonomia: configuração não lida; o trabalho fica para a próxima volta");
      return desfecho;
    }
    // Configuração sendo salva agora: o trabalho segue `pendente` para a próxima volta.
    if (!leitura) { desfecho = "configuracao_ocupada"; return desfecho; }
    const rodada: RodadaDaFila = { ...leitura.valor, deveParar };
    try {
      // A trava da conversa é a mesma do operador: assumir/devolver não disputam a rodada.
      const feito = await comTravaDoChat(chaveDaAutonomia(job.provider_id, job.conversation_id), async () => { await processar(job, rodada); return true; });
      if (!feito) desfecho = "conversa_ocupada";
    } catch (err) {
      desfecho = "falhou";
      await desistirDoTrabalho(job, err);
    }
    return desfecho;
  } finally {
    trabalhosEmAndamento -= 1;
    logger.info({ providerId: job.provider_id, jobId: job.id, desfecho, ms: Date.now() - inicio, idadeMs: Number.isFinite(criado) ? Math.max(0, inicio - criado) : undefined }, "Autonomia: trabalho da fila");
  }
}

/**
 * Uma volta da fila da autonomia (D11, achados e1, e4 e e14).
 *
 * - Até `PARALELISMO_DA_AUTONOMIA` rodadas ao mesmo tempo, nunca duas da MESMA
 *   conversa: a segunda mensagem espera a primeira terminar (e costuma ser
 *   cancelada por ela, que vê a mensagem mais nova). Do mesmo provedor, só
 *   quantas o fork aceita (`RODADAS_SIMULTANEAS_POR_PROVEDOR`).
 * - A leva vem do banco em rodízio entre provedores, e é completada enquanto
 *   houver trabalho novo: uma rodada lenta não segura as outras conversas.
 *   Trabalhador sem serviço NÃO sai enquanto houver rodada em curso — espera o
 *   intervalo, ou uma rodada terminar, e varre de novo. Só sai quando ninguém
 *   está rodando e a varredura não trouxe nada, ou pela parada, ou pelo teto.
 * - Erro de um trabalho não para os outros (`desistirDoTrabalho`).
 * - O sinal de parada é conferido antes de cada trabalho e a cada espera (no
 *   máximo o intervalo): o que não começou fica `pendente` para o próximo boot.
 *
 * `deveParar` é o sinal de um processo que chama esta função no próprio laço;
 * o worker usa `pararAutonomia`.
 */
export async function executarFilaAutonomia(opcoes: { deveParar?: () => boolean } = {}) {
  const deveParar = () => opcoes.deveParar?.() === true;
  if (deveParar()) return;
  const fimDaLeva = Date.now() + DURACAO_MAXIMA_DA_LEVA_MS;
  const aguardando: TrabalhoAutonomia[] = [];
  const vistos = new Set<number>();
  const conversasEmCurso = new Set<string>();
  const emCursoPorProvedor = new Map<number, number>();
  /** Rodadas em curso nesta leva: com alguma, quem está sem serviço espera em vez de sair. */
  let ocupados = 0;
  const chave = (job: TrabalhoAutonomia) => chaveDaAutonomia(job.provider_id, job.conversation_id);
  let varredura: Promise<void> | null = null;
  /** Antes disto a leva não volta ao banco. Zero: a última varredura trouxe o que começar, e pode haver mais. */
  let proximaVarreduraEm = 0;
  let erroDeLeitura: unknown = null;
  // Trabalho que não começou (trava ocupada, leitura falhou) volta a ser elegível nesta leva depois do intervalo — uma leva longa não o esquece.
  const adiadoAte = new Map<number, number>();

  /*
   * Quem espera é acordado quando algo muda: uma rodada terminou (liberou a
   * conversa, a vaga do provedor ou a última rodada), a leitura da chave D9
   * abriu vagas do provedor, ou a varredura trouxe trabalho. O temporizador é
   * só o teto da espera — até a próxima varredura —, e é nele que a parada e o
   * teto da leva são reconferidos.
   */
  let despertadores: (() => void)[] = [];
  const avisar = () => { const todos = despertadores; despertadores = []; for (const acordar of todos) acordar(); };
  const aguardar = (ms: number) => new Promise<void>(resolve => {
    const acordar = () => { clearTimeout(temporizador); resolve(); };
    const temporizador = setTimeout(() => { despertadores = despertadores.filter(d => d !== acordar); resolve(); }, Math.max(0, ms));
    temporizador.unref?.();
    despertadores.push(acordar);
  });

  /** Vagas de cada provedor nesta leva, pela chave D9 da última leitura; sem leitura, as da chave desligada. */
  const vagasPorProvedor = new Map<number, number>();
  const podeComecar = (job: TrabalhoAutonomia) =>
    !conversasEmCurso.has(chave(job)) &&
    (emCursoPorProvedor.get(job.provider_id) ?? 0) < (vagasPorProvedor.get(job.provider_id) ?? RODADAS_SIMULTANEAS_POR_PROVEDOR.chaveDesligada);

  /*
   * A leitura sob a trava `config:` é COMPARTILHADA entre as rodadas do mesmo
   * provedor que começam juntas. A trava é `pg_try_advisory_lock`: três rodadas
   * do mesmo provedor pedindo-a ao mesmo tempo, cada uma na sua conexão, fariam
   * duas receberem "ocupada" e pularem a vez — o paralelismo viraria fila em série.
   * Terminada a leitura, a próxima rodada lê de novo (configuração fresca).
   */
  const leiturasEmCurso = new Map<number, Promise<LeituraSobTrava>>();
  const lerSobTrava = (providerId: number): Promise<LeituraSobTrava> => {
    const emCurso = leiturasEmCurso.get(providerId);
    if (emCurso) return emCurso;
    const nova = comTravaDoChat(`config:${providerId}`, async () => ({ valor: await lerConfiguracaoDaRodada(providerId) }))
      .then(leitura => {
        if (leitura) {
          const { chaveLigada, chaveDesligada } = RODADAS_SIMULTANEAS_POR_PROVEDOR;
          vagasPorProvedor.set(providerId, leitura.valor.funcionariaDigital.ativa ? chaveLigada : chaveDesligada);
          avisar();
        }
        return leitura;
      })
      .finally(() => { leiturasEmCurso.delete(providerId); });
    leiturasEmCurso.set(providerId, nova);
    return nova;
  };

  // Uma varredura por vez para a leva inteira: três trabalhadores sem serviço não fazem três consultas.
  const varrer = () => (varredura ??= (async () => {
    try {
      const agora = Date.now();
      const novos = (await autonomiaStorage.proximos()).filter(j => !vistos.has(j.id) && (adiadoAte.get(j.id) ?? 0) <= agora && !aguardando.some(a => a.id === j.id));
      aguardando.push(...novos);
      // Nada que possa começar agora (vazia, ou só conversa/provedor ocupado): o banco espera o intervalo.
      proximaVarreduraEm = novos.some(podeComecar) ? 0 : Date.now() + INTERVALO_ENTRE_VARREDURAS_MS;
      if (novos.length) avisar();
    } catch (err) {
      erroDeLeitura = err;
      proximaVarreduraEm = Date.now() + INTERVALO_ENTRE_VARREDURAS_MS;
    }
  })().finally(() => { varredura = null; }));

  const proximoTrabalho = async (): Promise<TrabalhoAutonomia | null> => {
    for (;;) {
      if (deveParar() || Date.now() >= fimDaLeva) return null;
      const i = aguardando.findIndex(podeComecar);
      if (i >= 0) {
        const [job] = aguardando.splice(i, 1);
        vistos.add(job.id);
        conversasEmCurso.add(chave(job));
        emCursoPorProvedor.set(job.provider_id, (emCursoPorProvedor.get(job.provider_id) ?? 0) + 1);
        ocupados += 1;
        return job;
      }
      const agora = Date.now();
      if (agora >= proximaVarreduraEm) { await varrer(); continue; }
      // Ninguém rodando e nada a começar: a leva termina, e o laço de 3 s abre a próxima.
      if (ocupados === 0) return null;
      await aguardar(Math.min(proximaVarreduraEm, fimDaLeva) - agora);
    }
  };

  const trabalhador = async () => {
    for (let job = await proximoTrabalho(); job; job = await proximoTrabalho()) {
      try {
        if (ADIADOS.has(await executarTrabalho(job, deveParar, lerSobTrava))) {
          vistos.delete(job.id);
          adiadoAte.set(job.id, Date.now() + INTERVALO_ENTRE_VARREDURAS_MS);
        }
      } finally {
        conversasEmCurso.delete(chave(job));
        const doProvedor = (emCursoPorProvedor.get(job.provider_id) ?? 1) - 1;
        if (doProvedor > 0) emCursoPorProvedor.set(job.provider_id, doProvedor);
        else emCursoPorProvedor.delete(job.provider_id);
        ocupados -= 1;
        avisar();
      }
    }
  };
  await Promise.all(Array.from({ length: PARALELISMO_DA_AUTONOMIA }, trabalhador));
  // A leitura da fila falhou: o laço registra "fila indisponível", como antes.
  if (erroDeLeitura) throw erroDeLeitura;
}
let timer: ReturnType<typeof setInterval> | null = null;
let rodando: Promise<void> | null = null;
/** O sinal de parada do laço ligado por `iniciarAutonomia`. Cada laço tem o seu: parar um não trava uma chamada direta de `executarFilaAutonomia`. */
let sinalDoLaco = { parar: false };
/**
 * Liga o laço da fila — DEPOIS de conferir, uma vez só, que as tabelas da
 * 0028 existem. Sem elas, um aviso único e desiste: antes, o laço de 3 s
 * falhava a cada volta e enchia o log de "fila indisponível" num banco que
 * simplesmente ainda não tinha a migração. Devolve se ligou.
 */
export async function iniciarAutonomia(): Promise<boolean> {
  if (timer) return true;
  let tabelas: { ok: boolean; faltam: string[] };
  try { tabelas = await autonomiaStorage.tabelasExistem(); }
  catch (err) { logger.warn({ err }, "Autonomia: não foi possível conferir fila, identidade e quitações (0028/0034/0035); o laço não vai subir"); return false; }
  if (!tabelas.ok) { logger.warn({ faltam: tabelas.faltam }, "Autonomia: tabelas das migrações 0028/0034/0035 ausentes; o laço não vai subir"); return false; }
  const sinal = { parar: false };
  sinalDoLaco = sinal;
  timer = setInterval(() => {
    if (rodando || sinal.parar) return;
    rodando = executarFilaAutonomia({ deveParar: () => sinal.parar }).catch(err => logger.warn({ err }, "Autonomia: fila indisponível")).finally(() => { rodando = null; });
  }, 3000);
  timer.unref();
  return true;
}
/**
 * Para o laço: nenhum trabalho novo começa, e a espera pelas rodadas em curso
 * tem teto (achado e14). Antes esperava a leva inteira — até 20 rodadas de
 * 20–40 s — e só DEPOIS o worker drenava o sync, que o pm2 matava no meio.
 * Devolve se as rodadas terminaram dentro da espera.
 */
export async function pararAutonomia(esperaMaximaMs = ESPERA_MAXIMA_NA_PARADA_MS): Promise<boolean> {
  sinalDoLaco.parar = true;
  if (timer) clearInterval(timer);
  timer = null;
  const emCurso = rodando;
  if (!emCurso) return true;
  let espera: ReturnType<typeof setTimeout> | undefined;
  const terminou = await Promise.race([
    emCurso.then(() => true),
    new Promise<boolean>(resolve => { espera = setTimeout(() => resolve(false), esperaMaximaMs); espera.unref?.(); }),
  ]);
  clearTimeout(espera);
  if (!terminou) logger.warn({ emAndamento: trabalhosEmAndamento, esperaMs: esperaMaximaMs }, "Autonomia: parada sem esperar as rodadas em curso; trabalho interrompido vai ao atendente na volta, sem reenvio");
  return terminou;
}
