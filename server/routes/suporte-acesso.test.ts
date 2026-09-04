import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";

/**
 * Acesso de suporte: o provedor abre uma janela de 2h e um superadmin entra na
 * conta dele.
 *
 * O que se prova aqui nao e "a rota responde 200". E que as barreiras que
 * separam um estranho do dado pessoal dos titulares de um provedor continuam de
 * pe quando alguem mexe no codigo:
 *
 *   · so o ADMIN do provedor abre a janela — nem o operador, nem o suporte;
 *   · nao se entra sem janela valida, e "valida" exclui expirada e revogada;
 *   · entrando, a sessao ganha o `providerId` do provedor mas CONTINUA sendo a
 *     de um superadmin — e o que permite distinguir suporte de admin no log e
 *     na tela;
 *   · revogar alcanca quem JA ESTA DENTRO, na requisicao seguinte. Esta e a
 *     razao de a trava existir: a sessao dura 48h e a liberacao dura 2h.
 *
 * Os middlewares de `../auth` entram COMO OS REAIS, incluindo a trava — mockar
 * `requireAdmin` provaria apenas que a rota chama alguma coisa, e a linha mais
 * perigosa deste sistema e justamente a que `requireAdmin` NAO da: ele devolve
 * `next()` de imediato para superadmin.
 *
 * O storage e um duble com semantica de verdade (relogio proprio, filtro de
 * validade igual ao do banco) em vez de `mockResolvedValue`: metade dos casos
 * abaixo depende de o tempo passar e de uma janela ser revogada no meio.
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

/** Relogio do "banco". Longe do relogio do processo, de proposito. */
const relogio = { agora: new Date("2031-05-10T14:00:00.000Z") };
const DUAS_HORAS = 2 * 60 * 60 * 1000;

interface Janela {
  id: number;
  providerId: number;
  liberadoPor: number;
  liberadoEm: Date;
  expiraEm: Date;
  revogadoEm: Date | null;
  revogadoPor: number | null;
  usadoPor: number | null;
  primeiroUsoEm: Date | null;
  ultimoUsoEm: Date | null;
  usos: number;
}

let janelas: Janela[] = [];
let proximoId = 1;

