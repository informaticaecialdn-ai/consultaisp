import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, decimal, serial, jsonb, uniqueIndex, index, date, numeric } from "drizzle-orm/pg-core";
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
  proactiveAlertsEnabled: boolean("proactive_alerts_enabled").default(true),
  proactiveAlertWebhookUrl: text("proactive_alert_webhook_url"),
  cidadesAtendidas: text("cidades_atendidas").array().default(sql`'{}'::text[]`),
  mesorregioes: text("mesorregioes").array().default(sql`'{}'::text[]`),
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
  phone: text("phone"),
  role: text("role").notNull().default("user"),
  providerId: integer("provider_id").references(() => providers.id),
  emailVerified: boolean("email_verified").notNull().default(false),
  verificationToken: text("verification_token"),
  verificationTokenExpiresAt: timestamp("verification_token_expires_at"),
  lgpdAcceptedAt: timestamp("lgpd_accepted_at"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  resetToken: text("reset_token"),
  resetTokenExpiresAt: timestamp("reset_token_expires_at"),
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
  addressNumber: text("address_number"),
  complement: text("complement"),
  neighborhood: text("neighborhood"),
  city: text("city"),
  state: text("state"),
  cep: text("cep"),
  addressHash: text("address_hash"),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  status: text("status").notNull().default("active"),
  paymentStatus: text("payment_status").notNull().default("current"),
  totalOverdueAmount: decimal("total_overdue_amount", { precision: 10, scale: 2 }).default("0"),
  maxDaysOverdue: integer("max_days_overdue").default(0),
  overdueInvoicesCount: integer("overdue_invoices_count").default(0),
  equipmentCount: integer("equipment_count").default(1),
  equipmentEstimatedValue: decimal("equipment_estimated_value", { precision: 10, scale: 2 }).default("290"),
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
  cpfCnpjHash: text("cpf_cnpj_hash"),
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
  creditType: text("credit_type").notNull().default("mixed"),
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
  phone: z.string().min(10, "Telefone invalido"),
  providerName: z.string().min(2),
  cnpj: z.string().min(14),
  subdomain: z.string().min(3).max(30).regex(/^[a-z0-9-]+$/, "Apenas letras minusculas, numeros e hifens"),
  lgpdAccepted: z.boolean().refine(v => v === true, { message: "Aceite dos termos LGPD obrigatorio" }),
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

export const ISP_CREDIT_PACKAGES = [
  { id: "isp-50",   name: "50 Consultas ISP",   credits: 50,   price: 4990,  priceLabel: "R$ 49,90",  perUnit: "R$ 1,00/consulta" },
  { id: "isp-100",  name: "100 Consultas ISP",  credits: 100,  price: 8990,  priceLabel: "R$ 89,90",  perUnit: "R$ 0,90/consulta", popular: true },
  { id: "isp-250",  name: "250 Consultas ISP",  credits: 250,  price: 19990, priceLabel: "R$ 199,90", perUnit: "R$ 0,80/consulta" },
  { id: "isp-500",  name: "500 Consultas ISP",  credits: 500,  price: 34990, priceLabel: "R$ 349,90", perUnit: "R$ 0,70/consulta" },
];

export const SPC_CREDIT_PACKAGES = [
  { id: "spc-10",   name: "10 Consultas SPC",   credits: 10,   price: 4990,  priceLabel: "R$ 49,90",  perUnit: "R$ 4,99/consulta" },
  { id: "spc-30",   name: "30 Consultas SPC",   credits: 30,   price: 12990, priceLabel: "R$ 129,90", perUnit: "R$ 4,33/consulta", popular: true },
  { id: "spc-50",   name: "50 Consultas SPC",   credits: 50,   price: 19990, priceLabel: "R$ 199,90", perUnit: "R$ 4,00/consulta" },
  { id: "spc-100",  name: "100 Consultas SPC",  credits: 100,  price: 34990, priceLabel: "R$ 349,90", perUnit: "R$ 3,50/consulta" },
];

export const CREDIT_PACKAGES = [...ISP_CREDIT_PACKAGES.map(p => ({ ...p, creditType: "isp" as const })), ...SPC_CREDIT_PACKAGES.map(p => ({ ...p, creditType: "spc" as const }))];

export const PLAN_PRICES: Record<string, number> = {
  free: 0,
  basic: 149,
  pro: 349,
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

export const titularRequests = pgTable("titular_requests", {
  id: serial("id").primaryKey(),
  cpfCnpj: text("cpf_cnpj").notNull(),
  nome: text("nome").notNull(),
  email: text("email").notNull(),
  tipoSolicitacao: text("tipo_solicitacao").notNull(),
  descricao: text("descricao"),
  protocolo: text("protocolo").notNull().unique(),
  status: text("status").notNull().default("pendente"),
  prazoLimite: timestamp("prazo_limite"),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at"),
  executionResult: jsonb("execution_result"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTitularRequestSchema = createInsertSchema(titularRequests).omit({ id: true, createdAt: true });
export type TitularRequest = typeof titularRequests.$inferSelect;
export type InsertTitularRequest = z.infer<typeof insertTitularRequestSchema>;

export const proactiveAlerts = pgTable("proactive_alerts", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  cpfCnpj: varchar("cpf_cnpj", { length: 20 }).notNull(),
  consultingProviderId: integer("consulting_provider_id").references(() => providers.id),
  channel: varchar("channel", { length: 20 }).notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
  acknowledged: boolean("acknowledged").default(false),
  acknowledgedAt: timestamp("acknowledged_at"),
});

export const insertProactiveAlertSchema = createInsertSchema(proactiveAlerts).omit({ id: true, sentAt: true });
export type ProactiveAlert = typeof proactiveAlerts.$inferSelect;
export type InsertProactiveAlert = z.infer<typeof insertProactiveAlertSchema>;

export const PLAN_CREDITS: Record<string, { isp: number; spc: number }> = {
  free: { isp: 50, spc: 0 },
  basic: { isp: 200, spc: 50 },
  pro: { isp: 500, spc: 150 },
  enterprise: { isp: 1500, spc: 500 },
};

export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;

// ============================================================
// SPEC 003 — WhatsApp + Júlia + Helena (autorizado 2026-05-11)
// ============================================================

// 1. communications — toda comunicação inbound/outbound
export const communications = pgTable("communications", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  channel: varchar("channel", { length: 20 }).notNull(),
  direction: varchar("direction", { length: 20 }).notNull(),
  templateName: text("template_name"),
  content: text("content").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  externalMessageId: text("external_message_id"),
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
  agentId: text("agent_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  providerCustomerCreatedIdx: index("communications_provider_customer_created_idx").on(t.providerId, t.customerId, t.createdAt),
  externalMessageIdIdx: index("communications_external_message_id_idx").on(t.externalMessageId),
}));

// 2. audit_logs — APPEND-ONLY via trigger Postgres
export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  resourceId: text("resource_id").notNull(),
  actorType: varchar("actor_type", { length: 20 }).notNull(),
  actorId: text("actor_id"),
  actorName: text("actor_name"),
  payload: jsonb("payload"),
  legalBasis: text("legal_basis"),
  legalReferences: text("legal_references").array().default(sql`'{}'::text[]`),
  notificationProof: jsonb("notification_proof"),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  providerOccurredIdx: index("audit_logs_provider_occurred_idx").on(t.providerId, t.occurredAt),
  providerResourceIdx: index("audit_logs_provider_resource_idx").on(t.providerId, t.resource, t.resourceId),
}));

