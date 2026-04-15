import { useCrmStats, useCrmFunil, useCrmMetricasAgentes } from "@/hooks/crm/use-crm-stats";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Flame, ListTodo, DollarSign } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

const CLASSIFICACAO_COLORS: Record<string, string> = {
  frio: "#94a3b8",
  morno: "#fbbf24",
  quente: "#f97316",
  ultra_quente: "#ef4444",
};

const AGENTE_COLORS: Record<string, string> = {
  sofia: "#f472b6",
  leo: "#fbbf24",
  carlos: "#34d399",
  lucas: "#60a5fa",
  rafael: "#a78bfa",
};

export default function CrmDashboardTab() {
  const { data: stats, isLoading } = useCrmStats();
  const { data: funil = [] } = useCrmFunil();
  const { data: agentes = [] } = useCrmMetricasAgentes();

  if (isLoading) return <div className="text-[var(--color-muted)]">Carregando...</div>;

  const kpis = [
    { label: "Total Leads", value: stats?.totalLeads || 0, icon: Users, color: "text-blue-500" },
    { label: "Leads Quentes", value: stats?.leadsQuentes || 0, icon: Flame, color: "text-orange-500" },
    { label: "Tarefas Pendentes", value: stats?.tarefasPendentes || 0, icon: ListTodo, color: "text-yellow-500" },
    { label: "Pipeline", value: `R$ ${Number(stats?.valorPipeline || 0).toLocaleString("pt-BR")}`, icon: DollarSign, color: "text-emerald-500" },
  ];

  const classificacaoData = (stats?.porClassificacao || []).map((c: any) => ({
    name: c.classificacao, value: Number(c.count),
  }));

  const funilData = funil.map((f: any) => ({
    name: f.etapa, leads: Number(f.count), percentual: f.percentual,
  }));

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <kpi.icon className={`w-8 h-8 ${kpi.color}`} />
                <div>
                  <p className="text-2xl font-bold">{kpi.value}</p>
                  <p className="text-sm text-[var(--color-muted)]">{kpi.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Classificacao pie chart */}
        <Card>
          <CardHeader><CardTitle className="text-base">Leads por Classificacao</CardTitle></CardHeader>
          <CardContent>
            {classificacaoData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={classificacaoData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e) => `${e.name} (${e.value})`}>
                    {classificacaoData.map((entry: any) => (
                      <Cell key={entry.name} fill={CLASSIFICACAO_COLORS[entry.name] || "#64748b"} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-[var(--color-muted)] text-center py-8">Sem dados</p>
            )}
          </CardContent>
        </Card>

        {/* Funil bar chart */}
        <Card>
          <CardHeader><CardTitle className="text-base">Funil de Vendas</CardTitle></CardHeader>
          <CardContent>
            {funilData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={funilData} layout="vertical">
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: any) => [`${v} leads`, "Leads"]} />
                  <Bar dataKey="leads" fill="#60a5fa" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-[var(--color-muted)] text-center py-8">Sem dados</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agentes performance */}
      <Card>
        <CardHeader><CardTitle className="text-base">Performance dos Agentes</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {agentes.map((a: any) => (
              <div key={a.agente} className="p-3 rounded-lg border" style={{ borderColor: AGENTE_COLORS[a.agente] + "40" }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: AGENTE_COLORS[a.agente] }} />
                  <span className="font-medium capitalize">{a.agente}</span>
                </div>
                <div className="text-sm space-y-1 text-[var(--color-muted)]">
                  <p>{a.leadsAtivos} leads ativos</p>
                  <p>{a.totalMensagens} mensagens</p>
                  <p>{a.atividadesHoje} atividades hoje</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Atividades recentes */}
      <Card>
        <CardHeader><CardTitle className="text-base">Atividades Recentes</CardTitle></CardHeader>
        <CardContent>
          {(stats?.atividades || []).length > 0 ? (
            <div className="space-y-2">
              {stats.atividades.map((a: any) => (
                <div key={a.id} className="flex items-center gap-3 text-sm py-1 border-b last:border-0">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: AGENTE_COLORS[a.agente] || "#64748b" }} />
                  <span className="font-medium capitalize">{a.agente}</span>
                  <span className="text-[var(--color-muted)] flex-1">{a.descricao}</span>
                  <span className="text-xs text-[var(--color-muted)]">
                    {a.criadoEm ? new Date(a.criadoEm).toLocaleString("pt-BR") : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[var(--color-muted)] text-center py-4">Nenhuma atividade registrada</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
