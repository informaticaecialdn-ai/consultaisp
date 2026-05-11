/**
 * Spec 004 — Tool `consultar_memoria_cliente` (Sofia / opcional).
 *
 * Read-only. Faz lookup em `agent_memories` por customerId. Sofia raramente
 * precisa chamar (worker já injeta `memoryFacts` no input), mas a tool existe
 * para os casos onde `memoryFacts` veio vazio E o agente sente que precisa
 * de contexto adicional pra decidir o tom.
 *
 * Multi-tenant gate: o caller (worker) já validou que `customerId` pertence
 * ao `providerId`; aqui apenas filtramos por customerId.
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { customers, agentMemories } from "@shared/schema";
import { logger } from "../../logger";

export const consultarMemoriaTool: Tool = {
  name: "consultar_memoria_cliente",
  description:
    "Retorna fatos consolidados sobre o cliente do banco de memória dos agentes. Use somente se a lista `memoryFacts` veio vazia no input e você precisa de contexto adicional.",
  input_schema: {
    type: "object",
    properties: {
      customerId: { type: "integer", description: "ID interno do cliente" },
    },
    required: ["customerId"],
  },
};

export interface ConsultarMemoriaArgs {
  customerId: number;
}

export interface ConsultarMemoriaResult {
  ok: boolean;
  facts?: Array<{ key: string; value: string }>;
  summary?: string | null;
  error?: string;
}

export interface ConsultarMemoriaContext {
  providerId: number;
  /** customerId esperado (multi-tenant gate). */
  expectedCustomerId: number;
  correlationId?: string;
}

export async function executeConsultarMemoria(
  ctx: ConsultarMemoriaContext,
  rawArgs: unknown,
): Promise<ConsultarMemoriaResult> {
  const args = (rawArgs ?? {}) as Partial<ConsultarMemoriaArgs>;
  const customerId = Number(args.customerId);

  if (!Number.isFinite(customerId) || customerId <= 0) {
    return { ok: false, error: "customerId inválido" };
  }
  // Multi-tenant: tool não pode olhar outro cliente.
  if (customerId !== ctx.expectedCustomerId) {
    logger.warn(
      { action: "sofia_tool_cross_customer_attempt", providerId: ctx.providerId, requested: customerId, expected: ctx.expectedCustomerId },
      "Sofia tentou consultar memória de outro cliente — bloqueado",
    );
    return { ok: false, error: "customerId fora de escopo" };
  }

  // Multi-tenant defense-in-depth: confirma que customer ainda pertence ao provider.
  const [cust] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.providerId, ctx.providerId)))
    .limit(1);

  if (!cust) {
    return { ok: false, error: "customer não pertence ao provider" };
  }

  // Coleta memória de TODOS agentes (cross-agent insights — Sofia pode aprender com Helena/Bruno).
  const rows = await db
    .select({ facts: agentMemories.facts, summary: agentMemories.summary, agentId: agentMemories.agentId })
    .from(agentMemories)
    .where(eq(agentMemories.customerId, customerId));

  if (rows.length === 0) {
    return { ok: true, facts: [], summary: null };
  }

  const flatFacts: Array<{ key: string; value: string }> = [];
  let summaryParts: string[] = [];

  for (const r of rows) {
    if (r.summary) summaryParts.push(r.summary);
    const facts = (r.facts ?? []) as Array<Record<string, unknown>>;
    for (const f of facts) {
      // Aceita 2 formatos comuns: {fact: "..."} OU {key, value}
      if (typeof f.fact === "string") {
        flatFacts.push({ key: "fact", value: f.fact });
      } else if (typeof f.key === "string") {
        flatFacts.push({ key: f.key, value: String(f.value ?? "") });
      }
    }
  }

  return {
    ok: true,
    facts: flatFacts.slice(0, 30), // limite defensivo
    summary: summaryParts.length > 0 ? summaryParts.join(" / ") : null,
  };
}
