/**
 * A IDENTIDADE DO REVENDEDOR, do host ate o corpo da resposta.
 *
 * A secao de riscos do desenho da fase 2 abre dizendo que um papel novo entrando
 * antes destas guardas e escalada de privilegio. As guardas sao tres, e este
 * arquivo mede as tres com as PECAS DE VERDADE — `marca.service` real, storage
 * duble com semantica, rotas montadas de fato:
 *
 *   1. o dominio proprio da marca e a UNICA porta do revendedor;
 *   2. provedor suspenso nao entra, venha pelo subdominio ou pelo dominio da
 *      marca (decisao 9 do dono);
 *   3. o `/me` conta a marca a quem e revendedor — e continua contando
 *      exatamente a mesma coisa de sempre a quem nao e.
 *
 * O irmao `auth.routes.test.ts` mede a LIGACAO com o servico mockado (que o
 * ramo certo e chamado, que a sessao nasce certa). Aqui o servico e real, porque
 * o que se afirma e a REGRA: "marca A nao entra em B" nao vale nada contra um
 * duble que devolve o que o teste mandou devolver.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

vi.hoisted(() => {
  // `auth.routes.ts` importa de `../auth`, que exige SESSION_SECRET no topo do
  // modulo; o codigo proprio do provedor (`/me`) tambem deriva chave dele.
  process.env.SESSION_SECRET = "segredo-de-teste-do-revendedor";
});

vi.mock("express-session", () => ({ default: () => (_r: any, _s: any, n: any) => n() }));
vi.mock("connect-pg-simple", () => ({ default: () => class MockPgStore {} }));
vi.mock("../db", () => ({ db: {}, pool: {} }));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const storageMock = vi.hoisted(() => ({
  getUserByEmail: vi.fn(async (_e: string): Promise<any> => null),
  getUser: vi.fn(async (_id: number): Promise<any> => undefined),
  getProvider: vi.fn(async (_id: number): Promise<any> => null),
  getMarca: vi.fn(async (_id: number): Promise<any> => undefined),
  getMarcaPorDominio: vi.fn(async (_h: string): Promise<any> => undefined),
  getMarcaPorSubdominio: vi.fn(async (_s: string): Promise<any> => undefined),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

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
  sendWelcomeEmail: vi.fn(async () => undefined),
  sendPasswordChangedEmail: vi.fn(async () => undefined),
}));

import { registerAuthRoutes } from "./auth.routes";
import { esquecerMarcas } from "../services/marca.service";
import { MENSAGEM_PROVEDOR_SUSPENSO } from "../auth";

let server: Server;
let base: string;
let sessao: Record<string, any>;
/** O host que a requisicao seguinte vai carregar. Ver o middleware do harness. */
let host: string;

/** Uma marca como o banco a devolve, com tudo o que o resolvedor e o /me leem. */
const marcaDoBanco = (over: Record<string, any>) => ({
  ativo: true,
  assinatura: null,
  dominioStatus: "ativo",
  logoSvg: null, logoPng: null, faviconSvg: null,
  corBrand: "#4A4670", corBrandDark: null,
  emailRemetente: null, emailNomeExibicao: null,
  suporteEmail: null, suporteWhatsapp: null, site: null,
  responsavelRazaoSocial: null, responsavelCnpj: null,
  revendaAtiva: true,
  statusComercial: "ativo",
  comissaoPercentual: "20.00",
  repasseRazaoSocial: "CredNet Servicos LTDA",
  repasseCnpj: "12345678000199",
  repasseChavePix: "pix@crednet.com.br",
  repasseEmail: "financeiro@crednet.com.br",
  cadastroAberto: false,
  landingAtiva: false,
  landing: {},
  ogImagePng: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  ...over,
});

const CREDNET = marcaDoBanco({ id: 7, slug: "crednet", nomeProduto: "CredNet", dominio: "app.crednet.com.br" });
const RIVAL = marcaDoBanco({ id: 9, slug: "rival", nomeProduto: "Rival", dominio: "portal.rival.com.br" });

/** O provedor NsLink e cliente da CredNet: veste a marca 7 e tem subdominio. */
const NSLINK = { id: 5, name: "NsLink", subdomain: "nslink", marcaId: 7, status: "active", plan: "pro" };

