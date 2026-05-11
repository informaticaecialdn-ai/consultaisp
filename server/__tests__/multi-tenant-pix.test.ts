/**
 * Spec 004 — Multi-tenant isolation test for Bruno/Sofia/Pix.
 *
 * Princípio I (não-negociável): provedor A NUNCA vê dados do provedor B.
 *
 * Pré-requisitos:
 *  - DATABASE_URL apontando para Postgres dev (não produção!)
 *  - ENCRYPTION_MASTER_KEY definido (mesma chave da Spec 003)
 *  - Tabelas Spec 003 + Spec 004 migradas (`npm run db:migrate`)
 *
 * Nota: este teste usa o Postgres real (Constituição §Testes: mocks de banco
 * proibidos). O fetch para Asaas é monkey-patched para evitar HTTP real.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { db, pool } from "../db";
import { storage } from "../storage";
import { parseExternalReference, buildExternalRef } from "../services/asaas-multi-tenant";
import { providers, customers, invoices, asaasAccounts, pixCharges, outboundAttempts } from "@shared/schema";
import { eq } from "drizzle-orm";

const TEST_PROVIDER_A_NAME = "_test_spec004_provider_a";
const TEST_PROVIDER_B_NAME = "_test_spec004_provider_b";

let providerA: number;
let providerB: number;
let customerA: number;
let customerB: number;
let invoiceA: number;
let invoiceB: number;

async function cleanup() {
  // Limpa dados de teste em ordem reversa de FKs
  await db.delete(outboundAttempts).where(eq(outboundAttempts.providerId, providerA ?? -1));
  await db.delete(outboundAttempts).where(eq(outboundAttempts.providerId, providerB ?? -1));
  await db.delete(pixCharges).where(eq(pixCharges.providerId, providerA ?? -1));
  await db.delete(pixCharges).where(eq(pixCharges.providerId, providerB ?? -1));
  await db.delete(asaasAccounts).where(eq(asaasAccounts.providerId, providerA ?? -1));
  await db.delete(asaasAccounts).where(eq(asaasAccounts.providerId, providerB ?? -1));
  if (invoiceA) await db.delete(invoices).where(eq(invoices.id, invoiceA));
  if (invoiceB) await db.delete(invoices).where(eq(invoices.id, invoiceB));
  if (customerA) await db.delete(customers).where(eq(customers.id, customerA));
  if (customerB) await db.delete(customers).where(eq(customers.id, customerB));
  if (providerA) await db.delete(providers).where(eq(providers.id, providerA));
  if (providerB) await db.delete(providers).where(eq(providers.id, providerB));
}

describe("Spec 004 — Multi-tenant isolation (Bruno/Sofia/Pix)", () => {
  beforeAll(async () => {
    // Garante 2 providers de teste com CNPJ distinto
    const [pA] = await db.insert(providers).values({
      name: TEST_PROVIDER_A_NAME,
      cnpj: `00000000000001`,
      addressState: "SP",
    }).returning();
    const [pB] = await db.insert(providers).values({
      name: TEST_PROVIDER_B_NAME,
      cnpj: `00000000000002`,
      addressState: "SP",
    }).returning();
    providerA = pA.id;
    providerB = pB.id;

    // Customers
    const [cA] = await db.insert(customers).values({
      providerId: providerA,
      name: "Cliente A",
      cpfCnpj: "11111111111",
    }).returning();
    const [cB] = await db.insert(customers).values({
      providerId: providerB,
      name: "Cliente B",
      cpfCnpj: "22222222222",
    }).returning();
    customerA = cA.id;
    customerB = cB.id;

    // Invoices
    const [iA] = await db.insert(invoices).values({
      providerId: providerA,
      customerId: customerA,
      value: "149.90" as any,
      dueDate: "2026-05-14" as any,
      status: "pendente",
    }).returning();
    const [iB] = await db.insert(invoices).values({
      providerId: providerB,
      customerId: customerB,
      value: "249.90" as any,
      dueDate: "2026-05-14" as any,
      status: "pendente",
    }).returning();
    invoiceA = iA.id;
    invoiceB = iB.id;
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  describe("asaas_accounts isolation", () => {
    it("upsert(A) não cria/altera row do provider B", async () => {
      await storage.asaasAccount.upsert(providerA, {
        apiKey: "$aact_test_aaaaaaaaaaaaaa1",
        webhookToken: "tokenA_long_enough_for_validation",
        mode: "sandbox",
      });
      const accB = await storage.asaasAccount.byProviderId(providerB);
      expect(accB).toBeUndefined();
    });

    it("getApiKey(B) retorna null quando só A está configurado", async () => {
      const keyA = await storage.asaasAccount.getApiKey(providerA);
      const keyB = await storage.asaasAccount.getApiKey(providerB);
      expect(keyA).toBe("$aact_test_aaaaaaaaaaaaaa1");
      expect(keyB).toBeNull();
    });

    it("chaves de A e B nunca se cruzam mesmo após ambos configurados", async () => {
      await storage.asaasAccount.upsert(providerB, {
        apiKey: "$aact_test_bbbbbbbbbbbbbb2",
        webhookToken: "tokenB_long_enough_for_validation",
        mode: "sandbox",
      });
      const keyA = await storage.asaasAccount.getApiKey(providerA);
      const keyB = await storage.asaasAccount.getApiKey(providerB);
      expect(keyA).toBe("$aact_test_aaaaaaaaaaaaaa1");
      expect(keyB).toBe("$aact_test_bbbbbbbbbbbbbb2");
      expect(keyA).not.toBe(keyB);
    });
  });

  describe("pix_charges isolation", () => {
    let pixA_paymentId = "pay_test_a_111";
    let pixB_paymentId = "pay_test_b_222";

    beforeEach(async () => {
      await db.delete(pixCharges).where(eq(pixCharges.providerId, providerA));
      await db.delete(pixCharges).where(eq(pixCharges.providerId, providerB));
    });

    it("create(A) não fica visível em listForRegua(B)", async () => {
      await storage.pixCharge.create(providerA, {
        invoiceId: invoiceA,
        customerId: customerA,
        asaasPaymentId: pixA_paymentId,
        value: "149.90" as any,
        dueDate: "2026-05-14" as any,
        status: "pending",
      });

      const listFromB = await storage.pixCharge.listForRegua(providerB);
      expect(listFromB.find(r => r.asaasPaymentId === pixA_paymentId)).toBeUndefined();
    });

    it("byAsaasId filtra por provider — A não enxerga pay de B", async () => {
      await storage.pixCharge.create(providerB, {
        invoiceId: invoiceB,
        customerId: customerB,
        asaasPaymentId: pixB_paymentId,
        value: "249.90" as any,
        dueDate: "2026-05-14" as any,
        status: "pending",
      });

      const fromA = await storage.pixCharge.byAsaasId(providerA, pixB_paymentId);
      const fromB = await storage.pixCharge.byAsaasId(providerB, pixB_paymentId);
      expect(fromA).toBeUndefined();
      expect(fromB).toBeDefined();
      expect(fromB!.providerId).toBe(providerB);
    });
  });

  describe("outbound_attempts idempotency + isolation", () => {
    beforeEach(async () => {
      await db.delete(outboundAttempts).where(eq(outboundAttempts.providerId, providerA));
      await db.delete(outboundAttempts).where(eq(outboundAttempts.providerId, providerB));
    });

    it("tryReserve mesma fatura/passo/dia retorna null na 2a chamada (FR-005)", async () => {
      const scheduled = new Date("2026-05-11T09:00:00-03:00");
      const first = await storage.outboundAttempt.tryReserve({
        providerId: providerA,
        customerId: customerA,
        invoiceId: invoiceA,
        agentId: "bruno_v1",
        step: "D-3",
        scheduledFor: scheduled,
      });
      const second = await storage.outboundAttempt.tryReserve({
        providerId: providerA,
        customerId: customerA,
        invoiceId: invoiceA,
        agentId: "bruno_v1",
        step: "D-3",
        scheduledFor: scheduled,
      });
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it("tryReserve D-3 e D-1 mesmo dia mesma fatura: ambos passam (steps diferentes)", async () => {
      const scheduled = new Date("2026-05-11T09:00:00-03:00");
      const d3 = await storage.outboundAttempt.tryReserve({
        providerId: providerA,
        customerId: customerA,
        invoiceId: invoiceA,
        agentId: "bruno_v1",
        step: "D-3",
        scheduledFor: scheduled,
      });
      const d1 = await storage.outboundAttempt.tryReserve({
        providerId: providerA,
        customerId: customerA,
        invoiceId: invoiceA,
        agentId: "bruno_v1",
        step: "D-1",
        scheduledFor: scheduled,
      });
      expect(d3).not.toBeNull();
      expect(d1).not.toBeNull();
    });

    it("listForRegua(A) não retorna outbounds do provider B", async () => {
      await storage.outboundAttempt.tryReserve({
        providerId: providerB,
        customerId: customerB,
        invoiceId: invoiceB,
        agentId: "bruno_v1",
        step: "D-3",
        scheduledFor: new Date("2026-05-11T09:00:00-03:00"),
      });
      const fromA = await storage.outboundAttempt.listForRegua(providerA);
      expect(fromA.length).toBe(0);
    });
  });

  describe("payment_events idempotency", () => {
    beforeEach(async () => {
      // payment_events não tem helper de cleanup — usa SQL direto
      await db.execute(
        `DELETE FROM payment_events WHERE provider_id IN (${providerA}, ${providerB})` as any,
      );
    });

    it("insertOrSkip 2x mesmo (provider, payment, event) → 2a é duplicate (FR-008)", async () => {
      const data = {
        providerId: providerA,
        asaasPaymentId: "pay_test_dup_111",
        eventType: "PAYMENT_RECEIVED",
        payload: { id: "evt_1", value: 100 },
      };
      const first = await storage.paymentEvent.insertOrSkip(data);
      const second = await storage.paymentEvent.insertOrSkip(data);
      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.event?.id).toBe(first.event?.id);
    });

    it("mesmo asaasPaymentId em providers diferentes NÃO é duplicate", async () => {
      const data1 = {
        providerId: providerA,
        asaasPaymentId: "pay_test_cross_111",
        eventType: "PAYMENT_RECEIVED",
        payload: { id: "evt_1" },
      };
      const data2 = { ...data1, providerId: providerB };
      const r1 = await storage.paymentEvent.insertOrSkip(data1);
      const r2 = await storage.paymentEvent.insertOrSkip(data2);
      expect(r1.inserted).toBe(true);
      expect(r2.inserted).toBe(true);
    });
  });

  describe("parseExternalReference (helper Asaas multi-tenant)", () => {
    it("parse formato válido", () => {
      expect(parseExternalReference("provider:42:invoice:9876:attempt:551")).toEqual({
        providerId: 42, invoiceId: 9876, attemptId: 551,
      });
    });

    it("formato inválido retorna null", () => {
      expect(parseExternalReference("garbage")).toBeNull();
      expect(parseExternalReference("provider:abc:invoice:1:attempt:1")).toBeNull();
      expect(parseExternalReference(null)).toBeNull();
      expect(parseExternalReference(undefined)).toBeNull();
    });

    it("buildExternalRef roundtrips", () => {
      const ref = buildExternalRef(42, 9876, 551);
      const parsed = parseExternalReference(ref);
      expect(parsed).toEqual({ providerId: 42, invoiceId: 9876, attemptId: 551 });
    });
  });
});
