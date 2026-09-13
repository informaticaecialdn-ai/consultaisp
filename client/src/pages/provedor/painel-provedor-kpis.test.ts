/**
 * Os cartoes "Consultas ISP" e "Consultas SPC" da Visao Geral do Painel do
 * Provedor.
 *
 * Os dois ficavam em BRANCO para qualquer provedor que ja tivesse consultado:
 * a tela lia `.length` da resposta, mas nenhum dos dois GETs devolve lista —
 * devolvem um objeto, `{ consultations: [...], ... }`
 * (server/routes/consultas.routes.ts). `{}.length` e `undefined`, e o React
 * nao imprime nada. So aparecia um numero (0) enquanto a resposta nao chegava.
 *
 * Os dois formatos NAO sao iguais, e o teste cobre cada um:
 *  - ISP e paginada (50 por pagina): o numero certo e `total`. Contar a lista
 *    travaria o cartao em 50 para quem ja fez mais que isso.
 *  - SPC nao e paginada e nao traz `total`: a lista inteira e o total.
 *
 * Renderiza a pagina inteira (SSR), com as respostas ja no cache do
 * react-query — o mesmo caminho que a tela percorre no navegador.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import PainelProvedorPage from "./painel-provedor";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  useAuth: () => ({
    user: { name: "Operador", role: "admin" },
    provider: { id: 1, name: "Provedor", plan: "pro", subdomain: "provedor" },
    personificando: false,
    demoMode: false,
    marca: null,
    logout: vi.fn(),
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderizarPainel(respostas: Record<string, unknown>) {
  // A aba inicial sai de `window.location.search`; no node nao ha `window`.
  vi.stubGlobal("window", { location: { search: "" } });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  for (const [chave, dado] of Object.entries(respostas)) {
    queryClient.setQueryData([chave], dado);
  }
  const html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client: queryClient },
      createElement(Router, { ssrPath: "/painel-provedor" }, createElement(PainelProvedorPage))),
  );
  queryClient.clear();
  return html;
}

/** O texto do `<p data-testid="stat-...">` do cartao. */
function valorDoCartao(html: string, testid: string): string | undefined {
  return html.match(new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`))?.[1];
}

describe("cartoes de consultas do Painel do Provedor", () => {
  it("Consultas ISP mostra o total da resposta", () => {
    const html = renderizarPainel({
      "/api/isp-consultations": { consultations: [{ id: 1 }, { id: 2 }, { id: 3 }], total: 3, page: 1, pageSize: 50 },
      "/api/spc-consultations": { consultations: [], todayCount: 0, monthCount: 0, credits: 0 },
    });
    expect(valorDoCartao(html, "stat-consultas-isp")).toBe("3");
  });

  it("Consultas ISP le `total`, e nao o tamanho da pagina: 50 na lista, 137 no total", () => {
    const pagina = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
    const html = renderizarPainel({
      "/api/isp-consultations": { consultations: pagina, total: 137, page: 1, pageSize: 50 },
    });
    expect(valorDoCartao(html, "stat-consultas-isp")).toBe("137");
  });

  it("Consultas SPC, que nao traz `total`, conta a lista inteira", () => {
    const html = renderizarPainel({
      "/api/isp-consultations": { consultations: [], total: 0, page: 1, pageSize: 50 },
      "/api/spc-consultations": { consultations: [{ id: 1 }, { id: 2 }], todayCount: 1, monthCount: 2, credits: 10 },
    });
    expect(valorDoCartao(html, "stat-consultas-spc")).toBe("2");
  });

  /**
   * Sem resposta ainda (ou com o GET falhando), o cartao mostra "-", como os
   * dois vizinhos da mesma fileira. "0" afirmaria que o provedor nunca
   * consultou — uma afirmacao que a tela nao tem como fazer.
   */
  it("sem resposta, os dois cartoes mostram '-' e nao um zero inventado", () => {
    const html = renderizarPainel({});
    expect(valorDoCartao(html, "stat-consultas-isp")).toBe("-");
    expect(valorDoCartao(html, "stat-consultas-spc")).toBe("-");
  });
});
