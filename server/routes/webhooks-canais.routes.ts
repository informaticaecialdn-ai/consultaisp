import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { Resend } from "resend";
import { z } from "zod";
import { chaveDoLimite, createRateLimiter } from "../middleware/rate-limiter.middleware";
import { emModoDemo } from "../demo/modo-demo";
import { obterConfiguracaoCanaisInterna } from "../services/cobranca/canais-comunicacao.service";
import { persistirRetornoMulticanal } from "../services/chat/chat-multicanal.service";

/**
 * Quem paga a cota dos retornos: o PROVEDOR da URL — e, por cima, o IP.
 *
 * Twilio e Resend chamam de poucos IPs, compartilhados por todos os provedores.
 * Com só o balde por IP (120/min), um tenant movimentado gastava a cota dos
 * outros e a resposta de um cliente por SMS voltava 429 — e resposta perdida
 * não volta. Chavear pelo provedor só depois de validar o inteiro: lixo de URL
 * (`abc`, `0`, `1.5`) cai no balde do IP em vez de abrir um balde novo a cada
 * variação.
 *
 * Só o balde por provedor, porém, tirou o teto por IP num endpoint público
 * cujo `providerId` quem manda é o remetente: um IP rotacionando o inteiro
 * abria um balde novo de 600/min a cada id, e cada requisição pagava uma
 * leitura em cobranca_canais_config (SELECT + decifrar) antes do 401. Por isso
 * os DOIS limitadores encadeados (`registerWebhooksCanaisRoutes`): o do IP com
 * teto alto o bastante para um fornecedor entregar os retornos de todos os
 * tenants, o do provedor com a cota dele. Contar só falhas de assinatura por
 * IP seria mais fino, mas exigiria um contador em cada recusa dos dois
 * handlers; fica como evolução.
 */
export function chaveDoWebhookDeCanal(req: import("express").Request): string {
  const providerId = Number(req.params.providerId);
  return Number.isSafeInteger(providerId) && providerId > 0 ? `webhook-canal:${providerId}` : chaveDoLimite(req);
}
/** Por provedor: a cota de UM tenant, não a soma de todos. */
export const LIMITE_POR_PROVEDOR_DOS_WEBHOOKS = 600;
/** Por IP: cinco tenants movimentados no mesmo IP da Twilio ainda cabem; um só IP variando a URL não passa disso. */
export const LIMITE_POR_IP_DOS_WEBHOOKS = 3000;

/** Twilio signs the exact configured URL plus every alphabetically sorted form parameter. */
export function verificarAssinaturaSms(url: string, parametros: Record<string, string>, token: string, assinatura: string): boolean {
  if (!token || !assinatura || !url.startsWith("https://")) return false;
  const conteudo = url + Object.keys(parametros).sort().map(k => k + parametros[k]).join("");
  const esperada = createHmac("sha1", token).update(conteudo).digest("base64");
  const recebida = Buffer.from(assinatura);
  return recebida.length === esperada.length && timingSafeEqual(recebida, Buffer.from(esperada));
}

export function verificarEventoEmail(payload: string, headers: { id: string; timestamp: string; signature: string }, webhookSecret: string): unknown {
  // Official SDK delegates to Svix, including the five-minute replay timestamp window.
  return new Resend("verification-only").webhooks.verify({ payload, headers, webhookSecret });
}

