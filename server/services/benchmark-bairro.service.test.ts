import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * O benchmark é a única leitura cross-tenant do módulo de localização, e o que
 * estes testes travam é a fronteira: com menos de três provedores com massa o
 * número não sai, o observador nunca está dentro do número que vê, e em
 * nenhuma hipótese sai algo que diga QUAIS provedores entraram.
 *
 * O banco e o censo são substituídos: o que se testa é a agregação, o SQL que
 * o serviço monta e o cache, não o Postgres.
 */

const banco = vi.hoisted(() => ({
  atual: [] as unknown[],
  chamadas: 0,
  // O predicado do WHERE, capturado para ser lido de volta como SQL.
  where: null as unknown,
  joins: 0,
}));

vi.mock("../db", () => {
  // A cadeia select().from().innerJoin().where().groupBy() devolve as linhas
  // inventadas; conta as idas ao banco para os testes de cache.
  const cadeia: any = {
    select: () => cadeia,
    from: () => cadeia,
    innerJoin: () => { banco.joins++; return cadeia; },
    where: (pred: unknown) => { banco.where = pred; return cadeia; },
    groupBy: () => new Promise(resolve => setTimeout(() => {
      banco.chamadas++;
      resolve(banco.atual);
    }, 0)),
  };
  return { db: cadeia, pool: {} };
});

const censo = vi.hoisted(() => ({
  territorio: new Map<string, { hps: Map<string, number>; ucs: Map<string, number> }>(),
  chamadas: 0,
}));

vi.mock("./geo-bases.service", () => ({
  carregarTerritorio: async (cidades: string[]) => {
    censo.chamadas++;
    const m = new Map();
    for (const c of cidades) { const t = censo.territorio.get(c); if (t) m.set(c, t); }
    return m;
  },
}));

import {
  agregarBenchmarkBairro, benchmarkParaTela, calcularBenchmarkBairro, chaveCidadeBenchmark,
  normalizarUf, ordenarCanonicosPorTamanho, resumirBenchmark,
  BENCHMARK_K_MINIMO, BENCHMARK_MIN_CLIENTES_POR_PROVEDOR, BENCHMARK_MIN_CLIENTES_TOTAL,
  _limparCacheDeBenchmarkParaTestes, type LinhaAgregadaBenchmark,
} from "./benchmark-bairro.service";

const PR_LONDRINA = chaveCidadeBenchmark("PR", "LONDRINA");
const PR_IBIPORA = chaveCidadeBenchmark("PR", "IBIPORA");

const canonicos = new Map<string, string[]>([
  [PR_LONDRINA, ["JARDIM BANDEIRANTES", "CENTRO", "LEONOR"]],
  [PR_IBIPORA, ["CENTRO"]],
]);

const linha = (over: Partial<LinhaAgregadaBenchmark>): LinhaAgregadaBenchmark => ({
  providerId: 1, state: "PR", city: "Londrina", neighborhood: "Jardim Bandeirantes",
  clientes: 50, inadimplentes: 5, ...over,
});

/** Contribuições de um bairro, direto: {providerId: [clientes, inadimplentes]}. */
const contrib = (m: Record<number, [number, number]>) =>
  new Map(Object.entries(m).map(([id, [clientes, inadimplentes]]) => [Number(id), { clientes, inadimplentes }]));

// Observador que não está em bairro nenhum: vê o mercado inteiro.
const DE_FORA = 999;

