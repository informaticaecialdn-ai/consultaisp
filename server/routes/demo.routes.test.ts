import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * A porta da demonstracao publica.
 *
 * O que roda contra CODIGO REAL, sem mock: `emModoDemo()` (o que muda entre
 * testes e `process.env.DEMO_MODE`, a mesma variavel que decide em produção)
 * e `normalizarHost()` (prova que o host de verdade — porta e caixa
 * incluidos — vira o valor gravado). `criarSandbox` e `storage.getProvider`
 * SAO espioes: a criacao real (~5 mil linhas por sandbox) e responsabilidade
 * de `sandbox.service.test.ts`, e aqui o que importa e o que a ROTA faz com
 * o retorno deles.
 *
 * `req.session` É UM OBJETO STUB (`{ save, cookie, ... }` montado abaixo),
 * NAO a sessao real do Express — nao ha `sessionMiddleware` nem
 * `connect-pg-simple` neste arquivo. Isso e legitimo para testar a rota
 * isolada (o contrato é "o handler grava estes campos neste objeto"), mas
 * não cobre a integração com o store de sessão de verdade — só a rota.
 *
 * O app Express (e portanto o rate limiter, que guarda estado num Map
 * fechado dentro de `createRateLimiter`) e recriado a CADA teste — sem isso,
 * os pedidos a `/demo` espalhados pelos testes anteriores ao de limite
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
    // Relativo a "agora": o teste de TTL do cookie (abaixo) compara isto
    // contra `Date.now()` no momento da asserção, e uma data absoluta fixa
    // ficaria refem de quando a suíte roda de verdade.
    expiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000),
  })),
}));
vi.mock("../demo/sandbox.service", () => sandboxMock);

const storageMock = vi.hoisted(() => ({
  // Por padrao, o sandbox "ainda existe" — a maioria dos testes quer o
  // caminho feliz de reaproveitamento; quem quer o contrario usa
  // `mockResolvedValueOnce(undefined)`.
  getProvider: vi.fn(async () => ({ id: 42, subdomain: "sandbox-abc123" })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

import { registerDemoRoutes } from "./demo.routes";

const HOST_DA_DEMO = "demo.consultaisp.com.br";
const DEMO_MODE_ORIGINAL = process.env.DEMO_MODE;

/** Espelha VIDA_DO_SANDBOX_MS (server/demo/sandbox.service.ts) — 24h. */
const VIDA_DO_SANDBOX_MS = 24 * 60 * 60 * 1000;
/**
 * Espelha SESSAO_PADRAO_MS (server/auth.ts:12) — 48h, o padrao global que a
 * sessao herdaria se esta rota NUNCA tocasse `cookie.maxAge`. Nao importado
 * de la: importar `../auth` de verdade exige mockar `express-session`,
 * `connect-pg-simple` e `../db` so por uma constante que esta rota nem
 * referencia — o valor e estavel e documentado, e o comentario acima aponta
 * de volta pra fonte.
 */
const SESSAO_PADRAO_MS_DA_PLATAFORMA = 2 * 24 * 60 * 60 * 1000;

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
    // Primeira visita: nao ha sessao pra reaproveitar, entao a existencia de
    // um sandbox nem chega a ser conferida.
    expect(storageMock.getProvider).not.toHaveBeenCalled();
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
    // voltando numa segunda visita. `storage.getProvider` (padrao do mock)
    // confirma que o provedor 42 ainda existe.
    const segundo = await pedirDemo();

    expect(segundo.status).toBe(302);
    expect(segundo.headers.get("location")).toBe("/");
    expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);
    expect(storageMock.getProvider).toHaveBeenCalledWith(42);
  });

  it("sessao viva mas sandbox ja apagado pela limpeza: cria um novo, nao reaproveita dado morto", async () => {
    const primeiro = await pedirDemo();
    expect(primeiro.status).toBe(302);
    expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);

    // A limpeza horaria (Tarefa 7) ja apagou o provedor: o cookie ainda
    // "vale" no navegador, mas o registro no banco sumiu.
    storageMock.getProvider.mockResolvedValueOnce(undefined);

    const segundo = await pedirDemo();

    expect(segundo.status).toBe(302);
    expect(segundo.headers.get("location")).toBe("/");
    // NAO reaproveitou a sessao orfa — criou um sandbox NOVO em vez de
    // redirecionar para "/" apontando para dado que nao existe mais.
    expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(2);
  });

  it("500 com mensagem segura quando a criacao do sandbox falha, sem gravar sessao", async () => {
    sandboxMock.criarSandbox.mockRejectedValueOnce(new Error("boom"));

    const res = await pedirDemo();

    expect(res.status).toBe(500);
    expect(sessao.userId).toBeUndefined();
    expect(sessao.providerId).toBeUndefined();
    // Primeira visita: a verificacao de existencia nem entra em cena.
    expect(storageMock.getProvider).not.toHaveBeenCalled();
  });

  it("500 quando a verificacao de existencia falha — nao tenta criar outro por cima", async () => {
    sessao = { save: (cb: (e?: unknown) => void) => cb(), userId: 7, providerId: 42 };
    storageMock.getProvider.mockRejectedValueOnce(new Error("banco fora do ar"));

    const res = await pedirDemo();

    expect(res.status).toBe(500);
    expect(sandboxMock.criarSandbox).not.toHaveBeenCalled();
  });
});

