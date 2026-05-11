import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  paymentEvents,
  type PaymentEvent,
} from "@shared/schema";

/**
 * Spec 004 — Webhooks Asaas recebidos.
 * FR-008: idempotência por UNIQUE (provider_id, asaas_payment_id, event_type).
 */
export class PaymentEventStorage {
  /**
   * Insere evento; se já existe (UNIQUE violation), retorna inserted=false sem erro.
   * Implementa FR-008 idempotência via ON CONFLICT DO NOTHING.
   */
  async insertOrSkip(data: {
    providerId: number;
    asaasPaymentId: string;
    eventType: string;
    externalEventId?: string | null;
    payload: unknown;
  }): Promise<{ inserted: boolean; event: PaymentEvent | null }> {
    const rows = await db.insert(paymentEvents)
      .values({
        providerId: data.providerId,
        asaasPaymentId: data.asaasPaymentId,
        eventType: data.eventType,
        externalEventId: data.externalEventId ?? null,
        payload: data.payload as any,
        processingStatus: "processed",
      })
      .onConflictDoNothing({
        target: [paymentEvents.providerId, paymentEvents.asaasPaymentId, paymentEvents.eventType],
      })
      .returning();

    if (rows.length === 0) {
      // Duplicate — busca o existente para retornar referência.
      const [existing] = await db.select().from(paymentEvents)
        .where(and(
          eq(paymentEvents.providerId, data.providerId),
          eq(paymentEvents.asaasPaymentId, data.asaasPaymentId),
          eq(paymentEvents.eventType, data.eventType),
        ))
        .limit(1);
      return { inserted: false, event: existing ?? null };
    }
    return { inserted: true, event: rows[0] };
  }

  /**
   * Registra evento rejeitado (assinatura inválida, payload malformado).
   * Não passa pelo UNIQUE — rejeições podem se repetir.
   */
  async logRejection(data: {
    providerId: number | null;
    asaasPaymentId: string;
    eventType: string;
    payload: unknown;
    reason: string;
  }): Promise<PaymentEvent> {
    const [created] = await db.insert(paymentEvents)
      .values({
        providerId: data.providerId ?? 0, // 0 indica "tenant não identificado"
        asaasPaymentId: data.asaasPaymentId,
        eventType: data.eventType,
        payload: data.payload as any,
        processingStatus: "rejected",
        rejectionReason: data.reason,
      })
      .returning();
    return created;
  }

  async listByPixCharge(
    providerId: number,
    asaasPaymentId: string,
  ): Promise<PaymentEvent[]> {
    return db.select().from(paymentEvents)
      .where(and(
        eq(paymentEvents.providerId, providerId),
        eq(paymentEvents.asaasPaymentId, asaasPaymentId),
      ))
      .orderBy(desc(paymentEvents.receivedAt));
  }

  async attachSofiaJobId(eventId: number, jobId: string): Promise<void> {
    await db.update(paymentEvents)
      .set({ sofiaJobId: jobId })
      .where(eq(paymentEvents.id, eventId));
  }
}
