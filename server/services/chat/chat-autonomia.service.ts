import { randomUUID } from "crypto";
import { ConfigAutonomiaSchema, PlanoRespostaSchema, type ConfigAutonomia, type PedidoPlanoAutonomia, type PlanoResposta } from "@shared/chat-autonomia";
import type { TipoDeAgente } from "@shared/chat-agentes";
import { mensagemDePagamento } from "@shared/cobranca/pagamento-chat";
import { storage } from "../../storage";
import { logger } from "../../logger";
import { autonomiaStorage, type TrabalhoAutonomia } from "../../storage/chat-autonomia.storage";
import { clienteDoChat, ErroDaPonteDoChat } from "./chat-ponte.service";
import { comTravaDoChat } from "./chat-trava";
import { listarAgentesDoChat, comTravaDaConfiguracaoDoChat, modelosDosAgentesDoChat } from "./chat-agentes.service";
import { contextoDoAtendimento, segundaViaDoAtendimento } from "./chat-contexto.service";
import { casoParaAgente, registrarPromessaDoAgente } from "./chat-agente.service";
import { dataLocal, exigeHumano, propostaConfirmada, respostaControlada, textoDaProposta, validarProposta } from "./chat-autonomia-politica";
import { ACAO_AO_RECEBER_MENSAGEM } from "./chat-atendimento.service";
import { casoFechado } from "@shared/cobranca/estados";
import type { ChatBullqConversa } from "@shared/schema";
import type { Resultado } from "./chat-bullq.client";

const valor = <T>(r: Resultado<T>): T => { if (!r.ok) throw new Error("Operação do chat não confirmada"); return r.valor; };
export const chaveDaAutonomia = (providerId: number, conversationId: string) => `autonomia:${providerId}:${conversationId}`;

