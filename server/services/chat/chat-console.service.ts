/**
 * O console de agentes por provedor — agentes, skills, tools e execuções.
 *
 * Mesma lógica do `/ai-agents` do Chat BullQ, com a porta trocada: quem
 * configura entra pela sessão do Consulta ISP, e a organização do fork é
 * resolvida a partir do `providerId`. Nenhuma rota daqui recebe organização
 * por parâmetro — é isso que garante o isolamento multi-tenant.
 *
 * O que vem do fork é DADO, não verdade: cada payload passa por zod antes de
 * virar tipo. Uma organização mal provisionada ou um fork mais novo devolvendo
 * campo a mais não pode derrubar a tela.
 *
 * As três coisas que a ponte de cobrança criou lá dentro (a conexão com a API
 * do agente, as skills que o prompt cita pelo nome e os três perfis do Painel)
 * ficam marcadas `daPonte` e são recusadas para edição e remoção: apagar uma
 * delas por engano quebra o atendimento em produção, e o console não é o lugar
 * de descobrir isso.
 */
import { z } from "zod";
import { storage } from "../../storage";
import { clienteDoChat, ErroDaPonteDoChat, urlDaApiDoAgente } from "./chat-ponte.service";
import { comTravaDaConfiguracaoDoChat } from "./chat-agentes.service";
import {
  hostPermitido, LIMITES_DO_CONSOLE,
  type AgenteDoConsole, type AgenteDoConsoleEntrada, type ExecucaoDoAgente, type PeriodoDoConsole,
  type ResumoDoConsole, type SkillDoConsole, type SkillDoConsoleEntrada, type ToolDoConsole,
  type ToolDoConsoleEntrada, type VersaoDaSkill,
} from "@shared/chat-console";
import type { Resultado } from "./chat-bullq.client";

/** As skills que o prompt do agente de cobrança cita pelo nome. Renomear quebra o atendimento. */
export const SKILLS_DA_PONTE = ["consultarCaso", "registrarTransferencia", "registrarPromessa"] as const;

function cliente() {
  const c = clienteDoChat();
  if (!c) throw new ErroDaPonteDoChat("CHAT_DESLIGADO", "Configure a integração com o Chat BullQ antes de usar o console de agentes");
  return c;
}

/** A organização do provedor. Nunca provisiona: quem liga o chat é o Painel. */
async function organizacao(providerId: number): Promise<{ orgId: string; agenteConfig: Record<string, unknown> }> {
  const i = await storage.getIntegracaoDoChat(providerId);
  if (!i) throw new ErroDaPonteDoChat("SEM_CANAL", "Ligue a integração do chat no Painel do Provedor antes de configurar agentes");
  if (i.providerId !== providerId) throw new ErroDaPonteDoChat("CONFLITO", "Integração de outro provedor");
  const config = (i.agenteConfig ?? {}) as Record<string, unknown>;
  return { orgId: i.organizationId, agenteConfig: config };
}

function exigir<T>(r: Resultado<T>, mensagem: string): T {
  if (!r.ok) throw new ErroDaPonteDoChat("CHAT_FALHOU", `${mensagem}: ${r.erro}`);
  return r.valor;
}

/** Os ids dos três perfis que o Painel do Provedor administra. */
function idsDaPonte(agenteConfig: Record<string, unknown>): Set<string> {
  const agentes = (agenteConfig.agentes ?? {}) as Record<string, unknown>;
  const ids = new Set<string>();
  for (const v of Object.values(agentes)) {
    const id = (v as Record<string, unknown> | null)?.id;
    if (typeof id === "string" && id) ids.add(id);
  }
  return ids;
}

/**
 * Os hosts que uma tool pode chamar. A base da nossa própria API do agente
 * entra sempre — é a conexão que faz sentido aqui. O resto é o superadmin quem
 * libera, por variável de ambiente, porque quem escolhe o destino escolhe para
 * onde vão os headers de credencial.
 */
export function hostsPermitidosDasTools(): string[] {
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(urlDaApiDoAgente()).hostname.toLowerCase());
  } catch {
    /* base mal configurada: sobra a lista do ambiente */
  }
  for (const h of (process.env.CHAT_BULLQ_TOOLS_HOSTS || "").split(",")) {
    const limpo = h.trim().toLowerCase();
    if (limpo) hosts.add(limpo);
  }
  return [...hosts];
}

// ---------------------------------------------------------------- leitura

