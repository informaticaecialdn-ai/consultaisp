import type { PlanoResposta, PropostaAutonomia } from "@shared/chat-autonomia";
import type { Carteira } from "@shared/cobranca/estados";

export function confirmacaoExplicita(texto: string): boolean {
  return /^(sim|confirmo|confirmado|pode registrar|pode agendar|combinado|isso mesmo)[.!\s]*$/i.test(texto.trim());
}
/**
 * O que tira a conversa da IA e entrega ao humano. Negativar, baixar, retirar
 * o nome do SPC/Serasa, órgão de defesa, advogado, desconto,
 * parcelamento, pagamento informado e contestação: NUNCA pela IA — quem decide
 * é o atendente. `negativ` sem borda final pega negativar, negativado e
 * negativação (o `\b` não fecha em `ç`/`ã`).
 */
export function exigeHumano(texto: string, permitirNegociacao = false): boolean {
  if (permitirNegociacao) texto = texto.replace(/\b(desconto|parcelar|parcelamento)\b/gi, "");
  return /\b(humano|atendente|advogado|procon|processo|falecid[oa]|fraude|golpe|desconto|parcelar|parcelamento|paguei|pago|paga|comprovante|devolvi|devolvido|retiraram|spc|serasa)\b|\bnegativ|\bbaixa\w*|\bretira(r|da)\b.{0,30}\bnome\b|\bj[aá]\b.{0,20}\bretirad[oa]\b|n[aã]o (me |quero )?(cobre|cobrem|mande|mandem|contat|mensage)|n[aã]o (sou|conhe[cç]o|reconhe[cç]o)|n[uú]mero errado|pare de|cancelar|contesta/i.test(texto);
}
export function dataLocal(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}
/**
 * `saldo` é `null` quando NINGUÉM leu o valor agora no ERP (cliente que pagou
 * tudo devolve zero fatura, e a ficha cai para a varredura das 03:00). Null não
 * é zero e não é o saldo antigo: sem leitura ao vivo não existe proposta.
 */
