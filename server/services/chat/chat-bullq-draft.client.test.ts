import { describe, expect, it, vi } from "vitest";
vi.mock("../../logger", () => ({ logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
import { ChatBullqClient } from "./chat-bullq.client";
describe("cliente do draft remoto", () => {
  it("usa sessão da organização nas duas rotas e não chama conversa/mensagem", async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const client = new ChatBullqClient({ baseUrl: "https://bullq.invalid", platformKey: "teste", fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname; calls.push({ path, init });
      if (path.endsWith("/token")) return Response.json({ data: { accessToken: "token-org6", refreshToken: "refresh-org6" } });
      if (path.endsWith("/models")) return Response.json({ data: { configured: true, models: [{ id: "sakana/real" }] } });
      if (path.endsWith("/first-contact-draft")) return Response.json({ data: { texto: "Olá, sou assistente virtual. Podemos conversar?", agenteId: "a6", modelo: "sakana/real", runId: "draft6" } });
      throw new Error("Nenhuma outra operação é permitida");
    } });
    expect((await client.listarModelosDePrimeiroContato("org6")).ok).toBe(true);
    expect((await client.prepararPrimeiroContato("org6", "a6", { nomeCliente: "Teste", nomeProvedor: "ISP" })).ok).toBe(true);
    expect(calls.map(c => c.path)).toEqual(["/api/v1/platform/organizations/org6/token", "/api/v1/ai-agents/first-contact/models", "/api/v1/ai-agents/a6/first-contact-draft"]);
    for (const call of calls.slice(1)) expect(call.init?.headers).toMatchObject({ Authorization: "Bearer token-org6", "x-organization-id": "org6" });
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ context: { nomeCliente: "Teste", nomeProvedor: "ISP" } });
  });
  it("serviço sem patch devolve falha explícita", async () => {
    const client = new ChatBullqClient({ baseUrl: "https://bullq.invalid", platformKey: "teste", fetchImpl: async url => String(url).endsWith("/token") ? Response.json({ accessToken: "a", refreshToken: "r" }) : Response.json({ message: "Recurso não encontrado" }, { status: 404 }) });
    expect(await client.prepararPrimeiroContato("org6", "a6", { nomeCliente: "Teste", nomeProvedor: "ISP" })).toMatchObject({ ok: false, status: 404 });
  });
});