// 3. agent_memories — memória persistente (customer × agent)
export const agentMemories = pgTable("agent_memories", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  agentId: text("agent_id").notNull(),
  facts: jsonb("facts").default(sql`'[]'::jsonb`),
  promises: jsonb("promises").default(sql`'[]'::jsonb`),
  topics: text("topics").array().default(sql`'{}'::text[]`),
  sentimentHistory: jsonb("sentiment_history").default(sql`'[]'::jsonb`),
  summary: text("summary"),
  lastInteractionAt: timestamp("last_interaction_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  customerAgentUnique: uniqueIndex("agent_memories_customer_agent_uq").on(t.customerId, t.agentId),
}));

// 4. compliance_checks — cada validação Júlia
export const complianceChecks = pgTable("compliance_checks", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  agentId: text("agent_id"),
  proposedAction: jsonb("proposed_action").notNull(),
  decision: varchar("decision", { length: 30 }).notNull(),
  legalBasis: text("legal_basis"),
  legalReferences: text("legal_references").array().default(sql`'{}'::text[]`),
  adjustments: jsonb("adjustments"),
  blockingReasons: text("blocking_reasons").array(),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  providerCreatedIdx: index("compliance_checks_provider_created_idx").on(t.providerId, t.createdAt),
  customerDecisionIdx: index("compliance_checks_customer_decision_idx").on(t.customerId, t.decision),
}));

