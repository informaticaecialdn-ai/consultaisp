import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db";
import {
  providers, erpIntegrations, erpSyncLogs, erpCatalog,
  type ErpIntegration, type ErpSyncLog,
  type ErpCatalog, type InsertErpCatalog,
} from "@shared/schema";
import { encryptField, decryptField } from "../utils/crypto";
import { logger } from "../logger";

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

/**
 * Decifra sem deixar uma linha ruim derrubar as outras.
 *
 * A chave sai do SESSION_SECRET (ver server/utils/crypto.ts). Se ele mudar —
 * troca de servidor, restauracao de backup de outro ambiente — o AES-GCM nao
 * so devolve lixo: ele LANCA na verificacao da tag. Como a leitura era um
 * `rows.map(decryptIntegration)` cru, a primeira credencial ilegivel abortava a
 * lista inteira, e o sync de TODOS os provedores morria por causa de um.
 * Agora a linha problematica sai da lista e diz qual e, no log.
 */
function decryptIntegrationSafe(
  row: ErpIntegration,
): { ok: true; value: ErpIntegration } | { ok: false; motivo: string } {
  try {
    return { ok: true, value: decryptIntegration(row) };
  } catch (err: any) {
    return { ok: false, motivo: err?.message || "falha ao decifrar" };
  }
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

    const saida: Array<ErpIntegration & { providerName: string }> = [];
    for (const r of rows) {
      const d = decryptIntegrationSafe(r.erp_integrations);
      if (!d.ok) {
        logger.error(
          { providerId: r.erp_integrations.providerId, erpSource: r.erp_integrations.erpSource, motivo: d.motivo },
          "[ERP] credencial ilegivel — integracao ignorada. Reconfigure o token: a chave deriva do SESSION_SECRET e ele mudou desde que o token foi salvo.",
        );
        continue;
      }
      saida.push({ ...d.value, providerName: r.providers.name });
    }
    return saida;
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

  /**
   * Grava o desfecho de UMA sincronizacao: carimba a integracao e deixa a linha
   * no historico, numa transacao so.
   *
   * Existe porque ate aqui nada registrava sync nenhum — `erp_sync_logs` e os
   * contadores de `erp_integrations` estavam no schema e sem um unico chamador.
   * A tela mostrava "0 registros · Nunca" por construcao, entao um sync que
   * falhava todo dia era indistinguivel de um sync que nunca tinha sido
   * configurado. Sem isto nao ha como responder "o ERP atualizou hoje?".
   */
  async registrarResultadoSync(
    providerId: number,
    erpSource: string,
    r: {
      status: "success" | "partial" | "error";
      upserted: number;
      errors: number;
      recordsProcessed?: number;
      syncType?: "auto" | "manual";
      mensagem?: string;
      duracaoMs?: number;
    },
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE erp_integrations
           SET total_synced     = total_synced + ${r.upserted},
               total_errors     = total_errors + ${r.errors},
               last_sync_at     = NOW(),
               last_sync_status = ${r.status},
               status           = ${r.status === "error" ? "error" : "idle"}
         WHERE provider_id = ${providerId} AND erp_source = ${erpSource}
      `);
      await tx.insert(erpSyncLogs).values({
        providerId,
        erpSource,
        status: r.status,
        upserted: r.upserted,
        errors: r.errors,
        recordsProcessed: r.recordsProcessed ?? r.upserted + r.errors,
        recordsFailed: r.errors,
        syncType: r.syncType ?? "auto",
        payload: { mensagem: r.mensagem ?? null, duracaoMs: r.duracaoMs ?? null },
      } as any);
    });
  }

  /**
   * Falhas CONSECUTIVAS de uma integracao — quantas vezes seguidas, contando da
   * mais recente para tras, o sync terminou em erro. Uma falha isolada e ruido
   * de rede; trinta seguidas e uma integracao morta que ninguem viu, porque
   * cada log e igual ao anterior e some no meio dos outros.
   */
  async contarFalhasConsecutivas(providerId: number, erpSource: string): Promise<number> {
    const linhas = await db.select({ status: erpSyncLogs.status })
      .from(erpSyncLogs)
      .where(and(eq(erpSyncLogs.providerId, providerId), eq(erpSyncLogs.erpSource, erpSource)))
      .orderBy(desc(erpSyncLogs.syncedAt))
      .limit(100);
    let n = 0;
    for (const l of linhas) {
      if (l.status !== "error") break;
      n++;
    }
    return n;
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
