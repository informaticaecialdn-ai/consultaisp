import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { Resend } from "resend";
import { z } from "zod";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { obterConfiguracaoCanaisInterna } from "../services/cobranca/canais-comunicacao.service";
import { persistirRetornoMulticanal } from "../services/chat/chat-multicanal.service";

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
  const limite = createRateLimiter({ windowMs: 60000, maxRequests: 120 });
  app.post("/api/webhooks/canais/sms/:providerId", limite, async (req, res) => {
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
  app.post("/api/webhooks/canais/email/:providerId", limite, async (req, res) => {
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
