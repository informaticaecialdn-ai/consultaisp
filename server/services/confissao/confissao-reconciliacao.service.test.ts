import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O worker cobre o que o webhook não entregou: primeiro `reconciliar_em`
 * vencido (a cada passada, 10 min), depois toda `enviada` há mais de 1 h a
 * cada 6 h; expira pela data limite; avisa "falta a assinatura do provedor"
 * uma vez; quita a assinada cujo acordo cumpriu ou cujo Anexo I foi pago.
 */
const storageMock = vi.hoisted(() => ({
  confissoesParaReconciliar: vi.fn(async (): Promise<any[]> => []),
  obterConfissao: vi.fn(async (): Promise<any> => undefined),
  confissoesParaExpirar: vi.fn(async (): Promise<any[]> => []),
  confissoesAssinadasParaQuitacao: vi.fn(async (): Promise<any[]> => []),
  obterNegociacao: vi.fn(async (): Promise<any> => undefined),
  statusDasFaturasPorRef: vi.fn(async (): Promise<Map<string, string>> => new Map()),
  transicionarConfissao: vi.fn(async (_p: number, id: number, _de: string, para: string): Promise<any> => ({ id, status: para, casoId: 9, valorTotal: "10", ambiente: "producao" })),
  atualizarConfissao: vi.fn(async (): Promise<any> => ({})),
  getIntegracaoComCredencial: vi.fn(async (): Promise<any> => ({ provedorAssina: true })),
  registrarEventoDeCobranca: vi.fn(async (): Promise<any> => ({})),
  atualizarCasoDeCobranca: vi.fn(async (): Promise<any> => ({})),
  obterCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 9, status: "aberto" })),
}));
vi.mock("../../storage", () => ({ storage: storageMock }));
const retorno = vi.hoisted(() => ({
  aplicarRetorno: vi.fn(async (): Promise<any> => ({ status: "enviada", mudou: false, motivo: null })),
  expirarSeVencida: vi.fn(async (): Promise<boolean> => true),
}));
vi.mock("./confissao-retorno.service", () => retorno);
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { _reiniciarReconciliacaoParaTestes, rodarReconciliacao } from "./confissao-reconciliacao.service";

const AGORA = new Date("2026-09-12T12:00:00Z");
beforeEach(() => { vi.clearAllMocks(); _reiniciarReconciliacaoParaTestes(); });

