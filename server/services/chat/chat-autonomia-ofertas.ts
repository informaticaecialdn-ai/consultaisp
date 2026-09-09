import { createHash } from "crypto";
import { avaliarPedidoDeAcordo, ofertasDaPolitica, type OfertaDeAcordo } from "@shared/cobranca/acordo";
import { brl, gerarParcelas, validarNegociacao, type Politica } from "@shared/cobranca/politica";
import type { Carteira } from "@shared/cobranca/estados";
import type { OfertasAutonomia } from "@shared/chat-autonomia-seguranca";
import { dataLocal } from "./chat-autonomia-politica";

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
  if (!Number.isFinite(idade) || idade < 0 || idade >= 30 * 60_000 || o.customerId !== entrada.customerId || o.carteira !== entrada.carteira || Math.round(o.saldo * 100) !== Math.round(entrada.saldo * 100) || o.politicaHash !== hashPolitica(politica) || politica.pausada) return false;
  if (o.selecionada === null) return true;
  const selecionada = o.ofertas[o.selecionada];
  if (!selecionada || selecionada.vencimentos[0] < dataLocal(agora) || selecionada.vencimentos[0] > o.vencimentoMaximo) return false;
  const recalculadas = calcularOfertasAutonomia(entrada, politica, o.messageId, agora, selecionada.vencimentos[0]);
  return recalculadas.ofertas.some(nova => JSON.stringify(nova) === JSON.stringify(selecionada));
}
export function escolherOfertaAutonomia(o: OfertasAutonomia, texto: string, messageId: string, entrada: EntradaOfertaAutonomia, politica: Politica, agora = new Date()): OfertasAutonomia | null {
  if (messageId === o.messageId || !ofertaAindaValida(o, entrada, politica, agora)) return null;
  const escolha = /^(?:op[cç][aã]o\s*)?(\d+)\s+(?:para|dia|em)\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?[.!\s]*$/i.exec(texto.trim());
  if (!escolha) return null;
  const selecionada = Number(escolha[1]) - 1;
  if (!o.ofertas[selecionada]) return null;
  const hoje = dataLocal(agora);
  const dia = `${escolha[4] ?? hoje.slice(0, 4)}-${escolha[3].padStart(2, "0")}-${escolha[2].padStart(2, "0")}`;
  const data = new Date(`${dia}T12:00:00Z`);
  if (!Number.isFinite(data.getTime()) || data.toISOString().slice(0, 10) !== dia || dia < hoje || dia > o.vencimentoMaximo) return null;
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
