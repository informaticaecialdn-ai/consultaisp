/**
 * SCHEMAS DRAFT — Spec 003 (WhatsApp + Júlia + Helena)
 *
 * RASCUNHO. NÃO MERGEAR em shared/schema.ts sem autorização explícita
 * do owner (Princípio II — schema imutável sem autorização).
 *
 * 6 tabelas novas para suportar P1 do módulo Cobrança:
 * - communications: toda comunicação inbound/outbound
 * - audit_logs: imutável via trigger Postgres
 * - agent_memories: memória persistente por (customer, agent)
 * - compliance_checks: cada validação da Júlia
 * - agreements: acordos de pagamento (Rafael/Daniel)
 * - whatsapp_accounts: configuração Meta por tenant (Embedded Signup)
 *
 * Extraído via agent-A em 2026-05-11 a partir de RESOURCES.md e TEAM.md.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  serial,
  varchar,
  timestamp,
  jsonb,
  decimal,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
// import { providers, customers } from "../shared/schema"; // referências externas

// ============================================================
// 1. communications — toda comunicação inbound/outbound
// ============================================================

export const communications = pgTable(
  "communications",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id").notNull(), // .references(() => providers.id)
    customerId: integer("customer_id").notNull(), // .references(() => customers.id)
    channel: varchar("channel", { length: 20 }).notNull(), // WHATSAPP | SMS | EMAIL
    direction: varchar("direction", { length: 20 }).notNull(), // INBOUND | OUTBOUND
    templateName: text("template_name"), // null se free-form
    content: text("content").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    externalMessageId: text("external_message_id"), // wamid do Meta
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    readAt: timestamp("read_at"),
    agentId: text("agent_id"), // agt_reativo_v1, agt_compliance_v1, etc.
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    providerCustomerCreatedIdx: index("communications_provider_customer_created_idx").on(
      t.providerId,
      t.customerId,
      t.createdAt
    ),
    externalMessageIdIdx: index("communications_external_message_id_idx").on(t.externalMessageId),
  })
);

// ============================================================
// 2. audit_logs — APPEND-ONLY via trigger Postgres
// ============================================================

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    providerId: integer("provider_id").notNull(),
    action: text("action").notNull(), // send_whatsapp_cobranca, approve_agreement, etc.
    resource: text("resource").notNull(), // Customer, Communication, Agreement, etc.
    resourceId: text("resource_id").notNull(),
    actorType: varchar("actor_type", { length: 20 }).notNull(), // AGENT | HUMAN | SYSTEM
    actorId: text("actor_id"),
    actorName: text("actor_name"), // "Rafael - Negociador"
    payload: jsonb("payload"),
    legalBasis: text("legal_basis"),
    legalReferences: text("legal_references").array().default(sql`'{}'::text[]`),
    notificationProof: jsonb("notification_proof"), // { wamid, deliveredAt, readAt }
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    providerOccurredIdx: index("audit_logs_provider_occurred_idx").on(t.providerId, t.occurredAt),
    providerResourceIdx: index("audit_logs_provider_resource_idx").on(t.providerId, t.resource, t.resourceId),
  })
);

// ============================================================
// 3. agent_memories — memória persistente por (customer, agent)
// ============================================================

export const agentMemories = pgTable(
  "agent_memories",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").notNull(),
    agentId: text("agent_id").notNull(), // agt_reativo_v1, etc.
    facts: jsonb("facts").default(sql`'[]'::jsonb`), // [{ key, value, source, extractedAt }]
    promises: jsonb("promises").default(sql`'[]'::jsonb`), // [{ promise, promisedDate, status, createdAt }]
    topics: text("topics").array().default(sql`'{}'::text[]`),
    sentimentHistory: jsonb("sentiment_history").default(sql`'[]'::jsonb`), // [{ score, timestamp, context }]
    summary: text("summary"),
    lastInteractionAt: timestamp("last_interaction_at"),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    customerAgentUnique: uniqueIndex("agent_memories_customer_agent_uq").on(t.customerId, t.agentId),
  })
);

// ============================================================
// 4. compliance_checks — cada validação da Júlia
// ============================================================

export const complianceChecks = pgTable(
  "compliance_checks",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    providerId: integer("provider_id").notNull(),
    customerId: integer("customer_id").notNull(),
    agentId: text("agent_id"), // quem pediu validação
    proposedAction: jsonb("proposed_action").notNull(), // { actionType, content, channel, scheduledAt }
    decision: varchar("decision", { length: 30 }).notNull(), // APPROVED | APPROVED_WITH_ADJUSTMENT | BLOCKED
    legalBasis: text("legal_basis"),
    legalReferences: text("legal_references").array().default(sql`'{}'::text[]`),
    adjustments: jsonb("adjustments"),
    blockingReasons: text("blocking_reasons").array(),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    providerCreatedIdx: index("compliance_checks_provider_created_idx").on(t.providerId, t.createdAt),
    customerDecisionIdx: index("compliance_checks_customer_decision_idx").on(t.customerId, t.decision),
  })
);

// ============================================================
// 5. agreements — acordos de pagamento (Rafael, Daniel)
// ============================================================

export const agreements = pgTable(
  "agreements",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    providerId: integer("provider_id").notNull(),
    customerId: integer("customer_id").notNull(),
    invoiceIds: integer("invoice_ids").array().notNull(),
    type: varchar("type", { length: 30 }).notNull(), // PROMPT_PAYMENT | EXTENSION | INSTALLMENT
    totalValue: decimal("total_value", { precision: 10, scale: 2 }).notNull(),
    discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }).default("0"),
    installments: jsonb("installments").default(sql`'[]'::jsonb`), // [{ due_date, value, paid_at, status }]
    status: varchar("status", { length: 20 }).notNull().default("pending"), // PENDING | ACTIVE | COMPLETED | BROKEN | CANCELLED
    agreedAt: timestamp("agreed_at").notNull().defaultNow(),
    expectedFulfillmentAt: timestamp("expected_fulfillment_at"),
    fulfilledAt: timestamp("fulfilled_at"),
    brokenAt: timestamp("broken_at"),
    agentId: text("agent_id"), // Rafael ou Daniel ou humano
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    providerCreatedIdx: index("agreements_provider_created_idx").on(t.providerId, t.createdAt),
    customerStatusIdx: index("agreements_customer_status_idx").on(t.customerId, t.status),
  })
);

// ============================================================
// 6. whatsapp_accounts — Meta Cloud API por tenant (1:1)
// ============================================================

export const whatsappAccounts = pgTable(
  "whatsapp_accounts",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id").notNull().unique(),
    wabaId: text("waba_id").notNull().unique(),
    phoneNumberId: text("phone_number_id").notNull().unique(),
    displayName: text("display_name"),
    accessTokenEncrypted: text("access_token_encrypted").notNull(), // AES-256-GCM
    wabaStatus: varchar("waba_status", { length: 20 }).default("pending"),
    qualityRating: varchar("quality_rating", { length: 10 }), // GREEN | YELLOW | RED
    verifiedAt: timestamp("verified_at"),
    tokenExpiresAt: timestamp("token_expires_at"), // para rotação automática
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  }
);

// ============================================================
// TYPES INFERIDOS
// ============================================================

export type Communication = typeof communications.$inferSelect;
export type InsertCommunication = typeof communications.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;
export type AgentMemory = typeof agentMemories.$inferSelect;
export type InsertAgentMemory = typeof agentMemories.$inferInsert;
export type ComplianceCheck = typeof complianceChecks.$inferSelect;
export type InsertComplianceCheck = typeof complianceChecks.$inferInsert;
export type Agreement = typeof agreements.$inferSelect;
export type InsertAgreement = typeof agreements.$inferInsert;
export type WhatsappAccount = typeof whatsappAccounts.$inferSelect;
export type InsertWhatsappAccount = typeof whatsappAccounts.$inferInsert;
