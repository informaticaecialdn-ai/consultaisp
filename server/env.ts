import { logger } from "./logger";

const REQUIRED_VARS = ["DATABASE_URL", "SESSION_SECRET"] as const;

export function validateEnv(): void {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    logger.fatal({ missing }, "Missing required environment variables");
    process.exit(1);
  }
  // LGPD compliance warnings
  if (!process.env.NETWORK_CPF_SALT) {
    logger.warn("NETWORK_CPF_SALT not set — CPF hashing disabled. Set a 32+ char salt for LGPD compliance.");
  }
  logger.info("Environment validated");
}

export function getAsaasWebhookToken(): string | undefined {
  return process.env.ASAAS_WEBHOOK_TOKEN?.trim() || undefined;
}

// ─── Spec 008.5 — MCP ERP wrapper config ──────────────────────────────
/**
 * Base URL público do MCP server. Em prod aponta pra `https://provedor.ai/mcp/erp`.
 * É o endpoint que o owner cadastra no Vault da Anthropic Platform.
 */
export function getMcpBaseUrl(): string {
  return process.env.MCP_BASE_URL?.trim() || "http://localhost:5000/mcp/erp";
}

/**
 * MCP server é sempre habilitado quando rodando (não depende de env var
 * adicional — auth é via bearer no DB). Pode ser desabilitado via
 * `MCP_DISABLED=1` se necessário em algum ambiente.
 */
export function isMcpEnabled(): boolean {
  return process.env.MCP_DISABLED?.trim() !== "1";
}
