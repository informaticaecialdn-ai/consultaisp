import { storage } from "../../storage";
import { segurancaAutonomiaStorage } from "../../storage/chat-autonomia-seguranca.storage";
import type { OfertasAutonomia } from "@shared/chat-autonomia-seguranca";
import { brl, gerarParcelas, validarPolitica } from "@shared/cobranca/politica";
import { calcularOfertasAutonomia, escolherOfertaAutonomia, ofertaAindaValida, pedeNegociacao, pedidoForaDaFaixa, textoDasOfertas, textoDoAceite, type EntradaOfertaAutonomia } from "./chat-autonomia-ofertas";
import { confirmacaoExplicita } from "./chat-autonomia-politica";

interface RodadaNegociacao extends EntradaOfertaAutonomia {
  providerId: number; conversationId: string; casoId: number; texto: string; messageId: string;
  permitir: boolean; ofertas: OfertasAutonomia | null; agora?: Date;
}
type ResultadoNegociacao = { acao: "humano"; motivo: string } | { acao: "responder"; resposta: string; precisaEmissao?: boolean } | null;
/** A oferta nunca é escolhida pelo LLM: opção, data e consentimento vêm do cliente. */
export async function processarNegociacaoAutonoma(d: RodadaNegociacao): Promise<ResultadoNegociacao> {
  if (!d.ofertas && !pedeNegociacao(d.texto)) return null;
  const humano = (motivo: string): ResultadoNegociacao => ({ acao: "humano", motivo });
  if (!d.permitir) return humano("Negociação autônoma não autorizada pelo provedor");
  const autorId = await segurancaAutonomiaStorage.autorizacao(d.providerId);
  const autor = autorId ? await storage.getUser(autorId) : null;
  if (!autor || autor.providerId !== d.providerId || autor.role !== "admin") return humano("Autorização nominal do administrador exige revisão");
  const gravada = await storage.getPoliticaDeCobranca(d.providerId);
  if (!gravada) return humano("Configure a política da carteira antes de oferecer acordos");
  const validada = validarPolitica(gravada);
  if (!validada.ok || validada.politica.pausada) return humano("Política indisponível ou pausada");
  const politica = validada.politica, agora = d.agora ?? new Date();
  const ofertas = d.ofertas ?? calcularOfertasAutonomia(d, politica, d.messageId, agora);
  if (!ofertas.ofertas.length || !ofertaAindaValida(ofertas, d, politica, agora)) return humano("A oferta expirou ou saldo, política ou cadastro mudaram; refazer com o atendente");
  if (pedidoForaDaFaixa(d.texto, ofertas)) return humano("Cliente pediu uma condição fora da faixa da política");
  if (!d.ofertas) {
    if (politica.acordo[d.carteira].origemDaCobranca === "nao_definida") return { acao: "responder", resposta: `A política permite somente o pagamento integral de ${brl(d.saldo)} pela segunda via do ERP. Posso consultar a segunda via; condições diferentes precisam do atendente.` };
    await segurancaAutonomiaStorage.ofertas(d.providerId, d.conversationId, ofertas);
    return { acao: "responder", resposta: textoDasOfertas(ofertas) };
  }
  if (ofertas.selecionada !== null && ofertas.messageId !== d.messageId && confirmacaoExplicita(d.texto)) {
    const oferta = ofertas.ofertas[ofertas.selecionada];
    const parcelas = gerarParcelas(oferta.valor, oferta.parcelas, oferta.entrada, oferta.vencimentos[0]);
    // O storage volta a conferir o saldo sob bloqueio do caso e grava aceite,
    // exigência de aprovação e todos os recebíveis na mesma transação.
    const acordo = await storage.criarNegociacao(d.providerId, {
      casoId: d.casoId, tipo: oferta.tipo === "parcelado" ? "parcelamento" : "quitacao_desconto",
      valorOriginal: d.saldo, valorNegociado: oferta.valor, entrada: oferta.entrada, descontoPct: oferta.descontoPct,
      primeiroVencimento: oferta.vencimentos[0], criadoPorUserId: autor.id, aceita: true,
      aprovacao: { exigeAprovacao: false, motivos: [], carteira: d.carteira },
    }, parcelas);
    await segurancaAutonomiaStorage.ofertas(d.providerId, d.conversationId, null);
    await storage.atualizarCasoDeCobranca(d.providerId, d.casoId, { proximaAcao: "Preparar cobrança do acordo aceito no chat", proximoContatoEm: agora, responsavelUserId: null }, autor.id);
    return { acao: "responder", precisaEmissao: true, resposta: `Acordo #${acordo.id} registrado conforme a opção confirmada. A equipe vai preparar a cobrança e orientar o pagamento. O aceite não significa pagamento recebido; a entrada e as parcelas continuam pendentes de confirmação.` };
  }
  const escolhida = escolherOfertaAutonomia(ofertas, d.texto, d.messageId, d, politica, agora);
  if (!escolhida) return humano("Opção ou data não confirmadas dentro da janela da política");
  await segurancaAutonomiaStorage.ofertas(d.providerId, d.conversationId, escolhida);
  return { acao: "responder", resposta: textoDoAceite(escolhida) };
}
