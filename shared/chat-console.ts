/**
 * O console de agentes — o mesmo do Chat BullQ (`/ai-agents`), agora dentro do
 * Consulta ISP e por provedor.
 *
 * O fork continua sendo a LOJA e o EXECUTOR: `ai_agents`, `ai_skills`,
 * `ai_tools` e as execuções vivem lá, uma organização por provedor. O que muda
 * é a porta: quem configura entra pelo Consulta ISP, com a sessão do provedor,
 * e nunca vê o token da organização.
 *
 * Os limites abaixo são os do fork, campo a campo (`CreateAgentDto`,
 * `UpsertSkillDto`, `UpsertToolDto`, lidos em 07/09/2026). Repetir aqui não é
 * duplicação boba: é o que faz a tela recusar antes de gastar uma ida à VPS e
 * transformar `400 Bad Request` em frase em português.
 *
 * Duas travas são NOSSAS, não do fork:
 *
 * 1. **Tool só HTTP.** O fork aceita `CUSTOM_SQL` — uma conexão de banco que a
 *    skill usa para rodar query. Contra o nosso Postgres isso entrega a base
 *    inteira: quem escreve a query escolhe se filtra por `provider_id`, e o
 *    isolamento multi-tenant deixa de existir por configuração de tela. Fica de
 *    fora do schema, não escondido na UI.
 * 2. **Allowlist de host.** Uma skill é uma chamada HTTP que o FORK faz com os
 *    headers que alguém configurou. Sem lista de hosts permitidos, qualquer
 *    admin aponta a tool para um servidor dele e recebe as chaves de dentro do
 *    header — e ainda usa a VPS como proxy para a rede interna. O host tem que
 *    estar na lista do superadmin, ser https e não ser endereço privado.
 */
import { z } from "zod";

// ---------------------------------------------------------------- agentes

export const TIPOS_DE_AGENTE_DO_CONSOLE = ["WORKER", "ORCHESTRATOR"] as const;
export type TipoDeAgenteDoConsole = (typeof TIPOS_DE_AGENTE_DO_CONSOLE)[number];

export const ROTULO_DO_TIPO: Record<TipoDeAgenteDoConsole, { nome: string; papel: string }> = {
  WORKER: { nome: "Executor", papel: "Atende a conversa e chama as skills que você autorizou." },
  ORCHESTRATOR: { nome: "Orquestrador", papel: "Recebe primeiro e delega ao executor certo do organograma." },
};

/** Os departamentos do organograma. String livre no banco do fork; a lista padroniza o agrupamento. */
export const DEPARTAMENTOS = [
  "COBRANCA", "SUPORTE", "VENDAS", "RETENCAO", "FINANCEIRO", "OPERACOES", "TECNOLOGIA", "OUTRO",
] as const;
export type Departamento = (typeof DEPARTAMENTOS)[number];

export const ROTULO_DO_DEPARTAMENTO: Record<string, string> = {
  COBRANCA: "Cobrança", SUPORTE: "Suporte", VENDAS: "Vendas", RETENCAO: "Retenção",
  FINANCEIRO: "Financeiro", OPERACOES: "Operações", TECNOLOGIA: "Tecnologia", OUTRO: "Outro",
};

/** Dot categórico por departamento — `--cat-*` do design system, nunca fundo colorido. */
export const COR_DO_DEPARTAMENTO: Record<string, string> = {
  COBRANCA: "var(--cat-indigo)", SUPORTE: "var(--cat-blue)", VENDAS: "var(--cat-green)",
  RETENCAO: "var(--cat-violet)", FINANCEIRO: "var(--cat-teal)", OPERACOES: "var(--cat-amber)",
  TECNOLOGIA: "var(--cat-navy)", OUTRO: "var(--cat-slate)",
};

export const LIMITES_DO_CONSOLE = {
  agente: {
    nome: { min: 2, max: 80 },
    descricao: 500,
    categoria: 50,
    departamento: 40,
    squad: 60,
    instrucoes: { min: 10, max: 20000 },
    contextoOperacional: 8000,
    temperatura: { min: 0, max: 2, passo: 0.1 },
    maxTokens: { min: 64, max: 8192 },
    capacidades: 12,
  },
  skill: {
    nome: { min: 2, max: 60 },
    descricao: { min: 10, max: 2000 },
    categoria: 40,
    instrucoes: 4000,
    caminho: 400,
    corpo: 8000,
    timeoutMs: { min: 500, max: 60000 },
    parametros: 8000,
  },
  tool: {
    nome: { min: 2, max: 60 },
    descricao: { min: 5, max: 500 },
    baseUrl: 300,
    headers: 12,
  },
} as const;

