import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Server } from "node:http";

/**
 * A assinatura eletrônica de mentira da demonstração pública. O que se prova:
 * o cliente REAL do ZapSign, com o `fetch` local, faz toda chamada que a
 * emissão, o retorno e o cancelar usam sem tocar a rede; a reconsulta não
 * depende de memória (o worker é outro processo); nenhum documento sai como
 * de produção; a conta simulada é sempre sandbox; e o segredo do webhook
 * simulado não abre o webhook público — o retorno do ZapSign nunca alcança um
 * documento da demonstração.
 */
const storageMock = vi.hoisted(() => ({
  webhookSecretDoProvedor: vi.fn(async (): Promise<any> => undefined),
  obterConfissaoPorToken: vi.fn(async (): Promise<any> => ({ id: 100, status: "enviada", ambiente: "sandbox" })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
const retornoMock = vi.hoisted(() => ({ aplicarRetorno: vi.fn(async (): Promise<any> => ({ status: "enviada", mudou: false })), registrarInformadoPeloWebhook: vi.fn(async (): Promise<void> => undefined) }));
vi.mock("../services/confissao/confissao-retorno.service", () => retornoMock);
vi.mock("../services/confissao/confissao-emissao.service", () => ({ CABECALHO_DO_WEBHOOK: "X-Consulta-ISP-Assinatura" }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { clienteZapSign, HOSTS_DO_ZAPSIGN, type SignatarioParaCriar } from "../assinatura/zapsign";
import { ErroDeConfissao } from "../assinatura/erro";
import { registerWebhooksZapSignRoutes, _reiniciarJanelasParaTestes } from "../routes/webhooks-zapsign.routes";
import { AUTH_MODE_PADRAO, PRAZO_PADRAO_DE_ASSINATURA_DIAS } from "@shared/cobranca/confissao";
import { fetchDaAssinaturaSimulada, integracaoDaAssinaturaSimulada } from "./assinatura-simulada";

const cliente: SignatarioParaCriar = { name: "Rosana Cardoso Andrade", email: "rosana@example.com", phone_country: "55", phone_number: "43999990000", auth_mode: AUTH_MODE_PADRAO, cpf: "99950400007", require_cpf: true, lock_name: true, external_id: "cliente" };
const provedor: SignatarioParaCriar = { name: "Ana Demonstração", email: "ana@example.com", auth_mode: "assinaturaTela-tokenEmail", cpf: "11122233344", lock_name: true, external_id: "provedor", order_group: 1 };
const porPdf = (id: number, signers: SignatarioParaCriar[]) => ({
  name: "Confissão de dívida — Rosana — Provedor Demonstração", base64_pdf: "JVBERi0=", signers, lang: "pt-br" as const, external_id: `confissao:${id}`, folder_path: "consulta-isp/42",
  date_limit_to_sign: "2026-09-28", reminder_every_n_days: 3, allow_refuse_signature: true, signature_order_active: signers.length > 1,
});

let redeReal: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // A rede proibida: qualquer chamada ao fetch global é defeito da simulação.
  redeReal = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("a demonstração não pode sair para a rede"));
});
afterEach(() => { redeReal.mockRestore(); });

const zapDaDemo = (ambiente: "sandbox" | "producao" = "sandbox") => clienteZapSign({ apiToken: integracaoDaAssinaturaSimulada(42).apiToken, ambiente, fetchImpl: fetchDaAssinaturaSimulada });

describe("o cliente real do ZapSign sobre o fetch simulado", () => {
  it("toda chamada da emissão, do retorno e do cancelar responde aqui, sem nenhum pedido de rede", async () => {
    const zap = zapDaDemo();
    await expect(zap.testarToken()).resolves.toBeUndefined();

    const doc = await zap.criarDocumentoPorPdf(porPdf(101, [cliente]));
    expect(doc.token).toMatch(/^demo-/);
    expect(doc).toMatchObject({ status: "pending", sandbox: true, deleted: false, signed_at: null, signed_file: null });
    expect(doc.signers).toEqual([{ token: expect.stringMatching(/^demo-/), status: "new", sign_url: null, signed_at: null, auth_mode: AUTH_MODE_PADRAO, external_id: "cliente" }]);

    const comProvedor = await zap.criarDocumentoPorPdf(porPdf(102, [provedor, cliente]));
    expect(comProvedor.token).not.toBe(doc.token);
    expect(comProvedor.signers.map(s => [s.external_id, s.auth_mode])).toEqual([["provedor", "assinaturaTela-tokenEmail"], ["cliente", AUTH_MODE_PADRAO]]);

    const modelo = await zap.criarDocumentoPorModelo({ template_id: "tpl-demo", signer_name: "Rosana", data: [], lang: "pt-br", external_id: "confissao:103", folder_path: "consulta-isp/42", date_limit_to_sign: "2026-09-28", reminder_every_n_days: 3, allow_refuse_signature: true });
    expect(modelo.signers).toHaveLength(1);
    const atualizado = await zap.atualizarSignatario(modelo.signers[0].token, { auth_mode: AUTH_MODE_PADRAO, require_cpf: true });
    expect(atualizado.token).toBe(modelo.signers[0].token);
    expect((await zap.adicionarSignatario(modelo.token, provedor)).external_id).toBe("provedor");

    const webhook = await zap.registrarWebhookDoDocumento({ url: "https://consultaisp.com.br/api/webhooks/zapsign/42", docToken: doc.token, cabecalho: { nome: "X-Consulta-ISP-Assinatura", valor: integracaoDaAssinaturaSimulada(42).webhookSecret! } });
    expect(webhook.id).toMatch(/^demo-/);
    await expect(zap.excluirWebhook(webhook.id)).resolves.toBeUndefined();
    // Nada é enviado a ninguém: o reenvio responde zero entregas.
    expect(await zap.reenviarNotificacoes(doc.token)).toEqual({ enviados: 0, falhas: 0 });
    await expect(zap.excluirDocumento(doc.token)).resolves.toBeUndefined();

    expect(redeReal).not.toHaveBeenCalled();
  });

  it("a reconsulta não depende de memória: o mesmo token devolve o mesmo documento, em qualquer processo", async () => {
    const zap = zapDaDemo();
    const criado = await zap.criarDocumentoPorPdf(porPdf(201, [provedor, cliente]));
    const primeira = await zap.detalharDocumento(criado.token);
    expect(primeira).toEqual(criado);
    expect(await zapDaDemo().detalharDocumento(criado.token)).toEqual(primeira);
    expect(redeReal).not.toHaveBeenCalled();
  });

  it("documento que a simulação não emitiu é 404 local, e não há arquivo assinado para baixar", async () => {
    const zap = zapDaDemo();
    await expect(zap.detalharDocumento("doc-de-uma-conta-real")).rejects.toMatchObject({ codigo: "NAO_ENCONTRADA" });
    await expect(zap.excluirDocumento("doc-de-uma-conta-real")).rejects.toMatchObject({ codigo: "NAO_ENCONTRADA" });
    await expect(zap.baixarArquivo("https://zapsign.s3.amazonaws.com/assinado.pdf", 1024)).rejects.toBeInstanceOf(ErroDeConfissao);
    const rota = await fetchDaAssinaturaSimulada(`${HOSTS_DO_ZAPSIGN.sandbox}/rota-que-nao-existe/`, { method: "GET" });
    expect(rota.status).toBe(404);
    expect(redeReal).not.toHaveBeenCalled();
  });

  it("nunca há documento de produção: mesmo pedido no host de produção, a resposta é sandbox", async () => {
    const zap = zapDaDemo("producao");
    const doc = await zap.criarDocumentoPorPdf(porPdf(301, [cliente]));
    expect(doc.sandbox).toBe(true);
    expect((await zap.detalharDocumento(doc.token)).sandbox).toBe(true);
    expect(redeReal).not.toHaveBeenCalled();
  });
});

describe("a conta ZapSign simulada", () => {
  it("é sempre sandbox, ativa, modelo padrão sem parecer e só o devedor assina", () => {
    const integracao = integracaoDaAssinaturaSimulada(42);
    expect(integracao).toMatchObject({
      providerId: 42, fornecedor: "zapsign", ambiente: "sandbox", isEnabled: true, templateId: null, provedorAssina: false,
      authModeCliente: AUTH_MODE_PADRAO, exigirSelfie: false, prazoAssinaturaDias: PRAZO_PADRAO_DE_ASSINATURA_DIAS, enviarArquivoAssinadoWhatsapp: false, modeloRevisadoEm: null,
    });
    expect(integracao.apiToken).toBeTruthy();
    expect(integracao.webhookSecret?.length ?? 0).toBeGreaterThanOrEqual(32);
  });
});

describe("o retorno do ZapSign não alcança documento da demonstração", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(registerWebhooksZapSignRoutes());
    await new Promise<void>(r => { server = app.listen(0, "127.0.0.1", () => r()); });
    const addr = server.address();
    base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
  });
  afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

  it("o segredo simulado não autentica o webhook: o sandbox não tem linha em assinatura_integracoes, então é o 401 uniforme", async () => {
    redeReal.mockRestore(); // o pedido ao servidor local deste teste é o único fetch permitido aqui
    _reiniciarJanelasParaTestes();
    const r = await fetch(`${base}/api/webhooks/zapsign/42`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Consulta-ISP-Assinatura": integracaoDaAssinaturaSimulada(42).webhookSecret! },
      body: JSON.stringify({ event_type: "doc_signed", token: "demo-doc-100~cliente" }),
    });
    expect(r.status).toBe(401);
    expect(retornoMock.aplicarRetorno).not.toHaveBeenCalled();
  });

  it("trava de fonte: nada da demonstração grava assinatura_integracoes, e a simulação não lê banco nem fetch global", () => {
    const pasta = path.resolve(__dirname);
    for (const nome of readdirSync(pasta).filter(n => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      expect(readFileSync(path.join(pasta, nome), "utf8"), nome).not.toMatch(/insert\(\s*assinaturaIntegracoes/);
    }
    // Só o código: o comentário de cabeçalho cita `globalThis.fetch` justamente para dizer que não o chama.
    const codigo = readFileSync(path.join(pasta, "assinatura-simulada.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/^import (?!type )[^;]*from "\.\.\/(db|storage)/m);
    expect(codigo).not.toMatch(/globalThis\.fetch|\bfetch\s*\(/);
  });
});
