// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "admin" } }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: request, queryClient: { setQueryData: vi.fn() } }));
import { AvisosFaturas } from "./AvisosFaturas";
beforeEach(() => {
  vi.clearAllMocks();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["/api/cobranca/avisos-faturas/config"], { ligada: true, diasAntes: [7, 3, 1], canal: "whatsapp", limiteDiario: 10 });
  render(createElement(QueryClientProvider, { client }, createElement(AvisosFaturas)));
});
afterEach(cleanup);
describe("AvisosFaturas", () => {
  it("simula opções alteradas sem salvar e apresenta motivos", async () => {
    request.mockResolvedValue({ json: async () => ({ dia: "2026-09-08", analisadas: 1, elegiveis: 0, excluidas: 1, limitada: false, calendarioPermitido: true, fonte: "Espelho ERP", itens: [{ faturaId: 8, customerId: 42, nome: "Maria", vencimento: "2026-09-15", valor: 100, ultimaSincronizacao: null, elegivel: false, motivos: ["Fatura paga, cancelada ou fechada"] }] }) });
    fireEvent.change(screen.getByLabelText("Dias antes do vencimento"), { target: { value: "10, 0" } });
    fireEvent.click(screen.getByRole("button", { name: "Simular público" }));
    await screen.findByText("Fatura paga, cancelada ou fechada");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("POST", "/api/cobranca/avisos-faturas/simular", expect.objectContaining({ config: expect.objectContaining({ diasAntes: [10, 0] }) }));
    fireEvent.change(screen.getByLabelText("Dias antes do vencimento"), { target: { value: "2" } });
    await waitFor(() => expect(screen.queryByText("Fatura paga, cancelada ou fechada")).toBeNull());
  });
  it("recusa dias duplicados antes de chamar API", () => {
    fireEvent.change(screen.getByLabelText("Dias antes do vencimento"), { target: { value: "1, 1" } });
    expect((screen.getByRole("button", { name: "Salvar configuração" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Simular público" }) as HTMLButtonElement).disabled).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});
