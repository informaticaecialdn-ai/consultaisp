/**
 * A ECONOMIA DO CLIENTE (R24) — o porte literal de `computeEconomiaLedger`
 * do Provedor.ai (`packages/scoring/src/economia/index.ts:11-147`).
 *
 * Unit economics de UM assinante: quanto custou adquirir e instalar, quanto
 * custa servir por mês, quanto sobra, quando o investimento se paga, quanto
 * já rendeu e quanto ainda renderia — e o que se perde se ele cancelar.
 *
 * O que muda em relação ao Provedor.ai é só a origem dos números: lá o ARPU
 * vem de `clientes.valor_mensal` e os custos de `custo_parametros`; aqui o
 * ARPU vem do preço por plano cadastrado na política (`economia.precoPorPlano`,
 * casado com o nome do plano que o ERP informa) e os custos de
 * `cobranca_politica.economia`. As fórmulas são as mesmas, arredondamento
 * incluído, para o número da ficha bater com o do Provedor.ai dado o mesmo
 * insumo.
 *
 * Módulo puro: sem banco, sem React, sem I/O.
 */

/** Oferta de retenção PADRÃO do produto: 50% de desconto por 3 meses. */
export const RETENCAO_DESCONTO_PCT = 0.5;
export const RETENCAO_MESES = 3;

/** Os custos por provedor, com os nomes do Provedor.ai (`custo_parametros`). */
export interface CustoParametrosEconomia {
  cac: number;
  capex_instalacao: number;
  equipamento_residual: number;
  opex_link: number;
  opex_rede_pop: number;
  opex_suporte: number;
  opex_manutencao_noc: number;
  /** Pontos percentuais: 12 = 12%. */
  imposto_receita_pct: number;
  ciclo_meses: number;
}

export interface EconomiaLedgerInput {
  /** Mensalidade do plano. */
  arpu: number;
  custoParams: CustoParametrosEconomia;
  /** Meses desde a adesão (vivo) ou de casa até sair (ex-cliente). */
  mesAtual: number;
  /** true = contrato ativo ou suspenso; false = ex-cliente (ciclo encerrado). */
  cicloVivo: boolean;
  /** Soma dos pagamentos reais sincronizados; `null` quando não há histórico. */
  receitaRecebida: number | null;
  /** Faturas vencidas em aberto (valor original) — descontadas do lucro projetado. */
  inadimplenciaAberta: number;
}

export interface OpexCategoria {
  categoria: "link_transporte" | "rateio_rede_pop" | "suporte_atendimento" | "manutencao_noc" | "impostos_receita";
  valor: number;
  /** % do ARPU, uma casa. */
  pct: number;
}

