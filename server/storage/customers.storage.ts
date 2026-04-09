import { eq, and, gte, sql, ne } from "drizzle-orm";
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

  async getCustomersByAddressHash(addressHash: string, excludeCpfCnpj?: string): Promise<Customer[]> {
    const results = await db.select().from(customers)
      .where(eq(customers.addressHash, addressHash));
    if (excludeCpfCnpj) {
      const cleanExclude = excludeCpfCnpj.replace(/\D/g, "");
      return results.filter(c => c.cpfCnpj.replace(/\D/g, "") !== cleanExclude);
    }
    return results;
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

  /** Upsert cliente do ERP — atualiza se cpfCnpj+providerId ja existe, senao insere */
  async upsertFromErp(data: {
    providerId: number;
    cpfCnpj: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    cep?: string;
    latitude?: string;
    longitude?: string;
    totalOverdueAmount: number;
    maxDaysOverdue: number;
    overdueInvoicesCount: number;
    erpSource: string;
  }): Promise<void> {
    const existing = await db.select().from(customers)
      .where(and(
        eq(customers.cpfCnpj, data.cpfCnpj),
        eq(customers.providerId, data.providerId),
      ))
      .limit(1);

    const now = new Date();
    const riskTier = data.maxDaysOverdue > 180 ? "critical" : data.maxDaysOverdue > 90 ? "high" : data.maxDaysOverdue > 60 ? "medium" : "low";

    if (existing.length > 0) {
      await db.update(customers)
        .set({
          name: data.name,
          email: data.email || null,
          phone: data.phone || null,
          address: data.address || null,
          city: data.city || null,
          state: data.state || null,
          cep: data.cep || null,
          latitude: data.latitude || null,
          longitude: data.longitude || null,
          totalOverdueAmount: String(data.totalOverdueAmount),
          maxDaysOverdue: data.maxDaysOverdue,
          overdueInvoicesCount: data.overdueInvoicesCount,
          paymentStatus: data.totalOverdueAmount > 0 ? "overdue" : "current",
          riskTier,
          erpSource: data.erpSource,
          lastSyncAt: now,
        })
        .where(eq(customers.id, existing[0].id));
    } else {
      await db.insert(customers).values({
        providerId: data.providerId,
        cpfCnpj: data.cpfCnpj,
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        city: data.city || null,
        state: data.state || null,
        cep: data.cep || null,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        totalOverdueAmount: String(data.totalOverdueAmount),
        maxDaysOverdue: data.maxDaysOverdue,
        overdueInvoicesCount: data.overdueInvoicesCount,
        status: "active",
        paymentStatus: data.totalOverdueAmount > 0 ? "overdue" : "current",
        riskTier,
        erpSource: data.erpSource,
        lastSyncAt: now,
      });
    }
  }

  /** Buscar inadimplentes do banco local para mapa de calor — max 365 dias */
  async getHeatmapByProvider(providerId: number): Promise<{
    lat: number; lng: number; city: string; totalOverdueAmount: number;
    maxDaysOverdue: number; overdueCount: number;
  }[]> {
    const rows = await db.select().from(customers).where(and(
      eq(customers.providerId, providerId),
      eq(customers.paymentStatus, "overdue"),
      gte(customers.maxDaysOverdue, 1),
    ));
    return rows
      .filter(r => r.latitude && r.longitude && (r.maxDaysOverdue || 0) <= 365)
      .map(r => ({
        lat: parseFloat(r.latitude!),
        lng: parseFloat(r.longitude!),
        city: r.city || "",
        totalOverdueAmount: parseFloat(r.totalOverdueAmount || "0"),
        maxDaysOverdue: r.maxDaysOverdue || 0,
        overdueCount: r.overdueInvoicesCount || 1,
      }));
  }

  /** Buscar todos os inadimplentes de todos os provedores (mapa regional) — max 365 dias */
  async getHeatmapAll(): Promise<{
    lat: number; lng: number; city: string; totalOverdueAmount: number;
    maxDaysOverdue: number; overdueCount: number; providerId: number;
  }[]> {
    const rows = await db.select().from(customers).where(and(
      eq(customers.paymentStatus, "overdue"),
      gte(customers.maxDaysOverdue, 1),
    ));
    return rows
      .filter(r => r.latitude && r.longitude && (r.maxDaysOverdue || 0) <= 365)
      .map(r => ({
        lat: parseFloat(r.latitude!),
        lng: parseFloat(r.longitude!),
        city: r.city || "",
        totalOverdueAmount: parseFloat(r.totalOverdueAmount || "0"),
        maxDaysOverdue: r.maxDaysOverdue || 0,
        overdueCount: r.overdueInvoicesCount || 1,
        providerId: r.providerId!,
      }));
  }

  /** Buscar clientes por CEP prefix (consulta endereco cross-provider) */
  async getCustomersByCepPrefix(cepPrefix: string, excludeProviderId?: number): Promise<Customer[]> {
    const all = await db.select().from(customers).where(
      eq(customers.paymentStatus, "overdue"),
    );
    const prefix = cepPrefix.replace(/\D/g, "").slice(0, 5);
    return all.filter(c => {
      if (!c.cep) return false;
      if (!c.cep.replace(/\D/g, "").startsWith(prefix)) return false;
      if (excludeProviderId && c.providerId === excludeProviderId) return false;
      return true;
    });
  }

}
