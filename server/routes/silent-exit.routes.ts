/**
 * Spec 013 — Silent Exit risk preview endpoint.
 *
 * Aceita SilentExitInputs no body, retorna risco calculado + breakdown.
 * Sem DB. Útil para demo + integração frontend antes do cron real.
 */

import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { logger } from "../logger";
import { calculateSilentExitRisk } from "../services/silent-exit/risk-calculator";
import { buildSilentExitInputs } from "../services/silent-exit/snapshot-builder";
import { CustomerNotFoundError } from "../services/customer-health/snapshot-builder";

const previewSchema = z.object({
  bandwidthDropPercent: z.number().min(0).max(100).nullable(),
  portalLoginCount30d: z.number().int().min(0).nullable(),
  portalLoginCountBaseline: z.number().min(0).nullable(),
  secondViaSearches30d: z.number().int().min(0),
  ticketCount30d: z.number().int().min(0),
  ticketCountBaseline: z.number().min(0).nullable(),
  utmCompetitorReferrer: z.boolean(),
  daysWithoutLogin: z.number().int().min(0).nullable(),
  recentPlanDowngrade: z.boolean(),
  healthScoreTrend: z.enum(["declining", "stable", "improving"]).nullable(),
});

export function registerSilentExitRoutes(): Router {
  const router = express.Router();
  const jsonParser = express.json({ limit: "32kb" });

  /**
   * POST /api/silent-exit/preview-risk
   * Body: SilentExitInputs
   * Response: { riskScore, riskLevel, contributions, recommendedAction }
   */
  router.post(
    "/api/silent-exit/preview-risk",
    jsonParser,
    requireAuth,
    (req: Request, res: Response) => {
      const parsed = previewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "invalid_input",
          details: parsed.error.format(),
        });
      }

      try {
        const result = calculateSilentExitRisk(parsed.data);
        logger.debug(
          {
            action: "silent_exit_preview",
            userId: req.session?.userId,
            riskScore: result.riskScore,
            riskLevel: result.riskLevel,
          },
          "Silent exit risk preview computed",
        );
        return res.json({ ok: true, data: result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "calculation_failed";
        logger.error(
          { action: "silent_exit_preview_error", err: msg },
          "Silent exit preview failed",
        );
        return res.status(500).json({ ok: false, error: msg });
      }
    },
  );

  /**
   * GET /api/customers/:id/silent-exit-risk
   *
   * Computa silent exit risk on-the-fly para cliente real do tenant atual.
   * Lê do DB (communications inbound, etc.). Sinais não-instrumentados
   * retornam null/neutro — score reflete só dados disponíveis hoje.
   */
  router.get(
    "/api/customers/:id/silent-exit-risk",
    requireAuth,
    async (req: Request, res: Response) => {
      const customerId = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(customerId) || customerId <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_customer_id" });
      }
      const providerId = req.session?.providerId;
      if (!providerId) {
        return res.status(401).json({ ok: false, error: "no_provider_context" });
      }

      const started = Date.now();
      try {
        const inputs = await buildSilentExitInputs(providerId, customerId);
        const result = calculateSilentExitRisk(inputs);

        logger.debug(
          {
            action: "silent_exit_on_the_fly",
            providerId,
            customerId,
            riskScore: result.riskScore,
            riskLevel: result.riskLevel,
            latencyMs: Date.now() - started,
          },
          "Silent exit risk computed on-the-fly",
        );

        return res.json({
          ok: true,
          data: {
            customerId,
            ...result,
            inputsSnapshot: inputs,
            computedAt: new Date().toISOString(),
            source: "on_the_fly",
            limitations: {
              bandwidthData: "indisponível — requer Spec 012.0 com histórico persistido",
              portalSignals: "indisponíveis — portal cliente não instrumentado",
              contractHistory: "indisponível — sem tabela de mudanças de plano",
            },
          },
        });
      } catch (err) {
        if (err instanceof CustomerNotFoundError) {
          return res.status(404).json({ ok: false, error: "customer_not_found" });
        }
        const msg = err instanceof Error ? err.message : "computation_failed";
        logger.error(
          { action: "silent_exit_on_the_fly_error", providerId, customerId, err: msg },
          "Silent exit on-the-fly failed",
        );
        return res.status(500).json({ ok: false, error: msg });
      }
    },
  );

  return router;
}
