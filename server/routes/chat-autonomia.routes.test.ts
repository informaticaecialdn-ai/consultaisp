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
const agentesServico = vi.hoisted(() => ({
  funcionariaDigitalDoProvedor: vi.fn(async (): Promise<any> => ({ ativa: false })),
  configurarFuncionariaDigital: vi.fn(async (_p: number, dados: { ativa: boolean }): Promise<any> => ({ ativa: dados.ativa })),
}));
vi.mock("../services/chat/chat-agentes.service", () => agentesServico);
vi.mock("../services/chat/chat-ponte.service", async () => {
  const real = await vi.importActual<typeof import("../services/chat/chat-ponte.service")>("../services/chat/chat-ponte.service");
  return { ErroDaPonteDoChat: real.ErroDaPonteDoChat };
});
vi.mock("./provider.routes", () => ({ podeAdministrarOProvedor: (s: any) => s.role === "admin" }));
vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => (req.session?.userId ? next() : res.status(401).json({ message: "Autenticacao necessaria" })),
  requireProvider: (req: any, res: any, next: any) => (req.session?.providerId ? next() : res.status(403).json({ message: "Somente provedores" })),
}));
const escopoStorage = vi.hoisted(() => ({ getConversaDoChat: vi.fn(), obterCasoDeCobranca: vi.fn() }));
vi.mock("../storage", () => ({ storage: escopoStorage }));
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
    expect(servico.configurarAutonomia).toHaveBeenCalledWith(42, CONFIG, 7);
    // `.strict()`: providerId no corpo e recusado, nao ignorado em silencio.
    expect((await json("PUT", "/api/chat-bullq/autonomia", { ...CONFIG, providerId: 99 })).status).toBe(400);
    expect((await json("PUT", "/api/chat-bullq/autonomia", { ...CONFIG, maxTurnos: 50 })).status).toBe(400);
    expect((await json("PUT", "/api/chat-bullq/autonomia", { ...CONFIG, tipos: [] })).status).toBe(400);
    expect(servico.configurarAutonomia).toHaveBeenCalledTimes(1);
  });
  it("tipo marcado sem agente provisionado: o CONFLITO do servico vira 409 dizendo QUAL agente (a frase que o servico monta pelo catalogo)", async () => {
    sessao = ADMIN;
    const frase = "O agente “Recuperação de equipamentos” ainda não está provisionado. Provisione-o em Agentes do chat ou desmarque-o.";
    servico.configurarAutonomia.mockRejectedValueOnce(new ErroDaPonteDoChat("CONFLITO", frase));
    const r = await json("PUT", "/api/chat-bullq/autonomia", CONFIG);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ message: frase, codigo: "CONFLITO" });
  });
  it("banco sem a fila: 503 — nunca um estado inventado", async () => {
    sessao = ADMIN;
    servico.estadoDaAutonomia.mockRejectedValueOnce(new Error('relation "chat_autonomia_config" does not exist'));
    expect((await json("GET", "/api/chat-bullq/autonomia")).status).toBe(503);
    servico.configurarAutonomia.mockRejectedValueOnce(new Error("banco fora"));
    expect((await json("PUT", "/api/chat-bullq/autonomia", CONFIG)).status).toBe(503);
  });
  /**
   * O que a VPS mostrou em 16/09/2026: o fork recusou o OPEN→BOT com 400 e a
   * tela leu "confira as migracoes (0028/0034)". A recusa do Chat BullQ e
   * CHAT_FALHOU → 502 com a frase que o servico montou (razao + o que fazer),
   * e fica no log com a razao — senao so o operador a ve, no toast.
   */
  it("o Chat BullQ recusou (CHAT_FALHOU): 502 com a frase do servico, no PUT e no devolver, e a razao vai ao log", async () => {
    sessao = ADMIN;
    const frase = "Não foi possível devolver a conversa ao assistente: a conversa está em atendimento humano no Chat BullQ e de lá não passa direto a ficar com o assistente. Confira o status dela lá e tente de novo.";
    servico.devolverAoAssistente.mockRejectedValueOnce(new ErroDaPonteDoChat("CHAT_FALHOU", frase, 400));
    const d = await json("POST", "/api/chat-bullq/autonomia/conversas/conv_1/devolver");
    expect(d.status).toBe(502);
    expect(await d.json()).toEqual({ message: frase, codigo: "CHAT_FALHOU" });
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.objectContaining({ codigo: "CHAT_FALHOU", status: 400, razao: frase }), expect.stringContaining("conversa não devolvida"));
    servico.configurarAutonomia.mockRejectedValueOnce(new ErroDaPonteDoChat("CHAT_FALHOU", "O Chat BullQ precisa do recurso de preparação de primeiro contato e da credencial do modelo: O Chat BullQ respondeu 404"));
    const p = await json("PUT", "/api/chat-bullq/autonomia", CONFIG);
    expect(p.status).toBe(502);
    expect(await p.json()).toMatchObject({ codigo: "CHAT_FALHOU", message: expect.stringContaining("credencial do modelo") });
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.objectContaining({ codigo: "CHAT_FALHOU", razao: expect.stringContaining("credencial do modelo") }), expect.stringContaining("configura"));
  });
  /*
   * A razao vem do fork e este codigo nao a inspeciona: um 400 de validacao de
   * la ecoa o que foi ENVIADO, e o corpo enviado leva telefone do cliente. O
   * toast e resposta ao operador e mostra a frase inteira; o LOG e registro e
   * nao pode guardar dado pessoal (LGPD).
   */
  it("a razao do fork vai ao log sem dado pessoal: telefone e CPF ecoados por ele nao ficam registrados — e o toast segue inteiro", async () => {
    sessao = ADMIN;
    const frase = "phone must be a valid phone number: 5543999887766 (documento 12345678909)";
    servico.devolverAoAssistente.mockRejectedValueOnce(new ErroDaPonteDoChat("CHAT_FALHOU", frase, 400));
    const d = await json("POST", "/api/chat-bullq/autonomia/conversas/conv_1/devolver");
    expect(d.status).toBe(502);
    expect(await d.json()).toEqual({ message: frase, codigo: "CHAT_FALHOU" });
    const registrada = loggerMock.warn.mock.calls.at(-1)?.[0].razao as string;
    expect(registrada).toBe("phone must be a valid phone number: … (documento …)");
    expect(registrada).not.toMatch(/\d{4}/);
  });
  /**
   * A frase das migracoes (0028/0034) so para o caso REAL — tabela ausente,
   * `42P01` do Postgres. Banco fora, timeout ou trava: 503 com uma frase que o
   * operador consegue agir ("tente de novo; se persistir, avise o suporte"),
   * sem numero de migracao. O `err` completo continua no log.
   */
  it("503: tabela ausente (42P01) cita as migracoes; qualquer outro erro que nao e da ponte, nao — e o operador le o que fazer", async () => {
    sessao = ADMIN;
    servico.devolverAoAssistente.mockRejectedValueOnce(Object.assign(new Error('relation "chat_autonomia_fila" does not exist'), { code: "42P01" }));
    const m = await json("POST", "/api/chat-bullq/autonomia/conversas/conv_1/devolver");
    expect(m.status).toBe(503);
    expect((await m.json()).message).toMatch(/migrações .*\(0028\/0034\)/);
    servico.devolverAoAssistente.mockRejectedValueOnce(new Error("connection timeout"));
    const t = await json("POST", "/api/chat-bullq/autonomia/conversas/conv_1/devolver");
    expect(t.status).toBe(503);
    const corpo = await t.json();
    expect(corpo.message).not.toMatch(/0028|migra/);
    expect(corpo.message).toMatch(/Tente novamente.*suporte/);
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), expect.stringContaining("conversa não devolvida"));
    servico.filaDaAutonomia.mockRejectedValueOnce(Object.assign(new Error("undefined_table"), { code: "42P01" }));
    const f = await json("GET", "/api/chat-bullq/autonomia/estado");
    expect(f.status).toBe(503);
    expect((await f.json()).message).toMatch(/0028\/0034/);
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


