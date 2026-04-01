import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getConnector, getAllConnectors, getSupportedSources, buildConnectorConfig, ERP_CONFIG_FIELDS } from "../erp";

export function registerErpRoutes(): Router {
  const router = Router();

  // Public routes — available ERP list and config fields
  router.get("/api/erp/available", (_req, res) => {
    const connectors = getAllConnectors();
    return res.json(connectors.map(c => ({ name: c.name, label: c.label })));
  });

  router.get("/api/erp/config-fields/:source", (req, res) => {
    const source = String(req.params.source);
    const fields = ERP_CONFIG_FIELDS[source];
    if (!fields) return res.status(404).json({ message: "ERP nao encontrado" });
    return res.json(fields);
  });

  // Temporary diagnostic: test IXC connection from VPS IP
  // TODO: Remove after confirming IP whitelist works
  router.get("/api/debug/test-ixc", async (_req, res) => {
    try {
      const connector = getConnector("ixc");
      if (!connector) return res.json({ ok: false, error: "IXC connector not found" });

      const config = {
        apiUrl: "https://ixc.ngtelecom.net.br",
        apiToken: "9b6e60f4454dfffe906eaddaab94e7fcb40e5c2e4ef18a6a50f319ca7ea6c7de",
        apiUser: "351",
        extra: {},
      };

      const test = await connector.testConnection(config);

      // If connection works, try fetching a sample
      let sample = null;
      if (test.ok) {
        const delinq = await connector.fetchDelinquents(config);
        sample = {
          ok: delinq.ok,
          message: delinq.message,
          count: delinq.customers.length,
          first: delinq.customers[0] ? {
            cpf: delinq.customers[0].cpfCnpj?.replace(/(\d{3})\d{6}(\d{2})/, "$1******$2"),
            name: delinq.customers[0].name?.split(" ")[0] + " ***",
            days: delinq.customers[0].maxDaysOverdue,
            amount: delinq.customers[0].totalOverdueAmount,
          } : null,
        };
      }

      return res.json({ connection: test, sample });
    } catch (err: any) {
      return res.json({ ok: false, error: err.message });
    }
  });

  router.get("/api/provider/erp-integrations", requireAuth, async (req, res) => {
    try {
      const integrations = await storage.getErpIntegrations(req.session.providerId!);
      return res.json(integrations);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.patch("/api/provider/erp-integrations/:source", requireAuth, async (req, res) => {
    try {
      const source = String(req.params.source);
      const validSources = [...getSupportedSources(), "manual"];
      if (!validSources.includes(source)) return res.status(400).json({ message: "ERP invalido" });
      const allowed = ["isEnabled", "notes", "apiUrl", "apiToken", "apiUser", "syncIntervalHours", "clientId", "clientSecret", "mkContraSenha", "sgpApp", "voalleClientId", "extraConfig"];
      const data: any = {};
      for (const k of allowed) { if (req.body[k] !== undefined) data[k] = req.body[k]; }
      const integration = await storage.upsertErpIntegration(req.session.providerId!, source, data);
      return res.json(integration);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/provider/erp-integrations/:source/test", requireAuth, async (req, res) => {
    try {
      const source = String(req.params.source);
      const providerId = req.session.providerId!;
      const connector = getConnector(source);
      if (!connector) {
        return res.status(400).json({ ok: false, message: "ERP nao suportado" });
      }
      const integrations = await storage.getErpIntegrations(providerId);
      const intg = integrations.find(i => i.erpSource === source);
      if (!intg?.apiUrl || !intg?.apiToken) {
        return res.status(400).json({ ok: false, message: "Configure a URL e o token antes de testar" });
      }
      const config = buildConnectorConfig(intg);
      const result = await connector.testConnection(config);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error.message });
    }
  });

  router.post("/api/provider/erp-integrations/:source/sync", requireAuth, async (req, res) => {
    try {
      const source = String(req.params.source);
      const providerId = req.session.providerId!;
      const connector = getConnector(source);
      if (!connector) {
        return res.status(400).json({ ok: false, message: "ERP nao suportado" });
      }
      const integrations = await storage.getErpIntegrations(providerId);
      const intg = integrations.find(i => i.erpSource === source);
      if (!intg?.apiUrl || !intg?.apiToken) {
        return res.status(400).json({ ok: false, message: "Configure a URL e o token antes de sincronizar" });
      }
      const config = buildConnectorConfig(intg);
      const fetchResult = await connector.fetchDelinquents(config);
      if (!fetchResult.ok) {
        await storage.createErpSyncLog({
          providerId, erpSource: source,
          upserted: 0, errors: 0, status: "error",
          ipAddress: null, payload: { error: fetchResult.message },
          syncType: "manual", recordsProcessed: 0, recordsFailed: 0,
        });
        await storage.upsertErpIntegration(providerId, source, { status: "error", lastSyncStatus: "error", lastSyncAt: new Date() });
        return res.status(502).json({ ok: false, message: fetchResult.message });
      }
      const syncResult = await storage.syncErpCustomers(providerId, source, fetchResult.customers);
      const syncStatus = syncResult.errors > 0 && syncResult.upserted === 0 ? "error" : syncResult.errors > 0 ? "partial" : "success";
      await storage.createErpSyncLog({
        providerId, erpSource: source,
        upserted: syncResult.upserted, errors: syncResult.errors, status: syncStatus,
        ipAddress: null, payload: { total: fetchResult.customers.length },
        syncType: "manual", recordsProcessed: fetchResult.customers.length, recordsFailed: syncResult.errors,
      });
      await storage.upsertErpIntegration(providerId, source, {
        status: syncStatus, lastSyncStatus: syncStatus, lastSyncAt: new Date(),
      });
      await storage.incrementErpIntegrationCounters(providerId, source, syncResult.upserted, syncResult.errors);
      return res.json({ ok: true, synced: syncResult.upserted, errors: syncResult.errors, total: fetchResult.customers.length });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error.message });
    }
  });

  router.get("/api/provider/erp-sync-logs", requireAuth, async (req, res) => {
    try {
      const { source, limit } = req.query;
      const logs = await storage.getErpSyncLogs(
        req.session.providerId!,
        source as string | undefined,
        limit ? parseInt(limit as string) : 30,
      );
      return res.json(logs);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/provider/erp-integration-stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getErpIntegrationStats(req.session.providerId!);
      return res.json(stats);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/erp-connectors", requireAuth, (_req, res) => {
    const connectors = getAllConnectors();
    const meta = connectors.map(c => ({
      name: c.name,
      label: c.label,
      configFields: c.configFields,
    }));
    return res.json(meta);
  });

  return router;
}
