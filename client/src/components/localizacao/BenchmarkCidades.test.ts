import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BenchmarkCidades } from "./BenchmarkCidades";

describe("comparação municipal renderizada", () => {
  it("mostra base própria e amostra de outros provedores sem confundir pontos com dívida", () => {
    const html = renderToStaticMarkup(createElement(BenchmarkCidades, { carteira: "ativo", onCidade: () => undefined, cidades: [{cidade:"Cidade A",clientes:100,inadimplentes:20,dividaTotal:4000,pontosNoMapa:7,benchmark:{pct:10,provedores:3,clientes:90,inadimplentes:9}}] }));
    expect(html).toContain("7 / 20");
    expect(html).toContain("+10 p.p.");
    expect(html).toContain("3 outros provedores");
    expect(html).toContain("não representa toda a população");
  });
  it("não apresenta zero como benchmark indisponível", () => {
    const html = renderToStaticMarkup(createElement(BenchmarkCidades, { carteira: "ex_cliente", onCidade: () => undefined, cidades: [{cidade:"Cidade B",clientes:0,inadimplentes:0,dividaTotal:0,benchmarkPct:null}] }));
    expect(html).toContain("Sem benchmark disponível");
    expect(html).not.toContain("0 p.p.");
  });
});
