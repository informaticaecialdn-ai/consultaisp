import { eq, and } from "drizzle-orm";
import { db } from "../db";
import {
  whatsappOptouts,
  type WhatsappOptout,
} from "@shared/schema";

/**
 * Spec 003 — Opt-out permanente de WhatsApp (cliente respondeu "PARAR").
 * Princípio I (multi-tenant): TODA query filtra por providerId.
 * Princípio V (LGPD): respeitar opt-out é obrigação legal.
 */

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export class WhatsappOptoutStorage {
  /** Verifica se o telefone está em opt-out para o provedor. */
  async isOptedOut(providerId: number, phoneNumber: string): Promise<boolean> {
    const normalized = normalizePhone(phoneNumber);
    const [row] = await db.select({ id: whatsappOptouts.id }).from(whatsappOptouts)
      .where(and(
        eq(whatsappOptouts.providerId, providerId),
        eq(whatsappOptouts.phoneNumber, normalized),
      ))
      .limit(1);
    return !!row;
  }

  /** Marca telefone como opt-out. Idempotente (unique constraint provider+phone). */
  async markOptedOut(providerId: number, phoneNumber: string, reason: string): Promise<WhatsappOptout> {
    const normalized = normalizePhone(phoneNumber);

    // Tenta inserir; se já existe (unique constraint), retorna o existente atualizado.
    const existing = await db.select().from(whatsappOptouts)
      .where(and(
        eq(whatsappOptouts.providerId, providerId),
        eq(whatsappOptouts.phoneNumber, normalized),
      ))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db.update(whatsappOptouts)
        .set({ reason, isPermanent: true, optedOutAt: new Date() })
        .where(eq(whatsappOptouts.id, existing[0].id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(whatsappOptouts)
      .values({
        providerId,
        phoneNumber: normalized,
        reason,
        isPermanent: true,
      })
      .returning();
    return created;
  }
}
