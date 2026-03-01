import { eq, and, desc, sql, gte, lte, count } from "drizzle-orm";
import { db } from "./db";
import {
  providers, users, customers, contracts, invoices, equipment,
  ispConsultations, spcConsultations, antiFraudAlerts,
  type Provider, type InsertProvider,
  type User, type InsertUser,
  type Customer, type InsertCustomer,
  type Contract, type InsertContract,
  type Invoice, type InsertInvoice,
  type Equipment, type InsertEquipment,
  type IspConsultation, type InsertIspConsultation,
  type SpcConsultation, type InsertSpcConsultation,
  type AntiFraudAlert, type InsertAntiFraudAlert,
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
}

export const storage = new DatabaseStorage();
