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
  /**
   * SEM recorte pedido, a carteira é INTEIRA — e o teste trava isso porque a
   * troca custou o mapa em produção.
   *
   * O padrão nasceu `"ativo"` junto com a rota nova, que lê `carteira` da query
   * e sempre a passa explicitamente. Só que a rota nova não subiu (ver
   * `docs/mapa-da-rede-SEGURADO.md`), e a rota em produção chama
   * `getLocalizacao(providerId)` sem argumento: o mapa perdeu os ex-clientes com
   * dívida — o caso que ele existe para mostrar — e a taxa de bairro zerou, com
   * o numerador indo embora e o denominador ficando.
   *
   * `"todas"` é seguro nos dois mundos: é a resposta certa para quem não pediu
   * recorte, e a rota nova continua mandando o dela quando subir.
   */
  it("sem recorte pedido, o denominador é a carteira inteira do bairro", async () => {
    const r = await new LocalizacaoStorage().getLocalizacao(7);
    expect(r.carteira).toBe("todas");
    // A fixture tem 30 clientes: 20 ativos e 10 cancelados; devem 5 deles —
    // quatro ativos e UM ex-cliente. É esse ex que sumia da tela.
    expect(r.totalCarteira).toBe(30);
    // O denominador é a carteira inteira do bairro (30), não só os ativos.
    // 5/30 = 16,7% — com o filtro "ativo" a conta dava 4/20 = 20% e, na tela do
    // dono, 0% nos bairros cuja única dívida era de ex-cliente.
    expect(r.bairros[0]).toMatchObject({ clientes: 30, universo: 30, inadimplentes: 5, exComDivida: 1, pctInadimplencia: 16.7, pctBaseProvedor: 100 });
    expect(r.cidades[0]).toMatchObject({ universo: 30, pctInadimplencia: 16.7, semCoordenada: 1, pontosNoMapa: 4 });
    expect(r.resumo).toMatchObject({ clientes: 30, inadimplentes: 5, dividaTotal: 500, pctInadimplencia: 16.7, pontosNoMapa: 4 });
    // Quatro pontos: os cinco devedores menos o único sem coordenada.
    expect(r.pontos).toHaveLength(4);
    // O ex-cliente com dívida VOLTA para a legenda do mapa.
    expect(r.porEstado.ex_divida).toBe(1);
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
