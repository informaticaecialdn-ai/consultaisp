import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../services/cobranca/canais-comunicacao.service", () => ({ obterConfiguracaoCanaisInterna: vi.fn() }));
vi.mock("../services/chat/chat-multicanal.service", () => ({ persistirRetornoMulticanal: vi.fn() }));
import { buscarEmailRecebido, verificarAssinaturaSms, verificarEventoEmail } from "./webhooks-canais.routes";

afterEach(() => { vi.unstubAllGlobals(); });
describe("assinaturas dos retornos multicanal", () => {
  it("Twilio inclui parâmetros desconhecidos e URL canônica na assinatura", () => {
    const url = "https://isp.example/api/webhooks/canais/sms/9";
    const body = { From: "+5511999991111", Body: "Olá", NovoCampo: "preservado" };
    const assinatura = createHmac("sha1", "token").update(url + "BodyOláFrom+5511999991111NovoCampopreservado").digest("base64");
    expect(verificarAssinaturaSms(url, body, "token", assinatura)).toBe(true);
    expect(verificarAssinaturaSms(url.replace("/9", "/8"), body, "token", assinatura)).toBe(false);
    expect(verificarAssinaturaSms(url, { ...body, Body: "alterado" }, "token", assinatura)).toBe(false);
    expect(verificarAssinaturaSms(url, body, "outro", assinatura)).toBe(false);
    expect(verificarAssinaturaSms(url, body, "token", "")).toBe(false);
  });
  it("Resend verifica corpo cru, tenant secret e rejeita replay fora da janela", () => {
    const chave = Buffer.from("segredo-ficticio-de-teste-32-bytes");
    const secret = `whsec_${chave.toString("base64")}`;
    const payload = '{ "type": "email.received", "data": {} }';
    const id = "msg_test";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = `v1,${createHmac("sha256", chave).update(`${id}.${timestamp}.${payload}`).digest("base64")}`;
    expect(verificarEventoEmail(payload, { id, timestamp, signature }, secret)).toMatchObject({ type: "email.received" });
    expect(() => verificarEventoEmail(JSON.stringify(JSON.parse(payload)), { id, timestamp, signature }, secret)).toThrow();
    expect(() => verificarEventoEmail(payload, { id, timestamp, signature: "v1,invalid" }, secret)).toThrow();
    const velho = (Number(timestamp) - 600).toString();
    const replay = `v1,${createHmac("sha256", chave).update(`${id}.${velho}.${payload}`).digest("base64")}`;
    expect(() => verificarEventoEmail(payload, { id, timestamp: velho, signature: replay }, secret)).toThrow();
  });
  it("recebimento consulta host fixo autenticado e bloqueia corpo acima de 1 MB", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("x".repeat(1024 * 1024 + 1)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(buscarEmailRecebido("email-id", "re_privado")).rejects.toThrow("excede limite");
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails/receiving/email-id?html_format=cid", expect.objectContaining({ headers: { Authorization: "Bearer re_privado" }, redirect: "error" }));
  });
});
