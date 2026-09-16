import { DIRETIVA_POR_TOM, QUADRANTES, TONS, TOM_VULNERAVEL, type Quadrante, type Tom } from "./dna";
import { etapaParaAtraso, type Etapa } from "./regua";
import { textoDeAberturaControlada } from "../chat-templates";

/** Sugestão operacional. O DNA nunca altera a janela temporal ou autoriza envio. */
export function orientarContato(d: {
  diasAtraso: number;
  tom?: string | null;
  quadrante?: string | null;
  carteira?: string;
  status?: string;
  propensao?: number | null;
  etapas?: readonly Etapa[];
  modoAtendimento?: "primeira_resposta_humana" | "autonomo";
}) {
  const carteira = d.carteira === undefined || d.carteira === "ativo" ? "ativo" : d.carteira === "ex_cliente" ? "ex_cliente" : null;
  const vulneravel = d.tom === TOM_VULNERAVEL;
  const tomValido = TONS.includes(d.tom as Tom) ? (d.tom as Tom) : null;
  // Casos antigos guardavam o tom de ATIVOS também para ex-clientes. Não
  // convertemos esse registro em prova de histórico de uma relação encerrada.
  const tom = vulneravel ? TOM_VULNERAVEL : tomValido && carteira && tomValido.startsWith("ex_") === (carteira === "ex_cliente") ? tomValido : null;
  const regua = etapaParaAtraso(
    d.diasAtraso,
    carteira ?? "ativo",
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
    pre_negativacao: carteira === "ex_cliente" ? "Conciliação de pendências" : "Revisão humana",
    divida_antiga: "Recuperação de crédito",
    fim_de_linha: carteira === "ex_cliente" ? "Recuperação prolongada" : "Revisão humana",
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
    carteira,
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
    quadrante: tom && QUADRANTES.includes(d.quadrante as Quadrante) ? d.quadrante : null,
    diretiva: tom
      ? DIRETIVA_POR_TOM[tom]
      : carteira === "ex_cliente"
        ? "Seja cordial. Após confirmação de identidade, esclareça somente a dívida conferida do contrato encerrado e as alternativas autorizadas de regularização. Histórico da relação indisponível: não presuma fidelidade nem comportamento de pagamento."
        : "Seja cordial e confirme com quem está falando antes de apresentar dados do contrato vigente. Regularize a pendência sem presumir histórico de pagamento.",
    propensao,
    proximoPasso: pausado
      ? "Revise o acordo ou o encerramento antes de contatar."
      : vulneravel
        ? "Atendente avalia o contexto e inicia um contato acolhedor."
        : d.modoAtendimento === "primeira_resposta_humana"
          ? "Inicie com uma abertura neutra; após a resposta, encaminhe ao atendimento humano."
          : d.modoAtendimento === "autonomo"
            ? "Inicie com uma abertura neutra; após identificação, o assistente autônomo segue a política e transfere exceções ao humano."
            : "Inicie com uma abertura neutra; após a resposta, siga o modo de atendimento configurado para esta carteira.",
    automatizavel:
      carteira !== null &&
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
  return textoDeAberturaControlada({ nomeCliente: d.nome, nomeProvedor: d.provedor });
}
