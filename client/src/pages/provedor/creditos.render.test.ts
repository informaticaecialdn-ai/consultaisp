// @vitest-environment jsdom
/**
 * O saldo de /creditos RENDERIZADO (jsdom + Testing Library), com o
 * `AuthProvider` real por cima.
 *
 * O defeito: o saldo sai de `useAuth().provider.ispCredits`, e o `AuthProvider`
 * so lia `GET /api/auth/me` na montagem da aplicacao. Consultar gasta credito
 * no servidor, mas a sessao guardada no client continuava com o numero do
 * login — quem consultava e depois abria /creditos via o saldo de antes. E o
 * `invalidateQueries(["/api/auth/me"])` da compra nao alcancava nada: o
 * `AuthProvider` nao usa React Query, entao nao existe query com essa chave.
 *
 * O componente e o real; so o `fetch` e dublado (e por ele que o
 * `AuthProvider` e o `apiRequest` falam com o servidor). `saldoNoServidor` e o
 * `providers.isp_credits` do banco: o teste o muda por fora, como uma consulta
 * ou uma liberacao de pagamento mudaria.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, notifyManager } from "@tanstack/react-query";
import type { TabelaDePrecos } from "@/lib/precos";
import { AuthProvider } from "@/lib/auth";
import { getQueryFn } from "@/lib/queryClient";
import CreditosPage from "./creditos";

const TABELA: TabelaDePrecos = {
  origem: "plataforma", marcaId: null, planos: [], custoEmCreditos: {},
  pacotes: [{
    id: "pack-50", nome: "50 créditos", creditos: 50, precoCentavos: 5000, precoReais: 50,
    precoLabel: "R$ 50,00", precoUnitarioCentavos: 100, precoUnitarioLabel: "R$ 1,00 por crédito", popular: false,
  }],
};

let saldoNoServidor = 0;
let aoComprar: () => void = () => {};
let pedidos: unknown[] = [];

function resposta(corpo: unknown) {
  return { ok: true, status: 200, statusText: "OK", json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

beforeEach(() => {
  saldoNoServidor = 10;
  aoComprar = () => {};
  pedidos = [];
  notifyManager.setNotifyFunction(fn => { act(() => { fn(); }); });
  vi.stubGlobal("fetch", vi.fn(async (entrada: string) => {
    const url = String(entrada);
    if (url === "/api/auth/me") {
      return resposta({
        user: { id: 1, email: "dono@provedor.com.br", name: "Dono", role: "admin" },
        provider: { id: 7, name: "Provedor", ispCredits: saldoNoServidor },
        demoMode: false,
      });
    }
    if (url === "/api/credits/orders") return resposta(pedidos);
    if (url === "/api/credits/packages") return resposta(TABELA);
    if (url === "/api/credits/purchase") {
      aoComprar();
      return resposta({ order: { id: 1, orderNumber: "PC-0001" }, charge: null });
    }
    throw new Error(`fetch inesperado no teste: ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  notifyManager.setNotifyFunction(fn => { fn(); });
  vi.unstubAllGlobals();
});

/** A aplicacao como o App monta: sessao por fora, React Query, e a tela da rota. */
function arvore(client: QueryClient, tela: ReactNode) {
  return createElement(AuthProvider, null, createElement(QueryClientProvider, { client }, tela));
}

/** Com o `queryFn` padrao do app: as queries desta tela so passam a chave. */
function novoClient() {
  return new QueryClient({ defaultOptions: { queries: { queryFn: getQueryFn({ on401: "throw" }), retry: false }, mutations: { retry: false } } });
}

const saldoNaTela = () => screen.getByTestId("text-credits-balance").textContent;

describe("/creditos — saldo depois de gastar e de comprar", () => {
  it("quem consultou em outra tela e abre /creditos ve o saldo que o servidor tem agora", async () => {
    const client = novoClient();
    // A sessao carrega com 10 numa tela qualquer (a de consulta, por exemplo).
    const { rerender } = render(arvore(client, createElement("div", { "data-testid": "outra-tela" })));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/auth/me", expect.anything()));
    await act(async () => {});

    // A consulta debitou 3 no servidor. O AuthProvider continua montado, como
    // no SPA: so a rota troca.
    saldoNoServidor = 7;
    rerender(arvore(client, createElement(CreditosPage)));

    await waitFor(() => expect(saldoNaTela()).toBe("7"));
  });

  it("depois da compra, o saldo da tela e o que o servidor devolve — nao o do login", async () => {
    const user = userEvent.setup({ delay: null });
    render(arvore(novoClient(), createElement(CreditosPage)));
    await waitFor(() => expect(saldoNaTela()).toBe("10"));

    // Entre abrir a tela e confirmar o pedido, um pagamento anterior compensou
    // e o servidor passou a ter 60.
    aoComprar = () => { saldoNoServidor = 60; };
    await user.click(await screen.findByTestId("package-pack-50"));
    await user.click(screen.getByTestId("button-pay-pix"));
    await screen.findByTestId("modal-pedido-criado");

    await waitFor(() => expect(saldoNaTela()).toBe("60"));
  });

  it("um PIX que compensa com a tela aberta aparece no saldo sem sair nem dar F5", async () => {
    // So o intervalo e falso: e o relogio da releitura dos pedidos. O `waitFor`
    // segue vendo o DOM pelo MutationObserver.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    pedidos = [{ id: 1, orderNumber: "PC-0001", status: "pending", packageName: "50 créditos", amount: "50.00", asaasChargeId: "pay_1" }];
    render(arvore(novoClient(), createElement(CreditosPage)));
    await screen.findByTestId("pending-order-1");
    await waitFor(() => expect(saldoNaTela()).toBe("10"));

    // O pedido nasce `pending` e o credito so entra pelo webhook do Asaas, que
    // o client nao ouve: o servidor passa a ter o pedido pago e o saldo 60.
    pedidos = [{ ...(pedidos[0] as object), status: "paid" }];
    saldoNoServidor = 60;
    await act(async () => { vi.advanceTimersByTime(60_000); });

    await waitFor(() => expect(saldoNaTela()).toBe("60"));
    expect(screen.queryByTestId("pending-order-1")).toBeNull();
  });

  it("sem pedido pendente a tela nao fica relendo os pedidos", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    pedidos = [{ id: 1, orderNumber: "PC-0001", status: "paid", packageName: "50 créditos", amount: "50.00" }];
    render(arvore(novoClient(), createElement(CreditosPage)));
    await screen.findByTestId("order-row-1");
    const leiturasDePedidos = () => vi.mocked(fetch).mock.calls.filter(([u]) => String(u) === "/api/credits/orders").length;
    const antes = leiturasDePedidos();
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(leiturasDePedidos()).toBe(antes);
  });
});
