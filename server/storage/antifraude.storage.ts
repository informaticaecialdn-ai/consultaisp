import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import {
  antiFraudAlerts,
  type AntiFraudAlert, type InsertAntiFraudAlert,
} from "@shared/schema";

export class AntifraudeStorage {
  async getAlertsByProvider(providerId: number): Promise<AntiFraudAlert[]> {
    return db.select().from(antiFraudAlerts)
      .where(eq(antiFraudAlerts.providerId, providerId))
      .orderBy(desc(antiFraudAlerts.createdAt));
  }

  async createAlert(alert: InsertAntiFraudAlert): Promise<AntiFraudAlert> {
    const [created] = await db.insert(antiFraudAlerts).values(alert).returning();
    return created;
  }

  async updateAlertStatus(alertId: number, providerId: number, status: string): Promise<AntiFraudAlert | undefined> {
    const resolved = status === "resolved" || status === "dismissed";
    const [updated] = await db.update(antiFraudAlerts)
      .set({ status, resolved })
      .where(and(eq(antiFraudAlerts.id, alertId), eq(antiFraudAlerts.providerId, providerId)))
      .returning();
    return updated;
  }

  async getAlertsByCustomer(customerId: number): Promise<AntiFraudAlert[]> {
    return db.select().from(antiFraudAlerts)
      .where(eq(antiFraudAlerts.customerId, customerId))
      .orderBy(desc(antiFraudAlerts.createdAt));
  }
}
