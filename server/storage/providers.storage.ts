import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  providers, users, customers, contracts, invoices, equipment,
  ispConsultations, spcConsultations, antiFraudAlerts,
  supportThreads, supportMessages, planChanges, providerInvoices,
  creditOrders, providerDocuments, providerPartners,
  erpIntegrations, erpSyncLogs,
  type Provider, type InsertProvider,
} from "@shared/schema";

export class ProvidersStorage {
  async getProvider(id: number): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.id, id));
    return provider;
  }

  async getProviderByCnpj(cnpj: string): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.cnpj, cnpj));
    return provider;
  }

  async getProviderBySubdomain(subdomain: string): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.subdomain, subdomain));
    return provider;
  }

  async createProvider(provider: InsertProvider): Promise<Provider> {
    const [created] = await db.insert(providers).values(provider).returning();
    return created;
  }

  async updateProvider(id: number, data: Partial<Pick<Provider, "name" | "contactEmail" | "contactPhone" | "website">>): Promise<Provider> {
    const [updated] = await db.update(providers).set(data).where(eq(providers.id, id)).returning();
    return updated;
  }

  async getAllProviders(): Promise<Provider[]> {
    return db.select().from(providers);
  }

  async getAllProvidersWithN8n(): Promise<Array<{ id: number; name: string; n8nWebhookUrl: string; n8nAuthToken: string | null; n8nEnabled: boolean; n8nErpProvider: string | null }>> {
    const rows = await db
      .select({
        id: providers.id,
        name: providers.name,
        n8nWebhookUrl: providers.n8nWebhookUrl,
        n8nAuthToken: providers.n8nAuthToken,
        n8nEnabled: providers.n8nEnabled,
        n8nErpProvider: providers.n8nErpProvider,
      })
      .from(providers)
      .where(
        and(
          eq(providers.n8nEnabled, true),
          sql`${providers.n8nWebhookUrl} IS NOT NULL AND ${providers.n8nWebhookUrl} != ''`,
        )
      );
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      n8nWebhookUrl: r.n8nWebhookUrl as string,
      n8nAuthToken: r.n8nAuthToken ?? null,
      n8nEnabled: r.n8nEnabled ?? false,
      n8nErpProvider: r.n8nErpProvider ?? null,
    }));
  }

  async updateProviderCredits(id: number, ispCredits: number, spcCredits: number): Promise<void> {
    await db.update(providers).set({ ispCredits, spcCredits }).where(eq(providers.id, id));
  }

  async deleteProvider(id: number): Promise<void> {
    const threads = await db.select({ id: supportThreads.id }).from(supportThreads).where(eq(supportThreads.providerId, id));
    if (threads.length > 0) {
      const threadIds = threads.map(t => t.id);
      await db.delete(supportMessages).where(inArray(supportMessages.threadId, threadIds));
    }
    await db.delete(supportThreads).where(eq(supportThreads.providerId, id));
    await db.delete(invoices).where(eq(invoices.providerId, id));
    await db.delete(contracts).where(eq(contracts.providerId, id));
    await db.delete(antiFraudAlerts).where(eq(antiFraudAlerts.providerId, id));
    await db.delete(equipment).where(eq(equipment.providerId, id));
    await db.delete(customers).where(eq(customers.providerId, id));
    await db.delete(ispConsultations).where(eq(ispConsultations.providerId, id));
    await db.delete(spcConsultations).where(eq(spcConsultations.providerId, id));
    await db.delete(erpSyncLogs).where(eq(erpSyncLogs.providerId, id));
    await db.delete(erpIntegrations).where(eq(erpIntegrations.providerId, id));
    await db.delete(planChanges).where(eq(planChanges.providerId, id));
    await db.delete(providerInvoices).where(eq(providerInvoices.providerId, id));
    await db.delete(creditOrders).where(eq(creditOrders.providerId, id));
    await db.delete(providerDocuments).where(eq(providerDocuments.providerId, id));
    await db.delete(providerPartners).where(eq(providerPartners.providerId, id));
    await db.delete(users).where(eq(users.providerId, id));
    await db.delete(providers).where(eq(providers.id, id));
  }

  async updateProviderProfile(id: number, data: Partial<Provider>): Promise<Provider> {
    const [updated] = await db.update(providers).set(data as any).where(eq(providers.id, id)).returning();
    return updated;
  }

  async getProviderWebhookToken(providerId: number): Promise<string> {
    const [provider] = await db.select({ webhookToken: providers.webhookToken }).from(providers).where(eq(providers.id, providerId));
    if (provider?.webhookToken) return provider.webhookToken;
    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    await db.update(providers).set({ webhookToken: token } as any).where(eq(providers.id, providerId));
    return token;
  }

  async regenerateWebhookToken(providerId: number): Promise<string> {
    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    await db.update(providers).set({ webhookToken: token } as any).where(eq(providers.id, providerId));
    return token;
  }

  async getProviderByWebhookToken(token: string): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(sql`${providers.webhookToken} = ${token}`);
    return provider;
  }

  async getN8nConfig(providerId: number): Promise<{ n8nWebhookUrl: string | null; n8nAuthToken: string | null; n8nEnabled: boolean; n8nErpProvider: string | null }> {
    const [row] = await db.select({
      n8nWebhookUrl: providers.n8nWebhookUrl,
      n8nAuthToken: providers.n8nAuthToken,
      n8nEnabled: providers.n8nEnabled,
      n8nErpProvider: providers.n8nErpProvider,
    }).from(providers).where(eq(providers.id, providerId));
    return {
      n8nWebhookUrl: row?.n8nWebhookUrl ?? null,
      n8nAuthToken: row?.n8nAuthToken ?? null,
      n8nEnabled: row?.n8nEnabled ?? false,
      n8nErpProvider: row?.n8nErpProvider ?? null,
    };
  }

  async saveN8nConfig(providerId: number, data: { n8nWebhookUrl?: string; n8nAuthToken?: string; n8nEnabled?: boolean; n8nErpProvider?: string | null }): Promise<void> {
    await db.update(providers).set(data as any).where(eq(providers.id, providerId));
  }

}