const texto = z.string().nullish().transform(v => (typeof v === "string" && v.trim() ? v.trim() : null));
const AgenteBrutoSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  description: texto,
  kind: z.enum(["ORCHESTRATOR", "WORKER"]).catch("WORKER"),
  category: texto,
  capabilities: z.array(z.string()).catch([]).default([]),
  modelId: z.string().default(""),
  systemPrompt: z.string().default(""),
  operationalContext: texto,
  operationalContextUpdatedAt: texto,
  temperature: z.coerce.number().catch(0.3).default(0.3),
  maxTokens: z.coerce.number().int().catch(600).default(600),
  canRespondDirectly: z.boolean().catch(false).default(false),
  isActive: z.boolean().catch(false).default(false),
  parentAgentId: texto,
  department: texto,
  squad: texto,
  createdAt: texto,
  updatedAt: texto,
  channels: z.array(z.object({
    id: z.string(),
    channelId: z.string(),
    mode: z.string().default("DISABLED"),
    trigger: z.string().default("ALWAYS"),
    channel: z.object({ name: z.string().default("") }).partial().nullish(),
  }).partial({ id: true, channelId: true })).catch([]).default([]),
}).passthrough();

function lerAgente(bruto: unknown, daPonte: Set<string>): AgenteDoConsole | null {
  const r = AgenteBrutoSchema.safeParse(bruto);
  if (!r.success) return null;
  const a = r.data;
  return {
    id: a.id, nome: a.name, descricao: a.description, tipo: a.kind, categoria: a.category,
    capacidades: a.capabilities, modelo: a.modelId, instrucoes: a.systemPrompt,
    contextoOperacional: a.operationalContext, contextoAtualizadoEm: a.operationalContextUpdatedAt,
    temperatura: a.temperature, maxTokens: a.maxTokens, respondeDireto: a.canRespondDirectly,
    ativo: a.isActive, reportaA: a.parentAgentId, departamento: a.department, squad: a.squad,
    criadoEm: a.createdAt, atualizadoEm: a.updatedAt,
    canais: a.channels.map(c => ({
      id: c.id ?? "", canalId: c.channelId ?? "", nome: c.channel?.name ?? "canal",
      modo: c.mode ?? "DISABLED", gatilho: c.trigger ?? "ALWAYS",
    })),
    daPonte: daPonte.has(a.id),
  };
}

export async function listarAgentesDoConsole(providerId: number): Promise<{ agentes: AgenteDoConsole[] }> {
  const { orgId, agenteConfig } = await organizacao(providerId);
  const bruto = exigir(await cliente().listarAgentes(orgId), "Não foi possível listar os agentes");
  const daPonte = idsDaPonte(agenteConfig);
  const agentes = (Array.isArray(bruto) ? bruto : []).map(a => lerAgente(a, daPonte)).filter((a): a is AgenteDoConsole => a !== null);
  return { agentes };
}

export async function obterAgenteDoConsole(providerId: number, agenteId: string): Promise<AgenteDoConsole> {
  const { orgId, agenteConfig } = await organizacao(providerId);
  const bruto = exigir(await cliente().obterAgente(orgId, agenteId), "Não foi possível carregar o agente");
  const agente = lerAgente(bruto, idsDaPonte(agenteConfig));
  if (!agente) throw new ErroDaPonteDoChat("CHAT_FALHOU", "O Chat BullQ devolveu um agente em formato inesperado");
  return agente;
}

// ---------------------------------------------------------------- escrita de agente

/** O corpo do `CreateAgentDto`/`UpdateAgentDto` a partir da entrada em português. */
function corpoDoAgente(e: Partial<AgenteDoConsoleEntrada>): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};
  if (e.nome !== undefined) corpo.name = e.nome;
  if (e.descricao !== undefined) corpo.description = e.descricao;
  if (e.tipo !== undefined) corpo.kind = e.tipo;
  if (e.categoria !== undefined) corpo.category = e.categoria;
  if (e.capacidades !== undefined) corpo.capabilities = e.capacidades;
  if (e.modelo !== undefined) corpo.modelId = e.modelo;
  if (e.instrucoes !== undefined) corpo.systemPrompt = e.instrucoes;
  if (e.contextoOperacional !== undefined) corpo.operationalContext = e.contextoOperacional;
  if (e.temperatura !== undefined) corpo.temperature = e.temperatura;
  if (e.maxTokens !== undefined) corpo.maxTokens = e.maxTokens;
  if (e.respondeDireto !== undefined) corpo.canRespondDirectly = e.respondeDireto;
  if (e.ativo !== undefined) corpo.isActive = e.ativo;
  if (e.reportaA !== undefined) corpo.parentAgentId = e.reportaA;
  if (e.departamento !== undefined) corpo.department = e.departamento;
  if (e.squad !== undefined) corpo.squad = e.squad;
  return corpo;
}

