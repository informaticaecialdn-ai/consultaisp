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
  deleteProvider: vi.fn(async (_id: number): Promise<void> => undefined),
  getProviderByCnpj: vi.fn(async (): Promise<any> => null),
  getProviderBySubdomain: vi.fn(async (): Promise<any> => null),
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
  storageMock.deleteProvider.mockResolvedValue(undefined);
  storageMock.getProviderByCnpj.mockResolvedValue(null);
  storageMock.getProviderBySubdomain.mockResolvedValue(null);
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

/**
 * PATCH /api/admin/providers/:id — a ficha cadastral inteira.
 *
 * Ate aqui o superadmin CRIAVA um provedor com CNPJ, endereco, natureza juridica
 * e data de abertura, e depois nao conseguia corrigir nenhum deles: o schema do
 * PATCH e `.strict()` e so conhecia cinco campos. O que se prova abaixo e que a
 * ficha completa grava e, principalmente, que ela FALHA DE FORMA LEGIVEL — um
 * PATCH que reprova inteiro sem dizer qual dos 16 campos reprovou e, na pratica,
 * um formulario que nao salva.
 */
describe("PATCH /api/admin/providers/:id — cadastro completo", () => {
  /** O objeto que chegou ao storage — o unico lugar onde se ve o que seria gravado. */
  const gravado = () => storageMock.adminUpdateProvider.mock.calls[0][1] as unknown as any;

  it("grava natureza juridica, data de abertura e segmento", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, {
      legalType: "Sociedade Empresária Limitada",
      openingDate: "2014-03-21",
      businessSegment: "Provedor de internet",
    });

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({
      legalType: "Sociedade Empresária Limitada",
      openingDate: "2014-03-21",
      businessSegment: "Provedor de internet",
    });
  });

  it("grava a ficha inteira de uma vez", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, {
      name: "NsLink Telecom Ltda", tradeName: "NsLink", cnpj: "12345678000199",
      legalType: "LTDA", openingDate: "2014-03-21", businessSegment: "Provedor de internet",
      contactEmail: "contato@nslink.com.br", contactPhone: "37999990000",
      website: "https://nslink.com.br", subdomain: "nslink",
      addressZip: "35500000", addressStreet: "Rua das Palmeiras", addressNumber: "120",
      addressComplement: "Sala 3", addressNeighborhood: "Centro",
      addressCity: "Divinópolis", addressState: "MG",
    });

    expect(res.status).toBe(200);
    expect(gravado().addressCity).toBe("Divinópolis");
    expect(gravado().addressState).toBe("MG");
    expect(Object.keys(gravado())).toHaveLength(17);
  });

  // A tela monta o formulario com `provider.campo || ""`. Antes desta regra,
  // salvar a ficha de um provedor sem site devolvia 400 "Dados invalidos" sem
  // dizer qual campo — e com 16 campos isso e um formulario que nunca salva.
  it('"" vira null, e nao reprova o PATCH inteiro', async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, {
      tradeName: "", website: "", contactEmail: "", contactPhone: "",
      addressComplement: "", legalType: "", openingDate: "", businessSegment: "",
    });

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({
      tradeName: null, website: null, contactEmail: null, contactPhone: null,
      addressComplement: null, legalType: null, openingDate: null, businessSegment: null,
    });
  });

  // "   " tem o mesmo efeito de "" e nenhum significado a mais.
  it("so espaco tambem vira null, e o texto util e aparado", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    await alterar(42, { addressComplement: "   ", addressCity: "  Divinópolis  " });

    expect(gravado()).toEqual({ addressComplement: null, addressCity: "Divinópolis" });
  });

  it("aceita CNPJ mascarado e grava so os 14 digitos", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { cnpj: "12.345.678/0001-99" });

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ cnpj: "12345678000199" });
  });

  it("CNPJ com menos de 14 digitos e recusado apontando o campo", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { cnpj: "123.456" });
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.cnpj?.[0]).toMatch(/14 digitos/);
    expect(storageMock.adminUpdateProvider).not.toHaveBeenCalled();
  });

  // Um subdominio com espaco ou maiuscula nunca resolveria host nenhum, e ainda
  // ocuparia o valor para sempre numa coluna UNIQUE.
  it("subdominio fora do formato e recusado, com frase que diz o que vale", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { subdomain: "Meu Provedor!" });
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.subdomain?.[0]).toMatch(/letras minusculas, numeros e hifens/);
    expect(storageMock.adminUpdateProvider).not.toHaveBeenCalled();
  });

  // "" NAO e NULL numa coluna UNIQUE: o primeiro provedor grava vazio e o
  // segundo estoura com 23505.
  it("subdominio vazio vira null, nao string vazia", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { subdomain: "" });

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ subdomain: null });
  });

  // O painel do PROPRIO provedor grava website sem validacao nenhuma. Com
  // `.url()` deste lado, a ficha voltava 400 ao reenviar o valor que ela mesma
  // leu do banco — e o superadmin nao conseguia corrigir o endereco por causa
  // do site.
  it("aceita o site como o provedor digitou, sem esquema", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { website: "www.exemplo.com.br", addressCity: "Divinópolis" });

    expect(res.status).toBe(200);
    expect(gravado().website).toBe("www.exemplo.com.br");
  });

  it("nao reescreve o site: nada de prefixar https://", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    await alterar(42, { website: "exemplo.com.br" });

    expect(gravado().website).toBe("exemplo.com.br");
  });

  // Este valor e candidato natural a virar href numa tela futura.
  it("recusa site com esquema que nao seja http/https", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { website: "javascript:alert(1)" });

    expect(res.status).toBe(400);
    expect(storageMock.adminUpdateProvider).not.toHaveBeenCalled();
  });

  it("campo desconhecido continua sendo recusado", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { ispCreditos: 500 });

    expect(res.status).toBe(400);
    expect(storageMock.adminUpdateProvider).not.toHaveBeenCalled();
  });
});

