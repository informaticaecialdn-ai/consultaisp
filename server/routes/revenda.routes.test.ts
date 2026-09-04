import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * O PAINEL DO REVENDEDOR — `/api/revenda/*`.
 *
 * O que se prova aqui nao e "a rota responde 200". E que as tres barreiras que
 * separam um revendedor do que nao e dele continuam de pe quando alguem mexe no
 * codigo:
 *
 *   1. QUEM ENTRA. So `role: "revendedor"`. Provedor nao entra; SUPERADMIN
 *      TAMBEM NAO — ele tem `/api/admin/marcas/:id` com o mesmo conteudo, e
 *      deixa-lo passar daria a uma sessao sem marca um escopo (`session.marcaId`)
 *      que ninguem gravou, com `undefined` filtrando query.
 *   2. O QUE ELE EDITA. A metade nao-comercial da marca. Comissao, repasse,
 *      `revenda_ativa`, `status_comercial`, slug e dominio sao recusados — e a
 *      recusa e DERIVADA de `esquemaMarcaDoSuperadmin`, entao um campo comercial
 *      novo nasce recusado sem ninguem lembrar do painel do revendedor. Ha um
 *      teste que percorre as colunas de `marcas` e falha se alguma nao estiver
 *      declarada de um lado ou do outro.
 *   3. O QUE ELE VE. Nem a chave PIX de repasse, nem a senha da propria equipe.
 *      Isso e provado onde a garantia mora de verdade — nas COLUNAS do `select`
 *      do storage —, e nao so no formato da resposta.
 *
 * Os middlewares de `../auth` entram COMO OS REAIS. Mockar `requireRevendedor`
 * provaria apenas que a rota chama alguma coisa, e a linha perigosa e
 * justamente a que ele contem: `requireAuth` devolve `next()` de imediato para
 * superadmin, entao sem a segunda barreira o superadmin cairia dentro do
 * painel de uma marca que a sessao dele nao nomeia.
 *
 * O storage e um duble com semantica de verdade (equipe que encolhe, marca que
 * guarda o que foi gravado) em vez de `mockResolvedValue`: metade dos casos
 * depende de a equipe ter dois membros e passar a ter um.
 */

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-vitest";
});