const RENATA = {
  id: 3,
  email: "renata@crednet.com.br",
  name: "Renata Revendedora",
  password: "hash",
  role: "revendedor",
  providerId: null,
  marcaId: 7,
  emailVerified: true,
  mustChangePassword: false,
};

const ANA_ADMIN = {
  id: 5,
  email: "ana@nslink.com.br",
  name: "Ana Administradora",
  password: "hash",
  role: "admin",
  providerId: 5,
  marcaId: null,
  emailVerified: true,
  mustChangePassword: false,
};

/**
 * Liga o mundo: quem responde por cada dominio e por cada subdominio.
 *
 * A busca por id ve as MESMAS marcas — uma marca que responde por dominio mas
 * some quando procurada por id seria um mundo que nao existe.
 */
function mundo(porDominio: Record<string, any>, porSubdominio: Record<string, any> = {}) {
  storageMock.getMarcaPorDominio.mockImplementation(async (h: string) => porDominio[h]);
  storageMock.getMarcaPorSubdominio.mockImplementation(async (s: string) => porSubdominio[s]);
  const porId = new Map<number, any>();
  for (const m of [...Object.values(porDominio), ...Object.values(porSubdominio)]) {
    if (m?.id) porId.set(m.id, m);
  }
  storageMock.getMarca.mockImplementation(async (id: number) => porId.get(id));
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // `req.hostname` e um getter do prototipo do Express e vem de um socket
    // 127.0.0.1 neste harness. O cabecalho `Host` e proibido no fetch do Node,
    // entao o host de teste entra aqui — e e exatamente o valor que o servidor
    // leria atras do nginx.
    Object.defineProperty(req, "hostname", { value: host, configurable: true });
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
  // O cache host->marca dura 5 min e atravessaria os testes: uma marca desligada
  // no teste seguinte continuaria ativa pela linha do anterior.
  esquecerMarcas();
  sessao = {};
  host = "app.crednet.com.br";
  mundo(
    { "app.crednet.com.br": CREDNET, "portal.rival.com.br": RIVAL },
    { nslink: CREDNET },
  );
  storageMock.getProvider.mockResolvedValue({ ...NSLINK });
});

const login = (email: string) =>
  fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "senha-boa-123" }),
  });

const entrarComoRevendedor = () => {
  storageMock.getUserByEmail.mockResolvedValue({ ...RENATA });
  return login(RENATA.email);
};

/**
 * A porta do revendedor e UMA: o dominio proprio da marca dele, ativo.
 *
 * Cada recusa abaixo tem motivo proprio, e todas respondem o MESMO 401 generico.
 * Um texto especifico — "essa conta e de outra marca" — transformaria a tela de
 * login de qualquer dominio white label num oraculo que confirma que um e-mail
 * existe e em qual concorrente ele trabalha.
 */
