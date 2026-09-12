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
