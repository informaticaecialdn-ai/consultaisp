/**
 * De qual marca sai o e-mail de reenvio de verificacao e o de "esqueci minha
 * senha" — e para onde o link aponta.
 *
 * Os dois resolviam a marca pelo HOST DA REQUISICAO. Sao coisas diferentes:
 * quem pede reenvio pelo endereco da plataforma, ou por um dominio de marca que
 * nao e o dele, recebia um e-mail com a cara errada. Pior, o link saia da base
 * da marca — e sem dominio de marca ativo essa base e a RAIZ da plataforma, que
 * e exatamente onde `hostPertenceAoProvider` recusa o login. O usuario clicava,
 * digitava a senha e ouvia "Email ou senha incorretos", sem motivo aparente.
 *
 * A regra agora: marca e endereco saem do PROVEDOR dono da conta.
 *
 * Arquivo separado de propósito — cobre so estes dois handlers de
 * auth.routes.ts, e nao o login.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "segredo-de-teste";
  delete process.env.APP_URL;
  delete process.env.MAIN_DOMAIN;
});

const storageMock = vi.hoisted(() => ({
  getUserByEmail: vi.fn(async (_e: string): Promise<any> => undefined),
  getUserByPhone: vi.fn(async (_p: string): Promise<any> => undefined),
  getProvider: vi.fn(async (_id: number): Promise<any> => undefined),
  getProviderByCnpj: vi.fn(async (_c: string): Promise<any> => undefined),
  getProviderBySubdomain: vi.fn(async (_s: string): Promise<any> => undefined),
  createProvider: vi.fn(async (_d: any): Promise<any> => undefined),
  createUser: vi.fn(async (_d: any): Promise<any> => ({ id: 3 })),
  createProviderPartner: vi.fn(async (_d: any): Promise<any> => undefined),
  getMarca: vi.fn(async (_id: number): Promise<any> => undefined),
  setVerificationToken: vi.fn(async () => undefined),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

const emailMock = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(async () => undefined),
  sendPasswordResetEmail: vi.fn(async () => undefined),
  // Estes dois handlers nao os disparam, mas `auth.routes.ts` importa os quatro
  // no topo — o mock precisa cobrir o modulo inteiro. Quem os mede e
  // auth-email-gatilhos.test.ts.
  sendWelcomeEmail: vi.fn(async () => undefined),
  sendPasswordChangedEmail: vi.fn(async () => undefined),
}));
vi.mock("../services/email", () => emailMock);

// O limitador guarda estado entre chamadas e derrubaria o quarto pedido do
// arquivo com 429; o que se mede aqui nao e ele.
vi.mock("../middleware/rate-limiter.middleware", () => ({
  createRateLimiter: () => (_r: any, _s: any, n: any) => n(),
}));

const dbMock = vi.hoisted(() => ({
  update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
}));
vi.mock("../db", () => ({ db: dbMock, pool: {} }));

import { registerAuthRoutes } from "./auth.routes";
import { esquecerMarcas } from "../services/marca.service";

let server: Server;
let base: string;

const CREDNET = {
  id: 7, slug: "crednet", ativo: true, nomeProduto: "CredNet", assinatura: null,
  dominio: "app.crednet.com.br", dominioStatus: "ativo",
  logoSvg: null, logoPng: null, faviconSvg: null,
  corBrand: "#1F6F7A", corBrandDark: null,
  emailRemetente: null, emailNomeExibicao: null,
  suporteEmail: null, suporteWhatsapp: null, site: null,
  responsavelRazaoSocial: null, responsavelCnpj: null, createdAt: new Date(),
};

const USUARIO = {
  id: 3, email: "ana@nslink.com.br", name: "Ana", password: "hash",
  role: "admin", providerId: 42, emailVerified: false,
};

/** O provedor da CredNet; sem marca, e so um provedor com subdominio. */
const PROVEDOR_DA_CREDNET = { id: 42, subdomain: "nslink", marcaId: 7 };
const PROVEDOR_SEM_MARCA = { id: 42, subdomain: "nslink", marcaId: null };