/**
 * Um agente novo nasce PARADO: `isActive:false` e sem canal. Ligar é um passo
 * separado e consciente — criar um agente não pode, sozinho, colocar um robô
 * falando com cliente.
 */
export async function criarAgenteDoConsole(providerId: number, entrada: AgenteDoConsoleEntrada): Promise<AgenteDoConsole> {
  return comTravaDaConfiguracaoDoChat(providerId, async () => {
    const { orgId, agenteConfig } = await organizacao(providerId);
    if (entrada.reportaA) await conferirChefia(providerId, orgId, entrada.reportaA);
    const corpo = { ...corpoDoAgente(entrada), isActive: false, canRespondDirectly: entrada.respondeDireto ?? false };
    const criado = exigir(await cliente().criarAgente(orgId, corpo as never), "Não foi possível criar o agente");
    const agente = lerAgente(criado, idsDaPonte(agenteConfig));
    if (!agente) throw new ErroDaPonteDoChat("CHAT_FALHOU", "Agente criado, mas o Chat BullQ devolveu um formato inesperado");
    return agente;
  });
}

/** `reportaA` tem que ser um agente DA MESMA organização — e não ele mesmo. */
async function conferirChefia(providerId: number, orgId: string, chefeId: string, proprioId?: string) {
  if (proprioId && chefeId === proprioId) throw new ErroDaPonteDoChat("CONFLITO", "Um agente não reporta a si mesmo");
  const bruto = exigir(await cliente().listarAgentes(orgId), "Não foi possível conferir o organograma");
  const existe = (Array.isArray(bruto) ? bruto : []).some(a => (a as { id?: string })?.id === chefeId);
  if (!existe) throw new ErroDaPonteDoChat("CONFLITO", "O agente a quem este reporta não existe nesta organização");
}

export async function atualizarAgenteDoConsole(providerId: number, agenteId: string, entrada: Partial<AgenteDoConsoleEntrada>): Promise<AgenteDoConsole> {
  return comTravaDaConfiguracaoDoChat(providerId, async () => {
    const { orgId, agenteConfig } = await organizacao(providerId);
    if (idsDaPonte(agenteConfig).has(agenteId)) {
      throw new ErroDaPonteDoChat("CONFLITO", "Este é um dos perfis da cobrança. Edite pelo Painel do Provedor → Chat, onde a política e a régua entram no prompt.");
    }
    if (entrada.reportaA) await conferirChefia(providerId, orgId, entrada.reportaA, agenteId);
    exigir(await cliente().atualizarAgente(orgId, agenteId, corpoDoAgente(entrada)), "Não foi possível salvar o agente");
    return obterAgenteDoConsole(providerId, agenteId);
  });
}

export async function apagarAgenteDoConsole(providerId: number, agenteId: string): Promise<void> {
  return comTravaDaConfiguracaoDoChat(providerId, async () => {
    const { orgId, agenteConfig } = await organizacao(providerId);
    if (idsDaPonte(agenteConfig).has(agenteId)) {
      throw new ErroDaPonteDoChat("CONFLITO", "Este é um dos perfis da cobrança e não se apaga por aqui — o atendimento em andamento depende dele.");
    }
    exigir(await cliente().apagarAgente(orgId, agenteId), "Não foi possível remover o agente");
  });
}

// ---------------------------------------------------------------- canais do agente

export async function ligarAgenteAoCanalDoConsole(
  providerId: number, agenteId: string, canalId: string, modo: "AUTONOMOUS" | "COPILOT" | "DISABLED", gatilho?: "ALWAYS" | "OFF_HOURS" | "NO_HUMAN_ASSIGNED",
): Promise<void> {
  const { orgId } = await organizacao(providerId);
  const canais = exigir(await cliente().listarCanais(orgId), "Não foi possível conferir os canais");
  if (!canais.some(c => c.id === canalId)) throw new ErroDaPonteDoChat("CONFLITO", "O canal não pertence a este provedor");
  exigir(await cliente().ligarAgenteAoCanal(orgId, agenteId, canalId, modo, gatilho), "Não foi possível ligar o agente ao canal");
}

