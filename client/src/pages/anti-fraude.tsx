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
  ShieldAlert, Bell, BarChart3, BrainCircuit, BookOpen,
  Settings, CheckCircle, RefreshCw, AlertTriangle, DollarSign,
  Calendar, Package, Phone, XCircle, ChevronDown, ChevronUp,
  Search, Users, Zap, Shield, Target,
  AlertCircle, Flame, ArrowRight, TrendingUp,
  Building2, UserX, Wifi, WifiOff, Clock,
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
  const mins = Math.floor(diff / 60000);
  if (mins > 0) return `ha ${mins}min`;
  return "agora pouco";
}

function getAlertTypeConfig(type: string, severity: string) {
  switch (type) {
    case "defaulter_consulted":
      return {
        tag: "TENTATIVA DE FUGA",
        tagColor: "bg-red-100 text-red-800",
        borderColor: "border-red-300",
        bgColor: "bg-red-50",
        icon: WifiOff,
        iconBg: "bg-red-500",
        description: "Seu cliente inadimplente esta sendo consultado por outro provedor",
      };
    case "multiple_consultations":
      return {
        tag: "MIGRADOR SERIAL",
        tagColor: "bg-purple-100 text-purple-800",
        borderColor: "border-purple-300",
        bgColor: "bg-purple-50",
        icon: Users,
        iconBg: "bg-purple-500",
        description: "Este cliente consultou multiplos provedores — padrao de migracao em serie",
      };
    case "equipment_risk":
      return {
        tag: "RISCO DE EQUIPAMENTO",
        tagColor: "bg-amber-100 text-amber-800",
        borderColor: "border-amber-300",
        bgColor: "bg-amber-50",
        icon: Package,
        iconBg: "bg-amber-500",
        description: "Cliente com equipamento nao devolvido esta buscando novo provedor",
      };
    case "recent_contract":
      return {
        tag: "CONTRATO RECENTE",
        tagColor: "bg-blue-100 text-blue-800",
        borderColor: "border-blue-300",
        bgColor: "bg-blue-50",
        icon: Clock,
        iconBg: "bg-blue-500",
        description: "Cliente com contrato recente esta sendo prospectado por outro provedor",
      };
    default:
      return {
        tag: "ALERTA",
        tagColor: "bg-slate-100 text-slate-700",
        borderColor: "border-slate-200",
        bgColor: "bg-white",
        icon: AlertCircle,
        iconBg: "bg-slate-500",
        description: "",
      };
  }
}

