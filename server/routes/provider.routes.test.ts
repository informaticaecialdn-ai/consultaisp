import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Foco: DELETE /api/provider/users/:id (exclusao definitiva) e a defesa em
 * profundidade do requireProvider — sem ele, sessao com providerId 0 chega ao
 * handler e o handler compara/grava contra o provedor 0.
 */
const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(async (): Promise<any> => null),
  getUsersByProvider: vi.fn(async (): Promise<any[]> => []),
  deleteUser: vi.fn(async () => undefined),
  getUserByEmail: vi.fn(async (): Promise<any> => null),
  createUser: vi.fn(async (dados: any): Promise<any> => ({ id: 99, ...dados })),
  // O requireProvider REAL le o status do provedor para barrar sessao aberta
  // de provedor suspenso. Ativo por padrao; o teste de suspensao troca.
  getProvider: vi.fn(async (): Promise<any> => ({ id: 42, name: "Provedor Teste", status: "active" })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

/**
 * O e-mail vira espiao; `email-destinatario` fica REAL. O que se prova sobre a
 * inclusao de um usuario e QUEM recebe o aviso — a pessoa criada, nao o contato
 * do provedor — e isso so aparece com o modulo de destinatario rodando.
 */
const emailMock = vi.hoisted(() => ({
  sendUsuarioAdicionadoEmail: vi.fn(async () => undefined),
}));
vi.mock("../services/email", () => emailMock);

const { MARCA_FAKE, URL_DA_MARCA } = vi.hoisted(() => ({
  MARCA_FAKE: { marcaId: 3, nomeProduto: "CredNet", suporteEmail: null } as any,
  URL_DA_MARCA: "https://crednet.example",
}));
vi.mock("../services/marca.service", () => ({
  resolverMarcaPorId: vi.fn(async () => MARCA_FAKE),
  urlDeEntrada: vi.fn(() => URL_DA_MARCA),
  MARCA_PLATAFORMA: MARCA_FAKE,
}));

/**
 * A consulta a Receita vira espiao: as tres fontes sao servicos de terceiros e
 * um teste que bata neles falharia por cota, sem falar nada sobre a rota. O que
 * a rota faz com cada resposta possivel esta abaixo; o que cada fonte devolve
 * esta em services/cnpj-publico.service.test.ts, contra respostas gravadas.
 */
const consultaCnpjMock = vi.hoisted(() => vi.fn(async (_cnpj: string): Promise<any> => null));
vi.mock("../services/cnpj-publico.service", async importarReal => {
  // `normalizarCnpj` fica REAL: e ela que decide se o provedor tem um CNPJ
  // utilizavel, e esse julgamento e parte do que a rota promete.
  const real = await importarReal<typeof import("../services/cnpj-publico.service")>();
  return { ...real, consultarCnpjPublico: consultaCnpjMock };
});

/**
 * `requireProvider` entra AQUI COMO O REAL, importado do modulo de verdade.
 *
 * Antes este arquivo trazia uma copia sincrona escrita a mao, que so olhava
 * providerId. O bloco "requireProvider nas rotas de provedor" testava, entao,
 * a propria copia: passaria verde mesmo se o middleware de producao fosse
 * arrancado das rotas, e nao conhecia a trava de provedor suspenso. Com o
 * original, estes testes viram defesa de verdade.
 *
 * Importar `../auth` cobra dois pedagios, resolvidos abaixo: ele exige
 * SESSION_SECRET no topo e monta a sessao sobre o pool do Postgres. Nenhum dos
 * dois tem a ver com o middleware, entao o segredo e falso e o pool e mudo.
 */
vi.hoisted(() => {
  process.env.SESSION_SECRET ||= "segredo-de-teste-sem-nenhum-valor-real";
});
vi.mock("../db", () => ({
  pool: { query: async () => ({ rows: [] }), on: () => undefined, connect: async () => ({ release: () => undefined }) },
  db: {},
}));
vi.mock("../auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("../auth")>();
  return {
    ...real,
    // O requireAuth real depende de prova de host e de sessao completa, que
    // este arquivo nao esta testando.
    requireAuth: (req: any, res: any, next: any) => {
      if (!req.session?.userId) return res.status(401).json({ message: "Autenticacao necessaria" });
      next();
    },
  };
});

