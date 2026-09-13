import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * O chat simulado da demonstração sob contrato: o `ChatBullqClient` REAL, com
 * o `fetch` local, responde a TODO método público sem tocar a rede (o espião
 * em `globalThis.fetch` falha se for chamado); o histórico de uma conversa
 * semeada sai do banco coerente com a cena e com a janela de 24 h; o que o
 * visitante manda entra no histórico e some com a limpeza do sandbox; um
 * provedor nunca lê a conversa de outro.
 *
 * Banco de mentira no molde de `sandbox.service.test.ts`: o compilador SQL
 * real do Drizzle (`drizzle-orm/pg-proxy`) fala com o callback abaixo, que
 * devolve as linhas semeadas na ordem das colunas pedidas.
 */

const banco = vi.hoisted(() => ({
  conversas: [] as Record<string, unknown>[],
  integracoes: [] as Record<string, unknown>[],
  provedores: [] as Record<string, unknown>[],
  db: null as any,
}));

vi.mock("../db", () => ({
  db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }),
  pool: {},
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { drizzle } from "drizzle-orm/pg-proxy";
import { ChatBullqClient, type Resultado } from "../services/chat/chat-bullq.client";
import {
  fetchDoChatSimulado, limparChatSimuladoDoProvedor, MAXIMO_DE_CONVERSAS_CRIADAS, MAXIMO_DE_REGISTROS_POR_COLECAO, URL_DO_CHAT_SIMULADO, varrerOrganizacoesSemProvedor,
} from "./chat-simulado";

/** `select "t"."c", ... from "tabela"` -> as linhas do fixture como arrays, na ordem pedida. */
function responder(sql: string, params: unknown[]): unknown[][] {
  const m = /^select (.+?) from "(\w+)"/.exec(sql);
  if (!m) throw new Error(`SQL inesperado no banco de mentira: ${sql}`);
  const tabela = m[2];
  const colunas = m[1].split(", ").map((c) => {
    const col = /^(?:"(\w+)"\.)?"(\w+)"$/.exec(c);
    if (!col) throw new Error(`Coluna nao reconhecida: ${c}`);
    return `${col[1] ?? tabela}.${col[2]}`;
  });
  let linhas: Record<string, unknown>[] = [];
  if (tabela === "chat_bullq_conversas") {
    const conversa = params.find((p) => typeof p === "string");
    linhas = banco.conversas.filter((l) => l["chat_bullq_conversas.provider_id"] === params[0]
      && (conversa === undefined || l["chat_bullq_conversas.conversation_id"] === conversa));
  } else if (tabela === "chat_bullq_integracoes") {
    linhas = banco.integracoes.filter((l) => l["chat_bullq_integracoes.organization_id"] === params[0]);
  } else if (tabela === "providers") {
    // A varredura da memória: `select "id" from "providers" where "id" in (...)`.
    linhas = banco.provedores.filter((l) => params.includes(l["providers.id"]));
  } else {
    throw new Error(`Tabela inesperada: ${tabela}`);
  }
  return linhas.map((l) => colunas.map((c) => l[c] ?? null));
}
banco.db = drizzle(async (sql, params) => ({ rows: responder(sql, params) }));

const HORA = 60 * 60 * 1000;
const ORG = "demo-org-6";
/** Timestamp sem fuso, como o driver do Postgres devolve (o Drizzle acrescenta +0000). */
const driver = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, -1);

interface Semeada {
  providerId?: number; seq: number; status: string; origem?: "cobranca" | "equipamentos";
  abertaHaHoras: number; ultimoHaHoras: number;
  caso?: { status: string; carteira: string; valor: string; dias: number };
  recuperacao?: { status: string; agendadaEmHoras?: number };
  /** Dívida do cliente sem caso (inadimplente que ainda não virou card). */
  cliente?: { valor: string; dias: number };
}

