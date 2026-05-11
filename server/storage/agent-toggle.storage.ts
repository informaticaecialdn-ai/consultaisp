import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  agentToggles,
  type AgentToggles,
} from "@shared/schema";

/**
 * Spec 004 — Toggles Bruno/Sofia + janela horária por tenant.
 * Cria registro default (todos OFF) automaticamente quando não existe.
 */
export class AgentToggleStorage {
  /**
   * Busca config; se não existir, cria com defaults (FR-013 — opt-in explícito).
   */
  async byProviderId(providerId: number): Promise<AgentToggles> {
    const [existing] = await db.select().from(agentToggles)
      .where(eq(agentToggles.providerId, providerId))
      .limit(1);
    if (existing) return existing;

    const [created] = await db.insert(agentToggles)
      .values({ providerId })
      .returning();
    return created;
  }

  async update(
    providerId: number,
    patch: Partial<Omit<AgentToggles, "id" | "providerId" | "createdAt" | "updatedAt">>,
  ): Promise<AgentToggles> {
    // Garante que o registro existe
    await this.byProviderId(providerId);

    const [updated] = await db.update(agentToggles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(agentToggles.providerId, providerId))
      .returning();
    return updated;
  }

  /**
   * Lista provedores com bruno_ativo=true. Usado pelo scheduler diário.
   */
  async listProvidersWithBrunoActive(): Promise<AgentToggles[]> {
    return db.select().from(agentToggles)
      .where(eq(agentToggles.brunoAtivo, true));
  }

  /**
   * Lista provedores com sofia_ativa=true. Usado pelo handler de webhook.
   */
  async isSofiaActive(providerId: number): Promise<boolean> {
    const config = await this.byProviderId(providerId);
    return config.sofiaAtiva;
  }
}
