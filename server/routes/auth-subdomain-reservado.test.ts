import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * `sandbox-` é convenção de texto, não namespace reservado — até esta rodada
 * de correção. `registerSchema.subdomain` (shared/schema.ts) só exige
 * `/^[a-z0-9-]+$/` com 3-30 caracteres, e nem `/api/auth/register` nem
 * `/api/auth/check-subdomain` recusavam um provedor pagante escolhendo
 * `sandbox-alguma-coisa`. Isso importa porque `sandboxesExpirados`
 * (server/demo/sandbox.service.ts) identifica o que a limpeza da demonstração
 * apaga SÓ pelo prefixo — sem a reserva, essa conta de verdade seria apagada
 * pela varredura, sem esbarrar em nenhuma guarda de LGPD.
 *
 * `PREFIXO_SANDBOX` é importado de VERDADE aqui (não mockado): o que se prova
 * é que `auth.routes.ts` recusa exatamente o prefixo que `sandbox.service.ts`
 * usa para decidir o que apagar — os dois lados da mesma convenção, um teste
 * que cairia se algum dia divergissem.
 */
const storageMock = vi.hoisted(() => ({
  getUserByEmail: vi.fn(async (): Promise<any> => null),
  getUserByPhone: vi.fn(async (): Promise<any> => null),
  getProviderBySubdomain: vi.fn(async (): Promise<any> => null),
  getProviderByCnpj: vi.fn(async (): Promise<any> => null),
  createProvider: vi.fn(async (dados: any): Promise<any> => ({ id: 1, marcaId: null, ...dados })),
  createUser: vi.fn(async (dados: any): Promise<any> => ({ id: 10, ...dados })),
  createProviderPartner: vi.fn(async (dados: any): Promise<any> => ({ id: 20, ...dados })),
  setVerificationToken: vi.fn(async () => undefined),
  getProvider: vi.fn(async (): Promise<any> => null),
  getUser: vi.fn(async (): Promise<any> => null),
  getMarca: vi.fn(async (): Promise<any> => null),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../db", () => ({ db: {} }));
vi.mock("../password", () => ({
  hashPassword: vi.fn(async (s: string) => `hash:${s}`),
  verifyPassword: vi.fn(async () => false),
}));
vi.mock("../services/email", () => ({
  sendVerificationEmail: vi.fn(async () => undefined),
  sendWelcomeEmail: vi.fn(async () => undefined),
  sendPasswordChangedEmail: vi.fn(async () => undefined),
}));
vi.mock("../services/marca.service", () => ({
  hostPertenceAoProvider: vi.fn(async () => true),
  hostPertenceAMarca: vi.fn(async () => true),
  resolverMarcaPorId: vi.fn(async () => ({ marcaId: null, nomeProduto: "Consulta ISP" })),
  urlDeEntrada: vi.fn(() => "https://exemplo.consultaisp.com.br"),
}));
vi.mock("../auth", () => ({
  MENSAGEM_PROVEDOR_SUSPENSO: "Acesso suspenso",
  encerrarPersonificacao: vi.fn(),
}));
vi.mock("../middleware/rate-limiter.middleware", () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
  chaveDoLimite: () => "teste",
}));

import { registerAuthRoutes } from "./auth.routes";
import { PREFIXO_SANDBOX } from "../demo/sandbox.service";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { save: (cb: (e?: any) => void) => cb() };
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
  storageMock.getUserByEmail.mockResolvedValue(null);
  storageMock.getUserByPhone.mockResolvedValue(null);
  storageMock.getProviderBySubdomain.mockResolvedValue(null);
  storageMock.getProviderByCnpj.mockResolvedValue(null);
  storageMock.createProvider.mockImplementation(async (dados: any) => ({ id: 1, marcaId: null, ...dados }));
  storageMock.createUser.mockImplementation(async (dados: any) => ({ id: 10, ...dados }));
  storageMock.createProviderPartner.mockImplementation(async (dados: any) => ({ id: 20, ...dados }));
});

