import { describe, expect, it } from "vitest";
import { carteiraDaUrl, resumoDoRecorte } from "./metricas";

describe("carteira do mapa vinda da URL", () => {
  /**
   * Trava o padrão porque a troca dele custou o mapa em produção: com "ativo"
   * por omissão, os ex-clientes com dívida — 1.239 dos 1.260 devedores da
   * NsLink — desapareceram da tela e a taxa por bairro zerou.
   */
  it("sem recorte pedido, a carteira é a base completa", () => {
    expect(carteiraDaUrl("")).toBe("todas");
    expect(carteiraDaUrl("?rede=1")).toBe("todas");
    expect(carteiraDaUrl("?carteira=")).toBe("todas");
    expect(carteiraDaUrl("?carteira=inventada")).toBe("todas");
  });
  it("respeita o recorte que o operador escolheu", () => {
    expect(carteiraDaUrl("?carteira=ativo")).toBe("ativo");
    expect(carteiraDaUrl("?carteira=ex_cliente&rede=1")).toBe("ex_cliente");
  });
});

describe("taxas territoriais com base explícita", () => {
  it("pondera a taxa por clientes em vez de calcular a média das taxas", () => {
    expect(resumoDoRecorte([
      { cidade: "A", clientes: 10, inadimplentes: 5, dividaTotal: 500 },
      { cidade: "B", clientes: 90, inadimplentes: 9, dividaTotal: 900 },
    ])).toEqual({clientes: 100, inadimplentes: 14, dividaTotal: 1400, taxa: 14});
  });
  it("não reduz a taxa nem a dívida quando faltam coordenadas", () => {
    expect(resumoDoRecorte([{cidade:"A",clientes:100,inadimplentes:20,dividaTotal:2000,pontosNoMapa:3,semCoordenada:17}]).taxa).toBe(20);
  });
  it("não inventa taxa sem clientes", () => {
    expect(resumoDoRecorte([]).taxa).toBeNull();
  });
});
