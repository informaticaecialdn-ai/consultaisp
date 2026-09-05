import { describe, expect, it } from "vitest";
import {
  anosDeCliente, bandLabel, classificarSeloPagamento, clienteStatusMeta, computeHealthScore, computePropensao, corDaBandaDeCredito,
  csatClasseMeta, deriveFinancialScore, deriveRelationshipScore, deriveTechnicalScore, dnaToneOf, healthBandOf, healthLabelMeta,
  NEUTRAL_SCORE, npsClasseMeta, prescricaoPorAtraso, projecaoRisco, resumoExecutivo, sinaisDePropensao, situacaoRealDe,
} from "./cliente360";

/**
 * As fórmulas do Provedor.ai, conferidas com os exemplos que a documentação
 * de lá dá — e com os cantos que aqui importam: insumo ausente vira NEUTRAL
 * ou `hadData: false`, nunca um zero que pareça medido.
 */

describe("health score (dimension-scores.ts + health.ts)", () => {
  it("financeiro: sem fatura em aberto é 100, não neutro", () => {
    expect(deriveFinancialScore({ faturasEmAberto: 0, valorEmAberto: 0, valorMensal: 100, diasAtrasoMax: 0 })).toBe(100);
  });
  it("financeiro: penalidades com teto — 90 dias tira 60, 3 faturas tiram 30, dívida ≥3 tickets tira 30", () => {
    expect(deriveFinancialScore({ faturasEmAberto: 1, valorEmAberto: 100, valorMensal: 100, diasAtrasoMax: 45 })).toBe(50); // 100 − 30 − 10 − 10
    expect(deriveFinancialScore({ faturasEmAberto: 5, valorEmAberto: 900, valorMensal: 100, diasAtrasoMax: 400 })).toBe(0);  // 100 − 60 − 30 − 30 → clamp
    // sem ticket conhecido a razão não penaliza (hadData false)
    expect(deriveFinancialScore({ faturasEmAberto: 1, valorEmAberto: 900, valorMensal: 0, diasAtrasoMax: 0 })).toBe(90);
  });
  it("técnico: sem equipamento nenhum é SEM DADO (50); extraviado penaliza 40 cada, teto 80", () => {
    expect(deriveTechnicalScore({ equipamentosAtivos: 0, equipamentosExtraviados: 0 })).toBe(NEUTRAL_SCORE);
    expect(deriveTechnicalScore({ equipamentosAtivos: 2, equipamentosExtraviados: 0 })).toBe(100);
    expect(deriveTechnicalScore({ equipamentosAtivos: 0, equipamentosExtraviados: 1 })).toBe(60);
    expect(deriveTechnicalScore({ equipamentosAtivos: 0, equipamentosExtraviados: 3 })).toBe(20);
  });
  it("relacionamento: NPS manda; CSAT ajusta; sem os dois, NEUTRAL pela atividade", () => {
    expect(deriveRelationshipScore({ comunicacoes30d: 0, totalComunicacoes: 0, nps: 100 })).toBe(100);
    expect(deriveRelationshipScore({ comunicacoes30d: 0, totalComunicacoes: 0, nps: 0, csatRecente: { classe: "insatisfeito" } })).toBe(40);
    expect(deriveRelationshipScore({ comunicacoes30d: 0, totalComunicacoes: 0, csatRecente: { classe: "satisfeito" } })).toBe(65);
    expect(deriveRelationshipScore({ comunicacoes30d: 0, totalComunicacoes: 0 })).toBe(45);
    expect(deriveRelationshipScore({ comunicacoes30d: 1, totalComunicacoes: 1 })).toBe(55);
    expect(deriveRelationshipScore({ comunicacoes30d: 3, totalComunicacoes: 3 })).toBe(60);
  });
  it("combina .40/.30/.30 e classifica ≥75 saudável · ≥50 atenção · ≥25 risco · <25 crítico", () => {
    expect(computeHealthScore({ health_financial: 100, health_technical: 50, health_relationship: 50 })).toEqual({ health_score: 70, health_band: "atencao" });
    expect(computeHealthScore({ health_financial: 100, health_technical: 100, health_relationship: 100 }).health_band).toBe("saudavel");
    expect(computeHealthScore({ health_financial: 0, health_technical: 50, health_relationship: 50 })).toEqual({ health_score: 30, health_band: "risco" });
    expect(computeHealthScore({ health_financial: 0, health_technical: 0, health_relationship: 45 }).health_band).toBe("critico");
    expect(healthBandOf(10, "saudavel")).toBe("saudavel"); // banda REAL manda
    expect(healthLabelMeta(80)).toEqual({ label: "Saudável", tone: "ok" });
    expect(healthLabelMeta(20)).toEqual({ label: "Crítico", tone: "past" });
  });
});

