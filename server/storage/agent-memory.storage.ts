import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import {
  agentMemories,
  type AgentMemory,
} from "@shared/schema";

/**
 * Spec 003 — Memória persistente por (customer × agent).
 * Cada agente (Helena, Júlia, Rafael, Daniel etc) acumula contexto sobre o cliente:
 * fatos, promessas, tópicos, histórico de sentimento.
 *
 * NOTA: agent_memories não tem providerId direto — o isolamento se dá via customers.providerId.
 * Callers DEVEM validar que o customerId pertence ao providerId antes de chamar estas funções.
 */

export interface MemoryFact {
  fact: string;
  source?: string;
  recordedAt: string; // ISO
  confidence?: number;
}

export interface MemoryPromise {
  promise: string;
  dueDate?: string; // ISO
  status?: "pending" | "fulfilled" | "broken";
  recordedAt: string; // ISO
}

export interface MemorySentiment {
  sentiment: "positive" | "neutral" | "negative" | string;
  score?: number;
  recordedAt: string; // ISO
  context?: string;
}

export class AgentMemoryStorage {
  /** Carrega memória do agente para um cliente. Retorna undefined se não existe. */
  async load(customerId: number, agentId: string): Promise<AgentMemory | undefined> {
    const [row] = await db.select().from(agentMemories)
      .where(and(
        eq(agentMemories.customerId, customerId),
        eq(agentMemories.agentId, agentId),
      ))
      .limit(1);
    return row;
  }

  /**
   * Upsert da memória. Patch é aplicado por cima dos campos existentes
   * (substitui arrays/JSON inteiros — caller é responsável por mergear arrays se quiser).
   */
  async save(
    customerId: number,
    agentId: string,
    patch: Partial<Pick<AgentMemory, "facts" | "promises" | "topics" | "sentimentHistory" | "summary" | "lastInteractionAt">>,
  ): Promise<AgentMemory> {
    const existing = await this.load(customerId, agentId);
    const now = new Date();

    if (existing) {
      const [updated] = await db.update(agentMemories)
        .set({
          ...patch,
          updatedAt: now,
        })
        .where(eq(agentMemories.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(agentMemories)
      .values({
        customerId,
        agentId,
        facts: (patch.facts ?? []) as any,
        promises: (patch.promises ?? []) as any,
        topics: patch.topics ?? [],
        sentimentHistory: (patch.sentimentHistory ?? []) as any,
        summary: patch.summary ?? null,
        lastInteractionAt: patch.lastInteractionAt ?? now,
      })
      .returning();
    return created;
  }

  /** Acrescenta um fato à lista de facts (preserva os anteriores). */
  async appendFact(customerId: number, agentId: string, fact: MemoryFact): Promise<AgentMemory> {
    const existing = await this.load(customerId, agentId);
    const now = new Date();

    if (existing) {
      const [updated] = await db.update(agentMemories)
        .set({
          facts: sql`COALESCE(${agentMemories.facts}, '[]'::jsonb) || ${JSON.stringify([fact])}::jsonb` as any,
          lastInteractionAt: now,
          updatedAt: now,
        })
        .where(eq(agentMemories.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(agentMemories)
      .values({
        customerId,
        agentId,
        facts: [fact] as any,
        promises: [] as any,
        topics: [],
        sentimentHistory: [] as any,
        lastInteractionAt: now,
      })
      .returning();
    return created;
  }

  /** Acrescenta uma promessa à lista de promises (preserva as anteriores). */
  async addPromise(customerId: number, agentId: string, promise: MemoryPromise): Promise<AgentMemory> {
    const existing = await this.load(customerId, agentId);
    const now = new Date();

    if (existing) {
      const [updated] = await db.update(agentMemories)
        .set({
          promises: sql`COALESCE(${agentMemories.promises}, '[]'::jsonb) || ${JSON.stringify([promise])}::jsonb` as any,
          lastInteractionAt: now,
          updatedAt: now,
        })
        .where(eq(agentMemories.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(agentMemories)
      .values({
        customerId,
        agentId,
        facts: [] as any,
        promises: [promise] as any,
        topics: [],
        sentimentHistory: [] as any,
        lastInteractionAt: now,
      })
      .returning();
    return created;
  }

  /** Acrescenta um registro de sentimento ao histórico. */
  async addSentiment(customerId: number, agentId: string, sentiment: MemorySentiment): Promise<AgentMemory> {
    const existing = await this.load(customerId, agentId);
    const now = new Date();

    if (existing) {
      const [updated] = await db.update(agentMemories)
        .set({
          sentimentHistory: sql`COALESCE(${agentMemories.sentimentHistory}, '[]'::jsonb) || ${JSON.stringify([sentiment])}::jsonb` as any,
          lastInteractionAt: now,
          updatedAt: now,
        })
        .where(eq(agentMemories.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(agentMemories)
      .values({
        customerId,
        agentId,
        facts: [] as any,
        promises: [] as any,
        topics: [],
        sentimentHistory: [sentiment] as any,
        lastInteractionAt: now,
      })
      .returning();
    return created;
  }
}
