/**
 * Cliente HTTP do Chat BullQ — o atendimento omnichannel (NestJS) que roda a
 * parte e que a API consome para abrir conversa, mandar texto e ligar a IA.
 *
 * Duas portas, dois cabecalhos:
 * - Plataforma (`x-platform-key`): provisiona a organizacao do provedor e pede
 *   o par de tokens do dono dela. So este cliente conhece a chave.
 * - Operacao (`Authorization: Bearer` + `x-organization-id`): tudo o mais.
 *   O token de acesso expira em 15 minutos; ao receber 401 o cliente renova
 *   UMA vez pelo `/auth/refresh` e repete a chamada; se o refresh tambem cair,
 *   reobtem o par pela plataforma. Quem chama passa so o `organizationId` —
 *   nunca ve token, e por isso nao tem como vazar um em log ou em resposta.
 *
 * Nada aqui lanca por falha de rede, timeout ou HTTP: toda chamada devolve
 * `Resultado<T>`, e a mensagem de erro em portugues vem do `message` da API
 * quando ela mandou um. O log registra metodo, caminho e status — nunca a
 * query (que carrega telefone), o corpo (que carrega a mensagem) nem o token.
 */
import { logger } from "../../logger";
import type { ContextoDoPrimeiroContato, ModelosDosAgentes, PrimeiroContatoPreparado } from "@shared/chat-agentes";
import type { CanalWhatsapp, EstadoDaConexaoWhatsapp, TemplateDatafy } from "@shared/chat-whatsapp";
import type { PedidoPlanoAutonomia, PlanoResposta } from "@shared/chat-autonomia";

export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; erro: string; status?: number };

