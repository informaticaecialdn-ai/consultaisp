import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * A rede que faltava.
 *
 * As rotas de ERP nunca tiveram um teste. Quando PATCH/test/sync do provedor
 * exigiam so `requireAuth + requireProvider`, nada avisava que um operador de
 * papel "user" gravava credencial por curl, nem que o GET devolvia o token
 * decifrado ao navegador. O lado do provedor virou somente-leitura; este arquivo
 * existe para que ele nao volte a escrever nem a vazar sem que alguem repare.
 */
/**
 * Um Drizzle de mentira que so sabe fazer uma coisa: projetar.
 *
 * `db.select({ ...colunas })` devolve APENAS as colunas pedidas — e e nisso que
 * o recorte de credencial se apoia. Emular esse comportamento deixa o teste
 * exercitar o `getErpIntegracoesResumo` DE VERDADE, em vez de um mock que
 * repetiria a mesma logica e passaria verde mesmo se o storage voltasse a
 * fazer `db.select()` sem argumento.
 */
const dbFalso = vi.hoisted(() => {
  const estado: { colunas: Record<string, unknown> | null; linhas: any[] } = { colunas: null, linhas: [] };
  const cadeia: any = {
    select(colunas: Record<string, unknown>) { estado.colunas = colunas; return cadeia; },
    from() { return cadeia; },
    where() { return cadeia; },
    orderBy() {
      const chaves = Object.keys(estado.colunas ?? {});
      return estado.linhas.map(l => Object.fromEntries(chaves.map(k => [k, l[k] ?? null])));
    },
  };
  return { cadeia, estado };
});
vi.mock("../db", () => ({ db: dbFalso.cadeia, pool: {} }));

const storageMock = vi.hoisted(() => ({
  // Preenchido no beforeAll com o metodo REAL do ErpStorage, sobre o db falso.
  getErpIntegracoesResumo: vi.fn(async (_providerId: number): Promise<any[]> => []),
  getErpIntegrationStats: vi.fn(async () => ({
    totalEnabled: 1, totalSynced: 120, totalErrors: 2, lastSync: new Date("2026-09-01T10:00:00Z"),
  })),
  getErpSyncLogs: vi.fn(async (): Promise<any[]> => []),
  getErpIntegrations: vi.fn(async (): Promise<any[]> => []),
  getProvider: vi.fn(async (): Promise<any> => null),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

/**
 * As linhas cruas, com credencial, como saem do banco. O teste de vazamento so
 * vale se houver segredo de verdade para vazar — se o fixture nao tivesse token,
 * a assercao passaria por acidente.
 */
const { LINHAS_POR_PROVEDOR } = vi.hoisted(() => ({
  LINHAS_POR_PROVEDOR: {
    42: [
      {
        erpSource: "ixc",
        isEnabled: true,
        status: "idle",
        lastSyncAt: new Date("2026-09-01T10:00:00Z"),
        lastSyncStatus: "success",
        totalSynced: 120,
        totalErrors: 2,
        syncIntervalHours: 24,
        apiUrl: "https://erp-do-provedor-42.example",
        apiToken: "token-secreto-do-42",
        apiUser: "usuario-do-42",
        clientId: "client-id-do-42",
        clientSecret: "client-secret-do-42",
        mkContraSenha: "contra-senha-do-42",
        extraConfig: { sgpApp: "app-do-42" },
        notes: "anotacao interna do superadmin",
      },
      // So a URL: nao conecta em ERP nenhum, entao NAO esta configurado.
      {
        erpSource: "mk", isEnabled: false, status: "idle", lastSyncAt: null, lastSyncStatus: null,
        totalSynced: 0, totalErrors: 0, syncIntervalHours: 24,
        apiUrl: "https://so-a-url.example", apiToken: null,
      },
      // So o token: idem.
      {
        erpSource: "sgp", isEnabled: false, status: "idle", lastSyncAt: null, lastSyncStatus: null,
        totalSynced: 0, totalErrors: 0, syncIntervalHours: 24,
        apiUrl: null, apiToken: "so-o-token",
      },
    ],
    // O vizinho. Nenhuma sessao do 42 pode chegar nele.
    77: [
      {
        erpSource: "voalle", isEnabled: true, status: "idle", lastSyncAt: null, lastSyncStatus: null,
        totalSynced: 999, totalErrors: 0, syncIntervalHours: 12,
        apiUrl: "https://erp-do-provedor-77.example", apiToken: "token-secreto-do-77",
      },
    ],
  } as Record<number, any[]>,
}));

vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Autenticacao necessaria" });
    next();
  },
  requireProvider: (req: any, res: any, next: any) => {
    if (!req.session?.providerId) return res.status(403).json({ message: "Somente provedores" });
    next();
  },
  requireSuperAdmin: (req: any, res: any, next: any) => {
    if (req.session?.role !== "superadmin") return res.status(403).json({ message: "Somente superadmin" });
    next();
  },
}));

