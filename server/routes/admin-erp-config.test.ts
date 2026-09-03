import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Foco: a configuracao de ERP passou a morar so no superadmin.
 *
 * O que se prova aqui e (1) que so o superadmin entra, (2) que o PUT grava os
 * campos que quatro dos seis conectores exigem — mkContraSenha, clientId,
 * clientSecret e extraConfig —, (3) que o teste de conexao monta a config a
 * partir do registro inteiro, e (4) que os dois gravadores divergentes que
 * existiam (`erp-config` e `erp-test` sem `:source`) sumiram.
 *
 * O (2) e o buraco exato que a mudanca fecha: com o Zod `.strict()` de quatro
 * campos, MK, SGP, Hubsoft e Voalle eram inconfiguraveis pelo superadmin e a
 * tela ainda dizia "salvo". Sem um caso por ERP, esse buraco volta calado.
 *
 * `buildConnectorConfig` entra COMO O REAL de proposito: metade do bug antigo
 * era o handler montar a config a mao com `extra: {}`. Mockar essa funcao
 * provaria apenas que a rota chamou alguma coisa.
 */
const storageMock = vi.hoisted(() => ({
  getProvider: vi.fn(async (): Promise<any> => null),
  getErpIntegracoesResumo: vi.fn(async (): Promise<any[]> => []),
  getErpIntegrations: vi.fn(async (): Promise<any[]> => { throw new Error("credencial ilegivel"); }),
  getErpIntegracoesParaAdmin: vi.fn(async (): Promise<any[]> => []),
  upsertErpIntegration: vi.fn(async (providerId: number, erpSource: string, dados: any): Promise<any> => ({
    id: 1, providerId, erpSource, ...dados,
  })),
  getProviderWebhookToken: vi.fn(async () => "tok"),
  getErpSyncLogs: vi.fn(async (): Promise<any[]> => []),
  registrarReativacao: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../auth", () => ({
  requireSuperAdmin: (req: any, res: any, next: any) => {
    if (req.session?.role !== "superadmin") return res.status(403).json({ message: "Acesso restrito" });
    next();
  },
  esquecerStatusDeProvedor: vi.fn(),
}));

/** O conector espiao: guarda a config que a rota lhe entregou. */
const conectorMock = vi.hoisted(() => ({
  testConnection: vi.fn(async () => ({ ok: true, message: "Conexao ok", latencyMs: 12 })),
}));

/**
 * Os quatro que estao no catalogo mas cujo conector nao fala com o ERP. Eles
 * SAO fontes suportadas — e por isso que a guarda precisa vir depois da
 * validacao de source: sem ela, o `getSupportedSources` os deixa passar.
 */
const NAO_IMPLEMENTADOS = ["topsapp", "radiusnet", "gere", "receitanet"];
const SOURCES = ["ixc", "mk", "sgp", "hubsoft", "voalle", "rbx", ...NAO_IMPLEMENTADOS];
const LABELS: Record<string, string> = {
  ixc: "IXC Soft", mk: "MK Solutions", sgp: "SGP", hubsoft: "Hubsoft",
  voalle: "Voalle", rbx: "RBX ISP",
  topsapp: "TopSApp", radiusnet: "RadiusNet", gere: "Gere", receitanet: "ReceitaNet",
};

vi.mock("../erp/registry", () => ({
  getSupportedSources: () => SOURCES,
  getConnector: (source: string) => {
    if (!SOURCES.includes(source)) return undefined;
    // Espalhar mantem o MESMO espiao de `testConnection` nos dois casos: e o
    // que permite provar que a rota nao chamou o conector do stub.
    return {
      ...conectorMock,
      name: source,
      label: LABELS[source],
      naoImplementado: NAO_IMPLEMENTADOS.includes(source) || undefined,
    };
  },
}));
// Side-effect import na rota: os conectores de verdade abrem rede, nao entram.
vi.mock("../erp/index", () => ({}));