function semear(s: Semeada, agora: number) {
  const providerId = s.providerId ?? 6;
  const linha = {
    "chat_bullq_conversas.provider_id": providerId,
    "chat_bullq_conversas.conversation_id": `demo-conv-${providerId}-${s.seq}`,
    "chat_bullq_conversas.status": s.status,
    "chat_bullq_conversas.origem": s.origem ?? "cobranca",
    "chat_bullq_conversas.canal_id": "demo-canal",
    "chat_bullq_conversas.aberta_em": driver(agora - s.abertaHaHoras * HORA),
    "chat_bullq_conversas.ultimo_evento_em": driver(agora - s.ultimoHaHoras * HORA),
    "customers.name": `Maria Fictícia ${s.seq}`,
    "customers.phone": `(43) 99999-000${s.seq}`,
    "customers.total_overdue_amount": s.cliente?.valor ?? s.caso?.valor ?? "0",
    "customers.max_days_overdue": s.cliente?.dias ?? s.caso?.dias ?? 0,
    "providers.name": "Rede Demonstração Ltda",
    "providers.trade_name": "Rede Demo",
    "users.name": "Ana Atendente",
    "cobranca_casos.status": s.caso?.status ?? null,
    "cobranca_casos.carteira": s.caso?.carteira ?? null,
    "cobranca_casos.valor_atual": s.caso?.valor ?? null,
    "cobranca_casos.dias_atraso_abertura": s.caso?.dias ?? null,
    "equipment_recovery_cases.status": s.recuperacao?.status ?? null,
    "equipment_recovery_cases.scheduled_at": s.recuperacao?.agendadaEmHoras !== undefined ? driver(agora + s.recuperacao.agendadaEmHoras * HORA) : null,
    "equipment.type": s.recuperacao ? "onu" : null,
    "equipment.brand": s.recuperacao ? "Huawei" : null,
    "equipment.model": s.recuperacao ? "EG8145" : null,
  };
  banco.conversas.push(linha);
  return { conversationId: linha["chat_bullq_conversas.conversation_id"], abertaEm: agora - s.abertaHaHoras * HORA, ultimoEventoEm: agora - s.ultimoHaHoras * HORA, ...s };
}

let agora: number;
let semeadas: Record<string, ReturnType<typeof semear>>;
let espiao: ReturnType<typeof vi.spyOn>;
const novoCliente = () => new ChatBullqClient({ baseUrl: URL_DO_CHAT_SIMULADO, platformKey: "demo", fetchImpl: fetchDoChatSimulado });

beforeEach(() => {
  agora = Date.now();
  banco.conversas.length = 0;
  banco.integracoes = [{ "chat_bullq_integracoes.organization_id": ORG, "chat_bullq_integracoes.owner_email": "admin@sandbox-6.demo.invalid" }];
  banco.provedores = [{ "providers.id": 6 }, { "providers.id": 7 }];
  limparChatSimuladoDoProvedor(6);
  limparChatSimuladoDoProvedor(7);
  semeadas = {
    lembrete: semear({ seq: 1, status: "OPEN", abertaHaHoras: 30, ultimoHaHoras: 2, caso: { status: "aberto", carteira: "ativo", valor: "189.90", dias: 12 } }, agora),
    promessa: semear({ seq: 2, status: "WAITING", abertaHaHoras: 72, ultimoHaHoras: 3, caso: { status: "em_contato", carteira: "ativo", valor: "99.90", dias: 20 } }, agora),
    exCliente: semear({ seq: 3, status: "PENDING", abertaHaHoras: 120, ultimoHaHoras: 40, caso: { status: "negativado", carteira: "ex_cliente", valor: "240.00", dias: 150 } }, agora),
    retirada: semear({ seq: 4, status: "WAITING", origem: "equipamentos", abertaHaHoras: 96, ultimoHaHoras: 30, recuperacao: { status: "agendado", agendadaEmHoras: 48 } }, agora),
    encerrada: semear({ seq: 5, status: "CLOSED", abertaHaHoras: 144, ultimoHaHoras: 120, caso: { status: "em_contato", carteira: "ativo", valor: "120.00", dias: 9 } }, agora),
    semResposta: semear({ seq: 6, status: "WAITING", abertaHaHoras: 3, ultimoHaHoras: 3, caso: { status: "aberto", carteira: "ativo", valor: "80.00", dias: 3 } }, agora),
    negociacao: semear({ seq: 7, status: "BOT", abertaHaHoras: 50, ultimoHaHoras: 1, caso: { status: "negociando", carteira: "ativo", valor: "300.00", dias: 45 } }, agora),
    deOutroProvedor: semear({ providerId: 7, seq: 1, status: "OPEN", abertaHaHoras: 10, ultimoHaHoras: 1, caso: { status: "aberto", carteira: "ativo", valor: "50.00", dias: 5 } }, agora),
  };
  espiao = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("o chat simulado nao pode tocar a rede"); });
});
afterEach(() => { espiao.mockRestore(); });

