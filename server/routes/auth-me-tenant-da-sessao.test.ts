import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * `GET /api/auth/me` — de qual tenant e esta requisicao.
 *
 * O /me e a unica coisa que o client tem para saber onde esta. Ele resolvia o
 * provedor por `user.providerId`, a COLUNA da tabela `users`, e isso responde
 * certo por acidente: para todo mundo a coluna e a sessao coincidem, porque o
 * login grava uma a partir da outra. Os dois divergem exatamente uma vez — no
 * acesso de suporte, em que o superadmin tem a coluna nula e a sessao apontando
 * para o provedor que abriu a janela — e ali o /me devolvia `provider: null`,
 * deixando as telas do provedor sem contexto e a navegacao sem como saber que
 * havia um tenant.
 *
 * O que se prova aqui:
 *   · personificando, o /me devolve o provedor DA SESSAO e `personificando: true`;
 *   · fora da personificacao NADA muda — nem para o admin do provedor, nem para
 *     o superadmin na propria conta. Esta metade e o ponto: a correcao nao pode
 *     mexer na resposta de quem nunca entrou em conta de ninguem;
 *   · saindo, o /me volta a dizer que nao ha tenant. A sessao e o que manda, e
 *     ela e desfeita pela mesma rota que a criou.
 *
 * O harness e o de `suporte-acesso.test.ts`: os middlewares de `../auth` entram
 * como os reais (a trava inclusive) e o storage e um duble com semantica de
 * verdade, porque metade do que se afirma depende de uma janela existir e valer.
 */

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-vitest";
});