export async function desligarAgenteDoCanalDoConsole(providerId: number, agenteId: string, canalId: string): Promise<void> {
  const { orgId } = await organizacao(providerId);
  exigir(await cliente().desligarAgenteDoCanal(orgId, agenteId, canalId), "Não foi possível desligar o agente do canal");
}

// ---------------------------------------------------------------- tools

const ToolBrutaSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  description: z.string().default(""),
  source: z.string().default("CUSTOM_HTTP"),
  httpBaseUrl: texto,
  httpHeaders: z.record(z.string(), z.unknown()).nullish(),
  isActive: z.boolean().catch(true).default(true),
  _count: z.object({ skills: z.coerce.number().catch(0) }).partial().nullish(),
}).passthrough();

function mesmaBase(a: string | null, b: string): boolean {
  if (!a) return false;
  return a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();
}

function lerTool(bruto: unknown): ToolDoConsole | null {
  const r = ToolBrutaSchema.safeParse(bruto);
  if (!r.success) return null;
  const t = r.data;
  return {
    id: t.id, nome: t.name, descricao: t.description, baseUrl: t.httpBaseUrl,
    // Só os NOMES. O valor do header é a credencial e não volta para o navegador.
    headers: Object.keys(t.httpHeaders ?? {}),
    ativa: t.isActive, skills: t._count?.skills ?? 0,
    daPonte: mesmaBase(t.httpBaseUrl, urlDaApiDoAgente()),
  };
}

export async function listarToolsDoConsole(providerId: number): Promise<{ tools: ToolDoConsole[]; hostsPermitidos: string[] }> {
  const { orgId } = await organizacao(providerId);
  const bruto = exigir(await cliente().listarTools(orgId), "Não foi possível listar as conexões");
  return {
    tools: (Array.isArray(bruto) ? bruto : []).map(lerTool).filter((t): t is ToolDoConsole => t !== null),
    hostsPermitidos: hostsPermitidosDasTools(),
  };
}

function conferirBaseDaTool(baseUrl: string) {
  const veredito = hostPermitido(baseUrl, hostsPermitidosDasTools());
  if (!veredito.ok) throw new ErroDaPonteDoChat("CONFLITO", veredito.motivo);
}

export async function criarToolDoConsole(providerId: number, entrada: ToolDoConsoleEntrada): Promise<ToolDoConsole> {
  conferirBaseDaTool(entrada.baseUrl);
  const { orgId } = await organizacao(providerId);
  const criada = exigir(await cliente().criarTool(orgId, {
    nome: entrada.nome, descricao: entrada.descricao, httpBaseUrl: entrada.baseUrl,
    httpHeaders: entrada.headers ?? {}, ...(entrada.ativa !== undefined ? { isActive: entrada.ativa } : {}),
  }), "Não foi possível criar a conexão");
  const tool = lerTool(criada);
  if (!tool) throw new ErroDaPonteDoChat("CHAT_FALHOU", "Conexão criada, mas o Chat BullQ devolveu um formato inesperado");
  return tool;
}

async function toolDoProvedor(providerId: number, toolId: string): Promise<ToolDoConsole> {
  const { tools } = await listarToolsDoConsole(providerId);
  const tool = tools.find(t => t.id === toolId);
  if (!tool) throw new ErroDaPonteDoChat("CASO_NAO_ENCONTRADO", "Conexão não encontrada neste provedor");
  return tool;
}

export async function atualizarToolDoConsole(providerId: number, toolId: string, entrada: ToolDoConsoleEntrada): Promise<ToolDoConsole> {
  const atual = await toolDoProvedor(providerId, toolId);
  if (atual.daPonte) throw new ErroDaPonteDoChat("CONFLITO", "Esta é a conexão da cobrança com o Consulta ISP e não se edita por aqui.");
  conferirBaseDaTool(entrada.baseUrl);
  const { orgId } = await organizacao(providerId);
  // O PATCH do fork é upsert do DTO inteiro: sem `httpHeaders` os headers somem.
  // Mandar `{}` quando o operador não digitou nada é apagar credencial em silêncio,
  // então só mandamos o campo quando a tela declarou o conjunto novo.
  exigir(await cliente().atualizarTool(orgId, toolId, {
    name: entrada.nome, description: entrada.descricao, source: "CUSTOM_HTTP", httpBaseUrl: entrada.baseUrl,
    ...(entrada.headers ? { httpHeaders: entrada.headers } : {}),
    ...(entrada.ativa !== undefined ? { isActive: entrada.ativa } : {}),
  }), "Não foi possível salvar a conexão");
  return toolDoProvedor(providerId, toolId);
}

