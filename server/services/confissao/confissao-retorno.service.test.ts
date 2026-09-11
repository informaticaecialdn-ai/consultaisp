import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O retorno é UMA função para webhook, worker e cancelar: reconsulta o ZapSign
 * no host do ambiente DA LINHA e só a transição atômica decide quem grava o
 * evento. O que se prova: fora de `enviada` nada acontece; signed baixa o
 * arquivo e aplica; ambiente divergente não aplica; deleted vira cancelada;
 * pending só atualiza signatários; reconsulta falhando marca reconciliar_em;
 * recusa/expiração só "informadas"; cancelar reconsulta antes; reenviar
 * respeita a janela e o sandbox; expirar pela data limite.
 */
const storageMock = vi.hoisted(() => ({
  obterConfissao: vi.fn(async (): Promise<any> => confissao()),
  getIntegracaoComCredencial: vi.fn(async (): Promise<any> => ({ apiToken: "tok", ambiente: "producao", provedorAssina: false, isEnabled: true })),
  atualizarConfissao: vi.fn(async (_p: number, id: number, patch: any): Promise<any> => ({ ...confissao(), id, ...patch })),
  transicionarConfissao: vi.fn(async (_p: number, id: number, _de: string, para: string, patch: any): Promise<any> => ({ ...confissao(), id, status: para, ...patch })),
  guardarPdf: vi.fn(async (): Promise<any> => ({ sha256: "s", tamanhoBytes: 3 })),
  marcarSubstituidas: vi.fn(async (): Promise<number> => 0),
  registrarEventoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 1 })),
  atualizarCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 9 })),
  obterCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 9, status: "aberto" })),
}));
vi.mock("../../storage", () => ({ storage: storageMock }));
const zap = vi.hoisted(() => ({
  detalharDocumento: vi.fn(async (): Promise<any> => detalhe()),
  baixarArquivo: vi.fn(async (): Promise<Buffer> => Buffer.from("pdf")),
  excluirDocumento: vi.fn(async (): Promise<void> => undefined),
  excluirWebhook: vi.fn(async (): Promise<void> => undefined),
  reenviarNotificacoes: vi.fn(async (): Promise<any> => ({ enviados: 1, falhas: 0 })),
}));
const clienteZapSignMock = vi.hoisted(() => vi.fn(() => zap));
vi.mock("../../assinatura/zapsign", () => ({ clienteZapSign: clienteZapSignMock }));
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { aplicarRetorno, cancelarConfissao, expirarSeVencida, reenviarNotificacoes, registrarInformadoPeloWebhook, _reiniciarJanelasParaTestes, _tamanhoDaJanelaDeReenvioParaTestes } from "./confissao-retorno.service";
import { ErroDeConfissao } from "../../assinatura/erro";

function confissao(extra: Record<string, any> = {}) {
  return { id: 77, providerId: 1, customerId: 42, casoId: 9, status: "enviada", ambiente: "producao", valorTotal: "819.76", zapsignDocToken: "doc-1", webhookZapsignId: "w-1",
    zapsignSigners: [{ papel: "cliente", token: "s-1", signUrl: "u", status: "new", signedAt: null, authMode: "x" }], dataLimiteAssinatura: "2026-09-25", recusaInformadaEm: null, expiracaoInformadaEm: null, ...extra };
}
function detalhe(extra: Record<string, any> = {}) {
  return { token: "doc-1", status: "pending", signed_at: null, signed_file: null, original_file: "o", deleted: false, sandbox: false, signers: [{ token: "s-1", status: "link-opened", sign_url: "u", signed_at: null, auth_mode: "x", external_id: "cliente" }], ...extra };
}
beforeEach(() => { vi.clearAllMocks(); _reiniciarJanelasParaTestes(); storageMock.obterConfissao.mockResolvedValue(confissao()); zap.detalharDocumento.mockResolvedValue(detalhe()); });

