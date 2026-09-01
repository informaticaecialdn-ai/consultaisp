/**
 * A data vinha de duas fontes que escrevem diferente, e a tela mostrou
 * "16T00:00:00Z/07/1978" para um nascimento real. O formatador precisa
 * aguentar as duas formas.
 */
import { describe, it, expect } from "vitest";
import { dataBr } from "./cadastro-wizard";

describe("dataBr", () => {
  it("data simples da Receita", () => {
    expect(dataBr("2021-01-25")).toBe("25/01/2021");
  });

  it("ISO com horario da BigDataCorp — o caso que quebrou na tela", () => {
    expect(dataBr("1978-07-16T00:00:00Z")).toBe("16/07/1978");
    expect(dataBr("1978-07-16T03:20:11.000Z")).toBe("16/07/1978");
  });

  it("vazio continua vazio", () => {
    expect(dataBr(null)).toBeNull();
    expect(dataBr("")).toBeNull();
  });

  it("o que nao e data ISO volta como veio, sem inventar", () => {
    for (const v of ["16/07/1978", "ontem", "1978", "78-7-16"]) {
      expect(dataBr(v), `entrada ${v}`).toBe(v);
    }
  });
});
