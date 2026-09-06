/**
 * O filtro por faixa de atraso do quadro (pedido do dono, 06/09/2026).
 *
 * O que este teste protege:
 *  1. a faixa entra e sai da URL — o recorte é compartilhável e é o mesmo que
 *     vai para a API em `atraso=`;
 *  2. valor torto na URL é ignorado, nunca derruba a tela;
 *  3. a pílula oferece as seis faixas mais "todas", com o motivo de cada uma
 *     no `title` — em especial o dos 90 dias, que é a razão do corte;
 *  4. a pílula NÃO inventa contagem: sem número do servidor, sai só o rótulo.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { FAIXAS_DE_ATRASO, LIMITES_DA_FAIXA_DE_ATRASO } from "@shared/cobranca";
import {
  FiltroDeAtraso,
  PARAMETRO_ATRASO,
  TITULO_DO_FILTRO,
  atrasoDaUrl,
  opcoesDeAtraso,
  tituloDaFaixa,
  tituloDoFiltro,
  urlComAtraso,
  useFiltroDeAtraso,
} from "./filtro-atraso";

const renderizar = (elemento: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(elemento);

/** As `<option>` desenhadas, com value, título e texto. */
function opcoesDoHtml(html: string): Array<{ valor: string; titulo: string | null; texto: string }> {
  return [...html.matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)].map(m => ({
    valor: /value="([^"]*)"/.exec(m[1])?.[1] ?? "",
    titulo: /title="([^"]*)"/.exec(m[1])?.[1] ?? null,
    texto: m[2],
  }));
}

describe("a faixa entra e sai da URL", () => {
  it("lê a faixa de `atraso=` com ou sem a interrogação", () => {
    expect(atrasoDaUrl("?atraso=mais-90")).toBe("mais-90");
    expect(atrasoDaUrl("atraso=31-60&carteira=ativo")).toBe("31-60");
    expect(atrasoDaUrl("")).toBe("");
  });

  it("escreve a faixa preservando os outros parâmetros, e a limpa quando é 'todas'", () => {
    expect(urlComAtraso("/cobranca/kanban", "?carteira=ex_cliente", "mais-90"))
      .toBe("/cobranca/kanban?carteira=ex_cliente&atraso=mais-90");
    expect(urlComAtraso("/cobranca/kanban", "?carteira=ativo&atraso=8-15", ""))
      .toBe("/cobranca/kanban?carteira=ativo");
    // Sem nenhum parâmetro sobra a URL limpa — a que se compartilha.
    expect(urlComAtraso("/cobranca/kanban", "?atraso=ate-7", "")).toBe("/cobranca/kanban");
  });

  it("trocar de faixa larga a página: página 3 de outro recorte não quer dizer nada", () => {
    expect(urlComAtraso("/cobranca/ativos", "?pagina=3", "61-90")).toBe("/cobranca/ativos?atraso=61-90");
  });

  it("ida e volta: toda faixa sobrevive ao par escrever/ler", () => {
    for (const faixa of FAIXAS_DE_ATRASO) {
      const url = urlComAtraso("/cobranca/kanban", "?carteira=ativo", faixa);
      expect(atrasoDaUrl(url.slice(url.indexOf("?"))), faixa).toBe(faixa);
      expect(url).toContain(`${PARAMETRO_ATRASO}=${faixa}`);
    }
  });

  it("o parâmetro se chama `atraso` — o mesmo nome na URL e na query da API", () => {
    expect(PARAMETRO_ATRASO).toBe("atraso");
  });
});

describe("valor inválido na URL é ignorado, nunca derruba a tela", () => {
  it.each(["", "todos", "90", "0-7", "MAIS-90", "mais-90 ", "'; drop table"])("%s vira 'todas'", lixo => {
    expect(atrasoDaUrl(`?atraso=${encodeURIComponent(lixo)}`)).toBe("");
  });

  it("faixa torta não é escrita na URL nem selecionada na pílula", () => {
    expect(urlComAtraso("/cobranca/kanban", "?atraso=mais-90", "todos" as never)).toBe("/cobranca/kanban");
    // A pílula cai em "todas": quem está selecionado é a opção vazia, nenhuma faixa.
    const html = renderizar(createElement(FiltroDeAtraso, { valor: "todos", onChange: () => {} }));
    expect(html).toContain('<option value="" selected');
    for (const faixa of FAIXAS_DE_ATRASO) expect(html, faixa).not.toContain(`value="${faixa}" selected`);
    expect(html).not.toContain("Atraso:");
  });

  it("o hook lê a faixa da URL da tela", () => {
    function Sonda() {
      const { atraso } = useFiltroDeAtraso();
      return createElement("i", { "data-atraso": atraso });
    }
    const comFaixa = renderizar(createElement(Router, { ssrPath: "/cobranca/kanban", ssrSearch: "atraso=16-30" }, createElement(Sonda)));
    expect(comFaixa).toContain('data-atraso="16-30"');
    const comLixo = renderizar(createElement(Router, { ssrPath: "/cobranca/kanban", ssrSearch: "atraso=xpto" }, createElement(Sonda)));
    expect(comLixo).toContain("<i");
    expect(comLixo).not.toContain("xpto");
  });
});

