import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";
import { logger } from "../logger";

/**
 * Spec 003 — Rotas de configuração e operação WhatsApp Business (Meta Cloud API).
 * Todas filtram por req.session.providerId (Princípio I — multi-tenant).
 */
export function registerWhatsappRoutes(): Router {
  const router = Router();

  /**
   * GET /api/provider/whatsapp/account
   * Retorna status da conta WABA do tenant (sem expor access token).
   */
  router.get("/api/provider/whatsapp/account", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const account = await storage.whatsappAccount.findByProviderId(providerId);

      if (!account || account.wabaStatus === "revoked") {
        return res.json({ connected: false });
      }

      return res.json({
        connected: true,
        wabaId: account.wabaId,
        phoneNumberId: account.phoneNumberId,
        displayName: account.displayName,
        qualityRating: account.qualityRating,
        wabaStatus: account.wabaStatus,
        tokenExpiresAt: account.tokenExpiresAt,
        verifiedAt: account.verifiedAt,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      });
    } catch (error: any) {
      logger.error({ err: error, providerId: req.session.providerId }, "whatsapp.account.get failed");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * POST /api/provider/whatsapp/disconnect
   * Soft-disconnect: marca wabaStatus='revoked'. Não deleta (audit trail).
   */
  router.post("/api/provider/whatsapp/disconnect", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const account = await storage.whatsappAccount.findByProviderId(providerId);

      if (!account) {
        return res.status(404).json({ message: "Conta WhatsApp nao encontrada" });
      }

      // Soft-disconnect via update direto (mantém audit trail)
      const { db } = await import("../db");
      const { whatsappAccounts } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(whatsappAccounts)
        .set({ wabaStatus: "revoked", updatedAt: new Date() })
        .where(eq(whatsappAccounts.id, account.id));

      logger.info({ providerId, wabaId: account.wabaId }, "whatsapp.account.disconnected");
      return res.json({ ok: true, message: "Conta WhatsApp desconectada" });
    } catch (error: any) {
      logger.error({ err: error, providerId: req.session.providerId }, "whatsapp.disconnect failed");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * GET /api/provider/whatsapp/templates
   * Lista templates HSM aprovados via Meta API.
   */
  router.get("/api/provider/whatsapp/templates", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const account = await storage.whatsappAccount.findByProviderId(providerId);

      if (!account || account.wabaStatus === "revoked") {
        return res.status(404).json({ message: "Conta WhatsApp nao configurada" });
      }

      const { createMetaClient } = await import("../communications/whatsapp/client");
      const client = await createMetaClient(providerId);
      const templates = await client.getTemplates();
      const approved = templates.filter((t: any) => t.status === "APPROVED");
      return res.json(approved);
    } catch (error: any) {
      logger.error({ err: error, providerId: req.session.providerId }, "whatsapp.templates failed");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * GET /api/provider/whatsapp/communications?customerId=X&limit=50
   * Viewer de comunicações inbound/outbound do tenant.
   */
  router.get("/api/provider/whatsapp/communications", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const customerId = req.query.customerId ? parseInt(String(req.query.customerId)) : undefined;
      const limit = req.query.limit ? Math.min(parseInt(String(req.query.limit)), 200) : 50;

      const rows = await storage.communications.listByProvider(
        providerId,
        customerId && !isNaN(customerId) ? customerId : undefined,
        limit,
      );
      return res.json(rows);
    } catch (error: any) {
      logger.error({ err: error, providerId: req.session.providerId }, "whatsapp.communications.list failed");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
