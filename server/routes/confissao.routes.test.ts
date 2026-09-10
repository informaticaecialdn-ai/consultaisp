import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * O contrato das rotas: tenant da sessão em toda chamada; operador comum não
 * emite, não cancela, não reenvia e não marca revisado (403 APROVACAO_OBRIGATORIA);
 * superadmin só em janela de suporte; a base vai com os parâmetros que o
 * diálogo manda; os erros de domínio viram o HTTP do próprio erro; o PDF sai
 * como anexo e registra o download; a lista nunca leva PDF nem segredo.
 */
const storageMock = vi.hoisted(() => ({
  listarConfissoesDoCliente: vi.fn(async (): Promise<any[]> => []),
  obterConfissao: vi.fn(async (): Promise<any> => undefined),
  obterPdf: vi.fn(async (): Promise<any> => undefined),
  marcarModeloRevisado: vi.fn(async (): Promise<void> => undefined),
  getUsersByProvider: vi.fn(async (): Promise<any[]> => [{ id: 7, name: "Ana Admin" }]),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
const HASH = "a".repeat(64);
const servicos = vi.hoisted(() => ({
  montarBase: vi.fn(async (): Promise<any> => ({ dto: { origem: "saldo_integral", bloqueios: [], baseHash: "a".repeat(64), valorTotal: 10 } })),
  estadoDaAssinatura: vi.fn(async (): Promise<any> => ({ configurada: true, ativa: true, ambiente: "producao", modelo: "padrao", modeloRevisado: false, provedorAssina: false, authMode: "assinaturaTela-tokenWhatsapp", custo: null, prazoAssinaturaDias: 15, chatDisponivel: false, motivo: null })),
  emitirConfissao: vi.fn(async (): Promise<any> => confissao({ status: "enviada" })),
  cancelarConfissao: vi.fn(async (): Promise<any> => confissao({ status: "cancelada" })),
  reenviarNotificacoes: vi.fn(async (): Promise<any> => ({ enviados: 1, falhas: 0 })),
}));
vi.mock("../services/confissao/confissao-base.service", () => ({ montarBase: servicos.montarBase, estadoDaAssinatura: servicos.estadoDaAssinatura }));
vi.mock("../services/confissao/confissao-emissao.service", () => ({ emitirConfissao: servicos.emitirConfissao }));
vi.mock("../services/confissao/confissao-retorno.service", () => ({ cancelarConfissao: servicos.cancelarConfissao, reenviarNotificacoes: servicos.reenviarNotificacoes }));
vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => (req.session?.userId ? next() : res.status(401).json({ message: "Autenticacao necessaria" })),
  requireProvider: (req: any, res: any, next: any) => (req.session?.providerId ? next() : res.status(403).json({ message: "Somente provedores" })),
}));
vi.mock("./provider.routes", () => ({
  podeAdministrarOProvedor: (s: any) => s.role === "admin" || (s.role === "superadmin" && s.suporte?.providerId === s.providerId),
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { registerConfissaoRoutes } from "./confissao.routes";
import { ErroDeConfissao } from "../assinatura/erro";

function confissao(extra: Record<string, any> = {}) {
  return { id: 77, providerId: 42, customerId: 5, casoId: 9, negociacaoId: null, status: "enviada", origem: "saldo_integral", ambiente: "producao", zapsignSandbox: false,
    valorTotal: "819.76", valorOriginal: null, descontoPct: null, parcelas: [{ n: 1, rotulo: "parcela", valor: 819.76, vencimento: "2026-10-10" }], erpFaturas: [],
    modelo: "padrao", modeloVersao: "1.0", modeloRevisado: false, dataLimiteAssinatura: "2026-09-25", enviadaEm: new Date("2026-09-10T13:00:00Z"), assinadaEm: null, encerradaEm: null,
    recusaInformadaEm: null, expiracaoInformadaEm: null, erroUltimo: null, zapsignSigners: [{ papel: "cliente", token: "s-1", signUrl: "https://app.zapsign.com.br/verificar/s-1", status: "new", signedAt: null, authMode: "x" }],
    contatoAlteradoPorUserId: null, criadaPorUserId: 7, createdAt: new Date("2026-09-10T12:59:00Z"), pdfOriginalSha256: "a", pdfAssinadoSha256: null, baseCanonica: { segredo: "não sai" }, textoHash: "h1", ...extra };
}

let server: Server;
let base: string;
let sessao: Record<string, any> = {};
const ADMIN = { userId: 7, providerId: 42, role: "admin" };
const OPERADOR = { userId: 8, providerId: 42, role: "user" };
const SUPORTE = { userId: 1, providerId: 42, role: "superadmin", suporte: { providerId: 42 } };
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });
  app.use(registerConfissaoRoutes());
  await new Promise<void>(r => { server = app.listen(0, "127.0.0.1", () => r()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });
beforeEach(() => { vi.clearAllMocks(); sessao = ADMIN; });
const json = (method: string, caminho: string, corpo?: unknown) =>
  fetch(`${base}${caminho}`, { method, headers: corpo === undefined ? {} : { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
const corpo = () => ({ origem: "saldo_integral", vencimento: "2026-10-10", faturasExcluidas: ["F-2#multa"], baseHash: HASH, chaveIdempotencia: "5f0c9d1e-2b1a-4c3d-9e8f-000000000001", confirmoTeste: false });

describe("permissões", () => {
  it("operador lê estado, base e lista; não emite, não cancela, não reenvia, não marca revisado", async () => {
    sessao = OPERADOR;
    expect((await json("GET", "/api/cobranca/confissoes/estado")).status).toBe(200);
    expect((await json("GET", "/api/cobranca/clientes/5/confissoes/base")).status).toBe(200);
    expect((await json("GET", "/api/cobranca/clientes/5/confissoes")).status).toBe(200);
    for (const [m, c, b] of [["POST", "/api/cobranca/clientes/5/confissoes", corpo()], ["POST", "/api/cobranca/confissoes/77/cancelar", undefined], ["POST", "/api/cobranca/confissoes/77/reenviar", undefined], ["PUT", "/api/cobranca/confissoes/modelo/revisado", undefined]] as const) {
      const r = await json(m, c, b);
      expect(r.status, `${m} ${c}`).toBe(403);
      expect(await r.json()).toMatchObject({ code: "APROVACAO_OBRIGATORIA", message: expect.stringMatching(/^Apenas administradores podem/) });
    }
    expect(servicos.emitirConfissao).not.toHaveBeenCalled();
  });
  it("admin e superadmin em janela de suporte emitem; superadmin fora da janela não", async () => {
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", corpo())).status).toBe(200);
    sessao = SUPORTE;
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", corpo())).status).toBe(200);
    sessao = { userId: 1, providerId: 42, role: "superadmin" };
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", corpo())).status).toBe(403);
    expect(servicos.emitirConfissao).toHaveBeenCalledTimes(2);
    expect(servicos.emitirConfissao).toHaveBeenCalledWith(42, 5, 7, expect.objectContaining({ origem: "saldo_integral", baseHash: HASH, faturasExcluidas: ["F-2#multa"] }));
  });
  it("sem sessão é 401", async () => {
    sessao = {};
    expect((await json("GET", "/api/cobranca/confissoes/estado")).status).toBe(401);
  });
});

describe("base e emissão", () => {
  it("a base recebe os parâmetros do diálogo e responde o DTO", async () => {
    const r = await json("GET", "/api/cobranca/clientes/5/confissoes/base?vencimento=2026-10-10&faturasExcluidas=F-2%23multa,F-3&email=x%40y.com&representanteNome=Jo%C3%A3o&representanteCpf=987.654.321-00");
    expect(r.status).toBe(200);
    expect(servicos.montarBase).toHaveBeenCalledWith(42, 5, { vencimento: "2026-10-10", faturasExcluidas: ["F-2#multa", "F-3"], email: "x@y.com", telefone: null, representante: { nome: "João", cpf: "98765432100" } });
    expect((await r.json()).baseHash).toBe(HASH);
    expect((await json("GET", "/api/cobranca/clientes/abc/confissoes/base")).status).toBe(400);
    expect((await json("GET", "/api/cobranca/clientes/5/confissoes/base?vencimento=10/10/2026")).status).toBe(400);
  });
  it("o corpo da emissão é validado; erros de domínio saem com o HTTP do erro e o código", async () => {
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", { ...corpo(), chaveIdempotencia: "nao-e-uuid" })).status).toBe(400);
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", { ...corpo(), origem: "outra" })).status).toBe(400);
    servicos.emitirConfissao.mockRejectedValueOnce(new ErroDeConfissao("BLOQUEADA", "abra o caso antes", 422, { bloqueios: ["abra o caso antes"] }));
    const r = await json("POST", "/api/cobranca/clientes/5/confissoes", corpo());
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ message: "abra o caso antes", code: "BLOQUEADA", detalhes: { bloqueios: ["abra o caso antes"] } });
    servicos.emitirConfissao.mockRejectedValueOnce(new ErroDeConfissao("BASE_MUDOU", "A dívida mudou", 409));
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", corpo())).status).toBe(409);
    servicos.emitirConfissao.mockRejectedValueOnce(new Error("boom"));
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", corpo())).status).toBe(500);
  });
  it("a resposta da emissão e a lista têm a forma de ConfissaoResumo: sem base canônica, sem PDF, com signUrl do cliente e quem emitiu", async () => {
    const r = await (await json("POST", "/api/cobranca/clientes/5/confissoes", corpo())).json();
    expect(r).toMatchObject({ id: 77, status: "enviada", valorTotal: 819.76, signUrlCliente: "https://app.zapsign.com.br/verificar/s-1", criadaPor: "Ana Admin", contatoAlterado: false, pdf: { original: true, assinado: false }, dataLimiteAssinatura: "2026-09-25" });
    expect(JSON.stringify(r)).not.toMatch(/baseCanonica|segredo|base64|textoHash/);
    storageMock.listarConfissoesDoCliente.mockResolvedValueOnce([confissao(), confissao({ id: 60, status: "cancelada" })]);
    const lista = await (await json("GET", "/api/cobranca/clientes/5/confissoes")).json();
    expect(lista.map((c: any) => c.id)).toEqual([77, 60]);
    expect(storageMock.listarConfissoesDoCliente).toHaveBeenCalledWith(42, 5);
  });
});

describe("cancelar, reenviar, PDF, estado, modelo", () => {
  it("cancelar e reenviar passam pelo serviço com o tenant; erro de domínio preserva o HTTP", async () => {
    expect((await json("POST", "/api/cobranca/confissoes/77/cancelar")).status).toBe(200);
    expect(servicos.cancelarConfissao).toHaveBeenCalledWith(42, 77, 7);
    servicos.cancelarConfissao.mockRejectedValueOnce(new ErroDeConfissao("JA_ASSINADA", "já assinou", 409));
    expect((await json("POST", "/api/cobranca/confissoes/77/cancelar")).status).toBe(409);
    expect(await (await json("POST", "/api/cobranca/confissoes/77/reenviar")).json()).toEqual({ enviados: 1, falhas: 0 });
    servicos.reenviarNotificacoes.mockRejectedValueOnce(new ErroDeConfissao("REENVIO_CEDO", "aguarde", 429));
    expect((await json("POST", "/api/cobranca/confissoes/77/reenviar")).status).toBe(429);
  });
  it("o PDF sai como anexo, registra o download e some quando não é deste provedor", async () => {
    sessao = OPERADOR;
    storageMock.obterConfissao.mockResolvedValueOnce(confissao());
    storageMock.obterPdf.mockResolvedValueOnce({ bytes: Buffer.from("%PDF-1.4"), sha256: "a", tamanhoBytes: 8 });
    const r = await json("GET", "/api/cobranca/confissoes/77/pdf?tipo=original");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/pdf");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="confissao-77-original.pdf"');
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe("%PDF-1.4");
    expect(storageMock.obterPdf).toHaveBeenCalledWith(42, 77, "original", { registrarDownload: true });
    expect((await json("GET", "/api/cobranca/confissoes/77/pdf?tipo=assinado")).status).toBe(404);
    expect((await json("GET", "/api/cobranca/confissoes/77/pdf?tipo=outro")).status).toBe(400);
  });
  it("estado e modelo revisado", async () => {
    expect(await (await json("GET", "/api/cobranca/confissoes/estado")).json()).toMatchObject({ configurada: true, ativa: true });
    expect(servicos.estadoDaAssinatura).toHaveBeenCalledWith(42);
    expect((await json("PUT", "/api/cobranca/confissoes/modelo/revisado")).status).toBe(200);
    expect(storageMock.marcarModeloRevisado).toHaveBeenCalledWith(42, 7);
  });
});
