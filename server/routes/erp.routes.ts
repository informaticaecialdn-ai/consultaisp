import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { testErpConnection, fetchErpCustomers } from "./utils";

export function registerErpRoutes(): Router {
  const router = Router();

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
      const { source } = req.params;
      const validSources = ["ixc", "sgp", "mk", "tiacos", "hubsoft", "flyspeed", "netflash", "manual"];
      if (!validSources.includes(source)) return res.status(400).json({ message: "ERP invalido" });
      const allowed = ["isEnabled", "notes", "apiUrl", "apiToken", "apiUser", "syncIntervalHours"];
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
      const { source } = req.params;
      const providerId = req.session.providerId!;
      const integrations = await storage.getErpIntegrations(providerId);
      const intg = integrations.find(i => i.erpSource === source);
      if (!intg?.apiUrl || !intg?.apiToken) {
        return res.status(400).json({ ok: false, message: "Configure a URL e o token antes de testar" });
      }
      const result = await testErpConnection(source, intg.apiUrl, intg.apiUser || "", intg.apiToken);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error.message });
    }
  });

  router.post("/api/provider/erp-integrations/:source/sync", requireAuth, async (req, res) => {
    try {
      const { source } = req.params;
      const providerId = req.session.providerId!;
      const integrations = await storage.getErpIntegrations(providerId);
      const intg = integrations.find(i => i.erpSource === source);
      if (!intg?.apiUrl || !intg?.apiToken) {
        return res.status(400).json({ ok: false, message: "Configure a URL e o token antes de sincronizar" });
      }
      const fetchResult = await fetchErpCustomers(source, intg.apiUrl, intg.apiUser || "", intg.apiToken);
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

  router.post("/api/webhooks/erp-sync", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Token de autorizacao ausente" });
      }
      const token = authHeader.slice(7);
      const provider = await storage.getProviderByWebhookToken(token);
      if (!provider) return res.status(401).json({ message: "Token invalido" });

      const { erpSource, customers: customersData } = req.body;
      if (!erpSource || !Array.isArray(customersData)) {
        return res.status(400).json({ message: "Payload invalido. Esperado: { erpSource, customers: [] }" });
      }
      const validSources = ["ixc", "sgp", "mk", "tiacos", "hubsoft", "flyspeed", "netflash", "manual"];
      if (!validSources.includes(erpSource)) {
        return res.status(400).json({ message: `erpSource invalido. Valores aceitos: ${validSources.join(", ")}` });
      }

      const result = await storage.syncErpCustomers(provider.id, erpSource, customersData);
      const syncStatus = result.errors > 0 && result.upserted === 0 ? "error" : result.errors > 0 ? "partial" : "success";

      await storage.createErpSyncLog({
        providerId: provider.id,
        erpSource,
        upserted: result.upserted,
        errors: result.errors,
        status: syncStatus,
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || null,
        payload: { total: customersData.length },
      });
      await storage.upsertErpIntegration(provider.id, erpSource, {
        isEnabled: true,
        status: syncStatus,
        lastSyncAt: new Date(),
        lastSyncStatus: syncStatus,
      });
      await storage.incrementErpIntegrationCounters(provider.id, erpSource, result.upserted, result.errors);

      return res.json({ success: true, ...result, providerId: provider.id });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  return router;
}
