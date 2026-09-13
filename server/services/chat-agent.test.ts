/**
 * O agente do chat de visitante (landing page) na demonstração e fora dela.
 *
 * `POST /api/public/visitor-chat/messages` é pública e chama
 * `generateChatResponse` a cada mensagem. Na demonstração isso seria uma
 * chamada paga ao modelo por visitante anônimo: o que se prova aqui é que, com
 * DEMO_MODE, o SDK nem é instanciado (espião no construtor), e que sem ele o
 * caminho de sempre continua — cliente montado e `create` chamado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  construtor: vi.fn(),
  create: vi.fn(async () => ({ choices: [{ message: { content: "Resposta do modelo" } }] })),
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: sdk.create } };
    constructor(opcoes: unknown) { sdk.construtor(opcoes); }
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { generateChatResponse } from "./chat-agent";

const VARIAVEIS = ["DEMO_MODE", "AI_INTEGRATIONS_OPENAI_API_KEY"] as const;
const antes = Object.fromEntries(VARIAVEIS.map((v) => [v, process.env[v]]));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "chave-ficticia-de-teste";
});
afterEach(() => {
  for (const v of VARIAVEIS) { if (antes[v] === undefined) delete process.env[v]; else process.env[v] = antes[v]; }
});

describe("generateChatResponse e a demonstracao publica", () => {
  it("DEMO_MODE: texto fixo da demonstracao, sem instanciar o SDK nem chamar o modelo", async () => {
    process.env.DEMO_MODE = "true";

    const texto = await generateChatResponse("Quanto custa?", []);

    expect(texto).toMatch(/demonstração pública/);
    expect(sdk.construtor).not.toHaveBeenCalled();
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it("sem DEMO_MODE: monta o cliente com a chave do ambiente e devolve a resposta do modelo", async () => {
    delete process.env.DEMO_MODE;

    const texto = await generateChatResponse("Quanto custa?", [{ role: "user", content: "Oi" }]);

    expect(texto).toBe("Resposta do modelo");
    expect(sdk.construtor).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "chave-ficticia-de-teste" }));
    expect(sdk.create).toHaveBeenCalledTimes(1);
  });
});
