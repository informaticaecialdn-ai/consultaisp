import { beforeEach, describe, expect, it, vi } from "vitest";
const fila = vi.hoisted(() => ({ listarPreAvisosPendentes: vi.fn(), reservarPreAviso: vi.fn(), concluirPreAviso: vi.fn() }));
const envio = vi.hoisted(() => vi.fn());
vi.mock("../../storage/cobranca-preventivo.storage", () => ({ CobrancaPreventivoStorage: class { listarPreAvisosPendentes = fila.listarPreAvisosPendentes; reservarPreAviso = fila.reservarPreAviso; concluirPreAviso = fila.concluirPreAviso; } }));
vi.mock("./chat-ponte.service", () => ({ enviarPreAvisoParaChat: envio }));
import { executarPreAviso } from "./chat-preventivo.service";

beforeEach(() => {
  vi.resetAllMocks();
  fila.listarPreAvisosPendentes.mockResolvedValue([{ id: 1, faturaId: 10, customerId: 42, nome: "Maria", telefone: "11999999999", valor: "100", status: "aberta", vencimento: new Date("2026-09-15T00:00:00Z") }]);
  fila.reservarPreAviso.mockResolvedValue(true);
  envio.mockResolvedValue({ enviado: true, conversationId: "c1", messageId: "m1" });
});
describe("execução preventiva", () => {
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