/**
 * A colisao de UNIQUE chegava como 23505 no catch generico: o superadmin lia
 * "Erro interno do servidor" e nao tinha como saber que o problema era
 * duplicidade, muito menos de quem era o valor.
 */
describe("PATCH /api/admin/providers/:id — CNPJ e subdominio ja usados", () => {
  it("CNPJ de outro provedor devolve 409 dizendo de quem e, e nao grava", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());
    storageMock.getProviderByCnpj.mockResolvedValue({ id: 7, name: "Provedor Amplinet" });

    const res = await alterar(42, { cnpj: "12345678000199" });
    const corpo = await res.json();

    // 409 e nao 400: o pedido esta bem formado; o que impede e o estado de
    // outra linha.
    expect(res.status).toBe(409);
    expect(corpo.message).toMatch(/CNPJ ja cadastrado/);
    expect(corpo.message).toContain("Provedor Amplinet");
    // A frase vem pronta E enderecada ao campo, no mesmo formato do 400: e o que
    // deixa a tela imprimir a duplicidade debaixo do campo em vez de num toast.
    expect(corpo.errors.cnpj).toEqual([corpo.message]);
    expect(storageMock.adminUpdateProvider).not.toHaveBeenCalled();
  });

  it("subdominio de outro provedor devolve 409 dizendo de quem e, e nao grava", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());
    storageMock.getProviderBySubdomain.mockResolvedValue({ id: 7, name: "Provedor Amplinet" });

    const res = await alterar(42, { subdomain: "amplinet" });
    const corpo = await res.json();

    expect(res.status).toBe(409);
    expect(corpo.message).toMatch(/Subdominio ja em uso/);
    expect(corpo.message).toContain("Provedor Amplinet");
    expect(corpo.errors.subdomain).toEqual([corpo.message]);
    expect(storageMock.adminUpdateProvider).not.toHaveBeenCalled();
  });

  // A ficha reenvia o objeto inteiro a cada salvamento: o CNPJ que ela manda e
  // quase sempre o do proprio provedor. Se isso contasse como colisao, a tela
  // nunca salvaria nada.
  it("o proprio CNPJ nao e colisao", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());
    storageMock.getProviderByCnpj.mockResolvedValue({ id: 42, name: "Provedor NsLink" });
    storageMock.getProviderBySubdomain.mockResolvedValue({ id: 42, name: "Provedor NsLink" });

    const res = await alterar(42, { cnpj: "12345678000199", subdomain: "nslink" });

    expect(res.status).toBe(200);
    expect(storageMock.adminUpdateProvider).toHaveBeenCalled();
  });

  // Em Postgres varios NULL convivem numa coluna UNIQUE: limpar o subdominio
  // nao colide com nada, e nem faz sentido perguntar ao banco por "".
  it("limpar o subdominio nao consulta unicidade", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { subdomain: "" });

    expect(res.status).toBe(200);
    expect(storageMock.getProviderBySubdomain).not.toHaveBeenCalled();
  });

  it("provedor inexistente da 404 antes de conferir unicidade", async () => {
    storageMock.getProvider.mockResolvedValue(null);

    const res = await alterar(999, { cnpj: "12345678000199" });

    expect(res.status).toBe(404);
    expect(storageMock.getProviderByCnpj).not.toHaveBeenCalled();
  });
});

