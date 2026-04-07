import { eq, and, desc, sql, gte, count, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  ispConsultations, spcConsultations, providers, antiFraudAlerts, proactiveAlerts,
  type IspConsultation, type InsertIspConsultation,
  type SpcConsultation, type InsertSpcConsultation,
  type InsertAntiFraudAlert, type AntiFraudAlert,
  type Provider,
  type ProactiveAlert, type InsertProactiveAlert,
} from "@shared/schema";

export class ConsultationsStorage {
  async getIspConsultationsByProvider(providerId: number): Promise<IspConsultation[]> {
    return db.select().from(ispConsultations)
      .where(eq(ispConsultations.providerId, providerId))
      .orderBy(desc(ispConsultations.createdAt));
  }

  async getIspConsultationsByProviderPaginated(
    providerId: number,
    page: number,
    limit: number,
  ): Promise<{ rows: IspConsultation[]; total: number }> {
    const offset = (page - 1) * limit;
    const [rows, totalResult] = await Promise.all([
      db.select().from(ispConsultations)
        .where(eq(ispConsultations.providerId, providerId))
        .orderBy(desc(ispConsultations.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(ispConsultations)
        .where(eq(ispConsultations.providerId, providerId)),
    ]);
    return { rows, total: totalResult[0]?.count || 0 };
  }

  async createIspConsultation(consultation: InsertIspConsultation): Promise<IspConsultation> {
    const [created] = await db.insert(ispConsultations).values(consultation).returning();
    return created;
  }

  async getIspConsultationCountToday(providerId: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = await db.select({ count: count() }).from(ispConsultations)
      .where(and(eq(ispConsultations.providerId, providerId), gte(ispConsultations.createdAt, today)));
    return result[0]?.count || 0;
  }

  async getIspConsultationCountMonth(providerId: number): Promise<number> {
    const firstDay = new Date();
    firstDay.setDate(1);
    firstDay.setHours(0, 0, 0, 0);
    const result = await db.select({ count: count() }).from(ispConsultations)
      .where(and(eq(ispConsultations.providerId, providerId), gte(ispConsultations.createdAt, firstDay)));
    return result[0]?.count || 0;
  }

  async getRecentConsultationsForDocument(cpfCnpj: string, days: number): Promise<IspConsultation[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return db.select().from(ispConsultations)
      .where(and(eq(ispConsultations.cpfCnpj, cpfCnpj), gte(ispConsultations.createdAt, since)));
  }

  async getConsultationsByCepPrefix(cepPrefix: string, limitDays = 90): Promise<IspConsultation[]> {
    // cepPrefix = "86671-" (first 5 digits + dash)
    // Searches stored consultation results where any providerDetail has a cep starting with this prefix.
    // Uses PostgreSQL text search on the JSON column (works for both full and masked CEPs).
    const since = new Date();
    since.setDate(since.getDate() - limitDays);
    const pattern = `%"cep":"${cepPrefix}%`;
    const rows = await db.select().from(ispConsultations)
      .where(and(
        sql`${ispConsultations.result}::text LIKE ${pattern}`,
        gte(ispConsultations.createdAt, since),
        // Exclude past CEP searches to avoid recursion
        sql`${ispConsultations.searchType} != 'cep'`,
      ))
      .orderBy(desc(ispConsultations.createdAt))
      .limit(200);
    // De-duplicate: keep only most recent consultation per cpfCnpj
    const seen = new Set<string>();
    return rows.filter(r => {
      if (seen.has(r.cpfCnpj)) return false;
      seen.add(r.cpfCnpj);
      return true;
    });
  }

  async getConsultationTimeline(
    cpfCnpj: string,
    providerIds: number[],
    limit: number = 50,
  ): Promise<IspConsultation[]> {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    return db.select().from(ispConsultations)
      .where(and(
        eq(ispConsultations.cpfCnpj, cpfCnpj),
        inArray(ispConsultations.providerId, providerIds),
        gte(ispConsultations.createdAt, twelveMonthsAgo),
      ))
      .orderBy(desc(ispConsultations.createdAt))
      .limit(limit);
  }

  async getRegionalScoreStats(providerIds: number[], days: number): Promise<{ avgScore: number; totalConsultations: number; belowThresholdCount: number }> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const result = await db.select({
      avg: sql<number>`avg(score)`,
      count: sql<number>`count(*)`,
      belowThreshold: sql<number>`count(*) filter (where score < 150)`,
    }).from(ispConsultations)
      .where(and(inArray(ispConsultations.providerId, providerIds), gte(ispConsultations.createdAt, since)));
    const row = result[0];
    return {
      avgScore: Number(row?.avg) || 0,
      totalConsultations: Number(row?.count) || 0,
      belowThresholdCount: Number(row?.belowThreshold) || 0,
    };
  }

  async getRegionalAlertCount(providerIds: number[], days: number): Promise<number> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const result = await db.select({ count: count() }).from(antiFraudAlerts)
      .where(and(inArray(antiFraudAlerts.providerId, providerIds), gte(antiFraudAlerts.createdAt, since)));
    return result[0]?.count || 0;
  }

  async getTopRiskCeps(providerIds: number[], days: number, limit: number = 5): Promise<Array<{ cep: string; avgScore: number; count: number }>> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const rows = await db.select().from(ispConsultations)
      .where(and(inArray(ispConsultations.providerId, providerIds), gte(ispConsultations.createdAt, since)))
      .orderBy(desc(ispConsultations.createdAt))
      .limit(2000);