const syncMock = vi.hoisted(() => ({
  syncProviderToDb: vi.fn(async () => ({ upserted: 0, errors: 0 })),
  sincronizacaoEmAndamento: vi.fn(async () => false),
}));
vi.mock("../services/erp-sync.service", () => syncMock);

import { registerErpRoutes } from "./erp.routes";
import { ErpStorage } from "../storage/erp.storage";
import { getSupportedSources } from "../erp";

let server: Server;
let base: string;
let sessao: Record<string, unknown> = {};

beforeAll(async () => {
  // A rota chama o storage; o storage aqui e o de verdade, so que lendo do
  // Drizzle de mentira acima. O `where` por providerId nao roda no db falso,
  // entao o recorte por tenant e feito na entrada — e a rota ainda tem de provar
  // que passou o providerId da SESSAO (ver o teste de isolamento).
  const erpReal = new ErpStorage();
  storageMock.getErpIntegracoesResumo.mockImplementation(async (providerId: number) => {
    dbFalso.estado.linhas = LINHAS_POR_PROVEDOR[providerId] ?? [];
    return erpReal.getErpIntegracoesResumo(providerId);
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessao;
    next();
  });
  app.use(registerErpRoutes());
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
});

describe("as rotas de escrita do provedor deixaram de existir", () => {
  // 404 e a prova de que a rota SUMIU. Um 403 diria apenas que ela continua la,
  // protegida por um middleware que amanha alguem afrouxa.
  it("PATCH /api/provider/erp-integrations/:source responde 404", async () => {
    sessao = { userId: 1, providerId: 42, role: "admin" };
    const res = await fetch(`${base}/api/provider/erp-integrations/ixc`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiToken: "tentativa-de-gravar" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/provider/erp-integrations/:source/test responde 404", async () => {
    sessao = { userId: 1, providerId: 42, role: "admin" };
    const res = await fetch(`${base}/api/provider/erp-integrations/ixc/test`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("POST /api/provider/erp-integrations/:source/sync responde 404", async () => {
    sessao = { userId: 1, providerId: 42, role: "admin" };
    const res = await fetch(`${base}/api/provider/erp-integrations/ixc/sync`, { method: "POST" });
    expect(res.status).toBe(404);
    expect(syncMock.syncProviderToDb).not.toHaveBeenCalled();
  });

  it("as rotas anonimas de catalogo tambem sumiram", async () => {
    const disponiveis = await fetch(`${base}/api/erp/available`);
    expect(disponiveis.status).toBe(404);
    // Esta publicava o formato exato dos campos de credencial de cada ERP.
    const campos = await fetch(`${base}/api/erp/config-fields/ixc`);
    expect(campos.status).toBe(404);
  });
});

describe("GET /api/provider/erp-integrations", () => {
  it("401 sem sessao e 403 sem provedor", async () => {
    expect((await fetch(`${base}/api/provider/erp-integrations`)).status).toBe(401);
    sessao = { userId: 1, role: "superadmin" };
    expect((await fetch(`${base}/api/provider/erp-integrations`)).status).toBe(403);
  });

  /**
   * A assercao e sobre o JSON SERIALIZADO INTEIRO, nao campo a campo de
   * proposito: se amanha alguem acrescentar uma credencial nova ao retorno, uma
   * lista de `expect(x.apiToken).toBeUndefined()` continuaria verde. Procurar o
   * VALOR do segredo no texto pega qualquer nome de campo.
   */
  it("nao devolve credencial nenhuma — nem sob nome novo", async () => {
    sessao = { userId: 1, providerId: 42, role: "user" };
    const res = await fetch(`${base}/api/provider/erp-integrations`);
    expect(res.status).toBe(200);
    const texto = await res.text();

    for (const segredo of [
      "token-secreto-do-42",
      "usuario-do-42",
      "client-id-do-42",
      "client-secret-do-42",
      "contra-senha-do-42",
      "app-do-42",
      "https://erp-do-provedor-42.example",
      "anotacao interna do superadmin",
    ]) {
      expect(texto).not.toContain(segredo);
    }
    for (const chave of ["apiUrl", "apiToken", "apiUser", "clientId", "clientSecret", "mkContraSenha", "extraConfig", "notes"]) {
      expect(texto).not.toContain(chave);
    }
  });

  it("entrega o contrato de exibicao: estado e contadores", async () => {
    sessao = { userId: 1, providerId: 42, role: "user" };
    const corpo = await (await fetch(`${base}/api/provider/erp-integrations`)).json();
    expect(corpo[0]).toEqual({
      erpSource: "ixc",
      isEnabled: true,
      configurado: true,
      status: "idle",
      lastSyncAt: "2026-09-01T10:00:00.000Z",
      lastSyncStatus: "success",
      totalSynced: 120,
      totalErrors: 2,
    });
  });

  // Meia credencial nao conecta. Dizer "integrado" com so um dos dois manda o
  // provedor esperar um sync que nunca vai acontecer.
  it("`configurado` e E logico, nunca OU", async () => {
    sessao = { userId: 1, providerId: 42, role: "user" };
    const corpo = await (await fetch(`${base}/api/provider/erp-integrations`)).json();
    const porErp = Object.fromEntries(corpo.map((i: any) => [i.erpSource, i.configurado]));
    expect(porErp).toEqual({ ixc: true, mk: false, sgp: false });
  });

  it("isola por tenant: a sessao do 42 nunca alcanca a linha do 77", async () => {
    sessao = { userId: 1, providerId: 42, role: "user" };
    const texto = await (await fetch(`${base}/api/provider/erp-integrations`)).text();
    expect(storageMock.getErpIntegracoesResumo).toHaveBeenCalledWith(42);
    expect(texto).not.toContain("voalle");
    expect(texto).not.toContain("token-secreto-do-77");
    expect(texto).not.toContain("999");
  });

  it("o providerId vem da sessao, e nao do que o cliente pedir", async () => {
    sessao = { userId: 1, providerId: 42, role: "user" };
    await fetch(`${base}/api/provider/erp-integrations?providerId=77`);
    expect(storageMock.getErpIntegracoesResumo).toHaveBeenCalledWith(42);
  });
});

describe("GET /api/provider/erp-integration-stats", () => {
  // O nome diz "stats", mas a funcao devolvia a lista inteira de integracoes com
  // o token cifrado dentro. Era a porta de vazamento mais facil de esquecer.
  it("nao devolve o array `integrations`", async () => {
    sessao = { userId: 1, providerId: 42, role: "user" };
    const res = await fetch(`${base}/api/provider/erp-integration-stats`);
    expect(res.status).toBe(200);
    const texto = await res.text();
    expect(texto).not.toContain("integrations");
    expect(JSON.parse(texto)).toEqual({
      totalEnabled: 1,
      totalSynced: 120,
      totalErrors: 2,
      lastSync: "2026-09-01T10:00:00.000Z",
    });
  });

  it("isola por tenant", async () => {
    sessao = { userId: 1, providerId: 42, role: "user" };
    await fetch(`${base}/api/provider/erp-integration-stats`);
    expect(storageMock.getErpIntegrationStats).toHaveBeenCalledWith(42);
  });
});

describe("POST /api/admin/providers/:id/sync/:source", () => {
  const fonteValida = getSupportedSources()[0];

  it("403 para quem nao e superadmin", async () => {
    sessao = { userId: 1, providerId: 42, role: "admin" };
    const res = await fetch(`${base}/api/admin/providers/42/sync/${fonteValida}`, { method: "POST" });
    expect(res.status).toBe(403);
    expect(syncMock.syncProviderToDb).not.toHaveBeenCalled();
  });

  it("400 quando o id nao e numero", async () => {
    sessao = { userId: 1, role: "superadmin" };
    const res = await fetch(`${base}/api/admin/providers/abc/sync/${fonteValida}`, { method: "POST" });
    expect(res.status).toBe(400);
    expect(storageMock.getProvider).not.toHaveBeenCalled();
  });

  it("400 quando o ERP nao existe no registry", async () => {
    sessao = { userId: 1, role: "superadmin" };
    const res = await fetch(`${base}/api/admin/providers/42/sync/erp-inventado`, { method: "POST" });
    expect(res.status).toBe(400);
    expect(storageMock.getProvider).not.toHaveBeenCalled();
  });

  it("404 quando o provedor nao existe", async () => {
    sessao = { userId: 1, role: "superadmin" };
    storageMock.getProvider.mockResolvedValueOnce(null);
    const res = await fetch(`${base}/api/admin/providers/999/sync/${fonteValida}`, { method: "POST" });
    expect(res.status).toBe(404);
    expect(syncMock.syncProviderToDb).not.toHaveBeenCalled();
  });

  it("202 e dispara sem esperar a varredura", async () => {
    sessao = { userId: 1, role: "superadmin" };
    storageMock.getProvider.mockResolvedValueOnce({ id: 42, name: "Provedor 42" });
    storageMock.getErpIntegrations.mockResolvedValueOnce([
      { erpSource: fonteValida, apiUrl: "https://erp.example", apiToken: "t", apiUser: "u" },
    ]);
    const res = await fetch(`${base}/api/admin/providers/42/sync/${fonteValida}`, { method: "POST" });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true, iniciado: true });
    expect(syncMock.syncProviderToDb).toHaveBeenCalledTimes(1);
  });
});
