import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, decimal, serial, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Marca white label — a "pele" que um revendedor veste sobre o mesmo bureau.
 *
 * NAO e um tenant. O isolamento de dados continua sendo `providerId`; a marca so
 * decide como o sistema se APRESENTA: nome, logo, cor, dominio, remetente de
 * e-mail. Todos os provedores, de todas as marcas, alimentam e leem a MESMA
 * base — que e o produto. Revendedor com base propria venderia base vazia.
 *
 * A marca e entidade propria, e nao um punhado de colunas em `providers`,
 * porque assim os dois casos cabem na mesma estrutura: um revendedor com 10
 * ISPs e uma marca com 10 provedores apontando pra ela; um ISP grande que quer
 * a propria cara e uma marca com um provedor so.
 */
export const marcas = pgTable("marcas", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  ativo: boolean("ativo").notNull().default(true),

  // ── Identidade ───────────────────────────────────────────────────────────
  /** Substitui "Consulta ISP" onde a string e a MARCA da plataforma. Onde ela e
   *  o nome do TIPO DE CONSULTA (ao lado de Consulta SPC e Cadastral), fica. */
  nomeProduto: text("nome_produto").notNull(),
  assinatura: text("assinatura"),

  // ── Dominio proprio ──────────────────────────────────────────────────────
  /**
   * `dominioStatus` so vira "ativo" depois que o certificado foi emitido no
   * servidor por script/dominio-whitelabel.sh. A aplicacao NAO emite
   * certificado — entao ela tambem nao pode afirmar que o dominio funciona.
   */
  dominio: text("dominio").unique(),
  dominioStatus: text("dominio_status").notNull().default("pendente"),

  // ── Visual ───────────────────────────────────────────────────────────────
  /**
   * SVG e o formato preferido: nitido em qualquer tamanho e colore por variavel
   * no tema escuro. PNG e aceito, mas NAO acompanha o tema escuro — logo claro
   * some no fundo escuro, e nao ha o que fazer sobre isso num bitmap.
   *
   * O SVG NUNCA e embutido na pagina: e servido por URL e carregado em <img>,
   * onde o navegador desliga script por especificacao. Essa garantia vale mais
   * que um sanitizador de allowlist escrito a mao, que e notoriamente furado.
   * Ver server/routes/marca.routes.ts.
   */
  logoSvg: text("logo_svg"),
  logoPng: text("logo_png"),
  faviconSvg: text("favicon_svg"),

  /**
   * UMA cor por tema. Hover, soft e ink saem derivadas em
   * server/utils/marca-cores.ts — pedir quatro tons harmonicos a um revendedor
   * produz paleta ruim, e a derivacao acerta sempre.
   *
   * `corBrandDark` e opcional: sem ela, a clara e clareada ate passar AA sobre
   * o fundo escuro, como manda o DESIGN_SYSTEM ("semanticas clareiam no dark;
   * nunca reuse o hex do light").
   */
  corBrand: text("cor_brand").notNull().default("#4A4670"),
  corBrandDark: text("cor_brand_dark"),

  // ── E-mail ───────────────────────────────────────────────────────────────
  /**
   * `emailRemetente` so pode ser usado se o dominio estiver verificado no
   * Resend. Nulo = sai do dominio verificado da plataforma, com o nome de
   * exibicao da marca. Isso APARECE no cabecalho pro destinatario.
   */
  emailRemetente: text("email_remetente"),
  emailNomeExibicao: text("email_nome_exibicao"),

  // ── Suporte ──────────────────────────────────────────────────────────────
  suporteEmail: text("suporte_email"),
  suporteWhatsapp: text("suporte_whatsapp"),
  site: text("site"),

  // ── LGPD ─────────────────────────────────────────────────────────────────
  /**
   * Quem responde pelo tratamento perante o titular. Se o cliente final comprou
   * da "CredNet" e a tela de consentimento diz outro nome, ele nao sabe a quem
   * esta consentindo — e o consentimento e defeituoso. Por isso o white label
   * NAO pode ser invisivel aqui: o texto nomeia o controlador de verdade, com a
   * plataforma nomeada como operadora.
   */
  responsavelRazaoSocial: text("responsavel_razao_social"),
  responsavelCnpj: text("responsavel_cnpj"),

  createdAt: timestamp("created_at").defaultNow(),
});

