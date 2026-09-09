/**
 * A cobranca de saida (multa + equipamento) lida da descricao da fatura — as
 * frases sao as REAIS de producao (NsLink/MK e NG/IXC, 09/09/2026). O que se
 * prova: valor nomeado sai exato; palavra sem valor vira a fatura inteira so
 * quando nao ha mensalidade junto; mistura sem valores e indeterminada (fica
 * como divida); negacao nao e multa; nada passa do valor da fatura.
 */
import { describe, expect, it } from "vitest";
import { parcelasDaDescricao, somarCobrancaDeSaida, valorBrasileiro } from "./multa";

describe("valorBrasileiro", () => {
  it("le milhar com ponto e centavos com virgula, e o inteiro cru", () => {
    expect(valorBrasileiro("1.083,33")).toBe(1083.33);
    expect(valorBrasileiro("1083,33")).toBe(1083.33);
    expect(valorBrasileiro("600,00")).toBe(600);
    expect(valorBrasileiro("1.083")).toBe(1083);
    expect(valorBrasileiro("800")).toBe(800);
    expect(valorBrasileiro("599.82")).toBe(599.82);
  });
});

describe("parcelasDaDescricao — as frases da NsLink (MK)", () => {
  it("multa e equipamento nomeados saem exatos; o resto e mensalidade", () => {
    expect(parcelasDaDescricao("Proporcional 40 dias + multa 600,00", 719.86)).toEqual({ multa: 600, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("Proporcional 40 dias + multa de 600,00", 719.86)).toEqual({ multa: 600, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("2 Mensalidades 199,80 + multa 1.083,33 + equipamento 800,00", 2083.13)).toEqual({ multa: 1083.33, equipamento: 800, indeterminada: false });
    expect(parcelasDaDescricao("2 Mensalidades 119,80 + multa 1083,33", 1203.13)).toEqual({ multa: 1083.33, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("2 Mensalidades 199,80 + multa 866,67 + equipamento quebrado 800,00", 1866.47)).toEqual({ multa: 866.67, equipamento: 800, indeterminada: false });
    expect(parcelasDaDescricao("2 Mensalidades 199,80 + multa 500,00+ equipamento 800,00", 1499.8)).toEqual({ multa: 500, equipamento: 800, indeterminada: false });
    expect(parcelasDaDescricao("Proporcional 40 dias + equipamento 800,00", 919.86)).toEqual({ multa: 0, equipamento: 800, indeterminada: false });
    expect(parcelasDaDescricao("2 Mensalidades 199,80 + multa 500,00 + 800,00 equipamento", 1499.8)).toEqual({ multa: 500, equipamento: 800, indeterminada: false });
  });
  it("valor solto depois da multa ('+ 800,00') NAO vira equipamento: sub-ler e seguro, inventar nao", () => {
    expect(parcelasDaDescricao("2 Mensalidades 199,80 + multa 500,00 + 800,00", 1499.8)).toEqual({ multa: 500, equipamento: 0, indeterminada: false });
  });
  it("mistura sem valores ('2 Mensalidades + multa', '+ multa + juros') e INDETERMINADA — fica como divida", () => {
    expect(parcelasDaDescricao("2 Mensalidades + multa", 700)).toEqual({ multa: 0, equipamento: 0, indeterminada: true });
    expect(parcelasDaDescricao("2 Mensalidades + multa + juros", 720)).toEqual({ multa: 0, equipamento: 0, indeterminada: true });
  });
  it("o que nao fala de multa nem equipamento e mensalidade, ponto", () => {
    expect(parcelasDaDescricao("Faturamento 09/2026", 89.9)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("Ref.: Smart 800MB", 89.9)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("Proporcional 40 dias", 119.86)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao(null, 89.9)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
  });
});

describe("parcelasDaDescricao — as frases da NG (IXC)", () => {
  it("fatura INTEIRA de multa ou de equipamento, quando nao ha mensalidade junto", () => {
    expect(parcelasDaDescricao("referente a multa de rescisão", 500)).toEqual({ multa: 500, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("multa rescisória", 215)).toEqual({ multa: 215, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("Ref. Valor de equipamento não devolvido", 755)).toEqual({ multa: 0, equipamento: 755, indeterminada: false });
    expect(parcelasDaDescricao("referente aos equipamentos", 369)).toEqual({ multa: 0, equipamento: 369, indeterminada: false });
    expect(parcelasDaDescricao("Referente ao equipamento.", 346)).toEqual({ multa: 0, equipamento: 346, indeterminada: false });
  });
  it("mistura sem valores ('multa + parcela', 'dias de uso + Multa') e indeterminada", () => {
    expect(parcelasDaDescricao("referente a multa + parcela", 688)).toEqual({ multa: 0, equipamento: 0, indeterminada: true });
    expect(parcelasDaDescricao("referente a parcela + multa", 586)).toEqual({ multa: 0, equipamento: 0, indeterminada: true });
    expect(parcelasDaDescricao("Referente aos dias de uso + Multa", 708)).toEqual({ multa: 0, equipamento: 0, indeterminada: true });
    expect(parcelasDaDescricao("referente a multa + mensalidade", 720)).toEqual({ multa: 0, equipamento: 0, indeterminada: true });
  });
  it("negacao: 'não possui multa' nao e multa", () => {
    expect(parcelasDaDescricao("Referente aos dias de uso, não possui multa", 107)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("Sem multa", 107)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
  });
});

describe("parcelasDaDescricao — os limites", () => {
  it("nunca acima do valor da fatura, e fatura sem valor nao rende nada", () => {
    expect(parcelasDaDescricao("multa 600,00 + equipamento 800,00", 1000)).toEqual({ multa: 600, equipamento: 400, indeterminada: false });
    expect(parcelasDaDescricao("multa 900,00", 500)).toEqual({ multa: 500, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("multa 600,00", 0)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("multa 600,00", NaN)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
  });
  it("somar: varias faturas do mesmo cliente, com as indeterminadas contadas", () => {
    expect(somarCobrancaDeSaida([
      { descricao: "Proporcional 40 dias + multa 600,00", valor: 719.86 },
      { descricao: "referente ao equipamento", valor: 300 },
      { descricao: "2 Mensalidades + multa", valor: 700 },
    ])).toEqual({ multa: 600, equipamento: 300, indeterminadas: 1, faturas: 3 });
    expect(somarCobrancaDeSaida([])).toEqual({ multa: 0, equipamento: 0, indeterminadas: 0, faturas: 0 });
  });
});

describe("parcelasDaDescricao — o que a revisao adversarial de 09/09/2026 derrubou", () => {
  it("valor em dinheiro que a regex nao amarrou NAO vira fatura inteira: fica indeterminado", () => {
    expect(parcelasDaDescricao("multa rescisória, total 350,00", 500)).toEqual({ multa: 0, equipamento: 0, indeterminada: true });
    expect(parcelasDaDescricao("equipamento não devolvido — R$ 799,90 (ver contrato)", 900)).toEqual({ multa: 0, equipamento: 0, indeterminada: true });
  });
  it("'multa' de MORA (juros/atraso) sem qualificador de saida nao e cobranca de saida", () => {
    expect(parcelasDaDescricao("multa e juros por atraso", 12.5)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("Mensalidade 89,90 + multa 2,00 + juros 1,20", 93.1)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
    // Com qualificador, a multa e de saida mesmo com juros no texto.
    expect(parcelasDaDescricao("multa rescisória 500,00 + juros", 520)).toEqual({ multa: 500, equipamento: 0, indeterminada: false });
  });
  it("negacoes fora do padrao inicial: 'nao sera cobrada multa', 'equipamento devolvido', 'sem equipamento', 'inclui equipamento'", () => {
    expect(parcelasDaDescricao("Cancelamento — não será cobrada multa", 89.9)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("Equipamento devolvido — proporcional 12 dias", 35.96)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("Sem equipamento", 89.9)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("Plano Smart 800MB inclui equipamento", 89.9)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("Equipamento em comodato", 89.9)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
  });
  it("contagem, data, fracao e percentual nao sao dinheiro", () => {
    expect(parcelasDaDescricao("multa 2 parcelas de 300,00", 600)).toEqual({ multa: 0, equipamento: 0, indeterminada: true });
    expect(parcelasDaDescricao("multa 10% + mensalidade", 98.89)).toEqual({ multa: 0, equipamento: 0, indeterminada: true });
    expect(parcelasDaDescricao("multa 12/2025", 500)).toEqual({ multa: 500, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("equipamento 2 x 400,00", 800)).toEqual({ multa: 0, equipamento: 0, indeterminada: true });
  });
  it("vocabulario unico: roteador/onu/modem valem como equipamento, com e sem valor", () => {
    expect(parcelasDaDescricao("modem 150,00", 500)).toEqual({ multa: 0, equipamento: 150, indeterminada: false });
    expect(parcelasDaDescricao("Referente à ONU não devolvida", 320)).toEqual({ multa: 0, equipamento: 320, indeterminada: false });
    expect(parcelasDaDescricao("Mensalidade 99,90 + roteador 250,00", 349.9)).toEqual({ multa: 0, equipamento: 250, indeterminada: false });
  });
  it("um item com valor e o outro sem: o nomeado sai, o resto fica como divida, sem marcar indeterminada", () => {
    expect(parcelasDaDescricao("multa 500,00 + equipamento", 1300)).toEqual({ multa: 500, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("multa rescisória + equipamento 800,00", 1300)).toEqual({ multa: 0, equipamento: 800, indeterminada: false });
  });
  it("as frases reais continuam saindo iguais depois das regras novas", () => {
    expect(parcelasDaDescricao("Proporcional 40 dias + multa 600,00", 719.86)).toEqual({ multa: 600, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("2 Mensalidades 199,80 + multa 1.083,33 + equipamento 800,00", 2083.13)).toEqual({ multa: 1083.33, equipamento: 800, indeterminada: false });
    expect(parcelasDaDescricao("referente a multa de rescisão", 500)).toEqual({ multa: 500, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("Ref. Valor de equipamento não devolvido", 755)).toEqual({ multa: 0, equipamento: 755, indeterminada: false });
    expect(parcelasDaDescricao("Referente aos dias de uso, não possui multa", 107)).toEqual({ multa: 0, equipamento: 0, indeterminada: false });
    expect(parcelasDaDescricao("2 Mensalidades + multa + juros", 720)).toEqual({ multa: 0, equipamento: 0, indeterminada: true });
  });
});
