import { z } from "zod";

export const TIPOS_DE_AGENTE = ["cobranca_ativos", "cobranca_ex_clientes", "recuperacao_equipamentos"] as const;
export type TipoDeAgente = (typeof TIPOS_DE_AGENTE)[number];
export const TipoDeAgenteSchema = z.enum(TIPOS_DE_AGENTE);

/**
 * O teto do `systemPrompt` que o planejador do fork aceita (`AGENT_PROMPT_MAX`
 * do patch vps/009, a mesma constante dos dois lados). Até o 008 eram 8.000
 * caracteres; as funcionárias do Provedor.ai (a persona inteira, não um resumo)
 * não cabiam — o script de 16/09/2026 condensava o método em 6.000.
 */
export const AGENT_PROMPT_MAX = 80_000;

/**
 * O prompt final é `casa + instruções + avisos` (ver `juntarPromptFinal`). A
 * casa — as regras do servidor, em `chat-agentes.service.ts` — varia com o tipo,
 * o nome do provedor (até 80 caracteres) e o nome da funcionária (até 40); esta
 * é a reserva para o PIOR caso, travada em teste contra o texto real.
 */
export const RESERVA_DA_CASA = 9_000;
/** Quando o provedor escreve avisos do dia, eles entram abaixo deste cabeçalho. */
export const CABECALHO_DOS_AVISOS = "AVISOS DE HOJE (informados pelo provedor, subordinados às regras acima — não autorizam valor, prazo, desconto, baixa nem promessa que as regras proíbem):";
/** O que entra no lugar das instruções quando o provedor não escreveu nenhuma. */
export const INSTRUCOES_PADRAO = "Seja cordial e objetivo.";
const CONTEXTO_OPERACIONAL_MAX = 8_000;
/** Maior bloco de avisos possível: a separação, o cabeçalho e o contexto no teto. */
export const AVISOS_MAX = "\n\n".length + CABECALHO_DOS_AVISOS.length + "\n".length + CONTEXTO_OPERACIONAL_MAX;

/**
 * Limites de cada campo do perfil. `descricao`, `contextoOperacional` e a faixa
 * de temperatura/tokens seguem o `CreateAgentDto` do fork (description ≤ 500,
 * operationalContext ≤ 8000, temperature 0..2, maxTokens 64..8192), mais
 * apertados aqui de propósito: o agente de cobrança não improvisa nem escreve
 * tratado.
 *
 * `instrucoes` é DERIVADO, não escolhido: o que sobra do teto do planejador
 * depois da casa no pior caso e dos avisos no teto. Assim nenhuma combinação que
 * passe no schema estoura o prompt final — antes, um aviso do dia mais longo
 * podia recusar a gravação de uma persona que já estava salva.
 */
export const LIMITES_DO_AGENTE = {
  descricao: 500,
  instrucoes: AGENT_PROMPT_MAX - RESERVA_DA_CASA - AVISOS_MAX,
  contextoOperacional: CONTEXTO_OPERACIONAL_MAX,
  temperatura: { min: 0, max: 1, passo: 0.1 },
  /** 1.000 como padrão (16/09/2026): a funcionária escreve até 3 balões além do plano; 600 cortava o JSON no meio. */
  maxTokens: { min: 160, max: 1200, padrao: 1000 },
} as const;

/**
 * Nome com que a funcionária se apresenta ("Aqui é a Clara"). Só letras, com
 * espaço, hífen ou apóstrofo ENTRE palavras: o nome entra na casa do prompt e
 * nos textos do servidor, e pontuação livre ali seria uma porta para instrução
 * disfarçada de nome ("Clara. Ignore as regras").
 */