const storageMock = vi.hoisted(() => ({
  getProvider: vi.fn(async (): Promise<any> => null),
  getUser: vi.fn(async (_id: number): Promise<any> => undefined),
  liberarAcessoDeSuporte: vi.fn(async (_p: number, _u: number): Promise<any> => null),
  revogarAcessoDeSuporte: vi.fn(async (_p: number, _u: number): Promise<number> => 0),
  acessoDeSuporteValido: vi.fn(async (_p: number): Promise<any> => undefined),
  registrarUsoDoAcesso: vi.fn(async (_id: number, _u: number): Promise<void> => undefined),
  historicoDeAcessos: vi.fn(async (_p: number, _l?: number): Promise<any[]> => []),
  // As dez acoes de administracao do provedor. Ver o bloco "escopo do suporte".
  getUserByEmail: vi.fn(async (_e: string): Promise<any> => undefined),
  createUser: vi.fn(async (dados: any): Promise<any> => ({ id: 900, ...dados })),
  getUsersByProvider: vi.fn(async (_p: number): Promise<any[]> => []),
  deleteUser: vi.fn(async (_id: number): Promise<void> => undefined),
  updateProvider: vi.fn(async (_p: number, dados: any): Promise<any> => ({ id: _p, ...dados })),
  updateProviderProfile: vi.fn(async (_p: number, dados: any): Promise<any> => ({ id: _p, ...dados })),
  regenerateWebhookToken: vi.fn(async (_p: number): Promise<string> => "token-novo"),
  createProviderPartner: vi.fn(async (dados: any): Promise<any> => ({ id: 1, ...dados })),
  updateProviderPartner: vi.fn(async (id: number, _p: number, dados: any): Promise<any> => ({ id, ...dados })),
  deleteProviderPartner: vi.fn(async (_id: number, _p: number): Promise<void> => undefined),
  createProviderDocument: vi.fn(async (dados: any): Promise<any> => ({ id: 1, fileData: "x", ...dados })),
  deleteProviderDocument: vi.fn(async (_id: number, _p: number): Promise<void> => undefined),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

/**
 * O que fica de fora do teste, e por que.
 *
 * E-mail, marca e hash de senha nao tem nada a ver com as barreiras que este
 * arquivo prova, e cada um deles arrasta a rede ou um segredo de ambiente. O que
 * NAO e mockado sao os middlewares de `../auth` — inclusive a trava — porque e
 * neles que a resposta certa mora.
 */
vi.mock("../services/email", () => ({
  sendUsuarioAdicionadoEmail: vi.fn(async () => undefined),
  sendVerificationEmail: vi.fn(async () => undefined),
  sendWelcomeEmail: vi.fn(async () => undefined),
  sendPasswordChangedEmail: vi.fn(async () => undefined),
}));
vi.mock("../services/email-destinatario", () => ({
  contextoDeEmail: vi.fn(async () => ({ marca: {} as any, urlBase: "https://exemplo.test" })),
}));
vi.mock("../services/marca.service", () => ({
  resolverMarcaPorId: vi.fn(async () => ({ marcaId: null, nomeProduto: "Consulta ISP" }) as any),
  urlDeEntrada: vi.fn(() => "https://exemplo.test"),
  hostPertenceAoProvider: vi.fn(async () => true),
  MARCA_PLATAFORMA: { marcaId: null, nomeProduto: "Consulta ISP" } as any,
}));
vi.mock("../password", () => ({
  hashPassword: vi.fn(async (s: string) => `hash:${s}`),
  verifyPassword: vi.fn(async () => true),
}));

import {
  requireAuth,
  requireProvider,
  requireSuperAdmin,
  esquecerStatusDeProvedor,
  esquecerRegistrosDeUso,
} from "../auth";
import { registerSuporteAcessoRoutes } from "./suporte-acesso.routes";
import { registerProviderRoutes } from "./provider.routes";
import { registerAuthRoutes } from "./auth.routes";

let server: Server;
let base: string;
let sessao: Record<string, any>;

const PROVEDOR_ID = 42;
const VIZINHO_ID = 77;
const ADMIN_DO_PROVEDOR = { userId: 5, role: "admin", providerId: PROVEDOR_ID };
const OPERADOR = { userId: 7, role: "user", providerId: PROVEDOR_ID };
const SUPERADMIN = { userId: 1, role: "superadmin", providerId: 0 };

/** As pessoas que a trilha cita pelo nome. Ver `nomesDosEnvolvidos`. */
const USUARIOS: Record<number, { id: number; name: string; email: string; role: string; providerId: number | null }> = {
  1: { id: 1, name: "Rita do Suporte", email: "rita@plataforma.test", role: "superadmin", providerId: null },
  5: { id: 5, name: "Ana Administradora", email: "ana@nslink.test", role: "admin", providerId: PROVEDOR_ID },
  7: { id: 7, name: "Caio Operador", email: "caio@nslink.test", role: "user", providerId: PROVEDOR_ID },
};

function sessaoDe(base: Record<string, any>): Record<string, any> {
  // `save` existe em toda sessao de express-session; as rotas dependem dele
  // para persistir a personificacao ANTES de responder.
  return { ...base, save: (cb: (err?: unknown) => void) => cb() };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessao;
    next();
  });
  // A MESMA ORDEM DA PRODUCAO (server/routes/index.ts): o router do acesso de
  // suporte vem primeiro porque e ele que carrega a trava. Montado depois, as
  // rotas de provedor serviriam dado a uma personificacao ja revogada.
  app.use(registerSuporteAcessoRoutes());
  app.use(registerAuthRoutes());
  app.use(registerProviderRoutes());

  /**
   * Uma rota de provedor qualquer, com as MESMAS barreiras das rotas reais.
   * Existe para provar as duas metades que so aparecem fora deste modulo: que o
   * suporte conectado de fato alcanca o dado do provedor, e que a trava o
   * derruba na requisicao seguinte a revogacao.
   */
  app.get("/api/teste/dados-do-provedor", requireAuth, requireProvider, (req, res) => {
    res.json({ providerId: req.session.providerId, role: req.session.role });
  });

  /**
   * Uma rota de PLATAFORMA qualquer, com a guarda real. Faz o papel de
   * `GET /api/admin/providers`, que devolve a lista inteira de provedores —
   * nome, CNPJ, contato, plano e credito de todo mundo.
   */
  app.get("/api/teste/plataforma", requireAuth, requireSuperAdmin, (_req, res) => {
    res.json({ provedores: ["NsLink", "Amplinet", "CredNet"] });
  });

  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

/** Abre uma janela como o storage real abriria: revoga a anterior e cria outra. */
function liberar(providerId: number, liberadoPor: number, duracaoMs = DUAS_HORAS): Janela {
  for (const j of janelas) {
    if (j.providerId === providerId && !j.revogadoEm && j.expiraEm > relogio.agora) {
      j.revogadoEm = new Date(relogio.agora);
      j.revogadoPor = liberadoPor;
    }
  }
  const nova: Janela = {
    id: proximoId++,
    providerId,
    liberadoPor,
    liberadoEm: new Date(relogio.agora),
    expiraEm: new Date(relogio.agora.getTime() + duracaoMs),
    revogadoEm: null,
    revogadoPor: null,
    usadoPor: null,
    primeiroUsoEm: null,
    ultimoUsoEm: null,
    usos: 0,
  };
  janelas.push(nova);
  return nova;
}

beforeEach(() => {
  vi.clearAllMocks();
  janelas = [];
  proximoId = 1;
  relogio.agora = new Date("2031-05-10T14:00:00.000Z");
  esquecerStatusDeProvedor();
  esquecerRegistrosDeUso();

  storageMock.getProvider.mockImplementation(async (id: number) => ({
    id, name: "Provedor 42 Telecom LTDA", tradeName: "NsLink", status: "active",
  }));
  storageMock.getUser.mockImplementation(async (id: number) => USUARIOS[id]);
  storageMock.historicoDeAcessos.mockImplementation(async (providerId: number) =>
    janelas.filter(j => j.providerId === providerId).slice().reverse(),
  );

  storageMock.liberarAcessoDeSuporte.mockImplementation(async (providerId: number, liberadoPor: number) =>
    liberar(providerId, liberadoPor),
  );
  storageMock.revogarAcessoDeSuporte.mockImplementation(async (providerId: number, revogadoPor: number) => {
    let n = 0;
    for (const j of janelas) {
      if (j.providerId === providerId && !j.revogadoEm && j.expiraEm > relogio.agora) {
        j.revogadoEm = new Date(relogio.agora);
        j.revogadoPor = revogadoPor;
        n++;
      }
    }
    return n;
  });
  // O mesmo filtro do banco: nao revogada E ainda no prazo.
  storageMock.acessoDeSuporteValido.mockImplementation(async (providerId: number) =>
    janelas.find(j => j.providerId === providerId && !j.revogadoEm && j.expiraEm > relogio.agora),
  );
  storageMock.registrarUsoDoAcesso.mockImplementation(async (id: number, usadoPor: number) => {
    const j = janelas.find(x => x.id === id);
    if (!j) return;
    j.usadoPor = j.usadoPor ?? usadoPor;
    j.primeiroUsoEm = j.primeiroUsoEm ?? new Date(relogio.agora);
    j.ultimoUsoEm = new Date(relogio.agora);
    j.usos += 1;
  });

  sessao = sessaoDe(ADMIN_DO_PROVEDOR);
});

const post = (caminho: string) => fetch(`${base}${caminho}`, { method: "POST" });
const get = (caminho: string) => fetch(`${base}${caminho}`);

const liberarPelaRota = () => post("/api/provider/acesso-suporte/liberar");
const revogarPelaRota = () => post("/api/provider/acesso-suporte/revogar");
const entrar = (id: number | string) => post(`/api/admin/acesso-suporte/${id}/entrar`);
const sair = () => post("/api/admin/acesso-suporte/sair");
const dadosDoProvedor = () => get("/api/teste/dados-do-provedor");

// ── Quem abre a porta ────────────────────────────────────────────────────────

describe("liberar acesso — so o admin do provedor", () => {
  it("o admin do provedor libera, e a janela nasce com prazo", async () => {
    const res = await liberarPelaRota();
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.liberado).toBe(true);
    expect(corpo.conectado).toBe(false);
    expect(corpo.duracaoPadraoMs).toBe(DUAS_HORAS);
    expect(new Date(corpo.expiraEm).getTime() - new Date(corpo.liberadoEm).getTime()).toBe(DUAS_HORAS);
    expect(storageMock.liberarAcessoDeSuporte).toHaveBeenCalledWith(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
  });

  it("operador comum do provedor NAO libera, e nada e gravado", async () => {
    sessao = sessaoDe(OPERADOR);

    const res = await liberarPelaRota();

    expect(res.status).toBe(403);
    expect(storageMock.liberarAcessoDeSuporte).not.toHaveBeenCalled();
  });

  it("operador comum do provedor NAO revoga", async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    sessao = sessaoDe(OPERADOR);

    const res = await revogarPelaRota();

    expect(res.status).toBe(403);
    expect(storageMock.revogarAcessoDeSuporte).not.toHaveBeenCalled();
  });

  it("a rota de liberar so enxerga o proprio provedor da sessao", async () => {
    await liberarPelaRota();

    expect(janelas).toHaveLength(1);
    expect(janelas[0].providerId).toBe(PROVEDOR_ID);
  });
});

// ── Quem atravessa o isolamento ──────────────────────────────────────────────

describe("entrar — superadmin so entra com liberacao valida", () => {
  beforeEach(() => {
    sessao = sessaoDe(SUPERADMIN);
  });

  it("sem nenhuma liberacao: 403 e a sessao continua sem provedor", async () => {
    const res = await entrar(PROVEDOR_ID);
    const corpo = await res.json();

    expect(res.status).toBe(403);
    expect(corpo.code).toBe("SUPPORT_ACCESS_MISSING");
    expect(sessao.providerId).toBe(0);
    expect(sessao.suporte).toBeUndefined();
  });

  it("com a liberacao EXPIRADA: 403 e a sessao continua sem provedor", async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    relogio.agora = new Date(relogio.agora.getTime() + DUAS_HORAS + 60_000);

    const res = await entrar(PROVEDOR_ID);

    expect(res.status).toBe(403);
    expect(sessao.suporte).toBeUndefined();
  });

  it("com a liberacao REVOGADA antes da hora: 403", async () => {
    const janela = liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    janela.revogadoEm = new Date(relogio.agora);
    janela.revogadoPor = ADMIN_DO_PROVEDOR.userId;

    const res = await entrar(PROVEDOR_ID);

    expect(res.status).toBe(403);
    expect(sessao.suporte).toBeUndefined();
  });

  it("a liberacao do vizinho nao serve: entrar no 42 com janela do 77 e 403", async () => {
    liberar(VIZINHO_ID, 9);

    const res = await entrar(PROVEDOR_ID);

    expect(res.status).toBe(403);
    expect(sessao.providerId).toBe(0);
  });

  it("entrando: a sessao ganha o providerId e MANTEM role superadmin", async () => {
    const janela = liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);

    const res = await entrar(PROVEDOR_ID);
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.conectado).toBe(true);
    expect(sessao.providerId).toBe(PROVEDOR_ID);
    // A identidade nao muda: e o que separa suporte de admin no log e na tela.
    expect(sessao.role).toBe("superadmin");
    expect(sessao.userId).toBe(SUPERADMIN.userId);
    expect(sessao.suporte).toEqual({
      acessoId: janela.id,
      providerId: PROVEDOR_ID,
      expiraEm: janela.expiraEm.toISOString(),
    });
  });

  it("entrar grava o uso: quem entrou e quando", async () => {
    const janela = liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);

    await entrar(PROVEDOR_ID);

    expect(janela.usadoPor).toBe(SUPERADMIN.userId);
    expect(janela.primeiroUsoEm).not.toBeNull();
  });

  it("ja conectado: nao entra noutro provedor sem sair antes", async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    liberar(VIZINHO_ID, 9);
    await entrar(PROVEDOR_ID);

    const res = await entrar(VIZINHO_ID);
    const corpo = await res.json();

    expect(res.status).toBe(409);
    expect(corpo.code).toBe("SUPPORT_ALREADY_CONNECTED");
    expect(sessao.providerId).toBe(PROVEDOR_ID);
    expect(sessao.suporte.providerId).toBe(PROVEDOR_ID);
  });

  it("provedor invalido na URL nao chega ao storage", async () => {
    const res = await entrar("abc");

    expect(res.status).toBe(400);
    expect(storageMock.acessoDeSuporteValido).not.toHaveBeenCalled();
  });

  it("admin de provedor nao usa a rota de entrar", async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    sessao = sessaoDe(ADMIN_DO_PROVEDOR);

    const res = await entrar(PROVEDOR_ID);

    expect(res.status).toBe(403);
    expect(sessao.suporte).toBeUndefined();
  });
});