describe("agregarBenchmarkBairro — o bairro do censo é a chave", () => {
  it("três provedores com três grafias do mesmo bairro somam num bairro canônico só", () => {
    const r = agregarBenchmarkBairro([
      linha({ providerId: 1, neighborhood: "Jd. Bandeirantes", clientes: 100, inadimplentes: 10 }),
      linha({ providerId: 2, neighborhood: "JARDIM BANDEIRANTES", clientes: 50, inadimplentes: 10, city: "LONDRINA" }),
      linha({ providerId: 3, neighborhood: "Jardim  Bandeirantes", clientes: 50, inadimplentes: 4, city: "Londrina - PR" }),
    ], canonicos);

    const c = r.get(PR_LONDRINA)?.get("JARDIM BANDEIRANTES");
    expect(resumirBenchmark(c, DE_FORA)).toEqual({ provedores: 3, clientes: 200, inadimplentes: 24, pct: 12 });
    expect(benchmarkParaTela(c, DE_FORA)).toBe(12);
  });

  it("dois provedores agregam, mas o número não sai: cada um deduziria o outro", () => {
    const r = agregarBenchmarkBairro([
      linha({ providerId: 1, clientes: 100, inadimplentes: 10 }),
      linha({ providerId: 2, clientes: 100, inadimplentes: 30 }),
    ], canonicos);

    const c = r.get(PR_LONDRINA)?.get("JARDIM BANDEIRANTES");
    expect(c?.size).toBe(2);
    expect(benchmarkParaTela(c, DE_FORA)).toBeNull();
  });

  it("o mesmo provedor em dois bairros do ERP que caem no mesmo canônico é uma parcela só", () => {
    const r = agregarBenchmarkBairro([
      linha({ providerId: 1, neighborhood: "Jd Bandeirantes", clientes: 30, inadimplentes: 3 }),
      linha({ providerId: 1, neighborhood: "Jardim Bandeirantes", clientes: 20, inadimplentes: 2 }),
      linha({ providerId: 2 }),
    ], canonicos);
    const c = r.get(PR_LONDRINA)?.get("JARDIM BANDEIRANTES");
    expect(c?.size).toBe(2);
    expect(c?.get(1)).toEqual({ clientes: 50, inadimplentes: 5 });
  });

  it("bairro que não casa com o censo fica de fora — sem chave não há mercado", () => {
    const r = agregarBenchmarkBairro([
      linha({ providerId: 1, neighborhood: "Chácara Fora do Censo" }),
      linha({ providerId: 2, neighborhood: "Chácara Fora do Censo" }),
      linha({ providerId: 3, neighborhood: "Chácara Fora do Censo" }),
      linha({ providerId: 4, neighborhood: null }),
    ], canonicos);
    expect(r.get(PR_LONDRINA)).toBeUndefined();
  });

  it("cidade sem lista canônica é ignorada; bairros homônimos em cidades diferentes não se misturam", () => {
    const r = agregarBenchmarkBairro([
      linha({ providerId: 1, city: "Cambé", neighborhood: "Centro" }),
      linha({ providerId: 1, city: "Londrina", neighborhood: "Centro", clientes: 10, inadimplentes: 5 }),
      linha({ providerId: 2, city: "Ibiporã", neighborhood: "Centro", clientes: 10, inadimplentes: 0 }),
    ], canonicos);
    expect(r.has(chaveCidadeBenchmark("PR", "CAMBE"))).toBe(false);
    expect(r.get(PR_LONDRINA)?.get("CENTRO")?.get(1)).toEqual({ clientes: 10, inadimplentes: 5 });
    expect(r.get(PR_IBIPORA)?.get("CENTRO")?.get(2)).toEqual({ clientes: 10, inadimplentes: 0 });
  });

  it("nada no resumo identifica um provedor", () => {
    const r = agregarBenchmarkBairro([
      linha({ providerId: 1 }), linha({ providerId: 2 }), linha({ providerId: 3 }),
    ], canonicos);
    const b = resumirBenchmark(r.get(PR_LONDRINA)!.get("JARDIM BANDEIRANTES")!, DE_FORA)!;
    expect(Object.keys(b).sort()).toEqual(["clientes", "inadimplentes", "pct", "provedores"]);
    expect(JSON.stringify(b)).not.toMatch(/providerId|provider_id/);
  });
});

