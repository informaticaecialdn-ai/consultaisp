/**
 * Spec 008.5 Batch 1 — Middleware de auth do MCP server.
 *
 * Pipeline:
 *   1. Extrai Bearer do header Authorization
 *   2. Reject 401 se ausente ou mal formatado
 *   3. Lookup em mcp_bearer_tokens por tokenPrefix (índice O(log n))
 *   4. Reject 401 se revogado ou hash mismatch (scrypt verify)
 *   5. UPDATE lastUsedAt = NOW() (fire-and-forget — não bloqueia request)
 *   6. Inject McpAuthContext em req.mcpAuth
 *
 * Multi-tenant: providerId vem do registro de bearer; nenhuma tool precisa
 * passar providerId no payload — vem implícito do contexto.
 */

import type { Request, Response, NextFunction } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db";
import { mcpBearerTokens } from "@shared/schema";
import { logger } from "../logger";
import {
  extractBearerFromHeader,
  extractPrefix,
  verifyBearer,
} from "./bearer-auth";
import {
  type McpAuthContext,
  type McpScope,
  type McpToolName,
  MCP_SCOPES,
  MCP_TOOLS,
} from "./types";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      mcpAuth?: McpAuthContext;
    }
  }
}

/** Padroniza response 401 com WWW-Authenticate header. */
function rejectUnauthorized(res: Response, reason: string): void {
  res.setHeader("WWW-Authenticate", 'Bearer realm="provedor.ai/mcp/erp"');
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized", data: { reason } },
  });
}

export async function requireMcpAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const bearer = extractBearerFromHeader(req.headers.authorization);
  if (!bearer) {
    rejectUnauthorized(res, "missing_bearer");
    return;
  }

  const prefix = extractPrefix(bearer);
  if (!prefix) {
    rejectUnauthorized(res, "invalid_format");
    return;
  }

  // Lookup por prefix (índice). Pode haver mais de um se houver colisão de
  // prefix (improvável: 4 bytes random = 4B combinações; com 1k tokens
  // colisão ~10^-7). Iteramos verificando hash.
  const candidates = await db
    .select()
    .from(mcpBearerTokens)
    .where(
      and(
        eq(mcpBearerTokens.tokenPrefix, prefix),
        isNull(mcpBearerTokens.revokedAt),
      ),
    );

  if (candidates.length === 0) {
    rejectUnauthorized(res, "unknown_prefix");
    return;
  }

  let matched: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    if (await verifyBearer(bearer, c.tokenHash)) {
      matched = c;
      break;
    }
  }

  if (!matched) {
    rejectUnauthorized(res, "hash_mismatch");
    return;
  }

  // Sanitiza scopes/tools — ignora valores desconhecidos sem quebrar
  const validScopes = new Set<McpScope>(
    matched.allowedScopes.filter((s): s is McpScope =>
      (MCP_SCOPES as readonly string[]).includes(s),
    ),
  );
  const validTools = matched.allowedTools
    ? new Set<McpToolName>(
        matched.allowedTools.filter((t): t is McpToolName =>
          (MCP_TOOLS as readonly string[]).includes(t),
        ),
      )
    : null;

  req.mcpAuth = {
    tokenId: matched.id,
    tokenPrefix: matched.tokenPrefix,
    providerId: matched.providerId,
    tokenName: matched.name,
    scopes: validScopes,
    allowedTools: validTools,
  };

  // Fire-and-forget update de lastUsedAt — não bloqueia request
  db.update(mcpBearerTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpBearerTokens.id, matched.id))
    .catch((err) => {
      logger.warn(
        { err, tokenId: matched!.id },
        "[mcp.auth] failed to update lastUsedAt (non-blocking)",
      );
    });

  next();
}
