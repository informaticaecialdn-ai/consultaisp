import { describe, expect, it } from "vitest";
import { coordenadaValida, dentroDoBrasil } from "./coordenada";

/**
 * A coordenada do ERP é a melhor que existe — e é exatamente por isso que ela
 * precisa passar por um portão. Campo de texto livre no ERP recebe de tudo:
 * vazio, "N/A", vírgula decimal, e o (0,0) que significa "não informado" e
 * plota o cliente no meio do Atlântico.
 */

describe("aceita o que o ERP manda de verdade", () => {
  it("par válido de Londrina", () => {
    expect(coordenadaValida("-23.3103", "-51.1628")).toEqual({ lat: -23.3103, lng: -51.1628 });
  });

  it("número, não só string", () => {
    expect(coordenadaValida(-23.3103, -51.1628)).toEqual({ lat: -23.3103, lng: -51.1628 });
  });

  it("vírgula decimal — o ERP brasileiro escreve assim", () => {
    expect(coordenadaValida("-23,3103", "-51,1628")).toEqual({ lat: -23.3103, lng: -51.1628 });
  });

  it("espaço em volta não invalida", () => {
    expect(coordenadaValida("  -23.3103  ", " -51.1628 ")).toEqual({ lat: -23.3103, lng: -51.1628 });
  });

  it("latitude 0 é legítima quando a longitude é brasileira — o equador corta o Amapá", () => {
    expect(coordenadaValida("0", "-51.0")).toEqual({ lat: 0, lng: -51 });
  });
});

describe("recusa o que estragaria o mapa", () => {
  it("(0,0) é 'não informado', não o golfo da Guiné", () => {
    expect(coordenadaValida("0", "0")).toBeNull();
    expect(coordenadaValida(0, 0)).toBeNull();
    expect(coordenadaValida("0.0", "0.000000")).toBeNull();
  });

  it("vazio, nulo e indefinido", () => {
    expect(coordenadaValida("", "")).toBeNull();
    expect(coordenadaValida("   ", "-51.16")).toBeNull();
    expect(coordenadaValida(null, null)).toBeNull();
    expect(coordenadaValida(undefined, undefined)).toBeNull();
    expect(coordenadaValida("-23.31", undefined)).toBeNull();
  });

  it("texto que não é número", () => {
    expect(coordenadaValida("N/A", "N/A")).toBeNull();
    expect(coordenadaValida("null", "-51.16")).toBeNull();
    expect(coordenadaValida("-23.31°", "-51.16")).toBeNull();
    expect(coordenadaValida("-23.31.5", "-51.16")).toBeNull();
  });

  it("fora do Brasil — cadastro trocado ou coordenada invertida", () => {
    expect(coordenadaValida("48.8566", "2.3522")).toBeNull();      // Paris
    expect(coordenadaValida("-51.1628", "-23.3103")).toBeNull();   // lat/lng trocadas
  });

  it("fora de faixa geográfica", () => {
    expect(coordenadaValida("-91", "-51")).toBeNull();
    expect(coordenadaValida("-23", "-181")).toBeNull();
  });
});

describe("dentroDoBrasil", () => {
  it("cobre as pontas do país", () => {
    expect(dentroDoBrasil(-23.31, -51.16)).toBe(true);   // Londrina
    expect(dentroDoBrasil(2.8, -60.7)).toBe(true);       // Boa Vista
    expect(dentroDoBrasil(-33.5, -53.4)).toBe(true);     // Chuí
    expect(dentroDoBrasil(-34.6, -58.4)).toBe(false);    // Buenos Aires
  });
});