/**
 * `db.update().set({})` nao e no-op: o Drizzle se recusa a montar o SET vazio e
 * o erro vira "Erro interno do servidor", que convida o operador a clicar de
 * novo.
 */
describe("PATCH /api/admin/providers/:id — corpo sem campo nenhum", () => {
  it("corpo vazio nao chega ao storage", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, {});

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Nenhum campo para alterar");
    expect(storageMock.adminUpdateProvider).not.toHaveBeenCalled();
  });

  // `motivo` nao e coluna: sozinho, nao ha alteracao para gravar nem decisao
  // para avisar. Responder 200 faria o operador fechar a tela achando que
  // salvou.
  it("so o motivo nao chega ao storage nem manda e-mail", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { motivo: "Documento ilegível." });

    expect(res.status).toBe(400);
    expect(storageMock.adminUpdateProvider).not.toHaveBeenCalled();
    expect(emailMock.sendCadastroReprovadoEmail).not.toHaveBeenCalled();
  });

  // A guarda conta CHAVES. Desde que a tela manda so o que mudou, o PATCH de um
  // campo so deixou de ser excecao e virou o caso normal: se a guarda o
  // confundisse com corpo vazio, corrigir uma cidade seria impossivel.
  it("um campo so nao e corpo vazio", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { addressCity: "Formiga" });

    expect(res.status).toBe(200);
    expect(storageMock.adminUpdateProvider).toHaveBeenCalledWith(42, { addressCity: "Formiga" });
  });

  // Um PATCH que so apaga um campo tambem e alteracao: `null` e chave presente.
  it("apagar um campo so tambem passa pela guarda", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { addressComplement: "" });

    expect(res.status).toBe(200);
    expect(storageMock.adminUpdateProvider).toHaveBeenCalledWith(42, { addressComplement: null });
  });
});

/**
 * `contactEmail` e o ENDERECO DE ENTREGA dos avisos, e nao texto de vitrine como
 * o site: `destinatariosDoProvedor` so cai nos administradores quando ele esta
 * VAZIO. Por isso o formato continua exigido — mas so de valor NOVO. O painel do
 * proprio provedor grava esse campo sem validacao nenhuma, entao a coluna ja
 * guarda lista com virgula; recusar o que ja esta la obrigaria o superadmin a
 * alterar o e-mail real do provedor para conseguir corrigir o CEP dele.
 */
