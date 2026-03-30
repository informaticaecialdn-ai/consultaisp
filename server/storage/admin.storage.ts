import { eq, desc, sql, count } from "drizzle-orm";
import { db } from "../db";
import {
  providers, users, customers, ispConsultations, spcConsultations,
  planChanges, providerInvoices,
  type Provider,
  type PlanChange, type InsertPlanChange,
} from "@shared/schema";

export class AdminStorage {
  async adminUpdateProvider(id: number, data: Partial<Provider>): Promise<Provider> {
    const { id: _id, createdAt: _c, ...safe } = data as any;
    const [updated] = await db.update(providers).set(safe).where(eq(providers.id, id)).returning();
    return updated;
  }

  async adminDeactivateProvider(id: number): Promise<void> {
    await db.update(providers).set({ status: "inactive" }).where(eq(providers.id, id));
  }

  async updateProviderPlan(id: number, plan: string): Promise<Provider> {
    const [updated] = await db.update(providers).set({ plan }).where(eq(providers.id, id)).returning();
    return updated;
  }

  async addCredits(providerId: number, ispCredits: number, spcCredits: number): Promise<Provider> {
    const [updated] = await db.update(providers)
      .set({
        ispCredits: sql`${providers.ispCredits} + ${ispCredits}`,
        spcCredits: sql`${providers.spcCredits} + ${spcCredits}`,
      })
      .where(eq(providers.id, providerId))
      .returning();
    return updated;
  }

  async getSystemStats(): Promise<any> {
    const [providerCount] = await db.select({ count: count() }).from(providers);
    const [userCount] = await db.select({ count: count() }).from(users);
    const [customerCount] = await db.select({ count: count() }).from(customers);
    const [ispCount] = await db.select({ count: count() }).from(ispConsultations);
    const [spcCount] = await db.select({ count: count() }).from(spcConsultations);
    const allProviders = await db.select().from(providers);
    const totalIspCredits = allProviders.reduce((sum, p) => sum + (p.ispCredits || 0), 0);
    const totalSpcCredits = allProviders.reduce((sum, p) => sum + (p.spcCredits || 0), 0);
    return {
      providers: Number(providerCount.count),
      users: Number(userCount.count),
      customers: Number(customerCount.count),
      ispConsultations: Number(ispCount.count),
      spcConsultations: Number(spcCount.count),
      totalIspCredits,
      totalSpcCredits,
      activeProviders: allProviders.filter(p => p.status === "active").length,
    };
  }

  async getPlanChanges(providerId?: number): Promise<PlanChange[]> {
    if (providerId) {
      return db.select().from(planChanges).where(eq(planChanges.providerId, providerId)).orderBy(desc(planChanges.createdAt));
    }
    return db.select().from(planChanges).orderBy(desc(planChanges.createdAt));
  }

  async createPlanChange(change: InsertPlanChange): Promise<PlanChange> {
    const [created] = await db.insert(planChanges).values(change).returning();
    return created;
  }

