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
import type { Economia } from "./politica";
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
  const valorMensal = precoDoPlano(e.economia?.precoPorPlano, e.plano);
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
      ? `sem preço cadastrado para o plano "${e.plano}" (Política > Economia > preço por plano)`
      : "sem ARPU real do plano — o ERP não informou o plano do cliente";
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
    resumo,
  };
}
