/**
 * Página /time — overview dos 10 funcionários digitais do tenant.
 *
 * Spec 007 Sub-fase B. Mostra grid 5×2 (desktop) / 2×5 (mobile) com cada
 * agente do TEAM.md, status atual (online/training/offline) e KPI primário
 * do mês para os 4 implementados.
 *
 * Click em card abre /time/:agentId (perfil detalhado).
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentBadge } from "@/components/agent-badge";
import { ArrowRight, Sparkles } from "lucide-react";
import type { AgentProfile } from "@shared/types/team";

interface RosterResponse {
  agents: AgentProfile[];
}

function StatusPill({ status }: { status: AgentProfile["status"] }) {
  if (status === "online") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--color-success-bg)] text-[var(--color-success)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
        Online
      </span>
    );
  }
  if (status === "offline") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--color-tag-bg)] text-[var(--color-muted)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]" />
        Inativo
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--color-brand-amber-100)] text-[var(--color-brand-amber-700)]">
      <Sparkles className="w-2.5 h-2.5" />
      Em treinamento
    </span>
  );
}

function AgentCard({ agent }: { agent: AgentProfile }) {
  const isActive = agent.status === "online" || agent.status === "offline";

  return (
    <Link href={`/time/${agent.id}`}>
      <Card className="group p-5 h-full cursor-pointer hover:shadow-md hover:border-[var(--color-brand-green-700)]/30 transition-all">
        <div className="flex items-start justify-between gap-2 mb-4">
          <AgentBadge agentId={agent.id} variant="large" status={agent.status} />
          <ArrowRight className="w-4 h-4 text-[var(--color-muted)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-2" />
        </div>

        <p className="text-xs text-[var(--color-muted)] leading-relaxed line-clamp-3 mb-4 min-h-[3.6em]">
          {agent.description}
        </p>

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-[var(--color-border)]">
          <StatusPill status={agent.status} />
          {agent.kpi ? (
            <div className="text-right">
              <p className="text-lg font-display font-semibold text-[var(--color-ink)] leading-none">
                {agent.kpi.value}
                {agent.kpi.unit === "%" && <span className="text-sm">%</span>}
              </p>
              <p className="text-[10px] text-[var(--color-muted)] mt-0.5">{agent.kpi.label}</p>
            </div>
          ) : (
            <p className="text-[10px] text-[var(--color-muted)] text-right">
              {agent.plannedSpec ? `Previsto: ${agent.plannedSpec}` : "—"}
            </p>
          )}
        </div>

        {!isActive && (
          <p className="text-[10px] text-[var(--color-muted)] mt-3 italic">
            {agent.model} · {agent.stack === "managed-agents" ? "Anthropic Platform" : "Direct API"}
          </p>
        )}
      </Card>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <Card className="p-5 h-full">
      <div className="flex items-start gap-3 mb-4">
        <Skeleton className="w-12 h-12 rounded-full" />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-2 w-32" />
        </div>
      </div>
      <Skeleton className="h-3 w-full mb-2" />
      <Skeleton className="h-3 w-5/6 mb-2" />
      <Skeleton className="h-3 w-4/6 mb-4" />
      <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border)]">
        <Skeleton className="h-4 w-16 rounded-full" />
        <Skeleton className="h-4 w-12" />
      </div>
    </Card>
  );
}

export default function TimePage() {
  const { data, isLoading, error } = useQuery<RosterResponse>({
    queryKey: ["/api/team"],
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <header className="mb-8">
        <h1 className="text-3xl font-display font-semibold text-[var(--color-ink)] mb-2">
          Time Digital
        </h1>
        <p className="text-sm text-[var(--color-muted)] max-w-3xl leading-relaxed">
          Os 10 funcionários digitais do Provedor.ai trabalham 24/7 na cobrança do seu provedor.
          Cada um tem persona, responsabilidades, ferramentas e KPIs. Júlia valida toda
          comunicação antes do envio. Marcos é o gerente que orquestra o time.
        </p>
      </header>

      {error && (
        <Card className="p-6 border-[var(--color-danger)] bg-[var(--color-danger-bg)]">
          <p className="text-sm text-[var(--color-danger)]">
            Não foi possível carregar o time. Recarregue a página ou contate o suporte.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {isLoading
          ? Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)
          : data?.agents.map((agent) => <AgentCard key={agent.id} agent={agent} />)}
      </div>
    </div>
  );
}
