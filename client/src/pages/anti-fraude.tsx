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
  ShieldAlert, Bell, BarChart3, Shuffle, BrainCircuit, BookOpen,
  Settings, CheckCircle, RefreshCw, AlertTriangle, DollarSign,
  Calendar, Package, Phone, XCircle, ChevronDown, ChevronUp,
  Search, Users, TrendingUp, Zap, Shield, Target,
  AlertCircle, Activity, TrendingDown, Flame,
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
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc;
}

function formatCurrency(value: number | string | null | undefined): string {
  const num = typeof value === "string" ? parseFloat(value) : (value || 0);
  return `R$ ${num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `ha ${days} dia${days > 1 ? "s" : ""}`;
  if (hours > 0) return `ha ${hours}h`;
  return "agora";
}

const riskConfig = {
  critical: { label: "Critico", color: "bg-red-500", light: "bg-red-50 border-red-200", text: "text-red-700", badge: "bg-red-100 text-red-800", icon: Flame },
  high:     { label: "Alto",    color: "bg-orange-500", light: "bg-orange-50 border-orange-200", text: "text-orange-700", badge: "bg-orange-100 text-orange-800", icon: AlertTriangle },
  medium:   { label: "Medio",   color: "bg-amber-500", light: "bg-amber-50 border-amber-200", text: "text-amber-700", badge: "bg-amber-100 text-amber-800", icon: AlertCircle },
  low:      { label: "Baixo",   color: "bg-emerald-500", light: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", badge: "bg-emerald-100 text-emerald-800", icon: Shield },
} as const;

function getRiskConfig(level: string) {
  return riskConfig[level as keyof typeof riskConfig] || riskConfig.low;
}

function RiskBadge({ level, score }: { level: string; score?: number | null }) {
  const cfg = getRiskConfig(level);
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.color}`} />
      {cfg.label}{score !== undefined && score !== null ? ` · ${score}` : ""}
    </span>
  );
}

