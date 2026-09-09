import { describe, it, expect } from "vitest";
import { agregarRede, deslocarPonto, FUZZ_GRAUS, MIN_POR_BAIRRO, type LinhaRede } from "./rede-regional.service";
import type { CentroidesPorCidade } from "./geo-bases.service";

/**
 * Duas regras do dono, ambas de 02/09/2026:
 *
 * 1. "Só mostrar ex-clientes com dívida; dados da rede somente o ponto no
 *    mapa, sem informações" — o payload é posição e contagem, e nada mais.
 * 2. A bolha fica no centro do bairro pelo censo. Em Londrina, 4.323
 *    ex-clientes tinham coordenada do sync antigo (sem procedência, no centro
 *    da cidade com ruído); a mediana por bairro caía no mesmo quarteirão e as
 *    206 bolhas se empilhavam.
 */

// Centro de Londrina, onde o sync antigo despejava tudo.
const CENTRO = { lat: -23.3273, lon: -51.1504 };

let seq = 1;
/** Quem está olhando a rede nos testes. */
const OBSERVADOR = 1;
/** Um provedor qualquer que não é o observador. */
const OUTRO = 99;
function linha(over: Partial<LinhaRede> & { neighborhood: string }): LinhaRede {
  return {
    id: seq++,
    providerId: OUTRO,
    latitude: CENTRO.lat + (Math.sin(seq) * 0.004),
    longitude: CENTRO.lon + (Math.cos(seq) * 0.004),
    city: "Londrina",
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

describe("agregarRede — só o ponto no mapa", () => {
  it("o payload é posição e contagem: nenhum nome de bairro, valor, provedor ou referência sai do servidor", () => {
    const linhas = [
      ...Array.from({ length: 3 }, () => linha({ neighborhood: "Jardim União da Vitória II", geoPrecisao: "erp" })),
    ];
    const r = agregarRede(linhas, ["Londrina - PR"], centroides, OBSERVADOR);
    expect(r.bairros).toHaveLength(1);
    expect(Object.keys(r.bairros[0]).sort()).toEqual(["cidade", "lat", "lon", "ocorrencias"]);
    expect(r.pontos).toHaveLength(3);
    expect(Object.keys(r.pontos[0]).sort()).toEqual(["cidade", "lat", "lon"]);
    expect(JSON.stringify(r)).not.toMatch(/Vit[oó]ria|divida|provedor|faixa|ref/i);
  });
});

describe("agregarRede — onde a bolha do bairro fica", () => {
  it("ancora no centro do bairro pelo IBGE, mesmo com todas as coordenadas da carteira empilhadas no centro da cidade", () => {
    const linhas = [
      ...Array.from({ length: 5 }, () => linha({ neighborhood: "Jardim União da Vitória II" })),
      ...Array.from({ length: 4 }, () => linha({ neighborhood: "Califórnia" })),
    ];
    const r = agregarRede(linhas, ["Londrina - PR"], centroides, OBSERVADOR);

    expect(r.bairros.map(b => b.ocorrencias)).toEqual([5, 4]);
    const uniao = r.bairros[0];
    expect(uniao).toMatchObject({ cidade: "Londrina", ocorrencias: 5, lat: -23.3612, lon: -51.1285 });
    expect(r.bairros[1]).toMatchObject({ ocorrencias: 4, lat: -23.3369, lon: -51.1352 });
    // As duas bolhas ficam a quilômetros uma da outra — não no mesmo quarteirão.
    expect(Math.abs(uniao.lat! - r.bairros[1].lat!)).toBeGreaterThan(0.02);
  });

  it("coordenada sem procedência não vira ponto nem âncora: conta na bolha e em semPonto", () => {
    const linhas = Array.from({ length: 3 }, () => linha({ neighborhood: "Leonor" }));
    const r = agregarRede(linhas, ["Londrina"], centroides, OBSERVADOR);
    expect(r.bairros[0]).toMatchObject({ ocorrencias: 3, lat: -23.2927, lon: -51.1976 });
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
    const r = agregarRede(linhas, ["Londrina"], centroides, OBSERVADOR);
    expect(r.bairros[0]).toMatchObject({ ocorrencias: 5, lat: -23.41, lon: -51.21 });
    expect(r.pontos).toHaveLength(3);
    expect(r.semPonto).toBe(2);
    // Cada ponto sai deslocado, dentro do raio prometido.
    for (const p of r.pontos) expect(Math.abs(p.lat + 23.41)).toBeLessThan(0.02);
  });

  /* DECISÃO EXPLÍCITA, 04/09/2026. O ponto de procedência `vizinho` é a mediana
     de instalações da MESMA carteira que este mapa agrega. Deixá-lo entrar aqui
     seria contá-lo como endereço apurado, e o mapa entre provedores afirmaria a
     casa exatamente onde o mapa do dono diz que não sabe. Ele conta na bolha do
     bairro e em `semPonto` — que é o lugar honesto dele. */
  it("o ponto tirado da própria carteira não vira ponto nem âncora da rede", () => {
    const linhas = [
      linha({ neighborhood: "Chácara Fora do Censo", geoPrecisao: "vizinho", latitude: -23.40, longitude: -51.20 }),
      linha({ neighborhood: "Chácara Fora do Censo", geoPrecisao: "vizinho", latitude: -23.41, longitude: -51.21 }),
      linha({ neighborhood: "Chácara Fora do Censo", geoPrecisao: "vizinho", latitude: -23.42, longitude: -51.22 }),
    ];
    const r = agregarRede(linhas, ["Londrina"], centroides, OBSERVADOR);
    expect(r.bairros[0]).toMatchObject({ ocorrencias: 3, lat: null, lon: null });
    expect(r.pontos).toHaveLength(0);
    expect(r.semPonto).toBe(3);
  });

  it("sem IBGE e sem coordenada confiável, o bairro conta mas não tem posição", () => {
    const linhas = Array.from({ length: 3 }, () => linha({ neighborhood: "Chácara Fora do Censo" }));
    const r = agregarRede(linhas, ["Londrina"], centroides, OBSERVADOR);
    expect(r.bairros[0]).toMatchObject({ ocorrencias: 3, lat: null, lon: null });
  });

  it("piso e recorte de cidade continuam valendo", () => {
    const linhas = [
      ...Array.from({ length: MIN_POR_BAIRRO - 1 }, () => linha({ neighborhood: "Leonor" })),
      linha({ neighborhood: "Califórnia", city: "Cambé" }),
      linha({ neighborhood: "Califórnia", city: "Cambé" }),
      linha({ neighborhood: "Califórnia", city: "Cambé" }),
    ];
    const r = agregarRede(linhas, ["Londrina - PR"], centroides, OBSERVADOR);
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
    const r = agregarRede(linhas, ["Londrina"], centroides, OBSERVADOR);
    expect(r.bairros).toHaveLength(1);
    expect(r.bairros[0]).toMatchObject({ ocorrencias: 3, lat: -23.3612 });
  });
});

describe("agregarRede — a régua por cidade e o que é do observador (09/09/2026)", () => {
  /**
   * Os cards do modo Rede precisam separar "seus" de "dos outros" e dizer onde
   * a rede está calada. Três regras que este bloco trava:
   *
   * 1. O providerId entra para UMA comparação e morre no acumulador: nada que
   *    sai carrega id, e bolha/ponto continuam com as mesmas quatro/três chaves.
   * 2. "Seus" é contado DEPOIS do portão de bairro, no mesmo universo das
   *    outras contagens — total − seus nunca fica negativo.
   * 3. O rótulo de cidade é o DECLARADO, nos três arrays. A grafia crua do ERP
   *    de outro tenant ("LONDRINA") era a única marca de origem que o payload
   *    ainda carregava — e quebrava o filtro do chip.
   */
  it("uma linha por cidade declarada, zeros incluídos, e nenhum providerId sai", () => {
    const linhas = [
      ...Array.from({ length: 3 }, () => linha({ neighborhood: "Leonor", providerId: OUTRO })),
      linha({ neighborhood: "Leonor", providerId: OBSERVADOR }),
      // abaixo do piso: 2 casos, um deles do observador
      linha({ neighborhood: "Califórnia", providerId: OUTRO }),
      linha({ neighborhood: "Califórnia", providerId: OBSERVADOR }),
    ];
    const r = agregarRede(linhas, ["Londrina - PR", "Cambé - PR"], centroides, OBSERVADOR);
    expect(r.cidades).toEqual([
      { cidade: "Londrina", ocorrencias: 4, ocultas: 2, doObservador: 2, bairrosSemObservador: 0 },
      { cidade: "Cambé", ocorrencias: 0, ocultas: 0, doObservador: 0, bairrosSemObservador: 0 },
    ]);
    // Invariantes que a tela soma: Σ cidades.ocorrencias = Σ bolhas; Σ cidades.ocultas = ocultas.
    expect(r.cidades.reduce((t, c) => t + c.ocorrencias, 0)).toBe(r.bairros.reduce((t, b) => t + b.ocorrencias, 0));
    expect(r.cidades.reduce((t, c) => t + c.ocultas, 0)).toBe(r.ocultas);
    expect(Object.keys(r.bairros[0]).sort()).toEqual(["cidade", "lat", "lon", "ocorrencias"]);
    expect(JSON.stringify(r)).not.toMatch(/providerId|provedor|"id"/);
  });

  it("bairro visível sem nenhuma linha do observador é o ponto cego — contado, nunca nomeado", () => {
    const linhas = [
      ...Array.from({ length: 3 }, () => linha({ neighborhood: "Leonor" })),          // só dos outros
      ...Array.from({ length: 3 }, () => linha({ neighborhood: "União da Vitória" })),
      linha({ neighborhood: "União da Vitória", providerId: OBSERVADOR }),
    ];
    const r = agregarRede(linhas, ["Londrina"], centroides, OBSERVADOR);
    expect(r.cidades[0]).toMatchObject({ ocorrencias: 7, doObservador: 1, bairrosSemObservador: 1 });
    expect(r.bairros).toHaveLength(2);
    expect(JSON.stringify(r.cidades)).not.toMatch(/Leonor|Vit[oó]ria/i);
  });

  it("seus é contado depois do portão de bairro: linha sem bairro não conta em lado nenhum", () => {
    const linhas = [
      ...Array.from({ length: 3 }, () => linha({ neighborhood: "Leonor" })),
      linha({ neighborhood: "", providerId: OBSERVADOR }),
      linha({ neighborhood: "   ", providerId: OBSERVADOR }),
    ];
    const r = agregarRede(linhas, ["Londrina"], centroides, OBSERVADOR);
    expect(r.cidades[0]).toMatchObject({ ocorrencias: 3, ocultas: 0, doObservador: 0 });
    expect(r.cidades[0].ocorrencias + r.cidades[0].ocultas - r.cidades[0].doObservador).toBeGreaterThanOrEqual(0);
  });

  it("o que é do observador FORA da área declarada sai contado por cidade — e só o dele", () => {
    const linhas = [
      ...Array.from({ length: 3 }, () => linha({ neighborhood: "Leonor" })),
      ...Array.from({ length: 4 }, () => linha({ neighborhood: "Centro", city: "Ibiporã", providerId: OBSERVADOR })),
      linha({ neighborhood: "Centro", city: "Primeiro de Maio", providerId: OBSERVADOR }),
      // outro provedor fora da área: não interessa a ninguém, não entra em nada
      ...Array.from({ length: 9 }, () => linha({ neighborhood: "Centro", city: "Mandaguari", providerId: OUTRO })),
      // do observador, fora da área, SEM bairro: mesmo portão dos dois lados
      linha({ neighborhood: "", city: "Ibiporã", providerId: OBSERVADOR }),
    ];
    const r = agregarRede(linhas, ["Londrina - PR"], centroides, OBSERVADOR);
    expect(r.observador).toEqual({
      foraDaArea: 5,
      cidadesForaDaArea: [{ cidade: "Ibiporã", ocorrencias: 4 }, { cidade: "Primeiro de Maio", ocorrencias: 1 }],
    });
    expect(r.cidades.map(c => c.cidade)).toEqual(["Londrina"]);
    expect(JSON.stringify(r)).not.toMatch(/Mandaguari/);
  });

  it("o rótulo de cidade é o declarado, nos três arrays — a grafia do ERP alheio não sai", () => {
    const linhas = [
      linha({ neighborhood: "Leonor", city: "LONDRINA", geoPrecisao: "erp" }),
      linha({ neighborhood: "Leonor", city: "londrina", geoPrecisao: "erp" }),
      linha({ neighborhood: "Leonor", city: "Londrina", geoPrecisao: "erp" }),
    ];
    const r = agregarRede(linhas, ["Londrina - PR", "londrina"], centroides, OBSERVADOR);
    expect(r.cidades.map(c => c.cidade)).toEqual(["Londrina"]);
    expect(r.bairros.map(b => b.cidade)).toEqual(["Londrina"]);
    expect(new Set(r.pontos.map(p => p.cidade))).toEqual(new Set(["Londrina"]));
    // E a âncora no IBGE continua funcionando com o rótulo canônico.
    expect(r.bairros[0]).toMatchObject({ lat: -23.2927, lon: -51.1976 });
    expect(JSON.stringify(r)).not.toMatch(/LONDRINA|londrina/);
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
