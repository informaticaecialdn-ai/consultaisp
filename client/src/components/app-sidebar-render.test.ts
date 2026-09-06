import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { SidebarProvider } from "./ui/sidebar";
import { AppSidebar } from "./app-sidebar";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { name: "Operador", role: "admin" }, provider: { name: "Provedor" },
    marca: null, personificando: false, logout: vi.fn(),
  }),
}));

function renderizarSidebar(caminho: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient },
    createElement(Router, { ssrPath: caminho },
      createElement(SidebarProvider, null, createElement(AppSidebar))),
  ));
  queryClient.clear();
  return html;
}

describe("menus de cobrança renderizados", () => {
  it("expõe dois controles nativos nomeados e abre o menu da operação atual", () => {
    const html = renderizarSidebar("/cobranca/kanban?carteira=ex_cliente");
    const menus = [...html.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g)];
    expect(menus).toHaveLength(2);
    expect(menus[0][1]).toContain('data-testid="menu-cobranca-ativos"');
    expect(menus[0][1]).not.toContain('open=""');
    expect(menus[1][1]).toContain('data-testid="menu-cobranca-ex-clientes"');
    expect(menus[1][1]).toContain('open=""');
    expect(menus[0][2]).toMatch(/<summary\b[^>]*>[\s\S]*?<span[^>]*>Clientes Ativos<\/span>[\s\S]*?<\/summary>/);
    expect(menus[1][2]).toMatch(/<summary\b[^>]*>[\s\S]*?<span[^>]*>Ex-Clientes<\/span>[\s\S]*?<\/summary>/);
    const selecionados = html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
    expect(selecionados).toHaveLength(1);
    expect(selecionados[0]).toContain('href="/cobranca/kanban?carteira=ex_cliente"');
  });

  it("Conversas mantém a carteira atual e aparece antes dos dois menus", () => {
    const html = renderizarSidebar("/cobranca/ex-clientes");
    const conversa = html.match(/<a\b[^>]*data-testid="link-cobranca-chat"[^>]*>/)?.[0];
    expect(conversa).toContain('href="/cobranca/chat?carteira=ex_cliente"');
    expect(html.indexOf('data-testid="link-cobranca-chat"')).toBeLessThan(html.indexOf('data-testid="menu-cobranca-ativos"'));
    const politica = html.match(/<a\b[^>]*data-testid="link-cobranca-politica"[^>]*>/)?.[0];
    expect(politica).toContain('href="/cobranca/politica"');
  });

  it("permite escolher qualquer carteira ao entrar de fora da cobrança", () => {
    const html = renderizarSidebar("/creditos");
    expect(html).toContain('href="/cobranca/kanban?carteira=ativo"');
    expect(html).toContain('href="/cobranca/kanban?carteira=ex_cliente"');
    // A fila do dia saiu do menu em 06/09/2026 — o quadro e o unico lugar do dia.
    expect(html).not.toContain("/cobranca/fila");
    expect(html).not.toContain("Fila do dia");
    const conversa = html.match(/<a\b[^>]*data-testid="link-cobranca-chat"[^>]*>/)?.[0];
    expect(conversa).toContain('href="/cobranca/chat"');
  });
});
