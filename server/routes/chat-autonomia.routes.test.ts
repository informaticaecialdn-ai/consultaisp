import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * As rotas da autonomia do chat: sem sessao 401, sem provedor 403, so o admin
 * grava a configuracao, o providerId vem SEMPRE da sessao (nunca do corpo),
 * a fila indisponivel responde 503 (a tela mostra o traco, nunca zero), e o
 * "devolver" leva ao servico a conversa da rota com o usuario da sessao.
 */
const servico = vi.hoisted(() => ({
  estadoDaAutonomia: vi.fn(async (): Promise<any> => ({ config: { ativa: false, maxTurnos: 12, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos"] }, fila: { pendente: 0, processando: 0, enviando: 0, concluido: 0, humano: 0, cancelado: 0 }, limites: { nunca: ["negativar"] } })),
  configurarAutonomia: vi.fn(async (): Promise<any> => ({ config: { ativa: true } })),
  filaDaAutonomia: vi.fn(async (): Promise<any> => ({ porStatus: { pendente: 2, processando: 0, enviando: 0, concluido: 5, humano: 1, cancelado: 0 }, total: 8, lidoEm: "2026-09-06T15:00:00.000Z" })),
  devolverAoAssistente: vi.fn(async (): Promise<any> => ({ conversationId: "conv_1", status: "BOT", humano: false })),
}));
vi.mock("../services/chat/chat-autonomia.service", () => servico);
vi.mock("../services/chat/chat-ponte.service", async () => {
  const real = await vi.importActual<typeof import("../services/chat/chat-ponte.service")>("../services/chat/chat-ponte.service");
  return { ErroDaPonteDoChat: real.ErroDaPonteDoChat };
});
vi.mock("./provider.routes", () => ({ podeAdministrarOProvedor: (s: any) => s.role === "admin" }));
vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => (req.session?.userId ? next() : res.status(401).json({ message: "Autenticacao necessaria" })),
  requireProvider: (req: any, res: any, next: any) => (req.session?.providerId ? next() : res.status(403).json({ message: "Somente provedores" })),
}));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: loggerMock }));

import { registerChatAutonomiaRoutes } from "./chat-autonomia.routes";
import { ErroDaPonteDoChat } from "../services/chat/chat-ponte.service";

let server: Server;
let base: string;
let sessao: Record<string, any> = {};
const ADMIN = { userId: 7, providerId: 42, role: "admin" };
const OPERADOR = { userId: 8, providerId: 42, role: "user" };
const SUPERADMIN_SEM_SUPORTE = { userId: 1, role: "superadmin" };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });
  app.use(registerChatAutonomiaRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.clearAllMocks(); sessao = {}; });

