/**
 * A MONTAGEM da ficha 360 — o que o `apps/api/src/routes/cliente360.ts` do
 * Provedor.ai faz depois das queries, como função pura.
 *
 * Recebe números e datas já lidos (do banco, e depois do ERP ao vivo) e
 * devolve os blocos calculados: situação real, anos de casa, selo de
 * pagamento, os três scores, prescrição, Economia R24 e o resumo executivo.
 *
 * É pura de propósito: o servidor a chama com o que `customers` guarda; o
 * navegador a chama de novo quando o snapshot ao vivo traz o plano e a data
 * de contrato que o sync não tinha — e a ficha inteira se recompõe com o
 * mesmo código, sem uma segunda versão das fórmulas. O gate da Economia é
 * o do Provedor.ai: ARPU real (preço do plano cadastrado) e mês atual
 * conhecido; senão `null`, e a tela mostra PENDENTE com o motivo.
 */
import { custosInformados, type Economia } from "./politica";
import { computeEconomiaLedger, mesesEntre, precoDoPlano, type EconomiaLedger } from "./economia";
import {
  anosDeCliente, classificarSeloPagamento, computeHealthScore, computePropensao, deriveFinancialScore, deriveRelationshipScore,
  deriveTechnicalScore, prescricaoPorAtraso, resumoExecutivo, situacaoRealDe,
  type HealthBand, type Prescricao360, type Propensao, type SeloPagamento,
} from "./cliente360";

export interface EntradaDaFicha360 {
  hoje: Date;
  statusErp: string | null;
  carteira: string | null;
  contractStartDate: string | Date | null;
  /** Quando o contrato acabou — o "fim realizado" do ex-cliente. */
  cortadoEm: string | Date | null;
  plano: string | null;
  ispScore: number | null;
  riskTier: string | null;
  dividaAtual: number;
  diasAtraso: number;
  faturasAbertas: number | null;
  equipamentos: { ativos: number; extraviados: number };
  /** Contatos feitos pelo funcionário e respostas do cliente nos últimos 90 dias. */
  contatos90d: number;
  respostas90d: number;
  comunicacoes30d: number;
  totalComunicacoes: number;
  economia: Economia | null;
  /**
   * A mensalidade LIDA das faturas do ERP deste cliente — a segunda fonte de
   * ARPU, e na prática a que funciona (06/09/2026).
   *
   * A primeira é o preço por plano cadastrado na política, e ela depende de
   * duas coisas que hoje não existem: o nome do plano no banco (`customers`
   * não o guarda) e alguém ter digitado o preço daquele nome. Enquanto isso,
   * o valor que o provedor de fato cobra deste assinante está gravado nas
   * faturas desde a migração 0027.
   *
   * O preço cadastrado VENCE esta leitura: configuração explícita do admin
   * ganha de valor observado. Ausente aqui = o cliente não tem fatura do ERP.
   */
  mensalidadeObservada?: { valor: number; concordam: number; faturas: number } | null;
  /** Histórico de pagamento sincronizado, quando existir (fase 2). */
  historicoPagamento: { pagas: number; recebido: number; pct_em_dia: number } | null;
}

export interface ScoresDaFicha {
  health: number;
  health_band: HealthBand;
  health_detalhe: { financeiro: number; tecnico: number; relacionamento: number; tecnicoNeutro: boolean; relacionamentoNeutro: boolean };
  credito: number | null;
  credito_band: string | null;
  propensao: number | null;
  propensao_em_dia: boolean;
  propensao_detalhe: Propensao | null;
}

export interface Ficha360 {
  situacaoReal: "ativo" | "suspenso" | "ex-cliente" | null;
  anosCliente: number | null;
  mesesCliente: number | null;
  valorMensal: number | null;
  selo: SeloPagamento | null;
  scores: ScoresDaFicha;
  prescricao: Prescricao360 | null;
  economia: EconomiaLedger | null;
  /** Por que a Economia não saiu — o `motivo` do <Pendente> do Provedor.ai. */
  economiaPendente: string | null;
  /**
   * De onde saiu `valorMensal`. A tela precisa dizer isso: um número lido das
   * faturas e um número que o admin cadastrou merecem crédito diferente.
   * `null` quando não há mensalidade nenhuma.
   */
  origemDoValorMensal: "plano_cadastrado" | "faturas_do_erp" | null;
  resumo: string | null;
}

