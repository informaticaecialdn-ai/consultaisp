import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * As rotas da ponte com o Chat BullQ: quem pode o que (operador manda caso,
 * so admin liga o canal), o que cada erro da ponte vira em HTTP, e que o
 * providerId e o userId da SESSAO — nunca do corpo — chegam ao servico.
 */

const servico = vi.hoisted(() => ({
  estadoDaIntegracao: vi.fn(async (): Promise<any> => ({ ligado: true, provisionado: false, organizationId: null, canal: null, status: null, ultimoErro: null, inboxUrl: "https://chat.consultaisp.com.br/inbox" })),
  configurarCanalWhatsapp: vi.fn(async (): Promise<any> => ({ canalOk: true, integracao: { status: "ativo", canalId: "ch_1", canalNome: "Principal", ultimoErro: null } })),
  enviarCasoParaCobranca: vi.fn(async (): Promise<any> => ({ conversationId: "conv_1", reaproveitada: false, messageId: "m1", inboxUrl: "https://chat.consultaisp.com.br/inbox" })),
  conversaDoCaso: vi.fn(async (): Promise<any> => null),
  enviarRecuperacaoParaChat: vi.fn(async (): Promise<any> => ({ conversationId: "conv_9", reaproveitada: false, messageId: "m9", inboxUrl: "https://chat.consultaisp.com.br/inbox" })),
  definirSenhaDoInbox: vi.fn(async (): Promise<any> => ({ ownerEmail: "dono@isp.com" })),
}));
vi.mock("../services/chat/chat-ponte.service", async () => {
  const real = await vi.importActual<typeof import("../services/chat/chat-ponte.service")>("../services/chat/chat-ponte.service");
  return { ...servico, ErroDaPonteDoChat: real.ErroDaPonteDoChat };
});
vi.hoisted(() => { process.env.SESSION_SECRET ||= "segredo-de-teste-sem-nenhum-valor-real"; });
vi.mock("../db", () => ({ pool: { query: async () => ({ rows: [] }), on: () => undefined, connect: async () => ({ release: () => undefined }) }, db: {} }));
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => (req.session?.userId ? next() : res.status(401).json({ message: "Autenticacao necessaria" })),
  requireProvider: (req: any, res: any, next: any) => (req.session?.providerId ? next() : res.status(403).json({ message: "Somente provedores" })),
}));
vi.mock("../password", () => ({ hashPassword: vi.fn(async (s: string) => `hash:${s}`) }));
vi.mock("../services/email", () => ({ sendUsuarioAdicionadoEmail: vi.fn(async () => undefined) }));
vi.mock("../services/marca.service", () => ({
  resolverMarcaPorId: vi.fn(async () => ({ marcaId: null, nomeProduto: "Consulta ISP", suporteEmail: null })),
  urlDeEntrada: vi.fn(() => "https://consultaisp.example"),
  MARCA_PLATAFORMA: { marcaId: null, nomeProduto: "Consulta ISP", suporteEmail: null },
}));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: loggerMock }));

import { registerChatBullqRoutes } from "./chat-bullq.routes";
import { ErroDaPonteDoChat } from "../services/chat/chat-ponte.service";

let server: Server;
let base: string;
let sessao: Record<string, any> = {};
const ADMIN = { userId: 7, providerId: 42, role: "admin" };
const OPERADOR = { userId: 8, providerId: 42, role: "user" };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });
  app.use(registerChatBullqRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.clearAllMocks(); sessao = {}; });