export async function apagarToolDoConsole(providerId: number, toolId: string): Promise<void> {
  const atual = await toolDoProvedor(providerId, toolId);
  if (atual.daPonte) throw new ErroDaPonteDoChat("CONFLITO", "Esta é a conexão da cobrança com o Consulta ISP e não se apaga por aqui.");
  if (atual.skills > 0) throw new ErroDaPonteDoChat("CONFLITO", `Esta conexão ainda é usada por ${atual.skills} skill(s). Remova-as antes.`);
  const { orgId } = await organizacao(providerId);
  exigir(await cliente().apagarTool(orgId, toolId), "Não foi possível remover a conexão");
}

// ---------------------------------------------------------------- skills

const SkillBrutaSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  description: z.string().default(""),
  category: texto,
  promptInstructions: texto,
  source: z.enum(["BUILTIN", "HTTP", "SQL"]).catch("HTTP"),
  parameters: z.record(z.string(), z.unknown()).catch({}).default({}),
  toolId: texto,
  httpMethod: texto,
  httpPath: texto,
  httpBodyTemplate: texto,
  timeoutMs: z.coerce.number().int().catch(10000).default(10000),
  currentVersion: z.coerce.number().int().catch(1).default(1),
  isActive: z.boolean().catch(true).default(true),
  tool: z.object({ id: z.string(), name: z.string().default("") }).partial().nullish(),
  agents: z.array(z.object({ agent: z.object({ id: z.string(), name: z.string().default("") }).partial() })).catch([]).default([]),
}).passthrough();

function lerSkill(bruto: unknown): SkillDoConsole | null {
  const r = SkillBrutaSchema.safeParse(bruto);
  if (!r.success) return null;
  const s = r.data;
  return {
    id: s.id, nome: s.name, descricao: s.description, categoria: s.category, instrucoes: s.promptInstructions,
    origem: s.source, parametros: s.parameters, toolId: s.toolId, toolNome: s.tool?.name ?? null,
    metodo: s.httpMethod, caminho: s.httpPath, corpo: s.httpBodyTemplate, timeoutMs: s.timeoutMs,
    versao: s.currentVersion, ativa: s.isActive,
    agentes: s.agents.map(a => ({ id: a.agent?.id ?? "", nome: a.agent?.name ?? "" })).filter(a => a.id),
    daPonte: (SKILLS_DA_PONTE as readonly string[]).includes(s.name),
  };
}

export async function listarSkillsDoConsole(providerId: number): Promise<{ skills: SkillDoConsole[] }> {
  const { orgId } = await organizacao(providerId);
  const bruto = exigir(await cliente().listarSkills(orgId), "Não foi possível listar as skills");
  return { skills: (Array.isArray(bruto) ? bruto : []).map(lerSkill).filter((s): s is SkillDoConsole => s !== null) };
}

async function skillDoProvedor(providerId: number, skillId: string): Promise<SkillDoConsole> {
  const { skills } = await listarSkillsDoConsole(providerId);
  const skill = skills.find(s => s.id === skillId);
  if (!skill) throw new ErroDaPonteDoChat("CASO_NAO_ENCONTRADO", "Skill não encontrada neste provedor");
  return skill;
}

/** A skill só chama a conexão do próprio provedor — o `toolId` é conferido na lista dele. */
async function conferirTool(providerId: number, toolId: string) {
  const tool = await toolDoProvedor(providerId, toolId);
  if (!tool.ativa) throw new ErroDaPonteDoChat("CONFLITO", "A conexão escolhida está desativada");
}

export async function criarSkillDoConsole(providerId: number, entrada: SkillDoConsoleEntrada): Promise<SkillDoConsole> {
  await conferirTool(providerId, entrada.toolId);
  if ((SKILLS_DA_PONTE as readonly string[]).includes(entrada.nome)) {
    throw new ErroDaPonteDoChat("CONFLITO", `"${entrada.nome}" é o nome de uma skill da cobrança. Escolha outro.`);
  }
  const { orgId } = await organizacao(providerId);
  const criada = exigir(await cliente().criarSkill(orgId, corpoDaSkill(entrada)), "Não foi possível criar a skill");
  const skill = lerSkill(criada);
  if (!skill) throw new ErroDaPonteDoChat("CHAT_FALHOU", "Skill criada, mas o Chat BullQ devolveu um formato inesperado");
  return skill;
}

