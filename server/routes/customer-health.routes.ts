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
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAuth } from "../auth";
import { logger } from "../logger";
import { db } from "../db";
import { customers, invoices } from "@shared/schema";
import { calculateHealthScore } from "../services/customer-health/score-calculator";
import { recommendAction } from "../services/customer-health/recommendation-engine";
import {
  buildCustomerHealthInputs,
  CustomerNotFoundError,
} from "../services/customer-health/snapshot-builder";

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

/** Schema dos pesos (Spec 010A calibrador) — soma deve ser ~1.0 */
const weightsSchema = z
  .object({
    punctuality: z.number().min(0).max(1),
    loyalty: z.number().min(0).max(1),
    reliability: z.number().min(0).max(1),
    sentiment: z.number().min(0).max(1),
    engagement: z.number().min(0).max(1),
    externalScore: z.number().min(0).max(1),
  })
  .refine(
    (w) =>
      Math.abs(
        w.punctuality +
          w.loyalty +
          w.reliability +
          w.sentiment +
          w.engagement +
          w.externalScore -
          1,
      ) < 0.01,
    { message: "weights must sum to 1.0 (±0.01)" },
  );

const calibrateSchema = z.object({
  inputs: previewInputSchema,
  weights: weightsSchema,
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
   * POST /api/customer-health/calibrate
   *
   * Variante do calculate-preview que aceita pesos customizados.
   * Permite owner testar calibração dos 6 componentes (punctuality, loyalty,
   * reliability, sentiment, engagement, externalScore) com a soma = 1.0.
   *
   * Útil para:
   *   - Frontend calibrador (/health/calibrador)
   *   - Validar impacto de mudança de pesos antes de aplicar tenant-wide
   */
  router.post(
    "/api/customer-health/calibrate",
    jsonParser,
    requireAuth,
    (req: Request, res: Response) => {
      const parsed = calibrateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "invalid_input",
          details: parsed.error.format(),
        });
      }

      try {
        const { inputs, weights } = parsed.data;
        const score = calculateHealthScore(inputs, weights);
        const recommendation = recommendAction(inputs, score);

        logger.debug(
          {
            action: "customer_health_calibrate",
            userId: req.session?.userId,
            healthScore: score.healthScore,
            healthTier: score.healthTier,
          },
          "Customer health calibrate computed",
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
            weightsApplied: weights,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "calculation_failed";
        logger.error(
          { action: "customer_health_calibrate_error", err: msg },
          "Customer health calibrate failed",
        );
        return res.status(500).json({ ok: false, error: msg });
      }
    },
  );

  /**
   * GET /api/customers/:id/health
   *
   * Computa health score on-the-fly para cliente real do tenant atual.
   * Não persiste — consulta tabelas existentes e retorna resultado fresco.
   *
   * Quando schema customer_health_snapshots for autorizado, este endpoint
   * passa a ler do snapshot persistido (com fallback para on-the-fly).
   */
  router.get(
    "/api/customers/:id/health",
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
        const inputs = await buildCustomerHealthInputs(providerId, customerId);
        const score = calculateHealthScore(inputs);
        const recommendation = recommendAction(inputs, score);

        logger.debug(
          {
            action: "customer_health_on_the_fly",
            providerId,
            customerId,
            healthScore: score.healthScore,
            healthTier: score.healthTier,
            latencyMs: Date.now() - started,
          },
          "Customer health computed on-the-fly",
        );

        return res.json({
          ok: true,
          data: {
            customerId,
            healthScore: score.healthScore,
            healthTier: score.healthTier,
            components: score.components,
            predictions: {
              inadimplenciaRisk30dPercent: score.inadimplenciaRisk30dPercent,
              churnRisk60dPercent: score.churnRisk60dPercent,
            },
            recommendation,
            contractStatus: inputs.contractStatus ?? "active",
            inputsSnapshot: inputs,
            computedAt: new Date().toISOString(),
            source: "on_the_fly",  // futura: 'persisted' quando schema autorizado
          },
        });
      } catch (err) {
        if (err instanceof CustomerNotFoundError) {
          return res.status(404).json({ ok: false, error: "customer_not_found" });
        }
        const msg = err instanceof Error ? err.message : "computation_failed";
        logger.error(
          { action: "customer_health_on_the_fly_error", providerId, customerId, err: msg },
          "Customer health on-the-fly computation failed",
        );
        return res.status(500).json({ ok: false, error: msg });
      }
    },
  );

  /**
   * GET /api/dashboard/at-risk
   *
   * Lista priorizada dos N clientes do tenant com maior probabilidade de
   * inadimplência nos próximos 30d. Computa on-the-fly para clientes que
   * têm pelo menos 1 fatura vencida (universo "at risk" — muito menor que
   * total de clientes ativos, mantém performance < 2s).
   *
   * Query params:
   *   ?limit=20 (default, max 100)
   */
  router.get(
    "/api/dashboard/at-risk",
    requireAuth,
    async (req: Request, res: Response) => {
      const providerId = req.session?.providerId;
      if (!providerId) {
        return res.status(401).json({ ok: false, error: "no_provider_context" });
      }

      const limitRaw = Number(req.query.limit ?? 20);
      const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));

      const started = Date.now();
      try {
        // Universo "at risk": clientes com pelo menos 1 invoice overdue.
        // Reduz drasticamente o cálculo (geralmente <100 vs 10k+ ativos).
        const overdueCustomers = await db
          .selectDistinct({ customerId: invoices.customerId })
          .from(invoices)
          .where(
            and(
              eq(invoices.providerId, providerId),
              sql`(${invoices.status} = 'overdue' OR (${invoices.status} = 'pending' AND ${invoices.dueDate} < NOW()))`,
            ),
          )
          .limit(500);  // hard cap pra proteger memória/tempo

        // Calcula health para cada e ordena por inadimplência risk DESC
        const results: Array<{
          customerId: number;
          healthScore: number;
          healthTier: string;
          inadimplenciaRisk30dPercent: number;
          churnRisk60dPercent: number;
          recommendedAgent: string;
          recommendedAction: string;
        }> = [];

        for (const { customerId } of overdueCustomers) {
          try {
            const inputs = await buildCustomerHealthInputs(providerId, customerId);
            const score = calculateHealthScore(inputs);
            const recommendation = recommendAction(inputs, score);

            // Só inclui warning/critical (não healthy/gold que voltam por algum dado defasado)
            if (score.healthTier === "warning" || score.healthTier === "critical") {
              results.push({
                customerId,
                healthScore: score.healthScore,
                healthTier: score.healthTier,
                inadimplenciaRisk30dPercent: score.inadimplenciaRisk30dPercent,
                churnRisk60dPercent: score.churnRisk60dPercent,
                recommendedAgent: recommendation.recommendedAgent,
                recommendedAction: recommendation.recommendedAction,
              });
            }
          } catch {
            // cliente individual com erro não bloqueia o resto
            continue;
          }
        }

        // Sort: critical primeiro, depois maior inadimplenciaRisk30dPercent
        results.sort((a, b) => {
          if (a.healthTier !== b.healthTier) {
            return a.healthTier === "critical" ? -1 : 1;
          }
          return b.inadimplenciaRisk30dPercent - a.inadimplenciaRisk30dPercent;
        });

        const top = results.slice(0, limit);

        // Enriquecer com nome do cliente (1 query batch)
        const customerIds = top.map((r) => r.customerId);
        const customerNames =
          customerIds.length > 0
            ? await db
                .select({ id: customers.id, name: customers.name })
                .from(customers)
                .where(
                  and(
                    eq(customers.providerId, providerId),
                    sql`${customers.id} IN ${customerIds}`,
                  ),
                )
            : [];
        const nameMap = new Map(customerNames.map((c) => [c.id, c.name]));

        const enriched = top.map((r) => ({ ...r, customerName: nameMap.get(r.customerId) ?? null }));

        logger.info(
          {
            action: "dashboard_at_risk",
            providerId,
            universeSize: overdueCustomers.length,
            atRiskCount: results.length,
            returned: enriched.length,
            latencyMs: Date.now() - started,
          },
          "Dashboard at-risk computed",
        );

        return res.json({
          ok: true,
          data: {
            customers: enriched,
            stats: {
              universeSize: overdueCustomers.length,
              atRiskCount: results.length,
              criticalCount: results.filter((r) => r.healthTier === "critical").length,
              warningCount: results.filter((r) => r.healthTier === "warning").length,
            },
            computedAt: new Date().toISOString(),
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "computation_failed";
        logger.error(
          { action: "dashboard_at_risk_error", providerId, err: msg },
          "Dashboard at-risk failed",
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