vi.mock("express-session", () => ({ default: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("connect-pg-simple", () => ({ default: () => class MockPgStore {} }));

/**
 * O banco falso. Serve ao ultimo bloco deste arquivo, que exercita o storage
 * DE VERDADE para conferir a FORMA das consultas — quais colunas saem, com que
 * filtro e sob qual lock. As rotas nao passam por aqui: elas falam com o duble.
 */
const registro = vi.hoisted(() => ({
  selects: [] as { colunas: Record<string, unknown>; lock: string | null; cond: unknown }[],
  deletes: [] as { cond: unknown }[],
  inserts: [] as { valores: Record<string, unknown>; colunas: Record<string, unknown> }[],
  updates: [] as { valores: Record<string, unknown>; cond: unknown; colunas: Record<string, unknown> }[],
  execucoes: [] as unknown[],
  transacoes: 0,
  dentroDaTransacao: [] as string[],
  /** O que o proximo `select` devolve. Cada teste ajusta. */
  linhas: [] as any[],
  /** O que o proximo `delete ... returning` devolve. */
  apagados: [] as any[],
}));

const dbMock = vi.hoisted(() => {
  const construirSelect = (dentro: boolean) => (colunas: Record<string, unknown>) => {
    const alvo = { colunas, lock: null as string | null, cond: undefined as unknown };
    const finalizar = () => {
      registro.selects.push(alvo);
      if (dentro) registro.dentroDaTransacao.push("select");
      return Promise.resolve(registro.linhas);
    };
    const comWhere: any = {
      for: (strength: string) => { alvo.lock = strength; return finalizar(); },
      then: (r: any, j: any) => finalizar().then(r, j),
      orderBy: () => comWhere,
    };
    return {
      from: () => ({
        where: (cond: unknown) => { alvo.cond = cond; return comWhere; },
      }),
    };
  };

  const tx = {
    select: construirSelect(true),
    delete: () => ({
      where: (cond: unknown) => ({
        returning: () => {
          registro.deletes.push({ cond });
          registro.dentroDaTransacao.push("delete");
          return Promise.resolve(registro.apagados);
        },
      }),
    }),
    execute: async (q: unknown) => {
      registro.execucoes.push(q);
      registro.dentroDaTransacao.push("execute");
    },
  };

  return {
    pool: {},
    db: {
      select: construirSelect(false),
      insert: () => ({
        values: (valores: Record<string, unknown>) => ({
          returning: (colunas: Record<string, unknown>) => {
            registro.inserts.push({ valores, colunas });
            return Promise.resolve([{ id: 999, ...valores }]);
          },
        }),
      }),
      update: () => ({
        set: (valores: Record<string, unknown>) => ({
          where: (cond: unknown) => ({
            returning: (colunas: Record<string, unknown>) => {
              registro.updates.push({ valores, cond, colunas });
              return Promise.resolve([{ id: 7, ...valores }]);
            },
          }),
        }),
      }),
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
        registro.transacoes++;
        return fn(tx);
      },
      execute: async () => { throw new Error("execute fora da transacao"); },
    },
  };
});
vi.mock("../db", () => dbMock);

const loggerMock = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../logger", () => loggerMock);

vi.mock("../password", () => ({
  hashPassword: vi.fn(async (s: string) => `hash:${s}`),
  verifyPassword: vi.fn(async () => true),
}));

/**
 * `../storage` (o barril) e mockado porque `marca.routes.ts` — de onde vem o
 * esquema zod importado — o consome. Nenhuma rota deste arquivo o usa.
 */
vi.mock("../storage", () => ({
  storage: {
    getMarca: vi.fn(async () => undefined),
    getProvider: vi.fn(async () => undefined),
    getUser: vi.fn(async () => undefined),
  },
}));

const marcaServiceMock = vi.hoisted(() => ({ esquecerMarcas: vi.fn() }));
vi.mock("../services/marca.service", () => marcaServiceMock);

const eventosMock = vi.hoisted(() => ({
  registrarEventoDaMarca: vi.fn(async () => undefined),
  listarEventosDaMarca: vi.fn(async (_m: number, _l?: number) => [] as any[]),
}));
vi.mock("../services/marca-eventos.service", () => eventosMock);

/**
 * O convite por e-mail. Mockado para o teste afirmar QUE ele sai, com quem
 * convidou e sem a senha — e para que a falha de envio seja encenavel.
 */
const emailMock = vi.hoisted(() => ({
  sendUsuarioDeEquipeEmail: vi.fn(async (_to: string, _d: any, _m: number) => undefined),
}));
vi.mock("../services/email", () => emailMock);

// ── O duble do storage ──────────────────────────────────────────────────────

const MARCA_A = 7;
const MARCA_B = 8;

/** O estado do "banco" que o duble representa. */
const estado = vi.hoisted(() => ({
  marcas: new Map<number, Record<string, any>>(),
  equipe: [] as any[],
  provedores: [] as { marcaId: number; status: string; verificationStatus: string; novo: boolean }[],
  proximoId: 100,
  /** E-mails que ja existem em OUTRO tenant — para o 409 de unicidade global. */
  emailsOcupados: new Set<string>(),
}));

/**
 * As MESMAS colunas que `COLUNAS_DA_MARCA` projeta no storage real. O duble
 * devolve exatamente isto e nada mais: se ele devolvesse a linha inteira, o
 * teste de vazamento passaria a medir a disciplina da rota em vez do contrato
 * do storage, e o contrato do storage e onde a garantia mora (ha um bloco no
 * fim deste arquivo que prova as colunas do `select` de verdade).
 */
function projetarMarca(m: Record<string, any>) {
  return {
    id: m.id, slug: m.slug, ativo: m.ativo, nomeProduto: m.nomeProduto,
    assinatura: m.assinatura ?? null, dominio: m.dominio ?? null,
    dominioStatus: m.dominioStatus, corBrand: m.corBrand,
    corBrandDark: m.corBrandDark ?? null, emailRemetente: m.emailRemetente ?? null,
    emailNomeExibicao: m.emailNomeExibicao ?? null, suporteEmail: m.suporteEmail ?? null,
    suporteWhatsapp: m.suporteWhatsapp ?? null, site: m.site ?? null,
    responsavelRazaoSocial: m.responsavelRazaoSocial ?? null, responsavelCnpj: m.responsavelCnpj ?? null,
    cadastroAberto: m.cadastroAberto, landingAtiva: m.landingAtiva, landing: m.landing,
    temLogo: Boolean(m.logoSvg || m.logoPng),
    logoEhPng: Boolean(!m.logoSvg && m.logoPng),
    temFavicon: Boolean(m.faviconSvg),
    temOgImage: Boolean(m.ogImagePng),
  };
}

const dubleStorage = vi.hoisted(() => ({
  resumoDaMarca: vi.fn(),
  equipeDaMarca: vi.fn(),
  membroDaEquipe: vi.fn(),
  criarMembroDaEquipe: vi.fn(),
  removerMembroDaEquipe: vi.fn(),
  marcaDoRevendedor: vi.fn(),
  atualizarMarcaDoRevendedor: vi.fn(),
}));
vi.mock("../storage/revenda.storage", () => dubleStorage);

import { requireAuth } from "../auth";
import { corpoEhSensivel, sanitizeForLog } from "../utils/sanitize-log";
import { registerRevendaRoutes, CAMPOS_EDITAVEIS_PELO_REVENDEDOR, motivoDeRecusa } from "./revenda.routes";

let server: Server;
let base: string;
let sessao: Record<string, any>;

/** O que a captura de log do `index.ts` teria guardado da ultima resposta. */
const capturado: { corpo: unknown } = { corpo: undefined };

/**
 * `hostLogin` e "127.0.0.1" em toda sessao porque e para la que o `fetch` deste
 * teste aponta, e `requireAuth` compara `hostLogin` com `req.hostname`. Um
 * teste especifico troca esse valor para provar que a comparacao esta viva.
 */
const HOST = "127.0.0.1";
const REVENDEDOR_A = { userId: 10, role: "revendedor", providerId: 0, marcaId: MARCA_A, hostLogin: HOST };
const REVENDEDOR_B = { userId: 20, role: "revendedor", providerId: 0, marcaId: MARCA_B, hostLogin: HOST };
const ADMIN_DE_PROVEDOR = { userId: 5, role: "admin", providerId: 42, hostLogin: HOST };
const OPERADOR = { userId: 6, role: "user", providerId: 42, hostLogin: HOST };
const SUPERADMIN = { userId: 1, role: "superadmin", providerId: 0 };

function como(s: Record<string, any>) {
  sessao = { ...s, save: (cb: (e?: unknown) => void) => cb() };
}

async function pedir(metodo: string, caminho: string, corpo?: unknown) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: corpo === undefined ? {} : { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json: any = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* corpo nao-JSON */ }
  return { status: r.status, json, texto };
}

beforeAll(async () => {
  const app = express();
  // O MESMO teto da producao (`server/index.ts`: `express.json({limit:"10mb"})`).
  // Com o padrao de 100 KB do Express, o teste do SVG gigante passaria por 413
  // do body-parser e a checagem de 256 KB deste modulo nunca seria exercitada —
  // e ela e load-bearing: em producao cabem 10 MB no corpo, e sem ela esses
  // 10 MB iriam para `logo_svg` e sairiam a cada visitante do dominio da marca.
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });

  /**
   * O MESMO middleware de log de `server/index.ts`, DECISAO INCLUSA.
   *
   * Ele troca `res.json` por uma versao que guarda o objeto e, no `finish`,
   * so imprime quando `corpoEhSensivel(caminho)` for falso. Reproduzir apenas
   * a captura — que foi o que este arquivo fazia antes — media a coisa errada:
   * afirmava que a rota nao usava `res.json`, e nao que a senha nao chega ao
   * arquivo. Com a decisao aqui dentro, `capturado.corpo` e literalmente "o
   * que teria virado linha de log", que e a pergunta.
   */
  app.use((req, res, next) => {
    capturado.corpo = undefined;
    let doJson: unknown = undefined;
    const original = res.json;
    res.json = function (corpo: any, ...resto: any[]) {
      doJson = corpo;
      return original.apply(res, [corpo, ...resto] as any);
    };
    res.on("finish", () => {
      if (doJson !== undefined && !corpoEhSensivel(req.path.toLowerCase())) {
        capturado.corpo = sanitizeForLog(doJson);
      }
    });
    next();
  });

  app.use(registerRevendaRoutes());

  /**
   * Uma rota de PROVEDOR qualquer, com a barreira real. Existe para provar a
   * outra metade do confinamento: o revendedor entra no painel dele e NAO entra
   * no dado operacional de provedor, que e o bloqueio central de `requireAuth`.
   */
  app.get("/api/dashboard/stats", requireAuth, (_req, res) => res.json({ segredo: "carteira do provedor" }));

  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

function marcaNova(id: number, extra: Record<string, any> = {}) {
  return {
    id, slug: `marca-${id}`, ativo: true, nomeProduto: `Marca ${id}`, assinatura: null,
    dominio: `app.marca${id}.test`, dominioStatus: "ativo",
    corBrand: "#4A4670", corBrandDark: null,
    emailRemetente: null, emailNomeExibicao: null,
    suporteEmail: null, suporteWhatsapp: null, site: null,
    responsavelRazaoSocial: null, responsavelCnpj: null,
    revendaAtiva: true, statusComercial: "ativo", comissaoPercentual: "20.00",
    repasseRazaoSocial: "Revenda LTDA", repasseCnpj: "11222333000181",
    repasseChavePix: "chave-pix-secretissima", repasseEmail: "financeiro@marca.test",
    cadastroAberto: false, landingAtiva: false, landing: {},
    logoSvg: null, logoPng: null, faviconSvg: null, ogImagePng: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SERVER_PUBLIC_IP;

  estado.marcas = new Map([[MARCA_A, marcaNova(MARCA_A)], [MARCA_B, marcaNova(MARCA_B)]]);
  estado.equipe = [
    { id: 10, marcaId: MARCA_A, name: "Ana Revenda", email: "ana@crednet.test", role: "revendedor", emailVerified: true, mustChangePassword: false, createdAt: new Date("2031-01-01") },
    { id: 11, marcaId: MARCA_A, name: "Bruno Revenda", email: "bruno@crednet.test", role: "revendedor", emailVerified: true, mustChangePassword: true, createdAt: new Date("2031-01-02") },
    { id: 20, marcaId: MARCA_B, name: "Sozinho da Outra", email: "so@outra.test", role: "revendedor", emailVerified: true, mustChangePassword: false, createdAt: new Date("2031-01-03") },
  ];
  estado.provedores = [
    { marcaId: MARCA_A, status: "active", verificationStatus: "approved", novo: true },
    { marcaId: MARCA_A, status: "active", verificationStatus: "pending", novo: false },
    { marcaId: MARCA_A, status: "suspended", verificationStatus: "approved", novo: false },
    { marcaId: MARCA_B, status: "active", verificationStatus: "approved", novo: false },
  ];
  estado.proximoId = 100;
  estado.emailsOcupados = new Set(["ja-existe@qualquer.test"]);

  registro.selects = []; registro.deletes = []; registro.inserts = []; registro.updates = [];
  registro.execucoes = []; registro.transacoes = 0; registro.dentroDaTransacao = [];
  registro.linhas = []; registro.apagados = [];
  emailMock.sendUsuarioDeEquipeEmail.mockResolvedValue(undefined);

  const equipeDe = (marcaId: number) => estado.equipe.filter(m => m.marcaId === marcaId && m.role === "revendedor");

  dubleStorage.resumoDaMarca.mockImplementation(async (marcaId: number) => {
    const meus = estado.provedores.filter(p => p.marcaId === marcaId);
    return {
      total: meus.length,
      ativos: meus.filter(p => p.status === "active").length,
      suspensos: meus.filter(p => p.status === "suspended").length,
      cancelados: meus.filter(p => p.status === "cancelled").length,
      aguardandoAprovacao: meus.filter(p => p.verificationStatus === "pending").length,
      novosNoMes: meus.filter(p => p.novo).length,
    };
  });
  dubleStorage.equipeDaMarca.mockImplementation(async (marcaId: number) =>
    equipeDe(marcaId).map(({ marcaId: _m, ...resto }) => resto));
  dubleStorage.membroDaEquipe.mockImplementation(async (marcaId: number, userId: number) => {
    const m = equipeDe(marcaId).find(x => x.id === userId);
    if (!m) return undefined;
    const { marcaId: _m, ...resto } = m;
    return resto;
  });
  dubleStorage.criarMembroDaEquipe.mockImplementation(async (marcaId: number, dados: any) => {
    if (estado.emailsOcupados.has(dados.email) || estado.equipe.some(m => m.email === dados.email)) {
      const erro: any = new Error("duplicate key value violates unique constraint");
      erro.code = "23505";
      throw erro;
    }
    const novo = {
      id: estado.proximoId++, marcaId, name: dados.name, email: dados.email,
      role: "revendedor", emailVerified: true, mustChangePassword: true, createdAt: new Date(),
    };
    estado.equipe.push(novo);
    const { marcaId: _m, ...resto } = novo;
    return resto;
  });
  dubleStorage.removerMembroDaEquipe.mockImplementation(async (marcaId: number, userId: number) => {
    const equipe = equipeDe(marcaId);
    if (!equipe.some(m => m.id === userId)) return "nao_encontrado";
    if (equipe.length <= 1) return "ultimo";
    estado.equipe = estado.equipe.filter(m => m.id !== userId);
    return "removido";
  });
  dubleStorage.marcaDoRevendedor.mockImplementation(async (marcaId: number) => {
    const m = estado.marcas.get(marcaId);
    return m ? projetarMarca(m) : undefined;
  });
  dubleStorage.atualizarMarcaDoRevendedor.mockImplementation(async (marcaId: number, dados: any) => {
    const m = estado.marcas.get(marcaId);
    if (!m) return undefined;
    Object.assign(m, dados);
    return projetarMarca(m);
  });
});

// ── 1. Quem entra ───────────────────────────────────────────────────────────

describe("quem entra em /api/revenda", () => {
  const CAMINHOS = [
    ["GET", "/api/revenda/visao-geral"],
    ["GET", "/api/revenda/marca"],
    ["GET", "/api/revenda/usuarios"],
    ["GET", "/api/revenda/eventos"],
  ] as const;

  it("sessao de ADMIN de provedor recebe 403 em todo o namespace", async () => {
    como(ADMIN_DE_PROVEDOR);
    for (const [metodo, caminho] of CAMINHOS) {
      const r = await pedir(metodo, caminho);
      expect(r.status, `${metodo} ${caminho}`).toBe(403);
    }
    expect(dubleStorage.resumoDaMarca).not.toHaveBeenCalled();
    expect(dubleStorage.marcaDoRevendedor).not.toHaveBeenCalled();
  });

  it("sessao de OPERADOR de provedor recebe 403", async () => {
    como(OPERADOR);
    expect((await pedir("GET", "/api/revenda/visao-geral")).status).toBe(403);
  });

  /**
   * O caso que mais custaria caro: `requireAuth` devolve `next()` de imediato
   * para superadmin, entao sem `requireRevendedor` a sessao dele entraria aqui
   * com `session.marcaId` `undefined` — e `undefined` filtrando query nao
   * filtra nada. O superadmin tem `/api/admin/marcas/:id` com o mesmo conteudo.
   */
  it("sessao de SUPERADMIN recebe 403: ele tem a rota de admin, nao esta", async () => {
    como(SUPERADMIN);
    for (const [metodo, caminho] of CAMINHOS) {
      const r = await pedir(metodo, caminho);
      expect(r.status, `${metodo} ${caminho}`).toBe(403);
    }
    expect(dubleStorage.resumoDaMarca).not.toHaveBeenCalled();
  });

  it("sem sessao nenhuma: 401", async () => {
    como({});
    expect((await pedir("GET", "/api/revenda/visao-geral")).status).toBe(401);
  });

  /**
   * A prova de host tem de continuar viva DENTRO deste namespace. O dominio da
   * marca E a credencial de qual marca a sessao responde; se a comparacao sair,
   * o cookie de uma marca passa a valer no dominio de outra.
   */
  it("sessao de revendedor aberta em OUTRO host: 403", async () => {
    como({ ...REVENDEDOR_A, hostLogin: "app.outra-marca.test" });
    const r = await pedir("GET", "/api/revenda/visao-geral");
    expect(r.status).toBe(403);
    expect(r.json.message).toMatch(/endereco/i);
  });

  it("sessao de revendedor sem marca: 401, e nao um escopo vazio", async () => {
    como({ ...REVENDEDOR_A, marcaId: 0 });
    expect((await pedir("GET", "/api/revenda/visao-geral")).status).toBe(401);
  });

  /** A outra metade do confinamento: ele nao sai do proprio painel. */
  it("revendedor em rota de provedor: 403 'Somente provedores'", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("GET", "/api/dashboard/stats");
    expect(r.status).toBe(403);
    expect(r.json.message).toBe("Somente provedores");
    expect(r.texto).not.toContain("carteira do provedor");
  });

  it("revendedor entra no proprio painel", async () => {
    como(REVENDEDOR_A);
    expect((await pedir("GET", "/api/revenda/visao-geral")).status).toBe(200);
  });
});