/**
 * O `modelId` que a VPS aceita (`SUPPORTED_MODEL_ID_PATTERN` do fork): Sakana ou
 * OpenAI. Anthropic e Google não — aquele deploy não fala com essas APIs.
 */
export const PADRAO_DE_MODELO_DO_CONSOLE = /^(sakana\/\S+|fugu(?:-\S+)?|openai\/\S+|gpt-\S+)$/;

export const MODELOS_SUGERIDOS = [
  { id: "openai/gpt-4o-mini", rotulo: "GPT-4o mini", nota: "Recomendado · rápido e barato" },
  { id: "openai/gpt-4o", rotulo: "GPT-4o", nota: "Mais capaz · mais caro" },
] as const;

const nomeDoAgente = z.string().trim().min(LIMITES_DO_CONSOLE.agente.nome.min).max(LIMITES_DO_CONSOLE.agente.nome.max);
const opcional = (max: number) => z.string().trim().max(max).optional();

export const AgenteDoConsoleSchema = z.object({
  nome: nomeDoAgente,
  descricao: opcional(LIMITES_DO_CONSOLE.agente.descricao),
  tipo: z.enum(TIPOS_DE_AGENTE_DO_CONSOLE).default("WORKER"),
  categoria: opcional(LIMITES_DO_CONSOLE.agente.categoria),
  capacidades: z.array(z.string().trim().min(1).max(80)).max(LIMITES_DO_CONSOLE.agente.capacidades).optional(),
  modelo: z.string().trim().min(1).max(160)
    .regex(PADRAO_DE_MODELO_DO_CONSOLE, "Modelo fora do formato aceito pelo Chat BullQ (openai/…, gpt-…, sakana/… ou fugu…)"),
  instrucoes: z.string().trim().min(LIMITES_DO_CONSOLE.agente.instrucoes.min, "As instruções precisam de pelo menos 10 caracteres")
    .max(LIMITES_DO_CONSOLE.agente.instrucoes.max),
  contextoOperacional: opcional(LIMITES_DO_CONSOLE.agente.contextoOperacional),
  temperatura: z.number().min(LIMITES_DO_CONSOLE.agente.temperatura.min).max(LIMITES_DO_CONSOLE.agente.temperatura.max).optional(),
  maxTokens: z.number().int().min(LIMITES_DO_CONSOLE.agente.maxTokens.min).max(LIMITES_DO_CONSOLE.agente.maxTokens.max).optional(),
  respondeDireto: z.boolean().optional(),
  ativo: z.boolean().optional(),
  reportaA: z.string().trim().max(80).nullable().optional(),
  departamento: opcional(LIMITES_DO_CONSOLE.agente.departamento).nullable(),
  squad: opcional(LIMITES_DO_CONSOLE.agente.squad).nullable(),
}).strict();
export type AgenteDoConsoleEntrada = z.infer<typeof AgenteDoConsoleSchema>;

/** Edição: todo campo é opcional, mas o que vier é validado igual. */
export const AgenteDoConsoleParcialSchema = AgenteDoConsoleSchema.partial().strict()
  .refine(v => Object.keys(v).length > 0, "Nada para alterar");

export interface AgenteDoConsole {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: TipoDeAgenteDoConsole;
  categoria: string | null;
  capacidades: string[];
  modelo: string;
  instrucoes: string;
  contextoOperacional: string | null;
  contextoAtualizadoEm: string | null;
  temperatura: number;
  maxTokens: number;
  respondeDireto: boolean;
  ativo: boolean;
  reportaA: string | null;
  departamento: string | null;
  squad: string | null;
  criadoEm: string | null;
  atualizadoEm: string | null;
  canais: { id: string; canalId: string; nome: string; modo: string; gatilho: string }[];
  /** Marcado quando o agente é um dos três perfis da ponte (cobrança/equipamentos). */
  daPonte: boolean;
}