// 5. agreements — acordos de pagamento (Rafael/Daniel)
export const agreements = pgTable("agreements", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  invoiceIds: integer("invoice_ids").array().notNull(),
  type: varchar("type", { length: 30 }).notNull(),
  totalValue: decimal("total_value", { precision: 10, scale: 2 }).notNull(),
  discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }).default("0"),
  installments: jsonb("installments").default(sql`'[]'::jsonb`),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  agreedAt: timestamp("agreed_at").notNull().defaultNow(),
  expectedFulfillmentAt: timestamp("expected_fulfillment_at"),
  fulfilledAt: timestamp("fulfilled_at"),
  brokenAt: timestamp("broken_at"),
  agentId: text("agent_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  providerCreatedIdx: index("agreements_provider_created_idx").on(t.providerId, t.createdAt),
  customerStatusIdx: index("agreements_customer_status_idx").on(t.customerId, t.status),
}));

// 6. whatsapp_accounts — Meta Cloud API por tenant (1:1)
export const whatsappAccounts = pgTable("whatsapp_accounts", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().unique().references(() => providers.id),
  wabaId: text("waba_id").notNull().unique(),
  phoneNumberId: text("phone_number_id").notNull().unique(),
  displayName: text("display_name"),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  wabaStatus: varchar("waba_status", { length: 20 }).default("pending"),
  qualityRating: varchar("quality_rating", { length: 10 }),
  verifiedAt: timestamp("verified_at"),
  tokenExpiresAt: timestamp("token_expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Auxiliar: whatsapp_optouts (opt-out permanente "PARAR")
export const whatsappOptouts = pgTable("whatsapp_optouts", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  phoneNumber: text("phone_number").notNull(),
  optedOutAt: timestamp("opted_out_at").defaultNow(),
  reason: text("reason"),
  isPermanent: boolean("is_permanent").default(true),
}, (t) => ({
  uniqueProviderPhone: uniqueIndex("whatsapp_optouts_provider_phone_uq").on(t.providerId, t.phoneNumber),
}));

// Insert schemas + types
export const insertCommunicationSchema = createInsertSchema(communications).omit({ id: true, createdAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true, occurredAt: true });
export const insertAgentMemorySchema = createInsertSchema(agentMemories).omit({ id: true, updatedAt: true });
export const insertComplianceCheckSchema = createInsertSchema(complianceChecks).omit({ id: true, createdAt: true });
export const insertAgreementSchema = createInsertSchema(agreements).omit({ id: true, createdAt: true });
export const insertWhatsappAccountSchema = createInsertSchema(whatsappAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWhatsappOptoutSchema = createInsertSchema(whatsappOptouts).omit({ id: true, optedOutAt: true });

export type Communication = typeof communications.$inferSelect;
export type InsertCommunication = z.infer<typeof insertCommunicationSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AgentMemory = typeof agentMemories.$inferSelect;
export type InsertAgentMemory = z.infer<typeof insertAgentMemorySchema>;
export type ComplianceCheck = typeof complianceChecks.$inferSelect;
export type InsertComplianceCheck = z.infer<typeof insertComplianceCheckSchema>;
export type Agreement = typeof agreements.$inferSelect;
export type InsertAgreement = z.infer<typeof insertAgreementSchema>;
export type WhatsappAccount = typeof whatsappAccounts.$inferSelect;
export type InsertWhatsappAccount = z.infer<typeof insertWhatsappAccountSchema>;
export type WhatsappOptout = typeof whatsappOptouts.$inferSelect;
export type InsertWhatsappOptout = z.infer<typeof insertWhatsappOptoutSchema>;

// ============================================================================
// SPEC 004 — Bruno (preventivo) + Sofia (agradecimento) + Pix dinâmico
// Schema autorizado pelo owner em 2026-05-11.
// Multi-tenant invariante: toda tabela tem provider_id (Princípio I).
// ============================================================================

// 1) asaas_accounts — credenciais Asaas por tenant (1:1)
export const asaasAccounts = pgTable("asaas_accounts", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().unique().references(() => providers.id),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  webhookTokenEncrypted: text("webhook_token_encrypted"),
  mode: varchar("mode", { length: 10 }).notNull().default("sandbox"),
  accountStatus: varchar("account_status", { length: 20 }).notNull().default("pending"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 2) pix_charges — Pix dinâmico gerado por Bruno
export const pixCharges = pgTable("pix_charges", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  asaasPaymentId: text("asaas_payment_id").notNull().unique(),
  value: numeric("value", { precision: 12, scale: 2 }).notNull(),
  dueDate: date("due_date").notNull(),
  pixQrCodeBase64: text("pix_qr_code_base64"),
  pixCopyPaste: text("pix_copy_paste"),
  pixExpiresAt: timestamp("pix_expires_at"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  paidAt: timestamp("paid_at"),
  cancelledAt: timestamp("cancelled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  providerStatusIdx: index("pix_charges_provider_status_idx").on(t.providerId, t.status),
  invoiceIdx: index("pix_charges_invoice_idx").on(t.invoiceId),
  providerDueDateIdx: index("pix_charges_provider_due_idx").on(t.providerId, t.dueDate),
}));

// 3) payment_events — audit dos webhooks Asaas, idempotência por (provider, payment, event)
export const paymentEvents = pgTable("payment_events", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  asaasPaymentId: text("asaas_payment_id").notNull(),
  eventType: varchar("event_type", { length: 40 }).notNull(),
  externalEventId: text("external_event_id"),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  processingStatus: varchar("processing_status", { length: 20 }).notNull().default("processed"),
  rejectionReason: text("rejection_reason"),
  sofiaJobId: text("sofia_job_id"),
}, (t) => ({
  uniqueProviderPaymentEvent: uniqueIndex("payment_events_provider_payment_event_uq")
    .on(t.providerId, t.asaasPaymentId, t.eventType),
  receivedAtIdx: index("payment_events_received_at_idx").on(t.receivedAt),
  processingStatusIdx: index("payment_events_processing_status_idx").on(t.processingStatus),
}));

// 4) agent_toggles — bruno/sofia on/off + janela horária por tenant
export const agentToggles = pgTable("agent_toggles", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().unique().references(() => providers.id),
  brunoAtivo: boolean("bruno_ativo").notNull().default(false),
  sofiaAtiva: boolean("sofia_ativa").notNull().default(false),
  schedulerHoraLocal: varchar("scheduler_hora_local", { length: 8 }).notNull().default("09:00:00"),
  janelaInicio: varchar("janela_inicio", { length: 8 }).notNull().default("08:00:00"),
  janelaFim: varchar("janela_fim", { length: 8 }).notNull().default("20:00:00"),
  permiteSabado: boolean("permite_sabado").notNull().default(true),
  permiteDomingo: boolean("permite_domingo").notNull().default(false),
  templateBrunoNome: text("template_bruno_nome"),
  templateSofiaNome: text("template_sofia_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 5) outbound_attempts — estado da régua (intenção + Júlia decision + retry)
export const outboundAttempts = pgTable("outbound_attempts", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  invoiceId: integer("invoice_id").references(() => invoices.id),
  pixChargeId: integer("pix_charge_id").references(() => pixCharges.id),
  agentId: varchar("agent_id", { length: 40 }).notNull(),
  step: varchar("step", { length: 20 }).notNull(),
  scheduledFor: timestamp("scheduled_for").notNull(),
  status: varchar("status", { length: 30 }).notNull().default("scheduled"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at"),
  complianceCheckId: text("compliance_check_id"),
  communicationId: integer("communication_id"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  providerStatusScheduledIdx: index("outbound_attempts_provider_status_scheduled_idx")
    .on(t.providerId, t.status, t.scheduledFor),
  statusNextRetryIdx: index("outbound_attempts_status_next_retry_idx")
    .on(t.status, t.nextRetryAt),
  // UNIQUE (invoice_id, step, scheduled_for::date) criado via SQL raw na migration
}));

// Spec 004 — insert schemas + types
export const insertAsaasAccountSchema = createInsertSchema(asaasAccounts).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertPixChargeSchema = createInsertSchema(pixCharges).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertPaymentEventSchema = createInsertSchema(paymentEvents).omit({
  id: true, receivedAt: true,
});
export const insertAgentTogglesSchema = createInsertSchema(agentToggles).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertOutboundAttemptSchema = createInsertSchema(outboundAttempts).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type AsaasAccount = typeof asaasAccounts.$inferSelect;
export type InsertAsaasAccount = z.infer<typeof insertAsaasAccountSchema>;
export type PixCharge = typeof pixCharges.$inferSelect;
export type InsertPixCharge = z.infer<typeof insertPixChargeSchema>;
export type PaymentEvent = typeof paymentEvents.$inferSelect;
export type InsertPaymentEvent = z.infer<typeof insertPaymentEventSchema>;
export type AgentToggles = typeof agentToggles.$inferSelect;
export type InsertAgentToggles = z.infer<typeof insertAgentTogglesSchema>;
export type OutboundAttempt = typeof outboundAttempts.$inferSelect;
export type InsertOutboundAttempt = z.infer<typeof insertOutboundAttemptSchema>;

// ═══════════════════════════════════════════════════════════════════════
// Spec 008.5 — MCP ERP Wrapper · Bearer tokens
//
// Anthropic Managed Agents conectam a MCP servers externos via Vault com
// auth `static_bearer` (NÃO OAuth/JWT — confirmado pela doc oficial).
// Owner gera token aqui no superadmin, copia para credential do Vault na
// platform.claude.com, agent invoca MCP server com Authorization: Bearer.
//
// Multi-tenant: cada token pertence a 1 tenant. Bearer chega no MCP →
// resolve providerId pelo hash → todas as queries filtram automático.
//
// Token mostrado UMA VEZ na criação. Apenas hash persiste (scrypt — mesmo
// padrão de server/password.ts).
//
// Auditoria de tool calls: vai em audit_logs com actor_type="mcp".
// ═══════════════════════════════════════════════════════════════════════
export const mcpBearerTokens = pgTable("mcp_bearer_tokens", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  /** Hash scrypt do bearer token (formato salt:derivedKey, mesmo padrão de password.ts) */
  tokenHash: text("token_hash").notNull(),
  /** Prefixo público "mcp_xxxxxxxx" (8 chars após "mcp_") — usado no UI sem expor o token completo */
  tokenPrefix: text("token_prefix").notNull(),
  /** Descrição livre, ex: "Bruno production agent · Vertical Fibra" */
  name: text("name").notNull(),
  /** Scopes: ['read'] (default) ou ['read','read_pii']. Controla mascaramento de PII em erp_get_customer */
  allowedScopes: text("allowed_scopes").array().notNull().default(sql`'{read}'::text[]`),
  /** Subset de tools permitidas; null = todas */
  allowedTools: text("allowed_tools").array(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /** Última vez que o bearer foi usado em request MCP (para detectar tokens dormentes) */
  lastUsedAt: timestamp("last_used_at"),
  /** Soft delete: revogado != deletado para preservar audit trail */
  revokedAt: timestamp("revoked_at"),
}, (t) => ({
  providerIdx: index("mcp_bearer_tokens_provider_idx").on(t.providerId),
  prefixIdx: index("mcp_bearer_tokens_prefix_idx").on(t.tokenPrefix),
}));

export const insertMcpBearerTokenSchema = createInsertSchema(mcpBearerTokens).omit({
  id: true, createdAt: true, lastUsedAt: true, revokedAt: true,
});

export type McpBearerToken = typeof mcpBearerTokens.$inferSelect;
export type InsertMcpBearerToken = z.infer<typeof insertMcpBearerTokenSchema>;

// ═══════════════════════════════════════════════════════════════════════
// Spec 008.6 — Managed Agents migration tracker
// AUTORIZADO em specs/008-6-migrate-agents-to-managed/spec.md §Schema NOVO
// Rastreia toda invocação dos 4 agentes (Júlia/Bruno/Helena/Sofia) para:
//   1. Comparar paridade direct vs managed em modo shadow
//   2. Auditoria + custo Managed Agents
//   3. Telemetria no /admin-sistema#time-digital
// ═══════════════════════════════════════════════════════════════════════
export const agentInvocations = pgTable("agent_invocations", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  /** Nome interno: "julia" | "bruno" | "helena" | "sofia" (futuramente também marcos/rafael/etc.) */
  agentId: text("agent_id").notNull(),
  /** Runtime executado: "direct" | "managed" | "shadow" */
  runtime: text("runtime").notNull(),
  /** ID da session na platform.claude.com (sess_xxx) — null em modo direct */
  anthropicSessionId: text("anthropic_session_id"),
  /** ID do agent na platform.claude.com (agt_xxx) — null em modo direct */
  anthropicAgentId: text("anthropic_agent_id"),
  /** Hash do input para deduplicar comparações shadow */
  inputHash: text("input_hash"),
  /** Output shape específico do agente (JuliaDecision, BrunoResult, etc.) */
  outputJson: jsonb("output_json"),
  tokensInput: integer("tokens_input"),
  tokensOutput: integer("tokens_output"),
  latencyMs: integer("latency_ms"),
  /** "ok" | "error" | "timeout" | "diff" (último para shadow quando direct!=managed) */
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  /** Cruza com communications/audit_logs/compliance_checks via correlationId */
  correlationId: text("correlation_id"),
  /** Em shadow: aponta para a linha do par (a outra runtime do mesmo input). */
  pairedInvocationId: integer("paired_invocation_id"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
}, (t) => ({
  providerAgentTimeIdx: index("agent_invocations_provider_agent_time_idx").on(t.providerId, t.agentId, t.startedAt),
  correlationIdx: index("agent_invocations_correlation_idx").on(t.correlationId),
  runtimeIdx: index("agent_invocations_runtime_idx").on(t.runtime),
}));

export const insertAgentInvocationSchema = createInsertSchema(agentInvocations).omit({
  id: true, startedAt: true,
});

export type AgentInvocation = typeof agentInvocations.$inferSelect;
export type InsertAgentInvocation = z.infer<typeof insertAgentInvocationSchema>;
