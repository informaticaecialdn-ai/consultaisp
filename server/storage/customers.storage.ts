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
    addressNumber?: string;
    complement?: string;
    neighborhood?: string;
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
          addressNumber: data.addressNumber || null,
          complement: data.complement || null,
          neighborhood: data.neighborhood || null,
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
        addressNumber: data.addressNumber || null,
        complement: data.complement || null,
        neighborhood: data.neighborhood || null,
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

  /**
   * Buscar inadimplentes no mesmo endereco para alerta de risco.
   * Match inteligente:
   * - CEP especifico (nao termina em 000): match por CEP + numero
   * - CEP generico (termina em 000): match por rua normalizada + numero + cidade
   */
  async getCustomersByAddressForAlert(params: {
    cep?: string;
    address?: string;
    addressNumber?: string;
    city?: string;
    excludeCpfCnpj: string;
  }): Promise<{
    cpfMasked: string;
    overdueRange: string;
    maxDaysOverdue: number;
    status: string;
    matchType: "cep_numero" | "endereco_completo";
  }[]> {
    const { cep, address, addressNumber, city, excludeCpfCnpj } = params;
    if (!addressNumber) return []; // sem numero, nao tem como identificar imovel

    const cleanExclude = excludeCpfCnpj.replace(/\D/g, "");
    const cleanCep = cep?.replace(/\D/g, "") || "";
    const isGenericCep = cleanCep.endsWith("000") || cleanCep.length < 8;

    const rows = await db.select().from(customers).where(
      eq(customers.paymentStatus, "overdue"),
    );

    const normalizeStreet = (s: string): string => {
      return s
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
        .replace(/\br\.?\s*/g, "rua ")
        .replace(/\bav\.?\s*/g, "avenida ")
        .replace(/\btv\.?\s*/g, "travessa ")
        .replace(/\bpca?\.?\s*/g, "praca ")
        .replace(/\bal\.?\s*/g, "alameda ")
        .replace(/\brod\.?\s*/g, "rodovia ")
        .replace(/\s+/g, " ")
        .trim();
    };

    const normalNum = (n: string): string => n.replace(/\D/g, "").replace(/^0+/, "");
    const queryNum = normalNum(addressNumber);
    if (!queryNum) return [];

    const matches = rows.filter(c => {
      if (c.cpfCnpj.replace(/\D/g, "") === cleanExclude) return false;
      if (!c.addressNumber) return false;
      if (normalNum(c.addressNumber) !== queryNum) return false;

      if (!isGenericCep && cleanCep.length >= 8 && c.cep) {
        // CEP especifico: match por CEP completo + numero
        return c.cep.replace(/\D/g, "") === cleanCep;
      } else {
        // CEP generico ou sem CEP: match por rua normalizada + numero + cidade
        if (!address || !city || !c.address || !c.city) return false;
        const normalAddr = normalizeStreet(address);
        const normalCAddr = normalizeStreet(c.address);
        const normalCity = city.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const normalCCity = (c.city || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        return normalAddr === normalCAddr && normalCity === normalCCity;
      }
    });

    const maskCpf = (cpf: string): string => {
      const clean = cpf.replace(/\D/g, "");
      if (clean.length === 11) return `***.${clean.slice(3, 6)}.${clean.slice(6, 9)}-**`;
      if (clean.length === 14) return `**.***.${clean.slice(5, 8)}/${clean.slice(8, 12)}-**`;
      return "***";
    };

    const overdueRange = (val: number): string => {
      if (val <= 200) return "R$ 0-200";
      if (val <= 500) return "R$ 200-500";
      if (val <= 1000) return "R$ 500-1.000";
      if (val <= 2000) return "R$ 1.000-2.000";
      return "R$ 2.000+";
    };

    return matches.map(c => ({
      cpfMasked: maskCpf(c.cpfCnpj),
      overdueRange: overdueRange(parseFloat(c.totalOverdueAmount || "0")),
      maxDaysOverdue: c.maxDaysOverdue || 0,
      status: c.status === "cancelled" ? "inativo" : "inadimplente",
      matchType: (!isGenericCep && cleanCep.length >= 8) ? "cep_numero" as const : "endereco_completo" as const,
    }));
  }

  /** Ranking de CEPs por risco — agrega todos os provedores */
  async getCepRanking(): Promise<{
    cep5: string; city: string; count: number; totalOverdue: number; avgDaysOverdue: number; riskLevel: string;
  }[]> {
    const rows = await db.select().from(customers).where(
      eq(customers.paymentStatus, "overdue"),
    );

    const cepMap = new Map<string, { city: string; count: number; totalOverdue: number; totalDays: number }>();
    for (const r of rows) {
      if (!r.cep) continue;
      const cep5 = r.cep.replace(/\D/g, "").slice(0, 5);
      if (cep5.length < 5) continue;
      const existing = cepMap.get(cep5);
      const overdue = parseFloat(r.totalOverdueAmount || "0");
      const days = r.maxDaysOverdue || 0;
      if (existing) {
        existing.count++;
        existing.totalOverdue += overdue;
        existing.totalDays += days;
        if (!existing.city && r.city) existing.city = r.city;
      } else {
        cepMap.set(cep5, { city: r.city || "", count: 1, totalOverdue: overdue, totalDays: days });
      }
    }

    return Array.from(cepMap.entries())
      .map(([cep5, data]) => ({
        cep5,
        city: data.city,
        count: data.count,
        totalOverdue: data.totalOverdue,
        avgDaysOverdue: Math.round(data.totalDays / data.count),
        riskLevel: data.count >= 11 ? "critico" : data.count >= 6 ? "alto" : data.count >= 3 ? "medio" : "baixo",
      }))
      .sort((a, b) => b.count - a.count);
  }

  /** Tendencia regional — inadimplentes por mes (ultimos 6 meses) */
  async getTrend(): Promise<{ month: string; count: number; totalOverdue: number }[]> {
    const rows = await db.select().from(customers).where(
      eq(customers.paymentStatus, "overdue"),
    );

    const now = new Date();
    const months: { month: string; count: number; totalOverdue: number }[] = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
      const daysFromMonth = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      const count = rows.filter(r => (r.maxDaysOverdue || 0) >= daysFromMonth).length;
      const totalOverdue = rows
        .filter(r => (r.maxDaysOverdue || 0) >= daysFromMonth)
        .reduce((s, r) => s + parseFloat(r.totalOverdueAmount || "0"), 0);

      months.push({ month: label, count, totalOverdue });
    }

    return months;
  }

  /** Pontos para mapa de risco — agrega por CEP com lat/lng medio */
  async getMapPoints(): Promise<{
    lat: number; lng: number; cep5: string; city: string; count: number; totalOverdue: number; riskLevel: string;
  }[]> {
    const rows = await db.select().from(customers).where(
      eq(customers.paymentStatus, "overdue"),
    );

    const cepMap = new Map<string, { lats: number[]; lngs: number[]; city: string; count: number; totalOverdue: number }>();
    for (const r of rows) {
      if (!r.cep || !r.latitude || !r.longitude) continue;
      const cep5 = r.cep.replace(/\D/g, "").slice(0, 5);
      if (cep5.length < 5) continue;
      const lat = parseFloat(r.latitude);
      const lng = parseFloat(r.longitude);
      if (isNaN(lat) || isNaN(lng)) continue;

      const existing = cepMap.get(cep5);
      if (existing) {
        existing.lats.push(lat);
        existing.lngs.push(lng);
        existing.count++;
        existing.totalOverdue += parseFloat(r.totalOverdueAmount || "0");
        if (!existing.city && r.city) existing.city = r.city;
      } else {
        cepMap.set(cep5, { lats: [lat], lngs: [lng], city: r.city || "", count: 1, totalOverdue: parseFloat(r.totalOverdueAmount || "0") });
      }
    }

    return Array.from(cepMap.entries()).map(([cep5, data]) => ({
      lat: data.lats.reduce((s, v) => s + v, 0) / data.lats.length,
      lng: data.lngs.reduce((s, v) => s + v, 0) / data.lngs.length,
      cep5,
      city: data.city,
      count: data.count,
      totalOverdue: data.totalOverdue,
      riskLevel: data.count >= 11 ? "critico" : data.count >= 6 ? "alto" : data.count >= 3 ? "medio" : "baixo",
    }));
  }

}
