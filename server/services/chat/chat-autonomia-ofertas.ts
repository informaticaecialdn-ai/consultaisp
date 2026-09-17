import { createHash } from "crypto";
import { avaliarPedidoDeAcordo, ofertasDaPolitica, type OfertaDeAcordo } from "@shared/cobranca/acordo";
import { brl, gerarParcelas, validarNegociacao, type Politica } from "@shared/cobranca/politica";
import type { Carteira } from "@shared/cobranca/estados";
import type { OfertasAutonomia } from "@shared/chat-autonomia-seguranca";
import { normalizarMensagemDoCliente, resolverDatasDaMensagem } from "@shared/chat-funcionaria-triagem";
import { dataLocal, VALIDADE_DA_PROPOSTA_MS } from "./chat-autonomia-politica";

export interface EntradaOfertaAutonomia { customerId: number; carteira: Carteira; saldo: number; diasAtraso: number; mensalidade: number | null; vulneravel: boolean }
const hashPolitica = (politica: Politica) => createHash("sha256").update(JSON.stringify({ acordo: politica.acordo, negociacao: politica.negociacao, pausada: politica.pausada })).digest("hex");
export const pedeNegociacao = (texto: string) => /\b(desconto|parcela(?:r|mento|do|s)?|negociar|negocia[cç][aã]o|acordo|op[cç][oõ]es)\b/i.test(texto);
function dentro(o: OfertaDeAcordo, entrada: EntradaOfertaAutonomia, politica: Politica) {
  const pedido = { tipo: o.tipo === "parcelado" ? "parcelamento" as const : "quitacao_desconto" as const, valorOriginal: entrada.saldo, valorNegociado: o.valor, entrada: o.entrada, parcelas: o.parcelas };
  return validarNegociacao(politica, pedido, { valorMensalidade: entrada.mensalidade, vulneravel: entrada.vulneravel }).ok
    && avaliarPedidoDeAcordo({ ...pedido, carteira: entrada.carteira, diasAtraso: entrada.diasAtraso }, politica).decisao === "dentro";
}
export function calcularOfertasAutonomia(entrada: EntradaOfertaAutonomia, politica: Politica, messageId: string, agora = new Date(), primeiroVencimento?: string): OfertasAutonomia {
  const resultado = ofertasDaPolitica({ ...entrada, hoje: dataLocal(agora), primeiroVencimento }, politica);
  return { customerId: entrada.customerId, carteira: entrada.carteira, saldo: entrada.saldo, criadaEm: agora.toISOString(), messageId,
    ofertas: politica.pausada ? [] : resultado.ofertas.filter(o => Number.isFinite(o.valor) && dentro(o, entrada, politica)), selecionada: null,
    vencimentoMaximo: resultado.vencimentoMaximo, politicaHash: hashPolitica(politica) };
}
export function ofertaAindaValida(o: OfertasAutonomia, entrada: EntradaOfertaAutonomia, politica: Politica, agora = new Date()): boolean {
  const idade = agora.getTime() - Date.parse(o.criadaEm);
  // As ofertas seguem o episódio (6 h, f4), como a proposta: o saldo, a política e a data são relidos aqui.
  if (!Number.isFinite(idade) || idade < 0 || idade >= VALIDADE_DA_PROPOSTA_MS || o.customerId !== entrada.customerId || o.carteira !== entrada.carteira || Math.round(o.saldo * 100) !== Math.round(entrada.saldo * 100) || o.politicaHash !== hashPolitica(politica) || politica.pausada) return false;
  if (o.selecionada === null) return true;
  const selecionada = o.ofertas[o.selecionada];
  if (!selecionada || selecionada.vencimentos[0] < dataLocal(agora) || selecionada.vencimentos[0] > o.vencimentoMaximo) return false;
  const recalculadas = calcularOfertasAutonomia(entrada, politica, o.messageId, agora, selecionada.vencimentos[0]);
  return recalculadas.ofertas.some(nova => JSON.stringify(nova) === JSON.stringify(selecionada));
}
const ORDINAIS: Record<string, number> = { primeira: 1, segunda: 2, terceira: 3, quarta: 4, quinta: 5, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5 };
/**
 * A opção e a data que o CLIENTE escreveu, do jeito que se escreve (spec §3.3): "quero a opção 1 dia 10/09",
 * "a 2, dia 15", "opção 2 para sexta", "fico com a segunda opção dia 20". Exige UMA opção e UMA data; "opção
 * 1 ou 2", pergunta, "não" e "mas" não escolhem nada — na dúvida, a escolha fica sem efeito e a conversa vai
 * à equipe, nunca se escolhe pelo cliente. Exportada para teste.
 */
