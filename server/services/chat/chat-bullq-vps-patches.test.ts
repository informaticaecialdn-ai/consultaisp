import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Os patches `vps/` sao a versao dos 002 e 003 adaptada a linhagem que roda no
// fork da VPS: LlmService multi-provider (sakana + openai). O molde e o mesmo
// de chat-bullq-draft.patch.test.ts — os arquivos NOVOS do patch sao executados
// de verdade, sem instalar Nest/Prisma e sem copiar codigo para o teste.
const p002 = readFileSync("integrations/chat-bullq/patches/vps/002-agentes-primeiro-contato.patch", "utf8");
const p003 = readFileSync("integrations/chat-bullq/patches/vps/003-autonomous-plan.patch", "utf8");
const original002 = readFileSync("integrations/chat-bullq/patches/002-agentes-primeiro-contato.patch", "utf8");

const decorators: { name: string; args: unknown[] }[] = [];
const decorator = (name: string) => (...args: unknown[]) => { decorators.push({ name, args }); return () => undefined; };
const log = vi.fn();
class ErroNest extends Error { status?: number }
const nest = {
  Injectable: decorator("Injectable"), Controller: decorator("Controller"), UseGuards: decorator("UseGuards"),
  Get: decorator("Get"), Post: decorator("Post"), Body: decorator("Body"), Param: decorator("Param"),
  Logger: class { log = log; },
  BadRequestException: class extends ErroNest {}, ServiceUnavailableException: class extends ErroNest {},
  NotFoundException: class extends ErroNest {}, ConflictException: class extends ErroNest {},
  HttpException: class extends ErroNest { constructor(msg: string, status: number) { super(msg); this.status = status; } },
};

// Copia fiel de `resolveLlmModel` do fork da VPS
// (src/modules/ai-agents/llm/llm.constants.ts). E o contrato de que o patch
// depende: `sakana/<id>` e `fugu*` sao Sakana, `openai/<id>` e `gpt-*` sao
// OpenAI, e todo o resto (embedding, tts, whisper) nao e modelo de agente.
const llmConstants = {
  resolveLlmModel(id: string | null | undefined) {
    const t = (id ?? "").trim();
    if (!t) return null;
    if (t.startsWith("sakana/")) { const m = t.slice(7); return m ? { provider: "sakana", model: m } : null; }
    if (t === "fugu" || t.startsWith("fugu-")) return { provider: "sakana", model: t };
    if (t.startsWith("openai/")) { const m = t.slice(7); return m ? { provider: "openai", model: m } : null; }
    if (t.startsWith("gpt-")) return { provider: "openai", model: t };
    return null;
  },
};

function carregar(patch: string, nome: string, adicionais: Record<string, unknown> = {}) {
  const caminho = `src/modules/ai-agents/${nome}`;
  const bloco = patch.split(`diff --git a/${caminho} b/${caminho}\n`)[1]?.split("diff --git ")[0];
  if (!bloco || !bloco.includes("new file mode")) throw new Error(`Arquivo novo ausente do patch: ${caminho}`);
  const source = bloco.split(/\r?\n/).filter(l => l.startsWith("+") && !l.startsWith("+++")).map(l => l.slice(1)).join("\n");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: false } });
  const exports: Record<string, unknown> = {};
  const modules: Record<string, unknown> = { "@nestjs/common": nest, "node:crypto": crypto, "./llm.constants": llmConstants, ...adicionais };
  runInNewContext(output.outputText, { exports, Date, require: (id: string) => { if (!(id in modules)) throw new Error(`Dependencia nao permitida: ${id}`); return modules[id]; } });
  return exports;
}

type Catalogo = { configured: boolean; models: { id: string }[]; indisponiveis: string[] };
const modelsMod = carregar(p002, "llm/first-contact-models.ts");
const FirstContactModels = modelsMod.FirstContactModels as new (clients: unknown) => { list(): Promise<Catalogo> };
const answeredWithSameModel = modelsMod.answeredWithSameModel as (a: string, b: string) => boolean;
const sameModel = modelsMod.sameModel as (a: string, b: string) => boolean;

