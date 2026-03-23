import { storage } from "./storage";

async function fetchErpCustomersForScheduler(
  source: string,
  apiUrl: string,
  apiUser: string,
  apiToken: string,
): Promise<{ ok: boolean; message: string; customers: any[] }> {
  try {
    const basicAuth = Buffer.from(`${apiUser}:${apiToken}`).toString("base64");
    if (source === "ixc") {
      const body = {
        qtype: "fn_areceber.status",
        query: "A",
        oper: "=",
        page: "1",
        rp: "1000",
        sortname: "fn_areceber.id",
        sortorder: "asc",
      };
      const res = await fetch(`${apiUrl}/webservice/v1/fn_areceber`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/json",
          ixcsoft: "listar",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        return { ok: false, message: `IXC respondeu com status ${res.status}`, customers: [] };
      }
      const data = await res.json();
      const rows: any[] = data.registros || data.rows || (Array.isArray(data) ? data : []);
      const customers = rows.map((r: any) => ({
        cpf_cnpj: (r.cpf_cnpj || r.cnpj || "").replace(/\D/g, ""),
        name: r.razao || r.nome || r.name || "",
        balance: parseFloat(r.valor || r.valor_original || "0") || 0,
        dueDate: r.vencimento || r.data_vencimento || null,
        address: r.endereco || r.logradouro || null,
        city: r.cidade || null,
        state: r.uf || null,
        cep: (r.cep || "").replace(/\D/g, ""),
        phone: (r.fone_celular || r.telefone || "").replace(/\D/g, ""),
      }));
      return { ok: true, message: "ok", customers };
    }
    return { ok: false, message: `ERP "${source}" não suportado pelo auto-sync`, customers: [] };
  } catch (err: any) {
    return { ok: false, message: err.message || "Erro desconhecido", customers: [] };
  }
}

let schedulerRunning = false;
let lastGlobalRun: Date | null = null;
let totalRunCount = 0;

async function runAutoSync() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  const startTime = Date.now();
  console.log(`[AutoSync] Iniciando ciclo de sincronização automática — ${new Date().toISOString()}`);

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

        console.log(`[AutoSync] Sincronizando: ${intg.providerName} / ${intg.erpSource}`);

        const fetchResult = await fetchErpCustomersForScheduler(
          intg.erpSource,
          intg.apiUrl!,
          intg.apiUser || "",
          intg.apiToken!,
        );

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
          `[AutoSync] ✓ ${intg.providerName} — ${syncResult.upserted} upserted, ${syncResult.errors} erros`,
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
      `[AutoSync] Ciclo concluído em ${elapsed}ms — ${synced} sincronizados, ${skipped} sem vencimento`,
    );
  } catch (err: any) {
    console.error("[AutoSync] Erro crítico no ciclo:", err.message);
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