// ── A trava por requisicao ───────────────────────────────────────────────────

describe("a trava por requisicao", () => {
  beforeEach(async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    sessao = sessaoDe(SUPERADMIN);
    await entrar(PROVEDOR_ID);
  });

  it("conectado, o suporte alcanca o dado do provedor", async () => {
    const res = await dadosDoProvedor();
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo).toEqual({ providerId: PROVEDOR_ID, role: "superadmin" });
  });

  it("revogada NO MEIO: a proxima requisicao derruba a personificacao", async () => {
    expect((await dadosDoProvedor()).status).toBe(200);

    // O provedor clica em encerrar enquanto o suporte esta dentro.
    for (const j of janelas) { j.revogadoEm = new Date(relogio.agora); }

    const res = await dadosDoProvedor();
    const corpo = await res.json();

    expect(res.status).toBe(403);
    expect(corpo.code).toBe("SUPPORT_ACCESS_ENDED");
    expect(sessao.providerId).toBe(0);
    expect(sessao.suporte).toBeUndefined();
  });

  it("expirada NO MEIO: a proxima requisicao derruba a personificacao", async () => {
    relogio.agora = new Date(relogio.agora.getTime() + DUAS_HORAS + 1_000);

    const res = await dadosDoProvedor();

    expect(res.status).toBe(403);
    expect(sessao.suporte).toBeUndefined();
    // Derrubado, o superadmin volta a ser um superadmin sem provedor.
    expect((await dadosDoProvedor()).status).toBe(403);
  });

  it("revogar e liberar de novo NAO emenda a sessao antiga na janela nova", async () => {
    for (const j of janelas) { j.revogadoEm = new Date(relogio.agora); }
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);

    const res = await dadosDoProvedor();
    const corpo = await res.json();

    expect(res.status).toBe(403);
    expect(corpo.code).toBe("SUPPORT_ACCESS_ENDED");
    expect(sessao.suporte).toBeUndefined();
  });

  it("banco indisponivel: recusa a requisicao SEM apagar a autorizacao", async () => {
    storageMock.acessoDeSuporteValido.mockRejectedValueOnce(new Error("connection terminated"));

    const res = await dadosDoProvedor();
    const corpo = await res.json();

    expect(res.status).toBe(503);
    expect(corpo.code).toBe("SUPPORT_ACCESS_UNVERIFIED");
    // A liberacao continua valida — um soluco de rede nao pode obrigar o
    // provedor a autorizar de novo.
    expect(sessao.suporte).toBeDefined();
    expect((await dadosDoProvedor()).status).toBe(200);
  });

  it("sessao sem personificacao nao consulta o banco por requisicao", async () => {
    sessao = sessaoDe(ADMIN_DO_PROVEDOR);
    storageMock.acessoDeSuporteValido.mockClear();

    expect((await dadosDoProvedor()).status).toBe(200);

    expect(storageMock.acessoDeSuporteValido).not.toHaveBeenCalled();
  });

  it("o uso e amostrado, nao contado por requisicao", async () => {
    storageMock.registrarUsoDoAcesso.mockClear();
    for (let i = 0; i < 5; i++) await dadosDoProvedor();

    // O `entrar` do beforeEach ja gravou; dentro do mesmo minuto nada mais e
    // escrito, senao `usos` viraria numero de requisicoes HTTP.
    expect(storageMock.registrarUsoDoAcesso).not.toHaveBeenCalled();
    expect(janelas[0].usos).toBe(1);
  });
});

