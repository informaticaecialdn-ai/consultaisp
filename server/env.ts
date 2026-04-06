import { logger } from "./logger";

const REQUIRED_VARS = ["DATABASE_URL", "SESSION_SECRET"] as const;

export function validateEnv(): void {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    logger.fatal({ missing }, "Missing required environment variables");
    process.exit(1);
  }
  logger.info("Environment validated");
}

export function getAsaasWebhookToken(): string | undefined {
  return process.env.ASAAS_WEBHOOK_TOKEN?.trim() || undefined;
}
