import { describe, it, expect } from "vitest";
import { equipamentosNaDescricao, agregarEquipamentosCobrados } from "./equipamento-na-fatura";

describe("equipamentosNaDescricao", () => {
  /** As tres descricoes abaixo sao texto REAL de faturas da NsLink, medidas
   *  contra a API do MK em 27/08/2026. */
  it("le a fatura real: roteador e smart box, ignorando multa e proporcional", () => {
    const r = equipamentosNaDescricao("Proporcional 40 dias + multa 150,00 + roteador 800,00 + smart box 250,00");
    expect(r.map(e => e.tipo)).toEqual(["ROTEADOR", "TV BOX"]);
    expect(r.map(e => e.valor)).toEqual([800, 250]);
  });

  it("le a variante com 'multa de'", () => {
    const r = equipamentosNaDescricao("Proporcional 40 dias + multa de 550,00 + roteador 800,00 + smart box 350,00");
    expect(r.map(e => e.valor)).toEqual([800, 350]);
  });

  it("NAO conta multa como equipamento — o erro que inflaria o prejuizo", () => {
    expect(equipamentosNaDescricao("Fatura 20/08 + multa 125,00")).toEqual([]);
    expect(equipamentosNaDescricao("Proporcional 40 dias")).toEqual([]);
    expect(equipamentosNaDescricao("Mensalidade novembro")).toEqual([]);
  });

  it("exige VALOR — termo sem preco nao vira equipamento cobrado", () => {
    expect(equipamentosNaDescricao("devolucao de roteador")).toEqual([]);
  });

  it("separa por '+' antes de casar, para nao roubar o valor do item vizinho", () => {
    const r = equipamentosNaDescricao("multa 900,00 + onu 200,00");
    expect(r).toHaveLength(1);
    expect(r[0].tipo).toBe("ONU");
    expect(r[0].valor).toBe(200);
  });

  it("com quantidade, o valor e o ULTIMO numero", () => {
    const r = equipamentosNaDescricao("2 roteadores 800,00");
    expect(r[0].valor).toBe(800);
  });

  it("entende milhar com ponto e decimal com virgula", () => {
    expect(equipamentosNaDescricao("roteador 1.359,73")[0].valor).toBeCloseTo(1359.73);
    expect(equipamentosNaDescricao("roteador 800.50")[0].valor).toBeCloseTo(800.5);
    expect(equipamentosNaDescricao("roteador 800")[0].valor).toBe(800);
  });

  it("ignora acento e caixa", () => {
    expect(equipamentosNaDescricao("ANTENA 300,00")[0].tipo).toBe("ANTENA");
    expect(equipamentosNaDescricao("Rádio 300,00")[0].tipo).toBe("ANTENA");
  });

  it("reconhece o vocabulario de ONU/ONT/modem", () => {
    expect(equipamentosNaDescricao("ONU 200,00")[0].tipo).toBe("ONU");
    expect(equipamentosNaDescricao("ont 210,00")[0].tipo).toBe("ONU");
    expect(equipamentosNaDescricao("modem 190,00")[0].tipo).toBe("MODEM");
  });

  it("nao quebra com vazio, nulo ou lixo", () => {
    expect(equipamentosNaDescricao("")).toEqual([]);
    expect(equipamentosNaDescricao(null)).toEqual([]);
    expect(equipamentosNaDescricao("   + + ")).toEqual([]);
  });

  it("valor zero ou negativo nao conta", () => {
    expect(equipamentosNaDescricao("roteador 0,00")).toEqual([]);
  });
});

describe("agregarEquipamentosCobrados", () => {
  it("soma o prejuizo do cliente", () => {
    const r = agregarEquipamentosCobrados(["multa 150,00 + roteador 800,00 + smart box 250,00"]);
    expect(r.itens).toHaveLength(2);
    expect(r.total).toBe(1050);
  });

  it("deduplica a MESMA cobranca repetida em faturas reemitidas", () => {
    const r = agregarEquipamentosCobrados([
      "roteador 800,00 + smart box 250,00",
      "roteador 800,00 + smart box 250,00",
    ]);
    expect(r.itens).toHaveLength(2);
    expect(r.total).toBe(1050);
  });

  it("mas mantem equipamentos iguais de VALORES diferentes", () => {
    const r = agregarEquipamentosCobrados(["roteador 800,00", "roteador 350,00"]);
    expect(r.itens).toHaveLength(2);
    expect(r.total).toBe(1150);
  });

  it("lista vazia da total zero", () => {
    expect(agregarEquipamentosCobrados([]).total).toBe(0);
    expect(agregarEquipamentosCobrados([null, "", "mensalidade"]).total).toBe(0);
  });
});

describe("armadilhas de vocabulario", () => {
  /** "onus" normalizado e a palavra "onus" (encargo), nao o plural de ONU. */
  it("nao confunde 'onus' com equipamento", () => {
    expect(equipamentosNaDescricao("onus contratual 500,00")).toEqual([]);
  });

  it("aceita plural de roteador e antena", () => {
    expect(equipamentosNaDescricao("2 roteadores 800,00")[0].tipo).toBe("ROTEADOR");
    expect(equipamentosNaDescricao("antenas 300,00")[0].tipo).toBe("ANTENA");
  });
});
