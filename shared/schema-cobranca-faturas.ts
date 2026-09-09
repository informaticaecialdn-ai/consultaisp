import { pgTable, serial, integer, text, date, decimal, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { customers, invoices, providers, users } from "./schema";

/** A evidência de quitação é imutável. Sumir das abertas não cria recibo. */
export const cobrancaQuitacoes = pgTable("cobranca_quitacoes", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  faturaId: integer("fatura_id").notNull().references(() => invoices.id),
  origem: text("origem").notNull(),
  referencia: text("referencia").notNull(),
  pagoEm: date("pago_em").notNull(),
  valorPago: decimal("valor_pago", { precision: 12, scale: 2 }).notNull(),
  userId: integer("user_id").references(() => users.id),
  confirmadoEm: timestamp("confirmado_em").defaultNow().notNull(),
  divergenciaErpEm: timestamp("divergencia_erp_em"),
}, t => [uniqueIndex("cobranca_quitacoes_fatura_uq").on(t.providerId, t.faturaId),
  uniqueIndex("cobranca_quitacoes_referencia_uq").on(t.providerId, t.origem, t.referencia)]);

/** Fila independente: uma fatura a vencer não é um caso de inadimplência. */
export const cobrancaPreAvisos = pgTable("cobranca_pre_avisos", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  faturaId: integer("fatura_id").notNull().references(() => invoices.id),
  diaContato: date("dia_contato").notNull(),
  vencimento: date("vencimento").notNull(),
  diasAtraso: integer("dias_atraso").notNull(),
  status: text("status").default("pendente").notNull(),
  motivo: text("motivo"),
  conversationId: text("conversation_id"),
  messageId: text("message_id"),
  atualizadoEm: timestamp("atualizado_em").defaultNow().notNull(),
}, t => [uniqueIndex("cobranca_pre_avisos_fatura_dia_uq").on(t.providerId, t.faturaId, t.diaContato),
  index("cobranca_pre_avisos_fila_idx").on(t.providerId, t.diaContato, t.status)]);
