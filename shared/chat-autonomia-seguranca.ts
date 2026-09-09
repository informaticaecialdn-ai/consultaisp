import { foreignKey, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { chatBullqConversas, providers, users } from "./schema";
import type { EstadoIdentidade } from "./chat-autonomia";
import type { OfertaDeAcordo } from "./cobranca/acordo";
import type { Carteira } from "./cobranca/estados";

export interface OfertasAutonomia {
  customerId: number;
  carteira: Carteira;
  saldo: number;
  criadaEm: string;
  messageId: string;
  ofertas: OfertaDeAcordo[];
  selecionada: number | null;
  vencimentoMaximo: string;
  politicaHash: string;
}
/** 0034: estado adicional isolado, sem alterar o schema central. Nenhum documento bruto é armazenado. */
export const chatAutonomiaSeguranca = pgTable("chat_autonomia_seguranca", {
  providerId: integer("provider_id").notNull().references(() => providers.id),
  conversationId: text("conversation_id").notNull(),
  identidade: jsonb("identidade").$type<EstadoIdentidade | null>(),
  ofertas: jsonb("ofertas").$type<OfertasAutonomia | null>(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => [
  uniqueIndex("chat_autonomia_seguranca_conversa").on(t.providerId, t.conversationId),
  foreignKey({ columns: [t.providerId, t.conversationId], foreignColumns: [chatBullqConversas.providerId, chatBullqConversas.conversationId] }).onDelete("cascade"),
]);
export const chatAutonomiaAutorizacao = pgTable("chat_autonomia_autorizacao", {
  providerId: integer("provider_id").primaryKey().references(() => providers.id),
  userId: integer("user_id").notNull().references(() => users.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
