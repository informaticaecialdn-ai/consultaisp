import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2, Users, User, Search, BarChart3, MessageSquare, ArrowUpDown, Clock,
  ServerCog, Timer, CalendarClock, RefreshCw, CheckCircle, Wifi, WifiOff,
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

  const STAT_CARDS = [
    { label: "Provedores", value: stats?.providers ?? "-", icon: Building2, color: "from-blue-500 to-blue-600", sub: `${stats?.activeProviders ?? 0} ativos` },
    { label: "Usuarios", value: stats?.users ?? "-", icon: Users, color: "from-indigo-500 to-indigo-600", sub: "cadastrados" },
    { label: "Clientes", value: stats?.customers ?? "-", icon: User, color: "from-purple-500 to-purple-600", sub: "em todos os provedores" },
    { label: "Consultas ISP", value: stats?.ispConsultations ?? "-", icon: Search, color: "from-emerald-500 to-emerald-600", sub: "total realizado" },
    { label: "Consultas SPC", value: stats?.spcConsultations ?? "-", icon: BarChart3, color: "from-violet-500 to-violet-600", sub: "total realizado" },
    { label: "Mensagens novas", value: totalUnread, icon: MessageSquare, color: "from-rose-500 to-rose-600", sub: "aguardando resposta" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {STAT_CARDS.map((s) => (
          <Card key={s.label} className="p-4" data-testid={`stat-card-${s.label.toLowerCase().replace(/ /g, "-")}`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded ${s.color} flex items-center justify-center`}>
                <s.icon className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-[var(--color-muted)]">{s.label}</p>
                <p className="text-xs text-[var(--color-muted)]/70">{s.sub}</p>
              </div>
            </div>
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
                <div className="w-8 h-8 rounded bg-[var(--color-navy-bg)] dark:bg-blue-900 flex items-center justify-center text-sm font-bold text-[var(--color-navy)] dark:text-blue-300">
                  {p.name?.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-[var(--color-muted)]">{p.subdomain}.consultaisp.com.br</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`text-xs ${PLAN_LABELS[p.plan]?.color || ""}`}>
                    {PLAN_LABELS[p.plan]?.label}
                  </Badge>
                  <span className={`w-2 h-2 rounded-full ${p.status === "active" ? "bg-emerald-500" : "bg-gray-400"}`} />
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

      {/* Sincronizacao Auto widget (merged from old sincronizacao tab) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4 border-l-4 border-l-cyan-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded from-cyan-500 to-teal-600 flex items-center justify-center">
              <ServerCog className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-[var(--color-muted)]">Scheduler ERP</p>
              {autoSyncStatus?.scheduler?.running ? (
                <Badge className="bg-amber-100 text-[var(--color-gold)] gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" />Executando
                </Badge>
              ) : (
                <Badge className="bg-emerald-100 text-emerald-700 gap-1">
                  <CheckCircle className="w-3 h-3" />Aguardando
                </Badge>
              )}
            </div>
          </div>
        </Card>
        <Card className="p-4 border-l-4 border-l-blue-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded from-blue-500 to-indigo-600 flex items-center justify-center">
              <Timer className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-[var(--color-muted)]">Ultima execucao</p>
              <p className="text-sm font-semibold">
                {autoSyncStatus?.scheduler?.lastRun
                  ? new Date(autoSyncStatus.scheduler.lastRun).toLocaleString("pt-BR")
                  : "Nunca"}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4 border-l-4 border-l-violet-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded from-violet-500 to-purple-600 flex items-center justify-center">
              <CalendarClock className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-[var(--color-muted)]">Total de ciclos</p>
              <p className="text-2xl font-bold">{autoSyncStatus?.scheduler?.totalRuns ?? 0}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Wifi className="w-4 h-4 text-cyan-500" />
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
                success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
                error: "bg-red-100 text-[var(--color-danger)] dark:bg-red-900 dark:text-red-300",
                partial: "bg-amber-100 text-[var(--color-gold)] dark:bg-amber-900 dark:text-amber-300",
              };
              const statusColor = statusColors[intg.lastSyncStatus] || "bg-gray-100 text-gray-600";
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
                        <Badge className="text-xs bg-[var(--color-navy-bg)] text-[var(--color-navy)]">Vencido</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-[var(--color-muted)] flex-wrap">
                      <span>
                        {intg.lastSyncAt
                          ? `Ultima sync: ${new Date(intg.lastSyncAt).toLocaleString("pt-BR")}`
                          : "Nunca sincronizado"}
                      </span>
                      <span className="text-emerald-600">{intg.totalSynced} sincronizados</span>
                      {intg.totalErrors > 0 && <span className="text-red-500">{intg.totalErrors} erros</span>}
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
