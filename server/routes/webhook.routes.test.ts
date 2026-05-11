/**
 * Spec 004 — Tests for Asaas webhook handler (T039).
 *
 * Constituição §Testes: Postgres real, mocks de banco PROIBIDOS.
 * Mocks externos: BullMQ queue (não dispara worker real).
 *
 * Casos:
 *  - 200 com token válido + payload PAYMENT_RECEIVED → payment_events inserido + job enfileirado.
 *  - 200 duplicate → mesmo payment_events row, NENHUM job novo.
 *  - 401 token inválido → audit_log webhook_auth_failed.
 *  - 400 externalReference malformado.
 *
 * Skipa quando DATABASE_URL ausente.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq, and } from "drizzle-orm";

const HAS_DB = !!process.env.DATABASE_URL;
const describeIfDb = HAS_DB ? describe : describe.skip;

// Mock da queue para não rodar BullMQ real
const fakeQueueAdd = vi.fn().mockResolvedValue({ id: "fake-job-1" });
vi.mock("../lib/queue", async (orig) => {
  const actual = await orig<typeof import("../lib/queue")>();
  return {
    ...actual,
    getQueue: vi.fn(() => ({ add: fakeQueueAdd })),
  };
});

import { db, pool } from "../db";
import { storage } from "../storage";
import {
  providers, customers, contracts, invoices, asaasAccounts,
  pixCharges, paymentEvents, agentToggles, auditLogs, outboundAttempts,
} from "@shared/schema";
import { registerAsaasWebhookRoutes } from "./webhook.routes";

const VALID_WEBHOOK_TOKEN = "tokenA_super_long_for_validation_123456";
const VALID_API_KEY = "$aact_test_aaaaaaaaaaaaaaaaaaaaa";

let providerId: number;
let customerId: number;
let contractId: number;
let invoiceId: number;
let pixChargeId: number;
let attemptId: number;
let app: express.Express;

async function cleanupAll() {
  if (providerId) {
    await db.delete(auditLogs).where(eq(auditLogs.providerId, providerId));
    await db.delete(paymentEvents).where(eq(paymentEvents.providerId, providerId));
    await db.delete(outboundAttempts).where(eq(outboundAttempts.providerId, providerId));
    await db.delete(pixCharges).where(eq(pixCharges.providerId, providerId));
    await db.delete(asaasAccounts).where(eq(asaasAccounts.providerId, providerId));
    await db.delete(agentToggles).where(eq(agentToggles.providerId, providerId));
    if (invoiceId) await db.delete(invoices).where(eq(invoices.id, invoiceId));
    if (contractId) await db.delete(contracts).where(eq(contracts.id, contractId));
    if (customerId) await db.delete(customers).where(eq(customers.id, customerId));
    await db.delete(providers).where(eq(providers.id, providerId));
  }
}

describeIfDb("Spec 004 — POST /webhooks/asaas", () => {
  beforeAll(async () => {
    const [p] = await db.insert(providers).values({
      name: "_test_spec004_webhook_provider",
      cnpj: "00000000000077",
      addressState: "SP",
    }).returning();
    providerId = p.id;

    const [c] = await db.insert(customers).values({
      providerId, name: "Cliente Webhook", cpfCnpj: "11122233344",
      phone: "+5511977776666",
    }).returning();
    customerId = c.id;

    const [ct] = await db.insert(contracts).values({
      providerId, customerId, plan: "100MB", value: "149.90", status: "active",
    }).returning();
    contractId = ct.id;

    const [inv] = await db.insert(invoices).values({
      providerId, customerId, contractId,
      value: "149.90",
      dueDate: new Date("2026-05-14T00:00:00Z") as any,
      status: "pending",
    }).returning();
    invoiceId = inv.id;

    // Reserva um attempt para servir como `:attempt:` no externalReference
    const reserved = await storage.outboundAttempt.tryReserve({
      providerId, customerId, invoiceId,
      agentId: "bruno_v1", step: "D-3",
      scheduledFor: new Date(),
    });
    attemptId = reserved!.id;

    // Pix charge ligado a esse invoice (Sofia precisa achar via byAsaasId)
    const pix = await storage.pixCharge.create(providerId, {
      invoiceId, customerId,
      asaasPaymentId: "pay_webhook_test_111",
      value: "149.90" as any,
      dueDate: "2026-05-14" as any,
      status: "pending",
    });
    pixChargeId = pix.id;

    // Conta Asaas com webhook token
    await storage.asaasAccount.upsert(providerId, {
      apiKey: VALID_API_KEY,
      webhookToken: VALID_WEBHOOK_TOKEN,
      mode: "sandbox",
    });

    // Toggle Sofia ativa para testar fluxo de enfileiramento
    await db.insert(agentToggles).values({
      providerId, brunoAtivo: false, sofiaAtiva: true,
    });

    app = express();
    app.use(express.json());
    app.use(registerAsaasWebhookRoutes());
  });

  afterAll(async () => {
    await cleanupAll();
    await pool.end();
  });

  beforeEach(async () => {
    fakeQueueAdd.mockClear();
    await db.delete(paymentEvents).where(eq(paymentEvents.providerId, providerId));
    await db.delete(auditLogs).where(eq(auditLogs.providerId, providerId));
  });

  function payload(eventType = "PAYMENT_RECEIVED", asaasPaymentId = "pay_webhook_test_111") {
    return {
      id: `evt_${eventType.toLowerCase()}_${Date.now()}`,
      event: eventType,
      dateCreated: new Date().toISOString(),
      payment: {
        id: asaasPaymentId,
        customer: "cus_test",
        value: 149.90,
        netValue: 147.91,
        billingType: "PIX",
        status: "RECEIVED",
        dueDate: "2026-05-14",
        paymentDate: "2026-05-14",
        externalReference: `provider:${providerId}:invoice:${invoiceId}:attempt:${attemptId}`,
      },
    };
  }

  it("200 + payment_events inserido + sofia job enfileirado (token válido)", async () => {
    const res = await request(app)
      .post("/webhooks/asaas")
      .set("asaas-access-token", VALID_WEBHOOK_TOKEN)
      .send(payload());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const events = await db.select().from(paymentEvents)
      .where(eq(paymentEvents.providerId, providerId));
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("PAYMENT_RECEIVED");

    expect(fakeQueueAdd).toHaveBeenCalledTimes(1);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.providerId, providerId));
    const actions = audits.map(a => a.action);
    expect(actions).toContain("webhook_processed");
  });

  it("duplicate: mesmo payload 2x → 1 payment_events, NENHUM job novo na 2a", async () => {
    const p = payload();
    const r1 = await request(app).post("/webhooks/asaas").set("asaas-access-token", VALID_WEBHOOK_TOKEN).send(p);
    expect(r1.status).toBe(200);
    expect(fakeQueueAdd).toHaveBeenCalledTimes(1);

    const r2 = await request(app).post("/webhooks/asaas").set("asaas-access-token", VALID_WEBHOOK_TOKEN).send(p);
    expect(r2.status).toBe(200);
    expect(r2.body.duplicate).toBe(true);
    expect(fakeQueueAdd).toHaveBeenCalledTimes(1); // continua 1

    const events = await db.select().from(paymentEvents)
      .where(and(eq(paymentEvents.providerId, providerId), eq(paymentEvents.asaasPaymentId, "pay_webhook_test_111")));
    expect(events.length).toBe(1);

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.providerId, providerId));
    expect(audits.some(a => a.action === "webhook_duplicate")).toBe(true);
  });

  it("401 token inválido → audit webhook_auth_failed", async () => {
    const res = await request(app)
      .post("/webhooks/asaas")
      .set("asaas-access-token", "WRONG_TOKEN")
      .send(payload());

    expect(res.status).toBe(401);
    expect(fakeQueueAdd).not.toHaveBeenCalled();

    const events = await db.select().from(paymentEvents).where(eq(paymentEvents.providerId, providerId));
    expect(events.length).toBe(0);

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.providerId, providerId));
    expect(audits.some(a => a.action === "webhook_auth_failed")).toBe(true);
  });

  it("400 externalReference malformado", async () => {
    const bad = payload();
    (bad.payment as any).externalReference = "garbage:reference";

    const res = await request(app)
      .post("/webhooks/asaas")
      .set("asaas-access-token", VALID_WEBHOOK_TOKEN)
      .send(bad);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_external_reference");
    expect(fakeQueueAdd).not.toHaveBeenCalled();
  });

  it("PAYMENT_RECEIVED dispara update em pix_charges.status='paid'", async () => {
    const res = await request(app)
      .post("/webhooks/asaas")
      .set("asaas-access-token", VALID_WEBHOOK_TOKEN)
      .send(payload());
    expect(res.status).toBe(200);

    const pix = await storage.pixCharge.byAsaasId(providerId, "pay_webhook_test_111");
    expect(pix?.status).toBe("paid");
    expect(pix?.paidAt).not.toBeNull();
  });
});
