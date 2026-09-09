import { CobrancaPreventivoStorage } from "../../storage/cobranca-preventivo.storage";
import { enviarPreAvisoParaChat } from "./chat-ponte.service";
import { planejarPreAviso } from "@shared/cobranca/preventivo";

/** Confere a fatura novamente e toma a reserva antes de chamar qualquer canal. */
export async function executarPreAviso(providerId: number, id: number, userId: number, dia: string): Promise<{ enviado: boolean }> {
  const fila = new CobrancaPreventivoStorage();
  const aviso = (await fila.listarPreAvisosPendentes(providerId, dia, 500)).find(a => a.id === id);
  if (!aviso || !planejarPreAviso(providerId, { id: aviso.faturaId, status: aviso.status, vencimento: aviso.vencimento, valor: Number(aviso.valor) }, dia)) return { enviado: false };
  if (!await fila.reservarPreAviso(providerId, id, dia)) return { enviado: false };
  try {
    const resultado = await enviarPreAvisoParaChat(providerId, aviso, userId);
    await fila.concluirPreAviso(providerId, id, { status: resultado.enviado ? "enviado" : "ignorado", conversationId: resultado.conversationId, messageId: resultado.messageId,
      motivo: resultado.enviado ? "Pré-aviso iniciado; resposta será atendida pela equipe" : "Conversa existente; nenhuma nova mensagem enviada" });
    return { enviado: resultado.enviado };
  } catch (erro) {
    await fila.concluirPreAviso(providerId, id, { status: "incerto", motivo: "Envio sem confirmação; conferir conversa antes de qualquer nova tentativa" });
    throw erro;
  }
}
