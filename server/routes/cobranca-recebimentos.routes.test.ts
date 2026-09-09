import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import type { Server } from "node:http";

const m = vi.hoisted(() => ({
  clienteExiste: vi.fn(), clienteDaFatura: vi.fn(), faturasDoCliente: vi.fn(),
  historicoDePagamentosDoCliente: vi.fn(), registrarQuitacaoConfirmada: vi.fn(),
  listarQuitacoesDoCliente: vi.fn(),
}));
vi.mock("../storage/faturas.storage", () => ({ FaturasStorage: class { constructor() { Object.assign(this, m); } } }));
vi.mock("../logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("./provider.routes", () => ({ podeAdministrarOProvedor: (s: { role?: string; providerId?: number; suporte?: { providerId: number } }) => s.role === "admin" || (s.role === "superadmin" && s.suporte?.providerId === s.providerId) }));
vi.mock("../auth", () => ({
  requireAuth: ((req, res, next) => req.session.userId ? next() : res.sendStatus(401)) as RequestHandler,
  requireProvider: ((req, res, next) => req.session.providerId ? next() : res.sendStatus(403)) as RequestHandler,
}));
import { registerCobrancaRecebimentosRoutes } from "./cobranca-recebimentos.routes";

let server: Server;
let base = "";
let sessao: { userId?: number; providerId?: number; role?: string };
const entrada = { referencia: "comprovante-901", pagoEm: "2026-09-01", valorPago: 120 };
const post = (body: unknown) => fetch(`${base}/api/cobranca/faturas/88/confirmar-quitacao`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, { session: sessao }); next(); });
  app.use(registerCobrancaRecebimentosRoutes());
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Sem porta de teste");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  vi.resetAllMocks();
  sessao = { userId: 7, providerId: 42, role: "admin" };
  m.clienteExiste.mockResolvedValue(true);
  m.clienteDaFatura.mockResolvedValue(9);
  m.faturasDoCliente.mockResolvedValue({ linhas: [], total: 0 });
  m.historicoDePagamentosDoCliente.mockResolvedValue({ historicoInsuficiente: true });
  m.listarQuitacoesDoCliente.mockResolvedValue([]);
  m.registrarQuitacaoConfirmada.mockResolvedValue({ faturaId: 88, repetida: false });
});

describe("recebimentos de cobrança: sessão, prova e isolamento", () => {
  it('recusa fatura fora da carteira sem confirmar recebimento', async () => {
    m.clienteExiste.mockResolvedValue(false);
    const r = await fetch(base + '/api/cobranca/faturas/88/confirmar-quitacao?carteira=ex_cliente', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entrada),
    });
    expect(r.status).toBe(404);
    expect(m.clienteExiste).toHaveBeenCalledWith(42, 9, 'ex_cliente');
    expect(m.registrarQuitacaoConfirmada).not.toHaveBeenCalled();
  });
  it('pagamentos respeita o contexto explicito da carteira', async () => {
    m.clienteExiste.mockResolvedValue(false);
    const r = await fetch(base + '/api/cobranca/clientes/9/pagamentos?carteira=ativo');
    expect(r.status).toBe(404);
    expect(m.clienteExiste).toHaveBeenCalledWith(42, 9, 'ativo');
    expect(m.faturasDoCliente).not.toHaveBeenCalled();
  });
  it("exige sessão e administrador para confirmar", async () => {
    sessao = {};
    expect((await post(entrada)).status).toBe(401);
    sessao = { userId: 7, providerId: 42, role: "user" };
    expect((await post(entrada)).status).toBe(403);
    expect(m.registrarQuitacaoConfirmada).not.toHaveBeenCalled();
  });
  it("lê somente cliente e faturas do provedor da sessão", async () => {
    const r = await fetch(`${base}/api/cobranca/clientes/9/pagamentos?providerId=999`);
    expect(r.status).toBe(200);
    expect(m.clienteExiste).toHaveBeenCalledWith(42, 9, undefined);
    expect(m.faturasDoCliente).toHaveBeenCalledWith(42, 9);
    expect(m.historicoDePagamentosDoCliente).toHaveBeenCalledWith(42, 9);
  });
  it("não revela cliente nem fatura de outro provedor", async () => {
    m.clienteExiste.mockResolvedValue(false);
    expect((await fetch(`${base}/api/cobranca/clientes/9/pagamentos`)).status).toBe(404);
    expect(m.faturasDoCliente).not.toHaveBeenCalled();
    m.clienteDaFatura.mockResolvedValue(null);
    expect((await post(entrada)).status).toBe(404);
    expect(m.registrarQuitacaoConfirmada).not.toHaveBeenCalled();
  });
  it("atribui origem, usuário e cliente no servidor", async () => {
    expect((await post(entrada)).status).toBe(200);
    expect(m.clienteDaFatura).toHaveBeenCalledWith(42, 88);
    expect(m.registrarQuitacaoConfirmada).toHaveBeenCalledWith(42, 9, { ...entrada, faturaId: 88, origem: "comprovante_conferido", userId: 7 }, undefined);
  });
  it.each([{ ...entrada, origem: "erp_confirmado" }, { ...entrada, providerId: 999 }, { ...entrada, userId: 999 }, { ...entrada, pagoEm: "2026-02-30" }, { ...entrada, referencia: " " }, { ...entrada, valorPago: 0.001 }])("recusa confirmação inválida ou origem forjada %#", async body => {
    expect((await post(body)).status).toBe(400);
    expect(m.registrarQuitacaoConfirmada).not.toHaveBeenCalled();
  });
  it("conflito financeiro é 409 e replay mantém o resultado", async () => {
    m.registrarQuitacaoConfirmada.mockRejectedValueOnce(new Error("Esta fatura já tem outra confirmação de recebimento"));
    expect((await post(entrada)).status).toBe(409);
    m.registrarQuitacaoConfirmada.mockResolvedValue({ faturaId: 88, repetida: true });
    expect(await (await post(entrada)).json()).toEqual({ faturaId: 88, repetida: true });
  });
  it("não expõe conteúdo de falhas do banco", async () => {
    m.registrarQuitacaoConfirmada.mockRejectedValue(new Error("postgres://private-password"));
    const r = await post(entrada);
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("private-password");
  });
});