export function lerEscolhaDeOferta(texto: string, hoje: string): { opcao: number; data: string } | null {
  let t = normalizarMensagemDoCliente(texto).replace(/\n/g, " ");
  // "opção 1 e 2": duas opções ligadas por "e" não escolhem nenhuma
  if (!t || t.length > 160 || /[?]/.test(t) || /[0-9] e (?:a |o |opcao )?[0-9]/.test(t) || /(?<![a-z])(?:nao|nem|mas|porem|ou|talvez|sera)(?![a-z])/.test(t)) return null;
  const opcoes = new Set<number>();
  const achar = (re: RegExp, valor: (m: RegExpExecArray) => number) => {
    for (let m = re.exec(t); m; m = re.exec(t)) { opcoes.add(valor(m)); t = t.slice(0, m.index) + " ".repeat(m[0].length) + t.slice(m.index + m[0].length); re.lastIndex = m.index + m[0].length; }
  };
  achar(/(?<![a-z])op[cç]?(?:ao|oes)?(?: (?:numero|n[o.]?))? ?(\d{1,2})(?![0-9/.:-])/g, m => Number(m[1]));
  achar(/(?<![a-z])op[cç]?ao (um|uma|dois|duas|tres|quatro|cinco)(?![a-z])/g, m => ORDINAIS[m[1]]);
  achar(/(?<![a-z])(primeira|segunda|terceira|quarta|quinta) op[cç]?ao(?![a-z])/g, m => ORDINAIS[m[1]]);
  achar(/(?<![a-z])(?:a|na|pela|com a|quero a|fico com a|escolho a|prefiro a) (\d{1,2})(?![0-9/.:-]|[a-z]| (?:de |do )?(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|dias|horas?|h)(?![a-z]))/g, m => Number(m[1]));
  achar(/^ *(\d{1,2})(?![0-9/.:-])(?= *(?:[,;]|para|pra|dia|em|no|na|$))/g, m => Number(m[1]));
  if (opcoes.size !== 1) return null;
  const { datas } = resolverDatasDaMensagem(t, hoje);
  if (datas.length !== 1) return null;
  return { opcao: [...opcoes][0], data: datas[0] };
}
export function escolherOfertaAutonomia(o: OfertasAutonomia, texto: string, messageId: string, entrada: EntradaOfertaAutonomia, politica: Politica, agora = new Date()): OfertasAutonomia | null {
  if (messageId === o.messageId || !ofertaAindaValida(o, entrada, politica, agora)) return null;
  const hoje = dataLocal(agora);
  const escolha = lerEscolhaDeOferta(texto, hoje);
  if (!escolha) return null;
  const selecionada = escolha.opcao - 1;
  if (!o.ofertas[selecionada]) return null;
  const dia = escolha.data;
  if (dia < hoje || dia > o.vencimentoMaximo) return null;
  const novas = calcularOfertasAutonomia(entrada, politica, messageId, agora, dia);
  if (!novas.ofertas[selecionada]) return null;
  return { ...novas, selecionada };
}
export function pedidoForaDaFaixa(texto: string, ofertas: OfertasAutonomia) {
  const percentual = /(\d+(?:[.,]\d+)?)\s*%/.exec(texto);
  const parcelas = /(?:em\s+)?(\d+)\s*(?:x\b|vezes\b|parcelas\b)/i.exec(texto);
  return (percentual !== null && Number(percentual[1].replace(",", ".")) > Math.max(0, ...ofertas.ofertas.map(o => o.descontoPct))) || (parcelas !== null && Number(parcelas[1]) > Math.max(1, ...ofertas.ofertas.map(o => o.parcelas)));
}
function detalhes(o: OfertaDeAcordo): string {
  const parcelas = gerarParcelas(o.valor, o.parcelas, o.entrada, o.vencimentos[0]);
  return o.tipo === "a_vista" ? `${brl(o.valor)} à vista` : `total de ${brl(o.valor)}, entrada de ${brl(o.entrada)} em ${o.vencimentos[0]} e ${o.parcelas} parcelas: ${parcelas.map(p => `${brl(p.valor)} em ${p.vencimento}`).join("; ")}`;
}
export function textoDasOfertas(o: OfertasAutonomia): string {
  return `Estas são as opções autorizadas pela política: ${o.ofertas.map((f, i) => `Opção ${i + 1}: ${detalhes(f)}.`).join(" ")} Escolha a opção e a data do primeiro vencimento até ${o.vencimentoMaximo}, por exemplo “opção 1 para dia/mês”. A cobrança será preparada pela equipe após o aceite; não utilize um boleto antigo para pagar valor diferente.`;
}
export function textoDoAceite(o: OfertasAutonomia): string {
  const f = o.ofertas[o.selecionada!];
  return `Confirma ${detalhes(f)}, com ${f.tipo === "a_vista" ? "vencimento" : "primeiro vencimento"} em ${f.vencimentos[0]}? Responda “sim” para registrar o acordo. O aceite não confirma pagamento; a equipe preparará a cobrança.`;
}
