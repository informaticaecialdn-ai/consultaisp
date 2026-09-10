import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Foco: a configuração do ZapSign mora só no superadmin; o GET nunca devolve
 * token nem segredo; salvar com token vazio "não mexe"; credencial ilegível
 * sem token novo é 400; ativar testa o token no ZapSign e só então liga; o
 * corpo destas rotas fica fora do log de acesso.
 */
const storageMock = vi.hoisted(() => ({
  getProvider: vi.fn(async (): Promise<any> => ({ id: 4, name: "NG Telecom" })),
  getIntegracaoParaAdmin: vi.fn(async (): Promise<any> => undefined),
  salvarIntegracaoDeAssinatura: vi.fn(async (): Promise<void> => undefined),
  ativarIntegracaoDeAssinatura: vi.fn(async (): Promise<void> => undefined),
  getIntegracaoComCredencial: vi.fn(async (): Promise<any> => ({ apiToken: "tok", ambiente: "sandbox" })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../auth", () => ({
  requireSuperAdmin: (req: any, res: any, next: any) => {
    if (req.session?.role !== "superadmin") return res.status(403).json({ message: "Acesso restrito" });
    next();
  },
}));
const zapsignMock = vi.hoisted(() => ({ testarToken: vi.fn(async (): Promise<void> => undefined) }));
vi.mock("../assinatura/zapsign", () => ({ clienteZapSign: () => zapsignMock }));

import { registerAdminAssinaturaRoutes } from "./admin-assinatura.routes";
import { corpoEhSensivel } from "../utils/sanitize-log";
import { ErroDeConfissao } from "../assinatura/erro";

let server: Server;
let base: string;
let sessao: Record<string, any> = {};
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });
  app.use(registerAdminAssinaturaRoutes());
  await new Promise<void>(r => { server = app.listen(0, "127.0.0.1", () => r()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });
beforeEach(() => { vi.clearAllMocks(); sessao = { userId: 1, role: "superadmin" }; });

const json = (method: string, caminho: string, corpo?: unknown) =>
  fetch(`${base}${caminho}`, { method, headers: corpo === undefined ? {} : { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

const gravada = () => ({
  configurada: true, apiTokenGravado: true, apiTokenIlegivel: false, apiTokenFinal: "1234", ambiente: "sandbox", templateId: null,
  signatarioNome: null, signatarioCpf: null, signatarioEmail: null, signatarioTelefone: null, provedorAssina: false,
  authModeCliente: "assinaturaTela-tokenWhatsapp", exigirSelfie: false, prazoAssinaturaDias: 15, enviarArquivoAssinadoWhatsapp: false,
  modeloRevisadoEm: null, isEnabled: false, ativadaEm: null, updatedAt: null,
});

describe("configuração do ZapSign pelo superadmin", () => {
  it("só o superadmin entra", async () => {
    sessao = { userId: 8, providerId: 4, role: "admin" };
    expect((await json("GET", "/api/admin/providers/4/assinatura/zapsign")).status).toBe(403);
    expect((await json("PUT", "/api/admin/providers/4/assinatura/zapsign", {})).status).toBe(403);
    expect((await json("POST", "/api/admin/providers/4/assinatura/zapsign/ativar")).status).toBe(403);
  });
  it("GET devolve o estado sem token nem segredo; sem linha, o padrão não configurado", async () => {
    storageMock.getIntegracaoParaAdmin.mockResolvedValueOnce(gravada());
    const r = await json("GET", "/api/admin/providers/4/assinatura/zapsign");
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.apiTokenFinal).toBe("1234");
    expect(JSON.stringify(corpo)).not.toMatch(/apiToken"|webhookSecret/);
    const vazio = await (await json("GET", "/api/admin/providers/4/assinatura/zapsign")).json();
    expect(vazio).toMatchObject({ configurada: false, apiTokenGravado: false, ambiente: "sandbox", authModeCliente: "assinaturaTela-tokenWhatsapp", prazoAssinaturaDias: 15 });
    storageMock.getProvider.mockResolvedValueOnce(undefined);
    expect((await json("GET", "/api/admin/providers/99/assinatura/zapsign")).status).toBe(404);
  });
  it("PUT grava e devolve o estado novo; token vazio não mexe; assinaturaTela puro é recusado", async () => {
    storageMock.getIntegracaoParaAdmin.mockResolvedValue(gravada());
    const r = await json("PUT", "/api/admin/providers/4/assinatura/zapsign", { apiToken: "", ambiente: "producao", authModeCliente: "assinaturaTela-tokenEmail", prazoAssinaturaDias: 10 });
    expect(r.status).toBe(200);
    expect(storageMock.salvarIntegracaoDeAssinatura).toHaveBeenCalledWith(4, expect.objectContaining({ apiToken: "", ambiente: "producao", authModeCliente: "assinaturaTela-tokenEmail", prazoAssinaturaDias: 10 }));
    expect((await json("PUT", "/api/admin/providers/4/assinatura/zapsign", { authModeCliente: "assinaturaTela" })).status).toBe(400);
    expect((await json("PUT", "/api/admin/providers/4/assinatura/zapsign", { desconhecido: 1 })).status).toBe(400);
    expect((await json("PUT", "/api/admin/providers/4/assinatura/zapsign", { provedorAssina: true })).status).toBe(400);
  });
  it("credencial ilegível exige token novo", async () => {
    storageMock.getIntegracaoParaAdmin.mockResolvedValue({ ...gravada(), apiTokenIlegivel: true, apiTokenFinal: null });
    const r = await json("PUT", "/api/admin/providers/4/assinatura/zapsign", { ambiente: "sandbox" });
    expect(r.status).toBe(400);
    expect((await r.json()).message).toMatch(/redigite/i);
    expect(storageMock.salvarIntegracaoDeAssinatura).not.toHaveBeenCalled();
    expect((await json("PUT", "/api/admin/providers/4/assinatura/zapsign", { apiToken: "novo" })).status).toBe(200);
  });
  it("ativar testa o token no host do ambiente e só então liga; falha vira 422 e não liga", async () => {
    storageMock.getIntegracaoParaAdmin.mockResolvedValue({ ...gravada(), isEnabled: true });
    const ok = await json("POST", "/api/admin/providers/4/assinatura/zapsign/ativar");
    expect(ok.status).toBe(200);
    expect(zapsignMock.testarToken).toHaveBeenCalledTimes(1);
    expect(storageMock.ativarIntegracaoDeAssinatura).toHaveBeenCalledWith(4);
    zapsignMock.testarToken.mockRejectedValueOnce(new ErroDeConfissao("ZAPSIGN_CREDENCIAL", "O ZapSign recusou o token", 422));
    const falha = await json("POST", "/api/admin/providers/4/assinatura/zapsign/ativar");
    expect(falha.status).toBe(422);
    expect((await falha.json()).message).toMatch(/recusou o token/);
    expect(storageMock.ativarIntegracaoDeAssinatura).toHaveBeenCalledTimes(1);
    storageMock.getIntegracaoComCredencial.mockResolvedValueOnce(undefined);
    expect((await json("POST", "/api/admin/providers/4/assinatura/zapsign/ativar")).status).toBe(400);
  });
  it("o corpo destas rotas não vai ao log de acesso", () => {
    expect(corpoEhSensivel("/api/admin/providers/4/assinatura/zapsign")).toBe(true);
    expect(corpoEhSensivel("/api/admin/providers/4/assinatura/zapsign/ativar")).toBe(true);
    expect(corpoEhSensivel("/api/admin/providers/4/plan")).toBe(false);
  });
});
