/**
 * Quais e-mails saem do fluxo de conta, para QUEM, com QUE dados e QUANTAS
 * vezes.
 *
 * Dois gatilhos existiam so no papel:
 *
 * - BOAS-VINDAS. `sendWelcomeEmail` estava escrito e ninguem chamava. A conta
 *   ficava ativa em silencio, e o unico e-mail que o provedor guardaria — o que
 *   diz por qual endereco ele entra e com qual login — nunca chegava.
 *
 * - SENHA ALTERADA. Trocar a senha nao avisava ninguem. E o unico sinal que o
 *   dono da conta tem de que alguem a tomou: quem invade troca a senha, e sem o
 *   aviso ele so descobre quando tenta entrar e nao consegue.
 *
 * O que estes testes cravam, alem de "saiu": que saiu UMA vez (o link de
 * verificacao e clicado duas vezes o tempo todo), que foi para a PESSOA e nao
 * para o contato do provedor, e que uma falha de envio nao derruba a operacao —
 * a conta ja esta ativa e a senha ja mudou quando o e-mail sai.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "segredo-de-teste";
});

const storageMock = vi.hoisted(() => ({
  getUserByEmail: vi.fn(async (): Promise<any> => undefined),
  getUserByVerificationToken: vi.fn(async (): Promise<any> => undefined),
  setEmailVerified: vi.fn(async (_id: number) => undefined),
  getProvider: vi.fn(async (): Promise<any> => undefined),
  getUser: vi.fn(async (): Promise<any> => undefined),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

const emailMock = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(async () => undefined),
  sendPasswordResetEmail: vi.fn(async () => undefined),
  sendWelcomeEmail: vi.fn(async () => undefined),
  sendPasswordChangedEmail: vi.fn(async () => undefined),
}));
vi.mock("../services/email", () => emailMock);

const MARCA = { marcaId: null, origem: "plataforma", nomeProduto: "Consulta ISP" };
const marcaMock = vi.hoisted(() => ({
  hostPertenceAoProvider: vi.fn(async () => true),
  resolverMarcaPorHost: vi.fn(async () => ({ marcaId: null, origem: "plataforma" })),
  resolverMarcaPorId: vi.fn(async () => ({ marcaId: null, origem: "plataforma", nomeProduto: "Consulta ISP" })),
  urlDeEntrada: vi.fn(() => "https://nslink.consultaisp.com.br"),
}));
vi.mock("../services/marca.service", () => marcaMock);

// O limitador guarda estado entre chamadas e derrubaria os ultimos pedidos do
// arquivo com 429. Ele tem arquivo proprio — auth-rate-limit.test.ts.
vi.mock("../middleware/rate-limiter.middleware", () => ({
  createRateLimiter: () => (_r: any, _s: any, n: any) => n(),
}));

vi.mock("../password", () => ({
  hashPassword: vi.fn(async (s: string) => `hash:${s}`),
  verifyPassword: vi.fn(async () => true),
}));

/** `reset-password` e `change-password` falam com o Drizzle direto. */
const dbMock = vi.hoisted(() => {
  const estado: { usuarioDoToken: any; gravado: any[] } = { usuarioDoToken: null, gravado: [] };
  return {
    estado,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (estado.usuarioDoToken ? [estado.usuarioDoToken] : []),
        }),
      }),
    }),
    update: () => ({
      set: (valores: any) => ({
        where: async () => { estado.gravado.push(valores); },
      }),
    }),
  };
});
vi.mock("../db", () => ({ db: dbMock, pool: {} }));

import { registerAuthRoutes } from "./auth.routes";

let server: Server;
let base: string;
let sessao: Record<string, any>;

const PROVEDOR = {
  id: 7,
  name: "NsLink Telecom",
  cnpj: "12345678000199",
  plan: "pro",
  ispCredits: 250,
  marcaId: null,
  subdomain: "nslink",
  status: "active",
};

const USUARIO = {
  id: 42,
  email: "dono@nslink.com.br",
  name: "Ana",
  password: "hash",
  role: "admin",
  providerId: 7,
  emailVerified: false,
  verificationTokenExpiresAt: null as Date | null,
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
  sessao = {};
  dbMock.estado.usuarioDoToken = null;
  dbMock.estado.gravado = [];
  storageMock.getProvider.mockResolvedValue({ ...PROVEDOR });
  marcaMock.resolverMarcaPorId.mockResolvedValue({ ...MARCA } as any);
  marcaMock.urlDeEntrada.mockReturnValue("https://nslink.consultaisp.com.br");
});

