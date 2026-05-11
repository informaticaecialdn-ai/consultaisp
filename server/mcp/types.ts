/**
 * Spec 008.5 — MCP ERP Wrapper · Internal types
 *
 * Auth model: static bearer token (NÃO OAuth/JWT — confirmado pela doc oficial
 * Anthropic Managed Agents 2026-04-01). Owner gera token no superadmin,
 * cadastra como credential `static_bearer` no Vault da plataforma. Anthropic
 * envia o bearer no header Authorization: Bearer xxx em cada request MCP.
 *
 * Multi-tenant: cada token pertence a 1 providerId. Bearer chega → resolve
 * via hash → todas as tools filtram por providerId implicitamente.
 */

/** Scopes suportados (vide spec.md §Auth). */
export const MCP_SCOPES = ["read", "read_pii"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/** Tools expostas (vide spec.md §Tools expostas). */
export const MCP_TOOLS = [
  "erp_list_delinquents",
  "erp_get_customer",
  "erp_get_invoices",
  "erp_test_connection",
  "erp_list_supported",
] as const;
export type McpToolName = (typeof MCP_TOOLS)[number];

/**
 * Contexto autenticado injetado em `req` após middleware `requireMcpAuth`.
 * Route handlers e tool handlers consomem isso para multi-tenant gate +
 * scope check + audit log.
 */
export interface McpAuthContext {
  /** ID interno do registro mcp_bearer_tokens (pra audit + lastUsedAt update) */
  tokenId: number;
  /** Prefixo público "mcp_xxxxxxxx" (sem o secret) — para logs */
  tokenPrefix: string;
  /** Tenant que esse token autoriza */
  providerId: number;
  /** Nome legível atribuído na criação (ex: "Bruno production agent") */
  tokenName: string;
  /** Scopes ativos */
  scopes: Set<McpScope>;
  /** Subset de tools permitidas; null = todas */
  allowedTools: Set<McpToolName> | null;
}

/** Helper de check de scope. */
export function hasScope(ctx: McpAuthContext, scope: McpScope): boolean {
  return ctx.scopes.has(scope);
}

/** Helper de check de tool autorizada. */
export function canUseTool(ctx: McpAuthContext, tool: McpToolName): boolean {
  return ctx.allowedTools === null || ctx.allowedTools.has(tool);
}

/** Erros internos do MCP — mapeiam para JSON-RPC error codes / HTTP status. */
export class McpError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "McpError";
  }
}

export class McpUnauthorizedError extends McpError {
  constructor(message: string = "Bearer token inválido ou ausente") {
    super(401, message, "UNAUTHORIZED");
  }
}

export class McpForbiddenError extends McpError {
  constructor(message: string = "Scope ou tool não autorizada") {
    super(403, message, "FORBIDDEN");
  }
}
