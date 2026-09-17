/**
 * A tela dos agentes do chat, travada pelo texto da fonte (o vitest deste
 * projeto não coleta `.tsx`, como em `pages/cobranca/telas.test.ts`).
 *
 * O que se trava: os campos do perfil com os limites do schema compartilhado,
 * a validação no cliente igual à do servidor, a origem de cada modelo, o bloco
 * recolhível com o prompt final e as promessas do DESIGN_SYSTEM (primitivas do
 * painel, número em mono tabular, nada de paleta crua, sombra nem "Carregando").
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { AGENT_PROMPT_MAX, AVISOS_MAX, LIMITES_DO_AGENTE, RESERVA_DA_CASA } from "@shared/chat-agentes";

const fonte = readFileSync(join(__dirname, "AgentesDoChat.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("AgentesDoChat — campos do perfil", () => {
  it("lê os limites do schema compartilhado, nunca um número cravado", () => {
    expect(fonte).toContain('from "@shared/chat-agentes"');
    for (const campo of ["descricao", "instrucoes", "contextoOperacional"]) expect(fonte).toContain(`maxLength={LIMITES_DO_AGENTE.${campo}}`);
    expect(fonte).not.toMatch(/maxLength=\{\d+\}/);
    expect(fonte).toContain("min={LIMITES_DO_AGENTE.temperatura.min}");
    expect(fonte).toContain("max={LIMITES_DO_AGENTE.maxTokens.max}");
    // Derivado do teto do planejador (casa e avisos no máximo), não escolhido: as personas do Provedor.ai cabem.
    expect(LIMITES_DO_AGENTE.instrucoes).toBe(AGENT_PROMPT_MAX - RESERVA_DA_CASA - AVISOS_MAX);
    expect(fonte).toContain("maxLength={NOME_DA_PERSONA_MAX}");
  });
  it("valida no cliente com o mesmo schema do servidor e não deixa salvar inválido", () => {
    expect(fonte).toContain("ConfiguracaoDeAgenteSchema.safeParse(corpo)");
    expect(fonte).toMatch(/disabled=\{bloqueado \|\| !mudou \|\| !validacao\.success\}/);
  });
  it("envia ao PUT o perfil inteiro: descrição, instruções, contexto operacional, temperatura e tokens", () => {
    expect(fonte).toContain("const corpo = { modelo: modelo || null, nomeDaPersona: nomeOuNulo(nomeDaPersona), descricao, instrucoes, contextoOperacional, habilitado, temperatura: numeroOuIndefinido(temperatura), maxTokens: numeroOuIndefinido(maxTokens) }");
  });
  it("campo numérico vazio é “não definido”, nunca zero", () => {
    expect(fonte).toMatch(/const numeroOuIndefinido = \(v: string\) => v\.trim\(\) === "" \? undefined : Number\(v\)/);
    expect(fonte).not.toContain("Number(temperatura)");
    expect(fonte).not.toContain("Number(maxTokens)");
    expect(fonte).toContain("corpo.temperatura !== undefined && corpo.temperatura !== (agente.temperatura ?? 0.3)");
  });
  it("rótulos em português e as primitivas do painel", () => {
    for (const rotulo of [">modelo<", ">nome da funcionária<", ">descrição do agente<", ">instruções da funcionária<", ">contexto operacional do dia<", ">temperatura<", ">máximo de tokens<"]) expect(fonte).toContain(rotulo);
    expect(fonte).toContain("ROTULO_CAMPO");
    expect(fonte).toContain("CONTROLE_CAMPO_MULTILINHA");
    expect(fonte).toContain("BOTAO_MARCA");
    expect(fonte).toContain("CONTROLE_CAMPO");
  });
  it("mostra a origem de cada modelo — credencial do Chat BullQ ou OpenAI não confirmado", () => {
    expect(fonte).toContain("ORIGENS_DE_MODELO");
    expect(fonte).toContain('chat_bullq: "credencial do Chat BullQ"');
    expect(fonte).toContain('openai_vps: "OpenAI · não confirmado"');
    expect(fonte).toContain('data-testid="chat-origens-modelos"');
    // O id OpenAI que o serviço conectado não confirmou fica em destaque de atenção quando é o escolhido.
    expect(fonte).toContain('origemDoModelo === "openai_vps" ? "text-[var(--gated)]"');
  });
  it("o rótulo da origem, que vai ao <select> e à legenda do provedor, não cita a nossa infraestrutura", () => {
    // Só os TEXTOS: a chave `openai_vps` continua sendo o contrato com o serviço.
    const rotulos = fonte.match(/const ROTULO_DA_ORIGEM = \{([^}]*)\}/)?.[1] ?? "";
    const textos = Array.from(rotulos.matchAll(/:\s*"([^"]*)"/g), m => m[1]);
    expect(textos).toHaveLength(2);
    for (const texto of textos) expect(texto).not.toMatch(/VPS|fork|patch/i);
  });
  it("credencial de IA ausente bloqueia aplicar e testar, com o motivo no title", () => {
    expect(fonte).toContain("credencialAusente={modelos.data ? !modelos.data.configured : false}");
    expect((fonte.match(/title=\{credencialAusente \? SEM_CREDENCIAL : undefined\}/g) ?? []).length).toBe(2);
    expect((fonte.match(/\|\| credencialAusente\}/g) ?? []).length).toBe(2);
    expect(fonte).toMatch(/const SEM_CREDENCIAL = "O Chat BullQ respondeu que está sem credencial de IA/);
  });
  it("o contexto operacional só é prometido a partir do momento em que é aplicado", () => {
    expect(fonte).toContain("só chega ao modelo depois de");
    expect(fonte).not.toContain("Entra no prompt a cada resposta");
  });
  it("nome da funcionária: campo próprio, vazio vira null (apaga), com a regra de transparência à vista", () => {
    expect(fonte).toContain("const nomeOuNulo = (v: string) => v.trim() || null");
    expect(fonte).toContain("useState(agente.nomeDaPersona ?? \"\")");
    expect(fonte).toContain("erroDe(\"nomeDaPersona\")");
    expect(fonte).toContain("confirma que é atendimento automatizado com supervisão da equipe");
    expect(fonte).toContain("corpo.nomeDaPersona !== (agente.nomeDaPersona ?? null)");
    expect(fonte).not.toMatch(/assistente virtual/i);
  });
  it("contador do prompt final ao vivo: casa do servidor + instruções e avisos do formulário, contra o teto, com a mesma soma do servidor", () => {
    expect(fonte).toContain("tamanhoDoPromptFinal(prompt.data.caracteresDaCasa, instrucoes, contextoOperacional)");
    expect(fonte).toContain("prompt.data?.limite ?? AGENT_PROMPT_MAX");
    expect(fonte).toContain("data-testid={`prompt-final-${agente.tipo}`}");
    // Sem dado do servidor é traço, não zero; acima do teto fica em perigo.
    expect(fonte).toContain("promptFinalAoVivo === null ? \"—\"");
    expect(fonte).toContain("promptFinalAoVivo > tetoDoPrompt && \"text-[var(--danger)]\"");
  });
  it("tem o bloco recolhível com o prompt final, carregado só para admin (o contador precisa da casa mesmo com o bloco fechado)", () => {
    expect(fonte).toContain(">O que o agente recebe<");
    expect(fonte).toContain("/prompt`");
    expect(fonte).toContain("enabled: podeAdministrar, retry: false");
    expect(fonte).toContain("<details");
    expect(fonte).toContain("prompt.data.prompt");
  });
  it("o prompt é buscado no caminho da rota, não na key inteira: `atualizadoEm` só invalida", () => {
    // O fetcher padrão do queryClient faz `queryKey.join("/")`: com `atualizadoEm` na key, a URL
    // ganhava um segmento a mais e o servidor respondia 404 (log de produção, 16/09/2026).
    const consulta = fonte.match(/const prompt = useQuery<PromptDoAgente>\(\{([\s\S]*?)\}\);/)?.[1] ?? "";
    expect(consulta).toContain("queryKey: [`${API}/${agente.tipo}/prompt`, agente.atualizadoEm]");
    expect(consulta).toContain('queryFn: async () => (await apiRequest("GET", `${API}/${agente.tipo}/prompt`)).json()');
  });
});

describe("AgentesDoChat — DESIGN_SYSTEM", () => {
  it("todo número em mono tabular: temperatura, tokens, contadores e o rodapé do prompt", () => {
    expect(fonte).toContain('const CONTADOR = "font-mono text-[10px] tabular-nums');
    expect((fonte.match(/type="number"[^>]*font-mono text-xs tabular-nums/g) ?? []).length).toBe(2);
    expect((fonte.match(/CONTADOR/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
  it("sem paleta crua do Tailwind, sem sombra, sem pill em selo, raio até 8px", () => {
    expect(fonte).not.toMatch(/\b(?:bg|text|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/);
    expect(fonte).not.toMatch(/shadow-(?:sm|md|lg|xl|2xl)\b/);
    expect(fonte).not.toContain("rounded-full");
    expect(fonte).not.toMatch(/rounded-(?:xl|2xl|3xl)\b/);
  });
  it("carregamento é esqueleto, não texto", () => {
    expect(fonte).not.toContain("Carregando");
    expect(fonte).toContain("motion-safe:animate-pulse");
  });
});
