import { storage } from "./storage";
import { getConnector, getProviderLimiter, buildConnectorConfig } from "./erp";

let schedulerRunning = false;
let lastGlobalRun: Date | null = null;
let totalRunCount = 0;

async function runAutoSync() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  const startTime = Date.now();
  console.log(`[AutoSync] Iniciando ciclo de sincronizacao automatica — ${new Date().toISOString()}`);

  try {
    const integrations = await storage.getAllEnabledErpIntegrationsWithCredentials();
    const now = new Date();
    let synced = 0;
    let skipped = 0;

    for (const intg of integrations) {
      try {
        const intervalMs = (intg.syncIntervalHours || 24) * 60 * 60 * 1000;
        const nextDue = intg.lastSyncAt ? new Date(intg.lastSyncAt.getTime() + intervalMs) : new Date(0);
        if (now < nextDue) {
          skipped++;
          continue;
        }

        const connector = getConnector(intg.erpSource);
        if (!connector) {
          console.warn(`[AutoSync] ERP desconhecido: ${intg.erpSource} (provider: ${intg.providerName})`);
          continue;
        }

        console.log(`[AutoSync] Sincronizando: ${intg.providerName} / ${intg.erpSource}`);

        const config = buildConnectorConfig(intg);
        const limiter = getProviderLimiter(intg.providerId, intg.erpSource);
        const fetchResult = await limiter(() => connector.fetchDelinquents(config));

        if (!fetchResult.ok) {
          await storage.upsertErpIntegration(intg.providerId, intg.erpSource, {
            lastSyncAt: now,
            lastSyncStatus: "error",
            status: "error",
          });
          await storage.createErpSyncLog({
            providerId: intg.providerId,
            erpSource: intg.erpSource,
            upserted: 0,
            errors: 1,
            status: "error",
            ipAddress: null,
            payload: { error: fetchResult.message },
            syncType: "auto",
            recordsProcessed: 0,
            recordsFailed: 1,
          });
          console.warn(`[AutoSync] Erro em ${intg.providerName}: ${fetchResult.message}`);
          continue;
        }

        const syncResult = await storage.syncErpCustomers(
          intg.providerId,
          intg.erpSource,
          fetchResult.customers,
        );

        const syncStatus =
          syncResult.errors > 0 && syncResult.upserted === 0
            ? "error"
            : syncResult.errors > 0
            ? "partial"
            : "success";

        await storage.upsertErpIntegration(intg.providerId, intg.erpSource, {
          lastSyncAt: now,
          lastSyncStatus: syncStatus,
          status: syncStatus,
        });
        await storage.incrementErpIntegrationCounters(
          intg.providerId,
          intg.erpSource,
          syncResult.upserted,
          syncResult.errors,
        );
        await storage.createErpSyncLog({
          providerId: intg.providerId,
          erpSource: intg.erpSource,
          upserted: syncResult.upserted,
          errors: syncResult.errors,
          status: syncStatus,
          ipAddress: null,
          payload: { total: fetchResult.customers.length, source: "auto" },
          syncType: "auto",
          recordsProcessed: fetchResult.customers.length,
          recordsFailed: syncResult.errors,
        });

        console.log(
          `[AutoSync] ${intg.providerName} — ${syncResult.upserted} upserted, ${syncResult.errors} erros`,
        );
        synced++;
      } catch (err: any) {
        console.error(`[AutoSync] Erro inesperado em ${intg.providerName}:`, err.message);
      }
    }

    lastGlobalRun = now;
    totalRunCount++;
    const elapsed = Date.now() - startTime;
    console.log(
      `[AutoSync] Ciclo concluido em ${elapsed}ms — ${synced} sincronizados, ${skipped} sem vencimento`,
    );
  } catch (err: any) {
    console.error("[AutoSync] Erro critico no ciclo:", err.message);
  } finally {
    schedulerRunning = false;
  }
}

export function startScheduler() {
  console.log("[AutoSync] Scheduler iniciado — verifica a cada 30 minutos");
  setTimeout(runAutoSync, 5000);
  setInterval(runAutoSync, 30 * 60 * 1000);
}

export function getSchedulerStatus() {
  return {
    running: schedulerRunning,
    lastRun: lastGlobalRun,
    totalRuns: totalRunCount,
    nextRunIn: lastGlobalRun
      ? Math.max(0, 30 * 60 * 1000 - (Date.now() - lastGlobalRun.getTime()))
      : 0,
  };
}

export { runAutoSync };
