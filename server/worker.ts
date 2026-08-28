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

  try {
    const { startGeocodeBackfill } = await import("./services/geocode-backfill.service");
    startGeocodeBackfill();
    logger.info("[Worker] Geocode backfill scheduler started");
  } catch (err) {
    logger.warn({ err }, "[Worker] Geocode backfill failed to start");
  }

  /**
   * Espera o sync em voo antes de fechar o pool.
   *
   * Sem isto o restart do pm2 fechava a conexao no meio da varredura e o log
   * enchia de "Erro ao upsert <cpf>: Cannot use a pool after calling end on the
   * pool" — cada linha um cliente cuja atualizacao foi perdida. Como cada
   * restart tambem disparava um sync novo, a janela para isso acontecer era
   * grande. Trinta segundos cobre o upsert corrente com folga; passar disso, o
   * sync e abandonado de proposito, porque segurar o desligamento indefinidamente
   * faria o pm2 matar o processo do mesmo jeito, so que mais tarde.
   */
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "[Worker] Shutdown signal received");
    try {
      const { isSyncing } = await import("./services/erp-sync.service");
      const limite = Date.now() + 30_000;
      if (isSyncing()) logger.info("[Worker] Sync em andamento — aguardando ate 30s");
      while (isSyncing() && Date.now() < limite) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (isSyncing()) logger.warn("[Worker] Sync ainda rodando apos 30s — encerrando mesmo assim");
    } catch (err) {
      logger.warn({ err }, "[Worker] Nao consegui verificar o sync em andamento");
    }
    // `pool.end()` espera TODO cliente ser devolvido, e a varredura em voo
    // segura um: a trava do sync e um advisory lock preso a uma conexao, que
    // so e liberada no `finally`. Depois dos 30s de dreno, esperar por ela
    // indefinidamente entrega o desligamento ao SIGKILL do pm2 — que fecha o
    // socket do mesmo jeito, so que sem log e sem ordem.
    await Promise.race([
      pool.end().catch(() => {}),
      new Promise(r => setTimeout(r, 3_000)),
    ]);
    logger.info("[Worker] Database pool closed");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("[Worker] Ready — background jobs running");
})();