// ── O suporte conectado nao renova a si mesmo ────────────────────────────────

describe("suporte conectado nao autoriza a si mesmo", () => {
  beforeEach(async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    sessao = sessaoDe(SUPERADMIN);
    await entrar(PROVEDOR_ID);
    vi.clearAllMocks();
    storageMock.getProvider.mockImplementation(async (id: number) => ({ id, name: "Provedor", status: "active" }));
    storageMock.acessoDeSuporteValido.mockImplementation(async (providerId: number) =>
      janelas.find(j => j.providerId === providerId && !j.revogadoEm && j.expiraEm > relogio.agora),
    );
  });

  it("NAO libera acesso: sem esta linha a janela de 2h viraria permanente", async () => {
    const res = await liberarPelaRota();
    const corpo = await res.json();

    expect(res.status).toBe(403);
    expect(corpo.code).toBe("SUPPORT_SESSION_FORBIDDEN");
    expect(storageMock.liberarAcessoDeSuporte).not.toHaveBeenCalled();
    expect(janelas).toHaveLength(1);
  });

  it("NAO revoga acesso", async () => {
    const res = await revogarPelaRota();

    expect(res.status).toBe(403);
    expect(storageMock.revogarAcessoDeSuporte).not.toHaveBeenCalled();
    expect(janelas[0].revogadoEm).toBeNull();
  });

  it("mas LE o estado — e o que alimenta a faixa vermelha", async () => {
    const res = await get("/api/provider/acesso-suporte");
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.liberado).toBe(true);
    expect(corpo.conectado).toBe(true);
  });
});

// ── Sair ─────────────────────────────────────────────────────────────────────

describe("sair", () => {
  it("limpa a personificacao da sessao", async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    sessao = sessaoDe(SUPERADMIN);
    await entrar(PROVEDOR_ID);

    const res = await sair();
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.conectado).toBe(false);
    expect(sessao.providerId).toBe(0);
    expect(sessao.suporte).toBeUndefined();
    expect((await dadosDoProvedor()).status).toBe(403);
  });

  it("sair sem estar dentro responde 200 — o client tem um caminho so", async () => {
    sessao = sessaoDe(SUPERADMIN);

    const res = await sair();

    expect(res.status).toBe(200);
    expect(sessao.suporte).toBeUndefined();
  });
});

// ── Estado, para a tela do provedor ──────────────────────────────────────────

