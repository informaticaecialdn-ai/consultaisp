/**
 * Spec 004 US3 — Asaas config routes tests (T056).
 *
 * Mocka validateAndDetectMode + autenticação session-based via middleware fake.
 * DB real para storage.asaasAccount.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";

const HAS_DB = !!process.env.DATABASE_URL;
const describeIfDb = HAS_DB ? describe : describe.skip;

vi.mock("../services/asaas-multi-tenant", async (orig) => {
  const actual = await orig<typeof import("../services/asaas-multi-tenant")>();
  return {
    ...actual,
    validateAndDetectMode: vi.fn(),
  };
});

// Stub auth — injeta providerId no session
vi.mock("../auth", async () => {
  return {
    requireAuth: (req: any, _res: any, next: any) => {
      if (!req.session) req.session = {};
      req.session.userId = 1;
      next();
    },
    requireAdmin: (_req: any, _res: any, next: any) => next(),
    requireSuperAdmin: (_req: any, _res: any, next: any) => next(),
    sessionMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { db, pool } from "../db";
import { storage } from "../storage";
import { providers, asaasAccounts, auditLogs, agentToggles } from "@shared/schema";
import { registerAsaasConfigRoutes } from "./asaas-config.routes";
import { validateAndDetectMode } from "../services/asaas-multi-tenant";

let providerA: number;
let providerB: number;
let app: express.Express;

async function cleanup() {
  if (providerA) {
    await db.delete(auditLogs).where(eq(auditLogs.providerId, providerA));
    await db.delete(asaasAccounts).where(eq(asaasAccounts.providerId, providerA));
    await db.delete(agentToggles).where(eq(agentToggles.providerId, providerA));
    await db.delete(providers).where(eq(providers.id, providerA));
  }
  if (providerB) {
    await db.delete(auditLogs).where(eq(auditLogs.providerId, providerB));
    await db.delete(asaasAccounts).where(eq(asaasAccounts.providerId, providerB));
    await db.delete(agentToggles).where(eq(agentToggles.providerId, providerB));
    await db.delete(providers).where(eq(providers.id, providerB));
  }
}

describeIfDb("Spec 004 US3 — /api/asaas/account", () => {
  beforeAll(async () => {
    const [pA] = await db.insert(providers).values({
      name: "_test_spec004_us3_asaas_A",
      cnpj: "00000000000033",
      addressState: "SP",
    }).returning();
    const [pB] = await db.insert(providers).values({
      name: "_test_spec004_us3_asaas_B",
      cnpj: "00000000000034",
      addressState: "SP",
    }).returning();
    providerA = pA.id;
    providerB = pB.id;

    app = express();
    app.use(express.json());
    // Injeta providerId via middleware antes das rotas
    app.use((req: any, _res, next) => {
      req.session = req.session ?? {};
      req.session.providerId = Number(req.headers["x-test-provider-id"]) || providerA;
      next();
    });
    app.use(registerAsaasConfigRoutes());
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.delete(asaasAccounts).where(eq(asaasAccounts.providerId, providerA));
    await db.delete(asaasAccounts).where(eq(asaasAccounts.providerId, providerB));
    await db.delete(auditLogs).where(eq(auditLogs.providerId, providerA));
  });

  it("GET sem conta → connected=false", async () => {
    const res = await request(app).get("/api/asaas/account");
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
  });

  it("POST com chave válida → 201 + mascarada + audit", async () => {
    (validateAndDetectMode as any).mockResolvedValue({
      mode: "sandbox",
      account: { name: "Test Provider", email: "test@example.com" },
    });

    const res = await request(app)
      .post("/api/asaas/account")
      .send({ apiKey: "$aact_test_aaaaaaaaaaaaaaaaaaa", webhookToken: "tokenA_long_enough_for_test_123" });

    expect(res.status).toBe(201);
    expect(res.body.connected).toBe(true);
    expect(res.body.mode).toBe("sandbox");
    expect(res.body.maskedApiKey).toContain("$aact_test_");

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.providerId, providerA));
    expect(audits.some(a => a.action === "asaas_account_connected")).toBe(true);
  });

  it("POST com chave inválida (Asaas 401) → 400", async () => {
    (validateAndDetectMode as any).mockRejectedValue(new Error("Asaas API 401 unauthorized"));

    const res = await request(app)
      .post("/api/asaas/account")
      .send({ apiKey: "$aact_test_wrong_key_xxxxxxxx", webhookToken: "validTokenWithEnoughChars" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("asaas_validation_failed");
  });

  it("POST com webhookToken curto → 422 validation", async () => {
    const res = await request(app)
      .post("/api/asaas/account")
      .send({ apiKey: "$aact_test_validkey_xxxxxxxxxxx", webhookToken: "short" });

    expect(res.status).toBe(422);
  });

  it("multi-tenant: provider B não vê conta de A", async () => {
    (validateAndDetectMode as any).mockResolvedValue({ mode: "sandbox", account: {} });
    // Conecta A
    await request(app)
      .post("/api/asaas/account")
      .set("x-test-provider-id", String(providerA))
      .send({ apiKey: "$aact_test_aaaaaaaaaaaaaaaaaaa", webhookToken: "tokenA_long_enough_for_test_123" });

    // B consulta — não deveria ver
    const res = await request(app)
      .get("/api/asaas/account")
      .set("x-test-provider-id", String(providerB));

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
  });

  it("DELETE → 204 + audit + brunoAtivo=false", async () => {
    (validateAndDetectMode as any).mockResolvedValue({ mode: "sandbox", account: {} });
    await request(app)
      .post("/api/asaas/account")
      .send({ apiKey: "$aact_test_aaaaaaaaaaaaaaaaaaa", webhookToken: "tokenA_long_enough_for_test_123" });

    // Ativa Bruno antes
    await storage.agentToggle.update(providerA, { brunoAtivo: true });
    const before = await storage.agentToggle.byProviderId(providerA);
    expect(before.brunoAtivo).toBe(true);

    const res = await request(app).delete("/api/asaas/account");
    expect(res.status).toBe(204);

    const after = await storage.agentToggle.byProviderId(providerA);
    expect(after.brunoAtivo).toBe(false);

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.providerId, providerA));
    expect(audits.some(a => a.action === "asaas_account_disconnected")).toBe(true);
  });
});
