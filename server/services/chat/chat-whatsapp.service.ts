import { EstadoDaConexaoWhatsappSchema, type EstadoDaConexaoWhatsapp } from "@shared/chat-whatsapp";
import { storage } from "../../storage";
import { clienteDoChat, ErroDaPonteDoChat } from "./chat-ponte.service";
import { comTravaDoChat } from "./chat-trava";

/** Sempre resolve canal e organização pela sessão; nunca aceita ids do navegador. */
export async function consultarOuConectarWhatsapp(
  providerId: number,
  acao: "consultar" | "conectar",
  phone?: string,
): Promise<EstadoDaConexaoWhatsapp> {
  const cliente = clienteDoChat();
  if (!cliente) throw new ErroDaPonteDoChat("CHAT_DESLIGADO", "Configure o serviço do chat antes de conectar o WhatsApp");
  const resultado = await comTravaDoChat(`config:${providerId}`, async () => {
    const integracao = await storage.getIntegracaoDoChat(providerId);
    if (!integracao?.canalId || integracao.providerId !== providerId) {
      throw new ErroDaPonteDoChat("SEM_CANAL", "Salve o token da instância antes de conectar o número");
    }
    const capacidades = await cliente.capacidadesDosCanais(integracao.organizationId);
    if (!capacidades.ok || !capacidades.valor.whatsappUnofficial || !capacidades.valor.instanceConnect || !capacidades.valor.instanceStatus) {
      throw new ErroDaPonteDoChat("CONFLITO", "Esta instalação do ChatBullQ precisa da atualização de conexão por QR. O administrador da instalação pode aplicar o patch de WhatsApp não oficial.");
    }
    const remoto = acao === "conectar"
      ? await cliente.conectarWhatsapp(integracao.organizationId, integracao.canalId, phone)
      : await cliente.estadoDaConexaoWhatsapp(integracao.organizationId, integracao.canalId);
    if (!remoto.ok) {
      // Mensagens de gateways podem conter credenciais. Não persistir nem devolver o erro bruto.
      throw new ErroDaPonteDoChat("CHAT_FALHOU", "Não foi possível consultar a instância de WhatsApp. Confira a conexão do serviço e tente novamente.");
    }
    const estado = EstadoDaConexaoWhatsappSchema.safeParse(remoto.valor);
    if (!estado.success) throw new ErroDaPonteDoChat("CHAT_FALHOU", "O chat devolveu um estado de conexão inválido");
    const ativo = estado.data.connected && estado.data.loggedIn;
    // A instância respondeu: ela existe. Não estar conectada é o mesmo estado
    // físico que a ponte gravou ao salvar o canal — `aguardando_conexao`, e não
    // `erro`. `erro` fica para a consulta que falha ou o serviço que recusa
    // (acima), que nem chega aqui.
    await storage.marcarEstadoDaIntegracaoDoChat(providerId, {
      status: ativo ? "ativo" : "aguardando_conexao",
      ultimoErro: ativo ? null : estado.data.status === "connecting" ? "Aguardando o pareamento do WhatsApp" : "A instância de WhatsApp não está conectada",
    });
    // Um QR antigo não deve continuar aparecendo depois de confirmar a conexão.
    return { ...estado.data, ...(ativo ? { qrCode: null, pairCode: null } : {}) };
  });
  if (!resultado) throw new ErroDaPonteDoChat("CONFLITO", "A conexão está sendo atualizada. Tente novamente em instantes.");
  return resultado;
}
