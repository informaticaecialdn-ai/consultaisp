import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * LGPD (spec §8): o que NÃO é título — rascunho, cancelada, expirada e tudo de
 * sandbox — perde os dados pessoais 90 dias depois, ou na hora do pedido de
 * exclusão do titular; a assinada em produção fica até 5 anos após o último
 * vencimento ou a quitação (CC 206 §5 I), e o pedido de exclusão não a
 * anonimiza (LGPD art. 16, I) — a resposta lista a confissão e a base legal.
 */
const storageMock = vi.hoisted(() => ({
  confissoesParaRetencao: vi.fn(async (): Promise<any[]> => []),
  anonimizarConfissao: vi.fn(async (): Promise<void> => undefined),
  confissoesDoTitular: vi.fn(async (): Promise<any[]> => []),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { RETENCAO_SEM_TITULO_DIAS, anonimizarConfissoesDoTitular, apagarConfissoesSemTitulo, confissoesDoTitularParaRelatorio } from "./lgpd-confissoes";

beforeEach(() => vi.clearAllMocks());

describe("retenção", () => {
  it("apaga PDFs e dados pessoais do que não é título, 90 dias depois, uma por uma", async () => {
    storageMock.confissoesParaRetencao.mockResolvedValueOnce([{ id: 1, providerId: 1 }, { id: 2, providerId: 6 }]);
    const agora = new Date("2026-12-10T03:00:00Z");
    expect(await apagarConfissoesSemTitulo(agora)).toBe(2);
    const limite = storageMock.confissoesParaRetencao.mock.calls[0][0] as Date;
    expect(Math.round((agora.getTime() - limite.getTime()) / 86_400_000)).toBe(RETENCAO_SEM_TITULO_DIAS);
    expect(storageMock.anonimizarConfissao.mock.calls).toEqual([[1, 1], [6, 2]]);
  });
  it("uma falha não interrompe as demais", async () => {
    storageMock.confissoesParaRetencao.mockResolvedValueOnce([{ id: 1, providerId: 1 }, { id: 2, providerId: 1 }]);
    storageMock.anonimizarConfissao.mockRejectedValueOnce(new Error("boom"));
    expect(await apagarConfissoesSemTitulo(new Date())).toBe(1);
  });
});

describe("titular", () => {
  it("acesso/portabilidade listam as confissões do CPF; exclusão preserva a assinada em produção com a base legal", async () => {
    storageMock.confissoesDoTitular.mockResolvedValue([
      { id: 10, providerId: 1, status: "assinada", valorTotal: 819.76, ambiente: "producao", assinadaEm: new Date("2026-09-12T10:00:00Z"), createdAt: new Date("2026-09-10T00:00:00Z"), dataLimiteAssinatura: "2026-09-25" },
      { id: 11, providerId: 1, status: "assinada", valorTotal: 10, ambiente: "sandbox", assinadaEm: new Date("2026-09-12T10:00:00Z"), createdAt: new Date("2026-09-10T00:00:00Z"), dataLimiteAssinatura: "2026-09-25" },
      { id: 12, providerId: 1, status: "cancelada", valorTotal: 10, ambiente: "producao", assinadaEm: null, createdAt: new Date("2026-09-10T00:00:00Z"), dataLimiteAssinatura: "2026-09-25" },
    ]);
    const r = await confissoesDoTitularParaRelatorio("123.456.789-01");
    expect(storageMock.confissoesDoTitular).toHaveBeenCalledWith("123.456.789-01");
    expect(r.confissoes.map(c => c.id)).toEqual([10, 11, 12]);
    expect(r.confissoes[0]).toMatchObject({ id: 10, status: "assinada", valor: 819.76, ambiente: "producao", assinadaEm: "2026-09-12T10:00:00.000Z" });
    expect(r.preservadas.map(c => c.id)).toEqual([10]);
    expect(r.baseLegal).toContain("LGPD art. 16, I");
    expect(r.baseLegal).toContain("CC art. 206, §5º, I");
  });
});

describe("pedido de exclusão do titular", () => {
  const linha = (id: number, status: string, ambiente: string, providerId = 1) => ({
    id, providerId, status, valorTotal: 10, ambiente, assinadaEm: null, createdAt: new Date("2026-09-10T00:00:00Z"), dataLimiteAssinatura: "2026-09-25",
  });

  it("uma assinada em produção, uma cancelada e uma assinada em sandbox: só a primeira sobrevive intacta", async () => {
    storageMock.confissoesDoTitular.mockResolvedValueOnce([linha(10, "assinada", "producao"), linha(12, "cancelada", "producao"), linha(11, "assinada", "sandbox", 6)]);
    const r = await anonimizarConfissoesDoTitular("123.456.789-01");
    expect(storageMock.confissoesDoTitular).toHaveBeenCalledWith("123.456.789-01");
    // Cada uma pelo provedor DELA — o mesmo escopo das consultas: o CPF em qualquer provedor.
    expect(storageMock.anonimizarConfissao.mock.calls).toEqual([[1, 12], [6, 11]]);
    expect(r.anonimizadas).toBe(2);
    expect(r.preservadas.map(c => c.id)).toEqual([10]);
    expect(r.emAndamento).toEqual([]);
  });

  it("título é produção com status que PROVA a assinatura — assinada, quitada ou substituída; a enviada, em QUALQUER ambiente, é documento vivo e fica fora", async () => {
    storageMock.confissoesDoTitular.mockResolvedValueOnce([
      linha(20, "quitada", "producao"), linha(21, "substituida", "producao"), linha(22, "enviada", "producao"),
      linha(23, "rascunho", "producao"), linha(24, "expirada", "producao"), linha(25, "enviada", "sandbox"), linha(26, "quitada", "sandbox"),
    ]);
    const r = await anonimizarConfissoesDoTitular("12345678901");
    // A enviada de sandbox também: o documento e o webhook seguem vivos no ZapSign,
    // e uma assinatura depois reimportaria o PDF assinado, com os dados pessoais.
    expect(storageMock.anonimizarConfissao.mock.calls.map(c => (c as unknown[])[1])).toEqual([23, 24, 26]);
    expect(r.anonimizadas).toBe(3);
    expect(r.preservadas.map(c => c.id)).toEqual([20, 21]);
    expect(r.emAndamento.map(c => c.id)).toEqual([22, 25]);
  });

  it("uma anonimização que falha derruba o pedido — ele volta na próxima hora — em vez de dizer ao titular que apagou", async () => {
    storageMock.confissoesDoTitular.mockResolvedValueOnce([linha(12, "cancelada", "producao")]);
    storageMock.anonimizarConfissao.mockRejectedValueOnce(new Error("banco fora"));
    await expect(anonimizarConfissoesDoTitular("12345678901")).rejects.toThrow("banco fora");
  });
});
