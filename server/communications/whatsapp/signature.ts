/**
 * Spec 003 — Meta WhatsApp Cloud API webhook signature validation
 *
 * Meta envia `X-Hub-Signature-256: sha256=<hex>` calculado como HMAC-SHA256
 * do RAW body usando META_APP_SECRET como chave.
 *
 * CRÍTICO: precisamos do raw body ANTES do express.json() processá-lo.
 * Usamos `verify` callback do express.json para capturar `req.rawBody`.
 *
 * Princípio II (Constitution) — toda outbound passa por Júlia, mas
 * webhook inbound precisa ser autenticado antes de qualquer ação.
 */

import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../../logger";

/** Erro lançado quando assinatura é inválida ou ausente. */
export class SignatureValidationError extends Error {
  constructor(message: string, public readonly reason: string) {
    super(message);
    this.name = "SignatureValidationError";
  }
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

/**
 * express.json() verify callback — captura raw body em `req.rawBody`.
 *
 * O `server/index.ts` global já registra um verify callback similar; este
 * está exportado para casos onde se queira montar um router isolado com
 * raw body próprio (ex: testes ou apps separados).
 */
export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  req.rawBody = buf;
}

/**
 * Middleware Express que valida `X-Hub-Signature-256`.
 *
 * Exige:
 *  - process.env.META_APP_SECRET configurado
 *  - req.rawBody capturado (Buffer) — feito pelo verify callback do express.json
 *
 * Responde 403 se assinatura inválida/ausente.
 * Em sucesso, chama next().
 */
export function validateWhatsAppSignature(req: Request, res: Response, next: NextFunction): void {
  const t0 = Date.now();
  const appSecret = process.env.META_APP_SECRET;

  if (!appSecret) {
    logger.error({ action: "whatsapp_signature_validate", reason: "missing_secret" },
      "META_APP_SECRET não configurado — bloqueando webhook por segurança");
    res.status(500).json({ error: "server_misconfigured" });
    return;
  }

  const signatureHeader = req.header("x-hub-signature-256");
  if (!signatureHeader) {
    logger.warn({ action: "whatsapp_signature_validate", reason: "missing_header", latencyMs: Date.now() - t0 },
      "Webhook sem header X-Hub-Signature-256");
    res.status(403).json({ error: "missing_signature" });
    return;
  }

  if (!signatureHeader.startsWith("sha256=")) {
    logger.warn({ action: "whatsapp_signature_validate", reason: "bad_format", latencyMs: Date.now() - t0 },
      "Header de assinatura em formato inválido");
    res.status(403).json({ error: "invalid_signature_format" });
    return;
  }

  const provided = signatureHeader.slice("sha256=".length);

  const rawBody = req.rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    logger.error({ action: "whatsapp_signature_validate", reason: "no_raw_body", latencyMs: Date.now() - t0 },
      "Raw body não capturado — verify callback não está registrado");
    res.status(500).json({ error: "raw_body_unavailable" });
    return;
  }

  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

  let isValid = false;
  try {
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    isValid = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    isValid = false;
  }

  if (!isValid) {
    logger.warn({ action: "whatsapp_signature_validate", reason: "mismatch", latencyMs: Date.now() - t0 },
      "Assinatura HMAC inválida");
    res.status(403).json({ error: "invalid_signature" });
    return;
  }

  logger.debug({ action: "whatsapp_signature_validate", latencyMs: Date.now() - t0 }, "Signature OK");
  next();
}
