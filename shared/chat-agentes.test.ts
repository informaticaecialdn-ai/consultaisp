/**
 * O perfil do agente tem os mesmos campos do `AiAgent` do fork do Chat BullQ,
 * com os limites travados aqui — a UI, a rota e o serviço leem deste schema.
 */
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_AGENTES, ConfiguracaoDeAgenteSchema, LIMITES_DO_AGENTE, MODELOS_OPENAI_DA_VPS, ORIGENS_DE_MODELO, PADRAO_DE_MODELO_DO_FORK, TIPOS_DE_AGENTE, catalogoDeModelos } from "./chat-agentes";

const base = { modelo: "openai/gpt-4o-mini", instrucoes: "Seja breve", habilitado: true };

describe("ConfiguracaoDeAgenteSchema — limites do perfil", () => {
  it("preenche descrição e contexto operacional vazios por padrão", () => {
    const r = ConfiguracaoDeAgenteSchema.parse(base);
    expect(r).toMatchObject({ descricao: "", contextoOperacional: "" });
    expect(r.temperatura).toBeUndefined();
    expect(r.maxTokens).toBeUndefined();
  });
  it("descrição até 500, instruções até 6.000 e contexto operacional até 8.000 — como o CreateAgentDto do fork", () => {
    expect(LIMITES_DO_AGENTE).toMatchObject({ descricao: 500, instrucoes: 6000, contextoOperacional: 8000 });
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, descricao: "d".repeat(500) }).success).toBe(true);
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, descricao: "d".repeat(501) }).success).toBe(false);
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, instrucoes: "i".repeat(6000) }).success).toBe(true);
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, instrucoes: "i".repeat(6001) }).success).toBe(false);
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, contextoOperacional: "c".repeat(8000) }).success).toBe(true);
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, contextoOperacional: "c".repeat(8001) }).success).toBe(false);
  });
  it("temperatura de 0 a 1 e de 160 a 1.200 tokens inteiros", () => {
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, temperatura: 0, maxTokens: 160 }).success).toBe(true);
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, temperatura: 1, maxTokens: 1200 }).success).toBe(true);
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, temperatura: 1.1 }).success).toBe(false);
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, temperatura: -0.1 }).success).toBe(false);
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, maxTokens: 159 }).success).toBe(false);
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, maxTokens: 1201 }).success).toBe(false);
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, maxTokens: 600.5 }).success).toBe(false);
  });
  it("apara espaços e recusa chave desconhecida", () => {
    expect(ConfiguracaoDeAgenteSchema.parse({ ...base, descricao: "  Clara  ", contextoOperacional: " hoje sem visita " })).toMatchObject({ descricao: "Clara", contextoOperacional: "hoje sem visita" });
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, providerId: 9 }).success).toBe(false);
  });
  it("o modelo segue o formato que o fork da VPS aceita: sakana/, fugu, openai/ ou gpt-", () => {
    for (const ok of ["sakana/fugu-ultra-20260615", "fugu", "fugu-mini", "openai/gpt-4o-mini", "gpt-4o"]) expect(PADRAO_DE_MODELO_DO_FORK.test(ok), ok).toBe(true);
    for (const nao of ["claude-sonnet-4-6", "anthropic/claude", "gemini-pro", "openai/", "sakana/"]) expect(PADRAO_DE_MODELO_DO_FORK.test(nao), nao).toBe(false);
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, modelo: "claude-sonnet-4-6" }).success).toBe(false);
    expect(ConfiguracaoDeAgenteSchema.safeParse({ ...base, modelo: null }).success).toBe(true);
  });
});

describe("catálogo de modelos — de onde vem cada um", () => {
  it("marca a lista do Chat BullQ como credencial e acrescenta os OpenAI da VPS sem repetir", () => {
    const c = catalogoDeModelos({ configured: true, models: [{ id: "sakana/fugu" }, { id: "openai/gpt-4o-mini" }] });
    expect(c.configured).toBe(true);
    expect(c.models).toEqual([
      { id: "sakana/fugu", origem: "chat_bullq" },
      { id: "openai/gpt-4o-mini", origem: "chat_bullq" },
      { id: "openai/gpt-4o", origem: "openai_vps" },
    ]);
    expect(c.origens).toBe(ORIGENS_DE_MODELO);
  });
  it("`configured` é o que o Chat BullQ respondeu — a lista local não o forja", () => {
    const c = catalogoDeModelos({ configured: false, models: [{ id: "sakana/fugu" }] });
    expect(c.configured).toBe(false);
    // Os ids que só a VPS aceita continuam visíveis e marcados; visíveis não é o mesmo que utilizáveis.
    expect(c.models.map(m => m.id)).toEqual(MODELOS_OPENAI_DA_VPS.map(m => m.id));
    expect(c.models.every(m => m.origem === "openai_vps")).toBe(true);
  });
  it("sem nenhuma fonte, nada é inventado", () => {
    expect(catalogoDeModelos({ configured: false, models: [] }, [])).toMatchObject({ configured: false, models: [] });
    expect(catalogoDeModelos({ configured: true, models: [] }, [{ id: "claude-3", origem: "openai_vps" }]).models).toEqual([]);
  });
  it("os OpenAI do catálogo local são os que o fork da VPS nomeia e passam no padrão dele", () => {
    expect(MODELOS_OPENAI_DA_VPS.map(m => m.id)).toEqual(["openai/gpt-4o-mini", "openai/gpt-4o"]);
    for (const m of MODELOS_OPENAI_DA_VPS) expect(PADRAO_DE_MODELO_DO_FORK.test(m.id)).toBe(true);
  });
  it("o rótulo da origem local avisa que a linhagem distribuída no repositório recusa openai/*", () => {
    expect(ORIGENS_DE_MODELO.chat_bullq).toMatch(/confirmado ao vivo/i);
    expect(ORIGENS_DE_MODELO.openai_vps).toMatch(/VPS/);
    expect(ORIGENS_DE_MODELO.openai_vps).toMatch(/000\+001\+002/);
    expect(ORIGENS_DE_MODELO.openai_vps).toMatch(/400/);
  });
});

describe("catálogo de papéis", () => {
  it("cada papel tem nome e o que faz; `descricao` fica livre para o campo configurável", () => {
    for (const tipo of TIPOS_DE_AGENTE) {
      expect(CATALOGO_DE_AGENTES[tipo].nome).toBeTruthy();
      expect(CATALOGO_DE_AGENTES[tipo].papel).toBeTruthy();
      expect("descricao" in CATALOGO_DE_AGENTES[tipo]).toBe(false);
    }
  });
});
