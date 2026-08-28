import { Router } from "express";
import { requireAuth, requireSuperAdmin } from "../auth";
import { storage } from "../storage";
import { getConnector, getAllConnectors, getSupportedSources, buildConnectorConfig, ERP_CONFIG_FIELDS } from "../erp";
import { getSafeErrorMessage } from "../utils/safe-error";
import { syncProviderToDb, sincronizacaoEmAndamento } from "../services/erp-sync.service";
import { z } from "zod";

const erpIntegrationUpdateSchema = z.object({
  isEnabled: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
  apiUrl: z.string().max(500).nullable().optional(),
  apiToken: z.string().max(1000).nullable().optional(),
  apiUser: z.string().max(200).nullable().optional(),
  syncIntervalHours: z.number().int().min(1).max(720).optional(),
  clientId: z.string().max(200).nullable().optional(),
  clientSecret: z.string().max(500).nullable().optional(),
  mkContraSenha: z.string().max(200).nullable().optional(),
  sgpApp: z.string().max(200).nullable().optional(),
  voalleClientId: z.string().max(200).nullable().optional(),
  extraConfig: z.record(z.string()).nullable().optional(),
}).strict();

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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/provider/erp-integrations/:source", requireAuth, async (req, res) => {
    try {
      const source = String(req.params.source);
      const validSources = [...getSupportedSources(), "manual"];
      if (!validSources.includes(source)) return res.status(400).json({ message: "ERP invalido" });
      const parsed = erpIntegrationUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
      }
      if (parsed.data.apiUrl) {
        const { validateErpUrl } = await import("../utils/url-validator");
        const urlCheck = validateErpUrl(parsed.data.apiUrl);
        if (!urlCheck.valid) {
          return res.status(400).json({ message: urlCheck.reason });
        }
      }
      const integration = await storage.upsertErpIntegration(req.session.providerId!, source, parsed.data);
      return res.json(integration);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
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
      return res.status(500).json({ ok: false, message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/provider/erp-integrations/:source/sync", requireAuth, async (req, res) => {
    try {
      const source = String(req.params.source);
      const providerId = req.session.providerId!;
      const integrations = await storage.getErpIntegrations(providerId);
      const intg = integrations.find(i => i.erpSource === source);
      if (!intg?.apiUrl || !intg?.apiToken) {
        return res.status(400).json({ ok: false, message: "Configure a URL e o token antes de sincronizar" });
      }
      const provider = await storage.getProvider(providerId);
      if (sincronizacaoEmAndamento(providerId, source)) {
        return res.status(409).json({
          ok: false,
          emAndamento: true,
          message: "Ja existe uma sincronizacao em andamento para este ERP. Acompanhe pelo historico.",
        });
      }

      // DISPARA E RESPONDE. A varredura nao cabe num ciclo de request.
      //
      // A rota fazia `await` na sincronizacao inteira. Ela leva minutos — 682s
      // medidos na NsLink — e o nginx corta em `proxy_read_timeout 60s`,
      // devolvendo 504 em HTML. O `fetch` do painel entao estourava no
      // `res.json()` e a tela dizia "Erro ao sincronizar" para um sync que
      // estava rodando e ia terminar bem. Pior: convidava a clicar de novo.
      //
      // O resultado ja tem onde aparecer: `erp_sync_logs`, que o painel le em
      // GET /api/provider/erp-sync-logs.
      void syncProviderToDb(providerId, provider?.name || "Provedor", source, {
        apiUrl: intg.apiUrl,
        apiToken: intg.apiToken,
        apiUser: intg.apiUser,
        mkContraSenha: (intg as any).mkContraSenha ?? null,
        clientId: (intg as any).clientId ?? null,
        clientSecret: (intg as any).clientSecret ?? null,
        extraConfig: (intg as any).extraConfig ?? null,
      }, "manual").catch(err => {
        console.error(`[ERPSync] sync manual de ${source} (provider ${providerId}) falhou:`, err);
      });

      return res.status(202).json({
        ok: true,
        iniciado: true,
        message: "Sincronizacao iniciada. O resultado aparece no historico quando terminar.",
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/providers/:id/sync/:source", requireSuperAdmin, async (req, res) => {
    try {
      const providerId = parseInt(req.params.id);
      const source = String(req.params.source);
      const integrations = await storage.getErpIntegrations(providerId);
      const intg = integrations.find(i => i.erpSource === source);
      if (!intg?.apiUrl || !intg?.apiToken) {
        return res.status(400).json({ ok: false, message: "Provedor nao tem URL/token configurados" });
      }
      const provider = await storage.getProvider(providerId);
      if (sincronizacaoEmAndamento(providerId, source)) {
        return res.status(409).json({
          ok: false,
          emAndamento: true,
          message: "Ja existe uma sincronizacao em andamento para este ERP. Acompanhe pelo historico.",
        });
      }

      // DISPARA E RESPONDE. A varredura nao cabe num ciclo de request.
      //
      // A rota fazia `await` na sincronizacao inteira. Ela leva minutos — 682s
      // medidos na NsLink — e o nginx corta em `proxy_read_timeout 60s`,
      // devolvendo 504 em HTML. O `fetch` do painel entao estourava no
      // `res.json()` e a tela dizia "Erro ao sincronizar" para um sync que
      // estava rodando e ia terminar bem. Pior: convidava a clicar de novo.
      //
      // O resultado ja tem onde aparecer: `erp_sync_logs`, que o painel le em
      // GET /api/provider/erp-sync-logs.
      void syncProviderToDb(providerId, provider?.name || "Provedor", source, {
        apiUrl: intg.apiUrl,
        apiToken: intg.apiToken,
        apiUser: intg.apiUser,
        mkContraSenha: (intg as any).mkContraSenha ?? null,
        clientId: (intg as any).clientId ?? null,
        clientSecret: (intg as any).clientSecret ?? null,
        extraConfig: (intg as any).extraConfig ?? null,
      }, "manual").catch(err => {
        console.error(`[ERPSync] sync manual de ${source} (provider ${providerId}) falhou:`, err);
      });

      return res.status(202).json({
        ok: true,
        iniciado: true,
        message: "Sincronizacao iniciada. O resultado aparece no historico quando terminar.",
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/erp-sync-logs", requireAuth, async (req, res) => {
    try {
      const { source, limit } = req.query;
      const parsedLimit = Math.min(Math.max(parseInt(limit as string) || 30, 1), 100);
      const logs = await storage.getErpSyncLogs(
        req.session.providerId!,
        source as string | undefined,
        parsedLimit,
      );
      return res.json(logs);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/erp-integration-stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getErpIntegrationStats(req.session.providerId!);
      return res.json(stats);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/erp-connectors", requireAuth, (_req, res) => {
    const connectors = getAllConnectors();
    const meta = connectors.map(c => ({
      name: c.name,
      label: c.label,
      configFields: c.configFields,
      supportsEquipment: !!c.supportsEquipment,
    }));
    return res.json(meta);
  });

  return router;
}