describe("aplicarRetorno", () => {
  it("fora de enviada não chama o ZapSign", async () => {
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ status: "assinada" }));
    expect(await aplicarRetorno(1, 77, "webhook")).toMatchObject({ status: "assinada", mudou: false, motivo: "fora de enviada" });
    expect(zap.detalharDocumento).not.toHaveBeenCalled();
  });
  it("reconsulta no ambiente DA LINHA; pending só atualiza os signatários", async () => {
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ ambiente: "sandbox" }));
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ sandbox: true }));
    const r = await aplicarRetorno(1, 77, "worker");
    expect(clienteZapSignMock).toHaveBeenCalledWith({ apiToken: "tok", ambiente: "sandbox" });
    expect(r).toMatchObject({ status: "enviada", mudou: false, motivo: null, confirmado: true });
    expect(storageMock.atualizarConfissao).toHaveBeenCalledWith(1, 77, expect.objectContaining({ zapsignSigners: [expect.objectContaining({ papel: "cliente", status: "link-opened" })], reconciliarEm: null, erroUltimo: null }));
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalled();
  });
  it("signed: baixa o arquivo (≤ 8 MB), guarda, transição atômica, substitui a anterior, evento e follow-up", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_at: "2026-09-12T10:00:00Z", signed_file: "https://s3/x.pdf", signers: [{ token: "s-1", status: "signed", sign_url: "u", signed_at: "2026-09-12T10:00:00Z", auth_mode: "x", external_id: "cliente" }] }));
    const r = await aplicarRetorno(1, 77, "webhook");
    expect(zap.baixarArquivo).toHaveBeenCalledWith("https://s3/x.pdf", 8 * 1024 * 1024);
    expect(storageMock.guardarPdf).toHaveBeenCalledWith(1, 77, "assinado", expect.any(Buffer));
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "enviada", "assinada", expect.objectContaining({ assinadaEm: new Date("2026-09-12T10:00:00Z"), zapsignSandbox: false, erroUltimo: null }));
    expect(storageMock.marcarSubstituidas).toHaveBeenCalledWith(1, 42, 77);
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(1, expect.objectContaining({ tipo: "confissao", metadata: expect.objectContaining({ status: "assinada" }) }));
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(1, 9, expect.objectContaining({ proximaAcao: expect.stringContaining("título assinado") }), null);
    expect(r).toMatchObject({ status: "assinada", mudou: true, motivo: null, confirmado: true });
  });
  it("caso fechado: a assinatura é gravada, sem evento e sem follow-up", async () => {
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce({ id: 9, status: "pago" });
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_at: "2026-09-12T10:00:00Z", signed_file: "https://s3/x.pdf", signers: [{ token: "s-1", status: "signed", sign_url: "u", signed_at: "2026-09-12T10:00:00Z", auth_mode: "x", external_id: "cliente" }] }));
    const r = await aplicarRetorno(1, 77, "webhook");
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "enviada", "assinada", expect.anything());
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
    expect(storageMock.atualizarCasoDeCobranca).not.toHaveBeenCalled();
    expect(r).toMatchObject({ confirmado: true });
  });
  it("a transição perdida (outro processo aplicou antes) não grava evento", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_file: "https://s3/x.pdf" }));
    storageMock.transicionarConfissao.mockResolvedValueOnce(undefined);
    const r = await aplicarRetorno(1, 77, "worker");
    expect(r.mudou).toBe(false);
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });
  it("sandbox em linha de produção não aplica; em sandbox não há follow-up de título assinado", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_file: "x", sandbox: true }));
    const r = await aplicarRetorno(1, 77, "webhook");
    expect(r).toMatchObject({ status: "enviada", mudou: false, motivo: "ambiente divergente" });
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalled();
    expect(storageMock.atualizarConfissao).toHaveBeenCalledWith(1, 77, expect.objectContaining({ erroUltimo: "ambiente divergente" }));
    vi.clearAllMocks();
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ ambiente: "sandbox" }));
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_file: "x", sandbox: true }));
    await aplicarRetorno(1, 77, "webhook");
    expect(storageMock.transicionarConfissao).toHaveBeenCalled();
    expect(storageMock.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });
  it("deleted vira cancelada; reconsulta falhando marca reconciliar_em +10 min e propaga", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ deleted: true }));
    expect(await aplicarRetorno(1, 77, "worker")).toMatchObject({ status: "cancelada", mudou: true, motivo: "apagado no ZapSign" });
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "enviada", "cancelada", expect.objectContaining({ encerradaEm: expect.any(Date) }));
    zap.detalharDocumento.mockRejectedValueOnce(new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "fora", 502));
    await expect(aplicarRetorno(1, 77, "webhook")).rejects.toMatchObject({ codigo: "ZAPSIGN_INDISPONIVEL" });
    const patch = storageMock.atualizarConfissao.mock.calls.at(-1)![2];
    expect(patch.erroUltimo).toBe("fora");
    expect(patch.reconciliarEm.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
  });
  it("signed sem arquivo baixável fica enviada com reconciliar_em, sem transição", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_file: "https://s3/x.pdf" }));
    zap.baixarArquivo.mockRejectedValueOnce(new ErroDeConfissao("ARQUIVO_GRANDE", "passa de 8 MB", 422));
    const r = await aplicarRetorno(1, 77, "webhook");
    expect(r).toMatchObject({ status: "enviada", mudou: false, motivo: "passa de 8 MB" });
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalled();
  });
  it("signed sem signed_file fica enviada, NÃO confirmado, com reconciliar_em", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_file: null }));
    const r = await aplicarRetorno(1, 77, "webhook");
    expect(r).toMatchObject({ status: "enviada", mudou: false, confirmado: false });
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalled();
    expect(storageMock.atualizarConfissao).toHaveBeenCalledWith(1, 77, expect.objectContaining({ reconciliarEm: expect.any(Date) }));
  });
});

