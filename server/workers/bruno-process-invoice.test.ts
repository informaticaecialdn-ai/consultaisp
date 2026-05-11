/**
 * Spec 004 — Integration tests for processBrunoJob (T029).
 *
 * Constituição §Testes: Postgres real, mocks de banco PROIBIDOS.
 * Mocks externos: Anthropic SDK, Asaas, Meta WhatsApp client.
 *
 * Casos cobertos:
 *  - skipped_paid: fatura já paga → audit `bruno_skipped_paid`, vetoed, sem LLM.
 *  - skipped_optout: customer em whatsapp_optouts → audit `bruno_skipped_optout`.
 *  - waiting_window: hora atual fora da janela do tenant → markWaitingWindow.
 *  - bruno_disabled: toggle off → skipped (no envio).
 *  - happy_path: LLM mockado retorna JSON válido + Meta mock OK → markSent + audit.
 *  - julia_blocked: Júlia BLOCKED → markVetoed, sem envio Meta.
 *  - meta_fail: Meta throws → markFailed.
 *
 * Pré-requisitos:
 *  - DATABASE_URL apontando para Postgres de dev.
 *  - ENCRYPTION_MASTER_KEY definido.
 *  - Migrations Spec 003 + 004 aplicadas.
 *
 * Sem DATABASE_URL: testes são marcados como skip (vitest.skipIf).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";

const HAS_DB = !!process.env.DATABASE_URL;
const describeIfDb = HAS_DB ? describe : describe.skip;

// -------------------- MOCKS HOISTED --------------------
// Os mocks precisam estar acima dos imports concretos para vitest interceptá-los.

vi.mock("../agents/bruno", async (orig) => {
  const actual = await orig<typeof import("../agents/bruno")>();
  return {
    ...actual,
    invokeBruno: vi.fn(),
  };
});

vi.mock("../agents/julia", async (orig) => {
  const actual = await orig<typeof import("../agents/julia")>();
  return {
    ...actual,
    invokeJulia: vi.fn(),
  };
});

vi.mock("../communications/whatsapp/client", async (orig) => {
  const actual = await orig<typeof import("../communications/whatsapp/client")>();
  return {
    ...actual,
    createMetaClient: vi.fn(),
  };
});

// -------------------- AGORA IMPORTS --------------------
import { db, pool } from "../db";
import { storage } from "../storage";
import {
  providers, customers, contracts, invoices, agentToggles,
  whatsappOptouts, outboundAttempts, pixCharges, auditLogs,
} from "@shared/schema";
import { processBrunoJob } from "./bruno-process-invoice";
import { invokeBruno } from "../agents/bruno";
import { invokeJulia } from "../agents/julia";
import { createMetaClient } from "../communications/whatsapp/client";

const TEST_PROVIDER_NAME = "_test_spec004_bruno_worker";

let providerId: number;
let customerId: number;
let contractId: number;
let invoiceId: number;

async function cleanupAll() {
  if (providerId) {
    await db.delete(auditLogs).where(eq(auditLogs.providerId, providerId));
    await db.delete(outboundAttempts).where(eq(outboundAttempts.providerId, providerId));
    await db.delete(pixCharges).where(eq(pixCharges.providerId, providerId));
    await db.delete(agentToggles).where(eq(agentToggles.providerId, providerId));
    await db.delete(whatsappOptouts).where(eq(whatsappOptouts.providerId, providerId));
    if (invoiceId) await db.delete(invoices).where(eq(invoices.id, invoiceId));
    if (contractId) await db.delete(contracts).where(eq(contracts.id, contractId));
    if (customerId) await db.delete(customers).where(eq(customers.id, customerId));
    await db.delete(providers).where(eq(providers.id, providerId));
  }
}

describeIfDb("Spec 004 — processBrunoJob integration", () => {
  beforeAll(async () => {
    const [p] = await db.insert(providers).values({
      name: TEST_PROVIDER_NAME,
      cnpj: "00000000000099",
      addressState: "SP",
      tradeName: "Test Telecom",
      contactPhone: "+5511999999999",
    }).returning();
    providerId = p.id;

    const [c] = await db.insert(customers).values({
      providerId,
      name: "João da Silva",
      cpfCnpj: "12345678901",
      phone: "+5511988887777",
      email: "joao@example.com",
    }).returning();
    customerId = c.id;

    const [ct] = await db.insert(contracts).values({
      providerId,
      customerId,
      plan: "100MB",
      value: "149.90",
      status: "active",
    }).returning();
    contractId = ct.id;

    const [inv] = await db.insert(invoices).values({
      providerId,
      customerId,
      contractId,
      value: "149.90",
      dueDate: new Date("2026-05-14T00:00:00Z") as any,
      status: "pending",
    }).returning();
    invoiceId = inv.id;
  });

  afterAll(async () => {
    await cleanupAll();
    await pool.end();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reseta toggle + opt-outs + outbound entre cenários
    await db.delete(outboundAttempts).where(eq(outboundAttempts.providerId, providerId));
    await db.delete(pixCharges).where(eq(pixCharges.providerId, providerId));
    await db.delete(whatsappOptouts).where(eq(whatsappOptouts.providerId, providerId));
    await db.delete(agentToggles).where(eq(agentToggles.providerId, providerId));
    await db.insert(agentToggles).values({
      providerId,
      brunoAtivo: true,
      sofiaAtiva: false,
      schedulerHoraLocal: "09:00:00",
      janelaInicio: "00:00:00",
      janelaFim: "23:59:00",
      permiteSabado: true,
      permiteDomingo: true,
      templateBrunoNome: "lembrete_prevencimento_v1",
    });
    // Reseta status da fatura para pending
    await db.update(invoices).set({ status: "pending" }).where(eq(invoices.id, invoiceId));
  });

  async function reserveAttempt(step: "D-3" | "D-1" = "D-3") {
    const reserved = await storage.outboundAttempt.tryReserve({
      providerId,
      customerId,
      invoiceId,
      agentId: "bruno_v1",
      step,
      scheduledFor: new Date(),
    });
    if (!reserved) throw new Error("reserveAttempt failed");
    return reserved;
  }

  it("skipped_paid: fatura paga → audit bruno_skipped_paid, sem LLM", async () => {
    await db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoiceId));
    const attempt = await reserveAttempt("D-1");

    const result = await processBrunoJob({
      providerId, invoiceId, customerId,
      attemptId: attempt.id,
      step: "D-1",
      scheduledForIso: new Date().toISOString(),
      correlationId: "test-paid",
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("invoice_paid");
    expect(invokeBruno).not.toHaveBeenCalled();
    expect(invokeJulia).not.toHaveBeenCalled();
    expect(createMetaClient).not.toHaveBeenCalled();

    // Audit log existe
    const audits = await storage.auditLog.listByCustomer(providerId, customerId);
    expect(audits.some(a => a.action === "bruno_skipped_paid")).toBe(true);

    // Attempt está vetoed
    const updated = await storage.outboundAttempt.byId(providerId, attempt.id);
    expect(updated?.status).toBe("vetoed");
  });

  it("skipped_optout: customer em opt-out → audit bruno_skipped_optout", async () => {
    await db.insert(whatsappOptouts).values({
      providerId,
      phoneNumber: "+5511988887777",
      reason: "test",
    });
    const attempt = await reserveAttempt();

    const result = await processBrunoJob({
      providerId, invoiceId, customerId,
      attemptId: attempt.id,
      step: "D-3",
      scheduledForIso: new Date().toISOString(),
      correlationId: "test-optout",
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("opt_out");
    expect(invokeBruno).not.toHaveBeenCalled();

    const audits = await storage.auditLog.listByCustomer(providerId, customerId);
    expect(audits.some(a => a.action === "bruno_skipped_optout")).toBe(true);

    const updated = await storage.outboundAttempt.byId(providerId, attempt.id);
    expect(updated?.status).toBe("vetoed");
  });

  it("waiting_window: fora da janela horária → markWaitingWindow", async () => {
    // Define janela impossível (00:00-00:01) para garantir fora da janela agora.
    await db.update(agentToggles)
      .set({ janelaInicio: "00:00:00", janelaFim: "00:01:00" })
      .where(eq(agentToggles.providerId, providerId));

    const attempt = await reserveAttempt();
    const result = await processBrunoJob({
      providerId, invoiceId, customerId,
      attemptId: attempt.id,
      step: "D-3",
      scheduledForIso: new Date().toISOString(),
      correlationId: "test-window",
    });

    expect(result.status).toBe("waiting_window");
    expect(invokeBruno).not.toHaveBeenCalled();

    const updated = await storage.outboundAttempt.byId(providerId, attempt.id);
    expect(updated?.status).toBe("waiting_window");
    expect(updated?.nextRetryAt).not.toBeNull();
  });

  it("bruno_disabled: toggle off mid-flight → skipped", async () => {
    await db.update(agentToggles).set({ brunoAtivo: false }).where(eq(agentToggles.providerId, providerId));
    const attempt = await reserveAttempt();

    const result = await processBrunoJob({
      providerId, invoiceId, customerId,
      attemptId: attempt.id,
      step: "D-3",
      scheduledForIso: new Date().toISOString(),
      correlationId: "test-disabled",
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("bruno_disabled");
  });

  it("happy_path: Bruno LLM ok + Júlia APPROVED + Meta send → status sent", async () => {
    (invokeBruno as any).mockResolvedValue({
      success: true,
      output: {
        templateName: "lembrete_prevencimento_v1",
        variables: { nome_cliente: "João", valor: "R$ 149,90", data_vencimento: "14/05/2026" },
        pix: {
          asaasPaymentId: "pay_happy_111",
          qrCodeBase64: "QR_BASE64_STUB",
          copyPaste: "00020126happy",
          pixChargeId: undefined,
        },
        freeFormText: null,
      },
      turnsUsed: 2,
      toolsCalled: ["gerar_pix_dinamico"],
      latencyMs: 1200,
      tokensInput: 600,
      tokensOutput: 200,
      cacheHit: false,
      pixReused: false,
    });

    (invokeJulia as any).mockResolvedValue({
      decision: "APPROVED",
      fundamentacaoLegal: [],
      ajustesSugeridos: [],
      validUntil: new Date(Date.now() + 300_000).toISOString(),
      camadasValidadas: { deterministica: true, anatel: true, semantica: true, vulnerabilidade: true },
      latencyMs: 80,
      cacheHit: false,
      complianceCheckId: "cc_happy_111",
    });

    (createMetaClient as any).mockResolvedValue({
      sendTemplate: vi.fn().mockResolvedValue({ messageId: "wamid.happy.111", status: "sent" }),
    });

    const attempt = await reserveAttempt();
    const result = await processBrunoJob({
      providerId, invoiceId, customerId,
      attemptId: attempt.id,
      step: "D-3",
      scheduledForIso: new Date().toISOString(),
      correlationId: "test-happy",
    });

    expect(result.status).toBe("sent");
    expect(invokeBruno).toHaveBeenCalledOnce();
    expect(invokeJulia).toHaveBeenCalledOnce();
    expect(createMetaClient).toHaveBeenCalledWith(providerId);

    const updated = await storage.outboundAttempt.byId(providerId, attempt.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.complianceCheckId).toBe("cc_happy_111");

    const audits = await storage.auditLog.listByCustomer(providerId, customerId);
    const actions = audits.map(a => a.action);
    expect(actions).toContain("bruno_generate_pix");
    expect(actions).toContain("bruno_send_message");
  });

  it("julia_blocked: Júlia BLOCKED → markVetoed, sem Meta", async () => {
    (invokeBruno as any).mockResolvedValue({
      success: true,
      output: {
        templateName: "lembrete_prevencimento_v1",
        variables: { nome_cliente: "João", valor: "R$ 149,90", data_vencimento: "14/05/2026" },
        pix: { asaasPaymentId: "pay_blocked_111", qrCodeBase64: "QR", copyPaste: "00020126b" },
        freeFormText: null,
      },
      turnsUsed: 2, toolsCalled: ["gerar_pix_dinamico"], latencyMs: 1100,
      tokensInput: 600, tokensOutput: 200, cacheHit: false, pixReused: false,
    });

    (invokeJulia as any).mockResolvedValue({
      decision: "BLOCKED",
      fundamentacaoLegal: ["CDC art. 71"],
      ajustesSugeridos: [],
      blockingReasons: ["frequencia diária excedida"],
      validUntil: new Date().toISOString(),
      camadasValidadas: { deterministica: false, anatel: true, semantica: true, vulnerabilidade: true },
      latencyMs: 50,
      cacheHit: false,
      complianceCheckId: "cc_blocked_111",
    });

    const metaSend = vi.fn();
    (createMetaClient as any).mockResolvedValue({ sendTemplate: metaSend });

    const attempt = await reserveAttempt();
    const result = await processBrunoJob({
      providerId, invoiceId, customerId,
      attemptId: attempt.id,
      step: "D-3",
      scheduledForIso: new Date().toISOString(),
      correlationId: "test-blocked",
    });

    expect(result.status).toBe("vetoed");
    expect(metaSend).not.toHaveBeenCalled();

    const updated = await storage.outboundAttempt.byId(providerId, attempt.id);
    expect(updated?.status).toBe("vetoed");
    expect(updated?.complianceCheckId).toBe("cc_blocked_111");
  });

  it("meta_fail: Meta send throws → markFailed", async () => {
    (invokeBruno as any).mockResolvedValue({
      success: true,
      output: {
        templateName: "lembrete_prevencimento_v1",
        variables: { nome_cliente: "João", valor: "R$ 149,90", data_vencimento: "14/05/2026" },
        pix: { asaasPaymentId: "pay_meta_fail_111", qrCodeBase64: "QR", copyPaste: "00020126m" },
        freeFormText: null,
      },
      turnsUsed: 2, toolsCalled: ["gerar_pix_dinamico"], latencyMs: 1100,
      tokensInput: 600, tokensOutput: 200, cacheHit: false, pixReused: false,
    });

    (invokeJulia as any).mockResolvedValue({
      decision: "APPROVED",
      fundamentacaoLegal: [], ajustesSugeridos: [],
      validUntil: new Date().toISOString(),
      camadasValidadas: { deterministica: true, anatel: true, semantica: true, vulnerabilidade: true },
      latencyMs: 60, cacheHit: false,
      complianceCheckId: "cc_meta_fail_111",
    });

    (createMetaClient as any).mockResolvedValue({
      sendTemplate: vi.fn().mockRejectedValue(new Error("meta 500 boom")),
    });

    const attempt = await reserveAttempt();
    const result = await processBrunoJob({
      providerId, invoiceId, customerId,
      attemptId: attempt.id,
      step: "D-3",
      scheduledForIso: new Date().toISOString(),
      correlationId: "test-meta-fail",
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("meta 500 boom");

    const updated = await storage.outboundAttempt.byId(providerId, attempt.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.nextRetryAt).not.toBeNull();
    expect(updated?.attemptCount).toBe(1);

    const audits = await storage.auditLog.listByCustomer(providerId, customerId);
    expect(audits.some(a => a.action === "bruno_failed_send")).toBe(true);
  });

  it("bruno_failed: agent retornou error → markFailed sem chamar Meta", async () => {
    (invokeBruno as any).mockResolvedValue({
      success: false,
      output: undefined,
      error: "no_template_available",
      turnsUsed: 1, toolsCalled: [], latencyMs: 800,
      tokensInput: 200, tokensOutput: 0, cacheHit: false,
    });

    const attempt = await reserveAttempt();
    const result = await processBrunoJob({
      providerId, invoiceId, customerId,
      attemptId: attempt.id,
      step: "D-3",
      scheduledForIso: new Date().toISOString(),
      correlationId: "test-bruno-fail",
    });

    expect(result.status).toBe("failed");
    expect(invokeJulia).not.toHaveBeenCalled();
    expect(createMetaClient).not.toHaveBeenCalled();
  });
});