describe("selo de pagamento (selo-pagamento.ts) — estado atual > sem histórico > histórico > em dia", () => {
  it("dívida vencida é inadimplente, com os dias", () => {
    expect(classificarSeloPagamento({ emAberto: 120, atraso: 45, pagas: 30, pctEmDia: 95, mesesCliente: 40 })).toEqual({ tipo: "inadimplente", rotulo: "Inadimplente", tom: "past", motivo: "45 dias em atraso" });
    expect(classificarSeloPagamento({ emAberto: 120, atraso: 0, pagas: 0, pctEmDia: null, mesesCliente: null }).motivo).toBe("fatura vencida em aberto");
  });
  it("sem pagamentos: novo até 3 meses; veterano sem histórico é 'Sem histórico' (gap de sync, rótulo honesto)", () => {
    expect(classificarSeloPagamento({ emAberto: 0, atraso: 0, pagas: 0, pctEmDia: null, mesesCliente: 1 })).toEqual({ tipo: "novo", rotulo: "Novo", tom: "now", motivo: "1 mês de casa" });
    expect(classificarSeloPagamento({ emAberto: 0, atraso: 0, pagas: 0, pctEmDia: null, mesesCliente: 2 }).motivo).toBe("2 meses de casa");
    expect(classificarSeloPagamento({ emAberto: 0, atraso: 0, pagas: 0, pctEmDia: null, mesesCliente: 3 })).toEqual({ tipo: "novo", rotulo: "Sem histórico", tom: "now", motivo: "pagamentos ainda não sincronizados do ERP" });
    expect(classificarSeloPagamento({ emAberto: 0, atraso: 0, pagas: 0, pctEmDia: null, mesesCliente: null }).motivo).toBe("sem histórico de pagamento ainda");
  });
  it("com histórico: ≥90% pontual, senão paga atrasado; sem % mas com pagas, em dia", () => {
    expect(classificarSeloPagamento({ emAberto: 0, atraso: 0, pagas: 24, pctEmDia: 91.7, mesesCliente: 30 })).toEqual({ tipo: "pontual", rotulo: "Pontual", tom: "ok", motivo: "92% pagas em dia (24)" });
    expect(classificarSeloPagamento({ emAberto: 0, atraso: 0, pagas: 24, pctEmDia: 60, mesesCliente: 30 })).toEqual({ tipo: "paga_atrasado", rotulo: "Paga atrasado", tom: "gold", motivo: "60% em dia de 24 faturas" });
    expect(classificarSeloPagamento({ emAberto: 0, atraso: 0, pagas: 5, pctEmDia: null, mesesCliente: 30 })).toEqual({ tipo: "em_dia", rotulo: "Em dia", tom: "ok", motivo: "5 pagas · sem débito" });
  });
});