/** O que a IA NUNCA faz sozinha, dito pelo servidor — a tela repete estas palavras, não inventa as suas. */
export const LIMITES_DA_AUTONOMIA = {
  maxTurnos: 20, maxPlanosPorMensagem: 1, confirmacaoExplicita: true,
  agendamento: "local_sem_reserva_erp", pagamento: "somente_erp", envioAmbiguo: "humano_sem_reenvio",
  nunca: ["negativar", "baixar", "desconto_fora_da_politica", "parcelar", "confirmar_pagamento", "confirmar_devolucao"],
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
    valor(await c.desligarIa(intg.organizationId, conversationId));
    valor(await c.atribuir(intg.organizationId, conversationId, { status: "BOT" }));
    await autonomiaStorage.devolver(providerId, conversationId, "Atendente devolveu a conversa ao assistente");
    const atualizado = await storage.atualizarConversaDoChat(providerId, conversationId, { status: "BOT" });
    await storage.registrarEventoDoChat(providerId, atualizado ?? vinculo, userId, "Atendente devolveu a conversa ao assistente autônomo");
    return { valor: { conversationId, status: "BOT" as const, humano: false } };
  });
  if (!r) throw new ErroDaPonteDoChat("CONFLITO", "O assistente está finalizando uma rodada. Tente novamente em instantes.");
  return r.valor;
}
export async function configurarAutonomia(providerId: number, dados: ConfigAutonomia) {
  const config = ConfigAutonomiaSchema.parse(dados);
  return comTravaDaConfiguracaoDoChat(providerId, async () => {
    if (config.ativa) {
      const [{ agentes }, modelos] = await Promise.all([listarAgentesDoChat(providerId), modelosDosAgentesDoChat(providerId)]);
      if (!modelos.configured || config.tipos.some(tipo => !agentes.some(a => a.tipo === tipo && a.etapa === "pronto" && a.habilitado && a.id && a.modelo)))
        throw new ErroDaPonteDoChat("CONFLITO", "Configure a credencial de IA e deixe os agentes selecionados prontos antes de ativar a autonomia");
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

async function transferir(job: TrabalhoAutonomia, motivo: string) {
  // Bloqueio local primeiro: se o BullQ falhar, nenhuma próxima rodada responde.
  await autonomiaStorage.cancelar(job.provider_id, job.conversation_id, motivo);
  const vinculo = await storage.getConversaDoChat(job.provider_id, job.conversation_id);
  if (vinculo && !["OPEN", "CLOSED"].includes(vinculo.status)) {
    await storage.atualizarConversaDoChat(job.provider_id, job.conversation_id, { status: "PENDING" });
    await storage.registrarEventoDoChat(job.provider_id, vinculo, null, `Assistente autônomo transferiu ao atendente: ${motivo}`);
    const c = clienteDoChat(); const i = await storage.getIntegracaoDoChat(job.provider_id);
    if (c && i) { valor(await c.desligarIa(i.organizationId, job.conversation_id)); valor(await c.atribuir(i.organizationId, job.conversation_id, { status: "PENDING" })); }
  }
  // Quem recebe a conversa precisa do caso pedindo resposta, como no fluxo humano.
  await pedirRespostaNoCaso(job.provider_id, vinculo);
  await autonomiaStorage.marcar(job, "humano", motivo);
}

async function processar(job: TrabalhoAutonomia) {
  if (job.status !== "pendente") { await transferir(job, "Rodada interrompida; conferir histórico antes de qualquer reenvio"); return; }
  if (!await autonomiaStorage.assumir(job)) return;
  const providerId = job.provider_id, conversationId = job.conversation_id;
  try {
    const [config, estado, vinculo, intg] = await Promise.all([autonomiaStorage.config(providerId), autonomiaStorage.estado(providerId, conversationId), storage.getConversaDoChat(providerId, conversationId), storage.getIntegracaoDoChat(providerId)]);
    // A conversa saiu do assistente entre a chegada e a rodada: ninguem mais vai
    // responder esta mensagem, entao o caso fica pedindo resposta no chat.
    if (!config.ativa || estado.humano || !vinculo || ["OPEN", "PENDING", "CLOSED"].includes(vinculo.status)) { await pedirRespostaNoCaso(providerId, vinculo); await autonomiaStorage.marcar(job, "cancelado", "Autonomia pausada ou atendimento humano"); return; }
    if (estado.turnos >= config.maxTurnos) { await transferir(job, "Limite de rodadas atingido"); return; }
    const c = clienteDoChat(); if (!c || !intg) throw new Error("Chat indisponível");
    const mensagens = valor(await c.listarMensagens(intg.organizationId, conversationId, { page: 1, limit: 40 })).sort((a,b) => new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime());
    const inbound = mensagens.find(m => m.id === job.message_id && m.direction === "INBOUND");
    if (!inbound || inbound.type !== "TEXT" || !inbound.content.text?.trim()) { await transferir(job, "Mensagem com mídia ou texto indisponível exige leitura humana"); return; }
    const ultima = mensagens.filter(m => m.direction === "INBOUND").at(-1);
    if (ultima?.id !== job.message_id) { await autonomiaStorage.marcar(job, "cancelado", "Outra mensagem do cliente já recebida"); return; }
    const texto = inbound.content.text.trim();
    if (texto.length > 1200 || exigeHumano(texto)) { await transferir(job, "Cliente pediu atendimento ou informou uma exceção que exige conferência"); return; }
    const recuperacao = !!vinculo.recuperacaoId;
    const caso = vinculo.casoId ? await storage.obterCasoDeCobranca(providerId, vinculo.casoId) : null;
    const tipo: TipoDeAgente = recuperacao ? "recuperacao_equipamentos" : caso?.carteira === "ex_cliente" ? "cobranca_ex_clientes" : "cobranca_ativos";
    const agente = (await listarAgentesDoChat(providerId)).agentes.find(a => a.tipo === tipo);
    if (!config.tipos.includes(tipo) || !agente?.habilitado || agente.etapa !== "pronto" || !agente.id || !agente.modelo) { await transferir(job, "Agente da carteira não está habilitado e pronto"); return; }
    const contexto = await contextoDoAtendimento(providerId, conversationId, true);
    // A ficha agora devolve null quando ninguém leu o valor/atraso; null não é zero.
    const saldoLido = contexto.cliente.divida, atrasoLido = contexto.cliente.diasAtraso;
    const recuperacaoCaso = recuperacao ? await storage.getRecoveryCaseById(vinculo.recuperacaoId!, providerId) : null;
    if (recuperacao && (!recuperacaoCaso || recuperacaoCaso.closedAt || recuperacaoCaso.disputedAt)) { await transferir(job, "Caso de devolução encerrado ou contestado"); return; }
    if (!recuperacao && (contexto.erp.status !== "disponivel" || !caso || saldoLido == null || saldoLido <= 0 || atrasoLido == null || atrasoLido > 1825)) { await transferir(job, "Saldo não confirmado no ERP ou caso requer conferência"); return; }
    // O ERP responder NÃO é o mesmo que ter lido o financeiro: quando o cliente
    // pagou tudo, o ERP devolve zero fatura e a ficha cai para a varredura das
    // 03:00 — com `status: "disponivel"` do mesmo jeito. Falar aquele saldo é
    // cobrar por WhatsApp quem já pagou. Sem leitura ao vivo, vai ao atendente.
    if (!recuperacao && !contexto.erp.financeiroAoVivo) { await transferir(job, `Saldo não confirmado no ERP nesta leitura: o valor disponível é o da ${contexto.erp.valoresDe === "base_sincronizada" ? "base sincronizada" : "leitura anterior"}, e o assistente não fala valor que não leu`); return; }
    // Só se fala em valor o que foi lido AGORA. Na recuperação o saldo não é
    // afirmado a ninguém: `respostaControlada` e a proposta de agendamento o ignoram.
    const saldo: number | null = recuperacao || !contexto.erp.financeiroAoVivo ? null : saldoLido;
    // Debita antes de chamar IA ou efetivar operação; falha não concede custo ilimitado.
    await autonomiaStorage.turno(providerId, conversationId);
    let resposta: string;
    if (propostaConfirmada(estado.proposta, texto, job.message_id)) {
      const p = estado.proposta;
      if (p.acao === "promessa") {
        // `saldo == null` é a trava do valor não lido; a data é comparada com HOJE
        // em America/Sao_Paulo — às 21:00 de Brasília o UTC já virou o dia, e a
        // promessa feita para hoje seria recusada como passada.
        if (recuperacao || !config.permitirPromessa || saldo == null || p.valor !== saldo || p.data < dataLocal(new Date())) { await transferir(job, "A promessa precisa de nova conferência de saldo/data"); return; }
        const telefone = contexto.cliente.telefone;
        const atual = await casoParaAgente(providerId, telefone);
        if (!telefone || atual.caso?.id !== vinculo.casoId || atual.promessaAberta || atual.caso.prescrita) { await transferir(job, "Caso ou promessa existente exige conferência humana"); return; }
        const gravada = await registrarPromessaDoAgente(providerId, { telefone, dataPrometida: p.data, valor: saldo, observacao: "Confirmada pelo cliente após oferta explícita do assistente", conversaId: conversationId });
        if (!gravada.ok) throw new Error("Promessa não confirmada");
        resposta = `Promessa de pagamento registrada para ${p.data}. A pendência permanece até o ERP confirmar o pagamento. Obrigado pelo retorno.`;
      } else {
        if (!recuperacao || !config.permitirAgendamento || new Date(p.data).getTime() <= Date.now() || !await autonomiaStorage.agendar(providerId, vinculo.recuperacaoId!, vinculo.customerId, p.data, job.message_id)) { await transferir(job, "Agendamento existente ou indisponível; a equipe precisa conferir"); return; }
        resposta = `Agendamento local registrado para ${p.data.slice(0,10)} às ${p.data.slice(11,16)} (Brasília), para acompanhamento da equipe. A devolução do equipamento ainda não foi confirmada.`;
      }
      await autonomiaStorage.proposta(providerId, conversationId, null);
    } else {
      // Uma nova intenção invalida a oferta antiga, impedindo um “sim” tardio.
      if (estado.proposta) await autonomiaStorage.proposta(providerId, conversationId, null);
      const allowedActions: PlanoResposta["acao"][] = ["responder", "transferir"];
      if (!recuperacao && config.permitirSegundaVia) allowedActions.push("segunda_via");
      if (!recuperacao && config.permitirPromessa) allowedActions.push("promessa");
      if (recuperacao && config.permitirAgendamento && !recuperacaoCaso?.scheduledAt) allowedActions.push("agendar");
      const pedido: PedidoPlanoAutonomia = {
        requestId: `autonomia_${job.id}_${randomUUID()}`, operation: recuperacao ? "recuperacao" : "cobranca",
        // `dataHoje` é o dia de calendário de Brasília, o MESMO que `validarProposta`
        // usa para recusar data passada. Mandar o dia em UTC fazia o modelo e o
        // servidor discordarem do que é "hoje" a partir das 21:00.
        context: JSON.stringify({ saldo, dataHoje: dataLocal(new Date()), agora: new Date().toISOString(), fuso: "America/Sao_Paulo", faturas: contexto.faturas.slice(0,20).map(f => ({ ref: f.ref, valor: f.valor, vencimento: f.vencimento })), agendamentoExistente: recuperacaoCaso?.scheduledAt ?? null, regras: "Somente valor integral. Desconto, pagamento informado, comprovante, contestação, devolução informada e pedido de humano: transferir. Datas devem estar na mensagem; proposta seguida de confirmação é controlada pelo servidor. Não enviar mensagens diretamente." }),
        history: mensagens.slice(-8).map(m => ({ role: m.direction === "INBOUND" ? "user" : "assistant", content: (m.content.text ?? "[mídia]").slice(0, 1000) })), allowedActions,
      };
      const plano = PlanoRespostaSchema.parse(valor(await c.planejarAutonomia(intg.organizationId, agente.id, pedido)));
      if (!allowedActions.includes(plano.acao)) { await transferir(job, "Plano fora das permissões do provedor"); return; }
      if (plano.acao === "transferir") { await transferir(job, "A solicitação exige atendimento humano"); return; }
      if (plano.acao === "segunda_via") {
        if (!plano.faturaId) { await transferir(job, "Fatura não identificada"); return; }
        resposta = mensagemDePagamento(await segundaViaDoAtendimento(providerId, conversationId, plano.faturaId));
      } else if (plano.acao === "promessa" || plano.acao === "agendar") {
        const proposta = validarProposta(plano, texto, saldo, job.message_id);
        if (!proposta) { await transferir(job, "Data, valor ou horário não confirmados dentro dos limites"); return; }
        await autonomiaStorage.proposta(providerId, conversationId, proposta);
        resposta = textoDaProposta(proposta);
      } else resposta = respostaControlada(plano, saldo, recuperacao);
    }
    // A trava é a mesma do operador. Marcado ANTES do HTTP: nunca repetir envio ambíguo.
    await autonomiaStorage.marcar(job, "enviando");
    valor(await c.enviarTexto(intg.organizationId, conversationId, resposta));
    await autonomiaStorage.marcar(job, "concluido");
    await storage.registrarEventoDoChat(providerId, vinculo, null, "Assistente autônomo respondeu dentro das permissões do provedor");
  } catch (e) {
    logger.warn({ providerId: job.provider_id, jobId: job.id }, "Autonomia: rodada não confirmada; encaminhando ao humano");
    await transferir(job, "Falha na rodada ou envio não confirmado; conferir histórico, sem reenvio automático");
  }
}

export async function executarFilaAutonomia() {
  for (const job of await autonomiaStorage.proximos()) {
    // Config e conversa usam as mesmas travas das rotas; parar/assumir não disputa envio.
    await comTravaDoChat(`config:${job.provider_id}`, () => comTravaDoChat(chaveDaAutonomia(job.provider_id, job.conversation_id), () => processar(job)));
  }
}
let timer: ReturnType<typeof setInterval> | null = null;
let rodando: Promise<void> | null = null;
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
  catch (err) { logger.warn({ err }, "Autonomia: não foi possível conferir as tabelas da fila (migração 0028); o laço não vai subir"); return false; }
  if (!tabelas.ok) { logger.warn({ faltam: tabelas.faltam }, "Autonomia: tabelas da migração 0028 ausentes; o laço não vai subir"); return false; }
  timer = setInterval(() => {
    if (rodando) return;
    rodando = executarFilaAutonomia().catch(err => logger.warn({ err }, "Autonomia: fila indisponível")).finally(() => { rodando = null; });
  }, 3000);
  timer.unref();
  return true;
}
export async function pararAutonomia() { if (timer) clearInterval(timer); timer = null; await rodando; }