const json = (method: string, caminho: string, corpo?: unknown) =>
  fetch(`${base}${caminho}`, { method, headers: corpo === undefined ? {} : { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

describe("acesso", () => {
  it("401 sem sessao; 403 sem provedor", async () => {
    expect((await json("GET", "/api/chat-bullq/integracao")).status).toBe(401);
    sessao = { userId: 1, role: "superadmin" };
    expect((await json("GET", "/api/chat-bullq/integracao")).status).toBe(403);
  });
  it("operador ve a integracao e manda caso; so admin liga o canal", async () => {
    sessao = OPERADOR;
    expect((await json("GET", "/api/chat-bullq/integracao")).status).toBe(200);
    expect((await json("POST", "/api/chat-bullq/cobranca/casos/10/enviar", {})).status).toBe(200);
    expect((await json("POST", "/api/chat-bullq/integracao/canal", { nome: "Principal", token: "tok_12345678" })).status).toBe(403);
    expect(servico.configurarCanalWhatsapp).not.toHaveBeenCalled();
    sessao = ADMIN;
    expect((await json("POST", "/api/chat-bullq/integracao/canal", { nome: "Principal", token: "tok_12345678" })).status).toBe(200);
    expect(servico.configurarCanalWhatsapp).toHaveBeenCalledWith(42, { nome: "Principal", token: "tok_12345678", webhookSecret: undefined });
  });
});

describe("enviar para cobranca", () => {
  it("passa providerId e userId da sessao, o caso da rota e o texto/acao do corpo", async () => {
    sessao = OPERADOR;
    const res = await json("POST", "/api/chat-bullq/cobranca/casos/10/enviar", { texto: "Oi, tudo bem?", acaoDaEtapa: "Lembrar" });
    expect(res.status).toBe(200);
    expect(servico.enviarCasoParaCobranca).toHaveBeenCalledWith(42, 10, 8, "Oi, tudo bem?", "Lembrar");
    expect(await res.json()).toMatchObject({ conversationId: "conv_1" });
  });
  it("corpo vazio e aceito (mensagem modelo); caso invalido e 400; texto gigante e 400", async () => {
    sessao = OPERADOR;
    expect((await json("POST", "/api/chat-bullq/cobranca/casos/10/enviar")).status).toBe(200);
    expect(servico.enviarCasoParaCobranca).toHaveBeenLastCalledWith(42, 10, 8, null, null);
    expect((await json("POST", "/api/chat-bullq/cobranca/casos/abc/enviar", {})).status).toBe(400);
    expect((await json("POST", "/api/chat-bullq/cobranca/casos/10/enviar", { texto: "x".repeat(2001) })).status).toBe(400);
  });
  it("os erros da ponte viram o status certo, com o codigo", async () => {
    sessao = OPERADOR;
    const casos: Array<[string, number]> = [["CASO_NAO_ENCONTRADO", 404], ["CHAT_DESLIGADO", 503], ["CHAT_FALHOU", 502], ["SEM_CANAL", 409], ["SEM_TELEFONE", 409]];
    for (const [codigo, status] of casos) {
      servico.enviarCasoParaCobranca.mockRejectedValueOnce(new ErroDaPonteDoChat(codigo as any, `erro ${codigo}`));
      const res = await json("POST", "/api/chat-bullq/cobranca/casos/10/enviar", {});
      expect(res.status, codigo).toBe(status);
      expect(await res.json()).toMatchObject({ codigo, message: `erro ${codigo}` });
    }
    servico.enviarCasoParaCobranca.mockRejectedValueOnce(new Error("explodiu"));
    const res = await json("POST", "/api/chat-bullq/cobranca/casos/10/enviar", {});
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("explodiu");
  });
});

describe("conversa do caso e recuperacao", () => {
  it("404 quando o caso nunca foi enviado; 200 com a conversa quando foi", async () => {
    sessao = OPERADOR;
    expect((await json("GET", "/api/chat-bullq/cobranca/casos/10/conversa")).status).toBe(404);
    servico.conversaDoCaso.mockResolvedValueOnce({ conversationId: "conv_1", status: "OPEN", mensagens: [], erro: null, inboxUrl: "x" });
    const res = await json("GET", "/api/chat-bullq/cobranca/casos/10/conversa");
    expect(res.status).toBe(200);
    expect(servico.conversaDoCaso).toHaveBeenCalledWith(42, 10);
  });
  it("recuperacao: mesmo contrato de envio", async () => {
    sessao = OPERADOR;
    const res = await json("POST", "/api/chat-bullq/recuperacao/77/enviar", { texto: "Combinar retirada" });
    expect(res.status).toBe(200);
    expect(servico.enviarRecuperacaoParaChat).toHaveBeenCalledWith(42, 77, 8, "Combinar retirada");
  });
});

describe("senha do inbox", () => {
  it("so admin; senha curta e 400; a senha vai ao servico com o provedor da sessao", async () => {
    sessao = OPERADOR;
    expect((await json("POST", "/api/chat-bullq/integracao/senha", { senha: "segredo123" })).status).toBe(403);
    sessao = ADMIN;
    expect((await json("POST", "/api/chat-bullq/integracao/senha", { senha: "curta" })).status).toBe(400);
    const res = await json("POST", "/api/chat-bullq/integracao/senha", { senha: "segredo123" });
    expect(res.status).toBe(200);
    expect(servico.definirSenhaDoInbox).toHaveBeenCalledWith(42, "segredo123");
    expect(await res.json()).toEqual({ ownerEmail: "dono@isp.com" });
  });
});

describe("canal", () => {
  it("valida nome e token; teste do canal falhou vira 202 com o estado", async () => {
    sessao = ADMIN;
    expect((await json("POST", "/api/chat-bullq/integracao/canal", { nome: "P", token: "curto" })).status).toBe(400);
    servico.configurarCanalWhatsapp.mockResolvedValueOnce({ canalOk: false, integracao: { status: "erro", canalId: "ch_1", canalNome: "Principal", ultimoErro: "instancia desconectada" } });
    const res = await json("POST", "/api/chat-bullq/integracao/canal", { nome: "Principal", token: "tok_12345678" });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ canalOk: false, integracao: { status: "erro", ultimoErro: "instancia desconectada" } });
  });
});