// ── 2. Escopo: tudo sai de session.marcaId ──────────────────────────────────

describe("escopo por session.marcaId", () => {
  it("a visao geral conta so os provedores da propria marca", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("GET", "/api/revenda/visao-geral");
    expect(r.status).toBe(200);
    // Tres provedores em A; o quarto e de B e nao aparece nem na contagem.
    expect(r.json.provedores).toMatchObject({ total: 3, ativos: 2, suspensos: 1, aguardandoAprovacao: 1, novosNoMes: 1 });
    expect(dubleStorage.resumoDaMarca).toHaveBeenCalledWith(MARCA_A);
  });

  it("a mesma rota, com a sessao da outra marca, devolve os numeros da outra marca", async () => {
    como(REVENDEDOR_B);
    const r = await pedir("GET", "/api/revenda/visao-geral");
    expect(r.json.provedores.total).toBe(1);
    expect(dubleStorage.resumoDaMarca).toHaveBeenCalledWith(MARCA_B);
  });

  /**
   * `marcaId` no corpo e na query e ignorado — nao "conferido". Conferir contra
   * a sessao e so uma forma mais longa de usar a sessao, com uma chance a mais
   * de alguem inverter a comparacao.
   */
  it("marcaId no corpo do PATCH nao muda o alvo: e recusado como campo desconhecido", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("PATCH", "/api/revenda/marca", { marcaId: MARCA_B, nomeProduto: "Sequestro" });
    expect(r.status).toBe(400);
    expect(estado.marcas.get(MARCA_B)!.nomeProduto).toBe(`Marca ${MARCA_B}`);
  });

  it("marcaId na query da visao geral e ignorado", async () => {
    como(REVENDEDOR_A);
    await pedir("GET", `/api/revenda/visao-geral?marcaId=${MARCA_B}`);
    expect(dubleStorage.resumoDaMarca).toHaveBeenCalledWith(MARCA_A);
  });

  /**
   * Comissao e consumo NAO vem zerados: vem ausentes. Um zero e um NUMERO, e o
   * revendedor nao teria como distinguir "a plataforma ainda nao apura isso" de
   * "voce nao vendeu nada" — a leitura mais cara possivel, porque e sobre o
   * dinheiro dele. As fases 3 e 4 acrescentam as chaves.
   */
  it("a visao geral nao inventa comissao nem consumo zerados", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("GET", "/api/revenda/visao-geral");
    expect(Object.keys(r.json)).toEqual(["provedores"]);
    expect(r.texto).not.toMatch(/comissao|consumo|creditosVendidos/i);
  });
});

