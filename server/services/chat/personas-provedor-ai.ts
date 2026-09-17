/**
 * As funcionárias do Provedor.ai nos três perfis do chat (spec
 * `docs/superpowers/specs/2026-09-16-funcionario-digital-design.md`, §8, D2).
 *
 * Pedido do dono (16/09/2026): "ajustes os agentes com as mesmas descrição e
 * configurações dos agentes do provedor.ai… é um funcionário digital". O que
 * isso quer dizer aqui: o TEXTO é o do Provedor.ai — o prompt final do registry
 * gerado, a doutrina de recuperação de ativos, os blocos de runtime de voz,
 * objeções e recusa —, e só se troca, trecho a trecho, o que referencia algo que
 * o Consulta ISP não tem ou faz de outro jeito.
 *
 * Por isso a montagem é DADO, não reescrita:
 * - `integrations/provedor-ai/origem/*.txt` guarda os textos de origem verbatim
 *   (com cabeçalho arquivo:linhas e commit). O build nunca lê `F:/Provedor.ai`.
 * - `integrations/provedor-ai/adaptacoes.json` é a lista de adaptações (id,
 *   persona, trecho original, trecho novo ou remoção, motivo), aplicada em ordem.
 * - Um trecho original que não é encontrado FALHA a montagem: se alguém mexer na
 *   origem, a adaptação não passa a valer em silêncio sobre um texto diferente.
 *
 * Perfis: `cobranca_ativos` ← Clara (até D+14) + trechos da Bianca (negociação e
 * tom por quadrante, a partir de D+15); `cobranca_ex_clientes` ← Sofia;
 * `recuperacao_equipamentos` ← Mariana + a skill provedor-recuperacao-ativos.
 * Os três levam os blocos de runtime adaptados (o de recusa, não o equipamento).
 *
 * Funções puras sobre a fonte carregada. A leitura dos arquivos é separada
 * (`carregarFonteDasPersonas`), com `process.cwd()` e não `__dirname`, a mesma
 * convenção de `territorio-pontos.service.ts`: o script e os testes rodam da raiz.
 * O servidor em produção não importa este módulo — as personas chegam ao agente
 * pelo `script/configurar-personas-provedor-ai.ts`, gravadas como instruções.
 */
import { readFileSync } from "fs";
import path from "path";
import { z } from "zod";
import { LIMITES_DO_AGENTE, NOME_DA_PERSONA_RE, NOME_DA_PERSONA_MAX, type TipoDeAgente } from "@shared/chat-agentes";

export const PERSONAS_DE_ORIGEM = ["clara", "sofia", "mariana"] as const;
export type PersonaDeOrigem = (typeof PERSONAS_DE_ORIGEM)[number];
export type NomesDasPersonas = Record<PersonaDeOrigem, string>;

/** Blocos de origem. `prompt` e `descricao` são por persona; os demais são um arquivo só. */
export const BLOCOS_DE_ORIGEM = [
  "prompt", "descricao",
  "bianca-negociacao-ativa", "bianca-quadrante", "bianca-personas-de-tom", "bianca-sinais", "bianca-p2p", "bianca-objecoes",
  "recuperacao-ativos", "estilo-whatsapp", "objecoes", "recusa",
] as const;
export type BlocoDeOrigem = (typeof BLOCOS_DE_ORIGEM)[number];
const BLOCOS_POR_PERSONA: readonly BlocoDeOrigem[] = ["prompt", "descricao"];

export const PERSONA_DO_TIPO: Record<TipoDeAgente, PersonaDeOrigem> = {
  cobranca_ativos: "clara",
  cobranca_ex_clientes: "sofia",
  recuperacao_equipamentos: "mariana",
};

/** Os nomes que o dono escolheu em 16/09/2026. `--nomes clara,sofia,mariana` no script volta aos do Provedor.ai. */
export const NOMES_DO_DONO: NomesDasPersonas = { clara: "Clara", sofia: "Leonora", mariana: "Eduarda" };
export const NOMES_DO_PROVEDOR_AI: NomesDasPersonas = { clara: "Clara", sofia: "Sofia", mariana: "Mariana" };

