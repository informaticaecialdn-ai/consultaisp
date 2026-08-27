import { describe, expect, it } from "vitest";
import { deslocarPonto, FUZZ_GRAUS } from "./rede-regional.service";

/**
 * O deslocamento da coordenada é a peça de privacidade do mapa da rede: é ele
 * que transforma o endereço de um ex-cliente de outro provedor numa quadra em
 * vez de numa casa. Errar aqui não dá erro — dá ponto no lugar errado, ou
 * ponto que some, ou, pior, ponto que volta ao lugar certo se alguém recarregar
 * a página o bastante.
 */

const LONDRINA: [number, number] = [-23.3103, -51.1628];

const metrosEntre = (a: [number, number], b: [number, number]) => {
  const dLat = (a[0] - b[0]) * 111_320;
  const dLon = (a[1] - b[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
};

describe("deslocamento da coordenada", () => {
  it("nunca produz NaN — nem para o id que gera hash de sinal invertido", () => {
    for (let id = 1; id <= 3000; id++) {
      const d = deslocarPonto(id, LONDRINA[0], LONDRINA[1]);
      expect(Number.isFinite(d.lat), `lat NaN no id ${id}`).toBe(true);
      expect(Number.isFinite(d.lon), `lon NaN no id ${id}`).toBe(true);
    }
  });

  it("fica dentro do raio prometido — nunca joga o ponto para outro bairro", () => {
    const tetoMetros = FUZZ_GRAUS * 111_320 * 1.05; // 5% de folga numérica
    for (let id = 1; id <= 3000; id++) {
      const d = deslocarPonto(id, LONDRINA[0], LONDRINA[1]);
      expect(metrosEntre([d.lat, d.lon], LONDRINA)).toBeLessThanOrEqual(tetoMetros);
    }
  });

  it("mexe de verdade: o ponto não fica onde estava", () => {
    let iguais = 0;
    for (let id = 1; id <= 500; id++) {
      const d = deslocarPonto(id, LONDRINA[0], LONDRINA[1]);
      if (metrosEntre([d.lat, d.lon], LONDRINA) < 5) iguais++;
    }
    // Sorteio uniforme em disco: quase nenhum ponto cai nos 5m centrais.
    expect(iguais).toBeLessThan(5);
  });

  it("é estável — recarregar a página não permite triangular o ponto real", () => {
    const a = deslocarPonto(1196, LONDRINA[0], LONDRINA[1]);
    const b = deslocarPonto(1196, LONDRINA[0], LONDRINA[1]);
    expect(a).toEqual(b);
  });

  it("ids diferentes vão para lados diferentes — o borrão não é um bloco rígido", () => {
    const destinos = new Set(
      Array.from({ length: 200 }, (_, i) => {
        const d = deslocarPonto(i + 1, LONDRINA[0], LONDRINA[1]);
        return `${d.lat.toFixed(5)},${d.lon.toFixed(5)}`;
      }),
    );
    expect(destinos.size).toBeGreaterThan(190);
  });

  it("espalha em todas as direções, não só para um canto", () => {
    let ne = 0, no = 0, se = 0, so = 0;
    for (let id = 1; id <= 400; id++) {
      const d = deslocarPonto(id, LONDRINA[0], LONDRINA[1]);
      const norte = d.lat > LONDRINA[0];
      const leste = d.lon > LONDRINA[1];
      if (norte && leste) ne++; else if (norte) no++; else if (leste) se++; else so++;
    }
    for (const q of [ne, no, se, so]) expect(q).toBeGreaterThan(50);
  });
});
