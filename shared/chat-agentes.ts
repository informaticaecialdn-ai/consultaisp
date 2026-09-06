import { z } from "zod";

export const TIPOS_DE_AGENTE = ["cobranca_ativos", "cobranca_ex_clientes", "recuperacao_equipamentos"] as const;
export type TipoDeAgente = (typeof TIPOS_DE_AGENTE)[number];
export const TipoDeAgenteSchema = z.enum(TIPOS_DE_AGENTE);

/**
 * Limites de cada campo do perfil, os mesmos do `AiAgent` do fork do Chat BullQ
 * (`CreateAgentDto`: description ≤ 500, operationalContext ≤ 8000, temperature
 * 0..2, maxTokens 64..8192). Temperatura e orçamento ficam mais apertados aqui
 * de propósito: o agente de cobrança não improvisa nem escreve tratado.
 */
export const LIMITES_DO_AGENTE = {
  descricao: 500,
  instrucoes: 6000,
  contextoOperacional: 8000,
  temperatura: { min: 0, max: 1, passo: 0.1 },
  maxTokens: { min: 160, max: 1200 },
} as const;

/**
 * O que o fork do Chat BullQ na VPS aceita em `AiAgent.modelId`
 * (`SUPPORTED_MODEL_ID_PATTERN` em `llm/llm.constants.ts`, lido em 06/09/2026):
 * Sakana (`sakana/<id>`, `fugu`, `fugu-*`) ou OpenAI (`openai/<id>`, `gpt-*`).
 * Anthropic e Google ficam fora — aquele deploy não fala com essas APIs.
 */
export const PADRAO_DE_MODELO_DO_FORK = /^(sakana\/\S+|fugu(?:-\S+)?|openai\/\S+|gpt-\S+)$/;

export const ConfiguracaoDeAgenteSchema = z.object({
  modelo: z.string().trim().min(1).max(160).regex(PADRAO_DE_MODELO_DO_FORK, "Modelo fora do formato aceito pelo Chat BullQ (sakana/…, fugu…, openai/… ou gpt-…)").nullable(),
  descricao: z.string().trim().max(LIMITES_DO_AGENTE.descricao).default(""),
  instrucoes: z.string().trim().max(LIMITES_DO_AGENTE.instrucoes).default(""),
  contextoOperacional: z.string().trim().max(LIMITES_DO_AGENTE.contextoOperacional).default(""),
  habilitado: z.boolean().default(true),
  temperatura: z.number().min(LIMITES_DO_AGENTE.temperatura.min).max(LIMITES_DO_AGENTE.temperatura.max).optional(),
  maxTokens: z.number().int().min(LIMITES_DO_AGENTE.maxTokens.min).max(LIMITES_DO_AGENTE.maxTokens.max).optional(),
}).strict();
export type ConfiguracaoDeAgente = z.infer<typeof ConfiguracaoDeAgenteSchema>;

/** `papel` é o que o agente faz na carteira; `descricao` (configurável) é como o provedor o apresenta. */
export const CATALOGO_DE_AGENTES: Record<TipoDeAgente, { nome: string; papel: string }> = {
  cobranca_ativos: { nome: "Cobrança · clientes ativos", papel: "Abre o contato com clientes com contrato ativo, seguindo a régua e o tom do DNA." },
  cobranca_ex_clientes: { nome: "Cobrança · ex-clientes", papel: "Abre o contato sobre pendências após o encerramento, sem confundir dívida com devolução." },
  recuperacao_equipamentos: { nome: "Recuperação de equipamentos", papel: "Abre o contato sobre devolução. A equipe combina retirada e registra a recuperação." },
};
export interface AgenteDoChat extends ConfiguracaoDeAgente {
  tipo: TipoDeAgente;
  nome: string;
  papel: string;
  id: string | null;
  etapa: "nao_configurado" | "configurado" | "criando" | "criado" | "pronto" | "erro";
  erro: string | null;
  atualizadoEm: string | null;
  criacaoIniciada?: boolean;
  importadoDe?: { id: string; nome: string } | null;
}
export interface AgenteImportavel { id: string; nome: string; modelo: string }