/**
 * Os agentes do Provedor.ai que os textos de origem citam. Nenhum deles existe
 * aqui: no prompt de cada perfil só pode sobrar o nome da própria funcionária —
 * "Aqui é a Sofia" no prompt da Leonora é o modelo com dois nomes (achado f8).
 */
export const AGENTES_DO_PROVEDOR_AI = ["Clara", "Sofia", "Mariana", "Bianca", "Júlia", "Julia", "Serena", "Regina", "Marta", "Diana", "Sílvia", "Silvia", "Aurora"] as const;

/**
 * A ordem dos blocos em cada perfil. Os blocos são unidos por um separador `---`,
 * o mesmo que o gerador do registry do Provedor.ai põe entre os briefs.
 */
export const MONTAGEM: Record<TipoDeAgente, readonly BlocoDeOrigem[]> = {
  cobranca_ativos: ["prompt", "bianca-negociacao-ativa", "bianca-quadrante", "bianca-personas-de-tom", "bianca-sinais", "bianca-p2p", "bianca-objecoes", "estilo-whatsapp", "objecoes", "recusa"],
  cobranca_ex_clientes: ["prompt", "estilo-whatsapp", "objecoes", "recusa"],
  recuperacao_equipamentos: ["prompt", "recuperacao-ativos", "estilo-whatsapp", "objecoes"],
};
const SEPARADOR_DE_BLOCOS = "\n\n---\n\n";

/** Variáveis que o `novo` de uma adaptação pode usar; nenhuma sobra no resultado. */
export const VARIAVEIS = { persona: "$PERSONA", provedor: "$PROVEDOR" } as const;

const umOuVarios = <T extends z.ZodTypeAny>(item: T) => z.union([item, z.array(item).min(1)]);
export const AdaptacaoSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/, "id no formato C-01, W-10, N-SOFIA…"),
  persona: umOuVarios(z.enum(PERSONAS_DE_ORIGEM)),
  origem: z.enum(BLOCOS_DE_ORIGEM).default("prompt"),
  /** Texto exato, ou um intervalo `de`…`ate` (ambos inclusos) para remover/trocar blocos grandes. */
  original: z.union([z.string().min(1), z.object({ de: z.string().min(1), ate: z.string().min(1) }).strict()]),
  novo: z.string().optional(),
  remocao: z.literal(true).optional(),
  /** Troca TODAS as ocorrências (troca de nome, placeholder do provedor). Sem ela, o original tem de ser único. */
  todas: z.literal(true).optional(),
  motivo: z.string().min(8),
}).strict()
  .refine(a => (a.novo !== undefined) !== (a.remocao === true), { message: "cada adaptação tem `novo` OU `remocao: true`" })
  .refine(a => !a.todas || typeof a.original === "string", { message: "`todas` só vale para original em texto" });
export type Adaptacao = z.infer<typeof AdaptacaoSchema>;
const ArquivoDeAdaptacoesSchema = z.object({ versao: z.string().min(1), adaptacoes: z.array(AdaptacaoSchema).min(1) }).passthrough();

export interface FonteDasPersonas {
  /** Chave `persona.bloco` para `prompt`/`descricao`, e o nome do bloco para os demais. */
  textos: Record<string, string>;
  adaptacoes: Adaptacao[];
  versao: string;
}

export class ErroNaMontagemDaPersona extends Error {
  constructor(public readonly codigo: "ORIGEM_AUSENTE" | "ORIGINAL_NAO_ENCONTRADO" | "ORIGINAL_AMBIGUO" | "NOMES_INVALIDOS" | "RESULTADO_PROIBIDO", mensagem: string) {
    super(mensagem);
  }
}

export const DIRETORIO_PADRAO = path.join("integrations", "provedor-ai");
export const MARCADOR_DO_VERBATIM = "==== TEXTO VERBATIM ====";

/**
 * O texto depois do marcador, sem o espaço final (o arquivo termina em quebra de
 * linha; o texto de origem, nem sempre). Fim de linha vira LF antes de tudo: este
 * checkout tem `core.autocrlf=true`, e um worktree que nasce CRLF faria toda
 * adaptação com quebra de linha deixar de casar — a montagem falharia por forma,
 * não por conteúdo.
 */