function corpoDaSkill(e: SkillDoConsoleEntrada) {
  return {
    nome: e.nome, descricao: e.descricao, toolId: e.toolId, parameters: e.parametros,
    httpMethod: e.metodo, httpPath: e.caminho,
    ...(e.categoria ? { categoria: e.categoria } : {}),
    ...(e.instrucoes ? { promptInstructions: e.instrucoes } : {}),
    ...(e.corpo ? { httpBodyTemplate: e.corpo } : {}),
    ...(e.timeoutMs !== undefined ? { timeoutMs: e.timeoutMs } : {}),
    ...(e.ativa !== undefined ? { isActive: e.ativa } : {}),
    ...(e.nota ? { changeNote: e.nota } : {}),
  };
}

export async function atualizarSkillDoConsole(providerId: number, skillId: string, entrada: SkillDoConsoleEntrada): Promise<SkillDoConsole> {
  const atual = await skillDoProvedor(providerId, skillId);
  if (atual.daPonte) throw new ErroDaPonteDoChat("CONFLITO", `"${atual.nome}" é uma skill da cobrança: o prompt do agente a chama por esse nome.`);
  await conferirTool(providerId, entrada.toolId);
  const { orgId } = await organizacao(providerId);
  const corpo = corpoDaSkill(entrada);
  exigir(await cliente().atualizarSkill(orgId, skillId, {
    name: corpo.nome, description: corpo.descricao, source: "HTTP", toolId: corpo.toolId,
    parameters: corpo.parameters, httpMethod: corpo.httpMethod, httpPath: corpo.httpPath,
    ...(corpo.categoria ? { category: corpo.categoria } : {}),
    ...(corpo.promptInstructions ? { promptInstructions: corpo.promptInstructions } : {}),
    ...(corpo.httpBodyTemplate ? { httpBodyTemplate: corpo.httpBodyTemplate } : {}),
    ...(corpo.timeoutMs !== undefined ? { timeoutMs: corpo.timeoutMs } : {}),
    ...(corpo.isActive !== undefined ? { isActive: corpo.isActive } : {}),
    ...(corpo.changeNote ? { changeNote: corpo.changeNote } : {}),
  }), "Não foi possível salvar a skill");
  return skillDoProvedor(providerId, skillId);
}

export async function apagarSkillDoConsole(providerId: number, skillId: string): Promise<void> {
  const atual = await skillDoProvedor(providerId, skillId);
  if (atual.daPonte) throw new ErroDaPonteDoChat("CONFLITO", `"${atual.nome}" é uma skill da cobrança e não se apaga por aqui.`);
  const { orgId } = await organizacao(providerId);
  exigir(await cliente().apagarSkill(orgId, skillId), "Não foi possível remover a skill");
}

const VersaoBrutaSchema = z.object({
  id: z.string().min(1),
  version: z.coerce.number().int().catch(1).default(1),
  name: z.string().default(""),
  description: z.string().default(""),
  httpMethod: texto,
  httpPath: texto,
  changeNote: texto,
  createdAt: texto,
}).passthrough();

export async function versoesDaSkillDoConsole(providerId: number, skillId: string): Promise<{ versoes: VersaoDaSkill[] }> {
  await skillDoProvedor(providerId, skillId);
  const { orgId } = await organizacao(providerId);
  const bruto = exigir(await cliente().versoesDaSkill(orgId, skillId), "Não foi possível listar as versões da skill");
  const versoes = (Array.isArray(bruto) ? bruto : []).map(v => {
    const r = VersaoBrutaSchema.safeParse(v);
    if (!r.success) return null;
    return {
      id: r.data.id, versao: r.data.version, nome: r.data.name, descricao: r.data.description,
      metodo: r.data.httpMethod, caminho: r.data.httpPath, nota: r.data.changeNote, criadaEm: r.data.createdAt,
    };
  }).filter((v): v is VersaoDaSkill => v !== null);
  return { versoes };
}

// ---------------------------------------------------------------- skills do agente