describe("GET do estado", () => {
  it("sem liberacao: liberado false", async () => {
    const res = await get("/api/provider/acesso-suporte");
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo).toMatchObject({ liberado: false, conectado: false, usos: 0 });
  });

  it("depois de revogar, o estado volta a liberado false e diz quantas fechou", async () => {
    await liberarPelaRota();

    const res = await revogarPelaRota();
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.liberado).toBe(false);
    expect(corpo.revogadas).toBe(1);
    expect((await (await get("/api/provider/acesso-suporte")).json()).liberado).toBe(false);
  });

  it("nao devolve nome, e-mail nem o id de quem atendeu", async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    sessao = sessaoDe(SUPERADMIN);
    await entrar(PROVEDOR_ID);
    sessao = sessaoDe(ADMIN_DO_PROVEDOR);

    const corpo = await (await get("/api/provider/acesso-suporte")).json();

    expect(corpo.conectado).toBe(true);
    // `providerId` e `providerNome` sao do PROPRIO provedor que perguntou — o
    // que a faixa precisa para dizer de quem e a conta na tela. `agora` e o
    // relogio do servidor, que corrige a contagem regressiva. Nome de PESSOA
    // continua fora: a lista abaixo e a barreira contra devolver `usadoPor`.
    //
    // A lista e FECHADA de proposito, e continua sendo: `toEqual` sobre o
    // conjunto ordenado de chaves reprova tanto quem tira um campo quanto quem
    // acrescenta um. Cada chave nova aqui obriga quem a escreveu a passar por
    // este teste e responder se aquilo identifica uma pessoa.
    expect(Object.keys(corpo).sort()).toEqual(
      [
        "agora", "conectado", "duracaoPadraoMs", "expiraEm", "liberado", "liberadoEm",
        "primeiroUsoEm", "providerId", "providerNome", "ultimoUsoEm", "usos",
      ].sort(),
    );

    /**
     * A segunda barreira, contra a saida obvia: alguem que topar com a lista
     * fechada acima e so acrescentar a chave nova a ela.
     *
     * Aqui nao ha lista para editar — o corpo inteiro e varrido atras do nome e
     * do e-mail das tres pessoas que participaram desta janela (a admin que
     * liberou, a atendente que entrou, o operador do provedor). Se qualquer um
     * deles aparecer, sob qualquer nome de chave, o teste reprova.
     */
    const serializado = JSON.stringify(corpo);
    for (const pessoa of Object.values(USUARIOS)) {
      expect(serializado).not.toContain(pessoa.name);
      expect(serializado).not.toContain(pessoa.email);
    }
    // Os ids tambem nao saem — seriam usuarios da PLATAFORMA expostos ao
    // provedor. Explicito, porque foi para nao devolver `usadoPor` que
    // `EstadoDoAcesso` nasceu com a forma que tem.
    expect(corpo.usadoPor).toBeUndefined();
    expect(corpo.liberadoPor).toBeUndefined();
    expect(corpo.revogadoPor).toBeUndefined();
  });

  /**
   * Sem `agora`, a contagem regressiva da tela do provedor confia no relogio da
   * maquina dele — que pode estar minutos ou horas fora. Quem esta adiantado ve
   * a janela fechar antes da hora; quem esta atrasado ve "ainda ha tempo" numa
   * janela que o banco ja fechou, e essa e a leitura perigosa: a contagem diz
   * ao provedor por quanto tempo ainda ha gente de fora dentro da conta dele.
   *
   * O campo vai nas TRES respostas do lado do provedor porque a tela guarda o
   * corpo da mutacao no lugar do estado — liberar e revogar sem `agora`
   * deixariam a contagem sem correcao ate a proxima leitura.
   */
  it("manda o relogio do servidor nas tres respostas do lado do provedor", async () => {
    const antes = Date.now();

    const aoLiberar = await (await liberarPelaRota()).json();
    const noEstado = await (await get("/api/provider/acesso-suporte")).json();
    const aoRevogar = await (await revogarPelaRota()).json();

    for (const corpo of [aoLiberar, noEstado, aoRevogar]) {
      const instante = Date.parse(corpo.agora);
      expect(Number.isFinite(instante)).toBe(true);
      // O relogio e o do PROCESSO, nao o do duble de banco (que vive em 2031):
      // e o do processo que a tela usa para se corrigir.
      expect(instante).toBeGreaterThanOrEqual(antes - 1000);
      expect(instante).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });

  /**
   * A faixa vermelha desenha na tela de quem esta PERSONIFICANDO, e as telas de
   * um provedor sao iguais as de outro. Sem estes dois campos o aviso nao
   * consegue dizer de quem e a conta — e um aviso que nao identifica a conta e
   * um adesivo.
   */
  it("diz de quem e a conta: providerId e nome, nas tres respostas", async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    sessao = sessaoDe(SUPERADMIN);
    await entrar(PROVEDOR_ID);

    const naFaixa = await (await get("/api/provider/acesso-suporte")).json();

    // Nome fantasia, como em GET /api/tenant/resolve — e assim que o provedor e
    // conhecido, e a razao social so apareceria sem fantasia.
    expect(naFaixa).toMatchObject({ providerId: PROVEDOR_ID, providerNome: "NsLink", liberado: true });

    sessao = sessaoDe(ADMIN_DO_PROVEDOR);
    const aoLiberar = await (await liberarPelaRota()).json();
    const aoRevogar = await (await revogarPelaRota()).json();

    expect(aoLiberar).toMatchObject({ providerId: PROVEDOR_ID, providerNome: "NsLink" });
    expect(aoRevogar).toMatchObject({ providerId: PROVEDOR_ID, providerNome: "NsLink" });
  });

  it("provedor ilegivel nao apaga a faixa: sai o numero, sem o nome", async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    // A leitura do provedor cai; o aviso de personificacao NAO pode cair junto.
    storageMock.getProvider.mockRejectedValue(new Error("connection terminated"));

    const corpo = await (await get("/api/provider/acesso-suporte")).json();

    expect(corpo.liberado).toBe(true);
    expect(corpo.providerId).toBe(PROVEDOR_ID);
    expect(corpo.providerNome).toBeUndefined();
  });
});

// ── A trilha do superadmin ───────────────────────────────────────────────────

