import { describe, expect, it } from "vitest";
import { computeEconomiaLedger, type EconomiaLedger } from "./economia";
import { POLITICA_PADRAO, type Economia } from "./politica";
import { parsePeriodo } from "./periodo";
import { agregarPrejuizo, decomporPrejuizo, type DevedorDaCarteira } from "./prejuizo";

/** Os parâmetros da NsLink em 09/09/2026 — margem_mes 37,708, investimento 770, payback 21. */
const NSLINK: Economia = {
  ...POLITICA_PADRAO.economia,
  cac: 120, capexInstalacao: 650, equipamentoResidual: 390,
  opexLink: 15, opexRedePop: 10, opexSuporte: 10, opexManutencaoNoc: 10,
  impostoReceitaPct: 8, cicloMeses: 36, confirmado: false, precoPorPlano: {},
};
const CUSTOS = {
  cac: 120, capex_instalacao: 650, equipamento_residual: 390, opex_link: 15, opex_rede_pop: 10,
  opex_suporte: 10, opex_manutencao_noc: 10, imposto_receita_pct: 8, ciclo_meses: 36,
};
const ledger = (mesAtual: number, divida: number, cicloVivo = true): EconomiaLedger =>
  computeEconomiaLedger({ arpu: 89.9, custoParams: CUSTOS, mesAtual, cicloVivo, receitaRecebida: null, inadimplenciaAberta: divida });

describe("decomporPrejuizo — só campos do ledger, identidade exata", () => {
  it("antes do payback: prejuízo = dívida real + instalação não recuperada", () => {
    // Mês 6 devendo 179,80: o ledger dá −723,55 (37,708×6 − 770 − 179,80).
    const L = ledger(6, 179.8);
    expect(L.lucro_acumulado).toBe(-723.55);
    const d = decomporPrejuizo(L, 179.8);
    expect(d).toEqual({ prejuizo: 723.55, dividaAvaliada: 179.8, instalacaoNaoRecuperada: 543.75, abatida: 0 });
    expect(d.dividaAvaliada + d.instalacaoNaoRecuperada - d.abatida).toBeCloseTo(d.prejuizo, 2);
  });
  it("depois do payback: a margem já acumulada abate a dívida; veterano dá prejuízo 0 com dívida no sub", () => {
    const L = ledger(60, 179.8);
    expect(L.lucro_acumulado).toBe(1312.68);
    expect(decomporPrejuizo(L, 179.8)).toEqual({ prejuizo: 0, dividaAvaliada: 179.8, instalacaoNaoRecuperada: 0, abatida: 179.8 });
    // 22 meses com saldo 589,65: a sobra (59,58) cobre parte da dívida.
    const ex = ledger(22, 589.65, false);
    expect(ex.lucro_acumulado).toBe(-530.07);
    const d = decomporPrejuizo(ex, 589.65);
    expect(d).toEqual({ prejuizo: 530.07, dividaAvaliada: 589.65, instalacaoNaoRecuperada: 0, abatida: 59.58 });
    expect(d.dividaAvaliada + d.instalacaoNaoRecuperada - d.abatida).toBeCloseTo(d.prejuizo, 2);
  });
  it("modo recebida: o ledger não subtrai a dívida, e a decomposição não a soma de volta", () => {
    const L = computeEconomiaLedger({ arpu: 89.9, custoParams: CUSTOS, mesAtual: 6, cicloVivo: true, receitaRecebida: 300, inadimplenciaAberta: 179.8 });
    expect(L.fonte_receita).toBe("recebida");
    const d = decomporPrejuizo(L, 179.8);
    expect(d.prejuizo).toBe(Math.max(0, -L.lucro_acumulado));
    expect(d.instalacaoNaoRecuperada).toBe(d.prejuizo);
    expect(d.dividaAvaliada).toBe(179.8);
    expect(d.abatida).toBe(0);
  });
});