async function mensagensDe(c: ChatBullqClient, conversationId: string, org = ORG) {
  const r = await c.listarMensagens(org, conversationId, { page: 1, limit: 40 });
  if (!r.ok) throw new Error(`listarMensagens falhou: ${r.erro}`);
  return r.valor;
}

describe("todo método público do ChatBullqClient responde sem rede", () => {
  const PRIVADOS = new Set(["constructor", "cabecalhosPlataforma", "cabecalhosOperacao", "obterTokens", "autenticarPelaPlataforma", "renovarSessao", "operacao", "montarUrl", "requisicao"]);

  it("cada método tem resposta local; só senha do inbox, mídia e plano autônomo recusam, e recusam com status", async () => {
    const c = novoCliente();
    const ctx: Record<string, string> = {};
    const idDe = (r: Resultado<unknown>) => (r.ok ? String((r.valor as { id?: string }).id) : "sem-id");
    const conversa = semeadas.lembrete.conversationId;
    // Em ordem: o que depende de um id criado vem depois de quem o cria.
    const roteiro: Array<[string, () => Promise<Resultado<unknown>>, boolean]> = [
      ["provisionarOrganizacao", () => c.provisionarOrganizacao({ name: "Rede Demo", slug: "rede-demo", ownerEmail: "admin@sandbox-6.demo.invalid", ownerName: "Rede Demo", externalId: "6" }), true],
      ["sessao", () => c.sessao(ORG), true],
      ["definirSenhaDoOwner", () => c.definirSenhaDoOwner(ORG, "senha-da-demo"), false],
      ["listarCanais", () => c.listarCanais(ORG), true],
      ["capacidadesDosCanais", () => c.capacidadesDosCanais(ORG), true],
      ["criarCanalZappfy", () => c.criarCanalZappfy(ORG, { nome: "Principal", token: "token-ficticio" }), true],
      ["criarCanalWhatsapp", () => c.criarCanalWhatsapp(ORG, { provider: "ZAPPFY", nome: "Principal", token: "token-ficticio" } as never), true],
      ["testarCanal", () => c.testarCanal(ORG, "demo-canal"), true],
      ["estadoDaConexaoWhatsapp", () => c.estadoDaConexaoWhatsapp(ORG, "demo-canal"), true],
      ["conectarWhatsapp", () => c.conectarWhatsapp(ORG, "demo-canal", "5543999990000"), true],
      ["listarTemplatesWhatsapp", () => c.listarTemplatesWhatsapp(ORG, "demo-canal"), true],
      ["removerCanal", () => c.removerCanal(ORG, "demo-canal-antigo", "Antigo"), true],
      ["buscarConversaPorTelefone", () => c.buscarConversaPorTelefone(ORG, "(43) 99999-0001", "demo-canal"), true],
      ["iniciarConversa", async () => { const r = await c.iniciarConversa(ORG, { canalId: "demo-canal", telefone: "43999990099", nome: "Visitante", texto: "Olá" }); if (r.ok) ctx.criada = r.valor.conversationId; return r; }, true],
      ["listarMensagens", () => c.listarMensagens(ORG, conversa), true],
      ["enviarTexto", () => c.enviarTexto(ORG, conversa, "Oi"), true],
      ["obterMidia", () => c.obterMidia(ORG, "demo-msg-qualquer"), false],
      ["atribuir", () => c.atribuir(ORG, conversa, { status: "OPEN" }), true],
      ["ligarIa", () => c.ligarIa(ORG, ctx.criada), true],
      ["desligarIa", () => c.desligarIa(ORG, ctx.criada), true],
      ["encerrar", () => c.encerrar(ORG, ctx.criada), true],
      ["listarModelosDePrimeiroContato", () => c.listarModelosDePrimeiroContato(ORG), true],
      ["criarAgente", async () => { const r = await c.criarAgente(ORG, { name: "Agente", kind: "WORKER", systemPrompt: "x", modelId: "openai/gpt-4o-mini" }); ctx.agente = idDe(r); return r; }, true],
      ["listarAgentes", () => c.listarAgentes(ORG), true],
      ["obterAgente", () => c.obterAgente(ORG, ctx.agente), true],
      ["atualizarAgente", () => c.atualizarAgente(ORG, ctx.agente, { isActive: true }), true],
      ["ligarAgenteAoCanal", () => c.ligarAgenteAoCanal(ORG, ctx.agente, "demo-canal", "DISABLED"), true],
      ["desligarAgenteDoCanal", () => c.desligarAgenteDoCanal(ORG, ctx.agente, "demo-canal"), true],
      ["prepararPrimeiroContato", () => c.prepararPrimeiroContato(ORG, ctx.agente, { nomeCliente: "Maria", nomeProvedor: "Rede Demo" }), true],
      ["planejarAutonomia", () => c.planejarAutonomia(ORG, ctx.agente, { requestId: "r1", operation: "cobranca", context: "{}", history: [], allowedActions: ["responder"] }), false],
      ["criarTool", async () => { const r = await c.criarTool(ORG, { nome: "consulta", descricao: "d", httpBaseUrl: "https://demo.invalid", httpHeaders: {} }); ctx.tool = idDe(r); return r; }, true],
      ["listarTools", () => c.listarTools(ORG), true],
      ["atualizarTool", () => c.atualizarTool(ORG, ctx.tool, { isActive: false }), true],
      ["criarSkill", async () => { const r = await c.criarSkill(ORG, { nome: "consultarCaso", descricao: "d", toolId: ctx.tool, parameters: {}, httpMethod: "GET", httpPath: "/caso" }); ctx.skill = idDe(r); return r; }, true],
      ["listarSkills", () => c.listarSkills(ORG), true],
      ["atualizarSkill", () => c.atualizarSkill(ORG, ctx.skill, { isActive: false }), true],
      ["versoesDaSkill", () => c.versoesDaSkill(ORG, ctx.skill), true],
      ["ligarSkillsAoAgente", () => c.ligarSkillsAoAgente(ORG, ctx.agente, [ctx.skill]), true],
      ["listarSkillsDoAgente", () => c.listarSkillsDoAgente(ORG, ctx.agente), true],
      ["definirAprovacaoDaSkill", () => c.definirAprovacaoDaSkill(ORG, ctx.agente, ctx.skill, true), true],
      ["listarExecucoes", () => c.listarExecucoes(ORG, { limit: 10 }), true],
      ["estatisticasDaOrganizacao", () => c.estatisticasDaOrganizacao(ORG, "7d"), true],
      ["criarAutomacao", () => c.criarAutomacao(ORG, { nome: "retorno", trigger: "MESSAGE_RECEIVED", actions: [] }), true],
      ["listarAutomacoes", () => c.listarAutomacoes(ORG), true],
      ["apagarSkill", () => c.apagarSkill(ORG, ctx.skill), true],
      ["apagarTool", () => c.apagarTool(ORG, ctx.tool), true],
      ["apagarAgente", () => c.apagarAgente(ORG, ctx.agente), true],
    ];

    const publicos = Object.getOwnPropertyNames(ChatBullqClient.prototype).filter((n) => !PRIVADOS.has(n)).sort();
    expect(roteiro.map(([nome]) => nome).sort(), "método novo no cliente precisa entrar neste roteiro").toEqual(publicos);

    for (const [nome, chamar, esperaOk] of roteiro) {
      const r = await chamar();
      expect(r.ok, `${nome}: ${JSON.stringify(r)}`).toBe(esperaOk);
      if (!r.ok) expect(r.status, nome).toBeGreaterThanOrEqual(400);
    }
    expect(espiao).not.toHaveBeenCalled();
  });

  it("rota desconhecida é recusa local (404 JSON), não rede", async () => {
    const r = await (novoCliente() as any).operacao(ORG, "GET", "/rota-que-o-fork-nao-tem");
    expect(r).toMatchObject({ ok: false, status: 404 });
    const direto = await fetchDoChatSimulado(`${URL_DO_CHAT_SIMULADO}/api/v1/nada`, { method: "DELETE" });
    expect(direto.status).toBe(404);
    expect(await direto.json()).toHaveProperty("message");
    expect(espiao).not.toHaveBeenCalled();
  });
});