describe("login do revendedor — so o dominio proprio da marca", () => {
  it("entra pelo dominio da propria marca", async () => {
    const res = await entrarComoRevendedor();

    expect(res.status).toBe(200);
    expect(sessao.marcaId).toBe(7);
    expect(sessao.providerId).toBe(0);
    expect(sessao.role).toBe("revendedor");
    expect(sessao.hostLogin).toBe("app.crednet.com.br");
  });

  it("o revendedor da marca A NAO entra no dominio da marca B", async () => {
    host = "portal.rival.com.br";

    const res = await entrarComoRevendedor();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "Email ou senha incorretos" });
    expect(sessao.userId).toBeUndefined();
  });

  it("marca desligada nao e prova — desligar a marca desliga o acesso", async () => {
    mundo({ "app.crednet.com.br": { ...CREDNET, ativo: false } });

    const res = await entrarComoRevendedor();

    expect(res.status).toBe(401);
    expect(sessao.userId).toBeUndefined();
  });

  /**
   * Ordem obrigatoria do onboarding (decisao 10): dominio ativo -> revenda ativa
   * -> usuario. Sem certificado emitido a sessao viajaria em claro, entao o
   * dominio ainda pendente nao prova nada.
   */
  it("dominio ainda pendente de HTTPS nao e prova", async () => {
    mundo({ "app.crednet.com.br": { ...CREDNET, dominioStatus: "pendente" } });

    const res = await entrarComoRevendedor();

    expect(res.status).toBe(401);
    expect(sessao.userId).toBeUndefined();
  });

  it("a raiz da plataforma nao e prova, com ou sem www", async () => {
    for (const raiz of ["consultaisp.com.br", "www.consultaisp.com.br"]) {
      host = raiz;
      sessao = {};

      const res = await entrarComoRevendedor();

      expect(res.status, raiz).toBe(401);
      expect(sessao.userId, raiz).toBeUndefined();
    }
  });

  /**
   * O caso mais sutil: `nslink.consultaisp.com.br` e o endereco de um provedor
   * QUE VESTE A MARCA 7 — a marca resolve, e um `marcaId === marcaId` ingenuo
   * aceitaria. E decisao recusar: a sessao de quem revende nao nasce presa ao
   * endereco de um cliente dele, que pode trocar de marca ou ser desvinculado.
   */
  it("o subdominio de um provedor DA PROPRIA marca nao e prova", async () => {
    host = "nslink.consultaisp.com.br";

    const res = await entrarComoRevendedor();

    expect(res.status).toBe(401);
    expect(sessao.userId).toBeUndefined();
  });

  it("host desconhecido nao e prova", async () => {
    host = "app.crednet.com.br.evil.com";

    const res = await entrarComoRevendedor();

    expect(res.status).toBe(401);
    expect(sessao.userId).toBeUndefined();
  });

  it("o admin do provedor continua entrando pelas duas portas dele", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...ANA_ADMIN });

    host = "nslink.consultaisp.com.br";
    expect((await login(ANA_ADMIN.email)).status).toBe(200);

    sessao = {};
    host = "app.crednet.com.br";
    expect((await login(ANA_ADMIN.email)).status).toBe(200);
    expect(sessao.providerId).toBe(5);
    expect(sessao.marcaId).toBe(7);
  });
});

/**
 * Decisao 9: o login recusa provedor suspenso, seja quem for que suspendeu.
 *
 * Ja valia desde a fase 0; o que a fase 1 acrescenta e a segunda porta. O
 * provedor de uma marca white label entra pelo dominio do revendedor, e uma
 * trava que so cobrisse o subdominio deixaria a porta da marca aberta —
 * exatamente a porta que os clientes do revendedor usam.
 */
describe("login — provedor suspenso nao entra por porta nenhuma", () => {
  beforeEach(() => {
    storageMock.getUserByEmail.mockResolvedValue({ ...ANA_ADMIN });
  });

  it("403 pelo subdominio do provedor", async () => {
    host = "nslink.consultaisp.com.br";
    storageMock.getProvider.mockResolvedValue({ ...NSLINK, status: "suspended" });

    const res = await login(ANA_ADMIN.email);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      message: MENSAGEM_PROVEDOR_SUSPENSO,
      code: "PROVIDER_SUSPENDED",
    });
    expect(sessao.userId).toBeUndefined();
  });

  it("403 tambem pelo dominio da marca", async () => {
    host = "app.crednet.com.br";
    storageMock.getProvider.mockResolvedValue({ ...NSLINK, status: "suspended" });

    const res = await login(ANA_ADMIN.email);

    expect(res.status).toBe(403);
    expect(sessao.userId).toBeUndefined();
  });

  it("cancelado tambem nao entra", async () => {
    storageMock.getProvider.mockResolvedValue({ ...NSLINK, status: "cancelled" });

    expect((await login(ANA_ADMIN.email)).status).toBe(403);
  });

  it("suspender o provedor nao derruba o revendedor: divida do cliente nao e dele", async () => {
    storageMock.getProvider.mockResolvedValue({ ...NSLINK, status: "suspended" });

    const res = await entrarComoRevendedor();

    expect(res.status).toBe(200);
    expect(sessao.marcaId).toBe(7);
  });
});

/**
 * O `/me` e a unica coisa que o client tem para saber onde esta. Ele ganha um
 * caso — o revendedor — e a metade importante deste bloco e a outra: a resposta
 * de quem ja usava o sistema tem de sair identica a de antes da fase 1.
 */
