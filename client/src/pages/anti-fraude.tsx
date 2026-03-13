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
  ShieldAlert, Bell, BarChart3, BrainCircuit, Settings,
  CheckCircle, RefreshCw, AlertTriangle, DollarSign,
  Package, Phone, XCircle, ChevronDown, ChevronUp,
  Search, Users, Shield, AlertCircle, Flame,
  ArrowRight, Building2, UserX, Wifi, WifiOff, Clock,
  Zap, BookOpen, TrendingUp,
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

function fmt(doc: string): string {
  const d = doc.replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc;
}

function money(v: number | string | null | undefined): string {
  const n = typeof v === "string" ? parseFloat(v) : (v || 0);
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ago(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor(diff / 60000);
  if (d > 0) return `${d}d atras`;
  if (h > 0) return `${h}h atras`;
  if (m > 0) return `${m}min`;
  return "agora";
}

function alertConfig(type: string) {
  switch (type) {
    case "defaulter_consulted": return {
      tag: "PENDENCIA ATIVA", color: "red",
      border: "border-l-red-400", bg: "bg-red-50/40",
      badge: "bg-red-100 text-red-700",
      icon: WifiOff, iconBg: "bg-red-500",
      desc: "Cliente com contrato ativo buscando novo provedor sem regularizar pendencias",
    };
    case "multiple_consultations": return {
      tag: "PERFIL SERIAL", color: "purple",
      border: "border-l-purple-400", bg: "bg-purple-50/30",
      badge: "bg-purple-100 text-purple-700",
      icon: Users, iconBg: "bg-purple-500",
      desc: "Consultou varios provedores em curto periodo — padrao recorrente sem pagamento",
    };
    case "equipment_risk": return {
      tag: "EQUIPAMENTO", color: "amber",
      border: "border-l-amber-400", bg: "bg-amber-50/30",
      badge: "bg-amber-100 text-amber-700",
      icon: Package, iconBg: "bg-amber-500",
      desc: "Equipamento em comodato pendente — risco de perda se o cliente migrar",
    };
    default: return {
      tag: "ALERTA", color: "slate",
      border: "border-l-slate-300", bg: "bg-white",
      badge: "bg-slate-100 text-slate-600",
      icon: AlertCircle, iconBg: "bg-slate-400",
      desc: "",
    };
  }
}

function riskCfg(level: string) {
  switch (level) {
    case "critical": return { label: "Critico", bar: "bg-red-500", text: "text-red-600", badge: "bg-red-100 text-red-700" };
    case "high":     return { label: "Alto",    bar: "bg-orange-500", text: "text-orange-600", badge: "bg-orange-100 text-orange-700" };
    case "medium":   return { label: "Medio",   bar: "bg-amber-500", text: "text-amber-600", badge: "bg-amber-100 text-amber-700" };
    default:         return { label: "Baixo",   bar: "bg-emerald-500", text: "text-emerald-600", badge: "bg-emerald-100 text-emerald-700" };
  }
}

function AlertCard({ alert, onResolve, onDismiss }: {
  alert: AntiFraudAlert;
  onResolve: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = alertConfig(alert.type);
  const risk = riskCfg(alert.riskLevel || "low");
  const Icon = cfg.icon;
  const overdueVal = parseFloat(alert.overdueAmount || "0");
  const eqpVal = parseFloat(alert.equipmentValue || "0");
  const total = overdueVal + eqpVal;
  const isResolved = alert.status !== "new";

  return (
    <div
      className={`border-l-4 ${cfg.border} rounded-r-xl border border-l-4 border-slate-100 ${cfg.bg} ${isResolved ? "opacity-60" : ""}`}
      data-testid={`alert-card-${alert.id}`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl ${cfg.iconBg} flex items-center justify-center flex-shrink-0`}>
            <Icon className="w-4 h-4 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.tag}</span>
                <span className={`text-[10px] font-semibold ${risk.text}`}>{risk.label}{alert.riskScore ? ` · ${alert.riskScore}` : ""}</span>
                {isResolved && <span className="text-[10px] text-slate-400">{alert.status === "resolved" ? "RESOLVIDO" : "IGNORADO"}</span>}
              </div>
              <span className="text-[10px] text-slate-400 flex-shrink-0">{ago(alert.createdAt)}</span>
            </div>

            <p className="font-bold text-slate-900 text-sm leading-tight" data-testid={`alert-customer-${alert.id}`}>
              {alert.customerName}
            </p>
            {alert.customerCpfCnpj && (
              <p className="text-xs text-slate-400">{fmt(alert.customerCpfCnpj)}</p>
            )}
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{cfg.desc}</p>

            {alert.consultingProviderName && (
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                <Wifi className="w-3 h-3" />
                Cliente consultou outro provedor para nova contratacao
              </p>
            )}
          </div>
        </div>

        {(overdueVal > 0 || eqpVal > 0 || (alert.daysOverdue || 0) > 0) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(alert.daysOverdue || 0) > 0 && (
              <div className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-slate-200">
                <span className="text-slate-400">Atraso: </span>
                <span className="font-bold text-red-600">{alert.daysOverdue} dias</span>
              </div>
            )}
            {overdueVal > 0 && (
              <div className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-slate-200">
                <span className="text-slate-400">Em aberto: </span>
                <span className="font-bold text-red-600">{money(overdueVal)}</span>
              </div>
            )}
            {eqpVal > 0 && (
              <div className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-amber-200">
                <span className="text-amber-600">Equipamento: </span>
                <span className="font-bold text-amber-700">{money(eqpVal)}</span>
              </div>
            )}
            {(alert.recentConsultations || 0) > 1 && (
              <div className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-purple-200">
                <span className="text-purple-600">{alert.recentConsultations} provedores</span>
              </div>
            )}
            {total > 0 && (
              <div className="text-xs px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-200 ml-auto">
                <span className="text-red-500">Prejuizo em risco: </span>
                <span className="font-black text-red-700">{money(total)}</span>
              </div>
            )}
          </div>
        )}

        {alert.riskFactors && alert.riskFactors.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
            data-testid={`button-factors-${alert.id}`}
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {alert.riskFactors.length} indicadores de risco
          </button>
        )}
        {expanded && alert.riskFactors && (
          <ul className="mt-2 space-y-0.5 pl-1">
            {alert.riskFactors.map((f, i) => (
              <li key={i} className="text-xs text-slate-500 flex items-center gap-1.5">
                <span className={`w-1 h-1 rounded-full flex-shrink-0 ${risk.bar}`} />
                {f}
              </li>
            ))}
          </ul>
        )}

        {!isResolved && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/60">
            <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs px-3" onClick={() => onResolve(alert.id)} data-testid={`button-resolve-${alert.id}`}>
              <CheckCircle className="w-3 h-3" /> Resolvido
            </Button>
            <Button size="sm" variant="outline" className="gap-1 h-7 text-xs px-3 bg-white" onClick={() => onDismiss(alert.id)} data-testid={`button-dismiss-${alert.id}`}>
              <XCircle className="w-3 h-3" /> Ignorar
            </Button>
            <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs ml-auto text-slate-500" data-testid={`button-contact-${alert.id}`}>
              <Phone className="w-3 h-3" /> Contatar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function MonitoramentoTab({ alerts, customerRisk, onResolve, onDismiss, isLoading }: {
  alerts: AntiFraudAlert[];
  customerRisk: CustomerRisk[];
  onResolve: (id: number) => void;
  onDismiss: (id: number) => void;
  isLoading: boolean;
}) {
  const [status, setStatus] = useState<"new" | "all" | "resolved">("new");
  const [search, setSearch] = useState("");
  const [showRisk, setShowRisk] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const [aiError, setAiError] = useState("");
  const [showAI, setShowAI] = useState(false);

  const filtered = alerts.filter(a => {
    if (status === "new" && a.status !== "new") return false;
    if (status === "resolved" && a.status === "new") return false;
    if (search) {
      const q = search.toLowerCase();
      return (a.customerName?.toLowerCase().includes(q) || a.customerCpfCnpj?.includes(q));
    }
    return true;
  });

  const active = alerts.filter(a => a.status === "new");
  const resolved = alerts.filter(a => a.status !== "new");

  const runAI = async () => {
    setAiText(""); setAiLoading(true); setAiDone(false); setAiError(""); setShowAI(true);
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
              const p = JSON.parse(payload);
              if (p.error) { setAiError(p.error); break; }
              if (p.text) setAiText(prev => prev + p.text);
            } catch {}
          }
        }
      }
    } catch (e: any) { setAiError(e.message); }
    finally { setAiLoading(false); setAiDone(true); }
  };

  const criticalRisk = customerRisk.filter(c => c.riskLevel === "critical" || c.riskLevel === "high");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
          {([["new", `Ativos (${active.length})`], ["all", `Todos (${alerts.length})`], ["resolved", `Historico (${resolved.length})`]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setStatus(v)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${status === v ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-800"}`}
              data-testid={`filter-${v}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <Input placeholder="Buscar cliente..." className="pl-8 h-8 text-xs w-40 bg-white" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search" />
        </div>
        <Button size="sm" variant="outline" className={`gap-1.5 h-8 text-xs ${showRisk ? "bg-slate-900 text-white border-slate-900" : "bg-white"}`} onClick={() => setShowRisk(!showRisk)} data-testid="button-toggle-risk">
          <BarChart3 className="w-3.5 h-3.5" />
          Score de Risco
        </Button>
        <Button size="sm" variant="outline" className={`gap-1.5 h-8 text-xs ${showAI ? "bg-indigo-600 text-white border-indigo-600" : "bg-white"}`} onClick={!aiText ? runAI : () => setShowAI(!showAI)} disabled={aiLoading} data-testid="button-ai">
          <BrainCircuit className="w-3.5 h-3.5" />
          {aiLoading ? "Analisando..." : "Analise IA"}
        </Button>
      </div>

      {showAI && (
        <Card className="p-4 border-indigo-100 bg-indigo-50/30">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 text-indigo-500" />
              <span className="text-sm font-semibold text-slate-800">Analise de Padrao de Fraude</span>
              {aiLoading && <span className="text-xs text-indigo-500 flex items-center gap-1"><div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /> Analisando...</span>}
              {aiDone && !aiError && <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Pronto</span>}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={runAI} disabled={aiLoading}>Nova analise</Button>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setShowAI(false)}><XCircle className="w-3.5 h-3.5 text-slate-400" /></Button>
            </div>
          </div>
          {aiError && <p className="text-sm text-red-600 p-2 bg-red-50 rounded-lg">{aiError}</p>}
          {!aiText && !aiLoading && !aiError && <p className="text-sm text-slate-400 text-center py-4">Clique em "Nova analise" para gerar insights sobre os padroes de fraude</p>}
          {aiText && (
            <div className="text-sm text-slate-700 space-y-1 leading-relaxed">
              {aiText.split("\n").map((line, i) => {
                const t = line.trim();
                if (!t) return <div key={i} className="h-1" />;
                const isH = /^[A-ZÁÉÍÓÚÂÊÔÀÃÕ\s]{4,}$/.test(t) && t === t.toUpperCase();
                if (isH) return <p key={i} className="font-bold text-slate-900 mt-3 mb-1 text-xs uppercase tracking-wide">{t}</p>;
                if (t.startsWith("- ") || t.startsWith("• ")) return (
                  <p key={i} className="flex gap-2 text-slate-600">
                    <span className="text-indigo-400 flex-shrink-0">•</span>
                    {t.replace(/^[-•]\s+/, "")}
                  </p>
                );
                return <p key={i}>{t}</p>;
              })}
              {aiLoading && <span className="inline-block w-1 h-4 bg-indigo-500 animate-pulse ml-0.5 rounded-sm" />}
            </div>
          )}
        </Card>
      )}

      {showRisk && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-slate-400" />
              Clientes com Maior Risco de Migracao
            </h3>
            <button onClick={() => setShowRisk(false)} className="text-slate-400 hover:text-slate-600"><XCircle className="w-4 h-4" /></button>
          </div>
          {criticalRisk.length === 0 ? (
            <p className="text-sm text-slate-400 p-4 text-center">Nenhum cliente com risco alto identificado</p>
          ) : (
            <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
              {criticalRisk.slice(0, 10).map((c, i) => {
                const cfg = riskCfg(c.riskLevel);
                return (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-2.5" data-testid={`risk-${c.id}`}>
                    <span className="text-xs text-slate-300 w-5 text-right font-bold">#{i + 1}</span>
                    <div className={`w-1 h-8 rounded-full flex-shrink-0 ${cfg.bar}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full ${cfg.bar}`} style={{ width: `${c.riskScore}%` }} />
                        </div>
                        <span className={`text-xs font-bold ${cfg.text}`}>{c.riskScore}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {(c.overdueAmount + c.equipmentValue) > 0 && (
                        <p className="text-xs font-bold text-red-600">{money(c.overdueAmount + c.equipmentValue)}</p>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${cfg.badge}`}>{cfg.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Carregando alertas...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-7 h-7 text-emerald-500" />
          </div>
          <p className="text-base font-bold text-slate-800" data-testid="text-empty">
            {status === "new" ? "Nenhum alerta no momento" : "Nenhum alerta encontrado"}
          </p>
          {status === "new" && (
            <p className="text-sm text-slate-400 mt-2 max-w-sm mx-auto leading-relaxed">
              Quando um cliente com contrato ativo tiver pendencias e buscar um novo provedor, o alerta aparece aqui automaticamente.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(alert => (
            <AlertCard key={alert.id} alert={alert} onResolve={onResolve} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </div>
  );
}

function MigradoresTab({ alerts }: { alerts: AntiFraudAlert[] }) {
  const map = new Map<string, { name: string; cpf: string; alerts: AntiFraudAlert[]; isps: Set<string> }>();
  for (const a of alerts) {
    const k = a.customerCpfCnpj || String(a.customerId);
    if (!map.has(k)) map.set(k, { name: a.customerName || "?", cpf: k, alerts: [], isps: new Set() });
    const e = map.get(k)!;
    e.alerts.push(a);
    if (a.consultingProviderName) e.isps.add(a.consultingProviderName);
  }

  const serial = [...map.values()].filter(m => m.isps.size >= 2 || m.alerts.some(a => a.type === "multiple_consultations")).sort((a, b) => b.isps.size - a.isps.size);
  const reaped = [...map.values()].filter(m => m.alerts.length >= 2 && m.isps.size < 2).sort((a, b) => b.alerts.length - a.alerts.length);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <UserX className="w-4 h-4 text-purple-500" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">Migradores Seriais</h3>
            <p className="text-xs text-slate-400">CPF consultou varios provedores enquanto inadimplente</p>
          </div>
        </div>
        {serial.length === 0 ? (
          <Card className="p-6 text-center border-dashed">
            <p className="text-sm text-slate-400">Nenhum migrador serial identificado ainda</p>
            <p className="text-xs text-slate-300 mt-1">Padrao surge conforme mais provedores utilizam a plataforma</p>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {serial.map((m, i) => {
              const last = m.alerts.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
              const div = Math.max(...m.alerts.map(a => parseFloat(a.overdueAmount || "0")));
              const eqp = Math.max(...m.alerts.map(a => parseFloat(a.equipmentValue || "0")));
              const total = div + eqp;
              return (
                <Card key={i} className="p-4 border border-purple-100 bg-purple-50/20" data-testid={`migrador-${i}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-purple-500 flex items-center justify-center flex-shrink-0">
                      <UserX className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">PERFIL SERIAL</span>
                          </div>
                          <p className="font-bold text-slate-900 text-sm">{m.name}</p>
                          <p className="text-xs text-slate-400">{fmt(m.cpf)}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xl font-black text-purple-700">{m.isps.size > 0 ? m.isps.size : m.alerts.length}</p>
                          <p className="text-[10px] text-purple-400">{m.isps.size > 0 ? "provedores" : "ocorrencias"}</p>
                        </div>
                      </div>

                      {m.isps.size > 0 && (
                        <div className="flex items-center gap-1 mt-2 flex-wrap">
                          {[...m.isps].map((isp, j, arr) => (
                            <div key={j} className="flex items-center gap-1">
                              <span className="text-xs px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-lg text-slate-600 font-medium">{isp}</span>
                              {j < arr.length - 1 && <ArrowRight className="w-3 h-3 text-purple-300" />}
                            </div>
                          ))}
                          <ArrowRight className="w-3 h-3 text-purple-200" />
                          <span className="text-xs px-2 py-0.5 border border-dashed border-purple-300 rounded-lg text-purple-400">proximo?</span>
                        </div>
                      )}

                      {total > 0 && (
                        <div className="mt-2 text-xs">
                          <span className="text-red-500">Prejuizo estimado: </span>
                          <span className="font-black text-red-700">{money(total)}</span>
                          <span className="text-slate-400 ml-2">· {ago(last?.createdAt)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {reaped.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">Reincidentes</h3>
              <p className="text-xs text-slate-400">Multiplas ocorrencias de inadimplencia no historico</p>
            </div>
          </div>
          <div className="space-y-2">
            {reaped.slice(0, 8).map((m, i) => {
              const val = Math.max(...m.alerts.map(a => parseFloat(a.overdueAmount || "0")));
              return (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-orange-100 bg-orange-50/20" data-testid={`reincidente-${i}`}>
                  <div className="w-7 h-7 rounded-lg bg-orange-400 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{m.name}</p>
                    <p className="text-xs text-slate-400">{fmt(m.cpf)} · {m.alerts.length} registros</p>
                  </div>
                  {val > 0 && <p className="text-sm font-black text-red-600 flex-shrink-0">{money(val)}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigTab() {
  const [enabled, setEnabled] = useState(true);
  const [alertDebt, setAlertDebt] = useState(true);
  const [alertSerial, setAlertSerial] = useState(true);
  const [alertEqp, setAlertEqp] = useState(true);
  const [minDays, setMinDays] = useState("1");
  const [maxConsu, setMaxConsu] = useState("3");
  const [minEqp, setMinEqp] = useState("100");
  const [emails, setEmails] = useState([""]);
  const [showRules, setShowRules] = useState(false);
  const { toast } = useToast();

  const rules = [
    { id: 1, name: "Pendencia Ativa — Contrato Ativo ou Recem Cancelado", active: true, condition: "contrato_ativo_ou_cancelado_90d AND inadimplente", action: "criar_alerta(PENDENCIA_ATIVA)", desc: "Dispara apenas quando o cliente tem contrato ativo ou cancelado nos ultimos 90 dias, garantindo assertividade." },
    { id: 2, name: "Perfil Serial — Multiplas Consultas em 30 dias", active: true, condition: "consultas_30d >= 3", action: "criar_alerta(PERFIL_SERIAL, score=80)", desc: "CPF que consultou 3+ provedores em 30 dias — padrao de migracao sem pagamento." },
    { id: 3, name: "Equipamento Pendente", active: true, condition: "equipamento_nao_devolvido AND buscando_migrar", action: "criar_alerta(EQUIPAMENTO)", desc: "Cliente com equipamento em comodato buscando novo provedor — risco elevado de perda." },
    { id: 4, name: "Score Critico — Bloqueio de Aprovacao", active: false, condition: "score_migracao >= 75 AND sem_pagamento_3_faturas", action: "bloquear_aprovacao_automatica", desc: "Exige revisao manual para clientes com historico critico de migracao." },
  ];

  return (
    <div className="space-y-5">
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Protecao Ativa</h3>
            <p className="text-xs text-slate-400 mt-0.5">Monitora clientes inadimplentes a cada consulta ISP realizada na rede</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-enabled" />
        </div>
        <Separator />
        <div className="space-y-3">
          {[
            { label: "Migracao com Pendencia", desc: "Alerta quando cliente com contrato ativo busca novo provedor", v: alertDebt, set: setAlertDebt, id: "debt", color: "red" },
            { label: "Perfil Serial", desc: "Alerta quando CPF consulta 3+ provedores em 30 dias", v: alertSerial, set: setAlertSerial, id: "serial", color: "purple" },
            { label: "Equipamento com Pendencia", desc: "Alerta quando cliente com equipamento pendente tenta migrar", v: alertEqp, set: setAlertEqp, id: "eqp", color: "amber" },
          ].map(item => (
            <div key={item.id} className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-semibold text-slate-900">{item.label}</Label>
                <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
              </div>
              <Switch checked={item.v} onCheckedChange={item.set} data-testid={`switch-${item.id}`} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-900">Limites de Deteccao</h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Dias minimos de atraso", v: minDays, set: setMinDays, id: "days", hint: "para gerar alerta" },
            { label: "Consultas em 30 dias", v: maxConsu, set: setMaxConsu, id: "consu", hint: "para perfil serial" },
            { label: "Valor minimo equipamento (R$)", v: minEqp, set: setMinEqp, id: "eqpval", hint: "para alerta de perda" },
          ].map(f => (
            <div key={f.id} className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">{f.label}</Label>
              <Input type="number" value={f.v} onChange={e => f.set(e.target.value)} className="h-8 text-sm" data-testid={`input-${f.id}`} />
              <p className="text-[10px] text-slate-400">{f.hint}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-900">Notificacoes por Email</h3>
        <div className="space-y-2">
          {emails.map((e, i) => (
            <div key={i} className="flex gap-2">
              <Input type="email" placeholder="email@provedor.com.br" value={e} onChange={ev => { const n = [...emails]; n[i] = ev.target.value; setEmails(n); }} className="h-8 text-sm flex-1" data-testid={`email-${i}`} />
              {emails.length > 1 && <Button size="sm" variant="ghost" onClick={() => setEmails(emails.filter((_, j) => j !== i))} className="h-8 px-2"><XCircle className="w-4 h-4 text-slate-300" /></Button>}
            </div>
          ))}
          <Button size="sm" variant="outline" className="text-xs h-7 w-full" onClick={() => setEmails([...emails, ""])} data-testid="add-email">+ Adicionar email</Button>
        </div>
      </Card>

      <div>
        <button
          onClick={() => setShowRules(!showRules)}
          className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-3 hover:text-slate-900 transition-colors"
          data-testid="toggle-rules"
        >
          <BookOpen className="w-4 h-4 text-slate-400" />
          Regras de Deteccao
          {showRules ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
        </button>
        {showRules && (
          <div className="space-y-2">
            {rules.map(rule => (
              <Card key={rule.id} className={`overflow-hidden border ${rule.active ? "border-slate-200" : "border-slate-100 opacity-60"}`} data-testid={`rule-${rule.id}`}>
                <div className="flex">
                  <div className={`w-1 flex-shrink-0 ${rule.active ? "bg-emerald-500" : "bg-slate-200"}`} />
                  <div className="flex-1 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 leading-tight">{rule.name}</p>
                        <p className="text-xs text-slate-500 mt-1">{rule.desc}</p>
                        <div className="font-mono text-[10px] mt-2 space-y-0.5 bg-slate-50 rounded p-2 border border-slate-100">
                          <p><span className="text-blue-500">SE:</span> <span className="text-slate-600">{rule.condition}</span></p>
                          <p><span className="text-emerald-500">ENTAO:</span> <span className="text-slate-600">{rule.action}</span></p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Button className="w-full h-9" onClick={() => toast({ title: "Configuracoes salvas" })} data-testid="save-config">
        <CheckCircle className="w-4 h-4 mr-2" /> Salvar Configuracoes
      </Button>
    </div>
  );
}

export default function AntiFraudePage() {
  const { toast } = useToast();

  const { data: alerts = [], isLoading } = useQuery<AntiFraudAlert[]>({ queryKey: ["/api/anti-fraud/alerts"] });
  const { data: customerRisk = [] } = useQuery<CustomerRisk[]>({ queryKey: ["/api/anti-fraud/customer-risk"] });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiRequest("PATCH", `/api/anti-fraud/alerts/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/alerts"] }),
  });

  const onResolve = (id: number) => updateMutation.mutate({ id, status: "resolved" }, { onSuccess: () => toast({ title: "Resolvido" }) });
  const onDismiss = (id: number) => updateMutation.mutate({ id, status: "dismissed" }, { onSuccess: () => toast({ title: "Ignorado" }) });

  const active = alerts.filter(a => a.status === "new");
  const fugaAtivos = active.filter(a => a.type === "defaulter_consulted");
  const serialAtivos = active.filter(a => a.type === "multiple_consultations");
  const totalPrejuizo = active.reduce((s, a) => s + parseFloat(a.overdueAmount || "0") + parseFloat(a.equipmentValue || "0"), 0);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5" data-testid="anti-fraude-page">

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-rose-700 flex items-center justify-center shadow-sm">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900" data-testid="page-title">Anti-Fraude</h1>
            <p className="text-xs text-slate-400">Migracao serial — protecao contra clientes que migram sem pagar</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right">
              <p className="text-2xl font-black text-slate-900 leading-none" data-testid="kpi-ativos">{active.length}</p>
              <p className="text-[10px] text-slate-400">alertas ativos</p>
            </div>
            <div className="w-px h-8 bg-slate-200" />
            <div className="text-right">
              <p className={`text-lg font-black leading-none ${totalPrejuizo > 0 ? "text-red-600" : "text-slate-300"}`} data-testid="kpi-prejuizo">
                {totalPrejuizo > 0 ? money(totalPrejuizo) : "—"}
              </p>
              <p className="text-[10px] text-slate-400">prejuizo em risco</p>
            </div>
            {fugaAtivos.length > 0 && (
              <>
                <div className="w-px h-8 bg-slate-200" />
                <div className="text-right">
                  <p className="text-lg font-black text-orange-600 leading-none animate-pulse">{fugaAtivos.length}</p>
                  <p className="text-[10px] text-slate-400">com pendencia ativa</p>
                </div>
              </>
            )}
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => { queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/alerts"] }); queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/customer-risk"] }); }} data-testid="button-refresh">
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="alertas" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 bg-slate-100 p-1 rounded-xl h-auto">
          <TabsTrigger value="alertas" className="rounded-lg text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5" data-testid="tab-alertas">
            <Bell className="w-3.5 h-3.5" />
            Alertas
            {active.length > 0 && <span className="h-4 min-w-4 text-[10px] px-1 bg-red-500 text-white rounded-full flex items-center justify-center font-bold">{active.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="migradores" className="rounded-lg text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5" data-testid="tab-migradores">
            <UserX className="w-3.5 h-3.5" />
            Migradores
            {serialAtivos.length > 0 && <span className="h-4 min-w-4 text-[10px] px-1 bg-purple-500 text-white rounded-full flex items-center justify-center font-bold">{serialAtivos.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="config" className="rounded-lg text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5" data-testid="tab-config">
            <Settings className="w-3.5 h-3.5" />
            Configuracoes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="alertas">
          <MonitoramentoTab
            alerts={alerts}
            customerRisk={customerRisk}
            onResolve={onResolve}
            onDismiss={onDismiss}
            isLoading={isLoading}
          />
        </TabsContent>

        <TabsContent value="migradores">
          <MigradoresTab alerts={alerts} />
        </TabsContent>

        <TabsContent value="config">
          <ConfigTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
