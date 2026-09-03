/**
 * O fluxo de senha era o unico sem limitador.
 *
 * Login (5/15min), cadastro (3/60min) e reenvio de verificacao (3/15min) ja
 * tinham. `forgot-password` e `reset-password`, nao — e sao justamente os dois
 * que qualquer um alcanca sem sessao:
 *
 * - `forgot-password` DESPEJA E-MAIL num endereco que quem chama digitou, e
 *   responde igual para conta que existe e para conta que nao existe. Sem
 *   limite e uma maquina de mandar mensagem assinada com a marca de um provedor
 *   para a caixa de terceiros.
 * - `reset-password` ADIVINHA um token de 32 bytes durante a hora inteira de
 *   validade dele, de graca.
 *
 * O limitador e por processo e guarda estado entre chamadas, entao aqui ele NAO
 * e trocado por espiao — e o objeto do teste. Por isso o arquivo e separado dos
 * outros de auth, que o desligam para nao levar 429 no meio da suite.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "segredo-de-teste";
});

const storageMock = vi.hoisted(() => ({
  // Conta inexistente: o caminho mais barato, e o que um abusador usaria.
  getUserByEmail: vi.fn(async (): Promise<any> => undefined),
  getProvider: vi.fn(async (): Promise<any> => undefined),
  getUser: vi.fn(async (): Promise<any> => undefined),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../services/email", () => ({
  sendVerificationEmail: vi.fn(async () => undefined),
  sendPasswordResetEmail: vi.fn(async () => undefined),
  sendWelcomeEmail: vi.fn(async () => undefined),
  sendPasswordChangedEmail: vi.fn(async () => undefined),
}));

vi.mock("../services/marca.service", () => ({
  hostPertenceAoProvider: vi.fn(async () => true),
  resolverMarcaPorHost: vi.fn(async () => ({ marcaId: null, origem: "plataforma" })),
  resolverMarcaPorId: vi.fn(async () => ({ marcaId: null, origem: "plataforma" })),
  urlDeEntrada: vi.fn(() => "https://nslink.consultaisp.com.br"),
}));

vi.mock("../password", () => ({
  hashPassword: vi.fn(async (s: string) => `hash:${s}`),
  verifyPassword: vi.fn(async () => true),
}));

// Token que nunca casa: o pedido chega ao handler e e recusado la. O limitador
// tem de contar essa tentativa — se contasse so acerto, nao limitaria nada.
vi.mock("../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
  pool: {},
}));

import { registerAuthRoutes } from "./auth.routes";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { save: (cb: (e?: unknown) => void) => cb() };
    next();
  });
  app.use(registerAuthRoutes());
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

const pedir = (rota: string, corpo: unknown) =>
  fetch(`${base}${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

describe("POST /api/auth/forgot-password — limite", () => {
  it("3 pedidos passam e o 4o e recusado com 429", async () => {
    const status: number[] = [];
    for (let i = 0; i < 4; i++) {
      status.push((await pedir("/api/auth/forgot-password", { email: `alvo${i}@exemplo.com` })).status);
    }

    expect(status.slice(0, 3)).toEqual([200, 200, 200]);
    expect(status[3]).toBe(429);
  });

  it("o 429 diz quanto esperar, em vez de so recusar", async () => {
    const res = await pedir("/api/auth/forgot-password", { email: "alvo@exemplo.com" });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect((await res.json()).message).toMatch(/Tente novamente em \d+ minuto/);
  });
});

describe("POST /api/auth/reset-password — limite", () => {
  /**
   * Cota do login (5/15min): sobra folga para quem erra a confirmacao da senha
   * duas ou tres vezes, e nao serve para varrer o espaco de um token.
   *
   * Roda depois do bloco acima de proposito — os dois limitadores tem baldes
   * proprios, entao o `forgot-password` ja estourado nao encosta neste.
   */
  it("5 tentativas passam pelo limitador e a 6a e recusada com 429", async () => {
    const status: number[] = [];
    for (let i = 0; i < 6; i++) {
      status.push((await pedir("/api/auth/reset-password", {
        token: `chute-${i}`,
        newPassword: "senha-nova-123",
      })).status);
    }

    // 400 = o handler recusou o token. O que importa e que chegaram la.
    expect(status.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(status[5]).toBe(429);
  });
});