describe("PATCH /api/admin/providers/:id — e-mail de contato", () => {
  const gravado = () => storageMock.adminUpdateProvider.mock.calls[0][1] as unknown as any;
  const LEGADO = "financeiro@nslink.com.br, suporte@nslink.com.br";

  it("valor livre ja gravado nao reprova o PATCH, e o CEP e corrigido junto", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ contactEmail: LEGADO }));

    const res = await alterar(42, { contactEmail: LEGADO, addressZip: "35500000" });

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ contactEmail: LEGADO, addressZip: "35500000" });
  });

  // A comparacao e entre valores JA NORMALIZADOS dos dois lados. Com texto cru,
  // um espaco em volta do que o banco guarda viraria "alteracao" e reprovaria um
  // campo que ninguem tocou.
  it("espaco em volta do valor gravado nao conta como alteracao", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ contactEmail: `  ${LEGADO}  ` }));

    const res = await alterar(42, { contactEmail: LEGADO });

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ contactEmail: LEGADO });
  });

  it("valor NOVO invalido e recusado apontando o campo, em portugues", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ contactEmail: LEGADO }));

    const res = await alterar(42, { contactEmail: "financeiro arroba nslink" });
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.contactEmail?.[0]).toBe(
      "E-mail de contato inválido: informe um endereço só, no formato nome@empresa.com.br.",
    );
    expect(storageMock.adminUpdateProvider).not.toHaveBeenCalled();
  });

  // O legado passa por ja estar gravado; trocar por OUTRA lista e valor novo, e
  // valor novo tem de ser endereco de entrega de verdade.
  it("trocar o legado por outra lista livre e recusado", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ contactEmail: LEGADO }));

    const res = await alterar(42, { contactEmail: "cobranca@nslink.com.br, financeiro@nslink.com.br" });

    expect(res.status).toBe(400);
    expect(storageMock.adminUpdateProvider).not.toHaveBeenCalled();
  });

  it("e-mail novo e valido e gravado", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ contactEmail: LEGADO }));

    const res = await alterar(42, { contactEmail: "contato@nslink.com.br" });

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ contactEmail: "contato@nslink.com.br" });
  });

  // Apagar e escolha valida: sem contato, a entrega volta para os
  // administradores do provedor, que e o resgate de `destinatariosDoProvedor`.
  it("apagar o e-mail de contato continua valendo", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ contactEmail: LEGADO }));

    const res = await alterar(42, { contactEmail: "" });

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ contactEmail: null });
  });

  // Provedor sem contato cadastrado: nao ha valor anterior a preservar, entao
  // qualquer coisa que se escreva ali e valor novo.
  it("provedor sem contato: o primeiro e-mail ja e julgado", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase({ contactEmail: null }));

    const res = await alterar(42, { contactEmail: "nao-e-email" });

    expect(res.status).toBe(400);
    expect(storageMock.adminUpdateProvider).not.toHaveBeenCalled();
  });
});

/**
 * O 400 volta em `errors.<campo>` e a tela imprime a frase DEBAIXO do campo. Uma
 * frase em ingles ali ("String must contain at most 200 character(s)") nao diz
 * nem o campo nem o que fazer.
 */
