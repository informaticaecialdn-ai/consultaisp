import { CobrancaPreventivoStorage } from "../../storage/cobranca-preventivo.storage";
import { enviarPreAvisoParaChat } from "./chat-ponte.service";
import { planejarPreAviso } from "@shared/cobranca/preventivo";
import { janelaDoChat, lerAutomacaoChat } from "@shared/cobranca/automacao-chat";
import { storage } from "../../storage";
import { reservarComunicacao, concluirComunicacao } from "../../storage/cobranca-comunicacao.storage";

/** Confere a fatura novamente e toma a reserva antes de chamar qualquer canal. */
export async function executarPreAviso(providerId: number, id: number, userId: number, dia: string): Promise<{ enviado: boolean }> {
  const fila = new CobrancaPreventivoStorage();
  const configurada = await fila.obterConfigAvisos(providerId);
  const politica = await storage.getPoliticaDeCobranca(providerId);
  if (politica?.pausada) return { enviado: false };
  let diasPausados: string[] = [];
  if (configurada ? !configurada.ligada || configurada.canal !== "whatsapp" : false) return { enviado: false };
  if (!configurada) {
    const integracao = await storage.getIntegracaoDoChat(providerId);
    const legado = lerAutomacaoChat((integracao?.agenteConfig as Record<string, unknown> | null)?.primeiroContato);
    if (!legado.ligada || !legado.preventivo) return { enviado: false };
    diasPausados = legado.diasPausados;
  }
  const janela = janelaDoChat(new Date(), politica?.janelaContato, diasPausados);
  if (!janela.permitida || janela.dia !== dia) return { enviado: false };
  const aviso = (await fila.listarPreAvisosPendentes(providerId, dia, 500)).find(a => a.id === id);
  if (!aviso || !planejarPreAviso(providerId, { id: aviso.faturaId, status: aviso.status, vencimento: aviso.vencimento, valor: Number(aviso.valor) }, dia, undefined, configurada?.diasAntes ?? [7, 3, 1])) return { enviado: false };
  const comunicacaoId = await reservarComunicacao({ providerId, customerId: aviso.customerId, casoId: null,
    faturaId: aviso.faturaId, canal: "whatsapp", finalidade: "preventivo", dia, chave: `preventivo:${aviso.faturaId}:${dia}` });
  if (!comunicacaoId) return { enviado: false };
  if (!await fila.reservarPreAviso(providerId, id, dia)) {
    await concluirComunicacao(providerId, comunicacaoId, { status: "ignorado", motivo: "Fatura ou preferência de contato mudou antes do envio" });
    return { enviado: false };
  }
  try {
    const resultado = await enviarPreAvisoParaChat(providerId, aviso, userId);
    await concluirComunicacao(providerId, comunicacaoId, { status: resultado.enviado ? "enviado" : "ignorado",
      providerMessageId: resultado.messageId ?? undefined, motivo: resultado.enviado ? undefined : "Conversa existente; nenhuma nova mensagem enviada" });
    await fila.concluirPreAviso(providerId, id, { status: resultado.enviado ? "enviado" : "ignorado", conversationId: resultado.conversationId, messageId: resultado.messageId,
      motivo: resultado.enviado ? "Pré-aviso iniciado; resposta será atendida pela equipe" : "Conversa existente; nenhuma nova mensagem enviada" });
    return { enviado: resultado.enviado };
  } catch (erro) {
    await concluirComunicacao(providerId, comunicacaoId, { status: "incerto", motivo: "Envio sem confirmação; conferir conversa antes de qualquer nova tentativa" });
    await fila.concluirPreAviso(providerId, id, { status: "incerto", motivo: "Envio sem confirmação; conferir conversa antes de qualquer nova tentativa" });
    throw erro;
  }
}
