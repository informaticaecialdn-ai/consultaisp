import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Foco: a prova de host no LOGIN.
 *
 * O storage real abre conexao com o Postgres ao ser importado, e a prova de
 * host consulta a tabela de marcas — os dois viram espioes aqui, porque o que
 * se quer provar e o desvio de fluxo, nao a consulta.
 */
vi.hoisted(() => {
  // `auth.routes.ts` importa a mensagem de provedor suspenso de `../auth`, que
  // exige SESSION_SECRET no topo do modulo.
  process.env.SESSION_SECRET = "segredo-de-teste";
});

const storageMock = vi.hoisted(() => ({
  getUserByEmail: vi.fn(async (): Promise<any> => null),
  getProvider: vi.fn(async (): Promise<any> => null),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../db", () => ({ db: {}, pool: {} }));

const marcaMock = vi.hoisted(() => ({
  hostPertenceAoProvider: vi.fn(async () => true),
  resolverMarcaPorHost: vi.fn(async () => ({ marcaId: null, origem: "plataforma" })),
  resolverMarcaPorId: vi.fn(async () => ({ marcaId: null, origem: "plataforma" })),
  urlDeEntrada: vi.fn(() => "https://nslink.consultaisp.com.br"),
}));
vi.mock("../services/marca.service", () => marcaMock);

// O limitador guarda estado entre chamadas e derrubaria o sexto login do arquivo
// com 429; o que se mede aqui nao e ele.
vi.mock("../middleware/rate-limiter.middleware", () => ({
  createRateLimiter: () => (_r: any, _s: any, n: any) => n(),
}));

vi.mock("../password", () => ({
  hashPassword: vi.fn(async (s: string) => `hash:${s}`),
  verifyPassword: vi.fn(async () => true),
}));

vi.mock("../services/email", () => ({
  sendVerificationEmail: vi.fn(async () => undefined),
  sendPasswordResetEmail: vi.fn(async () => undefined),
}));

import { registerAuthRoutes } from "./auth.routes";
import { MENSAGEM_PROVEDOR_SUSPENSO } from "../auth";

let server: Server;
let base: string;
let sessao: Record<string, any>;

const USUARIO_BASE = {
  id: 42,
  email: "dono@nslink.com.br",
  name: "Dono",
  password: "hash",
  role: "admin",
  providerId: 7,
  emailVerified: true,
  mustChangePassword: false,
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    sessao.save = (cb: (e?: unknown) => void) => cb();
    (req as any).session = sessao;
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

beforeEach(() => {
  vi.clearAllMocks();
  marcaMock.hostPertenceAoProvider.mockResolvedValue(true);
  sessao = {};
});

const login = () =>
  fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "dono@nslink.com.br", password: "senha-boa-123" }),
  });

describe("POST /api/auth/login — prova de host", () => {
  it("provedor entra quando o host prova que e dele", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...USUARIO_BASE });
    storageMock.getProvider.mockResolvedValue({ id: 7, subdomain: "nslink", marcaId: null, status: "active" });

    const res = await login();

    expect(res.status).toBe(200);
    expect(marcaMock.hostPertenceAoProvider).toHaveBeenCalled();
    expect(sessao.providerId).toBe(7);
  });

  it("401 generico quando o host nao prova nada", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...USUARIO_BASE });
    storageMock.getProvider.mockResolvedValue({ id: 7, subdomain: "nslink", marcaId: null, status: "active" });
    marcaMock.hostPertenceAoProvider.mockResolvedValue(false);

    const res = await login();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "Email ou senha incorretos" });
    expect(sessao.userId).toBeUndefined();
  });

  /**
   * O buraco fail-OPEN: a condicao era `role !== 'superadmin' && user.providerId`,
   * entao um usuario sem provedor pulava a prova inteira e entrava por qualquer
   * host — e a sessao dele viajava entre hosts depois.
   */
  it("401 para usuario nao-superadmin SEM provedor, sem nem consultar a marca", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...USUARIO_BASE, providerId: null });

    const res = await login();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "Email ou senha incorretos" });
    expect(marcaMock.hostPertenceAoProvider).not.toHaveBeenCalled();
    expect(sessao.userId).toBeUndefined();
  });

  it("401 quando o providerId aponta para provedor que nao existe mais", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...USUARIO_BASE });
    storageMock.getProvider.mockResolvedValue(null);

    const res = await login();

    expect(res.status).toBe(401);
    expect(marcaMock.hostPertenceAoProvider).not.toHaveBeenCalled();
  });

  it("superadmin sem provedor continua entrando por qualquer host", async () => {
    storageMock.getUserByEmail.mockResolvedValue({
      ...USUARIO_BASE,
      role: "superadmin",
      providerId: null,
    });

    const res = await login();

    expect(res.status).toBe(200);
    expect(marcaMock.hostPertenceAoProvider).not.toHaveBeenCalled();
    expect(sessao.role).toBe("superadmin");
    expect(sessao.providerId).toBe(0);
  });
});

/**
 * A aba Provedores do superadmin promete, ao suspender, que "o acesso do
 * provedor e dos usuarios dele fica bloqueado ate alguem reativar". Ninguem lia
 * `providers.status`: o provedor era carregado so para a prova de host. Suspenso
 * por inadimplencia as 10h, o operador logava as 10h02 e gastava credito.
 */
describe("POST /api/auth/login — provedor suspenso", () => {
  it("403 com mensagem propria quando o provedor esta suspenso", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...USUARIO_BASE });
    storageMock.getProvider.mockResolvedValue({ id: 7, subdomain: "nslink", marcaId: null, status: "suspended" });

    const res = await login();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      message: MENSAGEM_PROVEDOR_SUSPENSO,
      code: "PROVIDER_SUSPENDED",
    });
    expect(sessao.userId).toBeUndefined();
  });

  it("403 tambem para provedor cancelado", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...USUARIO_BASE });
    storageMock.getProvider.mockResolvedValue({ id: 7, subdomain: "nslink", marcaId: null, status: "cancelled" });

    const res = await login();

    expect(res.status).toBe(403);
    expect(sessao.userId).toBeUndefined();
  });

  /**
   * A ordem importa: quem erra o host continua ouvindo a mensagem generica. Sem
   * isso, "Acesso suspenso" viraria um oraculo que confirma a existencia de uma
   * conta para quem nem esta no endereco certo.
   */
  it("host errado ainda responde o 401 generico, nao 'acesso suspenso'", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...USUARIO_BASE });
    storageMock.getProvider.mockResolvedValue({ id: 7, subdomain: "nslink", marcaId: null, status: "suspended" });
    marcaMock.hostPertenceAoProvider.mockResolvedValue(false);

    const res = await login();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "Email ou senha incorretos" });
  });

  it("reativar devolve o acesso na tentativa seguinte", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...USUARIO_BASE });
    storageMock.getProvider.mockResolvedValue({ id: 7, subdomain: "nslink", marcaId: null, status: "suspended" });
    expect((await login()).status).toBe(403);

    storageMock.getProvider.mockResolvedValue({ id: 7, subdomain: "nslink", marcaId: null, status: "active" });

    const res = await login();

    expect(res.status).toBe(200);
    expect(sessao.providerId).toBe(7);
  });

  it("superadmin nunca e barrado por status de tenant", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...USUARIO_BASE, role: "superadmin", providerId: null });
    storageMock.getProvider.mockResolvedValue({ id: 7, status: "suspended" });

    const res = await login();

    expect(res.status).toBe(200);
    expect(sessao.role).toBe("superadmin");
  });
});