/**
 * `GET /api/admin/acesso-suporte/:providerId`.
 *
 * Sem ela a aba Suporte da ficha do provedor nunca saia do estado de erro, e o
 * botao de entrar — o unico caminho de UI para a personificacao — nao chegava a
 * desenhar: a funcionalidade inteira ficava inalcancavel pela tela.
 */
describe("trilha do provedor, para o superadmin", () => {
  const trilha = (id: number | string) => get(`/api/admin/acesso-suporte/${id}`);

  beforeEach(() => {
    sessao = sessaoDe(SUPERADMIN);
  });

  it("sem nenhuma janela: vigente nulo e historico vazio", async () => {
    const res = await trilha(PROVEDOR_ID);
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo).toEqual({ vigente: null, historico: [] });
  });

  it("com janela aberta: a vigente e a mesma linha do historico, com os nomes", async () => {
    const janela = liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    // Entra para marcar uso, e SAI antes de ler. A trilha e tela de plataforma:
    // `requireSuperAdmin` recusa de dentro da personificacao (ver "escopo da
    // janela"), e o fluxo real e o mesmo — quem le a trilha esta na ficha do
    // provedor, nao dentro da conta dele.
    await entrar(PROVEDOR_ID);
    await sair();

    const corpo = await (await trilha(PROVEDOR_ID)).json();

    expect(corpo.vigente).toMatchObject({
      id: janela.id,
      revogadoEm: null,
      liberadoPorNome: "Ana Administradora",
      usadoPorNome: "Rita do Suporte",
      revogadoPorNome: null,
      usos: 1,
    });
    expect(corpo.historico).toHaveLength(1);
    expect(corpo.historico[0].id).toBe(janela.id);
  });

  it("janela encerrada some da vigente e FICA no historico — trilha nao tem buraco", async () => {
    const janela = liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    janela.revogadoEm = new Date(relogio.agora);
    janela.revogadoPor = ADMIN_DO_PROVEDOR.userId;

    const corpo = await (await trilha(PROVEDOR_ID)).json();

    expect(corpo.vigente).toBeNull();
    expect(corpo.historico).toHaveLength(1);
    expect(corpo.historico[0].revogadoPorNome).toBe("Ana Administradora");
  });

  it("nao devolve o id de nenhuma pessoa — so o nome", async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    await entrar(PROVEDOR_ID);
    await sair();

    const corpo = await (await trilha(PROVEDOR_ID)).json();

    expect(Object.keys(corpo.vigente).sort()).toEqual(
      [
        "id", "liberadoEm", "expiraEm", "revogadoEm", "liberadoPorNome",
        "revogadoPorNome", "usadoPorNome", "primeiroUsoEm", "ultimoUsoEm", "usos",
      ].sort(),
    );
  });

  it("usuario apagado nao derruba a trilha: fica sem nome, com os horarios", async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    storageMock.getUser.mockResolvedValue(undefined);

    const corpo = await (await trilha(PROVEDOR_ID)).json();

    expect(corpo.vigente.liberadoPorNome).toBeNull();
    expect(corpo.vigente.liberadoEm).toBeTruthy();
  });

  it("o admin do provedor NAO le a trilha — ela cita nome de gente da plataforma", async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    sessao = sessaoDe(ADMIN_DO_PROVEDOR);

    const res = await trilha(PROVEDOR_ID);

    expect(res.status).toBe(403);
    expect(storageMock.historicoDeAcessos).not.toHaveBeenCalled();
  });

  it("o operador do provedor tambem nao le", async () => {
    sessao = sessaoDe(OPERADOR);

    expect((await trilha(PROVEDOR_ID)).status).toBe(403);
  });

  it("provedor invalido na URL nao chega ao storage", async () => {
    expect((await trilha("abc")).status).toBe(400);
    expect(storageMock.historicoDeAcessos).not.toHaveBeenCalled();
  });
});

// ── O escopo do suporte: tudo que o admin do provedor faz ────────────────────

/**
 * O DONO ESCOLHEU "TUDO QUE O ADMIN DO PROVEDOR FAZ", e dez rotas nao cumpriam.
 *
 * A personificacao PRESERVA `role` como "superadmin" de proposito — e o que
 * permite separar suporte de admin no log, na trilha e na faixa. O preco caia em
 * `provider.routes.ts`, onde dez rotas comparavam `role !== "admin"` na mao:
 * criar e remover usuario, settings, perfil, token de integracao, socios e
 * documentos KYC. O suporte entrava na conta e era barrado justamente nas telas
 * de configuracao que ele foi criado para arrumar.
 *
 * As quatro metades sao testadas juntas de proposito: passar a valer para o
 * suporte nao pode passar a valer para o operador, nem para um superadmin que
 * nao esta dentro de janela nenhuma.
 */
