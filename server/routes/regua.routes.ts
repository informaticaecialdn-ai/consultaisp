/**
 * Spec 004 US3 — Painel "Régua Pré-Vencimento" + configurações dos agentes (T042).
 *
 * Endpoints:
 *   GET   /api/regua/pre-vencimento    — lista paginada de outbound_attempts com join customer+invoice+pix
 *   GET   /api/regua/agente-config     — config Bruno/Sofia + janela horária
 *   PATCH /api/regua/agente-config     — atualiza config + audit
 *
 * Auth: requireAuth + requireAdmin. Multi-tenant via req.session.providerId.
 */

import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { and, eq, gte, lte, sql, desc, inArray } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../logger";
import { requireAuth, requireAdmin } from "../auth";
import { storage } from "../storage";
import {
  outboundAttempts, customers, invoices, pixCharges,
} from "@shared/schema";

const PatchConfigBody = z.object({
  brunoAtivo: z.boolean().optional(),
  sofiaAtiva: z.boolean().optional(),
  schedulerHoraLocal: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  janelaInicio: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  janelaFim: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  permiteSabado: z.boolean().optional(),
  permiteDomingo: z.boolean().optional(),
  templateBrunoNome: z.string().nullable().optional(),
  templateSofiaNome: z.string().nullable().optional(),
}).strict();

function normalizeTime(value?: string): string | undefined {
  if (!value) return value;
  // Aceita "HH:MM" ou "HH:MM:SS". Normaliza para "HH:MM:SS".
  return value.length === 5 ? `${value}:00` : value;
}