const HOJE = new Date(2026, 8, 9); // 09/09/2026
const devedor = (over: Partial<DevedorDaCarteira> & { id: number }): DevedorDaCarteira => ({
  statusErp: "active", dividaAtual: 179.8, contractStartDate: "2026-03-09", cortadoEm: null,
  devemDesde: "2026-09-01", ultimaFatura: "2026-09-01", ...over,
});
const mensal = (valor = 89.9, concordam = 1, baixadas = 0) => ({ valor, concordam, faturas: concordam, baixadas });

describe("agregarPrejuizo — a soma da carteira por período", () => {
  it("ativos de set/26: soma os avaliados, conta os de fora por motivo, e a dívida do recorte é de todos", () => {
    const devedores = [
      devedor({ id: 1 }),                                          // mês 6 → −723,55
      devedor({ id: 2, contractStartDate: "2021-09-09" }),         // veterano → 0 de prejuízo
      devedor({ id: 3, contractStartDate: null }),                 // sem data → de fora
      devedor({ id: 4 }),                                          // sem mensalidade → de fora
      devedor({ id: 5, devemDesde: "2026-08-15", ultimaFatura: "2026-09-01" }), // agosto: outro período
      devedor({ id: 6, devemDesde: null, ultimaFatura: null, dividaAtual: 50 }), // sem data
    ];
    const mensalidades = new Map([[1, mensal()], [2, mensal()], [3, mensal()], [5, mensal()]]);
    const r = agregarPrejuizo({ devedores, mensalidades, economia: NSLINK, hoje: HOJE, periodo: parsePeriodo("2026-09")!, carteira: "ativo" });
    expect(r.resumo).toMatchObject({
      devedores: 4, avaliados: 2, noPrejuizo: 1, prejuizo: 723.55, dividaAvaliada: 359.6, instalacaoNaoRecuperada: 543.75, abatida: 179.8,
      dividaDoRecorte: 719.2, devedoresDaCarteira: 6, dividaDaCarteira: 949, semData: { clientes: 1, divida: 50 },
    });
    // Os três fecham no principal: dívida dos avaliados + instalação − abatida.
    expect(r.resumo.dividaAvaliada + r.resumo.instalacaoNaoRecuperada! - r.resumo.abatida).toBeCloseTo(r.resumo.prejuizo!, 2);
    expect(r.resumo.motivosDoTraco.map(m => [m.clientes, m.motivo.slice(0, 20)]).sort()).toEqual([[1, "sem data de contrato"], [1, "sem mensalidade: est"]]);
    expect(r.resumo.fatiaDaCarteira).toBe(75.8);
    expect(r.ids).toEqual([1, 2, 3, 4]);
    expect(r.serie).toEqual([{ mes: "2026-09", devedores: 4, dividaReal: 719.2, prejuizo: 723.55 }]);
  });
  it("mês + mês + mês = trimestre, e Σ períodos + sem data = a carteira inteira", () => {
    const devedores = [
      devedor({ id: 1, devemDesde: "2026-07-10" }), devedor({ id: 2, devemDesde: "2026-08-10" }), devedor({ id: 3, devemDesde: "2026-09-10" }),
      devedor({ id: 4, devemDesde: "2026-06-30" }), devedor({ id: 5, devemDesde: null, ultimaFatura: null }),
    ];
    const mensalidades = new Map(devedores.map(d => [d.id, mensal()]));
    const soma = (p: string) => agregarPrejuizo({ devedores, mensalidades, economia: NSLINK, hoje: HOJE, periodo: parsePeriodo(p)!, carteira: "ativo" }).resumo;
    const t3 = soma("2026-T3");
    expect(t3.devedores).toBe(3);
    expect(t3.prejuizo).toBeCloseTo(soma("2026-07").prejuizo! + soma("2026-08").prejuizo! + soma("2026-09").prejuizo!, 2);
    const tudo = t3.dividaDoRecorte + soma("2026-T2").dividaDoRecorte + t3.semData.divida;
    expect(tudo).toBeCloseTo(t3.dividaDaCarteira, 2);
    expect(soma("2026-S2").devedores).toBe(3);
    expect(soma("2026").devedores).toBe(4);
    expect(agregarPrejuizo({ devedores, mensalidades, economia: NSLINK, hoje: HOJE, periodo: parsePeriodo("2026-T3")!, carteira: "ativo" }).serie.map(s => s.devedores)).toEqual([1, 1, 1]);
  });
  it("a atribuição é só texto: a fatura de 01/07 cai em julho e em T3 em qualquer fuso", () => {
    const devedores = [devedor({ id: 1, devemDesde: "2026-07-01" }), devedor({ id: 2, devemDesde: "2026-06-30" })];
    const mensalidades = new Map([[1, mensal()], [2, mensal()]]);
    const em = (p: string) => agregarPrejuizo({ devedores, mensalidades, economia: NSLINK, hoje: HOJE, periodo: parsePeriodo(p)!, carteira: "ativo" }).ids;
    expect(em("2026-07")).toEqual([1]);
    expect(em("2026-T3")).toEqual([1]);
    expect(em("2026-T2")).toEqual([2]);
  });
  it("ex-clientes: a única fatura é o saldo — nenhum vira ARPU; o principal fica null e a dívida deixada é real", () => {
    const devedores = [
      devedor({ id: 1, statusErp: "cancelled", dividaAtual: 2924.66, devemDesde: "2026-02-10", ultimaFatura: "2026-02-10", contractStartDate: "2024-04-01" }),
      devedor({ id: 2, statusErp: "cancelled", dividaAtual: 589.65, devemDesde: "2026-03-05", ultimaFatura: "2026-03-05", contractStartDate: "2025-09-01" }),
    ];
    const mensalidades = new Map([[1, mensal(2924.66)], [2, mensal(589.65)]]);
    const r = agregarPrejuizo({ devedores, mensalidades, economia: NSLINK, hoje: HOJE, periodo: parsePeriodo("2026-T1")!, carteira: "ex_cliente" });
    expect(r.resumo.devedores).toBe(2);
    expect(r.resumo.avaliados).toBe(0);
    expect(r.resumo.prejuizo).toBeNull();
    expect(r.resumo.instalacaoNaoRecuperada).toBeNull();
    expect(r.resumo.dividaDoRecorte).toBe(3514.31);
    // Sem fatura paga o ex-cliente sai ESTIMADO; o que barra aqui e a mensalidade: a unica fatura e o saldo.
    expect(r.resumo.motivosDoTraco).toEqual([{ motivo: expect.stringMatching(/a única fatura aberta deste ex-cliente é o saldo final/), clientes: 2, divida: 3514.31 }]);
  });
  it("sem devedor no período: ZERO, não traço (conjunto vazio soma zero); sem carteira, sem fatia", () => {
    const r = agregarPrejuizo({ devedores: [], mensalidades: new Map(), economia: NSLINK, hoje: HOJE, periodo: parsePeriodo("2026-09")!, carteira: "ativo" });
    expect(r.resumo).toMatchObject({ devedores: 0, avaliados: 0, prejuizo: 0, instalacaoNaoRecuperada: 0, dividaDoRecorte: 0, fatiaDaCarteira: null });
    expect(r.ids).toEqual([]);
  });
  it("mês com devedor mas ninguém avaliado fica null na série; mês sem devedor fica null também", () => {
    const devedores = [devedor({ id: 1, devemDesde: "2026-07-10" }), devedor({ id: 2, devemDesde: "2026-08-10" })];
    const mensalidades = new Map([[1, mensal()]]); // o 2 nao tem mensalidade → barrado
    const r = agregarPrejuizo({ devedores, mensalidades, economia: NSLINK, hoje: HOJE, periodo: parsePeriodo("2026-T3")!, carteira: "ativo" });
    expect(r.serie.map(x => [x.devedores, x.prejuizo === null ? null : "num"])).toEqual([[1, "num"], [1, null], [0, null]]);
    expect(r.serie[1].dividaReal).toBe(179.8);
  });
});

