/**
 * As seis faixas de atraso do filtro do quadro, como o dono as escreveu em
 * 06/09/2026. O que este teste protege: a régua não pode ganhar buraco nem
 * sobreposição, e o corte dos 90 dias tem significado de produto — acima
 * disso o cliente dificilmente ainda tem contrato ativo.
 */
import { describe, expect, it } from "vitest";
import {
  FAIXAS_DE_ATRASO,
  LIMITES_DA_FAIXA_DE_ATRASO,
  faixaDeAtrasoDe,
  faixaDeAtrasoValida,
  faixasEmSequencia,
} from "./faixa-atraso";

describe("as seis faixas", () => {
  it("são as que o dono pediu, nesta ordem", () => {
    expect(FAIXAS_DE_ATRASO).toEqual(["ate-7", "8-15", "16-30", "31-60", "61-90", "mais-90"]);
    expect(FAIXAS_DE_ATRASO.map(f => LIMITES_DA_FAIXA_DE_ATRASO[f].rotulo)).toEqual([
      "Até 7 dias", "8 a 15 dias", "16 a 30 dias", "31 a 60 dias", "61 a 90 dias", "Mais de 90 dias",
    ]);
  });

  it("cobrem 1 até o infinito, sem buraco e sem sobreposição", () => {
    expect(faixasEmSequencia()).toBe(true);
    // e a última é a única sem teto
    const semTeto = FAIXAS_DE_ATRASO.filter(f => LIMITES_DA_FAIXA_DE_ATRASO[f].max === null);
    expect(semTeto).toEqual(["mais-90"]);
  });

  it("a faixa de mais de 90 dias diz por que existe: contrato provavelmente não é mais ativo", () => {
    expect(LIMITES_DA_FAIXA_DE_ATRASO["mais-90"].motivo).toMatch(/dificilmente ainda tem contrato ativo/);
    expect(LIMITES_DA_FAIXA_DE_ATRASO["mais-90"].min).toBe(91);
  });

  it("toda faixa explica o que significa para quem cobra", () => {
    for (const f of FAIXAS_DE_ATRASO) expect(LIMITES_DA_FAIXA_DE_ATRASO[f].motivo.length).toBeGreaterThan(20);
  });
});

describe("faixaDeAtrasoDe", () => {
  it("põe cada dia na faixa certa, inclusive nas bordas", () => {
    const casos: Array<[number, string | null]> = [
      [1, "ate-7"], [7, "ate-7"],
      [8, "8-15"], [15, "8-15"],
      [16, "16-30"], [30, "16-30"],
      [31, "31-60"], [60, "31-60"],
      [61, "61-90"], [90, "61-90"],
      [91, "mais-90"], [563, "mais-90"], [6397, "mais-90"],
    ];
    for (const [dias, esperada] of casos) expect(faixaDeAtrasoDe(dias), `${dias} dias`).toBe(esperada);
  });

  it("sem atraso não tem faixa — D0 e negativo são nulos, nunca 'até 7 dias'", () => {
    expect(faixaDeAtrasoDe(0)).toBeNull();
    expect(faixaDeAtrasoDe(-3)).toBeNull();
    expect(faixaDeAtrasoDe(Number.NaN)).toBeNull();
    expect(faixaDeAtrasoDe(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("todo dia de 1 a 400 cai em exatamente uma faixa", () => {
    for (let d = 1; d <= 400; d++) {
      const f = faixaDeAtrasoDe(d);
      expect(f, `${d} dias`).not.toBeNull();
      const quantas = FAIXAS_DE_ATRASO.filter(x => {
        const { min, max } = LIMITES_DA_FAIXA_DE_ATRASO[x];
        return d >= min && (max === null || d <= max);
      });
      expect(quantas, `${d} dias`).toHaveLength(1);
    }
  });
});

describe("faixaDeAtrasoValida", () => {
  it("aceita só as seis, e recusa o que vier da URL sem ser uma delas", () => {
    for (const f of FAIXAS_DE_ATRASO) expect(faixaDeAtrasoValida(f)).toBe(true);
    for (const lixo of ["", "todos", "ate7", "0-7", null, undefined, "mais-90 ", "MAIS-90"]) {
      expect(faixaDeAtrasoValida(lixo as string), String(lixo)).toBe(false);
    }
  });
});
