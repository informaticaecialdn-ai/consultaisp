import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

// Executa os arquivos completos adicionados pelo patch 001 (canais Zappfy,
// Uazapi e Datafy), sem instalar Nest/axios nem copiar código do fork para os
// testes. Molde: chat-bullq-draft.patch.test.ts.
const CAMINHO = "integrations/chat-bullq/patches/001-whatsapp-providers.patch";
const patch = readFileSync(CAMINHO, "utf8");
const decorators: { name: string; args: unknown[] }[] = [];
const decorator = (name: string) => (...args: unknown[]) => { decorators.push({ name, args }); return () => undefined; };
const nest = { BadRequestException: class extends Error {} };
function bloco(caminho: string) {
  return patch.split(`diff --git a/${caminho} b/${caminho}\n`)[1]?.split("diff --git ")[0];
}
function carregar(caminho: string, adicionais: Record<string, unknown> = {}) {
  const b = bloco(caminho);
  if (!b || !b.includes("new file mode")) throw new Error(`Arquivo novo ausente do patch: ${caminho}`);
  const source = b.split(/\r?\n/).filter(l => l.startsWith("+") && !l.startsWith("+++")).map(l => l.slice(1)).join("\n");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: false } });
  const exports: Record<string, unknown> = {};
  const modules: Record<string, unknown> = { "@nestjs/common": nest, crypto, ...adicionais };
  runInNewContext(output.outputText, { exports, Date, URL, Buffer, process, require: (id: string) => { if (!(id in modules)) throw new Error(`Dependência não permitida no canal: ${id}`); return modules[id]; } });
  return exports;
}
const ZAPPFY = "src/modules/channel-hub/adapters/zappfy";
const DATAFY = "src/modules/channel-hub/adapters/whatsapp-official";
const { resolveUnofficialConfig } = carregar(`${ZAPPFY}/whatsapp-provider-config.ts`) as { resolveUnofficialConfig(config: Record<string, unknown>): { provider: string; baseUrl: string; token: string } };
type Conexao = { provider: string; status: string; connected: boolean; loggedIn: boolean; phone: string | null; qrCode: string | null; pairCode: string | null };
const { sanitizeZappfyConnection } = carregar(`${ZAPPFY}/zappfy-connection.ts`) as { sanitizeZappfyConnection(payload: unknown, provider?: string): Conexao };
const { validateDatafyWebhook, datafyJobOptions } = carregar(`${DATAFY}/datafy-webhook.ts`) as {
  validateDatafyWebhook(headers: Record<string, string>, raw: Buffer, secret?: string): boolean;
  datafyJobOptions(channelId: string, raw: Buffer, kind: string, externalId: string): { jobId: string; removeOnComplete: { age: number }; removeOnFail: boolean };
};