describe("com pagamento real (0036), o ex-cliente entra na soma pelo que pagou", () => {
  it("historico presente + mensalidade confirmada: avaliado em modo recebida, prejuizo = o negativo do resultado", () => {
    const devedores = [devedor({ id: 1, statusErp: "cancelled", dividaAtual: 100, contractStartDate: "2025-09-05", ultimaFatura: "2026-03-05", devemDesde: "2026-03-05" })];
    const mensalidades = new Map([[1, mensal(89.9, 6, 6)]]);
    const historicos = new Map([[1, { pagas: 6, recebido: 539.4, pct_em_dia: 100 }]]);
    const r = agregarPrejuizo({ devedores, mensalidades, historicos, economia: NSLINK, hoje: HOJE, periodo: parsePeriodo("2026-T1")!, carteira: "ex_cliente" });
    expect(r.resumo.avaliados).toBe(1);
    // recebida: 539,40 × 0,92 − 45 × 6 − 770 = −543,75 → prejuizo 543,75; a divida fica ao lado, nao dentro.
    expect(r.resumo.prejuizo).toBe(543.75);
    expect(r.resumo.instalacaoNaoRecuperada).toBe(543.75);
    expect(r.resumo.dividaAvaliada).toBe(100);
    expect(r.resumo.motivosDoTraco).toEqual([]);
  });
});