export function textoDoArquivoDeOrigem(conteudoDoArquivo: string): string {
  const conteudo = conteudoDoArquivo.replace(/\r\n/g, "\n");
  const i = conteudo.indexOf(`\n${MARCADOR_DO_VERBATIM}\n`);
  if (i < 0) throw new ErroNaMontagemDaPersona("ORIGEM_AUSENTE", "arquivo de origem sem o marcador do texto verbatim");
  return conteudo.slice(i + MARCADOR_DO_VERBATIM.length + 2).trimEnd();
}

const chaveDoTexto = (persona: PersonaDeOrigem, bloco: BlocoDeOrigem) => BLOCOS_POR_PERSONA.includes(bloco) ? `${persona}.${bloco}` : bloco;

export function carregarFonteDasPersonas(raiz: string = process.cwd()): FonteDasPersonas {
  const dir = path.resolve(raiz, DIRETORIO_PADRAO);
  const textos: Record<string, string> = {};
  const ler = (chave: string) => { textos[chave] = textoDoArquivoDeOrigem(readFileSync(path.join(dir, "origem", `${chave}.txt`), "utf8")); };
  for (const bloco of BLOCOS_DE_ORIGEM) {
    if (BLOCOS_POR_PERSONA.includes(bloco)) for (const p of PERSONAS_DE_ORIGEM) ler(`${p}.${bloco}`);
    else ler(bloco);
  }
  const arquivo = ArquivoDeAdaptacoesSchema.parse(JSON.parse(readFileSync(path.join(dir, "adaptacoes.json"), "utf8")));
  const ids = new Set<string>();
  for (const a of arquivo.adaptacoes) {
    if (ids.has(a.id)) throw new ErroNaMontagemDaPersona("ORIGINAL_AMBIGUO", `adaptação repetida: ${a.id}`);
    ids.add(a.id);
  }
  return { textos, adaptacoes: arquivo.adaptacoes, versao: arquivo.versao };
}

let fonteEmCache: FonteDasPersonas | null = null;
function fontePadrao(): FonteDasPersonas {
  return fonteEmCache ??= carregarFonteDasPersonas();
}

function ocorrencias(texto: string, trecho: string): number[] {
  const achadas: number[] = [];
  for (let i = texto.indexOf(trecho); i >= 0; i = texto.indexOf(trecho, i + trecho.length)) achadas.push(i);
  return achadas;
}

/** Aplica UMA adaptação. Não achou → erro; achou mais de uma vez sem `todas` → erro. */
export function aplicarAdaptacao(texto: string, a: Adaptacao): string {
  const novo = a.remocao ? "" : a.novo!;
  if (typeof a.original === "string") {
    const achadas = ocorrencias(texto, a.original);
    if (!achadas.length) throw new ErroNaMontagemDaPersona("ORIGINAL_NAO_ENCONTRADO", `adaptação ${a.id}: trecho original não encontrado no bloco ${a.origem}`);
    if (achadas.length > 1 && !a.todas) throw new ErroNaMontagemDaPersona("ORIGINAL_AMBIGUO", `adaptação ${a.id}: trecho original aparece ${achadas.length} vezes no bloco ${a.origem}`);
    return texto.split(a.original).join(novo);
  }
  const de = ocorrencias(texto, a.original.de);
  const ate = ocorrencias(texto, a.original.ate);
  if (!de.length || !ate.length) throw new ErroNaMontagemDaPersona("ORIGINAL_NAO_ENCONTRADO", `adaptação ${a.id}: ${!de.length ? "início" : "fim"} do intervalo não encontrado no bloco ${a.origem}`);
  if (de.length > 1 || ate.length > 1) throw new ErroNaMontagemDaPersona("ORIGINAL_AMBIGUO", `adaptação ${a.id}: ${de.length > 1 ? "início" : "fim"} do intervalo aparece mais de uma vez no bloco ${a.origem}`);
  const fim = ate[0] + a.original.ate.length;
  if (fim <= de[0]) throw new ErroNaMontagemDaPersona("ORIGINAL_NAO_ENCONTRADO", `adaptação ${a.id}: o fim do intervalo vem antes do início no bloco ${a.origem}`);
  return texto.slice(0, de[0]) + novo + texto.slice(fim);
}

