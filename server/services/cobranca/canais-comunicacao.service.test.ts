import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn(), fetch: vi.fn() }));
vi.mock("../../db", () => ({ pool: mocks }));
import { encryptField, decryptField } from "../../utils/crypto";
import { enviarComunicacaoCobranca, MOTIVO_DEMO_NAO_ENVIA, obterConfiguracaoCanais, salvarConfiguracaoCanais } from "./canais-comunicacao.service";
import type { ConfiguracaoCanais, MensagemCobranca } from "@shared/cobranca/canais-comunicacao";

const config = (): ConfiguracaoCanais => ({
  sms: { ativado: true, accountSid: `AC${"1".repeat(32)}`, authToken: "token-so-do-provedor", remetente: "+5511999991111" },
  email: { ativado: true, apiKey: "re_chave_so_do_provedor", remetente: "financeiro@example.com", nomeRemetente: "Meu ISP", responderPara: "suporte@example.com" },
});
const mensagem = (canal: "sms" | "email" = "email"): MensagemCobranca => ({ canal, destinatario: canal === "email" ? "cliente@example.com" : "+5511999992222", texto: "Sua fatura vence amanhã.", assunto: "Sua fatura", idempotencyKey: "aviso-123" });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SESSION_SECRET", "segredo-ficticio-apenas-para-testes-canais");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.query.mockResolvedValue({ rows: [{ config_cifrada: encryptField(JSON.stringify(config())) }] });
  mocks.connect.mockResolvedValue(mocks);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("transportes de cobrança por provedor", () => {
  it("preserva segredo de recebimento cifrado e nunca o devolve no resumo", async () => {
    const c = config();
    c.email.receivingDomain = "respostas.example.com";
    c.email.webhookSecret = "whsec_c2VncmVkby1maWN0aWNpby1kZS10ZXN0ZQ==";
    mocks.query.mockResolvedValue({ rows: [{ config_cifrada: encryptField(JSON.stringify(c)) }] });
    const resumo = await obterConfiguracaoCanais(9);
    expect(resumo.email.recebimentoConfigurado).toBe(true);
    expect(JSON.stringify(resumo)).not.toContain("whsec_");
    await salvarConfiguracaoCanais(9, { ...c, email: { ...c.email, webhookSecret: "" } });
    const gravacao = mocks.query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO cobranca_canais_config"));
    expect(decryptField(gravacao?.[1][1])).toContain(c.email.webhookSecret);
  });
  it("aceita formato e endereço de resposta internos sem alterar o texto puro", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ id: "email-formatado" })));
    await enviarComunicacaoCobranca(9, mensagem(), { html: "<p>Proposta</p>", replyTo: "chat+abc@respostas.example.com" });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ text: mensagem().texto, html: "<p>Proposta</p>", reply_to: "chat+abc@respostas.example.com" });
  });
  it("Resend recebe só a credencial do provedor, texto puro, reply-to e idempotência", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ id: "email-123" }), { status: 200 }));
    expect(await enviarComunicacaoCobranca(9, mensagem())).toEqual({ status: "enviado", providerMessageId: "email-123" });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("provider_id = $1"), [9]);
    const [url, req] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(req.headers.Authorization).toBe("Bearer re_chave_so_do_provedor");
    expect(req.headers["Idempotency-Key"]).toMatch(/^cobranca-9-[a-f0-9]{64}$/);
    expect(JSON.parse(req.body)).toMatchObject({ text: mensagem().texto, reply_to: "suporte@example.com" });
    expect(req.redirect).toBe("error");
  });
  it("Twilio usa API fixa, autenticação Basic e body URL-encoded", async () => {
    const sid = `SM${"2".repeat(32)}`;
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ sid, status: "queued" }), { status: 201 }));
    expect(await enviarComunicacaoCobranca(9, mensagem("sms"))).toEqual({ status: "enviado", providerMessageId: sid });
    const [url, req] = mocks.fetch.mock.calls[0];
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${config().sms.accountSid}/Messages.json`);
    expect(new URLSearchParams(req.body).get("To")).toBe("+5511999992222");
    expect(req.headers.Authorization).toBe(`Basic ${Buffer.from(`${config().sms.accountSid}:token-so-do-provedor`).toString("base64")}`);
  });
  it("timeout nunca autoriza repetir envio e não vaza exceção", async () => {
    mocks.fetch.mockRejectedValue(new Error("token-so-do-provedor"));
    const r = await enviarComunicacaoCobranca(9, mensagem("sms"));
    expect(r.status).toBe("incerto");
    expect(JSON.stringify(r)).not.toContain("token-so-do-provedor");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([[503, "incerto"], [408, "incerto"], [401, "falhou"], [429, "falhou"]])("HTTP %s resulta em %s sem devolver o corpo remoto", async (status, esperado) => {
    mocks.fetch.mockResolvedValue(new Response("credencial-privada", { status: Number(status) }));
    const r = await enviarComunicacaoCobranca(9, mensagem());
    expect(r.status).toBe(esperado);
    expect(JSON.stringify(r)).not.toContain("credencial-privada");
  });
  it("200 sem ID é incerto", async () => {
    mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    expect((await enviarComunicacaoCobranca(9, mensagem())).status).toBe("incerto");
  });
  it("demonstração não chama Twilio nem Resend: falha com motivo claro e nenhum fetch; fora dela o mesmo envio sai", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ id: "nunca-deveria-sair" })));
    for (const canal of ["email", "sms"] as const) {
      expect(await enviarComunicacaoCobranca(9, mensagem(canal), { html: "<p>x</p>" })).toEqual({ status: "falhou", motivo: MOTIVO_DEMO_NAO_ENVIA });
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
    // O outro lado: só a variável separa a demonstração da produção; com ela desligada o transporte fala com o fornecedor.
    vi.stubEnv("DEMO_MODE", "false");
    expect((await enviarComunicacaoCobranca(9, mensagem())).status).toBe("enviado");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("rejeita destino/canal desativado antes de qualquer requisição", async () => {
    expect((await enviarComunicacaoCobranca(9, { ...mensagem("sms"), destinatario: "11999999999" })).status).toBe("falhou");
    const c = config(); c.email.ativado = false;
    mocks.query.mockResolvedValue({ rows: [{ config_cifrada: encryptField(JSON.stringify(c)) }] });
    expect((await enviarComunicacaoCobranca(9, mensagem())).status).toBe("falhou");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("leitura não devolve tokens", async () => {
    const r = await obterConfiguracaoCanais(9);
    expect(r.sms.configurado).toBe(true);
    expect(r.email.configurado).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/token-so|re_chave|authToken|apiKey/);
  });
  it("grava cifrado e mantém chaves omitidas numa edição", async () => {
    const entrada = config(); delete entrada.sms.authToken; delete entrada.email.apiKey;
    entrada.email.nomeRemetente = "Outro nome";
    const resultado = await salvarConfiguracaoCanais(9, entrada);
    expect(resultado.email.configurado).toBe(true);
    const insert = mocks.query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT"));
    expect(insert?.[1][0]).toBe(9);
    const cifrado: string = insert?.[1][1];
    expect(cifrado).toMatch(/^enc:/);
    expect(cifrado).not.toContain("token-so-do-provedor");
    expect(JSON.parse(decryptField(cifrado)!)).toMatchObject({ sms: { authToken: config().sms.authToken }, email: { apiKey: config().email.apiKey, nomeRemetente: "Outro nome" } });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("recusa ativar sem credenciais e desfaz transação", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const entrada = config(); delete entrada.sms.authToken;
    await expect(salvarConfiguracaoCanais(9, entrada)).rejects.toThrow("Preencha as credenciais");
    expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).startsWith("INSERT"))).toBe(false);
  });
});
