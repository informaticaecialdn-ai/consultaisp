/**
 * Spec 010A — Customer Health API (preview endpoints).
 *
 * MVP "preview" — opera sobre inputs fornecidos no body, SEM consultar DB.
 * Permite demo + integração frontend antes do schema customer_health_snapshots
 * ser autorizado e do snapshot-builder.ts (Batch 2) estar pronto.
 *
 * Endpoints DB-backed virão no Batch 2 (depende autorização):
 *   GET /api/customers/:id/health           — último snapshot
 *   GET /api/customers/:id/health/history   — série temporal
 *   GET /api/dashboard/at-risk              — lista priorizada
 */

import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { logger } from "../logger";
import { calculateHealthScore } from "../services/customer-health/score-calculator";
import { recommendAction } from "../services/customer-health/recommendation-engine";

/** Schema Zod do body da preview — valida inputs antes de calcular. */
const previewInputSchema = z.object({
  contractMonths: z.number().int().min(0),
  invoicesTotal: z.number().int().min(0),
  invoicesPaid: z.number().int().min(0),
  invoicesLate: z.number().int().min(0),
  invoicesOverdueCurrent: z.number().int().min(0),
  avgDaysLate30d: z.number().nullable(),
  avgDaysLate90d: z.number().nullable(),
  avgDaysLate365d: z.number().nullable(),
  totalRevenueAccumulatedCents: z.number().int().min(0),
  brokenAgreementsCount: z.number().int().min(0),
  ticketCount30d: z.number().int().min(0),
  ticketCount90d: z.number().int().min(0),
  lastInteractionDays: z.number().int().nullable(),
  avgSentimentScore90d: z.number().min(-1).max(1).nullable(),
  consultaIspScore: z.number().min(0).max(1000).nullable(),
});

export function registerCustomerHealthRoutes(): Router {
  const router = express.Router();
  const jsonParser = express.json({ limit: "64kb" });

  /**
   * POST /api/customer-health/calculate-preview
   *
   * Body: CustomerHealthInputs (vide types.ts)
   * Response: { ok: true, score, components, predictions, recommendation }
   *
   * Útil para:
   *   - Frontend visualizar health score de cliente hipotético (simulador)
   *   - Owner testar calibração de pesos sem rodar cron
   *   - Integração com agentes (Marcos consulta antes de despachar)
   */
  router.post(
    "/api/customer-health/calculate-preview",
    jsonParser,
    requireAuth,
    (req: Request, res: Response) => {
      const parseResult = previewInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          ok: false,
          error: "invalid_input",
          details: parseResult.error.format(),
        });
      }

      const inputs = parseResult.data;
      const started = Date.now();

      try {
        const score = calculateHealthScore(inputs);
        const recommendation = recommendAction(inputs, score);

        logger.debug(
          {
            action: "customer_health_preview",
            userId: req.session?.userId,
            healthScore: score.healthScore,
            healthTier: score.healthTier,
            latencyMs: Date.now() - started,
          },
          "Customer health preview computed",
        );

        return res.json({
          ok: true,
          data: {
            healthScore: score.healthScore,
            healthTier: score.healthTier,
            components: score.components,
            predictions: {
              inadimplenciaRisk30dPercent: score.inadimplenciaRisk30dPercent,
              churnRisk60dPercent: score.churnRisk60dPercent,
            },
            recommendation,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "calculation_failed";
        logger.error(
          { action: "customer_health_preview_error", err: msg },
          "Customer health preview failed",
        );
        return res.status(500).json({ ok: false, error: msg });
      }
    },
  );

  /**
   * GET /api/customer-health/health
   *
   * Health check para monitoramento. Não-autenticado.
   */
  router.get("/api/customer-health/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: "customer-health",
      version: "0.1.0-preview",
      capabilities: {
        preview: "available",
        snapshot: "pending_schema_authorization",
        cron: "pending_schema_authorization",
      },
    });
  });

  return router;
}
