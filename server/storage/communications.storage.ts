import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import {
  communications,
  customers,
  type Communication, type InsertCommunication,
} from "@shared/schema";

/**
 * Spec 003 — Comunicações inbound/outbound (WhatsApp, email, SMS).
 * Princípio I (multi-tenant): TODA query filtra por providerId.
 */
export class CommunicationsStorage {
  /** Lista mensagens inbound de um cliente (ordenadas mais recente -> antiga). */
  async listInbound(providerId: number, customerId: number, limit = 50): Promise<Communication[]> {
    return db.select().from(communications)
      .where(and(
        eq(communications.providerId, providerId),
        eq(communications.customerId, customerId),
        eq(communications.direction, "inbound"),
      ))
      .orderBy(desc(communications.createdAt))
      .limit(limit);
  }

  /** Lista mensagens outbound de um cliente (ordenadas mais recente -> antiga). */
  async listOutbound(providerId: number, customerId: number, limit = 50): Promise<Communication[]> {
    return db.select().from(communications)
      .where(and(
        eq(communications.providerId, providerId),
        eq(communications.customerId, customerId),
        eq(communications.direction, "outbound"),
      ))
      .orderBy(desc(communications.createdAt))
      .limit(limit);
  }

  /** Cria registro de comunicação. providerId é forçado pra garantir isolamento. */
  async create(providerId: number, data: Omit<InsertCommunication, "providerId">): Promise<Communication> {
    const [created] = await db.insert(communications)
      .values({ ...data, providerId })
      .returning();
    return created;
  }

  /**
   * Atualiza status de mensagem outbound pelo externalMessageId (wamid da Meta).
   * Usado por webhook da Meta Cloud API quando muda estado: sent -> delivered -> read.
   * Não filtra por providerId porque webhooks externos não conhecem nosso providerId —
   * a unicidade vem do externalMessageId, que é globalmente único na Meta.
   */
  async updateStatus(
    externalMessageId: string,
    status: string,
    timestamps: { sentAt?: Date; deliveredAt?: Date; readAt?: Date } = {},
  ): Promise<Communication | undefined> {
    const patch: Partial<Communication> = { status };
    if (timestamps.sentAt) patch.sentAt = timestamps.sentAt;
    if (timestamps.deliveredAt) patch.deliveredAt = timestamps.deliveredAt;
    if (timestamps.readAt) patch.readAt = timestamps.readAt;

    const [updated] = await db.update(communications)
      .set(patch)
      .where(eq(communications.externalMessageId, externalMessageId))
      .returning();
    return updated;
  }

  /** Busca por externalMessageId (wamid). Globalmente único, não precisa filtrar por provider. */
  async findByWamid(externalMessageId: string): Promise<Communication | undefined> {
    const [row] = await db.select().from(communications)
      .where(eq(communications.externalMessageId, externalMessageId))
      .limit(1);
    return row;
  }

  /** Lista comunicações do provider com join opcional de customer name/phone. */
  async listByProvider(
    providerId: number,
    customerId?: number,
    limit = 50,
  ): Promise<Array<Communication & { customerName: string | null; customerPhone: string | null }>> {
    const whereClause = customerId
      ? and(eq(communications.providerId, providerId), eq(communications.customerId, customerId))
      : eq(communications.providerId, providerId);

    const rows = await db.select({
      id: communications.id,
      providerId: communications.providerId,
      customerId: communications.customerId,
      channel: communications.channel,
      direction: communications.direction,
      templateName: communications.templateName,
      content: communications.content,
      status: communications.status,
      externalMessageId: communications.externalMessageId,
      sentAt: communications.sentAt,
      deliveredAt: communications.deliveredAt,
      readAt: communications.readAt,
      agentId: communications.agentId,
      createdAt: communications.createdAt,
      customerName: customers.name,
      customerPhone: customers.phone,
    })
      .from(communications)
      .leftJoin(customers, eq(communications.customerId, customers.id))
      .where(whereClause)
      .orderBy(desc(communications.createdAt))
      .limit(limit);

    return rows as any;
  }
}