// ── 3. A propria marca: leitura ─────────────────────────────────────────────

describe("GET /api/revenda/marca", () => {
  it("devolve a marca da sessao, nunca a do vizinho", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("GET", "/api/revenda/marca");
    expect(r.status).toBe(200);
    expect(r.json.id).toBe(MARCA_A);
    expect(dubleStorage.marcaDoRevendedor).toHaveBeenCalledWith(MARCA_A);
  });

  /**
   * A chave PIX de repasse e o CNPJ do beneficiario sao decisao 6 do dono: so
   * o superadmin le e escreve. O teste varre o corpo CRU, e nao as chaves do
   * objeto, para pegar tambem o caso de o valor vazar dentro de outro campo.
   */
  it("nao vaza repasse, comissao nem os arquivos em base64", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("GET", "/api/revenda/marca");
    for (const proibido of ["repasse", "chave-pix-secretissima", "11222333000181", "comissaoPercentual", "logoSvg", "logoPng", "faviconSvg", "ogImagePng"]) {
      expect(r.texto, `vazou ${proibido}`).not.toContain(proibido);
    }
    // O que a tela precisa saber sobre os arquivos e se EXISTEM.
    expect(r.json).toHaveProperty("temLogo", false);
    expect(r.json).toHaveProperty("temFavicon", false);
  });

  it("traz o IP do registro A quando o ambiente o publica, com dominio e status", async () => {
    process.env.SERVER_PUBLIC_IP = "203.0.113.10";
    estado.marcas.get(MARCA_A)!.dominioStatus = "pendente";
    como(REVENDEDOR_A);
    const r = await pedir("GET", "/api/revenda/marca");
    expect(r.json).toMatchObject({ dnsIp: "203.0.113.10", dominio: "app.marca7.test", dominioStatus: "pendente" });
  });

  /**
   * Sem `SERVER_PUBLIC_IP` o campo e NULO, e a tela diz "peca ao suporte". Um IP
   * inventado ou de outro ambiente nao daria erro visivel: daria a pagina de
   * outra pessoa no dominio do revendedor.
   */
  it("sem SERVER_PUBLIC_IP nao inventa endereco", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("GET", "/api/revenda/marca");
    expect(r.json.dnsIp).toBeNull();
  });

  /**
   * A previa e derivada no SERVIDOR, pelo mesmo `marca-cores.ts` que a
   * aplicacao usa para valer. Recalculada na tela, ela mostraria uma paleta que
   * nao e a que vai ao ar no dia em que as duas implementacoes divergirem — e o
   * ajuste de contraste e justamente a parte que surpreende quem escolheu a cor.
   */
  it("devolve a previa das cores derivada no servidor", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("GET", "/api/revenda/marca");
    expect(r.json.previa.claro.brand).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(r.json.previa.escuro.brand).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(typeof r.json.previa.claro.ajustada).toBe("boolean");
  });

  it("cor gravada invalida: previa nula, e nao uma paleta inventada", async () => {
    estado.marcas.get(MARCA_A)!.corBrand = "nao-e-cor";
    como(REVENDEDOR_A);
    const r = await pedir("GET", "/api/revenda/marca");
    expect(r.json.previa).toBeNull();
  });

  /**
   * `responsavel*` e quem responde ao TITULAR pela LGPD — o nome que a politica
   * publica da marca estampa —, e nao se confunde com `repasse*`, que e para
   * onde vai o dinheiro. O revendedor ve o que esta publicado em nome dele.
   */
  it("mostra o responsavel LGPD em leitura, sem permitir edicao", async () => {
    estado.marcas.get(MARCA_A)!.responsavelRazaoSocial = "CredNet Servicos LTDA";
    como(REVENDEDOR_A);
    const r = await pedir("GET", "/api/revenda/marca");
    expect(r.json.responsavelRazaoSocial).toBe("CredNet Servicos LTDA");
    expect((await pedir("PATCH", "/api/revenda/marca", { responsavelRazaoSocial: "Outra" })).status).toBe(400);
  });

  it("sessao apontando para marca que nao existe mais: 404 registrado", async () => {
    estado.marcas.delete(MARCA_A);
    como(REVENDEDOR_A);
    const r = await pedir("GET", "/api/revenda/marca");
    expect(r.status).toBe(404);
    expect(loggerMock.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 10, marcaId: MARCA_A }),
      expect.stringContaining("[revenda]"),
    );
  });
});

// ── 4. A propria marca: escrita ─────────────────────────────────────────────

