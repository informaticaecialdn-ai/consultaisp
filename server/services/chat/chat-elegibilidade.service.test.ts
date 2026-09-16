import { beforeEach, describe, expect, it, vi } from "vitest";
import { avaliarCandidatoAoContato } from "@shared/cobranca/elegibilidade-chat";
import { resolverEtapas } from "@shared/cobranca/regua";
const fake = vi.hoisted(() => ({ candidatosAoPrimeiroContato: vi.fn() }));
vi.mock("../../storage", () => ({ storage: fake }));
import { listarCandidatosDoChat, ordenarCandidatosComoOKanban } from "./chat-elegibilidade.service";
beforeEach(() => vi.resetAllMocks());

describe("ordem da rodada de primeiros contatos", () => {
  it("segue a coluna A iniciar do Kanban: ativos antes de ex-clientes; vencido, hoje, sem data; prioridade; valor; id", () => {
    const inicioDoDia = new Date("2026-09-16T03:00:00Z");
    const c = (id: number, extra: Record<string, unknown>) => ({ id, carteira: "ativo", ...extra });
    const lista = [
      c(1, { carteira: "ex_cliente", prioridade: "critica", valorAtual: "900" }),
      c(2, { proximoContatoEm: null, prioridade: "normal", valorAtual: "100" }),
      c(3, { proximoContatoEm: new Date("2026-09-15T12:00:00Z"), prioridade: "normal", valorAtual: "50" }),
      c(4, { proximoContatoEm: new Date("2026-09-16T12:00:00Z"), prioridade: "critica", valorAtual: "10" }),
      c(5, { proximoContatoEm: null, prioridade: "critica", valorAtual: "100" }),
      c(6, { proximoContatoEm: null, prioridade: "normal", valorAtual: "100" }),
    ];
    expect(ordenarCandidatosComoOKanban(lista, inicioDoDia).map(x => x.id)).toEqual([3, 4, 5, 2, 6, 1]);
    // Não altera a lista recebida.
    expect(lista.map(x => x.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

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
