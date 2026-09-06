import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Executa os arquivos completos adicionados pelo patch durável, sem precisar
// instalar Nest/Prisma ou copiar código de produção para os testes.
const patch = readFileSync("integrations/chat-bullq/patches/002-agentes-primeiro-contato.patch", "utf8");
const decorators: { name: string; args: unknown[] }[] = [];
const decorator = (name: string) => (...args: unknown[]) => { decorators.push({ name, args }); return () => undefined; };
const log = vi.fn();
const nest = { Injectable: decorator("Injectable"), Controller: decorator("Controller"), UseGuards: decorator("UseGuards"), Get: decorator("Get"), Post: decorator("Post"), Body: decorator("Body"), Param: decorator("Param"), Logger: class { log = log; }, BadRequestException: class extends Error {}, ServiceUnavailableException: class extends Error {}, NotFoundException: class extends Error {} };
function carregar(nome: string, adicionais: Record<string, unknown> = {}) {
  const caminho = `src/modules/ai-agents/${nome}`;
  const bloco = patch.split(`diff --git a/${caminho} b/${caminho}\n`)[1]?.split("diff --git ")[0];
  if (!bloco || !bloco.includes("new file mode")) throw new Error(`Arquivo novo ausente do patch: ${caminho}`);
  const source = bloco.split(/\r?\n/).filter(l => l.startsWith("+") && !l.startsWith("+++")).map(l => l.slice(1)).join("\n");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: false } });
  const exports: Record<string, unknown> = {};
  const modules: Record<string, unknown> = { "@nestjs/common": nest, "node:crypto": crypto, ...adicionais };
  runInNewContext(output.outputText, { exports, Date, require: (id: string) => { if (!(id in modules)) throw new Error(`Dependência não permitida no draft: ${id}`); return modules[id]; } });
  return exports;
}
type Draft = { texto: string; agenteId: string; modelo: string; runId: string };
interface Service { prepare(org: string, id: string, c: unknown): Promise<Draft> }
const FirstContactService = carregar("agents/first-contact.service.ts").FirstContactService as new (prisma: unknown, llm: unknown) => Service;
const FirstContactModels = carregar("llm/first-contact-models.ts").FirstContactModels as new (client: unknown, configured: boolean) => { list(): Promise<{ configured: boolean; models: { id: string }[] }> };
const context = { nomeCliente: "Maria", nomeProvedor: "NsLink" };
function fixture() {
  const findFirst = vi.fn(async () => ({ id: "a6", modelId: "sakana/fugu-modelo-real", systemPrompt: "Primeiro contato", capabilities: ["primeiro_contato_sem_envio"], isActive: false, canRespondDirectly: false }));
  const complete = vi.fn(async () => ({ message: { content: "Olá, sou o assistente virtual da NsLink. Posso falar com Maria?" }, stopReason: "stop", rawModelId: "fugu-modelo-real", usage: { inputTokens: 20, outputTokens: 15, costUsd: 0.001 } }));
  const models = vi.fn(async () => ({ configured: true, models: [{ id: "sakana/fugu-modelo-real" }] }));
  return { findFirst, complete, models, service: new FirstContactService({ aiAgent: { findFirst } }, { complete, firstContactModels: models }) };
}
describe("patch BullQ: preparação real sem envio", () => {
  it("busca o agente dentro da organização e não consulta LLM para outro tenant", async () => {
    const f = fixture(); f.findFirst.mockResolvedValueOnce(null as never);
    await expect(f.service.prepare("org-6", "agente-outro", context)).rejects.toThrow(/organização/);
    expect(f.findFirst).toHaveBeenCalledWith({ where: { id: "agente-outro", organizationId: "org-6", deletedAt: null } });
    expect(f.complete).not.toHaveBeenCalled();
  });
  it("chama LLM uma vez, com orçamento e modelo exato; retorna correlação sem chamar runner/canal", async () => {
    const f = fixture(); const result = await f.service.prepare("org-6", "a6", context);
    expect(result).toMatchObject({ agenteId: "a6", modelo: "sakana/fugu-modelo-real" });
    expect(result.runId).toMatch(/^[a-f\d-]{36}$/);
    expect(f.complete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ modelId: "sakana/fugu-modelo-real", maxTokens: 320, timeoutMs: 12000, maxRetries: 0 }));
    const request = f.complete.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(request.tools).toBeUndefined(); expect(request.modelParams).toBeUndefined();
    expect(JSON.stringify(log.mock.calls)).not.toContain("Maria");
  });
  it.each([
    { message: { content: "Sua dívida é R$ 300. Posso cobrar?" } },
    { rawModelId: "outro-modelo" },
    { stopReason: "length" },
    { message: { content: "Olá, sou assistente virtual, posso ajudar?", toolCalls: [{ name: "replyToConversation" }] } },
  ])("rejeita geração inválida ou troca de modelo: %j", async change => {
    const f = fixture(); const response = await f.complete(); f.complete.mockResolvedValueOnce({ ...response, ...change } as never);
    await expect(f.service.prepare("org-6", "a6", context)).rejects.toThrow();
  });
  it("não usa fallback se não há modelo/credencial e rejeita contexto com campos sensíveis", async () => {
    const f = fixture(); f.models.mockResolvedValueOnce({ configured: false, models: [] });
    await expect(f.service.prepare("org-6", "a6", context)).rejects.toThrow(/Credencial/);
    await expect(f.service.prepare("org-6", "a6", { ...context, cpf: "sintético" })).rejects.toThrow(/Campo/);
    expect(f.complete).not.toHaveBeenCalled();
  });
  it("deduplica requisições idênticas e rejeita outra preparação simultânea na organização", async () => {
    const f = fixture(); const output = await f.complete(); let liberar!: (r: typeof output) => void;
    f.complete.mockClear(); f.complete.mockImplementationOnce(() => new Promise(resolve => { liberar = resolve; }));
    const a = f.service.prepare("org-6", "a6", context);
    const b = f.service.prepare("org-6", "a6", context);
    await expect(f.service.prepare("org-6", "outro", context)).rejects.toThrow(/andamento/);
    liberar(output); await Promise.all([a, b]); expect(f.complete).toHaveBeenCalledTimes(1);
  });
});
describe("patch BullQ: modelos e proteção do controller", () => {
  it("sem credencial não chama API; com credencial só lista IDs retornados, com cache", async () => {
    const list = vi.fn(async () => ({ data: [{ id: "fugu-existente" }, { id: "openai/inexistente" }] }));
    expect(await new FirstContactModels({ models: { list } }, false).list()).toEqual({ configured: false, models: [] });
    expect(list).not.toHaveBeenCalled();
    const c = new FirstContactModels({ models: { list } }, true);
    expect(await c.list()).toEqual({ configured: true, models: [{ id: "sakana/fugu-existente" }] });
    await c.list(); expect(list).toHaveBeenCalledTimes(1);
  });
  it("falha da API de modelos não vira catálogo inventado", async () => {
    const list = vi.fn(async () => { throw new Error("Credencial inválida"); });
    await expect(new FirstContactModels({ models: { list } }, true).list()).rejects.toThrow(/listar/);
  });
  it("models e draft exigem JWT, organização e papel admin; corpo não substitui org", async () => {
    decorators.length = 0;
    const mod = carregar("agents/first-contact.controller.ts", {
      "@prisma/client": { OrgRole: { OWNER: "OWNER", ADMIN: "ADMIN" } },
      "../../../common/guards": { JwtAuthGuard: "jwt", OrgGuard: "org", RolesGuard: "roles" },
      "../../../common/decorators": { CurrentOrg: decorator("CurrentOrg"), Roles: decorator("Roles") },
    });
    expect(decorators).toContainEqual({ name: "UseGuards", args: ["jwt", "org", "roles"] });
    expect(decorators).toContainEqual({ name: "Roles", args: ["OWNER", "ADMIN"] });
    expect(decorators).toContainEqual({ name: "CurrentOrg", args: ["id"] });
    const Controller = mod.FirstContactController as new (service: unknown) => { prepare(org: string, id: string, body: unknown): Promise<Draft> };
    const prepare = vi.fn(); const controller = new Controller({ prepare });
    await controller.prepare("org-6", "a6", { context, organizationId: "org-7" });
    expect(prepare).toHaveBeenCalledWith("org-6", "a6", context);
  });
});
