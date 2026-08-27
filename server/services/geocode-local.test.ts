import { describe, expect, it } from "vitest";
import { nucleoDenso } from "./geocode-local.service";

/**
 * O nome do bairro no censo não é único dentro do município: Londrina tem sete
 * distritos rurais, e cada um tem o seu "CENTRO". Agrupados pelo nome, o
 * conjunto cobre 12,5 km — e espalhar um cliente do centro sobre ele o joga na
 * zona rural, num ponto que parece tão real quanto qualquer outro.
 */

const LONDRINA: [number, number] = [-23.3103, -51.1628];

/** Nuvem de pontos ao redor de um centro, com raio em graus. */
const nuvem = (centro: [number, number], n: number, raio: number): Array<[number, number]> =>
  Array.from({ length: n }, (_, i) => [
    centro[0] + Math.sin(i * 2.4) * raio * ((i % 7) / 7),
    centro[1] + Math.cos(i * 2.4) * raio * ((i % 5) / 5),
  ] as [number, number]);

const extensaoKm = (p: Array<[number, number]>) => {
  const lats = p.map(x => x[0]);
  return (Math.max(...lats) - Math.min(...lats)) * 111.32;
};

describe("nucleoDenso", () => {
  it("corta o povoado distante e mantém o miolo", () => {
    const centroUrbano = nuvem(LONDRINA, 200, 0.012);          // ~1,3 km
    const distritoRural = nuvem([-23.20, -51.05], 20, 0.005);  // ~13 km dali
    const nucleo = nucleoDenso([...centroUrbano, ...distritoRural]);

    expect(nucleo.length).toBeGreaterThan(150);
    expect(extensaoKm(nucleo)).toBeLessThan(4);
    expect(extensaoKm([...centroUrbano, ...distritoRural])).toBeGreaterThan(10);
  });

  it("bairro compacto e legítimo passa quase inteiro", () => {
    const b = nuvem(LONDRINA, 120, 0.008);
    expect(nucleoDenso(b).length).toBeGreaterThan(100);
  });

  it("bairro alongado não é decepado — a régua se ajusta ao formato", () => {
    // Bairro que segue uma avenida: 4 km de comprimento, legítimo.
    const avenida: Array<[number, number]> = Array.from({ length: 100 }, (_, i) => [
      LONDRINA[0] + (i / 100) * 0.036, LONDRINA[1] + (i % 3) * 0.0004,
    ]);
    expect(nucleoDenso(avenida).length).toBeGreaterThan(70);
  });

  it("conjunto pequeno passa intacto — não há miolo a estimar", () => {
    const poucos = nuvem(LONDRINA, 5, 0.05);
    expect(nucleoDenso(poucos)).toHaveLength(5);
  });

  it("nunca devolve vazio", () => {
    for (const n of [1, 2, 8, 50]) {
      expect(nucleoDenso(nuvem(LONDRINA, n, 0.02)).length).toBeGreaterThan(0);
    }
  });

  it("pontos todos iguais não quebram a divisão", () => {
    const iguais: Array<[number, number]> = Array.from({ length: 20 }, () => [...LONDRINA] as [number, number]);
    expect(nucleoDenso(iguais)).toHaveLength(20);
  });
});
