// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ETAPAS_PADRAO } from "@shared/cobranca";
import { API_DNA, API_EQUIPE, API_REGUA } from "@/components/cobranca/tipos";
import { GradeDna } from "@/components/cobranca/GradeDna";
import ReguaPage from "./regua";

afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

function renderizar(carteira: "ativo" | "ex_cliente") {
  window.history.replaceState({}, "", `/cobranca/regua?carteira=${carteira}`);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData([`${API_REGUA}?carteira=${carteira}`], { etapas: ETAPAS_PADRAO, pausada: false, contagens: [] });
  queryClient.setQueryData([`${API_DNA}?carteira=${carteira}`], { contagens: [{ carteira, quadrante: null, casos: 2, valor: 100 }] });
  queryClient.setQueryData([API_EQUIPE], []);
  return render(createElement(QueryClientProvider, { client: queryClient }, createElement(ReguaPage)));
}

describe("régua e DNA por carteira", () => {
  it("ex-cliente mostra cobrança do encerrado e troca a voz ao escolher quadrantes", () => {
    renderizar("ex_cliente");
    expect(screen.queryByTestId("etapa-lembrete_pre_vencimento")).toBeNull();
    expect(screen.queryByTestId("etapa-aviso_suspensao")).toBeNull();
    expect(screen.getByTestId("etapa-lembrete_atraso").textContent).toContain("Conferência da dívida");
    expect(screen.getByTestId("bloco-dna").textContent).toContain("duração da relação encerrada");
    expect(screen.getByTestId("grade-dna").textContent).toContain("sem datas da relação encerrada ou histórico confirmado");
    fireEvent.click(screen.getByTestId("dna-celula-A1"));
    expect(within(screen.getByTestId("dna-detalhe")).getByRole("heading").textContent).toBe("Esclarecedor");
    fireEvent.click(screen.getByTestId("dna-celula-C3"));
    expect(within(screen.getByTestId("dna-detalhe")).getByRole("heading").textContent).toBe("Conciliador");
    expect(screen.getByTestId("dna-detalhe").textContent).toContain("contrato encerrado");
    expect(screen.getByTestId("dna-ver-carteira").getAttribute("href")).toBe("/cobranca/ex-clientes?quadrante=C3");
    expect(screen.getByTestId("bloco-dna").textContent).not.toMatch(/Boas-vindas|Negociar \+ reter|vence em 3 dias/);
    expect(screen.getByTestId("dna-detalhe").textContent).toContain("sobrepõe qualquer quadrante");
  });

  it("ativo conserva suas etapas e a grade mostra orientação de vínculo ativo", () => {
    renderizar("ativo");
    expect(screen.getByTestId("etapa-lembrete_pre_vencimento")).toBeTruthy();
    expect(screen.getByTestId("etapa-aviso_suspensao")).toBeTruthy();
    fireEvent.click(screen.getByTestId("dna-celula-A1"));
    expect(within(screen.getByTestId("dna-detalhe")).getByRole("heading").textContent).toBe("Boas-vindas");
    expect(screen.getByTestId("dna-ver-carteira").getAttribute("href")).toBe("/cobranca/ativos?quadrante=A1");
  });

  it("a mesma grade atualiza rótulos e diretiva ao mudar de carteira", () => {
    const props = { contagens: [], selecionado: "C3" as const, onSelecionar: vi.fn() };
    const { rerender } = render(createElement(GradeDna, { ...props, carteira: "ativo" }));
    expect(within(screen.getByTestId("dna-detalhe")).getByRole("heading").textContent).toBe("Negociar + reter");
    rerender(createElement(GradeDna, { ...props, carteira: "ex_cliente" }));
    expect(within(screen.getByTestId("dna-detalhe")).getByRole("heading").textContent).toBe("Conciliador");
    expect(screen.getByTestId("dna-detalhe").textContent).toContain("Longa · Atrasos recorrentes");
  });
});
