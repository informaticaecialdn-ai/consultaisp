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

/**
 * Quais enderecos a barra lateral consulta.
 *
 * A sidebar esta em TODA tela do provedor, entao cada query dela e uma
 * requisicao por pagina aberta. Uma query que aponta para rota inexistente nao
 * quebra nada a vista: o client recebe 404 (em dev, o HTML do Vite), a query
 * falha em silencio e o componente some. Foi assim com o aviso de trial —
 * GET /api/provider/trial-status sem rota, sem coluna e sem trial no servidor,
 * e o banner nunca apareceu para ninguem.
 *
 * `enabled: false` impede o fetch, mas o useQuery ainda registra a query no
 * cache ao renderizar: e dele que sai a lista de enderecos.
 */
function consultasDaSidebar(caminho: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient },
    createElement(Router, { ssrPath: caminho },
      createElement(SidebarProvider, null, createElement(AppSidebar))),
  ));
  const chaves = queryClient.getQueryCache().getAll().map(q => q.queryKey.join("/"));
  queryClient.clear();
  return chaves;
}

describe("consultas da barra lateral do provedor", () => {
  it("nenhuma query aponta para trial-status, que nao tem rota no servidor", () => {
    const chaves = consultasDaSidebar("/");
    expect(chaves.length).toBeGreaterThan(0);
    expect(chaves.filter(chave => chave.includes("trial-status"))).toEqual([]);
  });
});
