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
  const partnerSecret = (process.env.PARTNER_CODE_SECRET || "").trim();
  if (!partnerSecret) {
    logger.warn("PARTNER_CODE_SECRET not set — partner codes derive from SESSION_SECRET; rotating SESSION_SECRET rotates every partner code. Set a 32+ char secret.");
  } else if (partnerSecret.length < 32) {
    // Falhar aqui, nao na primeira consulta com parceiro — que viraria 500
    // em toda consulta, listagem de alertas e timeline.
    logger.fatal({ length: partnerSecret.length }, "PARTNER_CODE_SECRET must have at least 32 characters");
    process.exit(1);
  }
  logger.info("Environment validated");
}

export function getAsaasWebhookToken(): string | undefined {
  return process.env.ASAAS_WEBHOOK_TOKEN?.trim() || undefined;
}
