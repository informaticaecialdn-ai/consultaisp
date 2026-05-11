/**
 * Team service — agrega KPIs dos 10 funcionários digitais do Provedor.ai.
 *
 * Fonte de verdade do CATÁLOGO (nome, role, cor, descrição): shared/types/team.ts
 * Esse serviço apenas calcula RUNTIME state: status (online/training/offline)
 * + 1 KPI primário por agente ativo para exibição em /api/team.
 *
 * Multi-tenant: todas as queries filtram por providerId.
 */

import { sql, and, eq, gte } from "drizzle-orm";
import { db } from "../db";
import {
  outboundAttempts,
  complianceChecks,
  communications,
  agentToggles,
} from "@shared/schema";
import {
  AGENT_CATALOG,
  AGENT_IDS,
  ACTIVE_AGENT_IDS,
  type AgentId,
  type AgentProfile,
  type AgentKpi,
  type AgentStatus,
} from "@shared/types/team";

/**
 * Início do mês corrente em ISO. Usado pra filtrar KPIs "do mês".
 */
function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

interface TogglesRow {
  brunoAtivo: boolean;
  sofiaAtiva: boolean;
}

/**
 * Lê toggles Bruno/Sofia. Se não existir registro pro tenant, default false.
 * agent_toggles é 1:1 por providerId.
 */
async function loadToggles(providerId: number): Promise<TogglesRow> {
  const rows = await db
    .select({
      brunoAtivo: agentToggles.brunoAtivo,
      sofiaAtiva: agentToggles.sofiaAtiva,
    })
    .from(agentToggles)
    .where(eq(agentToggles.providerId, providerId))
    .limit(1);

  if (rows.length === 0) {
    return { brunoAtivo: false, sofiaAtiva: false };
  }
  return {
    brunoAtivo: !!rows[0].brunoAtivo,
    sofiaAtiva: !!rows[0].sofiaAtiva,
  };
}

/**
 * Conta outbound_attempts no mês corrente para um agente específico.
 * status='sent' significa que JÚLIA aprovou e Meta API entregou (success path).
 */
async function countSentByAgent(providerId: number, agent: AgentId): Promise<number> {
  const monthStart = startOfMonth();
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outboundAttempts)
    .where(
      and(
        eq(outboundAttempts.providerId, providerId),
        eq(outboundAttempts.agentId, agent),
        eq(outboundAttempts.status, "sent"),
        gte(outboundAttempts.createdAt, monthStart),
      ),
    );
  return result[0]?.count ?? 0;
}

/**
 * Conta conversas inbound (channel=whatsapp, direction=inbound) do mês.
 * Aproxima Helena (atendente master inbound).
 */
async function countInboundConversations(providerId: number): Promise<number> {
  const monthStart = startOfMonth();
  const result = await db
    .select({ count: sql<number>`count(distinct ${communications.customerId})::int` })
    .from(communications)
    .where(
      and(
        eq(communications.providerId, providerId),
        eq(communications.direction, "inbound"),
        gte(communications.createdAt, monthStart),
      ),
    );
  return result[0]?.count ?? 0;
}

/**
 * Calcula taxa de bloqueio Júlia: BLOCKED / total no mês.
 * Retorna percentual 0-100 (arredondado).
 */
async function juliaBlockRate(providerId: number): Promise<{ rate: number; total: number }> {
  const monthStart = startOfMonth();
  const result = await db
    .select({
      total: sql<number>`count(*)::int`,
      blocked: sql<number>`count(*) filter (where ${complianceChecks.decision} = 'BLOCKED')::int`,
    })
    .from(complianceChecks)
    .where(
      and(
        eq(complianceChecks.providerId, providerId),
        gte(complianceChecks.createdAt, monthStart),
      ),
    );
  const total = result[0]?.total ?? 0;
  const blocked = result[0]?.blocked ?? 0;
  const rate = total === 0 ? 0 : Math.round((blocked / total) * 100);
  return { rate, total };
}

/**
 * Constrói roster completo com status + KPI por agente.
 * Retorna na ordem canônica de AGENT_IDS.
 */
export async function buildTeamRoster(providerId: number): Promise<AgentProfile[]> {
  const [toggles, juliaStats, helenaConvs, brunoSent, sofiaSent] = await Promise.all([
    loadToggles(providerId),
    juliaBlockRate(providerId),
    countInboundConversations(providerId),
    countSentByAgent(providerId, "bruno"),
    countSentByAgent(providerId, "sofia"),
  ]);

  return AGENT_IDS.map<AgentProfile>((id) => {
    const entry = AGENT_CATALOG[id];
    const status = resolveStatus(id, toggles);
    const kpi = ACTIVE_AGENT_IDS.includes(id)
      ? resolveKpi(id, { juliaStats, helenaConvs, brunoSent, sofiaSent })
      : null;

    return {
      id,
      name: entry.name,
      role: entry.role,
      description: entry.description,
      stack: entry.stack,
      model: entry.model,
      status,
      kpi,
      plannedSpec: entry.plannedSpec,
    };
  });
}

/**
 * Status visível no UI:
 * - Marcos/Rafael/Carla/Daniel/Lucas/Pedro: sempre "training" (não implementados)
 * - Júlia/Helena: sempre "online" (rodam silenciosamente em background sem toggle)
 * - Bruno/Sofia: "online" se toggle ativo, senão "offline"
 */
