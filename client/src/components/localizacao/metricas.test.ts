import { describe, expect, it } from "vitest";
import { carteiraDaUrl, chipsDaRede, cidadesCaladasDaRede, kpisDaRede, resumoDoRecorte, type RedeResumo } from "./metricas";

/**
 * A NsLink em 09/09/2026: 47 cidades declaradas, rede só em Londrina —
 * 4.344 ocorrências (4.208 em 205 bairros com 3+, 136 abaixo do piso), 294
 * delas suas; 895 ex-clientes seus com dívida em Ibiporã, que NÃO está
 * declarada, mais 49 noutras cidades.
 */
const NSLINK: RedeResumo = {
  semArea: false, minPorBairro: 3,
  cidades: [
    { cidade: "Londrina", ocorrencias: 4208, ocultas: 136, doObservador: 294, bairrosSemObservador: 149 },
    ...Array.from({ length: 46 }, (_, i) => ({ cidade: `Cidade ${i}`, ocorrencias: 0, ocultas: 0, doObservador: 0, bairrosSemObservador: 0 })),
  ],
  observador: { foraDaArea: 944, cidadesForaDaArea: [{ cidade: "Ibiporã", ocorrencias: 895 }, { cidade: "Primeiro de Maio", ocorrencias: 43 }, { cidade: "Cambé", ocorrencias: 6 }] },
};

/** A mesma NsLink com uma cidade declarada que só tem casos abaixo do piso. */
const COM_PISO: RedeResumo = {
  ...NSLINK,
  cidades: [NSLINK.cidades[0], { cidade: "Cambará", ocorrencias: 0, ocultas: 2, doObservador: 0, bairrosSemObservador: 0 }, ...NSLINK.cidades.slice(2)],
};

describe("os quatro cards do modo Rede", () => {
  it("separam o calote dos outros do seu, e dizem a parcela", () => {
    const [outros, cegos, cidades, fora] = kpisDaRede(NSLINK, null, 205);
    expect(outros).toMatchObject({ rotulo: "Casos de outros provedores", valor: "4.050", sub: "4.344 na rede · 294 seus · 6,8%" });
    expect(cegos).toMatchObject({ valor: "149", sub: "de 205 com 3+ casos na rede" });
    expect(cidades).toMatchObject({ valor: "1 de 47", sub: "46 sem caso na rede" });
    expect(fora).toMatchObject({ valor: "944", sub: "895 em Ibiporã · 49 noutras · 294 na área" });
  });
  it("cidade com casos só abaixo do piso conta como 'com caso' e é dita como tal", () => {
    expect(kpisDaRede(COM_PISO, null, 205)[2]).toMatchObject({ valor: "2 de 47", sub: "45 sem caso na rede · 1 só abaixo do piso" });
  });
  it("os dois primeiros seguem o chip de cidade; os dois últimos são sempre da área inteira", () => {
    const [outros, cegos, cidades, fora] = kpisDaRede(COM_PISO, "Cambará", 0);
    expect(outros).toMatchObject({ valor: "2", sub: "2 na rede · 0 seus · 0,0%" });
    expect(cegos).toMatchObject({ valor: "—", sub: "nenhum bairro no mapa" });
    expect(cidades.valor).toBe("2 de 47");
    expect(fora.valor).toBe("944");
  });
  it("sem rede, sem área ou sem caso: traço, nunca zero inventado", () => {
    expect(kpisDaRede(undefined, null, 0).map(c => c.valor)).toEqual(["—", "—", "—", "—"]);
    const semArea: RedeResumo = { cidades: [], observador: null, semArea: true, minPorBairro: 3 };
    expect(kpisDaRede(semArea, null, 0).map(c => c.valor)).toEqual(["—", "—", "—", "—"]);
    expect(kpisDaRede(semArea, null, 0)[3].sub).toBe("sem área declarada");
  });
  it("carteira inteira dentro da área lê como tal, e a subtração nunca fica negativa", () => {
    const tudoDentro: RedeResumo = { ...NSLINK, observador: { foraDaArea: 0, cidadesForaDaArea: [] } };
    expect(kpisDaRede(tudoDentro, null, 205)[3]).toMatchObject({ valor: "0", sub: "toda a sua carteira de ex-clientes com dívida está na área" });
    const soSeus: RedeResumo = { ...NSLINK, cidades: [{ cidade: "Londrina", ocorrencias: 3, ocultas: 0, doObservador: 3, bairrosSemObservador: 0 }] };
    expect(kpisDaRede(soSeus, null, 1)[0]).toMatchObject({ valor: "0", sub: "3 na rede · 3 seus · 100,0%" });
  });
});

describe("chips e cidades caladas do modo Rede", () => {
  it("só cidade com bolha vira chip — Ibiporã (fora da área) e cidade sem caso não entram", () => {
    expect(chipsDaRede(NSLINK).map(c => c.cidade)).toEqual(["Londrina"]);
    expect(chipsDaRede(undefined)).toEqual([]);
  });
  it("cidade só abaixo do piso não vira chip mas é nomeada como calada", () => {
    expect(chipsDaRede(COM_PISO).map(c => c.cidade)).toEqual(["Londrina"]);
    const c = cidadesCaladasDaRede(COM_PISO);
    expect(c.soAbaixoDoPiso).toEqual(["Cambará"]);
    expect(c.semCaso).toHaveLength(45);
    expect(c.semCaso).not.toContain("Londrina");
    expect(cidadesCaladasDaRede(NSLINK).semCaso).toHaveLength(46);
  });
});

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