describe("PATCH /api/revenda/marca", () => {
  const PROIBIDOS: [string, unknown][] = [
    ["slug", "outra-marca"],
    ["dominio", "app.roubada.test"],
    ["dominioStatus", "ativo"],
    ["ativo", true],
    ["emailRemetente", "eu@marca.test"],
    ["responsavelRazaoSocial", "Outra Razao LTDA"],
    ["responsavelCnpj", "11222333000181"],
    ["revendaAtiva", true],
    ["statusComercial", "ativo"],
    ["comissaoPercentual", 50],
    ["repasseRazaoSocial", "Minha Empresa"],
    ["repasseCnpj", "11222333000181"],
    ["repasseChavePix", "pix-novo"],
    ["repasseEmail", "eu@marca.test"],
  ];

  it.each(PROIBIDOS)("recusa %s e nao grava nada", async (campo, valor) => {
    como(REVENDEDOR_A);
    const antes = { ...estado.marcas.get(MARCA_A)! };
    const r = await pedir("PATCH", "/api/revenda/marca", { [campo]: valor });
    expect(r.status).toBe(400);
    expect(r.json.message).toBeTruthy();
    expect(dubleStorage.atualizarMarcaDoRevendedor).not.toHaveBeenCalled();
    expect(estado.marcas.get(MARCA_A)).toEqual(antes);
  });

  /**
   * Recusa acompanhada de campo editavel valido tambem para tudo. Sem isso o
   * pedido `{nomeProduto: "X", comissaoPercentual: 50}` gravaria o nome e
   * descartaria a comissao com 200 — e o revendedor leria "salvo" achando que
   * os dois passaram.
   */
  it("recusa o pedido INTEIRO quando um campo proibido acompanha um valido", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("PATCH", "/api/revenda/marca", { nomeProduto: "Nome Novo", comissaoPercentual: 50 });
    expect(r.status).toBe(400);
    expect(estado.marcas.get(MARCA_A)!.nomeProduto).toBe("Marca 7");
  });

  it("a tentativa de mudar condicao comercial vira aviso no log, com userId", async () => {
    como(REVENDEDOR_A);
    await pedir("PATCH", "/api/revenda/marca", { comissaoPercentual: 50 });
    expect(loggerMock.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 10, marcaId: MARCA_A, motivo: "tentou_alterar_condicao_comercial", campo: "comissaoPercentual" }),
      expect.any(String),
    );
  });

  it("grava os campos que sao dele", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("PATCH", "/api/revenda/marca", {
      nomeProduto: "CredNet", suporteEmail: "ajuda@crednet.test", cadastroAberto: true,
    });
    expect(r.status).toBe(200);
    expect(r.json.nomeProduto).toBe("CredNet");
    expect(estado.marcas.get(MARCA_A)).toMatchObject({ nomeProduto: "CredNet", suporteEmail: "ajuda@crednet.test", cadastroAberto: true });
  });

  /**
   * PATCH parcial de verdade: ausente MANTEM, `null` APAGA. Sem a distincao,
   * "apagar a assinatura" e "nao mexer na assinatura" seriam o mesmo pedido.
   */
  it("campo ausente e mantido; null apaga", async () => {
    estado.marcas.get(MARCA_A)!.assinatura = "Bureau da CredNet";
    estado.marcas.get(MARCA_A)!.site = "https://crednet.test";
    como(REVENDEDOR_A);

    await pedir("PATCH", "/api/revenda/marca", { nomeProduto: "CredNet" });
    expect(estado.marcas.get(MARCA_A)!.assinatura).toBe("Bureau da CredNet");

    await pedir("PATCH", "/api/revenda/marca", { assinatura: null });
    expect(estado.marcas.get(MARCA_A)!.assinatura).toBeNull();
    expect(estado.marcas.get(MARCA_A)!.site).toBe("https://crednet.test");
  });

  it("corpo vazio: 400, e nao um UPDATE sem coluna", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("PATCH", "/api/revenda/marca", {});
    expect(r.status).toBe(400);
    expect(dubleStorage.atualizarMarcaDoRevendedor).not.toHaveBeenCalled();
  });

  it("chave desconhecida e recusada, e nao descartada em silencio", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("PATCH", "/api/revenda/marca", { corDeFundo: "#000000" });
    expect(r.status).toBe(400);
    expect(r.json.message).toContain("corDeFundo");
  });

  it("cor invalida e recusada", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("PATCH", "/api/revenda/marca", { corBrand: "vermelho" });
    expect(r.status).toBe(400);
  });

  it("SVG que nao e SVG e recusado, e o gigante tambem", async () => {
    como(REVENDEDOR_A);
    expect((await pedir("PATCH", "/api/revenda/marca", { logoSvg: "<html><body>oi</body></html>" })).status).toBe(400);
    expect((await pedir("PATCH", "/api/revenda/marca", { logoSvg: `<svg>${"x".repeat(300 * 1024)}</svg>` })).status).toBe(400);
    expect((await pedir("PATCH", "/api/revenda/marca", { logoSvg: '<svg viewBox="0 0 1 1"></svg>' })).status).toBe(200);
  });

  it("PNG sem a assinatura do formato e recusado", async () => {
    como(REVENDEDOR_A);
    const falso = `data:image/png;base64,${Buffer.from("nao sou png de verdade").toString("base64")}`;
    expect((await pedir("PATCH", "/api/revenda/marca", { logoPng: falso })).status).toBe(400);

    const real = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13]).toString("base64")}`;
    expect((await pedir("PATCH", "/api/revenda/marca", { logoPng: real })).status).toBe(200);
  });

  /**
   * Grava a MESMA forma que validou. Os validadores conferem `valor.trim()`,
   * mas quem SERVE o PNG faz `replace(/^data:image\/png;base64,/, "")` — com um
   * espaco na frente, que sai de qualquer copiar-e-colar, o prefixo nao casa e
   * o `Buffer.from` recebe o cabecalho junto: bytes que nao sao PNG, logo que
   * nao aparece, e nenhum erro em lugar nenhum.
   */
  it("aparece o data URI antes de gravar, e nao so antes de validar", async () => {
    como(REVENDEDOR_A);
    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]).toString("base64")}`;
    const r = await pedir("PATCH", "/api/revenda/marca", { logoPng: `\n  ${png}  `, logoSvg: '  <svg viewBox="0 0 1 1"></svg>\n' });
    expect(r.status).toBe(200);
    expect(estado.marcas.get(MARCA_A)!.logoPng).toBe(png);
    expect(estado.marcas.get(MARCA_A)!.logoSvg!.startsWith("<svg")).toBe(true);
  });

  /**
   * O cache de host -> marca dura 5 minutos e e PROVA DE LOGIN. Sem esta
   * chamada o revendedor salvaria o nome novo e continuaria vendo o antigo no
   * proprio dominio dele.
   */
  it("toda gravacao invalida o cache de marcas", async () => {
    como(REVENDEDOR_A);
    await pedir("PATCH", "/api/revenda/marca", { nomeProduto: "CredNet" });
    expect(marcaServiceMock.esquecerMarcas).toHaveBeenCalledTimes(1);
  });

  it("grava o evento editar_marca sem o conteudo dos arquivos", async () => {
    como(REVENDEDOR_A);
    await pedir("PATCH", "/api/revenda/marca", { nomeProduto: "CredNet", logoSvg: '<svg viewBox="0 0 1 1"></svg>' });
    expect(eventosMock.registrarEventoDaMarca).toHaveBeenCalledWith(expect.objectContaining({
      marcaId: MARCA_A, userId: 10, atorRole: "revendedor", acao: "editar_marca",
      detalhe: { nomeProduto: "CredNet", logoSvg: "alterado" },
    }));
  });
});

// ── 5. A lista de campos nao pode ter buraco ────────────────────────────────

describe("cobertura da tabela marcas", () => {
  /**
   * Este e o teste que impede o buraco de aparecer por esquecimento: toda
   * coluna de `marcas` tem de estar declarada de UM dos lados. Coluna nova —
   * um segundo dado de repasse, um `asaasWalletId` — para este teste ate alguem
   * decidir se o revendedor a edita ou nao. Sem ele, a forma de vazar comissao
   * e repasse seria simplesmente ninguem lembrar do painel do revendedor.
   */
  it("toda coluna de marcas e editavel pelo revendedor OU declaradamente recusada", async () => {
    const { getTableColumns } = await import("drizzle-orm");
    const { marcas } = await import("@shared/schema");

    /** Geradas pelo banco: nao sao editaveis por rota nenhuma. */
    const GERADAS = new Set(["id", "createdAt"]);
    const editaveis = new Set(CAMPOS_EDITAVEIS_PELO_REVENDEDOR);

    const semDono = Object.keys(getTableColumns(marcas)).filter(
      c => !GERADAS.has(c) && !editaveis.has(c) && motivoDeRecusa(c) === null,
    );
    expect(semDono, "coluna de `marcas` sem lado declarado: decida se o revendedor a edita").toEqual([]);
  });

  /**
   * O elo entre os dois arquivos, dito por extenso: TODO campo da metade do
   * superadmin e recusado aqui. Se alguem mover um deles para a metade do
   * revendedor em `marca.routes.ts`, este teste e o `it.each` dos proibidos
   * caem juntos — e e assim que a mudanca vira conversa em vez de vazamento.
   */
  it("todo campo da metade do superadmin e recusado neste painel", async () => {
    const { esquemaMarcaDoSuperadmin } = await import("./marca.routes");
    const soDele = Object.keys(esquemaMarcaDoSuperadmin.shape);
    expect(soDele.length).toBeGreaterThan(0);
    for (const campo of soDele) {
      expect(motivoDeRecusa(campo), campo).toBeTruthy();
      expect(CAMPOS_EDITAVEIS_PELO_REVENDEDOR, campo).not.toContain(campo);
    }
  });

  it("nenhum campo comercial escapou para a lista de editaveis", () => {
    for (const proibido of ["slug", "dominio", "ativo", "revendaAtiva", "statusComercial", "comissaoPercentual",
      "repasseRazaoSocial", "repasseCnpj", "repasseChavePix", "repasseEmail",
      "responsavelRazaoSocial", "responsavelCnpj", "emailRemetente"]) {
      expect(CAMPOS_EDITAVEIS_PELO_REVENDEDOR, proibido).not.toContain(proibido);
      expect(motivoDeRecusa(proibido), proibido).toBeTruthy();
    }
  });
});