export interface ChatBullqOpcoes {
  /** Raiz do servico, com ou sem `/api/v1` e com ou sem barra no fim. */
  baseUrl: string;
  /** Chave de plataforma — vai so nas rotas `/platform/*`. */
  platformKey: string;
  /** Tempo maximo por requisicao. Padrao 15 s. */
  timeoutMs?: number;
  /** Troca o `fetch` nativo — para teste. */
  fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Tipos do contrato da API (nomes em ingles porque sao os campos que ela devolve)
// ---------------------------------------------------------------------------

export type TipoCanal = "WHATSAPP_ZAPPFY" | "WHATSAPP_OFFICIAL" | "INSTAGRAM" | "GMAIL";
export type StatusConversa = "PENDING" | "BOT" | "OPEN" | "WAITING" | "CLOSED";
export type ModoAgente = "AUTONOMOUS" | "COPILOT" | "DISABLED";
export type GatilhoAgente = "ALWAYS" | "OFF_HOURS" | "NO_HUMAN_ASSIGNED";

export interface Canal {
  id: string;
  type: TipoCanal;
  name: string;
  isActive: boolean;
}

export interface Conversa {
  id: string;
  status: StatusConversa;
  contact: { name: string | null; phone: string | null };
  channel: { id: string; type: TipoCanal; name: string };
  assignedTo: { id: string; name: string } | null;
  aiEnabled: boolean | null;
  activeAgentId: string | null;
  lastMessageAt: string | null;
}

export interface Mensagem {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  content: { text?: string; name?: string; language?: { code?: string } };
  status: string;
  senderName?: string;
  createdAt: string;
}

export interface AgenteIa {
  id: string;
  name: string;
  kind: "ORCHESTRATOR" | "WORKER";
  modelId: string;
  isActive: boolean;
}

export interface DadosProvisionamento {
  name: string;
  slug?: string;
  ownerEmail: string;
  ownerName: string;
  ownerPassword?: string;
  externalId?: string;
}

export interface OrganizacaoProvisionada {
  organizationId: string;
  slug: string;
  ownerUserId: string;
  ownerEmail: string;
  apiKey?: string;
  created: boolean;
}

export interface DadosAgente {
  name: string;
  kind: "ORCHESTRATOR" | "WORKER";
  systemPrompt: string;
  /** CreateAgentDto.description (≤ 500) — como o provedor apresenta o agente. */
  description?: string;
  /** CreateAgentDto.operationalContext (≤ 8000) — avisos do dia; o fork injeta no prompt a cada run. */
  operationalContext?: string;
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  capabilities?: unknown;
  isActive?: boolean;
  canRespondDirectly?: boolean;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

type Metodo = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type Query = Record<string, string | number | undefined>;

interface OpcoesRequisicao {
  headers: Record<string, string>;
  corpo?: unknown;
  query?: Query;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Telefone
// ---------------------------------------------------------------------------

/**
 * O telefone no formato que o WhatsApp nao-oficial exige: so digitos, com o
 * DDI 55 na frente. 10 ou 11 digitos (DDD + numero) ganham o 55; 12 ou 13 que
 * ja comecam com 55 ficam como estao; qualquer outra coisa nao e um telefone
 * brasileiro e vira null — melhor recusar do que abrir conversa com numero
 * errado.
 */
export function normalizarTelefoneParaChat(telefone: string | null | undefined): string | null {
  const digitos = String(telefone ?? "").replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return digitos;
  return null;
}

/** O que sobra para comparar dois telefones: os digitos sem o DDI. */
function semDdi(telefone: string | null | undefined): string {
  const digitos = String(telefone ?? "").replace(/\D/g, "");
  return (digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")
    ? digitos.slice(2)
    : digitos;
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

const TIMEOUT_PADRAO_MS = 15_000;

function normalizarBaseUrl(bruta: string): string {
  const semBarra = String(bruta ?? "").trim().replace(/\/+$/, "");
  return semBarra.endsWith("/api/v1") ? semBarra : `${semBarra}/api/v1`;
}

function interpretarJson(texto: string): unknown {
  if (!texto) return undefined;
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}

/** O `message` da API, que o NestJS manda ora como texto, ora como lista de validacao. */
function mensagemDaApi(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== "object") return null;
  const m = (corpo as { message?: unknown }).message;
  if (typeof m === "string" && m.trim()) return m.trim();
  if (Array.isArray(m) && m.length) return m.map(String).join("; ");
  return null;
}

function descartar(r: Resultado<unknown>): Resultado<void> {
  return r.ok ? { ok: true, valor: undefined } : r;
}

const enc = encodeURIComponent;

export class ChatBullqClient {
  private readonly baseUrl: string;
  private readonly platformKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  /** Par de tokens por organizacao — vive so em memoria, morre com o processo. */
  private readonly sessoes = new Map<string, Tokens>();
  /** Pedido de token em voo por organizacao, para duas chamadas simultaneas nao pedirem dois. */
  private readonly autenticando = new Map<string, Promise<Resultado<Tokens>>>();

  constructor(opcoes: ChatBullqOpcoes) {
    this.baseUrl = normalizarBaseUrl(opcoes.baseUrl);
    this.platformKey = opcoes.platformKey;
    this.timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS;
    // Sem o bind, `fetch` solto perde o `this` do globalThis e o Node recusa.
    this.fetchImpl = opcoes.fetchImpl ?? ((entrada, init) => fetch(entrada, init));
  }

  // ---------------------------------------------------------- plataforma

  /** Cria (ou reencontra, por slug/externalId) a organizacao do provedor no chat. */
  provisionarOrganizacao(dados: DadosProvisionamento): Promise<Resultado<OrganizacaoProvisionada>> {
    return this.requisicao<OrganizacaoProvisionada>("POST", "/platform/organizations", {
      headers: this.cabecalhosPlataforma(),
      corpo: dados,
    });
  }

  /**
   * Garante que ha sessao valida para a organizacao — obtem o par de tokens
   * pela plataforma na primeira vez e reusa depois. Devolve so a confirmacao:
   * o token fica aqui dentro.
   */
  async sessao(organizationId: string): Promise<Resultado<{ organizationId: string }>> {
    const tokens = await this.obterTokens(organizationId);
    if (!tokens.ok) return tokens;
    return { ok: true, valor: { organizationId } };
  }

  // ---------------------------------------------------------- canais

  listarCanais(orgId: string): Promise<Resultado<Canal[]>> {
    return this.operacao<Canal[]>(orgId, "GET", "/channels");
  }

  criarCanalZappfy(
    orgId: string,
    dados: { nome: string; token: string; webhookSecret?: string },
  ): Promise<Resultado<Canal>> {
    return this.operacao<Canal>(orgId, "POST", "/channels", {
      corpo: {
        type: "WHATSAPP_ZAPPFY",
        name: dados.nome,
        config: { token: dados.token },
        ...(dados.webhookSecret ? { webhookSecret: dados.webhookSecret } : {}),
      },
    });
  }

  criarCanalWhatsapp(orgId: string, dados: CanalWhatsapp): Promise<Resultado<Canal>> {
    const config = dados.provider === "DATAFY"
      ? { provider: "DATAFY", accessToken: dados.token, phoneNumberId: dados.phoneNumberId, ...(dados.businessAccountId ? { businessAccountId: dados.businessAccountId } : {}) }
      : { provider: dados.provider, token: dados.token, ...(dados.provider === "UAZAPI" ? { baseUrl: dados.baseUrl } : {}) };
    return this.operacao(orgId, "POST", "/channels", { corpo: {
      type: dados.provider === "DATAFY" ? "WHATSAPP_OFFICIAL" : "WHATSAPP_ZAPPFY",
      name: dados.nome, config, ...(dados.webhookSecret ? { webhookSecret: dados.webhookSecret } : {}),
    } });
  }

  async testarCanal(orgId: string, canalId: string): Promise<Resultado<{ ok: boolean; message?: string }>> {
    const r = await this.operacao<{ success?: boolean; ok?: boolean }>(orgId, "POST", `/channels/${enc(canalId)}/test`);
    const message = "Não foi possível validar o canal. Verifique a instância e o token.";
    if (!r.ok) return { ok: false, erro: message, ...(r.status ? { status: r.status } : {}) };
    const ok = typeof r.valor?.success === "boolean" ? r.valor.success : r.valor?.ok === true;
    return { ok: true, valor: ok ? { ok: true } : { ok: false, message } };
  }

  capacidadesDosCanais(orgId: string): Promise<Resultado<{ whatsappUnofficial: boolean; instanceConnect: boolean; instanceStatus: boolean; provider: string; uazapi: boolean; datafy: boolean; templateFirstContact: boolean }>> {
    return this.operacao(orgId, "GET", "/channels/capabilities");
  }

  estadoDaConexaoWhatsapp(orgId: string, canalId: string): Promise<Resultado<EstadoDaConexaoWhatsapp>> {
    return this.operacao(orgId, "GET", `/channels/${enc(canalId)}/connection-status`);
  }

  conectarWhatsapp(orgId: string, canalId: string, phone?: string): Promise<Resultado<EstadoDaConexaoWhatsapp>> {
    return this.operacao(orgId, "POST", `/channels/${enc(canalId)}/connect`, { corpo: phone ? { phone } : {} });
  }

  async listarTemplatesWhatsapp(orgId: string, canalId: string): Promise<Resultado<{ data: TemplateDatafy[] }>> {
    const r = await this.operacao<TemplateDatafy[]>(orgId, "GET", `/channels/${enc(canalId)}/templates`);
    if (!r.ok) return r;
    if (!Array.isArray(r.valor)) return { ok: false, erro: "O catálogo de templates do WhatsApp é inválido." };
    // The channel endpoint lists approved templates only, including legacy Meta.
    return { ok: true, valor: { data: r.valor.map(t => ({ ...t, status: t.status ?? "APPROVED" })) } };
  }

  // ---------------------------------------------------------- conversas

  /**
   * A conversa mais recente daquele telefone, ou null se nao ha nenhuma.
   *
   * A busca da API e por texto; a comparacao final e nossa, so por digitos e
   * indiferente ao 55 — o contato pode ter sido gravado de um jeito e o ERP
   * mandar do outro. "Mais recente" e por `lastMessageAt`; conversa sem
   * mensagem fica por ultimo.
   */
  async buscarConversaPorTelefone(
    orgId: string,
    telefone: string,
    canalId?: string,
  ): Promise<Resultado<Conversa | null>> {
    const normalizado = normalizarTelefoneParaChat(telefone);
    if (!normalizado) return { ok: false, erro: "Telefone inválido para o chat" };

    const r = await this.operacao<{ conversations?: Conversa[] } | Conversa[]>(orgId, "GET", "/conversations", {
      query: { search: normalizado, channelId: canalId, page: 1, limit: 20 },
    });
    if (!r.ok) return r;

    const lista = Array.isArray(r.valor) ? r.valor : (r.valor?.conversations ?? []);
    const alvo = semDdi(normalizado);
    const doTelefone = lista.filter(c => semDdi(c?.contact?.phone) === alvo);
    if (!doTelefone.length) return { ok: true, valor: null };

    const instante = (c: Conversa) => (c.lastMessageAt ? Date.parse(c.lastMessageAt) || 0 : 0);
    const maisRecente = doTelefone.reduce((a, b) => (instante(b) > instante(a) ? b : a));
    return { ok: true, valor: maisRecente };
  }

  /** Abre uma conversa ativa com a primeira mensagem ja enviada. */
  async iniciarConversa(
    orgId: string,
    dados: { canalId: string; telefone: string; nome?: string; texto: string; template?: { name: string; language: { code: string }; components?: unknown[] }; aiEnabled?: boolean; activeAgentId?: string | null },
  ): Promise<Resultado<{ conversationId: string; messageId: string }>> {
    const phone = normalizarTelefoneParaChat(dados.telefone);
    if (!phone) return { ok: false, erro: "Telefone inválido para o chat" };

    const r = await this.operacao<{ id: string; conversationId: string; status: string }>(
      orgId,
      "POST",
      "/conversations",
      {
        corpo: {
          channelId: dados.canalId,
          contact: { phone, ...(dados.nome ? { name: dados.nome } : {}) },
          message: dados.template ? { type: "TEMPLATE", content: dados.template } : { type: "TEXT", content: { text: dados.texto } },
          // Patch 4 do fork: a conversa nasce com a IA ligada e o agente fixado —
          // sem isso o Chat BullQ cria com aiEnabled=false e o agente nunca responde.
          ...(dados.aiEnabled !== undefined ? { aiEnabled: dados.aiEnabled } : {}),
          ...(dados.activeAgentId ? { activeAgentId: dados.activeAgentId } : {}),
        },
      },
    );
    if (!r.ok) return r;
    return { ok: true, valor: { conversationId: r.valor.conversationId, messageId: r.valor.id } };
  }

  async enviarTexto(
    orgId: string,
    conversationId: string,
    texto: string,
  ): Promise<Resultado<{ messageId: string; status: string }>> {
    const r = await this.operacao<{ id: string; status: string }>(orgId, "POST", "/messages", {
      corpo: { conversationId, type: "TEXT", content: { text: texto } },
    });
    if (!r.ok) return r;
    return { ok: true, valor: { messageId: r.valor.id, status: r.valor.status } };
  }

  obterMidia(orgId: string, messageId: string): Promise<Resultado<{ url: string; mimeType?: string }>> {
    return this.operacao(orgId, "GET", `/messages/${enc(messageId)}/media`);
  }

  /** As mensagens da conversa. Aceita o envelope `{ messages, pagination }` ou o array cru. */
  async listarMensagens(
    orgId: string,
    conversationId: string,
    opcoes: { limit?: number; page?: number } = {},
  ): Promise<Resultado<Mensagem[]>> {
    const r = await this.operacao<{ messages?: Mensagem[] } | Mensagem[]>(orgId, "GET", "/messages", {
      query: { conversationId, page: opcoes.page ?? 1, limit: opcoes.limit ?? 50 },
    });
    if (!r.ok) return r;
    return { ok: true, valor: Array.isArray(r.valor) ? r.valor : (r.valor?.messages ?? []) };
  }

  atribuir(
    orgId: string,
    conversationId: string,
    dados: { assignedToId?: string; departmentId?: string; status?: StatusConversa; subject?: string },
  ): Promise<Resultado<Conversa>> {
    const corpo: Record<string, unknown> = {};
    for (const [chave, valor] of Object.entries(dados)) {
      if (valor !== undefined) corpo[chave] = valor;
    }
    return this.operacao<Conversa>(orgId, "PATCH", `/conversations/${enc(conversationId)}`, { corpo });
  }

  async ligarIa(orgId: string, conversationId: string): Promise<Resultado<void>> {
    return descartar(await this.operacao(orgId, "POST", `/conversations/${enc(conversationId)}/ai/engage`));
  }

  async desligarIa(orgId: string, conversationId: string): Promise<Resultado<void>> {
    return descartar(
      await this.operacao(orgId, "PATCH", `/conversations/${enc(conversationId)}/ai`, { corpo: { enabled: false } }),
    );
  }

  async encerrar(orgId: string, conversationId: string): Promise<Resultado<void>> {
    return descartar(await this.operacao(orgId, "POST", `/conversations/${enc(conversationId)}/close`));
  }

  // ---------------------------------------------------------- agentes de IA

  listarAgentes(orgId: string): Promise<Resultado<AgenteIa[]>> {
    return this.operacao<AgenteIa[]>(orgId, "GET", "/ai-agents");
  }

  obterAgente(orgId: string, agenteId: string): Promise<Resultado<unknown>> {
    return this.operacao(orgId, "GET", `/ai-agents/${enc(agenteId)}`);
  }

  planejarAutonomia(orgId: string, agenteId: string, pedido: PedidoPlanoAutonomia): Promise<Resultado<PlanoResposta>> {
    return this.operacao(orgId, "POST", `/ai-agents/${enc(agenteId)}/autonomous-plan`, { corpo: pedido, timeoutMs: 30_000 });
  }

  /** Patch 002: lista os modelos realmente disponíveis na credencial do serviço. */
  listarModelosDePrimeiroContato(orgId: string): Promise<Resultado<ModelosDosAgentes>> {
    return this.operacao(orgId, "GET", "/ai-agents/first-contact/models");
  }

  /** Patch 002: uma conclusão sem tools, sem conversa e sem envio a canais. */
  prepararPrimeiroContato(orgId: string, agenteId: string, contexto: ContextoDoPrimeiroContato): Promise<Resultado<PrimeiroContatoPreparado>> {
    return this.operacao(orgId, "POST", `/ai-agents/${enc(agenteId)}/first-contact-draft`, { corpo: { context: contexto }, timeoutMs: 30_000 });
  }

  listarAutomacoes(orgId: string): Promise<Resultado<{ id: string; name: string; trigger: string }[]>> {
    return this.operacao(orgId, "GET", "/automations");
  }

  criarAgente(orgId: string, dados: DadosAgente): Promise<Resultado<AgenteIa>> {
    return this.operacao<AgenteIa>(orgId, "POST", "/ai-agents", { corpo: dados });
  }

  async ligarAgenteAoCanal(
    orgId: string,
    agenteId: string,
    canalId: string,
    mode: ModoAgente,
    trigger?: GatilhoAgente,
  ): Promise<Resultado<void>> {
    return descartar(
      await this.operacao(orgId, "POST", `/ai-agents/${enc(agenteId)}/channels`, {
        corpo: { channelId: canalId, mode, ...(trigger ? { trigger } : {}) },
      }),
    );
  }

  // ---------------------------------------------------------- catalogo do agente

  /** A conexao HTTP que as skills usam (uma por organizacao): base + headers literais (a chave do agente vai aqui). */
  async criarTool(orgId: string, dados: { nome: string; descricao: string; httpBaseUrl: string; httpHeaders: Record<string, string> }): Promise<Resultado<{ id: string }>> {
    return this.operacao<{ id: string }>(orgId, "POST", "/ai-catalog/tools", {
      corpo: { name: dados.nome, description: dados.descricao, source: "CUSTOM_HTTP", httpBaseUrl: dados.httpBaseUrl, httpHeaders: dados.httpHeaders },
    });
  }

  /** Uma funcao que o LLM pode chamar: nome (identificador), descricao, JSON Schema do input e a chamada HTTP. */
  async criarSkill(orgId: string, dados: {
    nome: string; descricao: string; categoria?: string; promptInstructions?: string; toolId: string;
    parameters: Record<string, unknown>; httpMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; httpPath: string;
    httpBodyTemplate?: string; responseMap?: Record<string, string>; timeoutMs?: number;
  }): Promise<Resultado<{ id: string }>> {
    return this.operacao<{ id: string }>(orgId, "POST", "/ai-catalog/skills", {
      corpo: {
        name: dados.nome, description: dados.descricao, ...(dados.categoria ? { category: dados.categoria } : {}),
        ...(dados.promptInstructions ? { promptInstructions: dados.promptInstructions } : {}),
        source: "HTTP", toolId: dados.toolId, parameters: dados.parameters, httpMethod: dados.httpMethod, httpPath: dados.httpPath,
        ...(dados.httpBodyTemplate ? { httpBodyTemplate: dados.httpBodyTemplate } : {}),
        ...(dados.responseMap ? { responseMap: dados.responseMap } : {}),
        timeoutMs: dados.timeoutMs ?? 10000,
      },
    });
  }

  /** Substitui o conjunto de skills do agente (o Chat BullQ apaga e recria os vinculos). */
  async ligarSkillsAoAgente(orgId: string, agenteId: string, skillIds: string[]): Promise<Resultado<void>> {
    return descartar(await this.operacao(orgId, "PUT", `/ai-catalog/agents/${enc(agenteId)}/skills`, { corpo: { skillIds } }));
  }

  /** PATCH no agente: prompt, contexto operacional, modelo, ativo. */
  async atualizarAgente(orgId: string, agenteId: string, dados: Record<string, unknown>): Promise<Resultado<{ id: string }>> {
    return this.operacao<{ id: string }>(orgId, "PATCH", `/ai-agents/${enc(agenteId)}`, { corpo: dados });
  }

  /** Uma automacao (gatilho → acoes) — usada para o webhook de volta ao Consulta ISP. */
  async criarAutomacao(orgId: string, dados: { nome: string; descricao?: string; trigger: string; conditions?: unknown; actions: unknown[]; enabled?: boolean }): Promise<Resultado<{ id: string }>> {
    return this.operacao<{ id: string }>(orgId, "POST", "/automations", {
      corpo: { name: dados.nome, ...(dados.descricao ? { description: dados.descricao } : {}), trigger: dados.trigger, ...(dados.conditions !== undefined ? { conditions: dados.conditions } : {}), actions: dados.actions, enabled: dados.enabled ?? true },
    });
  }

  /**
   * A senha do owner da organizacao, pela chave de plataforma — e o que deixa
   * a equipe do provedor entrar no inbox web. A senha so passa por aqui; nao
   * e guardada nem logada.
   */
  async definirSenhaDoOwner(orgId: string, senha: string): Promise<Resultado<{ ownerUserId: string; ownerEmail: string }>> {
    return this.requisicao<{ ownerUserId: string; ownerEmail: string }>("POST", `/platform/organizations/${enc(orgId)}/owner-password`, {
      headers: this.cabecalhosPlataforma(),
      corpo: { password: senha },
    });
  }

  // ---------------------------------------------------------- sessao

  private cabecalhosPlataforma(): Record<string, string> {
    return { "x-platform-key": this.platformKey };
  }

  private cabecalhosOperacao(orgId: string, accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}`, "x-organization-id": orgId };
  }

  private async obterTokens(orgId: string): Promise<Resultado<Tokens>> {
    const guardado = this.sessoes.get(orgId);
    if (guardado) return { ok: true, valor: guardado };
    return this.autenticarPelaPlataforma(orgId);
  }

  private autenticarPelaPlataforma(orgId: string): Promise<Resultado<Tokens>> {
    const emVoo = this.autenticando.get(orgId);
    if (emVoo) return emVoo;

    const pedido = (async (): Promise<Resultado<Tokens>> => {
      const r = await this.requisicao<Tokens>("POST", `/platform/organizations/${enc(orgId)}/token`, {
        headers: this.cabecalhosPlataforma(),
      });
      if (!r.ok) return r;
      if (!r.valor?.accessToken || !r.valor?.refreshToken) {
        logger.warn({ organizationId: orgId }, "chat-bullq: plataforma respondeu sem o par de tokens");
        return { ok: false, erro: "O Chat BullQ não devolveu a sessão da organização" };
      }
      this.sessoes.set(orgId, r.valor);
      return r;
    })().finally(() => this.autenticando.delete(orgId));

    this.autenticando.set(orgId, pedido);
    return pedido;
  }

  /**
   * Troca o par pelo `/auth/refresh`; se a API recusar, esquece a sessao e
   * pede outra pela plataforma. Se outra chamada ja renovou nesse meio-tempo,
   * usa o que ela trouxe sem bater na API de novo.
   */
  private async renovarSessao(orgId: string, atual: Tokens): Promise<Resultado<Tokens>> {
    const agora = this.sessoes.get(orgId);
    if (agora && agora.accessToken !== atual.accessToken) return { ok: true, valor: agora };

    const r = await this.requisicao<Tokens>("POST", "/auth/refresh", {
      headers: this.cabecalhosOperacao(orgId, atual.accessToken),
      corpo: { refreshToken: atual.refreshToken },
    });
    if (r.ok && r.valor?.accessToken && r.valor?.refreshToken) {
      this.sessoes.set(orgId, r.valor);
      return r;
    }

    logger.info({ organizationId: orgId }, "chat-bullq: refresh recusado, reobtendo a sessão pela plataforma");
    this.sessoes.delete(orgId);
    return this.autenticarPelaPlataforma(orgId);
  }

  /** Uma chamada de operacao: sessao, cabecalhos, e UMA renovacao em caso de 401. */
  private async operacao<T>(
    orgId: string,
    metodo: Metodo,
    caminho: string,
    opcoes: { corpo?: unknown; query?: Query; timeoutMs?: number } = {},
    podeRenovar = true,
  ): Promise<Resultado<T>> {
    const sessao = await this.obterTokens(orgId);
    if (!sessao.ok) return sessao;

    const r = await this.requisicao<T>(metodo, caminho, {
      ...opcoes,
      headers: this.cabecalhosOperacao(orgId, sessao.valor.accessToken),
    });
    if (!r.ok && r.status === 401 && podeRenovar) {
      const nova = await this.renovarSessao(orgId, sessao.valor);
      if (!nova.ok) return nova;
      return this.operacao<T>(orgId, metodo, caminho, opcoes, false);
    }
    return r;
  }

  // ---------------------------------------------------------- HTTP

  private montarUrl(caminho: string, query?: Query): string {
    const parametros = new URLSearchParams();
    for (const [chave, valor] of Object.entries(query ?? {})) {
      if (valor !== undefined && valor !== "") parametros.set(chave, String(valor));
    }
    const sufixo = parametros.toString();
    return `${this.baseUrl}${caminho}${sufixo ? `?${sufixo}` : ""}`;
  }

  private async requisicao<T>(metodo: Metodo, caminho: string, opcoes: OpcoesRequisicao): Promise<Resultado<T>> {
    const url = this.montarUrl(caminho, opcoes.query);
    const controlador = new AbortController();
    const timeoutMs = opcoes.timeoutMs ?? this.timeoutMs;
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
    const inicio = Date.now();

    try {
      const resposta = await this.fetchImpl(url, {
        method: metodo,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...opcoes.headers },
        body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
        signal: controlador.signal,
      });
      const corpo = interpretarJson(await resposta.text());
      const ms = Date.now() - inicio;

      if (!resposta.ok) {
        logger.warn({ metodo, caminho, status: resposta.status, ms }, "chat-bullq: requisição recusada");
        return {
          ok: false,
          erro: mensagemDaApi(corpo) ?? `O Chat BullQ respondeu ${resposta.status}`,
          status: resposta.status,
        };
      }

      logger.debug({ metodo, caminho, status: resposta.status, ms }, "chat-bullq: requisição ok");
      const dados = corpo && typeof corpo === "object" && "data" in corpo ? (corpo as { data: T }).data : corpo;
      return { ok: true, valor: dados as T };
    } catch (erro) {
      const ms = Date.now() - inicio;
      if (controlador.signal.aborted) {
        logger.warn({ metodo, caminho, ms }, "chat-bullq: tempo esgotado");
        return { ok: false, erro: `O Chat BullQ não respondeu em ${Math.round(timeoutMs / 1000)}s` };
      }
      // So o nome/codigo do erro: a mensagem do fetch pode trazer a URL, e a URL a query.
      const causa = (erro as { code?: string })?.code ?? (erro as { name?: string })?.name ?? "erro";
      logger.warn({ metodo, caminho, causa, ms }, "chat-bullq: falha de rede");
      return { ok: false, erro: "Não foi possível falar com o Chat BullQ" };
    } finally {
      clearTimeout(temporizador);
    }
  }
}
