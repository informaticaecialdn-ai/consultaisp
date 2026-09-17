import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { chatAutonomiaAutorizacao, chatAutonomiaSeguranca, type OfertasAutonomia } from "@shared/chat-autonomia-seguranca";
import { tentativasDosEstados, type EstadoIdentidade, type TentativasDoCliente } from "../services/chat/chat-autonomia-identidade";
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
  /**
   * Tentativas erradas de identidade do MESMO cliente, somadas em todas as conversas do provedor (spec D10,
   * s7): 3 em 24 h e 5 em 30 dias valem por cliente, senão cada conversa nova da régua — ou cada devolução
   * do atendente — dava mais 3 chutes nos 4 dígitos. Sem migração: o histórico mora no JSONB da identidade
   * (`tentativasEm`), e o filtro por cliente é refeito na contagem, caso o do banco falhe.
   */
  async tentativasDoCliente(providerId: number, customerId: number, agora = new Date()): Promise<TentativasDoCliente> {
    const linhas = await db.select({ identidade: chatAutonomiaSeguranca.identidade }).from(chatAutonomiaSeguranca)
      // também as linhas de conversa revinculada a outro cliente que guardaram as tentativas deste (correção 2)
      .where(and(eq(chatAutonomiaSeguranca.providerId, providerId), sql`(${chatAutonomiaSeguranca.identidade}->>'customerId' = ${String(customerId)} or (${chatAutonomiaSeguranca.identidade}->'tentativasDeOutrosClientes') ? ${String(customerId)})`));
    return tentativasDosEstados(linhas.map(l => l.identidade), providerId, customerId, agora);
  },
  /**
   * O atendente devolveu a conversa: a confirmação e as ofertas caem, o HISTÓRICO DE TENTATIVAS fica.
   * Antes a linha era apagada, e com ela as tentativas — devolver a conversa zerava o limite (s7).
   */
  async revogar(providerId: number, conversationId: string) {
    await db.update(chatAutonomiaSeguranca)
      .set({
        ofertas: null,
        identidade: sql`case when ${chatAutonomiaSeguranca.identidade} is null then null else jsonb_set(jsonb_set(${chatAutonomiaSeguranca.identidade}, '{confirmadaEm}', 'null'::jsonb), '{validaAte}', 'null'::jsonb) end`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(chatAutonomiaSeguranca.providerId, providerId), eq(chatAutonomiaSeguranca.conversationId, conversationId)));
  },
};
