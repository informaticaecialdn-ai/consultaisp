import { eq, sql, inArray, and } from "drizzle-orm";
import { db } from "../db";
import {
  providers, users, customers, contracts, invoices, equipment,
  ispConsultations, spcConsultations, antiFraudAlerts,
  supportThreads, supportMessages, planChanges, providerInvoices,
  creditOrders, providerDocuments, providerPartners,
  erpIntegrations, erpSyncLogs,
  type Provider, type InsertProvider, type ErpIntegration,
} from "@shared/schema";

/**
 * Sem nenhum campo de ERP, de proposito.
 *
 * Ate 03/09/2026 este tipo carregava `erpSource`, `erpUrl`, `erpEnabled` e um
 * `erpToken` no formato `usuario:token` — ja DECIFRADO. O objeto inteiro vai no
 * `res.json` de GET /api/admin/providers, que nao esta em SENSITIVE_ROUTES, e o
 * middleware de log grava o corpo: `sanitizeForLog` censura por NOME de chave e
 * nunca ouviu falar de "erpToken". Resultado: a credencial de ERP de todo
 * provedor com integracao ligada ficava legivel no log a cada abertura do painel
 * do superadmin. E o incidente de 27/08/2026 outra vez, sob outro nome de chave.
 *
 * A aba ERP do ProviderDrawer era o unico consumidor e saiu com a mudanca que
 * moveu a configuracao para /admin/provedor/:id. Quem precisa de ERP le
 * `erp_integrations` pelas rotas proprias — que decifram sob demanda, para um
 * unico provedor, e nao para a lista inteira.
 */
export interface ProviderWithStats extends Provider {
  userCount: number;
  adminEmailVerified: boolean;
}

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

  async debitIspCredits(id: number, cost: number): Promise<Provider | null> {
    const result = await db.execute(sql`UPDATE providers SET isp_credits = isp_credits - ${cost} WHERE id = ${id} AND isp_credits >= ${cost} RETURNING *`);
    const rows = result.rows as Provider[];
    return rows.length > 0 ? rows[0] : null;
  }

  async debitSpcCredits(id: number, cost: number): Promise<Provider | null> {
    // Sistema unificado: SPC consome de isp_credits (4 creditos por consulta)
    const result = await db.execute(sql`UPDATE providers SET isp_credits = isp_credits - ${cost} WHERE id = ${id} AND isp_credits >= ${cost} RETURNING *`);
    const rows = result.rows as Provider[];
    return rows.length > 0 ? rows[0] : null;
  }

  async getAllProvidersWithStats(): Promise<ProviderWithStats[]> {
    // Query 1: all providers
    const allProviders = await db.select().from(providers);

    // Query 2: user counts and admin email verification per provider
    const userStats = await db.execute(sql`
      SELECT
        provider_id,
        COUNT(*)::int AS user_count,
        MAX(CASE WHEN role = 'admin' THEN CASE WHEN email_verified THEN 1 ELSE 0 END END) AS admin_email_verified
      FROM users
      WHERE provider_id IS NOT NULL
      GROUP BY provider_id
    `);
    const userStatsMap = new Map<number, { userCount: number; adminEmailVerified: boolean }>();
    for (const row of userStats.rows as any[]) {
      userStatsMap.set(row.provider_id, {
        userCount: row.user_count || 0,
        adminEmailVerified: row.admin_email_verified === 1,
      });
    }

    // `erp_integrations` NAO e lida aqui: nenhum campo dela sobrevive no
    // retorno, e decifrar credencial que ninguem consome e so risco.
    return allProviders.map(p => {
      const stats = userStatsMap.get(p.id);
      return {
        ...p,
        userCount: stats?.userCount || 0,
        adminEmailVerified: stats?.adminEmailVerified || false,
      };
    });
  }

}