export interface EconomiaLedger {
  arpu: number;
  cac: number;
  capex: number;
  opex_mes: number;
  opex_breakdown: OpexCategoria[];
  margem_mes: number;
  margem_pct: number;
  investimento: number;
  payback_meses: number | null;
  mes_atual: number;
  inadimplencia_aberta: number;
  fonte_receita: "recebida" | "projetada";
  receita_recebida: number | null;
  lucro_acumulado: number;
  /** ticket × ciclo efetivo — receita BRUTA. */
  ltv_receita: number;
  /** margem_mes × ciclo efetivo — base da regra LTV:CAC ≥ 3. */
  ltv_margem: number;
  ltv_cac: number | null;
  ltv_realizado: number | null;
  perda_se_cancelar: number;
  custo_oferta_retencao: number;
  roi_retencao: number | null;
  ciclo_meses: number;
  ciclo_efetivo: number;
  ciclo_encerrado: boolean;
  /** OPEX mensal SEM imposto — o simulador precisa dele separado. */
  opex_fixo_mes: number;
  imposto_pct: number;
  equipamento_residual: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

export function computeEconomiaLedger(input: EconomiaLedgerInput): EconomiaLedger {
  const { arpu, custoParams: cp, mesAtual, cicloVivo, receitaRecebida, inadimplenciaAberta } = input;

  const impostoPct = Number(cp.imposto_receita_pct);
  const opexFixoMes = Number(cp.opex_link) + Number(cp.opex_rede_pop) + Number(cp.opex_suporte) + Number(cp.opex_manutencao_noc);
  const imposto = arpu * (impostoPct / 100);
  const opexMes = opexFixoMes + imposto;
  const investimento = Number(cp.cac) + Number(cp.capex_instalacao);
  const margemMes = arpu - opexMes;
  const ciclo = Number(cp.ciclo_meses);
  const pct = (v: number) => (arpu > 0 ? Math.round((v / arpu) * 1000) / 10 : 0);

  // Lucro acumulado: RECEBIDO real quando há histórico; senão projeção − dívida vencida.
  const lucroRecebido = receitaRecebida !== null
    ? receitaRecebida * (1 - impostoPct / 100) - opexFixoMes * mesAtual - investimento
    : null;
  const lucroProjetado = margemMes * mesAtual - investimento - inadimplenciaAberta;

  // Ciclo efetivo: veterano não trava no paramétrico; ex-cliente = tenure realizado.
  const cicloEfetivo = cicloVivo ? Math.max(ciclo, mesAtual) : mesAtual;
  const ltvReceita = arpu * cicloEfetivo;
  const ltvMargem = margemMes * cicloEfetivo;

  // Retenção — FORWARD de propósito (margem × ciclo).
  const perdaSeCancelar = cicloVivo && margemMes > 0 ? margemMes * ciclo : 0;
  const custoOfertaRetencao = arpu * RETENCAO_DESCONTO_PCT * RETENCAO_MESES;
  const roiRetencao = custoOfertaRetencao > 0 ? perdaSeCancelar / custoOfertaRetencao : null;

  const breakdown: OpexCategoria[] = [
    { categoria: "link_transporte", valor: r2(Number(cp.opex_link)), pct: pct(Number(cp.opex_link)) },
    { categoria: "rateio_rede_pop", valor: r2(Number(cp.opex_rede_pop)), pct: pct(Number(cp.opex_rede_pop)) },
    { categoria: "suporte_atendimento", valor: r2(Number(cp.opex_suporte)), pct: pct(Number(cp.opex_suporte)) },
    { categoria: "manutencao_noc", valor: r2(Number(cp.opex_manutencao_noc)), pct: pct(Number(cp.opex_manutencao_noc)) },
    { categoria: "impostos_receita", valor: r2(imposto), pct: pct(imposto) },
  ];

  return {
    arpu,
    cac: Number(cp.cac),
    capex: Number(cp.capex_instalacao),
    opex_mes: r2(opexMes),
    opex_breakdown: breakdown,
    margem_mes: r2(margemMes),
    margem_pct: pct(margemMes),
    investimento,
    payback_meses: margemMes > 0 ? Math.ceil(investimento / margemMes) : null,
    mes_atual: mesAtual,
    inadimplencia_aberta: r2(inadimplenciaAberta),
    fonte_receita: receitaRecebida !== null ? "recebida" : "projetada",
    receita_recebida: receitaRecebida,
    lucro_acumulado: r2(lucroRecebido ?? lucroProjetado),
    ltv_receita: r2(ltvReceita),
    ltv_margem: r2(ltvMargem),
    ltv_cac: investimento > 0 ? r1(ltvMargem / investimento) : null,
    ltv_realizado: receitaRecebida !== null ? r2(receitaRecebida) : null,
    perda_se_cancelar: r2(perdaSeCancelar),
    custo_oferta_retencao: r2(custoOfertaRetencao),
    roi_retencao: roiRetencao !== null ? r1(roiRetencao) : null,
    ciclo_meses: ciclo,
    ciclo_efetivo: cicloEfetivo,
    ciclo_encerrado: !cicloVivo,
    opex_fixo_mes: r2(opexFixoMes),
    imposto_pct: impostoPct,
    equipamento_residual: Number(cp.equipamento_residual),
  };
}

/**
 * Meses completos entre a adesão e `ate` (hoje para quem está vivo; a saída
 * para ex-cliente). É o `mes_atual` do Provedor.ai (`age()` em meses).
 * `null` quando não há data.
 */
export function mesesEntre(inicio: Date | string | null | undefined, ate: Date): number | null {
  if (!inicio) return null;
  const d = inicio instanceof Date ? inicio : new Date(inicio);
  if (Number.isNaN(d.getTime()) || d > ate) return null;
  let meses = (ate.getFullYear() - d.getFullYear()) * 12 + (ate.getMonth() - d.getMonth());
  if (ate.getDate() < d.getDate()) meses -= 1;
  return Math.max(0, meses);
}

/**
 * O preço do plano pelo nome que o ERP informa, tolerante a caixa, acento e
 * espaço. `null` quando o provedor não cadastrou esse plano — e aí a Economia
 * fica PENDENTE, nunca calculada com um chute.
 */
export function precoDoPlano(precoPorPlano: Record<string, number> | undefined, plano: string | null | undefined): number | null {
  if (!precoPorPlano || !plano) return null;
  const alvo = normalizarNomeDePlano(plano);
  for (const [nome, preco] of Object.entries(precoPorPlano)) {
    if (normalizarNomeDePlano(nome) === alvo && Number.isFinite(preco) && preco > 0) return preco;
  }
  return null;
}

export function normalizarNomeDePlano(nome: string): string {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
