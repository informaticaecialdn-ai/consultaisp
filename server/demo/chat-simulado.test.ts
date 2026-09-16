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
  /** O `agenteConfig` da integração do sandbox, como a semeadura grava. */
  agenteConfig: null as unknown,
  db: null as any,
}));

vi.mock("../db", () => ({
  db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }),
  pool: {},
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// A ponte, o serviço de agentes e o console rodam DE VERDADE contra o simulado:
// demonstração ligada, a integração do sandbox lida daqui e a trava do chat
// sem Postgres (é advisory lock, e o banco aqui é de mentira).
vi.mock("./modo-demo", () => ({ emModoDemo: () => true }));
vi.mock("../storage", () => ({
  storage: {
    getIntegracaoDoChat: async (providerId: number) => ({ providerId, organizationId: `demo-org-${providerId}`, agenteId: null, agenteConfig: banco.agenteConfig }),
    getProvider: async (id: number) => ({ id, name: "Rede Demonstração Ltda", tradeName: "Rede Demo" }),
    guardarAgenteDoChat: async () => undefined,
  },
}));
vi.mock("../services/chat/chat-trava", () => ({ comTravaDoChat: async (_chave: string, executar: () => Promise<unknown>) => executar() }));

import { drizzle } from "drizzle-orm/pg-proxy";
import { janelaDoChat, lerAutomacaoChat } from "@shared/cobranca/automacao-chat";
import { POLITICA_PADRAO } from "@shared/cobranca/politica";
import { TIPOS_DE_AGENTE } from "@shared/chat-agentes";
import { ChatBullqClient, type Mensagem, type Resultado } from "../services/chat/chat-bullq.client";
import { exigirAgentesProntos, listarAgentesDoChat, prepararPrimeiroContatoDoAgente } from "../services/chat/chat-agentes.service";
import { listarAgentesDoConsole, listarExecucoesDoConsole, listarSkillsDoConsole, listarToolsDoConsole, resumoDoConsole } from "../services/chat/chat-console.service";
import {
  AGENTES_DA_DEMO, agenteConfigDaDemo, fetchDoChatSimulado, limparChatSimuladoDoProvedor, MAXIMO_DE_CONVERSAS_CRIADAS, MAXIMO_DE_REGISTROS_POR_COLECAO,
  MODELO_DOS_AGENTES_DA_DEMO, roteiroDaConversa, URL_DO_CHAT_SIMULADO, varrerOrganizacoesSemProvedor, type LinhaDaConversa,
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
/**
 * Quarta-feira, 15h em São Paulo. Com a janela de contato no roteiro, o relógio
 * real deixava a suíte depender da hora em que roda: às 3h da manhã uma
 * conversa aberta há 3 h não tem instante permitido entre a abertura e agora.
 */
const AGORA_FIXO = Date.parse("2026-09-16T18:00:00.000Z");
/** Timestamp sem fuso, como o driver do Postgres devolve (o Drizzle acrescenta +0000). */
const driver = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, -1);

const horaEmSp = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" });
const semanaEmSp = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" });
const horaEmSaoPaulo = (iso: string) => Number(horaEmSp.format(new Date(iso)));
const diaDaSemanaEmSaoPaulo = (iso: string) => semanaEmSp.format(new Date(iso));
const janelaPorHora = new Map<number, boolean>();
/** A regra que o worker aplica ao primeiro contato: `janelaDoChat` com a janela padrão da política (memorizada por hora). */
function podeFalar(iso: string): boolean {
  const h = Math.floor(Date.parse(iso) / HORA);
  if (!janelaPorHora.has(h)) janelaPorHora.set(h, janelaDoChat(new Date(h * HORA), POLITICA_PADRAO.janelaContato).permitida);
  return janelaPorHora.get(h)!;
}

/** Uma linha de conversa semeada, para chamar `roteiroDaConversa` sem banco. */
function linhaDeConversa(parcial: Partial<LinhaDaConversa>): LinhaDaConversa {
  return {
    conversationId: "demo-conv-6-1", status: "OPEN", origem: "cobranca", canalId: "demo-canal", abertaEm: new Date(AGORA_FIXO - 72 * HORA), ultimoEventoEm: null,
    clienteNome: "Maria Fictícia", clienteTelefone: "(43) 99999-0001", clienteDivida: "189.90", clienteDias: 12,
    provedorNome: "Rede Demonstração Ltda", provedorFantasia: "Rede Demo", semeadaEm: null, atendenteNome: "Ana Atendente",
    casoStatus: null, casoCarteira: null, casoValor: null, casoDias: null, recuperacaoStatus: null, recuperacaoAgendadaEm: null,
    equipamentoTipo: null, equipamentoMarca: null, equipamentoModelo: null,
    ...parcial,
  };
}

/** O que vale para TODO roteiro: tamanho, ordem, nada no futuro, a janela nas falas do provedor e as regras de 24 h do status. */
function conferirRoteiro(msgs: Mensagem[], status: string, agoraDoCaso: number, rotulo: string) {
  const instantes = msgs.map((m) => Date.parse(m.createdAt));
  expect(msgs.length, rotulo).toBeGreaterThan(0);
  expect(msgs.length, rotulo).toBeLessThan(40);
  expect(instantes, rotulo).toEqual([...instantes].sort((a, b) => a - b));
  expect(Math.max(...instantes), rotulo).toBeLessThanOrEqual(agoraDoCaso);
  for (const m of msgs.filter((x) => x.direction === "OUTBOUND")) {
    const onde = `${rotulo} · ${m.senderName} ${m.createdAt}`;
    expect(horaEmSaoPaulo(m.createdAt), onde).toBeGreaterThanOrEqual(8);
    expect(horaEmSaoPaulo(m.createdAt), onde).toBeLessThan(20);
    expect(diaDaSemanaEmSaoPaulo(m.createdAt), onde).not.toBe("Sun");
    expect(podeFalar(m.createdAt), onde).toBe(true);
  }
  const ultimaDoCliente = instantes.filter((_, i) => msgs[i].direction === "INBOUND").at(-1);
  if (status === "BOT") {
    expect(msgs.every((m) => m.direction === "OUTBOUND"), rotulo).toBe(true);
  } else if (status === "OPEN" || status === "PENDING") {
    expect(msgs.at(-1)!.direction, rotulo).toBe("INBOUND");
    expect(agoraDoCaso - ultimaDoCliente!, rotulo).toBeLessThan(24 * HORA);
  } else {
    expect(msgs.at(-1)!.direction, rotulo).toBe("OUTBOUND");
    if (ultimaDoCliente !== undefined) expect(agoraDoCaso - ultimaDoCliente, rotulo).toBeGreaterThan(24 * HORA);
  }
}

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
    // A semeadura grava o provedor com o mesmo `agora` das conversas.
    "providers.created_at": driver(agora),
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
  vi.useFakeTimers({ toFake: ["Date"], now: AGORA_FIXO });
  agora = Date.now();
  banco.agenteConfig = agenteConfigDaDemo();
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
afterEach(() => { espiao.mockRestore(); vi.useRealTimers(); });

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
      ["criarCanalWhatsapp", () => c.criarCanalWhatsapp(ORG, { provider: "DATAFY", nome: "Oficial", token: "token-ficticio", phoneNumberId: "123456789", webhookSecret: "whsec_ficticio" }), true],
      // O WhatsApp da plataforma (Evolution): o canal único do simulado serve a ele também — sem token, como no fork.
      ["criarCanalEvolution", () => c.criarCanalEvolution(ORG, { nome: "WhatsApp da plataforma" }), true],
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
      expect(msgs.filter((m) => m.direction === "OUTBOUND").every((m) => podeFalar(m.createdAt)), cena).toBe(true);

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

  it("o roteiro é o do instante da semeadura: lido 20 h depois, ou depois de um reinício da API, as falas da equipe não andam", async () => {
    // Revisão da fase B (13/09/2026): o roteiro congelava no Date.now() da
    // primeira leitura. A semeadura grava o contato no instante da última fala
    // da equipe calculado com o `agora` da criação; aberta 20 h depois, a
    // conversa pendente mostrava a equipe numa hora que a linha do tempo do
    // caso não tem.
    const naSemeadura = await mensagensDe(novoCliente(), semeadas.exCliente.conversationId);
    expect(naSemeadura).toEqual(roteiroDaConversa(linhaDeConversa({
      conversationId: semeadas.exCliente.conversationId, status: "PENDING", abertaEm: new Date(semeadas.exCliente.abertaEm), ultimoEventoEm: new Date(semeadas.exCliente.ultimoEventoEm),
      clienteNome: "Maria Fictícia 3", clienteTelefone: "(43) 99999-0003", clienteDivida: "240.00", clienteDias: 150,
      casoStatus: "negativado", casoCarteira: "ex_cliente", casoValor: "240.00", casoDias: 150,
    }), agora));

    limparChatSimuladoDoProvedor(6); // o Map da memória zera, como num reinício
    vi.setSystemTime(agora + 20 * HORA);
    // O cenário importa: calculado com o relógio da leitura, o roteiro desta conversa mudaria.
    const comORelogioDaLeitura = roteiroDaConversa(linhaDeConversa({
      conversationId: semeadas.exCliente.conversationId, status: "PENDING", abertaEm: new Date(semeadas.exCliente.abertaEm), ultimoEventoEm: new Date(semeadas.exCliente.ultimoEventoEm),
      clienteNome: "Maria Fictícia 3", clienteTelefone: "(43) 99999-0003", clienteDivida: "240.00", clienteDias: 150,
      casoStatus: "negativado", casoCarteira: "ex_cliente", casoValor: "240.00", casoDias: 150,
    }), Date.now());
    expect(comORelogioDaLeitura).not.toEqual(naSemeadura);
    expect(await mensagensDe(novoCliente(), semeadas.exCliente.conversationId)).toEqual(naSemeadura);
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
    const lista = await c.listarAgentes(ORG);
    // Os três perfis semeados continuam na lista; o do visitante entra ao lado deles.
    expect(lista.ok && lista.valor.filter((a) => a.id === id)).toMatchObject([{ id, name: "Cobrança" }]);
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

  it("nova tentativa de retirada: a equipe cita a visita sem ninguém em casa e propõe novo horário, em todo status", async () => {
    const nova = (seq: number, status: string, ultimoHaHoras: number) => textoDe({ seq, status, origem: "equipamentos", abertaHaHoras: 240, ultimoHaHoras, recuperacao: { status: "nova_tentativa" } });
    const parada = await nova(28, "WAITING", 48);
    expect(parada.texto).toMatch(/não encontrou ninguém/);
    expect(parada.msgs.at(-1)!.content.text).toMatch(/nova tentativa/);
    expect(parada.texto).not.toMatch(/Agendado:/);
    // A ativa termina no cliente: a visita frustrada tem de vir ANTES da última fala dele.
    const ativa = await nova(29, "OPEN", 2);
    expect(ativa.texto).toMatch(/não encontrou ninguém/);
    expect(ativa.msgs.at(-1)!.direction).toBe("INBOUND");
    const encerrada = await nova(30, "CLOSED", 144);
    expect(encerrada.texto).toMatch(/não encontrou ninguém/);
    expect(encerrada.msgs.at(-1)!.content.text).toMatch(/encerrar/);
  });
});

/**
 * A janela de contato nas falas do provedor. A auditoria achou a equipe
 * escrevendo às 00:21 e às 04:21 e a abertura do assistente às 20:21: o
 * roteiro só repartia o tempo entre a abertura e o último evento, e a tela do
 * atendimento mostra a janela da política logo abaixo da conversa. O cliente
 * escreve quando quer; quem fala pelo provedor, não.
 */
describe("a equipe e o assistente só falam dentro da janela de contato", () => {
  // Quarta 15h, sábado 22h, domingo 3h e 12h, segunda 0h21 e 7h30, o feriado de 07/09 e a madrugada seguinte (São Paulo).
  const AGORAS = ["2026-09-16T18:00:00Z", "2026-09-20T01:00:00Z", "2026-09-20T06:00:00Z", "2026-09-20T15:00:00Z", "2026-09-21T03:21:00Z", "2026-09-21T10:30:00Z", "2026-09-07T13:00:00Z", "2026-09-08T09:00:00Z"].map(Date.parse);
  // [aberta há, último evento há] em horas: as idades que a semeadura grava por status (com o desvio por posição), uma ativa envelhecida e uma parada recente.
  const IDADES: Record<string, Array<[number, number]>> = {
    OPEN: [[72, 2], [72.8, 2.8], [80, 30]],
    PENDING: [[48, 6], [49.5, 7.5], [120, 40]],
    BOT: [[10, 9], [11.2, 10.2], [3, 3]],
    WAITING: [[120, 48], [121.4, 49.4], [3, 3]],
    CLOSED: [[240, 144], [241.6, 145.6], [30, 26]],
  };
  const CENAS: Array<Partial<LinhaDaConversa>> = [
    { clienteDias: 10 },
    { clienteDias: 150, clienteDivida: "99.90" },
    { casoStatus: "em_contato", casoCarteira: "ativo", casoValor: "120.00", casoDias: 20 },
    { casoStatus: "em_contato", casoCarteira: "ex_cliente", casoValor: "689.95", casoDias: 60 },
    { casoStatus: "negociando", casoCarteira: "ativo", casoValor: "300.00", casoDias: 45 },
    { casoStatus: "acordo_ativo", casoCarteira: "ativo", casoValor: "149.90", casoDias: 120 },
    { casoStatus: "pago", casoCarteira: "ativo", casoValor: "99.90", casoDias: 20 },
    { casoStatus: "negativado", casoCarteira: "ex_cliente", casoValor: "629.95", casoDias: 90 },
    ...["pre_recuperacao", "agendado", "nova_tentativa", "notificacao_formal", "contestado", "concluido"].map((recuperacaoStatus) => (
      { origem: "equipamentos", recuperacaoStatus, equipamentoTipo: "onu", equipamentoMarca: "Huawei", equipamentoModelo: "EG8145" })),
  ];

  it("toda OUTBOUND semeada cai entre 8h e 20h de São Paulo, fora do domingo, com as regras de 24 h e menos de 40 mensagens", () => {
    let roteiros = 0;
    for (const agoraDoCaso of AGORAS) {
      for (const [status, idades] of Object.entries(IDADES)) {
        for (const [aberta, ultimo] of idades) {
          for (const [i, cena] of CENAS.entries()) {
            const linha = linhaDeConversa({ conversationId: `demo-conv-6-${i + 1}`, status, abertaEm: new Date(agoraDoCaso - aberta * HORA), ultimoEventoEm: new Date(agoraDoCaso - ultimo * HORA), ...cena });
            conferirRoteiro(roteiroDaConversa(linha, agoraDoCaso), status, agoraDoCaso, `${new Date(agoraDoCaso).toISOString()} ${status} ${aberta}/${ultimo} cena ${i}`);
            roteiros++;
          }
        }
      }
    }
    expect(roteiros).toBe(AGORAS.length * 15 * CENAS.length);
  });

  it("linha que cabe na janela não sai da vida da conversa: nada antes da abertura nem depois do último evento", () => {
    // A ex-cliente da auditoria (demo-conv-19-13): aberta às 20h21 de quarta, com a equipe escrevendo à 0h21 e às 4h21; agora é sábado, 18h21.
    const agoraDoCaso = Date.parse("2026-09-12T21:21:00Z");
    const linha = linhaDeConversa({ status: "WAITING", casoStatus: "em_contato", casoCarteira: "ex_cliente", casoValor: "664.95", casoDias: 60, abertaEm: new Date(Date.parse("2026-09-09T23:21:00Z")), ultimoEventoEm: new Date(Date.parse("2026-09-11T19:21:00Z")) });
    const msgs = roteiroDaConversa(linha, agoraDoCaso);
    conferirRoteiro(msgs, "WAITING", agoraDoCaso, "auditoria 19-13");
    expect(Date.parse(msgs[0].createdAt)).toBeGreaterThanOrEqual(linha.abertaEm.getTime());
    expect(Date.parse(msgs.at(-1)!.createdAt)).toBeLessThanOrEqual(linha.ultimoEventoEm!.getTime());
  });
});

/**
 * O console de agentes nascia vazio: as abas Agentes, Skills, Conexões,
 * Execuções e Visão geral mostravam nada, enquanto a fila do chat tinha
 * conversas "com agente" e falas do "Assistente virtual".
 */
describe("o catálogo da organização nasce pronto", () => {
  it("org nova: três agentes ligados ao canal, as skills, a conexão e a automação ligada, sem nenhuma escrita antes — e duas leituras iguais", async () => {
    const c = novoCliente();
    const ler = async () => ({
      agentes: await listarAgentesDoConsole(6), skills: await listarSkillsDoConsole(6), tools: await listarToolsDoConsole(6),
      automacoes: await c.listarAutomacoes(ORG), versoes: await c.versoesDaSkill(ORG, "demo-skill-consultarCaso"),
      doAgente: await c.listarSkillsDoAgente(ORG, AGENTES_DA_DEMO.recuperacao_equipamentos.id),
    });
    const primeira = await ler();
    expect(await ler()).toEqual(primeira);

    const { agentes } = primeira.agentes;
    expect(agentes.map((a) => a.id).sort()).toEqual(TIPOS_DE_AGENTE.map((t) => AGENTES_DA_DEMO[t].id).sort());
    for (const a of agentes) {
      expect(a, a.id).toMatchObject({ modelo: MODELO_DOS_AGENTES_DA_DEMO, daPonte: true, canais: [{ canalId: "demo-canal" }] });
      expect(a.instrucoes.length, a.id).toBeGreaterThan(10);
    }
    const { skills } = primeira.skills;
    expect(skills.map((s) => s.nome).sort()).toEqual(["consultarCaso", "registrarPromessa", "registrarTransferencia"]);
    expect(skills.every((s) => s.daPonte && s.agentes.length > 0 && s.toolNome && s.versao === 1)).toBe(true);
    expect(primeira.versoes).toMatchObject({ ok: true, valor: [{ version: 1, name: "consultarCaso" }] });
    expect(primeira.doAgente.ok && primeira.doAgente.valor.length).toBeGreaterThan(0);

    const { tools } = primeira.tools;
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) expect(new URL(t.baseUrl!).hostname, t.id).toMatch(/(^|\.)consultaisp\.com\.br$/);
    expect(tools.reduce((n, t) => n + t.skills, 0)).toBe(skills.length);

    expect(primeira.automacoes).toMatchObject({ ok: true, valor: [{ trigger: "MESSAGE_RECEIVED", enabled: true }] });
    expect(espiao).not.toHaveBeenCalled();
  });

  it("limparChatSimuladoDoProvedor apaga também o catálogo semeado, e ele renasce igual", async () => {
    const c = novoCliente();
    const catalogo = async () => [await listarAgentesDoConsole(6), await listarSkillsDoConsole(6), await listarToolsDoConsole(6), await c.listarAutomacoes(ORG)];
    const antes = await catalogo();
    expect(await c.criarTool(ORG, { nome: "do visitante", descricao: "d", httpBaseUrl: "https://demo.invalid", httpHeaders: {} })).toMatchObject({ ok: true });
    expect(await c.apagarAgente(ORG, AGENTES_DA_DEMO.cobranca_ativos.id)).toMatchObject({ ok: true });
    expect(await catalogo()).not.toEqual(antes);

    limparChatSimuladoDoProvedor(6);

    expect(await catalogo()).toEqual(antes);
  });
});

