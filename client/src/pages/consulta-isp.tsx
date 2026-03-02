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

export default function ConsultaISPPage() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ConsultaResult | null>(null);
  const [showScoreDetails, setShowScoreDetails] = useState(false);
  const [activeTab, setActiveTab] = useState<"nova" | "historico" | "relatorios" | "info">("nova");

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
      queryClient.invalidateQueries({ queryKey: ["/api/isp-consultations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Consulta realizada", description: "Consulta ISP processada com sucesso" });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

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

                {/* Aviso de confidencialidade */}
                <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 flex items-start gap-3">
                  <Lock className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-bold text-base text-amber-900">INFORMACAO CONFIDENCIAL</p>
                    <p className="text-sm text-amber-800 mt-0.5">
                      As informacoes divulgadas atraves desta plataforma sao de uso exclusivo do provedor consulente,
                      vedada sua divulgacao a terceiros, nos termos da legislacao vigente.
                    </p>
                  </div>
                </div>

                {/* Card de resultado */}
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
                        Recomendacao: Aprovar — Prosseguir para Consulta SPC para verificacao completa
                      </p>
                    </div>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {/* Card principal do resultado */}
                    {(() => {
                      const style = decisionCardStyle(result.decisionReco);
                      const DecIcon = decisionIcon(result.decisionReco);
                      return (
                        <Card className={`overflow-hidden border-2 ${style.border} shadow-lg rounded-2xl`}>
                          <div className={`${style.header} px-6 py-4 flex items-center justify-between flex-wrap gap-3`}>
                            <div className="flex items-center gap-3">
                              <DecIcon className={`w-6 h-6 ${style.iconClass}`} />
                              <div>
                                <h3 className="text-lg font-semibold text-slate-900">Resultado da Consulta</h3>
                                <p className="text-sm text-slate-600">Documento: {formatCpfCnpj(result.cpfCnpj)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-slate-500">{result.providersFound} cadastro(s) encontrado(s)</span>
                              {result.creditsCost > 0 ? (
                                <Badge className="bg-blue-100 text-blue-700 border-blue-300 border text-xs">-{result.creditsCost} credito</Badge>
                              ) : (
                                <Badge className="bg-green-100 text-green-700 border-green-300 border text-xs">Gratuita</Badge>
                              )}
                            </div>
                          </div>

                          {/* Tabela de clientes */}
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600 uppercase">
                                  <th className="text-left px-4 py-3">Cliente</th>
                                  <th className="text-left px-4 py-3">Status</th>
                                  <th className="text-left px-4 py-3">Valor Aberto</th>
                                  <th className="text-center px-4 py-3">Score</th>
                                  <th className="text-center px-4 py-3">Risco</th>
                                  <th className="text-left px-4 py-3">Tags</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {result.providerDetails.map((detail, i) => {
                                  const rowScore = result.score;
                                  const scoreColorClass = scoreColor(rowScore);
                                  const scoreBgClass = scoreBg(rowScore);
                                  return (
                                    <tr
                                      key={i}
                                      className="hover:bg-slate-50 transition-colors"
                                      data-testid={`provider-detail-${i}`}
                                    >
                                      <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-md flex-shrink-0">
                                            {getInitials(detail.customerName || detail.providerName)}
                                          </div>
                                          <div>
                                            <p className="font-medium text-slate-900 text-sm">
                                              {detail.isSameProvider ? detail.customerName : (
                                                <span className="flex items-center gap-1">
                                                  <Lock className="w-3 h-3 text-slate-400" />
                                                  Dado restrito
                                                </span>
                                              )}
                                            </p>
                                            <p className="text-xs text-slate-500">{detail.providerName}</p>
                                            {detail.isSameProvider && (
                                              <Badge className="text-xs bg-blue-100 text-blue-700 border-0 mt-0.5">Seu provedor</Badge>
                                            )}
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3">
                                        <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full ${getPaymentStatusColor(detail.daysOverdue)}`}>
                                          {detail.daysOverdue === 0 ? "Em dia" : "Atrasado"}
                                        </span>
                                        {detail.daysOverdue > 0 && (
                                          <p className="text-xs text-slate-500 mt-0.5">{detail.daysOverdue} dias</p>
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        <p className={`text-sm font-semibold ${detail.daysOverdue > 0 ? "text-red-600" : "text-slate-700"}`}>
                                          {detail.isSameProvider && detail.overdueAmount !== undefined
                                            ? `R$ ${detail.overdueAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                                            : detail.overdueAmountRange || "R$ 0,00"}
                                        </p>
                                        {detail.overdueInvoicesCount > 0 && (
                                          <p className="text-xs text-slate-500">{detail.overdueInvoicesCount} fatura(s)</p>
                                        )}
                                      </td>
                                      <td className="px-4 py-3 text-center">
                                        <div className="flex flex-col items-center gap-1">
                                          <div className="relative w-[50px] h-[50px]">
                                            <ScoreGaugeSvg score={rowScore} />
                                            <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold rotate-90 ${scoreColorClass}`} data-testid="text-score-value">
                                              {rowScore}
                                            </span>
                                          </div>
                                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${scoreBgClass}`}>
                                            {rowScore}/100
                                          </span>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3 text-center">
                                        <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full ${riskDecisionBadge(result.decisionReco)}`} data-testid="text-risk-tier">
                                          {result.decisionReco === "Accept" ? "Baixo"
                                           : result.decisionReco === "Review" ? "Medio"
                                           : "Alto"}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                          {detail.hasUnreturnedEquipment && (
                                            <span className="text-xs px-2 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-300">
                                              Eqp
                                            </span>
                                          )}
                                          {result.isOwnCustomer && (
                                            <Badge className="text-xs bg-blue-50 text-blue-700 border-blue-200 border">Proprio</Badge>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </Card>
                      );
                    })()}

                    {/* Score details toggle */}
                    <Card className="overflow-hidden shadow-sm rounded-xl">
                      <button
                        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors"
                        onClick={() => setShowScoreDetails(!showScoreDetails)}
                        data-testid="button-toggle-score-details"
                      >
                        <div className="flex items-center gap-2">
                          <Target className="w-4 h-4 text-blue-600" />
                          <span className="text-sm font-semibold">Composicao do Score ISP</span>
                          <span className="text-sm text-slate-500">— Score base: 100</span>
                        </div>
                        {showScoreDetails ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </button>
                      {showScoreDetails && (
                        <div className="px-5 pb-5 border-t pt-4 space-y-3">
                          {result.penalties.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-xs font-semibold text-red-600 uppercase">Penalidades</p>
                              {result.penalties.map((p, i) => (
                                <div key={i} className="flex items-center justify-between text-sm p-2 bg-red-50 rounded-lg">
                                  <div className="flex items-center gap-2"><Minus className="w-3 h-3 text-red-500" /><span className="text-slate-700">{p.reason}</span></div>
                                  <span className="font-semibold text-red-600">{p.points}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {result.bonuses.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-xs font-semibold text-emerald-600 uppercase">Bonus</p>
                              {result.bonuses.map((b, i) => (
                                <div key={i} className="flex items-center justify-between text-sm p-2 bg-emerald-50 rounded-lg">
                                  <div className="flex items-center gap-2"><Plus className="w-3 h-3 text-emerald-500" /><span className="text-slate-700">{b.reason}</span></div>
                                  <span className="font-semibold text-emerald-600">+{b.points}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="pt-3 border-t flex items-center justify-between">
                            <span className="font-semibold">Score Final:</span>
                            <span className="text-lg font-bold">{result.score}/100</span>
                          </div>
                        </div>
                      )}
                    </Card>

                    {/* Equipamentos não devolvidos - para próprio provedor */}
                    {result.providerDetails.some(d => d.isSameProvider && d.hasUnreturnedEquipment && d.equipmentDetails?.length) && (
                      result.providerDetails.filter(d => d.isSameProvider && d.hasUnreturnedEquipment).map((detail, i) => (
                        <Card key={i} className="overflow-hidden shadow-sm rounded-xl">
                          <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-red-200 bg-white">
                            <h4 className="font-semibold text-red-900 flex items-center gap-2">
                              <Router className="w-4 h-4" />
                              Equipamentos Nao Devolvidos
                            </h4>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-300 font-medium">
                              {detail.unreturnedEquipmentCount} item(s)
                            </span>
                          </div>
                          <div className="p-4 space-y-2">
                            {detail.equipmentDetails?.map((eq, j) => (
                              <div key={j} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                                    <Router className="w-4 h-4 text-red-600" />
                                  </div>
                                  <span className="text-sm font-medium">{eq.type} {eq.brand} {eq.model}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xl font-bold text-red-700">R$ {parseFloat(eq.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                                  {eq.inRecoveryProcess && <Badge variant="secondary" className="text-xs">Em recuperacao</Badge>}
                                </div>
                              </div>
                            ))}
                            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between text-sm">
                              <span className="font-semibold text-red-900">Total em equipamentos</span>
                              <span className="font-bold text-red-700">
                                R$ {detail.equipmentDetails?.reduce((s, e) => s + parseFloat(e.value), 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>
                        </Card>
                      ))
                    )}

                    {/* Alertas anti-fraude */}
                    {result.alerts.length > 0 && (
                      <Card className="p-5 bg-amber-50 border border-amber-200 shadow-sm rounded-xl">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2 text-amber-800">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          Fatores de Risco
                        </h4>
                        <div className="space-y-2">
                          {result.alerts.map((alert, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm" data-testid={`alert-${i}`}>
                              <div className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
                              <span className="text-amber-800">{alert}</span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}

                    {/* Ações recomendadas */}
                    {result.recommendedActions.length > 0 && (
                      <Card className="p-5 bg-blue-50 border border-blue-200 shadow-sm rounded-xl">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2 text-blue-800">
                          <Lightbulb className="w-4 h-4" />
                          Acoes Recomendadas
                        </h4>
                        <div className="space-y-2">
                          {result.recommendedActions.map((action, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm" data-testid={`action-${i}`}>
                              <span className="text-blue-600 font-semibold min-w-[20px]">{i + 1}.</span>
                              <span className="text-blue-800">{action}</span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}
                  </div>
                )}
              </div>
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
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">Distribuicao por Decisao</h3>
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
                    iconBg: "bg-blue-50",
                  },
                  {
                    icon: Building2,
                    label: "CNPJ",
                    digits: "14 digitos",
                    example: "Exemplo: 12.345.678/0001-00",
                    iconColor: "text-blue-600",
                    iconBg: "bg-blue-50",
                  },
                  {
                    icon: MapPin,
                    label: "CEP",
                    digits: "8 digitos",
                    example: "Exemplo: 12345-678",
                    iconColor: "text-blue-600",
                    iconBg: "bg-blue-50",
                  },
                ].map(t => (
                  <div
                    key={t.label}
                    className="border border-slate-200 rounded-xl p-5 bg-white"
                    data-testid={`card-type-${t.label.toLowerCase()}`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-9 h-9 rounded-lg ${t.iconBg} flex items-center justify-center`}>
                        <t.icon className={`w-5 h-5 ${t.iconColor}`} />
                      </div>
                      <span className="text-base font-semibold text-slate-900">{t.label}</span>
                    </div>
                    <p className="text-sm text-slate-700 font-medium">{t.digits}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{t.example}</p>
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