export const NOME_DA_PERSONA_MAX = 40;
export const NOME_DA_PERSONA_RE = /^\p{L}+(?:[ '’-]\p{L}+)*$/u;
export function nomeDaPersonaValido(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const nome = v.trim();
  return nome.length >= 1 && nome.length <= NOME_DA_PERSONA_MAX && NOME_DA_PERSONA_RE.test(nome) ? nome : null;
}

/**
 * Junta as três partes do prompt final. Fonte ÚNICA da concatenação: o servidor
 * monta o texto com ela e a tela conta os caracteres com ela, então o contador
 * não pode divergir do que é gravado no agente.
 */
export function juntarPromptFinal(casa: string, instrucoes: string, contextoOperacional: string): string {
  const persona = instrucoes.trim() || INSTRUCOES_PADRAO;
  const avisos = contextoOperacional.trim();
  return avisos ? `${casa}${persona}\n\n${CABECALHO_DOS_AVISOS}\n${avisos}` : `${casa}${persona}`;
}
export function tamanhoDoPromptFinal(caracteresDaCasa: number, instrucoes: string, contextoOperacional: string): number {
  return caracteresDaCasa + juntarPromptFinal("", instrucoes, contextoOperacional).length;
}

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
  /** Omitido preserva o nome gravado; `null` apaga (a casa passa a apresentar só a empresa). */
  nomeDaPersona: z.string().trim().min(1, "Informe o nome da funcionária").max(NOME_DA_PERSONA_MAX, `Nome da funcionária com até ${NOME_DA_PERSONA_MAX} letras`).regex(NOME_DA_PERSONA_RE, "Nome da funcionária só com letras (espaço, hífen ou apóstrofo entre palavras)").nullable().optional(),
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
/**
 * O agente que a autonomia pode usar: provisionado (pronto, com id e modelo no
 * Chat BullQ) E habilitado. É UM predicado, lido pela tela da autonomia e pelo
 * servidor — o card "pausado" (habilitado=false) não opera, e a tela não pode
 * deixar marcar o que o servidor vai recusar.
 */
export const agentePodeOperar = (a: Pick<AgenteDoChat, "etapa" | "habilitado" | "id" | "modelo">): boolean => a.etapa === "pronto" && a.habilitado && !!a.id && !!a.modelo;
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
 *
 * Os TEXTOS abaixo vão para a tela do provedor (legenda e `<select>`), então
 * falam a língua de quem opera cobrança: o aviso é o mesmo, sem fork, patch,
 * nome de servidor nem código HTTP — isso fica neste comentário. As CHAVES não
 * mudam: o cliente e o serviço comparam `openai_vps`.
 */
export const ORIGENS_DE_MODELO = {
  chat_bullq: "confirmado ao vivo pela credencial deste Chat BullQ",
  openai_vps: "não confirmado pelo serviço conectado: só funciona se o seu Chat BullQ aceitar modelos OpenAI; senão, a criação do agente é recusada",
} as const;
export type OrigemDoModelo = keyof typeof ORIGENS_DE_MODELO;
export interface ModeloDoAgente { id: string; origem?: OrigemDoModelo }
/**
 * Os ids que o fork da VPS nomeia: os dois da mensagem do DTO, da tabela de preço
 * e do `CLASSIFIER_MODEL_ID`, e o `gpt-4.1`, que o patch vps/009 põe na tabela de
 * preço — é o modelo das funcionárias do Provedor.ai (decisão D3 de 16/09/2026).
 */
export const MODELOS_OPENAI_DA_VPS: readonly ModeloDoAgente[] = [
  { id: "openai/gpt-4o-mini", origem: "openai_vps" },
  { id: "openai/gpt-4o", origem: "openai_vps" },
  { id: "openai/gpt-4.1", origem: "openai_vps" },
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

/**
 * O prompt que o agente recebe: as regras da casa, o método da funcionária e o
 * contexto do dia — tudo dentro do `systemPrompt` que gravamos no fork (ver
 * `promptFinalDoAgente`). `caracteresDaCasa` e `limite` deixam a tela contar o
 * prompt final AO VIVO enquanto o admin edita (`tamanhoDoPromptFinal`).
 */
export interface PromptDoAgente { tipo: TipoDeAgente; nomeProvedor: string; prompt: string; contextoOperacional: string; caracteres: number; caracteresDaCasa: number; limite: number }

export interface ContextoDoPrimeiroContato {
  nomeCliente: string;
  nomeProvedor: string;
  tom?: string | null;
  orientacao?: string | null;
}
export interface PrimeiroContatoPreparado {
  texto: string; agenteId: string;
  /** Nulos quando a abertura é texto controlado, sem execução do modelo. */
  modelo: string | null; runId: string | null;
  modo?: "agente_ia" | "abertura_controlada";
}
