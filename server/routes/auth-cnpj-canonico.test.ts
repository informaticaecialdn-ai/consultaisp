import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * O CNPJ que entra pelo cadastro publico tem UMA forma so no banco.
 *
 * O defeito que estes testes prendem: `POST /api/auth/register` validava o CNPJ
 * normalizado e depois procurava e gravava o texto COMO DIGITADO. Como a busca
 * de duplicidade e o indice UNIQUE comparam string exata, "23.864.873/0001-48"
 * e "23864873000148" eram duas inscricoes diferentes — a mesma empresa nascia
 * como dois provedores, cada um com metade da carteira.
 *
 * Por isso o espiao de `getProviderByCnpj` aqui e um Map de chave exata, e nao
 * um `mockResolvedValue`: ele erra do mesmo jeito que o Postgres erra. Se o
 * handler voltar a procurar pela forma mascarada, o Map devolve `undefined`, o
 * segundo cadastro passa e o teste cai — que e exatamente o que se quer medir.
 *
 * O rate limiter vira passe-livre: o cadastro real e 3 por hora por IP, e todos
 * estes casos saem do mesmo 127.0.0.1.
 */
const provedoresPorCnpj = vi.hoisted(() => new Map<string, any>());

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
  provedoresPorCnpj.clear();

  // O espiao imita o banco: igualdade EXATA de string, sem normalizar nada.
  storageMock.getProviderByCnpj.mockImplementation(async (valor: string) =>
    provedoresPorCnpj.get(valor)
  );
  // E o insert grava exatamente o que recebeu, na chave que recebeu — se o
  // handler mandar mascarado, a linha fica mascarada, como ficou em producao.
  storageMock.createProvider.mockImplementation(async (dados: any) => {
    const criado = { id: provedoresPorCnpj.size + 1, marcaId: null, ...dados };
    provedoresPorCnpj.set(dados.cnpj, criado);
    return criado;
  });
  storageMock.getUserByEmail.mockResolvedValue(null);
  storageMock.getUserByPhone.mockResolvedValue(null);
  storageMock.getProviderBySubdomain.mockResolvedValue(null);
  storageMock.createUser.mockImplementation(async (dados: any) => ({ id: 10, ...dados }));
  storageMock.createProviderPartner.mockImplementation(async (dados: any) => ({ id: 20, ...dados }));
});

/** CNPJ real da conferencia de producao (id 6), nas duas formas. */
const CNPJ_MASCARADO = "23.864.873/0001-48";
const CNPJ_CANONICO = "23864873000148";

/** Um segundo documento valido, para o caso "empresa diferente". */
const OUTRO_CANONICO = "22759562000156";

