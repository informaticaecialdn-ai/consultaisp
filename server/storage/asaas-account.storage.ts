import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  asaasAccounts,
  type AsaasAccount,
} from "@shared/schema";
import { encrypt, decrypt } from "../lib/crypto/encryption";

/**
 * Spec 004 — Credenciais Asaas por tenant (1:1 com provider).
 * apiKey + webhookToken são criptografados via AES-256-GCM antes de persistir
 * (Princípio V - LGPD), reutilizando ENCRYPTION_MASTER_KEY da Spec 003.
 */
export class AsaasAccountStorage {
  async byProviderId(providerId: number): Promise<AsaasAccount | undefined> {
    const [row] = await db.select().from(asaasAccounts)
      .where(eq(asaasAccounts.providerId, providerId))
      .limit(1);
    return row;
  }

  /**
   * Decifra a apiKey do provider. Retorna null se conta não existe ou está revogada.
   */
  async getApiKey(providerId: number): Promise<string | null> {
    const account = await this.byProviderId(providerId);
    if (!account || account.accountStatus === "revoked") return null;
    return decrypt(account.apiKeyEncrypted);
  }

  async getWebhookToken(providerId: number): Promise<string | null> {
    const account = await this.byProviderId(providerId);
    if (!account || !account.webhookTokenEncrypted) return null;
    return decrypt(account.webhookTokenEncrypted);
  }

  /**
   * Upsert da conta Asaas. Cifra apiKey + webhookToken antes de gravar.
   */
  async upsert(providerId: number, data: {
    apiKey: string;
    webhookToken?: string;
    mode: "sandbox" | "production";
    accountStatus?: "pending" | "verified" | "revoked";
  }): Promise<AsaasAccount> {
    const apiKeyEncrypted = encrypt(data.apiKey);
    const webhookTokenEncrypted = data.webhookToken ? encrypt(data.webhookToken) : null;
    const now = new Date();

    const existing = await this.byProviderId(providerId);

    if (existing) {
      const [updated] = await db.update(asaasAccounts)
        .set({
          apiKeyEncrypted,
          webhookTokenEncrypted: webhookTokenEncrypted ?? existing.webhookTokenEncrypted,
          mode: data.mode,
          accountStatus: data.accountStatus ?? "verified",
          updatedAt: now,
        })
        .where(eq(asaasAccounts.providerId, providerId))
        .returning();
      return updated;
    }

    const [created] = await db.insert(asaasAccounts)
      .values({
        providerId,
        apiKeyEncrypted,
        webhookTokenEncrypted,
        mode: data.mode,
        accountStatus: data.accountStatus ?? "verified",
      })
      .returning();
    return created;
  }

  async markRevoked(providerId: number): Promise<void> {
    await db.update(asaasAccounts)
      .set({ accountStatus: "revoked", updatedAt: new Date() })
      .where(eq(asaasAccounts.providerId, providerId));
  }

  async touchLastUsed(providerId: number): Promise<void> {
    await db.update(asaasAccounts)
      .set({ lastUsedAt: new Date() })
      .where(eq(asaasAccounts.providerId, providerId));
  }
}