describe("patch 001: forma do arquivo", () => {
  it("é um git diff só do channel-hub e do pipeline de entrada, com LF, e cada arquivo novo declara new file mode", () => {
    expect(patch).not.toContain("\r");
    const arquivos = [...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map(m => { expect(m[1]).toBe(m[2]); return m[1]; });
    expect(arquivos.every(a => a.startsWith("src/modules/channel-hub/") || a === "src/modules/messaging/pipeline/inbound-message.processor.ts")).toBe(true);
    const novos = [`${ZAPPFY}/whatsapp-provider-config.ts`, `${ZAPPFY}/zappfy-connection.ts`, `${DATAFY}/datafy-webhook.ts`, "src/modules/channel-hub/channels/dto/connect-channel.dto.ts"];
    for (const n of novos) expect(bloco(n)).toMatch(/^new file mode 100644\n.*\n--- \/dev\/null\n\+\+\+ b\//);
    for (const m of ["src/modules/channel-hub/channels/channels.controller.ts", "src/modules/channel-hub/channels/channels.service.ts", "src/modules/channel-hub/webhook-gateway.controller.ts", `${ZAPPFY}/zappfy.http-client.ts`, `${DATAFY}/whatsapp-official.http-client.ts`]) {
      expect(bloco(m)).toMatch(/^index [0-9a-f]+\.\.[0-9a-f]+ 100644\n--- a\//);
    }
    // Os specs viajam junto: quem aplica o patch no fork roda o jest dele.
    for (const s of ["datafy-delivery.spec.ts", "datafy.spec.ts"]) expect(bloco(`${DATAFY}/${s}`)).toContain("new file mode");
    for (const s of ["uazapi-config.spec.ts", "zappfy-connection.spec.ts"]) expect(bloco(`${ZAPPFY}/${s}`)).toContain("new file mode");
    expect(bloco("src/modules/channel-hub/channels/channels-connection.spec.ts")).toContain("new file mode");
  });
  it("o pareamento só aceita telefone internacional em dígitos", () => {
    decorators.length = 0;
    carregar("src/modules/channel-hub/channels/dto/connect-channel.dto.ts", {
      "class-validator": { IsOptional: decorator("IsOptional"), IsString: decorator("IsString"), Matches: decorator("Matches") },
      "@nestjs/swagger": { ApiPropertyOptional: decorator("ApiPropertyOptional") },
    });
    const matches = decorators.find(d => d.name === "Matches");
    // A RegExp nasce no realm do vm: comparar pela forma, não pela identidade do construtor.
    expect(Object.prototype.toString.call(matches?.args[0])).toBe("[object RegExp]");
    expect(String(matches!.args[0])).toBe("/^\\d{10,15}$/");
    expect(decorators.map(d => d.name)).toContain("IsOptional");
  });
});

describe("patch 001: credencial do canal não oficial", () => {
  const anterior = process.env.UAZAPI_ALLOWED_HOSTS;
  afterEach(() => { if (anterior === undefined) delete process.env.UAZAPI_ALLOWED_HOSTS; else process.env.UAZAPI_ALLOWED_HOSTS = anterior; });
  it("canal antigo continua Zappfy na origem fixa; Uazapi aceita só a origem HTTPS da instância", () => {
    expect(resolveUnofficialConfig({ token: "fixture" })).toEqual({ provider: "ZAPPFY", baseUrl: "https://api.zappfy.io", token: "fixture" });
    expect(resolveUnofficialConfig({ provider: "UAZAPI", token: "fixture", baseUrl: "https://tenant.uazapi.com/" }).baseUrl).toBe("https://tenant.uazapi.com");
  });
  it.each(["http://tenant.uazapi.com", "https://127.0.0.1", "https://uazapi.com.attacker.test", "https://tenant.uazapi.com/other", "https://name:pass@tenant.uazapi.com", "https://tenant.uazapi.com?token=abc", "https://tenant.uazapi.com:8443", "https://tenant.uazapi.com#fragment"])("rejeita %s", baseUrl => {
    expect(() => resolveUnofficialConfig({ provider: "UAZAPI", token: "fixture", baseUrl })).toThrow(/origem HTTPS/);
  });
  it("token vazio, com quebra de linha ou provider desconhecido não passam", () => {
    expect(() => resolveUnofficialConfig({ token: " " })).toThrow(/Token/);
    expect(() => resolveUnofficialConfig({ token: "a\nb" })).toThrow(/Token/);
    expect(() => resolveUnofficialConfig({ provider: "OUTRO", token: "fixture" })).toThrow(/inválido/);
  });
  it("instância própria só entra pela allowlist do operador do deploy", () => {
    delete process.env.UAZAPI_ALLOWED_HOSTS;
    expect(() => resolveUnofficialConfig({ provider: "UAZAPI", token: "fixture", baseUrl: "https://wa.example.test" })).toThrow();
    process.env.UAZAPI_ALLOWED_HOSTS = "wa.example.test";
    expect(resolveUnofficialConfig({ provider: "UAZAPI", token: "fixture", baseUrl: "https://wa.example.test" }).baseUrl).toBe("https://wa.example.test");
  });
});

describe("patch 001: estado da conexão sem vazar a instância", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
  const conectando = { instance: { status: "connecting", qrcode: png, paircode: "1234-5678", token: "fixture-provider-secret", openai_apikey: "fixture-llm-secret" }, status: { connected: false, loggedIn: false, jid: null } };
  it("conectando devolve QR e código de pareamento; token e chave da IA nunca saem", () => {
    const r = sanitizeZappfyConnection(conectando);
    expect(r).toEqual({ provider: "ZAPPFY", status: "connecting", connected: false, loggedIn: false, phone: null, qrCode: png, pairCode: "1234-5678" });
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(sanitizeZappfyConnection(conectando, "UAZAPI").provider).toBe("UAZAPI");
  });
  it("QR cru em base64 ganha o prefixo PNG; a resposta do connect com booleanos no topo também vale", () => {
    expect(sanitizeZappfyConnection({ instance: { ...conectando.instance, qrcode: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" }, connected: false, loggedIn: false }).qrCode).toBe(png);
  });
  it("conectado só quando autenticado, e sem QR ou pareamento velho", () => {
    expect(sanitizeZappfyConnection({ ...conectando, instance: { ...conectando.instance, status: "connected" }, status: { connected: true, loggedIn: true, jid: { user: "5511999999999" } } }))
      .toEqual({ provider: "ZAPPFY", status: "connected", connected: true, loggedIn: true, phone: "5511999999999", qrCode: null, pairCode: null });
    expect(sanitizeZappfyConnection({ ...conectando, status: { connected: true, loggedIn: false, jid: null } }).connected).toBe(false);
  });
  it.each(["https://attacker.invalid/qr", "data:image/svg+xml;base64,PHN2Zz4=", "data:text/html,hello"])("QR inseguro vira nulo: %s", qrcode => {
    expect(sanitizeZappfyConnection({ ...conectando, instance: { ...conectando.instance, qrcode } }).qrCode).toBeNull();
  });
  it("payload desconhecido não vira instância conectada", () => {
    const r = sanitizeZappfyConnection({ instance: { token: "fixture-secret" } });
    expect(r.status).toBe("unknown"); expect(r.connected).toBe(false); expect(JSON.stringify(r)).not.toContain("fixture-secret");
    expect(sanitizeZappfyConnection({ ...conectando, instance: { ...conectando.instance, status: "hibernated" } }).status).toBe("disconnected");
  });
});

describe("patch 001: webhook Datafy assinado e sem replay", () => {
  const segredo = "whsec_fixture_only";
  const raw = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
  const agora = () => Math.floor(Date.now() / 1000);
  function headers(segundos = agora(), chave = segredo) {
    const timestamp = String(segundos);
    return { "x-datafy-delivery-id": "11111111-1111-4111-8111-111111111111", "x-datafy-timestamp": timestamp, "x-datafy-signature-256": "sha256=" + crypto.createHmac("sha256", chave).update(`${timestamp}.`).update(raw).digest("hex") };
  }
  it("aceita os bytes exatos assinados com o segredo whsec_ dentro da janela", () => {
    expect(validateDatafyWebhook(headers(), raw, segredo)).toBe(true);
  });
  it("rejeita corpo alterado, relógio fora de 300 s, entrega sem id, segredo errado ou sem prefixo", () => {
    expect(validateDatafyWebhook(headers(), Buffer.from("{}"), segredo)).toBe(false);
    for (const desvio of [-301, 301]) expect(validateDatafyWebhook(headers(agora() + desvio), raw, segredo)).toBe(false);
    expect(validateDatafyWebhook({ ...headers(), "x-datafy-delivery-id": "" }, raw, segredo)).toBe(false);
    expect(validateDatafyWebhook(headers(), raw, "whsec_other")).toBe(false);
    expect(validateDatafyWebhook(headers(agora(), "sem_prefixo"), raw, "sem_prefixo")).toBe(false);
    expect(validateDatafyWebhook(headers(), raw, undefined)).toBe(false);
    expect(validateDatafyWebhook({ "x-hub-signature-256": "sha256=" + "a".repeat(64) }, raw, segredo)).toBe(false);
  });
  it("o id do job vem dos bytes assinados, não do header de entrega, e a falha fica retentável", () => {
    const a = datafyJobOptions("canal-a", raw, "message", "wamid.1");
    expect(a.jobId).toMatch(/^datafy-[a-f0-9]{64}$/);
    expect(a).toMatchObject({ removeOnComplete: { age: 7 * 24 * 60 * 60 }, removeOnFail: false });
    expect(datafyJobOptions("canal-a", raw, "message", "wamid.1").jobId).toBe(a.jobId);
    expect(datafyJobOptions("canal-b", raw, "message", "wamid.1").jobId).not.toBe(a.jobId);
    expect(datafyJobOptions("canal-a", Buffer.from("{}"), "message", "wamid.1").jobId).not.toBe(a.jobId);
  });
});