describe("propensão a pagar (propensao-signals.ts + propensao.ts)", () => {
  const base = { creditScore0a1000: 700, valorDivida: 100, valorMensal: 100, diasAtraso: 0, contatos: 2, respostas: 1, hoje: "2026-09-05", diaPagamentoPreferido: null };

  it("normaliza cada sinal como o Provedor.ai", () => {
    const s = sinaisDePropensao(base);
    expect(s.creditoBase).toEqual({ normalized: 0.7, hadData: true });
    expect(s.valorVsTicket.normalized).toBeCloseTo(1 - 1 / 3, 6);
    expect(s.posicaoCiclo).toEqual({ normalized: 0.9, hadData: true });
    expect(s.responsividade).toEqual({ normalized: 0.5, hadData: true });
    expect(s.sazonalidade).toEqual({ normalized: 0.8, hadData: true }); // dia 5 ≤ 10
  });
  it("decaimento do ciclo: ~.40 aos 30 d, ~.19 aos 60 d, ~.09 aos 90 d, piso .05", () => {
    expect(sinaisDePropensao({ ...base, diasAtraso: 30 }).posicaoCiclo.normalized).toBeCloseTo(0.4015, 3);
    expect(sinaisDePropensao({ ...base, diasAtraso: 60 }).posicaoCiclo.normalized).toBeCloseTo(0.1896, 3);
    expect(sinaisDePropensao({ ...base, diasAtraso: 90 }).posicaoCiclo.normalized).toBeCloseTo(0.0896, 3);
    expect(sinaisDePropensao({ ...base, diasAtraso: 400 }).posicaoCiclo.normalized).toBe(0.05);
  });
  it("sazonalidade com dia preferido: distância circular, piso .3", () => {
    expect(sinaisDePropensao({ ...base, hoje: "2026-09-05", diaPagamentoPreferido: 5 }).sazonalidade.normalized).toBe(1);
    expect(sinaisDePropensao({ ...base, hoje: "2026-09-20", diaPagamentoPreferido: 5 }).sazonalidade.normalized).toBeCloseTo(0.3, 6);
    expect(sinaisDePropensao({ ...base, hoje: "2026-09-28", diaPagamentoPreferido: 2 }).sazonalidade.normalized).toBeCloseTo(1 - (4 / 15) * 0.7, 6);
    expect(sinaisDePropensao({ ...base, hoje: "2026-09-15", diaPagamentoPreferido: null }).sazonalidade.normalized).toBe(0.5);
    expect(sinaisDePropensao({ ...base, hoje: "2026-09-25", diaPagamentoPreferido: null }).sazonalidade.normalized).toBe(0.3);
  });
  it("sinal sem dado não vira 0,5 com peso cheio: os pesos são re-normalizados sobre quem tem dado", () => {
    const p = computePropensao({ ...base, creditScore0a1000: null, valorMensal: 0, contatos: 0 });
    // só posicaoCiclo (.15) e sazonalidade (.10) têm dado: (0.9×.15 + 0.8×.10) / .25 = 0.86
    expect(p.score).toBe(86);
    expect(p.band).toBe("alta");
    const porFator = Object.fromEntries(p.fatores.map(f => [f.factor, f]));
    expect(porFator.creditoBase.hadData).toBe(false);
    expect(porFator.creditoBase.weight).toBe(0);
    expect(porFator.posicaoCiclo.weight).toBeCloseTo(0.6, 6);
    expect(porFator.sazonalidade.weight).toBeCloseTo(0.4, 6);
  });
  it("com todos os sinais: score e banda", () => {
    const p = computePropensao(base);
    // .45×.7 + .15×.6667 + .15×.9 + .15×.5 + .10×.8 = .315+.1+.135+.075+.08 = .705
    expect(p.score).toBe(71);
    expect(p.band).toBe("alta");
    expect(computePropensao({ ...base, creditScore0a1000: 200, diasAtraso: 120, respostas: 0, hoje: "2026-09-25" }).band).toBe("baixa");
  });
});

describe("metas de exibição (domain.ts)", () => {
  it("status → rótulo e tom, aceitando os status em inglês do sync daqui", () => {
    expect(clienteStatusMeta("active")).toEqual({ label: "Ativo", tone: "ok" });
    expect(clienteStatusMeta("suspended")).toEqual({ label: "Suspenso", tone: "gold" });
    expect(clienteStatusMeta("cancelled")).toEqual({ label: "Ex-cliente", tone: "past" });
    expect(clienteStatusMeta("inadimplente")).toEqual({ label: "Em cobrança", tone: "gold" });
    expect(clienteStatusMeta("qualquer")).toEqual({ label: "qualquer", tone: "now" });
    expect(clienteStatusMeta(null)).toBeNull();
  });
  it("DNA A→ok, B→gold, C→past; NPS e CSAT; banda com espaço; cor da banda de crédito", () => {
    expect(dnaToneOf("A3")).toBe("ok");
    expect(dnaToneOf("B1")).toBe("gold");
    expect(dnaToneOf("C2")).toBe("past");
    expect(npsClasseMeta("promotor")).toEqual({ tone: "ok", label: "Promotor" });
    expect(csatClasseMeta("insatisfeito")).toEqual({ tone: "past", label: "Insatisfeito" });
    expect(bandLabel("muito_baixo_risco")).toBe("muito baixo risco");
    expect(bandLabel(null)).toBe("—");
    expect(corDaBandaDeCredito(800, "low")).toBe("success");
    expect(corDaBandaDeCredito(500, "medium")).toBe("warning");
    expect(corDaBandaDeCredito(200, "high")).toBe("danger");
    expect(corDaBandaDeCredito(null, null)).toBe("muted");
  });
  it("situação real: o contrato vence a pessoa; sem status, a carteira decide", () => {
    expect(situacaoRealDe("active", "ativo")).toBe("ativo");
    expect(situacaoRealDe("cancelled", "ativo")).toBe("ex-cliente");
    expect(situacaoRealDe(null, "ex_cliente")).toBe("ex-cliente");
    expect(situacaoRealDe("", null)).toBeNull();
  });
});