describe("o provedor cujo ERP nunca confirmou pagamento (0036)", () => {
  it("ex-clientes sem fatura paga entram ESTIMADOS (mensalidades do ciclo − saldo devedor), e o resumo diz quantos", () => {
    const devedores = [
      devedor({ id: 1, statusErp: "cancelled", dividaAtual: 100, contractStartDate: "2025-09-05", ultimaFatura: "2026-03-05", devemDesde: "2026-03-05" }),
      devedor({ id: 2, statusErp: "cancelled", dividaAtual: 200, contractStartDate: "2025-09-05", ultimaFatura: "2026-02-05", devemDesde: "2026-02-05" }),
    ];
    const mensalidades = new Map([[1, mensal(89.9, 6, 6)], [2, mensal(89.9, 6, 6)]]);
    const r = agregarPrejuizo({ devedores, mensalidades, erpConfirmaPagamentos: false, erpSource: "mk", economia: NSLINK, hoje: HOJE, periodo: parsePeriodo("2026-T1")!, carteira: "ex_cliente" });
    expect(r.resumo.avaliados).toBe(2);
    expect(r.resumo.estimados).toBe(2);
    expect(r.resumo.motivosDoTraco).toEqual([]);
    // 1: (89,90 × 6 − 100) × 0,92 − 45 × 6 − 770 = −635,75 · 2: (89,90 × 5 − 200) × 0,92 − 45 × 5 − 770 = −765,46
    expect(r.resumo.prejuizo).toBeCloseTo(1401.21, 2);
    expect(r.resumo.instalacaoNaoRecuperada).toBeCloseTo(1401.21, 2);
    expect(r.resumo.dividaAvaliada).toBe(300);
  });
  it("ex-cliente com historico real nao e estimado; cliente vivo tampouco", () => {
    const ex = agregarPrejuizo({ devedores: [devedor({ id: 1, statusErp: "cancelled", dividaAtual: 100, contractStartDate: "2025-09-05", ultimaFatura: "2026-03-05", devemDesde: "2026-03-05" })], mensalidades: new Map([[1, mensal(89.9, 6, 6)]]), historicos: new Map([[1, { pagas: 6, recebido: 539.4, pct_em_dia: 100 }]]), economia: NSLINK, hoje: HOJE, periodo: parsePeriodo("2026-T1")!, carteira: "ex_cliente" });
    expect(ex.resumo.avaliados).toBe(1);
    expect(ex.resumo.estimados).toBe(0);
    const vivo = agregarPrejuizo({ devedores: [devedor({ id: 1, statusErp: "active", dividaAtual: 100, contractStartDate: "2025-09-05", devemDesde: "2026-03-05", ultimaFatura: "2026-03-05" })], mensalidades: new Map([[1, mensal(89.9, 2)]]), economia: NSLINK, hoje: HOJE, periodo: parsePeriodo("2026-T1")!, carteira: "ativo" });
    expect(vivo.resumo.avaliados).toBe(1);
    expect(vivo.resumo.estimados).toBe(0);
  });
  it("o plano do devedor (contract_plan) com preco cadastrado vira o ARPU do cliente vivo", () => {
    const devedores = [devedor({ id: 1, statusErp: "active", dividaAtual: 100, contractStartDate: "2025-09-05", devemDesde: "2026-03-05", ultimaFatura: "2026-03-05", plano: "Smart 800MB" })];
    const r = agregarPrejuizo({ devedores, mensalidades: new Map(), economia: { ...NSLINK, precoPorPlano: { "Smart 800MB": 99.9 } }, hoje: HOJE, periodo: parsePeriodo("2026-T1")!, carteira: "ativo" });
    expect(r.resumo.avaliados).toBe(1);
    expect(r.resumo.motivosDoTraco).toEqual([]);
  });
});