describe("PATCH /api/admin/providers/:id — as frases que o operador le", () => {
  it("limite estourado diz o campo, o limite e em portugues", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { tradeName: "N".repeat(201) });
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.tradeName?.[0]).toBe("O nome fantasia deve ter no máximo 200 caracteres.");
  });

  it("razao social em branco diz o que informar", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { name: "   " });
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.name?.[0]).toBe("Informe a razão social do provedor.");
  });

  it("subdominio curto demais diz o minimo", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, { subdomain: "a" });
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.subdomain?.[0]).toBe("O subdomínio precisa de pelo menos 2 caracteres.");
  });

  // Varredura: nenhuma frase de campo do cadastro pode voltar no texto padrao do
  // zod. E o que impede a proxima regra de entrar em ingles sem ninguem notar.
  it("nenhum campo do cadastro devolve frase em ingles", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await alterar(42, {
      name: "", tradeName: "N".repeat(201), legalType: "L".repeat(51),
      openingDate: "0".repeat(21), businessSegment: "S".repeat(101),
      contactPhone: "9".repeat(21), website: "w".repeat(501), subdomain: "s",
      addressZip: "0".repeat(11), addressStreet: "R".repeat(201),
      addressNumber: "1".repeat(21), addressComplement: "C".repeat(101),
      addressNeighborhood: "B".repeat(101), addressCity: "C".repeat(101),
      addressState: "MGX", motivo: "M".repeat(501),
    });
    const corpo = await res.json();

    expect(res.status).toBe(400);
    const frases = Object.values(corpo.errors as Record<string, string[]>).flat();
    expect(frases.length).toBeGreaterThan(10);
    for (const frase of frases) {
      expect(frase).not.toMatch(/String must contain|Invalid|Expected|character\(s\)/);
    }
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

/**
 * DELETE /api/admin/providers/:id — a recusa honesta.
 *
 * `deleteProvider` para antes do primeiro DELETE quando o provedor tem trilha de
 * acesso de suporte: aquela tabela e a unica prova de quem entrou na conta e
 * abriu o dado pessoal dos titulares, e ela nao pode sumir junto com o provedor
 * que audita.
 *
 * O lado do storage ja esta coberto em `storage/providers-acesso-suporte.test.ts`.
 * O que faltava era a TRADUCAO: um erro que atravessa a fronteira do modulo e
 * cai no `catch` generico vira "Erro interno do servidor" — nada sobre o que
 * aconteceu, nada sobre o que fazer, e um convite a clicar de novo.
 */
describe("DELETE /api/admin/providers/:id", () => {
  const excluir = (id: number) => fetch(`${base}/api/admin/providers/${id}`, { method: "DELETE" });

  /** O erro como ele chega: sem a classe, so com o campo. Ver o comentario da rota. */
  function recusaDaTrilha(acessos: number): Error {
    const erro = new Error("provedor com trilha de acesso de suporte") as any;
    erro.codigo = "PROVEDOR_COM_TRILHA_DE_SUPORTE";
    erro.acessos = acessos;
    return erro;
  }

  it("sem trilha, exclui", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());

    const res = await excluir(42);

    expect(res.status).toBe(200);
    expect(storageMock.deleteProvider).toHaveBeenCalledWith(42);
  });

  it("com trilha, recusa com 409 — e nao com 500", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());
    storageMock.deleteProvider.mockRejectedValue(recusaDaTrilha(3));

    const res = await excluir(42);
    const corpo = await res.json();

    // 409 e nao 400: o pedido esta bem formado e a permissao existe. O que
    // impede e o ESTADO do provedor.
    expect(res.status).toBe(409);
    expect(corpo.code).toBe("PROVEDOR_COM_TRILHA_DE_SUPORTE");
    expect(corpo.acessos).toBe(3);
  });

  it("a mensagem diz quantos registros sao e onde ve-los", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());
    storageMock.deleteProvider.mockRejectedValue(recusaDaTrilha(3));

    const { message } = await (await excluir(42)).json();

    expect(message).toContain("3 registro(s)");
    expect(message).toContain("aba Suporte");
    // A primeira versao mandava "Exporte o historico antes de remover", e nao ha
    // exportacao nenhuma na tela. Instrucao impossivel de cumprir e pior do que
    // nenhuma: o operador procura o botao antes de acreditar que nao existe.
    expect(message).not.toMatch(/exporte/i);
  });

  it("falha de verdade continua sendo 500 — a traducao nao engole erro", async () => {
    storageMock.getProvider.mockResolvedValue(provedorBase());
    storageMock.deleteProvider.mockRejectedValue(new Error("connection terminated"));

    const res = await excluir(42);

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBeUndefined();
  });

  it("provedor inexistente da 404 e nao chega a tentar apagar", async () => {
    storageMock.getProvider.mockResolvedValue(null);

    const res = await excluir(999);

    expect(res.status).toBe(404);
    expect(storageMock.deleteProvider).not.toHaveBeenCalled();
  });
});