describe("reconciliação", () => {
  it("reconsulta na ordem do storage; a varredura completa (enviadas > 1 h) só a cada 6 h", async () => {
    storageMock.confissoesParaReconciliar.mockResolvedValueOnce([{ id: 2, providerId: 1 }, { id: 1, providerId: 1 }]);
    const r1 = await rodarReconciliacao(AGORA);
    expect(storageMock.confissoesParaReconciliar).toHaveBeenLastCalledWith(AGORA, 60 * 60_000);
    expect(retorno.aplicarRetorno.mock.calls.map(c => c[1])).toEqual([2, 1]);
    expect(r1.reconsultadas).toBe(2);
    await rodarReconciliacao(new Date(AGORA.getTime() + 10 * 60_000));
    expect(storageMock.confissoesParaReconciliar).toHaveBeenLastCalledWith(expect.any(Date), null);
    await rodarReconciliacao(new Date(AGORA.getTime() + 6 * 60 * 60_000 + 1));
    expect(storageMock.confissoesParaReconciliar).toHaveBeenLastCalledWith(expect.any(Date), 60 * 60_000);
  });
  it("uma reconsulta que falha não derruba a passada", async () => {
    storageMock.confissoesParaReconciliar.mockResolvedValueOnce([{ id: 1, providerId: 1 }, { id: 2, providerId: 1 }]);
    retorno.aplicarRetorno.mockRejectedValueOnce(new Error("fora"));
    const r = await rodarReconciliacao(AGORA);
    expect(r).toMatchObject({ reconsultadas: 2, falhas: 1 });
  });
  it("expira pela data limite (hoje em texto) pelo serviço", async () => {
    storageMock.confissoesParaExpirar.mockResolvedValueOnce([{ id: 5, providerId: 1 }]);
    const r = await rodarReconciliacao(AGORA);
    expect(storageMock.confissoesParaExpirar).toHaveBeenCalledWith("2026-09-12");
    expect(retorno.expirarSeVencida).toHaveBeenCalledWith(1, 5, "2026-09-12");
    expect(r.expiradas).toBe(1);
  });
  it("avisa 'falta a assinatura do provedor' uma vez: cliente assinou, provedor não, integração com provedorAssina", async () => {
    const c = { id: 7, providerId: 1, casoId: 9, valorTotal: "10", ambiente: "producao", status: "enviada", erroUltimo: null, zapsignSigners: [{ papel: "cliente", status: "link-opened", token: "a" }, { papel: "provedor", status: "new", token: "b" }] };
    storageMock.confissoesParaReconciliar.mockResolvedValueOnce([c]);
    storageMock.obterConfissao.mockResolvedValue({ ...c, zapsignSigners: [{ papel: "cliente", status: "signed", token: "a" }, { papel: "provedor", status: "new", token: "b" }] });
    await rodarReconciliacao(AGORA);
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(1, expect.objectContaining({ metadata: expect.objectContaining({ status: "aguardando_provedor" }) }));
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(1, 9, expect.objectContaining({ proximaAcao: expect.stringContaining("falta a assinatura do provedor") }), null);
    expect(storageMock.atualizarConfissao).toHaveBeenCalledWith(1, 7, expect.objectContaining({ erroUltimo: "aguardando a assinatura do provedor" }));
    vi.clearAllMocks();
    storageMock.confissoesParaReconciliar.mockResolvedValueOnce([c]);
    storageMock.obterConfissao.mockResolvedValue({ ...c, erroUltimo: "aguardando a assinatura do provedor", zapsignSigners: [{ papel: "cliente", status: "signed", token: "a" }, { papel: "provedor", status: "new", token: "b" }] });
    await rodarReconciliacao(AGORA);
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });
  it("sem a releitura não haveria aviso: a linha do storage ainda mostra o cliente sem assinar", async () => {
    const antes = { id: 7, providerId: 1, casoId: 9, valorTotal: "10", ambiente: "producao", status: "enviada", erroUltimo: null, zapsignSigners: [{ papel: "cliente", status: "new", token: "a" }, { papel: "provedor", status: "new", token: "b" }] };
    storageMock.confissoesParaReconciliar.mockResolvedValueOnce([antes]);
    storageMock.obterConfissao.mockResolvedValueOnce(antes);
    const r = await rodarReconciliacao(AGORA);
    expect(r.avisosDeProvedor).toBe(0);
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });
  it("quita: acordo cumprido → quitada; saldo integral com o Anexo I todo pago/baixado → quitada; parcial não", async () => {
    storageMock.confissoesAssinadasParaQuitacao.mockResolvedValueOnce([
      { id: 10, providerId: 1, origem: "acordo", negociacaoId: 3, erpSource: "mk", erpFaturas: [] },
      { id: 11, providerId: 1, origem: "saldo_integral", negociacaoId: null, erpSource: "mk", erpFaturas: [{ erpRef: "F-1" }, { erpRef: "F-2" }, { erpRef: "F-2" }] },
      { id: 12, providerId: 1, origem: "saldo_integral", negociacaoId: null, erpSource: "mk", erpFaturas: [{ erpRef: "F-9" }] },
    ]);
    storageMock.obterNegociacao.mockResolvedValueOnce({ id: 3, status: "cumprida" });
    storageMock.statusDasFaturasPorRef.mockResolvedValueOnce(new Map([["F-1", "paid"], ["F-2", "baixada_no_erp"]])).mockResolvedValueOnce(new Map([["F-9", "aberta"]]));
    const r = await rodarReconciliacao(AGORA);
    expect(storageMock.statusDasFaturasPorRef).toHaveBeenCalledWith(1, "mk", ["F-1", "F-2"]);
    expect(storageMock.transicionarConfissao.mock.calls.map(c => [c[1], c[3]])).toEqual([[10, "quitada"], [11, "quitada"]]);
    expect(r.quitadas).toBe(2);
  });
});
