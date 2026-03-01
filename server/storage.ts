import { eq, and, desc, sql, gte, lte, count } from "drizzle-orm";
import { db } from "./db";
import {
  providers, users, customers, contracts, invoices, equipment,
  ispConsultations, spcConsultations, antiFraudAlerts,
  supportThreads, supportMessages, planChanges, providerInvoices,
  type Provider, type InsertProvider,
  type User, type InsertUser,
  type Customer, type InsertCustomer,
  type Contract, type InsertContract,
  type Invoice, type InsertInvoice,
  type Equipment, type InsertEquipment,
  type IspConsultation, type InsertIspConsultation,
  type SpcConsultation, type InsertSpcConsultation,
  type AntiFraudAlert, type InsertAntiFraudAlert,
  type SupportThread, type InsertSupportThread,
  type SupportMessage, type InsertSupportMessage,
  type PlanChange, type InsertPlanChange,
  type ProviderInvoice, type InsertProviderInvoice,
} from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByVerificationToken(token: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  setEmailVerified(userId: number): Promise<void>;
  setVerificationToken(userId: number, token: string, expiresAt: Date): Promise<void>;
  getUsersByProvider(providerId: number): Promise<User[]>;
  deleteUser(id: number): Promise<void>;

  getProvider(id: number): Promise<Provider | undefined>;
  getProviderByCnpj(cnpj: string): Promise<Provider | undefined>;
  getProviderBySubdomain(subdomain: string): Promise<Provider | undefined>;
  createProvider(provider: InsertProvider): Promise<Provider>;
  updateProvider(id: number, data: Partial<Pick<Provider, "name" | "contactEmail" | "contactPhone" | "website">>): Promise<Provider>;
  getAllProviders(): Promise<Provider[]>;
  updateProviderCredits(id: number, ispCredits: number, spcCredits: number): Promise<void>;

  getCustomersByProvider(providerId: number): Promise<Customer[]>;
  getCustomerByCpfCnpj(cpfCnpj: string): Promise<Customer[]>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;

  getContractsByCustomer(customerId: number): Promise<Contract[]>;
  getContractsByProvider(providerId: number): Promise<Contract[]>;
  createContract(contract: InsertContract): Promise<Contract>;

  getInvoicesByProvider(providerId: number): Promise<Invoice[]>;
  getInvoicesByCustomer(customerId: number): Promise<Invoice[]>;
  getOverdueInvoicesByProvider(providerId: number): Promise<Invoice[]>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;

  getEquipmentByProvider(providerId: number): Promise<Equipment[]>;
  getEquipmentByCustomer(customerId: number): Promise<Equipment[]>;
  createEquipment(equipment: InsertEquipment): Promise<Equipment>;

  getIspConsultationsByProvider(providerId: number): Promise<IspConsultation[]>;
  createIspConsultation(consultation: InsertIspConsultation): Promise<IspConsultation>;
  getIspConsultationCountToday(providerId: number): Promise<number>;
  getIspConsultationCountMonth(providerId: number): Promise<number>;
  getRecentConsultationsForDocument(cpfCnpj: string, days: number): Promise<IspConsultation[]>;

  getSpcConsultationsByProvider(providerId: number): Promise<SpcConsultation[]>;
  createSpcConsultation(consultation: InsertSpcConsultation): Promise<SpcConsultation>;
  getSpcConsultationCountToday(providerId: number): Promise<number>;
  getSpcConsultationCountMonth(providerId: number): Promise<number>;

  getAlertsByProvider(providerId: number): Promise<AntiFraudAlert[]>;
  createAlert(alert: InsertAntiFraudAlert): Promise<AntiFraudAlert>;
  updateAlertStatus(alertId: number, providerId: number, status: string): Promise<AntiFraudAlert | undefined>;
  getAlertsByCustomer(customerId: number): Promise<AntiFraudAlert[]>;

  getDashboardStats(providerId: number): Promise<any>;
  getDefaultersByProvider(providerId: number): Promise<any[]>;
  getHeatmapDataByProvider(providerId: number): Promise<any[]>;
  getHeatmapDataAllProviders(): Promise<any[]>;

  getAllUsers(): Promise<User[]>;
  adminUpdateProvider(id: number, data: Partial<Provider>): Promise<Provider>;
  adminDeactivateProvider(id: number): Promise<void>;
  updateProviderPlan(id: number, plan: string): Promise<Provider>;
  addCredits(providerId: number, ispCredits: number, spcCredits: number): Promise<Provider>;
  getSystemStats(): Promise<any>;

  getPlanChanges(providerId?: number): Promise<PlanChange[]>;
  createPlanChange(change: InsertPlanChange): Promise<PlanChange>;

  getOrCreateSupportThread(providerId: number): Promise<SupportThread>;
  getAllSupportThreads(): Promise<(SupportThread & { providerName: string; unreadCount: number })[]>;
  getSupportMessages(threadId: number): Promise<SupportMessage[]>;
  createSupportMessage(msg: InsertSupportMessage): Promise<SupportMessage>;
  markMessagesRead(threadId: number, isFromAdmin: boolean): Promise<void>;
  updateThreadStatus(threadId: number, status: string): Promise<void>;
  getUnreadCountForProvider(providerId: number): Promise<number>;

  getAllProviderInvoices(providerId?: number): Promise<(ProviderInvoice & { providerName: string })[]>;
  getProviderInvoice(id: number): Promise<(ProviderInvoice & { providerName: string; providerCnpj: string; providerSubdomain: string | null }) | undefined>;
  createProviderInvoice(invoice: InsertProviderInvoice): Promise<ProviderInvoice>;
  updateProviderInvoiceStatus(id: number, status: string, paidDate?: Date, paidAmount?: string): Promise<ProviderInvoice>;
  getNextInvoiceNumber(): Promise<string>;
  getFinancialSummary(): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.verificationToken, token));
    return user;
  }

  async setEmailVerified(userId: number): Promise<void> {
    await db.update(users)
      .set({ emailVerified: true, verificationToken: null, verificationTokenExpiresAt: null })
      .where(eq(users.id, userId));
  }

  async setVerificationToken(userId: number, token: string, expiresAt: Date): Promise<void> {
    await db.update(users)
      .set({ verificationToken: token, verificationTokenExpiresAt: expiresAt })
      .where(eq(users.id, userId));
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async getUsersByProvider(providerId: number): Promise<User[]> {
    return db.select().from(users).where(eq(users.providerId, providerId));
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getProvider(id: number): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.id, id));
    return provider;
  }

  async getProviderByCnpj(cnpj: string): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.cnpj, cnpj));
    return provider;
  }

  async getProviderBySubdomain(subdomain: string): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.subdomain, subdomain));
    return provider;
  }

  async createProvider(provider: InsertProvider): Promise<Provider> {
    const [created] = await db.insert(providers).values(provider).returning();
    return created;
  }

  async updateProvider(id: number, data: Partial<Pick<Provider, "name" | "contactEmail" | "contactPhone" | "website">>): Promise<Provider> {
    const [updated] = await db.update(providers).set(data).where(eq(providers.id, id)).returning();
    return updated;
  }

  async getAllProviders(): Promise<Provider[]> {
    return db.select().from(providers);
  }

  async updateProviderCredits(id: number, ispCredits: number, spcCredits: number): Promise<void> {
    await db.update(providers).set({ ispCredits, spcCredits }).where(eq(providers.id, id));
  }

  async getCustomersByProvider(providerId: number): Promise<Customer[]> {
    return db.select().from(customers).where(eq(customers.providerId, providerId));
  }

  async getCustomerByCpfCnpj(cpfCnpj: string): Promise<Customer[]> {
    return db.select().from(customers).where(eq(customers.cpfCnpj, cpfCnpj));
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    const [created] = await db.insert(customers).values(customer).returning();
    return created;
  }

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

  async getEquipmentByProvider(providerId: number): Promise<Equipment[]> {
    return db.select().from(equipment).where(eq(equipment.providerId, providerId));
  }

  async getEquipmentByCustomer(customerId: number): Promise<Equipment[]> {
    return db.select().from(equipment).where(eq(equipment.customerId, customerId));
  }

  async createEquipment(eq_data: InsertEquipment): Promise<Equipment> {
    const [created] = await db.insert(equipment).values(eq_data).returning();
    return created;
  }

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

  async getDashboardStats(providerId: number): Promise<any> {
    const totalCustomers = await db.select({ count: count() }).from(customers)
      .where(eq(customers.providerId, providerId));
    
    const overdueInvoices = await db.select({ count: count() }).from(invoices)
      .where(and(eq(invoices.providerId, providerId), eq(invoices.status, "overdue")));

    const totalEquipment = await db.select({ count: count() }).from(equipment)
      .where(eq(equipment.providerId, providerId));

    const equipmentValue = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${equipment.value} AS DECIMAL)), 0)`,
    }).from(equipment).where(eq(equipment.providerId, providerId));

    const monthlyRevenue = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${invoices.value} AS DECIMAL)), 0)`,
    }).from(invoices).where(
      and(
        eq(invoices.providerId, providerId),
        eq(invoices.status, "paid"),
        gte(invoices.paidDate, sql`date_trunc('month', CURRENT_DATE)`),
      )
    );

    const overdueTotal = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${invoices.value} AS DECIMAL)), 0)`,
    }).from(invoices).where(
      and(
        eq(invoices.providerId, providerId),
        eq(invoices.status, "overdue"),
      )
    );

    const provider = await this.getProvider(providerId);

    return {
      totalCustomers: totalCustomers[0]?.count || 0,
      defaulters: overdueInvoices[0]?.count || 0,
      totalEquipment: totalEquipment[0]?.count || 0,
      equipmentValue: equipmentValue[0]?.total || "0",
      monthlyRevenue: monthlyRevenue[0]?.total || "0",
      overdueTotal: overdueTotal[0]?.total || "0",
      ispCredits: provider?.ispCredits || 0,
      spcCredits: provider?.spcCredits || 0,
    };
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

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

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

  async getOrCreateSupportThread(providerId: number): Promise<SupportThread> {
    const [existing] = await db.select().from(supportThreads).where(eq(supportThreads.providerId, providerId));
    if (existing) return existing;
    const [created] = await db.insert(supportThreads).values({ providerId, subject: "Suporte Geral", status: "open" }).returning();
    return created;
  }

  async getAllSupportThreads(): Promise<(SupportThread & { providerName: string; unreadCount: number })[]> {
    const threads = await db.select().from(supportThreads).orderBy(desc(supportThreads.lastMessageAt));
    const result = await Promise.all(threads.map(async (thread) => {
      const [provider] = await db.select({ name: providers.name }).from(providers).where(eq(providers.id, thread.providerId));
      const [{ count: unread }] = await db.select({ count: count() }).from(supportMessages)
        .where(and(eq(supportMessages.threadId, thread.id), eq(supportMessages.isFromAdmin, false), eq(supportMessages.isRead, false)));
      return { ...thread, providerName: provider?.name || "Desconhecido", unreadCount: Number(unread) };
    }));
    return result;
  }

  async getSupportMessages(threadId: number): Promise<SupportMessage[]> {
    return db.select().from(supportMessages).where(eq(supportMessages.threadId, threadId)).orderBy(supportMessages.createdAt);
  }

  async createSupportMessage(msg: InsertSupportMessage): Promise<SupportMessage> {
    const [created] = await db.insert(supportMessages).values(msg).returning();
    await db.update(supportThreads).set({ lastMessageAt: new Date() }).where(eq(supportThreads.id, msg.threadId));
    return created;
  }

  async markMessagesRead(threadId: number, isFromAdmin: boolean): Promise<void> {
    await db.update(supportMessages)
      .set({ isRead: true })
      .where(and(eq(supportMessages.threadId, threadId), eq(supportMessages.isFromAdmin, isFromAdmin)));
  }

  async updateThreadStatus(threadId: number, status: string): Promise<void> {
    await db.update(supportThreads).set({ status }).where(eq(supportThreads.id, threadId));
  }

  async getUnreadCountForProvider(providerId: number): Promise<number> {
    const [thread] = await db.select().from(supportThreads).where(eq(supportThreads.providerId, providerId));
    if (!thread) return 0;
    const [{ count: unread }] = await db.select({ count: count() }).from(supportMessages)
      .where(and(eq(supportMessages.threadId, thread.id), eq(supportMessages.isFromAdmin, true), eq(supportMessages.isRead, false)));
    return Number(unread);
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

  async getFinancialSummary(): Promise<any> {
    const allProviders = await db.select().from(providers);
    const allInvoices = await db.select().from(providerInvoices);

    const PLAN_PRICES: Record<string, number> = { free: 0, basic: 199, pro: 399, enterprise: 799 };

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
}

export const storage = new DatabaseStorage();