const personasDa = (a: Adaptacao): readonly PersonaDeOrigem[] => Array.isArray(a.persona) ? a.persona : [a.persona];

/**
 * Remover um trecho deixa linhas em branco sobrando e separadores `---` colados;
 * isso é forma, não conteúdo, e normalizar evita adaptações que só existiriam
 * para apagar quebras de linha.
 */
function normalizarForma(texto: string): string {
  return texto
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?:\n\n---)+\n\n---\n\n/g, "\n\n---\n\n")
    .replace(/^(?:---\n\n)+/, "")
    .replace(/(?:\n\n---)+$/, "")
    .trim();
}

function montarBloco(fonte: FonteDasPersonas, persona: PersonaDeOrigem, bloco: BlocoDeOrigem): string {
  const chave = chaveDoTexto(persona, bloco);
  const origem = fonte.textos[chave];
  if (origem === undefined) throw new ErroNaMontagemDaPersona("ORIGEM_AUSENTE", `texto de origem ausente: ${chave}`);
  let texto = origem;
  for (const a of fonte.adaptacoes) if (a.origem === bloco && personasDa(a).includes(persona)) texto = aplicarAdaptacao(texto, a);
  return normalizarForma(texto);
}

function resolverNomes(nomes?: Partial<NomesDasPersonas>): NomesDasPersonas {
  const r = { ...NOMES_DO_DONO, ...(nomes ?? {}) };
  for (const p of PERSONAS_DE_ORIGEM) {
    const n = r[p]?.trim() ?? "";
    if (!n || n.length > NOME_DA_PERSONA_MAX || !NOME_DA_PERSONA_RE.test(n)) throw new ErroNaMontagemDaPersona("NOMES_INVALIDOS", `nome inválido para a persona ${p}`);
    r[p] = n;
  }
  if (new Set(PERSONAS_DE_ORIGEM.map(p => r[p].toLocaleLowerCase("pt-BR"))).size !== PERSONAS_DE_ORIGEM.length) throw new ErroNaMontagemDaPersona("NOMES_INVALIDOS", "os três perfis precisam de nomes diferentes");
  return r;
}

export function nomeDaPersonaDoTipo(tipo: TipoDeAgente, nomes?: Partial<NomesDasPersonas>): string {
  return resolverNomes(nomes)[PERSONA_DO_TIPO[tipo]];
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const palavra = (s: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escaparRegex(s)}(?![\\p{L}\\p{N}])`, "u");

/**
 * O que NÃO pode sobrar em nenhuma persona montada. Cada item diz por quê; o
 * teste do builder percorre a mesma lista e a montagem falha se um deles aparecer.
 */
export const PROIBIDOS_NA_PERSONA: readonly { motivo: string; padrao: RegExp }[] = [
  { motivo: "placeholder do Provedor.ai", padrao: /\{\{|\}\}|\[\[|\]\]/ },
  { motivo: "variável de adaptação não resolvida", padrao: /\$PERSONA|\$PROVEDOR/ },
  { motivo: "marcador de substituição <…>", padrao: /<[^<>\n]{1,80}>/ },
  { motivo: "marcador de substituição […]", padrao: /\[[^[\]\n]{0,120}\]/ },
  { motivo: "ferramenta ou tabela interna do Provedor.ai", padrao: /gerar_link_pix|segunda_via_boleto|consultar_pagamento|gerar_confissao_divida|agendar_coleta_equipamento|consultar_equipamento|\bmcp:|\bdb:|\bwrite:|\bread:|calendario-br|dnd_optouts|cobrancas_ativas|negociacoes|write_offs?\b|confissoes_divida|suppress_?coleta|HANDOFF|GATE:/i },
  { motivo: "formato JSON de saída", padrao: /\bjson\b|```/i },
  { motivo: "percentual (tabela de desconto, benchmark, taxa)", padrao: /\d\s?%/ },
  { motivo: "motor de decisão econômico", padrao: /\b(?:EV|VPL|LTV|CAC|ROI|NBA|NPS)\b|write-?off|valor esperado/i },
  { motivo: "referência interna do Provedor.ai (R2, R18, R22…)", padrao: /\bR\d{1,2}\b/ },
  { motivo: "cobrança de reposição do aparelho", padrao: /reposi[çc][ãa]o/i },
  { motivo: "lembrete que o sistema não agenda", padrao: /lembr/i },
  { motivo: "prazo de retorno prometido", padrao: /j[áa] j[áa]|em instantes|daqui a pouco|hoje ainda|ainda hoje|rapidinho|em menos de \d/i },
  { motivo: "PIX ou link digitado pela funcionária", padrao: /copia[- ]e[- ]cola|qr ?code|1[- ]toque|link direto/i },
];

