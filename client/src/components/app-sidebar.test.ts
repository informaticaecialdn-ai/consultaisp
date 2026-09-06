import { describe, it, expect } from "vitest";
import { REVENDA_PATHS } from "../App";
import { NAV_PROVEDOR, NAV_REVENDEDOR, itemDeProvedorAtivo, itemDeRevendaAtivo } from "./app-sidebar";

/**
 * A barra lateral do revendedor.
 *
 * Duas coisas dela cabem em teste sem montar React, e as duas ja quebraram em
 * produto real: um menu que aponta para tela inexistente, e mais de um item
 * aceso ao mesmo tempo.
 */

describe("NAV_REVENDEDOR", () => {
  /**
   * O acordo desta fase, por escrito: Provedores, Comissoes, Precos e
   * Relatorios estao desenhados e chegam nas fases 2 a 4. Se alguem antecipar o
   * item de menu sem a tela, este teste avisa antes de o revendedor descobrir
   * pelo 404.
   */
  it("so aponta para telas que existem nesta fase", () => {
    const urls = NAV_REVENDEDOR.flatMap(g => g.itens.map(i => i.url));
    for (const url of urls) {
      expect(REVENDA_PATHS, `${url} nao tem rota em App.tsx`).toContain(url);
    }
  });

  it("as tres telas da fase 1 estao no menu", () => {
    const urls = NAV_REVENDEDOR.flatMap(g => g.itens.map(i => i.url));
    expect(urls).toEqual(["/revenda", "/revenda/marca", "/revenda/usuarios"]);
  });

  it("nenhum item repete rota ou identificador de teste", () => {
    const itens = NAV_REVENDEDOR.flatMap(g => g.itens);
    expect(new Set(itens.map(i => i.url)).size).toBe(itens.length);
    expect(new Set(itens.map(i => i.testId)).size).toBe(itens.length);
  });
});

describe("itemDeRevendaAtivo", () => {
  const urls = NAV_REVENDEDOR.flatMap(g => g.itens.map(i => i.url));
  const acesos = (caminho: string) => urls.filter(url => itemDeRevendaAtivo(url, caminho));

  it("cada tela acende o proprio item", () => {
    expect(acesos("/revenda")).toEqual(["/revenda"]);
    expect(acesos("/revenda/marca")).toEqual(["/revenda/marca"]);
    expect(acesos("/revenda/usuarios")).toEqual(["/revenda/usuarios"]);
  });

  /**
   * O motivo de a raiz casar exato. Com a regra de prefixo dos outros itens,
   * "Visão geral" ficaria aceso junto com "Minha marca" em /revenda/marca —
   * duas linhas destacadas, e ninguem sabe mais onde esta.
   */
  it("nunca acende dois itens ao mesmo tempo", () => {
    for (const caminho of ["/revenda", "/revenda/marca", "/revenda/usuarios", "/revenda/provedores/9"]) {
      expect(acesos(caminho).length, caminho).toBeLessThanOrEqual(1);
    }
  });

  it("subrota mantem o pai aceso", () => {
    // As fases seguintes trazem /revenda/marca/dominio e afins.
    expect(itemDeRevendaAtivo("/revenda/marca", "/revenda/marca/dominio")).toBe(true);
  });

  it("rota de nome parecido nao acende nada", () => {
    expect(itemDeRevendaAtivo("/revenda/marca", "/revenda/marcas")).toBe(false);
    expect(acesos("/revenda-antiga")).toEqual([]);
  });
});

describe("navegação independente das carteiras", () => {
  it.each([
    ["/cobranca/fila", "ativo"],
    ["/cobranca/fila", "ex_cliente"],
    ["/cobranca/kanban", "ativo"],
    ["/cobranca/kanban", "ex_cliente"],
    ["/cobranca/regua", "ativo"],
    ["/cobranca/regua", "ex_cliente"],
  ])("%s destaca somente a operação da carteira %s", (rota, carteira) => {
    const links = [`${rota}?carteira=ativo`, `${rota}?carteira=ex_cliente`];
    expect(links.filter(url => itemDeProvedorAtivo(url, rota, `responsavel=eu&carteira=${carteira}`)))
      .toEqual([`${rota}?carteira=${carteira}`]);
  });

  it("links antigos sem carteira destacam a operação de clientes ativos", () => {
    expect(itemDeProvedorAtivo("/cobranca/fila?carteira=ativo", "/cobranca/fila")).toBe(true);
    expect(itemDeProvedorAtivo("/cobranca/fila?carteira=ex_cliente", "/cobranca/fila")).toBe(false);
  });

  it("a ficha destaca a visão geral da carteira de origem", () => {
    expect(itemDeProvedorAtivo("/cobranca/ex-clientes?carteira=ex_cliente", "/cobranca/cliente/42", "carteira=ex_cliente")).toBe(true);
    expect(itemDeProvedorAtivo("/cobranca/ativos?carteira=ativo", "/cobranca/cliente/42", "carteira=ex_cliente")).toBe(false);
  });

  it("a rota própria prevalece sobre um parâmetro antigo", () => {
    expect(itemDeProvedorAtivo("/cobranca/ativos?carteira=ativo", "/cobranca/ativos", "carteira=ex_cliente")).toBe(true);
    expect(itemDeProvedorAtivo("/cobranca/ex-clientes?carteira=ex_cliente", "/cobranca/ex-clientes", "carteira=ativo")).toBe(true);
  });

  it("cada menu mantém sua carteira em todos os destinos operacionais", () => {
    const grupo = NAV_PROVEDOR.find(g => g.grupo === "Cobrança")!;
    const ativos = grupo.itens.find(i => i.label === "Clientes Ativos")!;
    const exClientes = grupo.itens.find(i => i.label === "Ex-Clientes")!;
    expect(ativos.filhos?.map(i => i.url)).toEqual([
      "/cobranca/ativos?carteira=ativo", "/cobranca/fila?carteira=ativo",
      "/cobranca/kanban?carteira=ativo", "/cobranca/regua?carteira=ativo",
    ]);
    expect(exClientes.filhos?.map(i => i.url)).toEqual([
      "/cobranca/ex-clientes?carteira=ex_cliente", "/cobranca/fila?carteira=ex_cliente",
      "/cobranca/kanban?carteira=ex_cliente", "/cobranca/regua?carteira=ex_cliente",
    ]);
  });
});
