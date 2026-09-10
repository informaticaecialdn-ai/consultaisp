import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * O webhook é público e sem HMAC: o que o defende é o cabeçalho secreto por
 * provedor, comparado em tempo constante e com resposta UNIFORME (401) para
 * provedor inexistente, integração desligada ou cabeçalho errado. Nada do
 * payload é acreditado: `signed` só depois da reconsulta (aplicarRetorno).
 */
const storageMock = vi.hoisted(() => ({
  webhookSecretDoProvedor: vi.fn(async (): Promise<any> => ({ webhookSecret: "segredo-certo", isEnabled: true, ambiente: "producao" })),
  obterConfissaoPorToken: vi.fn(async (): Promise<any> => ({ id: 77, status: "enviada", ambiente: "producao" })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
const retorno = vi.hoisted(() => ({
  aplicarRetorno: vi.fn(async (): Promise<any> => ({ status: "assinada", mudou: true, motivo: null })),
  registrarInformadoPeloWebhook: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock("../services/confissao/confissao-retorno.service", () => retorno);
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../logger", () => ({ logger: loggerMock }));

import { registerWebhooksZapSignRoutes, _reiniciarJanelasParaTestes } from "./webhooks-zapsign.routes";
import { ErroDeConfissao } from "../assinatura/erro";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(registerWebhooksZapSignRoutes());
  await new Promise<void>(r => { server = app.listen(0, "127.0.0.1", () => r()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });
beforeEach(() => { vi.clearAllMocks(); _reiniciarJanelasParaTestes(); storageMock.obterConfissaoPorToken.mockResolvedValue({ id: 77, status: "enviada", ambiente: "producao" }); });

const post = (providerId: number | string, corpo: unknown, cabecalho?: string) =>
  fetch(`${base}/api/webhooks/zapsign/${providerId}`, { method: "POST", headers: { "content-type": "application/json", ...(cabecalho === undefined ? {} : { "X-Consulta-ISP-Assinatura": cabecalho }) }, body: JSON.stringify(corpo) });
const evento = (event_type: string, extra: Record<string, unknown> = {}) => ({ event_type, token: "doc-1", status: "pending", sandbox: false, signers: [{ token: "s-1", status: "signed", liveness_photo_url: "https://x/selfie.jpg", ip: "1.2.3.4" }], ...extra });

describe("autenticação", () => {
  it("401 uniforme: sem cabeçalho, cabeçalho errado, provedor inexistente, integração desligada", async () => {
    expect((await post(1, evento("doc_signed"))).status).toBe(401);
    expect((await post(1, evento("doc_signed"), "errado")).status).toBe(401);
    storageMock.webhookSecretDoProvedor.mockResolvedValueOnce(undefined);
    expect((await post(999, evento("doc_signed"), "segredo-certo")).status).toBe(401);
    storageMock.webhookSecretDoProvedor.mockResolvedValueOnce({ webhookSecret: "segredo-certo", isEnabled: false, ambiente: "producao" });
    expect((await post(1, evento("doc_signed"), "segredo-certo")).status).toBe(401);
    const corpos = await Promise.all([post(1, evento("doc_signed")), post(999, evento("doc_signed"), "x")].map(async p => (await p).json()));
    expect(corpos[0]).toEqual(corpos[1]);
    expect(retorno.aplicarRetorno).not.toHaveBeenCalled();
    expect((await post("abc", evento("doc_signed"), "segredo-certo")).status).toBe(401);
    storageMock.webhookSecretDoProvedor.mockResolvedValueOnce({ webhookSecret: "", isEnabled: true, ambiente: "producao" });
    expect((await post(1, evento("doc_signed"))).status).toBe(401);
    storageMock.webhookSecretDoProvedor.mockResolvedValueOnce({ webhookSecret: "", isEnabled: true, ambiente: "producao" });
    expect((await post(1, evento("doc_signed"), "")).status).toBe(401);
  });
  it("o corpo do webhook nunca vai ao log — só providerId, event_type e token", async () => {
    await post(1, evento("doc_signed"), "segredo-certo");
    const gravado = JSON.stringify([...loggerMock.info.mock.calls, ...loggerMock.warn.mock.calls]);
    expect(gravado).not.toContain("selfie");
    expect(gravado).not.toContain("1.2.3.4");
    expect(gravado).toContain("doc_signed");
  });
});

describe("eventos", () => {
  it("token desconhecido → 200 ignorado, sem reconsulta", async () => {
    storageMock.obterConfissaoPorToken.mockResolvedValueOnce(undefined);
    const r = await post(1, evento("doc_signed"), "segredo-certo");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, ignorado: true });
    expect(retorno.aplicarRetorno).not.toHaveBeenCalled();
  });
  it("eventos informativos → 200 sem reconsulta", async () => {
    for (const e of ["doc_created", "created_signer", "signature_notification_sent", "doc_read_confirmation", "doc_expiration_alert", "email_bounce", "doc_viewed"]) {
      expect((await post(1, evento(e), "segredo-certo")).status).toBe(200);
    }
    expect(retorno.aplicarRetorno).not.toHaveBeenCalled();
  });
  it("doc_signed e doc_deleted reconsultam pelo serviço (nunca aplicam pelo payload); fora de enviada → 200 sem reconsulta", async () => {
    const r = await post(1, evento("doc_signed", { status: "signed" }), "segredo-certo");
    expect(r.status).toBe(200);
    expect(retorno.aplicarRetorno).toHaveBeenCalledWith(1, 77, "webhook");
    storageMock.obterConfissaoPorToken.mockResolvedValueOnce({ id: 77, status: "assinada", ambiente: "producao" });
    expect((await post(1, evento("doc_signed"), "segredo-certo")).status).toBe(200);
    expect(retorno.aplicarRetorno).toHaveBeenCalledTimes(1);
  });
  it("janela de 30 s por confissão: o segundo evento responde 200 sem reconsultar", async () => {
    await post(1, evento("doc_signed"), "segredo-certo");
    await post(1, evento("doc_deleted"), "segredo-certo");
    expect(retorno.aplicarRetorno).toHaveBeenCalledTimes(1);
    _reiniciarJanelasParaTestes();
    await post(1, evento("doc_deleted"), "segredo-certo");
    expect(retorno.aplicarRetorno).toHaveBeenCalledTimes(2);
  });
  it("doc_refused e doc_expired só ficam informados", async () => {
    await post(1, evento("doc_refused", { status: "recusado" }), "segredo-certo");
    expect(retorno.registrarInformadoPeloWebhook).toHaveBeenCalledWith(1, 77, "recusa", "doc_refused");
    await post(1, evento("doc_expired"), "segredo-certo");
    expect(retorno.registrarInformadoPeloWebhook).toHaveBeenCalledWith(1, 77, "expiracao", "doc_expired");
    expect(retorno.aplicarRetorno).not.toHaveBeenCalled();
  });
  it("reconsulta que falha → 502 sempre (mesmo com http < 500), sem detalhe interno, e libera a janela para a próxima entrega", async () => {
    retorno.aplicarRetorno.mockRejectedValueOnce(new ErroDeConfissao("NAO_CONFIGURADA", "A integração com o ZapSign não está configurada para este provedor", 409));
    const r = await post(1, evento("doc_signed"), "segredo-certo");
    expect(r.status).toBe(502);
    const corpo = await r.json();
    expect(corpo.message).toBe("Falha ao processar o evento");
    expect(JSON.stringify(corpo)).not.toContain("integração");
    retorno.aplicarRetorno.mockResolvedValueOnce({ status: "assinada", mudou: true, motivo: null, confirmado: true });
    expect((await post(1, evento("doc_signed"), "segredo-certo")).status).toBe(200);
    expect(retorno.aplicarRetorno).toHaveBeenCalledTimes(2);
  });
  it("corpo sem event_type ou sem token → 400; limite por provedor → 429", async () => {
    expect((await post(1, { foo: 1 }, "segredo-certo")).status).toBe(400);
    for (let i = 0; i < 60; i++) await post(1, evento("doc_created"), "segredo-certo");
    expect((await post(1, evento("doc_created"), "segredo-certo")).status).toBe(429);
  });
});
