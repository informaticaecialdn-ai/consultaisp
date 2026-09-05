import { describe, expect, it } from "vitest";
import { computeEconomiaLedger, mesesEntre, normalizarNomeDePlano, precoDoPlano, RETENCAO_DESCONTO_PCT, RETENCAO_MESES } from "./economia";

/**
 * O porte de `computeEconomiaLedger` do Provedor.ai, conferido número a
 * número com contas feitas à mão — arredondamento incluído. Se um destes
 * mudar, a ficha 360 deixa de bater com a do Provedor.ai para o mesmo insumo.
 */

const CUSTOS = {
  cac: 150,
  capex_instalacao: 200,
  equipamento_residual: 120,
  opex_link: 10,
  opex_rede_pop: 10,
  opex_suporte: 10,
  opex_manutencao_noc: 10,
  imposto_receita_pct: 10,
  ciclo_meses: 36,
};

describe("computeEconomiaLedger", () => {
  it("cliente vivo, sem histórico de pagamento: lucro é projeção menos a dívida vencida", () => {
    const e = computeEconomiaLedger({ arpu: 100, custoParams: CUSTOS, mesAtual: 12, cicloVivo: true, receitaRecebida: null, inadimplenciaAberta: 100 });
    expect(e.opex_fixo_mes).toBe(40);
    expect(e.imposto_pct).toBe(10);
    expect(e.opex_mes).toBe(50);            // 40 + 10% de 100
    expect(e.margem_mes).toBe(50);
    expect(e.margem_pct).toBe(50);
    expect(e.investimento).toBe(350);
    expect(e.payback_meses).toBe(7);        // ceil(350 / 50)
    expect(e.fonte_receita).toBe("projetada");
    expect(e.lucro_acumulado).toBe(150);    // 50 × 12 − 350 − 100
    expect(e.ciclo_efetivo).toBe(36);
    expect(e.ciclo_encerrado).toBe(false);
    expect(e.ltv_receita).toBe(3600);
    expect(e.ltv_margem).toBe(1800);
    expect(e.ltv_cac).toBe(5.1);            // 1800 / 350 = 5.142…
    expect(e.ltv_realizado).toBeNull();
    expect(e.perda_se_cancelar).toBe(1800); // margem × ciclo paramétrico
    expect(e.custo_oferta_retencao).toBe(100 * RETENCAO_DESCONTO_PCT * RETENCAO_MESES);
    expect(e.roi_retencao).toBe(12);
    expect(e.equipamento_residual).toBe(120);
    expect(e.opex_breakdown).toEqual([
      { categoria: "link_transporte", valor: 10, pct: 10 },
      { categoria: "rateio_rede_pop", valor: 10, pct: 10 },
      { categoria: "suporte_atendimento", valor: 10, pct: 10 },
      { categoria: "manutencao_noc", valor: 10, pct: 10 },
      { categoria: "impostos_receita", valor: 10, pct: 10 },
    ]);
  });

  it("com receita recebida real, o lucro sai do recebido líquido de imposto, menos OPEX fixo incorrido e investimento", () => {
    const e = computeEconomiaLedger({ arpu: 100, custoParams: CUSTOS, mesAtual: 12, cicloVivo: true, receitaRecebida: 1000, inadimplenciaAberta: 100 });
    expect(e.fonte_receita).toBe("recebida");
    expect(e.lucro_acumulado).toBe(70);     // 1000 × 0,9 − 40 × 12 − 350
    expect(e.ltv_realizado).toBe(1000);
    expect(e.receita_recebida).toBe(1000);
  });

  it("veterano além do ciclo: o ciclo efetivo acompanha os meses de casa", () => {
    const e = computeEconomiaLedger({ arpu: 100, custoParams: CUSTOS, mesAtual: 50, cicloVivo: true, receitaRecebida: null, inadimplenciaAberta: 0 });
    expect(e.ciclo_efetivo).toBe(50);
    expect(e.ltv_receita).toBe(5000);
    expect(e.perda_se_cancelar).toBe(1800); // sempre margem × ciclo PARAMÉTRICO
  });

  it("ex-cliente: ciclo encerrado, efetivo = meses realizados, nada a perder por cancelar", () => {
    const e = computeEconomiaLedger({ arpu: 100, custoParams: CUSTOS, mesAtual: 20, cicloVivo: false, receitaRecebida: 1500, inadimplenciaAberta: 0 });
    expect(e.ciclo_encerrado).toBe(true);
    expect(e.ciclo_efetivo).toBe(20);
    expect(e.ltv_receita).toBe(2000);
    expect(e.perda_se_cancelar).toBe(0);
    expect(e.roi_retencao).toBe(0);
  });

  it("margem negativa: payback nunca, LTV:CAC negativo, sem perda por cancelar", () => {
    const e = computeEconomiaLedger({ arpu: 30, custoParams: CUSTOS, mesAtual: 6, cicloVivo: true, receitaRecebida: null, inadimplenciaAberta: 0 });
    expect(e.margem_mes).toBe(-13);         // 30 − (40 + 3)
    expect(e.payback_meses).toBeNull();
    expect(e.perda_se_cancelar).toBe(0);
    expect(e.ltv_cac).toBe(-1.3);           // −13 × 36 / 350 = −1.337…
  });

  it("sem investimento, LTV:CAC não existe; arpu zero zera os percentuais sem dividir por zero", () => {
    const semInvest = computeEconomiaLedger({ arpu: 100, custoParams: { ...CUSTOS, cac: 0, capex_instalacao: 0 }, mesAtual: 1, cicloVivo: true, receitaRecebida: null, inadimplenciaAberta: 0 });
    expect(semInvest.ltv_cac).toBeNull();
    expect(semInvest.payback_meses).toBe(0);
    const arpuZero = computeEconomiaLedger({ arpu: 0, custoParams: CUSTOS, mesAtual: 1, cicloVivo: true, receitaRecebida: null, inadimplenciaAberta: 0 });
    expect(arpuZero.margem_pct).toBe(0);
    expect(arpuZero.roi_retencao).toBeNull();
  });

  it("arredonda a duas casas o dinheiro e a uma casa as razões, como o Provedor.ai", () => {
    const e = computeEconomiaLedger({ arpu: 99.9, custoParams: { ...CUSTOS, imposto_receita_pct: 7.5 }, mesAtual: 3, cicloVivo: true, receitaRecebida: null, inadimplenciaAberta: 0 });
    expect(e.opex_mes).toBe(47.49);         // 40 + 7,4925
    expect(e.margem_mes).toBe(52.41);
    expect(e.margem_pct).toBe(52.5);
    expect(e.ltv_cac).toBe(5.4);            // 52,4075 × 36 / 350 = 5.39…
  });
});

