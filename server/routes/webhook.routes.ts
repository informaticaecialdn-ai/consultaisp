/**
 * Spec 004 — Webhook handlers públicos (Asaas).
 *
 * POST /webhooks/asaas
 *   - Auth via header `asaas-access-token` validado em tempo constante contra
 *     `asaas_accounts.webhook_token_encrypted` (decifrado por providerId).
 *   - Identificação do tenant via `externalReference` no payload
 *     (formato: provider:<id>:invoice:<id>:attempt:<id>).
 *   - Idempotência: `payment_events` tem UNIQUE em (providerId, asaasPaymentId, eventType).
 *   - Responde 200 imediato; processamento Sofia é enfileirado (BullMQ).
 */

import express, { type Request, type Response, type Router } from "express";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../logger";
import { invoices } from "@shared/schema";
import { storage } from "../storage";
import { parseExternalReference } from "../services/asaas-multi-tenant";
import { getQueue, OUTBOUND_JOB_DEFAULTS, QUEUE_NAMES } from "../lib/queue";
import { auditAction } from "../agents/audit-actions";

const SOFIA_QUALIFYING_EVENTS = new Set([
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
]);

const PIX_STATUS_MAP: Record<string, string> = {
  PAYMENT_RECEIVED: "paid",
  PAYMENT_CONFIRMED: "paid",
  PAYMENT_OVERDUE: "expired",
  PAYMENT_DELETED: "cancelled",
  PAYMENT_REFUNDED: "refunded",
};

export interface SofiaJobData {
  providerId: number;
  paymentEventId: number;
  customerId: number;
  invoiceId: number | null;
  asaasPaymentId: string;
  value: number;
  paidAt: string; // ISO
  correlationId: string;
}

function safeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function registerAsaasWebhookRoutes(): Router {
  const router: Router = express.Router();

  router.post("/webhooks/asaas", async (req: Request, res: Response): Promise<void> => {
    const t0 = Date.now();
    const payload = req.body;

    if (!payload || typeof payload !== "object") {
      res.status(400).json({ error: "payload_missing" });
      return;
    }

    const eventType = String(payload.event ?? payload.eventType ?? "");
    const externalEventId = payload.id ?? null;
    const payment = payload.payment ?? {};
    const asaasPaymentId = String(payment.id ?? "");
    const externalReference = payment.externalReference ?? payload.externalReference ?? null;
    const valueRaw = Number(payment.value ?? 0);
    const paymentDate = payment.paymentDate ?? payment.clientPaymentDate ?? null;

    if (!eventType || !asaasPaymentId) {
      logger.warn(
        { action: "asaas_webhook_missing_fields", externalEventId, hasPayment: !!payment },
        "Asaas webhook sem event/paymentId",
      );
      res.status(400).json({ error: "invalid_payload" });
      return;
    }

    // 1. Identifica tenant via externalReference
    const ref = parseExternalReference(externalReference);
    if (!ref) {
      // Sem ref válido não conseguimos validar tenant — registra rejeição e responde 400.
      try {
        await storage.paymentEvent.logRejection({
          providerId: null,
          asaasPaymentId,
          eventType,
          payload,
          reason: "externalReference inválido ou ausente",
        });
      } catch (err) {
        logger.warn({ action: "asaas_log_rejection_failed", err: (err as Error)?.message }, "asaas log rejection falhou");
      }
      res.status(400).json({ error: "invalid_external_reference" });
      return;
    }

    // 2. Carrega conta Asaas do tenant e valida token
    const headerToken = req.headers["asaas-access-token"];
    const tokenStr = typeof headerToken === "string" ? headerToken : "";
    let expectedToken: string | null = null;

    try {
      expectedToken = await storage.asaasAccount.getWebhookToken(ref.providerId);
    } catch (err) {
      logger.error(
        { action: "asaas_token_load_failed", providerId: ref.providerId, err: (err as Error)?.message },
        "Falha ao carregar webhook token",
      );
    }

    if (!expectedToken || !tokenStr || !safeEqualString(tokenStr, expectedToken)) {
      // Audit + 401
      try {
        await storage.auditLog.registrarAcao(ref.providerId, {
          ...auditAction("webhook_auth_failed"),
          resourceId: String(ref.providerId),
          actorType: "system",
          actorId: "asaas-webhook",
          payload: {
            asaasPaymentId,
            eventType,
            externalEventId,
            hasTokenHeader: !!tokenStr,
            hasStoredToken: !!expectedToken,
          },
        });
      } catch (err) {
        logger.warn({ action: "asaas_audit_auth_failed_persist", err: (err as Error)?.message }, "audit auth failed persist err");
      }
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    // 3. Idempotência via insertOrSkip
    let inserted: boolean;
    let eventId: number | null = null;
    try {
      const r = await storage.paymentEvent.insertOrSkip({
        providerId: ref.providerId,
        asaasPaymentId,
        eventType,
        externalEventId: externalEventId ? String(externalEventId) : null,
        payload,
      });
      inserted = r.inserted;
      eventId = r.event?.id ?? null;
    } catch (err) {
      logger.error(
        { action: "asaas_event_persist_failed", providerId: ref.providerId, asaasPaymentId, eventType, err: (err as Error)?.message },
        "Falha ao persistir payment_event",
      );
      // Mesmo em falha de persist, responde 200 para Asaas (vai retornar; bug aqui não é problema deles).
      res.status(200).json({ ok: true, persisted: false });
      return;
    }

    if (!inserted) {
      try {
        await storage.auditLog.registrarAcao(ref.providerId, {
          ...auditAction("webhook_duplicate"),
          resourceId: String(ref.providerId),
          actorType: "system",
          actorId: "asaas-webhook",
          payload: { asaasPaymentId, eventType, externalEventId },
        });
      } catch { /* silent */ }
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    // 4. Atualiza pix_charges + invoices conforme evento
    const localPixStatus = PIX_STATUS_MAP[eventType];
    if (localPixStatus) {
      try {
        const extra: { paidAt?: Date; cancelledAt?: Date } = {};
        if (localPixStatus === "paid" && paymentDate) extra.paidAt = new Date(String(paymentDate));
        if (localPixStatus === "cancelled") extra.cancelledAt = new Date();
        await storage.pixCharge.updateStatus(asaasPaymentId, localPixStatus, extra);
      } catch (err) {
        logger.warn({ action: "asaas_pix_status_update_failed", err: (err as Error)?.message }, "pix status update failed");
      }
    }

    if (SOFIA_QUALIFYING_EVENTS.has(eventType) && ref.invoiceId) {
      try {
        await db.update(invoices)
          .set({ status: "paid", paidDate: paymentDate ? new Date(String(paymentDate)) : new Date() })
          .where(eq(invoices.id, ref.invoiceId));
      } catch (err) {
        logger.warn({ action: "asaas_invoice_update_failed", err: (err as Error)?.message }, "invoice status update failed");
      }
    }

    // Audit webhook_processed
    try {
      await storage.auditLog.registrarAcao(ref.providerId, {
        ...auditAction("webhook_processed"),
        resourceId: String(ref.providerId),
        actorType: "system",
        actorId: "asaas-webhook",
        payload: {
          asaasPaymentId,
          eventType,
          externalEventId,
          invoiceId: ref.invoiceId,
          paymentEventId: eventId,
        },
      });
    } catch { /* silent */ }

    // 5. Sofia eligível? Carrega customerId via pix_charges → ref.invoiceId
    if (SOFIA_QUALIFYING_EVENTS.has(eventType) && ref.invoiceId && eventId) {
      try {
        const sofiaActive = await storage.agentToggle.isSofiaActive(ref.providerId);
        if (sofiaActive) {
          const pix = await storage.pixCharge.byAsaasId(ref.providerId, asaasPaymentId);
          const customerId = pix?.customerId;
          if (customerId) {
            const data: SofiaJobData = {
              providerId: ref.providerId,
              paymentEventId: eventId,
              customerId,
              invoiceId: ref.invoiceId,
              asaasPaymentId,
              value: valueRaw,
              paidAt: paymentDate ? new Date(String(paymentDate)).toISOString() : new Date().toISOString(),
              correlationId: `sofia-evt${eventId}`,
            };
            const queue = getQueue(QUEUE_NAMES.SOFIA_THANK);
            const job = await queue.add("thank", data, {
              ...OUTBOUND_JOB_DEFAULTS,
              jobId: `sofia-evt${eventId}`,
            });
            await storage.paymentEvent.attachSofiaJobId(eventId, String(job.id));
          }
        }
      } catch (err) {
        logger.error(
          { action: "asaas_sofia_enqueue_failed", providerId: ref.providerId, asaasPaymentId, err: (err as Error)?.message },
          "Falha ao enfileirar Sofia",
        );
      }
    }

    const elapsed = Date.now() - t0;
    logger.info(
      {
        action: "asaas_webhook_handled",
        providerId: ref.providerId,
        eventType,
        asaasPaymentId,
        invoiceId: ref.invoiceId,
        paymentEventId: eventId,
        elapsedMs: elapsed,
      },
      "Asaas webhook processado",
    );

    res.status(200).json({ ok: true });
  });

  return router;
}
