/**
 * Spec 004 US3 — Dossiê de auditoria (T043).
 *
 * GET /api/dossie/cliente/:customerId
 *   ?from=2025-05-11&to=2026-05-11&format=pdf|json
 *
 * Auth: requireAuth + requireAdmin. Multi-tenant gate em buildDossie.
 * Audit do próprio dossiê: registra quem auditou (LGPD compliance interna).
 */

import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { logger } from "../logger";
import { requireAuth, requireAdmin } from "../auth";
import { storage } from "../storage";
import { buildDossie, renderDossiePdf } from "../services/dossie-builder";

const QuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  format: z.enum(["pdf", "json"]).default("pdf"),
});

function defaultPeriod(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 24 * 3600 * 1000);
  return { from, to };
}

export function registerDossieRoutes(): Router {
  const router: Router = express.Router();

  router.get("/api/dossie/cliente/:customerId", requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
    const providerId = req.session.providerId!;
    const customerId = Number(req.params.customerId);

    if (!Number.isFinite(customerId) || customerId <= 0) {
      res.status(400).json({ error: "invalid_customer_id" });
      return;
    }

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json({ error: "validation_error", issues: parsed.error.issues });
      return;
    }

    const defaults = defaultPeriod();
    const from = parsed.data.from ? new Date(parsed.data.from) : defaults.from;
    const to = parsed.data.to ? new Date(parsed.data.to) : defaults.to;
    const format = parsed.data.format;

    if (from > to) {
      res.status(400).json({ error: "invalid_period", message: "from > to" });
      return;
    }

    const started = Date.now();
    try {
      const data = await buildDossie({ providerId, customerId, from, to });

      // Audit do próprio dossiê (LGPD compliance interna — quem auditou quem)
      await storage.auditLog.registrarAcao(providerId, {
        action: "generate_dossie",
        resource: "customer",
        resourceId: String(customerId),
        actorType: "user",
        actorId: String(req.session.userId),
        payload: {
          from: from.toISOString(),
          to: to.toISOString(),
          format,
          totalCommunications: data.summary.totalCommunications,
          totalCompliance: data.complianceChecks.length,
          elapsedMs: Date.now() - started,
        },
      });

      if (format === "json") {
        res.json(data);
        return;
      }

      // PDF — stream
      const filename = `dossie-${customerId}-${data.period.from}-${data.period.to}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      renderDossiePdf(data, res);
    } catch (err) {
      const msg = (err as Error)?.message ?? "unknown";
      if (msg === "customer_not_found") {
        res.status(404).json({ error: "customer_not_found" });
        return;
      }
      logger.error({ action: "dossie_failed", providerId, customerId, err: msg }, "Falha ao gerar dossiê");
      if (!res.headersSent) {
        res.status(500).json({ error: "internal_error" });
      }
    }
  });

  return router;
}
