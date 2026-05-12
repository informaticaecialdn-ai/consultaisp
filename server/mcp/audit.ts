/**
 * Spec 008.5 Batch 2 — Audit log de tool calls MCP.
 *
 * Cada tool call gera entry em audit_logs com actorType="mcp" para
 * defesa jurídica e LGPD compliance. Não bloqueia request se insert
 * falha (log warning, segue).
 */

import { db } from "../db";
import { auditLogs } from "@shared/schema";
import { logger } from "../logger";
import type { McpAuthContext, McpToolName } from "./types";

/** Base legal default — ver TEAM.md §3.6 (LGPD). */
const LEGAL_BASIS_EXECUCAO_CONTRATO = "Execução de contrato (LGPD art. 7º V)";
const LEGAL_REFERENCES = ["LGPD art. 7º V"];

interface AuditPayload {
  tool: McpToolName;
  args: Record<string, unknown>;
  result: { ok: boolean; message?: string; recordCount?: number };
  /** Se masking foi aplicado (relevante para erp_get_customer com unmasked) */
  masked?: boolean;
  latencyMs?: number;
  error?: string;
}

export async function logMcpToolCall(
  ctx: McpAuthContext,
  payload: AuditPayload,
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      providerId: ctx.providerId,
      action: "mcp_tool_call",
      resource: "mcp_server_erp",
      resourceId: payload.tool,
      actorType: "mcp",
      actorId: ctx.tokenPrefix,
      actorName: ctx.tokenName,
      payload: payload as unknown as Record<string, unknown>,
      legalBasis: LEGAL_BASIS_EXECUCAO_CONTRATO,
      legalReferences: LEGAL_REFERENCES,
    });
  } catch (err) {
    // Audit failure não pode quebrar a tool call. Log warning e segue.
    logger.warn(
      { err, providerId: ctx.providerId, tool: payload.tool },
      "[mcp.audit] failed to insert audit log (non-blocking)",
    );
  }
}