describe("histórico determinístico das conversas semeadas", () => {
  it("toda cena: menos de 40 mensagens, só INBOUND/OUTBOUND, em ordem, dentro da vida da conversa e com a janela de 24 h respeitada", async () => {
    const c = novoCliente();
    for (const [cena, s] of Object.entries(semeadas)) {
      if (s.providerId === 7) continue;
      const msgs = await mensagensDe(c, s.conversationId);
      const instantes = msgs.map((m) => Date.parse(m.createdAt));
      expect(msgs.length, cena).toBeGreaterThan(0);
      expect(msgs.length, cena).toBeLessThan(40);
      expect(msgs.every((m) => m.direction === "INBOUND" || m.direction === "OUTBOUND"), cena).toBe(true);
      expect(msgs.every((m) => ["SENT", "DELIVERED", "READ"].includes(m.status)), cena).toBe(true);
      expect(msgs.every((m) => m.direction === "INBOUND" || !!m.senderName), cena).toBe(true);
      expect(instantes, cena).toEqual([...instantes].sort((a, b) => a - b));
      expect(instantes[0], cena).toBeGreaterThanOrEqual(s.abertaEm);
      expect(Math.max(...instantes), cena).toBeLessThanOrEqual(agora);

      const ultimaDoCliente = instantes.filter((_, i) => msgs[i].direction === "INBOUND").at(-1);
      if (s.status === "BOT") {
        // O robô só mandou a abertura: ninguém respondeu e nenhum atendente entrou.
        expect(msgs.every((m) => m.direction === "OUTBOUND" && m.senderName === "Assistente virtual"), cena).toBe(true);
      } else if (["OPEN", "PENDING"].includes(s.status)) {
        expect(msgs.at(-1)!.direction, cena).toBe("INBOUND");
        expect(agora - ultimaDoCliente!, cena).toBeLessThan(24 * HORA);
      } else {
        expect(msgs.at(-1)!.direction, cena).toBe("OUTBOUND");
        if (ultimaDoCliente !== undefined) expect(agora - ultimaDoCliente, cena).toBeGreaterThan(24 * HORA);
      }
      // Linha semeada coerente (a ativa ainda dentro de 24 h, ou a parada): nada passa do último evento.
      if (s.status !== "PENDING") expect(Math.max(...instantes), cena).toBeLessThanOrEqual(s.ultimoEventoEm);
    }
  });

  it("o texto é da cena: nome, valor, equipamento, encerramento; e a abertura só cumprimenta e identifica o provedor", async () => {
    const c = novoCliente();
    const lembrete = await mensagensDe(c, semeadas.lembrete.conversationId);
    expect(lembrete[0].content.text).toMatch(/^Olá, Maria! Sou o assistente virtual da Rede Demo\./);
    expect(lembrete[0].content.text).not.toMatch(/R\$|\d/);
    expect(lembrete.map((m) => m.content.text).join(" ")).toMatch(/189,90/);
    expect(lembrete.find((m) => m.senderName === "Ana Atendente")).toBeTruthy();

    const retirada = (await mensagensDe(c, semeadas.retirada.conversationId)).map((m) => m.content.text).join(" ");
    expect(retirada).toMatch(/Huawei EG8145/);
    expect(retirada).toMatch(/Agendado/);

    expect((await mensagensDe(c, semeadas.exCliente.conversationId))[0].content.text).toMatch(/contrato que você teve/);
    expect((await mensagensDe(c, semeadas.encerrada.conversationId)).at(-1)!.content.text).toMatch(/encerrar/);
    expect(await mensagensDe(c, semeadas.semResposta.conversationId)).toHaveLength(1);
  });

  it("duas leituras devolvem a mesma história, e mudar o status no banco não a reescreve", async () => {
    const c = novoCliente();
    const primeira = await mensagensDe(c, semeadas.lembrete.conversationId);
    banco.conversas[0]["chat_bullq_conversas.status"] = "CLOSED";
    expect(await mensagensDe(c, semeadas.lembrete.conversationId)).toEqual(primeira);
  });

  it("a busca por telefone acha a conversa semeada daquele cliente", async () => {
    const r = await novoCliente().buscarConversaPorTelefone(ORG, "43999990001", "demo-canal");
    expect(r).toMatchObject({ ok: true, valor: { id: semeadas.lembrete.conversationId, status: "OPEN", channel: { id: "demo-canal" } } });
  });
});

