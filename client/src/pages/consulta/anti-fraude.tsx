import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import {
  ShieldAlert, AlertTriangle, DollarSign,
  CheckCircle, XCircle, ChevronDown,
  Search, Clock, Phone, Package, Users,
  RefreshCw,
} from "lucide-react";

type AntiFraudAlert = {
  id: number;
  providerId: number;
  customerId: number | null;
  consultingProviderId: number | null;
  consultingProviderName: string | null;
  customerName: string | null;
  customerCpfCnpj: string | null;
  type: string;
  severity: string;
  message: string;
  riskScore: number | null;
  riskLevel: string | null;
  riskFactors: string[] | null;
  daysOverdue: number | null;
  overdueAmount: string | null;
  equipmentNotReturned: number | null;
  equipmentValue: string | null;
  recentConsultations: number | null;
  resolved: boolean;
  status: string;
  createdAt: string | null;
  customerStatus?: string;
};

type CustomerRisk = {
  id: number;
  name: string;
  cpfCnpj: string;
  riskScore: number;
  riskLevel: string;
  riskFactors: string[];
  daysOverdue: number;
  overdueAmount: number;
  equipmentNotReturned: number;
  equipmentValue: number;
  recentConsultations: number;
  alertCount: number;
};

const fmt = (v: number | string | null | undefined): string => {
  const num = typeof v === "string" ? parseFloat(v) : (v || 0);
  return `R$ ${num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const maskCpf = (doc: string): string => {
  const d = doc.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.***.***.${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.***.***/****-${d.slice(12)}`;
  return doc;
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}min atras`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h atras`;
  const days = Math.floor(diff / 86400000);
  return `${days}d atras`;
}