// ── 6. Equipe ───────────────────────────────────────────────────────────────

describe("equipe da marca", () => {
  it("lista so a propria equipe, sem senha nem token", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("GET", "/api/revenda/usuarios");
    expect(r.status).toBe(200);
    expect(r.json.map((m: any) => m.id).sort()).toEqual([10, 11]);
    expect(r.texto).not.toMatch(/password|verificationToken|resetToken|hash:/);
  });

  it("cria com mustChangePassword, gera a senha e devolve o endereco de entrada", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("POST", "/api/revenda/usuarios", { name: "Carla Revenda", email: "Carla@CredNet.test" });
    expect(r.status).toBe(201);
    expect(r.json.usuario).toMatchObject({ mustChangePassword: true, email: "carla@crednet.test" });
    expect(r.json.urlDeAcesso).toBe("https://app.marca7.test/login");
    // Senha gerada no servidor: 16 simbolos do alfabeto sem O/0/I/L/1.
    expect(r.json.senhaTemporaria).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{16}$/);
    // O hash nunca acompanha a resposta.
    expect(r.texto).not.toContain("hash:");
  });

  /**
   * Duas propriedades num teste so, e as duas custaram um defeito: as senhas
   * nao se repetem, e o alfabeto e sorteado INTEIRO. O sorteio usa amostragem
   * por rejeicao porque o alfabeto tem 31 simbolos e 31 nao divide 256 — um
   * `% 31` cru faria os 8 primeiros simbolos sairem mais que os outros. Com 60
   * senhas (960 simbolos) os 31 aparecem todos, e o teste ainda pega o caso em
   * que o corte da rejeicao ficar apertado demais e amputar o fim do alfabeto.
   */
  it("cada convite gera uma senha diferente, sorteada sobre o alfabeto inteiro", async () => {
    como(REVENDEDOR_A);
    const vistas = new Set<string>();
    const simbolos = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const r = await pedir("POST", "/api/revenda/usuarios", { name: `P${i}`, email: `p${i}@crednet.test` });
      expect(r.status).toBe(201);
      vistas.add(r.json.senhaTemporaria);
      for (const c of r.json.senhaTemporaria as string) simbolos.add(c);
    }
    expect(vistas.size).toBe(60);
    expect([...simbolos].sort().join("")).toBe("23456789ABCDEFGHJKMNPQRSTUVWXYZ");
  });

  it("senha vinda do cliente e recusada: quem escolhe a senha e o servidor", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("POST", "/api/revenda/usuarios", { name: "X", email: "x@crednet.test", password: "123456" });
    expect(r.status).toBe(400);
    expect(dubleStorage.criarMembroDaEquipe).not.toHaveBeenCalled();
  });

  it("role vindo do cliente e recusado: nao ha sub-papel nesta fase", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("POST", "/api/revenda/usuarios", { name: "X", email: "x@crednet.test", role: "superadmin" });
    expect(r.status).toBe(400);
    expect(dubleStorage.criarMembroDaEquipe).not.toHaveBeenCalled();
  });

  it("e-mail invalido e recusado", async () => {
    como(REVENDEDOR_A);
    expect((await pedir("POST", "/api/revenda/usuarios", { name: "X", email: "nao-e-email" })).status).toBe(400);
  });

  /**
   * A senha em texto puro NAO pode virar linha de log.
   *
   * O middleware de `server/index.ts` captura a resposta trocando `res.json`
   * por uma versao que guarda o objeto e depois o imprime por `sanitizeForLog`.
   * A rota responde com `res.json` — ou seja, ELA E CAPTURADA —, e quem impede
   * a senha de virar linha e `ROTAS_SEM_CORPO_NO_LOG`: o `index.ts` consulta
   * `corpoEhSensivel` antes de imprimir. Este teste confere a resposta de fato
   * e a decisao de log, nos dois lados.
   *
   * A versao anterior deste teste pinava um CONTORNO (a rota respondia por
   * `res.send`, que a captura nao intercepta) e por isso exigia que o corpo
   * capturado ficasse vazio. Trocar a asserção junto com o conserto e o ponto:
   * o que precisa ser verdade e "a senha nao chega ao arquivo", nao "esta rota
   * usa um verbo especifico do Express".
   */
  /**
   * O convite manda o e-mail, com o NOME de quem convidou e sem a senha.
   *
   * O nome esta no texto duas vezes de proposito: e o unico jeito de quem
   * recebe desconfiar de um convite que nao esperava. A senha nao vai porque
   * quem convidou ja a tem — ela sai no corpo desta resposta.
   */
  it("o convite manda e-mail com quem convidou, e sem a senha", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("POST", "/api/revenda/usuarios", { name: "Carla", email: "carla@crednet.test" });
    expect(r.status).toBe(201);
    expect(emailMock.sendUsuarioDeEquipeEmail).toHaveBeenCalledTimes(1);
    const [para, dados, marcaId] = emailMock.sendUsuarioDeEquipeEmail.mock.calls[0];
    expect(para).toBe("carla@crednet.test");
    expect(marcaId).toBe(MARCA_A);
    expect(dados).toEqual({
      nome: "Carla",
      // A sessao REVENDEDOR_A e o userId 10 — "Ana Revenda" na equipe.
      quemAdicionou: "Ana Revenda",
      emailDeAcesso: "carla@crednet.test",
    });
    expect(r.json.emailEnviado).toBe(true);
  });

  /**
   * Falha de envio nao derruba o convite: o membro ja existe quando o e-mail
   * sai. `emailEnviado: false` e o que permite a tela dizer a verdade em vez de
   * prometer um e-mail que nao saiu.
   */
  it("falha de envio nao derruba o convite, e a resposta diz que o e-mail nao saiu", async () => {
    emailMock.sendUsuarioDeEquipeEmail.mockRejectedValue(new Error("Resend fora do ar"));
    como(REVENDEDOR_A);
    const r = await pedir("POST", "/api/revenda/usuarios", { name: "Carla", email: "carla@crednet.test" });
    expect(r.status).toBe(201);
    expect(r.json.emailEnviado).toBe(false);
    expect(r.json.senhaTemporaria).toBeTruthy();
    expect(estado.equipe.some(m => m.email === "carla@crednet.test")).toBe(true);
  });

  it("a senha do convite nunca vira linha de log", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("POST", "/api/revenda/usuarios", { name: "Carla", email: "carla@crednet.test" });
    expect(r.status).toBe(201);
    expect(r.json.senhaTemporaria).toBeTruthy();
    expect(capturado.corpo, "a senha temporaria teria virado linha de log").toBeUndefined();
    // Cinto e suspensorio: mesmo que a rota saisse da lista grossa, a chave
    // esta na fina. As duas redes precisam existir — a lista cobre o corpo
    // inteiro (nome e e-mail junto), a chave cobre a senha em qualquer rota.
    expect(sanitizeForLog({ senhaTemporaria: r.json.senhaTemporaria })).toEqual({
      senhaTemporaria: "[REDACTED]",
    });
  });

  /**
   * A listagem da equipe tambem fica fora do log, e nao por tabela: ela e nome
   * e e-mail de cada pessoa da marca, pedidos a cada abertura da tela. A
   * entrada em `ROTAS_SEM_CORPO_NO_LOG` e de texto (prefixo) exatamente para
   * cobrir os dois verbos com uma linha.
   */
  it("a listagem da equipe tambem fica fora do log — e nome e e-mail de gente", async () => {
    como(REVENDEDOR_A);
    await pedir("GET", "/api/revenda/usuarios");
    expect(capturado.corpo).toBeUndefined();
    expect(corpoEhSensivel("/api/revenda/usuarios")).toBe(true);
    // O DELETE cai no mesmo prefixo, e tudo bem: o corpo dele nao tem segredo,
    // e quem removeu quem continua registrado pelo pino-http (metodo, caminho,
    // sessao e status), que esta lista nao toca.
    expect(corpoEhSensivel("/api/revenda/usuarios/9")).toBe(true);
    // A visao geral, que e so agregado, continua no log — a lista grossa nao
    // pode virar "tudo de /api/revenda", senao ela deixa de ser uma decisao.
    expect(corpoEhSensivel("/api/revenda/visao-geral")).toBe(false);
    como(REVENDEDOR_A);
    await pedir("GET", "/api/revenda/visao-geral");
    expect(capturado.corpo).toBeDefined();
  });

  /**
   * O e-mail e unico em TODA a tabela `users`, entao o conflito tanto pode ser
   * com a equipe desta marca quanto com um usuario de outro tenant — e a
   * resposta e a mesma nos dois casos, senao este endpoint viraria um oraculo
   * de "esse e-mail ja tem conta na plataforma".
   */
  it("e-mail ja usado em outro tenant: 409 generico, sem dizer onde", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("POST", "/api/revenda/usuarios", {
      name: "Fulano", email: "ja-existe@qualquer.test",
    });
    expect(r.status).toBe(409);
    expect(r.json.message).toBe("Este e-mail ja esta em uso.");
  });

  it("grava o evento de criacao", async () => {
    como(REVENDEDOR_A);
    await pedir("POST", "/api/revenda/usuarios", { name: "Carla", email: "carla@crednet.test" });
    expect(eventosMock.registrarEventoDaMarca).toHaveBeenCalledWith(expect.objectContaining({
      marcaId: MARCA_A, userId: 10, atorRole: "revendedor", acao: "criar_usuario_revenda",
    }));
  });

  it("remove um colega, mata a sessao dele e registra o evento", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("DELETE", "/api/revenda/usuarios/11");
    expect(r.status).toBe(200);
    expect(estado.equipe.some(m => m.id === 11)).toBe(false);
    expect(eventosMock.registrarEventoDaMarca).toHaveBeenCalledWith(expect.objectContaining({
      acao: "remover_usuario_revenda",
      detalhe: expect.objectContaining({ usuarioId: 11, email: "bruno@crednet.test" }),
    }));
  });

  it("nao remove a si mesmo: 409", async () => {
    como(REVENDEDOR_A);
    const r = await pedir("DELETE", "/api/revenda/usuarios/10");
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/propria conta/i);
    expect(dubleStorage.removerMembroDaEquipe).not.toHaveBeenCalled();
    expect(estado.equipe.some(m => m.id === 10)).toBe(true);
  });

  /**
   * Nao ha cadastro publico de revendedor: quem cria o primeiro acesso de uma
   * marca e o superadmin. Apagar o ultimo deixaria a marca sem ninguem que
   * consiga entrar, e a exclusao e definitiva.
   */
  it("nao remove o ultimo da marca: 409", async () => {
    como(REVENDEDOR_A);
    expect((await pedir("DELETE", "/api/revenda/usuarios/11")).status).toBe(200);
    // Sobrou so o proprio; a trava do "si mesmo" ja o protege, entao a do
    // "ultimo" e provada na marca B, onde ha um unico membro que nao e quem pede.
    como({ ...REVENDEDOR_B, userId: 21 });
    const r = await pedir("DELETE", "/api/revenda/usuarios/20");
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/ultimo acesso/i);
    expect(estado.equipe.some(m => m.id === 20)).toBe(true);
  });

  /**
   * 404 UNIFORME. O alvo pode nao existir, existir em outra marca ou ser um
   * provedor: a resposta e a mesma nos tres casos, senao o endpoint viraria uma
   * sonda de "que ids existem no sistema".
   */
  it("membro de OUTRA marca: 404 igual ao de id inexistente, e nada e apagado", async () => {
    como(REVENDEDOR_A);
    const doVizinho = await pedir("DELETE", "/api/revenda/usuarios/20");
    const inexistente = await pedir("DELETE", "/api/revenda/usuarios/99999");
    expect(doVizinho.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(doVizinho.json).toEqual(inexistente.json);
    expect(estado.equipe.some(m => m.id === 20)).toBe(true);
  });

  it("a recusa de escopo vai para o log com o userId de quem tentou", async () => {
    como(REVENDEDOR_A);
    await pedir("DELETE", "/api/revenda/usuarios/20");
    expect(loggerMock.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 10, marcaId: MARCA_A, motivo: "alvo_fora_da_marca", alvo: 20 }),
      expect.any(String),
    );
  });

  it("id que nao e numero: 400 sem tocar no storage", async () => {
    como(REVENDEDOR_A);
    expect((await pedir("DELETE", "/api/revenda/usuarios/abc")).status).toBe(400);
    expect(dubleStorage.removerMembroDaEquipe).not.toHaveBeenCalled();
  });
});

