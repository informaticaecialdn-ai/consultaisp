import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, decimal, serial, bigserial, jsonb, index, uniqueIndex, unique, primaryKey, foreignKey, check, date } from "drizzle-orm/pg-core";
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

  // ── Camada comercial (migracao 0013) ─────────────────────────────────────
  /**
   * A marca E o revendedor. A camada comercial pendura AQUI em vez de numa
   * tabela `revendedores` 1:1, que so duplicaria a chave.
   *
   * `revendaAtiva` false = marca "so pele": o ISP grande que quis a propria
   * cara. Ele nao comissiona nem ganha painel comercial, e e o padrao — marca
   * que ja existia nao vira revenda sozinha ao rodar a migracao.
   */
  revendaAtiva: boolean("revenda_ativa").notNull().default(false),
  /**
   * "ativo" | "suspenso". Pausa comissao e trava a edicao de preco SEM derrubar
   * a pele nem os provedores: divida do revendedor nunca pune o provedor
   * (decisao 14). Quem derruba a pele e `ativo`, que e outra coluna.
   * CHECK `marcas_status_comercial_valido` no banco.
   */
  statusComercial: text("status_comercial").notNull().default("ativo"),
  /**
   * Percentual sobre o bruto que efetivamente entrou. Negociado por marca e
   * definido SO pelo superadmin; CHECK de 0 a 50 no banco (`marcas_comissao_faixa`)
   * — acima disso a plataforma fica com menos da metade e o piso de preco
   * deixa de proteger a margem.
   *
   * `decimal` do Drizzle e o `numeric` do Postgres, e chega em JavaScript como
   * STRING (o driver nao arredonda o que o float arredondaria). Todo dinheiro
   * e percentual deste arquivo segue essa regra — some com `Number(...)` so no
   * ponto de calculo, nunca guarde o resultado de volta como float.
   */
  comissaoPercentual: decimal("comissao_percentual", { precision: 5, scale: 2 }).notNull().default("0"),
  /**
   * Quem RECEBE a comissao — nao confundir com `responsavel*`, que e quem
   * responde ao titular pela LGPD. Pode ser outra pessoa juridica.
   * So o superadmin le e escreve: nada disto vai para `window.__MARCA__` nem
   * para as rotas do revendedor.
   */
  repasseRazaoSocial: text("repasse_razao_social"),
  repasseCnpj: text("repasse_cnpj"),
  repasseChavePix: text("repasse_chave_pix"),
  repasseEmail: text("repasse_email"),
  /** Libera `POST /api/auth/register` no host desta marca. Desligado por padrao. */
  cadastroAberto: boolean("cadastro_aberto").notNull().default(false),
  /** Com landing desligada, "/" sem sessao no host da marca cai no login. */
  landingAtiva: boolean("landing_ativa").notNull().default(false),
  /**
   * Textos da landing da marca. Fica sem `$type` de proposito: e JSONB escrito
   * por gente, toda marca existente carrega `{}`, e nada no banco garante a
   * forma. Quem le PARSEIA com `esquemaLandingDaMarca` (shared/marca-landing.ts)
   * — declarar o tipo aqui afirmaria uma garantia que a coluna nao da.
   */
  landing: jsonb("landing").notNull().default({}),
  /** Data URI de PNG para o card de compartilhamento (og:image). */
  ogImagePng: text("og_image_png"),

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
  /**
   * UNICO vinculo pessoa ↔ marca. `providers.marcaId` diz que marca o provedor
   * VESTE; esta coluna diz de que marca a pessoa E — o revendedor.
   *
   * O banco tem o CHECK `users_papel_coerente` (migracao 0013), bidirecional:
   * revendedor tem marca e nao tem provedor; user/admin tem provedor e nao tem
   * marca; superadmin nao tem marca. Ele existe porque `requireAuth` tratava
   * "usuario sem provedor" como impossivel — um INSERT que criasse esse estado
   * abriria sessao sem tenant. Insert que viole isso e recusado pelo Postgres,
   * nao por este arquivo: o Drizzle nao conhece o CHECK.
   */
  marcaId: integer("marca_id").references(() => marcas.id),
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
  /**
   * Por que o contrato acabou, no TEXTO CRU do ERP ("Financeiro",
   * "Administrativo", "Financeiro - SPC").
   *
   * Sem ele, quem pediu para sair fica identico a quem foi cortado por calote —
   * e essa e a diferenca que um bureau de credito existe para registrar. Medido
   * na Amplinet em 04/09/2026: 214 contratos cancelados por motivo
   * administrativo contra 66 por financeiro, mais 222 clientes suspensos por
   * financeiro. Os 288 cortados por dinheiro entravam na nossa base
   * indistinguiveis dos 206 que so encerraram o servico.
   *
   * Texto livre, e nao enum: cada ERP escreve com a redacao dele. A
   * normalizacao para "financeiro" ou "administrativo" mora em
   * `shared/motivo-corte.ts`, onde conector, score e tela leem a mesma regra.
   * NULO significa "o ERP nao disse" — nunca "nao houve motivo".
   */
  motivoCorte: text("motivo_corte"),
  /** Quando o contrato passou ao status atual. Corte de tres anos atras pesa
   *  diferente de um de tres meses, e sem a data o score trata os dois igual. */
  cortadoEm: timestamp("cortado_em"),
  /**
   * Quando o contrato COMECOU, como o ERP informa (`contractStartDate` do
   * conector, lido por `dataDoErp`). Migracao 0021; autorizada pelo dono em
   * 05/09/2026 junto com as tabelas de cobranca.
   *
   * E a unica fonte da FIDELIDADE do DNA de cobranca (novo ate 11 meses, medio
   * ate 36, fiel acima): sem ela todo cliente e tratado como novo, e o tom que
   * o funcionario recebe para um cliente de dez anos sai igual ao de um que
   * entrou mes passado. `created_at` nao serve — e a data em que o SYNC viu o
   * cliente pela primeira vez, nao a do contrato.
   *
   * DATE, e nao TIMESTAMP: o ERP diz o dia, e um horario inventado so serviria
   * para virar o dia errado quando o fuso do processo e o do banco discordam.
   * Lida como texto `YYYY-MM-DD` (o driver do Drizzle nao converte DATE), e
   * gravada a partir das partes locais da `Date` que `dataDoErp` montou — ver
   * `dataSemHora` em server/storage/customers.storage.ts.
   */
  contractStartDate: date("contract_start_date"),
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
  // Nulo desde a 0027: a fatura que vem do ERP nao tem contrato NOSSO — so o
  // import CSV cria um `contracts` para pendurar a fatura. Fatura sem
  // contract_id e fatura do ERP.
  contractId: integer("contract_id").references(() => contracts.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  value: decimal("value", { precision: 10, scale: 2 }).notNull(),
  dueDate: timestamp("due_date").notNull(),
  paidDate: timestamp("paid_date"),
  // CSV/manual: pending | overdue | paid. ERP (0027): "aberta" (pendente no
  // ERP) e "baixada_no_erp" (sumiu dos pendentes numa varredura COMPLETA —
  // pagamento provavel, sem confirmacao). Ver server/storage/faturas.storage.ts.
  status: text("status").notNull().default("pending"),
  // ── Faturas do ERP (0027, fase 2 da cobranca) ─────────────────────────────
  // `erp_source` nulo = CSV/manual; "mk", "ixc"... = gravada pela varredura.
  // `erp_ref` e o id da fatura la, unico por (provedor, fonte) — e o que faz
  // a varredura seguinte reconhecer a mesma fatura em vez de duplica-la.
  erpSource: text("erp_source"),
  erpRef: text("erp_ref"),
  descricao: text("descricao"),
  /** Quando NOTAMOS que a fatura saiu dos pendentes — nao quando foi paga. */
  baixadaEm: timestamp("baixada_em"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  // Parcial porque a fatura do CSV nao tem referencia no ERP e pode repetir.
  uniqueIndex("invoices_provider_erp_ref_uq")
    .on(t.providerId, t.erpSource, t.erpRef)
    .where(sql`erp_ref IS NOT NULL`),
  // O resumo do mes pergunta "faturas deste provedor vencendo em [de, ate)".
  index("idx_invoices_provider_due").on(t.providerId, t.dueDate),
]);

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
  /**
   * O codigo que o provedor apresenta ao suporte: `CI-2609-K7F3M2`.
   * Nulo nas consultas anteriores a 03/09/2026 — elas nasceram sem codigo, e
   * inventar um retroativo diria que foram identificadas quando nao foram.
   * Indice unico parcial na migracao 0015.
   */
  consultaId: text("consulta_id"),
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
  /**
   * O codigo que o provedor apresenta ao suporte: `CI-2609-K7F3M2`.
   * Nulo nas consultas anteriores a 03/09/2026 — elas nasceram sem codigo, e
   * inventar um retroativo diria que foram identificadas quando nao foram.
   * Indice unico parcial na migracao 0015.
   */
  consultaId: text("consulta_id"),
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
  /**
   * O codigo que o provedor apresenta ao suporte: `CI-2609-K7F3M2`.
   * Nulo nas consultas anteriores a 03/09/2026 — elas nasceram sem codigo, e
   * inventar um retroativo diria que foram identificadas quando nao foram.
   * Indice unico parcial na migracao 0015.
   */
  consultaId: text("consulta_id"),
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
  /**
   * FOTO da marca no momento da emissao — nulo = plataforma.
   *
   * A comissao e apurada sobre esta coluna, nunca sobre `providers.marcaId`:
   * um provedor que troca de marca (ou se desvincula) reescreveria a comissao
   * de meses ja pagos se a apuracao lesse a marca ATUAL. Faturas anteriores a
   * migracao 0013 ficam nulas — nao ha comissao retroativa (decisao 7).
   */
  marcaId: integer("marca_id").references(() => marcas.id),
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
  /** FOTO da marca na compra — mesma regra de `providerInvoices.marcaId`. */
  marcaId: integer("marca_id").references(() => marcas.id),
  /**
   * Preco unitario que o provedor pagou, em CENTAVOS inteiros. `amount` guarda
   * o total; sem o unitario nao da para reconstruir por quanto o credito foi
   * vendido quando a marca mudar o preco depois — e e o unitario que a
   * conferencia de piso/teto usa como prova.
   *
   * Inteiro e nao `decimal` porque preco de tabela e definido em centavos
   * (`shared/planos.ts`, `TETO_CREDITO_CENTAVOS`); converter para numeric aqui
   * so criaria um segundo formato do mesmo numero.
   */
  precoUnitarioCentavos: integer("preco_unitario_centavos"),
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