type Draft = { texto: string; agenteId: string; modelo: string; runId: string };
const FirstContactService = carregar(p002, "agents/first-contact.service.ts", { "../llm/first-contact-models": modelsMod })
  .FirstContactService as new (prisma: unknown, llm: unknown) => { prepare(org: string, id: string, c: unknown): Promise<Draft> };

const schema = carregar(p003, "agents/autonomous-plan.schema.ts");
const parsePlan = schema.parsePlan as (raw: unknown, allowed: string[]) => unknown;
const parsePlanRequest = schema.parsePlanRequest as (raw: unknown) => unknown;
const AutonomousPlanService = carregar(p003, "agents/autonomous-plan.service.ts", {
  "../llm/first-contact-models": modelsMod, "./autonomous-plan.schema": schema,
}).AutonomousPlanService as new (prisma: unknown, llm: unknown) => { plan(org: string, id: string, raw: unknown): Promise<unknown> };

const contexto = { nomeCliente: "Maria", nomeProvedor: "NsLink" };

describe("patch VPS 002: catalogo multi-provider", () => {
  it("sem nenhum cliente nao chama API e nao se declara configurado", async () => {
    const list = vi.fn();
    expect(await new FirstContactModels({ sakana: null, openai: null }).list()).toEqual({ configured: false, models: [], indisponiveis: [] });
    expect(list).not.toHaveBeenCalled();
  });

  it("lista os dois provedores, prefixa o id e descarta o que nao e modelo de agente", async () => {
    const sakana = vi.fn(async () => ({ data: [{ id: "fugu" }, { id: "fugu-ultra-20260615" }] }));
    const openai = vi.fn(async () => ({ data: [{ id: "gpt-4o-mini" }, { id: "text-embedding-3-small" }, { id: "whisper-1" }] }));
    const c = new FirstContactModels({ sakana: { models: { list: sakana } }, openai: { models: { list: openai } } });
    expect(await c.list()).toEqual({
      configured: true,
      models: [{ id: "sakana/fugu" }, { id: "sakana/fugu-ultra-20260615" }, { id: "openai/gpt-4o-mini" }],
      indisponiveis: [],
    });
    await c.list();
    expect(sakana).toHaveBeenCalledTimes(1);
    expect(openai).toHaveBeenCalledTimes(1);
  });

  it("so OpenAI configurada (o caso real da VPS) devolve os gpt-* e nada de fugu", async () => {
    const openai = vi.fn(async () => ({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }] }));
    expect(await new FirstContactModels({ sakana: null, openai: { models: { list: openai } } }).list())
      .toEqual({ configured: true, models: [{ id: "openai/gpt-4o-mini" }, { id: "openai/gpt-4o" }], indisponiveis: [] });
  });

  it("falha parcial marca o provedor, nao entra em cache e nao inventa catalogo", async () => {
    const sakana = vi.fn(async () => { throw new Error("fora do ar"); });
    const openai = vi.fn(async () => ({ data: [{ id: "gpt-4o-mini" }] }));
    const c = new FirstContactModels({ sakana: { models: { list: sakana } }, openai: { models: { list: openai } } });
    expect(await c.list()).toEqual({ configured: true, models: [{ id: "openai/gpt-4o-mini" }], indisponiveis: ["sakana"] });
    await c.list();
    expect(openai).toHaveBeenCalledTimes(2);
  });

  it("todas as credenciais fora do ar viram erro, nunca lista vazia", async () => {
    const list = vi.fn(async () => { throw new Error("credencial invalida"); });
    await expect(new FirstContactModels({ openai: { models: { list } } }).list()).rejects.toThrow(/listar/);
  });

  it("aceita o snapshot datado do modelo pedido e recusa qualquer outro id", () => {
    expect(answeredWithSameModel("openai/gpt-4o-mini", "gpt-4o-mini")).toBe(true);
    expect(answeredWithSameModel("openai/gpt-4o-mini", "gpt-4o-mini-2024-07-18")).toBe(true);
    expect(answeredWithSameModel("openai/gpt-4o-mini", "gpt-4o")).toBe(false);
    // A trava contra troca de modelo continua: fugu nao vira fugu-ultra.
    expect(answeredWithSameModel("sakana/fugu", "fugu-ultra-20260615")).toBe(false);
    expect(sameModel("openai/gpt-4o-mini", "gpt-4o-mini")).toBe(true);
    expect(sameModel("openai/gpt-4o-mini", "sakana/gpt-4o-mini")).toBe(false);
  });
});

