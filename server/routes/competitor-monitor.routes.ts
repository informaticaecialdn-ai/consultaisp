/**
 * Spec 014 — Competitor Monitor heuristic preview endpoint.
 *
 * Classifica resultado de busca (heurística pré-LLM) sem chamar Serper real
 * nem Claude. Útil para owner testar com URLs/textos reais ANTES de ativar
 * crawler em produção.
 */

import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { logger } from "../logger";
import {
  classifyHeuristic,
  needsLlmReview,
} from "../services/competitor-monitor/heuristic-classifier";

const searchResultSchema = z.object({
  title: z.string().min(1).max(500),
  url: z.string().url(),
  snippet: z.string().max(2000),
  domain: z.string().optional(),
});

const tenantContextSchema = z.object({
  cities: z.array(z.string().min(1)).min(1).max(50),
  state: z.string().length(2),
  knownCompetitors: z.array(z.string().min(1)).max(50),
});

const previewSchema = z.object({
  results: z.array(searchResultSchema).min(1).max(50),
  context: tenantContextSchema,
});

export function registerCompetitorMonitorRoutes(): Router {
  const router = express.Router();
  const jsonParser = express.json({ limit: "128kb" });

  /**
   * POST /api/competitor-monitor/preview-classify
   * Body: { results[], context }
   * Response: classifications[] + stats { llmReviewNeeded count }
   */
  router.post(
    "/api/competitor-monitor/preview-classify",
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
        const { results, context } = parsed.data;
        const classified = results.map((search) => {
          const heuristic = classifyHeuristic(search, context);
          return {
            search,
            heuristic,
            needsLlm: needsLlmReview(heuristic),
          };
        });

        const stats = {
          total: classified.length,
          newProvider: classified.filter((c) => c.heuristic.classification === "new_provider").length,
          existingProvider: classified.filter((c) => c.heuristic.classification === "existing_provider").length,
          unrelated: classified.filter((c) => c.heuristic.classification === "unrelated").length,
          noise: classified.filter((c) => c.heuristic.classification === "noise").length,
          llmReviewNeeded: classified.filter((c) => c.needsLlm).length,
        };

        logger.debug(
          {
            action: "competitor_monitor_preview",
            userId: req.session?.userId,
            ...stats,
          },
          "Competitor monitor preview computed",
        );

        return res.json({ ok: true, data: { classified, stats } });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "classification_failed";
        logger.error(
          { action: "competitor_monitor_preview_error", err: msg },
          "Competitor monitor preview failed",
        );
        return res.status(500).json({ ok: false, error: msg });
      }
    },
  );

  return router;
}