describe("informado pelo webhook, cancelar, reenviar, expirar", () => {
  it("recusa informada grava a data, mantém enviada, evento e follow-up; a segunda vez não repete o evento", async () => {
    await registrarInformadoPeloWebhook(1, 77, "recusa", "doc_refused");
    expect(storageMock.atualizarConfissao).toHaveBeenCalledWith(1, 77, expect.objectContaining({ recusaInformadaEm: expect.any(Date), erroUltimo: expect.stringContaining("doc_refused") }));
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(1, expect.objectContaining({ metadata: expect.objectContaining({ status: "recusa_informada" }) }));
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(1, 9, expect.objectContaining({ proximaAcao: expect.stringContaining("recusou") }), null);
    vi.clearAllMocks();
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ recusaInformadaEm: new Date() }));
    await registrarInformadoPeloWebhook(1, 77, "recusa", "doc_refused");
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });
  it("cancelar em enviada reconsulta antes: signed → aplica e 409; deleted → cancelada sem DELETE; pending → DELETE e cancelada", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_file: "x" }));
    await expect(cancelarConfissao(1, 77, 7)).rejects.toMatchObject({ codigo: "JA_ASSINADA", http: 409 });
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "enviada", "assinada", expect.anything());
    vi.clearAllMocks();
    storageMock.obterConfissao.mockResolvedValue(confissao());
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ deleted: true }));
    expect((await cancelarConfissao(1, 77, 7)).status).toBe("cancelada");
    expect(zap.excluirDocumento).not.toHaveBeenCalled();
    vi.clearAllMocks();
    storageMock.obterConfissao.mockResolvedValue(confissao());
    zap.detalharDocumento.mockResolvedValueOnce(detalhe());
    const c = await cancelarConfissao(1, 77, 7);
    expect(zap.excluirDocumento).toHaveBeenCalledWith("doc-1");
    expect(zap.excluirWebhook).toHaveBeenCalledWith("w-1");
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "enviada", "cancelada", expect.objectContaining({ encerradaEm: expect.any(Date) }));
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(1, expect.objectContaining({ userId: 7, metadata: expect.objectContaining({ status: "cancelada" }) }));
    expect(c.status).toBe("cancelada");
  });
  it("cancelar rascunho não fala com o ZapSign; assinada não se cancela; reconsulta falhando não muda nada", async () => {
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ status: "rascunho", zapsignDocToken: null }));
    expect((await cancelarConfissao(1, 77, 7)).status).toBe("cancelada");
    expect(zap.detalharDocumento).not.toHaveBeenCalled();
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ status: "assinada" }));
    await expect(cancelarConfissao(1, 77, 7)).rejects.toMatchObject({ codigo: "JA_ASSINADA" });
    storageMock.obterConfissao.mockResolvedValueOnce(confissao());
    zap.detalharDocumento.mockRejectedValueOnce(new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "fora", 502));
    await expect(cancelarConfissao(1, 77, 7)).rejects.toMatchObject({ codigo: "ZAPSIGN_INDISPONIVEL" });
    expect(zap.excluirDocumento).not.toHaveBeenCalled();
  });
  it("reenviar: só enviada, nunca em sandbox, 1 vez a cada 30 min", async () => {
    expect(await reenviarNotificacoes(1, 77)).toEqual({ enviados: 1, falhas: 0 });
    expect(zap.reenviarNotificacoes).toHaveBeenCalledWith("doc-1");
    await expect(reenviarNotificacoes(1, 77)).rejects.toMatchObject({ codigo: "REENVIO_CEDO", http: 429 });
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ id: 78, ambiente: "sandbox" }));
    await expect(reenviarNotificacoes(1, 78)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ id: 79, status: "assinada" }));
    await expect(reenviarNotificacoes(1, 79)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
  });
  it("a janela de reenvio não cresce para sempre: o reenvio seguinte poda as confissões cuja janela já passou", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
      storageMock.obterConfissao.mockResolvedValueOnce(confissao({ id: 81 })).mockResolvedValueOnce(confissao({ id: 82 }));
      await reenviarNotificacoes(1, 81);
      await reenviarNotificacoes(1, 82);
      expect(_tamanhoDaJanelaDeReenvioParaTestes()).toBe(2);
      vi.setSystemTime(new Date("2026-09-12T12:30:00Z"));
      storageMock.obterConfissao.mockResolvedValueOnce(confissao({ id: 83 }));
      await reenviarNotificacoes(1, 83);
      expect(_tamanhoDaJanelaDeReenvioParaTestes(), "81 e 82 saíram; fica só a 83").toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("expirar: reconsulta primeiro; ainda pending depois da data limite → expirada com evento", async () => {
    expect(await expirarSeVencida(1, 77, "2026-09-24")).toBe(false);
    expect(await expirarSeVencida(1, 77, "2026-09-26")).toBe(true);
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "enviada", "expirada", expect.objectContaining({ encerradaEm: expect.any(Date) }));
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(1, expect.objectContaining({ metadata: expect.objectContaining({ status: "expirada" }) }));
  });
  it("cancelar não apaga um documento cujo estado não foi confirmado", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_file: null }));
    await expect(cancelarConfissao(1, 77, 7)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
    expect(zap.excluirDocumento).not.toHaveBeenCalled();
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalled();
  });
  it("expirar só expira o que a reconsulta confirmou pendente", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_file: null }));
    expect(await expirarSeVencida(1, 77, "2026-09-26")).toBe(false);
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalled();
  });
});