export const providers = pgTable("providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tradeName: text("trade_name"),
  cnpj: text("cnpj").notNull().unique(),
  legalType: text("legal_type"),
  openingDate: text("opening_date"),
  businessSegment: text("business_segment"),
  subdomain: text("subdomain").unique(),
  /**
   * Marca white label que este provedor veste. Nulo = marca da plataforma.
   *
   * Fica ao lado de `subdomain` de proposito: sao as DUAS formas de chegar a
   * este tenant pelo host. O login aceita as duas como prova de pertencimento
   * (o subdominio do provedor, ou o dominio da marca dele) e NENHUMA outra.
   */
  marcaId: integer("marca_id").references(() => marcas.id),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  verificationStatus: text("verification_status").notNull().default("pending"),
  ispCredits: integer("isp_credits").notNull().default(50),
  spcCredits: integer("spc_credits").notNull().default(0),
  bigdataCredits: integer("bigdata_credits").notNull().default(0),
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
  /**
   * Cidades que o provedor tirou do mapa da carteira na mao.
   *
   * NAO e o contrario de `cidadesAtendidas`: aquela declara onde ele vende e
   * governa o modo Regionalizacao, que traz dado de outros provedores. Esta
   * so esconde ponto no mapa dele mesmo — para o caso do endereco de cobranca
   * numa capital, que passa o corte de 20 clientes e nao e praca.
   */
  cidadesExcluidasDoMapa: text("cidades_excluidas_do_mapa").array().default(sql`'{}'::text[]`),
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
  /**
   * Procedencia da coordenada — ver shared/geo-precisao.ts. `erp`, `endereco`,
   * `logradouro`, `cep` ou `bairro` (aproximacao, desenhada translucida).
   * Nula em ponto gravado antes da coluna existir ou de origem desconhecida.
   * Migracao 0010. Autorizado pelo dono em 02/09/2026 ("fazer igual" ao
   * Provedor.ai, que tem geo_precisao).
   */
  geoPrecisao: text("geo_precisao"),
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
  // Credenciais que 4 dos 6 conectores exigem e que ate aqui nao tinham onde
  // morar. O codigo inteiro ja as lia — buildConnectorConfig, SENSITIVE_FIELDS,
  // o Zod da rota, o handleSave da tela — mas a tabela nao as declarava, entao o
  // Drizzle montava `set "api_token" = $1` e descartava o resto sem erro: a tela
  // aceitava a contra-senha do MK, dizia "salvo", e o valor sumia.
  // mkContraSenha e clientSecret entram criptografados (ver SENSITIVE_FIELDS em
  // server/storage/erp.storage.ts); clientId e identificador, nao segredo.
  mkContraSenha: text("mk_contra_senha"),
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  // Extras nao-secretos por ERP: sgpApp (SGP), voalleClientId (Voalle).
  extraConfig: jsonb("extra_config"),
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
  assetTag: text("asset_tag"),
  type: text("type").notNull(),
  brand: text("brand"),
  model: text("model"),
  serialNumber: text("serial_number"),
  mac: text("mac"),
  status: text("status").notNull().default("em_comodato"),
  inRecoveryProcess: boolean("in_recovery_process").default(false),
  value: decimal("value", { precision: 10, scale: 2 }),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const equipmentRecoveryCases = pgTable("equipment_recovery_cases", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  equipmentId: integer("equipment_id").notNull().references(() => equipment.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  status: text("status").notNull().default("pre_recuperacao"),
  priority: text("priority").notNull().default("normal"),
  terminationDate: timestamp("termination_date").notNull(),
  deadlineAt: timestamp("deadline_at").notNull(),
  scheduledAt: timestamp("scheduled_at"),
  collectionMethod: text("collection_method"),
  assignedToUserId: integer("assigned_to_user_id").references(() => users.id),
  proofReference: text("proof_reference"),
  customerNotifiedAt: timestamp("customer_notified_at"),
  notificationProtocol: text("notification_protocol"),
  evidenceValidatedAt: timestamp("evidence_validated_at"),
  evidenceValidatedById: integer("evidence_validated_by_id").references(() => users.id),
  bureauStatus: text("bureau_status").notNull().default("candidato"),
  disputedAt: timestamp("disputed_at"),
  disputeReason: text("dispute_reason"),
  closedAt: timestamp("closed_at"),
  notes: text("notes"),
  createdById: integer("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const equipmentRecoveryEvents = pgTable("equipment_recovery_events", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  caseId: integer("case_id").notNull().references(() => equipmentRecoveryCases.id),
  userId: integer("user_id").references(() => users.id),
  type: text("type").notNull(),
  channel: text("channel"),
  result: text("result"),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  occurredAt: timestamp("occurred_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
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

/**
 * Credencial da BigDataCorp por provedor. Um usuario de integracao por tenant:
 * consumo e custo aparecem separados tambem do lado do bureau.
 * login e password sao gravados com encryptField (ver server/utils/crypto.ts) e
 * nunca saem do servidor — a rota devolve a senha mascarada.
 */
export const bigdataIntegrations = pgTable("bigdata_integrations", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  login: text("login"),
  password: text("password"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  lastCheckAt: timestamp("last_check_at"),
  lastCheckStatus: text("last_check_status"),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Consulta cadastral. datasets[] registra quais foram chamados naquela consulta —
 * sem isso, quando o custo subir ninguem sabe qual dataset e o caro.
 */
export const bigdataConsultations = pgTable("bigdata_consultations", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  userId: integer("user_id").notNull().references(() => users.id),
  cpfCnpj: text("cpf_cnpj").notNull(),
  result: jsonb("result"),
  datasets: text("datasets").array(),
  veredito: text("veredito"),
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
  bigdataCreditsAdded: integer("bigdata_credits_added").default(0),
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
  bigdataCreditsIncluded: integer("bigdata_credits_included").notNull().default(0),
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
  bigdataCredits: integer("bigdata_credits").notNull().default(0),
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

export const insertMarcaSchema = createInsertSchema(marcas).omit({ id: true, createdAt: true });
export const insertProviderSchema = createInsertSchema(providers).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true });
export const insertContractSchema = createInsertSchema(contracts).omit({ id: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true });
export const insertEquipmentSchema = createInsertSchema(equipment).omit({ id: true });
export const insertEquipmentRecoveryCaseSchema = createInsertSchema(equipmentRecoveryCases).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEquipmentRecoveryEventSchema = createInsertSchema(equipmentRecoveryEvents).omit({ id: true, createdAt: true });
export const insertIspConsultationSchema = createInsertSchema(ispConsultations).omit({ id: true, createdAt: true });
export const insertSpcConsultationSchema = createInsertSchema(spcConsultations).omit({ id: true, createdAt: true });
export const insertBigdataIntegrationSchema = createInsertSchema(bigdataIntegrations).omit({ id: true, createdAt: true });
export const insertBigdataConsultationSchema = createInsertSchema(bigdataConsultations).omit({ id: true, createdAt: true });
export const insertAntiFraudAlertSchema = createInsertSchema(antiFraudAlerts).omit({ id: true, createdAt: true });

export type Marca = typeof marcas.$inferSelect;
export type InsertMarca = z.infer<typeof insertMarcaSchema>;
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
export type EquipmentRecoveryCase = typeof equipmentRecoveryCases.$inferSelect;
export type InsertEquipmentRecoveryCase = z.infer<typeof insertEquipmentRecoveryCaseSchema>;
export type EquipmentRecoveryEvent = typeof equipmentRecoveryEvents.$inferSelect;
export type InsertEquipmentRecoveryEvent = z.infer<typeof insertEquipmentRecoveryEventSchema>;
export type IspConsultation = typeof ispConsultations.$inferSelect;
export type InsertIspConsultation = z.infer<typeof insertIspConsultationSchema>;
export type SpcConsultation = typeof spcConsultations.$inferSelect;
export type InsertSpcConsultation = z.infer<typeof insertSpcConsultationSchema>;
export type BigdataIntegration = typeof bigdataIntegrations.$inferSelect;
export type InsertBigdataIntegration = z.infer<typeof insertBigdataIntegrationSchema>;
export type BigdataConsultation = typeof bigdataConsultations.$inferSelect;
export type InsertBigdataConsultation = z.infer<typeof insertBigdataConsultationSchema>;
export type AntiFraudAlert = typeof antiFraudAlerts.$inferSelect;
export type InsertAntiFraudAlert = z.infer<typeof insertAntiFraudAlertSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

/**
 * O cadastro acontece em tres etapas na tela (empresa, responsavel, acesso),
 * mas chega aqui de uma vez so: o POST e o ultimo passo. Etapa incompleta nao
 * cria nada — nao existe provedor meio cadastrado no banco.
 *
 * `name` e `phone` sao do RESPONSAVEL: o nome vai para o usuario que loga, e o
 * telefone e o WhatsApp dele, obrigatorio porque e o canal que funciona quando
 * o e-mail nao chega.
 */
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  phone: z.string().min(10, "WhatsApp invalido"),
  /** CPF do responsavel. Guardado em `provider_partners`, nao em `users`. */
  responsavelCpf: z.string().min(11, "CPF invalido"),
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

/**
 * CREDITO UNICO, VALIDO PARA TODA CONSULTA DO SISTEMA.
 *
 * Antes existiam tres bolsos separados — isp_credits, spc_credits e
 * bigdata_credits — cada um com o proprio pacote e a propria tabela de preco.
 * Na pratica isso produzia o defeito que o provedor via na tela: saldo de 187
 * creditos e a Consulta Cadastral respondendo "saldo insuficiente, voce tem 0",
 * porque ela debitava de um bolso que ninguem nunca comprou.
 *
 * Agora ha um saldo so. O que varia e QUANTOS creditos cada consulta consome,
 * nao de onde ela tira. O saldo vive em `providers.isp_credits`, que virou o
 * campo universal — as outras duas colunas foram zeradas e somadas nela pela
 * migration 0008; ficam no schema porque `credit_orders` e `provider_invoices`
 * as referenciam em registros historicos.
 */
export const CREDIT_PACKAGES = [
  { id: "credits-50",  name: "50 créditos",  credits: 50,  price: 5000,  priceLabel: "R$ 50,00",  perUnit: "R$ 1,00/crédito" },
  { id: "credits-100", name: "100 créditos", credits: 100, price: 10000, priceLabel: "R$ 100,00", perUnit: "R$ 1,00/crédito", popular: true },
  { id: "credits-250", name: "250 créditos", credits: 250, price: 25000, priceLabel: "R$ 250,00", perUnit: "R$ 1,00/crédito" },
  { id: "credits-500", name: "500 créditos", credits: 500, price: 50000, priceLabel: "R$ 500,00", perUnit: "R$ 1,00/crédito" },
];

/**
 * Quanto cada consulta consome do saldo. Credito vale R$ 1,00, entao o numero
 * aqui e o preco em reais.
 *
 * SEM DESCONTO POR VOLUME, de proposito: o pacote maior nao barateia a consulta,
 * so evita recarga. Preco de consulta que muda conforme o tamanho da compra e
 * dificil de explicar no suporte e impossivel de conferir numa fatura.
 *
 * - `isp` (R$ 1,00): consulta a rede colaborativa. Custo nosso e proximo de
 *   zero — e banco proprio, sem bureau externo.
 * - `cadastral` (R$ 2,00): BigDataCorp. Custa R$ 1,21 de 19 datasets mais o
 *   risco de area (preco DA CONTA, medido em POST /precos em 28/08/2026).
 *   Margem de R$ 0,79, 40%. Ao mexer no combo em
 *   server/services/bigdata.service.ts, refaca essa conta: cada dataset e
 *   cobrado a parte.
 * - `spc` (R$ 3,00): SPC Brasil. Continua o mais caro dos tres porque o bureau
 *   cobra mais e a consulta e negativacao formal. Baixado de 4 para 3 por
 *   decisao do dono em 31/08/2026.
 *
 * ESTE E O UNICO LUGAR ONDE ESSES NUMEROS EXISTEM. Nao repita nenhum deles em
 * texto de tela: a landing anunciava "4 creditos" em quatro arquivos diferentes,
 * e cada mudanca de preco exigia lembrar dos quatro. Importe a constante.
 */
export const CUSTO_EM_CREDITOS = {
  isp: 1,
  cadastral: 2,
  spc: 3,
} as const;

export type TipoConsultaCobravel = keyof typeof CUSTO_EM_CREDITOS;

/**
 * O que a fatura mensal cobra (server/routes/financeiro.routes.ts) e o que a
 * landing exibe. Sao a MESMA fonte de proposito: preco de vitrine que diverge
 * do preco cobrado e a forma mais rapida de perder um cliente.
 *
 * Vendidos hoje: `free` e `pro` — os dois cards da landing.
 * `basic` e `enterprise` continuam aqui porque provedores podem estar neles e
 * as consultas quebrariam sem a chave; nao sao oferecidos na pagina.
 */
export const PLAN_PRICES: Record<string, number> = {
  free: 0,
  basic: 149,      // legado, fora da vitrine
  pro: 99,
  enterprise: 799, // negociado fora do site
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

/**
 * Bases geográficas públicas — denominador do território.
 *
 * Diferente de todas as outras tabelas do sistema, esta NÃO tem providerId, e
 * é de propósito: IBGE e ANEEL descrevem o município, não a carteira de
 * ninguém. Quantos domicílios existem no Jardim Bandeirantes é o mesmo número
 * para todo provedor que atende ali — é justamente por ser comum que ele serve
 * de denominador da penetração de cada um.
 *
 * Duas fontes convivem na mesma tabela, separadas por `fonte`:
 *   CNEFE2022        — domicílios contados pelo IBGE (HPs, "homes passed")
 *   ANEEL_BDGD_2024  — unidades consumidoras residenciais com energia ligada
 *
 * A UC viva é o denominador melhor: domicílio sem luz não compra internet. O
 * CNEFE entra como reserva quando a ANEEL não cobre o bairro.
 *
 * `cidade_norm` + `uf` existem porque o cadastro do ERP guarda a cidade como
 * texto, não como código IBGE — é por esse par que o cliente encontra o seu
 * município aqui.
 */
export const geoHpsBairro = pgTable("geo_hps_bairro", {
  id: serial("id").primaryKey(),
  municipioIbge: text("municipio_ibge").notNull(),
  /** Nome do município sem acento e em caixa alta: LONDRINA. */
  cidadeNorm: text("cidade_norm").notNull(),
  uf: text("uf").notNull(),
  /** Bairro normalizado pela mesma cascata do ranking (server/services/localidade.ts). */
  bairroNorm: text("bairro_norm").notNull(),
  fonte: text("fonte").notNull(),
  hps: integer("hps").notNull(),
  atualizadoEm: timestamp("atualizado_em").defaultNow(),
});

export type GeoHpsBairro = typeof geoHpsBairro.$inferSelect;

/**
 * Endereços do CNEFE com coordenada — o geocodificador local.
 *
 * O censo de endereços do IBGE traz latitude e longitude de CADA endereço do
 * município. Com essa tabela na base, geocodificar deixa de ser uma chamada de
 * rede por cliente e vira uma consulta: instantânea, sem quota, sem depender de
 * um serviço de terceiro estar de pé.
 *
 * É a diferença entre plotar uma carteira em minutos e plotar em horas — e
 * entre a coordenada da casa e o centro da cidade com 2km de erro, que é o que
 * sobrava quando a rua não resolvia.
 *
 * Como `geo_hps_bairro`, não tem providerId: o endereço de uma rua é o mesmo
 * para todo provedor que atende ali.
 */
export const geoEndereco = pgTable("geo_endereco", {
  id: serial("id").primaryKey(),
  municipioIbge: text("municipio_ibge").notNull(),
  /** Logradouro na régua de comparação: "RUA DEZENOVE DE DEZEMBRO". */
  logradouroNorm: text("logradouro_norm").notNull(),
  numero: integer("numero"),
  cep: text("cep"),
  bairroNorm: text("bairro_norm"),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
});

export type GeoEndereco = typeof geoEndereco.$inferSelect;

/**
 * Creditos que a fatura declara como inclusos no plano.
 *
 * ATENCAO: isto e o que a fatura ESCREVE, nao um credito automatico. Nada no
 * sistema soma esses valores a `providers.ispCredits` quando a fatura e paga —
 * quem credita e o superadmin, ou a compra avulsa em /creditos.
 *
 * `pro` foi a zero junto com o preco de R$ 99: o plano passou a ser acesso, e a
 * consulta na rede se paga por credito (e o que a landing sempre disse no
 * subtitulo, "pague apenas pelo que usar na rede"). Antes prometia 500 ISP +
 * 150 SPC — cerca de R$ 500 pela propria tabela de pacotes — por um valor
 * menor que isso, e ainda dependia de alguem lancar na mao todo mes.
 */
export const PLAN_CREDITS: Record<string, { isp: number; spc: number }> = {
  free: { isp: 50, spc: 0 },
  basic: { isp: 200, spc: 50 },
  pro: { isp: 0, spc: 0 },
  enterprise: { isp: 1500, spc: 500 },
};

export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;
