import { eq, and, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  complianceChecks,
  type ComplianceCheck, type InsertComplianceCheck,
} from "@shared/schema";

/**
 * Spec 003 — Compliance checks (Júlia valida cada ação antes da execução).
 * Cada validação registra: decisão, base legal, ajustes, motivos de bloqueio.
 * Princípio I (multi-tenant): TODA query filtra por providerId.
 */

export interface MonthlyStats {
  total: number;
  blocked: number;
  approved: number;
  withAdjustment: number;
  blockingReasons: Array<{ reason: string; count: number }>;
}

export class ComplianceCheckStorage {
  /** Registra uma validação de compliance. providerId é forçado pra garantir isolamento. */
  async registrar(
    providerId: number,
    check: Omit<InsertComplianceCheck, "providerId">,
  ): Promise<ComplianceCheck> {
    const [created] = await db.insert(complianceChecks)
      .values({ ...check, providerId })
      .returning();
    return created;
  }

  /**
   * Estatísticas mensais de compliance para o dashboard de auditoria.
   * @param providerId tenant
   * @param month formato YYYY-MM (ex: "2026-05")
   */
  async monthlyStats(providerId: number, month: string): Promise<MonthlyStats> {
    // Validar formato e calcular range [start, end)
    const m = month.match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new Error(`Invalid month format: expected YYYY-MM, got "${month}"`);
    const year = Number(m[1]);
    const mon = Number(m[2]);
    const start = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(mon === 12 ? year + 1 : year, mon === 12 ? 0 : mon, 1, 0, 0, 0, 0));

    const rows = await db.select().from(complianceChecks)
      .where(and(
        eq(complianceChecks.providerId, providerId),
        gte(complianceChecks.createdAt, start),
        lt(complianceChecks.createdAt, end),
      ));

    const total = rows.length;
    let blocked = 0;
    let approved = 0;
    let withAdjustment = 0;
    const reasonCounts = new Map<string, number>();

    for (const r of rows) {
      const decision = (r.decision || "").toLowerCase();
      if (decision === "blocked" || decision === "block" || decision === "rejected") {
        blocked++;
        for (const reason of r.blockingReasons ?? []) {
          reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
        }
      } else if (decision === "approved" || decision === "approve" || decision === "allowed") {
        approved++;
      } else if (decision === "approved_with_adjustment" || decision === "adjusted" || r.adjustments) {
        withAdjustment++;
        approved++; // ajuste ainda é uma aprovação (condicional)
      }
    }

    const blockingReasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    return { total, blocked, approved, withAdjustment, blockingReasons };
  }
}
