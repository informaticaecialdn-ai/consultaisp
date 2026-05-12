/**
 * Spec 009 — Pix Dinâmico preview endpoint.
 *
 * Opera sobre OfferConfig fornecido + momento atual, SEM criar charge real
 * no Asaas e SEM persistir em DB. Permite owner testar configuração de
 * tiers + ver quanto cada faixa custaria.
 */

import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { logger } from "../logger";
import {
  computeOfferState,
  formatTiersForCustomer,
  resolveTiers,
} from "../services/pix-dynamic/tier-calculator";
import { DEFAULT_TIERS } from "../services/pix-dynamic/types";

const tierSchema = z.object({
  index: z.number().int().min(0),
  discountPercent: z.number().min(0).max(100),
  validForHours: z.number().min(0.1).max(168),
  label: z.string().min(1),
});

const previewSchema = z.object({
  baseAmountCents: z.number().int().min(100),  // mínimo R$ 1,00
  tiers: z.array(tierSchema).min(1).max(10).optional(),
  /** ISO 8601 — momento "agora" para simulação. Default: now real. */
  now: z.string().datetime().optional(),
  /** ISO 8601 — quando a oferta foi criada. Default: now. */
  createdAt: z.string().datetime().optional(),
});

export function registerPixDynamicRoutes(): Router {
  const router = express.Router();
  const jsonParser = express.json({ limit: "32kb" });

  /**
   * POST /api/pix-dynamic/preview-offer
   *
   * Body: { baseAmountCents, tiers?, now?, createdAt? }
   * Response: { tiers (resolved), state (current/next), customerText[] }
   */
  router.post(
    "/api/pix-dynamic/preview-offer",
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
        const createdAt = parsed.data.createdAt
          ? new Date(parsed.data.createdAt)
          : new Date();
        const now = parsed.data.now ? new Date(parsed.data.now) : new Date();

        const tiers = parsed.data.tiers ?? [...DEFAULT_TIERS];
        const config = {
          baseAmountCents: parsed.data.baseAmountCents,
          tiers,
          createdAt,
        };

        const resolved = resolveTiers(config);
        const state = computeOfferState(config, now);
        const customerText = formatTiersForCustomer(config);

        return res.json({
          ok: true,
          data: {
            config: {
              baseAmountCents: config.baseAmountCents,
              createdAt: config.createdAt.toISOString(),
              now: now.toISOString(),
            },
            resolvedTiers: resolved.map((t) => ({
              ...t,
              validFrom: t.validFrom.toISOString(),
              validUntil: t.validUntil.toISOString(),
            })),
            state: {
              currentTier: state.currentTier
                ? {
                    ...state.currentTier,
                    validFrom: state.currentTier.validFrom.toISOString(),
                    validUntil: state.currentTier.validUntil.toISOString(),
                  }
                : null,
              nextTier: state.nextTier
                ? {
                    ...state.nextTier,
                    validFrom: state.nextTier.validFrom.toISOString(),
                    validUntil: state.nextTier.validUntil.toISOString(),
                  }
                : null,
              nextTransitionAt: state.nextTransitionAt?.toISOString() ?? null,
              finalExpiresAt: state.finalExpiresAt.toISOString(),
              isExpired: state.isExpired,
            },
            customerText,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "calculation_failed";
        logger.error(
          { action: "pix_dynamic_preview_error", err: msg },
          "Pix dynamic preview failed",
        );
        return res.status(400).json({ ok: false, error: msg });
      }
    },
  );

  return router;
}
