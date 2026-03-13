import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Activity, Calendar, CheckCircle, BarChart3, Info,
  Clock, FileText, CreditCard, AlertTriangle, Shield, Building2,
  Wifi, ChevronDown, ChevronUp, Lightbulb, Target, Minus, Plus,
  Lock, ArrowRight, Zap, Router, MapPin, XCircle, AlertCircle,
  User, Sparkles, Download, Save, RotateCcw, TrendingDown, TrendingUp,
} from "lucide-react";

interface ProviderDetail {
  providerName: string;
  isSameProvider: boolean;
  customerName: string;
  status: string;
  daysOverdue: number;
  overdueAmount?: number;
  overdueAmountRange?: string;
  overdueInvoicesCount: number;
  contractStartDate: string;
  contractAgeDays: number;
  hasUnreturnedEquipment: boolean;
  unreturnedEquipmentCount: number;
  equipmentDetails?: { type: string; brand: string; model: string; value: string; inRecoveryProcess: boolean }[];
  equipmentPendingSummary?: string;
  cancelledDate?: string;
}

interface AddressMatch {
  customerName: string;
  cpfCnpj: string;
  address: string;
  city: string;
  state?: string;
  providerName: string;
  isSameProvider: boolean;
  status: string;
  daysOverdue: number;
  totalOverdue?: number;
  hasDebt: boolean;
}

interface ConsultaResult {
  cpfCnpj: string;
  searchType: string;
  notFound: boolean;
  score: number;
  riskTier: string;
  riskLabel: string;
  recommendation: string;
  decisionReco: string;
  providersFound: number;
  providerDetails: ProviderDetail[];
  penalties: { reason: string; points: number }[];
  bonuses: { reason: string; points: number }[];
  alerts: string[];
  recommendedActions: string[];
  creditsCost: number;
  isOwnCustomer: boolean;
  addressMatches?: AddressMatch[];
}

function formatCpfCnpj(value: string): string {
  const cleaned = value.replace(/\D/g, "");
  if (cleaned.length <= 11) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, (_, a, b, c, d) =>
      d ? `${a}.${b}.${c}-${d}` : c ? `${a}.${b}.${c}` : b ? `${a}.${b}` : a
    );
  }
  return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, (_, a, b, c, d, e) =>
    e ? `${a}.${b}.${c}/${d}-${e}` : d ? `${a}.${b}.${c}/${d}` : c ? `${a}.${b}.${c}` : b ? `${a}.${b}` : a
  );
}

