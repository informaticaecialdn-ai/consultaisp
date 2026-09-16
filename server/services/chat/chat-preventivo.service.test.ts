import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fila = vi.hoisted(() => ({ obterConfigAvisos: vi.fn(), listarPreAvisosPendentes: vi.fn(), reservarPreAviso: vi.fn(), concluirPreAviso: vi.fn() }));
const envio = vi.hoisted(() => vi.fn());
vi.mock("../../storage/cobranca-preventivo.storage", () => ({ CobrancaPreventivoStorage: class { obterConfigAvisos = fila.obterConfigAvisos; listarPreAvisosPendentes = fila.listarPreAvisosPendentes; reservarPreAviso = fila.reservarPreAviso; concluirPreAviso = fila.concluirPreAviso; } }));
const politica = vi.hoisted(() => vi.fn());
const diario = vi.hoisted(() => ({ reservarComunicacao: vi.fn(), concluirComunicacao: vi.fn() }));
vi.mock("../../storage/cobranca-comunicacao.storage", () => diario);
vi.mock("../../storage", () => ({ storage: { getIntegracaoDoChat: vi.fn(), getPoliticaDeCobranca: politica } }));
vi.mock("./chat-ponte.service", () => ({ enviarPreAvisoParaChat: envio }));
import { executarPreAviso } from "./chat-preventivo.service";

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-08T15:00:00Z"));
  diario.reservarComunicacao.mockResolvedValue(12);
  politica.mockResolvedValue({ pausada: false });
  fila.obterConfigAvisos.mockResolvedValue({ ligada: true, canal: "whatsapp", diasAntes: [7, 3, 1], limiteDiario: 10 });
  fila.listarPreAvisosPendentes.mockResolvedValue([{ id: 1, faturaId: 10, customerId: 42, nome: "Maria", telefone: "11999999999", valor: "100", status: "aberta", vencimento: new Date("2026-09-15T00:00:00Z") }]);
  fila.reservarPreAviso.mockResolvedValue(true);
  envio.mockResolvedValue({ enviado: true, conversationId: "c1", messageId: "m1" });
});
afterEach(() => vi.useRealTimers());
describe("execução preventiva", () => {
  it("não envia fora da janela nem com política pausada", async () => {
    politica.mockResolvedValueOnce({ pausada: true });
    expect(await executarPreAviso(6, 1, 9, "2026-09-08")).toEqual({ enviado: false });
    vi.setSystemTime(new Date("2026-09-08T23:00:00Z"));
    expect(await executarPreAviso(6, 1, 9, "2026-09-08")).toEqual({ enviado: false });
    expect(diario.reservarComunicacao).not.toHaveBeenCalled();
  });
  it("reserva no diário compartilhado antes do CAS e respeita bloqueio de outro canal", async () => {
    diario.reservarComunicacao.mockResolvedValueOnce(null);
    expect(await executarPreAviso(6, 1, 9, "2026-09-08")).toEqual({ enviado: false });
    expect(fila.reservarPreAviso).not.toHaveBeenCalled();
    await executarPreAviso(6, 1, 9, "2026-09-08");
    expect(diario.concluirComunicacao).toHaveBeenCalledWith(6, 12, expect.objectContaining({ status: "enviado" }));
  });
  it("respeita pausa e alteração de canal antes da reserva", async () => {
    fila.obterConfigAvisos.mockResolvedValueOnce({ ligada: false, canal: "whatsapp", diasAntes: [7], limiteDiario: 10 });
    expect(await executarPreAviso(6, 1, 9, "2026-09-08")).toEqual({ enviado: false });
    fila.obterConfigAvisos.mockResolvedValueOnce({ ligada: true, canal: "email", diasAntes: [7], limiteDiario: 10 });
    expect(await executarPreAviso(6, 1, 9, "2026-09-08")).toEqual({ enviado: false });
    expect(fila.reservarPreAviso).not.toHaveBeenCalled();
  });
  it("reserva por fatura e dia antes do envio; corrida não duplica", async () => {
    fila.reservarPreAviso.mockResolvedValueOnce(false);
    expect(await executarPreAviso(6, 1, 9, "2026-09-08")).toEqual({ enviado: false });
    expect(envio).not.toHaveBeenCalled();
    await executarPreAviso(6, 1, 9, "2026-09-08");
    expect(fila.reservarPreAviso).toHaveBeenCalledWith(6, 1, "2026-09-08");
    expect(fila.concluirPreAviso).toHaveBeenCalledWith(6, 1, expect.objectContaining({ status: "enviado", messageId: "m1" }));
  });
  it("fatura liquidada não envia; timeout é incerto e não volta à fila", async () => {
    fila.listarPreAvisosPendentes.mockResolvedValueOnce([]);
    await executarPreAviso(6, 1, 9, "2026-09-08");
    expect(envio).not.toHaveBeenCalled();
    envio.mockRejectedValueOnce(new Error("timeout"));
    await expect(executarPreAviso(6, 1, 9, "2026-09-08")).rejects.toThrow("timeout");
    expect(fila.concluirPreAviso).toHaveBeenCalledWith(6, 1, expect.objectContaining({ status: "incerto" }));
  });
});
