import { eq, and, desc, sql, count } from "drizzle-orm";
import { db } from "../db";
import {
  providers, contracts, invoices, providerInvoices, creditOrders,
  planChanges, providerPartners, providerDocuments,
  PLAN_PRICES,
  type Provider,
  type Contract, type InsertContract,
  type Invoice, type InsertInvoice,
  type ProviderInvoice, type InsertProviderInvoice,
  type CreditOrder, type InsertCreditOrder,
  type PlanChange, type InsertPlanChange,
  type ProviderPartner, type InsertProviderPartner,
  type ProviderDocument, type InsertProviderDocument,
} from "@shared/schema";

export class FinancialStorage {
  async getContractsByCustomer(customerId: number): Promise<Contract[]> {
    return db.select().from(contracts).where(eq(contracts.customerId, customerId));
  }

  async getContractsByProvider(providerId: number): Promise<Contract[]> {
    return db.select().from(contracts).where(eq(contracts.providerId, providerId));
  }

  async createContract(contract: InsertContract): Promise<Contract> {
    const [created] = await db.insert(contracts).values(contract).returning();
    return created;
  }

  async getInvoicesByProvider(providerId: number): Promise<Invoice[]> {
    return db.select().from(invoices).where(eq(invoices.providerId, providerId)).orderBy(desc(invoices.dueDate));
  }

  async getInvoicesByCustomer(customerId: number): Promise<Invoice[]> {
    return db.select().from(invoices).where(eq(invoices.customerId, customerId)).orderBy(desc(invoices.dueDate));
  }

  async getOverdueInvoicesByProvider(providerId: number): Promise<Invoice[]> {
    return db.select().from(invoices).where(
      and(
        eq(invoices.providerId, providerId),
        eq(invoices.status, "overdue"),
      )
    );
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [created] = await db.insert(invoices).values(invoice).returning();
    return created;
  }

