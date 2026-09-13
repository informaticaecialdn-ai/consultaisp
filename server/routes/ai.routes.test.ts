/**
 * O stream que a tela do parecer (`AiAnalysisSection.tsx`) consome: linhas
 * `data: {"text": ...}` e o fechamento `data: [DONE]`. Na demonstração o texto
 * vem do parecer simulado, fora dela do modelo — e o FORMATO do stream tem que
 * ser o mesmo nos dois lados, senão a tela quebra só na demonstração.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const openaiMock = vi.hoisted(() => {
  const create = vi.fn(async (_params: unknown) => (async function* () {
    yield { choices: [{ delta: { content: "Parecer do modelo" } }] };
  })());
  const OpenAI = vi.fn(function () { return { chat: { completions: { create } } }; });
  return { create, OpenAI };
});
vi.mock("openai", () => ({ default: openaiMock.OpenAI }));

vi.mock("../auth", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireProvider: (_req: any, _res: any, next: any) => next(),
}));

import { registerAiRoutes } from "./ai.routes";
import { parecerSimulado } from "../services/ai-analysis";

const RESULTADO = {
  cpfCnpj: "99950400007", notFound: false, score: 610, riskLabel: "Risco moderado", decisionReco: "Review",
  providerDetails: [{ customerName: "Carlos Costa Souza", isSameProvider: false, daysOverdue: 12, overdueAmount: 99.9 }],
};

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(registerAiRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => { delete process.env.DEMO_MODE; });

/** Lê o stream inteiro e devolve os payloads de cada linha `data: `. */
async function analisar() {
  const res = await fetch(`${base}/api/ai/analyze-consultation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result: RESULTADO }),
  });
  const corpo = await res.text();
  const payloads = corpo.split("\n").filter(l => l.startsWith("data: ")).map(l => l.slice(6));
  return { res, payloads };
}

describe("POST /api/ai/analyze-consultation", () => {
  it("DEMO ligado: text/event-stream com o parecer simulado em data: {text} e [DONE] no fim, sem SDK", async () => {
    process.env.DEMO_MODE = "true";
    const { res, payloads } = await analisar();

    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(payloads.at(-1)).toBe("[DONE]");
    const textos = payloads.slice(0, -1).map(p => JSON.parse(p));
    expect(textos.every(t => typeof t.text === "string")).toBe(true);
    expect(textos.map(t => t.text).join("").trimEnd()).toBe(parecerSimulado(RESULTADO as any));
    expect(openaiMock.OpenAI).not.toHaveBeenCalled();
  });

  it("DEMO desligado: o mesmo formato, com o texto do modelo", async () => {
    const { payloads } = await analisar();

    expect(payloads).toEqual([JSON.stringify({ text: "Parecer do modelo" }), "[DONE]"]);
    expect(openaiMock.create).toHaveBeenCalledTimes(1);
  });
});