describe("o que o visitante faz", () => {
  it("enviarTexto entra no histórico seguinte, depois do roteiro", async () => {
    const c = novoCliente();
    const antes = await mensagensDe(c, semeadas.lembrete.conversationId);
    const r = await c.enviarTexto(ORG, semeadas.lembrete.conversationId, "Segue o PIX da demonstração");
    expect(r).toMatchObject({ ok: true, valor: { status: "SENT" } });
    const depois = await mensagensDe(c, semeadas.lembrete.conversationId);
    expect(depois.slice(0, antes.length)).toEqual(antes);
    expect(depois.at(-1)).toMatchObject({ id: r.ok ? r.valor.messageId : "", direction: "OUTBOUND", content: { text: "Segue o PIX da demonstração" } });
  });

  it("iniciarConversa cria o id do provedor, guarda a abertura e a conversa passa a ser achada pelo telefone", async () => {
    const c = novoCliente();
    const r = await c.iniciarConversa(ORG, { canalId: "demo-canal", telefone: "(43) 98888-7777", nome: "Visitante", texto: "Olá, Visitante!" });
    const id = r.ok ? r.valor.conversationId : "";
    expect(id).toMatch(/^demo-conv-6-n[0-9a-z]+$/);
    expect(await mensagensDe(c, id)).toMatchObject([{ direction: "OUTBOUND", content: { text: "Olá, Visitante!" } }]);
    expect(await c.buscarConversaPorTelefone(ORG, "43988887777")).toMatchObject({ ok: true, valor: { id, status: "WAITING" } });
    expect(await c.encerrar(ORG, id)).toMatchObject({ ok: true });
    expect(await c.buscarConversaPorTelefone(ORG, "43988887777")).toMatchObject({ ok: true, valor: { status: "CLOSED" } });
  });

  it("o rascunho de primeiro contato devolve o agente e o modelo que o visitante criou", async () => {
    const c = novoCliente();
    const agente = await c.criarAgente(ORG, { name: "Cobrança", kind: "WORKER", systemPrompt: "x", modelId: "openai/gpt-4.1-mini" });
    const id = agente.ok ? agente.valor.id : "";
    expect(await c.listarAgentes(ORG)).toMatchObject({ ok: true, valor: [{ id, name: "Cobrança" }] });
    const r = await c.prepararPrimeiroContato(ORG, id, { nomeCliente: "Maria", nomeProvedor: "Rede Demo" });
    expect(r).toMatchObject({ ok: true, valor: { agenteId: id, modelo: "openai/gpt-4.1-mini", texto: "Olá, Maria! Sou o assistente virtual da Rede Demo. Podemos conversar por aqui?" } });
  });

  it("limparChatSimuladoDoProvedor esvazia só aquele provedor", async () => {
    const c = novoCliente();
    await c.enviarTexto(ORG, semeadas.lembrete.conversationId, "vai sumir");
    const doSeis = await c.iniciarConversa(ORG, { canalId: "demo-canal", telefone: "43977776666", texto: "Olá" });
    const doSete = await c.iniciarConversa("demo-org-7", { canalId: "demo-canal", telefone: "43966665555", texto: "Olá" });

    limparChatSimuladoDoProvedor(6);

    expect((await mensagensDe(c, semeadas.lembrete.conversationId)).some((m) => m.content.text === "vai sumir")).toBe(false);
    expect(await c.listarMensagens(ORG, doSeis.ok ? doSeis.valor.conversationId : "")).toMatchObject({ ok: false, status: 404 });
    expect(await c.listarMensagens("demo-org-7", doSete.ok ? doSete.valor.conversationId : "")).toMatchObject({ ok: true });
  });
});

