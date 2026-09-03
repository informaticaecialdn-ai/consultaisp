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
  // O requireProvider REAL le o status do provedor para barrar sessao aberta
  // de provedor suspenso. Ativo por padrao; o teste de suspensao troca.
  getProvider: vi.fn(async (): Promise<any> => ({ id: 42, name: "Provedor Teste", status: "active" })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

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
