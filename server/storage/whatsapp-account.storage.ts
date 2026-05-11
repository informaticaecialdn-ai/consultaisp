import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  whatsappAccounts,
  type WhatsappAccount,
} from "@shared/schema";
import { encrypt } from "../lib/crypto/encryption";

/**
 * Spec 003 — Meta WhatsApp Cloud API por tenant (1:1 com provider).
 * accessToken é criptografado via AES-256-GCM antes de persistir (Princípio V - LGPD).
 */

export interface OAuthData {
  wabaId: string;
  phoneNumberId: string;
  displayName?: string;
  accessToken: string; // plaintext — será criptografado aqui
  tokenExpiresAt?: Date;
}

export class WhatsappAccountStorage {
  /** Busca conta por phoneNumberId (usado nos webhooks da Meta pra rotear pro tenant correto). */
  async findByPhoneNumberId(phoneNumberId: string): Promise<WhatsappAccount | undefined> {
    const [row] = await db.select().from(whatsappAccounts)
      .where(eq(whatsappAccounts.phoneNumberId, phoneNumberId))
      .limit(1);
    return row;
  }

  /** Busca conta pelo providerId (1:1 — unique no schema). */
  async findByProviderId(providerId: number): Promise<WhatsappAccount | undefined> {
    const [row] = await db.select().from(whatsappAccounts)
      .where(eq(whatsappAccounts.providerId, providerId))
      .limit(1);
    return row;
  }

  /**
   * Upsert a partir do callback OAuth da Meta (Embedded Signup).
   * Criptografa o accessToken antes de gravar.
   */
  async upsertFromOAuth(providerId: number, data: OAuthData): Promise<WhatsappAccount> {
    const accessTokenEncrypted = encrypt(data.accessToken);
    const now = new Date();

    const existing = await this.findByProviderId(providerId);

    if (existing) {
      const [updated] = await db.update(whatsappAccounts)
        .set({
          wabaId: data.wabaId,
          phoneNumberId: data.phoneNumberId,
          displayName: data.displayName ?? existing.displayName,
          accessTokenEncrypted,
          tokenExpiresAt: data.tokenExpiresAt ?? null,
          updatedAt: now,
        })
        .where(eq(whatsappAccounts.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(whatsappAccounts)
      .values({
        providerId,
        wabaId: data.wabaId,
        phoneNumberId: data.phoneNumberId,
        displayName: data.displayName ?? null,
        accessTokenEncrypted,
        tokenExpiresAt: data.tokenExpiresAt ?? null,
      })
      .returning();
    return created;
  }
}
