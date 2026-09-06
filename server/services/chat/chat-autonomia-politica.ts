import type { PlanoResposta, PropostaAutonomia } from "@shared/chat-autonomia";

export function confirmacaoExplicita(texto: string): boolean {
  return /^(sim|confirmo|confirmado|pode registrar|pode agendar|combinado|isso mesmo)[.!\s]*$/i.test(texto.trim());
}
/**
 * O que tira a conversa da IA e entrega ao humano. Negativar, baixar, retirar
 * (o nome do SPC/Serasa, o equipamento), órgão de defesa, advogado, desconto,
 * parcelamento, pagamento informado e contestação: NUNCA pela IA — quem decide
 * é o atendente. `negativ` sem borda final pega negativar, negativado e
 * negativação (o `\b` não fecha em `ç`/`ã`).
 */
export function exigeHumano(texto: string): boolean {
  return /\b(humano|atendente|advogado|procon|processo|falecid[oa]|fraude|golpe|desconto|parcelar|parcelamento|paguei|pago|paga|comprovante|devolvi|devolvido|retiraram|spc|serasa)\b|\bnegativ|\bbaixa\w*|\bretira(r|da)\b|n[aã]o (me |quero )?(cobre|cobrem|mande|mandem|contat|mensage)|n[aã]o (sou|conhe[cç]o|reconhe[cç]o)|n[uú]mero errado|pare de|cancelar|contesta/i.test(texto);
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
  const literal = new RegExp(`(?:^|\\D)${Number(d)}[/.-]0?${Number(mes)}(?:[/.-](?:${ano}|${ano.slice(2)}))?(?:$|\\D)`);
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
export function respostaControlada(plano: PlanoResposta, saldo: number | null, recuperacao: boolean): string {
  switch (plano.resposta) {
    case "informar_divida": return !recuperacao && saldo !== null && saldo > 0 ? `O ERP informa ${brl(saldo)} em aberto na leitura de agora. Posso consultar a segunda via ou registrar uma promessa de pagamento pelo valor integral. Para qual data você pretende pagar?` : "Vou encaminhar a conferência da situação ao atendente.";
    case "pedir_data": return recuperacao ? "Qual dia e horário você propõe para a devolução? Informe a data no formato dia/mês e o horário como 14:00." : "Para qual data você pretende pagar? Informe dia e mês, por exemplo, no formato dia/mês.";
    case "orientar_devolucao": return "Posso registrar um agendamento local de devolução para acompanhamento da equipe. Qual dia e horário você propõe?";
    case "agradecer": return "Obrigado pelo retorno. Se precisar de acompanhamento, posso encaminhar ao atendente.";
    case "pedir_confirmacao": return "Para registrar, preciso primeiro combinar a data com você. Pode informar dia e mês?";
    default: return recuperacao ? "Sou o assistente virtual e posso ajudar a combinar a devolução do equipamento. Qual dia e horário fica adequado?" : "Sou o assistente virtual. Posso consultar a segunda via, informar a pendência ou combinar uma promessa de pagamento. Como posso ajudar?";
  }
}
