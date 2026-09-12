import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * A porta da demonstracao publica. Duas coisas decidem se ela funciona de
 * verdade em producao, e as duas sao testadas aqui contra o CODIGO REAL (nao
 * contra um espiao que so devolve o que o teste mandou):
 *
 *   1. Fora de DEMO_MODE, o proprio HANDLER devolve 404 — nao a ausencia de
 *      rota. `emModoDemo()` roda sem mock: o que muda entre os testes e
 *      `process.env.DEMO_MODE`, a mesma variavel que decide em producao.
 *   2. Em DEMO_MODE, a sessao sai com os CINCO campos que `requireAuth` exige
 *      (userId, providerId, role, hostLogin, subdomain) — `normalizarHost`
 *      tambem roda sem mock, para provar que o host de verdade (porta e caixa
 *      incluidos) vira o valor gravado.
 *
 * `criarSandbox` e mockado: a criacao real (~5 mil linhas por sandbox) e
 * responsabilidade de `sandbox.service.test.ts`; aqui o que importa e o que a
 * ROTA faz com o retorno dela.
 *
 * O app Express (e portanto o rate limiter, que guarda estado num Map
 * fechado dentro de `createRateLimiter`) e recriado a CADA teste — sem isso,
 * os ~10 pedidos a `/demo` espalhados pelos testes anteriores ao de limite
 * dividiriam o mesmo balde e o teste de limite ficaria refem da ordem de
 * execucao dos outros.
 */

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-vitest";
});

const sandboxMock = vi.hoisted(() => ({
  criarSandbox: vi.fn(async () => ({
    providerId: 42,
    userId: 7,
    subdomain: "sandbox-abc123",
    expiraEm: new Date("2026-09-13T00:00:00Z"),
  })),
}));
vi.mock("../demo/sandbox.service", () => sandboxMock);

import { registerDemoRoutes } from "./demo.routes";

const HOST_DA_DEMO = "demo.consultaisp.com.br";
const DEMO_MODE_ORIGINAL = process.env.DEMO_MODE;

let server: Server;
let base: string;
let sessao: Record<string, unknown>;
let host: string;

async function subirServidor(): Promise<void> {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = sessao;
    // `hostname` e getter de prototipo no Express — a propriedade propria o
    // encobre, do mesmo jeito que `X-Forwarded-Host` faz com trust proxy ligado.
    Object.defineProperty(req, "hostname", { value: host, configurable: true });
    next();
  });
  app.use(registerDemoRoutes());
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
}

beforeEach(async () => {
  vi.clearAllMocks();
  sessao = { save: (cb: (e?: unknown) => void) => cb() };
  host = HOST_DA_DEMO;
  process.env.DEMO_MODE = "true";
  await subirServidor();
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (DEMO_MODE_ORIGINAL === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = DEMO_MODE_ORIGINAL;
});

const pedirDemo = () => fetch(`${base}/demo`, { redirect: "manual" });

describe("GET /demo fora de DEMO_MODE", () => {
  it("responde 404 explicito do handler, mesmo sem qualquer sessao", async () => {
    delete process.env.DEMO_MODE;
    sessao = {};

    const res = await pedirDemo();

    expect(res.status).toBe(404);
    // .json() aqui so funciona porque o corpo E JSON: prova que quem respondeu
    // foi o handler (res.status(404).json(...)), nao a pagina padrao do Express
    // para rota inexistente (que seria HTML, e faria .json() estourar).
    expect(await res.json()).toEqual({ message: "Nao encontrado" });
    expect(sandboxMock.criarSandbox).not.toHaveBeenCalled();
  });

  it("qualquer valor diferente da string exata 'true' tambem e 404", async () => {
    process.env.DEMO_MODE = "1";

    expect((await pedirDemo()).status).toBe(404);
    expect(sandboxMock.criarSandbox).not.toHaveBeenCalled();
  });
});

describe("GET /demo em DEMO_MODE", () => {
  it("cria o sandbox, grava os cinco campos de sessao e redireciona para /", async () => {
    const res = await pedirDemo();

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);
    expect(sessao).toMatchObject({
      userId: 7,
      providerId: 42,
      role: "admin",
      hostLogin: HOST_DA_DEMO,
      subdomain: "sandbox-abc123",
    });
  });

  it("hostLogin sai de normalizarHost de verdade — porta e caixa somem", async () => {
    host = "DEMO.consultaisp.com.br:8443";

    await pedirDemo();

    expect(sessao.hostLogin).toBe(HOST_DA_DEMO);
  });

  it("subdomain e o do SANDBOX recem-criado, nao um extraido do host", async () => {
    // Um host que nem tem subdominio de provedor extraivel — so para deixar
    // claro que o valor gravado nao pode ter vindo de req.hostname.
    host = HOST_DA_DEMO;

    await pedirDemo();

    expect(sessao.subdomain).toBe("sandbox-abc123");
  });

  it("segundo acesso com sessao viva reaproveita o mesmo sandbox, sem criar outro", async () => {
    const primeiro = await pedirDemo();
    expect(primeiro.status).toBe(302);
    expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);

    // `sessao` e o MESMO objeto que a rota acabou de mutar — simula o cookie
    // voltando numa segunda visita.
    const segundo = await pedirDemo();

    expect(segundo.status).toBe(302);
    expect(segundo.headers.get("location")).toBe("/");
    expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);
  });

  it("500 com mensagem segura quando a criacao do sandbox falha, sem gravar sessao", async () => {
    sandboxMock.criarSandbox.mockRejectedValueOnce(new Error("boom"));

    const res = await pedirDemo();

    expect(res.status).toBe(500);
    expect(sessao.userId).toBeUndefined();
    expect(sessao.providerId).toBeUndefined();
  });
});

describe("GET /demo — limite", () => {
  it("5 pedidos passam e o 6o e recusado com 429", async () => {
    const status: number[] = [];
    for (let i = 0; i < 6; i++) {
      // Sessao nova a cada volta: sem isto, a partir da 2a chamada
      // `chaveDoLimite` passaria a chavear por `p:42` (a sessao ja teria
      // providerId da chamada anterior) em vez de por IP, e as 6 chamadas
      // nunca cairiam no mesmo balde.
      sessao = { save: (cb: (e?: unknown) => void) => cb() };
      status.push((await pedirDemo()).status);
    }

    expect(status.slice(0, 5)).toEqual([302, 302, 302, 302, 302]);
    expect(status[5]).toBe(429);
  });

  it("o 429 diz quanto esperar, em vez de so recusar", async () => {
    for (let i = 0; i < 5; i++) {
      sessao = { save: (cb: (e?: unknown) => void) => cb() };
      await pedirDemo();
    }
    sessao = { save: (cb: (e?: unknown) => void) => cb() };

    const res = await pedirDemo();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect((await res.json()).message).toMatch(/Tente novamente em \d+ minuto/);
  });
});