describe("a UF faz parte da cidade — homônimas de estados diferentes são mercados diferentes", () => {
  const SC_SANTA_HELENA = chaveCidadeBenchmark("SC", "SANTA HELENA");
  const PR_SANTA_HELENA = chaveCidadeBenchmark("PR", "SANTA HELENA");
  const duasSantaHelena = new Map([[PR_SANTA_HELENA, ["CENTRO"]], [SC_SANTA_HELENA, ["CENTRO"]]]);

  it("linha do PR não entra no mercado de SC, e vice-versa", () => {
    const r = agregarBenchmarkBairro([
      linha({ providerId: 1, state: "PR", city: "Santa Helena", neighborhood: "Centro" }),
      linha({ providerId: 2, state: "pr", city: "Santa Helena - PR", neighborhood: "Centro" }),
      linha({ providerId: 3, state: "SC", city: "Santa Helena", neighborhood: "Centro" }),
    ], duasSantaHelena);
    expect(Array.from(r.get(PR_SANTA_HELENA)!.get("CENTRO")!.keys()).sort()).toEqual([1, 2]);
    expect(Array.from(r.get(SC_SANTA_HELENA)!.get("CENTRO")!.keys())).toEqual([3]);
  });

  it("linha sem estado não contradiz ninguém: entra nas duas; pedido sem UF aceita qualquer estado", () => {
    const r = agregarBenchmarkBairro([
      linha({ providerId: 1, state: null, city: "Santa Helena", neighborhood: "Centro" }),
      linha({ providerId: 2, state: "Paraná", city: "Santa Helena", neighborhood: "Centro" }),
    ], duasSantaHelena);
    expect(r.get(PR_SANTA_HELENA)!.get("CENTRO")!.size).toBe(2);
    expect(r.get(SC_SANTA_HELENA)!.get("CENTRO")!.size).toBe(2);

    const semUf = agregarBenchmarkBairro([
      linha({ providerId: 1, state: "PR", city: "Santa Helena", neighborhood: "Centro" }),
      linha({ providerId: 3, state: "SC", city: "Santa Helena", neighborhood: "Centro" }),
    ], new Map([[chaveCidadeBenchmark(null, "SANTA HELENA"), ["CENTRO"]]]));
    expect(semUf.get("|SANTA HELENA")!.get("CENTRO")!.size).toBe(2);
  });

  it("normalizarUf só aceita sigla; chaveCidadeBenchmark é 'UF|CIDADE'", () => {
    expect(normalizarUf(" pr ")).toBe("PR");
    expect(normalizarUf("Paraná")).toBe("");
    expect(normalizarUf(null)).toBe("");
    expect(chaveCidadeBenchmark("pr", "LONDRINA")).toBe("PR|LONDRINA");
    expect(chaveCidadeBenchmark(undefined, "LONDRINA")).toBe("|LONDRINA");
  });
});

describe("resumirBenchmark — as travas que separam mercado de concorrente", () => {
  it("as travas são as constantes, não números soltos", () => {
    expect(BENCHMARK_K_MINIMO).toBe(3);
    expect(BENCHMARK_MIN_CLIENTES_POR_PROVEDOR).toBe(10);
    expect(BENCHMARK_MIN_CLIENTES_TOTAL).toBe(30);
    expect(resumirBenchmark(null, DE_FORA)).toBeNull();
    expect(resumirBenchmark(undefined, DE_FORA)).toBeNull();
    expect(benchmarkParaTela(null, DE_FORA)).toBeNull();
  });

  it("um cliente importado à mão não é um provedor: duas contas com 1 cliente não fecham o k", () => {
    // O ataque: bairro com um único concorrente real; o atacante cria duas
    // contas e importa um cliente em cada. Sem a trava, o "mercado" seria a
    // taxa do concorrente.
    const c = contrib({ 1: [200, 40], 2: [1, 0], 3: [1, 0] });
    expect(benchmarkParaTela(c, DE_FORA)).toBeNull();
    // Com massa de verdade nas três, fecha.
    expect(benchmarkParaTela(contrib({ 1: [200, 40], 2: [10, 0], 3: [10, 0] }), DE_FORA)).toBeCloseTo(18.2, 1);
  });

  it("o observador está fora do número que vê — variar a própria base não muda nada", () => {
    const antes = contrib({ 1: [100, 10], 2: [100, 30], 3: [100, 20] });
    const depois = contrib({ 1: [150, 10], 2: [100, 30], 3: [100, 20] });
    expect(resumirBenchmark(antes, 1)).toEqual({ provedores: 3, clientes: 200, inadimplentes: 50, pct: 25 });
    expect(resumirBenchmark(depois, 1)).toEqual(resumirBenchmark(antes, 1));
    // Cada observador vê a soma dos OUTROS dois.
    expect(resumirBenchmark(antes, 2)?.pct).toBe(15);
    expect(resumirBenchmark(antes, 3)?.pct).toBe(20);
    // Quem não está no bairro vê os três.
    expect(resumirBenchmark(antes, DE_FORA)?.pct).toBe(20);
  });

  it("o observador conta no k, mas os outros dois precisam ter piso de universo juntos", () => {
    // Três contribuintes, mas sem o observador sobram 20 clientes: abaixo do
    // piso, o percentual vira contagem e não sai.
    expect(benchmarkParaTela(contrib({ 1: [500, 50], 2: [10, 1], 3: [10, 1] }), 1)).toBeNull();
    expect(benchmarkParaTela(contrib({ 1: [500, 50], 2: [15, 1], 3: [15, 1] }), 1)).toBeCloseTo(6.7, 1);
  });

  it("provedor sem massa no bairro não conta no k nem entra na soma", () => {
    const c = contrib({ 1: [100, 10], 2: [100, 30], 3: [100, 20], 4: [3, 3] });
    expect(resumirBenchmark(c, DE_FORA)).toEqual({ provedores: 3, clientes: 300, inadimplentes: 60, pct: 20 });
  });
});