const verificar = (token = "tok-valido") =>
  fetch(`${base}/api/auth/verify-email?token=${token}`);

describe("GET /api/auth/verify-email — boas-vindas", () => {
  it("manda para quem CONFIRMOU, com os dados reais do cadastro", async () => {
    storageMock.getUserByVerificationToken.mockResolvedValue({ ...USUARIO });

    const res = await verificar();

    expect(res.status).toBe(200);
    expect(storageMock.setEmailVerified).toHaveBeenCalledWith(42);
    expect(emailMock.sendWelcomeEmail).toHaveBeenCalledTimes(1);

    const [para, dados, marca, urlBase] = emailMock.sendWelcomeEmail.mock.calls[0] as any[];
    // Para a PESSOA que acabou de confirmar, nao para o contato do provedor:
    // quem esta com a tela aberta e ela.
    expect(para).toBe("dono@nslink.com.br");
    expect(dados).toEqual({
      nome: "Ana",
      provedor: "NsLink Telecom",
      cnpj: "12345678000199",
      plano: "Profissional",
      creditos: 250,
      emailDeAcesso: "dono@nslink.com.br",
    });
    expect(marca).toEqual(MARCA);
    expect(urlBase).toBe("https://nslink.consultaisp.com.br");
  });

  /** "pro" cru na tela e vazamento de chave de banco para o cliente. */
  it("o plano vai em portugues, nunca a chave crua", async () => {
    for (const [plan, rotulo] of [["free", "Gratuito"], ["basic", "Básico"], ["enterprise", "Enterprise"]]) {
      vi.clearAllMocks();
      storageMock.getProvider.mockResolvedValue({ ...PROVEDOR, plan });
      storageMock.getUserByVerificationToken.mockResolvedValue({ ...USUARIO });

      await verificar();

      expect((emailMock.sendWelcomeEmail.mock.calls[0] as any[])[1].plano, `plano ${plan}`).toBe(rotulo);
    }
  });

  /**
   * A trava de verdade e `setEmailVerified` zerar o token — o segundo clique
   * nem acha usuario. Este e o outro caminho: linha que chega ja verificada e
   * ainda com token.
   */
  it("conta ja verificada responde sucesso e NAO manda boas-vindas de novo", async () => {
    storageMock.getUserByVerificationToken.mockResolvedValue({ ...USUARIO, emailVerified: true });

    const res = await verificar();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ verified: true });
    expect(emailMock.sendWelcomeEmail).not.toHaveBeenCalled();
    expect(storageMock.setEmailVerified).not.toHaveBeenCalled();
  });

  it("token invalido nao ativa nem manda nada", async () => {
    storageMock.getUserByVerificationToken.mockResolvedValue(undefined);

    const res = await verificar("tok-que-nao-existe");

    expect(res.status).toBe(400);
    expect(emailMock.sendWelcomeEmail).not.toHaveBeenCalled();
    expect(storageMock.setEmailVerified).not.toHaveBeenCalled();
  });

  it("token expirado nao ativa nem manda nada", async () => {
    storageMock.getUserByVerificationToken.mockResolvedValue({
      ...USUARIO,
      verificationTokenExpiresAt: new Date(Date.now() - 1000),
    });

    const res = await verificar();

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("TOKEN_EXPIRED");
    expect(emailMock.sendWelcomeEmail).not.toHaveBeenCalled();
    expect(storageMock.setEmailVerified).not.toHaveBeenCalled();
  });

  /** A conta ja esta ativa quando o e-mail sai. Resend fora do ar nao desfaz. */
  it("falha no envio nao derruba a ativacao", async () => {
    storageMock.getUserByVerificationToken.mockResolvedValue({ ...USUARIO });
    emailMock.sendWelcomeEmail.mockRejectedValueOnce(new Error("Resend fora do ar"));

    const res = await verificar();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ verified: true });
    expect(storageMock.setEmailVerified).toHaveBeenCalledWith(42);
  });

  /** O e-mail inteiro fala do provedor. Sem provedor, nao ha o que dizer. */
  it("usuario sem provedor e ativado, mas sem boas-vindas", async () => {
    storageMock.getUserByVerificationToken.mockResolvedValue({ ...USUARIO, providerId: null });

    const res = await verificar();

    expect(res.status).toBe(200);
    expect(storageMock.setEmailVerified).toHaveBeenCalledWith(42);
    expect(emailMock.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});

/**
 * O cliente mandava para `/login` no host atual. Aberto pelo dominio da
 * plataforma, esse login e recusado por desenho e o usuario le "Email ou senha
 * incorretos" sem ter errado nada. Quem sabe por onde este provedor entra e o
 * servidor.
 */
describe("GET /api/auth/verify-email — para onde mandar depois", () => {
  it("devolve o endereco de entrada do provedor", async () => {
    storageMock.getUserByVerificationToken.mockResolvedValue({ ...USUARIO });
    marcaMock.urlDeEntrada.mockReturnValue("https://app.crednet.com.br");

    const res = await verificar();

    expect(await res.json()).toEqual({
      verified: true,
      email: "dono@nslink.com.br",
      urlDeEntrada: "https://app.crednet.com.br",
    });
  });

  it("o endereco sai do PROVEDOR do dono do token, nao do host do pedido", async () => {
    storageMock.getUserByVerificationToken.mockResolvedValue({ ...USUARIO });

    await verificar();

    expect(marcaMock.resolverMarcaPorId).toHaveBeenCalledWith(null);
    expect(marcaMock.urlDeEntrada).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, subdomain: "nslink" }),
      expect.anything(),
    );
  });
});

