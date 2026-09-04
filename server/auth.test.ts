import { describe, it, expect, vi, beforeEach } from "vitest";

// Must be hoisted so SESSION_SECRET is set before auth.ts module evaluates
vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-vitest";
});

// Mock dependencies that auth.ts imports at top level
vi.mock("express-session", () => {
  const sessionFn = () => (_req: any, _res: any, next: any) => next();
  return { default: sessionFn };
});

vi.mock("connect-pg-simple", () => {
  return { default: () => class MockPgStore {} };
});

vi.mock("./db", () => ({
  pool: {},
}));

// `requireProvider` passou a ler `providers.status`: sem este espiao o teste
// abriria conexao de verdade so para descobrir se um provedor esta suspenso.
const storageMock = vi.hoisted(() => ({
  getProvider: vi.fn(async (_id: number): Promise<any> => ({ id: 7, status: "active" })),
  // `requireRevendedor` passou a ler `marcas.ativo` pelo mesmo motivo: a prova
  // de que a marca esta ligada so acontecia no login, e a sessao dura 48h.
  getMarca: vi.fn(async (_id: number): Promise<any> => ({ id: 7, ativo: true })),
}));
vi.mock("./storage", () => ({ storage: storageMock }));

import {
  requireAuth, requireAdmin, requireProvider, requireSuperAdmin, requireRevendedor,
  esquecerStatusDeProvedor, MENSAGEM_PROVEDOR_SUSPENSO,
  esquecerEstadoDaMarca, MENSAGEM_MARCA_DESLIGADA,
  caminhoLiberadoAoRevendedor, PREFIXOS_LIBERADOS_AO_REVENDEDOR,
} from "./auth.js";

type SessionData = {
  userId?: number;
  providerId?: number;
  role?: string;
  subdomain?: string;
  hostLogin?: string;
  marcaId?: number | null;
};

const mockReq = (
  session: Partial<SessionData> = {},
  hostname = "nslink.consultaisp.com.br",
  originalUrl = "/api/dashboard/stats",
) => ({ session, hostname, originalUrl } as any);

const mockRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe("requireAuth", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it("returns 401 when no session userId", () => {
    const req = mockReq({});
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Autenticacao necessaria" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when a provider session matches the host it was born on", () => {
    const req = mockReq({
      userId: 1,
      providerId: 7,
      role: "admin",
      hostLogin: "nslink.consultaisp.com.br",
    });
    const res = mockRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  // O buraco fail-OPEN: a prova de host so rodava quando havia providerId.
  it("recusa com 401 generico quem nao e superadmin e nao tem provedor", () => {
    const req = mockReq({ userId: 1, role: "user" });
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Autenticacao necessaria" });
    expect(next).not.toHaveBeenCalled();
  });

  it("recusa providerId 0, que e o valor gravado no login para quem nao tem provedor", () => {
    const req = mockReq({ userId: 1, providerId: 0, role: "user", hostLogin: "nslink.consultaisp.com.br" });
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("recusa sessao sem provedor mesmo sem papel declarado", () => {
    const req = mockReq({ userId: 1 });
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("superadmin continua entrando por qualquer host, sem provedor", () => {
    const req = mockReq({ userId: 1, role: "superadmin" }, "consultaisp.com.br");
    const res = mockRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("403 quando a sessao de um host e reapresentada em outro", () => {
    const req = mockReq(
      { userId: 1, providerId: 7, role: "admin", hostLogin: "nslink.consultaisp.com.br" },
      "outra.consultaisp.com.br",
    );
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Sessao invalida para este endereco" });
    expect(next).not.toHaveBeenCalled();
  });

  // Sessao aberta antes do deploy do hostLogin: janela de compatibilidade de
  // 48h que segue valendo pela regra antiga, agora so para quem TEM provedor.
  it("sessao legada sem hostLogin ainda e barrada quando o subdominio diverge", () => {
    const req = mockReq(
      { userId: 1, providerId: 7, role: "admin", subdomain: "nslink" },
      "outra.consultaisp.com.br",
    );
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("sessao legada sem hostLogin passa quando o subdominio confere", () => {
    const req = mockReq(
      { userId: 1, providerId: 7, role: "admin", subdomain: "nslink" },
      "nslink.consultaisp.com.br",
    );
    const res = mockRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

/**
 * O PAPEL NOVO DENTRO DA MESMA PORTA.
 *
 * `requireAuth` era escrito sobre uma premissa que a fase 1 quebra: "quem nao e
 * superadmin tem provedor". Ela virou uma linha fail-closed na fase 0 — sem
 * `providerId > 0`, 401 —, e essa linha, sozinha, trancaria TODO revendedor do
 * lado de fora: `providerId` 0 e o estado normal dele, nao a anomalia.
 *
 * O que se prova aqui e o par: a ancora de tenant do revendedor e `marcaId`, e o
 * escopo dele e uma lista de prefixos com tudo o mais negado.
 */
describe("requireAuth — revendedor", () => {
  let next: ReturnType<typeof vi.fn>;

  const DOMINIO = "app.crednet.com.br";
  const revendedor = (extra: Partial<SessionData> = {}) => ({
    userId: 3, providerId: 0, role: "revendedor", marcaId: 7, hostLogin: DOMINIO, ...extra,
  });

  beforeEach(() => {
    next = vi.fn();
  });

  it("passa no proprio painel, com providerId 0 — o valor normal deste papel", () => {
    const req = mockReq(revendedor(), DOMINIO, "/api/revenda/visao-geral");
    const res = mockRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("401 sem marca: sessao de revendedor sem marca nao tem tenant nenhum", () => {
    const req = mockReq(revendedor({ marcaId: null }), DOMINIO, "/api/revenda/visao-geral");
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Autenticacao necessaria" });
    expect(next).not.toHaveBeenCalled();
  });

  it("401 com marcaId 0, que e o valor que passaria por um `!= null`", () => {
    const req = mockReq(revendedor({ marcaId: 0 }), DOMINIO, "/api/revenda/visao-geral");
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("403 quando a sessao de um dominio de marca aparece em outro", () => {
    const req = mockReq(revendedor(), "portal.rival.com.br", "/api/revenda/visao-geral");
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Sessao invalida para este endereco" });
    expect(next).not.toHaveBeenCalled();
  });

  /**
   * Sem janela de compatibilidade neste ramo, ao contrario do provedor: o papel
   * nasceu DEPOIS de `hostLogin` existir, entao sessao de revendedor sem esse
   * campo nao e legado — e sessao sem prova nenhuma.
   */
  it("403 sem hostLogin: nao existe sessao legada de revendedor", () => {
    const req = mockReq(revendedor({ hostLogin: undefined }), DOMINIO, "/api/revenda/visao-geral");
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("403 'Somente provedores' ao pedir rota de provedor", () => {
    const req = mockReq(revendedor(), DOMINIO, "/api/isp-consultations");
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Somente provedores" });
    expect(next).not.toHaveBeenCalled();
  });

  /**
   * O FURO DE CAIXA, o mesmo que ja aconteceu duas vezes neste repositorio
   * (server/utils/sanitize-log.ts e a trava de acesso de suporte). O roteador do
   * Express e INSENSIVEL A CAIXA — este projeto nao chama
   * `app.set("case sensitive routing", true)` —, entao `/API/ISP-CONSULTATIONS`
   * chega ao mesmo handler que a forma em caixa baixa. Uma lista comparada com
   * `startsWith` cru deixaria o dossie da consulta passar com uma letra trocada.
   */
  it("403 tambem com o caminho em CAIXA ALTA — o Express ignora caixa, a lista nao pode ignorar isso", () => {
    const req = mockReq(revendedor(), DOMINIO, "/API/ISP-CONSULTATIONS");
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Somente provedores" });
    expect(next).not.toHaveBeenCalled();
  });

  it("o painel dele continua abrindo em caixa alta, como o roteador o serviria", () => {
    const req = mockReq(revendedor(), DOMINIO, "/API/REVENDA/VISAO-GERAL");
    const res = mockRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("a query nao entra na comparacao", () => {
    const req = mockReq(revendedor(), DOMINIO, "/api/revenda/provedores?busca=x&status=active");
    const res = mockRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("o host e conferido ANTES do escopo: sessao no endereco errado nao vira 'Somente provedores'", () => {
    const req = mockReq(revendedor(), "portal.rival.com.br", "/api/isp-consultations");
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ message: "Sessao invalida para este endereco" });
  });

  it("o provedor nao e afetado: papel sem `revendedor` segue pela regra antiga", () => {
    const req = mockReq(
      { userId: 1, providerId: 7, role: "admin", hostLogin: "nslink.consultaisp.com.br" },
      "nslink.consultaisp.com.br",
      "/api/isp-consultations",
    );
    const res = mockRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe("caminhoLiberadoAoRevendedor", () => {
  it("libera os quatro prefixos e nada alem deles", () => {
    for (const p of PREFIXOS_LIBERADOS_AO_REVENDEDOR) {
      expect(caminhoLiberadoAoRevendedor(p), p).toBe(true);
      expect(caminhoLiberadoAoRevendedor(`${p}/alguma-coisa`), p).toBe(true);
    }
    expect(PREFIXOS_LIBERADOS_AO_REVENDEDOR).toEqual([
      "/api/revenda", "/api/auth", "/api/marca", "/api/public",
    ]);
  });

  it("nega o que serve dado de provedor", () => {
    for (const caminho of [
      "/api/isp-consultations",
      "/api/bigdata-consultations/42",
      "/api/customers",
      "/api/inadimplentes",
      "/api/anti-fraud/alerts",
      "/api/equipamentos",
      "/api/provider/profile",
      "/api/chat/thread",
      "/api/dashboard/stats",
      "/api/admin/providers",
      "/api/credits/packages",
    ]) {
      expect(caminhoLiberadoAoRevendedor(caminho), caminho).toBe(false);
    }
  });

  /**
   * Por que a comparacao e por SEGMENTO e nao `startsWith` cru: um prefixo solto
   * liberaria qualquer rota que apenas COMECE com o mesmo texto, e a lista
   * deixaria de dizer o que parece dizer.
   */
  it("prefixo casa por segmento — vizinho de nome parecido nao entra de carona", () => {
    expect(caminhoLiberadoAoRevendedor("/api/revendax")).toBe(false);
    expect(caminhoLiberadoAoRevendedor("/api/marcas")).toBe(false);
    expect(caminhoLiberadoAoRevendedor("/api/publico")).toBe(false);
    expect(caminhoLiberadoAoRevendedor("/api/authenticate")).toBe(false);
  });

  it("normaliza caixa e barra final, que e exatamente o que o roteador ignora", () => {
    expect(caminhoLiberadoAoRevendedor("/API/AUTH/ME")).toBe(true);
    expect(caminhoLiberadoAoRevendedor("/api/auth/me/")).toBe(true);
    expect(caminhoLiberadoAoRevendedor("/Api/Revenda/")).toBe(true);
    expect(caminhoLiberadoAoRevendedor("/API/ISP-CONSULTATIONS")).toBe(false);
    expect(caminhoLiberadoAoRevendedor("/API/PROVIDER/PROFILE/")).toBe(false);
  });

  it("caminho vazio ou raiz nao e liberado — a lista e allowlist, ausencia nega", () => {
    expect(caminhoLiberadoAoRevendedor("")).toBe(false);
    expect(caminhoLiberadoAoRevendedor("/")).toBe(false);
    expect(caminhoLiberadoAoRevendedor("///")).toBe(false);
  });
});

describe("requireRevendedor", () => {
  let next: ReturnType<typeof vi.fn>;

  const DOMINIO = "app.crednet.com.br";
  const req = (sessao: Partial<SessionData>, hostname = DOMINIO) => mockReq(sessao, hostname, "/api/revenda/marca");

  beforeEach(() => {
    next = vi.fn();
  });

  it("passa com sessao de revendedor com marca e host conferido", async () => {
    const res = mockRes();

    await requireRevendedor(req({ userId: 3, providerId: 0, role: "revendedor", marcaId: 7, hostLogin: DOMINIO }), res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("403 para admin de provedor", async () => {
    const res = mockRes();

    await requireRevendedor(req({ userId: 1, providerId: 7, role: "admin", hostLogin: DOMINIO }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Somente revendedores" });
    expect(next).not.toHaveBeenCalled();
  });

  /**
   * Superadmin tem `/api/admin/marcas/:id` com o mesmo conteudo. Deixa-lo entrar
   * aqui daria a uma sessao SEM marca um escopo que ninguem gravou — e
   * `session.marcaId` e o filtro de toda query de revenda.
   */
  it("403 para superadmin: o painel do revendedor nao e a tela dele", async () => {
    const res = mockRes();

    await requireRevendedor(req({ userId: 9, role: "superadmin", hostLogin: DOMINIO }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("403 sem marca na sessao, mesmo com o papel certo", async () => {
    const res = mockRes();

    await requireRevendedor(req({ userId: 3, providerId: 0, role: "revendedor", marcaId: null, hostLogin: DOMINIO }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("403 sem sessao nenhuma", async () => {
    const res = mockRes();

    await requireRevendedor(req({}), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  /**
   * A prova de host e repetida aqui de proposito. Este teste e o que garante que
   * a repeticao nao foi "limpa" depois por parecer redundante: montar a rota sem
   * `requireAuth` nao daria erro nenhum, e a sessao de uma marca passaria a valer
   * no dominio de outra.
   */
  it("403 no dominio de outra marca, sem depender de requireAuth ter rodado antes", async () => {
    const res = mockRes();

    await requireRevendedor(
      req({ userId: 3, providerId: 0, role: "revendedor", marcaId: 7, hostLogin: DOMINIO }, "portal.rival.com.br"),
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Sessao invalida para este endereco" });
    expect(next).not.toHaveBeenCalled();
  });
});

/**
 * DESLIGAR A MARCA DERRUBA A SESSAO ABERTA.
 *
 * A prova de que a marca esta ligada morava so no login: `hostPertenceAMarca`
 * exige origem "dominio-proprio", e essa resolucao filtra por `ativo`. Depois
 * disso nada revalidava — entao desligar a marca as 10h deixava o revendedor ja
 * logado editando a marca e criando e removendo acessos pelo resto da vida do
 * cookie, que dura 48h.
 *
 * E o mesmo defeito que `providers.status` teve e o mesmo conserto, com a mesma
 * assimetria de cache. `revendaAtiva` NAO entra: pela decisao 14, marca sem
 * revenda continua existindo como pele — tirar dela o painel seria inventar uma
 * punicao que o desenho nao pediu.
 */
describe("requireRevendedor — estado da marca", () => {
  let next: ReturnType<typeof vi.fn>;
  const DOMINIO = "app.crednet.com.br";
  const SESSAO = { userId: 3, providerId: 0, role: "revendedor", marcaId: 7, hostLogin: DOMINIO };
  const req = () => mockReq(SESSAO, DOMINIO, "/api/revenda/marca");

  beforeEach(() => {
    next = vi.fn();
    esquecerEstadoDaMarca();
    // `mockClear` e nao so `mockResolvedValue`: os testes deste bloco contam
    // CHAMADAS (para provar o cache), e o contador vem sujo dos blocos acima.
    storageMock.getMarca.mockClear();
    storageMock.getMarca.mockResolvedValue({ id: 7, ativo: true });
  });

  it("403 quando a marca foi desligada, com codigo proprio para a tela", async () => {
    storageMock.getMarca.mockResolvedValue({ id: 7, ativo: false });
    const res = mockRes();

    await requireRevendedor(req(), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      message: MENSAGEM_MARCA_DESLIGADA,
      code: "MARCA_DESLIGADA",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("marca ligada passa, e a leitura fica 30s em memoria", async () => {
    await requireRevendedor(req(), mockRes(), next);
    await requireRevendedor(req(), mockRes(), next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(storageMock.getMarca).toHaveBeenCalledTimes(1);
  });

  /**
   * A assimetria e o ponto: o veredito NEGATIVO nunca entra no cache, entao
   * religar volta a valer na requisicao seguinte. O contrario — cachear os dois
   * — faria o revendedor levar 403 por meio minuto depois de a plataforma ter
   * reaberto a marca na frente dele.
   */
  it("veredito negativo nao e cacheado: religar vale na requisicao seguinte", async () => {
    storageMock.getMarca.mockResolvedValue({ id: 7, ativo: false });
    await requireRevendedor(req(), mockRes(), next);
    expect(next).not.toHaveBeenCalled();

    storageMock.getMarca.mockResolvedValue({ id: 7, ativo: true });
    await requireRevendedor(req(), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("banco fora do ar nao vira bloqueio em massa — isto protege regra comercial, nao invasao", async () => {
    storageMock.getMarca.mockRejectedValue(new Error("connection terminated"));
    const res = mockRes();

    await requireRevendedor(req(), res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  /**
   * Marca ausente e defeito (a sessao aponta para uma linha que sumiu), nao
   * estado comercial. Bloquear aqui esconderia a causa real atras de um texto
   * errado; as rotas ja respondem 404 sozinhas.
   */
  it("marca inexistente nao e marca desligada", async () => {
    storageMock.getMarca.mockResolvedValue(undefined);
    const res = mockRes();

    await requireRevendedor(req(), res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  /** O papel e o host sao conferidos ANTES: sessao errada nem chega ao banco. */
  it("sessao de outro papel nao chega a consultar a marca", async () => {
    await requireRevendedor(
      mockReq({ userId: 1, providerId: 7, role: "admin", hostLogin: DOMINIO }, DOMINIO, "/api/revenda/marca"),
      mockRes(),
      next,
    );
    expect(storageMock.getMarca).not.toHaveBeenCalled();
  });
});

describe("requireProvider", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
    vi.clearAllMocks();
    esquecerStatusDeProvedor();
    storageMock.getProvider.mockResolvedValue({ id: 7, status: "active" });
  });

  it("passa com provedor de verdade", async () => {
    const req = mockReq({ userId: 1, providerId: 7, role: "user" });
    const res = mockRes();

    await requireProvider(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("403 com providerId 0 — o valor que gravaria provider_id 0 na tabela", async () => {
    const req = mockReq({ userId: 1, providerId: 0, role: "user" });
    const res = mockRes();

    await requireProvider(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Somente provedores" });
    expect(next).not.toHaveBeenCalled();
  });

  it("403 sem providerId nenhum", async () => {
    const req = mockReq({ userId: 1, role: "user" });
    const res = mockRes();

    await requireProvider(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("403 sem sessao", async () => {
    const req = mockReq({});
    const res = mockRes();

    await requireProvider(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("403 para superadmin: rota de provedor nao e endereco dele", async () => {
    const req = mockReq({ userId: 1, role: "superadmin" });
    const res = mockRes();

    await requireProvider(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  // Segunda barreira: o 403 central de `requireAuth` ja teria recusado. Esta
  // linha e a que sobra se alguem escrever uma rota de provedor sem a primeira.
  it("403 para revendedor — e sem ir ao banco perguntar por um provedor 0", async () => {
    const req = mockReq({ userId: 3, providerId: 0, role: "revendedor", marcaId: 7 });
    const res = mockRes();

    await requireProvider(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Somente provedores" });
    expect(storageMock.getProvider).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

/**
 * Suspender era promessa de tela: o confirm do superadmin dizia que "o acesso
 * do provedor e dos usuarios dele fica bloqueado", e nada no servidor lia
 * `providers.status`. A sessao dura 48h — sem esta trava, quem ja estava logado
 * seguia consultando CPF e gastando credito depois da suspensao.
 */
describe("requireProvider — status do provedor", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
    vi.clearAllMocks();
    esquecerStatusDeProvedor();
  });

  const sessaoDoProvedor = () => mockReq({ userId: 1, providerId: 7, role: "admin" });

  it("403 quando o provedor da sessao esta suspenso", async () => {
    storageMock.getProvider.mockResolvedValue({ id: 7, status: "suspended" });
    const res = mockRes();

    await requireProvider(sessaoDoProvedor(), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      message: MENSAGEM_PROVEDOR_SUSPENSO,
      code: "PROVIDER_SUSPENDED",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("403 tambem para provedor cancelado", async () => {
    storageMock.getProvider.mockResolvedValue({ id: 7, status: "cancelled" });
    const res = mockRes();

    await requireProvider(sessaoDoProvedor(), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  // A assimetria do cache: veredito negativo nunca e guardado, entao reativar
  // volta a valer na requisicao seguinte, sem esperar TTL nenhum.
  it("reativar volta a funcionar de imediato", async () => {
    storageMock.getProvider.mockResolvedValue({ id: 7, status: "suspended" });
    await requireProvider(sessaoDoProvedor(), mockRes(), next);
    expect(next).not.toHaveBeenCalled();

    storageMock.getProvider.mockResolvedValue({ id: 7, status: "active" });
    const res = mockRes();
    await requireProvider(sessaoDoProvedor(), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("provedor ativo e lido uma vez so — nao uma consulta por requisicao", async () => {
    storageMock.getProvider.mockResolvedValue({ id: 7, status: "active" });

    await requireProvider(sessaoDoProvedor(), mockRes(), next);
    await requireProvider(sessaoDoProvedor(), mockRes(), next);
    await requireProvider(sessaoDoProvedor(), mockRes(), next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(storageMock.getProvider).toHaveBeenCalledTimes(1);
  });

  // Falha de leitura nao pode virar bloqueio em massa: o que se protege aqui e
  // cobranca, nao invasao.
  it("banco fora do ar nao bloqueia ninguem", async () => {
    storageMock.getProvider.mockRejectedValue(new Error("connection terminated"));
    const res = mockRes();

    await requireProvider(sessaoDoProvedor(), res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("provedor que nao existe mais nao e tratado como suspenso", async () => {
    storageMock.getProvider.mockResolvedValue(undefined);
    const res = mockRes();

    await requireProvider(sessaoDoProvedor(), res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("requireAdmin", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it("returns 403 when role is 'user'", () => {
    const req = mockReq({ userId: 1, providerId: 7, role: "user" });
    const res = mockRes();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when role is 'admin'", () => {
    const req = mockReq({ userId: 1, providerId: 7, role: "admin" });
    const res = mockRes();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() when role is 'superadmin'", () => {
    const req = mockReq({ userId: 1, role: "superadmin" });
    const res = mockRes();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("403 para admin sem provedor: escreveria com providerId 0", () => {
    const req = mockReq({ userId: 1, providerId: 0, role: "admin" });
    const res = mockRes();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  /**
   * A intuicao puxa para o outro lado — o revendedor "administra" provedores —,
   * e e por isso que vale um teste: as rotas com este middleware sao as do
   * painel de UM provedor e gravam com `session.providerId`, que na sessao dele
   * e 0. Aceitar aqui daria ao papel comercial o acesso operacional que ele nao
   * tem.
   */
  it("403 para revendedor: administrar a marca nao e administrar um provedor", () => {
    const req = mockReq({ userId: 3, providerId: 0, role: "revendedor", marcaId: 7 });
    const res = mockRes();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Acesso negado" });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireSuperAdmin", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it("returns 403 when role is 'admin'", () => {
    const req = mockReq({ userId: 1, providerId: 7, role: "admin" });
    const res = mockRes();

    requireSuperAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when role is 'superadmin'", () => {
    const req = mockReq({ userId: 1, role: "superadmin" });
    const res = mockRes();

    requireSuperAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 when no session at all", () => {
    const req = mockReq({});
    const res = mockRes();

    requireSuperAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  // `/api/admin/*` fica FORA da lista de prefixos do revendedor, entao ele nem
  // chega aqui. Esta e a barreira que continua valendo se a lista mudar.
  it("403 para revendedor — a area da plataforma nao e dele", () => {
    const req = mockReq({ userId: 3, providerId: 0, role: "revendedor", marcaId: 7 });
    const res = mockRes();

    requireSuperAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