describe("mesesEntre", () => {
  const hoje = new Date(2026, 8, 5); // 05/09/2026
  it("conta meses completos; dia ainda não chegou não conta", () => {
    expect(mesesEntre(new Date(2025, 8, 5), hoje)).toBe(12);
    expect(mesesEntre(new Date(2025, 8, 6), hoje)).toBe(11);
    expect(mesesEntre("2026-09-01", hoje)).toBe(0);
  });
  it("sem data, data inválida ou futura = null", () => {
    expect(mesesEntre(null, hoje)).toBeNull();
    expect(mesesEntre("nao-e-data", hoje)).toBeNull();
    expect(mesesEntre(new Date(2027, 0, 1), hoje)).toBeNull();
  });
});

describe("precoDoPlano", () => {
  const tabela = { "Fibra 300": 119.9, "Combo 800MB + Deezer": 199.9, "Zerado": 0 };
  it("casa o nome sem caixa, acento nem espaço duplo", () => {
    expect(precoDoPlano(tabela, "fibra  300")).toBe(119.9);
    expect(precoDoPlano(tabela, "COMBO 800MB + DEEZER")).toBe(199.9);
    expect(normalizarNomeDePlano("Fibra Ótica 300")).toBe("fibra otica 300");
  });
  it("plano desconhecido, preço zero ou tabela vazia = null (Economia PENDENTE, nunca chute)", () => {
    expect(precoDoPlano(tabela, "Fibra 500")).toBeNull();
    expect(precoDoPlano(tabela, "Zerado")).toBeNull();
    expect(precoDoPlano({}, "Fibra 300")).toBeNull();
    expect(precoDoPlano(undefined, "Fibra 300")).toBeNull();
    expect(precoDoPlano(tabela, null)).toBeNull();
  });
});