function resolveStatus(id: AgentId, toggles: TogglesRow): AgentStatus {
  if (!ACTIVE_AGENT_IDS.includes(id)) return "training";
  if (id === "bruno") return toggles.brunoAtivo ? "online" : "offline";
  if (id === "sofia") return toggles.sofiaAtiva ? "online" : "offline";
  return "online"; // júlia, helena
}

interface KpiContext {
  juliaStats: { rate: number; total: number };
  helenaConvs: number;
  brunoSent: number;
  sofiaSent: number;
}

function resolveKpi(id: AgentId, ctx: KpiContext): AgentKpi {
  switch (id) {
    case "julia":
      return {
        label: "Taxa de bloqueio",
        value: ctx.juliaStats.rate,
        unit: "%",
        trend: ctx.juliaStats.total === 0 ? "flat" : undefined,
      };
    case "helena":
      return { label: "Conversas atendidas", value: ctx.helenaConvs, unit: "no mês" };
    case "bruno":
      return { label: "Lembretes enviados", value: ctx.brunoSent, unit: "no mês" };
    case "sofia":
      return { label: "Agradecimentos", value: ctx.sofiaSent, unit: "no mês" };
    default:
      // unreachable — ACTIVE_AGENT_IDS é union estreita
      return { label: "—", value: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Spec 007 Sub-fase C — agregação cross-tenant para o superadmin
// ═══════════════════════════════════════════════════════════════════════

export interface AdminTeamStats {
  /** Total de tenants no sistema (count from providers). */
  totalTenants: number;
  /** Tenants com pelo menos 1 toggle ativo (Bruno OR Sofia). */
  tenantsWithActiveAgents: number;
  /** Mensagens outbound enviadas (status='sent') no mês corrente, cross-tenant. */
  totalSentThisMonth: number;
  /** Taxa de bloqueio agregada da Júlia (% BLOCKED / total compliance_checks). */
  juliaBlockRateGlobal: number;
  juliaTotalChecks: number;
  /** Top tenants por volume de mensagens no mês. */
  topTenantsByVolume: Array<{
    providerId: number;
    providerName: string;
    sentCount: number;
  }>;
  /** Volume por agente cross-tenant (apenas implementados). */
  byAgent: Array<{
    agentId: AgentId;
    sentCount: number;
    tenantsActive: number;
  }>;
}

/**
 * Agregação cross-tenant para a aba superadmin "Time Digital".
 * Sem cache — query direta. Otimizar quando virar gargalo.
 */
export async function buildAdminTeamStats(): Promise<AdminTeamStats> {
  const monthStart = startOfMonth();

  // Import dinâmico para evitar circular (providers usa db, que usa este service indiretamente)
  const { providers } = await import("@shared/schema");

  const [
    totalTenantsRow,
    activeAgentTenantsRow,
    sentByAgentRows,
    juliaGlobalRow,
    topTenantsRows,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(providers),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentToggles)
      .where(sql`${agentToggles.brunoAtivo} = true OR ${agentToggles.sofiaAtiva} = true`),
    db
      .select({
        agentId: outboundAttempts.agentId,
        sentCount: sql<number>`count(*)::int`,
        tenantsActive: sql<number>`count(distinct ${outboundAttempts.providerId})::int`,
      })
      .from(outboundAttempts)
      .where(
        and(
          eq(outboundAttempts.status, "sent"),
          gte(outboundAttempts.createdAt, monthStart),
        ),
      )
      .groupBy(outboundAttempts.agentId),
    db
      .select({
        total: sql<number>`count(*)::int`,
        blocked: sql<number>`count(*) filter (where ${complianceChecks.decision} = 'BLOCKED')::int`,
      })
      .from(complianceChecks)
      .where(gte(complianceChecks.createdAt, monthStart)),
    db
      .select({
        providerId: providers.id,
        providerName: providers.name,
        sentCount: sql<number>`count(${outboundAttempts.id})::int`,
      })
      .from(outboundAttempts)
      .innerJoin(providers, eq(providers.id, outboundAttempts.providerId))
      .where(
        and(
          eq(outboundAttempts.status, "sent"),
          gte(outboundAttempts.createdAt, monthStart),
        ),
      )
      .groupBy(providers.id, providers.name)
      .orderBy(sql`count(${outboundAttempts.id}) desc`)
      .limit(5),
  ]);

  const totalSent = sentByAgentRows.reduce((acc, r) => acc + (r.sentCount ?? 0), 0);
  const juliaTotal = juliaGlobalRow[0]?.total ?? 0;
  const juliaBlocked = juliaGlobalRow[0]?.blocked ?? 0;

  return {
    totalTenants: totalTenantsRow[0]?.count ?? 0,
    tenantsWithActiveAgents: activeAgentTenantsRow[0]?.count ?? 0,
    totalSentThisMonth: totalSent,
    juliaBlockRateGlobal: juliaTotal === 0 ? 0 : Math.round((juliaBlocked / juliaTotal) * 100),
    juliaTotalChecks: juliaTotal,
    topTenantsByVolume: topTenantsRows.map((r) => ({
      providerId: r.providerId,
      providerName: r.providerName,
      sentCount: r.sentCount ?? 0,
    })),
    byAgent: sentByAgentRows
      .filter((r) => ACTIVE_AGENT_IDS.includes(r.agentId as AgentId))
      .map((r) => ({
        agentId: r.agentId as AgentId,
        sentCount: r.sentCount ?? 0,
        tenantsActive: r.tenantsActive ?? 0,
      })),
  };
}
