import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Foco: as travas do DELETE /api/admin/users/:id, que apaga a linha de vez, e
 * os avisos que as decisoes do superadmin passaram a disparar — analise de
 * cadastro, suspensao de acesso, troca de plano e acesso criado para alguem.
 *
 * Tudo que abre conexao ou fala com terceiro vira espiao: o que se prova aqui
 * e QUEM a rota se recusa a apagar e QUEM recebe cada aviso, nao como o e-mail
 * e montado nem como a linha e gravada.
 *
 * `email-destinatario` entra COMO O REAL de proposito: a regra "contato do
 * provedor ou, na falta dele, os administradores" e metade do que se testa
 * aqui. Mockar esse modulo provaria apenas que a rota chamou uma funcao.
 */
const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(async (): Promise<any> => null),
  deleteUser: vi.fn(async () => undefined),
  getProvider: vi.fn(async (): Promise<any> => null),
  adminUpdateProvider: vi.fn(async (_id: number, dados: any): Promise<any> => dados),
  updateProviderPlan: vi.fn(async (): Promise<any> => null),
  createPlanChange: vi.fn(async () => undefined),
  getUsersByProvider: vi.fn(async (): Promise<any[]> => []),
  getUserByEmail: vi.fn(async (): Promise<any> => null),
  createUser: vi.fn(async (dados: any): Promise<any> => ({ id: 99, ...dados })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../auth", () => ({
  requireSuperAdmin: (req: any, res: any, next: any) => {
    if (req.session?.role !== "superadmin") return res.status(403).json({ message: "Acesso restrito" });
    next();
  },
  esquecerStatusDeProvedor: vi.fn(),
}));

const emailMock = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(async () => undefined),
  sendCadastroAprovadoEmail: vi.fn(async () => undefined),
  sendCadastroReprovadoEmail: vi.fn(async () => undefined),
  sendAcessoSuspensoEmail: vi.fn(async () => undefined),
  sendAcessoReativadoEmail: vi.fn(async () => undefined),
  sendPlanoAlteradoEmail: vi.fn(async () => undefined),
  sendUsuarioAdicionadoEmail: vi.fn(async () => undefined),
}));

/**
 * Marca de teste: o que importa e que ela CHEGUE ao e-mail, nao o conteudo.
 * Hoisted porque a fabrica do `vi.mock` de marca.service sobe para o topo.
 */
const { MARCA_FAKE, URL_DA_MARCA } = vi.hoisted(() => ({
  MARCA_FAKE: { marcaId: 7, nomeProduto: "CredNet", suporteEmail: null } as any,
  URL_DA_MARCA: "https://crednet.example",
}));