describe("POST /api/auth/reset-password — aviso de senha alterada", () => {
  const redefinir = (body: any = { token: "reset-tok", newPassword: "senha-nova-123" }) =>
    fetch(`${base}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("avisa o DONO da conta, uma vez, com a marca do provedor dele", async () => {
    dbMock.estado.usuarioDoToken = { ...USUARIO, resetTokenExpiresAt: null };

    const res = await redefinir();

    expect(res.status).toBe(200);
    expect(emailMock.sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
    expect(emailMock.sendPasswordChangedEmail).toHaveBeenCalledWith(
      "dono@nslink.com.br",
      "Ana",
      MARCA,
      "https://nslink.consultaisp.com.br",
    );
  });

  it("nao avisa quando o token nao vale — a senha nao mudou", async () => {
    dbMock.estado.usuarioDoToken = null;

    const res = await redefinir();

    expect(res.status).toBe(400);
    expect(emailMock.sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it("nao avisa quando o token expirou", async () => {
    dbMock.estado.usuarioDoToken = {
      ...USUARIO,
      resetTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    };

    const res = await redefinir();

    expect(res.status).toBe(400);
    expect(emailMock.sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  /** A senha JA mudou quando o aviso sai. Falhar em avisar nao a desfaz. */
  it("falha no envio nao derruba a troca de senha", async () => {
    dbMock.estado.usuarioDoToken = { ...USUARIO, resetTokenExpiresAt: null };
    emailMock.sendPasswordChangedEmail.mockRejectedValueOnce(new Error("Resend fora do ar"));

    const res = await redefinir();

    expect(res.status).toBe(200);
    expect(dbMock.estado.gravado[0]).toMatchObject({ password: "hash:senha-nova-123" });
  });
});

describe("POST /api/auth/change-password — aviso de senha alterada", () => {
  const trocar = () =>
    fetch(`${base}/api/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: "outra-senha-456" }),
    });

  it("avisa o dono da sessao, uma vez", async () => {
    sessao.userId = 42;
    storageMock.getUser.mockResolvedValue({ ...USUARIO });

    const res = await trocar();

    expect(res.status).toBe(200);
    expect(emailMock.sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
    expect(emailMock.sendPasswordChangedEmail).toHaveBeenCalledWith(
      "dono@nslink.com.br",
      "Ana",
      MARCA,
      "https://nslink.consultaisp.com.br",
    );
  });

  it("sem sessao nao troca nem avisa", async () => {
    const res = await trocar();

    expect(res.status).toBe(401);
    expect(emailMock.sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it("senha curta e recusada antes de qualquer aviso", async () => {
    sessao.userId = 42;

    const res = await fetch(`${base}/api/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: "123" }),
    });

    expect(res.status).toBe(400);
    expect(emailMock.sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it("falha no envio nao derruba a troca de senha", async () => {
    sessao.userId = 42;
    storageMock.getUser.mockResolvedValue({ ...USUARIO });
    emailMock.sendPasswordChangedEmail.mockRejectedValueOnce(new Error("Resend fora do ar"));

    const res = await trocar();

    expect(res.status).toBe(200);
    expect(dbMock.estado.gravado[0]).toMatchObject({ password: "hash:outra-senha-456" });
  });
});