export function registerReguaRoutes(): Router {
  const router: Router = express.Router();

  // GET /api/regua/pre-vencimento
  router.get("/api/regua/pre-vencimento", requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
    const providerId = req.session.providerId!;

    const limit = Math.min(200, Number(req.query.limit) || 50);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const stepFilter = req.query.step ? String(req.query.step) : undefined;
    const statusFilter = req.query.status ? String(req.query.status) : undefined;
    const fromStr = req.query.from ? String(req.query.from) : undefined;
    const toStr = req.query.to ? String(req.query.to) : undefined;

    try {
      const conditions: any[] = [eq(outboundAttempts.providerId, providerId)];
      if (stepFilter) conditions.push(eq(outboundAttempts.step, stepFilter));
      if (statusFilter) conditions.push(eq(outboundAttempts.status, statusFilter));
      if (fromStr) conditions.push(gte(outboundAttempts.scheduledFor, new Date(fromStr)));
      if (toStr) conditions.push(lte(outboundAttempts.scheduledFor, new Date(toStr)));

      const attemptsRows = await db.select().from(outboundAttempts)
        .where(and(...conditions))
        .orderBy(desc(outboundAttempts.scheduledFor))
        .limit(limit)
        .offset(offset);

      // Total separado para paginação
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(outboundAttempts)
        .where(and(...conditions));

      if (attemptsRows.length === 0) {
        res.json({ items: [], pagination: { limit, offset, total } });
        return;
      }

      // Resolve customers + invoices + pixCharges em batch
      const customerIds = Array.from(new Set(attemptsRows.map(a => a.customerId)));
      const invoiceIds = Array.from(new Set(attemptsRows.map(a => a.invoiceId).filter((x): x is number => !!x)));
      const pixChargeIds = Array.from(new Set(attemptsRows.map(a => a.pixChargeId).filter((x): x is number => !!x)));

      const [custRows, invRows, pixRows] = await Promise.all([
        customerIds.length > 0
          ? db.select({
              id: customers.id, name: customers.name, phone: customers.phone, cpfCnpj: customers.cpfCnpj,
            }).from(customers).where(and(eq(customers.providerId, providerId), inArray(customers.id, customerIds)))
          : Promise.resolve([]),
        invoiceIds.length > 0
          ? db.select({
              id: invoices.id, value: invoices.value, dueDate: invoices.dueDate, status: invoices.status,
            }).from(invoices).where(and(eq(invoices.providerId, providerId), inArray(invoices.id, invoiceIds)))
          : Promise.resolve([]),
        pixChargeIds.length > 0
          ? db.select({
              id: pixCharges.id, asaasPaymentId: pixCharges.asaasPaymentId, status: pixCharges.status,
              pixExpiresAt: pixCharges.pixExpiresAt, paidAt: pixCharges.paidAt,
            }).from(pixCharges).where(and(eq(pixCharges.providerId, providerId), inArray(pixCharges.id, pixChargeIds)))
          : Promise.resolve([]),
      ]);

      const custMap = new Map(custRows.map(c => [c.id, c]));
      const invMap = new Map(invRows.map(i => [i.id, i]));
      const pixMap = new Map(pixRows.map(p => [p.id, p]));

      const items = attemptsRows.map(a => {
        const cust = custMap.get(a.customerId);
        const inv = a.invoiceId ? invMap.get(a.invoiceId) : undefined;
        const pix = a.pixChargeId ? pixMap.get(a.pixChargeId) : undefined;
        return {
          attemptId: a.id,
          step: a.step,
          status: a.status,
          scheduledFor: a.scheduledFor,
          attemptCount: a.attemptCount,
          nextRetryAt: a.nextRetryAt,
          failureReason: a.failureReason,
          customer: cust ? {
            id: cust.id,
            name: cust.name,
            phone: cust.phone,
            cpfCnpj: cust.cpfCnpj,
          } : null,
          invoice: inv ? {
            id: inv.id,
            value: inv.value,
            dueDate: inv.dueDate,
            status: inv.status,
          } : null,
          pixCharge: pix ? {
            id: pix.id,
            asaasPaymentId: pix.asaasPaymentId,
            status: pix.status,
            expiresAt: pix.pixExpiresAt,
            paidAt: pix.paidAt,
          } : null,
        };
      });

      res.json({ items, pagination: { limit, offset, total } });
    } catch (err) {
      logger.error({ action: "regua_list_failed", providerId, err: (err as Error)?.message }, "GET regua/pre-vencimento falhou");
      res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /api/regua/agente-config
  router.get("/api/regua/agente-config", requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
    const providerId = req.session.providerId!;
    try {
      const cfg = await storage.agentToggle.byProviderId(providerId);
      res.json(cfg);
    } catch (err) {
      logger.error({ action: "agente_config_get_failed", providerId, err: (err as Error)?.message }, "GET agente-config falhou");
      res.status(500).json({ error: "internal_error" });
    }
  });

  // PATCH /api/regua/agente-config
  router.patch("/api/regua/agente-config", requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
    const providerId = req.session.providerId!;
    const parsed = PatchConfigBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "validation_error", issues: parsed.error.issues });
      return;
    }

    try {
      const before = await storage.agentToggle.byProviderId(providerId);
      const patch = {
        ...parsed.data,
        schedulerHoraLocal: normalizeTime(parsed.data.schedulerHoraLocal),
        janelaInicio: normalizeTime(parsed.data.janelaInicio),
        janelaFim: normalizeTime(parsed.data.janelaFim),
      };
      const updated = await storage.agentToggle.update(providerId, patch as any);

      // Audit
      await storage.auditLog.registrarAcao(providerId, {
        action: "agent_toggle_updated",
        resource: "agent_toggles",
        resourceId: String(updated.id),
        actorType: "user",
        actorId: String(req.session.userId),
        payload: {
          changes: parsed.data,
          before: {
            brunoAtivo: before.brunoAtivo,
            sofiaAtiva: before.sofiaAtiva,
            janelaInicio: before.janelaInicio,
            janelaFim: before.janelaFim,
          },
        },
      });

      // Se brunoAtivo virou false, cancelar jobs BullMQ pendentes do provider.
      // Implementação simplificada: jobs órfãos serão filtrados no worker via re-leitura
      // de agent_toggles.brunoAtivo (já implementado em bruno-process-invoice.ts).

      res.json(updated);
    } catch (err) {
      logger.error({ action: "agente_config_patch_failed", providerId, err: (err as Error)?.message }, "PATCH agente-config falhou");
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
