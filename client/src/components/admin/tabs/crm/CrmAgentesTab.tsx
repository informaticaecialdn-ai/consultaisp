import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Users, MessageSquare, Activity, ArrowRightLeft } from "lucide-react";

const AGENTE_COLORS: Record<string, string> = {
  sofia: "#f472b6",
  leo: "#fbbf24",
  carlos: "#34d399",
  lucas: "#60a5fa",
  rafael: "#a78bfa",
};

const AGENTE_ROLES: Record<string, string> = {
  sofia: "Marketing",
  leo: "Copywriter",
  carlos: "Pre-Vendas/SDR",
  lucas: "Vendas",
  rafael: "Closer",
};

const AGENTE_MODELS: Record<string, string> = {
  sofia: "Sonnet 4.6",
  leo: "Opus 4.6",
  carlos: "Sonnet 4.6",
  lucas: "Opus 4.6",
  rafael: "Opus 4.6",
};

export default function CrmAgentesTab() {
  const { data: agentes = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/metricas/agentes"],
    refetchInterval: 15000,
  });

  const { data: monitorData = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/monitor"],
    refetchInterval: 15000,
  });

  const { data: atividades = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/atividades?limit=30"],
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-6">
      {/* Agent cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {["sofia", "leo", "carlos", "lucas", "rafael"].map((key) => {
          const stats = agentes.find((a: any) => a.agente === key);
          const monitor = monitorData.find((m: any) => m.agente === key);
          return (
            <Card key={key} className="border-t-4" style={{ borderTopColor: AGENTE_COLORS[key] }}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: AGENTE_COLORS[key] }}
                  >
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-sm capitalize">{key}</CardTitle>
                    <p className="text-xs text-[var(--color-muted)]">{AGENTE_ROLES[key]}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge variant="secondary" className="text-xs">{AGENTE_MODELS[key]}</Badge>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    <Users className="w-3 h-3 text-[var(--color-muted)]" />
                    <span>{stats?.leadsAtivos || 0} leads</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3 text-[var(--color-muted)]" />
                    <span>{stats?.totalMensagens || 0} msgs</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Activity className="w-3 h-3 text-[var(--color-muted)]" />
                    <span>{stats?.atividadesHoje || 0} hoje</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowRightLeft className="w-3 h-3 text-[var(--color-muted)]" />
                    <span>{stats?.handoffsEnviados || 0} handoffs</span>
                  </div>
                </div>
                {stats?.ultimaAtividade && (
                  <p className="text-xs text-[var(--color-muted)]">
                    Ultima: {new Date(stats.ultimaAtividade).toLocaleString("pt-BR")}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Activity feed */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-base">Feed de Atividades</CardTitle>
            <Badge variant="secondary" className="text-xs">Auto-refresh 15s</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {atividades.length === 0 ? (
            <p className="text-center text-[var(--color-muted)] py-4">Nenhuma atividade registrada</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {atividades.map((a: any) => (
                <div key={a.id} className="flex items-start gap-3 text-sm py-2 border-b last:border-0">
                  <div
                    className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                    style={{ backgroundColor: AGENTE_COLORS[a.agente] || "#64748b" }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize">{a.agente}</span>
                      <Badge variant="outline" className="text-xs">{a.tipo}</Badge>
                    </div>
                    <p className="text-[var(--color-muted)] truncate">{a.descricao}</p>
                    {a.scoreAntes !== null && a.scoreDepois !== null && a.scoreAntes !== a.scoreDepois && (
                      <p className="text-xs mt-0.5">
                        Score: {a.scoreAntes} → {a.scoreDepois}
                        <span className={a.scoreDepois > a.scoreAntes ? "text-emerald-500 ml-1" : "text-red-500 ml-1"}>
                          ({a.scoreDepois > a.scoreAntes ? "+" : ""}{a.scoreDepois - a.scoreAntes})
                        </span>
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-[var(--color-muted)] flex-shrink-0">
                    {a.criadoEm ? new Date(a.criadoEm).toLocaleString("pt-BR") : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
