import { eq, and, asc, desc, sql } from "drizzle-orm";
import { db } from "../db";
import {
  auditLogs, customers,
  type AuditLog,
} from "@shared/schema";

/**
 * Spec 003 — Audit logs APPEND-ONLY (trigger Postgres bloqueia UPDATE/DELETE).
 * Usado para gerar dossiê de defesa Procon/MP/CDC.
 * Princípio I (multi-tenant): TODA query filtra por providerId.
 */

export interface AuditLogParams {
  action: string;
  resource: string;
  resourceId: string;
  actorType: "user" | "agent" | "system" | "tenant" | string;
  actorId?: string;
  actorName?: string;
  payload?: unknown;
  legalBasis?: string;
  legalReferences?: string[];
  notificationProof?: unknown;
}

export interface DossierEntry {
  occurredAt: Date;
  action: string;
  resource: string;
  resourceId: string;
  actorType: string;
  actorId: string | null;
  actorName: string | null;
  payload: unknown;
  legalBasis: string | null;
  legalReferences: string[];
  notificationProof: unknown;
}

export class AuditLogStorage {
  /** Registra ação no audit log. APPEND-ONLY — não tem update/delete. */
  async registrarAcao(providerId: number, params: AuditLogParams): Promise<AuditLog> {
    const [created] = await db.insert(auditLogs)
      .values({
        providerId,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId,
        actorType: params.actorType,
        actorId: params.actorId ?? null,
        actorName: params.actorName ?? null,
        payload: (params.payload ?? null) as any,
        legalBasis: params.legalBasis ?? null,
        legalReferences: params.legalReferences ?? [],
        notificationProof: (params.notificationProof ?? null) as any,
      })
      .returning();
    return created;
  }

  /** Lista todos os audit logs de um cliente (qualquer recurso ligado ao customerId). */
  async listByCustomer(providerId: number, customerId: number, limit = 200): Promise<AuditLog[]> {
    // resourceId é text; comparamos com customerId.toString() OU buscamos logs cujo payload referencia o cliente.
    // Estratégia: filtrar por resource = 'customer' AND resourceId = customerId.toString().
    return db.select().from(auditLogs)
      .where(and(
        eq(auditLogs.providerId, providerId),
        eq(auditLogs.resource, "customer"),
        eq(auditLogs.resourceId, String(customerId)),
      ))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(limit);
  }

  /**
   * Gera dossiê completo de defesa para um cliente:
   * timeline cronológica (ordem crescente) de TODAS as ações relevantes,
   * incluindo ações sobre o customer + recursos relacionados (communications,
   * agreements, compliance_checks) que mencionem o customerId.
   *
   * Usado em casos de Procon/CDC: prova de boa-fé, base legal e
   * cumprimento dos requisitos da Lei 14.181/2021 (superendividamento).
   */
  async gerarDossie(providerId: number, customerId: number): Promise<DossierEntry[]> {
    // Busca logs onde resourceId = customerId.toString() OU payload contém customerId
    // (logs de communications/agreements/etc referenciam customerId no payload).
    const customerIdStr = String(customerId);

    const rows = await db.select().from(auditLogs)
      .where(and(
        eq(auditLogs.providerId, providerId),
        sql`(
          (${auditLogs.resource} = 'customer' AND ${auditLogs.resourceId} = ${customerIdStr})
          OR (${auditLogs.payload} ->> 'customerId' = ${customerIdStr})
          OR (${auditLogs.payload} ->> 'customer_id' = ${customerIdStr})
        )`,
      ))
      .orderBy(asc(auditLogs.occurredAt));

    return rows.map(r => ({
      occurredAt: r.occurredAt,
      action: r.action,
      resource: r.resource,
      resourceId: r.resourceId,
      actorType: r.actorType,
      actorId: r.actorId,
      actorName: r.actorName,
      payload: r.payload,
      legalBasis: r.legalBasis,
      legalReferences: r.legalReferences ?? [],
      notificationProof: r.notificationProof,
    }));
  }
}