  async getNextInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const [{ count: total }] = await db.select({ count: count() }).from(providerInvoices);
    const seq = (Number(total) + 1).toString().padStart(6, "0");
    return `NF-${year}-${seq}`;
  }

  async getAllProviderInvoices(providerId?: number): Promise<(ProviderInvoice & { providerName: string })[]> {
    const allInvoices = providerId
      ? await db.select().from(providerInvoices).where(eq(providerInvoices.providerId, providerId)).orderBy(desc(providerInvoices.createdAt))
      : await db.select().from(providerInvoices).orderBy(desc(providerInvoices.createdAt));
    return Promise.all(allInvoices.map(async (inv) => {
      const [provider] = await db.select({ name: providers.name }).from(providers).where(eq(providers.id, inv.providerId));
      return { ...inv, providerName: provider?.name || "Desconhecido" };
    }));
  }

  async getProviderInvoice(id: number): Promise<(ProviderInvoice & { providerName: string; providerCnpj: string; providerSubdomain: string | null }) | undefined> {
    const [inv] = await db.select().from(providerInvoices).where(eq(providerInvoices.id, id));
    if (!inv) return undefined;
    const [provider] = await db.select({ name: providers.name, cnpj: providers.cnpj, subdomain: providers.subdomain }).from(providers).where(eq(providers.id, inv.providerId));
    return { ...inv, providerName: provider?.name || "Desconhecido", providerCnpj: provider?.cnpj || "", providerSubdomain: provider?.subdomain || null };
  }

  async createProviderInvoice(invoice: InsertProviderInvoice): Promise<ProviderInvoice> {
    const [created] = await db.insert(providerInvoices).values(invoice).returning();
    return created;
  }

  async updateProviderInvoiceStatus(id: number, status: string, paidDate?: Date, paidAmount?: string): Promise<ProviderInvoice> {
    const updateData: Partial<typeof providerInvoices.$inferInsert> = { status };
    if (paidDate) updateData.paidDate = paidDate;
    if (paidAmount) updateData.paidAmount = paidAmount;
    const [updated] = await db.update(providerInvoices).set(updateData).where(eq(providerInvoices.id, id)).returning();
    return updated;
  }

  async updateProviderInvoiceAsaas(id: number, asaasData: {
    asaasChargeId?: string;
    asaasCustomerId?: string;
    asaasStatus?: string;
    asaasInvoiceUrl?: string;
    asaasBankSlipUrl?: string;
    asaasPixKey?: string;
    asaasBillingType?: string;
    status?: string;
    paidDate?: Date;
    paidAmount?: string;
  }): Promise<ProviderInvoice> {
    const [updated] = await db.update(providerInvoices).set(asaasData).where(eq(providerInvoices.id, id)).returning();
    return updated;
  }

  async getFinancialSummary(): Promise<any> {
    const allProviders = await db.select().from(providers);
    const allInvoices = await db.select().from(providerInvoices);

    const activeProviders = allProviders.filter(p => p.status === "active");
    const mrr = activeProviders.reduce((sum, p) => sum + (PLAN_PRICES[p.plan] || 0), 0);
    const arr = mrr * 12;

    const pendingInvoices = allInvoices.filter(i => i.status === "pending" || i.status === "overdue");
    const paidInvoices = allInvoices.filter(i => i.status === "paid");
    const overdueInvoices = allInvoices.filter(i => i.status === "overdue");

    const totalRevenue = paidInvoices.reduce((sum, i) => sum + parseFloat(i.paidAmount || i.amount), 0);
    const pendingRevenue = pendingInvoices.reduce((sum, i) => sum + parseFloat(i.amount), 0);
    const overdueRevenue = overdueInvoices.reduce((sum, i) => sum + parseFloat(i.amount), 0);

    const planDistribution: Record<string, number> = {};
    for (const p of allProviders) {
      planDistribution[p.plan] = (planDistribution[p.plan] || 0) + 1;
    }

    const now = new Date();
    const last6Months: { period: string; revenue: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const periodPaid = allInvoices.filter(inv => inv.period === period && inv.status === "paid");
      const revenue = periodPaid.reduce((sum, inv) => sum + parseFloat(inv.paidAmount || inv.amount), 0);
      last6Months.push({ period, revenue });
    }

    return {
      mrr, arr,
      totalRevenue, pendingRevenue, overdueRevenue,
      totalInvoices: allInvoices.length,
      pendingCount: pendingInvoices.length,
      paidCount: paidInvoices.length,
      overdueCount: overdueInvoices.length,
      planDistribution,
      last6Months,
      activeProviders: activeProviders.length,
      totalProviders: allProviders.length,
    };
  }

  async getAllCreditOrders(providerId?: number): Promise<CreditOrder[]> {
    if (providerId) {
      return db.select().from(creditOrders).where(eq(creditOrders.providerId, providerId)).orderBy(desc(creditOrders.createdAt));
    }
    return db.select().from(creditOrders).orderBy(desc(creditOrders.createdAt));
  }

  async getCreditOrder(id: number): Promise<CreditOrder | undefined> {
    const [order] = await db.select().from(creditOrders).where(eq(creditOrders.id, id));
    return order;
  }

  async createCreditOrder(order: InsertCreditOrder): Promise<CreditOrder> {
    const [created] = await db.insert(creditOrders).values(order).returning();
    return created;
  }

  async updateCreditOrder(id: number, data: Partial<CreditOrder>): Promise<CreditOrder> {
    const [updated] = await db.update(creditOrders).set(data as any).where(eq(creditOrders.id, id)).returning();
    return updated;
  }

  async releaseCreditOrder(id: number): Promise<CreditOrder> {
    const order = await this.getCreditOrder(id);
    if (!order) throw new Error("Pedido nao encontrado");
    if (order.status === "paid") throw new Error("Creditos ja foram liberados para este pedido");
    await db.execute(sql`UPDATE providers SET isp_credits = isp_credits + ${order.ispCredits}, spc_credits = spc_credits + ${order.spcCredits} WHERE id = ${order.providerId}`);
    const [updated] = await db.update(creditOrders).set({ status: "paid", creditedAt: new Date() }).where(eq(creditOrders.id, id)).returning();
    await db.insert(planChanges).values({
      providerId: order.providerId,
      ispCreditsAdded: order.ispCredits,
      spcCreditsAdded: order.spcCredits,
      notes: `Creditos liberados via pedido ${order.orderNumber} (${order.packageName})`,
    });
    return updated;
  }

  async getNextOrderNumber(): Promise<string> {
    const [row] = await db.select({ cnt: count() }).from(creditOrders);
    const num = (row?.cnt || 0) + 1;
    const today = new Date();
    const yyyymm = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}`;
    return `CR-${yyyymm}-${String(num).padStart(4, "0")}`;
  }

  async getProviderPartners(providerId: number): Promise<ProviderPartner[]> {
    return db.select().from(providerPartners).where(eq(providerPartners.providerId, providerId)).orderBy(providerPartners.createdAt);
  }

  async createProviderPartner(partner: InsertProviderPartner): Promise<ProviderPartner> {
    const [created] = await db.insert(providerPartners).values(partner).returning();
    return created;
  }

  async updateProviderPartner(id: number, providerId: number, data: Partial<ProviderPartner>): Promise<ProviderPartner> {
    const [updated] = await db.update(providerPartners).set(data as any).where(and(eq(providerPartners.id, id), eq(providerPartners.providerId, providerId))).returning();
    return updated;
  }

  async deleteProviderPartner(id: number, providerId: number): Promise<void> {
    await db.delete(providerPartners).where(and(eq(providerPartners.id, id), eq(providerPartners.providerId, providerId)));
  }

  async getProviderDocuments(providerId: number): Promise<ProviderDocument[]> {
    return db.select().from(providerDocuments).where(eq(providerDocuments.providerId, providerId)).orderBy(desc(providerDocuments.uploadedAt));
  }

  async getProviderDocument(id: number): Promise<ProviderDocument | undefined> {
    const [doc] = await db.select().from(providerDocuments).where(eq(providerDocuments.id, id));
    return doc;
  }

  async createProviderDocument(doc: InsertProviderDocument): Promise<ProviderDocument> {
    const [created] = await db.insert(providerDocuments).values(doc).returning();
    return created;
  }

  async deleteProviderDocument(id: number, providerId: number): Promise<void> {
    await db.delete(providerDocuments).where(and(eq(providerDocuments.id, id), eq(providerDocuments.providerId, providerId)));
  }

  async updateProviderDocumentStatus(id: number, status: string, reviewedById: number, reviewerName: string, rejectionReason?: string): Promise<ProviderDocument> {
    const [updated] = await db.update(providerDocuments).set({ status, reviewedById, reviewerName, rejectionReason: rejectionReason || null, reviewedAt: new Date() }).where(eq(providerDocuments.id, id)).returning();
    return updated;
  }
}
