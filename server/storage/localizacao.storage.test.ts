import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { customers } from "@shared/schema";

const fake = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], queries: [] as unknown[] }));
vi.mock("../db", () => ({ db: { select: () => ({ from: (table: unknown) => ({ where: async (query: unknown) => {
  fake.queries.push(query);
  return table === customers ? fake.rows : [{ cidadesExcluidasDoMapa: [] }];
} }) }) } }));
vi.mock("../services/area-atendida", async importOriginal => ({
  ...await importOriginal<object>(), resolverAreaAtendida: async () => ({ cidades: ["Londrina"], uf: "PR", origem: "declarada" }),
}));
vi.mock("../services/geo-bases.service", () => ({ carregarTerritorio: async () => new Map(), carregarCaixasMunicipio: async () => new Map() }));
vi.mock("../services/benchmark-bairro.service", () => ({
  calcularBenchmarkBairro: async () => new Map(), calcularBenchmarkCidade: async () => new Map(),
  benchmarkParaTela: () => null, resumirBenchmark: () => null,
  chaveCidadeBenchmark: (uf: string, cidade: string) => `${uf}|${cidade}`, ordenarCanonicosPorTamanho: () => [],
}));
vi.mock("../services/geocoding", () => ({ geocodeAddress: vi.fn(), geocodeCity: vi.fn() }));
import { LocalizacaoStorage } from "./localizacao.storage";

beforeEach(() => {
  fake.queries = [];
  fake.rows = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1, providerId: 7, name: "Cliente", city: "Londrina", state: "PR", neighborhood: "Centro",
    status: i < 20 ? "active" : "cancelled", totalOverdueAmount: i < 4 || i === 20 ? "100" : "0",
    paymentStatus: "current", latitude: i === 0 ? null : "-23.30", longitude: i === 0 ? null : "-51.16",
  }));
});

describe("Localização: universo da carteira", () => {
  it("usa todos os ativos no denominador, incluindo devedor sem coordenada", async () => {
    const r = await new LocalizacaoStorage().getLocalizacao(7);
    expect(r.carteira).toBe("ativo");
    expect(r.totalCarteira).toBe(20);
    expect(r.bairros[0]).toMatchObject({ clientes: 20, universo: 20, inadimplentes: 4, pctInadimplencia: 20, pctBaseProvedor: 100 });
    expect(r.cidades[0]).toMatchObject({ universo: 20, pctInadimplencia: 20, semCoordenada: 1, pontosNoMapa: 3 });
    expect(r.resumo).toMatchObject({ clientes: 20, inadimplentes: 4, dividaTotal: 400, pctInadimplencia: 20, pontosNoMapa: 3 });
    expect(r.pontos).toHaveLength(3);
    expect(r.porEstado.ex_divida).toBe(0);
    const sql = new PgDialect().sqlToQuery(fake.queries[2] as SQL);
    expect(sql.sql).toContain('"customers"."provider_id"');
    expect(sql.params).toEqual([7]);
  });
  it("inclui ex-clientes quitados no denominador e conserva cidade operacional", async () => {
    const r = await new LocalizacaoStorage().getLocalizacao(7, "ex_cliente");
    expect(r.totalCarteira).toBe(10);
    expect(r.bairros[0]).toMatchObject({ clientes: 10, universo: 10, inadimplentes: 1, pctInadimplencia: 10 });
    expect(r.pontos).toHaveLength(1);
    expect(r.porEstado.ex_divida).toBe(1);
  });
  it("participação usa toda carteira do provedor mesmo fora do recorte do mapa", async () => {
    fake.rows.push({ ...fake.rows[10], id: 100, city: "Curitiba" });
    const r = await new LocalizacaoStorage().getLocalizacao(7, "todas");
    expect(r.totalCarteira).toBe(31);
    expect(r.foraDoMapa).toBe(1);
    expect(r.bairros[0]).toMatchObject({ universo: 30, pctInadimplencia: 16.7, clientesCidade: 30, pctBaseProvedor: 96.8, pctInadimplentesBaseProvedor: 16.1, pctBaseCidade: 100 });
  });
  it("suspensos pertencem aos ativos e saldos não positivos não são dívida", async () => {
    fake.rows[0].status = "suspended";
    fake.rows[1].totalOverdueAmount = "-50";
    fake.rows[2].totalOverdueAmount = "NaN";
    fake.rows[3].totalOverdueAmount = "Infinity";
    const r = await new LocalizacaoStorage().getLocalizacao(7, "ativo");
    expect(r.resumo).toMatchObject({ clientes: 20, inadimplentes: 1, dividaTotal: 100, pctInadimplencia: 5, pontosNoMapa: 0 });
    expect(r.porEstado.suspenso).toBe(1);
  });
  it("não atribui benchmark a cidade com UFs diferentes na própria carteira", async () => {
    fake.rows[0].state = "SP";
    const r = await new LocalizacaoStorage().getLocalizacao(7);
    expect(r.cidades[0]).toMatchObject({ uf: null, ufAmbigua: true, benchmark: null, benchmarkPct: null });
  });
});
