import { describe, expect, it } from "vitest";
import { numeroPorExtenso, valorPorExtenso } from "./por-extenso";

describe("por extenso", () => {
  it.each([
    [0, "zero"], [1, "um"], [15, "quinze"], [21, "vinte e um"], [100, "cem"], [101, "cento e um"],
    [200, "duzentos"], [999, "novecentos e noventa e nove"], [1000, "mil"], [1100, "mil e cem"],
    [1250, "mil duzentos e cinquenta"], [2020, "dois mil e vinte"], [100000, "cem mil"],
    [1_000_000, "um milhão"], [1_200_000, "um milhão e duzentos mil"], [2_300_020, "dois milhões trezentos mil e vinte"],
  ])("%s → %s", (n, esperado) => {
    expect(numeroPorExtenso(n)).toBe(esperado);
  });
  it("valores em reais: centavos, milhares, singular", () => {
    expect(valorPorExtenso(719.86)).toBe("setecentos e dezenove reais e oitenta e seis centavos");
    expect(valorPorExtenso(1)).toBe("um real");
    expect(valorPorExtenso(1000)).toBe("mil reais");
    expect(valorPorExtenso(0.5)).toBe("cinquenta centavos");
    expect(valorPorExtenso(1250.01)).toBe("mil duzentos e cinquenta reais e um centavo");
    expect(valorPorExtenso(2_000_000)).toBe("dois milhões de reais");
    expect(valorPorExtenso(0)).toBe("zero real");
    expect(valorPorExtenso(99.999)).toBe("cem reais");
  });
  it("recusa o que não é inteiro não negativo", () => {
    expect(() => numeroPorExtenso(-1)).toThrow();
    expect(() => numeroPorExtenso(1.5)).toThrow();
  });
});