const json = (method: string, caminho: string, corpo?: unknown) =>
  fetch(`${base}${caminho}`, { method, headers: corpo === undefined ? {} : { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

const CONFIG = { ativa: true, maxTurnos: 8, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: false, tipos: ["cobranca_ativos", "cobranca_ex_clientes"] };

describe("acesso", () => {
  it("sem sessao: 401 em todas; superadmin sem provedor: 403; nada chega ao servico", async () => {
    expect((await json("GET", "/api/chat-bullq/autonomia")).status).toBe(401);
    expect((await json("PUT", "/api/chat-bullq/autonomia", CONFIG)).status).toBe(401);
    expect((await json("GET", "/api/chat-bullq/autonomia/estado")).status).toBe(401);
    expect((await json("POST", "/api/chat-bullq/autonomia/conversas/conv_1/devolver")).status).toBe(401);
    sessao = SUPERADMIN_SEM_SUPORTE;
    expect((await json("GET", "/api/chat-bullq/autonomia")).status).toBe(403);
    expect((await json("GET", "/api/chat-bullq/autonomia/estado")).status).toBe(403);
    expect(servico.estadoDaAutonomia).not.toHaveBeenCalled();
    expect(servico.filaDaAutonomia).not.toHaveBeenCalled();
    expect(servico.devolverAoAssistente).not.toHaveBeenCalled();
  });
  it("operador le, mas nao grava: PUT e 403 e o servico nao e chamado", async () => {
    sessao = OPERADOR;
    expect((await json("GET", "/api/chat-bullq/autonomia")).status).toBe(200);
    const r = await json("PUT", "/api/chat-bullq/autonomia", CONFIG);
    expect(r.status).toBe(403);
    expect((await r.json()).message).toMatch(/administradores/);
    expect(servico.configurarAutonomia).not.toHaveBeenCalled();
  });
});

describe("configuracao", () => {
  it("GET devolve config, fila e limites do provedor DA SESSAO", async () => {
    sessao = ADMIN;
    const r = await json("GET", "/api/chat-bullq/autonomia");
    expect(r.status).toBe(200);
    expect(servico.estadoDaAutonomia).toHaveBeenCalledWith(42);
    const corpo = await r.json();
    expect(corpo.config.ativa).toBe(false);
    expect(corpo.limites.nunca).toContain("negativar");
  });
  it("admin grava: o providerId e o da sessao mesmo que o corpo tente outro; corpo invalido e 400", async () => {
    sessao = ADMIN;
    const r = await json("PUT", "/api/chat-bullq/autonomia", CONFIG);
    expect(r.status).toBe(200);
    expect(servico.configurarAutonomia).toHaveBeenCalledWith(42, CONFIG);
    // `.strict()`: providerId no corpo e recusado, nao ignorado em silencio.
    expect((await json("PUT", "/api/chat-bullq/autonomia", { ...CONFIG, providerId: 99 })).status).toBe(400);
    expect((await json("PUT", "/api/chat-bullq/autonomia", { ...CONFIG, maxTurnos: 50 })).status).toBe(400);
    expect((await json("PUT", "/api/chat-bullq/autonomia", { ...CONFIG, tipos: [] })).status).toBe(400);
    expect(servico.configurarAutonomia).toHaveBeenCalledTimes(1);
  });
  it("agente sem estar pronto: o CONFLITO do servico vira 409 com a frase dele", async () => {
    sessao = ADMIN;
    servico.configurarAutonomia.mockRejectedValueOnce(new ErroDaPonteDoChat("CONFLITO", "Configure a credencial de IA e deixe os agentes selecionados prontos antes de ativar a autonomia"));
    const r = await json("PUT", "/api/chat-bullq/autonomia", CONFIG);
    expect(r.status).toBe(409);
    expect((await r.json()).message).toMatch(/agentes selecionados prontos/);
  });
  it("banco sem a fila: 503 — nunca um estado inventado", async () => {
    sessao = ADMIN;
    servico.estadoDaAutonomia.mockRejectedValueOnce(new Error('relation "chat_autonomia_config" does not exist'));
    expect((await json("GET", "/api/chat-bullq/autonomia")).status).toBe(503);
    servico.configurarAutonomia.mockRejectedValueOnce(new Error("banco fora"));
    expect((await json("PUT", "/api/chat-bullq/autonomia", CONFIG)).status).toBe(503);
  });
});

describe("fila por status", () => {
  it("devolve a contagem do provedor da sessao", async () => {
    sessao = OPERADOR;
    const r = await json("GET", "/api/chat-bullq/autonomia/estado");
    expect(r.status).toBe(200);
    expect(servico.filaDaAutonomia).toHaveBeenCalledWith(42);
    expect(await r.json()).toMatchObject({ porStatus: { pendente: 2, concluido: 5, humano: 1 }, total: 8 });
  });
  it("fila indisponivel: 503, sem zero enganoso no corpo", async () => {
    sessao = OPERADOR;
    servico.filaDaAutonomia.mockRejectedValueOnce(new Error("relation does not exist"));
    const r = await json("GET", "/api/chat-bullq/autonomia/estado");
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain("porStatus");
  });
});

describe("devolver ao assistente", () => {
  it("leva a conversa da rota e o usuario da sessao ao servico; operador pode", async () => {
    sessao = OPERADOR;
    const r = await json("POST", "/api/chat-bullq/autonomia/conversas/conv_1/devolver");
    expect(r.status).toBe(200);
    expect(servico.devolverAoAssistente).toHaveBeenCalledWith(42, "conv_1", 8);
    expect(await r.json()).toMatchObject({ conversationId: "conv_1", status: "BOT", humano: false });
  });
  it("conversa de outro provedor: 404; autonomia desligada: 409; trava ocupada: 409; chat desligado: 503", async () => {
    sessao = ADMIN;
    servico.devolverAoAssistente.mockRejectedValueOnce(new ErroDaPonteDoChat("CASO_NAO_ENCONTRADO", "Conversa não encontrada neste provedor"));
    expect((await json("POST", "/api/chat-bullq/autonomia/conversas/conv_de_outro/devolver")).status).toBe(404);
    servico.devolverAoAssistente.mockRejectedValueOnce(new ErroDaPonteDoChat("CONFLITO", "Ative a autonomia antes de devolver a conversa ao assistente"));
    expect((await json("POST", "/api/chat-bullq/autonomia/conversas/conv_1/devolver")).status).toBe(409);
    servico.devolverAoAssistente.mockRejectedValueOnce(new ErroDaPonteDoChat("CHAT_DESLIGADO", "Configure o Chat BullQ"));
    expect((await json("POST", "/api/chat-bullq/autonomia/conversas/conv_1/devolver")).status).toBe(503);
  });
});