describe("o contrato de agentes que a semeadura grava na integração", () => {
  it("lerAgente lê os três perfis de agenteConfigDaDemo() como prontos, com o id e o modelo semeados", async () => {
    const { agentes } = await listarAgentesDoChat(6);
    expect(agentes.map((a) => [a.tipo, a.etapa, a.habilitado, a.id, a.modelo])).toEqual(
      TIPOS_DE_AGENTE.map((t) => [t, "pronto", true, AGENTES_DA_DEMO[t].id, MODELO_DOS_AGENTES_DA_DEMO]));
    await expect(exigirAgentesProntos(6, [...TIPOS_DE_AGENTE])).resolves.toBeUndefined();
  });

  it("primeiro contato de equipamento em caso novo: o rascunho sai do agente semeado, com o id e o modelo que a integração guarda", async () => {
    const config = agenteConfigDaDemo();
    const r = await prepararPrimeiroContatoDoAgente(6, "recuperacao_equipamentos", { nomeCliente: "Maria", nomeProvedor: "Rede Demo" });
    expect(r).toMatchObject({ agenteId: config.agentes.recuperacao_equipamentos.id, modelo: config.agentes.recuperacao_equipamentos.modelo });
    expect(r.agenteId).toBe(AGENTES_DA_DEMO.recuperacao_equipamentos.id);
    expect(espiao).not.toHaveBeenCalled();
  });

  it("a automação do primeiro contato nasce ligada, e a de retorno aponta para a automação semeada", async () => {
    const config = agenteConfigDaDemo();
    expect(lerAutomacaoChat(config.primeiroContato)).toMatchObject({ ligada: true, cobranca: true, limiteDiario: 10 });
    expect(await novoCliente().listarAutomacoes(ORG)).toMatchObject({ ok: true, valor: [{ id: config.respostaHumanaAutomacaoId }] });
  });
});

