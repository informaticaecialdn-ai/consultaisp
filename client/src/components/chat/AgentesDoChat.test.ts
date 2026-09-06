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
import { LIMITES_DO_AGENTE } from "@shared/chat-agentes";

const fonte = readFileSync(join(__dirname, "AgentesDoChat.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("AgentesDoChat — campos do perfil", () => {
  it("lê os limites do schema compartilhado, nunca um número cravado", () => {
    expect(fonte).toContain('from "@shared/chat-agentes"');
    for (const campo of ["descricao", "instrucoes", "contextoOperacional"]) expect(fonte).toContain(`maxLength={LIMITES_DO_AGENTE.${campo}}`);
    expect(fonte).not.toMatch(/maxLength=\{\d+\}/);
    expect(fonte).toContain("min={LIMITES_DO_AGENTE.temperatura.min}");
    expect(fonte).toContain("max={LIMITES_DO_AGENTE.maxTokens.max}");
    expect(LIMITES_DO_AGENTE.instrucoes).toBe(6000);
  });
  it("valida no cliente com o mesmo schema do servidor e não deixa salvar inválido", () => {
    expect(fonte).toContain("ConfiguracaoDeAgenteSchema.safeParse(corpo)");
    expect(fonte).toMatch(/disabled=\{bloqueado \|\| !mudou \|\| !validacao\.success\}/);
  });
  it("envia ao PUT o perfil inteiro: descrição, instruções, contexto operacional, temperatura e tokens", () => {
    expect(fonte).toMatch(/const corpo = \{ modelo: modelo \|\| null, descricao, instrucoes, contextoOperacional, habilitado, temperatura: numeroOuIndefinido\(temperatura\), maxTokens: numeroOuIndefinido\(maxTokens\) \}/);
  });
  it("campo numérico vazio é “não definido”, nunca zero", () => {
    expect(fonte).toMatch(/const numeroOuIndefinido = \(v: string\) => v\.trim\(\) === "" \? undefined : Number\(v\)/);
    expect(fonte).not.toContain("Number(temperatura)");
    expect(fonte).not.toContain("Number(maxTokens)");
    expect(fonte).toContain("corpo.temperatura !== undefined && corpo.temperatura !== (agente.temperatura ?? 0.3)");
  });
  it("rótulos em português e as primitivas do painel", () => {
    for (const rotulo of [">modelo<", ">descrição do agente<", ">preferências de escrita<", ">contexto operacional do dia<", ">temperatura<", ">máximo de tokens<"]) expect(fonte).toContain(rotulo);
    expect(fonte).toContain("ROTULO_CAMPO");
    expect(fonte).toContain("CONTROLE_CAMPO_MULTILINHA");
    expect(fonte).toContain("BOTAO_MARCA");
    expect(fonte).toContain("CONTROLE_CAMPO");
  });
  it("mostra a origem de cada modelo — credencial do Chat BullQ ou id que só a VPS aceita", () => {
    expect(fonte).toContain("ORIGENS_DE_MODELO");
    expect(fonte).toContain('chat_bullq: "credencial do Chat BullQ"');
    expect(fonte).toContain('openai_vps: "OpenAI · só na VPS"');
    expect(fonte).toContain('data-testid="chat-origens-modelos"');
    // O id que só a VPS aceita fica em destaque de atenção quando é o escolhido — a linhagem do repositório o recusa com 400.
    expect(fonte).toContain('origemDoModelo === "openai_vps" ? "text-[var(--gated)]"');
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
  it("tem o bloco recolhível com o prompt final, carregado só quando aberto e só para admin", () => {
    expect(fonte).toContain(">O que o agente recebe<");
    expect(fonte).toContain("/prompt`");
    expect(fonte).toContain("enabled: promptAberto && podeAdministrar");
    expect(fonte).toContain("<details");
    expect(fonte).toContain("prompt.data.prompt");
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