export default function AntiFraudePage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: alerts = [], isLoading: alertsLoading, refetch: refetchAlerts } = useQuery<AntiFraudAlert[]>({
    queryKey: ["/api/anti-fraud/alerts"],
    staleTime: 30000,
  });

  const { data: customerRisks = [], isLoading: risksLoading } = useQuery<CustomerRisk[]>({
    queryKey: ["/api/anti-fraud/customer-risk"],
    staleTime: 60000,
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/anti-fraud/alerts/${id}/status`, { status: "resolved" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/alerts"] }); toast({ title: "Alerta resolvido" }); },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/anti-fraud/alerts/${id}/status`, { status: "dismissed" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/alerts"] }); toast({ title: "Alerta ignorado" }); },
  });

  // Filtrar alertas ativos
  const activeAlerts = alerts.filter(a => a.status === "new" || a.status === "active");
  const filteredAlerts = search
    ? activeAlerts.filter(a =>
        (a.customerName || "").toLowerCase().includes(search.toLowerCase()) ||
        (a.customerCpfCnpj || "").includes(search)
      )
    : activeAlerts;

  // KPIs
  const totalPrejuizo = activeAlerts.reduce((s, a) => s + parseFloat(a.overdueAmount || "0") + parseFloat(a.equipmentValue || "0"), 0);
  const clientesEmFuga = activeAlerts.filter(a => a.type === "defaulter_consulted").length;
  const equipRisco = activeAlerts.reduce((s, a) => s + (a.equipmentNotReturned || 0), 0);

  // Top devedores — ordenar por valor + dias
  const topDevedores = [...customerRisks]
    .sort((a, b) => b.overdueAmount - a.overdueAmount || b.daysOverdue - a.daysOverdue)
    .slice(0, 20);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-red-500" />
            Protecao Anti-Fraude
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitore clientes inadimplentes que estao tentando migrar para outros provedores
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => refetchAlerts()}>
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={AlertTriangle}
          label="Alertas Ativos"
          value={activeAlerts.length}
          color="text-red-500"
          bg="bg-red-50 dark:bg-red-950/20"
        />
        <KpiCard
          icon={Users}
          label="Clientes em Fuga"
          value={clientesEmFuga}
          sub="consultados por outros provedores"
          color="text-orange-500"
          bg="bg-orange-50 dark:bg-orange-950/20"
        />
        <KpiCard
          icon={DollarSign}
          label="Prejuizo em Risco"
          value={fmt(totalPrejuizo)}
          sub="dividas + equipamentos"
          color="text-red-600"
          bg="bg-red-50 dark:bg-red-950/20"
        />
        <KpiCard
          icon={Package}
          label="Equipamentos em Risco"
          value={equipRisco}
          color="text-amber-600"
          bg="bg-amber-50 dark:bg-amber-950/20"
        />
      </div>

      {/* Alertas em Tempo Real */}
      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h2 className="font-semibold">Alertas — Clientes Tentando Migrar</h2>
            {activeAlerts.length > 0 && (
              <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                {activeAlerts.length}
              </Badge>
            )}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por nome ou CPF..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-sm border rounded-md bg-background w-64"
            />
          </div>
        </div>

        {alertsLoading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando alertas...</div>
        ) : filteredAlerts.length === 0 ? (
          <div className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-green-400" />
            <p className="font-medium text-green-700 dark:text-green-300">Nenhum alerta ativo</p>
            <p className="text-sm text-muted-foreground mt-1">Seus clientes nao estao sendo consultados por outros provedores no momento.</p>
          </div>
        ) : (
          <div className="divide-y">
            {filteredAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} onResolve={resolveMutation.mutate} onDismiss={dismissMutation.mutate} />
            ))}
          </div>
        )}
      </Card>

      {/* Ranking dos Piores Devedores */}
      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-orange-500" />
          <h2 className="font-semibold">Ranking de Risco — Seus Clientes</h2>
          <span className="ml-auto text-xs text-muted-foreground">{topDevedores.length} clientes</span>
        </div>

        {risksLoading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando...</div>
        ) : topDevedores.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">Nenhum cliente com risco identificado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">#</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Cliente</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Divida</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Dias Atraso</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Equip.</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Consultas</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Risco</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {topDevedores.map((c, i) => (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{i + 1}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{maskCpf(c.cpfCnpj)}</p>
                    </td>
                    <td className="px-4 py-3 font-semibold text-red-600">{fmt(c.overdueAmount)}</td>
                    <td className="px-4 py-3">
                      <span className={c.daysOverdue > 90 ? "text-red-600 font-semibold" : ""}>{c.daysOverdue}d</span>
                    </td>
                    <td className="px-4 py-3">{c.equipmentNotReturned > 0 ? `${c.equipmentNotReturned} (${fmt(c.equipmentValue)})` : "—"}</td>
                    <td className="px-4 py-3">
                      {c.recentConsultations > 0 ? (
                        <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 text-xs">
                          {c.recentConsultations} consulta(s)
                        </Badge>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <RiskBadge level={c.riskLevel} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, color, bg }: {
  icon: any; label: string; value: any; sub?: string; color: string; bg: string;
}) {
  return (
    <Card className={`p-4 ${bg}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </Card>
  );
}

function AlertCard({ alert, onResolve, onDismiss }: {
  alert: AntiFraudAlert;
  onResolve: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const daysOverdue = alert.daysOverdue || 0;
  const overdueAmt = parseFloat(alert.overdueAmount || "0");
  const equipValue = parseFloat(alert.equipmentValue || "0");
  const totalRisk = overdueAmt + equipValue;

  const isContratoRecente = daysOverdue <= 90 && daysOverdue > 0;
  const isDevedorCronico = daysOverdue > 90;

  return (
    <div className="p-4 hover:bg-muted/20 transition-colors">
      <div className="flex items-start gap-3">
        {/* Indicador de severidade */}
        <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
          totalRisk > 1000 ? "bg-red-500" : totalRisk > 500 ? "bg-orange-500" : "bg-amber-500"
        }`} />

        {/* Conteudo principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{alert.customerName || "Cliente"}</span>
            <span className="font-mono text-xs text-muted-foreground">{maskCpf(alert.customerCpfCnpj || "")}</span>

            {isContratoRecente && (
              <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 text-xs">
                CONTRATO RECENTE
              </Badge>
            )}
            {isDevedorCronico && (
              <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 text-xs">
                DEVEDOR CRONICO
              </Badge>
            )}

            <span className="text-xs text-muted-foreground ml-auto">{timeAgo(alert.createdAt)}</span>
          </div>

          {/* Info principal */}
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-sm">
              <DollarSign className="w-3.5 h-3.5 text-red-500" />
              <span className="font-semibold text-red-600">{fmt(overdueAmt)}</span>
              <span className="text-muted-foreground">em aberto</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <Clock className="w-3.5 h-3.5 text-orange-500" />
              <span className={daysOverdue > 90 ? "font-semibold text-red-600" : ""}>{daysOverdue} dias</span>
              <span className="text-muted-foreground">de atraso</span>
            </div>
            {(alert.equipmentNotReturned || 0) > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <Package className="w-3.5 h-3.5 text-amber-500" />
                <span>{alert.equipmentNotReturned} equip.</span>
                <span className="text-muted-foreground">({fmt(equipValue)})</span>
              </div>
            )}
          </div>

          {/* Quem consultou */}
          {alert.consultingProviderName && (
            <div className="mt-2 text-sm text-muted-foreground flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Consultado por <span className="font-medium text-foreground">{alert.consultingProviderName}</span>
            </div>
          )}

          {/* Prejuizo estimado */}
          {totalRisk > 0 && (
            <div className="mt-2 bg-red-50 dark:bg-red-950/20 rounded px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-medium text-red-700 dark:text-red-400">PREJUIZO ESTIMADO SE MIGRAR</span>
              <span className="font-bold text-red-600">{fmt(totalRisk)}</span>
            </div>
          )}

          {/* Fatores de risco expandivel */}
          {alert.riskFactors && alert.riskFactors.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-2 text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground"
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
              {alert.riskFactors.length} indicadores de risco
            </button>
          )}
          {expanded && alert.riskFactors && (
            <div className="mt-2 space-y-1">
              {alert.riskFactors.map((f, i) => (
                <div key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                  {f}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Acoes */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => onResolve(alert.id)}>
            <CheckCircle className="w-3 h-3" /> Resolvido
          </Button>
          <Button size="sm" variant="ghost" className="gap-1 text-xs text-muted-foreground" onClick={() => onDismiss(alert.id)}>
            <XCircle className="w-3 h-3" /> Ignorar
          </Button>
          {alert.customerCpfCnpj && (
            <a href={`tel:${alert.customerCpfCnpj}`}>
              <Button size="sm" variant="default" className="gap-1 text-xs w-full bg-green-600 hover:bg-green-700">
                <Phone className="w-3 h-3" /> Ligar
              </Button>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function RiskBadge({ level }: { level: string }) {
  const config: Record<string, string> = {
    critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  };
  const labels: Record<string, string> = {
    critical: "Critico", high: "Alto", medium: "Medio", low: "Baixo",
  };
  return (
    <Badge className={`text-xs ${config[level] || config.low}`}>
      {labels[level] || level}
    </Badge>
  );
}
