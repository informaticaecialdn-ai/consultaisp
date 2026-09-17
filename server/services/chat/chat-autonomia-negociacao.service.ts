import { storage } from "../../storage";
import { segurancaAutonomiaStorage } from "../../storage/chat-autonomia-seguranca.storage";
import type { OfertasAutonomia } from "@shared/chat-autonomia-seguranca";
import type { OfertaDeAcordo } from "@shared/cobranca/acordo";
import { gerarParcelas, validarPolitica } from "@shared/cobranca/politica";
import { formatarReais } from "@shared/chat-funcionaria-textos";
import { calcularOfertasAutonomia, escolherOfertaAutonomia, ofertaAindaValida, pedeNegociacao, pedidoForaDaFaixa, type EntradaOfertaAutonomia } from "./chat-autonomia-ofertas";
import { confirmacaoDeAcordo } from "./chat-autonomia-politica";
import { exigirIdentidadeRecente } from "./chat-autonomia-identidade";

interface RodadaNegociacao extends EntradaOfertaAutonomia {
  providerId: number; conversationId: string; casoId: number; texto: string; messageId: string;
  permitir: boolean; permitirSegundaVia?: boolean; ofertas: OfertasAutonomia | null; agora?: Date;
  /**
   * A identidade foi confirmada NESTA mensagem. Com uma opção já escolhida, é a volta do novo desafio que o aceite
   * pediu (identidade de mais de 2 h): a pergunta do aceite é repetida, em vez de a conversa ir à equipe.
   */
  identidadeRecemConfirmada?: boolean;
}
/**
 * O que a rodada de negociação decidiu. Os TEXTOS com número são do servidor (as linhas das opções, a pergunta do
 * aceite); a introdução das opções e a confirmação do acordo gravado são escritas pela funcionária quando a chave D9
 * está ligada — e, sem ela ou recusadas pelo verificador, pela reserva (spec §3.3). Quem monta os balões é o serviço.
 */
export type ResultadoNegociacao =
  | { acao: "humano"; motivo: string }
  /** D10: o aceite exige identidade de no máximo 2 h. O serviço pede os dígitos de novo; a opção escolhida fica. */
  | { acao: "pedir_identidade"; motivo: string }
  /** As opções calculadas: a introdução (sem número) vem antes, e estas linhas seguem num balão próprio. */
  | { acao: "responder"; etapa: "ofertas"; linhas: string; ofertas: OfertasAutonomia }
  /** A pergunta do aceite da opção escolhida, com valor e data — texto do servidor. */
  | { acao: "responder"; etapa: "aceite"; baloes: string[] }
  /** A política só permite o valor integral: a segunda via é o caminho. */
  | { acao: "responder"; etapa: "somente_integral"; baloes: string[] }
  /** Acordo gravado: a confirmação cita exatamente a data e o valor do primeiro pagamento; a equipe prepara a cobrança. */
  | { acao: "responder"; etapa: "acordo_registrado"; gravado: { tipo: "acordo"; data: string; valorCentavos?: number }; precisaEmissao: true }
  | null;

const reais = (valor: number) => formatarReais(Math.round(valor * 100));
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Uma opção numa linha, como se escreve no WhatsApp: "entrada de R$ 64,00 + 6x de R$ 42,66, total de R$ 320,00". */
function resumoDaOferta(o: OfertaDeAcordo): string {
  if (o.tipo === "a_vista") return `${reais(o.valor)} à vista`;
  const parcelas = gerarParcelas(o.valor, o.parcelas, o.entrada, o.vencimentos[0]);
  const iguais = parcelas.every(p => p.valor === parcelas[0].valor);
  // `gerarParcelas` acerta os centavos na última: ela é dita, para a soma que a pessoa faz bater com o total.
  const emParcelas = iguais ? `${o.parcelas}x de ${reais(parcelas[0].valor)}` : `${o.parcelas} parcelas de ${reais(parcelas[0].valor)} (a última de ${reais(parcelas[parcelas.length - 1].valor)})`;
  return `${o.entrada > 0 ? `entrada de ${reais(o.entrada)} + ` : ""}${emParcelas}, total de ${reais(o.valor)}`;
}
/**
 * As linhas das opções (servidor): uma por linha, o prazo para escolher e o aviso do boleto antigo. Datas em dd/mm —
 * antes saía "2026-09-09", e a pessoa lia uma data de sistema.
 */