/**
 * Anúncio de consequência: negativação, suspensão, rescisão, protesto… só podem
 * aparecer numa frase que as NEGA como assunto da funcionária ("nunca anuncie
 * suspensão"). O Consulta ISP proíbe a IA de anunciar consequência, e ex-cliente
 * nem tem serviço para suspender.
 */
const CONSEQUENCIA = /negativ|suspens[ãa]o|suspend|rescis|rescind|protest|\bspc\b|serasa|cart[óo]rio|cadastro de inadimplentes|prote[çc][ãa]o ao cr[ée]dito/i;
const NEGACAO = /\b(?:nunca|n[ãa]o|jamais|nem|nenhum|nenhuma|proibid[oa]|sem)\b/i;
export function frasesQueAnunciamConsequencia(texto: string): string[] {
  return texto.split(/(?<=[.!?;:])\s+|\n+/).filter(f => CONSEQUENCIA.test(f) && !NEGACAO.test(f));
}

/**
 * `nomeProvedor` sai do texto antes das checagens: um provedor chamado "Sofia
 * Net" ou "SPC Fibra" não é nome de persona nem anúncio de negativação.
 */
export function problemasDaPersona(textoMontado: string, tipo: TipoDeAgente, nomes?: Partial<NomesDasPersonas>, nomeProvedor?: string): string[] {
  const r = resolverNomes(nomes);
  const proprio = r[PERSONA_DO_TIPO[tipo]];
  const provedor = nomeProvedor?.trim();
  const texto = provedor ? textoMontado.split(provedor).join("Provedor") : textoMontado;
  const problemas: string[] = [];
  for (const p of PROIBIDOS_NA_PERSONA) {
    const m = texto.match(p.padrao);
    if (m) problemas.push(`${p.motivo}: "${m[0]}"`);
  }
  const outrosNomes = new Set<string>([...AGENTES_DO_PROVEDOR_AI, ...PERSONAS_DE_ORIGEM.map(p => r[p])]);
  outrosNomes.delete(proprio);
  for (const nome of outrosNomes) if (palavra(nome).test(texto)) problemas.push(`nome de outra persona: ${nome}`);
  for (const f of frasesQueAnunciamConsequencia(texto)) problemas.push(`anúncio de consequência: "${f.slice(0, 120)}"`);
  return problemas;
}

export interface OpcoesDaPersona {
  nomeProvedor: string;
  nomes?: Partial<NomesDasPersonas>;
}

/** O texto que vai nas instruções do perfil. Lança `ErroNaMontagemDaPersona` se uma adaptação não casar ou se sobrar algo proibido. */
export function montarPersona(tipo: TipoDeAgente, opcoes: OpcoesDaPersona, fonte: FonteDasPersonas = fontePadrao()): string {
  const nomes = resolverNomes(opcoes.nomes);
  const nomeProvedor = opcoes.nomeProvedor.trim();
  if (!nomeProvedor) throw new ErroNaMontagemDaPersona("NOMES_INVALIDOS", "nome do provedor vazio");
  const persona = PERSONA_DO_TIPO[tipo];
  const texto = normalizarForma(MONTAGEM[tipo].map(b => montarBloco(fonte, persona, b)).join(SEPARADOR_DE_BLOCOS))
    .split(VARIAVEIS.persona).join(nomes[persona])
    .split(VARIAVEIS.provedor).join(nomeProvedor);
  const problemas = problemasDaPersona(texto, tipo, nomes, nomeProvedor);
  if (problemas.length) throw new ErroNaMontagemDaPersona("RESULTADO_PROIBIDO", `persona de ${tipo} com ${problemas.length} problema(s): ${problemas.slice(0, 5).join(" · ")}`);
  return texto;
}