vi.mock("../password", () => ({ hashPassword: vi.fn(async (s: string) => `hash:${s}`) }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { esquecerStatusDeProvedor } from "../auth";
import { registerProviderRoutes } from "./provider.routes";

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
  app.use(registerProviderRoutes());
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
  // `clearAllMocks` limpa as chamadas, nao a implementacao: sem esta linha um
  // `mockRejectedValue` de um teste vazaria para os seguintes.
  storageMock.deleteUser.mockResolvedValue(undefined);
  storageMock.getUserByEmail.mockResolvedValue(null);
  storageMock.createUser.mockImplementation(async (dados: any) => ({ id: 99, ...dados }));
  storageMock.getProvider.mockResolvedValue({
    id: 42, name: "Provedor Teste", status: "active",
    contactEmail: "contato@provedor.com.br", marcaId: 3, subdomain: "teste",
  });
  sessao = { userId: 1, providerId: 7, role: "admin" };
});

const apagar = (id: number) => fetch(`${base}/api/provider/users/${id}`, { method: "DELETE" });

describe("DELETE /api/provider/users/:id", () => {
  it("exclui outro usuario do mesmo provedor", async () => {
    storageMock.getUser.mockResolvedValue({ id: 9, role: "user", providerId: 7 });

    const res = await apagar(9);

    expect(res.status).toBe(200);
    expect(storageMock.deleteUser).toHaveBeenCalledWith(9);
  });

  // 409 e nao 400: o pedido esta bem formado; o que impede e o estado.
  it("409 ao tentar excluir a propria conta", async () => {
    const res = await apagar(1);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "Voce nao pode excluir a propria conta" });
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("409 ao excluir o ultimo administrador do provedor", async () => {
    storageMock.getUser.mockResolvedValue({ id: 9, role: "admin", providerId: 7 });
    storageMock.getUsersByProvider.mockResolvedValue([
      { id: 9, role: "admin" },
      { id: 1, role: "user" },
    ]);

    const res = await apagar(9);

    expect(res.status).toBe(409);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("exclui um administrador quando sobra outro", async () => {
    storageMock.getUser.mockResolvedValue({ id: 9, role: "admin", providerId: 7 });
    storageMock.getUsersByProvider.mockResolvedValue([
      { id: 9, role: "admin" },
      { id: 1, role: "admin" },
    ]);

    const res = await apagar(9);

    expect(res.status).toBe(200);
    expect(storageMock.deleteUser).toHaveBeenCalledWith(9);
  });

  it("404 para usuario de outro provedor — nao revela que ele existe", async () => {
    storageMock.getUser.mockResolvedValue({ id: 9, role: "user", providerId: 8 });

    const res = await apagar(9);

    expect(res.status).toBe(404);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });
});

/**
 * `isp_consultations.user_id`, `spc_consultations.user_id`,
 * `bigdata_consultations.user_id` e `support_messages.sender_id` sao NOT NULL e
 * sem ON DELETE. Ou seja: o operador que ja rodou UMA consulta — o uso normal
 * da conta — nao pode ser apagado, e o handler devolvia 500 "Erro interno do
 * servidor". O admin via um erro sem causa e tentava de novo.
 */
describe("DELETE /api/provider/users/:id — usuario com historico", () => {
  const violacaoDeFk = (extra: Record<string, unknown> = {}) =>
    Object.assign(new Error('violates foreign key constraint "isp_consultations_user_id_users_id_fk"'), { code: "23503", ...extra });

  beforeEach(() => {
    storageMock.getUser.mockResolvedValue({ id: 9, role: "user", providerId: 7 });
  });

  it("409 com o motivo em portugues, nunca 500", async () => {
    storageMock.deleteUser.mockRejectedValue(violacaoDeFk());

    const res = await apagar(9);
    const corpo = await res.json();

    expect(res.status).toBe(409);
    expect(corpo.code).toBe("USUARIO_COM_HISTORICO");
    expect(corpo.message).toMatch(/historico/i);
    expect(corpo.message).not.toMatch(/23503|foreign key/i);
  });

  // O driver ora entrega o erro do pg direto, ora embrulhado por quem chamou.
  it("reconhece o 23503 tambem quando vem embrulhado em cause", async () => {
    storageMock.deleteUser.mockRejectedValue(
      Object.assign(new Error("Failed query"), { cause: { code: "23503" } }),
    );

    const res = await apagar(9);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("USUARIO_COM_HISTORICO");
  });

  // Qualquer outra falha continua sendo falha do servidor: transformar tudo em
  // 409 esconderia um defeito de verdade atras de um texto tranquilizador.
  it("erro que nao e violacao de chave estrangeira continua 500", async () => {
    storageMock.deleteUser.mockRejectedValue(new Error("connection terminated"));

    const res = await apagar(9);

    expect(res.status).toBe(500);
  });
});

describe("requireProvider nas rotas de provedor", () => {
  it("403 para sessao sem provedor: nao chega a consultar nada", async () => {
    sessao = { userId: 1, providerId: 0, role: "user" };

    const res = await fetch(`${base}/api/provider/users`);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "Somente provedores" });
    expect(storageMock.getUsersByProvider).not.toHaveBeenCalled();
  });

  it("403 para sessao sem provedor tambem na criacao de usuario", async () => {
    sessao = { userId: 1, providerId: 0, role: "admin" };

    const res = await fetch(`${base}/api/provider/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", email: "x@x.com", password: "12345678" }),
    });

    expect(res.status).toBe(403);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("401 sem sessao nenhuma", async () => {
    sessao = {};

    const res = await fetch(`${base}/api/provider/users`);

    expect(res.status).toBe(401);
  });

  /**
   * O motivo de usar o middleware REAL aqui: a suspensao de um provedor tem
   * que alcancar a sessao que ja estava aberta. Com a copia escrita a mao que
   * existia neste arquivo, este teste era impossivel — ela nem lia o status.
   */
  it("provedor suspenso nao passa, mesmo com a sessao ja aberta", async () => {
    esquecerStatusDeProvedor();
    storageMock.getProvider.mockResolvedValueOnce({ id: 42, name: "Provedor Teste", status: "suspended" });
    sessao = { userId: 1, providerId: 42, role: "admin" };

    const res = await fetch(`${base}/api/provider/users`);

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("PROVIDER_SUSPENDED");
    expect(storageMock.getUsersByProvider).not.toHaveBeenCalled();
  });

  it("reativado volta a passar assim que o cache e esquecido", async () => {
    esquecerStatusDeProvedor();
    sessao = { userId: 1, providerId: 42, role: "admin" };

    const res = await fetch(`${base}/api/provider/users`);

    expect(res.status).toBe(200);
    expect(storageMock.getUsersByProvider).toHaveBeenCalledWith(42);
  });
});

/**
 * Quem era adicionado a equipe nao recebia nada: descobria a propria conta
 * quando alguem avisava por fora. O aviso vai para a PESSOA criada, com a marca
 * e o endereco de entrada do provedor — e nunca com a senha.
 */
describe("POST /api/provider/users — aviso a quem foi adicionado", () => {
  const convidar = (corpo: Record<string, unknown>) =>
    fetch(`${base}/api/provider/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });

  beforeEach(() => {
    esquecerStatusDeProvedor();
    sessao = { userId: 1, providerId: 42, role: "admin" };
  });

  it("avisa a pessoa criada, com quem a adicionou e a marca do provedor", async () => {
    storageMock.getUser.mockResolvedValue({ id: 1, name: "Marcos do NsLink", providerId: 42 });

    const res = await convidar({ name: "Ana", email: "ana@nslink.com.br", password: "segredo-forte", role: "user" });

    expect(res.status).toBe(201);
    expect(emailMock.sendUsuarioAdicionadoEmail).toHaveBeenCalledTimes(1);
    expect(emailMock.sendUsuarioAdicionadoEmail).toHaveBeenCalledWith(
      "ana@nslink.com.br", "Ana", "Provedor Teste", "Marcos do NsLink",
      "ana@nslink.com.br", MARCA_FAKE, URL_DA_MARCA,
    );
  });

  // E-mail nao e canal para senha: fica na caixa de entrada, no backup e em
  // todo encaminhamento.
  it("a senha escolhida por quem convidou nao viaja no e-mail", async () => {
    storageMock.getUser.mockResolvedValue({ id: 1, name: "Marcos do NsLink", providerId: 42 });

    await convidar({ name: "Ana", email: "ana@nslink.com.br", password: "segredo-forte" });

    const argumentos = JSON.stringify(emailMock.sendUsuarioAdicionadoEmail.mock.calls[0]);
    expect(argumentos).not.toContain("segredo-forte");
  });

  it("sem conseguir ler quem convidou, assina com o nome do provedor", async () => {
    storageMock.getUser.mockResolvedValue(null);

    await convidar({ name: "Ana", email: "ana@nslink.com.br", password: "segredo-forte" });

    expect(emailMock.sendUsuarioAdicionadoEmail.mock.calls[0][3]).toBe("Provedor Teste");
  });

  // A conta ja esta criada quando o aviso sai; Resend fora do ar nao a desfaz.
  it("falha de envio nao derruba a criacao", async () => {
    storageMock.getUser.mockResolvedValue({ id: 1, name: "Marcos do NsLink", providerId: 42 });
    emailMock.sendUsuarioAdicionadoEmail.mockRejectedValueOnce(new Error("Resend fora do ar"));

    const res = await convidar({ name: "Ana", email: "ana@nslink.com.br", password: "segredo-forte" });

    expect(res.status).toBe(201);
    expect(storageMock.createUser).toHaveBeenCalled();
  });

  it("e-mail ja cadastrado: nao cria nem avisa", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ id: 5, email: "ana@nslink.com.br" });

    const res = await convidar({ name: "Ana", email: "ana@nslink.com.br", password: "segredo-forte" });

    expect(res.status).toBe(409);
    expect(storageMock.createUser).not.toHaveBeenCalled();
    expect(emailMock.sendUsuarioAdicionadoEmail).not.toHaveBeenCalled();
  });

  it("operador comum nao convida ninguem, e nada e enviado", async () => {
    sessao = { userId: 1, providerId: 42, role: "user" };

    const res = await convidar({ name: "Ana", email: "ana@nslink.com.br", password: "segredo-forte" });

    expect(res.status).toBe(403);
    expect(emailMock.sendUsuarioAdicionadoEmail).not.toHaveBeenCalled();
  });
});