// ---------------------------------------------------------------- tools

/**
 * O host precisa estar na lista do superadmin. `null` na lista significa
 * "nenhum host liberado" — e aí só a base do próprio Consulta ISP passa, que é
 * o caso normal: a skill útil aqui chama a NOSSA API do agente.
 */
export function hostPermitido(url: string, hostsPermitidos: readonly string[]): { ok: true } | { ok: false; motivo: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, motivo: "Endereço inválido — informe uma URL completa, começando com https://" };
  }
  if (u.protocol !== "https:") return { ok: false, motivo: "Só endereços https:// — a chave do header viaja nessa chamada" };
  if (u.username || u.password) return { ok: false, motivo: "Sem usuário e senha no endereço" };
  const host = u.hostname.toLowerCase();
  if (ehEnderecoPrivado(host)) return { ok: false, motivo: "Endereço interno não é permitido" };
  const liberado = hostsPermitidos.some(h => {
    const alvo = h.trim().toLowerCase();
    return alvo && (host === alvo || host.endsWith(`.${alvo}`));
  });
  if (!liberado) {
    return {
      ok: false,
      motivo: hostsPermitidos.length
        ? `Host não liberado. Liberados: ${hostsPermitidos.join(", ")}`
        : "Nenhum host externo liberado para este provedor. Fale com o suporte para liberar um.",
    };
  }
  return { ok: true };
}

