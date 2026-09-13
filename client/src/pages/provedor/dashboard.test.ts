/**
 * A lista "Funcionalidades disponiveis" do Painel do Provedor.
 *
 * Cada card e uma promessa: o titulo leva a uma tela, e a descricao diz o que o
 * provedor vai encontrar la. Ate 12/09/2026 o card Anti-Fraude prometia
 * "ranking de clientes em risco", mas /anti-fraude so lista alertas — nao ha
 * tela de ranking, e `GET /api/anti-fraud/customer-risk` nao tem consumidor no
 * client. O provedor clicava atras de um ranking que nao existe.
 *
 * O teste renderiza a pagina (SSR) e le os cards do HTML, em vez de repetir a
 * lista a mao: amostra copiada envelhece calada quando alguem acrescenta um card.
 * A tela de destino e achada pelo App.tsx (Route -> lazy import -> arquivo),
 * e a descricao so pode prometer ranking se a fonte dessa tela tiver um.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import DashboardPage from "./dashboard";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  useAuth: () => ({
    user: { name: "Operador", role: "admin" },
    provider: { id: 1, name: "Provedor", plan: "pro", subdomain: "provedor" },
    partnerCode: "ABC123",
    personificando: false,
    demoMode: false,
    marca: null,
    logout: vi.fn(),
  }),
}));

const APP = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

type Card = { url: string; titulo: string; desc: string };

function cardsDoDashboard(): Card[] {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  const html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client: queryClient },
      createElement(Router, { ssrPath: "/" }, createElement(DashboardPage))),
  );
  queryClient.clear();
  // CartaoAcao: <a href> > div > ladrilho + div > <p>titulo</p><p>descricao</p>.
  const cards = [...html.matchAll(/<a href="([^"]+)"><div[^>]*>.*?<p[^>]*>([^<]*)<\/p><p[^>]*>([^<]*)<\/p>/g)]
    .map(([, url, titulo, desc]) => ({ url, titulo, desc }));
  return cards;
}

/** Fonte da tela que o App.tsx monta em `url`: Route -> componente -> import. */
function fonteDaTela(url: string): string {
  const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const componente = APP.match(new RegExp(`<Route path="${escapar(url)}" component=\\{(\\w+)\\}`))?.[1];
  if (!componente) throw new Error(`${url} nao tem <Route component> em App.tsx`);
  const modulo = APP.match(new RegExp(`const ${componente} = lazy\\(pagina\\(\\(\\) => import\\("@/([^"]+)"\\)`))?.[1];
  if (!modulo) throw new Error(`${componente} nao tem lazy import em App.tsx`);
  return readFileSync(new URL(`../../${modulo}.tsx`, import.meta.url), "utf8");
}

describe("Funcionalidades disponiveis", () => {
  const cards = cardsDoDashboard();

  it("le todos os cards da pagina renderizada", () => {
    // Trava do proprio teste: se o markup do card mudar e a regex parar de
    // casar, as checagens abaixo passariam sobre uma lista vazia.
    expect(cards.length).toBeGreaterThanOrEqual(10);
    expect(cards.map(c => c.titulo)).toContain("Anti-Fraude");
  });

  it("todo card leva a uma tela que existe", () => {
    for (const c of cards) {
      expect(() => fonteDaTela(c.url), `${c.titulo} -> ${c.url}`).not.toThrow();
    }
  });

  it("nenhum card promete ranking que a tela de destino nao tem", () => {
    for (const c of cards.filter(c => /ranking/i.test(c.desc))) {
      // Booleano, e nao toMatch: na falha o toMatch despeja a fonte inteira da tela.
      expect(/ranking/i.test(fonteDaTela(c.url)), `"${c.titulo}" promete "${c.desc}", e ${c.url} nao tem ranking`).toBe(true);
    }
  });

  it("Anti-Fraude descreve os alertas que /anti-fraude lista, sem ranking de clientes", () => {
    const antiFraude = cards.find(c => c.url === "/anti-fraude");
    expect(antiFraude?.desc).not.toMatch(/ranking/i);
    // A tela diz "Outro provedor consultou este cliente": e disso que o alerta nasce.
    expect(antiFraude?.desc).toMatch(/outro provedor consulta/i);
  });
});
