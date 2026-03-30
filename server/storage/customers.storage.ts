import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import {
  customers,
  type Customer, type InsertCustomer,
} from "@shared/schema";

export class CustomersStorage {
  async getCustomersByProvider(providerId: number): Promise<Customer[]> {
    return db.select().from(customers).where(eq(customers.providerId, providerId));
  }

  async getCustomerByCpfCnpj(cpfCnpj: string): Promise<Customer[]> {
    return db.select().from(customers).where(eq(customers.cpfCnpj, cpfCnpj));
  }

  async getCustomersByExactAddress(address: string, city: string, state: string | null, cep: string | null, excludeCpfCnpj: string): Promise<Customer[]> {
    if (!address || !city) return [];
    const n = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const normalAddr = n(address);
    const normalCity = n(city);
    const normalState = state ? n(state) : null;
    const normalCep = cep ? cep.replace(/\D/g, "") : null;
    const all = await db.select().from(customers);
    return all.filter(c => {
      if (!c.address || !c.city) return false;
      if (n(c.address) !== normalAddr) return false;
      if (n(c.city) !== normalCity) return false;
      if (normalState && c.state && n(c.state) !== normalState) return false;
      if (normalCep && c.cep) {
        if (c.cep.replace(/\D/g, "") !== normalCep) return false;
      }
      if (c.cpfCnpj.replace(/\D/g, "") === excludeCpfCnpj) return false;
      return true;
    });
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    const [created] = await db.insert(customers).values(customer).returning();
    return created;
  }

  async syncErpCustomers(providerId: number, erpSource: string, customersData: any[]): Promise<{ upserted: number; errors: number }> {
    let upserted = 0;
    let errors = 0;
    const now = new Date();

    const computeRisk = (days: number): string => {
      if (days >= 90) return "critical";
      if (days >= 60) return "high";
      if (days >= 30) return "medium";
      return "low";
    };
    const computeStatus = (days: number): string => {
      if (days >= 90) return "90+";
      if (days >= 60) return "60-90";
      if (days >= 30) return "30-60";
      if (days > 0) return "1-30";
      return "current";
    };

    for (const c of customersData) {
      try {
        if (!c.cpfCnpj || !c.name) { errors++; continue; }
        const cpf = c.cpfCnpj.replace(/\D/g, "");
        const days = Number(c.maxDaysOverdue ?? 0);
        const amount = String(c.totalOverdueAmount ?? "0");
        const invoicesCount = Number(c.overdueInvoicesCount ?? 0);

        const existing = await db.select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.providerId, providerId), sql`${customers.cpfCnpj} = ${cpf}`))
          .limit(1);

        const payload: any = {
          name: c.name,
          cpfCnpj: cpf,
          email: c.email ?? null,
          phone: c.phone?.replace(/\D/g, "") ?? null,
          city: c.city ?? null,
          state: c.state ?? null,
          address: c.address ?? null,
          cep: c.cep?.replace(/\D/g, "") ?? null,
          totalOverdueAmount: amount,
          maxDaysOverdue: days,
          overdueInvoicesCount: invoicesCount,
          riskTier: computeRisk(days),
          paymentStatus: computeStatus(days),
          erpSource,
          lastSyncAt: now,
        };

        if (existing.length > 0) {
          await db.update(customers).set(payload).where(eq(customers.id, existing[0].id));
        } else {
          await db.insert(customers).values({ ...payload, providerId, status: "active" });
        }
        upserted++;
      } catch {
        errors++;
      }
    }
    return { upserted, errors };
  }
}