async function pedir(rota: string, corpo: unknown, host = "consultaisp.com.br") {
  return fetch(`${base}${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: host },
    body: JSON.stringify(corpo),
  });
}

/** (marca, urlBase) com que o e-mail foi montado. */
function argumentosDe(fn: { mock: { calls: any[][] } }) {
  const chamada = fn.mock.calls[0] ?? [];
  return { marca: chamada[3], urlBase: chamada[4] };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = {}; next(); });
  app.use(registerAuthRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  esquecerMarcas();
  storageMock.getUserByEmail.mockResolvedValue(USUARIO);
  storageMock.getProvider.mockResolvedValue(PROVEDOR_DA_CREDNET);
  storageMock.getMarca.mockResolvedValue(CREDNET);
});

describe("POST /api/auth/resend-verification", () => {
  it("usa a marca do PROVEDOR, mesmo pedida do host da plataforma", async () => {
    const res = await pedir("/api/auth/resend-verification", { email: USUARIO.email }, "consultaisp.com.br");
    expect(res.status).toBe(200);

    const { marca, urlBase } = argumentosDe(emailMock.sendVerificationEmail);
    expect(marca.marcaId).toBe(7);
    expect(marca.nomeProduto).toBe("CredNet");
    expect(urlBase).toBe("https://app.crednet.com.br");
    // A marca veio do provedor, nao de uma busca por host.
    expect(storageMock.getProvider).toHaveBeenCalledWith(42);
  });

  it("nao herda a marca do host de onde o pedido veio", async () => {
    // Mesmo pedido, feito de dentro do dominio de OUTRA marca.
    storageMock.getProvider.mockResolvedValue(PROVEDOR_SEM_MARCA);
    await pedir("/api/auth/resend-verification", { email: USUARIO.email }, "portal.rival.com.br");

    const { marca, urlBase } = argumentosDe(emailMock.sendVerificationEmail);
    expect(marca.marcaId).toBeNull();
    expect(marca.nomeProduto).toBe("Consulta ISP");
    expect(urlBase).toBe("https://nslink.consultaisp.com.br");
  });

  it("sem dominio de marca ativo o link vai para o SUBDOMINIO, nunca para a raiz", async () => {
    storageMock.getMarca.mockResolvedValue({ ...CREDNET, dominioStatus: "pendente" });
    await pedir("/api/auth/resend-verification", { email: USUARIO.email });

    const { marca, urlBase } = argumentosDe(emailMock.sendVerificationEmail);
    // A pele continua sendo a da marca; so o endereco muda.
    expect(marca.nomeProduto).toBe("CredNet");
    expect(urlBase).toBe("https://nslink.consultaisp.com.br");
  });

  it("e-mail ja verificado nao dispara nada", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...USUARIO, emailVerified: true });
    const res = await pedir("/api/auth/resend-verification", { email: USUARIO.email });
    expect(res.status).toBe(200);
    expect(emailMock.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("conta inexistente responde igual e nao vaza que ela nao existe", async () => {
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    const res = await pedir("/api/auth/resend-verification", { email: "ninguem@x.com" });
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/Se esse email existir/);
    expect(emailMock.sendVerificationEmail).not.toHaveBeenCalled();
  });
});

/**
 * O e-mail do CADASTRO ficou de fora quando `urlDeEntrada` foi criada: seguia
 * montando o link pela marca do HOST. Sem dominio de marca ativo, essa base e a
 * RAIZ da plataforma — exatamente onde `hostPertenceAoProvider` recusa o login
 * de todo usuario nao-superadmin. Quem se cadastrava pela landing confirmava o
 * e-mail, era mandado para /login no mesmo host e ouvia "Email ou senha
 * incorretos". O provedor recem-cadastrado nao entrava.
 */
describe("POST /api/auth/register", () => {
  const CADASTRO = {
    email: "novo@nslink.com.br", password: "senha-boa-123", name: "Ana Nova",
    phone: "34999998888", responsavelCpf: "04117982940",
    providerName: "NSLink", cnpj: "11222333000181", subdomain: "nslink",
    lgpdAccepted: true,
  };

  beforeEach(() => {
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    storageMock.getUserByPhone.mockResolvedValue(undefined);
    storageMock.getProviderByCnpj.mockResolvedValue(undefined);
    storageMock.getProviderBySubdomain.mockResolvedValue(undefined);
    storageMock.createProvider.mockResolvedValue({ id: 42, subdomain: "nslink", marcaId: null });
    storageMock.createUser.mockResolvedValue({ id: 3, email: CADASTRO.email });
  });

  it("o link do e-mail leva ao SUBDOMINIO do provedor, nunca a raiz da plataforma", async () => {
    const res = await pedir("/api/auth/register", CADASTRO, "consultaisp.com.br");
    expect(res.status).toBe(201);

    const { urlBase } = argumentosDe(emailMock.sendVerificationEmail);
    expect(urlBase).toBe("https://nslink.consultaisp.com.br");
    expect(urlBase).not.toBe("https://consultaisp.com.br");
  });

  // Mesmo cadastro feito de dentro do dominio de uma marca que nao e a dele: o
  // provedor nasce sem marca (vincular marca no cadastro e assunto da fase 1),
  // entao o unico endereco onde ele consegue entrar e o subdominio.
  it("cadastro por dominio de outra marca tambem aponta para onde ele entra", async () => {
    const res = await pedir("/api/auth/register", CADASTRO, "app.crednet.com.br");
    expect(res.status).toBe(201);

    const { marca, urlBase } = argumentosDe(emailMock.sendVerificationEmail);
    expect(marca.marcaId).toBeNull();
    expect(urlBase).toBe("https://nslink.consultaisp.com.br");
  });

  it("provedor ja com marca de dominio ativo recebe o link da marca", async () => {
    storageMock.createProvider.mockResolvedValue({ id: 42, subdomain: "nslink", marcaId: 7 });

    await pedir("/api/auth/register", CADASTRO, "consultaisp.com.br");

    const { marca, urlBase } = argumentosDe(emailMock.sendVerificationEmail);
    expect(marca.nomeProduto).toBe("CredNet");
    expect(urlBase).toBe("https://app.crednet.com.br");
  });
});

describe("POST /api/auth/forgot-password", () => {
  it("marca e link saem do provedor, nao do host", async () => {
    const res = await pedir("/api/auth/forgot-password", { email: USUARIO.email }, "consultaisp.com.br");
    expect(res.status).toBe(200);

    const { marca, urlBase } = argumentosDe(emailMock.sendPasswordResetEmail);
    expect(marca.marcaId).toBe(7);
    expect(urlBase).toBe("https://app.crednet.com.br");
  });

  it("provedor sem marca recebe o link do proprio subdominio", async () => {
    storageMock.getProvider.mockResolvedValue(PROVEDOR_SEM_MARCA);
    await pedir("/api/auth/forgot-password", { email: USUARIO.email }, "app.crednet.com.br");

    const { marca, urlBase } = argumentosDe(emailMock.sendPasswordResetEmail);
    expect(marca.marcaId).toBeNull();
    expect(urlBase).toBe("https://nslink.consultaisp.com.br");
  });

  it("conta inexistente responde a mesma coisa e nao manda e-mail", async () => {
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    const res = await pedir("/api/auth/forgot-password", { email: "ninguem@x.com" });
    expect(res.status).toBe(200);
    expect(emailMock.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
