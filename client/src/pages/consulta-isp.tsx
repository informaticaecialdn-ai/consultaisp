import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  TrendingUp,
  CalendarDays,
  CheckCircle,
  BarChart3,
  Info,
  Clock,
  FileText,
  CreditCard,
  AlertTriangle,
  Shield,
  Building2,
  Wifi,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Target,
  Minus,
  Plus,
  ClipboardCopy,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Users,
  Zap,
  Router,
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

function ScoreGauge({ score, riskTier }: { score: number; riskTier: string }) {
  const colors: Record<string, { bg: string; text: string; ring: string }> = {
    low: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200" },
    medium: { bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-200" },
    high: { bg: "bg-orange-50", text: "text-orange-700", ring: "ring-orange-200" },
    critical: { bg: "bg-rose-50", text: "text-rose-700", ring: "ring-rose-200" },
  };
  const c = colors[riskTier] || colors.critical;
  const pct = Math.max(0, Math.min(100, score));
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  return (
    <div className={`relative flex flex-col items-center justify-center p-6 rounded-2xl ${c.bg} ring-1 ${c.ring}`}>
      <svg width="120" height="120" viewBox="0 0 120 120" className="-rotate-90">
        <circle cx="60" cy="60" r="45" fill="none" stroke="currentColor" strokeWidth="10" className="text-gray-200" />
        <circle
          cx="60" cy="60" r="45" fill="none" strokeWidth="10"
          stroke="url(#gaugeGrad)" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-1000"
        />
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" className={`${c.text}`} stopColor="currentColor" />
            <stop offset="100%" className={`${c.text}`} stopColor="currentColor" stopOpacity="0.6" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-3xl font-bold ${c.text}`} data-testid="text-score-value">{score}</span>
        <span className="text-xs text-muted-foreground">/100</span>
      </div>
    </div>
  );
}

function getPaymentStatusLabel(daysOverdue: number, cancelledDate?: string): string {
  if (daysOverdue === 0 && !cancelledDate) return "Em dia";
  if (daysOverdue === 0 && cancelledDate) return "Cancelado (quitado)";
  if (daysOverdue <= 30) return "Inadimplente (1-30 dias)";
  if (daysOverdue <= 60) return "Inadimplente (31-60 dias)";
  if (daysOverdue <= 90) return "Inadimplente (61-90 dias)";
  return "Inadimplente (90+ dias)";
}

function getPaymentStatusColor(daysOverdue: number): string {
  if (daysOverdue === 0) return "bg-emerald-100 text-emerald-700";
  if (daysOverdue <= 30) return "bg-amber-100 text-amber-700";
  if (daysOverdue <= 60) return "bg-orange-100 text-orange-700";
  return "bg-rose-100 text-rose-700";
}

export default function ConsultaISPPage() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ConsultaResult | null>(null);
  const [showScoreDetails, setShowScoreDetails] = useState(false);

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
    if (cleaned.length === 11) return "CPF";
    if (cleaned.length === 14) return "CNPJ";
    if (cleaned.length === 8) return "CEP";
    return null;
  };

  const detectedType = getDetectedType(query);

  const riskColors: Record<string, string> = {
    low: "bg-emerald-100 text-emerald-800",
    medium: "bg-amber-100 text-amber-800",
    high: "bg-orange-100 text-orange-800",
    critical: "bg-rose-100 text-rose-800",
  };

  const riskIconColors: Record<string, string> = {
    low: "bg-emerald-500",
    medium: "bg-amber-500",
    high: "bg-orange-500",
    critical: "bg-rose-500",
  };

  const consultations = data?.consultations || [];
  const approvedCount = consultations.filter((c: any) => c.approved).length;
  const rejectedCount = consultations.filter((c: any) => !c.approved).length;
  const avgScore = consultations.length > 0
    ? Math.round(consultations.reduce((acc: number, c: any) => acc + (c.score || 0), 0) / consultations.length)
    : 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="consulta-isp-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <Search className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-consulta-isp-title">Consulta ISP</h1>
            <p className="text-sm text-muted-foreground">Rede colaborativa de protecao ao credito para provedores</p>
          </div>
        </div>
        <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-sm">
          <CreditCard className="w-4 h-4 text-blue-600" />
          Creditos ISP: <span className="font-bold" data-testid="text-isp-credits">{data?.credits ?? "..."}</span>
        </Badge>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border-blue-200/50 dark:border-blue-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Consultas Hoje</span>
            <TrendingUp className="w-5 h-5 text-blue-500" />
          </div>
          <div className="text-2xl font-bold" data-testid="text-isp-today">{isLoading ? <Skeleton className="h-7 w-8" /> : data?.todayCount}</div>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/30 dark:to-orange-900/20 border-orange-200/50 dark:border-orange-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Consultas Mes</span>
            <CalendarDays className="w-5 h-5 text-orange-500" />
          </div>
          <div className="text-2xl font-bold" data-testid="text-isp-month">{isLoading ? <Skeleton className="h-7 w-8" /> : data?.monthCount}</div>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/20 border-emerald-200/50 dark:border-emerald-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Taxa Aprovacao</span>
            <CheckCircle className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold">
            {isLoading ? <Skeleton className="h-7 w-8" /> : (
              consultations.length > 0
                ? Math.round((approvedCount / consultations.length) * 100) + "%"
                : "0%"
            )}
          </div>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/20 border-purple-200/50 dark:border-purple-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Score Medio ISP</span>
            <BarChart3 className="w-5 h-5 text-purple-500" />
          </div>
          <div className="text-2xl font-bold">{isLoading ? <Skeleton className="h-7 w-8" /> : avgScore}</div>
        </Card>
      </div>

      <Tabs defaultValue="nova" className="space-y-4">
        <TabsList>
          <TabsTrigger value="nova" className="gap-1.5" data-testid="tab-nova-consulta">
            <Search className="w-3.5 h-3.5" />
            Nova Consulta
          </TabsTrigger>
          <TabsTrigger value="historico" className="gap-1.5" data-testid="tab-historico">
            <Clock className="w-3.5 h-3.5" />
            Historico
          </TabsTrigger>
          <TabsTrigger value="relatorios" className="gap-1.5" data-testid="tab-relatorios">
            <BarChart3 className="w-3.5 h-3.5" />
            Relatorios
          </TabsTrigger>
          <TabsTrigger value="info" className="gap-1.5" data-testid="tab-info">
            <Info className="w-3.5 h-3.5" />
            Informacoes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="nova">
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <Search className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold">Realizar Consulta ISP</h2>
            </div>

            <div className="flex gap-3 items-center">
              <div className="relative flex-1">
                <Input
                  data-testid="input-isp-search"
                  placeholder="Digite CPF, CNPJ ou CEP"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pr-10"
                />
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    navigator.clipboard.readText().then((text) => {
                      if (text) setQuery(text);
                    }).catch(() => {});
                  }}
                  title="Colar da area de transferencia"
                  data-testid="button-paste-clipboard"
                >
                  <ClipboardCopy className="w-4 h-4" />
                </button>
              </div>
              <Button variant="ghost" onClick={() => { setQuery(""); setResult(null); }} data-testid="button-clear-isp">
                Limpar
              </Button>
              <Button
                onClick={handleSearch}
                disabled={!query.trim() || mutation.isPending}
                className="bg-gradient-to-r from-blue-600 to-blue-700"
                data-testid="button-consultar-isp"
              >
                {mutation.isPending ? "Consultando..." : "Consultar ISP"}
              </Button>
            </div>

            {detectedType && (
              <div className="mt-2 flex items-center gap-1.5" data-testid="text-detected-type">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-medium text-emerald-600">{detectedType} detectado</span>
              </div>
            )}

            <div className="mt-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg p-4 flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Busca Inteligente:</span> Digite um{" "}
                <span className="font-bold text-blue-600">CPF</span> (11 digitos) ou{" "}
                <span className="font-bold text-blue-600">CNPJ</span> (14 digitos).{" "}
                O sistema busca em todos os provedores da rede colaborativa e retorna score, restricoes, equipamentos e alertas.
              </p>
            </div>

            {result && (
              <div className="mt-6 space-y-5" data-testid="consultation-result">
                <div className="border rounded-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-6 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Search className="w-5 h-5" />
                        <div>
                          <h3 className="text-lg font-semibold">Resultado da Consulta ISP</h3>
                          <p className="text-sm text-slate-300">Documento: {formatCpfCnpj(result.cpfCnpj)}</p>
                        </div>
                      </div>
                      {result.creditsCost > 0 ? (
                        <Badge className="bg-blue-500 border-0 text-white">
                          -{result.creditsCost} credito
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-500 border-0 text-white">Gratuita</Badge>
                      )}
                    </div>
                  </div>

                  {result.notFound ? (
                    <div className="p-8 text-center">
                      <Shield className="w-12 h-12 mx-auto mb-3 text-emerald-500" />
                      <h4 className="text-lg font-semibold text-emerald-700" data-testid="text-not-found">Nenhum registro encontrado</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Este documento nao possui registros na base de dados colaborativa ISP.
                      </p>
                      <Badge className="mt-3 bg-emerald-100 text-emerald-800 border-0">Score: 100/100 - Sem restricoes</Badge>
                      <p className="text-xs text-muted-foreground mt-3">Recomendacao: Aprovar - Prosseguir para Consulta SPC para verificacao completa</p>
                    </div>
                  ) : (
                    <div className="p-6 space-y-6">
                      <div className="flex flex-col md:flex-row gap-6 items-start">
                        <ScoreGauge score={result.score} riskTier={result.riskTier} />
                        <div className="flex-1 space-y-3">
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className={`w-4 h-4 rounded-full ${riskIconColors[result.riskTier]}`} />
                            <Badge className={`${riskColors[result.riskTier]} border-0 text-sm px-3 py-1`} data-testid="text-risk-tier">
                              {result.riskLabel}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <Target className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Recomendacao:</span>
                            <span className="text-sm font-semibold" data-testid="text-recommendation">{result.recommendation}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Encontrado em:</span>
                            <span className="text-sm font-semibold">{result.providersFound} provedor(es)</span>
                          </div>
                          {result.isOwnCustomer && (
                            <div className="flex items-center gap-2">
                              <Shield className="w-4 h-4 text-blue-500" />
                              <span className="text-sm text-blue-600 font-medium">Cliente do seu provedor (consulta gratuita)</span>
                            </div>
                          )}
                          <button
                            onClick={() => setShowScoreDetails(!showScoreDetails)}
                            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 transition-colors"
                            data-testid="button-toggle-score-details"
                          >
                            {showScoreDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            {showScoreDetails ? "Ocultar detalhes do score" : "Ver detalhes do score"}
                          </button>
                        </div>
                      </div>

                      {showScoreDetails && (
                        <Card className="p-4 bg-slate-50 dark:bg-slate-900/30">
                          <h4 className="text-sm font-semibold mb-3">Composicao do Score</h4>
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                              <span className="font-medium text-foreground">Score Base: 100</span>
                            </div>
                            {result.penalties.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-xs font-semibold text-rose-600 uppercase">Penalidades</span>
                                {result.penalties.map((p, i) => (
                                  <div key={i} className="flex items-center justify-between text-sm p-2 bg-rose-50 dark:bg-rose-950/20 rounded">
                                    <div className="flex items-center gap-2">
                                      <Minus className="w-3 h-3 text-rose-500" />
                                      <span>{p.reason}</span>
                                    </div>
                                    <span className="font-semibold text-rose-600">{p.points}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {result.bonuses.length > 0 && (
                              <div className="space-y-1 mt-2">
                                <span className="text-xs font-semibold text-emerald-600 uppercase">Bonus</span>
                                {result.bonuses.map((b, i) => (
                                  <div key={i} className="flex items-center justify-between text-sm p-2 bg-emerald-50 dark:bg-emerald-950/20 rounded">
                                    <div className="flex items-center gap-2">
                                      <Plus className="w-3 h-3 text-emerald-500" />
                                      <span>{b.reason}</span>
                                    </div>
                                    <span className="font-semibold text-emerald-600">+{b.points}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="mt-3 pt-3 border-t flex items-center justify-between text-sm">
                              <span className="font-semibold">Score Final:</span>
                              <span className="text-lg font-bold">{result.score}/100</span>
                            </div>
                          </div>
                        </Card>
                      )}

                      <div>
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                          <Building2 className="w-4 h-4" />
                          Encontrado em {result.providersFound} provedor(es)
                        </h4>
                        <div className="space-y-3">
                          {result.providerDetails.map((detail, i) => (
                            <Card key={i} className="p-0 overflow-hidden" data-testid={`provider-detail-${i}`}>
                              <div className="flex">
                                <div className="w-1.5 flex-shrink-0 rounded-l-lg" style={{ backgroundColor: detail.daysOverdue > 0 ? "#f43f5e" : "#10b981" }} />
                                <div className="flex-1 p-4">
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                      <Wifi className="w-4 h-4 text-blue-600" />
                                      <span className="font-semibold">{detail.providerName}</span>
                                      {detail.isSameProvider && (
                                        <Badge variant="secondary" className="text-xs">Seu provedor</Badge>
                                      )}
                                      {!detail.isSameProvider && (
                                        <Badge variant="outline" className="text-xs gap-1">
                                          <Lock className="w-3 h-3" /> Dados parciais
                                        </Badge>
                                      )}
                                    </div>
                                    <Badge className={`border-0 ${getPaymentStatusColor(detail.daysOverdue)}`}>
                                      {getPaymentStatusLabel(detail.daysOverdue, detail.cancelledDate)}
                                    </Badge>
                                  </div>
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                                    <div>
                                      <span className="text-muted-foreground">Nome:</span>
                                      <p className="font-medium">{detail.customerName}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Dias em atraso:</span>
                                      <p className={`font-medium ${detail.daysOverdue > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                                        {detail.daysOverdue > 0 ? `${detail.daysOverdue} dias` : "0 (em dia)"}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Valor em aberto:</span>
                                      <p className="font-medium">
                                        {detail.isSameProvider && detail.overdueAmount !== undefined
                                          ? `R$ ${detail.overdueAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                                          : detail.overdueAmountRange || "R$ 0,00"}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Faturas vencidas:</span>
                                      <p className="font-medium">{detail.overdueInvoicesCount}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Equipamentos:</span>
                                      <p className={`font-medium ${detail.hasUnreturnedEquipment ? "text-rose-600" : "text-emerald-600"}`}>
                                        {detail.hasUnreturnedEquipment
                                          ? detail.isSameProvider
                                            ? `${detail.unreturnedEquipmentCount} nao devolvido(s)`
                                            : detail.equipmentPendingSummary
                                          : "Devolvidos"}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Cliente desde:</span>
                                      <p className="font-medium">
                                        {new Date(detail.contractStartDate).toLocaleDateString("pt-BR")}
                                      </p>
                                    </div>
                                  </div>
                                  {detail.cancelledDate && (
                                    <div className="mt-3 pt-3 border-t flex items-center gap-2 text-sm">
                                      <span className="text-muted-foreground">Cancelado em:</span>
                                      <span className="font-medium text-rose-600">{new Date(detail.cancelledDate).toLocaleDateString("pt-BR")}</span>
                                    </div>
                                  )}
                                  {detail.isSameProvider && detail.equipmentDetails && detail.equipmentDetails.length > 0 && (
                                    <div className="mt-3 pt-3 border-t">
                                      <span className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
                                        <Router className="w-3 h-3" />
                                        Equipamentos nao devolvidos
                                      </span>
                                      <div className="mt-2 space-y-1">
                                        {detail.equipmentDetails.map((eq, j) => (
                                          <div key={j} className="flex items-center justify-between text-sm p-2 bg-rose-50 dark:bg-rose-950/20 rounded">
                                            <span>{eq.type} {eq.brand} {eq.model}</span>
                                            <div className="flex items-center gap-2">
                                              <span className="text-rose-600 font-medium">R$ {parseFloat(eq.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                                              {eq.inRecoveryProcess && (
                                                <Badge variant="secondary" className="text-xs">Em recuperacao</Badge>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </div>

                      {result.alerts.length > 0 && (
                        <Card className="p-4 bg-amber-50 dark:bg-amber-950/20 border-amber-200">
                          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2 text-amber-800">
                            <AlertTriangle className="w-4 h-4" />
                            Alertas Anti-Fraude
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

                      {result.recommendedActions.length > 0 && (
                        <Card className="p-4 bg-blue-50 dark:bg-blue-950/20 border-blue-200">
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
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="historico">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Historico de Consultas</h2>
            {consultations.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Nenhuma consulta realizada ainda</p>
              </div>
            ) : (
              <div className="space-y-2">
                {consultations.map((c: any) => {
                  const tier = c.score >= 80 ? "low" : c.score >= 50 ? "medium" : c.score >= 25 ? "high" : "critical";
                  const resultData = c.result as any;
                  const customerName = resultData?.providerDetails?.[0]?.customerName;
                  const providersFound = resultData?.providersFound || 0;
                  return (
                    <div key={c.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg" data-testid={`consultation-${c.id}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${c.approved ? "bg-emerald-500" : "bg-rose-500"}`} />
                        <div>
                          <span className="text-sm font-medium">{formatCpfCnpj(c.cpfCnpj)}</span>
                          {customerName && (
                            <span className="text-xs text-muted-foreground ml-2">{customerName}</span>
                          )}
                          {!customerName && resultData?.notFound && (
                            <span className="text-xs text-muted-foreground ml-2">Nao encontrado</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {providersFound > 0 && (
                          <span className="text-xs text-muted-foreground">{providersFound} provedor(es)</span>
                        )}
                        <span className="text-sm font-medium">Score: {c.score}/100</span>
                        <Badge className={`${riskColors[tier]} border-0 text-xs`}>
                          {c.decisionReco === "Accept" ? "Aprovar" : c.decisionReco === "Review" ? "Revisar" : "Rejeitar"}
                        </Badge>
                        {c.cost === 0 ? (
                          <Badge variant="secondary" className="text-xs">Gratis</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">-{c.cost} credito</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {c.createdAt ? new Date(c.createdAt).toLocaleDateString("pt-BR") : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="relatorios">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Resumo de Consultas
            </h2>
            {consultations.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Realize consultas para ver o resumo</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card className="p-4 text-center">
                    <span className="text-xs text-muted-foreground">Total Consultas</span>
                    <p className="text-2xl font-bold mt-1">{consultations.length}</p>
                  </Card>
                  <Card className="p-4 text-center">
                    <span className="text-xs text-muted-foreground">Aprovadas</span>
                    <p className="text-2xl font-bold mt-1 text-emerald-600">{approvedCount}</p>
                  </Card>
                  <Card className="p-4 text-center">
                    <span className="text-xs text-muted-foreground">Rejeitadas</span>
                    <p className="text-2xl font-bold mt-1 text-rose-600">{rejectedCount}</p>
                  </Card>
                  <Card className="p-4 text-center">
                    <span className="text-xs text-muted-foreground">Score Medio</span>
                    <p className="text-2xl font-bold mt-1">{avgScore}/100</p>
                  </Card>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-3">Distribuicao por Decisao</h3>
                  <div className="flex gap-2 h-4 rounded-full overflow-hidden">
                    {approvedCount > 0 && (
                      <div
                        className="bg-emerald-500 rounded-l-full"
                        style={{ width: `${(approvedCount / consultations.length) * 100}%` }}
                        title={`Aprovadas: ${approvedCount}`}
                      />
                    )}
                    {rejectedCount > 0 && (
                      <div
                        className="bg-rose-500 rounded-r-full"
                        style={{ width: `${(rejectedCount / consultations.length) * 100}%` }}
                        title={`Rejeitadas: ${rejectedCount}`}
                      />
                    )}
                  </div>
                  <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" /> Aprovadas ({approvedCount})
                    </span>
                    <span className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-rose-500" /> Rejeitadas ({rejectedCount})
                    </span>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-3">Creditos Consumidos</h3>
                  <div className="space-y-1">
                    {(() => {
                      const freeCount = consultations.filter((c: any) => c.cost === 0).length;
                      const paidCount = consultations.filter((c: any) => c.cost > 0).length;
                      const totalSpent = consultations.reduce((sum: number, c: any) => sum + (c.cost || 0), 0);
                      return (
                        <>
                          <div className="flex justify-between p-2 bg-muted/50 rounded text-sm">
                            <span>Consultas gratuitas (proprio/nao encontrado)</span>
                            <span className="font-medium text-emerald-600">{freeCount}</span>
                          </div>
                          <div className="flex justify-between p-2 bg-muted/50 rounded text-sm">
                            <span>Consultas pagas (outro provedor)</span>
                            <span className="font-medium text-blue-600">{paidCount}</span>
                          </div>
                          <div className="flex justify-between p-2 bg-blue-50 dark:bg-blue-950/20 rounded text-sm font-semibold">
                            <span>Total creditos consumidos</span>
                            <span className="text-blue-600">{totalSpent}</span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-3">Alertas Gerados</h3>
                  {(() => {
                    const withAlerts = consultations.filter((c: any) => (c.result as any)?.alerts?.length > 0).length;
                    return (
                      <div className="flex justify-between p-2 bg-amber-50 dark:bg-amber-950/20 rounded text-sm">
                        <span>Consultas com alertas anti-fraude</span>
                        <span className="font-medium text-amber-700">{withAlerts}</span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="info">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Sobre a Consulta ISP</h2>
            <div className="space-y-6 text-sm text-muted-foreground">
              <p>A Consulta ISP e uma rede colaborativa de protecao ao credito exclusiva para provedores de internet. Funciona como um "SPC do setor de telecom", onde provedores compartilham informacoes sobre clientes inadimplentes para proteger uns aos outros.</p>

              <div>
                <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Fluxo da Consulta
                </h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                    <span className="font-bold text-blue-600 min-w-[24px]">1.</span>
                    <div>
                      <p className="font-medium text-foreground">Digite CPF ou CNPJ</p>
                      <p className="text-xs">Valida o formato do documento automaticamente</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-center">
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                    <span className="font-bold text-blue-600 min-w-[24px]">2.</span>
                    <div>
                      <p className="font-medium text-foreground">Sistema busca em TODOS os provedores</p>
                      <p className="text-xs">Carrega dados do cliente, faturas, equipamentos e calcula score</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-center">
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                    <span className="font-bold text-blue-600 min-w-[24px]">3.</span>
                    <div>
                      <p className="font-medium text-foreground">Gera alertas anti-fraude (se aplicavel)</p>
                      <p className="text-xs">Notifica provedores originais sobre clientes inadimplentes consultados</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-center">
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                    <span className="font-bold text-blue-600 min-w-[24px]">4.</span>
                    <div>
                      <p className="font-medium text-foreground">Resultado consolidado com score e recomendacao</p>
                      <p className="text-xs">Debita creditos (se consulta de outro provedor) e salva no historico</p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Calculo do Score ISP (0-100)
                </h3>
                <p className="mb-3">Score = 100 - Penalidades + Bonus (minimo 0, maximo 100)</p>

                <div className="mb-3">
                  <span className="text-xs font-semibold text-rose-600 uppercase">Penalidades</span>
                  <div className="mt-1 space-y-1">
                    <div className="flex justify-between p-2 bg-rose-50 dark:bg-rose-950/20 rounded">
                      <span>Atraso 1-30 dias</span><span className="font-medium text-rose-600">-10</span>
                    </div>
                    <div className="flex justify-between p-2 bg-rose-50 dark:bg-rose-950/20 rounded">
                      <span>Atraso 31-60 dias</span><span className="font-medium text-rose-600">-20</span>
                    </div>
                    <div className="flex justify-between p-2 bg-rose-50 dark:bg-rose-950/20 rounded">
                      <span>Atraso 61-90 dias</span><span className="font-medium text-rose-600">-30</span>
                    </div>
                    <div className="flex justify-between p-2 bg-rose-50 dark:bg-rose-950/20 rounded">
                      <span>Atraso 90+ dias</span><span className="font-medium text-rose-600">-40</span>
                    </div>
                    <div className="flex justify-between p-2 bg-rose-50 dark:bg-rose-950/20 rounded">
                      <span>Cada R$ 100 em aberto</span><span className="font-medium text-rose-600">-5</span>
                    </div>
                    <div className="flex justify-between p-2 bg-rose-50 dark:bg-rose-950/20 rounded">
                      <span>Equipamento nao devolvido (cada)</span><span className="font-medium text-rose-600">-15</span>
                    </div>
                    <div className="flex justify-between p-2 bg-rose-50 dark:bg-rose-950/20 rounded">
                      <span>Contrato menor que 6 meses</span><span className="font-medium text-rose-600">-10</span>
                    </div>
                    <div className="flex justify-between p-2 bg-rose-50 dark:bg-rose-950/20 rounded">
                      <span>Contrato menor que 3 meses</span><span className="font-medium text-rose-600">-15</span>
                    </div>
                    <div className="flex justify-between p-2 bg-rose-50 dark:bg-rose-950/20 rounded">
                      <span>Multiplas consultas (&gt;3 em 30 dias)</span><span className="font-medium text-rose-600">-20</span>
                    </div>
                    <div className="flex justify-between p-2 bg-rose-50 dark:bg-rose-950/20 rounded">
                      <span>Divida em multiplos provedores</span><span className="font-medium text-rose-600">-25</span>
                    </div>
                  </div>
                </div>

                <div>
                  <span className="text-xs font-semibold text-emerald-600 uppercase">Bonus</span>
                  <div className="mt-1 space-y-1">
                    <div className="flex justify-between p-2 bg-emerald-50 dark:bg-emerald-950/20 rounded">
                      <span>Cliente ha mais de 2 anos (em dia)</span><span className="font-medium text-emerald-600">+10</span>
                    </div>
                    <div className="flex justify-between p-2 bg-emerald-50 dark:bg-emerald-950/20 rounded">
                      <span>Nunca atrasou pagamento</span><span className="font-medium text-emerald-600">+15</span>
                    </div>
                    <div className="flex justify-between p-2 bg-emerald-50 dark:bg-emerald-950/20 rounded">
                      <span>Equipamentos sempre devolvidos</span><span className="font-medium text-emerald-600">+5</span>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Classificacao de Risco
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-emerald-500" />
                      <span className="text-sm font-medium text-foreground">80-100</span>
                    </div>
                    <p className="text-xs font-medium">BAIXO RISCO</p>
                    <p className="text-xs">Aprovar</p>
                  </Card>
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-amber-500" />
                      <span className="text-sm font-medium text-foreground">50-79</span>
                    </div>
                    <p className="text-xs font-medium">MEDIO RISCO</p>
                    <p className="text-xs">Aprovar com cautela</p>
                  </Card>
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-orange-500" />
                      <span className="text-sm font-medium text-foreground">25-49</span>
                    </div>
                    <p className="text-xs font-medium">ALTO RISCO</p>
                    <p className="text-xs">Exigir garantias</p>
                  </Card>
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-rose-500" />
                      <span className="text-sm font-medium text-foreground">0-24</span>
                    </div>
                    <p className="text-xs font-medium">CRITICO</p>
                    <p className="text-xs">Rejeitar</p>
                  </Card>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Sistema Anti-Fraude
                </h3>
                <p className="mb-3">Alertas sao gerados automaticamente nas seguintes situacoes:</p>
                <div className="space-y-1">
                  <div className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-950/20 rounded">
                    <Zap className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium text-foreground">Cliente inadimplente consultado</span>
                      <p className="text-xs">Quando outro provedor consulta um cliente seu com atraso</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-950/20 rounded">
                    <Router className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium text-foreground">Equipamento nao devolvido</span>
                      <p className="text-xs">Quando outro provedor consulta cliente com equipamento pendente</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-950/20 rounded">
                    <Users className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium text-foreground">Multiplas consultas</span>
                      <p className="text-xs">Quando mais de 2 provedores consultam o mesmo documento em 30 dias</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-950/20 rounded">
                    <Clock className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium text-foreground">Contrato recente</span>
                      <p className="text-xs">Quando contrato com menos de 90 dias e consultado</p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <CreditCard className="w-4 h-4" />
                  Regras de Creditos
                </h3>
                <div className="space-y-1">
                  <div className="flex justify-between p-2 bg-muted/50 rounded">
                    <span>Consulta de cliente proprio</span>
                    <span className="font-medium text-emerald-600">Gratuita</span>
                  </div>
                  <div className="flex justify-between p-2 bg-muted/50 rounded">
                    <span>Consulta de cliente de outro provedor</span>
                    <span className="font-medium text-blue-600">1 credito</span>
                  </div>
                  <div className="flex justify-between p-2 bg-muted/50 rounded">
                    <span>Documento nao encontrado</span>
                    <span className="font-medium text-emerald-600">Gratuita</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Privacidade e Isolamento
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="p-3 border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/10">
                    <h4 className="text-xs font-semibold text-emerald-700 mb-2 flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5" /> Pode ver (outro provedor)
                    </h4>
                    <div className="space-y-1 text-xs">
                      <p>Nome do cliente</p>
                      <p>Status de pagamento</p>
                      <p>Faixa de valor em aberto</p>
                      <p>Dias de atraso</p>
                      <p>Se tem equipamento pendente</p>
                      <p>Nome do provedor de origem</p>
                    </div>
                  </Card>
                  <Card className="p-3 border-rose-200 bg-rose-50/50 dark:bg-rose-950/10">
                    <h4 className="text-xs font-semibold text-rose-700 mb-2 flex items-center gap-1.5">
                      <EyeOff className="w-3.5 h-3.5" /> Nao pode ver
                    </h4>
                    <div className="space-y-1 text-xs">
                      <p>Endereco completo</p>
                      <p>Telefone / Email</p>
                      <p>Detalhes das faturas</p>
                      <p>Historico de interacoes</p>
                      <p>Dados sensiveis</p>
                    </div>
                  </Card>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4" />
                  Fluxo Recomendado
                </h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                    <span className="font-bold text-blue-600">1.</span>
                    <div>
                      <p className="font-medium text-foreground">Consulta ISP (rapida e barata)</p>
                      <p className="text-xs">Se encontrar restricoes em provedores: RECUSAR. Se limpo: prosseguir para SPC.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg">
                    <span className="font-bold text-purple-600">2.</span>
                    <div>
                      <p className="font-medium text-foreground">Consulta SPC (completa)</p>
                      <p className="text-xs">Confirma situacao financeira geral. Score nacional + restricoes + historico.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg">
                    <span className="font-bold text-emerald-600">3.</span>
                    <div>
                      <p className="font-medium text-foreground">Decisao Final</p>
                      <p className="text-xs">ISP limpo + SPC limpo = Aprovar. ISP com pendencia = Recusar ou exigir garantias. SPC com restricoes = Avaliar caso a caso.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