describe("prescrição, risco, resumo, anos", () => {
  const hoje = new Date(2026, 8, 5);
  // Intl escreve "R$ 189,90" com espaço inquebrável; o teste compara com espaço comum.
  const semNbsp = (s: string | null) => s?.replace(/ /g, " ") ?? null;
  it("prescrição: a mais antiga é hoje − dias; prescreve cinco anos depois", () => {
    const p = prescricaoPorAtraso(45, hoje)!;
    expect(p.fatura_mais_antiga).toBe("2026-07-22");
    expect(p.data_prescricao).toBe("2031-07-22");
    expect(p.prescrita).toBe(false);
    expect(p.dias_restantes).toBe(1781);
    expect(prescricaoPorAtraso(0, hoje)).toBeNull();
    const velha = prescricaoPorAtraso(5 * 365 + 40, hoje)!;
    expect(velha.prescrita).toBe(true);
    expect(velha.dias_restantes).toBe(0);
  });
  it("risco do próximo vencimento: propensão primeiro, histórico depois, senão pendente", () => {
    const aVencer = [{ vencimento: "2026-09-20", total: 120 }, { vencimento: "2026-09-10", total: 100 }];
    expect(projecaoRisco({ aVencer, propensao: 71, pctEmDia: 50 })).toEqual({ vencimento: "2026-09-10", valor: 100, risco_pct: 29, fonte: "propensao" });
    expect(projecaoRisco({ aVencer, propensao: null, pctEmDia: 92.4 })).toEqual({ vencimento: "2026-09-10", valor: 100, risco_pct: 8, fonte: "historico" });
    expect(projecaoRisco({ aVencer, propensao: null, pctEmDia: null })!.risco_pct).toBeNull();
    expect(projecaoRisco({ aVencer: [], propensao: 71, pctEmDia: null })).toBeNull();
  });
  it("resumo executivo junta selo, casa, vencido, histórico e LTV com ' · '", () => {
    const selo = classificarSeloPagamento({ emAberto: 189.9, atraso: 47, pagas: 0, pctEmDia: null, mesesCliente: 40 });
    expect(semNbsp(resumoExecutivo({ selo, situacaoReal: "ativo", anosCliente: 3.4, vencido: 189.9, atraso: 47, temFaturas: true, historicoPagamento: null, ltvReceita: 3600 })))
      .toBe("Inadimplente · 3,4 anos de casa · R$ 189,90 vencido há 47d · LTV R$ 3.600,00");
    expect(resumoExecutivo({ selo: null, situacaoReal: "ex-cliente", anosCliente: 1, vencido: 0, atraso: 0, temFaturas: false, historicoPagamento: null, ltvReceita: null }))
      .toBe("Ex-cliente · 1 ano de casa");
    expect(resumoExecutivo({ selo: null, situacaoReal: null, anosCliente: null, vencido: 0, atraso: 0, temFaturas: false, historicoPagamento: null, ltvReceita: null })).toBeNull();
  });
  it("anos de cliente com uma casa decimal", () => {
    expect(anosDeCliente(new Date(2023, 8, 5), hoje)).toBe(3);
    expect(anosDeCliente("2025-03-05", hoje)).toBe(1.5);
    expect(anosDeCliente(null, hoje)).toBeNull();
  });
});