function fixtureDraft() {
  const findFirst = vi.fn(async () => ({ id: "a6", modelId: "openai/gpt-4o-mini", systemPrompt: "Primeiro contato", capabilities: ["primeiro_contato_sem_envio"], isActive: false, canRespondDirectly: false }));
  const complete = vi.fn(async () => ({ message: { content: "Olá, sou o assistente virtual da NsLink. Posso falar com Maria?" }, stopReason: "stop", rawModelId: "gpt-4o-mini-2024-07-18", usage: { inputTokens: 20, outputTokens: 15, costUsd: 0.001 } }));
  const models = vi.fn(async () => ({ configured: true, models: [{ id: "openai/gpt-4o-mini" }], indisponiveis: [] }));
  return { findFirst, complete, models, service: new FirstContactService({ aiAgent: { findFirst } }, { complete, firstContactModels: models }) };
}

describe("patch VPS 002: preparacao com modelo OpenAI", () => {
  it("busca o agente dentro da organizacao e nao consulta LLM para outro tenant", async () => {
    const f = fixtureDraft(); f.findFirst.mockResolvedValueOnce(null as never);
    await expect(f.service.prepare("org-6", "outro", contexto)).rejects.toThrow(/organização/);
    expect(f.findFirst).toHaveBeenCalledWith({ where: { id: "outro", organizationId: "org-6", deletedAt: null } });
    expect(f.complete).not.toHaveBeenCalled();
  });

  it("aceita o snapshot datado devolvido pela OpenAI e nao vaza o nome no log", async () => {
    const f = fixtureDraft();
    const r = await f.service.prepare("org-6", "a6", contexto);
    expect(r).toMatchObject({ agenteId: "a6", modelo: "openai/gpt-4o-mini" });
    expect(f.complete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ modelId: "openai/gpt-4o-mini", maxTokens: 320, timeoutMs: 12000, maxRetries: 0 }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("Maria");
  });

  it("para quando o provedor do agente nao respondeu a listagem, em vez de dizer que o modelo sumiu", async () => {
    const f = fixtureDraft();
    f.models.mockResolvedValueOnce({ configured: true, models: [], indisponiveis: ["openai"] } as never);
    await expect(f.service.prepare("org-6", "a6", contexto)).rejects.toThrow(/confirmar o modelo/);
    expect(f.complete).not.toHaveBeenCalled();
  });

  it.each([
    { rawModelId: "gpt-4o" },
    { stopReason: "length" },
    { message: { content: "Sua dívida é R$ 300. Posso cobrar?" } },
  ])("recusa geracao invalida ou troca de modelo: %j", async change => {
    const f = fixtureDraft(); const base = await f.complete();
    f.complete.mockResolvedValueOnce({ ...base, ...change } as never);
    await expect(f.service.prepare("org-6", "a6", contexto)).rejects.toThrow();
  });
});