  async getSaasMetrics(): Promise<any> {
    const PLAN_PRICES: Record<string, number> = { free: 0, basic: 199, pro: 399, enterprise: 799 };
    const PLAN_ORDER = ["free", "basic", "pro", "enterprise"];

    const allProviders = await db.select().from(providers);
    const allInvoices = await db.select().from(providerInvoices);
    const allChanges = await db.select().from(planChanges).orderBy(planChanges.createdAt);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const activeProviders = allProviders.filter(p => p.status === "active");
    const payingProviders = activeProviders.filter(p => (PLAN_PRICES[p.plan] || 0) > 0);

    const mrr = activeProviders.reduce((sum, p) => sum + (PLAN_PRICES[p.plan] || 0), 0);
    const arr = mrr * 12;
    const arpu = payingProviders.length > 0 ? mrr / payingProviders.length : 0;

    // MRR Waterfall from plan_changes this month
    const monthChanges = allChanges.filter(c => new Date(c.createdAt!) >= monthStart);
    let newMrr = 0, expansionMrr = 0, contractionMrr = 0, churnedMrr = 0, reactivationMrr = 0;
    const upgrades: any[] = [];
    const downgrades: any[] = [];
    const churns: any[] = [];

    for (const change of monthChanges) {
      if (!change.newPlan) continue;
      const oldPrice = PLAN_PRICES[change.oldPlan || "free"] || 0;
      const newPrice = PLAN_PRICES[change.newPlan] || 0;
      const delta = newPrice - oldPrice;
      const provider = allProviders.find(p => p.id === change.providerId);
      if (!provider) continue;

      if (oldPrice === 0 && newPrice > 0) {
        newMrr += newPrice;
      } else if (oldPrice > 0 && newPrice === 0) {
        churnedMrr += oldPrice;
        churns.push({ provider: provider.name, oldPlan: change.oldPlan, mrr: oldPrice, date: change.createdAt });
      } else if (delta > 0) {
        expansionMrr += delta;
        upgrades.push({ provider: provider.name, from: change.oldPlan, to: change.newPlan, delta, date: change.createdAt });
      } else if (delta < 0) {
        contractionMrr += Math.abs(delta);
        downgrades.push({ provider: provider.name, from: change.oldPlan, to: change.newPlan, delta: Math.abs(delta), date: change.createdAt });
      }
    }

    const startingMrr = mrr - newMrr - expansionMrr + contractionMrr + churnedMrr;
    const nrr = startingMrr > 0 ? Math.round(((startingMrr + expansionMrr - contractionMrr - churnedMrr) / startingMrr) * 100) : 100;

    // Churn rate
    const churnedCount = churns.length;
    const startingPayingCount = payingProviders.length + churnedCount;
    const monthlyChurnRate = startingPayingCount > 0 ? parseFloat(((churnedCount / startingPayingCount) * 100).toFixed(1)) : 0;
    const annualChurnRate = parseFloat((monthlyChurnRate * 12).toFixed(1));
    const ltv = monthlyChurnRate > 0 ? Math.round(arpu / (monthlyChurnRate / 100)) : Math.round(arpu * 24);

    // New providers this month
    const newProvidersThisMonth = allProviders.filter(p => new Date(p.createdAt!) >= monthStart).length;
    const newPayingThisMonth = allProviders.filter(p => new Date(p.createdAt!) >= monthStart && (PLAN_PRICES[p.plan] || 0) > 0).length;

    // Plan distribution with revenue
    const planDistribution: Record<string, { count: number; mrr: number }> = {};
    for (const p of activeProviders) {
      if (!planDistribution[p.plan]) planDistribution[p.plan] = { count: 0, mrr: 0 };
      planDistribution[p.plan].count++;
      planDistribution[p.plan].mrr += PLAN_PRICES[p.plan] || 0;
    }

    // 12-month historical
    const last12Months: any[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const periodEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const periodPaid = allInvoices.filter(inv => inv.period === period && inv.status === "paid");
      const collectedRevenue = periodPaid.reduce((sum, inv) => sum + parseFloat(inv.paidAmount || inv.amount), 0);
      const periodInvoices = allInvoices.filter(inv => inv.period === period && inv.status !== "cancelled");
      const billedRevenue = periodInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount), 0);
      const activeAtPeriod = allProviders.filter(p => new Date(p.createdAt!) <= periodEnd).length;
      last12Months.push({ period, collectedRevenue, billedRevenue, activeProviders: activeAtPeriod, payingProviders: periodInvoices.length });
    }

    // Invoice health
    const allActiveInvoices = allInvoices.filter(i => i.status !== "cancelled");
    const paidInvoices = allInvoices.filter(i => i.status === "paid");
    const overdueInvoices = allInvoices.filter(i => i.status === "overdue" || (i.status === "pending" && new Date(i.dueDate) < now));
    const pendingInvoices = allInvoices.filter(i => i.status === "pending" && new Date(i.dueDate) >= now);

    const totalBilled = allActiveInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
    const totalCollected = paidInvoices.reduce((s, i) => s + parseFloat(i.paidAmount || i.amount), 0);
    const totalOverdue = overdueInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
    const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;

    // Overdue aging buckets
    const agingBuckets = { "1-15": 0, "16-30": 0, "31-60": 0, "60+": 0 };
    for (const inv of overdueInvoices) {
      const days = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
      if (days <= 15) agingBuckets["1-15"] += parseFloat(inv.amount);
      else if (days <= 30) agingBuckets["16-30"] += parseFloat(inv.amount);
      else if (days <= 60) agingBuckets["31-60"] += parseFloat(inv.amount);
      else agingBuckets["60+"] += parseFloat(inv.amount);
    }

    // Provider billing health
    const providerBillingHealth = await Promise.all(activeProviders.map(async p => {
      const provInvoices = allInvoices.filter(i => i.providerId === p.id);
      const provPaid = provInvoices.filter(i => i.status === "paid");
      const provOverdue = provInvoices.filter(i => i.status === "overdue" || (i.status === "pending" && new Date(i.dueDate) < now));
      const hasAsaas = provInvoices.some(i => i.asaasChargeId);
      return {
        id: p.id, name: p.name, plan: p.plan,
        mrr: PLAN_PRICES[p.plan] || 0,
        invoicesCount: provInvoices.length,
        paidCount: provPaid.length,
        overdueCount: provOverdue.length,
        overdueAmount: provOverdue.reduce((s, i) => s + parseFloat(i.amount), 0),
        lastPaid: provPaid.length > 0 ? provPaid.sort((a, b) => new Date(b.paidDate!).getTime() - new Date(a.paidDate!).getTime())[0].paidDate : null,
        hasAsaas,
        health: provOverdue.length > 0 ? "overdue" : provPaid.length > 0 ? "good" : "new",
      };
    }));

    return {
      snapshot: {
        mrr, arr, arpu, nrr, ltv,
        monthlyChurnRate, annualChurnRate,
        payingProviders: payingProviders.length,
        activeProviders: activeProviders.length,
        totalProviders: allProviders.length,
        newProvidersThisMonth, newPayingThisMonth,
      },
      waterfall: {
        startingMrr, newMrr, expansionMrr, contractionMrr, churnedMrr, reactivationMrr,
        endingMrr: mrr,
        upgrades, downgrades, churns,
      },
      planDistribution,
      last12Months,
      invoiceHealth: {
        totalBilled, totalCollected, totalOverdue,
        collectionRate,
        counts: { total: allActiveInvoices.length, paid: paidInvoices.length, overdue: overdueInvoices.length, pending: pendingInvoices.length },
        agingBuckets,
      },
      providerBillingHealth,
    };
  }
}
