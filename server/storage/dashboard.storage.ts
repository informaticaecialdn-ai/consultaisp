import { eq, and, desc, sql, count, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  providers, customers, invoices, equipment,
} from "@shared/schema";

export class DashboardStorage {
  async getDashboardStats(providerId: number): Promise<any> {
    const totalCustomers = await db.select({ count: count() }).from(customers)
      .where(eq(customers.providerId, providerId));

    const defaulterCustomers = await db.select({ count: count() }).from(customers)
      .where(and(eq(customers.providerId, providerId), sql`${customers.paymentStatus} != 'current'`));

    const overdueTotal = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${invoices.value} AS DECIMAL)), 0)`,
    }).from(invoices).where(
      and(eq(invoices.providerId, providerId), eq(invoices.status, "overdue"))
    );

    const critical = await db.select({ count: count() }).from(customers)
      .where(and(eq(customers.providerId, providerId), eq(customers.riskTier, "critical")));
    const high = await db.select({ count: count() }).from(customers)
      .where(and(eq(customers.providerId, providerId), eq(customers.riskTier, "high")));
    const medium = await db.select({ count: count() }).from(customers)
      .where(and(eq(customers.providerId, providerId), eq(customers.riskTier, "medium")));

    const unreturnedEquip = await db.select({
      count: count(),
      total: sql<string>`COALESCE(SUM(CAST(${equipment.value} AS DECIMAL)), 0)`,
    }).from(equipment)
      .innerJoin(customers, eq(equipment.customerId, customers.id))
      .where(and(
        eq(equipment.providerId, providerId),
        sql`${customers.paymentStatus} != 'current'`,
        sql`${equipment.status} != 'returned'`,
      ));

    const overdueInvoicesCount = await db.select({ count: count() }).from(invoices)
      .where(and(eq(invoices.providerId, providerId), eq(invoices.status, "overdue")));

    const [provider] = await db.select().from(providers).where(eq(providers.id, providerId));

    const partnerProviders = await db.select({ count: count() }).from(providers)
      .where(and(
        eq(providers.status, "active"),
        sql`${providers.id} != ${providerId}`,
      ));

    return {
      totalCustomers: totalCustomers[0]?.count || 0,
      defaulters: defaulterCustomers[0]?.count || 0,
      overdueInvoicesCount: overdueInvoicesCount[0]?.count || 0,
      overdueTotal: overdueTotal[0]?.total || "0",
      criticalCount: critical[0]?.count || 0,
      highCount: high[0]?.count || 0,
      mediumCount: medium[0]?.count || 0,
      unreturnedEquipmentCount: unreturnedEquip[0]?.count || 0,
      unreturnedEquipmentValue: unreturnedEquip[0]?.total || "0",
      ispCredits: provider?.ispCredits || 0,
      spcCredits: provider?.spcCredits || 0,
      partnerCount: partnerProviders[0]?.count || 0,
    };
  }

  async getDefaultersList(providerId: number): Promise<any[]> {
    return db.select({
      id: customers.id,
      name: customers.name,
      city: customers.city,
      state: customers.state,
      totalOverdueAmount: customers.totalOverdueAmount,
      maxDaysOverdue: customers.maxDaysOverdue,
      overdueInvoicesCount: customers.overdueInvoicesCount,
      riskTier: customers.riskTier,
      paymentStatus: customers.paymentStatus,
      erpSource: customers.erpSource,
      lastSyncAt: customers.lastSyncAt,
    }).from(customers)
      .where(and(
        eq(customers.providerId, providerId),
        sql`${customers.paymentStatus} != 'current'`,
      ))
      .orderBy(desc(customers.totalOverdueAmount));
  }

  async getInadimplentes(providerId: number): Promise<any[]> {
    const list = await db.select({
      id: customers.id,
      name: customers.name,
      cpfCnpj: customers.cpfCnpj,
      phone: customers.phone,
      email: customers.email,
      city: customers.city,
      state: customers.state,
      totalOverdueAmount: customers.totalOverdueAmount,
      maxDaysOverdue: customers.maxDaysOverdue,
      overdueInvoicesCount: customers.overdueInvoicesCount,
      riskTier: customers.riskTier,
      paymentStatus: customers.paymentStatus,
      erpSource: customers.erpSource,
      lastSyncAt: customers.lastSyncAt,
      createdAt: customers.createdAt,
    }).from(customers)
      .where(and(
        eq(customers.providerId, providerId),
        sql`${customers.paymentStatus} != 'current'`,
      ))
      .orderBy(desc(customers.totalOverdueAmount));

    const ids = list.map(c => c.id);
    if (ids.length === 0) return [];

    const equipData = await db.select({
      customerId: equipment.customerId,
      count: count(),
      total: sql<string>`COALESCE(SUM(CAST(${equipment.value} AS DECIMAL)), 0)`,
    }).from(equipment)
      .where(and(
        eq(equipment.providerId, providerId),
        inArray(equipment.customerId, ids),
        sql`${equipment.status} != 'returned'`,
      ))
      .groupBy(equipment.customerId);

    const equipMap = new Map(equipData.map(e => [e.customerId, { count: Number(e.count), value: Number(e.total) }]));

    return list.map(c => ({
      ...c,
      unreturnedEquipmentCount: equipMap.get(c.id)?.count ?? 0,
      unreturnedEquipmentValue: equipMap.get(c.id)?.value ?? 0,
    }));
  }

  async getDefaultersByProvider(providerId: number): Promise<any[]> {
    const result = await db
      .select({
        customerId: customers.id,
        customerName: customers.name,
        cpfCnpj: customers.cpfCnpj,
        phone: customers.phone,
        city: customers.city,
        invoiceId: invoices.id,
        invoiceValue: invoices.value,
        dueDate: invoices.dueDate,
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(
        and(
          eq(invoices.providerId, providerId),
          eq(invoices.status, "overdue"),
        )
      )
      .orderBy(desc(invoices.dueDate));
    return result;
  }

  async getHeatmapDataByProvider(providerId: number): Promise<any[]> {
    const result = await db.select({
      id: customers.id,
      name: customers.name,
      latitude: customers.latitude,
      longitude: customers.longitude,
      city: customers.city,
      totalOverdueAmount: customers.totalOverdueAmount,
      maxDaysOverdue: customers.maxDaysOverdue,
      overdueInvoicesCount: customers.overdueInvoicesCount,
      riskTier: customers.riskTier,
      paymentStatus: customers.paymentStatus,
    }).from(customers).where(
      and(
        eq(customers.providerId, providerId),
        sql`${customers.paymentStatus} != 'current'`,
        sql`${customers.latitude} IS NOT NULL`,
        sql`${customers.longitude} IS NOT NULL`,
      )
    );
    return result;
  }

  async getHeatmapDataAllProviders(): Promise<any[]> {
    const result = await db.select({
      latitude: customers.latitude,
      longitude: customers.longitude,
      city: customers.city,
      totalOverdueAmount: customers.totalOverdueAmount,
      maxDaysOverdue: customers.maxDaysOverdue,
    }).from(customers).where(
      and(
        sql`${customers.paymentStatus} != 'current'`,
        sql`${customers.latitude} IS NOT NULL`,
        sql`${customers.longitude} IS NOT NULL`,
      )
    );
    return result;
  }
}
