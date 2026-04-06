import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db";
import {
  providers, erpIntegrations, erpSyncLogs, erpCatalog,
  type ErpIntegration, type ErpSyncLog,
  type ErpCatalog, type InsertErpCatalog,
} from "@shared/schema";
import { encryptField, decryptField } from "../utils/crypto";

const SENSITIVE_FIELDS = ["apiToken", "apiUser", "clientSecret", "mkContraSenha"] as const;

function encryptSensitiveFields(data: Partial<ErpIntegration>): Partial<ErpIntegration> {
  const result = { ...data };
  for (const field of SENSITIVE_FIELDS) {
    if (field in result && typeof (result as any)[field] === "string") {
      (result as any)[field] = encryptField((result as any)[field]);
    }
  }
  return result;
}

function decryptIntegration(row: ErpIntegration): ErpIntegration {
  const result = { ...row };
  for (const field of SENSITIVE_FIELDS) {
    if (typeof (result as any)[field] === "string") {
      (result as any)[field] = decryptField((result as any)[field]);
    }
  }
  return result;
}

export class ErpStorage {
  async getErpIntegrations(providerId: number): Promise<ErpIntegration[]> {
    const rows = await db.select().from(erpIntegrations)
      .where(eq(erpIntegrations.providerId, providerId))
      .orderBy(erpIntegrations.erpSource);
    return rows.map(decryptIntegration);
  }

  async getAllEnabledErpIntegrationsWithCredentials(): Promise<Array<ErpIntegration & { providerName: string }>> {
    const rows = await db
      .select()
      .from(erpIntegrations)
      .innerJoin(providers, eq(erpIntegrations.providerId, providers.id))
      .where(
        and(
          eq(erpIntegrations.isEnabled, true),
          sql`${erpIntegrations.apiUrl} IS NOT NULL AND ${erpIntegrations.apiUrl} != ''`,
          sql`${erpIntegrations.apiToken} IS NOT NULL AND ${erpIntegrations.apiToken} != ''`,
        )
      )
      .orderBy(erpIntegrations.providerId, erpIntegrations.erpSource);
    return rows.map(r => ({ ...decryptIntegration(r.erp_integrations), providerName: r.providers.name }));
  }

  async upsertErpIntegration(providerId: number, erpSource: string, data: Partial<ErpIntegration>): Promise<ErpIntegration> {
    const encrypted = encryptSensitiveFields(data);
    const existing = await db.select().from(erpIntegrations)
      .where(and(eq(erpIntegrations.providerId, providerId), eq(erpIntegrations.erpSource, erpSource)))
      .limit(1);
    if (existing.length > 0) {
      const [updated] = await db.update(erpIntegrations)
        .set(encrypted as any)
        .where(and(eq(erpIntegrations.providerId, providerId), eq(erpIntegrations.erpSource, erpSource)))
        .returning();
      return decryptIntegration(updated);
    }
    const [created] = await db.insert(erpIntegrations)
      .values({ providerId, erpSource, ...encrypted } as any)
      .returning();
    return decryptIntegration(created);
  }

  async incrementErpIntegrationCounters(providerId: number, erpSource: string, upserted: number, errors: number): Promise<void> {
    await db.execute(sql`
      UPDATE erp_integrations
      SET total_synced = total_synced + ${upserted},
          total_errors = total_errors + ${errors}
      WHERE provider_id = ${providerId} AND erp_source = ${erpSource}
    `);
  }

  async getErpSyncLogs(providerId: number, erpSource?: string, limit = 50): Promise<ErpSyncLog[]> {
    const conditions = [eq(erpSyncLogs.providerId, providerId)];
    if (erpSource) conditions.push(eq(erpSyncLogs.erpSource, erpSource));
    return db.select().from(erpSyncLogs)
      .where(and(...conditions))
      .orderBy(desc(erpSyncLogs.syncedAt))
      .limit(limit);
  }

  async createErpSyncLog(log: Omit<ErpSyncLog, "id" | "syncedAt">): Promise<ErpSyncLog> {
    const [created] = await db.insert(erpSyncLogs).values(log as any).returning();
    return created;
  }

  async getErpIntegrationStats(providerId?: number): Promise<any> {
    const conditions = providerId ? [eq(erpIntegrations.providerId, providerId)] : [];
    const integrations = await db.select().from(erpIntegrations)
      .where(conditions.length ? and(...conditions) : undefined);
    const totalEnabled = integrations.filter(i => i.isEnabled).length;
    const totalSynced = integrations.reduce((s, i) => s + (i.totalSynced ?? 0), 0);
    const totalErrors = integrations.reduce((s, i) => s + (i.totalErrors ?? 0), 0);
    const lastSync = integrations.reduce((latest, i) => {
      if (!i.lastSyncAt) return latest;
      if (!latest) return i.lastSyncAt;
      return i.lastSyncAt > latest ? i.lastSyncAt : latest;
    }, null as Date | null);
    return { totalEnabled, totalSynced, totalErrors, lastSync, integrations };
  }

  async getAllErpCatalog(): Promise<ErpCatalog[]> {
    return db.select().from(erpCatalog).orderBy(erpCatalog.name);
  }

  async getErpCatalogItem(id: number): Promise<ErpCatalog | undefined> {
    const [item] = await db.select().from(erpCatalog).where(eq(erpCatalog.id, id));
    return item;
  }

  async createErpCatalogItem(data: InsertErpCatalog): Promise<ErpCatalog> {
    const [item] = await db.insert(erpCatalog).values(data).returning();
    return item;
  }

  async updateErpCatalogItem(id: number, data: Partial<InsertErpCatalog>): Promise<ErpCatalog> {
    const [item] = await db.update(erpCatalog).set(data).where(eq(erpCatalog.id, id)).returning();
    return item;
  }

  async deleteErpCatalogItem(id: number): Promise<void> {
    await db.delete(erpCatalog).where(eq(erpCatalog.id, id));
  }
}