    const cepMap = new Map<string, { totalScore: number; count: number }>();
    for (const row of rows) {
      const result = row.result as any;
      const details = result?.providerDetails;
      if (!Array.isArray(details)) continue;
      for (const d of details) {
        const cep = d?.cep;
        if (!cep || typeof cep !== "string" || cep.length < 5) continue;
        const prefix = cep.replace(/\D/g, "").slice(0, 5);
        if (prefix.length < 5) continue;
        const entry = cepMap.get(prefix) || { totalScore: 0, count: 0 };
        entry.totalScore += row.score || 0;
        entry.count += 1;
        cepMap.set(prefix, entry);
      }
    }

    return [...cepMap.entries()]
      .map(([cep, { totalScore, count }]) => ({ cep, avgScore: totalScore / count, count }))
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, limit);
  }

  async getSpcConsultationsByProvider(providerId: number): Promise<SpcConsultation[]> {
    return db.select().from(spcConsultations)
      .where(eq(spcConsultations.providerId, providerId))
      .orderBy(desc(spcConsultations.createdAt));
  }

  async createSpcConsultation(consultation: InsertSpcConsultation): Promise<SpcConsultation> {
    const [created] = await db.insert(spcConsultations).values(consultation).returning();
    return created;
  }

  async getSpcConsultationCountToday(providerId: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = await db.select({ count: count() }).from(spcConsultations)
      .where(and(eq(spcConsultations.providerId, providerId), gte(spcConsultations.createdAt, today)));
    return result[0]?.count || 0;
  }

  async getSpcConsultationCountMonth(providerId: number): Promise<number> {
    const firstDay = new Date();
    firstDay.setDate(1);
    firstDay.setHours(0, 0, 0, 0);
    const result = await db.select({ count: count() }).from(spcConsultations)
      .where(and(eq(spcConsultations.providerId, providerId), gte(spcConsultations.createdAt, firstDay)));
    return result[0]?.count || 0;
  }

  async debitAndCreateSpcConsultation(
    providerId: number,
    cost: number,
    consultation: InsertSpcConsultation,
  ): Promise<{ provider: Provider; consultation: SpcConsultation } | null> {
    return db.transaction(async (tx) => {
      const debitResult = await tx.execute(
        sql`UPDATE providers SET spc_credits = spc_credits - ${cost} WHERE id = ${providerId} AND spc_credits >= ${cost} RETURNING *`,
      );
      const rows = debitResult.rows as Provider[];
      if (rows.length === 0) return null;

      const [created] = await tx.insert(spcConsultations).values(consultation).returning();
      return { provider: rows[0], consultation: created };
    });
  }

  async debitAndCreateIspConsultation(
    providerId: number,
    cost: number,
    consultation: InsertIspConsultation,
    alertRecord?: InsertAntiFraudAlert,
  ): Promise<{ provider: Provider; consultation: IspConsultation; alert?: AntiFraudAlert } | null> {
    return db.transaction(async (tx) => {
      const debitResult = await tx.execute(
        sql`UPDATE providers SET isp_credits = isp_credits - ${cost} WHERE id = ${providerId} AND isp_credits >= ${cost} RETURNING *`,
      );
      const rows = debitResult.rows as Provider[];
      if (rows.length === 0) return null;

      const [created] = await tx.insert(ispConsultations).values(consultation).returning();

      let alert: AntiFraudAlert | undefined;
      if (alertRecord) {
        const [createdAlert] = await tx.insert(antiFraudAlerts).values(alertRecord).returning();
        alert = createdAlert;
      }

      return { provider: rows[0], consultation: created, alert };
    });
  }

  async getLastProactiveAlert(cpfCnpj: string, providerId: number): Promise<{ sentAt: Date } | undefined> {
    const since = new Date();
    since.setDate(since.getDate() - 1); // 24h throttle
    const [row] = await db.select({ sentAt: proactiveAlerts.sentAt })
      .from(proactiveAlerts)
      .where(and(
        eq(proactiveAlerts.cpfCnpj, cpfCnpj),
        eq(proactiveAlerts.providerId, providerId),
        gte(proactiveAlerts.sentAt, since),
      ))
      .orderBy(desc(proactiveAlerts.sentAt))
      .limit(1);
    return row ? { sentAt: row.sentAt! } : undefined;
  }

  async createProactiveAlert(data: InsertProactiveAlert): Promise<ProactiveAlert> {
    const [created] = await db.insert(proactiveAlerts).values(data).returning();
    return created;
  }

  async getProactiveAlertsByProvider(providerId: number, limit: number = 50): Promise<ProactiveAlert[]> {
    return db.select().from(proactiveAlerts)
      .where(eq(proactiveAlerts.providerId, providerId))
      .orderBy(desc(proactiveAlerts.sentAt))
      .limit(limit);
  }

  async acknowledgeProactiveAlert(alertId: number, providerId: number): Promise<ProactiveAlert | undefined> {
    const [updated] = await db.update(proactiveAlerts)
      .set({ acknowledged: true, acknowledgedAt: new Date() })
      .where(and(eq(proactiveAlerts.id, alertId), eq(proactiveAlerts.providerId, providerId)))
      .returning();
    return updated;
  }
}
