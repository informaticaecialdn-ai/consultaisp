import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Foco: `POST /api/public/visitor-chat/messages` — revisão final de segurança
 * antes da demonstração pública (item 5).
 *
 * A rota é pública (sem `requireAuth`), a linha que ela grava
 * (`visitorChatMessages`) não tem `provider_id` e nenhuma varredura de
 * limpeza a alcança. Sem limite de taxa nem de tamanho, qualquer IP grava
 * mensagens sem parar contra um corpo com até 10 MB (teto global do parser
 * JSON, `server/index.ts`). O que se prova aqui é só essas duas guardas.
 *
 * `generateChatResponse` (a resposta automática por IA) é mockada para
 * REJEITAR, de propósito: a rota dispara essa resposta em `fire-and-forget`
 * — sem `await` — e ela grava uma SEGUNDA mensagem
 * (`storage.createVisitorChatMessage` de novo, com `isFromAdmin: true`)
 * quando termina. Deixá-la resolver tornaria as asserções sobre "quantas
 * vezes o storage foi chamado" uma corrida contra microtasks, porque o `catch`
 * do handler não segura essa promise. Rejeitando, o bloco cai no `catch`
 * interno da rota (`console.warn`) e nunca chama o storage de novo — o que
 * sobra é determinístico e é exatamente o que esta bateria de testes verifica.
 *
 * Servidor NOVO a cada teste, de propósito (mesmo motivo de
 * `demo.routes.test.ts`): o limite de taxa vive num Map fechado dentro de
 * `createRateLimiter`, criado quando `registerChatRoutes()` roda — um
 * servidor compartilhado entre testes faria os pedidos de um teste contarem
 * para o balde do próximo.
 */
vi.hoisted(() => {
  process.env.SESSION_SECRET ||= "segredo-de-teste-sem-nenhum-valor-real";
});
vi.mock("../db", () => ({
  pool: { query: async () => ({ rows: [] }), on: () => undefined, connect: async () => ({ release: () => undefined }) },
  db: {},
}));

