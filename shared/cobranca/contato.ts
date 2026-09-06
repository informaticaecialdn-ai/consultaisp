import { DIRETIVA_POR_TOM, TONS, TOM_VULNERAVEL, type Tom } from "./dna";
import { etapaParaAtraso, type Etapa } from "./regua";

/** Sugestão operacional. O DNA nunca altera a janela temporal ou autoriza envio. */
export function orientarContato(d: {
  diasAtraso: number;
  tom?: string | null;
  quadrante?: string | null;
  carteira?: string;
  status?: string;
  propensao?: number | null;
  etapas?: readonly Etapa[];
}) {
  const vulneravel = d.tom === TOM_VULNERAVEL;
  const tom = TONS.includes(d.tom as Tom) ? (d.tom as Tom) : null;
  const regua = etapaParaAtraso(
    d.diasAtraso,
    d.carteira === "ex_cliente" ? "ex_cliente" : "ativo",
    d.etapas,
  );
  const propensao =
    typeof d.propensao === "number" &&
    Number.isFinite(d.propensao) &&
    d.propensao >= 0 &&
    d.propensao <= 100
      ? d.propensao
      : null;
  const agentes: Record<string, string> = {
    lembrete_pre_vencimento: "Pré-aviso",
    lembrete_atraso: "Lembrete",
    aviso_suspensao: "Regularização",
    negociacao_recuperacao: "Negociação assistida",
    pre_negativacao: "Revisão humana",
    divida_antiga: "Recuperação de crédito",
    fim_de_linha: "Revisão humana",
  };
  const agenteDaEtapa = regua.etapa ? agentes[regua.etapa.id] ?? "Revisão humana" : "Revisão humana";
  const agente = vulneravel
    ? "Acolhimento humano"
    : agenteDaEtapa === "Revisão humana"
      ? agenteDaEtapa
    : propensao !== null && propensao < 30
      ? "Negociação assistida"
      : agenteDaEtapa;
  const pausado = [
    "encerrado",
    "cancelamento",
    "pago",
    "baixado",
    "negativado",
    "acordo_ativo",
    "negociando",
  ].includes(d.status ?? "");
  return {
    agente,
    etapa: regua.etapa
      ? {
          id: regua.etapa.id,
          rotulo: regua.etapa.rotulo,
          acao: regua.etapa.acao,
          diaMin: regua.etapa.diaMin,
          diaMax: regua.etapa.diaMax,
        }
      : null,
    motivoSemEtapa: regua.motivo,
    tom: tom ?? "cordial",
    quadrante: d.quadrante ?? null,
    diretiva: tom
      ? DIRETIVA_POR_TOM[tom]
      : "Seja cordial e confirme com quem está falando antes de apresentar dados do contrato.",
    propensao,
    proximoPasso: pausado
      ? "Revise o acordo ou o encerramento antes de contatar."
      : vulneravel
        ? "Atendente avalia o contexto e inicia um contato acolhedor."
        : "Revise a mensagem inicial. Quando o cliente responder, assuma o atendimento.",
    automatizavel:
      !pausado &&
      !vulneravel &&
      regua.etapa !== null &&
      agente !== "Revisão humana",
  };
}

export function textoDePrimeiroContato(d: {
  nome: string;
  provedor: string;
  origem: "cobranca" | "equipamentos";
  tom?: string | null;
}) {
  const nome = d.nome.trim().split(/\s+/)[0] || "tudo bem";
  const abertura = `Olá, ${nome}. Sou o assistente virtual da ${d.provedor}.`;
  if (d.origem === "equipamentos")
    return `${abertura} Podemos conversar sobre a devolução do equipamento do contrato? Sua resposta será encaminhada à nossa equipe para combinar a retirada.`;
  const aberturas: Record<string, string> = {
    boas_vindas:
      "Podemos orientar você sobre o atendimento financeiro do seu contrato?",
    parceiro:
      "Podemos verificar juntos se você precisa de ajuda com seu atendimento financeiro?",
    acolhedor:
      "Obrigado pela parceria. Podemos ajudar com seu atendimento financeiro?",
    orientador:
      "Podemos explicar os próximos passos do seu atendimento financeiro?",
    firme_gentil:
      "Podemos conversar e organizar os próximos passos do seu atendimento financeiro?",
    cuidado: "Queremos ouvir você e encontrar uma forma tranquila de ajudar.",
    firme_objetivo:
      "Precisamos conversar sobre seu atendimento financeiro. Podemos verificar a situação juntos?",
    recuperacao:
      "Podemos conversar sobre as alternativas para resolver seu atendimento financeiro?",
    negociar_reter:
      "Valorizamos nossa relação e queremos encontrar uma solução para você. Podemos conversar?",
    humanizado_vulneravel:
      "Queremos ouvir você e encontrar uma forma tranquila de ajudar.",
  };
  const ajuda =
    aberturas[d.tom ?? ""] ??
    "Podemos conversar sobre seu atendimento financeiro?";
  return `${abertura} ${ajuda} Confirma que posso falar com você por aqui? Um atendente continuará a conversa após sua resposta.`;
}
