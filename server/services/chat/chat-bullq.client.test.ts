/**
 * O cliente do Chat BullQ, contra um servidor falso que grava cada chamada.
 *
 * O que se prova aqui e o que o chamador nunca enxerga: que a sessao e obtida
 * uma vez e reusada, que o 401 renova UMA vez e repete, que a queda do refresh
 * volta a plataforma, e que telefone e token nao passam pelo log — a API do
 * chat carrega o telefone na query e o token no cabecalho, os dois lugares
 * que um log de requisicao mais costuma copiar por descuido.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}));
vi.mock("../../logger", () => ({ logger: loggerMock }));

import { ChatBullqClient, normalizarTelefoneParaChat, type Conversa } from "./chat-bullq.client";

// ---------------------------------------------------------------------------
// Servidor falso
// ---------------------------------------------------------------------------

interface Chamada {
  metodo: string;
  url: string;
  /** Caminho SEM o `/api/v1`, para o teste ler como o contrato escreve. */
  caminho: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  corpo: any;
}

type Resposta = { status?: number; corpo?: unknown };
type Responder = (chamada: Chamada) => Resposta | Promise<Resposta>;

function servidorFalso() {
  const chamadas: Chamada[] = [];
  const rotas: Array<{ metodo: string; caminho: string | RegExp; responder: Responder }> = [];

  const fetchImpl = async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(entrada));
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) headers[k.toLowerCase()] = v;
    const chamada: Chamada = {
      metodo: init?.method ?? "GET",
      url: url.toString(),
      caminho: url.pathname.replace(/^\/api\/v1/, ""),
      query: url.searchParams,
      headers,
      corpo: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    chamadas.push(chamada);

    const rota = rotas.find(r =>
      r.metodo === chamada.metodo &&
      (typeof r.caminho === "string" ? r.caminho === chamada.caminho : r.caminho.test(chamada.caminho)),
    );
    if (!rota) throw new Error(`rota nao prevista no teste: ${chamada.metodo} ${chamada.caminho}`);
    const { status = 200, corpo } = await rota.responder(chamada);
    return resposta(status, corpo);
  };

  return {
    chamadas,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    quando(metodo: string, caminho: string | RegExp, responder: Responder) {
      rotas.push({ metodo, caminho, responder });
    },
    /** As chamadas de um caminho, para contar quantas vezes a API foi procurada. */
    de(caminho: string | RegExp) {
      return chamadas.filter(c => (typeof caminho === "string" ? c.caminho === caminho : caminho.test(c.caminho)));
    },
  };
}

function resposta(status: number, corpo: unknown): Response {
  const texto = corpo === undefined ? "" : JSON.stringify(corpo);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => texto,
    json: async () => JSON.parse(texto),
    headers: new Headers({ "content-type": "application/json" }),
  } as unknown as Response;
}

const ORG = "org_7f3a";
const CHAVE = "pk_plataforma_secreta";
const TOKEN_1 = { accessToken: "acesso-um", refreshToken: "refresh-um" };
const TOKEN_2 = { accessToken: "acesso-dois", refreshToken: "refresh-dois" };
const TELEFONE = "43999990000";
const TELEFONE_COM_55 = "5543999990000";

/** Servidor com a plataforma respondendo o primeiro par de tokens. */
function servidorComSessao() {
  const s = servidorFalso();
  s.quando("POST", `/platform/organizations/${ORG}/token`, () => ({ corpo: { data: TOKEN_1 } }));
  return s;
}

function cliente(s: ReturnType<typeof servidorFalso>, extra: { timeoutMs?: number; baseUrl?: string } = {}) {
  return new ChatBullqClient({
    baseUrl: extra.baseUrl ?? "https://chat.example.com/",
    platformKey: CHAVE,
    fetchImpl: s.fetchImpl,
    timeoutMs: extra.timeoutMs,
  });
}