/**
 * GET /api/provider/cnpj — o cadastro da PROPRIA empresa na Receita.
 *
 * A rota nasceu em 04/09/2026 porque a busca acontecia NO NAVEGADOR, contra uma
 * fonte so (BrasilAPI) e sem queda para as outras duas. O provedor da Amplinet
 * via a ficha com "helio cainelli" no lugar da razao social, clicava em "buscar
 * dados pelo CNPJ" e recebia "servico indisponivel" — que ele leu, com razao,
 * como "o sistema nao busca nada".
 *
 * O que se prova aqui e o ESCOPO: a rota nao aceita CNPJ de ninguem, so o do
 * provedor da sessao. Uma rota autenticada que consultasse CNPJ arbitrario
 * viraria um consultor gratuito de cadastro de empresa alheia, pago com a nossa
 * cota nas tres fontes.
 */
describe("GET /api/provider/cnpj", () => {
  const buscar = () => fetch(`${base}/api/provider/cnpj`);

  beforeEach(() => {
    consultaCnpjMock.mockReset();
    storageMock.getProvider.mockResolvedValue({
      id: 42, name: "helio cainelli", status: "active", cnpj: "23864873000148",
    });
    sessao = { userId: 5, providerId: 42, role: "admin" };
  });

  it("consulta o CNPJ DO PROVEDOR DA SESSAO, e nao um do pedido", async () => {
    consultaCnpjMock.mockResolvedValue({ razaoSocial: "HELIO CAINELLI TELECOM LTDA", fonte: "ReceitaWS" });

    const res = await buscar();

    expect(res.status).toBe(200);
    expect((await res.json()).razaoSocial).toBe("HELIO CAINELLI TELECOM LTDA");
    expect(consultaCnpjMock).toHaveBeenCalledWith("23864873000148");
  });

  it("operador comum tambem le — ler o cadastro publico da propria empresa nao muda nada", async () => {
    // Quem grava e o PATCH do perfil, e la a exigencia de admin continua.
    sessao = { userId: 7, providerId: 42, role: "user" };
    consultaCnpjMock.mockResolvedValue({ razaoSocial: "HELIO CAINELLI TELECOM LTDA" });

    expect((await buscar()).status).toBe(200);
  });

  it("sessao sem provedor nao passa do requireProvider", async () => {
    sessao = { userId: 1, providerId: 0, role: "superadmin" };

    const res = await buscar();

    expect(res.status).toBe(403);
    expect(consultaCnpjMock).not.toHaveBeenCalled();
  });

  it("provedor sem CNPJ valido recebe 400 e ninguem e consultado", async () => {
    storageMock.getProvider.mockResolvedValue({ id: 42, name: "X", status: "active", cnpj: "123" });

    const res = await buscar();

    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/CNPJ/i);
    expect(consultaCnpjMock).not.toHaveBeenCalled();
  });

  it("as tres fontes recusando da 502, e nao 404", async () => {
    // 404 mandaria o provedor conferir um numero que costuma estar certo: as
    // fontes sao de terceiros e recusam por cota tanto quanto por inexistencia.
    consultaCnpjMock.mockResolvedValue(null);

    const res = await buscar();

    expect(res.status).toBe(502);
    expect((await res.json()).message).toMatch(/tente de novo|alguns minutos/i);
  });
});