describe("a pílula oferece as seis faixas e diz por que cada uma existe", () => {
  const html = renderizar(createElement(FiltroDeAtraso, { valor: "", onChange: () => {} }));
  const opcoes = opcoesDoHtml(html);

  it("as seis, na ordem do dono, mais 'todas'", () => {
    expect(opcoes.map(o => o.valor)).toEqual(["", ...FAIXAS_DE_ATRASO]);
    expect(opcoes[0].texto).toBe("Todas as faixas");
    expect(opcoes.slice(1).map(o => o.texto)).toEqual([
      "Até 7 dias", "8 a 15 dias", "16 a 30 dias", "31 a 60 dias", "61 a 90 dias", "Mais de 90 dias",
    ]);
  });

  it("cada opção leva o motivo da faixa no title", () => {
    for (const faixa of FAIXAS_DE_ATRASO) {
      const opcao = opcoes.find(o => o.valor === faixa)!;
      expect(opcao.titulo, faixa).toContain(LIMITES_DA_FAIXA_DE_ATRASO[faixa].motivo.slice(0, 24));
    }
  });

  it("o título dos 90 dias é a razão que o dono deu para o corte", () => {
    expect(tituloDaFaixa("mais-90")).toMatch(/dificilmente ainda tem contrato ativo/);
    expect(tituloDoFiltro("mais-90")).toContain(TITULO_DO_FILTRO);
    expect(tituloDoFiltro("mais-90")).toMatch(/dificilmente ainda tem contrato ativo/);
    expect(tituloDoFiltro("")).toBe(TITULO_DO_FILTRO);
  });

  it("em ex-clientes o title avisa que a última faixa não tem teto — o atraso lá é de anos", () => {
    expect(tituloDaFaixa("mais-90", "ex_cliente")).toMatch(/não tem teto/);
    expect(tituloDaFaixa("mais-90", "ativo")).not.toMatch(/não tem teto/);
    // As outras cinco não mudam de conversa por causa da carteira.
    for (const faixa of FAIXAS_DE_ATRASO.filter(f => f !== "mais-90")) {
      expect(tituloDaFaixa(faixa, "ex_cliente"), faixa).toBe(tituloDaFaixa(faixa, "ativo"));
    }
  });

  it("ligada, o chip mostra a faixa curta e o número sai mono tabular", () => {
    const ligada = renderizar(createElement(FiltroDeAtraso, { valor: "31-60", onChange: () => {} }));
    expect(ligada).toContain("Atraso");
    expect(ligada).toMatch(/font-mono tabular-nums[^>]*>: 31–60d/);
  });
});

describe("a pílula não inventa contagem que o servidor não mandou", () => {
  it("sem contagens, a opção é só o rótulo — nada de zero", () => {
    const opcoes = opcoesDeAtraso();
    expect(opcoes.map(o => o.rotulo)).toEqual(FAIXAS_DE_ATRASO.map(f => LIMITES_DA_FAIXA_DE_ATRASO[f].rotulo));
    for (const o of opcoes) expect(o.rotulo, o.valor).not.toMatch(/·/);
  });

  it("contagem só onde o servidor contou; o resto continua sem número", () => {
    const opcoes = opcoesDeAtraso({ contagens: { "ate-7": 12, "mais-90": 0, "8-15": null } });
    expect(opcoes.find(o => o.valor === "ate-7")!.rotulo).toBe("Até 7 dias · 12");
    // Zero medido é zero, e aparece: o que não pode é zero inventado.
    expect(opcoes.find(o => o.valor === "mais-90")!.rotulo).toBe("Mais de 90 dias · 0");
    expect(opcoes.find(o => o.valor === "8-15")!.rotulo).toBe("8 a 15 dias");
    expect(opcoes.find(o => o.valor === "31-60")!.rotulo).toBe("31 a 60 dias");
  });

  it("o rótulo desenhado não ganha número de lugar nenhum", () => {
    const html = renderizar(createElement(FiltroDeAtraso, { valor: "", onChange: () => {} }));
    expect(html).not.toContain("· 0");
    expect(html).not.toContain("(0)");
  });
});