function conversa(parcial: Partial<Conversa> & { id: string; phone: string | null; lastMessageAt: string | null }): Conversa {
  return {
    id: parcial.id,
    status: parcial.status ?? "OPEN",
    contact: { name: "Fulano", phone: parcial.phone },
    channel: { id: "canal-1", type: "WHATSAPP_ZAPPFY", name: "Zap" },
    assignedTo: null,
    aiEnabled: null,
    activeAgentId: null,
    lastMessageAt: parcial.lastMessageAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe("provisionarOrganizacao", () => {
  it("fala com a plataforma pela chave, sem JWT, e devolve o data", async () => {
    const s = servidorFalso();
    const org = { organizationId: ORG, slug: "amplinet", ownerUserId: "u1", ownerEmail: "dono@amplinet.com.br", created: true };
    s.quando("POST", "/platform/organizations", () => ({ corpo: { data: org, meta: {} } }));

    const r = await cliente(s).provisionarOrganizacao({
      name: "Amplinet", slug: "amplinet", ownerEmail: "dono@amplinet.com.br", ownerName: "Helio", externalId: "provider:12",
    });

    expect(r).toEqual({ ok: true, valor: org });
    const [chamada] = s.chamadas;
    expect(chamada.url).toBe("https://chat.example.com/api/v1/platform/organizations");
    expect(chamada.headers["x-platform-key"]).toBe(CHAVE);
    expect(chamada.headers["authorization"]).toBeUndefined();
    expect(chamada.headers["content-type"]).toBe("application/json");
    expect(chamada.corpo).toEqual({
      name: "Amplinet", slug: "amplinet", ownerEmail: "dono@amplinet.com.br", ownerName: "Helio", externalId: "provider:12",
    });
  });

  it("nao duplica o /api/v1 quando a baseUrl ja o traz", async () => {
    const s = servidorFalso();
    s.quando("POST", "/platform/organizations", () => ({ corpo: { data: {} } }));
    await cliente(s, { baseUrl: "https://chat.example.com/api/v1/" }).provisionarOrganizacao({
      name: "X", ownerEmail: "x@x.com", ownerName: "X",
    });
    expect(s.chamadas[0].url).toBe("https://chat.example.com/api/v1/platform/organizations");
  });
});

describe("sessao", () => {
  it("obtem o token pela plataforma uma vez e reusa nas chamadas seguintes", async () => {
    const s = servidorComSessao();
    s.quando("GET", "/channels", () => ({ corpo: { data: [{ id: "c1", type: "WHATSAPP_ZAPPFY", name: "Zap", isActive: true }] } }));
    const c = cliente(s);

    const a = await c.listarCanais(ORG);
    const b = await c.listarCanais(ORG);

    expect(a.ok && a.valor[0].id).toBe("c1");
    expect(b.ok).toBe(true);
    expect(s.de(`/platform/organizations/${ORG}/token`)).toHaveLength(1);

    const [pedidoDeToken, ...operacoes] = s.chamadas;
    expect(pedidoDeToken.headers["x-platform-key"]).toBe(CHAVE);
    for (const op of operacoes) {
      expect(op.headers["authorization"]).toBe(`Bearer ${TOKEN_1.accessToken}`);
      expect(op.headers["x-organization-id"]).toBe(ORG);
      expect(op.headers["x-platform-key"]).toBeUndefined();
    }
  });

  it("sessao() confirma sem entregar o token ao chamador", async () => {
    const s = servidorComSessao();
    const r = await cliente(s).sessao(ORG);
    expect(r).toEqual({ ok: true, valor: { organizationId: ORG } });
    expect(JSON.stringify(r)).not.toContain(TOKEN_1.accessToken);
  });

  it("ao receber 401 renova pelo /auth/refresh e repete a chamada com o token novo", async () => {
    const s = servidorComSessao();
    let vezes = 0;
    s.quando("GET", "/channels", ch => {
      vezes++;
      if (ch.headers["authorization"] === `Bearer ${TOKEN_2.accessToken}`) return { corpo: { data: [] } };
      return { status: 401, corpo: { message: "Unauthorized" } };
    });
    s.quando("POST", "/auth/refresh", ch => {
      expect(ch.corpo).toEqual({ refreshToken: TOKEN_1.refreshToken });
      expect(ch.headers["x-organization-id"]).toBe(ORG);
      return { corpo: { data: TOKEN_2 } };
    });

    const r = await cliente(s).listarCanais(ORG);

    expect(r).toEqual({ ok: true, valor: [] });
    expect(vezes).toBe(2);
    expect(s.chamadas.map(c => `${c.metodo} ${c.caminho}`)).toEqual([
      `POST /platform/organizations/${ORG}/token`,
      "GET /channels",
      "POST /auth/refresh",
      "GET /channels",
    ]);
  });

  it("se o refresh falhar, reobtem a sessao pela plataforma e repete", async () => {
    const s = servidorFalso();
    let pedidosDeToken = 0;
    s.quando("POST", `/platform/organizations/${ORG}/token`, () => {
      pedidosDeToken++;
      return { corpo: { data: pedidosDeToken === 1 ? TOKEN_1 : TOKEN_2 } };
    });
    s.quando("POST", "/auth/refresh", () => ({ status: 401, corpo: { message: "Refresh token expirado" } }));
    s.quando("GET", "/channels", ch =>
      ch.headers["authorization"] === `Bearer ${TOKEN_2.accessToken}`
        ? { corpo: { data: [] } }
        : { status: 401, corpo: { message: "Unauthorized" } },
    );

    const r = await cliente(s).listarCanais(ORG);

    expect(r).toEqual({ ok: true, valor: [] });
    expect(pedidosDeToken).toBe(2);
    expect(s.chamadas.map(c => `${c.metodo} ${c.caminho}`)).toEqual([
      `POST /platform/organizations/${ORG}/token`,
      "GET /channels",
      "POST /auth/refresh",
      `POST /platform/organizations/${ORG}/token`,
      "GET /channels",
    ]);
  });

  it("renova so uma vez: 401 depois do token novo vira erro, nao laco", async () => {
    const s = servidorComSessao();
    s.quando("GET", "/channels", () => ({ status: 401, corpo: { message: "Sem acesso" } }));
    s.quando("POST", "/auth/refresh", () => ({ corpo: { data: TOKEN_2 } }));

    const r = await cliente(s).listarCanais(ORG);

    expect(r).toEqual({ ok: false, erro: "Sem acesso", status: 401 });
    expect(s.de("/channels")).toHaveLength(2);
  });

  it("chamadas simultaneas na mesma organizacao pedem um token so", async () => {
    const s = servidorComSessao();
    s.quando("GET", "/channels", () => ({ corpo: { data: [] } }));
    const c = cliente(s);
    await Promise.all([c.listarCanais(ORG), c.listarCanais(ORG), c.listarCanais(ORG)]);
    expect(s.de(`/platform/organizations/${ORG}/token`)).toHaveLength(1);
  });
});

describe("buscarConversaPorTelefone", () => {
  it("casa o telefone com e sem 55 e devolve a mais recente por lastMessageAt", async () => {
    const s = servidorComSessao();
    s.quando("GET", "/conversations", () => ({
      corpo: {
        data: {
          conversations: [
            conversa({ id: "antiga-com-55", phone: TELEFONE_COM_55, lastMessageAt: "2026-09-01T10:00:00Z" }),
            conversa({ id: "outro-numero", phone: "5543988880000", lastMessageAt: "2026-09-05T10:00:00Z" }),
            conversa({ id: "recente-sem-55", phone: "(43) 99999-0000", lastMessageAt: "2026-09-04T10:00:00Z" }),
            conversa({ id: "sem-mensagem", phone: TELEFONE, lastMessageAt: null }),
          ],
          pagination: { page: 1, limit: 20, total: 4 },
        },
      },
    }));

    const r = await cliente(s).buscarConversaPorTelefone(ORG, "(43) 99999-0000", "canal-1");

    expect(r.ok && r.valor?.id).toBe("recente-sem-55");
    const busca = s.de("/conversations")[0];
    expect(busca.query.get("search")).toBe(TELEFONE_COM_55);
    expect(busca.query.get("channelId")).toBe("canal-1");
    expect(busca.query.get("limit")).toBe("20");
  });

  it("devolve null quando nenhuma conversa e daquele telefone", async () => {
    const s = servidorComSessao();
    s.quando("GET", "/conversations", () => ({
      corpo: { data: { conversations: [conversa({ id: "x", phone: "5543988880000", lastMessageAt: null })], pagination: {} } },
    }));
    const r = await cliente(s).buscarConversaPorTelefone(ORG, TELEFONE);
    expect(r).toEqual({ ok: true, valor: null });
    expect(s.de("/conversations")[0].query.has("channelId")).toBe(false);
  });

  it("recusa telefone que nao e brasileiro sem bater na API", async () => {
    const s = servidorComSessao();
    const r = await cliente(s).buscarConversaPorTelefone(ORG, "123");
    expect(r.ok).toBe(false);
    expect(s.chamadas).toHaveLength(0);
  });
});

describe("iniciarConversa e enviarTexto", () => {
  it("monta o corpo do contrato com o telefone normalizado e devolve os ids", async () => {
    const s = servidorComSessao();
    s.quando("POST", "/conversations", () => ({ corpo: { data: { id: "msg-1", conversationId: "conv-1", status: "SENT" } } }));

    const r = await cliente(s).iniciarConversa(ORG, {
      canalId: "canal-1", telefone: "(43) 99999-0000", nome: "Fulano", texto: "Olá, sua fatura venceu.",
    });

    expect(r).toEqual({ ok: true, valor: { conversationId: "conv-1", messageId: "msg-1" } });
    expect(s.de("/conversations")[0].corpo).toEqual({
      channelId: "canal-1",
      contact: { phone: TELEFONE_COM_55, name: "Fulano" },
      message: { type: "TEXT", content: { text: "Olá, sua fatura venceu." } },
    });
  });

  it("enviarTexto manda para /messages e devolve id e status", async () => {
    const s = servidorComSessao();
    s.quando("POST", "/messages", () => ({ corpo: { data: { id: "msg-2", conversationId: "conv-1", status: "QUEUED" } } }));

    const r = await cliente(s).enviarTexto(ORG, "conv-1", "Segunda via em anexo.");

    expect(r).toEqual({ ok: true, valor: { messageId: "msg-2", status: "QUEUED" } });
    expect(s.de("/messages")[0].corpo).toEqual({ conversationId: "conv-1", type: "TEXT", content: { text: "Segunda via em anexo." } });
  });

  it("listarMensagens aceita o envelope e o array cru", async () => {
    const s = servidorComSessao();
    const msg = { id: "m", direction: "INBOUND", type: "TEXT", content: { text: "oi" }, status: "READ", createdAt: "2026-09-05T00:00:00Z" };
    let vez = 0;
    s.quando("GET", "/messages", () => ({ corpo: ++vez === 1 ? { data: { messages: [msg], pagination: {} } } : { data: [msg] } }));
    const c = cliente(s);

    const a = await c.listarMensagens(ORG, "conv-1", { limit: 5 });
    const b = await c.listarMensagens(ORG, "conv-1");

    expect(a).toEqual({ ok: true, valor: [msg] });
    expect(b).toEqual({ ok: true, valor: [msg] });
    expect(s.de("/messages")[0].query.get("limit")).toBe("5");
    expect(s.de("/messages")[0].query.get("conversationId")).toBe("conv-1");
  });
});

describe("gestao da conversa e agentes", () => {
  it("atribuir manda so os campos informados; IA e encerramento batem nos caminhos certos", async () => {
    const s = servidorComSessao();
    s.quando("PATCH", "/conversations/conv-1", ch => ({ corpo: { data: conversa({ id: "conv-1", phone: null, lastMessageAt: null, status: ch.corpo.status }) } }));
    s.quando("POST", "/conversations/conv-1/ai/engage", () => ({ corpo: { data: {} } }));
    s.quando("PATCH", "/conversations/conv-1/ai", () => ({ corpo: { data: {} } }));
    s.quando("POST", "/conversations/conv-1/close", () => ({ status: 204 }));
    const c = cliente(s);

    const atribuida = await c.atribuir(ORG, "conv-1", { assignedToId: "op-9", status: "OPEN", departmentId: undefined });
    expect(atribuida.ok && atribuida.valor.status).toBe("OPEN");
    expect(s.de("/conversations/conv-1")[0].corpo).toEqual({ assignedToId: "op-9", status: "OPEN" });

    expect(await c.ligarIa(ORG, "conv-1")).toEqual({ ok: true, valor: undefined });
    expect(await c.desligarIa(ORG, "conv-1")).toEqual({ ok: true, valor: undefined });
    expect(s.de("/conversations/conv-1/ai")[0].corpo).toEqual({ enabled: false });
    expect(await c.encerrar(ORG, "conv-1")).toEqual({ ok: true, valor: undefined });
  });

  it("canais e agentes: cria o canal Zappfy, testa, lista e liga agente ao canal", async () => {
    const s = servidorComSessao();
    const canal = { id: "canal-2", type: "WHATSAPP_ZAPPFY", name: "Cobrança", isActive: true };
    const agente = { id: "ag-1", name: "Cobrador", kind: "WORKER", modelId: "gpt-4o-mini", isActive: true };
    s.quando("POST", "/channels", () => ({ corpo: { data: canal } }));
    s.quando("POST", "/channels/canal-2/test", () => ({ corpo: { data: { ok: true } } }));
    s.quando("GET", "/ai-agents", () => ({ corpo: { data: [agente] } }));
    s.quando("POST", "/ai-agents", () => ({ corpo: { data: agente } }));
    s.quando("POST", "/ai-agents/ag-1/channels", () => ({ corpo: { data: {} } }));
    const c = cliente(s);

    expect(await c.criarCanalZappfy(ORG, { nome: "Cobrança", token: "tok-zap", webhookSecret: "seg" })).toEqual({ ok: true, valor: canal });
    expect(s.de("/channels")[0].corpo).toEqual({ type: "WHATSAPP_ZAPPFY", name: "Cobrança", config: { token: "tok-zap" }, webhookSecret: "seg" });
    expect(await c.testarCanal(ORG, "canal-2")).toEqual({ ok: true, valor: { ok: true } });
    expect(await c.listarAgentes(ORG)).toEqual({ ok: true, valor: [agente] });
    expect(await c.criarAgente(ORG, { name: "Cobrador", kind: "WORKER", systemPrompt: "...", modelId: "gpt-4o-mini" })).toEqual({ ok: true, valor: agente });
    expect(await c.ligarAgenteAoCanal(ORG, "ag-1", "canal-2", "AUTONOMOUS", "OFF_HOURS")).toEqual({ ok: true, valor: undefined });
    expect(s.de("/ai-agents/ag-1/channels")[0].corpo).toEqual({ channelId: "canal-2", mode: "AUTONOMOUS", trigger: "OFF_HOURS" });
  });
});

describe("falhas", () => {
  it("erro HTTP vira { ok:false, erro, status } com a message da API", async () => {
    const s = servidorComSessao();
    s.quando("POST", "/messages", () => ({ status: 422, corpo: { message: "Conversa encerrada não aceita mensagem" } }));

    const r = await cliente(s).enviarTexto(ORG, "conv-1", "oi");

    expect(r).toEqual({ ok: false, erro: "Conversa encerrada não aceita mensagem", status: 422 });
  });

  it("erro de validacao do NestJS (message em lista) vira uma frase so", async () => {
    const s = servidorComSessao();
    s.quando("POST", "/messages", () => ({ status: 400, corpo: { message: ["conversationId must be a string", "content should not be empty"] } }));
    const r = await cliente(s).enviarTexto(ORG, "conv-1", "oi");
    expect(r).toEqual({ ok: false, erro: "conversationId must be a string; content should not be empty", status: 400 });
  });

  it("erro HTTP sem message ganha uma frase em portugues com o status", async () => {
    const s = servidorComSessao();
    s.quando("GET", "/channels", () => ({ status: 502 }));
    const r = await cliente(s).listarCanais(ORG);
    expect(r).toEqual({ ok: false, erro: "O Chat BullQ respondeu 502", status: 502 });
  });

  it("falha na propria obtencao da sessao chega ao chamador como resultado, nao como excecao", async () => {
    const s = servidorFalso();
    s.quando("POST", `/platform/organizations/${ORG}/token`, () => ({ status: 403, corpo: { message: "Chave de plataforma inválida" } }));
    const r = await cliente(s).listarCanais(ORG);
    expect(r).toEqual({ ok: false, erro: "Chave de plataforma inválida", status: 403 });
  });

  it("timeout vira { ok:false } com mensagem em portugues, sem lancar", async () => {
    const pendurado = ((_entrada: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const c = new ChatBullqClient({ baseUrl: "https://chat.example.com", platformKey: CHAVE, fetchImpl: pendurado, timeoutMs: 20 });

    const r = await c.provisionarOrganizacao({ name: "X", ownerEmail: "x@x.com", ownerName: "X" });

    expect(r).toEqual({ ok: false, erro: "O Chat BullQ não respondeu em 0s" });
  });

  it("queda de rede vira { ok:false } em portugues, sem a URL na mensagem", async () => {
    const caido = (async (entrada: RequestInfo | URL) => {
      throw Object.assign(new Error(`connect ECONNREFUSED ${String(entrada)}`), { code: "ECONNREFUSED" });
    }) as unknown as typeof fetch;
    const c = new ChatBullqClient({ baseUrl: "https://chat.example.com", platformKey: CHAVE, fetchImpl: caido });

    const r = await c.provisionarOrganizacao({ name: "X", ownerEmail: "x@x.com", ownerName: "X" });

    expect(r).toEqual({ ok: false, erro: "Não foi possível falar com o Chat BullQ" });
  });
});

describe("normalizarTelefoneParaChat", () => {
  it("11 digitos (celular com DDD) ganha o 55", () => {
    expect(normalizarTelefoneParaChat("(43) 99999-0000")).toBe("5543999990000");
  });
  it("10 digitos (fixo com DDD) ganha o 55", () => {
    expect(normalizarTelefoneParaChat("43 3333-4444")).toBe("554333334444");
  });
  it("13 digitos que ja comecam com 55 ficam como estao", () => {
    expect(normalizarTelefoneParaChat("+55 (43) 99999-0000")).toBe("5543999990000");
  });
  it("12 digitos que ja comecam com 55 ficam como estao", () => {
    expect(normalizarTelefoneParaChat("55 43 3333-4444")).toBe("554333334444");
  });
  it("qualquer outra coisa e null: curto, 12 digitos sem 55, longo demais, vazio, nulo", () => {
    expect(normalizarTelefoneParaChat("99999-0000")).toBeNull();
    expect(normalizarTelefoneParaChat("+44 20 7946 0958")).toBeNull();
    expect(normalizarTelefoneParaChat("55 43 99999-0000 1")).toBeNull();
    expect(normalizarTelefoneParaChat("")).toBeNull();
    expect(normalizarTelefoneParaChat(null)).toBeNull();
    expect(normalizarTelefoneParaChat(undefined)).toBeNull();
  });
});

describe("log", () => {
  it("nenhuma linha de log carrega telefone, token, chave de plataforma ou texto da mensagem", async () => {
    const s = servidorComSessao();
    const TEXTO = "Sua fatura de setembro venceu ontem";
    s.quando("GET", "/conversations", () => ({ corpo: { data: { conversations: [], pagination: {} } } }));
    s.quando("POST", "/conversations", () => ({ status: 401, corpo: { message: "Unauthorized" } }));
    s.quando("POST", "/auth/refresh", () => ({ status: 401, corpo: { message: "expirado" } }));
    const c = cliente(s);

    await c.buscarConversaPorTelefone(ORG, "(43) 99999-0000");
    await c.iniciarConversa(ORG, { canalId: "canal-1", telefone: TELEFONE, nome: "Fulano", texto: TEXTO });

    const linhas = [loggerMock.info, loggerMock.warn, loggerMock.error, loggerMock.debug]
      .flatMap(fn => fn.mock.calls)
      .map(args => JSON.stringify(args));

    // O teste so vale se o cliente logou de fato — uma sessao, uma recusa, um refresh.
    expect(linhas.length).toBeGreaterThanOrEqual(3);
    for (const linha of linhas) {
      expect(linha).not.toContain(TELEFONE);
      expect(linha).not.toContain(TELEFONE_COM_55);
      expect(linha).not.toContain("99999");
      expect(linha).not.toContain(TOKEN_1.accessToken);
      expect(linha).not.toContain(TOKEN_1.refreshToken);
      expect(linha).not.toContain(CHAVE);
      expect(linha).not.toContain("Fulano");
      expect(linha).not.toContain(TEXTO);
      expect(linha).not.toContain("search=");
    }
  });
});
