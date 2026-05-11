import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  pixCharges,
  type PixCharge, type InsertPixCharge,
} from "@shared/schema";

/**
 * Spec 004 — Pix dinâmico gerado por Bruno.
 * Princípio I (multi-tenant): toda função recebe providerId como 1º parâmetro.
 */
export class PixChargeStorage {
  async create(providerId: number, data: Omit<InsertPixCharge, "providerId">): Promise<PixCharge> {
    const [created] = await db.insert(pixCharges)
      .values({ ...data, providerId })
      .returning();
    return created;
  }

  async byAsaasId(providerId: number, asaasPaymentId: string): Promise<PixCharge | undefined> {
    const [row] = await db.select().from(pixCharges)
      .where(and(
        eq(pixCharges.providerId, providerId),
        eq(pixCharges.asaasPaymentId, asaasPaymentId),
      ))
      .limit(1);
    return row;
  }

  /**
   * Busca Pix vigente (mais recente) para uma fatura num dia específico e step.
   * Usado para idempotência defensiva antes de chamar Asaas — segunda camada
   * (a primeira camada é o UNIQUE index em outbound_attempts).
   */
  async byInvoiceAndDay(
    providerId: number,
    invoiceId: number,
    day: Date,
  ): Promise<PixCharge | undefined> {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    const [row] = await db.select().from(pixCharges)
      .where(and(
        eq(pixCharges.providerId, providerId),
        eq(pixCharges.invoiceId, invoiceId),
        gte(pixCharges.createdAt, dayStart),
        lte(pixCharges.createdAt, dayEnd),
      ))
      .limit(1);
    return row;
  }

  /**
   * Atualiza status pelo asaasPaymentId. Não filtra por providerId aqui porque
   * asaasPaymentId é globalmente único (Asaas é a fonte de verdade); o caller
   * é responsável por garantir que veio do tenant certo (webhook valida via
   * externalReference + token).
   */
  async updateStatus(
    asaasPaymentId: string,
    status: PixCharge["status"],
    timestamps: { paidAt?: Date; cancelledAt?: Date } = {},
  ): Promise<PixCharge | undefined> {
    const patch: Partial<PixCharge> = { status, updatedAt: new Date() };
    if (timestamps.paidAt) patch.paidAt = timestamps.paidAt;
    if (timestamps.cancelledAt) patch.cancelledAt = timestamps.cancelledAt;

    const [updated] = await db.update(pixCharges)
      .set(patch)
      .where(eq(pixCharges.asaasPaymentId, asaasPaymentId))
      .returning();
    return updated;
  }

  /**
   * Cacheia QR Code base64 e copia-e-cola após primeira chamada Asaas.
   */
  async cacheQrCode(
    providerId: number,
    asaasPaymentId: string,
    qrCodeBase64: string,
    copyPaste: string,
    expiresAt?: Date,
  ): Promise<void> {
    await db.update(pixCharges)
      .set({
        pixQrCodeBase64: qrCodeBase64,
        pixCopyPaste: copyPaste,
        pixExpiresAt: expiresAt ?? null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(pixCharges.providerId, providerId),
        eq(pixCharges.asaasPaymentId, asaasPaymentId),
      ));
  }

  /**
   * Listagem para painel "Régua Pré-Vencimento".
   */
  async listForRegua(
    providerId: number,
    filters: {
      from?: Date;
      to?: Date;
      status?: PixCharge["status"];
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<PixCharge[]> {
    const conditions = [eq(pixCharges.providerId, providerId)];
    if (filters.from) conditions.push(gte(pixCharges.dueDate, filters.from.toISOString().slice(0, 10) as any));
    if (filters.to) conditions.push(lte(pixCharges.dueDate, filters.to.toISOString().slice(0, 10) as any));
    if (filters.status) conditions.push(eq(pixCharges.status, filters.status));

    return db.select().from(pixCharges)
      .where(and(...conditions))
      .orderBy(sql`${pixCharges.dueDate} asc`)
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0);
  }
}
