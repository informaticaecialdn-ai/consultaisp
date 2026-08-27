import { eq, and, ne, desc } from "drizzle-orm";
import { db } from "../db";
import {
  antiFraudAlerts, customers,
  type AntiFraudAlert, type InsertAntiFraudAlert,
} from "@shared/schema";

export type AlertWithOwnership = AntiFraudAlert & { customerProviderId: number | null; customerStatus: string };

export class AntifraudeStorage {
  /**
   * Alertas em que ESTE provedor e o DONO do cliente — ou seja, o cliente dele
   * esta sendo procurado por outro provedor.
   *
   * Antes havia tambem `OR consultingProviderId = providerId`, que devolvia os
   * alertas que o proprio provedor GEROU ao consultar clientes alheios. Como a
   * mascara revela o nome do consulente quando ele e voce mesmo, a tela exibia
   * "Consultado por <seu proprio nome>" — um alerta de fuga apontando para o
   * dono. Fuga so existe do ponto de vista de quem tem o cliente a perder.
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
      .where(and(
        eq(antiFraudAlerts.providerId, providerId),
        // Blindagem: um registro legado onde dono e consulente coincidem nao
        // descreve fuga nenhuma e nao pode voltar para a tela.
        ne(antiFraudAlerts.consultingProviderId, providerId),
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