const cadastro = (extra: Record<string, any> = {}) => ({
  email: "dono@provedor.com.br",
  password: "senha123",
  name: "Dono do Provedor",
  phone: "11999998888",
  responsavelCpf: "529.982.247-25", // CPF valido de exemplo da Receita
  providerName: "Provedor Exemplo",
  cnpj: "23864873000148",
  subdomain: "exemplo",
  lgpdAccepted: true,
  ...extra,
});

async function registrar(corpo: Record<string, any>) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, corpo: await res.json() };
}

async function checarSubdominio(subdomain: string) {
  const res = await fetch(`${base}/api/auth/check-subdomain?subdomain=${encodeURIComponent(subdomain)}`);
  return { status: res.status, corpo: await res.json() };
}

describe("PREFIXO_SANDBOX — a constante é a mesma dos dois lados", () => {
  it("é exatamente 'sandbox-', com o hífen", () => {
    expect(PREFIXO_SANDBOX).toBe("sandbox-");
  });
});

describe("GET /api/auth/check-subdomain — o prefixo reservado nunca chega ao banco", () => {
  it("subdominio comecando por sandbox- vem indisponivel, sem consultar storage", async () => {
    const { status, corpo } = await checarSubdominio(`${PREFIXO_SANDBOX}alguma-coisa`);

    expect(status).toBe(200);
    expect(corpo).toEqual({ available: false });
    expect(storageMock.getProviderBySubdomain).not.toHaveBeenCalled();
  });

  it("a reserva nao diferencia caixa — SANDBOX-Foo tambem e recusado", async () => {
    const { corpo } = await checarSubdominio("SANDBOX-Foo");

    expect(corpo).toEqual({ available: false });
    expect(storageMock.getProviderBySubdomain).not.toHaveBeenCalled();
  });

  it("so o prefixo com hifen e reservado — 'sandboxempresa' (sem hifen) segue para o banco", async () => {
    const { corpo } = await checarSubdominio("sandboxempresa");

    expect(storageMock.getProviderBySubdomain).toHaveBeenCalledWith("sandboxempresa");
    expect(corpo).toEqual({ available: true });
  });

  it("subdominio comum continua indo para o banco normalmente", async () => {
    storageMock.getProviderBySubdomain.mockResolvedValueOnce({ id: 9 });

    const { corpo } = await checarSubdominio("provedor-real");

    expect(storageMock.getProviderBySubdomain).toHaveBeenCalledWith("provedor-real");
    expect(corpo).toEqual({ available: false });
  });
});

describe("POST /api/auth/register — o prefixo reservado nunca vira provedor", () => {
  it("recusa com 400 e mensagem propria, sem consultar nem gravar nada", async () => {
    const { status, corpo } = await registrar(cadastro({ subdomain: `${PREFIXO_SANDBOX}empresa` }));

    expect(status).toBe(400);
    expect(corpo).toEqual({ message: "Subdominio reservado. Escolha outro." });
    expect(storageMock.getProviderBySubdomain).not.toHaveBeenCalled();
    expect(storageMock.createProvider).not.toHaveBeenCalled();
  });

  it("a mensagem e distinta do 409 generico de duplicidade — nao e colisao com dado existente", async () => {
    const { corpo } = await registrar(cadastro({ subdomain: `${PREFIXO_SANDBOX}empresa` }));

    expect(corpo.message).not.toBe("Dados ja cadastrados. Verifique email, telefone, CNPJ ou subdominio.");
  });

  it("um subdominio comum, fora do prefixo, continua cadastrando normalmente", async () => {
    const { status } = await registrar(cadastro({ subdomain: "provedor-de-verdade" }));

    expect(status).toBe(201);
    expect(storageMock.createProvider).toHaveBeenCalledTimes(1);
    expect(storageMock.createProvider.mock.calls[0][0]).toMatchObject({ subdomain: "provedor-de-verdade" });
  });
});
