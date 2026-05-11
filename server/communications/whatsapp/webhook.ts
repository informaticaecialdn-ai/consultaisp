/**
 * Spec 003 — Meta WhatsApp Cloud API webhook handler
 *
 * GET  /webhooks/whatsapp — Verify (hub challenge)
 * POST /webhooks/whatsapp — Receive (signature → enqueue → 200)
 *
 * Princípio crítico: responder 200 em <4s SEMPRE (Meta dá 5s antes de retry massivo).
 * Processamento real do payload é assíncrono via BullMQ queue 'whatsapp-webhook'.
 *
 * Multi-tenant: a resolução do tenant (phoneNumberId → providerId) acontece no worker,
 * NÃO aqui. Webhook handler é stateless e rápido.
 */

import express, { type Request, type Response, type Router } from "express";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { logger } from "../../logger";
import { validateWhatsAppSignature } from "./signature";

const QUEUE_NAME = "whatsapp-webhook";

// Lazy singleton — só conecta no Redis na primeira request
let _queue: Queue | null = null;
let _redis: IORedis | null = null;

function getQueue(): Queue {
  if (_queue) return _queue;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL não configurado — webhook não pode enfileirar");
  }
  _redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null, // exigido pelo BullMQ
  });
  _redis.on("error", (err: Error) => {
    logger.error({ action: "redis_error", err: err.message }, "Redis connection error");
  });
  _queue = new Queue(QUEUE_NAME, { connection: _redis });
  return _queue;
}

/**
 * Monta o router /webhooks/whatsapp.
 *
 * Importante: raw body é capturado pelo `express.json` GLOBAL em server/index.ts
 * via `verify` callback que armazena `req.rawBody = buf`. validateWhatsAppSignature
 * lê esse Buffer para HMAC-SHA256.
 */
export function registerWhatsAppWebhookRoutes(): Router {
  const router: Router = express.Router();

  // GET /webhooks/whatsapp — verificação inicial da Meta
  router.get("/webhooks/whatsapp", (req: Request, res: Response): void => {
    const mode = req.query["hub.mode"];
    const verifyToken = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const expected = process.env.META_VERIFY_TOKEN;
    if (!expected) {
      logger.error({ action: "whatsapp_webhook_verify", reason: "missing_env" },
        "META_VERIFY_TOKEN não configurado");
      res.status(500).send("server_misconfigured");
      return;
    }

    if (mode === "subscribe" && verifyToken === expected && typeof challenge === "string") {
      logger.info({ action: "whatsapp_webhook_verify", result: "ok" },
        "Meta webhook verify OK");
      res.status(200).type("text/plain").send(challenge);
      return;
    }

    logger.warn({ action: "whatsapp_webhook_verify", result: "rejected", mode },
      "Meta webhook verify rejeitado");
    res.status(403).send("forbidden");
  });

  // POST /webhooks/whatsapp — recebe payloads
  // Raw body é capturado pelo `verify` callback do express.json() global
  // em server/index.ts (`req.rawBody = buf`). validateWhatsAppSignature lê esse buffer.
  router.post(
    "/webhooks/whatsapp",
    validateWhatsAppSignature,
    async (req: Request, res: Response): Promise<void> => {
      const t0 = Date.now();
      const payload = req.body;

      // Extração defensiva de metadata para logging (sem confiar no payload)
      const phoneNumberId =
        payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      const wabaId = payload?.entry?.[0]?.id;

      try {
        const queue = getQueue();
        await queue.add(
          "incoming",
          {
            receivedAt: new Date().toISOString(),
            phoneNumberId,
            wabaId,
            payload,
          },
          {
            attempts: 5,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 86400 },
          },
        );

        logger.info({
          action: "whatsapp_webhook_enqueued",
          phoneNumberId,
          wabaId,
          latencyMs: Date.now() - t0,
        }, "Webhook enfileirado para processamento");

        // Sempre 200 — Meta requer < 5s
        res.status(200).send("ok");
      } catch (err) {
        // Mesmo se falhar enqueue, devolvemos 200 para Meta não retentar massivamente.
        // O erro vai para os logs e devemos alertar via monitoring.
        logger.error({
          action: "whatsapp_webhook_enqueue_failed",
          phoneNumberId,
          wabaId,
          err: (err as Error).message,
          latencyMs: Date.now() - t0,
        }, "Falha ao enfileirar webhook — Meta receberá 200 mesmo assim");
        res.status(200).send("ok");
      }
    },
  );

  return router;
}

/** Helper para shutdown gracioso. */
export async function closeWhatsAppWebhookResources(): Promise<void> {
  try {
    if (_queue) await _queue.close();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Erro fechando queue WhatsApp");
  }
  try {
    if (_redis) await _redis.quit();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Erro fechando Redis");
  }
  _queue = null;
  _redis = null;
}
