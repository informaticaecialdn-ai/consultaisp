/**
 * A máscara compartilhada do CNPJ.
 *
 * O que ela precisa provar não é "formata bonito" — é que ela dá o MESMO
 * resultado para as duas formas que `providers.cnpj` guardou em produção até
 * 05/09/2026: 14 dígitos crus ("22759562000156") em dois provedores e a
 * pontuação dentro do banco ("23.864.873/0001-48") em quatro. A correção
 * normaliza a coluna para 14 dígitos; para os quatro, essa correção só não é uma
 * regressão visível porque a exibição passou a mascarar.
 *
 * Enquanto a migração não roda em todo ambiente, os dois formatos convivem —
 * então a função tem de aceitar os dois e sair igual nos dois.
 */
import { describe, it, expect } from "vitest";
import { cnpjCru, cnpjMascarado } from "./cnpj";

describe("cnpjCru", () => {
  it("tira a pontuação e devolve os 14 dígitos", () => {
    expect(cnpjCru("23.864.873/0001-48")).toBe("23864873000148");
    expect(cnpjCru("23864873000148")).toBe("23864873000148");
  });

  it("é idempotente — passar duas vezes não muda nada", () => {
    expect(cnpjCru(cnpjCru("23.864.873/0001-48"))).toBe("23864873000148");
  });

  it("corta no décimo quarto dígito", () => {
    // O campo é digitado; sem o corte, uma tecla a mais entraria no estado e
    // depois no corpo do PATCH, onde o servidor exige exatamente 14.
    expect(cnpjCru("238648730001489999")).toBe("23864873000148");
  });

  it("aguenta vazio, nulo e indefinido sem estourar", () => {
    // As telas chamam com `provider?.cnpj`, que é `undefined` enquanto a query
    // não voltou. Estourar aqui derrubaria a página inteira no primeiro render.
    expect(cnpjCru("")).toBe("");
    expect(cnpjCru(null)).toBe("");
    expect(cnpjCru(undefined)).toBe("");
  });
});

describe("cnpjMascarado", () => {
  it("as DUAS formas gravadas em produção saem idênticas na tela", () => {
    // Este é o teste que dá sentido ao módulo. `22759562000156` é o provedor 1
    // (cru) e `23.864.873/0001-48` é o provedor 6 (com a pontuação no banco).
    expect(cnpjMascarado("22759562000156")).toBe("22.759.562/0001-56");
    expect(cnpjMascarado("23.864.873/0001-48")).toBe("23.864.873/0001-48");
    expect(cnpjMascarado("23864873000148")).toBe("23.864.873/0001-48");
  });

  it("mascara em degraus, para o campo poder ser digitado", () => {
    // Um formatador que só saiba mascarar os 14 dígitos completos devolve o
    // número cru enquanto se digita, e o cursor pula a cada tecla.
    expect(cnpjMascarado("12")).toBe("12");
    expect(cnpjMascarado("12345")).toBe("12.345");
    expect(cnpjMascarado("12345678")).toBe("12.345.678");
    expect(cnpjMascarado("123456780001")).toBe("12.345.678/0001");
    expect(cnpjMascarado("12345678000199")).toBe("12.345.678/0001-99");
  });

  it("é idempotente — mascarar o já mascarado não duplica pontuação", () => {
    expect(cnpjMascarado(cnpjMascarado("12345678000199"))).toBe("12.345.678/0001-99");
  });

  it("vazio, nulo e indefinido saem como string vazia, e não como 'undefined'", () => {
    // As telas escrevem `cnpjMascarado(p.cnpj) || "—"`: só o vazio faz o
    // travessão aparecer. Devolver "undefined" imprimiria a palavra na tela.
    expect(cnpjMascarado("")).toBe("");
    expect(cnpjMascarado(null)).toBe("");
    expect(cnpjMascarado(undefined)).toBe("");
  });

  it("um valor com lixo no meio ainda sai formatado", () => {
    // O cadastro público gravou o que foi digitado, sem normalizar nada. Espaço
    // e ponto solto existem na coluna.
    expect(cnpjMascarado(" 23.864.873 / 0001 - 48 ")).toBe("23.864.873/0001-48");
  });
});