export function validarProposta(plano: PlanoResposta, mensagem: string, saldo: number | null, messageId: string, agora = new Date()): PropostaAutonomia | null {
  if (!["promessa", "agendar"].includes(plano.acao) || !plano.data) return null;
  const dia = plano.data.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const data = new Date(`${dia}T12:00:00-03:00`);
  if (!Number.isFinite(data.getTime()) || data.toISOString().slice(0, 10) !== dia || dia < dataLocal(agora) || data.getTime() > agora.getTime() + 90 * 86400000) return null;
  const [ano, mes, d] = dia.split("-");
  const literal = new RegExp(`(?:^|\\D)0?${Number(d)}[/.-]0?${Number(mes)}(?:[/.-](?:${ano}|${ano.slice(2)}))?(?:$|\\D)`);
  const amanha = dataLocal(new Date(agora.getTime() + 86400000));
  const citada = mensagem.includes(dia) || literal.test(mensagem) || (dia === dataLocal(agora) && /\bhoje\b/i.test(mensagem)) || (dia === amanha && /amanh[aã]/i.test(mensagem));
  if (!citada) return null;
  if (plano.acao === "promessa") {
    if (saldo === null || !Number.isFinite(saldo) || saldo <= 0 || (plano.valor !== undefined && Math.round(plano.valor * 100) !== Math.round(saldo * 100))) return null;
    return { acao: "promessa", data: dia, valor: saldo, criadaEm: agora.toISOString(), messageId };
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-03:00$/.test(plano.data)) return null;
  const horario = plano.data.slice(11, 16);
  if (!mensagem.includes(horario) || new Date(plano.data).getTime() <= agora.getTime()) return null;
  return { acao: "agendar", data: plano.data, criadaEm: agora.toISOString(), messageId };
}
export function propostaConfirmada(proposta: PropostaAutonomia | null, texto: string, messageId: string, agora = new Date()): proposta is PropostaAutonomia {
  return !!proposta && proposta.messageId !== messageId && agora.getTime() - new Date(proposta.criadaEm).getTime() < 30 * 60_000 && confirmacaoExplicita(texto);
}
const brl = (valor: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
export function textoDaProposta(p: PropostaAutonomia): string {
  return p.acao === "promessa"
    ? `Você confirma a promessa de pagamento de ${brl(p.valor!)} para ${p.data}? Responda “sim” para registrar. A baixa depende da confirmação do pagamento no ERP.`
    : `Você confirma o agendamento local da devolução para ${p.data.slice(0, 10)} às ${p.data.slice(11, 16)} (horário de Brasília)? Responda “sim” para registrar. A equipe acompanha o agendamento; o equipamento só será baixado após conferência.`;
}
/**
 * O LLM escolhe a intenção; fatos, links e compromissos são escritos pelo servidor.
 *
 * `saldo` só chega aqui quando foi lido AGORA no ERP; `null` significa que
 * ninguém mediu nesta rodada. Nenhum ramo desta função inventa número a partir
 * de null — sem leitura, a frase não cita valor e a conferência vai ao atendente.
 */
export interface ContextoDaResposta {
  tom?: string | null;
  vulneravel?: boolean;
  carteira?: Carteira | null;
  permitirPromessa?: boolean;
  permitirSegundaVia?: boolean;
  permitirAgendamento?: boolean;
}
export function respostaControlada(plano: PlanoResposta, saldo: number | null, recuperacao: boolean, orientacao: ContextoDaResposta = {}): string {
  const aberturas: Record<string, string> = {
    boas_vindas: "Vou orientar você. ", parceiro: "Vamos conferir juntos. ", acolhedor: "Obrigado pela parceria. ",
    orientador: "Vamos organizar os próximos passos. ", firme_gentil: "Podemos organizar a regularização. ", cuidado: "Vamos conversar com tranquilidade. ",
    firme_objetivo: "Vamos conferir a situação e definir o próximo passo. ", recuperacao: "Vamos avaliar uma solução. ", negociar_reter: "Queremos encontrar uma solução que preserve nossa relação. ",
    humanizado_vulneravel: "Vamos conversar com tranquilidade e respeitar suas possibilidades. ",
    ex_esclarecedor: "Posso esclarecer a pendência do contrato encerrado. ", ex_respeitoso: "Vamos conferir a pendência com atenção. ",
    ex_acolhedor: "Vamos buscar uma solução para a pendência que ficou. ", ex_orientador: "Vamos organizar os próximos passos para regularizar a dívida. ",
    ex_firme_gentil: "Podemos organizar a regularização da dívida. ", ex_cuidado: "Vamos conversar com tranquilidade sobre a pendência. ",
    ex_objetivo: "Vamos conferir a dívida e o próximo passo. ", ex_assertivo: "Vamos avaliar uma solução para a dívida. ",
    ex_conciliador: "Vamos buscar uma solução para encerrar a pendência. ",
  };
  const tom = orientacao.tom ?? "";
  const tomCompativel = !recuperacao && tom.startsWith("ex_") === (orientacao.carteira === "ex_cliente") ? tom : "";
  const abertura = aberturas[orientacao.vulneravel ? "humanizado_vulneravel" : tomCompativel] ?? "";
  return abertura + respostaFactual(plano, saldo, recuperacao, orientacao);
}
function respostaFactual(plano: PlanoResposta, saldo: number | null, recuperacao: boolean, permissoes: ContextoDaResposta): string {
  const pedirData = recuperacao
    ? permissoes.permitirAgendamento === true
      ? "Qual dia e horário você propõe para a devolução? Informe a data no formato dia/mês e o horário como 14:00."
      : "A equipe pode orientar a devolução do equipamento. Posso encaminhar ao atendente?"
    : permissoes.permitirPromessa === true
      ? "Para qual data você pretende pagar? Informe dia e mês, por exemplo, no formato dia/mês."
      : "Posso esclarecer a pendência ou encaminhar ao atendente para avaliar sua solicitação.";
  const opcoes = [
    permissoes.permitirSegundaVia === true ? "consultar a segunda via do ERP" : null,
    permissoes.permitirPromessa === true ? "registrar uma promessa de pagamento pelo valor integral, após sua confirmação" : null,
  ].filter(Boolean);
  const ajuda = opcoes.length ? `Posso ${opcoes.join(" ou ")}. Como você prefere seguir?` : "Posso esclarecer a pendência ou encaminhar ao atendente.";
  switch (plano.resposta) {
    case "informar_divida": return !recuperacao && saldo !== null && Number.isFinite(saldo) && saldo > 0 ? `O ERP informa ${brl(saldo)} em aberto na leitura de agora, referente ao contrato ${permissoes.carteira === "ex_cliente" ? "encerrado" : "vigente"}. ${ajuda}` : "Vou encaminhar a conferência da situação ao atendente.";
    case "pedir_data": return pedirData;
    case "orientar_devolucao": return recuperacao ? pedirData : "A equipe de equipamentos pode orientar a devolução. Posso encaminhar ao atendente?";
    case "agradecer": return "Obrigado pelo retorno. Se precisar de acompanhamento, posso encaminhar ao atendente.";
    case "pedir_confirmacao": return pedirData;
    default: return recuperacao ? pedirData : `Sou o assistente virtual. ${ajuda}`;
  }
}
