import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import {
  ShieldAlert,
  Bell,
  BarChart3,
  Shuffle,
  BrainCircuit,
  BookOpen,
  Settings,
  CheckCircle,
  RefreshCw,
  AlertTriangle,
  DollarSign,
  Calendar,
  Package,
  Phone,
  XCircle,
  Eye,
  ChevronDown,
  ChevronUp,
  Search,
  Users,
  TrendingUp,
  Zap,
  Shield,
  Target,
  ArrowRight,
  Info,
  Lock,
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

function formatCpfCnpj(doc: string): string {
  const digits = doc.replace(/\D/g, "");
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return doc;
}

function formatCurrency(value: number | string | null | undefined): string {
  const num = typeof value === "string" ? parseFloat(value) : (value || 0);
  return `R$ ${num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR") + " as " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function RiskLevelBadge({ level, score }: { level: string; score?: number | null }) {
  const config: Record<string, { label: string; className: string }> = {
    critical: { label: "Critico", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
    high: { label: "Alto", className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
    medium: { label: "Medio", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    low: { label: "Baixo", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
  };
  const c = config[level] || config.low;
  return (
    <Badge className={`${c.className} font-semibold`} data-testid={`badge-risk-${level}`}>
      {c.label}{score !== undefined && score !== null ? ` (${score})` : ""}
    </Badge>
  );
}

function RiskDot({ level }: { level: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-emerald-500",
  };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[level] || colors.low}`} />;
}

function StatCard({ label, value, color, icon: Icon }: { label: string; value: number; color: string; icon: any }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-2xl font-bold" data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    </Card>
  );
}

