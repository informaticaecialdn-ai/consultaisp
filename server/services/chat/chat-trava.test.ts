import { beforeEach, describe, expect, it, vi } from "vitest";
const conexao = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("../../db", () => ({ pool: { connect: async () => conexao } }));
import { comTravaDoChat } from "./chat-trava";
beforeEach(() => { vi.resetAllMocks(); conexao.query.mockResolvedValue({ rows: [{ locked: true }] }); });
describe("exclusão mútua de contato entre API e worker", () => {
  it("não executa contato enquanto outra instância possui a trava", async () => {
    conexao.query.mockResolvedValue({ rows: [{ locked: false }] });
    const enviar = vi.fn();
    expect(await comTravaDoChat("contato:7:fone", enviar)).toBeNull();
    expect(enviar).not.toHaveBeenCalled();
    expect(conexao.release).toHaveBeenCalledWith(false);
  });
  it("libera a trava mesmo quando o transporte falha", async () => {
    await expect(comTravaDoChat("contato:7:fone", async () => { throw new Error("falha"); })).rejects.toThrow("falha");
    expect(conexao.query).toHaveBeenLastCalledWith(expect.stringContaining("pg_advisory_unlock"), ["contato:7:fone"]);
    expect(conexao.release).toHaveBeenCalledWith(false);
  });
  it("descarta conexão cuja liberação falhou para não manter trava no pool", async () => {
    conexao.query.mockResolvedValueOnce({ rows: [{ locked: true }] }).mockRejectedValueOnce(new Error("conexão perdida"));
    expect(await comTravaDoChat("contato:7:fone", async () => "feito")).toBe("feito");
    expect(conexao.release).toHaveBeenCalledWith(true);
  });
});