/**
 * Preco proprio da marca — a camada 1 da resolucao de preco.
 *
 * E TABELA, e nao um JSONB em `marcas`, por tres motivos praticos: cada linha
 * guarda quem mudou e quando (o preco muda a receita de terceiros, entao a
 * mudanca precisa de dono); a `chave` e validada contra o catalogo de pacotes e
 * planos; e o fechamento mensal faz JOIN direto nela.
 *
 * Vazia = a marca inteira usa a tabela da plataforma (`shared/planos.ts`), que
 * tambem e o PISO: a marca so pode subir o preco, ate o teto por credito.
 * Quem valida e `validarPrecoDaMarca`, sempre no servidor.
 */
export const marcaPrecos = pgTable("marca_precos", {
  id: serial("id").primaryKey(),
  marcaId: integer("marca_id").notNull().references(() => marcas.id),
  /** "pacote" (creditos avulsos) ou "plano" (mensalidade). CHECK no banco. */
  tipo: text("tipo").notNull(),
  /** `credits-50`…`credits-500` para pacote; `free`/`pro`/`enterprise` para plano. */
  chave: text("chave").notNull(),
  precoCentavos: integer("preco_centavos").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  atualizadoPorId: integer("atualizado_por_id").references(() => users.id),
  atualizadoEm: timestamp("atualizado_em").defaultNow(),
}, (t) => [
  // A UNIQUE e constraint de tabela na migracao 0013; o Postgres a implementa
  // com um indice deste nome. Declarada aqui para o leitor ver a chave de
  // negocio — uma linha por marca, tipo e chave.
  uniqueIndex("marca_precos_marca_id_tipo_chave_key").on(t.marcaId, t.tipo, t.chave),
  index("idx_marca_precos_marca").on(t.marcaId),
]);

/**
 * Fechamento mensal da comissao de uma marca — um por competencia (YYYY-MM).
 *
 * Existe ANTES de `comissaoLancamentos` neste arquivo porque e ela que os
 * lancamentos referenciam quando sao fechados.
 *
 * O dinheiro sai FORA do sistema (PIX/TED contra nota fiscal de comissao do
 * revendedor, decisao 6), entao `comprovante` e `notaFiscalRef` sao o unico
 * rastro do pagamento — sem eles nao ha como provar meses depois que a
 * plataforma pagou. `aberto → aprovado → pago`, e `cancelado` reabre os
 * lancamentos; CHECK no banco.
 */