describe("GET /api/auth/me", () => {
  const me = () => fetch(`${base}/api/auth/me`);

  it("revendedor recebe a marca e nenhum provedor", async () => {
    storageMock.getUser.mockResolvedValue({ ...RENATA });
    sessao = { userId: 3, providerId: 0, role: "revendedor", marcaId: 7, hostLogin: "app.crednet.com.br" };

    const corpo = await (await me()).json();

    expect(corpo.user).toEqual({ id: 3, email: RENATA.email, name: RENATA.name, role: "revendedor" });
    expect(corpo.provider).toBeNull();
    expect(corpo.partnerCode).toBeNull();
    expect(corpo.marca).toEqual({
      id: 7,
      nomeProduto: "CredNet",
      slug: "crednet",
      dominio: "app.crednet.com.br",
      dominioStatus: "ativo",
      revendaAtiva: true,
      comissaoPercentual: 20,
    });
  });

  /**
   * O que o revendedor NAO pode receber a cada montagem de tela: os SVGs (peso,
   * sem ganho — as imagens ja sao servidas por URL) e os dados de repasse, que
   * sao de quem recebe dinheiro e so o superadmin le (decisao 6).
   */
  it("a marca do /me nao carrega repasse nem SVG", async () => {
    storageMock.getUser.mockResolvedValue({ ...RENATA });
    storageMock.getMarca.mockResolvedValue({
      ...CREDNET,
      logoSvg: "<svg id='logo'/>",
      faviconSvg: "<svg id='favicon'/>",
      ogImagePng: "data:image/png;base64,AAAA",
    });
    sessao = { userId: 3, providerId: 0, role: "revendedor", marcaId: 7, hostLogin: "app.crednet.com.br" };

    const bruto = await (await me()).text();

    for (const proibido of [
      "logoSvg", "logoPng", "faviconSvg", "ogImagePng",
      "repasseRazaoSocial", "repasseCnpj", "repasseChavePix", "repasseEmail",
      "pix@crednet.com.br", "12345678000199", "<svg",
    ]) {
      expect(bruto, proibido).not.toContain(proibido);
    }
  });

  // A sessao e a autoridade sobre o tenant, aqui como no `provider` — a coluna
  // e so a reserva. Uma sessao apontando para outra marca nao le a coluna.
  it("a marca vem da SESSAO, nao da coluna do usuario", async () => {
    storageMock.getUser.mockResolvedValue({ ...RENATA, marcaId: 9 });
    sessao = { userId: 3, providerId: 0, role: "revendedor", marcaId: 7, hostLogin: "app.crednet.com.br" };

    const corpo = await (await me()).json();

    expect(corpo.marca.id).toBe(7);
  });

  it("REGRESSAO — o /me do admin de provedor sai igual ao de antes da fase 1", async () => {
    storageMock.getUser.mockResolvedValue({ ...ANA_ADMIN });
    sessao = { userId: 5, providerId: 5, role: "admin", marcaId: 7, hostLogin: "app.crednet.com.br" };

    const corpo = await (await me()).json();

    expect(Object.keys(corpo).sort()).toEqual(
      ["mustChangePassword", "partnerCode", "personificando", "provider", "user"],
    );
    expect(corpo).not.toHaveProperty("marca");
    expect(corpo.provider.id).toBe(5);
    expect(typeof corpo.partnerCode).toBe("string");
    expect(corpo.personificando).toBe(false);
    // Nem consulta a tabela de marcas: o provedor recebe a pele pelo
    // `window.__MARCA__` do HTML, resolvido por host.
    expect(storageMock.getMarca).not.toHaveBeenCalled();
  });

  it("REGRESSAO — o /me do superadmin sai igual ao de antes da fase 1", async () => {
    storageMock.getUser.mockResolvedValue({
      id: 9, email: "root@consultaisp.com.br", name: "Root", role: "superadmin",
      providerId: null, marcaId: null, mustChangePassword: false,
    });
    sessao = { userId: 9, providerId: 0, role: "superadmin" };

    const corpo = await (await me()).json();

    expect(Object.keys(corpo).sort()).toEqual(
      ["mustChangePassword", "partnerCode", "personificando", "provider", "user"],
    );
    expect(corpo).not.toHaveProperty("marca");
    expect(corpo.provider).toBeNull();
    expect(corpo.partnerCode).toBeNull();
    expect(storageMock.getProvider).not.toHaveBeenCalled();
    expect(storageMock.getMarca).not.toHaveBeenCalled();
  });
});
