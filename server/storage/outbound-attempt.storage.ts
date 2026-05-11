import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  outboundAttempts,
  type OutboundAttempt, type InsertOutboundAttempt,
} from "@shared/schema";

/**
 * Spec 004 — Estado da régua (intenção + decisão Júlia + retry).
 * Princípio I (multi-tenant) + FR-005 (idempotência por dia/passo).
 */
export class OutboundAttemptStorage {
  /**
   * Tenta reservar slot da régua. Retorna o attempt criado OU null se já existe
   * (FR-005 — UNIQUE em (invoice_id, step, scheduled_for::date) para steps Bruno).
   *
   * Para Sofia (step='THANK_YOU') não há UNIQUE — chame esta função apenas
   * se já validou idempotência via payment_events.
   */
  async tryReserve(data: {
    providerId: number;
    customerId: number;
    invoiceId?: number;
    pixChargeId?: number;
    agentId: "bruno_v1" | "sofia_v1";
    step: "D-3" | "D-1" | "THANK_YOU";
    scheduledFor: Date;
  }): Promise<OutboundAttempt | null> {
    try {
      const [created] = await db.insert(outboundAttempts)
        .values({
          providerId: data.providerId,
          customerId: data.customerId,
          invoiceId: data.invoiceId ?? null,
          pixChargeId: data.pixChargeId ?? null,
          agentId: data.agentId,
          step: data.step,
          scheduledFor: data.scheduledFor,
          status: "scheduled",
        })
        .returning();
      return created;
    } catch (err: any) {
      // UNIQUE violation (Bruno D-3/D-1 mesmo dia)
      if (err?.code === "23505") return null;
      throw err;
    }
  }

  async byId(providerId: number, id: number): Promise<OutboundAttempt | undefined> {
    const [row] = await db.select().from(outboundAttempts)
      .where(and(
        eq(outboundAttempts.providerId, providerId),
        eq(outboundAttempts.id, id),
      ))
      .limit(1);
    return row;
  }

  async markWaitingWindow(id: number, nextRetryAt: Date): Promise<void> {
    await db.update(outboundAttempts)
      .set({ status: "waiting_window", nextRetryAt, updatedAt: new Date() })
      .where(eq(outboundAttempts.id, id));
  }

  async markAwaitingCompliance(id: number): Promise<void> {
    await db.update(outboundAttempts)
      .set({ status: "awaiting_compliance", updatedAt: new Date() })
      .where(eq(outboundAttempts.id, id));
  }

  async markVetoed(id: number, complianceCheckId: string, reason?: string): Promise<void> {
    await db.update(outboundAttempts)
      .set({
        status: "vetoed",
        complianceCheckId,
        failureReason: reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(outboundAttempts.id, id));
  }

  async markSent(id: number, complianceCheckId: string, communicationId: number): Promise<void> {
    await db.update(outboundAttempts)
      .set({
        status: "sent",
        complianceCheckId,
        communicationId,
        updatedAt: new Date(),
      })
      .where(eq(outboundAttempts.id, id));
  }

  async markFailed(id: number, reason: string, nextRetryAt: Date): Promise<void> {
    await db.update(outboundAttempts)
      .set({
        status: "failed",
        failureReason: reason,
        nextRetryAt,
        attemptCount: sql`${outboundAttempts.attemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(outboundAttempts.id, id));
  }

  async markNeedsHumanReview(id: number, reason: string): Promise<void> {
    await db.update(outboundAttempts)
      .set({
        status: "needs_human_review",
        failureReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(outboundAttempts.id, id));
  }

  /**
   * Worker outbound-retry chama isto: lista attempts prontos para retry.
   * Retorna até `limit` rows ordenados por nextRetryAt.
   */
  async selectForRetry(limit = 50): Promise<OutboundAttempt[]> {
    const now = new Date();
    return db.select().from(outboundAttempts)
      .where(and(
        eq(outboundAttempts.status, "failed"),
        lt(outboundAttempts.attemptCount, 2),
        lte(outboundAttempts.nextRetryAt, now),
      ))
      .orderBy(outboundAttempts.nextRetryAt)
      .limit(limit);
  }

  /**
   * Listagem para painel "Régua Pré-Vencimento".
   */
  async listForRegua(
    providerId: number,
    filters: {
      from?: Date;
      to?: Date;
      status?: OutboundAttempt["status"];
      step?: OutboundAttempt["step"];
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<OutboundAttempt[]> {
    const conditions = [eq(outboundAttempts.providerId, providerId)];
    if (filters.from) conditions.push(gte(outboundAttempts.scheduledFor, filters.from));
    if (filters.to) conditions.push(lte(outboundAttempts.scheduledFor, filters.to));
    if (filters.status) conditions.push(eq(outboundAttempts.status, filters.status));
    if (filters.step) conditions.push(eq(outboundAttempts.step, filters.step));

    return db.select().from(outboundAttempts)
      .where(and(...conditions))
      .orderBy(desc(outboundAttempts.scheduledFor))
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0);
  }
}
