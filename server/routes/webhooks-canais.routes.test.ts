import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../services/cobranca/canais-comunicacao.service", () => ({ obterConfiguracaoCanaisInterna: vi.fn() }));
vi.mock("../services/chat/chat-multicanal.service", () => ({ persistirRetornoMulticanal: vi.fn() }));
import { buscarEmailRecebido, chaveDoWebhookDeCanal, LIMITE_POR_IP_DOS_WEBHOOKS, LIMITE_POR_PROVEDOR_DOS_WEBHOOKS, registerWebhooksCanaisRoutes, verificarAssinaturaSms, verificarEventoEmail } from "./webhooks-canais.routes";
import { obterConfiguracaoCanaisInterna } from "../services/cobranca/canais-comunicacao.service";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
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
  it("demonstração não consulta o Resend: recusa antes de qualquer fetch; fora dela consulta", async () => {
    const id = "3f2b4c1e-8d9a-4c7b-9e1f-2a3b4c5d6e7f";
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ id, from: "cliente@example.com", to: ["chat+abc@respostas.example.com"], subject: null, text: "oi", html: null }))));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DEMO_MODE", "true");
    await expect(buscarEmailRecebido(id, "re_privado")).rejects.toThrow("Demonstração");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("DEMO_MODE", "false");
    await expect(buscarEmailRecebido(id, "re_privado")).resolves.toMatchObject({ id, text: "oi" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("cota dos retornos por provedor", () => {
  // Twilio e Resend chamam de poucos IPs compartilhados por TODOS os provedores:
  // um balde por IP faz o tenant movimentado gastar a cota dos outros, e a
  // resposta de um SMS perdido não volta. O balde é do provedor da URL — só
  // depois de validar o inteiro, senão cada lixo de URL viraria um balde novo.
  it("provedor válido tem o próprio balde; URL inválida cai no balde do IP", () => {
    const req = (providerId: string, ip = "203.0.113.7") => ({ params: { providerId }, ip, session: {} }) as unknown as import("express").Request;
    expect(chaveDoWebhookDeCanal(req("9"))).toBe("webhook-canal:9");
    expect(chaveDoWebhookDeCanal(req("9", "198.51.100.1"))).toBe("webhook-canal:9");
    expect(chaveDoWebhookDeCanal(req("8"))).not.toBe(chaveDoWebhookDeCanal(req("9")));
    for (const lixo of ["abc", "0", "-1", "1.5", "9007199254740993", ""]) expect(chaveDoWebhookDeCanal(req(lixo)), lixo).toBe("ip:203.0.113.7");
  });

  /**
   * O balde por provedor sozinho tirou o teto por IP: o endpoint é público, o
   * `providerId` vem da URL e cada inteiro novo abria um balde de 600/min — um
   * IP só, rotacionando o id, fazia leituras ilimitadas em cobranca_canais_config
   * (SELECT + decifrar) antes do 401. Revisão de 16/09/2026: os dois limitadores
   * encadeados — o do IP com teto alto (Twilio/Resend chamam de poucos IPs para
   * todos os tenants), o do provedor com o dele.
   */
  describe("os dois baldes encadeados na rota", () => {
    type Middleware = (req: unknown, res: unknown, next: () => void) => unknown;
    const rotas = new Map<string, Middleware[]>();
    registerWebhooksCanaisRoutes({ post: (caminho: string, ...fila: Middleware[]) => { rotas.set(caminho, fila); } } as never);
    const respostaFalsa = () => { const r = { codigo: undefined as number | undefined, setHeader: () => undefined, status: (s: number) => { r.codigo = s; return r; }, json: () => r }; return r; };
    /** Passa a requisição pelos limitadores (tudo antes do handler); devolve se chegou ao handler ou o status da recusa. */
    const tentar = (caminho: string, providerId: string, ip: string) => {
      const fila = rotas.get(caminho)!;
      const limitadores = fila.slice(0, -1);
      const req = { params: { providerId }, ip, session: {} };
      const res = respostaFalsa();
      let chegou = false;
      const correr = (i: number): void => { if (i === limitadores.length) { chegou = true; return; } limitadores[i](req, res, () => correr(i + 1)); };
      correr(0);
      return chegou ? "handler" : res.codigo;
    };
    it("o handler fica atrás de DOIS limitadores nas duas rotas, e o teto por IP é maior que o por provedor", () => {
      for (const caminho of ["/api/webhooks/canais/sms/:providerId", "/api/webhooks/canais/email/:providerId"]) expect(rotas.get(caminho)!.length, caminho).toBe(3);
      expect(LIMITE_POR_IP_DOS_WEBHOOKS).toBeGreaterThan(LIMITE_POR_PROVEDOR_DOS_WEBHOOKS);
    });
    it("um IP só, variando o providerId, bate no teto por IP antes de tocar o banco", () => {
      const resultados: unknown[] = [];
      for (let i = 1; i <= LIMITE_POR_IP_DOS_WEBHOOKS + 1; i++) resultados.push(tentar("/api/webhooks/canais/sms/:providerId", String(100000 + i), "198.51.100.9"));
      expect(resultados.slice(0, LIMITE_POR_IP_DOS_WEBHOOKS).every(r => r === "handler")).toBe(true);
      expect(resultados[LIMITE_POR_IP_DOS_WEBHOOKS]).toBe(429);
      expect(obterConfiguracaoCanaisInterna).not.toHaveBeenCalled();
    });
    it("o balde do provedor continua o dele: a 601ª chamada ao mesmo provedor é 429 mesmo vindo de IPs diferentes, e outro provedor segue passando", () => {
      const rota = "/api/webhooks/canais/email/:providerId";
      for (let i = 1; i <= LIMITE_POR_PROVEDOR_DOS_WEBHOOKS; i++) expect(tentar(rota, "7", `203.0.113.${(i % 200) + 1}`)).toBe("handler");
      expect(tentar(rota, "7", "203.0.113.250")).toBe(429);
      expect(tentar(rota, "8", "203.0.113.250")).toBe("handler");
    });
  });
});
