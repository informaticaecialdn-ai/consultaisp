/**
 * Spec 013 — Silent Exit snapshot builder (sem schema novo).
 *
 * Lê dados das tabelas existentes (customers, communications) e monta
 * SilentExitInputs para o risk-calculator. Permite computar risco de
 * saída silenciosa REAL on-the-fly para um cliente.
 *
 * Limitações MVP — sinais não-disponíveis retornam null/neutro:
 *   - bandwidthDropPercent: depende Spec 012.0 com dados HISTÓRICOS (snapshot ainda não persistido)
 *   - portalLoginCount30d / baseline: portal cliente não instrumentado
 *   - utmCompetitorReferrer: portal não captura UTM
 *   - daysWithoutLogin: idem
 *   - recentPlanDowngrade: contracts table não tem histórico de mudanças
 *   - healthScoreTrend: precisa snapshots customer_health_snapshots persistidos
 *
 * Sinais DISPONÍVEIS:
 *   - ticketCount30d + baseline (via communications inbound)
 *   - secondViaSearches30d: sempre 0 por enquanto (audit logs não rastreia esse evento ainda)
 *
 * Quando instrumentação chegar, populamos os null/false. Score sobe.
 */

import { and, count, eq, gte } from "drizzle-orm";
import { db } from "../../db";
import { communications, customers } from "@shared/schema";
import { CustomerNotFoundError } from "../customer-health/snapshot-builder";
import type { SilentExitInputs } from "./types";

export async function buildSilentExitInputs(
  providerId: number,
  customerId: number,
): Promise<SilentExitInputs> {
  // Multi-tenant gate
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.providerId, providerId)))
    .limit(1);
  if (!customer) {
    throw new CustomerNotFoundError(providerId, customerId);
  }

  // Tickets 30d e 90d (baseline = média mensal dos 90d)
  const ticketCount30d = await ticketsInDays(providerId, customerId, 30);
  const ticketCount90d = await ticketsInDays(providerId, customerId, 90);
  const ticketCountBaseline = ticketCount90d > 0 ? ticketCount90d / 3 : null;

  return {
    bandwidthDropPercent: null,           // requer histórico Spec 012.0
    portalLoginCount30d: null,            // requer instrumentação portal
    portalLoginCountBaseline: null,
    secondViaSearches30d: 0,              // requer event tracking
    ticketCount30d,
    ticketCountBaseline,
    utmCompetitorReferrer: false,         // requer UTM tracking portal
    daysWithoutLogin: null,               // requer login tracking
    recentPlanDowngrade: false,           // requer contracts history table
    healthScoreTrend: null,               // requer customer_health_snapshots persistidos
  };
}

async function ticketsInDays(
  providerId: number,
  customerId: number,
  daysWindow: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000);

  const [row] = await db
    .select({ c: count() })
    .from(communications)
    .where(
      and(
        eq(communications.customerId, customerId),
        eq(communications.providerId, providerId),
        eq(communications.direction, "inbound"),
        gte(communications.createdAt, cutoff),
      ),
    );

  return Number(row?.c ?? 0);
}