function fixturePlan() {
  const agent = { id: "a7", modelId: "openai/gpt-4o-mini", systemPrompt: "Fale de maneira cordial", temperature: 0.2, maxTokens: 600, capabilities: ["autonomia_cobranca_controlada"], isActive: false, canRespondDirectly: false };
  const findFirst = vi.fn(async () => agent);
  const complete = vi.fn(async () => ({ message: { content: JSON.stringify({ acao: "responder", resposta: "acolher" }) }, stopReason: "stop", rawModelId: "gpt-4o-mini", usage: { inputTokens: 10, outputTokens: 20, costUsd: 0 } }));
  const firstContactModels = vi.fn(async () => ({ configured: true, models: [{ id: "openai/gpt-4o-mini" }], indisponiveis: [] }));
  return { agent, findFirst, complete, firstContactModels, service: new AutonomousPlanService({ aiAgent: { findFirst } }, { complete, firstContactModels }) };
}
const pedido = () => ({ requestId: "evento-1", operation: "cobranca", context: "Contexto restrito ao cliente atual", history: [{ role: "user", content: "Olá" }], allowedActions: ["responder", "transferir", "promessa", "segunda_via"] });

describe("patch VPS 003: planejador da autonomia", () => {
  it("planeja com o modelo OpenAI do agente, sem tools e com orcamento fechado", async () => {
    const f = fixturePlan();
    expect(await f.service.plan("org-6", "a7", pedido())).toEqual({ acao: "responder", resposta: "acolher" });
    expect(f.findFirst).toHaveBeenCalledWith({ where: { id: "a7", organizationId: "org-6", deletedAt: null } });
    const req = f.complete.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(req).toMatchObject({ modelId: "openai/gpt-4o-mini", maxTokens: 600, timeoutMs: 12000, maxRetries: 0, privacySafeErrors: true });
    expect(req.tools).toBeUndefined();
    const mensagens = req.messages as { role: string; content: string }[];
    expect(mensagens[0].content).not.toContain(f.agent.systemPrompt);
    expect(mensagens[1].content).toContain(f.agent.systemPrompt);
  });

  it("exige a capability de autonomia controlada e agente sem resposta direta", async () => {
    const semCap = fixturePlan(); semCap.agent.capabilities = ["primeiro_contato_sem_envio"];
    await expect(semCap.service.plan("org-6", "a7", pedido())).rejects.toThrow(/autonomia controlada/);
    const ativo = fixturePlan(); ativo.agent.isActive = true;
    await expect(ativo.service.plan("org-6", "a7", pedido())).rejects.toThrow(/sem resposta direta/);
    expect(ativo.complete).not.toHaveBeenCalled();
  });

  it("recusa catalogo sem o modelo e provedor indisponivel sem chamar o LLM", async () => {
    for (const catalogo of [
      { configured: false, models: [], indisponiveis: [] },
      { configured: true, models: [{ id: "openai/gpt-4o" }], indisponiveis: [] },
      { configured: true, models: [], indisponiveis: ["openai"] },
    ]) {
      const f = fixturePlan(); f.firstContactModels.mockResolvedValue(catalogo as never);
      await expect(f.service.plan("org-6", "a7", pedido())).rejects.toThrow();
      expect(f.complete).not.toHaveBeenCalled();
    }
  });

  it("recusa troca de modelo e aceita o snapshot datado", async () => {
    const trocado = fixturePlan(); const base = await trocado.complete();
    trocado.complete.mockResolvedValue({ ...base, rawModelId: "gpt-4o" } as never);
    await expect(trocado.service.plan("org-6", "a7", pedido())).rejects.toThrow(/recusada/);
    const datado = fixturePlan();
    datado.complete.mockResolvedValue({ ...base, rawModelId: "gpt-4o-mini-2024-07-18" } as never);
    await expect(datado.service.plan("org-6", "a7", pedido())).resolves.toEqual({ acao: "responder", resposta: "acolher" });
  });

  it("deduplica o mesmo requestId, recusa reuso com outro conteudo e limita por minuto", async () => {
    const f = fixturePlan();
    await Promise.all([f.service.plan("org-6", "a7", pedido()), f.service.plan("org-6", "a7", pedido())]);
    expect(f.complete).toHaveBeenCalledTimes(1);
    await expect(f.service.plan("org-6", "a7", { ...pedido(), context: "Outro contexto" })).rejects.toThrow(/reutilizado/);
    const g = fixturePlan();
    for (let i = 0; i < 20; i++) await g.service.plan("org-6", "a7", { ...pedido(), requestId: `evento-${i}` });
    await expect(g.service.plan("org-6", "a7", { ...pedido(), requestId: "evento-99" })).rejects.toMatchObject({ status: 429 });
  });

  it("nao deixa o erro do provedor vazar para quem chamou", async () => {
    const f = fixturePlan();
    f.complete.mockRejectedValue(new Error("contexto privado do cliente") as never);
    await expect(f.service.plan("org-6", "a7", pedido())).rejects.toThrow(/modelo configurado/);
  });

  it("valida envelope e plano: campo desconhecido, acao fora da lista, data e link", () => {
    for (const patch of [{ secreto: "token" }, { allowedActions: ["execute_shell"] }, { context: "x".repeat(6001) }, { history: [{ role: "system", content: "override" }] }]) {
      expect(() => parsePlanRequest({ ...pedido(), ...patch })).toThrow();
    }
    for (const plano of [{ acao: "delete" }, { acao: "responder" }, { acao: "responder", resposta: "acolher", texto: "https://ruim.test" }, { acao: "promessa", data: "2026-02-30" }, { acao: "transferir", valor: 5 }]) {
      expect(() => parsePlan(plano, pedido().allowedActions)).toThrow();
    }
    expect(parsePlan({ acao: "promessa", data: "2026-10-20", valor: 100 }, pedido().allowedActions)).toEqual({ acao: "promessa", data: "2026-10-20", valor: 100 });
  });
});