describe("isolamento entre sandboxes", () => {
  it("um provedor não lê nem escreve na conversa de outro", async () => {
    const c = novoCliente();
    expect(await c.listarMensagens("demo-org-7", semeadas.lembrete.conversationId)).toMatchObject({ ok: false, status: 404 });
    expect(await c.enviarTexto("demo-org-7", semeadas.lembrete.conversationId, "x")).toMatchObject({ ok: false, status: 404 });
    const busca = await c.buscarConversaPorTelefone(ORG, "43999990001");
    expect(busca).toMatchObject({ ok: true, valor: { id: semeadas.lembrete.conversationId } });
    expect(await c.listarMensagens(ORG, semeadas.deOutroProvedor.conversationId)).toMatchObject({ ok: false, status: 404 });
    expect(espiao).not.toHaveBeenCalled();
  });
});

/**
 * A cena segue o STATUS do caso e da recuperação, não só o status da conversa.
 * Antes, toda conversa encerrada virava "já paguei… pagamento localizado" (em
 * caso com dívida viva), a encerrada de equipamento dizia "recebemos o
 * equipamento" numa recuperação CONTESTADA, o robô conversava como atendente
 * humano, e negativado e atraso de 150 dias recebiam o lembrete de
 * "esquecimento".
 */
describe("a cena conta a mesma história que o caso e a recuperação", () => {
  const textoDe = async (s: Semeada) => {
    const x = semear(s, agora);
    const msgs = await mensagensDe(novoCliente(), x.conversationId);
    return { msgs, texto: msgs.map((m) => m.content.text).join(" | ") };
  };

  it("acordo ativo encerrado: acordo registrado e encerramento, nunca 'já paguei'", async () => {
    const { msgs, texto } = await textoDe({ seq: 20, status: "CLOSED", abertaHaHoras: 240, ultimoHaHoras: 144, caso: { status: "acordo_ativo", carteira: "ativo", valor: "149.90", dias: 120 } });
    expect(texto).not.toMatch(/paguei|Pagamento localizado/);
    expect(texto).toMatch(/Acordo registrado/);
    expect(msgs.at(-1)!.content.text).toMatch(/encerrar/);
  });

  it("ex-cliente negativado encerrado: abertura de ex-cliente, recusa registrada, nada de pagamento", async () => {
    const { msgs, texto } = await textoDe({ seq: 21, status: "CLOSED", abertaHaHoras: 240, ultimoHaHoras: 144, caso: { status: "negativado", carteira: "ex_cliente", valor: "629.95", dias: 90 } });
    expect(msgs[0].content.text).toMatch(/contrato que você teve/);
    expect(texto).toMatch(/fatura de saída/);
    expect(texto).toMatch(/registrei a sua posição/);
    expect(texto).not.toMatch(/paguei|Pagamento localizado|PIX/);
  });

  it("ativo negativado: registro nos órgãos de proteção ao crédito e cliente resistente — nunca o lembrete de esquecimento", async () => {
    const { texto } = await textoDe({ seq: 22, status: "WAITING", abertaHaHoras: 120, ultimoHaHoras: 48, caso: { status: "negativado", carteira: "ativo", valor: "119.90", dias: 300 } });
    expect(texto).toMatch(/proteção ao crédito/);
    expect(texto).toMatch(/não vou pagar/);
    expect(texto).not.toMatch(/esquecimento|PIX/);
  });

  it("sem caso, o tom sai da etapa da régua: 150 dias é negociação, 10 dias é lembrete", async () => {
    const longo = await textoDe({ seq: 23, status: "WAITING", abertaHaHoras: 120, ultimoHaHoras: 48, cliente: { valor: "99.90", dias: 150 } });
    expect(longo.texto).toMatch(/150 dias/);
    expect(longo.texto).not.toMatch(/esquecimento/);
    const lembrete = await textoDe({ seq: 24, status: "OPEN", abertaHaHoras: 30, ultimoHaHoras: 2, cliente: { valor: "99.90", dias: 10 } });
    expect(lembrete.texto).toMatch(/esquecimento/);
  });

  it("conversa do robô: só a abertura automática, sem resposta do cliente e sem atendente humano", async () => {
    const { msgs } = await textoDe({ seq: 25, status: "BOT", abertaHaHoras: 10, ultimoHaHoras: 9, caso: { status: "em_contato", carteira: "ex_cliente", valor: "689.95", dias: 60 } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: "OUTBOUND", senderName: "Assistente virtual" });
    expect(msgs[0].content.text).not.toMatch(/R\$|\d/);
  });

  it("equipamento contestado e encerrado: confere o registro da devolução, nunca 'recebemos o equipamento'", async () => {
    const { msgs, texto } = await textoDe({ seq: 26, status: "CLOSED", origem: "equipamentos", abertaHaHoras: 240, ultimoHaHoras: 144, recuperacao: { status: "contestado" } });
    expect(texto).toMatch(/já devolvi/);
    expect(texto).toMatch(/conferir o registro da devolução/);
    expect(texto).not.toMatch(/Recebemos o equipamento|Pode vir buscar/);
    expect(msgs.at(-1)!.content.text).toMatch(/encerrar/);
  });

  it("'pagamento localizado' só existe onde o caso está pago", async () => {
    const { texto } = await textoDe({ seq: 27, status: "CLOSED", abertaHaHoras: 240, ultimoHaHoras: 144, caso: { status: "pago", carteira: "ativo", valor: "99.90", dias: 20 } });
    expect(texto).toMatch(/Pagamento localizado/);
  });
});