/** A descrição do YAML do Provedor.ai, passada pela mesma lista de adaptação (achado f15). */
export function montarDescricao(tipo: TipoDeAgente, fonte: FonteDasPersonas = fontePadrao()): string {
  return montarBloco(fonte, PERSONA_DO_TIPO[tipo], "descricao");
}

/**
 * Decisão D3: os três perfis começam em `openai/gpt-4.1` com temperatura 0.3 —
 * o modelo e a temperatura de Sofia, Mariana e Bianca no Provedor.ai (a Clara
 * de lá roda em gpt-4o-mini e só desce para ele se a bateria mostrar que não
 * perde). `maxTokens` é o padrão do perfil (o default 2048 de lá não cabe na faixa daqui).
 */
export const CONFIGURACAO_DAS_FUNCIONARIAS = {
  modelo: "openai/gpt-4.1",
  temperatura: 0.3,
  maxTokens: LIMITES_DO_AGENTE.maxTokens.padrao,
} as const;

/** O provedor com que os arquivos revisáveis de `personas/` são montados. Nome neutro: não é cliente real. */
export const PROVEDOR_DE_EXEMPLO = "Provedor Exemplo";
export const COMANDO_DE_REGERACAO = "npx tsx script/configurar-personas-provedor-ai.ts --gerar";

/**
 * O arquivo revisável `integrations/provedor-ai/personas/<tipo>.md`: a descrição
 * e as instruções exatamente como a montagem produz, com o provedor de exemplo e
 * os nomes do dono. O teste do builder confere que o arquivo versionado é este
 * texto — quem muda a origem ou as adaptações regenera e o diff mostra a persona.
 */
export function arquivoDaPersona(tipo: TipoDeAgente, fonte: FonteDasPersonas = fontePadrao()): string {
  const persona = montarPersona(tipo, { nomeProvedor: PROVEDOR_DE_EXEMPLO }, fonte);
  const descricao = montarDescricao(tipo, fonte);
  const milhar = (n: number) => n.toLocaleString("pt-BR");
  return [
    `<!-- Arquivo GERADO pela montagem das personas. Não edite: mude integrations/provedor-ai/origem/ ou adaptacoes.json e rode \`${COMANDO_DE_REGERACAO}\`. -->`,
    `# ${tipo} — ${nomeDaPersonaDoTipo(tipo)}`,
    "",
    `Persona **${PERSONA_DO_TIPO[tipo]}** do Provedor.ai adaptada ao Consulta ISP (adaptações versão ${fonte.versao}), montada com o provedor de exemplo "${PROVEDOR_DE_EXEMPLO}" e os nomes escolhidos pelo dono.`,
    "",
    `- blocos de origem: ${MONTAGEM[tipo].map(b => chaveDoTexto(PERSONA_DO_TIPO[tipo], b)).join(", ")}`,
    `- modelo: ${CONFIGURACAO_DAS_FUNCIONARIAS.modelo} · temperatura ${String(CONFIGURACAO_DAS_FUNCIONARIAS.temperatura).replace(".", ",")} · maxTokens ${milhar(CONFIGURACAO_DAS_FUNCIONARIAS.maxTokens)}`,
    `- instruções: ${milhar(persona.length)} caracteres (limite das instruções: ${milhar(LIMITES_DO_AGENTE.instrucoes)})`,
    `- descrição: ${milhar(descricao.length)} caracteres (limite: ${milhar(LIMITES_DO_AGENTE.descricao)})`,
    "",
    "## Descrição",
    "",
    descricao,
    "",
    "## Instruções",
    "",
    "```text",
    persona,
    "```",
    "",
  ].join("\n");
}