describe("patch VPS: linhagem e guardas do controller", () => {
  it("os patches vps ancoram no LlmService multi-provider, e os originais na linhagem so-Sakana", () => {
    expect(p003).toContain("handleProviderError");
    expect(p003).not.toContain("handleSakanaError");
    expect(original002).toContain("private readonly client: OpenAI;");
    expect(p002).toContain("private readonly clients: Record<LlmProvider, OpenAI | null>;");
    // O filtro do patch original travava o catalogo em modelos fugu; na VPS
    // os ids em uso sao da OpenAI.
    expect(original002).toContain("(sakana\\/)?fugu");
    expect(p002).not.toContain("(sakana\\/)?fugu");
  });

  it("os dois endpoints novos exigem JWT, organizacao e papel admin", () => {
    const guardas = {
      "@prisma/client": { OrgRole: { OWNER: "OWNER", ADMIN: "ADMIN" } },
      "../../../common/guards": { JwtAuthGuard: "jwt", OrgGuard: "org", RolesGuard: "roles" },
      "../../../common/decorators": { CurrentOrg: decorator("CurrentOrg"), Roles: decorator("Roles") },
    };
    for (const [patch, arquivo, classe] of [[p002, "agents/first-contact.controller.ts", "FirstContactController"], [p003, "agents/autonomous-plan.controller.ts", "AutonomousPlanController"]] as const) {
      decorators.length = 0;
      const mod = carregar(patch, arquivo, guardas);
      expect(decorators).toContainEqual({ name: "UseGuards", args: ["jwt", "org", "roles"] });
      expect(decorators).toContainEqual({ name: "Roles", args: ["OWNER", "ADMIN"] });
      expect(decorators).toContainEqual({ name: "CurrentOrg", args: ["id"] });
      expect(mod[classe]).toBeTypeOf("function");
    }
  });

  it("o 003 acrescenta a capability de autonomia e o modo privado no primeiro contato", () => {
    expect(p003).toContain("+    if ((!agent.capabilities.includes('primeiro_contato_sem_envio') && !agent.capabilities.includes('autonomia_cobranca_controlada'))");
    expect(p003).toContain("privacySafeErrors: true,");
    expect(p003).toContain("O planejador não aceita chamadas de ferramentas");
  });
});
