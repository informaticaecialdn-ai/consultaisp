/**
 * Spec 004 — Bruno + Sofia + Pix dinâmico
 *
 * 5 tabelas novas. Autorizado pelo owner em 2026-05-11.
 * Multi-tenant invariante (Princípio I): toda tabela com `provider_id`.
 *
 * Este arquivo é um RASCUNHO; o conteúdo abaixo é mesclado em `shared/schema.ts`
 * durante a task T005. Depois deste merge, ele continua aqui apenas como
 * referência histórica.
 */
import { sql } from "drizzle-orm";
import {
  pgTable, text, varchar, integer, boolean, timestamp, decimal,
  serial, jsonb, uniqueIndex, index, date, numeric, time
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Estas referências (providers, customers, invoices, communications, complianceChecks)
// existem em shared/schema.ts. Aqui o draft é auto-contido para clareza.
declare const providers: any;
declare const customers: any;
declare const invoices: any;
declare const communications: any;
declare const complianceChecks: any;

// 1) asaas_accounts ----------------------------------------------------------
export const asaasAccounts = pgTable("asaas_accounts", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().unique().references(() => providers.id),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  webhookTokenEncrypted: text("webhook_token_encrypted"),
  mode: varchar("mode", { length: 10 }).notNull().default("sandbox"), // 'sandbox' | 'production'
  accountStatus: varchar("account_status", { length: 20 }).notNull().default("pending"), // pending|verified|revoked
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 2) pix_charges -------------------------------------------------------------
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
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending|paid|expired|cancelled|refunded
  paidAt: timestamp("paid_at"),
  cancelledAt: timestamp("cancelled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  providerStatusIdx: index("pix_charges_provider_status_idx").on(t.providerId, t.status),
  invoiceIdx: index("pix_charges_invoice_idx").on(t.invoiceId),
  providerDueDateIdx: index("pix_charges_provider_due_idx").on(t.providerId, t.dueDate),
}));

// 3) payment_events ----------------------------------------------------------
export const paymentEvents = pgTable("payment_events", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  asaasPaymentId: text("asaas_payment_id").notNull(),
  eventType: varchar("event_type", { length: 40 }).notNull(),
  externalEventId: text("external_event_id"),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  processingStatus: varchar("processing_status", { length: 20 }).notNull().default("processed"), // processed|duplicate|rejected
  rejectionReason: text("rejection_reason"),
  sofiaJobId: text("sofia_job_id"),
}, (t) => ({
  // FR-008 idempotência: UNIQUE (provider_id, asaas_payment_id, event_type)
  uniqueProviderPaymentEvent: uniqueIndex("payment_events_provider_payment_event_uq")
    .on(t.providerId, t.asaasPaymentId, t.eventType),
  receivedAtIdx: index("payment_events_received_at_idx").on(t.receivedAt),
  processingStatusIdx: index("payment_events_processing_status_idx").on(t.processingStatus),
}));

// 4) agent_toggles -----------------------------------------------------------
export const agentToggles = pgTable("agent_toggles", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().unique().references(() => providers.id),
  brunoAtivo: boolean("bruno_ativo").notNull().default(false),
  sofiaAtiva: boolean("sofia_ativa").notNull().default(false),
  schedulerHoraLocal: time("scheduler_hora_local").notNull().default("09:00:00"),
  janelaInicio: time("janela_inicio").notNull().default("08:00:00"),
  janelaFim: time("janela_fim").notNull().default("20:00:00"),
  permiteSabado: boolean("permite_sabado").notNull().default(true),
  permiteDomingo: boolean("permite_domingo").notNull().default(false),
  templateBrunoNome: text("template_bruno_nome"),
  templateSofiaNome: text("template_sofia_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 5) outbound_attempts -------------------------------------------------------
export const outboundAttempts = pgTable("outbound_attempts", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  invoiceId: integer("invoice_id").references(() => invoices.id),
  pixChargeId: integer("pix_charge_id").references(() => pixCharges.id),
  agentId: varchar("agent_id", { length: 40 }).notNull(), // 'bruno_v1' | 'sofia_v1'
  step: varchar("step", { length: 20 }).notNull(), // 'D-3' | 'D-1' | 'THANK_YOU'
  scheduledFor: timestamp("scheduled_for").notNull(),
  status: varchar("status", { length: 30 }).notNull().default("scheduled"),
  // status: 'scheduled' | 'waiting_window' | 'awaiting_compliance' | 'vetoed' | 'sent' | 'failed' | 'needs_human_review'
  attemptCount: integer("attempt_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at"),
  complianceCheckId: text("compliance_check_id"), // FK opcional para compliance_checks.id (uuid string)
  communicationId: integer("communication_id"), // FK opcional para communications.id criado quando sent
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  providerStatusScheduledIdx: index("outbound_attempts_provider_status_scheduled_idx")
    .on(t.providerId, t.status, t.scheduledFor),
  statusNextRetryIdx: index("outbound_attempts_status_next_retry_idx")
    .on(t.status, t.nextRetryAt),
  // O UNIQUE (invoice_id, step, scheduled_for::date) é criado via SQL raw na migration
  // (Drizzle não suporta expression UNIQUE diretamente).
}));

// Insert schemas + types
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
