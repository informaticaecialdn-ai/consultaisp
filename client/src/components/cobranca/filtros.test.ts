import { describe, it, expect } from "vitest";
import { STATUS_ABERTOS_DE_CASO, STATUS_FECHADOS_DE_CASO } from "@shared/cobranca";
import {
  FILTROS_INICIAIS, filtrosDaUrl, limparFiltros, lerVisao, mesmosFiltros, OPCOES_QUADRANTE, OPCOES_STATUS,
  queryDaCarteira, temFiltros, totalDePaginas,
} from "./filtros";

describe("queryDaCarteira", () => {
  it("a carteira sempre vai; o resto só quando ligado", () => {
    expect(queryDaCarteira(FILTROS_INICIAIS)).toBe("carteira=ativo");
    expect(queryDaCarteira({ ...FILTROS_INICIAIS, carteira: "ex_cliente", quadrante: "C3", busca: "  Ana " }))
      .toBe("carteira=ex_cliente&busca=Ana&quadrante=C3");
  });
  it("página 1 não entra na URL — é a que se compartilha", () => {
    expect(queryDaCarteira({ ...FILTROS_INICIAIS, pagina: 1 })).not.toContain("pagina");
    expect(queryDaCarteira({ ...FILTROS_INICIAIS, pagina: 3 })).toContain("pagina=3");
  });
  it("só manda parâmetros que a rota aceita", () => {
    const q = queryDaCarteira({ ...FILTROS_INICIAIS, status: "aberto", etapa: "lembrete_atraso", saude: "boa", divida: "ate-100", bairro: "Centro" });
    for (const chave of ["carteira", "status", "etapa", "saude", "divida", "bairro"]) expect(q).toContain(`${chave}=`);
    expect(q).not.toContain("statusErp");
  });
});

describe("filtrosDaUrl", () => {
  it("é o inverso da query", () => {
    const f = { ...FILTROS_INICIAIS, carteira: "ex_cliente" as const, quadrante: "B2", bairro: "Centro", pagina: 2 };
    expect(filtrosDaUrl(`?${queryDaCarteira(f)}`)).toEqual(f);
  });
  it("valor desconhecido cai no padrão, nunca em erro", () => {
    expect(filtrosDaUrl("?carteira=x&pagina=abc").carteira).toBe("ativo");
    expect(filtrosDaUrl("?pagina=0").pagina).toBe(1);
    expect(filtrosDaUrl("")).toEqual(FILTROS_INICIAIS);
  });
});

describe("mesmosFiltros — a carteira decide por aqui se a URL mudou por fora", () => {
  it("compara pelo recorte, não pelo texto: espaço na busca e página 1 explícita não contam", () => {
    expect(mesmosFiltros({ ...FILTROS_INICIAIS, busca: " Ana ", pagina: 1 }, { ...FILTROS_INICIAIS, busca: "Ana" })).toBe(true);
    expect(mesmosFiltros(FILTROS_INICIAIS, filtrosDaUrl(""))).toBe(true);
  });
  it("o link do DNA (?carteira=ex_cliente&quadrante=C3) é outro recorte", () => {
    expect(mesmosFiltros(FILTROS_INICIAIS, filtrosDaUrl("carteira=ex_cliente&quadrante=C3"))).toBe(false);
    expect(mesmosFiltros(FILTROS_INICIAIS, { ...FILTROS_INICIAIS, pagina: 2 })).toBe(false);
  });
});

describe("temFiltros / limparFiltros", () => {
  it("carteira e página não contam como filtro", () => {
    expect(temFiltros({ ...FILTROS_INICIAIS, carteira: "ex_cliente", pagina: 4 })).toBe(false);
    expect(temFiltros({ ...FILTROS_INICIAIS, busca: " x" })).toBe(true);
    expect(temFiltros({ ...FILTROS_INICIAIS, divida: "ate-100" })).toBe(true);
  });
  it("limpar preserva a aba", () => {
    expect(limparFiltros({ ...FILTROS_INICIAIS, carteira: "ex_cliente", quadrante: "A1", pagina: 3 }))
      .toEqual({ ...FILTROS_INICIAIS, carteira: "ex_cliente" });
  });
});

describe("opções", () => {
  it("quadrante lista os 3 grupos e os 9 quadrantes com a abordagem", () => {
    expect(OPCOES_QUADRANTE.map(o => o.valor)).toEqual(["A", "B", "C", "A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"]);
    expect(OPCOES_QUADRANTE.find(o => o.valor === "B3")?.rotulo).toBe("B3 · cuidado · sem pressão");
  });
  it("situação é a do CASO, vivos antes dos fechados, mais 'sem caso' e 'todos' — o vocabulário da rota", () => {
    const valores = OPCOES_STATUS.map(o => o.valor);
    expect(valores).toEqual([...STATUS_ABERTOS_DE_CASO, ...STATUS_FECHADOS_DE_CASO, "sem_caso", "todos"]);
    // Os dois status novos (05/09/2026) entram pelo vocabulário, não por lista local.
    expect(valores.indexOf("em_contato")).toBeGreaterThan(valores.indexOf("aberto"));
    expect(valores.indexOf("em_contato")).toBeLessThan(valores.indexOf("negociando"));
    expect(valores).toContain("cancelamento");
  });
});

describe("paginação e visão", () => {
  it("totalDePaginas nunca é zero", () => {
    expect(totalDePaginas(0)).toBe(1);
    expect(totalDePaginas(51)).toBe(2);
    expect(totalDePaginas(100)).toBe(2);
  });
  it("visão lê o storage e cai em cards sem ele", () => {
    expect(lerVisao({ getItem: () => "tabela" })).toBe("tabela");
    expect(lerVisao({ getItem: () => "lixo" })).toBe("cards");
    expect(lerVisao({ getItem: () => { throw new Error("sem storage"); } })).toBe("cards");
    expect(lerVisao(null)).toBe("cards");
  });
});