describe("GET /demo — o cookie nao sobrevive ao sandbox", () => {
  it("maxAge fica preso a expiraEm do sandbox, nao ao padrao global de 48h", async () => {
    // Simula o que a sessao real entregaria: `cookie.maxAge` ja presente, no
    // padrao GLOBAL da plataforma. Se a rota nunca tocasse este campo, o
    // valor permaneceria EXATAMENTE este — e essa e a regressao que o teste
    // existe para pegar (o cookie "sobrevivendo" ao sandbox).
    sessao = { save: (cb: (e?: unknown) => void) => cb(), cookie: { maxAge: SESSAO_PADRAO_MS_DA_PLATAFORMA } };

    await pedirDemo();

    const maxAge = (sessao.cookie as { maxAge: number }).maxAge;
    expect(maxAge).not.toBe(SESSAO_PADRAO_MS_DA_PLATAFORMA);
    expect(maxAge).toBeLessThanOrEqual(VIDA_DO_SANDBOX_MS);
    // Folga generosa (1 min) para o tempo de execucao do teste — a chamada
    // mockada e sincrona o bastante para sobrar bem menos que isso.
    expect(maxAge).toBeGreaterThan(VIDA_DO_SANDBOX_MS - 60_000);
  });

  it("a segunda visita (sandbox ainda vivo) nao reescreve o cookie", async () => {
    sessao = { save: (cb: (e?: unknown) => void) => cb(), cookie: { maxAge: SESSAO_PADRAO_MS_DA_PLATAFORMA } };
    await pedirDemo();
    const maxAgeAposCriar = (sessao.cookie as { maxAge: number }).maxAge;

    await pedirDemo(); // segunda visita: sessao viva, sandbox confirmado no banco

    expect((sessao.cookie as { maxAge: number }).maxAge).toBe(maxAgeAposCriar);
  });
});

describe("GET /demo — limite", () => {
  it("2 pedidos passam e o 3o e recusado com 429", async () => {
    const status: number[] = [];
    for (let i = 0; i < 3; i++) {
      // Sessao nova a cada volta: sem isto, a partir da 2a chamada
      // `chaveDoLimite` passaria a chavear por `p:42` (a sessao ja teria
      // providerId da chamada anterior) em vez de por IP, e as 3 chamadas
      // nunca cairiam no mesmo balde.
      sessao = { save: (cb: (e?: unknown) => void) => cb() };
      status.push((await pedirDemo()).status);
    }

    expect(status.slice(0, 2)).toEqual([302, 302]);
    expect(status[2]).toBe(429);
  });

  it("o 429 diz quanto esperar, em vez de so recusar", async () => {
    for (let i = 0; i < 2; i++) {
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
