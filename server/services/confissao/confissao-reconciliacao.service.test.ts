import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O worker cobre o que o webhook não entregou: primeiro `reconciliar_em`
 * vencido (a cada passada, 10 min), depois toda `enviada` há mais de 1 h a
 * cada 6 h; expira pela data limite; quita, só na passada completa e com a
 * janela girando, a assinada cujo acordo cumpriu ou cujo Anexo I foi pago.
 *
 * O aviso "falta a assinatura do provedor" NÃO se prova aqui: ele depende do
 * que o `aplicarRetorno` real grava na linha a cada reconsulta, e este arquivo
 * dubla o retorno. Os testes dele estão em `confissao-ciclo.test.ts`, com os
 * serviços reais sobre uma tabela em memória.
 */
const storageMock = vi.hoisted(() => ({
  confissoesParaReconciliar: vi.fn(async (): Promise<any[]> => []),
  obterConfissao: vi.fn(async (): Promise<any> => undefined),
  confissoesParaExpirar: vi.fn(async (): Promise<any[]> => []),
  confissoesAssinadasParaQuitacao: vi.fn(async (): Promise<any[]> => []),
  obterNegociacao: vi.fn(async (): Promise<any> => undefined),
  statusDasFaturasPorRef: vi.fn(async (): Promise<Map<string, string>> => new Map()),
  marcarQuitacaoVerificada: vi.fn(async (): Promise<void> => undefined),
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
beforeEach(() => {
  vi.clearAllMocks();
  _reiniciarReconciliacaoParaTestes();
  // clearAllMocks não desfaz mockImplementation: o storage em memória de um teste não vaza para o outro.
  storageMock.confissoesAssinadasParaQuitacao.mockImplementation(async () => []);
  storageMock.marcarQuitacaoVerificada.mockImplementation(async () => undefined);
});

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
  it("a quitação só roda na passada completa: a curta (10 min) não varre as assinadas", async () => {
    await rodarReconciliacao(AGORA);
    expect(storageMock.confissoesAssinadasParaQuitacao).toHaveBeenCalledTimes(1);
    await rodarReconciliacao(new Date(AGORA.getTime() + 10 * 60_000));
    await rodarReconciliacao(new Date(AGORA.getTime() + 20 * 60_000));
    expect(storageMock.confissoesAssinadasParaQuitacao).toHaveBeenCalledTimes(1);
  });
  it("a janela da quitação gira: com limite 2, duas passadas completas seguidas avaliam linhas DIFERENTES, e a que nunca quita não prende a fila", async () => {
    // O storage em memória faz o que o SQL faz (o teste do storage prende o SQL):
    // ORDER BY quitacao_verificada_em ASC NULLS FIRST, id ASC LIMIT n.
    const assinadas = [10, 11, 12, 13].map(id => ({ id, providerId: 1, origem: "saldo_integral", negociacaoId: null, erpSource: "mk", erpFaturas: [{ erpRef: `F-${id}` }], quitacaoVerificadaEm: null as Date | null }));
    const carimbo = (c: { quitacaoVerificadaEm: Date | null }) => c.quitacaoVerificadaEm?.getTime() ?? -Infinity;
    storageMock.confissoesAssinadasParaQuitacao.mockImplementation(async (maximo?: number) => [...assinadas].sort((a, b) => (carimbo(a) - carimbo(b)) || a.id - b.id).slice(0, maximo).map(c => ({ ...c })));
    storageMock.marcarQuitacaoVerificada.mockImplementation(async (_p: number, id: number, quando: Date) => { assinadas.find(c => c.id === id)!.quitacaoVerificadaEm = quando; });
    await rodarReconciliacao(AGORA, { limiteDaQuitacao: 2 });
    await rodarReconciliacao(new Date(AGORA.getTime() + 6 * 60 * 60_000 + 1), { limiteDaQuitacao: 2 });
    expect(storageMock.confissoesAssinadasParaQuitacao).toHaveBeenCalledWith(2);
    const avaliadas = storageMock.statusDasFaturasPorRef.mock.calls.map(c => (c as unknown[])[2]);
    expect(avaliadas).toEqual([["F-10"], ["F-11"], ["F-12"], ["F-13"]]);
    expect(storageMock.marcarQuitacaoVerificada.mock.calls.map(c => (c as unknown[])[1])).toEqual([10, 11, 12, 13]);
  });
});