describe("ordenarCanonicosPorTamanho — o dominante vem primeiro", () => {
  it("é a ordem que o casador usa para desempatar o fuzzy", () => {
    expect(ordenarCanonicosPorTamanho(new Map([["A", 5], ["B", 50], ["C", 20]]))).toEqual(["B", "C", "A"]);
  });
});

describe("lerAgregado — o que o SQL corta antes de qualquer coisa chegar à memória", () => {
  beforeEach(() => {
    _limparCacheDeBenchmarkParaTestes();
    banco.chamadas = 0; banco.joins = 0; banco.where = null;
    banco.atual = [];
    censo.territorio = new Map([
      ["LONDRINA", { hps: new Map([["CENTRO", 900]]), ucs: new Map() }],
    ]);
  });

  it("junta com providers e só aceita provedor aprovado e ativo, com bairro preenchido", async () => {
    await calcularBenchmarkBairro([{ cidadeNorm: "LONDRINA", uf: "PR" }]);
    expect(banco.joins).toBe(1);
    const { sql } = new PgDialect().sqlToQuery(banco.where as any);
    const plano = sql.replace(/\s+/g, " ");
    expect(plano).toMatch(/"providers"\."status" = 'active'/);
    expect(plano).toMatch(/"providers"\."verification_status" = 'approved'/);
    expect(plano).toMatch(/"customers"\."neighborhood" is not null/);
    expect(plano).toMatch(/"customers"\."neighborhood" <> ''/);
    expect(plano).toMatch(/lower\("customers"\."status"\) not in \('cancelled', 'inactive'\)/);
  });
});

