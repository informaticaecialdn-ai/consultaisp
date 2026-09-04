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
  getMarca: vi.fn(async (): Promise<any> => undefined),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../db", () => ({ db: {}, pool: {} }));

const marcaMock = vi.hoisted(() => ({
  hostPertenceAoProvider: vi.fn(async () => true),
  hostPertenceAMarca: vi.fn(async () => true),
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
  // Gatilhos de outros handlers do mesmo arquivo. Declarados para o mock nao
  // ficar mais estreito que o modulo real — quem os mede e
  // auth-email-gatilhos.test.ts.
  sendWelcomeEmail: vi.fn(async () => undefined),
  sendPasswordChangedEmail: vi.fn(async () => undefined),
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
  marcaMock.hostPertenceAMarca.mockResolvedValue(true);
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

/**
 * O TERCEIRO RAMO DO LOGIN.
 *
 * Aqui se mede a LIGACAO: que o revendedor e provado por `hostPertenceAMarca` e
 * nao pela prova do provedor, que a sessao nasce com a marca DO USUARIO, e que a
 * recusa e o mesmo 401 generico dos outros dois ramos. A regra de host em si —
 * marca A x marca B, marca inativa, raiz, subdominio de provedor — e medida com
 * o servico de verdade em `auth-revendedor.test.ts`; aqui ele e um duble, de
 * proposito, para o desvio de fluxo ficar isolado.
 */
describe("POST /api/auth/login — revendedor", () => {
  const REVENDEDOR = {
    id: 3,
    email: "dono@nslink.com.br",
    name: "Renata Revendedora",
    password: "hash",
    role: "revendedor",
    providerId: null,
    marcaId: 7,
    emailVerified: true,
    mustChangePassword: false,
  };

  const MARCA = {
    id: 7,
    slug: "crednet",
    nomeProduto: "CredNet",
    dominio: "app.crednet.com.br",
    dominioStatus: "ativo",
    revendaAtiva: true,
    comissaoPercentual: "20.00",
    // O que NAO pode sair daqui, deliberadamente presente na linha do banco.
    logoSvg: "<svg/>",
    logoPng: "data:image/png;base64,AAAA",
    faviconSvg: "<svg/>",
    ogImagePng: "data:image/png;base64,BBBB",
    repasseRazaoSocial: "CredNet Servicos LTDA",
    repasseCnpj: "12345678000199",
    repasseChavePix: "chave-pix-do-revendedor",
    repasseEmail: "financeiro@crednet.com.br",
  };

  it("entra pelo dominio da propria marca e a sessao nasce com a marca DO USUARIO", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...REVENDEDOR });
    storageMock.getMarca.mockResolvedValue({ ...MARCA });

    const res = await login();

    expect(res.status).toBe(200);
    expect(marcaMock.hostPertenceAMarca).toHaveBeenCalledWith(expect.anything(), 7);
    // A prova do PROVEDOR nao roda: ele nao tem provedor a provar.
    expect(marcaMock.hostPertenceAoProvider).not.toHaveBeenCalled();
    expect(sessao.marcaId).toBe(7);
    expect(sessao.providerId).toBe(0);
    expect(sessao.role).toBe("revendedor");
    expect(sessao.hostLogin).toBeTruthy();
  });

  /**
   * A linha era `provider?.marcaId`, e para o revendedor `provider` e null: a
   * sessao nasceria sem marca e sem provedor, e `requireRevendedor` a recusaria
   * em tudo. A pessoa acertaria senha e dominio e ficaria trancada por dentro.
   */
  it("a marca da sessao NAO vem do provedor — ele nao tem provedor", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...REVENDEDOR });
    storageMock.getMarca.mockResolvedValue({ ...MARCA });

    await login();

    expect(storageMock.getProvider).not.toHaveBeenCalled();
    expect(sessao.marcaId).toBe(7);
  });

  it("401 generico quando o host nao prova a marca — nunca 'essa conta e de outra marca'", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...REVENDEDOR });
    marcaMock.hostPertenceAMarca.mockResolvedValue(false);

    const res = await login();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "Email ou senha incorretos" });
    expect(sessao.userId).toBeUndefined();
    expect(storageMock.getMarca).not.toHaveBeenCalled();
  });

  it("revendedor sem marca na coluna e recusado, sem virar sessao sem tenant", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...REVENDEDOR, marcaId: null });
    marcaMock.hostPertenceAMarca.mockResolvedValue(false);

    const res = await login();

    expect(res.status).toBe(401);
    expect(marcaMock.hostPertenceAMarca).toHaveBeenCalledWith(expect.anything(), null);
    expect(sessao.userId).toBeUndefined();
  });

  it("a resposta traz a marca enxuta e provider null", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...REVENDEDOR });
    storageMock.getMarca.mockResolvedValue({ ...MARCA });

    const corpo = await (await login()).json();

    expect(corpo.provider).toBeNull();
    expect(corpo.marca).toEqual({
      id: 7,
      nomeProduto: "CredNet",
      slug: "crednet",
      dominio: "app.crednet.com.br",
      dominioStatus: "ativo",
      revendaAtiva: true,
      // `numeric(5,2)` chega como string do driver; na tela "20.00%" seria feio
      // e "20%" e o que o revendedor negociou.
      comissaoPercentual: 20,
    });
  });

  it("a marca enxuta nao carrega repasse nem SVG", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...REVENDEDOR });
    storageMock.getMarca.mockResolvedValue({ ...MARCA });

    const bruto = await (await login()).text();

    for (const proibido of [
      "logoSvg", "logoPng", "faviconSvg", "ogImagePng",
      "repasseRazaoSocial", "repasseCnpj", "repasseChavePix", "repasseEmail",
      "chave-pix-do-revendedor", "12345678000199",
    ]) {
      expect(bruto, proibido).not.toContain(proibido);
    }
  });

  // A promessa do outro lado: quem ja usava o sistema recebe o mesmo payload de
  // ontem, sem uma chave `marca` a mais para o client ter de ignorar.
  it("o login de admin de provedor continua sem a chave `marca`", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ ...USUARIO_BASE });
    storageMock.getProvider.mockResolvedValue({ id: 7, subdomain: "nslink", marcaId: 4, status: "active" });

    const corpo = await (await login()).json();

    expect(corpo).not.toHaveProperty("marca");
    expect(storageMock.getMarca).not.toHaveBeenCalled();
    expect(sessao.marcaId).toBe(4);
  });
});
