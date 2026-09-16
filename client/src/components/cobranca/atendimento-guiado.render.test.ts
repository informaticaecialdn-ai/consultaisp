// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KanbanCobranca } from "./KanbanCobranca";
vi.mock("./PainelDoCaso", () => ({ PainelDoCaso: () => null }));
afterEach(cleanup);
it("abre e recolhe o atendimento guiado em um quadro sem casos", () => {
  render(createElement(QueryClientProvider, {client:new QueryClient()}, createElement(KanbanCobranca, {
    quadro:{colunas:[],total:0,kpis:null,pausada:false,pausadaMotivo:null},
    chaveDaQuery:["teste"], etapas:[], hoje:new Date(), podeAdministrar:false,
    acoes:{onContato:vi.fn()}, onNegociar:vi.fn(), onCancelar:vi.fn(),
  })));
  fireEvent.click(screen.getByRole("button", {name:"Iniciar atendimento"}));
  expect(screen.getByText(/Nenhum caso elegível/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"Recolher"}));
  expect(screen.queryByText(/Nenhum caso elegível/)).toBeNull();
});