function getRiskLevelConfig(level: string) {
  switch (level) {
    case "critical": return { label: "Critico", color: "bg-red-500", badge: "bg-red-100 text-red-800" };
    case "high":     return { label: "Alto",    color: "bg-orange-500", badge: "bg-orange-100 text-orange-800" };
    case "medium":   return { label: "Medio",   color: "bg-amber-500", badge: "bg-amber-100 text-amber-800" };
    default:         return { label: "Baixo",   color: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-800" };
  }
}

function PrejuizoCard({ label, value, sub, icon: Icon, color, alert }: {
  label: string; value: string | number; sub?: string; icon: any; color: string; alert?: boolean;
}) {
  return (
    <Card className={`p-4 ${alert ? "border-red-200 bg-red-50/30" : "border-slate-200"}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        {alert && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse mt-1" />}
      </div>
      <p className="text-2xl font-black text-slate-900" data-testid={`kpi-${label}`}>{value}</p>
      <p className="text-xs font-semibold text-slate-600 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </Card>
  );
}

function AlertaMigracaoCard({ alert, onResolve, onDismiss }: {
  alert: AntiFraudAlert;
  onResolve: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const typeConfig = getAlertTypeConfig(alert.type, alert.severity);
  const riskConfig = getRiskLevelConfig(alert.riskLevel || "low");
  const TypeIcon = typeConfig.icon;

  const overdueVal = parseFloat(alert.overdueAmount || "0");
  const eqpVal = parseFloat(alert.equipmentValue || "0");
  const totalPrejuizo = overdueVal + eqpVal;

  return (
    <Card className={`overflow-hidden border ${alert.status !== "new" ? "border-slate-200 opacity-70" : typeConfig.borderColor}`} data-testid={`alert-card-${alert.id}`}>
      <div className={`${alert.status === "new" ? typeConfig.bgColor : "bg-white"} p-4`}>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${typeConfig.iconBg}`}>
            <TypeIcon className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${typeConfig.tagColor}`}>
                  {typeConfig.tag}
                </span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${riskConfig.badge}`}>
                  {riskConfig.label}{alert.riskScore ? ` · ${alert.riskScore}` : ""}
                </span>
                {alert.status === "resolved" && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">RESOLVIDO</span>
                )}
                {alert.status === "dismissed" && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">IGNORADO</span>
                )}
              </div>
              <span className="text-xs text-slate-400 flex-shrink-0">{timeAgo(alert.createdAt)}</span>
            </div>

            <p className="font-bold text-slate-900 text-sm" data-testid={`alert-customer-${alert.id}`}>
              {alert.customerName || "Cliente desconhecido"}
            </p>
            {alert.customerCpfCnpj && (
              <p className="text-xs text-slate-500">{formatCpfCnpj(alert.customerCpfCnpj)}</p>
            )}

            <p className="text-xs text-slate-600 mt-1">{typeConfig.description}</p>

            {alert.consultingProviderName && (
              <div className="flex items-center gap-1.5 mt-1.5 text-xs">
                <Building2 className="w-3 h-3 text-slate-400" />
                <span className="text-slate-500">Consultado por:</span>
                <span className="font-semibold text-slate-800">{alert.consultingProviderName}</span>
                <ArrowRight className="w-3 h-3 text-slate-400" />
                <span className="text-slate-500 italic">destino provavel da migracao</span>
              </div>
            )}
          </div>
        </div>

        {(overdueVal > 0 || eqpVal > 0 || (alert.daysOverdue || 0) > 0 || (alert.recentConsultations || 0) > 1) && (
          <div className="mt-3 ml-13 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {overdueVal > 0 && (
              <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-[10px] text-slate-400">Mensalidades em atraso</p>
                <p className="text-sm font-black text-red-600">{formatCurrency(overdueVal)}</p>
              </div>
            )}
            {(alert.daysOverdue || 0) > 0 && (
              <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-[10px] text-slate-400">Dias sem pagar</p>
                <p className="text-sm font-black text-orange-600">{alert.daysOverdue} dias</p>
              </div>
            )}
            {eqpVal > 0 && (
              <div className="bg-white rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
                <p className="text-[10px] text-amber-600">Equipamento em risco</p>
                <p className="text-sm font-black text-amber-700">{formatCurrency(eqpVal)}</p>
                <p className="text-[10px] text-amber-500">{alert.equipmentNotReturned} item(ns)</p>
              </div>
            )}
            {(alert.recentConsultations || 0) > 1 && (
              <div className="bg-white rounded-lg border border-purple-200 bg-purple-50/50 px-3 py-2">
                <p className="text-[10px] text-purple-600">Provedores consultados</p>
                <p className="text-sm font-black text-purple-700">{alert.recentConsultations} provedores</p>
                <p className="text-[10px] text-purple-500">nos ultimos 30 dias</p>
              </div>
            )}
          </div>
        )}

        {totalPrejuizo > 0 && (
          <div className="mt-3 ml-13 p-2.5 rounded-lg border border-red-200 bg-red-50 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-red-600 font-semibold uppercase tracking-wide">Prejuizo estimado se o cliente migrar</p>
              <p className="text-base font-black text-red-700">{formatCurrency(totalPrejuizo)}</p>
            </div>
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          </div>
        )}

        {alert.riskFactors && alert.riskFactors.length > 0 && (
          <div className="mt-3 ml-13">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
              data-testid={`button-toggle-factors-${alert.id}`}
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {alert.riskFactors.length} indicador{alert.riskFactors.length > 1 ? "es" : ""} de risco
            </button>
            {expanded && (
              <ul className="mt-2 space-y-1">
                {alert.riskFactors.map((factor, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-slate-600">
                    <span className={`w-1.5 h-1.5 rounded-full ${riskConfig.color} flex-shrink-0 mt-1`} />
                    {factor}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {alert.status === "new" && (
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/50 ml-13">
            <Button
              size="sm"
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs"
              onClick={() => onResolve(alert.id)}
              data-testid={`button-resolve-${alert.id}`}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Resolvido
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-7 text-xs bg-white"
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
    </Card>
  );
}

function AlertasTab({ alerts, onResolve, onDismiss }: {
  alerts: AntiFraudAlert[];
  onResolve: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "resolved" | "dismissed">("new");
  const [typeFilter, setTypeFilter] = useState<"all" | "defaulter_consulted" | "multiple_consultations" | "equipment_risk">("all");
  const [search, setSearch] = useState("");

  const filtered = alerts.filter(a => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (typeFilter !== "all" && a.type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (a.customerName?.toLowerCase().includes(q) || a.customerCpfCnpj?.includes(q) || a.consultingProviderName?.toLowerCase().includes(q));
    }
    return true;
  });

  const newCount = alerts.filter(a => a.status === "new").length;
  const fugaCount = alerts.filter(a => a.type === "defaulter_consulted" && a.status === "new").length;
  const serialCount = alerts.filter(a => a.type === "multiple_consultations" && a.status === "new").length;
  const eqpCount = alerts.filter(a => a.type === "equipment_risk" && a.status === "new").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-slate-400 font-medium">Status:</span>
          {([["all", `Todos (${alerts.length})`], ["new", `Ativos (${newCount})`], ["resolved", "Resolvidos"], ["dismissed", "Ignorados"]] as const).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${statusFilter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}
              data-testid={`filter-${f}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-slate-400 font-medium">Tipo:</span>
          <button
            onClick={() => setTypeFilter("all")}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all ${typeFilter === "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`}
          >
            Todos
          </button>
          {fugaCount > 0 && (
            <button
              onClick={() => setTypeFilter(typeFilter === "defaulter_consulted" ? "all" : "defaulter_consulted")}
              className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-all ${typeFilter === "defaulter_consulted" ? "bg-red-600 text-white border-red-600" : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"}`}
            >
              Tentativas de Fuga ({fugaCount})
            </button>
          )}
          {serialCount > 0 && (
            <button
              onClick={() => setTypeFilter(typeFilter === "multiple_consultations" ? "all" : "multiple_consultations")}
              className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-all ${typeFilter === "multiple_consultations" ? "bg-purple-600 text-white border-purple-600" : "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100"}`}
            >
              Migradores Seriais ({serialCount})
            </button>
          )}
          {eqpCount > 0 && (
            <button
              onClick={() => setTypeFilter(typeFilter === "equipment_risk" ? "all" : "equipment_risk")}
              className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-all ${typeFilter === "equipment_risk" ? "bg-amber-600 text-white border-amber-600" : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"}`}
            >
              Risco Equipamento ({eqpCount})
            </button>
          )}
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              placeholder="Buscar cliente..."
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
              <Shield className="w-7 h-7 text-emerald-600" />
            </div>
            <h3 className="text-base font-semibold text-slate-800 mb-1" data-testid="text-tudo-certo">
              {search || typeFilter !== "all" ? "Nenhum alerta corresponde ao filtro" : statusFilter === "new" ? "Nenhuma tentativa de migracao ativa" : "Nenhum alerta"}
            </h3>
            <p className="text-sm text-slate-400">
              {!search && typeFilter === "all" && statusFilter === "new" && "Os alertas aparecem automaticamente quando um cliente inadimplente seu e consultado por outro provedor."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((alert) => (
            <AlertaMigracaoCard key={alert.id} alert={alert} onResolve={onResolve} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </div>
  );
}

function MigradoresTab({ alerts, customerRisk }: { alerts: AntiFraudAlert[]; customerRisk: CustomerRisk[] }) {
  const customerMap = new Map<string, { name: string; cpf: string; alerts: AntiFraudAlert[]; providers: Set<string> }>();

  for (const alert of alerts) {
    const key = alert.customerCpfCnpj || String(alert.customerId);
    if (!customerMap.has(key)) {
      customerMap.set(key, { name: alert.customerName || "Desconhecido", cpf: key, alerts: [], providers: new Set() });
    }
    const entry = customerMap.get(key)!;
    entry.alerts.push(alert);
    if (alert.consultingProviderName) entry.providers.add(alert.consultingProviderName);
  }

  const migradores = Array.from(customerMap.values())
    .filter(m => m.providers.size >= 2 || m.alerts.filter(a => a.type === "multiple_consultations").length > 0)
    .sort((a, b) => b.providers.size - a.providers.size);

  const recidivas = Array.from(customerMap.values())
    .filter(m => m.alerts.length >= 2 && m.providers.size < 2)
    .sort((a, b) => b.alerts.length - a.alerts.length);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2">
          <Users className="w-4 h-4 text-purple-500" />
          Migradores Seriais Identificados
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          Clientes que foram consultados por multiplos provedores enquanto inadimplentes — perfil classico de migracao em serie.
        </p>

        {migradores.length === 0 ? (
          <Card className="p-6 text-center">
            <Shield className="w-10 h-10 mx-auto mb-2 text-emerald-300" />
            <p className="text-sm text-slate-500">Nenhum migrador serial detectado ainda.</p>
            <p className="text-xs text-slate-400 mt-1">Padrao surge conforme mais consultas sao realizadas na rede.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {migradores.map((m, idx) => {
              const latestAlert = m.alerts.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
              const maxOverdue = Math.max(...m.alerts.map(a => parseFloat(a.overdueAmount || "0")));
              const maxEqp = Math.max(...m.alerts.map(a => parseFloat(a.equipmentValue || "0")));
              const totalPrejuizo = maxOverdue + maxEqp;
              const riskScore = m.providers.size >= 4 ? "critical" : m.providers.size >= 3 ? "high" : "medium";
              return (
                <Card key={idx} className="overflow-hidden border border-purple-200 bg-purple-50/20" data-testid={`migrador-${idx}`}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-purple-500 flex items-center justify-center flex-shrink-0">
                          <UserX className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">MIGRADOR SERIAL</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${riskScore === "critical" ? "bg-red-100 text-red-800" : riskScore === "high" ? "bg-orange-100 text-orange-800" : "bg-amber-100 text-amber-800"}`}>
                              {riskScore === "critical" ? "CRITICO" : riskScore === "high" ? "ALTO" : "MEDIO"}
                            </span>
                          </div>
                          <p className="font-bold text-slate-900">{m.name}</p>
                          <p className="text-xs text-slate-500">{formatCpfCnpj(m.cpf)}</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xl font-black text-purple-700">{m.providers.size}</p>
                        <p className="text-[10px] text-purple-500">provedores consultados</p>
                      </div>
                    </div>

                    <div className="mb-3 p-3 rounded-lg border border-purple-200 bg-white">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Ciclo de Migracao Detectado</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {Array.from(m.providers).map((prov, i, arr) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <span className="text-xs px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 font-medium">{prov}</span>
                            {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-purple-400" />}
                          </div>
                        ))}
                        <ArrowRight className="w-3 h-3 text-purple-300" />
                        <span className="text-xs px-2 py-1 rounded-lg border border-dashed border-purple-300 text-purple-500 font-medium">proximo?</span>
                      </div>
                    </div>

                    {totalPrejuizo > 0 && (
                      <div className="p-2.5 rounded-lg border border-red-200 bg-red-50 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-red-600 font-semibold uppercase">Prejuizo acumulado estimado</p>
                          <p className="text-base font-black text-red-700">{formatCurrency(totalPrejuizo)}</p>
                        </div>
                        <div className="text-right text-xs text-red-500">
                          {maxOverdue > 0 && <p>Mensalidades: {formatCurrency(maxOverdue)}</p>}
                          {maxEqp > 0 && <p>Equipamentos: {formatCurrency(maxEqp)}</p>}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
                      <Clock className="w-3 h-3" />
                      Ultimo alerta: {formatDateTime(latestAlert?.createdAt)} · {m.alerts.length} ocorrencia{m.alerts.length > 1 ? "s" : ""}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {recidivas.length > 0 && (
        <div>
          <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-orange-500" />
            Reincidentes
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            Clientes com multiplas ocorrencias de inadimplencia no historico.
          </p>
          <div className="space-y-2.5">
            {recidivas.slice(0, 10).map((m, idx) => {
              const totalValue = Math.max(...m.alerts.map(a => parseFloat(a.overdueAmount || "0")));
              return (
                <Card key={idx} className="p-3 border border-orange-200 bg-orange-50/20" data-testid={`reincidente-${idx}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm">{m.name}</p>
                      <p className="text-xs text-slate-500">{formatCpfCnpj(m.cpf)} · {m.alerts.length} registros de inadimplencia</p>
                    </div>
                    {totalValue > 0 && (
                      <p className="text-sm font-black text-red-600 flex-shrink-0">{formatCurrency(totalValue)}</p>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
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
  const totalOverdue = customerRisk.reduce((s, c) => s + c.overdueAmount, 0);
  const totalEquipment = customerRisk.reduce((s, c) => s + c.equipmentValue, 0);

  if (isLoading) {
    return (
      <Card className="p-8">
        <div className="text-center py-8 text-slate-400">
          <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin opacity-50" />
          <p className="text-sm">Calculando risco de migracao...</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Flame className="w-4 h-4 text-red-500" />
            <span className="text-xs font-semibold text-slate-600">Risco Critico</span>
          </div>
          <p className="text-2xl font-black text-red-600">{criticalCount}</p>
          <p className="text-xs text-slate-400">clientes monitorados</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-semibold text-slate-600">Risco Alto</span>
          </div>
          <p className="text-2xl font-black text-orange-600">{highCount}</p>
          <p className="text-xs text-slate-400">clientes monitorados</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-red-500" />
            <span className="text-xs font-semibold text-slate-600">Total em Aberto</span>
          </div>
          <p className="text-sm font-black text-red-600">{formatCurrency(totalOverdue)}</p>
          <p className="text-xs text-slate-400">mensalidades nao pagas</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Package className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-semibold text-slate-600">Equipamentos</span>
          </div>
          <p className="text-sm font-black text-amber-600">{formatCurrency(totalEquipment)}</p>
          <p className="text-xs text-slate-400">em risco de perda</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-slate-400" />
              Clientes com Maior Risco de Migracao
            </h3>
            <p className="text-xs text-slate-400">Monitorados continuamente — score baseado em atraso, divida, equipamentos e padrao de consultas</p>
          </div>
          <div className="flex items-center gap-1">
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
              const cfg = getRiskLevelConfig(customer.riskLevel);
              const totalRisco = customer.overdueAmount + customer.equipmentValue;
              return (
                <div key={customer.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors" data-testid={`risk-customer-${customer.id}`}>
                  <span className="text-sm font-black text-slate-300 w-6 flex-shrink-0 text-right">#{idx + 1}</span>
                  <div className={`w-1.5 h-10 rounded-full flex-shrink-0 ${cfg.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-slate-900 truncate">{customer.name}</p>
                    <p className="text-xs text-slate-400">{formatCpfCnpj(customer.cpfCnpj)}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${customer.riskLevel === "critical" ? "bg-red-500" : customer.riskLevel === "high" ? "bg-orange-500" : customer.riskLevel === "medium" ? "bg-amber-500" : "bg-emerald-500"}`}
                          style={{ width: `${customer.riskScore}%` }}
                        />
                      </div>
                      <span className={`text-xs font-bold ${customer.riskLevel === "critical" ? "text-red-600" : customer.riskLevel === "high" ? "text-orange-600" : "text-amber-600"}`}>{customer.riskScore}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 text-right">
                    {customer.daysOverdue > 0 && (
                      <div className="hidden sm:block">
                        <p className="text-xs font-bold text-red-600">{customer.daysOverdue}d atraso</p>
                        <p className="text-[10px] text-slate-400">{formatCurrency(customer.overdueAmount)}</p>
                      </div>
                    )}
                    {customer.equipmentNotReturned > 0 && (
                      <div className="hidden sm:block">
                        <p className="text-xs font-bold text-amber-600">{customer.equipmentNotReturned} equip.</p>
                        <p className="text-[10px] text-slate-400">{formatCurrency(customer.equipmentValue)}</p>
                      </div>
                    )}
                    {totalRisco > 0 && (
                      <div>
                        <p className="text-xs font-black text-red-700">{formatCurrency(totalRisco)}</p>
                        <p className="text-[10px] text-slate-400">em risco</p>
                      </div>
                    )}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
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

function renderAIText(text: string) {
  return text.split("\n").map((line, i) => {
    const t = line.trim();
    if (!t) return <div key={i} className="h-2" />;
    const isHeader = /^[A-ZÁÉÍÓÚÂÊÔÀÃÕ\s]{4,}$/.test(t) && t === t.toUpperCase() && t.length > 3;
    if (isHeader) return <p key={i} className="font-bold text-slate-800 mt-4 mb-1 text-sm uppercase tracking-wide border-b border-indigo-100 pb-1">{t}</p>;
    if (t.startsWith("- ") || t.startsWith("• ")) return (
      <p key={i} className="text-sm text-slate-700 pl-3 flex gap-2">
        <span className="text-indigo-400 mt-0.5 flex-shrink-0">•</span>
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
  const fugaAlerts = activeAlerts.filter(a => a.type === "defaulter_consulted");
  const serialAlerts = activeAlerts.filter(a => a.type === "multiple_consultations");
  const totalPrejuizo = activeAlerts.reduce((sum, a) => sum + parseFloat(a.overdueAmount || "0") + parseFloat(a.equipmentValue || "0"), 0);
  const criticalCount = activeAlerts.filter(a => a.riskLevel === "critical").length;

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
          <WifiOff className="w-4 h-4 text-red-500 mb-2" />
          <p className="text-2xl font-black text-red-700">{fugaAlerts.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">Tentativas de fuga ativas</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <Users className="w-4 h-4 text-purple-500 mb-2" />
          <p className="text-2xl font-black text-purple-700">{serialAlerts.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">Migradores seriais detectados</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <DollarSign className="w-4 h-4 text-red-500 mb-2" />
          <p className="text-lg font-black text-red-700">{formatCurrency(totalPrejuizo)}</p>
          <p className="text-xs text-slate-500 mt-0.5">Prejuizo total em risco</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <Flame className="w-4 h-4 text-orange-500 mb-2" />
          <p className="text-2xl font-black text-orange-700">{criticalCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Casos criticos ativos</p>
        </div>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
              <BrainCircuit className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Analise com IA — Padrao de Fraude por Migracao</h3>
              <p className="text-xs text-slate-400">Identificacao de perfis, ciclos e recomendacoes para reducao de prejuizos</p>
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
            {aiLoading ? "Analisando..." : aiText ? "Nova Analise" : "Analisar Padroes de Fraude"}
          </Button>
        </div>

        {!aiText && !aiLoading && !aiError && (
          <div className="text-center py-10 border-2 border-dashed border-indigo-100 rounded-xl bg-indigo-50/30">
            <BrainCircuit className="w-12 h-12 mx-auto mb-3 text-indigo-200" />
            <p className="text-sm text-slate-600 font-medium">Analise de Padrao de Fraude por Migracao</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              A IA analisa o comportamento dos seus clientes inadimplentes, identifica migradores seriais
              e recomenda acoes para reduzir prejuizos com equipamentos e mensalidades nao pagas.
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
          Acoes Prioritarias para Reducao de Prejuizo
        </h3>
        <div className="space-y-2.5">
          {fugaAlerts.length > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-red-200 bg-red-50">
              <div className="w-8 h-8 rounded-lg bg-red-500 flex items-center justify-center flex-shrink-0">
                <WifiOff className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-red-800">{fugaAlerts.length} cliente{fugaAlerts.length > 1 ? "s" : ""} tentando migrar — agir antes que saiam</p>
                <p className="text-xs text-red-600 mt-0.5">Contatar agora pode evitar perda de equipamentos e zerar a divida</p>
              </div>
              <Button size="sm" variant="outline" className="text-xs flex-shrink-0 border-red-300 text-red-700 hover:bg-red-100">Contatar</Button>
            </div>
          )}
          {serialAlerts.length > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-purple-200 bg-purple-50">
              <div className="w-8 h-8 rounded-lg bg-purple-500 flex items-center justify-center flex-shrink-0">
                <UserX className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-purple-800">{serialAlerts.length} migrador{serialAlerts.length > 1 ? "es" : ""} serial detectado{serialAlerts.length > 1 ? "s" : ""}</p>
                <p className="text-xs text-purple-600 mt-0.5">Registre no banco colaborativo para alertar outros provedores da rede</p>
              </div>
              <Button size="sm" variant="outline" className="text-xs flex-shrink-0 border-purple-300 text-purple-700 hover:bg-purple-100">Ver Perfis</Button>
            </div>
          )}
          <div className="flex items-center gap-3 p-3 rounded-xl border border-amber-200 bg-amber-50">
            <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center flex-shrink-0">
              <Package className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-800">Iniciar processo de recuperacao de equipamentos</p>
              <p className="text-xs text-amber-600 mt-0.5">Clientes em processo de migracao raramente devolvem equipamentos voluntariamente</p>
            </div>
            <Button size="sm" variant="outline" className="text-xs flex-shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100">Agendar</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function RegrasTab() {
  const [rules, setRules] = useState([
    {
      id: 1, name: "Fuga Detectada — Inadimplente Consultado", priority: 1, active: true,
      condition: "cliente_inadimplente AND consultado_por_outro_provedor",
      action: "criar_alerta(TENTATIVA_DE_FUGA, risco_calculado), notificar_provedor",
      desc: "Dispara alerta imediato quando um cliente seu com divida em aberto e consultado por outro provedor — indicativo de que esta planejando migrar.",
    },
    {
      id: 2, name: "Migrador Serial — Multiplas Consultas", priority: 2, active: true,
      condition: "consultas_em_30_dias >= 3",
      action: "criar_alerta(MIGRADOR_SERIAL, risco=80), notificar_todos_provedores",
      desc: "Identifica CPF consultado por 3 ou mais provedores em 30 dias — padrao classico de cliente rodando entre operadoras.",
    },
    {
      id: 3, name: "Equipamento em Risco de Perda", priority: 3, active: true,
      condition: "equipamento_nao_devolvido AND consultado_por_outro_provedor",
      action: "criar_alerta(RISCO_EQUIPAMENTO, urgente), iniciar_processo_recuperacao",
      desc: "Quando cliente com equipamento pendente e consultado por outro provedor, o risco de perda definitiva do equipamento e elevado.",
    },
    {
      id: 4, name: "Contrato Recente com Consulta Externa", priority: 4, active: true,
      condition: "contrato_age < 90_dias AND consultado_por_outro_provedor",
      action: "criar_alerta(CONTRATO_RECENTE), revisar_credito",
      desc: "Cliente com menos de 90 dias de contrato sendo consultado por outros — pode indicar intencao de migracao rapida apos instalacao.",
    },
    {
      id: 5, name: "Score de Migracao Critico", priority: 5, active: false,
      condition: "risco_migracao >= 75 AND nao_pagou_ultimas_3_faturas",
      action: "bloquear_aprovacao_automatica, exigir_revisao_manual",
      desc: "Bloqueia aprovacao automatica de clientes com historico critico de migracao e tres ou mais faturas em atraso.",
    },
  ]);

  const toggleRule = (id: number) => setRules(rules.map(r => r.id === id ? { ...r, active: !r.active } : r));

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl border border-blue-200 bg-blue-50">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-blue-900">Como as regras funcionam</p>
            <p className="text-xs text-blue-700 mt-1">
              As regras sao avaliadas automaticamente a cada consulta ISP realizada na plataforma.
              Quando um provedor consulta um CPF, o sistema verifica se esse CPF pertence a clientes
              inadimplentes de outros provedores e dispara os alertas configurados.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-900">Regras de Deteccao de Fraude</h3>
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
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`w-2 h-2 rounded-full ${rule.active ? "bg-emerald-500" : "bg-slate-300"}`} />
                      <span className="font-bold text-slate-900 text-sm">{rule.name}</span>
                      <span className="text-[10px] text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded font-medium">P{rule.priority}</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">{rule.desc}</p>
                  </div>
                  <Switch checked={rule.active} onCheckedChange={() => toggleRule(rule.id)} data-testid={`switch-rule-${rule.id}`} />
                </div>
                <div className="bg-slate-50 rounded-lg p-3 font-mono text-xs space-y-1 border border-slate-100 mt-2">
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
  const [alertDefaulter, setAlertDefaulter] = useState(true);
  const [alertSerial, setAlertSerial] = useState(true);
  const [alertEquipment, setAlertEquipment] = useState(true);
  const [minOverdueDays, setMinOverdueDays] = useState("1");
  const [maxConsultations, setMaxConsultations] = useState("3");
  const [minEquipmentValue, setMinEquipmentValue] = useState("100");
  const [notifyCritical, setNotifyCritical] = useState(true);
  const [notifyHigh, setNotifyHigh] = useState(true);
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
            <Label htmlFor="toggle-enabled" className="font-semibold text-slate-900 cursor-pointer">Protecao Anti-Fraude por Migracao</Label>
            <p className="text-xs text-slate-400 mt-0.5">Monitora automaticamente clientes inadimplentes a cada consulta ISP na rede</p>
          </div>
          <Switch id="toggle-enabled" checked={enabled} onCheckedChange={setEnabled} data-testid="switch-enabled" />
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <Bell className="w-4 h-4 text-slate-400" />
          Tipos de Alerta
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-100">
            <div>
              <Label className="font-semibold text-red-900 cursor-pointer">Tentativa de Fuga</Label>
              <p className="text-xs text-red-600 mt-0.5">Alertar quando cliente inadimplente e consultado por outro provedor</p>
            </div>
            <Switch checked={alertDefaulter} onCheckedChange={setAlertDefaulter} data-testid="switch-alert-defaulter" />
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-purple-50 border border-purple-100">
            <div>
              <Label className="font-semibold text-purple-900 cursor-pointer">Migrador Serial</Label>
              <p className="text-xs text-purple-600 mt-0.5">Alertar quando CPF e consultado por multiplos provedores</p>
            </div>
            <Switch checked={alertSerial} onCheckedChange={setAlertSerial} data-testid="switch-alert-serial" />
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50 border border-amber-100">
            <div>
              <Label className="font-semibold text-amber-900 cursor-pointer">Risco de Equipamento</Label>
              <p className="text-xs text-amber-600 mt-0.5">Alertar quando cliente com equipamento pendente tenta migrar</p>
            </div>
            <Switch checked={alertEquipment} onCheckedChange={setAlertEquipment} data-testid="switch-alert-equipment" />
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <Target className="w-4 h-4 text-slate-400" />
          Limites de Deteccao
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">Dias minimos de atraso</Label>
            <Input type="number" value={minOverdueDays} onChange={(e) => setMinOverdueDays(e.target.value)} className="h-9" data-testid="input-min-overdue-days" />
            <p className="text-[10px] text-slate-400">para gerar alerta de fuga</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">Consultas em 30 dias</Label>
            <Input type="number" value={maxConsultations} onChange={(e) => setMaxConsultations(e.target.value)} className="h-9" data-testid="input-max-consultations" />
            <p className="text-[10px] text-slate-400">para classificar como migrador serial</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">Valor minimo equipamento (R$)</Label>
            <Input type="number" value={minEquipmentValue} onChange={(e) => setMinEquipmentValue(e.target.value)} className="h-9" data-testid="input-min-equipment-value" />
            <p className="text-[10px] text-slate-400">para gerar alerta de risco de perda</p>
          </div>
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
              <Label className="font-semibold text-slate-900">Notificar tentativas de fuga (CRITICO)</Label>
              <p className="text-xs text-slate-400">Email imediato quando cliente inadimplente e consultado</p>
            </div>
            <Switch checked={notifyCritical} onCheckedChange={setNotifyCritical} data-testid="switch-notify-critical" />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-semibold text-slate-900">Notificar risco de equipamento (ALTO)</Label>
              <p className="text-xs text-slate-400">Email quando risco de perda de equipamento e detectado</p>
            </div>
            <Switch checked={notifyHigh} onCheckedChange={setNotifyHigh} data-testid="switch-notify-high" />
          </div>
        </div>
      </Card>

      <Button className="w-full gap-2" onClick={() => toast({ title: "Configuracoes salvas" })} data-testid="button-save-config">
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
  const fugaAttempts = activeAlerts.filter(a => a.type === "defaulter_consulted");
  const serialMigrators = activeAlerts.filter(a => a.type === "multiple_consultations");
  const totalPrejuizo = activeAlerts.reduce((s, a) => s + parseFloat(a.overdueAmount || "0") + parseFloat(a.equipmentValue || "0"), 0);
  const equipmentAtRisk = activeAlerts.filter(a => (a.equipmentNotReturned || 0) > 0);
  const totalEquipmentValue = equipmentAtRisk.reduce((s, a) => s + parseFloat(a.equipmentValue || "0"), 0);

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto" data-testid="anti-fraude-page">

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-600 to-rose-800 flex items-center justify-center shadow-md">
            <ShieldAlert className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900" data-testid="text-anti-fraude-title">Anti-Fraude — Migracao Serial</h1>
            <p className="text-sm text-slate-500">Protege seu provedor contra clientes que migram sem pagar e sem devolver equipamentos</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {fugaAttempts.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-red-100 text-red-700 border border-red-200 animate-pulse" data-testid="badge-fuga-count">
              <WifiOff className="w-3.5 h-3.5" /> {fugaAttempts.length} Tentativa{fugaAttempts.length > 1 ? "s" : ""} de Fuga
            </span>
          )}
          {serialMigrators.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-purple-100 text-purple-700 border border-purple-200" data-testid="badge-serial-count">
              <Users className="w-3.5 h-3.5" /> {serialMigrators.length} Migrador{serialMigrators.length > 1 ? "es" : ""} Serial
            </span>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/alerts"] }); queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/customer-risk"] }); }} data-testid="button-refresh">
            <RefreshCw className="w-3.5 h-3.5" />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <PrejuizoCard
          label="Tentativas de Fuga"
          value={fugaAttempts.length}
          sub="clientes tentando migrar"
          icon={WifiOff}
          color="bg-red-500"
          alert={fugaAttempts.length > 0}
        />
        <PrejuizoCard
          label="Migradores Seriais"
          value={serialMigrators.length}
          sub="consultados por 3+ provedores"
          icon={UserX}
          color="bg-purple-500"
        />
        <PrejuizoCard
          label="Prejuizo em Risco"
          value={formatCurrency(totalPrejuizo)}
          sub="dividas + equipamentos"
          icon={DollarSign}
          color="bg-rose-600"
          alert={totalPrejuizo > 0}
        />
        <PrejuizoCard
          label="Equipamentos Ameacados"
          value={equipmentAtRisk.length > 0 ? formatCurrency(totalEquipmentValue) : equipmentAtRisk.length}
          sub={equipmentAtRisk.length > 0 ? `${equipmentAtRisk.length} item(ns) em risco` : "nenhum em risco"}
          icon={Package}
          color="bg-amber-500"
        />
      </div>

      {activeAlerts.length === 0 && !alertsLoading && (
        <Card className="p-5 border-emerald-200 bg-emerald-50/30">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-bold text-emerald-900">Nenhuma tentativa de migracao ativa</p>
              <p className="text-sm text-emerald-700">
                Os alertas aparecem automaticamente quando um cliente seu com divida e consultado por outro provedor.
                Quanto mais provedores utilizarem a plataforma, mais eficaz e a protecao da rede colaborativa.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Tabs defaultValue="alertas" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1 bg-slate-100/80 p-1 rounded-xl">
          <TabsTrigger value="alertas" className="gap-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm" data-testid="tab-alertas">
            <Bell className="w-3.5 h-3.5" />
            Alertas
            {activeAlerts.length > 0 && (
              <span className="ml-1 h-5 min-w-5 text-xs px-1.5 bg-red-500 text-white rounded-full flex items-center justify-center font-bold">{activeAlerts.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="migradores" className="gap-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm" data-testid="tab-migradores">
            <UserX className="w-3.5 h-3.5" />
            Migradores
            {serialMigrators.length > 0 && (
              <span className="ml-1 h-5 min-w-5 text-xs px-1.5 bg-purple-500 text-white rounded-full flex items-center justify-center font-bold">{serialMigrators.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="score" className="gap-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm" data-testid="tab-score">
            <BarChart3 className="w-3.5 h-3.5" />
            Score de Risco
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

        <TabsContent value="migradores">
          <MigradoresTab alerts={alerts} customerRisk={customerRisk} />
        </TabsContent>

        <TabsContent value="score">
          <ScoreRiscoTab customerRisk={customerRisk} isLoading={riskLoading} />
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