describe("execuções e resumo contam as conversas semeadas", () => {
  it("uma execução por abertura do assistente e uma pela primeira resposta do cliente — transferida na janela, pulada fora dela", async () => {
    const c = novoCliente();
    const { execucoes } = await listarExecucoesDoConsole(6, { periodo: "30d", limite: 200 });
    const doSeis = Object.values(semeadas).filter((s) => s.providerId !== 7);
    expect(new Set(execucoes.map((e) => e.conversaId))).toEqual(new Set(doSeis.map((s) => s.conversationId)));

    for (const s of doSeis) {
      const msgs = await mensagensDe(c, s.conversationId);
      const daConversa = execucoes.filter((e) => e.conversaId === s.conversationId).sort((a, b) => a.iniciadaEm.localeCompare(b.iniciadaEm));
      expect(daConversa[0], s.conversationId).toMatchObject({ status: "COMPLETED", desfecho: "REPLIED", iniciadaEm: msgs[0].createdAt, modelo: MODELO_DOS_AGENTES_DA_DEMO });
      const primeiraDoCliente = msgs.find((m) => m.direction === "INBOUND");
      if (!primeiraDoCliente) {
        expect(daConversa, s.conversationId).toHaveLength(1);
        continue;
      }
      expect(daConversa, s.conversationId).toHaveLength(2);
      expect(daConversa[1], s.conversationId).toMatchObject(podeFalar(primeiraDoCliente.createdAt)
        ? { status: "COMPLETED", desfecho: "TRANSFERRED_TO_HUMAN", iniciadaEm: primeiraDoCliente.createdAt }
        : { status: "SKIPPED", tokens: 0, custoUsd: 0, iniciadaEm: primeiraDoCliente.createdAt });
    }
    expect(execucoes.some((e) => e.status === "SKIPPED")).toBe(true);
    expect(execucoes.some((e) => e.desfecho === "TRANSFERRED_TO_HUMAN")).toBe(true);
    expect(execucoes.find((e) => e.conversaId === semeadas.retirada.conversationId)!.agenteId).toBe(AGENTES_DA_DEMO.recuperacao_equipamentos.id);
    expect(execucoes.find((e) => e.conversaId === semeadas.exCliente.conversationId)!.agenteId).toBe(AGENTES_DA_DEMO.cobranca_ex_clientes.id);
    expect(execucoes.find((e) => e.conversaId === semeadas.lembrete.conversationId)!.agenteId).toBe(AGENTES_DA_DEMO.cobranca_ativos.id);
    expect(espiao).not.toHaveBeenCalled();
  });

  it("o resumo é a soma exata da lista, em cada período, por agente e por desfecho — e a lista é determinística", async () => {
    for (const periodo of ["24h", "7d", "30d"] as const) {
      const { execucoes } = await listarExecucoesDoConsole(6, { periodo, limite: 200 });
      const resumo = await resumoDoConsole(6, periodo);
      expect(resumo.periodo).toBe(periodo);
      expect(resumo.execucoes.total, periodo).toBe(execucoes.length);
      expect(resumo.execucoes.concluidas, periodo).toBe(execucoes.filter((e) => e.status === "COMPLETED").length);
      expect(resumo.execucoes.puladas, periodo).toBe(execucoes.filter((e) => e.status === "SKIPPED").length);
      expect(resumo.execucoes.falhas, periodo).toBe(0);
      expect(resumo.tokens, periodo).toBe(execucoes.reduce((s, e) => s + e.tokens, 0));
      expect(resumo.custoUsd, periodo).toBeCloseTo(execucoes.reduce((s, e) => s + e.custoUsd, 0), 9);
      expect(resumo.porAgente.reduce((s, a) => s + a.execucoes, 0), periodo).toBe(execucoes.length);
      expect(resumo.porAgente.every((a) => a.nome !== "agente removido"), periodo).toBe(true);
      expect(Object.values(resumo.porDesfecho).reduce((s, n) => s + n, 0), periodo).toBe(execucoes.length);
    }
    const trinta = await listarExecucoesDoConsole(6, { periodo: "30d", limite: 200 });
    expect(trinta.execucoes.length).toBeGreaterThan(6);
    expect((await resumoDoConsole(6, "30d")).latencia.p50).not.toBeNull();
    expect(await listarExecucoesDoConsole(6, { periodo: "30d", limite: 200 })).toEqual(trinta);
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
    // O catálogo semeado não come o teto: o visitante criou os cem dele com a conexão da demonstração já na lista.
    const tools = await c.listarTools(ORG);
    expect(tools.ok && tools.valor.length).toBeGreaterThan(MAXIMO_DE_REGISTROS_POR_COLECAO);
    expect(espiao).not.toHaveBeenCalled();
  });
});