describe("calcularBenchmarkBairro — uma ida ao banco por hora, para todas as cidades", () => {
  beforeEach(() => {
    _limparCacheDeBenchmarkParaTestes();
    banco.chamadas = 0; censo.chamadas = 0;
    banco.atual = [
      linha({ providerId: 1 }), linha({ providerId: 2 }), linha({ providerId: 3 }),
      linha({ providerId: 1, city: "Ibiporã", neighborhood: "Centro" }),
      linha({ providerId: 2, city: "Ibiporã", neighborhood: "Centro" }),
      linha({ providerId: 3, city: "Ibiporã", neighborhood: "Centro" }),
    ];
    censo.territorio = new Map([
      ["LONDRINA", { hps: new Map([["CENTRO", 900], ["JARDIM BANDEIRANTES", 2000]]), ucs: new Map() }],
      ["IBIPORA", { hps: new Map([["CENTRO", 900]]), ucs: new Map() }],
    ]);
  });

  it("casa contra o CNEFE ordenado por HPs e serve a segunda chamada do cache", async () => {
    const a = await calcularBenchmarkBairro([{ cidadeNorm: "LONDRINA", uf: "PR" }]);
    expect(benchmarkParaTela(a.get(PR_LONDRINA)?.get("JARDIM BANDEIRANTES"), DE_FORA)).toBe(10);
    expect(banco.chamadas).toBe(1);

    const b = await calcularBenchmarkBairro([{ cidadeNorm: "LONDRINA", uf: "PR" }]);
    expect(b.get(PR_LONDRINA)).toBe(a.get(PR_LONDRINA));
    expect(banco.chamadas).toBe(1);
  });

  it("cidade nova dentro da hora não volta ao banco: o agregado é global", async () => {
    await calcularBenchmarkBairro([{ cidadeNorm: "LONDRINA", uf: "PR" }]);
    const r = await calcularBenchmarkBairro([{ cidadeNorm: "IBIPORA", uf: "PR" }]);
    expect(banco.chamadas).toBe(1);
    expect(benchmarkParaTela(r.get(PR_IBIPORA)?.get("CENTRO"), DE_FORA)).toBe(10);
  });

  it("duas chamadas simultâneas no cache frio dividem a mesma ida ao banco", async () => {
    const [a, b] = await Promise.all([
      calcularBenchmarkBairro([{ cidadeNorm: "LONDRINA", uf: "PR" }]),
      calcularBenchmarkBairro([{ cidadeNorm: "IBIPORA", uf: "PR" }]),
    ]);
    expect(banco.chamadas).toBe(1);
    expect(a.get(PR_LONDRINA)?.size).toBe(1);
    expect(b.get(PR_IBIPORA)?.size).toBe(1);
  });

  it("cidade sem censo não entra no retorno e não vai ao banco", async () => {
    const r = await calcularBenchmarkBairro([{ cidadeNorm: "CAMBE", uf: "PR" }]);
    expect(r.size).toBe(0);
    expect(banco.chamadas).toBe(0);
  });

  it("cidade sem censo não fica presa no cache: assim que o CNEFE entra, o mercado aparece junto com o HP", async () => {
    censo.territorio.delete("IBIPORA");
    expect((await calcularBenchmarkBairro([{ cidadeNorm: "IBIPORA", uf: "PR" }])).size).toBe(0);

    censo.territorio.set("IBIPORA", { hps: new Map([["CENTRO", 900]]), ucs: new Map() });
    const r = await calcularBenchmarkBairro([{ cidadeNorm: "IBIPORA", uf: "PR" }]);
    expect(benchmarkParaTela(r.get(PR_IBIPORA)?.get("CENTRO"), DE_FORA)).toBe(10);
  });

  it("lista canônica diferente invalida o casamento guardado — o mercado segue o HP", async () => {
    const antes = await calcularBenchmarkBairro([{ cidadeNorm: "LONDRINA", uf: "PR" }]);
    expect(antes.get(PR_LONDRINA)?.has("JARDIM BANDEIRANTES")).toBe(true);

    // Reingestão do CNEFE sem o Jardim Bandeirantes: o HP some, e o benchmark
    // daquele bairro tem de sumir na mesma leitura, sem esperar o TTL.
    censo.territorio.set("LONDRINA", { hps: new Map([["CENTRO", 900]]), ucs: new Map() });
    const depois = await calcularBenchmarkBairro([{ cidadeNorm: "LONDRINA", uf: "PR" }]);
    expect(depois.get(PR_LONDRINA)?.has("JARDIM BANDEIRANTES")).toBe(false);
    expect(banco.chamadas).toBe(1);
  });

  it("recebe o território já carregado e não volta a geo_hps_bairro", async () => {
    const territorio = new Map([
      ["LONDRINA", { hps: new Map([["CENTRO", 900], ["JARDIM BANDEIRANTES", 2000]]), ucs: new Map() }],
    ]);
    const r = await calcularBenchmarkBairro([{ cidadeNorm: "LONDRINA", uf: "PR" }], territorio);
    expect(censo.chamadas).toBe(0);
    expect(r.get(PR_LONDRINA)?.size).toBe(1);
  });
});