const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function dataOuNull(v: string | Date | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function montarFicha360(e: EntradaDaFicha360): Ficha360 {
  const situacaoReal = situacaoRealDe(e.statusErp, e.carteira);
  const cicloVivo = situacaoReal === "ativo" || situacaoReal === "suspenso";
  const fim = cicloVivo ? e.hoje : (dataOuNull(e.cortadoEm) ?? e.hoje);
  const mesesCliente = mesesEntre(e.contractStartDate, fim);
  const anosCliente = anosDeCliente(e.contractStartDate, fim);
  // Preço cadastrado primeiro (o admin mandou), mensalidade observada depois.
  const precoCadastrado = precoDoPlano(e.economia?.precoPorPlano, e.plano);
  const observada = e.mensalidadeObservada && e.mensalidadeObservada.valor > 0 ? e.mensalidadeObservada.valor : null;
  const valorMensal = precoCadastrado ?? observada;
  const origemDoValorMensal: Ficha360["origemDoValorMensal"] =
    precoCadastrado !== null ? "plano_cadastrado" : observada !== null ? "faturas_do_erp" : null;
  const faturasAbertas = e.faturasAbertas ?? (e.dividaAtual > 0 ? 1 : 0);

  const selo = classificarSeloPagamento({
    emAberto: e.dividaAtual,
    atraso: e.diasAtraso,
    pagas: e.historicoPagamento?.pagas ?? 0,
    pctEmDia: e.historicoPagamento?.pct_em_dia ?? null,
    mesesCliente,
  });

  const financeiro = deriveFinancialScore({ faturasEmAberto: faturasAbertas, valorEmAberto: e.dividaAtual, valorMensal: valorMensal ?? 0, diasAtrasoMax: e.diasAtraso });
  const tecnicoNeutro = e.equipamentos.ativos === 0 && e.equipamentos.extraviados === 0;
  const tecnico = deriveTechnicalScore({ equipamentosAtivos: e.equipamentos.ativos, equipamentosExtraviados: e.equipamentos.extraviados });
  const relacionamento = deriveRelationshipScore({ comunicacoes30d: e.comunicacoes30d, totalComunicacoes: e.totalComunicacoes });
  const health = computeHealthScore({ health_financial: financeiro, health_technical: tecnico, health_relationship: relacionamento });

  // Propensão só existe com dívida em aberto (fatura ABERTA no Provedor.ai); sem ela, "Em dia".
  const propensaoDetalhe = e.dividaAtual > 0
    ? computePropensao({
        creditScore0a1000: e.ispScore,
        valorDivida: e.dividaAtual,
        valorMensal: valorMensal ?? 0,
        diasAtraso: e.diasAtraso,
        contatos: e.contatos90d,
        respostas: e.respostas90d,
        hoje: isoDia(e.hoje),
        diaPagamentoPreferido: null,
      })
    : null;

  const prescricao = prescricaoPorAtraso(e.diasAtraso, e.hoje);

  let economia: EconomiaLedger | null = null;
  let economiaPendente: string | null = null;
  if (!e.economia) {
    economiaPendente = "sem parâmetros de custo do provedor (Política > Economia)";
  } else if (situacaoReal === "ex-cliente" && !e.historicoPagamento) {
    economiaPendente = "ex-cliente sem histórico de pagamento sincronizado — a economia realizada é a soma dos pagamentos reais, não fórmula";
  } else if (!cicloVivo && !e.historicoPagamento) {
    economiaPendente = "cliente sem contrato ativo (cancelado no ERP) — ciclo encerrado; nenhum número de assinatura é projetado";
  } else if (valorMensal === null) {
    economiaPendente = e.plano
      ? `sem mensalidade: o plano "${e.plano}" não tem preço cadastrado e este cliente não tem fatura vinda do ERP`
      : "sem mensalidade: este cliente não tem fatura vinda do ERP, e o plano dele não chegou do sync";
  } else if (!custosInformados(e.economia)) {
    // Chega DEPOIS do ARPU de propósito: o ARPU é dado do ERP e o provedor não
    // tem o que fazer se faltar; os custos são a configuração que ele preenche.
    economiaPendente = "faltam os custos do provedor: CAC, instalação e o custo mensal de servir um assinante (Política > Economia)";
  } else if (mesesCliente === null) {
    economiaPendente = "sem data de contrato — o ERP não informou quando o cliente aderiu";
  } else {
    economia = computeEconomiaLedger({
      arpu: valorMensal,
      custoParams: {
        cac: e.economia.cac,
        capex_instalacao: e.economia.capexInstalacao,
        equipamento_residual: e.economia.equipamentoResidual,
        opex_link: e.economia.opexLink,
        opex_rede_pop: e.economia.opexRedePop,
        opex_suporte: e.economia.opexSuporte,
        opex_manutencao_noc: e.economia.opexManutencaoNoc,
        imposto_receita_pct: e.economia.impostoReceitaPct,
        ciclo_meses: e.economia.cicloMeses,
      },
      mesAtual: mesesCliente,
      cicloVivo,
      receitaRecebida: e.historicoPagamento ? e.historicoPagamento.recebido : null,
      inadimplenciaAberta: e.dividaAtual,
    });
  }

  const resumo = resumoExecutivo({
    selo,
    situacaoReal,
    anosCliente,
    vencido: e.dividaAtual,
    atraso: e.diasAtraso,
    temFaturas: faturasAbertas > 0,
    historicoPagamento: e.historicoPagamento ? { pagas: e.historicoPagamento.pagas, pct_em_dia: e.historicoPagamento.pct_em_dia } : null,
    ltvReceita: economia?.ltv_receita ?? null,
  });

  return {
    situacaoReal,
    anosCliente,
    mesesCliente,
    valorMensal,
    selo,
    scores: {
      health: health.health_score,
      health_band: health.health_band,
      health_detalhe: { financeiro, tecnico, relacionamento, tecnicoNeutro, relacionamentoNeutro: true },
      credito: e.ispScore,
      credito_band: e.riskTier,
      propensao: propensaoDetalhe?.score ?? null,
      propensao_em_dia: e.dividaAtual <= 0,
      propensao_detalhe: propensaoDetalhe,
    },
    prescricao,
    economia,
    economiaPendente,
    origemDoValorMensal,
    resumo,
  };
}
