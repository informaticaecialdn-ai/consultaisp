import { EstadoDaConexaoWhatsappSchema, type EstadoDaConexaoWhatsapp } from "@shared/chat-whatsapp";
import { storage } from "../../storage";
import { clienteDoChat, ErroDaPonteDoChat } from "./chat-ponte.service";
import { comTravaDoChat } from "./chat-trava";

/** Sempre resolve canal e organização pela sessão; nunca aceita ids do navegador. */
export async function consultarOuConectarWhatsapp(
  providerId: number,
  acao: "consultar" | "conectar",
  phone?: string,
  opcoes: { espera?: number } = {},
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
    const { organizationId, canalId } = integracao; // estreitados pela guarda acima — o closure nao herda o narrowing
    const ler = () => cliente.estadoDaConexaoWhatsapp(organizationId, canalId);
    const lido = (r: Awaited<ReturnType<typeof ler>>) => (r.ok ? EstadoDaConexaoWhatsappSchema.safeParse(r.valor) : null);
    let aviso: string | null = null;
    let remoto: Awaited<ReturnType<typeof ler>>;
    if (acao === "conectar") {
      // Pedir QR ou codigo para um numero JA conectado faz o Uazapi/Zappfy
      // iniciar OUTRO login e derrubar a sessao atual (NsLink, 09/09/2026:
      // "disconnected by API" e, quatro minutos depois, "Pair Code timeout").
      // Le o estado antes; conectado e logado, nao pede nada.
      const atual = lido(await ler());
      if (atual?.success && atual.data.connected && atual.data.loggedIn) {
        remoto = { ok: true, valor: atual.data };
        aviso = "O número já está conectado. Gerar um novo QR ou código derrubaria a sessão atual — para trocar de aparelho, desconecte antes em WhatsApp → Aparelhos conectados.";
      } else {
        remoto = await cliente.conectarWhatsapp(organizationId, canalId, phone);
        // O QR ou o codigo aparecem no STATUS logo depois do pedido, nao na
        // resposta dele (a instancia ainda esta trocando de estado). Espera um
        // instante e rele; sem QR nem codigo, fica a resposta do pedido.
        if (remoto.ok) {
          const espera = opcoes.espera ?? 1200;
          if (espera > 0) await new Promise(r => setTimeout(r, espera));
          const relido = lido(await ler());
          if (relido?.success && (relido.data.qrCode || relido.data.pairCode || relido.data.status === "connecting")) remoto = { ok: true, valor: relido.data };
        }
      }
    } else {
      remoto = await ler();
    }
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
    return { ...estado.data, ...(ativo ? { qrCode: null, pairCode: null } : {}), aviso };
  });
  if (!resultado) throw new ErroDaPonteDoChat("CONFLITO", "A conexão está sendo atualizada. Tente novamente em instantes.");
  return resultado;
}
