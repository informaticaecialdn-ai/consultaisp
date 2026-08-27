import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2, ArrowUpDown, Clock,
  RefreshCw, CheckCircle, Wifi, WifiOff,
} from "lucide-react";
import { STALE_DASHBOARD, STALE_LISTS } from "@/lib/queryClient";
import { PLAN_LABELS } from "../constants";

export default function VisaoGeralTab() {
  const [, navigate] = useLocation();

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/admin/stats"],
    staleTime: STALE_DASHBOARD,
  });
  const { data: allProviders = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    staleTime: STALE_LISTS,
  });
  const { data: planHistory = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/plan-history"],
  });
  const { data: chatThreads = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/chat/threads"],
    refetchInterval: 10000,
  });
  const { data: autoSyncStatus, isLoading: syncLoading } = useQuery<any>({
    queryKey: ["/api/admin/auto-sync/status"],
    refetchInterval: 30000,
  });

  const totalUnread = chatThreads.reduce((sum: number, t: any) => sum + (t.unreadCount || 0), 0);

  // Cards de metrica no padrao Bureau: rotulo mono em caixa alta, numero mono
  // tabular em ink. Sem icone com gradiente — o dado e o protagonista.
  const STAT_CARDS = [
    { label: "Provedores", value: stats?.providers ?? "—", sub: `${stats?.activeProviders ?? 0} ativos` },
    { label: "Usuarios", value: stats?.users ?? "—", sub: "cadastrados" },
    { label: "Clientes", value: stats?.customers ?? "—", sub: "em todos os provedores" },
    { label: "Consultas ISP", value: stats?.ispConsultations ?? "—", sub: "total realizado" },
    { label: "Consultas SPC", value: stats?.spcConsultations ?? "—", sub: "total realizado" },
    { label: "Mensagens novas", value: totalUnread, sub: "aguardando resposta" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {STAT_CARDS.map((s) => (
          <Card key={s.label} className="px-3.5 py-3" data-testid={`stat-card-${s.label.toLowerCase().replace(/ /g, "-")}`}>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--color-muted)]">
              {s.label}
            </p>
            <p className="font-mono text-[21px] font-medium tracking-[-0.02em] tabular-nums text-[var(--color-ink)] mt-1 leading-none">
              {s.value}
            </p>
            <p className="text-[11px] text-[var(--color-muted)] mt-1">{s.sub}</p>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
            <Building2 className="w-4 h-4" />Provedores Recentes
          </h3>
          <div className="space-y-2">
            {allProviders.slice(0, 5).map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 py-1.5 border-b last:border-0" data-testid={`provider-row-${p.id}`}>
                <div className="w-8 h-8 rounded bg-[var(--color-tag-bg)] flex items-center justify-center text-sm font-semibold text-[var(--color-ink)]">
                  {p.name?.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="font-mono text-[11px] text-[var(--color-muted)] truncate">{p.subdomain}.consultaisp.com.br</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex font-mono text-[10px] font-medium tracking-[0.04em] px-1.5 py-0.5 rounded ${PLAN_LABELS[p.plan]?.color || "bg-[var(--color-tag-bg)] text-[var(--color-muted)]"}`}>
                    {PLAN_LABELS[p.plan]?.label ?? p.plan}
                  </span>
                  <span className={`w-2 h-2 rounded-full ${p.status === "active" ? "bg-[var(--color-success)]" : "bg-[var(--color-muted)]"}`} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
            <ArrowUpDown className="w-4 h-4" />Historico de Planos
          </h3>
          <div className="space-y-2">
            {planHistory.slice(0, 5).map((h: any) => (
              <div key={h.id} className="py-1.5 border-b last:border-0 text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-[var(--color-muted)]" />
                  <span className="text-xs text-[var(--color-muted)]">
                    {new Date(h.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                {h.oldPlan && h.newPlan ? (
                  <p className="text-xs mt-0.5">
                    Plano: <strong>{PLAN_LABELS[h.oldPlan]?.label}</strong> → <strong>{PLAN_LABELS[h.newPlan]?.label}</strong>
                  </p>
                ) : (
                  <p className="text-xs mt-0.5">
                    Creditos: ISP <strong>+{h.ispCreditsAdded}</strong> / SPC <strong>+{h.spcCreditsAdded}</strong>
                  </p>
                )}
                {h.notes && <p className="text-xs text-[var(--color-muted)] truncate">{h.notes}</p>}
              </div>
            ))}
            {planHistory.length === 0 && (
              <p className="text-sm text-[var(--color-muted)] py-4 text-center">Nenhum historico ainda</p>
            )}
          </div>
        </Card>
      </div>

      {/* Sincronizacao Auto — mesmos cards de metrica do topo; o estado do
          scheduler e um badge retangular semantico, nao um enfeite colorido. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="px-3.5 py-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--color-muted)]">
            Scheduler ERP
          </p>
          <div className="mt-1.5">
            {autoSyncStatus?.scheduler?.running ? (
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium tracking-[0.04em] px-1.5 py-0.5 rounded bg-[var(--color-gold-bg)] text-[var(--color-gold)]">
                <RefreshCw className="w-3 h-3 animate-spin" />Executando
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium tracking-[0.04em] px-1.5 py-0.5 rounded bg-[var(--color-success-bg)] text-[var(--color-success)]">
                <CheckCircle className="w-3 h-3" />Aguardando
              </span>
            )}
          </div>
        </Card>
        <Card className="px-3.5 py-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--color-muted)]">
            Ultima execucao
          </p>
          <p className="font-mono text-[14px] font-medium tabular-nums text-[var(--color-ink)] mt-1.5">
            {autoSyncStatus?.scheduler?.lastRun
              ? new Date(autoSyncStatus.scheduler.lastRun).toLocaleString("pt-BR")
              : "Nunca"}
          </p>
        </Card>
        <Card className="px-3.5 py-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--color-muted)]">
            Total de ciclos
          </p>
          <p className="font-mono text-[21px] font-medium tracking-[-0.02em] tabular-nums text-[var(--color-ink)] mt-1 leading-none">
            {autoSyncStatus?.scheduler?.totalRuns ?? 0}
          </p>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Wifi className="w-4 h-4 text-[var(--color-muted)]" />
            Integracoes Ativas ({autoSyncStatus?.integrations?.length ?? 0} provedores)
          </h3>
        </div>
        {syncLoading ? (
          <div className="p-8 text-center text-[var(--color-muted)] text-sm">Carregando...</div>
        ) : !autoSyncStatus?.integrations?.length ? (
          <div className="p-8 text-center">
            <WifiOff className="w-10 h-10 mx-auto text-[var(--color-muted)]/30 mb-2" />
            <p className="text-sm text-[var(--color-muted)]">Nenhuma integracao ativa com credenciais configuradas</p>
          </div>
        ) : (
          <div className="divide-y">
            {autoSyncStatus.integrations.map((intg: any) => {
              const statusColors: Record<string, string> = {
                success: "bg-[var(--color-success-bg)] text-[var(--color-success)]",
                error: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
                partial: "bg-[var(--color-gold-bg)] text-[var(--color-gold)]",
              };
              const statusColor = statusColors[intg.lastSyncStatus] || "bg-[var(--color-tag-bg)] text-[var(--color-muted)]";
              return (
                <div key={`${intg.providerId}-${intg.erpSource}`} className="p-4 flex items-center gap-4" data-testid={`sync-row-${intg.providerId}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{intg.providerName}</span>
                      <Badge variant="outline" className="text-xs uppercase font-mono">{intg.erpSource}</Badge>
                      {intg.lastSyncStatus && (
                        <Badge className={`text-xs ${statusColor}`}>{intg.lastSyncStatus}</Badge>
                      )}
                      {intg.isDue && (
                        <Badge className="text-xs bg-[var(--color-brand-bg)] text-[var(--color-brand)]">Vencido</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-[var(--color-muted)] flex-wrap">
                      <span>
                        {intg.lastSyncAt
                          ? `Ultima sync: ${new Date(intg.lastSyncAt).toLocaleString("pt-BR")}`
                          : "Nunca sincronizado"}
                      </span>
                      <span className="text-[var(--color-success)]">{intg.totalSynced} sincronizados</span>
                      {intg.totalErrors > 0 && <span className="text-[var(--color-danger)]">{intg.totalErrors} erros</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