export const comissaoFechamentos = pgTable("comissao_fechamentos", {
  id: serial("id").primaryKey(),
  marcaId: integer("marca_id").notNull().references(() => marcas.id),
  /** Competencia no formato `YYYY-MM`. Texto, para ordenar e agrupar como veio. */
  competencia: text("competencia").notNull(),
  valorBruto: decimal("valor_bruto", { precision: 10, scale: 2 }).notNull(),
  valorComissao: decimal("valor_comissao", { precision: 10, scale: 2 }).notNull(),
  qtdLancamentos: integer("qtd_lancamentos").notNull(),
  status: text("status").notNull().default("aberto"),
  aprovadoEm: timestamp("aprovado_em"),
  pagoEm: timestamp("pago_em"),
  comprovante: text("comprovante"),
  notaFiscalRef: text("nota_fiscal_ref"),
  observacoes: text("observacoes"),
  fechadoPorId: integer("fechado_por_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  // Constraint de tabela na 0013: um fechamento por marca e competencia. E ela
  // que protege contra o job mensal rodar em duas instancias ao mesmo tempo.
  uniqueIndex("comissao_fechamentos_marca_id_competencia_key").on(t.marcaId, t.competencia),
]);

/**
 * Um lancamento por ENTRADA DE DINHEIRO: pedido de credito pago ou fatura de
 * plano paga.
 *
 * O `percentual` e gravado junto porque e o VIGENTE naquele instante. Sem esta
 * tabela a comissao seria recalculada a cada leitura e mudaria sozinha quando o
 * superadmin renegociasse o percentual — reescrevendo meses ja pagos.
 * `plan_changes` nao serve: e ledger de credito, nao de dinheiro.
 *
 * So ids e valores: nenhum CPF, nenhum nome de cliente. O revendedor le esta
 * tabela, e ele nao tem por que ver quem e o assinante do provedor dele.
 */
export const comissaoLancamentos = pgTable("comissao_lancamentos", {
  id: serial("id").primaryKey(),
  marcaId: integer("marca_id").notNull().references(() => marcas.id),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  /** `credit_order` | `provider_invoice` | `estorno` | `ajuste`. CHECK no banco. */
  origem: text("origem").notNull(),
  /** Id na tabela de origem. Nulo em `ajuste`, que nao nasce de documento. */
  origemId: integer("origem_id"),
  competencia: text("competencia").notNull(),
  valorBruto: decimal("valor_bruto", { precision: 10, scale: 2 }).notNull(),
  percentual: decimal("percentual", { precision: 5, scale: 2 }).notNull(),
  valorComissao: decimal("valor_comissao", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pendente"),
  fechamentoId: integer("fechamento_id").references(() => comissaoFechamentos.id),
  descricao: text("descricao"),
  criadoPorId: integer("criado_por_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  // Indice unico PARCIAL: e ele que torna a reentrega do webhook do Asaas
  // inofensiva — o mesmo pedido pago duas vezes nao vira comissao dobrada.
  // Parcial porque `estorno` e `ajuste` nao tem documento de origem e podem
  // repetir na mesma competencia.
  uniqueIndex("comissao_lancamentos_origem_uq")
    .on(t.origem, t.origemId)
    .where(sql`origem IN ('credit_order', 'provider_invoice')`),
  index("idx_comissao_lancamentos_marca_comp").on(t.marcaId, t.competencia),
  index("idx_comissao_lancamentos_provider").on(t.providerId),
]);

/**
 * Trilha de auditoria da revenda — append-only.
 *
 * Obrigatoria desde a fase 1 (decisao 15) pelo que o revendedor pode fazer: ele
 * suspende provedores que nao sao dele, cria usuarios de terceiros e mexe em
 * preco que vira dinheiro. Sem esta tabela, "quem suspendeu meu provedor?" nao
 * tem resposta. `atorRole` registra tambem o que o SUPERADMIN faz sobre a
 * marca, porque ele pode reverter qualquer ato do revendedor.
 *
 * Nunca se escreve aqui direto: use `registrarEventoDaMarca`
 * (server/services/marca-eventos.service.ts), que faz a redacao de senha,
 * token, segredo e chave PIX antes do INSERT — o `detalhe` guarda o antes/depois
 * de edicoes que passam perto de credencial.
 */
export const marcaEventos = pgTable("marca_eventos", {
  id: serial("id").primaryKey(),
  marcaId: integer("marca_id").notNull().references(() => marcas.id),
  /** Quem fez. NOT NULL: evento sem autor nao serve de auditoria. */
  userId: integer("user_id").notNull().references(() => users.id),
  /** `revendedor` ou `superadmin` — o papel no momento do ato, nao o de hoje. */
  atorRole: text("ator_role").notNull(),
  /** Uma das acoes de `AcaoDeMarca`; o servico recusa o que nao esta na lista. */
  acao: text("acao").notNull(),
  /** Provedor alvo, quando a acao tem um. Nulo em acoes sobre a propria marca. */
  providerId: integer("provider_id").references(() => providers.id),
  detalhe: jsonb("detalhe").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  // A leitura e sempre "os ultimos eventos desta marca", da tela e do CSV.
  index("idx_marca_eventos_marca_data").on(t.marcaId, t.createdAt.desc()),
]);

export const insertMarcaPrecoSchema = createInsertSchema(marcaPrecos).omit({ id: true, atualizadoEm: true });
export const insertComissaoFechamentoSchema = createInsertSchema(comissaoFechamentos).omit({ id: true, createdAt: true });
export const insertComissaoLancamentoSchema = createInsertSchema(comissaoLancamentos).omit({ id: true, createdAt: true });
export const insertMarcaEventoSchema = createInsertSchema(marcaEventos).omit({ id: true, createdAt: true });

export type MarcaPreco = typeof marcaPrecos.$inferSelect;
export type InsertMarcaPreco = z.infer<typeof insertMarcaPrecoSchema>;
export type ComissaoFechamento = typeof comissaoFechamentos.$inferSelect;
export type InsertComissaoFechamento = z.infer<typeof insertComissaoFechamentoSchema>;
export type ComissaoLancamento = typeof comissaoLancamentos.$inferSelect;
export type InsertComissaoLancamento = z.infer<typeof insertComissaoLancamentoSchema>;
export type MarcaEvento = typeof marcaEventos.$inferSelect;
export type InsertMarcaEvento = z.infer<typeof insertMarcaEventoSchema>;

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
 * Tabela de preco e de plano: a definicao mora em ./planos.
 *
 * Continua re-exportada daqui porque rota, storage e servico ja importam
 * destes nomes de `@shared/schema`. Quebrar esse import agora renomearia
 * dezenas de arquivos de outras frentes por nada.
 */
export {
  CREDIT_PACKAGES,
  CUSTO_EM_CREDITOS,
  PLAN_PRICES,
  PLAN_CREDITS,
  TETO_CREDITO_CENTAVOS,
  validarPrecoDaMarca,
  formatarReais,
} from "./planos";
export type { TipoConsultaCobravel, ValidacaoDePreco } from "./planos";

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
  /**
   * Marca da landing em que o visitante conversou. Nulo = plataforma.
   *
   * Entrou na migracao 0013 junto do resto, mas so a fase 5 escreve nela: quem
   * atende continua sendo a plataforma (decisao 13), e a coluna serve para o
   * atendente saber sob que nome o visitante achou o produto.
   */
  marcaId: integer("marca_id").references(() => marcas.id),
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
  /**
   * Marca pela qual o titular chegou ate o pedido. Nulo = plataforma.
   *
   * Importa para a LGPD: a resposta ao titular sai com o nome de quem ele
   * acredita ter contratado, e o controlador nomeado no texto e o
   * `responsavel*` daquela marca. Escrita a partir da fase 5.
   */
  marcaId: integer("marca_id").references(() => marcas.id),
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
 * Regras do anti-fraude por provedor — o que ele quer que a rede vigie na
 * base dele. O catalogo, o padrao e a validacao dos parametros vivem em
 * shared/antifraude-regras.ts. Uma linha por (provedor, tipo); o que nao
 * esta gravado vale o padrao, por isso nao ha seed.
 */
export const antiFraudRules = pgTable("anti_fraud_rules", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  tipo: text("tipo").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  parametros: jsonb("parametros").$type<Record<string, number>>().notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [uniqueIndex("anti_fraud_rules_provider_tipo").on(t.providerId, t.tipo)]);

export type AntiFraudRule = typeof antiFraudRules.$inferSelect;
export type InsertAntiFraudRule = typeof antiFraudRules.$inferInsert;

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
 * Acesso de suporte — a janela em que o superadmin entra NA CONTA do provedor.
 *
 * Isto nao e uma permissao a mais: e personificacao. Enquanto a janela vale, o
 * suporte ve o dado pessoal completo dos clientes daquele provedor — CPF, nome,
 * endereco, telefone, consultas, alertas — e o isolamento por `providerId`, que
 * e a invariante central do produto, e atravessado de proposito.
 *
 * Por isso ela e TABELA, e nao duas colunas em `providers`. Coluna guarda
 * estado; a LGPD nao pergunta pelo estado de hoje, pergunta pelo passado: quem
 * olhou o dado de quem, quando, autorizado por quem e por quanto tempo. Meses
 * depois, com duas colunas sobrescritas a cada liberacao, nao ha resposta —
 * cada linha aqui e uma janela que existiu, e nenhuma e reescrita por cima.
 *
 * As colunas respondem, uma a uma:
 *   provider_id                  de QUEM e o dado que foi aberto
 *   liberado_por / liberado_em   QUEM autorizou e QUANDO — e o consentimento
 *   expira_em                    ate quando valia
 *   revogado_em / revogado_por   se foi cortada antes da hora, e por quem
 *   usado_por / primeiro_uso_em  QUEM entrou, e quando entrou a primeira vez
 *   ultimo_uso_em / usos         ate quando ficou, e com que intensidade
 *
 * Uma janela liberada e NUNCA usada tambem e informacao: o provedor autorizou, o
 * suporte nao entrou, ninguem viu dado nenhum. Por isso `usado_por` fica nulo
 * ate o primeiro uso, em vez de nascer preenchido com o suposto destinatario.
 *
 * TIMESTAMPTZ, e nao TIMESTAMP como o resto do schema. A diferenca so importa
 * aqui porque so aqui um horario decide se um estranho enxerga dado pessoal:
 * `timestamp without time zone` compara duas paredes de relogio e depende do
 * fuso de quem gravou e do fuso de quem le. Uma janela de 2 horas nao pode virar
 * 5 porque o processo Node e o Postgres discordaram de fuso.
 *
 * `usado_por` guarda o PRIMEIRO que entrou e nunca e sobrescrito — sobrescrever
 * apagaria quem abriu a porta. A consequencia assumida: se dois superadmins
 * usarem a MESMA janela, esta tabela mostra o primeiro e a contagem, e a
 * separacao por pessoa fica no log estruturado da requisicao.
 */
export const acessosSuporte = pgTable("acessos_suporte", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  liberadoPor: integer("liberado_por").notNull().references(() => users.id),
  liberadoEm: timestamp("liberado_em", { withTimezone: true }).notNull().defaultNow(),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
  revogadoEm: timestamp("revogado_em", { withTimezone: true }),
  revogadoPor: integer("revogado_por").references(() => users.id),
  usadoPor: integer("usado_por").references(() => users.id),
  primeiroUsoEm: timestamp("primeiro_uso_em", { withTimezone: true }),
  ultimoUsoEm: timestamp("ultimo_uso_em", { withTimezone: true }),
  usos: integer("usos").notNull().default(0),
}, (t) => [
  // A pergunta quente, feita a CADA requisicao de uma sessao de suporte:
  // "existe liberacao valida para o provedor X agora?". Parcial porque janela
  // revogada nunca volta a ser valida — deixa-la fora impede que o indice
  // engorde com o historico. `expira_em` desc porque a consulta quer a de prazo
  // mais longo e para na primeira linha.
  index("acessos_suporte_vigente")
    .on(t.providerId, t.expiraEm.desc())
    .where(sql`revogado_em IS NULL`),
  // A outra pergunta, fria: a trilha do provedor, da mais recente para tras.
  index("acessos_suporte_historico").on(t.providerId, t.liberadoEm.desc()),
]);

export type AcessoDeSuporte = typeof acessosSuporte.$inferSelect;
export type InsertAcessoDeSuporte = typeof acessosSuporte.$inferInsert;

/**
 * ══════════════════════════════════════════════════════════════════════════
 * COBRANCA — o funcionario no lugar do agente.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Pedido do dono em 05/09/2026: trazer do Provedor.ai a carteira, a ficha 360,
 * a regua e o DNA 3x3, "mas ao inves de agentes vai ser o funcionario, usuario
 * do sistema". Cinco tabelas e uma coluna (`customers.contract_start_date`),
 * autorizadas explicitamente nessa data. Migracao 0021.
 *
 * O desenho segue o que foi MEDIDO em producao no mesmo dia, e nao o que o
 * Provedor.ai tem:
 *
 *   · NAO existe fatura a fatura. `invoices` tem 3 linhas de teste e
 *     `contracts` uma. O sync do ERP grava so AGREGADOS em `customers`
 *     (total_overdue_amount, max_days_overdue, overdue_invoices_count,
 *     status). Por isso o caso e POR CLIENTE, e a regua anda sobre
 *     `max_days_overdue`. Fatura a fatura e a fase 2.
 *   · Sao duas carteiras do mesmo tamanho de importancia: ~590 clientes
 *     ativos ou suspensos com divida, e ~7.300 EX-clientes devendo R$ 4,8 mi
 *     (a NG sozinha, 6.034 / R$ 3,9 mi). `carteira` e fixada na abertura do
 *     caso porque o status do ERP muda depois — um ativo que e cortado no
 *     meio da cobranca continua sendo o caso que abriu como ativo.
 *
 * O molde e o CRM de recuperacao de equipamento (`equipment_recovery_cases` +
 * `_events`): um CASO por cliente com a vida dele, uma LINHA DO TEMPO de
 * eventos, e o que o sistema faz sozinho (mudar etapa, cumprir acordo) deixa
 * evento com `user_id` nulo. Negociacao e parcela sao tabelas proprias porque
 * um caso pode ter mais de uma tentativa de acordo — a primeira quebra, a
 * segunda cumpre — e a ficha precisa contar as duas.
 */

/**
 * Todos os status que um caso de cobranca assume, na ordem do kanban do
 * operador (decisao do dono, 05/09/2026, migracao 0022): A contatar (aberto)
 * → Em contato → Negociando → Acordo ativo → Pago | Cancelamento; baixado,
 * negativado e encerrado ficam recolhidos em "Encerrados".
 * A maquina de estados (quem vai para onde) e `shared/cobranca/estados.ts`.
 */
export const STATUS_CASO_COBRANCA = [
  "aberto", "em_contato", "negociando", "acordo_ativo", "pago", "baixado", "negativado", "encerrado", "cancelamento",
] as const;
export type StatusCasoCobranca = (typeof STATUS_CASO_COBRANCA)[number];

/**
 * Os status TERMINAIS. Fora deles o caso esta vivo, e so pode haver UM vivo
 * por cliente (indice parcial `cobranca_casos_um_aberto_por_cliente`).
 *
 * `negativado` NAO esta aqui, e e decisao: negativar e uma ETAPA da cobranca,
 * nao o fim dela — o nome sujo e justamente o que faz o ex-cliente voltar para
 * negociar, e a campanha de divida antiga mira esse cliente. Se fosse
 * terminal, o job de abertura veria um cliente com divida e sem caso vivo e
 * abriria outro no dia seguinte, para sempre.
 *
 * `cancelamento` ESTA: o contrato acabou e a cobranca desse caso tambem — o
 * que sobra e a recuperacao do equipamento, que e outro CRM.
 *
 * ATENCAO: a lista e repetida LITERALMENTE no predicado dos indices parciais
 * em migrations/0022_cobranca_fluxo.sql (a 0021 tem a lista da fase 1, sem
 * `cancelamento`). Ha teste que le a migracao e confere.
 */
export const STATUS_CASO_FECHADO = ["pago", "baixado", "encerrado", "cancelamento"] as const satisfies readonly StatusCasoCobranca[];

export const CARTEIRAS_DE_COBRANCA = ["ativo", "ex_cliente"] as const;
export type CarteiraDeCobranca = (typeof CARTEIRAS_DE_COBRANCA)[number];

/**
 * O que fica GRAVADO por etapa em `cobranca_politica.etapas`: SO as mudancas
 * do provedor sobre o catalogo (`EtapaConfig` em shared/cobranca/regua.ts,
 * que e quem valida e mescla). Rotulo, base legal e "disponivel na fase 1"
 * sao fatos do sistema e nao entram — se o JSON pudesse ligar o preventivo na
 * fase 1, o motor mandaria lembrar de uma fatura que ninguem tem.
 * `etapas = []` significa "vale o catalogo padrao inteiro".
 */
export interface EtapaDaReguaGravada {
  id: string;
  diaMin?: number;
  diaMax?: number | null;
  /** O que o funcionario faz nessa etapa, reescrito pelo provedor. */
  acao?: string;
  /** telefone | whatsapp | email | presencial. */
  canalSugerido?: string;
  /** NULL = qualquer operador pega da fila. */
  responsavelUserId?: number | null;
  /** Desligada pelo provedor: a etapa seguinte absorve a janela. */
  ativa?: boolean;
}

export interface NegociacaoDaPolitica {
  maxParcelas: number;
  entradaMinimaPct: number;
  descontoMaxPct: number;
  saldoMinimoParcelar: number;
}

/** Tetos legais: multa 2% (CDC art. 52 §1) e juros 1%/mes (CC art. 406). A politica so pode DESCER. */
export interface EncargosDaPolitica {
  multaPct: number;
  jurosMesPct: number;
}

/** Janela em que o funcionario pode ligar (CDC art. 42: dias uteis 8-20h, sabado ate 14h). */
export interface JanelaDeContato {
  horaInicio: number;
  horaFim: number;
  sabado: boolean;
  sabadoHoraFim: number;
  domingo: boolean;
  feriado: boolean;
}

/**
 * Os custos POR PROVEDOR da "Economia do cliente" (R24 do Provedor.ai) na
 * ficha 360 — decisao do dono, 05/09/2026, migracao 0022. Reais por cliente;
 * OPEX por mes; imposto em pontos percentuais. `confirmado` e o que separa
 * dado de chute: false = a tela mostra o selo "≈ parametros padrao".
 * Quem valida e ajusta e `EconomiaSchema` em shared/cobranca/politica.ts.
 */
export interface EconomiaDaPolitica {
  cac: number;
  capexInstalacao: number;
  equipamentoResidual: number;
  opexLink: number;
  opexRedePop: number;
  opexSuporte: number;
  opexManutencaoNoc: number;
  impostoReceitaPct: number;
  cicloMeses: number;
  confirmado: boolean;
  /** Mensalidade por NOME de plano (ARPU do R24). Opcional: linhas anteriores a 0023 nao a tem; o Zod aplica `{}`. */
  precoPorPlano?: Record<string, number>;
}

/**
 * A POLITICA DE ACORDO, por carteira (migracao 0029, 06/09/2026). Quem valida,
 * ordena as faixas e ajusta ao envelope geral e `AcordoSchema` em
 * shared/cobranca/acordo.ts; aqui fica so o formato do JSONB.
 *
 * `origemDaCobranca` e um CAMPO porque foi decisao do dono ("fica na decisao
 * do provedor"): asaas | erp | manual, e `nao_definida` enquanto ele nao
 * escolher — e nesse estado NENHUMA oferta com desconto e gerada.
 */
export interface FaixaDeAcordoGravada {
  /** Piso exclusivo. Opcional: inferido do `ateDias` da faixa anterior (0 na primeira). */
  acimaDeDias?: number;
  /** Teto inclusivo; null = a ultima faixa, sem teto. */
  ateDias: number | null;
  descontoMaxPct: number;
  maxParcelas: number;
  entradaMinimaPct: number;
}

export interface AcordoDaCarteiraGravado {
  /** nao_definida | asaas | erp | manual. */
  origemDaCobranca: string;
  faixas: FaixaDeAcordoGravada[];
  /** Em quantos dias a frente o devedor escolhe a primeira parcela (a janela do credor). */
  janelaVencimentoDias: number;
  /** O quanto alem da faixa um pedido pode ir e ainda ser levado a um humano aprovar. */
  tetoDeExcecaoPct: number;
  parcelasDeExcecao: number;
}

export interface AcordoDaPolitica {
  ativo: AcordoDaCarteiraGravado;
  ex_cliente: AcordoDaCarteiraGravado;
}

/**
 * Os DEFAULTS da politica, na coluna e no codigo, para uma linha criada so com
 * `pausada = true` (o botao de pausar a regua antes de configurar o resto)
 * nascer utilizavel.
 *
 * Tres copias precisam concordar, e ha teste para as tres: esta, o DEFAULT
 * das colunas em migrations/0021_cobranca.sql e 0022_cobranca_fluxo.sql
 * (linha velha e linha nova com padroes diferentes seria bug silencioso) e
 * `POLITICA_PADRAO` em shared/cobranca/politica.ts, que e quem valida o que o
 * admin grava. Os valores sao os do Provedor.ai (buildDefaultPolicy), em
 * pontos percentuais.
 */
export const POLITICA_DE_COBRANCA_PADRAO: {
  negociacao: NegociacaoDaPolitica;
  encargos: EncargosDaPolitica;
  janelaContato: JanelaDeContato;
  economia: EconomiaDaPolitica;
  acordo: AcordoDaPolitica;
} = {
  negociacao: { maxParcelas: 6, entradaMinimaPct: 20, descontoMaxPct: 20, saldoMinimoParcelar: 150 },
  encargos: { multaPct: 2, jurosMesPct: 1 },
  janelaContato: { horaInicio: 8, horaFim: 20, sabado: true, sabadoHoraFim: 14, domingo: false, feriado: false },
  economia: {
    cac: 0, capexInstalacao: 0, equipamentoResidual: 0,
    opexLink: 0, opexRedePop: 0, opexSuporte: 0, opexManutencaoNoc: 0,
    impostoReceitaPct: 0, cicloMeses: 36, confirmado: false,
    // Mensalidade por NOME de plano (o ARPU da Economia do cliente) — chave nova em 05/09/2026, migracao 0023.
    precoPorPlano: {},
  },
  // Politica de acordo (0029): a origem nasce NAO DEFINIDA nas duas carteiras.
  // O cliente ativo em atraso recente paga o que deve (desconto 0, a vista); do
  // ex-cliente se recupera o que der, sem passar do envelope geral (20% / 6x).
  acordo: {
    ativo: {
      origemDaCobranca: "nao_definida",
      faixas: [
        { acimaDeDias: 0, ateDias: 30, descontoMaxPct: 0, maxParcelas: 1, entradaMinimaPct: 100 },
        { acimaDeDias: 30, ateDias: 60, descontoMaxPct: 5, maxParcelas: 2, entradaMinimaPct: 50 },
        { acimaDeDias: 60, ateDias: null, descontoMaxPct: 10, maxParcelas: 3, entradaMinimaPct: 30 },
      ],
      janelaVencimentoDias: 10,
      tetoDeExcecaoPct: 20,
      parcelasDeExcecao: 6,
    },
    ex_cliente: {
      origemDaCobranca: "nao_definida",
      faixas: [
        { acimaDeDias: 0, ateDias: 90, descontoMaxPct: 10, maxParcelas: 3, entradaMinimaPct: 30 },
        { acimaDeDias: 90, ateDias: 180, descontoMaxPct: 15, maxParcelas: 4, entradaMinimaPct: 25 },
        { acimaDeDias: 180, ateDias: null, descontoMaxPct: 20, maxParcelas: 6, entradaMinimaPct: 20 },
      ],
      janelaVencimentoDias: 10,
      tetoDeExcecaoPct: 20,
      parcelasDeExcecao: 6,
    },
  },
};

/** Uma por provedor. Ausente = tudo no padrao (o `get` devolve undefined e o motor aplica o catalogo). */
export const cobrancaPolitica = pgTable("cobranca_politica", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  etapas: jsonb("etapas").$type<EtapaDaReguaGravada[]>().notNull().default([]),
  negociacao: jsonb("negociacao").$type<NegociacaoDaPolitica>().notNull().default(POLITICA_DE_COBRANCA_PADRAO.negociacao),
  encargos: jsonb("encargos").$type<EncargosDaPolitica>().notNull().default(POLITICA_DE_COBRANCA_PADRAO.encargos),
  janelaContato: jsonb("janela_contato").$type<JanelaDeContato>().notNull().default(POLITICA_DE_COBRANCA_PADRAO.janelaContato),
  economia: jsonb("economia").$type<EconomiaDaPolitica>().notNull().default(POLITICA_DE_COBRANCA_PADRAO.economia),
  /** Politica de acordo por carteira (0029): origem da cobranca, faixas por atraso, janela e excecao. */
  acordo: jsonb("acordo").$type<AcordoDaPolitica>().notNull().default(POLITICA_DE_COBRANCA_PADRAO.acordo),
  pausada: boolean("pausada").notNull().default(false),
  pausadaMotivo: text("pausada_motivo"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [uniqueIndex("cobranca_politica_provider").on(t.providerId)]);

/** A vida do cliente na cobranca: um caso vivo por cliente, com a foto da abertura e o estado de hoje. */
export const cobrancaCasos = pgTable("cobranca_casos", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  status: text("status").notNull().default("aberto"),
  /**
   * Desde quando o caso esta NESTE status (migracao 0030). `updated_at` muda
   * por qualquer motivo (valor, responsavel, proxima acao) e nao responde
   * "ha quanto tempo este caso esta parado nesta coluna" — que e o que a
   * esteira precisa mostrar. Quem escreve e o storage, em TODA transicao.
   */
  statusDesde: timestamp("status_desde").notNull().defaultNow(),
  /** `ativo` | `ex_cliente`, fixada na abertura — ver o cabecalho da secao. */
  carteira: text("carteira").notNull(),
  abertoEm: timestamp("aberto_em").notNull().defaultNow(),
  /** Id da etapa da regua em que o caso esta (`lembrete_atraso`, ...). Nula ate o motor passar. */
  etapaAtual: text("etapa_atual"),
  /** A foto do momento da abertura — o que o caso era quando nasceu. */
  diasAtrasoAbertura: integer("dias_atraso_abertura").notNull().default(0),
  valorAbertura: decimal("valor_abertura", { precision: 12, scale: 2 }).notNull().default("0"),
  /** O que o caso vale hoje; quem atualiza e o job, a partir de `customers.total_overdue_amount`. */
  valorAtual: decimal("valor_atual", { precision: 12, scale: 2 }).notNull().default("0"),
  /** NULL = fila geral: qualquer operador pega. */
  responsavelUserId: integer("responsavel_user_id").references(() => users.id),
  /** critica | alta | normal | baixa (PRIORIDADES em shared/cobranca/estados.ts). Texto, como no CRM de recuperacao. */
  prioridade: text("prioridade").notNull().default("normal"),
  proximoContatoEm: timestamp("proximo_contato_em"),
  /** Follow-up: a proxima acao escrita ("ligar de novo", "cobrar a promessa"). Nula = caso sem proxima acao. */
  proximaAcao: text("proxima_acao"),
  ultimoContatoEm: timestamp("ultimo_contato_em"),
  /** A1..C3 do DNA 3x3, calculado pelo motor. */
  quadranteDna: text("quadrante_dna"),
  /** A abordagem que o DNA manda (acolhedor, firme_gentil, ...). Vulneravel sobrepoe. */
  tom: text("tom"),
  encerradoEm: timestamp("encerrado_em"),
  motivoEncerramento: text("motivo_encerramento"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_cobranca_casos_provider_status").on(t.providerId, t.status),
  index("idx_cobranca_casos_provider_customer").on(t.providerId, t.customerId),
  // Um caso VIVO por cliente. A lista de status e a de STATUS_CASO_FECHADO
  // (recriado na 0022 com `cancelamento`).
  uniqueIndex("cobranca_casos_um_aberto_por_cliente")
    .on(t.providerId, t.customerId)
    .where(sql`status NOT IN ('pago', 'baixado', 'encerrado', 'cancelamento')`),
  // A fila: casos vivos, por responsavel, na ordem do proximo contato.
  index("idx_cobranca_casos_fila")
    .on(t.providerId, t.responsavelUserId, t.proximoContatoEm)
    .where(sql`status NOT IN ('pago', 'baixado', 'encerrado', 'cancelamento')`),
]);

/**
 * A linha do tempo. `user_id` nulo = o sistema (job, cascata de acordo).
 * tipo: contato | promessa | negociacao_proposta | acordo_aceito |
 *       acordo_quebrado | parcela_paga | etapa_mudou | responsavel_mudou |
 *       nota | suspensao | negativacao | encerramento | cancelamento
 * canal: telefone | whatsapp | email | presencial | sistema
 * resultado (de um contato): falou | nao_atendeu | caixa_postal |
 *       promessa_pagamento | recusou | numero_errado
 */
export const cobrancaEventos = pgTable("cobranca_eventos", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  casoId: integer("caso_id").notNull().references(() => cobrancaCasos.id),
  /** Repetido do caso para a ficha 360 ler a vida INTEIRA do cliente, atravessando casos. */
  customerId: integer("customer_id").notNull().references(() => customers.id),
  userId: integer("user_id").references(() => users.id),
  tipo: text("tipo").notNull(),
  canal: text("canal"),
  resultado: text("resultado"),
  notas: text("notas"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  ocorridoEm: timestamp("ocorrido_em").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_cobranca_eventos_caso").on(t.providerId, t.casoId, t.ocorridoEm.desc()),
  index("idx_cobranca_eventos_cliente").on(t.providerId, t.customerId, t.ocorridoEm.desc()),
  // "Contatados hoje", o KPI da carteira.
  index("idx_cobranca_eventos_tipo_data").on(t.providerId, t.tipo, t.ocorridoEm),
]);

/**
 * tipo: parcelamento | quitacao_desconto | baixa_negociada
 * status: proposta | aceita | ativa | cumprida | quebrada | cancelada
 */
export const cobrancaNegociacoes = pgTable("cobranca_negociacoes", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  casoId: integer("caso_id").notNull().references(() => cobrancaCasos.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  tipo: text("tipo").notNull(),
  valorOriginal: decimal("valor_original", { precision: 12, scale: 2 }).notNull(),
  valorNegociado: decimal("valor_negociado", { precision: 12, scale: 2 }).notNull(),
  descontoPct: decimal("desconto_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  entrada: decimal("entrada", { precision: 12, scale: 2 }).notNull().default("0"),
  /** Quantas parcelas — igual ao numero de linhas em `cobranca_parcelas`. */
  parcelas: integer("parcelas").notNull().default(0),
  valorParcela: decimal("valor_parcela", { precision: 12, scale: 2 }),
  primeiroVencimento: date("primeiro_vencimento"),
  status: text("status").notNull().default("proposta"),
  criadoPorUserId: integer("criado_por_user_id").notNull().references(() => users.id),
  aceitaEm: timestamp("aceita_em"),
  quebradaEm: timestamp("quebrada_em"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_cobranca_negociacoes_caso").on(t.providerId, t.casoId),
]);

/** status: pendente | paga | atrasada | cancelada */
export const cobrancaParcelas = pgTable("cobranca_parcelas", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  negociacaoId: integer("negociacao_id").notNull().references(() => cobrancaNegociacoes.id),
  numero: integer("numero").notNull(),
  valor: decimal("valor", { precision: 12, scale: 2 }).notNull(),
  vencimento: date("vencimento").notNull(),
  pagoEm: timestamp("pago_em"),
  valorPago: decimal("valor_pago", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("pendente"),
}, (t) => [
  uniqueIndex("cobranca_parcelas_numero").on(t.negociacaoId, t.numero),
  // O job que marca atrasadas, e o KPI de recuperado nos ultimos 30 dias.
  index("idx_cobranca_parcelas_status_vencimento").on(t.providerId, t.status, t.vencimento),
]);

export const insertCobrancaCasoSchema = createInsertSchema(cobrancaCasos).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCobrancaEventoSchema = createInsertSchema(cobrancaEventos).omit({ id: true, createdAt: true });
export const insertCobrancaNegociacaoSchema = createInsertSchema(cobrancaNegociacoes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCobrancaParcelaSchema = createInsertSchema(cobrancaParcelas).omit({ id: true });

// `$inferInsert`, e nao z.infer dos schemas acima, para o JSONB tipado
// (`etapas`, `negociacao`, `metadata`) chegar ao storage com o tipo declarado
// em vez de `unknown`.
export type CobrancaPolitica = typeof cobrancaPolitica.$inferSelect;
export type InsertCobrancaPolitica = typeof cobrancaPolitica.$inferInsert;
export type CobrancaCaso = typeof cobrancaCasos.$inferSelect;
export type InsertCobrancaCaso = typeof cobrancaCasos.$inferInsert;
export type CobrancaEvento = typeof cobrancaEventos.$inferSelect;
export type InsertCobrancaEvento = typeof cobrancaEventos.$inferInsert;
export type CobrancaNegociacao = typeof cobrancaNegociacoes.$inferSelect;
export type InsertCobrancaNegociacao = typeof cobrancaNegociacoes.$inferInsert;
export type CobrancaParcela = typeof cobrancaParcelas.$inferSelect;
export type InsertCobrancaParcela = typeof cobrancaParcelas.$inferInsert;

/* ── Chat BullQ — a ponte com o sistema de atendimento (migracao 0024, 05/09/2026) ──
 *
 * O Chat BullQ roda a parte; aqui fica so o VINCULO: a Organization de la que
 * pertence ao provedor daqui, o canal de WhatsApp escolhido, e cada conversa
 * aberta a partir de um caso de cobranca ou de recuperacao de equipamento.
 * Nenhum segredo nestas tabelas. */

export const chatBullqIntegracoes = pgTable("chat_bullq_integracoes", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  organizationId: text("organization_id").notNull(),
  slug: text("slug").notNull(),
  ownerEmail: text("owner_email").notNull(),
  canalId: text("canal_id"),
  canalNome: text("canal_nome"),
  /** provisionado (org criada, sem canal) · ativo (canal testado) · erro */
  status: text("status").notNull().default("provisionado"),
  ultimoErro: text("ultimo_erro"),
  /** SHA-256 da chave que o agente de IA do Chat BullQ usa para chamar o Consulta ISP (migracao 0025). */
  chaveAgenteHash: text("chave_agente_hash"),
  /** O AiAgent de cobranca criado na organizacao do provedor. */
  agenteId: text("agente_id"),
  /** ids da tool, das skills e das automacoes criadas la — para nao recriar. */
  agenteConfig: jsonb("agente_config").$type<Record<string, unknown>>(),
  /** Segredo do HMAC dos avisos que o Chat BullQ manda de volta (call_webhook). */
  webhookSecret: text("webhook_secret"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("chat_bullq_integracoes_provider").on(t.providerId)]);

export const chatBullqConversas = pgTable("chat_bullq_conversas", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  casoId: integer("caso_id").references(() => cobrancaCasos.id),
  recuperacaoId: integer("recuperacao_id").references(() => equipmentRecoveryCases.id),
  /** cobranca | equipamentos */
  origem: text("origem").notNull(),
  conversationId: text("conversation_id").notNull(),
  canalId: text("canal_id").notNull(),
  abertaPorUserId: integer("aberta_por_user_id").references(() => users.id),
  /** Como o Chat BullQ devolve: PENDING · BOT · OPEN · WAITING · CLOSED */
  status: text("status").notNull().default("BOT"),
  abertaEm: timestamp("aberta_em").notNull().defaultNow(),
  ultimoEventoEm: timestamp("ultimo_evento_em"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("chat_bullq_conversas_conversa").on(t.providerId, t.conversationId)]);

export type ChatBullqIntegracao = typeof chatBullqIntegracoes.$inferSelect;
export type InsertChatBullqIntegracao = typeof chatBullqIntegracoes.$inferInsert;
export type ChatBullqConversa = typeof chatBullqConversas.$inferSelect;
export type InsertChatBullqConversa = typeof chatBullqConversas.$inferInsert;

/* A autonomia do chat (migracao 0028): o motor CONTROLADO do Consulta ISP que
 * responde ao cliente sozinho, dentro do que o provedor permitiu. O LLM so
 * escolhe a intencao; texto, valor e data sao do servidor. Tres tabelas:
 * a configuracao por provedor, o estado por conversa (rodadas, proposta em
 * aberto, se um humano assumiu) e a fila duravel de mensagens a responder.
 * Declaradas identicas a migrations/0028_chat_autonomia.sql. */

export const chatAutonomiaConfig = pgTable("chat_autonomia_config", {
  providerId: integer("provider_id").primaryKey().references(() => providers.id),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{"ativa":false}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatAutonomiaEstado = pgTable("chat_autonomia_estado", {
  providerId: integer("provider_id").notNull().references(() => providers.id),
  conversationId: text("conversation_id").notNull(),
  turnos: integer("turnos").notNull().default(0),
  humano: boolean("humano").notNull().default(false),
  proposta: jsonb("proposta").$type<Record<string, unknown>>(),
  motivo: text("motivo"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.providerId, t.conversationId] }),
  foreignKey({ columns: [t.providerId, t.conversationId], foreignColumns: [chatBullqConversas.providerId, chatBullqConversas.conversationId] }),
  check("chat_autonomia_estado_turnos_check", sql`${t.turnos} >= 0`),
]);


export const chatAutonomiaFila = pgTable("chat_autonomia_fila", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  conversationId: text("conversation_id").notNull(),
  messageId: text("message_id").notNull(),
  /** pendente · processando · enviando · concluido · humano · cancelado */
  status: text("status").notNull().default("pendente"),
  motivo: text("motivo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("chat_autonomia_fila_provider_id_message_id_key").on(t.providerId, t.messageId),
  foreignKey({ columns: [t.providerId, t.conversationId], foreignColumns: [chatBullqConversas.providerId, chatBullqConversas.conversationId] }),
  check("chat_autonomia_fila_status_check", sql`${t.status} in ('pendente','processando','enviando','concluido','humano','cancelado')`),
  index("chat_autonomia_pendente").on(t.status, t.id),
]);

export type ChatAutonomiaConfigLinha = typeof chatAutonomiaConfig.$inferSelect;
export type ChatAutonomiaEstadoLinha = typeof chatAutonomiaEstado.$inferSelect;
export type ChatAutonomiaFilaLinha = typeof chatAutonomiaFila.$inferSelect;

export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;