vi.mock("../db", () => ({ db: {} }));
vi.mock("../password", () => ({ hashPassword: vi.fn(async (s: string) => `hash:${s}`) }));
vi.mock("../services/email", () => emailMock);
vi.mock("../services/marca.service", () => ({
  esquecerMarcas: vi.fn(),
  resolverMarcaPorId: vi.fn(async () => MARCA_FAKE),
  urlDeEntrada: vi.fn(() => URL_DA_MARCA),
  MARCA_PLATAFORMA: MARCA_FAKE,
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../services/lgpd-email.service", () => ({ sendCompletionEmail: vi.fn(async () => undefined) }));

import { registerAdminRoutes } from "./admin.routes";

let server: Server;
let base: string;
let sessao: Record<string, any>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessao;
    next();
  });
  app.use(registerAdminRoutes());
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

/** Provedor com contato cadastrado: o caminho normal dos avisos. */
const provedorBase = (extra: Record<string, any> = {}) => ({
  id: 42,
  name: "Provedor NsLink",
  contactEmail: "contato@nslink.com.br",
  marcaId: 7,
  subdomain: "nslink",
  plan: "free",
  status: "active",
  verificationStatus: "pending",
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` limpa as chamadas, nao a implementacao: sem estas linhas um
  // `mockResolvedValue` de um teste vazaria para os seguintes.
  storageMock.getProvider.mockResolvedValue(null);
  storageMock.getUser.mockResolvedValue(null);
  storageMock.getUsersByProvider.mockResolvedValue([]);
  storageMock.getUserByEmail.mockResolvedValue(null);
  storageMock.adminUpdateProvider.mockImplementation(async (_id: number, dados: any) => dados);
  storageMock.createUser.mockImplementation(async (dados: any) => ({ id: 99, ...dados }));
  sessao = { userId: 1, role: "superadmin" };
});

const apagar = (id: number) => fetch(`${base}/api/admin/users/${id}`, { method: "DELETE" });

describe("DELETE /api/admin/users/:id", () => {
  it("apaga um usuario comum", async () => {
    storageMock.getUser.mockResolvedValue({ id: 9, role: "admin", providerId: 3 });

    const res = await apagar(9);

    expect(res.status).toBe(200);
    expect(storageMock.deleteUser).toHaveBeenCalledWith(9);
  });

  // Sem esta trava o superadmin apaga a propria conta e so o banco devolve o
  // acesso — a plataforma fica sem quem administre.
  it("409 ao tentar apagar a propria conta, e nao chega a apagar", async () => {
    const res = await apagar(1);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "Voce nao pode excluir a propria conta" });
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("409 ao tentar apagar outro superadmin", async () => {
    storageMock.getUser.mockResolvedValue({ id: 2, role: "superadmin", providerId: null });

    const res = await apagar(2);

    expect(res.status).toBe(409);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("404 quando o usuario nao existe", async () => {
    storageMock.getUser.mockResolvedValue(null);

    const res = await apagar(999);

    expect(res.status).toBe(404);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("403 para quem nao e superadmin", async () => {
    sessao = { userId: 5, role: "admin", providerId: 3 };

    const res = await apagar(9);

    expect(res.status).toBe(403);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });
});

// ── Avisos das decisoes do superadmin ────────────────────────────────────────

const alterar = (id: number, corpo: Record<string, unknown>) =>
  fetch(`${base}/api/admin/providers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

/**
 * A tela de cadastros reenvia o PATCH inteiro a cada clique e deixa o botao
 * "Aprovar" visivel para quem ja esta aprovado. Sem comparar com o valor
 * anterior, o mesmo aviso sairia a cada clique — e aviso repetido ensina o
 * provedor a ignorar o proximo.
 */
describe("PATCH /api/admin/providers/:id — analise de cadastro", () => {
  it("aprovar um cadastro pendente avisa o contato do provedor, uma vez", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ verificationStatus: "pending" }));

    const res = await alterar(42, { verificationStatus: "approved" });

    expect(res.status).toBe(200);
    expect(emailMock.sendCadastroAprovadoEmail).toHaveBeenCalledTimes(1);
    expect(emailMock.sendCadastroAprovadoEmail).toHaveBeenCalledWith(
      "contato@nslink.com.br", "Provedor NsLink", "Provedor NsLink", MARCA_FAKE, URL_DA_MARCA,
    );
    expect(emailMock.sendCadastroReprovadoEmail).not.toHaveBeenCalled();
  });

  it("aprovar quem ja estava aprovado nao manda nada", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ verificationStatus: "approved" }));

    const res = await alterar(42, { verificationStatus: "approved" });

    expect(res.status).toBe(200);
    expect(emailMock.sendCadastroAprovadoEmail).not.toHaveBeenCalled();
  });

  it("reprovar leva o motivo escrito pelo superadmin ate o e-mail", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ verificationStatus: "pending" }));

    const res = await alterar(42, {
      verificationStatus: "rejected",
      motivo: "O contrato social enviado está ilegível.",
    });

    expect(res.status).toBe(200);
    expect(emailMock.sendCadastroReprovadoEmail).toHaveBeenCalledTimes(1);
    expect(emailMock.sendCadastroReprovadoEmail).toHaveBeenCalledWith(
      "contato@nslink.com.br", "Provedor NsLink", "Provedor NsLink",
      "O contrato social enviado está ilegível.", MARCA_FAKE, URL_DA_MARCA,
    );
  });

  // "Seu cadastro foi reprovado" sem razao nenhuma e uma porta sem macaneta.
  it("reprovar sem motivo ainda diz ao provedor o que fazer", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ verificationStatus: "pending" }));

    await alterar(42, { verificationStatus: "rejected" });

    const motivo = emailMock.sendCadastroReprovadoEmail.mock.calls[0][3] as unknown as string;
    expect(motivo.length).toBeGreaterThan(0);
    expect(motivo).toMatch(/Painel do Provedor/);
  });

  // `motivo` nao e coluna: se vazar para o storage, o UPDATE quebra.
  it("o motivo nunca chega ao storage", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ verificationStatus: "pending" }));

    await alterar(42, { verificationStatus: "rejected", motivo: "Documento ilegível." });

    expect(storageMock.adminUpdateProvider).toHaveBeenCalledWith(42, { verificationStatus: "rejected" });
  });

  it("sem contato cadastrado, o aviso vai para os administradores do provedor", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ contactEmail: null, verificationStatus: "pending" }));
    storageMock.getUsersByProvider.mockResolvedValue([
      { id: 3, role: "admin", email: "Dono@nslink.com.br" },
      { id: 4, role: "user", email: "operador@nslink.com.br" },
    ]);

    await alterar(42, { verificationStatus: "approved" });

    expect(emailMock.sendCadastroAprovadoEmail).toHaveBeenCalledTimes(1);
    expect(emailMock.sendCadastroAprovadoEmail.mock.calls[0][0]).toBe("dono@nslink.com.br");
  });

  // O ato ja terminou quando o e-mail sai: Resend fora do ar nao pode desfazer
  // uma aprovacao que ja esta gravada.
  it("falha de envio nao derruba a alteracao", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ verificationStatus: "pending" }));
    emailMock.sendCadastroAprovadoEmail.mockRejectedValueOnce(new Error("Resend fora do ar"));

    const res = await alterar(42, { verificationStatus: "approved" });

    expect(res.status).toBe(200);
    expect(storageMock.adminUpdateProvider).toHaveBeenCalled();
  });

  it("404 quando o provedor nao existe, sem gravar nem avisar", async () => {
    storageMock.getProvider.mockResolvedValue(null);

    const res = await alterar(999, { verificationStatus: "approved" });

    expect(res.status).toBe(404);
    expect(storageMock.adminUpdateProvider).not.toHaveBeenCalled();
    expect(emailMock.sendCadastroAprovadoEmail).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/providers/:id — acesso suspenso e restabelecido", () => {
  it("suspender avisa, com o motivo", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ status: "active" }));

    await alterar(42, { status: "suspended", motivo: "Fatura de agosto em aberto." });

    expect(emailMock.sendAcessoSuspensoEmail).toHaveBeenCalledTimes(1);
    expect(emailMock.sendAcessoSuspensoEmail).toHaveBeenCalledWith(
      "contato@nslink.com.br", "Provedor NsLink", "Provedor NsLink",
      "Fatura de agosto em aberto.", MARCA_FAKE, URL_DA_MARCA,
    );
  });

  it("suspender de novo quem ja estava suspenso nao manda nada", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ status: "suspended" }));

    await alterar(42, { status: "suspended" });

    expect(emailMock.sendAcessoSuspensoEmail).not.toHaveBeenCalled();
  });

  it("voltar de suspenso para ativo avisa o restabelecimento", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ status: "suspended" }));

    await alterar(42, { status: "active" });

    expect(emailMock.sendAcessoReativadoEmail).toHaveBeenCalledTimes(1);
    expect(emailMock.sendAcessoReativadoEmail).toHaveBeenCalledWith(
      "contato@nslink.com.br", "Provedor NsLink", "Provedor NsLink", MARCA_FAKE, URL_DA_MARCA,
    );
  });

  // Sair de "cancelled" e outra historia comercial: "seu acesso voltou" seria
  // a mensagem errada para ela.
  it("cancelado que vira ativo nao recebe o aviso de restabelecimento", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ status: "cancelled" }));

    await alterar(42, { status: "active" });

    expect(emailMock.sendAcessoReativadoEmail).not.toHaveBeenCalled();
  });

  it("um PATCH que so mexe no endereco nao dispara aviso nenhum", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    await alterar(42, { addressCity: "Divinópolis" });

    expect(emailMock.sendAcessoSuspensoEmail).not.toHaveBeenCalled();
    expect(emailMock.sendAcessoReativadoEmail).not.toHaveBeenCalled();
    expect(emailMock.sendCadastroAprovadoEmail).not.toHaveBeenCalled();
    expect(emailMock.sendCadastroReprovadoEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/providers/:id/plan", () => {
  const trocarPlano = (id: number, corpo: Record<string, unknown>) =>
    fetch(`${base}/api/admin/providers/${id}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });

  it("avisa com os rotulos em portugues, nao com a chave da coluna", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ plan: "free" }));
    storageMock.updateProviderPlan.mockResolvedValue(provedorBase({ plan: "pro" }));

    const res = await trocarPlano(42, { plan: "pro" });

    expect(res.status).toBe(200);
    expect(emailMock.sendPlanoAlteradoEmail).toHaveBeenCalledTimes(1);
    const [para, nome, dados] = emailMock.sendPlanoAlteradoEmail.mock.calls[0] as unknown as any[];
    expect(para).toBe("contato@nslink.com.br");
    expect(nome).toBe("Provedor NsLink");
    expect(dados.de).toBe("Gratuito");
    expect(dados.para).toBe("Profissional");
  });

  it("leva as notas do superadmin como observacao e os creditos do plano novo", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ plan: "free" }));
    storageMock.updateProviderPlan.mockResolvedValue(provedorBase({ plan: "pro" }));

    await trocarPlano(42, { plan: "pro", notes: "Negociado com desconto de 3 meses." });

    const dados = emailMock.sendPlanoAlteradoEmail.mock.calls[0][2] as unknown as any;
    expect(dados.observacao).toBe("Negociado com desconto de 3 meses.");
    expect(dados.creditosDoPlano).toBe(30);
  });

  it("confirmar o mesmo plano grava o registro mas nao manda e-mail", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ plan: "pro" }));
    storageMock.updateProviderPlan.mockResolvedValue(provedorBase({ plan: "pro" }));

    const res = await trocarPlano(42, { plan: "pro" });

    expect(res.status).toBe(200);
    expect(storageMock.createPlanChange).toHaveBeenCalled();
    expect(emailMock.sendPlanoAlteradoEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/providers/:id/users", () => {
  const criar = (id: number, corpo: Record<string, unknown>) =>
    fetch(`${base}/api/admin/providers/${id}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });

  it("avisa a PESSOA criada, nao o contato do provedor, e sem a senha", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());
    storageMock.getUser.mockResolvedValue({ id: 1, name: "Suporte da Plataforma" });

    const res = await criar(42, { name: "Ana", email: "ana@nslink.com.br", password: "segredo-forte", role: "user" });

    expect(res.status).toBe(201);
    expect(emailMock.sendUsuarioAdicionadoEmail).toHaveBeenCalledTimes(1);
    expect(emailMock.sendUsuarioAdicionadoEmail).toHaveBeenCalledWith(
      "ana@nslink.com.br", "Ana", "Provedor NsLink", "Suporte da Plataforma",
      "ana@nslink.com.br", MARCA_FAKE, URL_DA_MARCA,
    );
    const argumentos = JSON.stringify(emailMock.sendUsuarioAdicionadoEmail.mock.calls[0]);
    expect(argumentos).not.toContain("segredo-forte");
  });

  it("sem conseguir ler quem criou, assina como Administrador do Sistema", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());
    storageMock.getUser.mockResolvedValue(null);

    await criar(42, { name: "Ana", email: "ana@nslink.com.br", password: "segredo-forte" });

    expect(emailMock.sendUsuarioAdicionadoEmail.mock.calls[0][3]).toBe("Administrador do Sistema");
  });

  it("falha de envio nao derruba a criacao da conta", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());
    emailMock.sendUsuarioAdicionadoEmail.mockRejectedValueOnce(new Error("Resend fora do ar"));

    const res = await criar(42, { name: "Ana", email: "ana@nslink.com.br", password: "segredo-forte" });

    expect(res.status).toBe(201);
    expect(storageMock.createUser).toHaveBeenCalled();
  });

  it("e-mail ja cadastrado: nao cria nem avisa", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());
    storageMock.getUserByEmail.mockResolvedValue({ id: 5, email: "ana@nslink.com.br" });

    const res = await criar(42, { name: "Ana", email: "ana@nslink.com.br", password: "segredo-forte" });

    expect(res.status).toBe(409);
    expect(emailMock.sendUsuarioAdicionadoEmail).not.toHaveBeenCalled();
  });
});
