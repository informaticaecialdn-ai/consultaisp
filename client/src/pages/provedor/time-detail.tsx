/**
 * Página /time/:agentId — perfil detalhado de um funcionário digital.
 *
 * Spec 007 Sub-fase B. Mostra job description (TEAM.md §4.X), KPI principal,
 * status, stack e referências canônicas. Agentes "em treinamento" exibem
 * apenas a descrição + spec planejada.
 */

import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentBadge } from "@/components/agent-badge";
import { ArrowLeft, Cpu, Workflow, FileText, AlertCircle } from "lucide-react";
import {
  AGENT_CATALOG,
  AGENT_IDS,
  type AgentId,
  type AgentProfile,
} from "@shared/types/team";

interface RosterResponse {
  agents: AgentProfile[];
}

function isValidAgentId(id: string | undefined): id is AgentId {
  return !!id && (AGENT_IDS as readonly string[]).includes(id);
}

export default function TimeDetailPage() {
  const [, params] = useRoute<{ agentId: string }>("/time/:agentId");
  const agentId = params?.agentId;

  const { data, isLoading } = useQuery<RosterResponse>({
    queryKey: ["/api/team"],
  });

  if (!isValidAgentId(agentId)) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <Card className="p-8 text-center">
          <AlertCircle className="w-12 h-12 mx-auto text-[var(--color-muted)] mb-4" />
          <h1 className="text-xl font-display font-semibold mb-2">Funcionário não encontrado</h1>
          <p className="text-sm text-[var(--color-muted)] mb-6">
            O agente "{agentId}" não está no catálogo do Provedor.ai.
          </p>
          <Link href="/time">
            <a className="text-sm font-medium text-[var(--color-brand-green-700)] hover:underline">
              ← Voltar para o Time Digital
            </a>
          </Link>
        </Card>
      </div>
    );
  }

  const catalog = AGENT_CATALOG[agentId];
  const profile = data?.agents.find((a) => a.id === agentId);

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <Link href="/time">
        <a className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] mb-6">
          <ArrowLeft className="w-4 h-4" />
          Time Digital
        </a>
      </Link>

      <header className="flex items-start gap-6 mb-8">
        <AgentBadge
          agentId={agentId}
          variant="large"
          status={profile?.status}
          className="flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-display font-semibold text-[var(--color-ink)] mb-1">
            {catalog.name}
          </h1>
          <p className="text-sm text-[var(--color-muted)] mb-3">{catalog.role}</p>
          <p className="text-sm leading-relaxed text-[var(--color-ink)]/80 max-w-3xl">
            {catalog.description}
          </p>
        </div>
      </header>

      {/* KPI grande para agentes ativos */}
      {profile?.kpi && (
        <Card className="p-6 mb-6 bg-[var(--color-brand-green-100)]/30 border-[var(--color-brand-green-700)]/20">
          <div className="flex items-baseline gap-3">
            <span className="text-5xl font-display font-semibold text-[var(--color-brand-green-900)]">
              {profile.kpi.value}
              {profile.kpi.unit === "%" && <span className="text-3xl">%</span>}
            </span>
            <div>
              <p className="text-sm font-medium text-[var(--color-ink)]">{profile.kpi.label}</p>
              {profile.kpi.unit && profile.kpi.unit !== "%" && (
                <p className="text-xs text-[var(--color-muted)]">{profile.kpi.unit}</p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Aviso para agentes em treinamento */}
      {profile?.status === "training" && (
        <Card className="p-5 mb-6 bg-[var(--color-brand-amber-100)] border-[var(--color-brand-amber-500)]/30">
          <div className="flex items-start gap-3">
            <Cpu className="w-5 h-5 text-[var(--color-brand-amber-700)] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-[var(--color-brand-amber-700)] mb-1">
                Em desenvolvimento
              </h3>
              <p className="text-xs text-[var(--color-ink)]/80 leading-relaxed">
                {catalog.name} está no roadmap canônico do Provedor.ai mas ainda não foi
                ativado. Previsão: <strong>{catalog.plannedSpec ?? "a definir"}</strong>.
                O catálogo, persona e KPIs já estão documentados no{" "}
                <code className="text-[10px] bg-white/60 px-1 py-0.5 rounded">TEAM.md</code>.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Metadados técnicos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card className="p-5">
          <h3 className="text-xs uppercase tracking-wider font-semibold text-[var(--color-muted)] mb-3 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5" />
            Stack técnico
          </h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted)]">Modelo</dt>
              <dd className="font-medium">{catalog.model}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted)]">Hospedagem canônica</dt>
              <dd className="font-medium">Anthropic Platform</dd>
            </div>
            {catalog.currentStack !== catalog.stack && (
              <div className="flex justify-between">
                <dt className="text-[var(--color-muted)]">Em execução</dt>
                <dd className="font-medium text-[var(--color-brand-amber-700)]">
                  Direct API (legacy · migrar Spec 008.6)
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted)]">ID interno</dt>
              <dd className="font-mono text-xs">{catalog.id}</dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5">
          <h3 className="text-xs uppercase tracking-wider font-semibold text-[var(--color-muted)] mb-3 flex items-center gap-1.5">
            <Workflow className="w-3.5 h-3.5" />
            Operação
          </h3>
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : profile ? (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--color-muted)]">Status no seu tenant</dt>
                <dd className="font-medium capitalize">{profile.status}</dd>
              </div>
              {profile.kpi && (
                <div className="flex justify-between">
                  <dt className="text-[var(--color-muted)]">KPI do mês</dt>
                  <dd className="font-medium">
                    {profile.kpi.value} {profile.kpi.unit ?? ""}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">Sem dados ainda.</p>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-[var(--color-muted)] mb-3 flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" />
          Referência canônica
        </h3>
        <p className="text-xs text-[var(--color-muted)] leading-relaxed">
          Persona, ferramentas, SOPs e KPIs detalhados em{" "}
          <code className="text-[10px] bg-[var(--color-tag-bg)] px-1.5 py-0.5 rounded">
            C:\Provedor.ai\Ecossistema\TEAM.md
          </code>{" "}
          §4.{AGENT_IDS.indexOf(agentId) + 1}.
        </p>
      </Card>
    </div>
  );
}