function getInitials(name: string): string {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

function ScoreGaugeSvg({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const r = 45;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = score >= 75 ? "#10b981" : score >= 50 ? "#6b7280" : "#ef4444";
  return (
    <svg width="100" height="100" viewBox="0 0 120 120" className="-rotate-90">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
      <circle
        cx="60" cy="60" r={r} fill="none" strokeWidth="10"
        stroke={color} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        className="transition-all duration-1000"
      />
    </svg>
  );
}

function getPaymentStatusLabel(daysOverdue: number, cancelledDate?: string): string {
  if (daysOverdue === 0 && !cancelledDate) return "Em dia";
  if (daysOverdue === 0 && cancelledDate) return "Cancelado (quitado)";
  if (daysOverdue <= 30) return "Inadimplente (1-30d)";
  if (daysOverdue <= 60) return "Inadimplente (31-60d)";
  if (daysOverdue <= 90) return "Inadimplente (61-90d)";
  return "Inadimplente (90+d)";
}

function getPaymentStatusColor(daysOverdue: number): string {
  if (daysOverdue === 0) return "bg-green-100 text-green-700";
  if (daysOverdue <= 30) return "bg-red-100 text-red-700";
  if (daysOverdue <= 60) return "bg-red-100 text-red-700";
  return "bg-red-100 text-red-700";
}

function LoadingCard() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setProgress(p => Math.min(p + 3, 92)), 80);
    return () => clearInterval(interval);
  }, []);
  return (
    <Card className="p-12 text-center shadow-lg rounded-2xl">
      <div className="flex flex-col items-center gap-6">
        <div className="w-16 h-16 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
        <div>
          <p className="text-lg font-semibold text-slate-900">Consultando Base ISP...</p>
          <p className="text-sm text-slate-600 mt-1">Buscando no banco de dados interno.</p>
        </div>
        <div className="w-full max-w-xs">
          <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-1.5 text-right">{progress}%</p>
        </div>
      </div>
    </Card>
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
        <p key={i} className="font-bold text-slate-800 mt-4 mb-1 text-sm uppercase tracking-wide border-b border-slate-200 pb-1">
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

export default function ConsultaISPPage() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ConsultaResult | null>(null);
  const [showScoreDetails, setShowScoreDetails] = useState(false);
  const [activeTab, setActiveTab] = useState<"nova" | "historico" | "relatorios" | "info">("nova");
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const [aiError, setAiError] = useState("");
  const [selectedProviderIdx, setSelectedProviderIdx] = useState<number | null>(0);
  const [showFullResult, setShowFullResult] = useState(false);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/isp-consultations"],
  });

  const mutation = useMutation({
    mutationFn: async (cpfCnpj: string) => {
      const res = await apiRequest("POST", "/api/isp-consultations", { cpfCnpj });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data.result);
      setShowScoreDetails(false);
      setShowFullResult(false);
      setAiText("");
      setAiDone(false);
      setAiError("");
      setSelectedProviderIdx(0);
      queryClient.invalidateQueries({ queryKey: ["/api/isp-consultations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      const ownCount = (data.result?.providerDetails || []).filter((d: any) => d.isSameProvider).length;
      const otherCount = (data.result?.providerDetails || []).filter((d: any) => !d.isSameProvider).length;
      const costDesc = otherCount > 0
        ? `${ownCount} gratuita(s), ${otherCount} x 1 credito`
        : data.result?.notFound ? "Nada consta — Gratuita" : "Gratuita";
      toast({ title: "Consulta realizada", description: costDesc });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const runAIAnalysis = async (consultaResult: ConsultaResult) => {
    setAiText("");
    setAiLoading(true);
    setAiDone(false);
    setAiError("");
    try {
      const res = await fetch("/api/ai/analyze-consultation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: consultaResult }),
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

  const handleSearch = () => {
    if (!query.trim()) return;
    mutation.mutate(query);
  };

  const getDetectedType = (val: string) => {
    const cleaned = val.replace(/\D/g, "");
    if (cleaned.length === 8) return "CEP";
    if (cleaned.length === 11) return "CPF";
    if (cleaned.length === 14) return "CNPJ";
    return null;
  };

  const detectedType = getDetectedType(query);

  const consultations = data?.consultations || [];
  const approvedCount = consultations.filter((c: any) => c.approved).length;
  const rejectedCount = consultations.filter((c: any) => !c.approved).length;
  const avgScore = consultations.length > 0
    ? Math.round(consultations.reduce((acc: number, c: any) => acc + (c.score || 0), 0) / consultations.length)
    : 0;
  const approvalRate = consultations.length > 0
    ? Math.round((approvedCount / consultations.length) * 100)
    : 0;

  const riskDecisionBadge = (decision: string) => {
    if (decision === "Accept") return "bg-green-100 text-green-700";
    if (decision === "Review") return "bg-amber-100 text-amber-700";
    return "bg-red-100 text-red-700";
  };

  const scoreColor = (score: number) =>
    score >= 75 ? "text-emerald-600" : score >= 50 ? "text-gray-600" : "text-red-600";

  const scoreBg = (score: number) =>
    score >= 75 ? "bg-green-100 text-green-800 border-green-300" :
    score >= 50 ? "bg-yellow-100 text-yellow-800 border-yellow-300" :
    "bg-red-100 text-red-800 border-red-300";

  const decisionIcon = (decision: string) =>
    decision === "Accept" ? CheckCircle : decision === "Review" ? AlertCircle : XCircle;

  const decisionCardStyle = (decision: string) =>
    decision === "Accept"
      ? { border: "border-green-200", header: "bg-green-50", iconClass: "text-green-600" }
      : decision === "Review"
      ? { border: "border-yellow-200", header: "bg-yellow-50", iconClass: "text-yellow-600" }
      : { border: "border-red-200", header: "bg-red-50", iconClass: "text-red-600" };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-slate-50 to-purple-50 p-6" data-testid="consulta-isp-page">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* ── CABEÇALHO ── */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-md">
              <Search className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1
                className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-700 bg-clip-text text-transparent leading-tight"
                data-testid="text-consulta-isp-title"
              >
                Consulta ISP
              </h1>
              <p className="text-lg text-slate-600">Sistema de analise de credito para provedores</p>
            </div>
          </div>
          <div className="bg-white/70 backdrop-blur border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm flex items-center gap-2.5">
            <CreditCard className="w-5 h-5 text-blue-600" />
            <div>
              <p className="text-xs text-slate-500 leading-none">Creditos ISP</p>
              <p
                className={`text-xl font-bold leading-tight ${(data?.credits ?? 1) === 0 ? "text-red-600" : "text-slate-900"}`}
                data-testid="text-isp-credits"
              >
                {data?.credits ?? "..."}
              </p>
            </div>
          </div>
        </div>

        {/* ── CARDS DE ESTATÍSTICAS ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Consultas Hoje", value: data?.todayCount ?? 0, icon: Activity,
              iconBg: "bg-blue-100", iconColor: "text-blue-600", testid: "text-isp-today",
            },
            {
              label: "Consultas Mes", value: data?.monthCount ?? 0, icon: Calendar,
              iconBg: "bg-orange-100", iconColor: "text-orange-600", testid: "text-isp-month",
            },
            {
              label: "Taxa Aprovacao", value: `${approvalRate}%`, icon: CheckCircle,
              iconBg: "bg-green-100", iconColor: "text-green-600", testid: "text-isp-approval",
            },
            {
              label: "Score Medio ISP", value: avgScore, icon: BarChart3,
              iconBg: "bg-yellow-100", iconColor: "text-yellow-600", testid: "text-isp-avg-score",
            },
          ].map(stat => (
            <div
              key={stat.label}
              className="bg-white/70 backdrop-blur rounded-xl shadow-sm p-4"
              data-testid={stat.testid}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-slate-600">{stat.label}</p>
                <div className={`w-9 h-9 rounded-lg ${stat.iconBg} flex items-center justify-center`}>
                  <stat.icon className={`w-5 h-5 ${stat.iconColor}`} />
                </div>
              </div>
              <p className="text-3xl font-bold text-slate-900">
                {isLoading ? "..." : stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* ── TABS ── */}
        <div className="flex gap-1 bg-white/70 backdrop-blur rounded-xl p-1 shadow-sm border border-slate-200 w-fit">
          {(["nova", "historico", "relatorios", "info"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              data-testid={`tab-${tab}`}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab === "nova" ? "Nova Consulta"
               : tab === "historico" ? "Historico"
               : tab === "relatorios" ? "Relatorios"
               : "Informacoes"}
            </button>
          ))}
        </div>

        {/* ── ABA: NOVA CONSULTA ── */}
        {activeTab === "nova" && (
          <div className="space-y-5">
            {/* Formulário */}
            <Card className="overflow-hidden shadow-lg rounded-2xl">
              <div className="bg-slate-50 border-b px-6 py-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                  <Search className="w-4 h-4 text-white" />
                </div>
                <h2 className="text-lg font-semibold text-slate-900">Realizar Consulta ISP</h2>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex gap-3 items-center">
                  <div className="relative flex-1">
                    <Input
                      data-testid="input-isp-search"
                      placeholder="Digite CPF, CNPJ ou CEP"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      className="h-12 text-base pr-10 rounded-lg border-slate-200"
                    />
                    {detectedType && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {detectedType === "CEP" && <MapPin className="w-4 h-4 text-blue-600" />}
                        {detectedType === "CPF" && <FileText className="w-4 h-4 text-green-600" />}
                        {detectedType === "CNPJ" && <Building2 className="w-4 h-4 text-purple-600" />}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="h-12 px-6 rounded-lg"
                    onClick={() => { setQuery(""); setResult(null); }}
                    data-testid="button-clear-isp"
                  >
                    Limpar
                  </Button>
                  <Button
                    onClick={handleSearch}
                    disabled={!query.trim() || mutation.isPending}
                    className="h-12 px-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
                    data-testid="button-consultar-isp"
                  >
                    {mutation.isPending ? "Consultando..." : "Consultar"}
                  </Button>
                </div>

                {detectedType && (
                  <div className="flex items-center gap-2" data-testid="text-detected-type">
                    {detectedType === "CEP" && <MapPin className="w-4 h-4 text-blue-600" />}
                    {detectedType === "CPF" && <FileText className="w-4 h-4 text-green-600" />}
                    {detectedType === "CNPJ" && <Building2 className="w-4 h-4 text-purple-600" />}
                    <span className={`text-sm font-medium ${
                      detectedType === "CEP" ? "text-blue-600"
                      : detectedType === "CPF" ? "text-green-600"
                      : "text-purple-600"
                    }`}>{detectedType} detectado</span>
                  </div>
                )}

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                  <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-blue-800">
                    <span className="font-semibold">Busca Inteligente:</span> Digite CPF (11 digitos), CNPJ (14 digitos) ou CEP (8 digitos).
                    O sistema busca na rede colaborativa e retorna score, restricoes e alertas.
                  </p>
                </div>
              </div>
            </Card>

            {/* Loading */}
            {mutation.isPending && <LoadingCard />}

            {/* Resultado */}
            {!mutation.isPending && result && (
              <div className="space-y-4" data-testid="consultation-result">

                {/* Nada Consta */}
                {result.notFound ? (
                  <Card className="overflow-hidden border-2 border-green-200 shadow-lg rounded-2xl">
                    <div className="bg-green-50 px-6 py-4 flex items-center gap-3">
                      <CheckCircle className="w-6 h-6 text-green-600" />
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">Nada Consta</h3>
                        <p className="text-sm text-slate-600">Documento: {formatCpfCnpj(result.cpfCnpj)}</p>
                      </div>
                    </div>
                    <div className="p-6">
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
                        <Shield className="w-5 h-5 text-green-600 flex-shrink-0" />
                        <p className="text-sm text-green-800">
                          Nenhum cliente encontrado na base de dados. Documento sem restricoes na rede ISP colaborativa.
                        </p>
                      </div>
                      <p className="text-xs text-slate-500 mt-3 text-center">
                        Sugestao de Decisao: Aprovar — Prosseguir para Consulta SPC para verificacao completa
                      </p>
                    </div>
                  </Card>
                ) : !showFullResult ? (
                  /* ── LISTA DE CLIENTES ENCONTRADOS ── */
                  <div className="space-y-4">
                    <Card className="overflow-hidden rounded-2xl border border-slate-200 shadow-md">
                      <div className="bg-slate-50 px-5 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <Search className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <h3 className="text-base font-semibold text-slate-900" data-testid="text-resultado-titulo">
                              Resultado da Consulta
                            </h3>
                            <p className="text-xs text-slate-500">
                              Documento: {formatCpfCnpj(result.cpfCnpj)}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-slate-400">
                          {new Date().toLocaleDateString("pt-BR")}
                        </span>
                      </div>

                      <div className="p-5">
                        <p className="text-sm text-slate-600 mb-4">
                          {result.providerDetails.length === 1
                            ? "1 cliente localizado na base de dados colaborativa."
                            : `${result.providerDetails.length} cadastro(s) localizado(s) na base de dados colaborativa.`
                          }
                        </p>

                        <div className="space-y-3">
                          {result.providerDetails.map((detail, i) => {
                            const isOwn = detail.isSameProvider;
                            const hasOverdue = (detail.overdueAmount || 0) > 0 || !!detail.overdueAmountRange;
                            const statusCls = detail.daysOverdue === 0
                              ? "bg-emerald-100 text-emerald-700"
                              : detail.daysOverdue <= 30 ? "bg-orange-100 text-orange-700"
                              : "bg-red-100 text-red-700";
                            return (
                              <div
                                key={i}
                                className="flex items-center gap-4 p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                                data-testid={`customer-found-${i}`}
                              >
                                <div className={`w-1.5 self-stretch rounded-full flex-shrink-0 ${isOwn ? "bg-blue-500" : "bg-slate-300"}`} />
                                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                                  {isOwn
                                    ? <span className="text-xs font-bold text-slate-700">{getInitials(detail.customerName)}</span>
                                    : <Lock className="w-4 h-4 text-slate-400" />
                                  }
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <p className="text-sm font-semibold text-slate-900 truncate">
                                      {isOwn ? detail.customerName : "Dados restritos"}
                                    </p>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isOwn ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                                      {isOwn ? "SEU PROVEDOR" : "OUTRO PROVEDOR"}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs text-slate-500">{detail.providerName}</span>
                                    <span className="text-slate-300">|</span>
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusCls}`}>
                                      {detail.daysOverdue === 0 ? "Em dia" : `${detail.daysOverdue} dias atraso`}
                                    </span>
                                    {hasOverdue && (
                                      <>
                                        <span className="text-slate-300">|</span>
                                        <span className="text-xs font-semibold text-red-600">
                                          {detail.overdueAmount
                                            ? `R$ ${detail.overdueAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                                            : detail.overdueAmountRange}
                                        </span>
                                      </>
                                    )}
                                    {detail.hasUnreturnedEquipment && (
                                      <>
                                        <span className="text-slate-300">|</span>
                                        <span className="text-xs text-amber-600 flex items-center gap-1">
                                          <Router className="w-3 h-3" />
                                          {detail.unreturnedEquipmentCount} equip.
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isOwn ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`} data-testid={`cost-badge-${i}`}>
                                    {isOwn ? "Gratuita" : "1 Credito"}
                                  </span>
                                  <Button
                                    size="sm"
                                    className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5 text-xs h-8"
                                    onClick={() => { setShowFullResult(true); setSelectedProviderIdx(i); }}
                                    data-testid={`button-ver-informacoes-${i}`}
                                  >
                                    <Info className="w-3.5 h-3.5" />
                                    Ver Informacoes
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-5 flex justify-center">
                          <Button
                            variant="outline"
                            className="gap-2"
                            onClick={() => { setQuery(""); setResult(null); }}
                            data-testid="button-nova-consulta"
                          >
                            <RotateCcw className="w-4 h-4" />
                            Nova Consulta
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </div>
                ) : (
                  <div className="space-y-5">

                    {/* Botão voltar para a lista */}
                    <button
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
                      onClick={() => setShowFullResult(false)}
                      data-testid="button-voltar-lista"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Voltar para a lista
                    </button>

                    {/* ── HERO: Score + Sugestão de Decisão + Provedor selecionado ── */}
                    {(() => {
                      const selectedDetail = result.providerDetails[selectedProviderIdx ?? 0];
                      const isOwnSelected = selectedDetail?.isSameProvider ?? false;
                      const heroName = isOwnSelected ? selectedDetail?.customerName : null;
                      const detailCost = isOwnSelected ? 0 : 1;
                      const dc = result.decisionReco;
                      const heroBg = dc === "Accept" ? "from-emerald-50 to-white border-emerald-200"
                        : dc === "Review" ? "from-amber-50 to-white border-amber-200"
                        : "from-red-50 to-white border-red-200";
                      const decisionBg = dc === "Accept" ? "bg-emerald-500"
                        : dc === "Review" ? "bg-amber-500" : "bg-red-500";
                      const decisionLabel = dc === "Accept" ? "APROVAR" : dc === "Review" ? "ANALISAR" : "REJEITAR";
                      const riskCls = result.riskTier === "low" ? "bg-emerald-100 text-emerald-700"
                        : result.riskTier === "medium" ? "bg-amber-100 text-amber-700"
                        : result.riskTier === "high" ? "bg-orange-100 text-orange-700"
                        : "bg-red-100 text-red-700";
                      const now = new Date();
                      const dataConsulta = now.toLocaleDateString("pt-BR") + " " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                      return (
                        <Card className={`overflow-hidden rounded-2xl border bg-gradient-to-r ${heroBg}`} data-testid="hero-result-card">
                          <div className="p-5">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">

                              {/* Score gauge */}
                              <div className="flex-shrink-0 flex flex-col items-center gap-1">
                                <div className="relative w-24 h-24">
                                  <ScoreGaugeSvg score={result.score} />
                                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-2xl font-black text-slate-900 leading-none" data-testid="text-score-value">{result.score}</span>
                                    <span className="text-[9px] text-slate-500 font-medium">/ 100</span>
                                  </div>
                                </div>
                                <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Score ISP</span>
                              </div>

                              {/* Provedor info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2.5 mb-2">
                                  <div className="w-9 h-9 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center flex-shrink-0">
                                    {heroName
                                      ? <span className="text-xs font-bold text-slate-700">{getInitials(heroName)}</span>
                                      : <Lock className="w-4 h-4 text-slate-400" />
                                    }
                                  </div>
                                  <div>
                                    <p className="font-bold text-slate-900 text-base leading-tight" data-testid="text-customer-name">
                                      {heroName || "Dados restritos"}
                                    </p>
                                    <p className="text-xs text-slate-500">{formatCpfCnpj(result.cpfCnpj)} — {selectedDetail?.providerName}</p>
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isOwnSelected ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                                    {isOwnSelected ? "SEU PROVEDOR" : "OUTRO PROVEDOR"}
                                  </span>
                                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${riskCls}`} data-testid="text-risk-tier">
                                    {result.riskLabel}
                                  </span>
                                  <span className="text-xs text-slate-400">{dataConsulta}</span>
                                </div>
                              </div>

                              {/* Sugestão de Decisão + Custo */}
                              <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
                                <div className={`${decisionBg} text-white px-6 py-3 rounded-xl text-center min-w-[7rem]`} data-testid="badge-decision">
                                  <p className="text-[10px] font-semibold opacity-80 uppercase tracking-widest">Sugestao</p>
                                  <p className="text-xl font-black tracking-wide">{decisionLabel}</p>
                                </div>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${detailCost === 0 ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`} data-testid="detail-cost-badge">
                                  {detailCost === 0 ? "Gratuita" : "1 Credito"}
                                </span>
                              </div>

                            </div>
                          </div>
                        </Card>
                      );
                    })()}

                    {/* ── DETALHES DO PROVEDOR SELECIONADO ── */}
                    {(() => {
                      const detail = result.providerDetails[selectedProviderIdx ?? 0];
                      if (!detail) return null;
                      const isOwn = detail.isSameProvider;
                      const hasOverdue = (detail.overdueAmount || 0) > 0 || !!detail.overdueAmountRange;
                      const contractMonths = Math.max(1, Math.round(detail.contractAgeDays / 30));
                      const statusContrato = detail.cancelledDate ? "Cancelado" : "Ativo";
                      const totalEqp = detail.equipmentDetails?.reduce((s: number, e: any) => s + parseFloat(e.value || "0"), 0) || 0;
                      const statusCls = detail.daysOverdue === 0
                        ? "bg-emerald-100 text-emerald-700"
                        : detail.daysOverdue <= 30 ? "bg-orange-100 text-orange-700"
                        : "bg-red-100 text-red-700";
                      return (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <Building2 className="w-4 h-4 text-slate-500" />
                            <h3 className="text-sm font-semibold text-slate-700">
                              Detalhes — {detail.providerName}
                            </h3>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isOwn ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                              {isOwn ? "SEU PROVEDOR" : "OUTRO PROVEDOR"}
                            </span>
                          </div>
                          <div
                            className="border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden"
                            data-testid={`provider-detail-${selectedProviderIdx ?? 0}`}
                          >
                            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">

                              <div className="p-4">
                                <div className="flex items-center gap-1.5 mb-3">
                                  <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Financeiro</span>
                                </div>
                                <div className="space-y-2.5">
                                  <div>
                                    <p className="text-[10px] text-slate-400 mb-0.5">Status de pagamento</p>
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>
                                      {detail.status}
                                    </span>
                                  </div>
                                  {detail.daysOverdue > 0 && (
                                    <div>
                                      <p className="text-[10px] text-slate-400">Dias em atraso</p>
                                      <p className="text-sm font-bold text-red-600">{detail.daysOverdue} dias</p>
                                    </div>
                                  )}
                                  {isOwn && (detail.overdueAmount || 0) > 0 && (
                                    <div>
                                      <p className="text-[10px] text-slate-400">Valor em aberto</p>
                                      <p className="text-base font-black text-red-600">
                                        R$ {(detail.overdueAmount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                      </p>
                                    </div>
                                  )}
                                  {!isOwn && detail.overdueAmountRange && (
                                    <div>
                                      <p className="text-[10px] text-slate-400">Faixa de valor</p>
                                      <p className="text-sm text-slate-700">{detail.overdueAmountRange}</p>
                                    </div>
                                  )}
                                  {detail.overdueInvoicesCount > 0 && (
                                    <div>
                                      <p className="text-[10px] text-slate-400">Faturas em atraso</p>
                                      <p className="text-sm font-semibold text-slate-700">{detail.overdueInvoicesCount} fatura(s)</p>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="p-4">
                                <div className="flex items-center gap-1.5 mb-3">
                                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contrato</span>
                                </div>
                                <div className="space-y-2.5">
                                  <div>
                                    <p className="text-[10px] text-slate-400">Tempo de servico</p>
                                    <p className="text-sm font-semibold text-slate-800">{contractMonths} {contractMonths === 1 ? "mes" : "meses"}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-slate-400">Status do contrato</p>
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusContrato === "Ativo" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                                      {statusContrato}
                                    </span>
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-slate-400">Cliente</p>
                                    {isOwn
                                      ? <p className="text-sm font-semibold text-slate-800">{detail.customerName}</p>
                                      : <span className="flex items-center gap-1 text-xs text-slate-400"><Lock className="w-3 h-3" /> Dado restrito</span>
                                    }
                                  </div>
                                  {detail.cancelledDate && (
                                    <div>
                                      <p className="text-[10px] text-slate-400">Data cancelamento</p>
                                      <p className="text-xs text-slate-600">{new Date(detail.cancelledDate).toLocaleDateString("pt-BR")}</p>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className={`p-4 ${detail.hasUnreturnedEquipment ? "bg-amber-50/60" : ""}`}>
                                <div className="flex items-center gap-1.5 mb-3">
                                  <Router className={`w-3.5 h-3.5 ${detail.hasUnreturnedEquipment ? "text-amber-500" : "text-slate-400"}`} />
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Equipamentos</span>
                                </div>
                                {detail.hasUnreturnedEquipment ? (
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-1">
                                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                      <p className="text-xs font-bold text-amber-700">{detail.unreturnedEquipmentCount} nao devolvido(s)</p>
                                    </div>
                                    {detail.equipmentDetails ? (
                                      <div className="space-y-1.5 mt-2">
                                        {detail.equipmentDetails.map((eq: any, j: number) => (
                                          <div key={j} className="flex items-center justify-between gap-2">
                                            <span className="text-xs text-slate-700 flex-1 truncate">{eq.type} {eq.brand} {eq.model}</span>
                                            <span className="text-xs font-semibold text-slate-800 flex-shrink-0">
                                              R$ {parseFloat(eq.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                            </span>
                                          </div>
                                        ))}
                                        <div className="pt-1.5 border-t border-amber-200 flex justify-between">
                                          <span className="text-xs font-bold text-amber-700">Total</span>
                                          <span className="text-xs font-black text-amber-700">
                                            R$ {totalEqp.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                          </span>
                                        </div>
                                      </div>
                                    ) : (
                                      <p className="text-xs text-slate-600">{detail.equipmentPendingSummary}</p>
                                    )}
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                                    <span className="text-sm text-emerald-700 font-medium">Todos devolvidos</span>
                                  </div>
                                )}
                              </div>

                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── COMPOSIÇÃO DO SCORE ── */}
                    {(result.penalties.length > 0 || result.bonuses.length > 0) && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <BarChart3 className="w-4 h-4 text-slate-500" />
                          <h3 className="text-sm font-semibold text-slate-700">Composicao do Score</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {result.bonuses.length > 0 && (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                              <div className="flex items-center gap-1.5 mb-3">
                                <Plus className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Pontos Positivos</span>
                              </div>
                              <div className="space-y-2">
                                {result.bonuses.map((b, i) => (
                                  <div key={i} className="flex items-start justify-between gap-2">
                                    <span className="text-xs text-slate-700 flex-1">{b.reason}</span>
                                    <span className="text-xs font-black text-emerald-600 flex-shrink-0">+{b.points}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {result.penalties.length > 0 && (
                            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                              <div className="flex items-center gap-1.5 mb-3">
                                <Minus className="w-3.5 h-3.5 text-red-600" />
                                <span className="text-xs font-bold text-red-700 uppercase tracking-wide">Penalidades</span>
                              </div>
                              <div className="space-y-2">
                                {result.penalties.map((p, i) => (
                                  <div key={i} className="flex items-start justify-between gap-2">
                                    <span className="text-xs text-slate-700 flex-1">{p.reason}</span>
                                    <span className="text-xs font-black text-red-600 flex-shrink-0">{p.points}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── ALERTAS ── */}
                    {result.alerts.length > 0 && (
                      <div className="rounded-xl border-l-4 border-l-amber-400 border border-amber-200 bg-amber-50 p-4" data-testid="section-fatores-risco">
                        <div className="flex items-center gap-1.5 mb-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                          <h4 className="text-xs font-bold text-amber-700 uppercase tracking-wide">Alertas do Sistema</h4>
                        </div>
                        <ul className="space-y-1.5">
                          {result.alerts.map((alert, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs" data-testid={`alert-${i}`}>
                              <span className="text-amber-500 font-black flex-shrink-0 mt-0.5">•</span>
                              <span className="text-amber-800">{alert}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* ── RECOMENDAÇÕES ── */}
                    {result.recommendedActions.length > 0 && (
                      <div className={`rounded-xl p-4 border ${
                        result.decisionReco === "Accept" ? "bg-emerald-50 border-emerald-200"
                        : result.decisionReco === "Review" ? "bg-amber-50 border-amber-200"
                        : "bg-red-50 border-red-200"
                      }`}>
                        <div className="flex items-center gap-1.5 mb-3">
                          <Lightbulb className={`w-4 h-4 ${
                            result.decisionReco === "Accept" ? "text-emerald-600"
                            : result.decisionReco === "Review" ? "text-amber-600" : "text-red-600"
                          }`} />
                          <h4 className={`text-xs font-bold uppercase tracking-wide ${
                            result.decisionReco === "Accept" ? "text-emerald-700"
                            : result.decisionReco === "Review" ? "text-amber-700" : "text-red-700"
                          }`} data-testid="text-decision-summary">
                            {result.decisionReco === "Accept" ? "Condicoes para Aprovacao"
                              : result.decisionReco === "Review" ? "Pontos para Revisao"
                              : "Condicoes Obrigatorias"}
                          </h4>
                        </div>
                        <div className="space-y-1.5">
                          {result.recommendedActions.map((action, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <ArrowRight className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                                result.decisionReco === "Accept" ? "text-emerald-500"
                                : result.decisionReco === "Review" ? "text-amber-500" : "text-red-500"
                              }`} />
                              <span className="text-xs text-slate-700">{action}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── ANÁLISE COM IA ── */}
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4" data-testid="panel-ai-analysis">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-indigo-600" />
                          <h4 className="text-sm font-semibold text-indigo-700">Analise Inteligente</h4>
                          {aiLoading && (
                            <span className="text-xs text-indigo-500 flex items-center gap-1">
                              <div className="w-3 h-3 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                              Analisando...
                            </span>
                          )}
                          {aiDone && !aiError && (
                            <span className="text-xs text-emerald-600 flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" />
                              Concluido
                            </span>
                          )}
                        </div>
                        {!aiLoading && (
                          <Button
                            size="sm"
                            variant={aiText ? "outline" : "default"}
                            className={aiText ? "text-xs h-7 gap-1" : "text-xs h-7 gap-1 bg-indigo-600 hover:bg-indigo-700 text-white"}
                            onClick={() => runAIAnalysis(result)}
                            data-testid="button-run-ai-consultation"
                          >
                            <Sparkles className="w-3 h-3" />
                            {aiText ? "Nova Analise" : "Analisar com IA"}
                          </Button>
                        )}
                      </div>
                      {!aiText && !aiLoading && !aiError && (
                        <p className="text-xs text-indigo-600/70">
                          Clique em "Analisar com IA" para obter uma interpretacao especializada deste resultado.
                        </p>
                      )}
                      {aiError && <p className="text-sm text-red-600">{aiError}</p>}
                      {aiText && (
                        <div className="space-y-1 mt-2">
                          {renderAIText(aiText)}
                          {aiLoading && <span className="inline-block w-1.5 h-4 bg-indigo-500 animate-pulse ml-0.5 rounded-sm" />}
                        </div>
                      )}
                    </div>

                    {/* ── BOTÕES ── */}
                    <div className="flex flex-wrap gap-3">
                      <Button className="bg-blue-600 hover:bg-blue-700 text-white gap-2" data-testid="button-gerar-relatorio">
                        <Download className="w-4 h-4" />
                        Gerar Relatorio
                      </Button>
                      <Button variant="outline" className="gap-2" data-testid="button-salvar-consulta">
                        <Save className="w-4 h-4" />
                        Salvar Consulta
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => setActiveTab("historico")}
                        data-testid="button-ver-historico"
                      >
                        <Clock className="w-4 h-4" />
                        Ver Historico
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => { setQuery(""); setResult(null); }}
                        data-testid="button-nova-consulta"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Nova Consulta
                      </Button>
                    </div>

                  </div>
                )}
              </div>
            )}

            {/* ── CRUZAMENTO DE ENDEREÇO ── */}
            {result && !result.notFound && result.addressMatches && result.addressMatches.length > 0 && (
              <Card className="overflow-hidden shadow-lg rounded-2xl border-2 border-orange-200" data-testid="card-address-matches">
                <div className="bg-orange-50 px-6 py-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-slate-900">Alerta de Cruzamento por Endereco</h3>
                    <p className="text-sm text-orange-700">
                      {result.addressMatches.filter(m => m.hasDebt).length > 0
                        ? `${result.addressMatches.filter(m => m.hasDebt).length} pessoa(s) com divida no mesmo endereco`
                        : `${result.addressMatches.length} cadastro(s) localizado(s) no mesmo endereco`
                      }
                    </p>
                  </div>
                  <Badge className="bg-orange-100 text-orange-800 border-orange-300 border">
                    {result.addressMatches.length} cadastro(s)
                  </Badge>
                </div>

                <div className="p-5">
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-orange-800">
                      Foram encontrados outros cadastros com o mesmo endereco exato. Esse padrao pode indicar uso de diferentes documentos de membros da mesma familia para contratar servicos apos inadimplencia anterior.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {result.addressMatches.map((match, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-4 p-4 rounded-xl border bg-white ${
                          match.hasDebt ? "border-red-200" : "border-slate-200"
                        }`}
                        data-testid={`address-match-${i}`}
                      >
                        <div className={`w-1.5 self-stretch rounded-full flex-shrink-0 ${
                          match.hasDebt ? "bg-red-400" : "bg-slate-300"
                        }`} />

                        <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                          <User className="w-5 h-5 text-orange-600" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-slate-900" data-testid={`address-match-name-${i}`}>
                              {match.customerName}
                            </span>
                            {match.isSameProvider && (
                              <Badge className="bg-blue-100 text-blue-700 border-0 text-xs">Seu cliente</Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Doc: {match.cpfCnpj} &nbsp;•&nbsp; {match.providerName}
                          </p>
                          <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3" />
                            {match.address}{match.city ? `, ${match.city}` : ""}{match.state ? `/${match.state}` : ""}
                          </p>
                        </div>

                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            match.daysOverdue === 0
                              ? "bg-emerald-100 text-emerald-700"
                              : match.daysOverdue <= 30
                              ? "bg-orange-100 text-orange-700"
                              : "bg-red-100 text-red-700"
                          }`}>
                            {match.status}
                          </span>
                          {match.isSameProvider && match.totalOverdue !== undefined && match.totalOverdue > 0 && (
                            <span className="text-xs text-red-600 font-medium">
                              R$ {match.totalOverdue.toFixed(2)} em aberto
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="text-xs text-slate-400 mt-4 text-center">
                    Dados parcialmente anonimizados para clientes de outros provedores conforme politica de privacidade da rede.
                  </p>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ── ABA: HISTORICO ── */}
        {activeTab === "historico" && (
          <Card className="shadow-lg rounded-2xl overflow-hidden">
            <div className="bg-slate-50 border-b px-6 py-4 flex items-center gap-3">
              <Clock className="w-5 h-5 text-slate-500" />
              <h2 className="text-lg font-semibold text-slate-900">Historico de Consultas</h2>
            </div>
            <div className="p-6">
              {consultations.length === 0 ? (
                <div className="text-center py-12">
                  <Search className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                  <p className="text-slate-500">Nenhuma consulta realizada ainda</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {consultations.map((c: any) => {
                    const tier = c.score >= 75 ? "low" : c.score >= 50 ? "medium" : c.score >= 25 ? "high" : "critical";
                    const resultData = c.result as any;
                    const customerName = resultData?.providerDetails?.[0]?.customerName;
                    const providersFound = resultData?.providersFound || 0;
                    return (
                      <div key={c.id} className="flex items-center justify-between p-3.5 bg-white rounded-xl border border-slate-200 hover:border-blue-200 transition-colors" data-testid={`consultation-${c.id}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-2.5 h-2.5 rounded-full ${c.approved ? "bg-emerald-500" : "bg-red-500"}`} />
                          <div>
                            <span className="text-sm font-medium text-slate-900">{formatCpfCnpj(c.cpfCnpj)}</span>
                            {customerName && <span className="text-xs text-slate-500 ml-2">{customerName}</span>}
                            {!customerName && resultData?.notFound && <span className="text-xs text-slate-500 ml-2">Nao encontrado</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap justify-end">
                          {providersFound > 0 && <span className="text-xs text-slate-500">{providersFound} prov.</span>}
                          <span className="text-sm font-medium text-slate-700">Score: {c.score}/100</span>
                          <Badge className={`${riskDecisionBadge(c.decisionReco)} border-0 text-xs`}>
                            {c.decisionReco === "Accept" ? "Aprovar" : c.decisionReco === "Review" ? "Revisar" : "Rejeitar"}
                          </Badge>
                          {c.cost === 0
                            ? <Badge variant="secondary" className="text-xs">Gratis</Badge>
                            : <Badge variant="outline" className="text-xs">-{c.cost} cred.</Badge>
                          }
                          <span className="text-xs text-slate-400">
                            {c.createdAt ? new Date(c.createdAt).toLocaleDateString("pt-BR") : ""}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* ── ABA: RELATORIOS ── */}
        {activeTab === "relatorios" && (
          <Card className="shadow-lg rounded-2xl overflow-hidden">
            <div className="bg-slate-50 border-b px-6 py-4 flex items-center gap-3">
              <BarChart3 className="w-5 h-5 text-slate-500" />
              <h2 className="text-lg font-semibold text-slate-900">Resumo de Consultas</h2>
            </div>
            <div className="p-6">
              {consultations.length === 0 ? (
                <div className="text-center py-12">
                  <BarChart3 className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                  <p className="text-slate-500">Realize consultas para ver o resumo</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: "Total Consultas", value: consultations.length, color: "text-slate-900" },
                      { label: "Aprovadas", value: approvedCount, color: "text-emerald-600" },
                      { label: "Rejeitadas", value: rejectedCount, color: "text-red-600" },
                      { label: "Score Medio", value: `${avgScore}/100`, color: "text-blue-600" },
                    ].map(s => (
                      <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-4 text-center">
                        <p className="text-xs text-slate-500 mb-1">{s.label}</p>
                        <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">Distribuicao por Sugestao de Decisao</h3>
                    <div className="flex gap-1 h-4 rounded-full overflow-hidden bg-slate-100">
                      {approvedCount > 0 && (
                        <div className="bg-emerald-500" style={{ width: `${(approvedCount / consultations.length) * 100}%` }} />
                      )}
                      {rejectedCount > 0 && (
                        <div className="bg-red-500" style={{ width: `${(rejectedCount / consultations.length) * 100}%` }} />
                      )}
                    </div>
                    <div className="flex justify-between mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500" />Aprovadas ({approvedCount})</span>
                      <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500" />Rejeitadas ({rejectedCount})</span>
                    </div>
                  </div>
                  {(() => {
                    const freeCount = consultations.filter((c: any) => c.cost === 0).length;
                    const paidCount = consultations.filter((c: any) => c.cost > 0).length;
                    const totalSpent = consultations.reduce((s: number, c: any) => s + (c.cost || 0), 0);
                    const withAlerts = consultations.filter((c: any) => (c.result as any)?.alerts?.length > 0).length;
                    return (
                      <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-slate-700">Creditos e Alertas</h3>
                        {[
                          { label: "Consultas gratuitas", value: freeCount, color: "text-emerald-600", bg: "bg-white" },
                          { label: "Consultas pagas", value: paidCount, color: "text-blue-600", bg: "bg-white" },
                          { label: "Total creditos consumidos", value: totalSpent, color: "text-blue-600", bg: "bg-blue-50" },
                          { label: "Consultas com alertas anti-fraude", value: withAlerts, color: "text-amber-700", bg: "bg-amber-50" },
                        ].map(r => (
                          <div key={r.label} className={`flex justify-between p-3 ${r.bg} border border-slate-200 rounded-lg text-sm`}>
                            <span className="text-slate-700">{r.label}</span>
                            <span className={`font-semibold ${r.color}`}>{r.value}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* ── ABA: INFORMACOES ── */}
        {activeTab === "info" && (
          <Card className="shadow-lg rounded-2xl overflow-hidden" data-testid="tab-content-info">
            <div className="px-6 py-4 flex items-center gap-3">
              <Shield className="w-5 h-5 text-slate-600" />
              <h2 className="text-lg font-semibold text-slate-900">Sobre a Consulta ISP</h2>
            </div>
            <div className="px-6 pb-6 space-y-5">
              {/* Busca Inteligente */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 flex items-center gap-3">
                <Search className="w-5 h-5 text-blue-600 flex-shrink-0" />
                <p className="text-sm text-blue-900">
                  <span className="font-semibold">Busca Inteligente:</span> O sistema detecta automaticamente se voce digitou um{" "}
                  <span className="font-semibold">CPF</span> (11 digitos),{" "}
                  <span className="font-semibold">CNPJ</span> (14 digitos) ou{" "}
                  <span className="font-semibold">CEP</span> (8 digitos).
                </p>
              </div>

              {/* Três cards de tipo */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    icon: FileText,
                    label: "CPF",
                    digits: "11 digitos",
                    example: "Exemplo: 123.456.789-00",
                    iconColor: "text-blue-600",
                    iconBg: "bg-blue-100",
                    border: "border-blue-200",
                    headerBg: "bg-blue-50",
                    labelColor: "text-blue-700",
                  },
                  {
                    icon: Building2,
                    label: "CNPJ",
                    digits: "14 digitos",
                    example: "Exemplo: 12.345.678/0001-00",
                    iconColor: "text-emerald-600",
                    iconBg: "bg-emerald-100",
                    border: "border-emerald-200",
                    headerBg: "bg-emerald-50",
                    labelColor: "text-emerald-700",
                  },
                  {
                    icon: MapPin,
                    label: "CEP",
                    digits: "8 digitos",
                    example: "Exemplo: 12345-678",
                    iconColor: "text-purple-600",
                    iconBg: "bg-purple-100",
                    border: "border-purple-200",
                    headerBg: "bg-purple-50",
                    labelColor: "text-purple-700",
                  },
                ].map(t => (
                  <div
                    key={t.label}
                    className={`rounded-xl border ${t.border} overflow-hidden shadow-sm`}
                    data-testid={`card-type-${t.label.toLowerCase()}`}
                  >
                    <div className={`${t.headerBg} px-5 py-4 flex items-center gap-3 border-b ${t.border}`}>
                      <div className={`w-9 h-9 rounded-lg ${t.iconBg} flex items-center justify-center`}>
                        <t.icon className={`w-5 h-5 ${t.iconColor}`} />
                      </div>
                      <span className={`text-base font-semibold ${t.labelColor}`}>{t.label}</span>
                    </div>
                    <div className="bg-white px-5 py-4">
                      <p className="text-sm text-slate-800 font-medium">{t.digits}</p>
                      <p className="text-xs text-slate-500 mt-1">{t.example}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

      </div>
    </div>
  );
}
