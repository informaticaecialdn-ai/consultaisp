/**
 * A coordenada do ERP só entra se combinar com a cidade do cadastro.
 *
 * O ERP erra coordenada: a matriz gravada como padrão, o ponto de outro
 * cliente, lat/lon de uma cidade homônima. Gravada como "coordenada do ERP",
 * ela vencia qualquer outra fonte para sempre — e era um dos pontos a
 * quilômetros do endereço.
 */
import { describe, it, expect } from "vitest";
import { coerenteComCidade, RAIO_COERENCIA_KM, coordenadaValida } from "./coordenada";

const LONDRINA = { lat: -23.3045, lng: -51.1696 };

describe("coerenteComCidade", () => {
  it("ponto dentro da cidade passa", () => {
    expect(coerenteComCidade(-23.32, -51.15, LONDRINA)).toBe(true);
  });

  it("ponto na cidade vizinha, a ~45 km, não passa", () => {
    // Apucarana fica a ~50 km de Londrina em linha reta.
    expect(coerenteComCidade(-23.5505, -51.4610, LONDRINA)).toBe(false);
  });

  it("ponto a 300 km — a matriz gravada como padrão — não passa", () => {
    expect(coerenteComCidade(-25.4284, -49.2733, LONDRINA)).toBe(false);   // Curitiba
  });

  it("sem centro conhecido não se acusa", () => {
    expect(coerenteComCidade(-25.4284, -49.2733, null)).toBe(true);
    expect(coerenteComCidade(-25.4284, -49.2733, undefined)).toBe(true);
  });

  it("o raio é o de cidades vizinhas, não de estados", () => {
    expect(RAIO_COERENCIA_KM).toBeLessThanOrEqual(40);
  });
});

describe("coordenadaValida continua recusando o que não é ponto", () => {
  it("vazio, (0,0), texto e fora do Brasil", () => {
    expect(coordenadaValida("", "")).toBeNull();
    expect(coordenadaValida("0", "0")).toBeNull();
    expect(coordenadaValida("abc", "-51")).toBeNull();
    expect(coordenadaValida("48.85", "2.35")).toBeNull();
  });

  it("aceita vírgula decimal e texto numérico", () => {
    expect(coordenadaValida("-23,31", "-51,16")).toEqual({ lat: -23.31, lng: -51.16 });
  });
});