/**
 * De onde vem cada modelo oferecido — e o que a origem GARANTE, que não é a
 * mesma coisa nas duas.
 *
 * `chat_bullq` é o que o serviço conectado confirmou ao vivo: vale em qualquer
 * linhagem do fork, porque foi ele mesmo que listou.
 *
 * `openai_vps` é conhecimento local, não confirmação: a VPS roda o fork
 * patchado para OpenAI e aceita `openai/*` (lido em `llm.constants.ts` e
 * `llm-pricing.ts` daquele deploy, 06/09/2026), mas a linhagem que ESTE
 * repositório distribui — patches 000+001+002, `integrations/chat-bullq/local`
 * — recusa `openai/*` com 400, e o catálogo do patch 002 só lista `fugu*`.
 * Quem sobe o ambiente local documentado e escolhe um id OpenAI leva 400. Por
 * isso a origem viaja com o modelo até o `<select>`: o padrão oferecido é o que
 * o serviço conectado confirmou; o id OpenAI só é seguro onde o fork foi
 * patchado para OpenAI.
 */
export const ORIGENS_DE_MODELO = {
  chat_bullq: "confirmado ao vivo pela credencial deste Chat BullQ",
  openai_vps: "conhecido só do fork patchado para OpenAI (a VPS); a linhagem dos patches 000+001+002 recusa openai/* com 400",
} as const;
export type OrigemDoModelo = keyof typeof ORIGENS_DE_MODELO;
export interface ModeloDoAgente { id: string; origem?: OrigemDoModelo }
/** Os dois ids que o fork da VPS nomeia (mensagem do DTO, tabela de preço e `CLASSIFIER_MODEL_ID`). */
export const MODELOS_OPENAI_DA_VPS: readonly ModeloDoAgente[] = [
  { id: "openai/gpt-4o-mini", origem: "openai_vps" },
  { id: "openai/gpt-4o", origem: "openai_vps" },
];
export interface ModelosDosAgentes { configured: boolean; models: ModeloDoAgente[]; origens?: Record<OrigemDoModelo, string> }

/**
 * Junta a lista ao vivo do Chat BullQ com o catálogo local, sem repetir id e
 * marcando a origem de cada um.
 *
 * `configured` é REPETIDO do Chat BullQ, nunca deduzido: se o serviço diz que
 * não há credencial de IA, `configured` continua `false` mesmo com modelos
 * listados aqui. Deduzi-lo do tamanho da lista escondia o alerta de credencial
 * ausente e deixava o card anunciar "pronto para preparar" um agente que não
 * tem com o que rodar (na VPS a `OPENAI_API_KEY` está presente e vazia).
 */
export function catalogoDeModelos(doChat: { configured: boolean; models: { id: string }[] }, locais: readonly ModeloDoAgente[] = MODELOS_OPENAI_DA_VPS): ModelosDosAgentes {
  const vistos = new Set<string>();
  const models: ModeloDoAgente[] = [];
  for (const m of doChat.configured ? doChat.models : []) {
    if (vistos.has(m.id)) continue;
    vistos.add(m.id); models.push({ id: m.id, origem: "chat_bullq" });
  }
  for (const m of locais) {
    if (vistos.has(m.id) || !PADRAO_DE_MODELO_DO_FORK.test(m.id)) continue;
    vistos.add(m.id); models.push({ id: m.id, origem: m.origem ?? "openai_vps" });
  }
  return { configured: doChat.configured, models, origens: ORIGENS_DE_MODELO };
}

/** O prompt que o agente recebe: as regras da casa, as preferências do provedor e o contexto do dia — tudo dentro do `systemPrompt` que gravamos no fork (ver `promptFinalDoAgente`). */
export interface PromptDoAgente { tipo: TipoDeAgente; nomeProvedor: string; prompt: string; contextoOperacional: string; caracteres: number }

export interface ContextoDoPrimeiroContato {
  nomeCliente: string;
  nomeProvedor: string;
  tom?: string | null;
  orientacao?: string | null;
}
export interface PrimeiroContatoPreparado { texto: string; agenteId: string; modelo: string; runId: string }