export async function skillsDoAgenteDoConsole(providerId: number, agenteId: string): Promise<{ ligadas: { skillId: string; nome: string; exigeAprovacao: boolean }[] }> {
  const { orgId } = await organizacao(providerId);
  const bruto = exigir(await cliente().listarSkillsDoAgente(orgId, agenteId), "Não foi possível listar as skills do agente");
  const Schema = z.object({
    skillId: z.string().min(1),
    requiresApproval: z.boolean().catch(false).default(false),
    skill: z.object({ name: z.string().default("") }).partial().nullish(),
  }).passthrough();
  const ligadas = (Array.isArray(bruto) ? bruto : []).map(v => {
    const r = Schema.safeParse(v);
    return r.success ? { skillId: r.data.skillId, nome: r.data.skill?.name ?? "", exigeAprovacao: r.data.requiresApproval } : null;
  }).filter((v): v is { skillId: string; nome: string; exigeAprovacao: boolean } => v !== null);
  return { ligadas };
}

/**
 * Substitui o conjunto de skills do agente. O fork apaga e recria os vínculos,
 * então mandar a lista errada tira uma skill sem aviso — a tela manda sempre a
 * lista inteira, nunca um delta.
 */
export async function definirSkillsDoAgenteDoConsole(providerId: number, agenteId: string, skillIds: string[]): Promise<void> {
  return comTravaDaConfiguracaoDoChat(providerId, async () => {
    const { orgId, agenteConfig } = await organizacao(providerId);
    if (idsDaPonte(agenteConfig).has(agenteId)) {
      throw new ErroDaPonteDoChat("CONFLITO", "As skills dos perfis da cobrança são as que o prompt deles exige e não se trocam por aqui.");
    }
    const { skills } = await listarSkillsDoConsole(providerId);
    const conhecidas = new Set(skills.map(s => s.id));
    const desconhecida = skillIds.find(id => !conhecidas.has(id));
    if (desconhecida) throw new ErroDaPonteDoChat("CONFLITO", "Uma das skills escolhidas não pertence a este provedor");
    exigir(await cliente().ligarSkillsAoAgente(orgId, agenteId, skillIds), "Não foi possível salvar as skills do agente");
  });
}

export async function definirAprovacaoDaSkillDoConsole(providerId: number, agenteId: string, skillId: string, exigeAprovacao: boolean): Promise<void> {
  const { orgId } = await organizacao(providerId);
  exigir(await cliente().definirAprovacaoDaSkill(orgId, agenteId, skillId, exigeAprovacao), "Não foi possível mudar a aprovação da skill");
}

// ---------------------------------------------------------------- execuções

const ExecucaoBrutaSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().default(""),
  conversationId: z.string().default(""),
  modelId: z.string().default(""),
  status: z.enum(["RUNNING", "COMPLETED", "FAILED", "SKIPPED"]).catch("COMPLETED"),
  finalAction: texto,
  errorMessage: texto,
  inputTokens: z.coerce.number().catch(0).default(0),
  outputTokens: z.coerce.number().catch(0).default(0),
  costUsd: z.coerce.number().catch(0).default(0),
  durationMs: z.coerce.number().nullish(),
  startedAt: z.string().default(""),
  agent: z.object({ name: z.string().default("") }).partial().nullish(),
  toolCalls: z.array(z.object({
    id: z.string().default(""),
    toolName: z.string().default(""),
    error: texto,
    durationMs: z.coerce.number().nullish(),
    output: z.unknown().nullish(),
  }).partial()).catch([]).default([]),
  failedToolCalls: z.coerce.number().nullish(),
}).passthrough();

/** Uma chamada falhou se deu erro OU se a resposta trouxe `ok:false` — o fork já conta, mas nem sempre. */
function chamadaFalhou(erro: string | null, saida: unknown): boolean {
  if (erro) return true;
  if (saida && typeof saida === "object" && !Array.isArray(saida)) {
    const o = saida as Record<string, unknown>;
    if (o.ok === false) return true;
    if (typeof o.status === "number" && o.status >= 400) return true;
  }
  return false;
}