const storageMock = vi.hoisted(() => ({
  getVisitorChatByToken: vi.fn(async (): Promise<any> => ({ id: 1, status: "open", visitorName: "Visitante" })),
  createVisitorChatMessage: vi.fn(async (chatId: number, content: string, isFromAdmin: boolean, senderName: string): Promise<any> =>
    ({ id: 99, chatId, content, isFromAdmin, senderName })),
  getVisitorChatMessages: vi.fn(async (): Promise<any[]> => []),
  createVisitorChat: vi.fn(async (name: string, email: string, phone: string | null): Promise<any> =>
    ({ id: 2, token: `tok-${name}`, visitorName: name, visitorEmail: email, visitorPhone: phone })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

const chatAgentMock = vi.hoisted(() => ({
  generateChatResponse: vi.fn(async () => { throw new Error("nao usado neste teste"); }),
}));
vi.mock("../services/chat-agent", () => chatAgentMock);

import { registerChatRoutes } from "./chat.routes";

let server: Server;
let base: string;

async function subirServidor(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {};
    next();
  });
  app.use(registerChatRoutes());
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
}

beforeEach(async () => {
  vi.clearAllMocks();
  storageMock.getVisitorChatByToken.mockResolvedValue({ id: 1, status: "open", visitorName: "Visitante" });
  storageMock.createVisitorChatMessage.mockImplementation(async (chatId: number, content: string, isFromAdmin: boolean, senderName: string) =>
    ({ id: 99, chatId, content, isFromAdmin, senderName }));
  storageMock.createVisitorChat.mockImplementation(async (name: string, email: string, phone: string | null) =>
    ({ id: 2, token: `tok-${name}`, visitorName: name, visitorEmail: email, visitorPhone: phone }));
  await subirServidor();
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

const enviar = (content: unknown, token = "tok-123") =>
  fetch(`${base}/api/public/visitor-chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-visitor-token": token },
    body: JSON.stringify({ content }),
  });

describe("POST /api/public/visitor-chat/messages — teto de tamanho", () => {
  it("recusa mensagem acima de 4.000 caracteres, sem gravar nada", async () => {
    const res = await enviar("x".repeat(4_001));

    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/longa/i);
    expect(storageMock.createVisitorChatMessage).not.toHaveBeenCalled();
  });

  it("aceita exatamente 4.000 caracteres", async () => {
    const res = await enviar("x".repeat(4_000));

    expect(res.status).toBe(201);
    expect(storageMock.createVisitorChatMessage).toHaveBeenCalledTimes(1);
  });

  it("mensagem comum continua funcionando normalmente", async () => {
    const res = await enviar("Ola, quero saber mais sobre o produto");

    expect(res.status).toBe(201);
    expect(storageMock.createVisitorChatMessage).toHaveBeenCalledWith(1, "Ola, quero saber mais sobre o produto", false, "Visitante");
  });
});

describe("POST /api/public/visitor-chat/messages — limite de taxa", () => {
  it("acima de 20 pedidos na mesma janela, o servidor recusa com 429", async () => {
    const status: number[] = [];
    // 21 chamadas do MESMO IP (todas batem em 127.0.0.1 — o teste roda contra
    // um servidor local de verdade, entao o proprio `req.ip` e quem chaveia).
    for (let i = 0; i < 21; i++) {
      status.push((await enviar(`mensagem ${i}`)).status);
    }

    expect(status.filter(s => s === 201).length).toBe(20);
    expect(status[20]).toBe(429);
  });
});

const iniciar = (overrides: Record<string, unknown> = {}) =>
  fetch(`${base}/api/public/visitor-chat/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Visitante", email: "visitante@example.com", ...overrides }),
  });

/**
 * `POST /api/public/visitor-chat/start` — revisão final de segurança antes
 * da demonstração pública (item 5): a rota mintava token sem limite nenhum,
 * e cada token emitido dá direito a 20 mensagens por minuto com resposta
 * automática via IA (OpenAI) na rota `/messages` acima — sem freio aqui, um
 * IP mintava tokens sem parar e cada um abria sua própria cota de custo.
 */
describe("POST /api/public/visitor-chat/start — limite de taxa", () => {
  it("acima de 20 pedidos na mesma janela, o servidor recusa com 429", async () => {
    const status: number[] = [];
    for (let i = 0; i < 21; i++) {
      status.push((await iniciar()).status);
    }

    expect(status.filter(s => s === 201).length).toBe(20);
    expect(status[20]).toBe(429);
  });

  // A prova de que é o MESMO limitador, não um equivalente: as duas rotas
  // dividem o balde. Sem isso, `/start` teria seus próprios 20 e `/messages`
  // outros 20 — 40 no total pela mesma origem, o dobro da cota pretendida.
  it("compartilha o balde com /messages — a mesma origem gasta a MESMA cota nas duas rotas", async () => {
    for (let i = 0; i < 15; i++) await iniciar();

    const status: number[] = [];
    for (let i = 0; i < 10; i++) status.push((await enviar(`mensagem ${i}`)).status);

    // So sobram 5 no balde compartilhado (20 - 15) antes de recusar.
    expect(status.filter(s => s === 201).length).toBe(5);
    expect(status.slice(5).every(s => s === 429)).toBe(true);
  });

  it("mensagem comum continua funcionando normalmente", async () => {
    const res = await iniciar();

    expect(res.status).toBe(201);
    const corpo = await res.json();
    expect(corpo.token).toBe("tok-Visitante");
    expect(storageMock.createVisitorChat).toHaveBeenCalledWith("Visitante", "visitante@example.com", null);
  });

  it("recusa sem nome ou sem email, sem gravar nada", async () => {
    const res = await iniciar({ name: "" });

    expect(res.status).toBe(400);
    expect(storageMock.createVisitorChat).not.toHaveBeenCalled();
  });
});
