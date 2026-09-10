import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * LGPD (spec §8): o que NÃO é título — rascunho, cancelada, expirada e tudo de
 * sandbox — perde os dados pessoais 90 dias depois; a assinada em produção
 * fica até 5 anos após o último vencimento ou a quitação (CC 206 §5 I), e o
 * pedido de exclusão do titular não a anonimiza (LGPD art. 16, I) — a resposta
 * lista a confissão e a base legal.
 */
const storageMock = vi.hoisted(() => ({
  confissoesParaRetencao: vi.fn(async (): Promise<any[]> => []),
  anonimizarConfissao: vi.fn(async (): Promise<void> => undefined),
  confissoesDoTitular: vi.fn(async (): Promise<any[]> => []),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { RETENCAO_SEM_TITULO_DIAS, apagarConfissoesSemTitulo, confissoesDoTitularParaRelatorio } from "./lgpd-confissoes";

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
