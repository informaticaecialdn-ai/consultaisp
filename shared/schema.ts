import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, decimal, serial, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const providers = pgTable("providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tradeName: text("trade_name"),
  cnpj: text("cnpj").notNull().unique(),
  legalType: text("legal_type"),
  openingDate: text("opening_date"),
  businessSegment: text("business_segment"),
  subdomain: text("subdomain").unique(),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  verificationStatus: text("verification_status").notNull().default("pending"),
  ispCredits: integer("isp_credits").notNull().default(50),
  spcCredits: integer("spc_credits").notNull().default(0),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  website: text("website"),
  addressZip: text("address_zip"),
  addressStreet: text("address_street"),
  addressNumber: text("address_number"),
  addressComplement: text("address_complement"),
  addressNeighborhood: text("address_neighborhood"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  webhookToken: text("webhook_token"),
  n8nWebhookUrl: text("n8n_webhook_url"),
  n8nAuthToken: text("n8n_auth_token"),
  n8nEnabled: boolean("n8n_enabled").default(false),
  n8nErpProvider: text("n8n_erp_provider"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const providerPartners = pgTable("provider_partners", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  name: text("name").notNull(),
  cpf: text("cpf").notNull(),
  birthDate: text("birth_date"),
  email: text("email"),
  phone: text("phone"),
  role: text("role"),
  sharePercentage: decimal("share_percentage", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const providerDocuments = pgTable("provider_documents", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  documentType: text("document_type").notNull(),
  documentName: text("document_name").notNull(),
  documentMimeType: text("document_mime_type"),
  documentSize: integer("document_size"),
  fileData: text("file_data").notNull(),
  status: text("status").notNull().default("pending"),
  rejectionReason: text("rejection_reason"),
  uploadedById: integer("uploaded_by_id").references(() => providers.id),
  reviewedById: integer("reviewed_by_id"),
  reviewerName: text("reviewer_name"),
  reviewedAt: timestamp("reviewed_at"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
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
  erpSource: text("erp_source").default("manual"),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const erpIntegrations = pgTable("erp_integrations", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  erpSource: text("erp_source").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  status: text("status").notNull().default("idle"),
  totalSynced: integer("total_synced").notNull().default(0),
  totalErrors: integer("total_errors").notNull().default(0),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: text("last_sync_status"),
  notes: text("notes"),
  apiUrl: text("api_url"),
  apiToken: text("api_token"),
  apiUser: text("api_user"),
  syncIntervalHours: integer("sync_interval_hours").notNull().default(24),
  createdAt: timestamp("created_at").defaultNow(),
});

export const erpSyncLogs = pgTable("erp_sync_logs", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  erpSource: text("erp_source").notNull(),
  syncedAt: timestamp("synced_at").defaultNow(),
  upserted: integer("upserted").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  status: text("status").notNull().default("success"),
  ipAddress: text("ip_address"),
  payload: jsonb("payload"),
  syncType: text("sync_type").notNull().default("manual"),
  recordsProcessed: integer("records_processed").notNull().default(0),
  recordsFailed: integer("records_failed").notNull().default(0),
});

export type ErpIntegration = typeof erpIntegrations.$inferSelect;
export type InsertErpIntegration = typeof erpIntegrations.$inferInsert;
export type ErpSyncLog = typeof erpSyncLogs.$inferSelect;

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
export const insertProviderPartnerSchema = createInsertSchema(providerPartners).omit({ id: true, createdAt: true });
export const insertProviderDocumentSchema = createInsertSchema(providerDocuments).omit({ id: true, uploadedAt: true });

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
export type ProviderPartner = typeof providerPartners.$inferSelect;
export type InsertProviderPartner = z.infer<typeof insertProviderPartnerSchema>;
export type ProviderDocument = typeof providerDocuments.$inferSelect;
export type InsertProviderDocument = z.infer<typeof insertProviderDocumentSchema>;

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

export const erpCatalog = pgTable("erp_catalog", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  logoBase64: text("logo_base64"),
  gradient: text("gradient").notNull().default("from-slate-500 to-slate-600"),
  active: boolean("active").notNull().default(true),
  authType: text("auth_type").notNull().default("bearer"),
  authHint: text("auth_hint"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertErpCatalogSchema = createInsertSchema(erpCatalog).omit({ id: true, createdAt: true });
export type InsertErpCatalog = z.infer<typeof insertErpCatalogSchema>;
export type ErpCatalog = typeof erpCatalog.$inferSelect;

export const visitorChats = pgTable("visitor_chats", {
  id: serial("id").primaryKey(),
  visitorName: text("visitor_name").notNull(),
  visitorEmail: text("visitor_email").notNull(),
  visitorPhone: text("visitor_phone"),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("open"),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const visitorChatMessages = pgTable("visitor_chat_messages", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").notNull().references(() => visitorChats.id),
  content: text("content").notNull(),
  isFromAdmin: boolean("is_from_admin").notNull().default(false),
  senderName: text("sender_name").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type VisitorChat = typeof visitorChats.$inferSelect;
export type VisitorChatMessage = typeof visitorChatMessages.$inferSelect;

export const PLAN_CREDITS: Record<string, { isp: number; spc: number }> = {
  free: { isp: 50, spc: 0 },
  basic: { isp: 200, spc: 50 },
  pro: { isp: 500, spc: 150 },
  enterprise: { isp: 1500, spc: 500 },
};

export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;