const cadastro = (extra: Record<string, any> = {}) => ({
  email: "dono@provedor.com.br",
  password: "senha123",
  name: "Dono do Provedor",
  phone: "11999998888",
  responsavelCpf: "529.982.247-25", // CPF valido de exemplo da Receita
  providerName: "Provedor Exemplo",
  cnpj: CNPJ_CANONICO,
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

describe("POST /api/auth/register — o CNPJ e gravado numa forma so", () => {
  it("grava 14 digitos quando o CNPJ chega mascarado", async () => {
    const { status } = await registrar(cadastro({ cnpj: CNPJ_MASCARADO }));

    expect(status).toBe(201);
    expect(storageMock.createProvider).toHaveBeenCalledTimes(1);
    expect(storageMock.createProvider.mock.calls[0][0]).toMatchObject({ cnpj: CNPJ_CANONICO });
  });

  it("grava o MESMO valor que o cadastro com CNPJ cru — as duas formas convergem", async () => {
    await registrar(cadastro({ cnpj: CNPJ_MASCARADO }));
    const gravadoMascarado = storageMock.createProvider.mock.calls[0][0].cnpj;

    provedoresPorCnpj.clear();
    storageMock.createProvider.mockClear();

    await registrar(cadastro({ cnpj: CNPJ_CANONICO }));
    const gravadoCru = storageMock.createProvider.mock.calls[0][0].cnpj;

    expect(gravadoMascarado).toBe(gravadoCru);
  });

  it("procura a duplicidade pelo canonico, e nao pelo texto digitado", async () => {
    await registrar(cadastro({ cnpj: CNPJ_MASCARADO }));

    expect(storageMock.getProviderByCnpj).toHaveBeenCalledWith(CNPJ_CANONICO);
  });
});

describe("POST /api/auth/register — o segundo cadastro do mesmo documento e recusado", () => {
  /**
   * As quatro combinacoes de formatacao entre o cadastro que ja existe e o que
   * chega. Todas tem de dar no mesmo lugar: 409 e nenhum provedor novo. E este
   * o caso que produziu o defeito — o par (cru gravado, mascarado digitado)
   * passava direto e criava a segunda conta da mesma empresa.
   */
  const combinacoes = [
    { primeiro: CNPJ_CANONICO, segundo: CNPJ_MASCARADO, nome: "gravado cru, digitado mascarado" },
    { primeiro: CNPJ_MASCARADO, segundo: CNPJ_CANONICO, nome: "gravado mascarado, digitado cru" },
    { primeiro: CNPJ_CANONICO, segundo: CNPJ_CANONICO, nome: "cru nos dois" },
    { primeiro: CNPJ_MASCARADO, segundo: CNPJ_MASCARADO, nome: "mascarado nos dois" },
  ];

  for (const { primeiro, segundo, nome } of combinacoes) {
    it(`recusa o segundo cadastro (${nome})`, async () => {
      const inicial = await registrar(cadastro({ cnpj: primeiro }));
      expect(inicial.status).toBe(201);
      storageMock.createProvider.mockClear();

      const repetido = await registrar(cadastro({
        cnpj: segundo,
        email: "outro@provedor.com.br",
        phone: "11888887777",
        subdomain: "outro",
      }));

      expect(repetido.status).toBe(409);
      expect(storageMock.createProvider).not.toHaveBeenCalled();
      // Uma linha so no "banco": a segunda tentativa nao criou nada.
      expect(provedoresPorCnpj.size).toBe(1);
    });
  }

  it("a recusa continua vaga — nao vira oraculo de quais CNPJs ja sao clientes", async () => {
    await registrar(cadastro({ cnpj: CNPJ_CANONICO }));

    const repetido = await registrar(cadastro({
      cnpj: CNPJ_MASCARADO,
      email: "outro@provedor.com.br",
      phone: "11888887777",
      subdomain: "outro",
    }));

    // A mesma frase generica dos outros conflitos (email, telefone, subdominio):
    // ela nao diz QUAL dado colidiu, de proposito.
    expect(repetido.corpo.message).toBe(
      "Dados ja cadastrados. Verifique email, telefone, CNPJ ou subdominio.",
    );
    expect(repetido.corpo.message).not.toContain(CNPJ_CANONICO);
    expect(repetido.corpo.message).not.toContain(CNPJ_MASCARADO);
  });

  it("empresa diferente com o mesmo formato continua entrando", async () => {
    await registrar(cadastro({ cnpj: CNPJ_MASCARADO }));
    storageMock.createProvider.mockClear();

    const outra = await registrar(cadastro({
      cnpj: OUTRO_CANONICO,
      email: "terceiro@provedor.com.br",
      phone: "11777776666",
      subdomain: "terceiro",
    }));

    expect(outra.status).toBe(201);
    expect(storageMock.createProvider.mock.calls[0][0]).toMatchObject({ cnpj: OUTRO_CANONICO });
  });
});

describe("POST /api/auth/register — o digito verificador vale nas duas formas", () => {
  it("recusa CNPJ mascarado com digito verificador errado", async () => {
    const { status, corpo } = await registrar(cadastro({ cnpj: "23.864.873/0001-49" }));

    expect(status).toBe(400);
    expect(corpo.message).toContain("CNPJ invalido");
    expect(storageMock.createProvider).not.toHaveBeenCalled();
  });

  it("recusa CNPJ cru com digito verificador errado", async () => {
    const { status } = await registrar(cadastro({ cnpj: "23864873000149" }));

    expect(status).toBe(400);
    expect(storageMock.createProvider).not.toHaveBeenCalled();
  });

  it("nao consulta o banco antes de reprovar o documento — recusa de graca vem primeiro", async () => {
    await registrar(cadastro({ cnpj: "23.864.873/0001-49" }));

    expect(storageMock.getProviderByCnpj).not.toHaveBeenCalled();
    expect(storageMock.getUserByEmail).not.toHaveBeenCalled();
  });
});