describe("conversa criada pelo visitante e o reinício da API", () => {
  it("o id não se repete depois de um reinício, a conversa antiga não ganha roteiro inventado e a lista não sai em dobro", async () => {
    const c = novoCliente();
    const a = await c.iniciarConversa(ORG, { canalId: "demo-canal", telefone: "43911112222", nome: "Cliente A", texto: "Olá, A!" });
    const idA = a.ok ? a.valor.conversationId : "";
    // A ponte registra toda conversa nova em chat_bullq_conversas: a linha fica no banco.
    semear({ seq: 900, status: "WAITING", abertaHaHoras: 1, ultimoHaHoras: 1 }, agora);
    Object.assign(banco.conversas.at(-1)!, { "chat_bullq_conversas.conversation_id": idA, "customers.phone": "(43) 91111-2222", "customers.name": "Cliente A" });

    const lista = await fetchDoChatSimulado(`${URL_DO_CHAT_SIMULADO}/api/v1/conversations`, { headers: { "x-organization-id": ORG } });
    const ids = ((await lista.json()) as { conversations: { id: string }[] }).conversations.map((x) => x.id);
    expect(ids.filter((id) => id === idA)).toHaveLength(1);

    // Reinício: módulo carregado de novo, memória vazia, banco com a linha de A.
    vi.resetModules();
    const novo = await import("./chat-simulado");
    const { ChatBullqClient: ClienteNovo } = await import("../services/chat/chat-bullq.client");
    const depois = new ClienteNovo({ baseUrl: novo.URL_DO_CHAT_SIMULADO, platformKey: "demo", fetchImpl: novo.fetchDoChatSimulado });
    const b = await depois.iniciarConversa(ORG, { canalId: "demo-canal", telefone: "43933334444", nome: "Cliente B", texto: "Olá, B!" });
    const idB = b.ok ? b.valor.conversationId : "";
    expect(idB).toMatch(/^demo-conv-6-n/);
    expect(idB).not.toBe(idA);

    expect(await depois.listarMensagens(ORG, idA, { page: 1, limit: 40 })).toEqual({ ok: true, valor: [] });
    expect(espiao).not.toHaveBeenCalled();
  });
});

