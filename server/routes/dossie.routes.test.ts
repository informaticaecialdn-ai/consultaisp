/**
 * Spec 004 US3 — Dossie routes tests (T057).
 *
 * Casos: gerar dossie JSON OK, format PDF retorna binário, multi-tenant gate
 * (admin de B tentando ver cliente de A → 404), data range > 12 meses (performance).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";

const HAS_DB = !!process.env.DATABASE_URL;
const describeIfDb = HAS_DB ? describe : describe.skip;

vi.mock("../auth", async () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    if (!req.session) req.session = {};
    req.session.userId = 1;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireSuperAdmin: (_req: any, _res: any, next: any) => next(),
  sessionMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { db, pool } from "../db";
import {
  providers, customers, contracts, invoices, communications,
  complianceChecks, pixCharges, auditLogs, outboundAttempts,
} from "@shared/schema";
import { registerDossieRoutes } from "./dossie.routes";

let providerA: number;
let providerB: number;
let customerA: number;
let customerB: number;
let contractA: number;
let app: express.Express;

async function cleanup() {
  for (const pid of [providerA, providerB]) {
    if (!pid) continue;
    await db.delete(auditLogs).where(eq(auditLogs.providerId, pid));
    await db.delete(outboundAttempts).where(eq(outboundAttempts.providerId, pid));
    await db.delete(pixCharges).where(eq(pixCharges.providerId, pid));
    await db.delete(complianceChecks).where(eq(complianceChecks.providerId, pid));
    await db.delete(communications).where(eq(communications.providerId, pid));
    await db.delete(invoices).where(eq(invoices.providerId, pid));
    await db.delete(contracts).where(eq(contracts.providerId, pid));
    await db.delete(customers).where(eq(customers.providerId, pid));
    await db.delete(providers).where(eq(providers.id, pid));
  }
}

describeIfDb("Spec 004 US3 — /api/dossie/cliente/:id", () => {
  beforeAll(async () => {
    const [pA] = await db.insert(providers).values({
      name: "_test_us3_dossie_A", cnpj: "00000000000044", addressState: "SP", tradeName: "Test A",
    }).returning();
    const [pB] = await db.insert(providers).values({
      name: "_test_us3_dossie_B", cnpj: "00000000000045", addressState: "SP",
    }).returning();
    providerA = pA.id;
    providerB = pB.id;

    const [cA] = await db.insert(customers).values({
      providerId: providerA, name: "Cliente A Dossie", cpfCnpj: "44455566677", phone: "+5511955554444",
    }).returning();
    const [cB] = await db.insert(customers).values({
      providerId: providerB, name: "Cliente B Dossie", cpfCnpj: "55566677788", phone: "+5511944443333",
    }).returning();
    customerA = cA.id;
    customerB = cB.id;

    const [ct] = await db.insert(contracts).values({
      providerId: providerA, customerId: customerA, plan: "100MB", value: "149.90", status: "active",
    }).returning();
    contractA = ct.id;

    // Popular dados de auditoria para customerA
    await db.insert(communications).values({
      providerId: providerA, customerId: customerA, channel: "whatsapp", direction: "outbound",
      content: "Olá João, sua fatura vence em 3 dias.", status: "sent",
      sentAt: new Date(), agentId: "agt_preventivo_v1", templateName: "lembrete_prevencimento_v1",
    });

    await db.insert(complianceChecks).values({
      providerId: providerA, customerId: customerA, agentId: "agt_compliance_v1",
      proposedAction: { actionType: "send_message", channel: "whatsapp" } as any,
      decision: "APPROVED",
      legalBasis: "Execução de contrato (LGPD art. 7º V)",
      legalReferences: ["CDC art. 71"] as any,
    });

    await db.insert(auditLogs).values({
      providerId: providerA, action: "bruno_send_message", resource: "customer",
      resourceId: String(customerA), actorType: "agent", actorId: "agt_preventivo_v1",
      actorName: "Bruno", payload: {} as any,
      legalBasis: "Execução de contrato", legalReferences: ["CDC art. 71"] as any,
    });

    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = req.session ?? {};
      req.session.providerId = Number(req.headers["x-test-provider-id"]) || providerA;
      next();
    });
    app.use(registerDossieRoutes());
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it("GET dossiê JSON do cliente A → 200 com dados", async () => {
    const res = await request(app)
      .get(`/api/dossie/cliente/${customerA}?format=json`);

    expect(res.status).toBe(200);
    expect(res.body.customer.id).toBe(customerA);
    expect(res.body.customer.cpfCnpjMasked).toContain("***");
    expect(res.body.communications.length).toBeGreaterThanOrEqual(1);
    expect(res.body.complianceChecks.length).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.totalCommunications).toBeGreaterThanOrEqual(1);
    expect(res.body.provider.id).toBe(providerA);
  });

  it("GET PDF → 200 + Content-Type application/pdf", async () => {
    const res = await request(app)
      .get(`/api/dossie/cliente/${customerA}?format=pdf`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    // PDF começa com %PDF
    const body = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text);
    expect(body.slice(0, 4).toString()).toBe("%PDF");
  });

  it("multi-tenant: provider B pedindo customerA → 404", async () => {
    const res = await request(app)
      .get(`/api/dossie/cliente/${customerA}?format=json`)
      .set("x-test-provider-id", String(providerB));

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("customer_not_found");
  });

  it("invalid customerId → 400", async () => {
    const res = await request(app).get("/api/dossie/cliente/abc?format=json");
    expect(res.status).toBe(400);
  });

  it("from > to → 400", async () => {
    const res = await request(app)
      .get(`/api/dossie/cliente/${customerA}?format=json&from=2026-12-31&to=2026-01-01`);
    expect(res.status).toBe(400);
  });

  it("performance SC-006: dossiê 12 meses completa em <30s", async () => {
    const from = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const t0 = Date.now();
    const res = await request(app)
      .get(`/api/dossie/cliente/${customerA}?format=json&from=${from}&to=${to}`);
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(30_000);
  });
});
