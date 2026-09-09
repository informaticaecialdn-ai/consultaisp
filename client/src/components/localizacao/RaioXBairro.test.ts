import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RankingBairros, { chaveBairro, type BairroRanking } from "./RankingBairros";
import RaioXBairro, { calcularTaxaAgregada, calcularPenetracaoAgregada } from "./RaioXBairro";

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }) }));

function bairro(overrides: Partial<BairroRanking> = {}): BairroRanking {
  return { bairro: "Centro", cidade: "Cidade A", clientes: 100, inadimplentes: 10,
    exComDivida: 0, atuais: 100, pctInadimplencia: 10, dividaTotal: 200,
    hps: 1000, ucsVivas: 1000, pctPenetracao: 10, benchmarkPct: null, ...overrides };
}

describe("Raio-X: denominadores e identidade territorial", () => {
  it("calcula taxa da carteira pelo total, sem dar peso igual a bairros pequenos", () => {
    expect(calcularTaxaAgregada([bairro(), bairro({ clientes: 1, inadimplentes: 1, pctInadimplencia: 100 })])).toBeCloseTo(11 / 101 * 100);
    expect(calcularTaxaAgregada([])).toBeNull();
  });
  it("pondera penetração pelo denominador territorial e omite sem match", () => {
    expect(calcularPenetracaoAgregada([bairro(), bairro({ atuais: 10, ucsVivas: null, hps: 20, pctPenetracao: 50 }), bairro({ atuais: 200, hps: null, ucsVivas: null, pctPenetracao: null })])).toBeCloseTo(110 / 1020 * 100);
  });
  it("distingue bairros de mesmo nome em cidades diferentes", () => {
    const a = bairro();
    const b = bairro({ cidade: "Cidade B", clientes: 4, inadimplentes: 2, pctInadimplencia: 50 });
    expect(chaveBairro(a)).not.toBe(chaveBairro(b));
    const html = renderToStaticMarkup(createElement(RaioXBairro, { bairros: [a, b], selecionado: chaveBairro(b), onSelect: () => {}, cidade: null }));
    expect(html).toContain("2 inadimplentes ÷ 4 clientes");
    expect(html).toContain("Cidade B");
    expect(html).not.toContain("atuais + ex-clientes com dívida");
  });
  it("explica carteira ex e amostra pequena sem mostrar zero ex-clientes", () => {
    const b = bairro({ clientes: 2, inadimplentes: 1, atuais: 0, pctInadimplencia: 50, pctPenetracao: 0 });
    const html = renderToStaticMarkup(createElement(RaioXBairro, { bairros: [b], selecionado: chaveBairro(b), onSelect: () => {}, cidade: null, carteira: "ex_cliente" }));
    expect(html).toContain("Amostra pequena");
    expect(html).toContain("carteira de ex-clientes");
    expect(html).not.toContain("0 ex-clientes com dívida");
    expect(html).toContain("Não aplicável");
    expect(html).toContain("Penetração comercial se aplica à carteira ativa");
    expect(html).not.toContain("penetração do recorte");
  });
  it("mostra benchmark do bairro e diferença em pontos percentuais", () => {
    const b = bairro({ benchmarkPct: 20 });
    const html = renderToStaticMarkup(createElement(RaioXBairro, { bairros: [b], selecionado: chaveBairro(b), onSelect: () => {}, cidade: null }));
    expect(html).toContain("Mercado · mesmo bairro");
    expect(html).toContain("10,0 pp vs referência");
    expect(html).toContain("seu provedor excluído");
  });
  it("separa participação territorial da taxa de inadimplência no ranking", () => {
    const b = bairro({ pctBaseProvedor: 5, pctBaseCidade: 25 });
    const html = renderToStaticMarkup(createElement(RankingBairros, { bairros: [b], selecionado: chaveBairro(b), onSelect: () => {}, ordem: "maior", onOrdem: () => {}, cidade: null }));
    expect(html).toContain("10 inadimplentes ÷ 100 clientes");
    expect(html).toContain("5,0% do provedor");
    expect(html).toContain("25,0% da cidade");
    expect(html).not.toContain("0 ex");
    expect(html).toContain('aria-pressed="true"');
  });
  it("sem carteira pedida, o rotulo e o denominador sao a base inteira", () => {
    const b = bairro({ exComDivida: 3 });
    const html = renderToStaticMarkup(createElement(RankingBairros, { bairros: [b], selecionado: null, onSelect: () => {}, ordem: "maior", onOrdem: () => {}, cidade: null }));
    expect(html).toContain("Carteira: todos os clientes");
    expect(html).toContain("10 inadimplentes ÷ 100 clientes");
    // O ex-cliente com divida so aparece na base completa — e o caso que sumiu
    // da tela do dono quando o padrao era "ativo".
    expect(html).toContain("3 ex com dívida");
  });

  it("distingue taxa dentro do bairro de impacto na base inteira", () => {
    const b = bairro({ clientes: 12, inadimplentes: 5, pctInadimplencia: 41.7, pctInadimplentesBaseProvedor: 1.9 });
    const html = renderToStaticMarkup(createElement(RankingBairros, { bairros: [b], selecionado: chaveBairro(b), onSelect: () => {}, ordem: "maior", onOrdem: () => {}, cidade: null }));
    expect(html).toContain("41,7%");
    expect(html).toContain("5 inadimplentes ÷ 12 clientes");
    expect(html).toContain("Impacto na base: 1,9% dos clientes do provedor devem neste bairro");
    expect(html).toContain("Inadimplentes deste bairro ÷ todos os clientes do provedor na carteira selecionada");
  });
});
