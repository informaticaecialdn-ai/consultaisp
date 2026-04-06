import { eq, and, desc, sql, gte, count } from "drizzle-orm";
import { db } from "../db";
import {
  ispConsultations, spcConsultations, providers, antiFraudAlerts,
  type IspConsultation, type InsertIspConsultation,
  type SpcConsultation, type InsertSpcConsultation,
  type InsertAntiFraudAlert, type AntiFraudAlert,
  type Provider,
} from "@shared/schema";

export class ConsultationsStorage {
  async getIspConsultationsByProvider(providerId: number): Promise<IspConsultation[]> {
    return db.select().from(ispConsultations)
      .where(eq(ispConsultations.providerId, providerId))
      .orderBy(desc(ispConsultations.createdAt));
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
      .orderBy(desc(ispConsultations.createdAt));
    // De-duplicate: keep only most recent consultation per cpfCnpj
    const seen = new Set<string>();
    return rows.filter(r => {
      if (seen.has(r.cpfCnpj)) return false;
      seen.add(r.cpfCnpj);
      return true;
    });
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
}