const endereco = (valor: string): string => (valor.match(/<([^<>]+)>\s*$/)?.[1] || valor).trim().toLowerCase();
const EmailRecebidoSchema = z.object({
  id: z.string().uuid(), from: z.string().max(500), to: z.array(z.string().max(500)).max(100),
  subject: z.string().max(2000).nullish(), text: z.string().nullish(), html: z.string().nullish(),
});
/** Fixed host, bounded stream, no redirects or attachment downloads. */
export async function buscarEmailRecebido(id: string, apiKey: string): Promise<z.infer<typeof EmailRecebidoSchema>> {
  // A demonstração não fala com o Resend: a chave gravada lá é falsa e a
  // consulta sairia para a rede. Recusar antes do fetch vira 503 no handler —
  // sem canal de recebimento real configurado, nenhum evento legítimo chega aqui.
  if (emModoDemo()) throw new Error("Demonstração não consulta o fornecedor de e-mail");
  const resposta = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}?html_format=cid`, {
    headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000), redirect: "error",
  });
  if (!resposta.ok || !resposta.body) throw new Error("Consulta de e-mail indisponível");
  const leitor = resposta.body.getReader();
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    while (true) {
      const parte = await leitor.read();
      if (parte.done) break;
      tamanho += parte.value.byteLength;
      if (tamanho > 1024 * 1024) { await leitor.cancel(); throw new Error("E-mail excede limite"); }
      partes.push(parte.value);
    }
  } finally { leitor.releaseLock(); }
  return EmailRecebidoSchema.parse(JSON.parse(Buffer.concat(partes).toString("utf8")));
}

export function registerWebhooksCanaisRoutes(app: Express): void {
  // Dois baldes, o do IP primeiro: sem sessão a chave padrão é o IP — ver `chaveDoWebhookDeCanal`.
  const limitePorIp = createRateLimiter({ windowMs: 60000, maxRequests: LIMITE_POR_IP_DOS_WEBHOOKS });
  const limitePorProvedor = createRateLimiter({ windowMs: 60000, maxRequests: LIMITE_POR_PROVEDOR_DOS_WEBHOOKS, chave: chaveDoWebhookDeCanal });
  app.post("/api/webhooks/canais/sms/:providerId", limitePorIp, limitePorProvedor, async (req, res) => {
    const providerId = Number(req.params.providerId);
    if (!Number.isSafeInteger(providerId) || providerId <= 0) return res.sendStatus(401);
    try {
      const config = (await obterConfiguracaoCanaisInterna(providerId)).sms;
      const parametros = z.record(z.string().max(20000)).safeParse(req.body);
      if (!config.ativado || !config.authToken || !config.webhookUrl || !req.is("application/x-www-form-urlencoded") || !parametros.success || req.originalUrl !== `/api/webhooks/canais/sms/${providerId}` || !verificarAssinaturaSms(config.webhookUrl, parametros.data, config.authToken, req.get("X-Twilio-Signature") || "")) return res.sendStatus(401);
      const sms = z.object({ AccountSid: z.literal(config.accountSid), MessageSid: z.string().regex(/^SM[a-fA-F0-9]{32}$/), From: z.string().regex(/^\+[1-9]\d{7,14}$/), To: z.literal(config.remetente), Body: z.string().trim().min(1).max(20000) }).safeParse(parametros.data);
      if (!sms.success) return res.sendStatus(400);
      await persistirRetornoMulticanal(providerId, { canal: "sms", externalId: sms.data.MessageSid, remetente: sms.data.From, destinatario: sms.data.To, texto: sms.data.Body });
      return res.type("text/xml").send("<Response></Response>");
    } catch { return res.sendStatus(503); }
  });
  app.post("/api/webhooks/canais/email/:providerId", limitePorIp, limitePorProvedor, async (req, res) => {
    const providerId = Number(req.params.providerId);
    if (!Number.isSafeInteger(providerId) || providerId <= 0) return res.sendStatus(401);
    try {
      const config = (await obterConfiguracaoCanaisInterna(providerId)).email;
      const raw = (req as typeof req & { rawBody?: unknown }).rawBody;
      if (!config.ativado || !config.apiKey || !config.receivingDomain || !config.webhookSecret || !Buffer.isBuffer(raw) || raw.length > 262144) return res.sendStatus(401);
      let evento: unknown;
      try { evento = verificarEventoEmail(raw.toString("utf8"), { id: req.get("svix-id") || "", timestamp: req.get("svix-timestamp") || "", signature: req.get("svix-signature") || "" }, config.webhookSecret); }
      catch { return res.sendStatus(401); }
      const tipo = z.object({ type: z.string() }).safeParse(evento);
      if (tipo.success && tipo.data.type !== "email.received") return res.sendStatus(204);
      const validado = z.object({ type: z.literal("email.received"), data: z.object({ email_id: z.string().uuid() }) }).safeParse(evento);
      if (!validado.success) return res.sendStatus(400);
      const email = await buscarEmailRecebido(validado.data.data.email_id, config.apiKey);
      if (email.id !== validado.data.data.email_id) return res.sendStatus(400);
      const destinos = email.to.map(endereco).filter(v => v.endsWith(`@${config.receivingDomain}`) && /^chat\+[a-zA-Z0-9_-]+@/.test(v));
      // Ambiguous/unsolicited mail is acknowledged without attaching to any customer.
      if (destinos.length !== 1) return res.sendStatus(204);
      const texto = (email.text || email.html?.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ") || "").trim().slice(0, 20000);
      if (!texto) return res.sendStatus(204);
      await persistirRetornoMulticanal(providerId, { canal: "email", externalId: email.id, remetente: endereco(email.from), destinatario: destinos[0], texto, assunto: email.subject?.replace(/[\r\n]/g, " ").slice(0, 200), replyToken: destinos[0].split("@")[0].slice(5) });
      return res.sendStatus(204);
    } catch { return res.sendStatus(503); }
  });
}
