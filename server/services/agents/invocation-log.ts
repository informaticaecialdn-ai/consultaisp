/**
 * Spec 008.6 — Persistence helper for `agent_invocations`.
 *
 * Fire-and-forget logger that records each invocation (direct, managed, or
 * shadow pair). Failures don't bubble — invocations should not fail just
 * because telemetry insertion did. Errors go to structured logs.
 */

import { db } from "../../db";
import { agentInvocations } from "@shared/schema";
import { logger } from "../../logger";
import type { InvocationRecord } from "./types";

/**
 * Insert one row in `agent_invocations`. Returns the inserted id so callers
 * can later set `pairedInvocationId` on the sibling row (shadow mode).
 */
export async function logInvocation(record: InvocationRecord): Promise<number | null> {
  try {
    const [row] = await db
      .insert(agentInvocations)
      .values({
        providerId: record.providerId,
        agentId: record.agentId,
        runtime: record.runtime,
        anthropicSessionId: record.anthropicSessionId ?? null,
        anthropicAgentId: record.anthropicAgentId ?? null,
        inputHash: record.inputHash ?? null,
        outputJson: (record.outputJson ?? null) as unknown as Record<string, unknown>,
        tokensInput: record.tokensInput ?? null,
        tokensOutput: record.tokensOutput ?? null,
        latencyMs: record.latencyMs ?? null,
        status: record.status,
        errorMessage: record.errorMessage ?? null,
        correlationId: record.correlationId ?? null,
        pairedInvocationId: record.pairedInvocationId ?? null,
        endedAt: record.endedAt ?? new Date(),
      })
      .returning({ id: agentInvocations.id });
    return row?.id ?? null;
  } catch (err) {
    logger.error(
      {
        action: "agent_invocations_persist_failed",
        agentId: record.agentId,
        runtime: record.runtime,
        providerId: record.providerId,
        correlationId: record.correlationId,
        err: (err as Error)?.message,
      },
      "Failed to persist agent_invocations row",
    );
    return null;
  }
}

/**
 * Update an existing row to set `pairedInvocationId`. Used in shadow mode
 * after both direct + managed rows are inserted, to link them.
 */
export async function linkPair(invocationId: number, pairedId: number): Promise<void> {
  try {
    const { eq } = await import("drizzle-orm");
    await db
      .update(agentInvocations)
      .set({ pairedInvocationId: pairedId })
      .where(eq(agentInvocations.id, invocationId));
  } catch (err) {
    logger.error(
      {
        action: "agent_invocations_link_pair_failed",
        invocationId,
        pairedId,
        err: (err as Error)?.message,
      },
      "Failed to link paired invocations",
    );
  }
}

/**
 * Stable hash of an input object for deduplication of shadow comparisons.
 * Not cryptographic — just consistent JSON canonicalization + djb2.
 */
export function hashInput(input: unknown): string {
  const canonical = JSON.stringify(input, Object.keys((input ?? {}) as Record<string, unknown>).sort());
  let hash = 5381;
  for (let i = 0; i < canonical.length; i++) {
    hash = (hash * 33) ^ canonical.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