describe("o card tira a multa e o equipamento da divida antes do prejuizo (dono, 09/09/2026)", () => {
  const dev = () => devedor({ id: 1, statusErp: "active", dividaAtual: 719.86, contractStartDate: "2026-07-05", devemDesde: "2026-08-05", ultimaFatura: "2026-08-05" });
  it("a divida avaliada e a de servico; o prejuizo cai pela multa; a soma do que ficou de fora vai no resumo; a divida REAL do recorte nao muda", () => {
    const sem = agregarPrejuizo({ devedores: [dev()], mensalidades: new Map([[1, mensal(89.9, 2)]]), economia: NSLINK, hoje: HOJE, periodo: parsePeriodo("2026-T3")!, carteira: "ativo" });
    const com = agregarPrejuizo({ devedores: [dev()], mensalidades: new Map([[1, mensal(89.9, 2)]]), cobrancasDeSaida: new Map([[1, { multa: 600, equipamento: 0, indeterminadas: 0, faturas: 1 }]]), economia: NSLINK, hoje: HOJE, periodo: parsePeriodo("2026-T3")!, carteira: "ativo" });
    expect(sem.resumo.avaliados).toBe(1);
    expect(com.resumo.avaliados).toBe(1);
    expect(com.resumo.dividaAvaliada).toBe(119.86);
    expect(sem.resumo.dividaAvaliada).toBe(719.86);
    expect(Math.round((sem.resumo.prejuizo! - com.resumo.prejuizo!) * 100) / 100).toBe(600);
    expect(com.resumo.multaForaDoPrejuizo).toBe(600);
    expect(com.resumo.dividaDoRecorte).toBe(719.86);
    expect(sem.resumo.multaForaDoPrejuizo).toBe(0);
  });
  it("faturas indeterminadas e multa so contam para quem PASSOU no gate — 'contada como divida' fala dos avaliados", () => {
    const fora = agregarPrejuizo({ devedores: [dev()], mensalidades: new Map(), cobrancasDeSaida: new Map([[1, { multa: 600, equipamento: 0, indeterminadas: 2, faturas: 3 }]]), economia: NSLINK, hoje: HOJE, periodo: parsePeriodo("2026-T3")!, carteira: "ativo" });
    expect(fora.resumo.avaliados).toBe(0);
    expect(fora.resumo.multasIndeterminadas).toBe(0);
    expect(fora.resumo.multaForaDoPrejuizo).toBe(0);
    // A divida dele no motivo do traco e a INTEIRA, segundo o ERP.
    expect(fora.resumo.motivosDoTraco[0]?.divida).toBe(719.86);
    const dentro = agregarPrejuizo({ devedores: [dev()], mensalidades: new Map([[1, mensal(89.9, 2)]]), cobrancasDeSaida: new Map([[1, { multa: 600, equipamento: 0, indeterminadas: 2, faturas: 3 }]]), economia: NSLINK, hoje: HOJE, periodo: parsePeriodo("2026-T3")!, carteira: "ativo" });
    expect(dentro.resumo.avaliados).toBe(1);
    expect(dentro.resumo.multasIndeterminadas).toBe(2);
    expect(dentro.resumo.multaForaDoPrejuizo).toBe(600);
  });
});
