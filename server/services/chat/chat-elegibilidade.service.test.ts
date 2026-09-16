import { beforeEach, describe, expect, it, vi } from "vitest";
import { avaliarCandidatoAoContato } from "@shared/cobranca/elegibilidade-chat";
import { resolverEtapas } from "@shared/cobranca/regua";
const fake = vi.hoisted(() => ({ candidatosAoPrimeiroContato: vi.fn() }));
vi.mock("../../storage", () => ({ storage: fake }));
import { listarCandidatosDoChat } from "./chat-elegibilidade.service";
beforeEach(() => vi.resetAllMocks());

describe("paginação dos candidatos", () => {
  it("alcança elegível depois de 200 candidatos que exigem humano", async () => {
    const bloqueados = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, carteira: "ativo", diasAtraso: 12, tom: "humanizado_vulneravel" }));
    fake.candidatosAoPrimeiroContato
      .mockResolvedValueOnce({ cobranca: bloqueados, equipamentos: [{ id: 81 }], proximoId: 200 })
      .mockResolvedValueOnce({ cobranca: [{ id: 201, carteira: "ativo", diasAtraso: 12 }], equipamentos: [{ id: 81 }], proximoId: null });
    const r = await listarCandidatosDoChat(7);
    expect(r.cobranca.filter(c => avaliarCandidatoAoContato(c, ["ativo"], resolverEtapas(null), new Date()).elegivel).map(c => c.id)).toEqual([201]);
    expect(r.equipamentos).toEqual([{ id: 81 }]);
    expect(r.limitado).toBe(false);
    expect(fake.candidatosAoPrimeiroContato.mock.calls).toEqual([[7, 0], [7, 200]]);
  });
  it("cursor repetido falha em vez de duplicar indefinidamente os candidatos", async () => {
    fake.candidatosAoPrimeiroContato.mockResolvedValue({ cobranca: [], equipamentos: [], proximoId: 200 });
    await expect(listarCandidatosDoChat(7)).rejects.toThrow("Cursor");
    expect(fake.candidatosAoPrimeiroContato).toHaveBeenCalledTimes(2);
  });
  it("informa limite de varredura para não apresentar contagem truncada como completa", async () => {
    fake.candidatosAoPrimeiroContato.mockImplementation(async (_id: number, cursor: number) => ({ cobranca: [{ id: cursor + 1 }], equipamentos: [], proximoId: cursor + 1 }));
    expect(await listarCandidatosDoChat(7)).toMatchObject({ limitado: true });
    expect(fake.candidatosAoPrimeiroContato).toHaveBeenCalledTimes(50);
  });
});