export async function listarExecucoesDoConsole(
  providerId: number,
  filtros: { agenteId?: string; status?: string; periodo?: string; soComErro?: boolean; limite?: number },
): Promise<{ execucoes: ExecucaoDoAgente[] }> {
  const { orgId } = await organizacao(providerId);
  const bruto = exigir(await cliente().listarExecucoes(orgId, {
    agentId: filtros.agenteId, status: filtros.status, period: filtros.periodo,
    hasErrors: filtros.soComErro ? "1" : undefined, limit: filtros.limite ?? 50,
  }), "Não foi possível listar as execuções");
  const execucoes = (Array.isArray(bruto) ? bruto : []).map(v => {
    const r = ExecucaoBrutaSchema.safeParse(v);
    if (!r.success) return null;
    const e = r.data;
    const chamadas = e.toolCalls.map(c => {
      const falhou = chamadaFalhou(c.error ?? null, c.output);
      return { id: c.id ?? "", ferramenta: c.toolName ?? "", erro: c.error ?? null, duracaoMs: c.durationMs ?? null, falhou };
    });
    return {
      id: e.id, agenteId: e.agentId, agenteNome: e.agent?.name ?? "agente", conversaId: e.conversationId,
      modelo: e.modelId, status: e.status, desfecho: e.finalAction, erro: e.errorMessage,
      tokens: e.inputTokens + e.outputTokens, custoUsd: e.costUsd, duracaoMs: e.durationMs ?? null,
      iniciadaEm: e.startedAt, chamadas,
      falhasDeFerramenta: e.failedToolCalls ?? chamadas.filter(c => c.falhou).length,
    };
  }).filter((e): e is ExecucaoDoAgente => e !== null);
  return { execucoes };
}

const ResumoBrutoSchema = z.object({
  period: z.enum(["24h", "7d", "30d"]).catch("7d"),
  runs: z.object({
    total: z.coerce.number().catch(0).default(0),
    completed: z.coerce.number().catch(0).default(0),
    failed: z.coerce.number().catch(0).default(0),
    skipped: z.coerce.number().catch(0).default(0),
    successRate: z.coerce.number().nullish(),
  }).partial().default({}),
  tokens: z.object({ total: z.coerce.number().catch(0).default(0) }).partial().default({}),
  cost: z.object({ usd: z.coerce.number().catch(0).default(0), avgPerRun: z.coerce.number().catch(0).default(0) }).partial().default({}),
  latency: z.object({ p50: z.coerce.number().nullish(), p95: z.coerce.number().nullish() }).partial().default({}),
  byAgent: z.array(z.object({
    agentId: z.string().default(""), runs: z.coerce.number().catch(0).default(0),
    tokens: z.coerce.number().catch(0).default(0), cost: z.coerce.number().catch(0).default(0),
  }).partial()).catch([]).default([]),
  byFinalAction: z.record(z.string(), z.coerce.number()).catch({}).default({}),
  tools: z.array(z.object({ name: z.string().default(""), calls: z.coerce.number().catch(0).default(0) }).partial()).catch([]).default([]),
}).passthrough();

export async function resumoDoConsole(providerId: number, periodo: PeriodoDoConsole): Promise<ResumoDoConsole> {
  const { orgId } = await organizacao(providerId);
  const bruto = exigir(await cliente().estatisticasDaOrganizacao(orgId, periodo), "Não foi possível carregar o resumo");
  const r = ResumoBrutoSchema.safeParse(bruto);
  if (!r.success) throw new ErroDaPonteDoChat("CHAT_FALHOU", "O Chat BullQ devolveu um resumo em formato inesperado");
  const d = r.data;
  // O feed traz o agentId; o nome vem da lista, que já está no console.
  const { agentes } = await listarAgentesDoConsole(providerId);
  const nomes = new Map(agentes.map(a => [a.id, a.nome]));
  return {
    periodo: d.period,
    execucoes: {
      total: d.runs.total ?? 0, concluidas: d.runs.completed ?? 0, falhas: d.runs.failed ?? 0,
      puladas: d.runs.skipped ?? 0, taxaSucesso: d.runs.successRate ?? null,
    },
    tokens: d.tokens.total ?? 0,
    custoUsd: d.cost.usd ?? 0,
    custoMedioUsd: d.cost.avgPerRun ?? 0,
    latencia: { p50: d.latency.p50 ?? null, p95: d.latency.p95 ?? null },
    porAgente: d.byAgent.map(a => ({
      agenteId: a.agentId ?? "", nome: nomes.get(a.agentId ?? "") ?? "agente removido",
      execucoes: a.runs ?? 0, tokens: a.tokens ?? 0, custoUsd: a.cost ?? 0,
    })),
    porDesfecho: d.byFinalAction,
    ferramentas: d.tools.map(t => ({ nome: t.name ?? "", chamadas: t.calls ?? 0 })),
  };
}

/** Só para teste: o limite de caracteres que a tela mostra vem do shared. */
export const LIMITES = LIMITES_DO_CONSOLE;
