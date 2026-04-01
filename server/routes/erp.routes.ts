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
