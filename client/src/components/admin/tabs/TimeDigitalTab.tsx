/**
 * Spec 007 Sub-fase C — Tab superadmin "Time Digital".
 *
 * Visão agregada cross-tenant dos 10 funcionários digitais. Mostra:
 * - 4 cards KPI: total tenants, tenants com toggle ativo, volume mensagens,
 *   taxa bloqueio Júlia global
 * - Tabela "Top 5 tenants por volume"
 * - Grid dos 10 agentes (catálogo) com volume agregado por agente
 *
 * Padrão mimético de VisaoGeralTab.tsx (useQuery + Card + Badge).
 */

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users, Bot, MessageSquare, ShieldCheck, TrendingUp, Sparkles,
} from "lucide-react";
import { STALE_DASHBOARD } from "@/lib/queryClient";
import { AgentBadge } from "@/components/agent-badge";
import {
  AGENT_CATALOG, AGENT_IDS, ACTIVE_AGENT_IDS, type AgentId,
} from "@shared/types/team";

interface AdminTeamStats {
  totalTenants: number;
  tenantsWithActiveAgents: number;
  totalSentThisMonth: number;
  juliaBlockRateGlobal: number;
  juliaTotalChecks: number;
  topTenantsByVolume: Array<{ providerId: number; providerName: string; sentCount: number }>;
  byAgent: Array<{ agentId: AgentId; sentCount: number; tenantsActive: number }>;
}

export default function TimeDigitalTab() {
  const { data: stats, isLoading } = useQuery<AdminTeamStats>({
    queryKey: ["/api/admin/team-stats"],
    staleTime: STALE_DASHBOARD,
  });

  const STAT_CARDS = [
    {
      label: "Tenants no sistema",
      value: stats?.totalTenants ?? "-",
      icon: Users,
      color: "from-blue-500 to-blue-600",
      sub: `${stats?.tenantsWithActiveAgents ?? 0} com agentes ativos`,
    },
    {
      label: "Mensagens enviadas",
      value: stats?.totalSentThisMonth ?? "-",
      icon: MessageSquare,
      color: "from-emerald-500 to-emerald-600",
      sub: "este mês · cross-tenant",
    },
    {
      label: "Taxa bloqueio Júlia",
      value: `${stats?.juliaBlockRateGlobal ?? 0}%`,
      icon: ShieldCheck,
      color: "from-amber-500 to-orange-600",
      sub: `${stats?.juliaTotalChecks ?? 0} validações`,
    },
    {
      label: "Agentes ativos",
      value: ACTIVE_AGENT_IDS.length,
      icon: Bot,
      color: "from-rose-500 to-pink-600",
      sub: `de ${AGENT_IDS.length} no roadmap`,
    },
  ];

  // Map agent -> sentCount para lookup rápido
  const sentByAgent = new Map<AgentId, { sentCount: number; tenantsActive: number }>();
  stats?.byAgent.forEach((row) => sentByAgent.set(row.agentId, row));

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STAT_CARDS.map((s) => (
          <Card key={s.label} className="p-4" data-testid={`team-stat-${s.label.toLowerCase().replace(/ /g, "-")}`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded bg-gradient-to-br ${s.color} flex items-center justify-center flex-shrink-0`}>
                <s.icon className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold">{isLoading ? "..." : s.value}</p>
                <p className="text-xs text-[var(--color-muted)] truncate">{s.label}</p>
                <p className="text-xs text-[var(--color-muted)]/70 truncate">{s.sub}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Top 5 tenants por volume */}
        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
            <TrendingUp className="w-4 h-4" />Top tenants por volume (mês)
          </h3>
          {isLoading ? (
            <p className="text-sm text-[var(--color-muted)]">Carregando...</p>
          ) : stats?.topTenantsByVolume.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] py-4 text-center">
              Sem mensagens enviadas neste mês ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {stats?.topTenantsByVolume.map((t, idx) => (
                <div
                  key={t.providerId}
                  className="flex items-center gap-3 py-1.5 border-b last:border-0"
                  data-testid={`team-tenant-row-${t.providerId}`}
                >
                  <span className="w-6 h-6 rounded-full bg-[var(--color-tag-bg)] flex items-center justify-center text-xs font-bold text-[var(--color-muted)] flex-shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.providerName}</p>
                  </div>
                  <Badge variant="outline" className="text-xs font-mono">
                    {t.sentCount.toLocaleString("pt-BR")} msgs
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Volume por agente */}
        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
            <Bot className="w-4 h-4" />Volume por agente (cross-tenant)
          </h3>
          <div className="space-y-2">
            {ACTIVE_AGENT_IDS.map((id) => {
              const data = sentByAgent.get(id);
              return (
                <div
                  key={id}
                  className="flex items-center gap-3 py-1.5 border-b last:border-0"
                  data-testid={`team-agent-row-${id}`}
                >
                  <AgentBadge agentId={id} variant="small" />
                  <div className="flex-1" />
                  <span className="text-xs text-[var(--color-muted)]">
                    {data?.tenantsActive ?? 0} tenant{(data?.tenantsActive ?? 0) === 1 ? "" : "s"}
                  </span>
                  <Badge variant="outline" className="text-xs font-mono min-w-[60px] justify-center">
                    {(data?.sentCount ?? 0).toLocaleString("pt-BR")}
                  </Badge>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Catálogo completo (10 agentes) */}
      <Card className="p-5">
        <h3 className="font-semibold mb-1 flex items-center gap-2 text-sm">
          <Sparkles className="w-4 h-4" />Catálogo do Time Digital
        </h3>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Fonte canônica: <code className="text-[10px] bg-[var(--color-tag-bg)] px-1 py-0.5 rounded">TEAM.md</code>.
          Agentes "em treinamento" estão no roadmap mas ainda não foram implementados.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {AGENT_IDS.map((id) => {
            const agent = AGENT_CATALOG[id];
            const isActive = ACTIVE_AGENT_IDS.includes(id);
            return (
              <div
                key={id}
                className={`p-3 rounded border ${isActive ? "border-[var(--color-success)]/30 bg-[var(--color-success-bg)]/30" : "border-[var(--color-brand-amber-500)]/30 bg-[var(--color-brand-amber-100)]/30"}`}
                data-testid={`team-catalog-${id}`}
              >
                <AgentBadge agentId={id} variant="small" />
                <p className="text-[10px] text-[var(--color-muted)] mt-2 line-clamp-2 leading-snug">
                  {agent.role}
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  {isActive ? (
                    <Badge className="text-[9px] px-1.5 py-0 h-4 bg-[var(--color-success-bg)] text-[var(--color-success)]">
                      Ativo
                    </Badge>
                  ) : (
                    <Badge className="text-[9px] px-1.5 py-0 h-4 bg-[var(--color-brand-amber-100)] text-[var(--color-brand-amber-700)]">
                      {agent.plannedSpec ?? "Em breve"}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