describe("escopo do suporte nas rotas de administracao do provedor", () => {
  /** As dez acoes, na forma minima que faz cada handler rodar de verdade. */
  const ACOES: Array<{ nome: string; metodo: string; caminho: string; corpo?: unknown }> = [
    {
      nome: "criar usuario", metodo: "POST", caminho: "/api/provider/users",
      corpo: { name: "Novo", email: "novo@nslink.test", password: "senha-forte" },
    },
    { nome: "remover usuario", metodo: "DELETE", caminho: "/api/provider/users/9" },
    {
      nome: "alterar configuracoes", metodo: "PATCH", caminho: "/api/provider/settings",
      corpo: { website: "https://nslink.test" },
    },
    { nome: "regenerar token de integracao", metodo: "POST", caminho: "/api/provider/integration/regenerate-token" },
    { nome: "alterar o perfil", metodo: "PATCH", caminho: "/api/provider/profile", corpo: { tradeName: "NsLink" } },
    {
      nome: "adicionar socio", metodo: "POST", caminho: "/api/provider/partners",
      corpo: { name: "Socio", cpf: "12345678909" },
    },
    {
      nome: "editar socio", metodo: "PATCH", caminho: "/api/provider/partners/1",
      corpo: { name: "Socio Editado" },
    },
    { nome: "remover socio", metodo: "DELETE", caminho: "/api/provider/partners/1" },
    {
      nome: "enviar documento KYC", metodo: "POST", caminho: "/api/provider/documents",
      corpo: { documentType: "contrato_social", documentName: "cs.pdf", fileData: "data:application/pdf;base64,QQ==" },
    },
    { nome: "remover documento KYC", metodo: "DELETE", caminho: "/api/provider/documents/1" },
  ];

  const chamar = (a: (typeof ACOES)[number]) =>
    fetch(`${base}${a.caminho}`, {
      method: a.metodo,
      headers: a.corpo ? { "Content-Type": "application/json" } : undefined,
      body: a.corpo ? JSON.stringify(a.corpo) : undefined,
    });

  beforeEach(() => {
    // O alvo do DELETE: do provedor certo, e nao e o ultimo administrador.
    storageMock.getUser.mockImplementation(async (id: number) =>
      id === 9 ? { id: 9, name: "Alvo", role: "user", providerId: PROVEDOR_ID } : USUARIOS[id],
    );
  });

  it("o suporte conectado faz as dez", async () => {
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    sessao = sessaoDe(SUPERADMIN);
    await entrar(PROVEDOR_ID);

    for (const acao of ACOES) {
      const res = await chamar(acao);
      expect(res.ok, `${acao.nome} devolveu ${res.status}`).toBe(true);
    }
  });

  it("o admin do provedor continua fazendo as dez", async () => {
    sessao = sessaoDe(ADMIN_DO_PROVEDOR);

    for (const acao of ACOES) {
      const res = await chamar(acao);
      expect(res.ok, `${acao.nome} devolveu ${res.status}`).toBe(true);
    }
  });

  it("o operador comum continua barrado nas dez — a regra nao afrouxou", async () => {
    sessao = sessaoDe(OPERADOR);

    for (const acao of ACOES) {
      const res = await chamar(acao);
      expect(res.status, `${acao.nome} devolveu ${res.status}`).toBe(403);
    }
  });

  /**
   * Superadmin SEM personificacao nao administra provedor nenhum por aqui.
   *
   * Hoje ele nem chega ao helper: sem `providerId` a sessao morre em
   * `requireProvider`. A linha existe porque a condicao poderia ter sido escrita
   * como "ou e superadmin", e nesse dia bastaria ser da plataforma para escrever
   * na conta de qualquer tenant sem janela liberada nenhuma.
   */
  it("superadmin fora de personificacao nao passa", async () => {
    sessao = sessaoDe(SUPERADMIN);

    for (const acao of ACOES) {
      expect((await chamar(acao)).status, acao.nome).toBe(403);
    }
  });

  /**
   * A janela autoriza UM provedor. Sessao com `suporte` apontando para o vizinho
   * e `providerId` do 42 e estado impossivel hoje — `entrar` grava os dois
   * juntos — e e o tipo de coisa que uma refatoracao futura cria em silencio.
   */
  it("personificacao de OUTRO provedor nao autoriza escrever neste", async () => {
    // A janela do vizinho existe e esta valida: quem barra a escrita e o helper,
    // nao a trava.
    const doVizinho = liberar(VIZINHO_ID, 9);
    sessao = sessaoDe({
      ...SUPERADMIN,
      providerId: PROVEDOR_ID,
      suporte: {
        acessoId: doVizinho.id,
        providerId: VIZINHO_ID,
        expiraEm: doVizinho.expiraEm.toISOString(),
      },
    });

    for (const acao of ACOES) {
      expect((await chamar(acao)).status, acao.nome).toBe(403);
    }
  });
});

// ── Login sobre uma sessao de suporte ────────────────────────────────────────

/**
 * O LOGIN TROCA O DONO DA SESSAO, E A PERSONIFICACAO NAO PODE ATRAVESSAR.
 *
 * O login sobrescrevia `userId`, `providerId` e `role` e deixava
 * `session.suporte` orfa. A trava seguiria validando a janela do provedor
 * ANTERIOR a cada requisicao e carimbando uso nela com o `userId` de quem acabou
 * de entrar — a trilha do provedor passaria a acusar acesso de alguem que nunca
 * entrou nele, que e a unica coisa que uma trilha nao pode fazer.
 */
describe("login limpa a personificacao de suporte", () => {
  const OUTRO_DA_PLATAFORMA = {
    id: 3, email: "outro@plataforma.test", name: "Outro", password: "hash",
    role: "superadmin", providerId: null, emailVerified: true, mustChangePassword: false,
  };

  const logar = () =>
    fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: OUTRO_DA_PLATAFORMA.email, password: "seja-o-que-for" }),
    });

  beforeEach(async () => {
    storageMock.getUserByEmail.mockResolvedValue(OUTRO_DA_PLATAFORMA);
    liberar(PROVEDOR_ID, ADMIN_DO_PROVEDOR.userId);
    sessao = sessaoDe(SUPERADMIN);
    await entrar(PROVEDOR_ID);
  });

  it("depois do login a sessao nao carrega mais a janela do provedor anterior", async () => {
    expect(sessao.suporte).toBeDefined();

    const res = await logar();

    expect(res.status).toBe(200);
    expect(sessao.suporte).toBeUndefined();
    expect(sessao.userId).toBe(OUTRO_DA_PLATAFORMA.id);
    expect(sessao.providerId).toBe(0);
  });

  it("e a janela do provedor anterior para de receber uso desta sessao", async () => {
    const janela = janelas[0];
    await logar();

    // Sem a limpeza, esta requisicao passaria pela trava, revalidaria a janela do
    // 42 e gravaria uso nela com o userId de quem acabou de entrar.
    esquecerRegistrosDeUso();
    storageMock.registrarUsoDoAcesso.mockClear();
    await dadosDoProvedor();

    expect(storageMock.registrarUsoDoAcesso).not.toHaveBeenCalled();
    expect(janela.usadoPor).toBe(SUPERADMIN.userId);
  });
});

