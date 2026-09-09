import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { NavegacaoCarteiras } from "./NavegacaoCarteiras";

describe("navegação interna exclusiva da carteira", () => {
  it.each(["ativo", "ex_cliente"] as const)("todos os destinos permanecem em %s", carteira => {
    const html = renderToStaticMarkup(createElement(Router, { ssrPath: "/cobranca/esteira" },
      createElement(NavegacaoCarteiras, { carteira, destino: "/cobranca/esteira" })));
    const links = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1].replaceAll("&amp;", "&"));
    expect(links).toHaveLength(4);
    for (const href of links) {
      const url = new URL(href, "http://localhost");
      expect(url.searchParams.get("carteira")).toBe(carteira);
      expect(url.pathname).not.toBe(carteira === "ativo" ? "/cobranca/ex-clientes" : "/cobranca/ativos");
    }
    expect(html).toContain("Carteira");
    expect(html).toContain("Esteira");
    expect(html).toContain("Régua e DNA");
    expect(html).toContain("Conversas");
    expect(html).not.toContain(carteira === "ativo" ? "Ex-clientes" : "Clientes ativos");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
