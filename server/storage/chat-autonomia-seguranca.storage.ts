import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { chatAutonomiaAutorizacao, chatAutonomiaSeguranca, type OfertasAutonomia } from "@shared/chat-autonomia-seguranca";
import type { EstadoIdentidade } from "../services/chat/chat-autonomia-identidade";
export const segurancaAutonomiaStorage = {
  async autorizacao(providerId: number) {
    const [linha] = await db.select({ userId: chatAutonomiaAutorizacao.userId }).from(chatAutonomiaAutorizacao).where(eq(chatAutonomiaAutorizacao.providerId, providerId)).limit(1);
    return linha?.userId ?? null;
  },
  async autorizar(providerId: number, userId: number) {
    await db.insert(chatAutonomiaAutorizacao).values({ providerId, userId }).onConflictDoUpdate({ target: chatAutonomiaAutorizacao.providerId, set: { userId, updatedAt: sql`now()` } });
  },
  async ler(providerId: number, conversationId: string) {
    const [linha] = await db.select({ identidade: chatAutonomiaSeguranca.identidade, ofertas: chatAutonomiaSeguranca.ofertas }).from(chatAutonomiaSeguranca)
      .where(and(eq(chatAutonomiaSeguranca.providerId, providerId), eq(chatAutonomiaSeguranca.conversationId, conversationId))).limit(1);
    return linha ?? { identidade: null, ofertas: null };
  },
  async identidade(providerId: number, conversationId: string, identidade: EstadoIdentidade | null) {
    await db.insert(chatAutonomiaSeguranca).values({ providerId, conversationId, identidade })
      .onConflictDoUpdate({ target: [chatAutonomiaSeguranca.providerId, chatAutonomiaSeguranca.conversationId], set: { identidade, updatedAt: sql`now()` } });
  },
  async ofertas(providerId: number, conversationId: string, ofertas: OfertasAutonomia | null) {
    await db.insert(chatAutonomiaSeguranca).values({ providerId, conversationId, ofertas })
      .onConflictDoUpdate({ target: [chatAutonomiaSeguranca.providerId, chatAutonomiaSeguranca.conversationId], set: { ofertas, updatedAt: sql`now()` } });
  },
  async revogar(providerId: number, conversationId: string) {
    await db.delete(chatAutonomiaSeguranca).where(and(eq(chatAutonomiaSeguranca.providerId, providerId), eq(chatAutonomiaSeguranca.conversationId, conversationId)));
  },
};