describe("a memória do visitante no processo da API", () => {
  it("a varredura descarta o estado das organizações cujo provedor sumiu do banco, e só delas", async () => {
    const c = novoCliente();
    const seis = await c.iniciarConversa(ORG, { canalId: "demo-canal", telefone: "43955556666", texto: "Olá" });
    const sete = await c.iniciarConversa("demo-org-7", { canalId: "demo-canal", telefone: "43977778888", texto: "Olá" });
    banco.provedores = [{ "providers.id": 7 }];

    expect(await varrerOrganizacoesSemProvedor()).toBe(1);

    expect(await c.listarMensagens(ORG, seis.ok ? seis.valor.conversationId : "")).toMatchObject({ ok: false, status: 404 });
    expect(await c.listarMensagens("demo-org-7", sete.ok ? sete.valor.conversationId : "")).toMatchObject({ ok: true });
  });

  it("a varredura liga sozinha no primeiro uso, sem depender do worker: passado o intervalo, o sandbox apagado some", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      vi.resetModules();
      const novo = await import("./chat-simulado");
      const { ChatBullqClient: ClienteNovo } = await import("../services/chat/chat-bullq.client");
      const c = new ClienteNovo({ baseUrl: novo.URL_DO_CHAT_SIMULADO, platformKey: "demo", fetchImpl: novo.fetchDoChatSimulado });
      const r = await c.iniciarConversa(ORG, { canalId: "demo-canal", telefone: "43912121212", texto: "Olá" });
      const id = r.ok ? r.valor.conversationId : "";
      expect(await c.listarMensagens(ORG, id)).toMatchObject({ ok: true });

      banco.provedores = [];
      await vi.advanceTimersByTimeAsync(novo.INTERVALO_DA_VARREDURA_MS);

      expect(await c.listarMensagens(ORG, id)).toMatchObject({ ok: false, status: 404 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("conversas novas e itens do catálogo param no teto, com recusa local", async () => {
    const c = novoCliente();
    for (let i = 0; i < MAXIMO_DE_CONVERSAS_CRIADAS; i++) {
      const r = await c.iniciarConversa(ORG, { canalId: "demo-canal", telefone: `439${String(i).padStart(8, "0")}`, texto: "Olá" });
      expect(r.ok, `conversa ${i}`).toBe(true);
    }
    expect(await c.iniciarConversa(ORG, { canalId: "demo-canal", telefone: "43999998888", texto: "Olá" })).toMatchObject({ ok: false, status: 429 });

    const tool = (nome: string) => c.criarTool(ORG, { nome, descricao: "d", httpBaseUrl: "https://demo.invalid", httpHeaders: {} });
    for (let i = 0; i < MAXIMO_DE_REGISTROS_POR_COLECAO; i++) expect((await tool(`t${i}`)).ok, `tool ${i}`).toBe(true);
    expect(await tool("sobra")).toMatchObject({ ok: false, status: 429 });
    expect(espiao).not.toHaveBeenCalled();
  });
});