// ── 7. Trilha e rotas reservadas ────────────────────────────────────────────

describe("trilha de auditoria", () => {
  it("le os eventos da propria marca", async () => {
    eventosMock.listarEventosDaMarca.mockResolvedValueOnce([{ id: 1, acao: "editar_marca" }] as any);
    como(REVENDEDOR_A);
    const r = await pedir("GET", "/api/revenda/eventos?limite=5");
    expect(r.status).toBe(200);
    expect(eventosMock.listarEventosDaMarca).toHaveBeenCalledWith(MARCA_A, 5);
  });

  it("limite invalido cai no padrao do servico, e nao em NaN", async () => {
    como(REVENDEDOR_A);
    await pedir("GET", "/api/revenda/eventos?limite=abacaxi");
    expect(eventosMock.listarEventosDaMarca).toHaveBeenCalledWith(MARCA_A, undefined);
  });
});

describe("rotas reservadas", () => {
  const RESERVADAS: [string, string][] = [
    ["POST", "/api/revenda/provedores/42/creditos"],
    ["POST", "/api/revenda/provedores/42/plano"],
    ["GET", "/api/revenda/chat"],
    ["GET", "/api/revenda/chat/threads"],
    ["POST", "/api/revenda/chat/threads/9/mensagens"],
  ];

  /**
   * 404 seria a resposta honesta — a funcionalidade nao existe — e e por isso
   * que nao serve: 404 diz "nao ha nada neste endereco", e o proximo a
   * implementar creditos por revenda escolheria outro caminho, com outra ideia
   * de escopo e outro middleware.
   */
  it.each(RESERVADAS)("%s %s responde 403 com a frase combinada", async (metodo, caminho) => {
    como(REVENDEDOR_A);
    const r = await pedir(metodo, caminho, metodo === "POST" ? {} : undefined);
    expect(r.status).toBe(403);
    expect(r.json.message).toBe("Indisponivel nesta versao");
  });

  it("reservada continua atras dos middlewares: provedor leva 403 sem ver a frase", async () => {
    como(ADMIN_DE_PROVEDOR);
    const r = await pedir("POST", "/api/revenda/provedores/42/creditos", {});
    expect(r.status).toBe(403);
    expect(r.json.message).not.toBe("Indisponivel nesta versao");
  });
});

