/**
 * ERP Sync Worker — processo separado do HTTP server.
 *
 * Isola o sync do ERP para que:
 * - Crashes do sync nao derrubem a API
 * - Crashes da API nao interrompam sync em andamento
 * - Sync possa ser reiniciado independentemente
 * - Latencia da API nao seja afetada pelo sync pesado
 *
 * Executa o scheduler do ERP sync + LGPD retention/titular (tambem background jobs).
 */

import "dotenv/config";
import { validateEnv } from "./env";
import { pool } from "./db";
import { logger } from "./logger";

(async () => {
  validateEnv();
  logger.info("[Worker] ERP sync worker starting");

  try {
    const { startErpSyncScheduler } = await import("./services/erp-sync.service");
    startErpSyncScheduler();
    logger.info("[Worker] ERP sync scheduler started");
  } catch (err) {
    logger.error({ err }, "[Worker] ERP sync scheduler failed to start");
    process.exit(1);
  }

  try {
    const { startRetentionScheduler } = await import("./services/lgpd-retention");
    startRetentionScheduler();
    logger.info("[Worker] LGPD retention scheduler started");
  } catch (err) {
    logger.warn({ err }, "[Worker] LGPD retention scheduler failed to start");
  }

  try {
    const { startTitularProcessor } = await import("./services/lgpd-titular.service");
    startTitularProcessor();
    logger.info("[Worker] LGPD titular processor started");
  } catch (err) {
    logger.warn({ err }, "[Worker] LGPD titular processor failed to start");
  }

  // Spec 004 — Bruno preventivo + outbound retry. Apenas se REDIS_URL estiver setado;
  // sem Redis o Bruno simplesmente fica desabilitado (degrada limpo).
  if (process.env.REDIS_URL) {
    try {
      const { startBrunoScheduler } = await import("./workers/bruno-scheduler");
      const { startBrunoWorker } = await import("./workers/bruno-process-invoice");
      const { startOutboundRetry } = await import("./workers/outbound-retry");
      startBrunoScheduler();
      startBrunoWorker();
      startOutboundRetry();
      logger.info("[Worker] Bruno scheduler + worker + outbound retry started (Spec 004)");
    } catch (err) {
      logger.error({ err }, "[Worker] Bruno/outbound-retry failed to start");
    }
  } else {
    logger.warn("[Worker] REDIS_URL ausente — Bruno scheduler/worker desabilitados (Spec 004)");
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "[Worker] Shutdown signal received");
    try {
      const { stopBrunoScheduler } = await import("./workers/bruno-scheduler");
      const { stopBrunoWorker } = await import("./workers/bruno-process-invoice");
      const { stopOutboundRetry } = await import("./workers/outbound-retry");
      const { closeQueueResources } = await import("./lib/queue");
      stopBrunoScheduler();
      stopOutboundRetry();
      await stopBrunoWorker();
      await closeQueueResources();
    } catch (err) {
      logger.warn({ err }, "[Worker] Bruno shutdown helpers failed");
    }
    await pool.end();
    logger.info("[Worker] Database pool closed");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("[Worker] Ready — background jobs running");
})();
