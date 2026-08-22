import { describe, it, expect } from "vitest";
import {
  distanciaKm, mediana, centroMediano, separarCoordenadasSuspeitas,
} from "./coordenada-suspeita";

/** Cornelio Procopio, PR — centro da cidade. */
const CP = { lat: -23.1811, lon: -50.6467 };
/** Sao Paulo capital — o erro real encontrado na carteira de demonstracao. */
const SP = { lat: -23.5505, lon: -46.6340 };

/** Clientes espalhados dentro da propria cidade, poucos km do centro. */
function carteiraDe(cidade: string, centro: { lat: number; lon: number }, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    cidade,
    lat: centro.lat + (i % 5) * 0.004 - 0.008,
    lon: centro.lon + (i % 3) * 0.005 - 0.005,
  }));
}

describe("distanciaKm", () => {
  it("da zero para o mesmo ponto", () => {
    expect(distanciaKm(CP.lat, CP.lon, CP.lat, CP.lon)).toBe(0);
  });

  it("mede Cornelio Procopio ate Sao Paulo em ~410km", () => {
    const d = distanciaKm(CP.lat, CP.lon, SP.lat, SP.lon);
    expect(d).toBeGreaterThan(390);
    expect(d).toBeLessThan(430);
  });

  it("e simetrica", () => {
    expect(distanciaKm(CP.lat, CP.lon, SP.lat, SP.lon))
      .toBeCloseTo(distanciaKm(SP.lat, SP.lon, CP.lat, CP.lon), 6);
  });
});

describe("mediana", () => {
  it("pega o central em lista impar", () => {
    expect(mediana([3, 1, 2])).toBe(2);
  });

  it("media os dois centrais em lista par", () => {
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
  });

  it("nao se desloca por um valor extremo", () => {
    expect(mediana([1, 2, 3, 4, 1000])).toBe(3);
  });

  it("da NaN para lista vazia", () => {
    expect(mediana([])).toBeNaN();
  });
});

describe("centroMediano", () => {
  it("ignora o outlier ao calcular o centro", () => {
    const pontos = [...carteiraDe("CP", CP, 9), { cidade: "CP", ...SP }];
    const centro = centroMediano(pontos);
    expect(distanciaKm(centro.lat, centro.lon, CP.lat, CP.lon)).toBeLessThan(5);
  });
});

describe("separarCoordenadasSuspeitas", () => {
  it("separa o ponto em Sao Paulo declarado como Cornelio Procopio", () => {
    const errado = { cidade: "Cornelio Procopio", ...SP };
    const { coerentes, suspeitos } = separarCoordenadasSuspeitas(
      [...carteiraDe("Cornelio Procopio", CP, 18), errado],
    );
    expect(suspeitos).toEqual([errado]);
    expect(coerentes).toHaveLength(18);
  });

  it("nao acusa ninguem quando a carteira e coerente", () => {
    const { suspeitos } = separarCoordenadasSuspeitas(carteiraDe("Ibaiti", CP, 20));
    expect(suspeitos).toEqual([]);
  });

  it("julga cada cidade pelo proprio centro, nao pelo centro geral", () => {
    // Duas cidades a ~400km. Sem agrupar por cidade, o centro geral cairia no
    // meio do caminho e as duas carteiras inteiras virariam suspeitas.
    const pontos = [...carteiraDe("Cornelio Procopio", CP, 10), ...carteiraDe("Sao Paulo", SP, 10)];
    expect(separarCoordenadasSuspeitas(pontos).suspeitos).toEqual([]);
  });

  it("nao julga cidade com poucos pontos para nao acusar errado", () => {
    // Dois clientes distantes entre si: sem massa nao da para dizer qual erra.
    const pontos = [
      { cidade: "Assai", ...CP },
      { cidade: "Assai", ...SP },
    ];
    expect(separarCoordenadasSuspeitas(pontos).suspeitos).toEqual([]);
  });

  it("respeita o raio informado", () => {
    const vizinho = { cidade: "CP", lat: CP.lat + 0.5, lon: CP.lon };  // ~55km
    const pontos = [...carteiraDe("CP", CP, 10), vizinho];
    expect(separarCoordenadasSuspeitas(pontos, 50).suspeitos).toEqual([vizinho]);
    expect(separarCoordenadasSuspeitas(pontos, 100).suspeitos).toEqual([]);
  });

  it("preserva a ordem de entrada", () => {
    const errado = { cidade: "CP", ...SP };
    const base = carteiraDe("CP", CP, 10);
    const { coerentes } = separarCoordenadasSuspeitas([base[0], errado, base[1], ...base.slice(2)]);
    expect(coerentes[0]).toBe(base[0]);
    expect(coerentes[1]).toBe(base[1]);
  });

  it("trata cidade com caixa e espaco diferentes como a mesma", () => {
    const pontos = [
      ...carteiraDe("Cornelio Procopio", CP, 5),
      ...carteiraDe("  CORNELIO PROCOPIO  ", CP, 5),
      { cidade: "cornelio procopio", ...SP },
    ];
    expect(separarCoordenadasSuspeitas(pontos).suspeitos).toHaveLength(1);
  });

  it("aguenta lista vazia", () => {
    expect(separarCoordenadasSuspeitas([])).toEqual({ coerentes: [], suspeitos: [] });
  });
});