// ── 8. O storage de verdade: a FORMA das consultas ─────────────────────────

/**
 * Aqui o duble sai de cena e o modulo real entra, com um banco falso que apenas
 * REGISTRA. O Postgres nao participa; o que precisa de prova e a forma:
 *
 *   · quais COLUNAS saem — a garantia de que senha, token e chave PIX nao saem
 *     do banco e o `select` de colunas nomeadas, nao um `map` na rota;
 *   · qual FILTRO — `marca_id` em toda consulta;
 *   · sob qual LOCK — a regra do "ultimo membro" so vale se a contagem e o
 *     DELETE acontecerem sob o mesmo lock.
 */
describe("storage de revenda: forma das consultas", () => {
  let real: typeof import("../storage/revenda.storage");
  let paraSql: (q: unknown) => { sql: string; params: unknown[] };

  beforeAll(async () => {
    real = await vi.importActual<typeof import("../storage/revenda.storage")>("../storage/revenda.storage");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialeto = new PgDialect();
    paraSql = (q: unknown) => dialeto.sqlToQuery(q as any);
  });

  it("a equipe sai sem password, sem token de verificacao e sem token de reset", async () => {
    registro.linhas = [];
    await real.equipeDaMarca(MARCA_A);
    const colunas = Object.keys(registro.selects[0].colunas);
    for (const proibida of ["password", "verificationToken", "verificationTokenExpiresAt", "resetToken", "resetTokenExpiresAt", "lgpdAcceptedAt"]) {
      expect(colunas, proibida).not.toContain(proibida);
    }
    const { sql, params } = paraSql(registro.selects[0].cond);
    expect(sql).toContain("marca_id");
    expect(sql).toContain("role");
    expect(params).toEqual([MARCA_A, "revendedor"]);
  });

  /**
   * O agregado e o unico lugar onde o revendedor toca em `providers`. Se o
   * filtro por marca sumir dele, a visao geral passa a contar os provedores da
   * plataforma inteira — e o duble das rotas nao pegaria isso, porque quem
   * filtra la sou eu.
   */
  it("o resumo conta so os provedores da marca pedida", async () => {
    registro.linhas = [{ total: 0, ativos: 0, suspensos: 0, cancelados: 0, aguardandoAprovacao: 0, novosNoMes: 0 }];
    await real.resumoDaMarca(MARCA_A);
    const { sql, params } = paraSql(registro.selects[0].cond);
    expect(sql).toContain("marca_id");
    expect(params).toEqual([MARCA_A]);
  });

  it("membroDaEquipe filtra por marca, papel e id — os tres", async () => {
    registro.linhas = [];
    await real.membroDaEquipe(MARCA_A, 11);
    const { sql, params } = paraSql(registro.selects[0].cond);
    expect(sql).toContain("marca_id");
    expect(sql).toContain("role");
    expect(params).toEqual([MARCA_A, "revendedor", 11]);
  });

  it("a marca sai sem repasse, sem comissao e sem os arquivos em base64", async () => {
    registro.linhas = [];
    await real.marcaDoRevendedor(MARCA_A);
    const colunas = Object.keys(registro.selects[0].colunas);
    for (const proibida of ["repasseRazaoSocial", "repasseCnpj", "repasseChavePix", "repasseEmail",
      "comissaoPercentual", "revendaAtiva", "statusComercial", "logoSvg", "logoPng", "faviconSvg", "ogImagePng"]) {
      expect(colunas, proibida).not.toContain(proibida);
    }
    expect(paraSql(registro.selects[0].cond).params).toEqual([MARCA_A]);
  });

  it("criar membro crava papel, marca e providerId null — nao os recebe", async () => {
    await real.criarMembroDaEquipe(MARCA_A, { name: "Carla", email: "carla@x.test", passwordHash: "hash:abc" });
    expect(registro.inserts[0].valores).toMatchObject({
      role: "revendedor", marcaId: MARCA_A, providerId: null, emailVerified: true, mustChangePassword: true,
    });
    // O `returning` tambem e projetado: a linha criada nao volta com a senha.
    expect(Object.keys(registro.inserts[0].colunas)).not.toContain("password");
  });

  it("a gravacao da marca filtra pelo id da sessao", async () => {
    await real.atualizarMarcaDoRevendedor(MARCA_A, { nomeProduto: "CredNet" });
    expect(paraSql(registro.updates[0].cond).params).toEqual([MARCA_A]);
    expect(registro.updates[0].valores).toEqual({ nomeProduto: "CredNet" });
  });

  it("remover: conta e apaga sob o MESMO lock, na mesma transacao", async () => {
    registro.linhas = [{ id: 10 }, { id: 11 }];
    registro.apagados = [{ id: 11 }];
    const r = await real.removerMembroDaEquipe(MARCA_A, 11);

    expect(r).toBe("removido");
    expect(registro.transacoes).toBe(1);
    expect(registro.selects[0].lock).toBe("update");
    // A ordem prova a atomicidade: trava, conta, apaga e derruba a sessao, tudo
    // dentro da mesma transacao.
    expect(registro.dentroDaTransacao).toEqual(["select", "delete", "execute"]);
  });

  it("remover repete marca_id e role no DELETE, e nao confia na leitura anterior", async () => {
    registro.linhas = [{ id: 10 }, { id: 11 }];
    registro.apagados = [{ id: 11 }];
    await real.removerMembroDaEquipe(MARCA_A, 11);
    const { sql, params } = paraSql(registro.deletes[0].cond);
    expect(sql).toContain("marca_id");
    expect(sql).toContain("role");
    expect(params).toEqual([MARCA_A, "revendedor", 11]);
  });

  it("a sessao do removido cai na mesma transacao, com o id parametrizado", async () => {
    registro.linhas = [{ id: 10 }, { id: 11 }];
    registro.apagados = [{ id: 11 }];
    await real.removerMembroDaEquipe(MARCA_A, 11);
    const { sql, params } = paraSql(registro.execucoes[0]);
    expect(sql).toMatch(/delete\s+from\s+"session"/i);
    expect(sql).not.toContain("11'");
    expect(params).toEqual(["11"]);
  });

  it("ultimo membro: nao apaga nada e nao derruba sessao nenhuma", async () => {
    registro.linhas = [{ id: 10 }];
    const r = await real.removerMembroDaEquipe(MARCA_A, 10);
    expect(r).toBe("ultimo");
    expect(registro.deletes).toEqual([]);
    expect(registro.execucoes).toEqual([]);
  });

  it("alvo fora da equipe: nao apaga nada", async () => {
    registro.linhas = [{ id: 10 }, { id: 11 }];
    const r = await real.removerMembroDaEquipe(MARCA_A, 20);
    expect(r).toBe("nao_encontrado");
    expect(registro.deletes).toEqual([]);
  });
});