export function linhasDasOfertas(o: OfertasAutonomia): string {
  return [
    ...o.ofertas.map((f, i) => `Opção ${i + 1}: ${resumoDaOferta(f)}`),
    `O primeiro pagamento pode ser até ${ddmm(o.vencimentoMaximo)} (por exemplo: "opção 1 dia ${ddmm(o.vencimentoMaximo)}"). Não use um boleto antigo pra pagar valor diferente, tá?`,
  ].join("\n");
}
/** A pergunta do aceite (servidor): a opção, o valor e a data do primeiro pagamento, e o que acontece depois do "sim". */
export function perguntaDoAceite(o: OfertasAutonomia): string {
  const f = o.ofertas[o.selecionada!];
  const quando = `${f.tipo === "a_vista" ? "pagamento" : "primeiro pagamento"} pro dia ${ddmm(f.vencimentos[0])}`;
  return `Então fica a opção ${o.selecionada! + 1}: ${resumoDaOferta(f)}, com ${quando}. Posso registrar o acordo? Se estiver certo, me responde "sim". Depois do sim, a nossa equipe prepara a cobrança e te orienta por aqui.`;
}
/** O primeiro pagamento do acordo: à vista, o total; parcelado, a entrada (paga na aceitação) ou a primeira parcela. */
function primeiroPagamento(o: OfertaDeAcordo): number {
  if (o.tipo === "a_vista") return o.valor;
  if (o.entrada > 0) return o.entrada;
  return gerarParcelas(o.valor, o.parcelas, o.entrada, o.vencimentos[0])[0].valor;
}

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
    if (politica.acordo[d.carteira].origemDaCobranca === "nao_definida") return d.permitirSegundaVia === true
      ? { acao: "responder", etapa: "somente_integral", baloes: [`Pela nossa política, aqui eu consigo só o pagamento do valor total, de ${reais(d.saldo)}, pela segunda via. Se quiser, te mando a segunda via por aqui; outra condição precisa da nossa equipe.`] }
      : humano("Condições diferentes exigem atendente e a segunda via automática não está autorizada");
    await segurancaAutonomiaStorage.ofertas(d.providerId, d.conversationId, ofertas);
    return { acao: "responder", etapa: "ofertas", linhas: linhasDasOfertas(ofertas), ofertas };
  }
  if (ofertas.selecionada !== null && ofertas.messageId !== d.messageId && confirmacaoDeAcordo(d.texto)) {
    // D10: o aceite vira base de cobrança e de confissão de dívida, então a identidade tem que ter no máximo
    // 2 h — a do episódio chega a 24 h e o aparelho pode ter mudado de mão. Lida AGORA, depois da rodada que a
    // renovou. Mais velha que isso, os dígitos são pedidos de novo e a opção escolhida continua valendo.
    const seguranca = await segurancaAutonomiaStorage.ler(d.providerId, d.conversationId);
    const identidade = seguranca?.identidade ?? null;
    if (!identidade || identidade.providerId !== d.providerId || identidade.customerId !== d.customerId) {
      return humano("Aceite de acordo sem identidade confirmada deste cliente; conferir com o atendente");
    }
    if (!exigirIdentidadeRecente(identidade, agora)) return { acao: "pedir_identidade", motivo: "Aceite de acordo exige identidade confirmada nas últimas 2 horas" };
    const oferta = ofertas.ofertas[ofertas.selecionada];
    const parcelas = gerarParcelas(oferta.valor, oferta.parcelas, oferta.entrada, oferta.vencimentos[0]);
    // O storage volta a conferir o saldo sob bloqueio do caso e grava aceite,
    // exigência de aprovação e todos os recebíveis na mesma transação.
    await storage.criarNegociacao(d.providerId, {
      casoId: d.casoId, tipo: oferta.tipo === "parcelado" ? "parcelamento" : "quitacao_desconto",
      valorOriginal: d.saldo, valorNegociado: oferta.valor, entrada: oferta.entrada, descontoPct: oferta.descontoPct,
      primeiroVencimento: oferta.vencimentos[0], criadoPorUserId: autor.id, aceita: true,
      aprovacao: { exigeAprovacao: false, motivos: [], carteira: d.carteira },
    }, parcelas);
    await segurancaAutonomiaStorage.ofertas(d.providerId, d.conversationId, null);
    await storage.atualizarCasoDeCobranca(d.providerId, d.casoId, { proximaAcao: "Preparar cobrança do acordo aceito no chat", proximoContatoEm: agora, responsavelUserId: null }, autor.id);
    return { acao: "responder", etapa: "acordo_registrado", precisaEmissao: true, gravado: { tipo: "acordo", data: oferta.vencimentos[0], valorCentavos: Math.round(primeiroPagamento(oferta) * 100) } };
  }
  const escolhida = escolherOfertaAutonomia(ofertas, d.texto, d.messageId, d, politica, agora);
  if (!escolhida) {
    // A volta do novo desafio ("8909"): a opção escolhida continua — repete a pergunta do aceite.
    if (d.identidadeRecemConfirmada === true && ofertas.selecionada !== null) return { acao: "responder", etapa: "aceite", baloes: [perguntaDoAceite(ofertas)] };
    return humano("Opção ou data não confirmadas dentro da janela da política");
  }
  await segurancaAutonomiaStorage.ofertas(d.providerId, d.conversationId, escolhida);
  return { acao: "responder", etapa: "aceite", baloes: [perguntaDoAceite(escolhida)] };
}
