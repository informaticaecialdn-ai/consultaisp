import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import {
  ShieldAlert, AlertTriangle, DollarSign,
  CheckCircle, XCircle,
  Search, Clock, Phone, Package, Users,
  RefreshCw, Wifi, FileText,
} from "lucide-react";

type AntiFraudAlert = {
  id: number;
  providerId: number;
  customerId: number | null;
  customerProviderId?: number;
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

const fmtCpf = (doc: string): string => {
  const d = doc.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
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

// Custo de instalacao padrao (configuravel futuramente pelo provedor)
const CUSTO_INSTALACAO = 150;
const CUSTO_EQUIP_ESTIMADO = 290;

export default function AntiFraudePage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "resolved">("active");

  const { data: alerts = [], isLoading: alertsLoading, refetch } = useQuery<AntiFraudAlert[]>({
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

  const activeAlerts = alerts.filter(a => a.status === "new" || a.status === "active");
  const resolvedAlerts = alerts.filter(a => a.status === "resolved" || a.status === "dismissed");
  const displayAlerts = filter === "active" ? activeAlerts : filter === "resolved" ? resolvedAlerts : alerts;

  const filtered = search
    ? displayAlerts.filter(a =>
        (a.customerName || "").toLowerCase().includes(search.toLowerCase()) ||
        (a.customerCpfCnpj || "").includes(search)
      )
    : displayAlerts;

  // KPIs
  const totalDivida = activeAlerts.reduce((s, a) => s + parseFloat(a.overdueAmount || "0"), 0);
  const totalEquip = activeAlerts.length * CUSTO_EQUIP_ESTIMADO;
  const totalInstalacao = activeAlerts.length * CUSTO_INSTALACAO;
  const totalPrejuizo = totalDivida + totalEquip + totalInstalacao;

  // Top devedores
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
            Clientes inadimplentes sendo consultados por outros provedores
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 bg-red-50 dark:bg-red-950/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-xs font-medium text-muted-foreground uppercase">Alertas Ativos</span>
          </div>
          <p className="text-2xl font-bold text-red-500">{activeAlerts.length}</p>
        </Card>
        <Card className="p-4 bg-orange-50 dark:bg-orange-950/20">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-medium text-muted-foreground uppercase">Dividas em Risco</span>
          </div>
          <p className="text-2xl font-bold text-orange-500">{fmt(totalDivida)}</p>
        </Card>
        <Card className="p-4 bg-amber-50 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-medium text-muted-foreground uppercase">Equipamentos</span>
          </div>
          <p className="text-2xl font-bold text-amber-600">{activeAlerts.length}</p>
          <p className="text-xs text-muted-foreground">{fmt(totalEquip)} (valor estimado)</p>
        </Card>
        <Card className="p-4 bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <span className="text-xs font-medium text-muted-foreground uppercase">Prejuizo Total Estimado</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{fmt(totalPrejuizo)}</p>
          <p className="text-xs text-muted-foreground">divida + equip + instalacao</p>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant={filter === "active" ? "default" : "outline"} size="sm" onClick={() => setFilter("active")}>
            Ativos ({activeAlerts.length})
          </Button>
          <Button variant={filter === "resolved" ? "default" : "outline"} size="sm" onClick={() => setFilter("resolved")}>
            Resolvidos ({resolvedAlerts.length})
          </Button>
          <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>
            Todos ({alerts.length})
          </Button>
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

      {/* Cards de Alertas */}
      {alertsLoading ? (
        <div className="p-8 text-center text-muted-foreground">Carregando alertas...</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center">
          <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-green-400" />
          <p className="font-medium text-green-700 dark:text-green-300">Nenhum alerta</p>
          <p className="text-sm text-muted-foreground mt-1">Seus clientes nao estao sendo consultados por outros provedores.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((alert) => (
            <AlertCard key={alert.id} alert={alert} onResolve={resolveMutation.mutate} onDismiss={dismissMutation.mutate} />
          ))}
        </div>
      )}

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
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Atraso</th>
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
                      <p className="text-xs text-muted-foreground font-mono">{fmtCpf(c.cpfCnpj)}</p>
                    </td>
                    <td className="px-4 py-3 font-semibold text-red-600">{fmt(c.overdueAmount)}</td>
                    <td className="px-4 py-3">
                      <span className={c.daysOverdue > 90 ? "text-red-600 font-semibold" : ""}>{c.daysOverdue}d</span>
                    </td>
                    <td className="px-4 py-3">
                      {c.recentConsultations > 0 ? (
                        <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 text-xs">
                          {c.recentConsultations}x
                        </Badge>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3"><RiskBadge level={c.riskLevel} /></td>
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

function AlertCard({ alert, onResolve, onDismiss }: {
  alert: AntiFraudAlert;
  onResolve: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const daysOverdue = alert.daysOverdue || 0;
  const overdueAmt = parseFloat(alert.overdueAmount || "0");
  const equipValue = parseFloat(alert.equipmentValue || "0") || CUSTO_EQUIP_ESTIMADO;
  const totalPrejuizo = overdueAmt + equipValue + CUSTO_INSTALACAO;
  const isResolved = alert.status === "resolved" || alert.status === "dismissed";

  // Score simplificado do cliente (0-100)
  const score = Math.max(0, 100 - Math.min(daysOverdue / 3, 40) - Math.min(overdueAmt / 50, 40) - (daysOverdue < 90 ? 20 : 0));

  return (
    <Card className={`overflow-hidden ${isResolved ? "opacity-60" : ""}`}>
      {/* Header do card */}
      <div className={`px-4 py-2 flex items-center justify-between ${
        daysOverdue > 90 ? "bg-red-500 text-white" :
        daysOverdue > 30 ? "bg-orange-500 text-white" :
        "bg-amber-500 text-white"
      }`}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span className="font-semibold text-sm">
            {daysOverdue <= 90 ? "CONTRATO RECENTE" : "DEVEDOR CRONICO"}
          </span>
        </div>
        <span className="text-xs opacity-90">{timeAgo(alert.createdAt)}</span>
      </div>

      <div className="p-4 space-y-3">
        {/* Nome + CPF (dados completos — cliente proprio) */}
        <div>
          <p className="font-bold text-lg">{alert.customerName || "Cliente"}</p>
          <p className="font-mono text-sm text-muted-foreground">{alert.customerCpfCnpj ? fmtCpf(alert.customerCpfCnpj) : ""}</p>
        </div>

        {/* Info do contrato */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <DollarSign className="w-3 h-3" />
              Divida
            </div>
            <p className="font-bold text-red-600">{fmt(overdueAmt)}</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Clock className="w-3 h-3" />
              Dias de Atraso
            </div>
            <p className={`font-bold ${daysOverdue > 90 ? "text-red-600" : "text-orange-600"}`}>{daysOverdue} dias</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Package className="w-3 h-3" />
              Equipamento
            </div>
            <p className="font-bold">{alert.equipmentNotReturned || 1} un.</p>
            <p className="text-xs text-muted-foreground">{fmt(equipValue)} (estimado)</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <ShieldAlert className="w-3 h-3" />
              Score
            </div>
            <p className={`font-bold ${score < 30 ? "text-red-600" : score < 60 ? "text-orange-600" : "text-green-600"}`}>
              {Math.round(score)}/100
            </p>
            <p className="text-xs text-muted-foreground">
              {score < 30 ? "Critico" : score < 60 ? "Alto risco" : "Moderado"}
            </p>
          </div>
        </div>

        {/* Quem consultou */}
        {alert.consultingProviderName && (
          <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/20 rounded-lg px-3 py-2">
            <Users className="w-4 h-4 text-blue-500" />
            <span className="text-sm">Consultado por</span>
            <span className="font-semibold text-sm">{alert.consultingProviderName}</span>
          </div>
        )}

        {/* Prejuizo estimado */}
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase mb-2">Prejuizo Estimado se Migrar</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Divida</p>
              <p className="font-semibold text-sm">{fmt(overdueAmt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Equipamento</p>
              <p className="font-semibold text-sm">{fmt(equipValue)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Instalacao</p>
              <p className="font-semibold text-sm">{fmt(CUSTO_INSTALACAO)}</p>
            </div>
          </div>
          <div className="border-t border-red-200 dark:border-red-800 mt-2 pt-2 text-center">
            <p className="text-lg font-bold text-red-600">{fmt(totalPrejuizo)}</p>
          </div>
        </div>

        {/* Acoes */}
        {!isResolved && (
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" className="gap-1.5 flex-1 bg-green-600 hover:bg-green-700" onClick={() => onResolve(alert.id)}>
              <CheckCircle className="w-3.5 h-3.5" /> Resolvido
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 flex-1" onClick={() => onDismiss(alert.id)}>
              <XCircle className="w-3.5 h-3.5" /> Ignorar
            </Button>
            <a href={`tel:${(alert.customerCpfCnpj || "").replace(/\D/g, "")}`} className="flex-1">
              <Button size="sm" variant="outline" className="gap-1.5 w-full border-green-500 text-green-600 hover:bg-green-50">
                <Phone className="w-3.5 h-3.5" /> Ligar
              </Button>
            </a>
          </div>
        )}
        {isResolved && (
          <div className="text-center py-1">
            <Badge variant="outline" className="text-xs">{alert.status === "resolved" ? "Resolvido" : "Ignorado"}</Badge>
          </div>
        )}
      </div>
    </Card>
  );
}

function RiskBadge({ level }: { level: string }) {
  const config: Record<string, string> = {
    critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  };
  const labels: Record<string, string> = { critical: "Critico", high: "Alto", medium: "Medio", low: "Baixo" };
  return <Badge className={`text-xs ${config[level] || config.low}`}>{labels[level] || level}</Badge>;
}