/** Loopback, link-local, faixas privadas e nomes sem ponto (host interno da rede da VPS). */
export function ehEnderecoPrivado(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;
  if (!host.includes(".")) return true;
  if (host.startsWith("[") || host.includes(":")) return true; // IPv6 literal
  const partes = host.split(".");
  if (partes.length === 4 && partes.every(p => /^\d{1,3}$/.test(p))) {
    const [a, b] = partes.map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

export const ToolDoConsoleSchema = z.object({
  nome: z.string().trim().min(LIMITES_DO_CONSOLE.tool.nome.min).max(LIMITES_DO_CONSOLE.tool.nome.max),
  descricao: z.string().trim().min(LIMITES_DO_CONSOLE.tool.descricao.min, "Descreva em uma frase para que serve esta conexão")
    .max(LIMITES_DO_CONSOLE.tool.descricao.max),
  baseUrl: z.string().trim().min(1).max(LIMITES_DO_CONSOLE.tool.baseUrl),
  headers: z.record(z.string().trim().min(1).max(80), z.string().max(500)).optional(),
  ativa: z.boolean().optional(),
}).strict();
export type ToolDoConsoleEntrada = z.infer<typeof ToolDoConsoleSchema>;

export interface ToolDoConsole {
  id: string;
  nome: string;
  descricao: string;
  baseUrl: string | null;
  /** Só os NOMES dos headers. O valor é credencial e nunca volta do servidor. */
  headers: string[];
  ativa: boolean;
  skills: number;
  /** Conexão criada pela ponte (a API do agente do Consulta ISP): não se edita nem se apaga por aqui. */
  daPonte: boolean;
}

// ---------------------------------------------------------------- skills

export const METODOS_DA_SKILL = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type MetodoDaSkill = (typeof METODOS_DA_SKILL)[number];

/** O nome que o LLM vê como nome de função — a mesma regra do fork. */
export const PADRAO_DO_NOME_DA_SKILL = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * `parameters` é o JSON Schema do input da função. Chega como texto da tela
 * (o operador digita JSON) e precisa ser objeto — o fork exige `@IsObject`.
 */
export const ParametrosDaSkillSchema = z.string().trim().max(LIMITES_DO_CONSOLE.skill.parametros)
  .transform((texto, ctx) => {
    if (!texto) return { type: "object", properties: {} } as Record<string, unknown>;
    let lido: unknown;
    try {
      lido = JSON.parse(texto);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Os parâmetros precisam ser um JSON válido" });
      return z.NEVER;
    }
    if (!lido || typeof lido !== "object" || Array.isArray(lido)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Os parâmetros precisam ser um objeto JSON Schema" });
      return z.NEVER;
    }
    return lido as Record<string, unknown>;
  });

export const SkillDoConsoleSchema = z.object({
  nome: z.string().trim().min(LIMITES_DO_CONSOLE.skill.nome.min).max(LIMITES_DO_CONSOLE.skill.nome.max)
    .regex(PADRAO_DO_NOME_DA_SKILL, "O nome vira o nome da função para o modelo: comece com letra e use só letras, números e _"),
  descricao: z.string().trim().min(LIMITES_DO_CONSOLE.skill.descricao.min, "Descreva o que a skill faz — é o que o modelo lê para decidir chamá-la")
    .max(LIMITES_DO_CONSOLE.skill.descricao.max),
  categoria: opcional(LIMITES_DO_CONSOLE.skill.categoria),
  instrucoes: opcional(LIMITES_DO_CONSOLE.skill.instrucoes),
  toolId: z.string().trim().min(1, "Escolha a conexão que a skill usa").max(80),
  parametros: ParametrosDaSkillSchema,
  metodo: z.enum(METODOS_DA_SKILL),
  caminho: z.string().trim().min(1, "Informe o caminho da chamada").max(LIMITES_DO_CONSOLE.skill.caminho),
  corpo: opcional(LIMITES_DO_CONSOLE.skill.corpo),
  timeoutMs: z.number().int().min(LIMITES_DO_CONSOLE.skill.timeoutMs.min).max(LIMITES_DO_CONSOLE.skill.timeoutMs.max).optional(),
  ativa: z.boolean().optional(),
  nota: opcional(300),
}).strict();
export type SkillDoConsoleEntrada = z.infer<typeof SkillDoConsoleSchema>;

export interface SkillDoConsole {
  id: string;
  nome: string;
  descricao: string;
  categoria: string | null;
  instrucoes: string | null;
  origem: "BUILTIN" | "HTTP" | "SQL";
  parametros: Record<string, unknown>;
  toolId: string | null;
  toolNome: string | null;
  metodo: string | null;
  caminho: string | null;
  corpo: string | null;
  timeoutMs: number;
  versao: number;
  ativa: boolean;
  agentes: { id: string; nome: string }[];
  /** Skill criada pela ponte (consultarCaso, registrarPromessa…): leitura, não edição. */
  daPonte: boolean;
}

export interface VersaoDaSkill {
  id: string;
  versao: number;
  nome: string;
  descricao: string;
  metodo: string | null;
  caminho: string | null;
  nota: string | null;
  criadaEm: string | null;
}

// ---------------------------------------------------------------- execuções

export interface ChamadaDeFerramenta {
  id: string;
  ferramenta: string;
  erro: string | null;
  duracaoMs: number | null;
  falhou: boolean;
}

export interface ExecucaoDoAgente {
  id: string;
  agenteId: string;
  agenteNome: string;
  conversaId: string;
  modelo: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
  desfecho: string | null;
  erro: string | null;
  tokens: number;
  custoUsd: number;
  duracaoMs: number | null;
  iniciadaEm: string;
  chamadas: ChamadaDeFerramenta[];
  falhasDeFerramenta: number;
}

export const PERIODOS = ["24h", "7d", "30d"] as const;
export type PeriodoDoConsole = (typeof PERIODOS)[number];

export interface ResumoDoConsole {
  periodo: PeriodoDoConsole;
  execucoes: { total: number; concluidas: number; falhas: number; puladas: number; taxaSucesso: number | null };
  tokens: number;
  custoUsd: number;
  custoMedioUsd: number;
  latencia: { p50: number | null; p95: number | null };
  porAgente: { agenteId: string; nome: string; execucoes: number; tokens: number; custoUsd: number }[];
  porDesfecho: Record<string, number>;
  ferramentas: { nome: string; chamadas: number }[];
}

/** O desfecho de uma execução, em português, para a tabela. */
export const ROTULO_DO_DESFECHO: Record<string, string> = {
  REPLIED: "Respondeu",
  DELEGATED: "Delegou",
  HANDED_BACK: "Devolveu",
  TRANSFERRED_TO_HUMAN: "Transferiu para humano",
  CLOSED_CONVERSATION: "Encerrou",
  NO_ACTION: "Sem ação",
};

export const ROTULO_DO_STATUS: Record<string, string> = {
  RUNNING: "Rodando", COMPLETED: "Concluída", FAILED: "Falhou", SKIPPED: "Pulada",
};
