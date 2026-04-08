import { eq, and, or, desc, sql } from "drizzle-orm";
import { db } from "../db";
import {
  antiFraudAlerts, customers,
  type AntiFraudAlert, type InsertAntiFraudAlert,
} from "@shared/schema";

export type AlertWithOwnership = AntiFraudAlert & { customerProviderId: number | null; customerStatus: string };

export class AntifraudeStorage {
  /**
   * Returns alerts where the provider owns the customer OR was the consulting provider.
   * Joins with customers table to derive authoritative customerProviderId (ground truth
   * for who owns the customer), falling back to alert.providerId when customerId is null.
   */
  async getAlertsByProvider(providerId: number): Promise<AlertWithOwnership[]> {
    const rows = await db
      .select({
        alert: antiFraudAlerts,
        customerProviderId: customers.providerId,
        customerStatus: customers.status,
      })
      .from(antiFraudAlerts)
      .leftJoin(customers, eq(antiFraudAlerts.customerId, customers.id))
      .where(or(
        eq(antiFraudAlerts.providerId, providerId),
        eq(antiFraudAlerts.consultingProviderId, providerId),
      ))
      .orderBy(desc(antiFraudAlerts.createdAt));

    return rows.map(row => ({
      ...row.alert,
      customerProviderId: row.customerProviderId ?? row.alert.providerId,
      customerStatus: row.customerStatus ?? "unknown",
    }));
  }

  async createAlert(alert: InsertAntiFraudAlert): Promise<AntiFraudAlert> {
    const [created] = await db.insert(antiFraudAlerts).values(alert).returning();
    return created;
  }

  async updateAlertStatus(alertId: number, providerId: number, status: string): Promise<AlertWithOwnership | undefined> {
    const resolved = status === "resolved" || status === "dismissed";
    const [updated] = await db.update(antiFraudAlerts)
      .set({ status, resolved })
      .where(and(eq(antiFraudAlerts.id, alertId), eq(antiFraudAlerts.providerId, providerId)))
      .returning();
    if (!updated) return undefined;

    // Resolve authoritative customerProviderId via customers table
    if (updated.customerId) {
      const [customer] = await db.select({ providerId: customers.providerId, status: customers.status })
        .from(customers)
        .where(eq(customers.id, updated.customerId))
        .limit(1);
      return { ...updated, customerProviderId: customer?.providerId ?? updated.providerId, customerStatus: customer?.status ?? "unknown" };
    }
    return { ...updated, customerProviderId: updated.providerId, customerStatus: "unknown" };
  }

  async getAlertsByCustomer(customerId: number): Promise<AntiFraudAlert[]> {
    return db.select().from(antiFraudAlerts)
      .where(eq(antiFraudAlerts.customerId, customerId))
      .orderBy(desc(antiFraudAlerts.createdAt));
  }
}