vi.mock("../db", () => ({ db: {} }));
vi.mock("../password", () => ({ hashPassword: vi.fn(async (s: string) => `hash:${s}`) }));
vi.mock("../services/email", () => ({
  sendVerificationEmail: vi.fn(async () => undefined),
  sendCadastroAprovadoEmail: vi.fn(async () => undefined),
  sendCadastroReprovadoEmail: vi.fn(async () => undefined),
  sendAcessoSuspensoEmail: vi.fn(async () => undefined),
  sendAcessoReativadoEmail: vi.fn(async () => undefined),
  sendPlanoAlteradoEmail: vi.fn(async () => undefined),
  sendUsuarioAdicionadoEmail: vi.fn(async () => undefined),
}));
vi.mock("../services/marca.service", () => ({
  esquecerMarcas: vi.fn(),
  resolverMarcaPorId: vi.fn(async () => ({ marcaId: 1, nomeProduto: "Consulta ISP" })),
  urlDeEntrada: vi.fn(() => "https://consultaisp.example"),
  MARCA_PLATAFORMA: { marcaId: 1, nomeProduto: "Consulta ISP" },
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

const PROVEDOR = { id: 42, name: "Provedor NsLink", contactEmail: "contato@nslink.com.br" };

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` limpa as chamadas, nao a implementacao.
  storageMock.getProvider.mockResolvedValue(PROVEDOR);
  storageMock.getErpIntegracoesResumo.mockResolvedValue([]);
  storageMock.getErpIntegracoesParaAdmin.mockResolvedValue([]);
  storageMock.getProviderWebhookToken.mockResolvedValue("tok");
  storageMock.getErpSyncLogs.mockResolvedValue([]);
  storageMock.upsertErpIntegration.mockImplementation(
    async (providerId: number, erpSource: string, dados: any) => ({ id: 1, providerId, erpSource, ...dados }),
  );
  conectorMock.testConnection.mockResolvedValue({ ok: true, message: "Conexao ok", latencyMs: 12 });
  storageMock.registrarReativacao.mockResolvedValue(undefined);
  sessao = { userId: 1, role: "superadmin" };
});

const salvar = (id: number | string, source: string, corpo: Record<string, unknown>) =>
  fetch(`${base}/api/admin/providers/${id}/erp/${source}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

const testar = (id: number | string, source: string) =>
  fetch(`${base}/api/admin/providers/${id}/erp/${source}/test`, { method: "POST" });

const lerIntegracao = (id: number | string) =>
  fetch(`${base}/api/admin/providers/${id}/integration`);

// ── Quem entra ───────────────────────────────────────────────────────────────

describe("configuracao de ERP — so o superadmin", () => {
  it("PUT erp/:source responde 403 para admin de provedor, e nao grava", async () => {
    sessao = { userId: 5, role: "admin", providerId: 42 };

    const res = await salvar(42, "ixc", { apiUrl: "https://erp.exemplo.com.br", apiToken: "abc" });

    expect(res.status).toBe(403);
    expect(storageMock.upsertErpIntegration).not.toHaveBeenCalled();
  });

  it("POST erp/:source/test responde 403 para admin de provedor, e nao chama o ERP", async () => {
    sessao = { userId: 5, role: "admin", providerId: 42 };

    const res = await testar(42, "ixc");

    expect(res.status).toBe(403);
    expect(conectorMock.testConnection).not.toHaveBeenCalled();
  });

  it("PUT erp/:source responde 403 para operador comum", async () => {
    sessao = { userId: 7, role: "user", providerId: 42 };

    const res = await salvar(42, "ixc", { apiToken: "abc" });

    expect(res.status).toBe(403);
    expect(storageMock.upsertErpIntegration).not.toHaveBeenCalled();
  });
});

// ── O que chega ao storage ───────────────────────────────────────────────────

/**
 * Um caso por ERP que precisava de campo alem de URL/token/usuario. Enquanto o
 * Zub era `.strict()` com quatro chaves, cada um destes payloads virava 400 —
 * ou, pior, era truncado e gravava metade da credencial.
 */
describe("PUT /api/admin/providers/:id/erp/:source — grava a credencial inteira", () => {
  it("IXC: usuario e token chegam como vieram", async () => {
    const res = await salvar(42, "ixc", {
      apiUrl: "https://ixc.nslink.com.br",
      apiUser: "17",
      apiToken: "tok-ixc",
      isEnabled: true,
    });

    expect(res.status).toBe(200);
    expect(storageMock.upsertErpIntegration).toHaveBeenCalledWith(42, "ixc", {
      apiUrl: "https://ixc.nslink.com.br",
      apiUser: "17",
      apiToken: "tok-ixc",
      isEnabled: true,
    });
  });

  it("MK: a contra-senha vai em mkContraSenha, nao em apiUser", async () => {
    const res = await salvar(42, "mk", {
      apiUrl: "https://mk.nslink.com.br",
      apiUser: "integracao",
      apiToken: "tok-mk",
      mkContraSenha: "contra-secreta",
      isEnabled: true,
    });

    expect(res.status).toBe(200);
    const [, , dados] = storageMock.upsertErpIntegration.mock.calls[0];
    expect(dados.mkContraSenha).toBe("contra-secreta");
    // O gravador antigo quebrava "token:contrasenha" e punha a contra-senha em
    // apiUser — coluna que buildConnectorConfig nem le para o MK.
    expect(dados.apiUser).toBe("integracao");
  });

  it("SGP: sgpApp viaja dentro de extraConfig", async () => {
    const res = await salvar(42, "sgp", {
      apiUrl: "https://sgp.nslink.com.br",
      apiToken: "tok-sgp",
      extraConfig: { sgpApp: "consultaisp" },
      isEnabled: true,
    });

    expect(res.status).toBe(200);
    const [, , dados] = storageMock.upsertErpIntegration.mock.calls[0];
    expect(dados.extraConfig).toEqual({ sgpApp: "consultaisp" });
  });

  it("Hubsoft: clientId e clientSecret chegam ao storage", async () => {
    const res = await salvar(42, "hubsoft", {
      apiUrl: "https://api.hubsoft.com.br",
      apiUser: "usuario@nslink.com.br",
      apiToken: "senha-oauth",
      clientId: "cid-123",
      clientSecret: "csecret-456",
      isEnabled: true,
    });

    expect(res.status).toBe(200);
    const [, , dados] = storageMock.upsertErpIntegration.mock.calls[0];
    expect(dados.clientId).toBe("cid-123");
    expect(dados.clientSecret).toBe("csecret-456");
  });

  it("Voalle: voalleClientId viaja dentro de extraConfig", async () => {
    const res = await salvar(42, "voalle", {
      apiUrl: "https://voalle.nslink.com.br",
      apiUser: "integracao",
      apiToken: "tok-voalle",
      extraConfig: { voalleClientId: "vcid-789" },
      isEnabled: true,
    });

    expect(res.status).toBe(200);
    const [, , dados] = storageMock.upsertErpIntegration.mock.calls[0];
    expect(dados.extraConfig).toEqual({ voalleClientId: "vcid-789" });
  });

  // Chave ausente e chave que nao se quer mexer. A versao anterior mandava
  // `apiUrl ?? null`, entao salvar so o liga/desliga apagava a credencial boa.
  it("salvar so isEnabled nao manda apiUrl nem apiToken ao storage", async () => {
    const res = await salvar(42, "ixc", { isEnabled: false });

    expect(res.status).toBe(200);
    const [, , dados] = storageMock.upsertErpIntegration.mock.calls[0];
    expect(dados).toEqual({ isEnabled: false });
    expect("apiUrl" in dados).toBe(false);
    expect("apiToken" in dados).toBe(false);
  });

  it("campo fora do contrato derruba com 400", async () => {
    const res = await salvar(42, "ixc", { apiToken: "abc", providerId: 999 });

    expect(res.status).toBe(400);
    expect(storageMock.upsertErpIntegration).not.toHaveBeenCalled();
  });

  // URL de rede interna e SSRF com credencial de servidor: quem julga e o
  // validateErpUrl, nao o `.url()` do Zod.
  it("URL HTTP para host privado e recusada com 400", async () => {
    const res = await salvar(42, "ixc", { apiUrl: "http://192.168.0.10/webservice/v1" });

    expect(res.status).toBe(400);
    expect(storageMock.upsertErpIntegration).not.toHaveBeenCalled();
  });

  it("source invalido responde 400 e nao consulta o provedor", async () => {
    const res = await salvar(42, "erp-que-nao-existe", { apiToken: "abc" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "ERP invalido" });
    expect(storageMock.upsertErpIntegration).not.toHaveBeenCalled();
  });

  it("provedor inexistente responde 404", async () => {
    storageMock.getProvider.mockResolvedValue(null);

    const res = await salvar(999, "ixc", { apiToken: "abc" });

    expect(res.status).toBe(404);
    expect(storageMock.upsertErpIntegration).not.toHaveBeenCalled();
  });

  it("id que nao e numero responde 400", async () => {
    const res = await salvar("abc", "ixc", { apiToken: "abc" });

    expect(res.status).toBe(400);
    expect(storageMock.getProvider).not.toHaveBeenCalled();
    expect(storageMock.upsertErpIntegration).not.toHaveBeenCalled();
  });
});

// ── Religar uma integracao pausada ───────────────────────────────────────────

/**
 * A pausa automatica marca `status = "pausado_por_falhas"` e desliga. Como
 * `registrarResultadoSync` passou a PRESERVAR essa coluna, so o religar do
 * superadmin a apaga — e enquanto ele nao apagava, a integracao voltava a
 * sincronizar com `is_enabled = true` e a marca de pausa junto: o painel do
 * provedor testa o status antes do isEnabled e seguia dizendo "pausada por
 * falhas" para quem ja estava rodando.
 *
 * A linha "reativado" e a outra metade: `contarFalhasConsecutivas` para na
 * primeira linha que nao e erro, entao sem ela as tres falhas que causaram a
 * pausa continuam valendo e a tolerancia de 3 vira 1 para sempre.
 */
describe("PUT erp/:source — religar limpa a marca de pausa", () => {
  // A forma do RESUMO, nao a da linha decifrada: `configurado` no lugar de
  // apiUrl/apiToken. E o que a rota le, e ler outra coisa aqui esconderia se
  // ela voltasse a depender de campo que o resumo nao tem.
  const pausada = (extra: Record<string, unknown> = {}) => [{
    erpSource: "ixc", isEnabled: false, status: "pausado_por_falhas",
    configurado: true, ...extra,
  }];

  /**
   * O PUT nao pode DECIFRAR nada so para saber se a integracao estava ligada.
   *
   * `getErpIntegrations` passa por `decryptIntegration`, que LANCA quando a
   * credencial nao abre — SESSION_SECRET trocado, base restaurada de outro
   * ambiente. Se o PUT lesse por ali, ele devolveria 500 antes do upsert, e
   * esta e justamente a tela que existe para redigitar a credencial quebrada:
   * o unico caminho de conserto morreria pelo defeito que ele conserta.
   *
   * O mock de `getErpIntegrations` lanca de proposito. Isso arma a trava em
   * TODOS os casos deste arquivo, nao so neste: se alguem trocar o resumo pela
   * leitura decifrada, a suite inteira fica vermelha em 500.
   */
  it("nao decifra credencial para decidir se e religar", async () => {
    storageMock.getErpIntegracoesResumo.mockResolvedValue(pausada());

    const res = await salvar(42, "ixc", { isEnabled: true });

    expect(res.status).toBe(200);
    expect(storageMock.getErpIntegrations).not.toHaveBeenCalled();
  });

  it("religar grava status 'idle' e registra a reativacao", async () => {
    storageMock.getErpIntegracoesResumo.mockResolvedValue(pausada());

    const res = await salvar(42, "ixc", { isEnabled: true });

    expect(res.status).toBe(200);
    const [, , dados] = storageMock.upsertErpIntegration.mock.calls[0];
    expect(dados).toEqual({ isEnabled: true, status: "idle" });
    expect(storageMock.registrarReativacao).toHaveBeenCalledWith(42, "ixc");
  });

  // Religar junto com a credencial nova e o caso real: o superadmin corrige o
  // token que causou as falhas e liga de volta na mesma gravacao.
  it("religar com credencial nova preserva os campos do corpo", async () => {
    storageMock.getErpIntegracoesResumo.mockResolvedValue(pausada());

    const res = await salvar(42, "ixc", { isEnabled: true, apiToken: "tok-novo" });

    expect(res.status).toBe(200);
    const [, , dados] = storageMock.upsertErpIntegration.mock.calls[0];
    expect(dados).toEqual({ isEnabled: true, apiToken: "tok-novo", status: "idle" });
  });

  /**
   * Sem esta trava, todo "Salvar" viraria uma reativacao: uma linha falsa no
   * historico e, pior, o zero da contagem de falhas — a pausa automatica nunca
   * mais chegaria a tres.
   */
  it("salvar credencial numa integracao JA ligada nao registra reativacao", async () => {
    storageMock.getErpIntegracoesResumo.mockResolvedValue([{
      erpSource: "ixc", isEnabled: true, status: "idle",
      apiUrl: "https://ixc.nslink.com.br", apiToken: "tok-ixc",
    }]);

    const res = await salvar(42, "ixc", { isEnabled: true, apiToken: "tok-novo" });

    expect(res.status).toBe(200);
    const [, , dados] = storageMock.upsertErpIntegration.mock.calls[0];
    expect(dados).toEqual({ isEnabled: true, apiToken: "tok-novo" });
    expect("status" in dados).toBe(false);
    expect(storageMock.registrarReativacao).not.toHaveBeenCalled();
  });

  it("desligar nao registra reativacao nem mexe no status", async () => {
    storageMock.getErpIntegracoesResumo.mockResolvedValue([{
      erpSource: "ixc", isEnabled: true, status: "idle",
      apiUrl: "https://ixc.nslink.com.br", apiToken: "tok-ixc",
    }]);

    const res = await salvar(42, "ixc", { isEnabled: false });

    expect(res.status).toBe(200);
    const [, , dados] = storageMock.upsertErpIntegration.mock.calls[0];
    expect(dados).toEqual({ isEnabled: false });
    expect(storageMock.registrarReativacao).not.toHaveBeenCalled();
  });

  // Primeira configuracao do ERP: nao havia integracao, entao nao ha o que
  // religar. Gravar "reativado" aqui inventaria um rastro que nunca aconteceu.
  it("primeira configuracao (integracao inexistente) nao registra reativacao", async () => {
    storageMock.getErpIntegracoesResumo.mockResolvedValue([]);

    const res = await salvar(42, "ixc", {
      isEnabled: true, apiUrl: "https://ixc.nslink.com.br", apiToken: "tok-ixc",
    });

    expect(res.status).toBe(200);
    const [, , dados] = storageMock.upsertErpIntegration.mock.calls[0];
    expect("status" in dados).toBe(false);
    expect(storageMock.registrarReativacao).not.toHaveBeenCalled();
  });

  // O corpo nao dita estado: `status` fora do contrato e 400, e nada e gravado.
  it("`status` no corpo da requisicao e recusado com 400", async () => {
    storageMock.getErpIntegracoesResumo.mockResolvedValue(pausada());

    const res = await salvar(42, "ixc", { isEnabled: true, status: "idle" });

    expect(res.status).toBe(400);
    expect(storageMock.upsertErpIntegration).not.toHaveBeenCalled();
    expect(storageMock.registrarReativacao).not.toHaveBeenCalled();
  });

  // A credencial ja foi gravada quando o log falha: derrubar o PUT faria a tela
  // dizer "erro" sobre uma gravacao que aconteceu, e o superadmin salvaria de novo.
  it("falha ao registrar a reativacao nao derruba o PUT", async () => {
    storageMock.getErpIntegracoesResumo.mockResolvedValue(pausada());
    storageMock.registrarReativacao.mockRejectedValue(new Error("log indisponivel"));

    const res = await salvar(42, "ixc", { isEnabled: true });

    expect(res.status).toBe(200);
    const [, , dados] = storageMock.upsertErpIntegration.mock.calls[0];
    expect(dados).toEqual({ isEnabled: true, status: "idle" });
  });
});

// ── O teste de conexao ───────────────────────────────────────────────────────

describe("POST /api/admin/providers/:id/erp/:source/test", () => {
  /**
   * O `find()` antigo pegava a primeira integracao habilitada e ignorava a URL.
   * Aqui o provedor tem duas: pedir o MK tem que testar o MK.
   */
  it("testa o ERP nomeado na URL, nao o primeiro habilitado", async () => {
    storageMock.getErpIntegrations.mockResolvedValue([
      { erpSource: "ixc", isEnabled: true, apiUrl: "https://ixc.nslink.com.br", apiToken: "tok-ixc", apiUser: "17" },
      {
        erpSource: "mk", isEnabled: true, apiUrl: "https://mk.nslink.com.br", apiToken: "tok-mk",
        apiUser: "integracao", mkContraSenha: "contra-secreta",
      },
    ]);

    const res = await testar(42, "mk");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "Conexao ok", latencyMs: 12 });
    const [config] = conectorMock.testConnection.mock.calls[0] as any[];
    expect(config.apiUrl).toBe("https://mk.nslink.com.br");
    // O que o handler antigo descartava com `extra: {}`.
    expect(config.mkContraSenha).toBe("contra-secreta");
  });

  it("leva clientId, clientSecret e extraConfig ao conector", async () => {
    storageMock.getErpIntegrations.mockResolvedValue([{
      erpSource: "hubsoft", isEnabled: true,
      apiUrl: "https://api.hubsoft.com.br", apiToken: "senha-oauth", apiUser: "usuario@nslink.com.br",
      clientId: "cid-123", clientSecret: "csecret-456", extraConfig: { sgpApp: "consultaisp" },
    }]);

    const res = await testar(42, "hubsoft");

    expect(res.status).toBe(200);
    const [config] = conectorMock.testConnection.mock.calls[0] as any[];
    expect(config.clientId).toBe("cid-123");
    expect(config.clientSecret).toBe("csecret-456");
    expect(config.extra).toEqual({ sgpApp: "consultaisp" });
  });

  it("sem URL ou token responde 400 e nao chama o ERP", async () => {
    storageMock.getErpIntegrations.mockResolvedValue([
      { erpSource: "ixc", isEnabled: true, apiUrl: null, apiToken: null },
    ]);

    const res = await testar(42, "ixc");

    expect(res.status).toBe(400);
    expect(conectorMock.testConnection).not.toHaveBeenCalled();
  });

  it("source invalido responde 400", async () => {
    const res = await testar(42, "erp-que-nao-existe");

    expect(res.status).toBe(400);
    expect(conectorMock.testConnection).not.toHaveBeenCalled();
  });

  it("provedor inexistente responde 404", async () => {
    storageMock.getProvider.mockResolvedValue(null);

    const res = await testar(999, "ixc");

    expect(res.status).toBe(404);
    expect(conectorMock.testConnection).not.toHaveBeenCalled();
  });

  it("id que nao e numero responde 400", async () => {
    const res = await testar("abc", "ixc");

    expect(res.status).toBe(400);
    expect(storageMock.getProvider).not.toHaveBeenCalled();
  });

  // O catch respondia `res.json` sem status: falha de rede no ERP chegava como
  // 200 e a tela nao tinha como distinguir de um teste que passou.
  it("erro do conector responde 500, nao 200", async () => {
    storageMock.getErpIntegrations.mockResolvedValue([
      { erpSource: "ixc", isEnabled: true, apiUrl: "https://ixc.nslink.com.br", apiToken: "tok" },
    ]);
    conectorMock.testConnection.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await testar(42, "ixc");

    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBe(false);
  });
});

// ── ERP cujo conector ainda nao fala com a API ───────────────────────────────

/**
 * A marca `naoImplementado` so fechava a porta da frente: a secao de adicionar
 * integracao da tela do admin. Pela rota — ou numa linha que ja existisse de
 * quando o painel do provedor aceitava qualquer fonte suportada — dava para
 * configurar e habilitar um conector que nao conversa com ERP nenhum.
 *
 * O desfecho nao era so cosmetico. A integracao nascia "ativa", o provedor lia
 * "Integrada", cada varredura automatica falhava por construcao e a terceira
 * disparava o corte automatico: e-mail ao PROVEDOR dizendo que a integracao
 * dele foi pausada por falhas, de um ERP que nunca chegou a ser implementado.
 */
describe("conector nao implementado — nao se configura nem se testa", () => {
  it("PUT responde 400 e nao grava nada", async () => {
    const res = await salvar(42, "gere", {
      apiUrl: "https://gere.nslink.com.br", apiToken: "tok-gere", isEnabled: true,
    });

    expect(res.status).toBe(400);
    expect(storageMock.upsertErpIntegration).not.toHaveBeenCalled();
  });

  it("POST test responde 400 e nao chama o conector", async () => {
    storageMock.getErpIntegrations.mockResolvedValue([
      { erpSource: "gere", isEnabled: true, apiUrl: "https://gere.nslink.com.br", apiToken: "tok-gere" },
    ]);

    const res = await testar(42, "gere");

    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
    expect(conectorMock.testConnection).not.toHaveBeenCalled();
  });

  // A guarda cobre os quatro, nao so aquele que o primeiro caso usou.
  it.each(NAO_IMPLEMENTADOS)("%s e recusado no PUT e no teste", async (source) => {
    expect((await salvar(42, source, { apiToken: "tok" })).status).toBe(400);
    expect((await testar(42, source)).status).toBe(400);
    expect(storageMock.upsertErpIntegration).not.toHaveBeenCalled();
    expect(conectorMock.testConnection).not.toHaveBeenCalled();
  });

  /**
   * A mensagem e lida por um operador humano, e ela precisa dizer POR QUE — sem
   * isso ele troca a credencial achando que errou o token. O nome do ERP sai do
   * `label` do conector, nunca o identificador tecnico.
   */
  it("a mensagem explica que o conector nao conversa com o ERP, e nomeia qual", async () => {
    const { message } = await (await salvar(42, "receitanet", { apiToken: "tok" })).json();

    expect(message).toContain("ReceitaNet");
    expect(message).toContain("não conversa com a API");
    expect(message).not.toContain("receitanet");
    expect(message).not.toContain("/api/");
  });

  // A guarda vem DEPOIS da validacao de source: sem essa ordem, um ERP que nao
  // existe viraria "ainda nao implementado" — e o operador esperaria por ele.
  it("source inexistente continua sendo ERP invalido, nao 'nao implementado'", async () => {
    const res = await salvar(42, "erp-que-nao-existe", { apiToken: "tok" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "ERP invalido" });
  });

  // O outro lado da guarda: ela nao pode ter fechado o caminho de quem funciona.
  it("ERP implementado continua gravando com 200", async () => {
    const res = await salvar(42, "ixc", {
      apiUrl: "https://ixc.nslink.com.br", apiUser: "17", apiToken: "tok-ixc", isEnabled: true,
    });

    expect(res.status).toBe(200);
    expect(storageMock.upsertErpIntegration).toHaveBeenCalledTimes(1);
  });
});

// ── A leitura da aba de integracao ───────────────────────────────────────────

/**
 * A chave dos segredos deriva do SESSION_SECRET. Quando ele muda — troca de
 * servidor, base restaurada de outro ambiente — o AES-GCM nao devolve lixo:
 * ele LANCA. A leitura decifrada crua fazia UMA credencial podre derrubar a
 * aba inteira com 500, e esta e justamente a tela onde se redigita a credencial
 * podre: o unico caminho de conserto morria pelo defeito que ele conserta.
 */
describe("GET /api/admin/providers/:id/integration", () => {
  it("credencial ilegivel nao derruba a aba: 200 com a linha sadia e a quebrada marcada", async () => {
    storageMock.getErpIntegracoesParaAdmin.mockResolvedValue([
      {
        erpSource: "ixc", isEnabled: true, apiUrl: "https://ixc.nslink.com.br",
        apiToken: "tok-ixc", credencialIlegivel: false,
      },
      {
        erpSource: "mk", isEnabled: true, apiUrl: "https://mk.nslink.com.br",
        apiToken: null, mkContraSenha: null, credencialIlegivel: true,
      },
    ]);

    const res = await lerIntegracao(42);

    expect(res.status).toBe(200);
    const { integrations } = await res.json();
    expect(integrations).toHaveLength(2);
    expect(integrations[0].apiToken).toBe("tok-ixc");
    // Marcada, e nao omitida: campo vazio sem aviso o operador salvaria por
    // cima achando que nunca houve credencial ali.
    expect(integrations[1].credencialIlegivel).toBe(true);
    expect(integrations[1].erpSource).toBe("mk");
  });

  /**
   * A trava: `getErpIntegrations` lanca no mock deste arquivo. Se alguem voltar
   * a le-la aqui, este caso fica vermelho em 500 antes de chegar a producao.
   */
  it("nao usa a leitura que lanca em credencial ilegivel", async () => {
    const res = await lerIntegracao(42);

    expect(res.status).toBe(200);
    expect(storageMock.getErpIntegrations).not.toHaveBeenCalled();
    expect(storageMock.getErpIntegracoesParaAdmin).toHaveBeenCalledWith(42);
  });

  it("responde 403 para quem nao e superadmin", async () => {
    sessao = { userId: 5, role: "admin", providerId: 42 };

    const res = await lerIntegracao(42);

    expect(res.status).toBe(403);
    expect(storageMock.getErpIntegracoesParaAdmin).not.toHaveBeenCalled();
  });
});

// ── Os gravadores divergentes que sumiram ────────────────────────────────────

/**
 * Dois gravadores para a mesma tabela significavam dado salvo em coluna
 * diferente conforme a tela usada: `erp-config` quebrava o token no primeiro
 * ":" e, no MK, gravava a contra-senha em `apiUser`.
 */
describe("rotas legadas de ERP do superadmin", () => {
  it("PUT /api/admin/providers/:id/erp-config responde 404", async () => {
    const res = await fetch(`${base}/api/admin/providers/42/erp-config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ erpSource: "mk", apiUrl: "https://mk.nslink.com.br", apiToken: "tok:contra" }),
    });

    expect(res.status).toBe(404);
    expect(storageMock.upsertErpIntegration).not.toHaveBeenCalled();
  });

  it("POST /api/admin/providers/:id/erp-test responde 404", async () => {
    const res = await fetch(`${base}/api/admin/providers/42/erp-test`, { method: "POST" });

    expect(res.status).toBe(404);
    expect(conectorMock.testConnection).not.toHaveBeenCalled();
  });
});