function AlertCard({ alert, onResolve, onDismiss }: {
  alert: AntiFraudAlert;
  onResolve: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const riskColors: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-emerald-500",
  };

  const riskBg: Record<string, string> = {
    critical: "bg-red-50 dark:bg-red-950/20",
    high: "bg-orange-50 dark:bg-orange-950/20",
    medium: "bg-amber-50 dark:bg-amber-950/20",
    low: "bg-emerald-50 dark:bg-emerald-950/20",
  };

  const level = alert.riskLevel || "low";

  return (
    <Card className="overflow-hidden" data-testid={`alert-card-${alert.id}`}>
      <div className="flex">
        <div className={`w-1.5 flex-shrink-0 ${riskColors[level]}`} />
        <div className="flex-1 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <RiskLevelBadge level={level} score={alert.riskScore} />
              {alert.status === "new" && (
                <Badge variant="outline" className="text-xs">Novo</Badge>
              )}
              {alert.status === "resolved" && (
                <Badge className="bg-emerald-100 text-emerald-800 text-xs">Resolvido</Badge>
              )}
              {alert.status === "dismissed" && (
                <Badge variant="secondary" className="text-xs">Ignorado</Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{formatDateTime(alert.createdAt)}</span>
          </div>

          <div className="space-y-1">
            <p className="font-semibold" data-testid={`alert-customer-${alert.id}`}>
              {alert.customerName || "Cliente desconhecido"}
            </p>
            {alert.customerCpfCnpj && (
              <p className="text-sm text-muted-foreground">
                {formatCpfCnpj(alert.customerCpfCnpj)}
              </p>
            )}
            {alert.consultingProviderName && (
              <p className="text-sm">
                Consultado por: <span className="font-medium">{alert.consultingProviderName}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-4 flex-wrap text-sm">
            {(alert.overdueAmount && parseFloat(alert.overdueAmount) > 0) && (
              <span className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
                Valor em aberto: <span className="font-semibold">{formatCurrency(alert.overdueAmount)}</span>
              </span>
            )}
            {(alert.daysOverdue !== null && alert.daysOverdue > 0) && (
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                Dias em atraso: <span className="font-semibold">{alert.daysOverdue}</span>
              </span>
            )}
            {(alert.equipmentNotReturned !== null && alert.equipmentNotReturned > 0) && (
              <span className="flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-muted-foreground" />
                Equipamentos: <span className="font-semibold">{alert.equipmentNotReturned} ({formatCurrency(alert.equipmentValue)})</span>
              </span>
            )}
          </div>

          {alert.riskFactors && alert.riskFactors.length > 0 && (
            <div>
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                data-testid={`button-toggle-factors-${alert.id}`}
              >
                Fatores de Risco ({alert.riskFactors.length})
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {expanded && (
                <ul className="mt-2 space-y-1 text-sm pl-1">
                  {alert.riskFactors.map((factor, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <RiskDot level={level} />
                      <span>{factor}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {alert.status === "new" && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="default"
                className="gap-1.5"
                onClick={() => onResolve(alert.id)}
                data-testid={`button-resolve-${alert.id}`}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Resolver
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => onDismiss(alert.id)}
                data-testid={`button-dismiss-${alert.id}`}
              >
                <XCircle className="w-3.5 h-3.5" />
                Ignorar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                data-testid={`button-contact-${alert.id}`}
              >
                <Phone className="w-3.5 h-3.5" />
                Contatar
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function AlertasTab({ alerts, onResolve, onDismiss }: {
  alerts: AntiFraudAlert[];
  onResolve: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const [filter, setFilter] = useState<"all" | "new" | "resolved" | "dismissed">("all");
  const [search, setSearch] = useState("");

  const filtered = alerts.filter(a => {
    if (filter === "new" && a.status !== "new") return false;
    if (filter === "resolved" && a.status !== "resolved") return false;
    if (filter === "dismissed" && a.status !== "dismissed") return false;
    if (search) {
      const q = search.toLowerCase();
      return (a.customerName?.toLowerCase().includes(q) ||
        a.customerCpfCnpj?.includes(q) ||
        a.consultingProviderName?.toLowerCase().includes(q));
    }
    return true;
  });

  const newCount = alerts.filter(a => a.status === "new").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
            data-testid="filter-all"
          >
            Todos ({alerts.length})
          </Button>
          <Button
            size="sm"
            variant={filter === "new" ? "default" : "outline"}
            onClick={() => setFilter("new")}
            data-testid="filter-new"
          >
            Novos ({newCount})
          </Button>
          <Button
            size="sm"
            variant={filter === "resolved" ? "default" : "outline"}
            onClick={() => setFilter("resolved")}
            data-testid="filter-resolved"
          >
            Resolvidos ({alerts.filter(a => a.status === "resolved").length})
          </Button>
          <Button
            size="sm"
            variant={filter === "dismissed" ? "default" : "outline"}
            onClick={() => setFilter("dismissed")}
            data-testid="filter-dismissed"
          >
            Ignorados ({alerts.filter(a => a.status === "dismissed").length})
          </Button>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou CPF..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-alerts"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-6">
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2" data-testid="text-tudo-certo">
              {filter === "all" ? "Nenhum alerta encontrado" : `Nenhum alerta ${filter === "new" ? "novo" : filter === "resolved" ? "resolvido" : "ignorado"}`}
            </h3>
            <p className="text-muted-foreground text-sm">
              {filter === "all" && !search
                ? "Realize consultas ISP para gerar alertas automaticamente."
                : "Tente ajustar o filtro ou busca."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onResolve={onResolve}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreRiscoTab({ customerRisk, isLoading }: { customerRisk: CustomerRisk[]; isLoading: boolean }) {
  const criticalCount = customerRisk.filter(c => c.riskLevel === "critical").length;
  const highCount = customerRisk.filter(c => c.riskLevel === "high").length;
  const mediumCount = customerRisk.filter(c => c.riskLevel === "medium").length;
  const lowCount = customerRisk.filter(c => c.riskLevel === "low").length;
  const avgScore = customerRisk.length > 0
    ? Math.round(customerRisk.reduce((s, c) => s + c.riskScore, 0) / customerRisk.length)
    : 0;

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="text-center py-12 text-muted-foreground">
          <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin opacity-50" />
          <p>Carregando ranking de risco...</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Critico" value={criticalCount} color="bg-red-500" icon={AlertTriangle} />
        <StatCard label="Alto" value={highCount} color="bg-orange-500" icon={TrendingUp} />
        <StatCard label="Medio" value={mediumCount} color="bg-amber-500" icon={Eye} />
        <StatCard label="Baixo" value={lowCount} color="bg-emerald-500" icon={CheckCircle} />
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-blue-500">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="stat-score-medio">{avgScore}</p>
              <p className="text-xs text-muted-foreground">Score Medio</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b">
          <h3 className="font-semibold flex items-center gap-2">
            <Target className="w-4 h-4" />
            Top Clientes em Risco
          </h3>
        </div>
        {customerRisk.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            Nenhum cliente com risco identificado.
          </div>
        ) : (
          <div className="divide-y">
            {customerRisk.slice(0, 20).map((customer, idx) => (
              <div
                key={customer.id}
                className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors"
                data-testid={`risk-customer-${customer.id}`}
              >
                <span className="text-sm font-bold text-muted-foreground w-6">#{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{customer.name}</p>
                  <p className="text-xs text-muted-foreground">{formatCpfCnpj(customer.cpfCnpj)}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold">Score: {customer.riskScore}</p>
                    <RiskLevelBadge level={customer.riskLevel} />
                  </div>
                  <Separator orientation="vertical" className="h-8" />
                  <div className="text-right text-sm">
                    <p className="font-medium">{formatCurrency(customer.overdueAmount)}</p>
                    <p className="text-xs text-muted-foreground">{customer.daysOverdue}d atraso</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function PadroesTab({ alerts }: { alerts: AntiFraudAlert[] }) {
  const customerAlerts = new Map<string, AntiFraudAlert[]>();
  for (const alert of alerts) {
    const key = alert.customerCpfCnpj || String(alert.customerId);
    if (!customerAlerts.has(key)) customerAlerts.set(key, []);
    customerAlerts.get(key)!.push(alert);
  }

  const recidiva: { name: string; cpf: string; count: number; alerts: AntiFraudAlert[] }[] = [];
  const cicloFraude: { name: string; cpf: string; providers: Set<string>; alerts: AntiFraudAlert[] }[] = [];

  customerAlerts.forEach((custAlerts, key) => {
    if (custAlerts.length >= 2) {
      recidiva.push({
        name: custAlerts[0].customerName || "Desconhecido",
        cpf: custAlerts[0].customerCpfCnpj || key,
        count: custAlerts.length,
        alerts: custAlerts,
      });
    }

    const uniqueProviders = new Set(custAlerts.map(a => a.consultingProviderName).filter(Boolean) as string[]);
    if (uniqueProviders.size >= 2) {
      cicloFraude.push({
        name: custAlerts[0].customerName || "Desconhecido",
        cpf: custAlerts[0].customerCpfCnpj || key,
        providers: uniqueProviders,
        alerts: custAlerts,
      });
    }
  });

  const totalPatterns = recidiva.length + cicloFraude.length;
  const criticalAlerts = alerts.filter(a => a.riskLevel === "critical").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Padroes Identificados" value={totalPatterns} color="bg-indigo-500" icon={Shuffle} />
        <StatCard label="Alertas Criticos" value={criticalAlerts} color="bg-red-500" icon={AlertTriangle} />
        <StatCard label="Casos de Recidiva" value={recidiva.length} color="bg-orange-500" icon={RefreshCw} />
        <StatCard label="Multiplos Provedores" value={cicloFraude.length} color="bg-purple-500" icon={Users} />
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold text-lg">Padroes Identificados</h3>

        {totalPatterns === 0 ? (
          <Card className="p-6">
            <div className="text-center py-8 text-muted-foreground">
              <Shuffle className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Nenhum padrao detectado</p>
              <p className="text-sm mt-1">Padroes surgem com mais consultas e dados ao longo do tempo.</p>
            </div>
          </Card>
        ) : (
          <>
            {recidiva.map((item, idx) => {
              const maxScore = Math.max(...item.alerts.map(a => a.riskScore || 0));
              const maxLevel = maxScore >= 75 ? "critical" : maxScore >= 50 ? "high" : maxScore >= 25 ? "medium" : "low";
              return (
                <Card key={`rec-${idx}`} className="overflow-hidden" data-testid={`pattern-recidiva-${idx}`}>
                  <div className="flex">
                    <div className={`w-1.5 flex-shrink-0 ${maxLevel === "critical" ? "bg-red-500" : "bg-orange-500"}`} />
                    <div className="flex-1 p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <RiskLevelBadge level={maxLevel} />
                          <span className="font-semibold">RECIDIVA - {item.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{item.count} ocorrencias</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Cliente com historico de inadimplencia repetida. {formatCpfCnpj(item.cpf)}
                      </p>
                      <div className="text-sm space-y-1 mt-2">
                        <p className="font-medium text-muted-foreground">Historico:</p>
                        {item.alerts.slice(0, 5).map((a, i) => (
                          <p key={i} className="flex items-center gap-2 pl-2">
                            <RiskDot level={a.riskLevel || "low"} />
                            {formatDateTime(a.createdAt)} - {formatCurrency(a.overdueAmount)} em aberto, {a.daysOverdue} dias
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}

            {cicloFraude.map((item, idx) => {
              const maxScore = Math.max(...item.alerts.map(a => a.riskScore || 0));
              const maxLevel = maxScore >= 75 ? "critical" : maxScore >= 50 ? "high" : maxScore >= 25 ? "medium" : "low";
              return (
                <Card key={`ciclo-${idx}`} className="overflow-hidden" data-testid={`pattern-ciclo-${idx}`}>
                  <div className="flex">
                    <div className={`w-1.5 flex-shrink-0 ${maxLevel === "critical" ? "bg-red-500" : "bg-orange-500"}`} />
                    <div className="flex-1 p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <RiskLevelBadge level={maxLevel} />
                          <span className="font-semibold">CICLO DE FRAUDE - {item.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{item.providers.size} provedores</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Cliente consultado por {item.providers.size} provedores, indicando tentativa de contratar em varios. {formatCpfCnpj(item.cpf)}
                      </p>
                      <div className="text-sm mt-2">
                        <p className="font-medium text-muted-foreground">Provedores consultantes:</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {Array.from(item.providers).map((prov, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{prov}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function renderAIText(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={i} className="h-2" />;
    const isHeader = /^[A-ZÁÉÍÓÚÂÊÔÀÃÕ\s]{4,}$/.test(trimmed) && trimmed === trimmed.toUpperCase() && trimmed.length > 3;
    if (isHeader) {
      return (
        <p key={i} className="font-bold text-slate-800 mt-4 mb-1 text-sm uppercase tracking-wide border-b border-indigo-200 pb-1">
          {trimmed}
        </p>
      );
    }
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      return (
        <p key={i} className="text-sm text-slate-700 pl-3 flex gap-2">
          <span className="text-indigo-400 mt-0.5">•</span>
          <span>{trimmed.replace(/^[-•]\s+/, "")}</span>
        </p>
      );
    }
    return <p key={i} className="text-sm text-slate-700">{trimmed}</p>;
  });
}

function AnaliseIATab({ alerts, customerRisk }: { alerts: AntiFraudAlert[]; customerRisk: CustomerRisk[] }) {
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const [aiError, setAiError] = useState("");

  const activeAlerts = alerts.filter(a => a.status === "new");
  const criticalAlerts = activeAlerts.filter(a => a.riskLevel === "critical");
  const totalRiskValue = activeAlerts.reduce((sum, a) => sum + parseFloat(a.overdueAmount || "0") + parseFloat(a.equipmentValue || "0"), 0);
  const avgRiskScore = activeAlerts.length > 0
    ? Math.round(activeAlerts.reduce((sum, a) => sum + (a.riskScore || 0), 0) / activeAlerts.length)
    : 0;
  const riskLevel = avgRiskScore >= 75 ? "critical" : avgRiskScore >= 50 ? "high" : avgRiskScore >= 25 ? "medium" : "low";

  const equipmentAtRisk = activeAlerts.filter(a => (a.equipmentNotReturned || 0) > 0);
  const totalEquipmentValue = equipmentAtRisk.reduce((sum, a) => sum + parseFloat(a.equipmentValue || "0"), 0);
  const equipmentCustomers = new Set(equipmentAtRisk.map(a => a.customerName)).size;
  const overdueAlerts = activeAlerts.filter(a => (a.daysOverdue || 0) > 60);
  const totalOverdueValue = overdueAlerts.reduce((sum, a) => sum + parseFloat(a.overdueAmount || "0"), 0);

  const runAIAnalysis = async () => {
    setAiText("");
    setAiLoading(true);
    setAiDone(false);
    setAiError("");
    try {
      const res = await fetch("/api/ai/analyze-antifraud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alerts, customers: customerRisk }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Erro na analise");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") { setAiDone(true); break; }
            try {
              const parsed = JSON.parse(payload);
              if (parsed.error) { setAiError(parsed.error); break; }
              if (parsed.text) setAiText(prev => prev + parsed.text);
            } catch {}
          }
        }
      }
    } catch (err: any) {
      setAiError(err.message || "Erro desconhecido");
    } finally {
      setAiLoading(false);
      setAiDone(true);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          Resumo de Risco
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Score Geral</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-2xl font-bold">{avgRiskScore}/100</span>
              <RiskLevelBadge level={riskLevel} />
            </div>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Tendencia</p>
            <p className="text-lg font-semibold mt-1 flex items-center gap-1">
              <TrendingUp className="w-4 h-4 text-orange-500" />
              {activeAlerts.length > 3 ? "Piorando" : activeAlerts.length > 0 ? "Estavel" : "Controlada"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Casos Criticos</p>
            <p className="text-2xl font-bold mt-1">{criticalAlerts.length}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Valor Total em Risco</p>
            <p className="text-lg font-bold mt-1">{formatCurrency(totalRiskValue)}</p>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-indigo-600" />
            Analise de Fraude com IA
            {aiLoading && (
              <span className="text-xs text-indigo-500 flex items-center gap-1 font-normal">
                <div className="w-3 h-3 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                Analisando...
              </span>
            )}
            {aiDone && !aiError && (
              <span className="text-xs text-emerald-600 flex items-center gap-1 font-normal">
                <CheckCircle className="w-3 h-3" />
                Concluido
              </span>
            )}
          </h3>
          <Button
            size="sm"
            variant={aiText ? "outline" : "default"}
            className={aiText ? "gap-1.5" : "gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"}
            onClick={runAIAnalysis}
            disabled={aiLoading}
            data-testid="button-run-ai-analysis"
          >
            <BrainCircuit className="w-3.5 h-3.5" />
            {aiLoading ? "Analisando..." : aiText ? "Nova Analise" : "Executar Analise de Fraude"}
          </Button>
        </div>

        {!aiText && !aiLoading && !aiError && (
          <div className="text-center py-8 text-muted-foreground">
            <BrainCircuit className="w-12 h-12 mx-auto mb-3 text-indigo-300" />
            <p className="text-sm">
              Clique em "Executar Analise de Fraude" para obter insights estrategicos
              sobre os padroes de risco da sua base de clientes.
            </p>
          </div>
        )}

        {aiError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-600">{aiError}</p>
          </div>
        )}

        {aiText && (
          <div className="space-y-1">
            {renderAIText(aiText)}
            {aiLoading && (
              <span className="inline-block w-1.5 h-4 bg-indigo-500 animate-pulse ml-0.5 rounded-sm" />
            )}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4" />
          Acoes Imediatas
        </h3>
        <div className="space-y-3">
          {equipmentCustomers > 0 && (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20">
              <RiskDot level="critical" />
              <div className="flex-1">
                <p className="font-medium text-sm">URGENTE: Recuperar equipamentos de {equipmentCustomers} cliente(s)</p>
                <p className="text-xs text-muted-foreground mt-0.5">Valor total: {formatCurrency(totalEquipmentValue)}</p>
              </div>
              <Button size="sm" variant="outline" className="text-xs flex-shrink-0">Agendar Retiradas</Button>
            </div>
          )}
          {overdueAlerts.length > 0 && (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20">
              <RiskDot level="high" />
              <div className="flex-1">
                <p className="font-medium text-sm">IMPORTANTE: Intensificar cobranca em {overdueAlerts.length} caso(s)</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total em aberto: {formatCurrency(totalOverdueValue)}</p>
              </div>
              <Button size="sm" variant="outline" className="text-xs flex-shrink-0">Enviar Notificacoes</Button>
            </div>
          )}
          <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20">
            <RiskDot level="medium" />
            <div className="flex-1">
              <p className="font-medium text-sm">PREVENTIVO: Revisar politica de credito</p>
              <p className="text-xs text-muted-foreground mt-0.5">Exigir caucao para contratos novos em areas de risco</p>
            </div>
            <Button size="sm" variant="outline" className="text-xs flex-shrink-0">Ver Sugestoes</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function RegrasTab() {
  const defaultRules = [
    {
      id: 1,
      name: "Alerta Equipamento Alto Valor",
      priority: 1,
      active: true,
      condition: "equipment_value > 300",
      action: "add_risk_points(20)",
    },
    {
      id: 2,
      name: "Cliente Novo com Atraso",
      priority: 2,
      active: true,
      condition: "contract_age < 90 AND days_overdue > 30",
      action: "add_risk_points(25), send_notification",
    },
    {
      id: 3,
      name: "Multiplas Consultas",
      priority: 3,
      active: false,
      condition: "consultations_count > 3",
      action: "block_approval",
    },
    {
      id: 4,
      name: "Valor Alto em Aberto",
      priority: 4,
      active: true,
      condition: "overdue_amount > 500",
      action: "add_risk_points(15), send_notification",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          Construtor de Regras
        </h3>
        <Button className="gap-2" data-testid="button-new-rule">
          <Zap className="w-4 h-4" />
          Nova Regra
        </Button>
      </div>

      <div className="space-y-3">
        {defaultRules.map((rule) => (
          <Card key={rule.id} className="overflow-hidden" data-testid={`rule-card-${rule.id}`}>
            <div className="flex">
              <div className={`w-1.5 flex-shrink-0 ${rule.active ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600"}`} />
              <div className="flex-1 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {rule.active ? (
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <XCircle className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className="font-semibold">
                      Regra: {rule.name}
                      {!rule.active && <span className="text-muted-foreground ml-2">(DESATIVADA)</span>}
                    </span>
                  </div>
                  <Badge variant="outline" className="text-xs">Prioridade: {rule.priority}</Badge>
                </div>
                <div className="bg-muted/40 rounded p-3 font-mono text-sm space-y-1">
                  <p>
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">SE:</span>{" "}
                    {rule.condition}
                  </p>
                  <p>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">ENTAO:</span>{" "}
                    {rule.action}
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" className="text-xs">Editar</Button>
                  <Button size="sm" variant="outline" className="text-xs">
                    {rule.active ? "Desativar" : "Ativar"}
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs text-red-600">Excluir</Button>
                  <Button size="sm" variant="ghost" className="text-xs">Testar</Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ConfiguracoesTab() {
  const [enabled, setEnabled] = useState(true);
  const [minOverdueDays, setMinOverdueDays] = useState("1");
  const [minContractAge, setMinContractAge] = useState("90");
  const [alertEquipment, setAlertEquipment] = useState(true);
  const [minEquipmentValue, setMinEquipmentValue] = useState("100");
  const [alertMultipleConsultations, setAlertMultipleConsultations] = useState(true);
  const [maxConsultations, setMaxConsultations] = useState("2");
  const [notifyCritical, setNotifyCritical] = useState(true);
  const [notifyHigh, setNotifyHigh] = useState(false);
  const [emails, setEmails] = useState<string[]>([""]);
  const { toast } = useToast();

  return (
    <div className="space-y-6">
      <Card className="p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Configuracoes Gerais
        </h3>
        <div className="flex items-center justify-between">
          <Label htmlFor="toggle-enabled" className="font-medium">Modulo Anti-Fraude Ativo</Label>
          <Switch
            id="toggle-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            data-testid="switch-enabled"
          />
        </div>
        <Separator />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Dias minimos de atraso para alerta</Label>
            <Input
              type="number"
              value={minOverdueDays}
              onChange={(e) => setMinOverdueDays(e.target.value)}
              data-testid="input-min-overdue-days"
            />
          </div>
          <div className="space-y-2">
            <Label>Idade minima do contrato (risco)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={minContractAge}
                onChange={(e) => setMinContractAge(e.target.value)}
                data-testid="input-min-contract-age"
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">dias</span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Package className="w-4 h-4" />
          Alertas de Equipamento
        </h3>
        <div className="flex items-center justify-between">
          <Label htmlFor="toggle-equipment">Alertar quando cliente tem equipamento em risco</Label>
          <Switch
            id="toggle-equipment"
            checked={alertEquipment}
            onCheckedChange={setAlertEquipment}
            data-testid="switch-alert-equipment"
          />
        </div>
        <div className="space-y-2">
          <Label>Valor minimo para alerta</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={minEquipmentValue}
              onChange={(e) => setMinEquipmentValue(e.target.value)}
              data-testid="input-min-equipment-value"
            />
            <span className="text-sm text-muted-foreground">R$</span>
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Users className="w-4 h-4" />
          Alertas de Multiplas Consultas
        </h3>
        <div className="flex items-center justify-between">
          <Label htmlFor="toggle-multi">Alertar quando cliente e consultado multiplas vezes</Label>
          <Switch
            id="toggle-multi"
            checked={alertMultipleConsultations}
            onCheckedChange={setAlertMultipleConsultations}
            data-testid="switch-alert-multi"
          />
        </div>
        <div className="space-y-2">
          <Label>Maximo de consultas em 30 dias</Label>
          <Input
            type="number"
            value={maxConsultations}
            onChange={(e) => setMaxConsultations(e.target.value)}
            data-testid="input-max-consultations"
          />
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Bell className="w-4 h-4" />
          Notificacoes por Email
        </h3>
        <div className="space-y-2">
          <Label>Emails para notificacao</Label>
          {emails.map((email, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                type="email"
                placeholder="email@provedor.com.br"
                value={email}
                onChange={(e) => {
                  const newEmails = [...emails];
                  newEmails[idx] = e.target.value;
                  setEmails(newEmails);
                }}
                data-testid={`input-email-${idx}`}
              />
              {emails.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEmails(emails.filter((_, i) => i !== idx))}
                >
                  <XCircle className="w-4 h-4 text-red-500" />
                </Button>
              )}
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEmails([...emails, ""])}
            data-testid="button-add-email"
          >
            + Adicionar
          </Button>
        </div>
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="toggle-critical">Notificar alertas CRITICOS</Label>
            <Switch
              id="toggle-critical"
              checked={notifyCritical}
              onCheckedChange={setNotifyCritical}
              data-testid="switch-notify-critical"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="toggle-high">Notificar alertas ALTOS</Label>
            <Switch
              id="toggle-high"
              checked={notifyHigh}
              onCheckedChange={setNotifyHigh}
              data-testid="switch-notify-high"
            />
          </div>
        </div>
      </Card>

      <Button
        className="w-full gap-2"
        onClick={() => toast({ title: "Configuracoes salvas com sucesso" })}
        data-testid="button-save-config"
      >
        <CheckCircle className="w-4 h-4" />
        Salvar Configuracoes
      </Button>
    </div>
  );
}

export default function AntiFraudePage() {
  const { toast } = useToast();
  const { data: alerts = [], isLoading: alertsLoading } = useQuery<AntiFraudAlert[]>({
    queryKey: ["/api/anti-fraud/alerts"],
  });

  const { data: customerRisk = [], isLoading: riskLoading } = useQuery<CustomerRisk[]>({
    queryKey: ["/api/anti-fraud/customer-risk"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PATCH", `/api/anti-fraud/alerts/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/alerts"] });
    },
  });

  const handleResolve = (id: number) => {
    updateStatusMutation.mutate({ id, status: "resolved" }, {
      onSuccess: () => toast({ title: "Alerta marcado como resolvido" }),
    });
  };

  const handleDismiss = (id: number) => {
    updateStatusMutation.mutate({ id, status: "dismissed" }, {
      onSuccess: () => toast({ title: "Alerta ignorado" }),
    });
  };

  const activeAlerts = alerts.filter(a => a.status === "new");
  const criticalCount = activeAlerts.filter(a => a.riskLevel === "critical").length;
  const highCount = activeAlerts.filter(a => a.riskLevel === "high").length;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="anti-fraude-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-anti-fraude-title">Modulo Anti-Fraude</h1>
            <p className="text-sm text-muted-foreground">Monitore clientes de alto risco e proteja seu negocio</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {criticalCount > 0 && (
            <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 gap-1" data-testid="badge-critical-count">
              <RiskDot level="critical" /> {criticalCount} Critico{criticalCount > 1 ? "s" : ""}
            </Badge>
          )}
          {highCount > 0 && (
            <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 gap-1" data-testid="badge-high-count">
              <RiskDot level="high" /> {highCount} Alto{highCount > 1 ? "s" : ""}
            </Badge>
          )}
          <Button
            variant="secondary"
            className="gap-2"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/alerts"] });
              queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/customer-risk"] });
            }}
            data-testid="button-refresh"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="alertas" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="alertas" className="gap-1.5" data-testid="tab-alertas">
            <Bell className="w-3.5 h-3.5" />
            Alertas
            {activeAlerts.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 min-w-5 text-xs px-1.5">{activeAlerts.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="score" className="gap-1.5" data-testid="tab-score">
            <BarChart3 className="w-3.5 h-3.5" />
            Score de Risco
          </TabsTrigger>
          <TabsTrigger value="padroes" className="gap-1.5" data-testid="tab-padroes">
            <Shuffle className="w-3.5 h-3.5" />
            Padroes
          </TabsTrigger>
          <TabsTrigger value="ia" className="gap-1.5" data-testid="tab-ia">
            <BrainCircuit className="w-3.5 h-3.5" />
            Analise IA
          </TabsTrigger>
          <TabsTrigger value="regras" className="gap-1.5" data-testid="tab-regras">
            <BookOpen className="w-3.5 h-3.5" />
            Regras
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1.5" data-testid="tab-config">
            <Settings className="w-3.5 h-3.5" />
            Configuracoes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="alertas">
          {alertsLoading ? (
            <Card className="p-6">
              <div className="text-center py-12 text-muted-foreground">
                <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin opacity-50" />
                <p>Carregando alertas...</p>
              </div>
            </Card>
          ) : (
            <AlertasTab alerts={alerts} onResolve={handleResolve} onDismiss={handleDismiss} />
          )}
        </TabsContent>

        <TabsContent value="score">
          <ScoreRiscoTab customerRisk={customerRisk} isLoading={riskLoading} />
        </TabsContent>

        <TabsContent value="padroes">
          <PadroesTab alerts={alerts} />
        </TabsContent>

        <TabsContent value="ia">
          <AnaliseIATab alerts={alerts} customerRisk={customerRisk} />
        </TabsContent>

        <TabsContent value="regras">
          <RegrasTab />
        </TabsContent>

        <TabsContent value="config">
          <ConfiguracoesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
