import { describe, it, expect } from "vitest";
import { agregarRede, deslocarPonto, FUZZ_GRAUS, MIN_POR_BAIRRO, type LinhaRede } from "./rede-regional.service";
import type { CentroidesPorCidade } from "./geo-bases.service";

/**
 * O caso real de 02/09/2026: em Londrina, 4.323 ex-clientes com dívida tinham
 * coordenada do sync antigo (sem procedência, no centro da cidade com ruído).
 * A mediana por bairro caía no mesmo quarteirão e as 206 bolhas se
 * empilhavam. A bolha tem que ficar no centro do bairro pelo censo.
 */

// Centro de Londrina, onde o sync antigo despejava tudo.
const CENTRO = { lat: -23.3273, lon: -51.1504 };

let seq = 1;
function linha(over: Partial<LinhaRede> & { neighborhood: string }): LinhaRede {
  return {
    id: seq++,
    providerId: 1,
    latitude: CENTRO.lat + (Math.sin(seq) * 0.004),
    longitude: CENTRO.lon + (Math.cos(seq) * 0.004),
    city: "Londrina",
    totalOverdueAmount: "150.00",
    geoPrecisao: null,
    ...over,
  };
}

const centroides: CentroidesPorCidade = new Map([
  ["LONDRINA", [
    { bairroNorm: "UNIAO DA VITORIA", lat: -23.3612, lon: -51.1285, enderecos: 2621 },
    { bairroNorm: "CALIFORNIA", lat: -23.3369, lon: -51.1352, enderecos: 2955 },
    { bairroNorm: "LEONOR", lat: -23.2927, lon: -51.1976, enderecos: 2013 },
  ]],
]);

describe("agregarRede — onde a bolha do bairro fica", () => {
  it("ancora no centro do bairro pelo IBGE, mesmo com todas as coordenadas da carteira empilhadas no centro da cidade", () => {
    const linhas = [
      ...Array.from({ length: 5 }, () => linha({ neighborhood: "Jardim União da Vitória II" })),
      ...Array.from({ length: 4 }, () => linha({ neighborhood: "Califórnia", providerId: 2 })),
    ];
    const r = agregarRede(linhas, ["Londrina - PR"], centroides);

    expect(r.bairros.map(b => b.bairro)).toEqual(["Jardim União da Vitória II", "Califórnia"]);
    const uniao = r.bairros[0];
    expect(uniao).toMatchObject({ ocorrencias: 5, provedores: 1, ancora: "ibge", lat: -23.3612, lon: -51.1285 });
    expect(r.bairros[1]).toMatchObject({ ocorrencias: 4, ancora: "ibge", lat: -23.3369, lon: -51.1352 });
    // As duas bolhas ficam a quilômetros uma da outra — não no mesmo quarteirão.
    expect(Math.abs(uniao.lat! - r.bairros[1].lat!)).toBeGreaterThan(0.02);
  });

  it("coordenada sem procedência não vira ponto nem âncora: conta na bolha e em semPonto", () => {
    const linhas = Array.from({ length: 3 }, () => linha({ neighborhood: "Leonor" }));
    const r = agregarRede(linhas, ["Londrina"], centroides);
    expect(r.bairros[0]).toMatchObject({ ocorrencias: 3, ancora: "ibge" });
    expect(r.pontos).toHaveLength(0);
    expect(r.semPonto).toBe(3);
  });

  it("sem o bairro no IBGE, ancora na mediana das coordenadas CONFIÁVEIS (erp/endereço/rua/cep) e ignora as demais", () => {
    const linhas = [
      linha({ neighborhood: "Chácara Fora do Censo", geoPrecisao: "erp", latitude: -23.40, longitude: -51.20 }),
      linha({ neighborhood: "Chácara Fora do Censo", geoPrecisao: "endereco", latitude: -23.41, longitude: -51.21 }),
      linha({ neighborhood: "Chácara Fora do Censo", geoPrecisao: "logradouro", latitude: -23.42, longitude: -51.22 }),
      // aproximação e sem procedência: fora da mediana e dos pontos
      linha({ neighborhood: "Chácara Fora do Censo", geoPrecisao: "bairro", latitude: -23.10, longitude: -51.00 }),
      linha({ neighborhood: "Chácara Fora do Censo", geoPrecisao: null, latitude: CENTRO.lat, longitude: CENTRO.lon }),
    ];
    const r = agregarRede(linhas, ["Londrina"], centroides);
    expect(r.bairros[0]).toMatchObject({ ocorrencias: 5, ancora: "carteira", lat: -23.41, lon: -51.21 });
    expect(r.pontos).toHaveLength(3);
    expect(r.semPonto).toBe(2);
    // Cada ponto sai deslocado, dentro do raio prometido.
    for (const p of r.pontos) {
      expect(Math.abs(p.lat + 23.41)).toBeLessThan(0.02);
      expect(p.ref).toMatch(/^r\d+$/);
    }
  });

  it("sem IBGE e sem coordenada confiável, o bairro entra no ranking sem posição", () => {
    const linhas = Array.from({ length: 3 }, () => linha({ neighborhood: "Chácara Fora do Censo" }));
    const r = agregarRede(linhas, ["Londrina"], centroides);
    expect(r.bairros[0]).toMatchObject({ ocorrencias: 3, lat: null, lon: null, ancora: null });
  });

  it("piso e recorte de cidade continuam valendo", () => {
    const linhas = [
      ...Array.from({ length: MIN_POR_BAIRRO - 1 }, () => linha({ neighborhood: "Leonor" })),
      linha({ neighborhood: "Califórnia", city: "Cambé" }),
      linha({ neighborhood: "Califórnia", city: "Cambé" }),
      linha({ neighborhood: "Califórnia", city: "Cambé" }),
    ];
    const r = agregarRede(linhas, ["Londrina - PR"], centroides);
    expect(r.bairros).toHaveLength(0);
    expect(r.ocultas).toBe(MIN_POR_BAIRRO - 1);
    expect(r.pontos).toHaveLength(0);
  });

  it("variações do mesmo bairro somam numa bolha só, casada com o censo pelo núcleo do nome", () => {
    const linhas = [
      linha({ neighborhood: "Jardim União da Vitória II" }),
      linha({ neighborhood: "Jardim Uniao da Vitoria" }),
      linha({ neighborhood: "VILA UNIAO DA VITORIA" }),
    ];
    const r = agregarRede(linhas, ["Londrina"], centroides);
    expect(r.bairros).toHaveLength(1);
    expect(r.bairros[0]).toMatchObject({ ocorrencias: 3, ancora: "ibge", lat: -23.3612 });
  });
});

describe("deslocarPonto", () => {
  it("é estável e fica dentro do raio", () => {
    const a = deslocarPonto(42, -23.31, -51.16);
    const b = deslocarPonto(42, -23.31, -51.16);
    expect(a).toEqual(b);
    expect(Math.abs(a.lat + 23.31)).toBeLessThanOrEqual(FUZZ_GRAUS);
    expect(Math.abs(a.lon + 51.16)).toBeLessThanOrEqual(FUZZ_GRAUS / Math.cos((23.31 * Math.PI) / 180) + 1e-9);
  });
});
