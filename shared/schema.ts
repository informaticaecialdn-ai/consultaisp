import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, decimal, serial, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const providers = pgTable("providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  cnpj: text("cnpj").notNull().unique(),
  subdomain: text("subdomain").unique(),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  ispCredits: integer("isp_credits").notNull().default(50),
  spcCredits: integer("spc_credits").notNull().default(0),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  website: text("website"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("user"),
  providerId: integer("provider_id").references(() => providers.id),
  emailVerified: boolean("email_verified").notNull().default(false),
  verificationToken: text("verification_token"),
  verificationTokenExpiresAt: timestamp("verification_token_expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  name: text("name").notNull(),
  cpfCnpj: text("cpf_cnpj").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  cep: text("cep"),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  status: text("status").notNull().default("active"),
  paymentStatus: text("payment_status").notNull().default("current"),
  totalOverdueAmount: decimal("total_overdue_amount", { precision: 10, scale: 2 }).default("0"),
  maxDaysOverdue: integer("max_days_overdue").default(0),
  overdueInvoicesCount: integer("overdue_invoices_count").default(0),
  ispScore: integer("isp_score").default(100),
  riskTier: text("risk_tier").default("low"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  plan: text("plan").notNull(),
  value: decimal("value", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("active"),
  startDate: timestamp("start_date").defaultNow(),
  endDate: timestamp("end_date"),
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  value: decimal("value", { precision: 10, scale: 2 }).notNull(),
  dueDate: timestamp("due_date").notNull(),
  paidDate: timestamp("paid_date"),
  status: text("status").notNull().default("pending"),
});

export const equipment = pgTable("equipment", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customers.id),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  type: text("type").notNull(),
  brand: text("brand"),
  model: text("model"),
  serialNumber: text("serial_number"),
  mac: text("mac"),
  status: text("status").notNull().default("installed"),
  inRecoveryProcess: boolean("in_recovery_process").default(false),
  value: decimal("value", { precision: 10, scale: 2 }),
});

export const ispConsultations = pgTable("isp_consultations", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  userId: integer("user_id").notNull().references(() => users.id),
  cpfCnpj: text("cpf_cnpj").notNull(),
  searchType: text("search_type").notNull(),
  result: jsonb("result"),
  score: integer("score"),
  decisionReco: text("decision_reco"),
  cost: integer("cost").default(1),
  approved: boolean("approved"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const spcConsultations = pgTable("spc_consultations", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  userId: integer("user_id").notNull().references(() => users.id),
  cpfCnpj: text("cpf_cnpj").notNull(),
  result: jsonb("result"),
  score: integer("score"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const supportThreads = pgTable("support_threads", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  subject: text("subject").notNull().default("Suporte Geral"),
  status: text("status").notNull().default("open"),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const supportMessages = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull().references(() => supportThreads.id),
  senderId: integer("sender_id").notNull().references(() => users.id),
  senderName: text("sender_name").notNull(),
  content: text("content").notNull(),
  isFromAdmin: boolean("is_from_admin").notNull().default(false),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const planChanges = pgTable("plan_changes", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  oldPlan: text("old_plan"),
  newPlan: text("new_plan"),
  ispCreditsAdded: integer("isp_credits_added").default(0),
  spcCreditsAdded: integer("spc_credits_added").default(0),
  changedById: integer("changed_by_id").references(() => users.id),
  changedByName: text("changed_by_name"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const antiFraudAlerts = pgTable("anti_fraud_alerts", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  customerId: integer("customer_id").references(() => customers.id),
  consultingProviderId: integer("consulting_provider_id").references(() => providers.id),
  consultingProviderName: text("consulting_provider_name"),
  customerName: text("customer_name"),
  customerCpfCnpj: text("customer_cpf_cnpj"),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("medium"),
  message: text("message").notNull(),
  riskScore: integer("risk_score"),
  riskLevel: text("risk_level").default("low"),
  riskFactors: jsonb("risk_factors").$type<string[]>(),
  daysOverdue: integer("days_overdue").default(0),
  overdueAmount: decimal("overdue_amount", { precision: 10, scale: 2 }).default("0"),
  equipmentNotReturned: integer("equipment_not_returned").default(0),
  equipmentValue: decimal("equipment_value", { precision: 10, scale: 2 }).default("0"),
  recentConsultations: integer("recent_consultations").default(0),
  resolved: boolean("resolved").notNull().default(false),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const providerInvoices = pgTable("provider_invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  period: text("period").notNull(),
  planAtTime: text("plan_at_time").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  ispCreditsIncluded: integer("isp_credits_included").notNull().default(0),
  spcCreditsIncluded: integer("spc_credits_included").notNull().default(0),
  status: text("status").notNull().default("pending"),
  dueDate: timestamp("due_date").notNull(),
  paidDate: timestamp("paid_date"),
  paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }),
  notes: text("notes"),
  createdById: integer("created_by_id").references(() => users.id),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").defaultNow(),
  asaasChargeId: text("asaas_charge_id"),
  asaasCustomerId: text("asaas_customer_id"),
  asaasStatus: text("asaas_status"),
  asaasInvoiceUrl: text("asaas_invoice_url"),
  asaasBankSlipUrl: text("asaas_bank_slip_url"),
  asaasPixKey: text("asaas_pix_key"),
  asaasBillingType: text("asaas_billing_type"),
});

export const creditOrders = pgTable("credit_orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  providerName: text("provider_name").notNull(),
  packageName: text("package_name").notNull(),
  ispCredits: integer("isp_credits").notNull().default(0),
  spcCredits: integer("spc_credits").notNull().default(0),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  paymentMethod: text("payment_method"),
  asaasChargeId: text("asaas_charge_id"),
  asaasCustomerId: text("asaas_customer_id"),
  asaasStatus: text("asaas_status"),
  asaasInvoiceUrl: text("asaas_invoice_url"),
  asaasBankSlipUrl: text("asaas_bank_slip_url"),
  asaasPixKey: text("asaas_pix_key"),
  asaasBillingType: text("asaas_billing_type"),
  creditedAt: timestamp("credited_at"),
  notes: text("notes"),
  createdById: integer("created_by_id").references(() => users.id),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProviderSchema = createInsertSchema(providers).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true });
export const insertContractSchema = createInsertSchema(contracts).omit({ id: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true });
export const insertEquipmentSchema = createInsertSchema(equipment).omit({ id: true });
export const insertIspConsultationSchema = createInsertSchema(ispConsultations).omit({ id: true, createdAt: true });
export const insertSpcConsultationSchema = createInsertSchema(spcConsultations).omit({ id: true, createdAt: true });
export const insertAntiFraudAlertSchema = createInsertSchema(antiFraudAlerts).omit({ id: true, createdAt: true });

export type Provider = typeof providers.$inferSelect;
export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Contract = typeof contracts.$inferSelect;
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Equipment = typeof equipment.$inferSelect;
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type IspConsultation = typeof ispConsultations.$inferSelect;
export type InsertIspConsultation = z.infer<typeof insertIspConsultationSchema>;
export type SpcConsultation = typeof spcConsultations.$inferSelect;
export type InsertSpcConsultation = z.infer<typeof insertSpcConsultationSchema>;
export type AntiFraudAlert = typeof antiFraudAlerts.$inferSelect;
export type InsertAntiFraudAlert = z.infer<typeof insertAntiFraudAlertSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  providerName: z.string().min(2),
  cnpj: z.string().min(14),
  subdomain: z.string().min(3).max(30).regex(/^[a-z0-9-]+$/, "Apenas letras minusculas, numeros e hifens"),
});

export const updateProviderSchema = z.object({
  name: z.string().min(2).optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().optional(),
  website: z.string().optional(),
});

export const insertSupportThreadSchema = createInsertSchema(supportThreads).omit({ id: true, createdAt: true, lastMessageAt: true });
export const insertSupportMessageSchema = createInsertSchema(supportMessages).omit({ id: true, createdAt: true });
export const insertPlanChangeSchema = createInsertSchema(planChanges).omit({ id: true, createdAt: true });
export const insertProviderInvoiceSchema = createInsertSchema(providerInvoices).omit({ id: true, createdAt: true });
export const insertCreditOrderSchema = createInsertSchema(creditOrders).omit({ id: true, createdAt: true });

export type SupportThread = typeof supportThreads.$inferSelect;
export type InsertSupportThread = z.infer<typeof insertSupportThreadSchema>;
export type SupportMessage = typeof supportMessages.$inferSelect;
export type InsertSupportMessage = z.infer<typeof insertSupportMessageSchema>;
export type PlanChange = typeof planChanges.$inferSelect;
export type InsertPlanChange = z.infer<typeof insertPlanChangeSchema>;
export type ProviderInvoice = typeof providerInvoices.$inferSelect;
export type InsertProviderInvoice = z.infer<typeof insertProviderInvoiceSchema>;
export type CreditOrder = typeof creditOrders.$inferSelect;
export type InsertCreditOrder = z.infer<typeof insertCreditOrderSchema>;

export const CREDIT_PACKAGES = [
  { id: "basico",       name: "Basico",       ispCredits: 50,  spcCredits: 20,  price: 4990,  priceLabel: "R$ 49,90" },
  { id: "profissional", name: "Profissional",  ispCredits: 200, spcCredits: 100, price: 14990, priceLabel: "R$ 149,90", popular: true },
  { id: "enterprise",   name: "Enterprise",    ispCredits: 500, spcCredits: 300, price: 29990, priceLabel: "R$ 299,90" },
];

export const PLAN_PRICES: Record<string, number> = {
  free: 0,
  basic: 199,
  pro: 399,
  enterprise: 799,
};

export const PLAN_CREDITS: Record<string, { isp: number; spc: number }> = {
  free: { isp: 50, spc: 0 },
  basic: { isp: 200, spc: 50 },
  pro: { isp: 500, spc: 150 },
  enterprise: { isp: 1500, spc: 500 },
};

export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;