it("não devolve ao assistente conversa de outra carteira", async () => {
  sessao = OPERADOR;
  escopoStorage.getConversaDoChat.mockResolvedValue({ casoId: 11 });
  escopoStorage.obterCasoDeCobranca.mockResolvedValue({ carteira: "ex_cliente" });
  const resposta = await json("POST", "/api/chat-bullq/autonomia/conversas/conv_1/devolver?origem=cobranca&carteira=ativo", {});
  expect(resposta.status).toBe(404);
  expect(servico.devolverAoAssistente).not.toHaveBeenCalled();
});

describe("D9 — a chave da funcionária digital", () => {
  const ROTA = "/api/chat-bullq/autonomia/funcionaria-digital";
  it("sem sessao 401; sem provedor 403; nada chega ao servico", async () => {
    expect((await json("GET", ROTA)).status).toBe(401);
    expect((await json("PUT", ROTA, { ativa: true })).status).toBe(401);
    sessao = SUPERADMIN_SEM_SUPORTE;
    expect((await json("GET", ROTA)).status).toBe(403);
    expect((await json("PUT", ROTA, { ativa: true })).status).toBe(403);
    expect(agentesServico.funcionariaDigitalDoProvedor).not.toHaveBeenCalled();
    expect(agentesServico.configurarFuncionariaDigital).not.toHaveBeenCalled();
  });
  it("qualquer operador le a chave do provedor DA SESSAO; o padrao e desligada", async () => {
    sessao = OPERADOR;
    const r = await json("GET", ROTA);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ativa: false });
    expect(agentesServico.funcionariaDigitalDoProvedor).toHaveBeenCalledWith(42);
  });
  it("operador nao grava: 403 e o servico nao e chamado", async () => {
    sessao = OPERADOR;
    const r = await json("PUT", ROTA, { ativa: true });
    expect(r.status).toBe(403);
    expect((await r.json()).message).toMatch(/administradores/);
    expect(agentesServico.configurarFuncionariaDigital).not.toHaveBeenCalled();
  });
  it("admin liga e desliga: provedor e usuario da sessao; corpo so com ativa booleana", async () => {
    sessao = ADMIN;
    const ligar = await json("PUT", ROTA, { ativa: true });
    expect(ligar.status).toBe(200);
    expect(await ligar.json()).toEqual({ ativa: true });
    expect(agentesServico.configurarFuncionariaDigital).toHaveBeenCalledWith(42, { ativa: true }, 7);
    expect((await json("PUT", ROTA, { ativa: false })).status).toBe(200);
    expect(agentesServico.configurarFuncionariaDigital).toHaveBeenLastCalledWith(42, { ativa: false }, 7);
    for (const corpo of [{}, { ativa: "sim" }, { ativa: true, providerId: 99 }]) expect((await json("PUT", ROTA, corpo)).status).toBe(400);
    expect(agentesServico.configurarFuncionariaDigital).toHaveBeenCalledTimes(2);
  });
  it("sem integracao ou configuracao sendo salva: 409 com a frase; banco fora: 503 — a leitura nunca inventa 'desligada'", async () => {
    sessao = ADMIN;
    agentesServico.configurarFuncionariaDigital.mockRejectedValueOnce(new ErroDaPonteDoChat("CONFLITO", "A configuração do chat está sendo atualizada. Tente novamente em instantes."));
    const r = await json("PUT", ROTA, { ativa: false });
    expect(r.status).toBe(409);
    expect((await r.json()).message).toMatch(/sendo atualizada/);
    agentesServico.configurarFuncionariaDigital.mockRejectedValueOnce(new Error("banco fora"));
    expect((await json("PUT", ROTA, { ativa: false })).status).toBe(503);
    agentesServico.funcionariaDigitalDoProvedor.mockRejectedValueOnce(new Error("banco fora"));
    const leitura = await json("GET", ROTA);
    expect(leitura.status).toBe(503);
    expect(JSON.stringify(await leitura.json())).not.toContain("ativa");
  });
});
