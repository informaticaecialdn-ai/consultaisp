/**
 * Spec 004 — Tests for processSofiaJob (T040).
 *
 * Casos: happy_path, opt-out, julia_blocked, sofia_disabled, sofia_failed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";

const HAS_DB = !!process.env.DATABASE_URL;
const describeIfDb = HAS_DB ? describe : describe.skip;

// MOCKS HOISTED
vi.mock("../agents/sofia", async (orig) => {
  const actual = await orig<typeof import("../agents/sofia")>();
  return { ...actual, invokeSofia: vi.fn() };
});

vi.mock("../agents/julia", async (orig) => {
  const actual = await orig<typeof import("../agents/julia")>();
  return { ...actual, invokeJulia: vi.fn() };
});

vi.mock("../communications/whatsapp/client", async (orig) => {
  const actual = await orig<typeof import("../communications/whatsapp/client")>();
  return { ...actual, createMetaClient: vi.fn() };
});

// Mock getQueue para evitar conexão real Redis quando re-enqueue acontece
vi.mock("../lib/queue", async (orig) => {
  const actual = await orig<typeof import("../lib/queue")>();
  return {
    ...actual,
    getQueue: vi.fn(() => ({ add: vi.fn().mockResolvedValue({ id: "deferred-1" }) })),
    getRedisConnection: vi.fn(),
  };
});

import { db, pool } from "../db";
import { storage } from "../storage";
import {
  providers, customers, contracts, invoices, agentToggles,
  whatsappOptouts, outboundAttempts, auditLogs,
} from "@shared/schema";
import { processSofiaJob } from "./sofia-event-processor";
import { invokeSofia } from "../agents/sofia";
import { invokeJulia } from "../agents/julia";
import { createMetaClient } from "../communications/whatsapp/client";

let providerId: number;
let customerId: number;
let contractId: number;
let invoiceId: number;

async function cleanup() {
  if (providerId) {
    await db.delete(auditLogs).where(eq(auditLogs.providerId, providerId));
    await db.delete(outboundAttempts).where(eq(outboundAttempts.providerId, providerId));
    await db.delete(whatsappOptouts).where(eq(whatsappOptouts.providerId, providerId));
    await db.delete(agentToggles).where(eq(agentToggles.providerId, providerId));
    if (invoiceId) await db.delete(invoices).where(eq(invoices.id, invoiceId));
    if (contractId) await db.delete(contracts).where(eq(contracts.id, contractId));
    if (customerId) await db.delete(customers).where(eq(customers.id, customerId));
    await db.delete(providers).where(eq(providers.id, providerId));
  }
}

describeIfDb("Spec 004 — processSofiaJob integration", () => {
  beforeAll(async () => {
    const [p] = await db.insert(providers).values({
      name: "_test_spec004_sofia_worker",
      cnpj: "00000000000088",
      addressState: "SP",
      tradeName: "Test Telecom Sofia",
    }).returning();
    providerId = p.id;

    const [c] = await db.insert(customers).values({
      providerId, name: "Maria Conceição",
      cpfCnpj: "55566677788", phone: "+5511966665555",
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
      status: "paid",
      paidDate: new Date("2026-05-14T08:32:11Z") as any,
    }).returning();
    invoiceId = inv.id;
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.delete(outboundAttempts).where(eq(outboundAttempts.providerId, providerId));
    await db.delete(whatsappOptouts).where(eq(whatsappOptouts.providerId, providerId));
    await db.delete(agentToggles).where(eq(agentToggles.providerId, providerId));
    await db.insert(agentToggles).values({
      providerId,
      brunoAtivo: false,
      sofiaAtiva: true,
      schedulerHoraLocal: "09:00:00",
      janelaInicio: "00:00:00",
      janelaFim: "23:59:00",
      permiteSabado: true,
      permiteDomingo: true,
      templateSofiaNome: "agradecimento_pagamento_v1",
    });
  });

  function makeJobData() {
    return {
      providerId, customerId,
      paymentEventId: 9999,
      invoiceId,
      asaasPaymentId: "pay_sofia_test_111",
      value: 149.90,
      paidAt: "2026-05-14T08:32:11-03:00",
      correlationId: "test-sofia",
    };
  }

  it("happy_path: Sofia ok + Júlia APPROVED + Meta sendTemplate → sent + audit", async () => {
    (invokeSofia as any).mockResolvedValue({
      success: true,
      output: {
        templateName: "agradecimento_pagamento_v1",
        variables: { nome_cliente: "Maria", valor: "R$ 149,90", data_pagamento: "14/05/2026" },
        freeFormText: null,
      },
      turnsUsed: 1, toolsCalled: [], latencyMs: 800,
      tokensInput: 500, tokensOutput: 100, cacheHit: false,
    });

    (invokeJulia as any).mockResolvedValue({
      decision: "APPROVED",
      fundamentacaoLegal: [], ajustesSugeridos: [],
      validUntil: new Date().toISOString(),
      camadasValidadas: { deterministica: true, anatel: true, semantica: true, vulnerabilidade: true },
      latencyMs: 60, cacheHit: false,
      complianceCheckId: "cc_sofia_happy",
    });

    const sendTemplate = vi.fn().mockResolvedValue({ messageId: "wamid.sofia.111", status: "sent" });
    (createMetaClient as any).mockResolvedValue({ sendTemplate, sendText: vi.fn() });

    const result = await processSofiaJob(makeJobData());
    expect(result.status).toBe("sent");
    expect(sendTemplate).toHaveBeenCalledOnce();

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.providerId, providerId));
    expect(audits.some(a => a.action === "sofia_send_thanks")).toBe(true);

    const attempts = await storage.outboundAttempt.listForRegua(providerId, { step: "THANK_YOU" });
    expect(attempts.length).toBe(1);
    expect(attempts[0].status).toBe("sent");
    expect(attempts[0].complianceCheckId).toBe("cc_sofia_happy");
  });

  it("opt_out: customer em whatsapp_optouts → skip + audit sofia_skipped_optout", async () => {
    await db.insert(whatsappOptouts).values({
      providerId, phoneNumber: "+5511966665555", reason: "test",
    });

    const result = await processSofiaJob(makeJobData());
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("opt_out");
    expect(invokeSofia).not.toHaveBeenCalled();

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.providerId, providerId));
    expect(audits.some(a => a.action === "sofia_skipped_optout")).toBe(true);
  });

  it("julia_blocked: Júlia BLOCKED → markVetoed sem Meta send", async () => {
    (invokeSofia as any).mockResolvedValue({
      success: true,
      output: {
        templateName: "agradecimento_pagamento_v1",
        variables: { nome_cliente: "Maria", valor: "R$ 149,90", data_pagamento: "14/05/2026" },
        freeFormText: null,
      },
      turnsUsed: 1, toolsCalled: [], latencyMs: 800,
      tokensInput: 500, tokensOutput: 100, cacheHit: false,
    });
    (invokeJulia as any).mockResolvedValue({
      decision: "BLOCKED",
      fundamentacaoLegal: ["CDC art. 71"],
      ajustesSugeridos: [],
      blockingReasons: ["frequência diária excedida"],
      validUntil: new Date().toISOString(),
      camadasValidadas: { deterministica: false, anatel: true, semantica: true, vulnerabilidade: true },
      latencyMs: 50, cacheHit: false,
      complianceCheckId: "cc_sofia_blocked",
    });

    const sendTemplate = vi.fn();
    (createMetaClient as any).mockResolvedValue({ sendTemplate, sendText: vi.fn() });

    const result = await processSofiaJob(makeJobData());
    expect(result.status).toBe("vetoed");
    expect(sendTemplate).not.toHaveBeenCalled();

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.providerId, providerId));
    expect(audits.some(a => a.action === "sofia_blocked_julia")).toBe(true);

    const attempts = await storage.outboundAttempt.listForRegua(providerId, { step: "THANK_YOU" });
    expect(attempts[0].status).toBe("vetoed");
  });

  it("sofia_disabled: toggle off → skipped sem chamar Sofia", async () => {
    await db.update(agentToggles).set({ sofiaAtiva: false }).where(eq(agentToggles.providerId, providerId));

    const result = await processSofiaJob(makeJobData());
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("sofia_disabled");
    expect(invokeSofia).not.toHaveBeenCalled();
  });

  it("sofia_failed: Sofia retorna error → markFailed sem Meta", async () => {
    (invokeSofia as any).mockResolvedValue({
      success: false,
      output: undefined,
      error: "no_template_available",
      turnsUsed: 1, toolsCalled: [], latencyMs: 700,
      tokensInput: 300, tokensOutput: 0, cacheHit: false,
    });

    const result = await processSofiaJob(makeJobData());
    expect(result.status).toBe("failed");
    expect(invokeJulia).not.toHaveBeenCalled();
    expect(createMetaClient).not.toHaveBeenCalled();
  });
});