// ── A janela de A nao abre o dado de B ───────────────────────────────────────

/**
 * O ESCOPO DA LIBERACAO (04/09/2026).
 *
 * A personificacao preserva `session.role = "superadmin"` de proposito: e o que
 * permite o atendente operar a conta e o que distingue suporte de admin no log.
 * O preco disso e que `requireSuperAdmin`, comparando so o papel, atendia TODA
 * rota de plataforma de dentro da janela — e rota de plataforma responde sobre
 * todos os provedores.
 *
 * O provedor 42 assinou uma autorizacao para o dado DELE. Ler a lista de
 * provedores com essa assinatura na mao usa o consentimento de um para ver o de
 * outro, que e exatamente o isolamento entre tenants que o produto vende.
 *
 * Tirar o link da barra lateral nao resolve nada: a lista chega chamando a API.
 * Por isso a recusa e do middleware, e os casos abaixo batem no middleware.
 */
describe("escopo da janela — as telas da plataforma ficam de fora", () => {
  const plataforma = () => get("/api/teste/plataforma");

  beforeEach(async () => {
    sessao = sessaoDe(ADMIN_DO_PROVEDOR);
    await liberarPelaRota();
    sessao = sessaoDe(SUPERADMIN);
  });

  it("fora da personificacao o superadmin ve a plataforma inteira", async () => {
    // O controle. Sem ele, um 403 no caso seguinte poderia ser qualquer coisa.
    const res = await plataforma();
    expect(res.status).toBe(200);
    expect((await res.json()).provedores).toHaveLength(3);
  });

  it("dentro da personificacao a mesma rota recusa, e diz por que", async () => {
    await entrar(PROVEDOR_ID);

    const res = await plataforma();
    const corpo = await res.json();

    expect(res.status).toBe(403);
    expect(corpo.code).toBe("SUPPORT_PLATFORM_BLOCKED");
    // Nao "acesso negado": o atendente TEM o papel, e a tela volta sozinha
    // quando ele sair. A mensagem tem de dizer o que fazer.
    expect(corpo.message).toMatch(/Encerre o acesso de suporte/i);
    expect(corpo.provedores).toBeUndefined();
  });

  it("o dado do provedor liberado continua chegando — a recusa e so da plataforma", async () => {
    await entrar(PROVEDOR_ID);

    const res = await dadosDoProvedor();
    expect(res.status).toBe(200);
    expect((await res.json()).providerId).toBe(PROVEDOR_ID);
  });

  it("sair continua atendendo — barrar a saida prenderia o atendente dentro", async () => {
    await entrar(PROVEDOR_ID);

    const res = await sair();

    expect(res.status).toBe(200);
    expect(sessao.suporte).toBeUndefined();
  });

  it("e depois de sair a plataforma volta na mesma sessao", async () => {
    await entrar(PROVEDOR_ID);
    await sair();

    const res = await plataforma();
    expect(res.status).toBe(200);
    expect((await res.json()).provedores).toHaveLength(3);
  });

  it("quem nao e superadmin recebe a recusa de sempre, nao a nova", async () => {
    // A guarda ganhou um segundo motivo de recusa; o primeiro nao pode ter
    // mudado de forma, porque dezenas de telas leem essa mensagem.
    sessao = sessaoDe(ADMIN_DO_PROVEDOR);

    const res = await plataforma();
    const corpo = await res.json();

    expect(res.status).toBe(403);
    expect(corpo.message).toBe("Acesso restrito ao administrador do sistema");
    expect(corpo.code).toBeUndefined();
  });
});

describe("a excecao e uma rota so", () => {
  // Os dois casos abaixo leem FONTE, e nao chamam funcao: o que se prova e a
  // forma do codigo — que so uma rota usa a guarda frouxa e que nenhuma rota de
  // plataforma ficou sem guarda. Nao ha como perguntar isso a um servidor.
  const PASTA_DAS_ROTAS = fileURLToPath(new URL(".", import.meta.url));

  it("nenhuma outra rota usa a guarda que atende dentro da personificacao", async () => {
    // `requireSuperAdminMesmoNoSuporte` existe para a saida e mais nada. Ela e
    // exportada como qualquer outra, e usada por engano numa segunda rota
    // reabre o buraco inteiro sem nenhum sinal: os casos acima continuariam
    // verdes, porque exercitam a guarda estrita.
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const porArquivo: Record<string, number> = {};
    for (const arquivo of readdirSync(PASTA_DAS_ROTAS)) {
      if (!arquivo.endsWith(".routes.ts")) continue;
      const fonte = readFileSync(join(PASTA_DAS_ROTAS, arquivo), "utf8");
      const n = fonte.split("requireSuperAdminMesmoNoSuporte").length - 1;
      if (n > 0) porArquivo[arquivo] = n;
    }

    // Tres ocorrencias, no MESMO arquivo: o import, a rota de entrar e a de
    // sair — as duas que abrem e fecham a janela, e que nao devolvem dado de
    // provedor nenhum.
    expect(porArquivo).toEqual({ "suporte-acesso.routes.ts": 3 });
  });

  it("toda rota /api/admin declara uma guarda de superadmin", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    // `admin.routes.ts` e onde moram as ~30 rotas que respondem sobre TODOS os
    // provedores. Declarar uma sem guarda nenhuma e o jeito mais facil de
    // reabrir isto sem perceber — a rota responderia ate para quem nao e da
    // plataforma, quanto mais para uma janela de suporte.
    const fonte = readFileSync(join(PASTA_DAS_ROTAS, "admin.routes.ts"), "utf8");
    const semGuarda = fonte
      .split(/\r?\n/)
      .filter(l => /router\.(get|post|put|patch|delete)\("\/api\/admin\//.test(l))
      .filter(l => !l.includes("requireSuperAdmin"));

    expect(semGuarda).toEqual([]);
  });
});
