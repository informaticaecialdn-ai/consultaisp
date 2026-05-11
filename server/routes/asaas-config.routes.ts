/**
 * Spec 004 US3 — Configuração da conta Asaas do provider (T041).
 *
 * Endpoints:
 *   GET    /api/asaas/account       — status atual (mascarado)
 *   POST   /api/asaas/account       — conectar/atualizar (valida + cifra + salva)
 *   DELETE /api/asaas/account       — desconectar (marca revoked)
 *
 * Auth: requireAuth + requireAdmin. Multi-tenant via req.session.providerId.
 * Nunca devolve plaintext de credenciais.
 */

import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { logger } from "../logger";
import { requireAuth, requireAdmin } from "../auth";
import { storage } from "../storage";
import { validateAndDetectMode } from "../services/asaas-multi-tenant";
import { auditAction } from "../agents/audit-actions";

const PostBody = z.object({
  apiKey: z.string().min(20, "Chave Asaas inválida (muito curta)"),
  webhookToken: z.string().min(16, "webhookToken deve ter ≥16 caracteres"),
});

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return "***";
  return `${apiKey.slice(0, 12)}******${apiKey.slice(-4)}`;
}

export function registerAsaasConfigRoutes(): Router {
  const router: Router = express.Router();

  // Naive in-memory rate-limit (5/15min/IP) — sem dep nova
  const attempts = new Map<string, { count: number; resetAt: number }>();
  function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = attempts.get(ip);
    if (!entry || entry.resetAt < now) {
      attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
      return true;
    }
    if (entry.count >= 5) return false;
    entry.count++;
    return true;
  }

  // GET /api/asaas/account
  router.get("/api/asaas/account", requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
    const providerId = req.session.providerId!;
    try {
      const account = await storage.asaasAccount.byProviderId(providerId);
      if (!account) {
        res.json({ connected: false });
        return;
      }
      const apiKey = await storage.asaasAccount.getApiKey(providerId);
      res.json({
        connected: account.accountStatus !== "revoked",
        mode: account.mode,
        accountStatus: account.accountStatus,
        lastUsedAt: account.lastUsedAt,
        maskedApiKey: apiKey ? maskApiKey(apiKey) : null,
      });
    } catch (err) {
      logger.error({ action: "asaas_account_get_failed", providerId, err: (err as Error)?.message }, "GET asaas/account falhou");
      res.status(500).json({ error: "internal_error" });
    }
  });

  // POST /api/asaas/account
  router.post("/api/asaas/account", requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
    const providerId = req.session.providerId!;
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] ?? req.ip ?? "unknown";

    if (!checkRateLimit(ip)) {
      res.status(429).json({ error: "rate_limit_exceeded", message: "Máx 5 tentativas em 15min" });
      return;
    }

    const parsed = PostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "validation_error", issues: parsed.error.issues });
      return;
    }

    const { apiKey, webhookToken } = parsed.data;

    try {
      // Valida com Asaas /myAccount
      const validation = await validateAndDetectMode(apiKey);
      const { mode, account } = validation;

      // Upsert
      const saved = await storage.asaasAccount.upsert(providerId, {
        apiKey,
        webhookToken,
        mode,
        accountStatus: "verified",
      });

      // Audit
      await storage.auditLog.registrarAcao(providerId, {
        action: "asaas_account_connected",
        resource: "asaas_account",
        resourceId: String(saved.id),
        actorType: "user",
        actorId: String(req.session.userId),
        payload: { mode, asaasAccountName: account?.name ?? null, asaasEmail: account?.email ?? null },
      });

      res.status(201).json({
        connected: true,
        mode,
        accountStatus: "verified",
        lastUsedAt: saved.lastUsedAt,
        maskedApiKey: maskApiKey(apiKey),
      });
    } catch (err) {
      const msg = (err as Error)?.message ?? "unknown";
      logger.warn({ action: "asaas_account_post_failed", providerId, err: msg }, "Validação Asaas falhou");
      // Asaas response 401 indica chave inválida
      const status = msg.includes("401") || msg.toLowerCase().includes("unauthorized") ? 400 : 502;
      res.status(status).json({ error: "asaas_validation_failed", message: msg });
    }
  });

  // DELETE /api/asaas/account
  router.delete("/api/asaas/account", requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
    const providerId = req.session.providerId!;
    try {
      const existing = await storage.asaasAccount.byProviderId(providerId);
      if (!existing) {
        res.status(204).send();
        return;
      }
      await storage.asaasAccount.markRevoked(providerId);

      // Suspende Bruno automaticamente
      await storage.agentToggle.update(providerId, { brunoAtivo: false });

      await storage.auditLog.registrarAcao(providerId, {
        action: "asaas_account_disconnected",
        resource: "asaas_account",
        resourceId: String(existing.id),
        actorType: "user",
        actorId: String(req.session.userId),
        payload: { previousMode: existing.mode, brunoAutoSuspended: true },
      });

      res.status(204).send();
    } catch (err) {
      logger.error({ action: "asaas_account_delete_failed", providerId, err: (err as Error)?.message }, "DELETE asaas/account falhou");
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