function ScoreBar({ score, level }: { score: number; level: string }) {
  const cfg = getRiskConfig(level);
  const barColor = level === "critical" ? "bg-red-500" : level === "high" ? "bg-orange-500" : level === "medium" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-bold w-8 text-right ${cfg.text}`}>{score}</span>
    </div>
  );
}

function KpiCard({ label, value, sub, color, icon: Icon, alert }: {
  label: string; value: string | number; sub?: string; color: string; icon: any; alert?: boolean;
}) {
  return (
    <Card className={`p-4 border ${alert ? "border-red-200 bg-red-50/50" : "border-slate-200"}`}>
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color} flex-shrink-0`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {alert && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-black text-slate-900" data-testid={`kpi-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</p>
        <p className="text-xs font-semibold text-slate-600 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
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
  const level = alert.riskLevel || "low";
  const cfg = getRiskConfig(level);
  const LevelIcon = cfg.icon;

  const overdueVal = parseFloat(alert.overdueAmount || "0");
  const eqpVal = parseFloat(alert.equipmentValue || "0");

  return (
    <Card className={`overflow-hidden border ${alert.status === "new" ? cfg.light : "border-slate-200 bg-white"}`} data-testid={`alert-card-${alert.id}`}>
      <div className="flex">
        <div className={`w-1 flex-shrink-0 ${cfg.color}`} />
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.badge}`}>
                <LevelIcon className={`w-4 h-4 ${cfg.text}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <RiskBadge level={level} score={alert.riskScore} />
                  {alert.status === "new" && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-900 text-white">NOVO</span>
                  )}
                  {alert.status === "resolved" && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">RESOLVIDO</span>
                  )}
                  {alert.status === "dismissed" && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">IGNORADO</span>
                  )}
                </div>
                <p className="font-bold text-slate-900 truncate" data-testid={`alert-customer-${alert.id}`}>
                  {alert.customerName || "Cliente desconhecido"}
                </p>
                {alert.customerCpfCnpj && (
                  <p className="text-xs text-slate-500">{formatCpfCnpj(alert.customerCpfCnpj)}</p>
                )}
                {alert.consultingProviderName && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    Consultado por <span className="font-semibold text-slate-700">{alert.consultingProviderName}</span>
                  </p>
                )}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-slate-400">{timeAgo(alert.createdAt)}</p>
              <p className="text-[10px] text-slate-300 mt-0.5">{formatDateTime(alert.createdAt)}</p>
            </div>
          </div>

          {(overdueVal > 0 || (alert.daysOverdue || 0) > 0 || (alert.equipmentNotReturned || 0) > 0 || (alert.recentConsultations || 0) > 0) && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {overdueVal > 0 && (
                <div className="flex items-center gap-1.5 bg-white rounded-lg border border-slate-200 px-2.5 py-2">
                  <DollarSign className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] text-slate-400">Em aberto</p>
                    <p className="text-xs font-bold text-red-600 truncate">{formatCurrency(overdueVal)}</p>
                  </div>
                </div>
              )}
              {(alert.daysOverdue || 0) > 0 && (
                <div className="flex items-center gap-1.5 bg-white rounded-lg border border-slate-200 px-2.5 py-2">
                  <Calendar className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-400">Atraso</p>
                    <p className="text-xs font-bold text-orange-600">{alert.daysOverdue} dias</p>
                  </div>
                </div>
              )}
              {(alert.equipmentNotReturned || 0) > 0 && (
                <div className="flex items-center gap-1.5 bg-white rounded-lg border border-slate-200 px-2.5 py-2">
                  <Package className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-400">Equipamentos</p>
                    <p className="text-xs font-bold text-amber-600">{alert.equipmentNotReturned} ({formatCurrency(eqpVal)})</p>
                  </div>
                </div>
              )}
              {(alert.recentConsultations || 0) > 0 && (
                <div className="flex items-center gap-1.5 bg-white rounded-lg border border-slate-200 px-2.5 py-2">
                  <Users className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-400">Consultas</p>
                    <p className="text-xs font-bold text-indigo-600">{alert.recentConsultations} provedores</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {alert.riskFactors && alert.riskFactors.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                data-testid={`button-toggle-factors-${alert.id}`}
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {alert.riskFactors.length} fator{alert.riskFactors.length > 1 ? "es" : ""} de risco
              </button>
              {expanded && (
                <ul className="mt-2 space-y-1 pl-1">
                  {alert.riskFactors.map((factor, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-slate-600">
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.color} flex-shrink-0 mt-1`} />
                      {factor}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {alert.status === "new" && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
              <Button
                size="sm"
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs"
                onClick={() => onResolve(alert.id)}
                data-testid={`button-resolve-${alert.id}`}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Resolver
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 h-7 text-xs"
                onClick={() => onDismiss(alert.id)}
                data-testid={`button-dismiss-${alert.id}`}
              >
                <XCircle className="w-3.5 h-3.5" />
                Ignorar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 h-7 text-xs ml-auto"
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
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "resolved" | "dismissed">("all");
  const [riskFilter, setRiskFilter] = useState<"all" | "critical" | "high" | "medium" | "low">("all");
  const [search, setSearch] = useState("");

  const filtered = alerts.filter(a => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (riskFilter !== "all" && a.riskLevel !== riskFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (a.customerName?.toLowerCase().includes(q) || a.customerCpfCnpj?.includes(q) || a.consultingProviderName?.toLowerCase().includes(q));
    }
    return true;
  });

  const newCount = alerts.filter(a => a.status === "new").length;
  const critCount = alerts.filter(a => a.riskLevel === "critical").length;
  const highCount = alerts.filter(a => a.riskLevel === "high").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["all", "new", "resolved", "dismissed"] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                statusFilter === f
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
              }`}
              data-testid={`filter-${f}`}
            >
              {f === "all" ? `Todos (${alerts.length})` : f === "new" ? `Novos (${newCount})` : f === "resolved" ? `Resolvidos (${alerts.filter(a => a.status === "resolved").length})` : `Ignorados (${alerts.filter(a => a.status === "dismissed").length})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          {critCount > 0 && (
            <button
              onClick={() => setRiskFilter(riskFilter === "critical" ? "all" : "critical")}
              className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-all ${riskFilter === "critical" ? "bg-red-600 text-white border-red-600" : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"}`}
            >
              Critico ({critCount})
            </button>
          )}
          {highCount > 0 && (
            <button
              onClick={() => setRiskFilter(riskFilter === "high" ? "all" : "high")}
              className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-all ${riskFilter === "high" ? "bg-orange-600 text-white border-orange-600" : "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"}`}
            >
              Alto ({highCount})
            </button>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              placeholder="Buscar..."
              className="pl-8 h-8 text-xs w-44"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-alerts"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8">
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
              <CheckCircle className="w-7 h-7 text-emerald-600" />
            </div>
            <h3 className="text-base font-semibold text-slate-800 mb-1" data-testid="text-tudo-certo">
              {search || riskFilter !== "all" ? "Nenhum alerta corresponde ao filtro" : statusFilter === "all" ? "Nenhum alerta ainda" : `Nenhum alerta ${statusFilter === "new" ? "novo" : statusFilter === "resolved" ? "resolvido" : "ignorado"}`}
            </h3>
            <p className="text-sm text-slate-400">
              {!search && riskFilter === "all" && statusFilter === "all" && "Alertas sao gerados automaticamente a cada consulta ISP realizada."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((alert) => (
            <AlertCard key={alert.id} alert={alert} onResolve={onResolve} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreRiscoTab({ customerRisk, isLoading }: { customerRisk: CustomerRisk[]; isLoading: boolean }) {
  const [sortBy, setSortBy] = useState<"score" | "overdue" | "equipment">("score");

  const sorted = [...customerRisk].sort((a, b) => {
    if (sortBy === "overdue") return b.overdueAmount - a.overdueAmount;
    if (sortBy === "equipment") return b.equipmentValue - a.equipmentValue;
    return b.riskScore - a.riskScore;
  });

  const criticalCount = customerRisk.filter(c => c.riskLevel === "critical").length;
  const highCount = customerRisk.filter(c => c.riskLevel === "high").length;
  const mediumCount = customerRisk.filter(c => c.riskLevel === "medium").length;
  const lowCount = customerRisk.filter(c => c.riskLevel === "low").length;
  const avgScore = customerRisk.length > 0 ? Math.round(customerRisk.reduce((s, c) => s + c.riskScore, 0) / customerRisk.length) : 0;
  const totalOverdue = customerRisk.reduce((s, c) => s + c.overdueAmount, 0);

  if (isLoading) {
    return (
      <Card className="p-8">
        <div className="text-center py-8 text-slate-400">
          <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin opacity-50" />
          <p className="text-sm">Calculando scores de risco...</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: "Critico", value: criticalCount, color: "bg-red-500", icon: Flame },
          { label: "Alto", value: highCount, color: "bg-orange-500", icon: AlertTriangle },
          { label: "Medio", value: mediumCount, color: "bg-amber-500", icon: AlertCircle },
          { label: "Baixo", value: lowCount, color: "bg-emerald-500", icon: Shield },
        ].map(item => (
          <Card key={item.label} className="p-3 col-span-1">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.color}`}>
                <item.icon className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-xl font-black text-slate-900">{item.value}</p>
                <p className="text-[10px] text-slate-500 font-medium">{item.label}</p>
              </div>
            </div>
          </Card>
        ))}
        <Card className="p-3 col-span-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-xl font-black text-slate-900" data-testid="stat-score-medio">{avgScore}</p>
              <p className="text-[10px] text-slate-500 font-medium">Score Medio</p>
            </div>
          </div>
        </Card>
        <Card className="p-3 col-span-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-rose-500">
              <DollarSign className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-slate-900">{formatCurrency(totalOverdue)}</p>
              <p className="text-[10px] text-slate-500 font-medium">Total em Aberto</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2 text-slate-800">
            <Target className="w-4 h-4 text-slate-400" />
            Ranking de Risco ({customerRisk.length} clientes)
          </h3>
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400 mr-1">Ordenar por:</span>
            {(["score", "overdue", "equipment"] as const).map(opt => (
              <button
                key={opt}
                onClick={() => setSortBy(opt)}
                className={`px-2 py-1 text-xs rounded font-medium transition-all ${sortBy === opt ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {opt === "score" ? "Score" : opt === "overdue" ? "Divida" : "Equip."}
              </button>
            ))}
          </div>
        </div>
        {customerRisk.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
            Nenhum cliente com risco identificado.
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {sorted.slice(0, 20).map((customer, idx) => {
              const cfg = getRiskConfig(customer.riskLevel);
              return (
                <div
                  key={customer.id}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors"
                  data-testid={`risk-customer-${customer.id}`}
                >
                  <span className="text-sm font-black text-slate-300 w-6 flex-shrink-0">#{idx + 1}</span>
                  <div className={`w-2 h-8 rounded-full flex-shrink-0 ${cfg.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-slate-900 truncate">{customer.name}</p>
                    <p className="text-xs text-slate-400">{formatCpfCnpj(customer.cpfCnpj)}</p>
                    <ScoreBar score={customer.riskScore} level={customer.riskLevel} />
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs font-bold text-red-600">{formatCurrency(customer.overdueAmount)}</p>
                      <p className="text-[10px] text-slate-400">{customer.daysOverdue}d atraso</p>
                    </div>
                    {customer.equipmentNotReturned > 0 && (
                      <div className="text-right hidden sm:block">
                        <p className="text-xs font-bold text-amber-600">{customer.equipmentNotReturned} equip.</p>
                        <p className="text-[10px] text-slate-400">{formatCurrency(customer.equipmentValue)}</p>
                      </div>
                    )}
                    <RiskBadge level={customer.riskLevel} score={customer.riskScore} />
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
      recidiva.push({ name: custAlerts[0].customerName || "Desconhecido", cpf: custAlerts[0].customerCpfCnpj || key, count: custAlerts.length, alerts: custAlerts });
    }
    const uniqueProviders = new Set(custAlerts.map(a => a.consultingProviderName).filter(Boolean) as string[]);
    if (uniqueProviders.size >= 2) {
      cicloFraude.push({ name: custAlerts[0].customerName || "Desconhecido", cpf: custAlerts[0].customerCpfCnpj || key, providers: uniqueProviders, alerts: custAlerts });
    }
  });

  const totalPatterns = recidiva.length + cicloFraude.length;
  const criticalAlerts = alerts.filter(a => a.riskLevel === "critical").length;
  const totalRisk = alerts.reduce((s, a) => s + parseFloat(a.overdueAmount || "0") + parseFloat(a.equipmentValue || "0"), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Padroes Detectados", value: totalPatterns, color: "bg-indigo-500", icon: Shuffle },
          { label: "Alertas Criticos", value: criticalAlerts, color: "bg-red-500", icon: Flame },
          { label: "Casos de Recidiva", value: recidiva.length, color: "bg-orange-500", icon: RefreshCw },
          { label: "Multiplos Provedores", value: cicloFraude.length, color: "bg-purple-500", icon: Users },
        ].map(item => (
          <Card key={item.label} className="p-3">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.color}`}>
                <item.icon className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-xl font-black text-slate-900">{item.value}</p>
                <p className="text-[10px] text-slate-500 font-medium leading-tight">{item.label}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {totalRisk > 0 && (
        <Card className="p-4 bg-red-50 border-red-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500 flex items-center justify-center flex-shrink-0">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-red-800">Valor Total em Risco nos Padroes Detectados</p>
              <p className="text-xl font-black text-red-700">{formatCurrency(totalRisk)}</p>
            </div>
          </div>
        </Card>
      )}

      {totalPatterns === 0 ? (
        <Card className="p-8">
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center mx-auto mb-3">
              <Shuffle className="w-7 h-7 text-indigo-400" />
            </div>
            <h3 className="font-semibold text-slate-700 mb-1">Nenhum padrao detectado</h3>
            <p className="text-sm text-slate-400">Padroes emergem conforme mais consultas sao realizadas ao longo do tempo.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {recidiva.map((item, idx) => {
            const maxScore = Math.max(...item.alerts.map(a => a.riskScore || 0));
            const level = maxScore >= 75 ? "critical" : maxScore >= 50 ? "high" : maxScore >= 25 ? "medium" : "low";
            const cfg = getRiskConfig(level);
            const totalValue = item.alerts.reduce((s, a) => s + parseFloat(a.overdueAmount || "0"), 0);
            return (
              <Card key={`rec-${idx}`} className={`overflow-hidden border ${cfg.light}`} data-testid={`pattern-recidiva-${idx}`}>
                <div className="flex">
                  <div className={`w-1 flex-shrink-0 ${cfg.color}`} />
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-black px-2 py-0.5 rounded bg-orange-100 text-orange-700 tracking-wider">RECIDIVA</span>
                          <RiskBadge level={level} score={maxScore} />
                        </div>
                        <p className="font-bold text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-500">{formatCpfCnpj(item.cpf)}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-black text-red-600">{formatCurrency(totalValue)}</p>
                        <p className="text-xs text-slate-400">{item.count} ocorrencias</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 mb-2">
                      Cliente com historico de inadimplencia repetida detectado em {item.count} alertas distintos.
                    </p>
                    <div className="space-y-1">
                      {item.alerts.slice(0, 4).map((a, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-slate-600 py-0.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.color} flex-shrink-0`} />
                          <span className="text-slate-400">{formatDateTime(a.createdAt)}</span>
                          <span>—</span>
                          <span className="font-medium">{formatCurrency(a.overdueAmount)}</span>
                          <span className="text-slate-400">{a.daysOverdue} dias atraso</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}

          {cicloFraude.map((item, idx) => {
            const maxScore = Math.max(...item.alerts.map(a => a.riskScore || 0));
            const level = maxScore >= 75 ? "critical" : maxScore >= 50 ? "high" : maxScore >= 25 ? "medium" : "low";
            const cfg = getRiskConfig(level);
            return (
              <Card key={`ciclo-${idx}`} className={`overflow-hidden border ${cfg.light}`} data-testid={`pattern-ciclo-${idx}`}>
                <div className="flex">
                  <div className={`w-1 flex-shrink-0 ${cfg.color}`} />
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-black px-2 py-0.5 rounded bg-purple-100 text-purple-700 tracking-wider">MULTIPLOS PROVEDORES</span>
                          <RiskBadge level={level} score={maxScore} />
                        </div>
                        <p className="font-bold text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-500">{formatCpfCnpj(item.cpf)}</p>
                      </div>
                      <span className="text-sm font-bold text-purple-700 flex-shrink-0">{item.providers.size} provedores</span>
                    </div>
                    <p className="text-xs text-slate-600 mb-2">
                      Cliente consultado por {item.providers.size} provedores diferentes, indicando possivel tentativa de contratar em varios simultaneamente.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(item.providers).map((prov, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600 font-medium">{prov}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function renderAIText(text: string) {
  return text.split("\n").map((line, i) => {
    const t = line.trim();
    if (!t) return <div key={i} className="h-2" />;
    const isHeader = /^[A-ZÁÉÍÓÚÂÊÔÀÃÕ\s]{4,}$/.test(t) && t === t.toUpperCase() && t.length > 3;
    if (isHeader) return <p key={i} className="font-bold text-slate-800 mt-4 mb-1 text-sm uppercase tracking-wide border-b border-indigo-100 pb-1">{t}</p>;
    if (t.startsWith("- ") || t.startsWith("• ")) return (
      <p key={i} className="text-sm text-slate-700 pl-3 flex gap-2">
        <span className="text-indigo-400 mt-0.5">•</span>
        <span>{t.replace(/^[-•]\s+/, "")}</span>
      </p>
    );
    return <p key={i} className="text-sm text-slate-700 leading-relaxed">{t}</p>;
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
  const avgRiskScore = activeAlerts.length > 0 ? Math.round(activeAlerts.reduce((sum, a) => sum + (a.riskScore || 0), 0) / activeAlerts.length) : 0;
  const riskLevel = avgRiskScore >= 75 ? "critical" : avgRiskScore >= 50 ? "high" : avgRiskScore >= 25 ? "medium" : "low";
  const equipmentAtRisk = activeAlerts.filter(a => (a.equipmentNotReturned || 0) > 0);
  const totalEquipmentValue = equipmentAtRisk.reduce((sum, a) => sum + parseFloat(a.equipmentValue || "0"), 0);
  const equipmentCustomers = new Set(equipmentAtRisk.map(a => a.customerName)).size;
  const overdueAlerts = activeAlerts.filter(a => (a.daysOverdue || 0) > 60);
  const totalOverdueValue = overdueAlerts.reduce((sum, a) => sum + parseFloat(a.overdueAmount || "0"), 0);

  const runAIAnalysis = async () => {
    setAiText(""); setAiLoading(true); setAiDone(false); setAiError("");
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
      setAiLoading(false); setAiDone(true);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-1">Score Geral de Risco</p>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-black text-slate-900">{avgRiskScore}</span>
            <span className="text-slate-400 text-sm mb-0.5">/100</span>
          </div>
          <ScoreBar score={avgRiskScore} level={riskLevel} />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-1">Casos Criticos</p>
          <p className="text-2xl font-black text-red-600">{criticalAlerts.length}</p>
          <p className="text-xs text-slate-400">de {activeAlerts.length} ativos</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-1">Valor Total em Risco</p>
          <p className="text-lg font-black text-rose-600">{formatCurrency(totalRiskValue)}</p>
          <p className="text-xs text-slate-400">inadimplencia + equip.</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-1">Tendencia</p>
          <p className="text-base font-bold text-slate-800 flex items-center gap-1 mt-1">
            {activeAlerts.length > 3
              ? <><TrendingUp className="w-4 h-4 text-red-500" /> Piorando</>
              : activeAlerts.length > 0
              ? <><Activity className="w-4 h-4 text-amber-500" /> Estavel</>
              : <><TrendingDown className="w-4 h-4 text-emerald-500" /> Controlada</>
            }
          </p>
        </div>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
              <BrainCircuit className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Analise de Fraude com IA</h3>
              <p className="text-xs text-slate-400">Insights estrategicos sobre os padroes de risco</p>
            </div>
            {aiLoading && (
              <span className="text-xs text-indigo-500 flex items-center gap-1 font-medium ml-2">
                <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                Analisando...
              </span>
            )}
            {aiDone && !aiError && (
              <span className="text-xs text-emerald-600 flex items-center gap-1 font-medium ml-2">
                <CheckCircle className="w-3 h-3" /> Concluido
              </span>
            )}
          </div>
          <Button
            size="sm"
            className={aiText ? "gap-1.5" : "gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"}
            variant={aiText ? "outline" : "default"}
            onClick={runAIAnalysis}
            disabled={aiLoading}
            data-testid="button-run-ai-analysis"
          >
            <BrainCircuit className="w-3.5 h-3.5" />
            {aiLoading ? "Analisando..." : aiText ? "Nova Analise" : "Executar Analise"}
          </Button>
        </div>

        {!aiText && !aiLoading && !aiError && (
          <div className="text-center py-10 border-2 border-dashed border-indigo-100 rounded-xl bg-indigo-50/30">
            <BrainCircuit className="w-12 h-12 mx-auto mb-3 text-indigo-200" />
            <p className="text-sm text-slate-600 font-medium">Analise com IA disponivel</p>
            <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
              Clique em "Executar Analise" para obter insights sobre padroes de fraude e recomendacoes estrategicas.
            </p>
          </div>
        )}
        {aiError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-600">{aiError}</p>
          </div>
        )}
        {aiText && (
          <div className="space-y-1 bg-slate-50 rounded-xl p-4 border border-slate-100">
            {renderAIText(aiText)}
            {aiLoading && <span className="inline-block w-1.5 h-4 bg-indigo-500 animate-pulse ml-0.5 rounded-sm" />}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-amber-500" />
          Acoes Prioritarias
        </h3>
        <div className="space-y-2.5">
          {equipmentCustomers > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-red-200 bg-red-50">
              <div className="w-8 h-8 rounded-lg bg-red-500 flex items-center justify-center flex-shrink-0">
                <Package className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-red-800">Recuperar equipamentos — {equipmentCustomers} cliente(s)</p>
                <p className="text-xs text-red-600 mt-0.5">Valor total em risco: {formatCurrency(totalEquipmentValue)}</p>
              </div>
              <Button size="sm" variant="outline" className="text-xs flex-shrink-0 border-red-300 text-red-700 hover:bg-red-100">Agendar</Button>
            </div>
          )}
          {overdueAlerts.length > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-orange-200 bg-orange-50">
              <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center flex-shrink-0">
                <DollarSign className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-orange-800">Intensificar cobranca — {overdueAlerts.length} caso(s) acima de 60 dias</p>
                <p className="text-xs text-orange-600 mt-0.5">Total em aberto: {formatCurrency(totalOverdueValue)}</p>
              </div>
              <Button size="sm" variant="outline" className="text-xs flex-shrink-0 border-orange-300 text-orange-700 hover:bg-orange-100">Notificar</Button>
            </div>
          )}
          <div className="flex items-center gap-3 p-3 rounded-xl border border-amber-200 bg-amber-50">
            <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center flex-shrink-0">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-800">Revisar politica de credito preventivamente</p>
              <p className="text-xs text-amber-600 mt-0.5">Exigir caucao para contratos novos em areas de risco elevado</p>
            </div>
            <Button size="sm" variant="outline" className="text-xs flex-shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100">Ver Sugestoes</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function RegrasTab() {
  const [rules, setRules] = useState([
    { id: 1, name: "Equipamento Alto Valor", priority: 1, active: true, condition: "equipment_value > 300", action: "add_risk_points(20)", desc: "Adiciona pontos de risco quando equipamentos de alto valor nao sao devolvidos." },
    { id: 2, name: "Cliente Novo em Atraso", priority: 2, active: true, condition: "contract_age < 90 AND days_overdue > 30", action: "add_risk_points(25), send_notification", desc: "Alerta clientes novos que ja entram em atraso nos primeiros 90 dias de contrato." },
    { id: 3, name: "Multiplas Consultas", priority: 3, active: false, condition: "consultations_count > 3", action: "block_approval", desc: "Bloqueia aprovacao automatica de clientes consultados por mais de 3 provedores." },
    { id: 4, name: "Valor Alto em Aberto", priority: 4, active: true, condition: "overdue_amount > 500", action: "add_risk_points(15), send_notification", desc: "Dispara alerta quando o valor total em aberto supera R$ 500." },
  ]);

  const toggleRule = (id: number) => setRules(rules.map(r => r.id === id ? { ...r, active: !r.active } : r));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-900">Regras de Deteccao</h3>
          <p className="text-xs text-slate-400 mt-0.5">{rules.filter(r => r.active).length} de {rules.length} regras ativas</p>
        </div>
        <Button className="gap-2 text-xs" size="sm" data-testid="button-new-rule">
          <Zap className="w-3.5 h-3.5" />
          Nova Regra
        </Button>
      </div>

      <div className="space-y-2.5">
        {rules.map((rule) => (
          <Card key={rule.id} className={`overflow-hidden border ${rule.active ? "border-slate-200" : "border-slate-100 opacity-60"}`} data-testid={`rule-card-${rule.id}`}>
            <div className="flex">
              <div className={`w-1 flex-shrink-0 ${rule.active ? "bg-emerald-500" : "bg-slate-300"}`} />
              <div className="flex-1 p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`w-2 h-2 rounded-full ${rule.active ? "bg-emerald-500" : "bg-slate-300"}`} />
                      <span className="font-bold text-slate-900 text-sm">{rule.name}</span>
                      <span className="text-[10px] text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded font-medium">P{rule.priority}</span>
                    </div>
                    <p className="text-xs text-slate-500">{rule.desc}</p>
                  </div>
                  <Switch
                    checked={rule.active}
                    onCheckedChange={() => toggleRule(rule.id)}
                    data-testid={`switch-rule-${rule.id}`}
                  />
                </div>
                <div className="bg-slate-50 rounded-lg p-3 font-mono text-xs space-y-1 border border-slate-100">
                  <p><span className="text-blue-600 font-bold">SE:</span> <span className="text-slate-700">{rule.condition}</span></p>
                  <p><span className="text-emerald-600 font-bold">ENTAO:</span> <span className="text-slate-700">{rule.action}</span></p>
                </div>
                <div className="flex items-center gap-1.5 mt-3">
                  <Button size="sm" variant="outline" className="text-xs h-7">Editar</Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7 text-slate-500">Testar</Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7 text-red-500 ml-auto">Excluir</Button>
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
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <Settings className="w-4 h-4 text-slate-400" />
          Configuracoes Gerais
        </h3>
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
          <div>
            <Label htmlFor="toggle-enabled" className="font-semibold text-slate-900 cursor-pointer">Modulo Anti-Fraude Ativo</Label>
            <p className="text-xs text-slate-400 mt-0.5">Monitoramento automatico em cada consulta ISP</p>
          </div>
          <Switch id="toggle-enabled" checked={enabled} onCheckedChange={setEnabled} data-testid="switch-enabled" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">Dias minimos de atraso para alerta</Label>
            <Input type="number" value={minOverdueDays} onChange={(e) => setMinOverdueDays(e.target.value)} className="h-9" data-testid="input-min-overdue-days" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">Idade minima do contrato para alertar</Label>
            <div className="flex items-center gap-2">
              <Input type="number" value={minContractAge} onChange={(e) => setMinContractAge(e.target.value)} className="h-9" data-testid="input-min-contract-age" />
              <span className="text-sm text-slate-400 whitespace-nowrap">dias</span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <Package className="w-4 h-4 text-slate-400" />
          Alertas de Equipamento
        </h3>
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
          <div>
            <Label htmlFor="toggle-equipment" className="font-semibold text-slate-900 cursor-pointer">Alertar equipamentos em risco</Label>
            <p className="text-xs text-slate-400 mt-0.5">Quando cliente possui equipamento nao devolvido</p>
          </div>
          <Switch id="toggle-equipment" checked={alertEquipment} onCheckedChange={setAlertEquipment} data-testid="switch-alert-equipment" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-700">Valor minimo para alerta (R$)</Label>
          <Input type="number" value={minEquipmentValue} onChange={(e) => setMinEquipmentValue(e.target.value)} className="h-9" data-testid="input-min-equipment-value" />
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-400" />
          Alertas de Multiplas Consultas
        </h3>
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
          <div>
            <Label htmlFor="toggle-multi" className="font-semibold text-slate-900 cursor-pointer">Alertar multiplas consultas</Label>
            <p className="text-xs text-slate-400 mt-0.5">Quando o cliente e consultado por varios provedores</p>
          </div>
          <Switch id="toggle-multi" checked={alertMultipleConsultations} onCheckedChange={setAlertMultipleConsultations} data-testid="switch-alert-multi" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-700">Maximo de consultas em 30 dias</Label>
          <Input type="number" value={maxConsultations} onChange={(e) => setMaxConsultations(e.target.value)} className="h-9" data-testid="input-max-consultations" />
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <Bell className="w-4 h-4 text-slate-400" />
          Notificacoes por Email
        </h3>
        <div className="space-y-2">
          {emails.map((email, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input type="email" placeholder="email@provedor.com.br" value={email} onChange={(e) => { const n = [...emails]; n[idx] = e.target.value; setEmails(n); }} className="h-9" data-testid={`input-email-${idx}`} />
              {emails.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => setEmails(emails.filter((_, i) => i !== idx))}>
                  <XCircle className="w-4 h-4 text-red-400" />
                </Button>
              )}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setEmails([...emails, ""])} className="text-xs" data-testid="button-add-email">
            + Adicionar email
          </Button>
        </div>
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="toggle-critical" className="font-semibold text-slate-900 cursor-pointer">Notificar alertas CRITICOS</Label>
              <p className="text-xs text-slate-400">Score acima de 75</p>
            </div>
            <Switch id="toggle-critical" checked={notifyCritical} onCheckedChange={setNotifyCritical} data-testid="switch-notify-critical" />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="toggle-high" className="font-semibold text-slate-900 cursor-pointer">Notificar alertas ALTOS</Label>
              <p className="text-xs text-slate-400">Score entre 50 e 75</p>
            </div>
            <Switch id="toggle-high" checked={notifyHigh} onCheckedChange={setNotifyHigh} data-testid="switch-notify-high" />
          </div>
        </div>
      </Card>

      <Button
        className="w-full gap-2"
        onClick={() => toast({ title: "Configuracoes salvas" })}
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

  const handleResolve = (id: number) => updateStatusMutation.mutate({ id, status: "resolved" }, { onSuccess: () => toast({ title: "Alerta resolvido" }) });
  const handleDismiss = (id: number) => updateStatusMutation.mutate({ id, status: "dismissed" }, { onSuccess: () => toast({ title: "Alerta ignorado" }) });

  const activeAlerts = alerts.filter(a => a.status === "new");
  const criticalCount = activeAlerts.filter(a => a.riskLevel === "critical").length;
  const highCount = activeAlerts.filter(a => a.riskLevel === "high").length;
  const totalRiskValue = activeAlerts.reduce((s, a) => s + parseFloat(a.overdueAmount || "0") + parseFloat(a.equipmentValue || "0"), 0);
  const riskCustomersCount = customerRisk.filter(c => c.riskLevel === "critical" || c.riskLevel === "high").length;

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto" data-testid="anti-fraude-page">

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-rose-700 flex items-center justify-center shadow-md">
            <ShieldAlert className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900" data-testid="text-anti-fraude-title">Anti-Fraude</h1>
            <p className="text-sm text-slate-500">Monitoramento automatico de risco e fraude</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {criticalCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-red-100 text-red-700 border border-red-200" data-testid="badge-critical-count">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> {criticalCount} Critico{criticalCount > 1 ? "s" : ""}
            </span>
          )}
          {highCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-orange-100 text-orange-700 border border-orange-200" data-testid="badge-high-count">
              <span className="w-2 h-2 rounded-full bg-orange-500" /> {highCount} Alto{highCount > 1 ? "s" : ""}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/alerts"] });
              queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/customer-risk"] });
            }}
            data-testid="button-refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Alertas Ativos" value={activeAlerts.length} sub={`${alerts.length} total`} color="bg-slate-700" icon={Bell} alert={activeAlerts.length > 0} />
        <KpiCard label="Criticos" value={criticalCount} sub={`${highCount} altos`} color="bg-red-500" icon={Flame} alert={criticalCount > 0} />
        <KpiCard label="Valor em Risco" value={formatCurrency(totalRiskValue)} color="bg-rose-600" icon={DollarSign} />
        <KpiCard label="Clientes de Alto Risco" value={riskCustomersCount} sub="critico + alto" color="bg-orange-500" icon={Users} />
      </div>

      <Tabs defaultValue="alertas" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1 bg-slate-100/80 p-1 rounded-xl">
          <TabsTrigger value="alertas" className="gap-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm" data-testid="tab-alertas">
            <Bell className="w-3.5 h-3.5" />
            Alertas
            {activeAlerts.length > 0 && (
              <span className="ml-1 h-5 min-w-5 text-xs px-1.5 bg-red-500 text-white rounded-full flex items-center justify-center font-bold">{activeAlerts.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="score" className="gap-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm" data-testid="tab-score">
            <BarChart3 className="w-3.5 h-3.5" />
            Score de Risco
          </TabsTrigger>
          <TabsTrigger value="padroes" className="gap-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm" data-testid="tab-padroes">
            <Shuffle className="w-3.5 h-3.5" />
            Padroes
          </TabsTrigger>
          <TabsTrigger value="ia" className="gap-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm" data-testid="tab-ia">
            <BrainCircuit className="w-3.5 h-3.5" />
            Analise IA
          </TabsTrigger>
          <TabsTrigger value="regras" className="gap-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm" data-testid="tab-regras">
            <BookOpen className="w-3.5 h-3.5" />
            Regras
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm" data-testid="tab-config">
            <Settings className="w-3.5 h-3.5" />
            Configuracoes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="alertas">
          {alertsLoading ? (
            <Card className="p-8">
              <div className="text-center py-8 text-slate-400">
                <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin opacity-50" />
                <p className="text-sm">Carregando alertas...</p>
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