vi.mock("express-session", () => ({ default: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("connect-pg-simple", () => ({ default: () => class MockPgStore {} }));
vi.mock("../db", () => ({ pool: {}, db: {} }));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const relogio = { agora: new Date("2031-05-10T14:00:00.000Z") };
const DUAS_HORAS = 2 * 60 * 60 * 1000;

interface Janela {
  id: number;
  providerId: number;
  expiraEm: Date;
  revogadoEm: Date | null;
}

let janelas: Janela[] = [];
let proximoId = 1;

const storageMock = vi.hoisted(() => ({
  getProvider: vi.fn(async (_id: number): Promise<any> => null),
  getUser: vi.fn(async (_id: number): Promise<any> => undefined),
  acessoDeSuporteValido: vi.fn(async (_p: number): Promise<any> => undefined),
  registrarUsoDoAcesso: vi.fn(async (_id: number, _u: number): Promise<void> => undefined),
  historicoDeAcessos: vi.fn(async (_p: number, _l?: number): Promise<any[]> => []),
  liberarAcessoDeSuporte: vi.fn(async (_p: number, _u: number): Promise<any> => null),
  revogarAcessoDeSuporte: vi.fn(async (_p: number, _u: number): Promise<number> => 0),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

// Marca e e-mail nao tem nada a ver com o que este arquivo afirma, e cada um
// arrasta rede ou segredo de ambiente. Os middlewares de `../auth` NAO sao
// mockados: e neles que a resposta certa mora.
vi.mock("../services/email", () => ({
  sendVerificationEmail: vi.fn(async () => undefined),
  sendWelcomeEmail: vi.fn(async () => undefined),
  sendPasswordChangedEmail: vi.fn(async () => undefined),
}));
vi.mock("../services/marca.service", () => ({
  resolverMarcaPorId: vi.fn(async () => ({ marcaId: null, nomeProduto: "Consulta ISP" }) as any),
  urlDeEntrada: vi.fn(() => "https://exemplo.test"),
  hostPertenceAoProvider: vi.fn(async () => true),
  MARCA_PLATAFORMA: { marcaId: null, nomeProduto: "Consulta ISP" } as any,
  MENSAGEM_PROVEDOR_SUSPENSO: "suspenso",
}));
vi.mock("../password", () => ({
  hashPassword: vi.fn(async (s: string) => `hash:${s}`),
  verifyPassword: vi.fn(async () => true),
}));

import { esquecerStatusDeProvedor, esquecerRegistrosDeUso } from "../auth";
import { registerSuporteAcessoRoutes } from "./suporte-acesso.routes";
import { registerAuthRoutes } from "./auth.routes";

let server: Server;
let base: string;
let sessao: Record<string, any>;

const PROVEDOR_ID = 42;
const ADMIN_DO_PROVEDOR = { userId: 5, role: "admin", providerId: PROVEDOR_ID };
const SUPERADMIN = { userId: 1, role: "superadmin", providerId: 0 };

const USUARIOS: Record<number, any> = {
  1: {
    id: 1, name: "Rita do Suporte", email: "rita@plataforma.test",
    role: "superadmin", providerId: null, mustChangePassword: false,
  },
  5: {
    id: 5, name: "Ana Administradora", email: "ana@nslink.test",
    role: "admin", providerId: PROVEDOR_ID, mustChangePassword: false,
  },
};

function sessaoDe(inicial: Record<string, any>): Record<string, any> {
  return { ...inicial, save: (cb: (err?: unknown) => void) => cb() };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessao;
    next();
  });
  // A ordem da producao: o router do acesso de suporte primeiro, porque e ele
  // que carrega a trava — e a trava tambem alcanca o /me.
  app.use(registerSuporteAcessoRoutes());
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
  janelas = [];
  proximoId = 1;
  relogio.agora = new Date("2031-05-10T14:00:00.000Z");
  esquecerStatusDeProvedor();
  esquecerRegistrosDeUso();

  storageMock.getProvider.mockImplementation(async (id: number) => ({
    id, name: "Provedor 42 Telecom LTDA", tradeName: "NsLink", status: "active", marcaId: null,
  }));
  storageMock.getUser.mockImplementation(async (id: number) => USUARIOS[id]);
  storageMock.acessoDeSuporteValido.mockImplementation(async (providerId: number) =>
    janelas.find(j => j.providerId === providerId && !j.revogadoEm && j.expiraEm > relogio.agora),
  );

  sessao = sessaoDe(ADMIN_DO_PROVEDOR);
});

function liberar(providerId: number, duracaoMs = DUAS_HORAS): Janela {
  const nova: Janela = {
    id: proximoId++,
    providerId,
    expiraEm: new Date(relogio.agora.getTime() + duracaoMs),
    revogadoEm: null,
  };
  janelas.push(nova);
  return nova;
}

const me = () => fetch(`${base}/api/auth/me`);
const entrar = (id: number) => fetch(`${base}/api/admin/acesso-suporte/${id}/entrar`, { method: "POST" });
const sair = () => fetch(`${base}/api/admin/acesso-suporte/sair`, { method: "POST" });

// ── Fora da personificacao: nada muda ────────────────────────────────────────

describe("sessao normal — a resposta continua a mesma", () => {
  it("admin do provedor recebe o proprio provedor e personificando: false", async () => {
    const corpo = await (await me()).json();

    expect(corpo.user).toEqual({ id: 5, email: "ana@nslink.test", name: "Ana Administradora", role: "admin" });
    expect(corpo.provider?.id).toBe(PROVEDOR_ID);
    expect(corpo.personificando).toBe(false);
    expect(typeof corpo.partnerCode).toBe("string");
  });

  it("superadmin na propria conta nao tem provedor nenhum", async () => {
    sessao = sessaoDe(SUPERADMIN);

    const corpo = await (await me()).json();

    expect(corpo.user.role).toBe("superadmin");
    expect(corpo.provider).toBeNull();
    expect(corpo.partnerCode).toBeNull();
    expect(corpo.personificando).toBe(false);
    // `providerId: 0` nao e provedor: o /me nao pode ir ao banco perguntar pelo
    // provedor zero.
    expect(storageMock.getProvider).not.toHaveBeenCalled();
  });

  it("sessao antiga, sem providerId gravado, ainda acha o provedor pela coluna", async () => {
    // Sessoes criadas antes de `providerId` existir na sessao: sem o fallback, o
    // admin perderia o provedor de repente, sem ter feito nada.
    sessao = sessaoDe({ userId: 5, role: "admin" });

    const corpo = await (await me()).json();

    expect(corpo.provider?.id).toBe(PROVEDOR_ID);
    expect(corpo.personificando).toBe(false);
  });

  it("sem sessao, 401", async () => {
    sessao = sessaoDe({});

    expect((await me()).status).toBe(401);
  });
});

// ── Personificando: o tenant e o da sessao ───────────────────────────────────

describe("acesso de suporte — o provedor vem da sessao", () => {
  beforeEach(async () => {
    liberar(PROVEDOR_ID);
    sessao = sessaoDe(SUPERADMIN);
    await entrar(PROVEDOR_ID);
  });

  it("devolve o provedor personificado, e nao o nulo da coluna do usuario", async () => {
    // A premissa que quebrava tudo: a coluna do superadmin e nula.
    expect(USUARIOS[1].providerId).toBeNull();
    expect(sessao.providerId).toBe(PROVEDOR_ID);

    const corpo = await (await me()).json();

    expect(corpo.provider?.id).toBe(PROVEDOR_ID);
    expect(corpo.provider?.tradeName).toBe("NsLink");
    expect(storageMock.getProvider).toHaveBeenCalledWith(PROVEDOR_ID);
  });

  it("a identidade continua sendo a do superadmin — a personificacao nao troca de pessoa", async () => {
    const corpo = await (await me()).json();

    expect(corpo.user).toEqual({
      id: 1, email: "rita@plataforma.test", name: "Rita do Suporte", role: "superadmin",
    });
    expect(corpo.personificando).toBe(true);
  });

  it("saindo, o /me volta a dizer que nao ha tenant", async () => {
    expect((await (await me()).json()).personificando).toBe(true);

    await sair();
    const corpo = await (await me()).json();

    expect(corpo.provider).toBeNull();
    expect(corpo.personificando).toBe(false);
  });

  it("com a janela revogada a trava recusa o /me antes de ele contar qualquer coisa", async () => {
    janelas[0].revogadoEm = new Date(relogio.agora);

    const res = await me();

    // A trava roda em toda requisicao de API, o /me inclusive: nao existe
    // resposta "voce esta no provedor 42" depois que a liberacao caiu.
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("SUPPORT_ACCESS_ENDED");
  });
});
