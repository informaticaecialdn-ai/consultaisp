import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
  User,
  Calendar,
  DollarSign,
  Package,
  XCircle,
  ArrowRight,
  Eye,
  ShieldAlert,
  CircleDot,
  Hash,
  Timer,
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

function ScoreGauge({ score, riskTier, riskLabel, recommendation }: { score: number; riskTier: string; riskLabel: string; recommendation: string }) {
  const colors: Record<string, { stroke: string; text: string; bg: string; ringBg: string }> = {
    low: { stroke: "#10b981", text: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30", ringBg: "text-emerald-100 dark:text-emerald-900/30" },
    medium: { stroke: "#f59e0b", text: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30", ringBg: "text-amber-100 dark:text-amber-900/30" },
    high: { stroke: "#f97316", text: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/30", ringBg: "text-orange-100 dark:text-orange-900/30" },
    critical: { stroke: "#ef4444", text: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-950/30", ringBg: "text-rose-100 dark:text-rose-900/30" },
  };
  const c = colors[riskTier] || colors.critical;
  const pct = Math.max(0, Math.min(100, score));
  const circumference = 2 * Math.PI * 52;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  return (
    <div className={`flex flex-col items-center gap-3 p-6 rounded-2xl ${c.bg} min-w-[200px]`}>
      <div className="relative">
        <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
          <circle cx="70" cy="70" r="52" fill="none" strokeWidth="12" className={c.ringBg} stroke="currentColor" />
          <circle
            cx="70" cy="70" r="52" fill="none" strokeWidth="12"
            stroke={c.stroke} strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-4xl font-bold ${c.text}`} data-testid="text-score-value">{score}</span>
          <span className="text-xs text-muted-foreground font-medium">de 100</span>
        </div>
      </div>
      <div className="text-center space-y-1">
        <Badge className={`${
          riskTier === "low" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" :
          riskTier === "medium" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" :
          riskTier === "high" ? "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" :
          "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
        } border-0 text-xs px-3 py-1`} data-testid="text-risk-tier">
          {riskLabel}
        </Badge>
        <p className="text-sm font-medium text-muted-foreground" data-testid="text-recommendation">{recommendation}</p>
      </div>
    </div>
  );
}

function StatItem({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | number; color?: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color || "bg-slate-100 dark:bg-slate-800"}`}>
        <Icon className="w-4 h-4 text-slate-600 dark:text-slate-300" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-sm font-semibold truncate">{value}</p>
      </div>
    </div>
  );
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

  const approvalRate = data?.consultations?.length > 0
    ? Math.round((data.consultations.filter((c: any) => c.approved).length / data.consultations.length) * 100)
    : 0;

  const avgScore = data?.consultations?.length > 0
    ? Math.round(data.consultations.reduce((acc: number, c: any) => acc + (c.score || 0), 0) / data.consultations.length)
    : 0;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" data-testid="consulta-isp-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-consulta-isp-title">Consulta ISP</h1>
            <p className="text-sm text-muted-foreground">Analise de credito colaborativa entre provedores</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="gap-1.5 px-4 py-2 text-sm bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200/50 dark:border-blue-800/30">
            <CreditCard className="w-4 h-4 text-blue-600" />
            <span className="text-muted-foreground">Creditos:</span>
            <span className="font-bold text-blue-700 dark:text-blue-400" data-testid="text-isp-credits">{data?.credits ?? "..."}</span>
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-blue-500/5 rounded-bl-[2rem]" />
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Search className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-sm text-muted-foreground">Hoje</span>
          </div>
          <div className="text-3xl font-bold" data-testid="text-isp-today">{isLoading ? <Skeleton className="h-8 w-10" /> : data?.todayCount}</div>
          <p className="text-xs text-muted-foreground mt-1">consultas realizadas</p>
        </Card>
        <Card className="p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-orange-500/5 rounded-bl-[2rem]" />
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
              <CalendarDays className="w-5 h-5 text-orange-600" />
            </div>
            <span className="text-sm text-muted-foreground">Este mes</span>
          </div>
          <div className="text-3xl font-bold" data-testid="text-isp-month">{isLoading ? <Skeleton className="h-8 w-10" /> : data?.monthCount}</div>
          <p className="text-xs text-muted-foreground mt-1">consultas no periodo</p>
        </Card>
        <Card className="p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/5 rounded-bl-[2rem]" />
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
            </div>
            <span className="text-sm text-muted-foreground">Aprovacao</span>
          </div>
          <div className="text-3xl font-bold">{isLoading ? <Skeleton className="h-8 w-10" /> : `${approvalRate}%`}</div>
          <p className="text-xs text-muted-foreground mt-1">taxa de aprovacao</p>
        </Card>
        <Card className="p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-purple-500/5 rounded-bl-[2rem]" />
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-purple-600" />
            </div>
            <span className="text-sm text-muted-foreground">Score medio</span>
          </div>
          <div className="text-3xl font-bold">{isLoading ? <Skeleton className="h-8 w-10" /> : avgScore}</div>
          <p className="text-xs text-muted-foreground mt-1">pontuacao media</p>
        </Card>
      </div>

      <Tabs defaultValue="nova" className="space-y-4">
        <TabsList className="bg-muted/50">
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
              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Search className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Realizar Consulta</h2>
                <p className="text-xs text-muted-foreground">Pesquise por CPF, CNPJ ou CEP</p>
              </div>
            </div>

            <div className="flex gap-3 items-center">
              <div className="relative flex-1">
                <Input
                  data-testid="input-isp-search"
                  placeholder="Digite CPF, CNPJ ou CEP"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pr-10 h-11 text-base"
                />
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    navigator.clipboard.readText().then((text) => {
                      if (text) setQuery(text);
                    }).catch(() => {});
                  }}
                  title="Colar da area de transferencia"
                  aria-label="Colar da area de transferencia"
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
                className="bg-gradient-to-r from-blue-600 to-indigo-600 h-11 px-6 shadow-md shadow-blue-500/20"
                data-testid="button-consultar-isp"
              >
                <Search className="w-4 h-4 mr-2" />
                {mutation.isPending ? "Consultando..." : "Consultar"}
              </Button>
            </div>

            <div className="flex items-center gap-4 mt-3">
              {detectedType && (
                <div className="flex items-center gap-1.5" data-testid="text-detected-type">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  <span className="text-sm font-medium text-emerald-600">{detectedType} detectado</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><CircleDot className="w-3 h-3" /> CPF: 11 digitos</span>
                <span className="flex items-center gap-1"><CircleDot className="w-3 h-3" /> CNPJ: 14 digitos</span>
                <span className="flex items-center gap-1"><CircleDot className="w-3 h-3" /> CEP: 8 digitos</span>
              </div>
            </div>

            {result && (
              <div className="mt-8 space-y-6" data-testid="consultation-result">
                <Separator />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Eye className="w-5 h-5 text-slate-500" />
                    <div>
                      <h3 className="text-lg font-bold">Resultado da Consulta</h3>
                      <p className="text-sm text-muted-foreground">
                        {result.searchType.toUpperCase()}: <span className="font-mono font-medium text-foreground">{formatCpfCnpj(result.cpfCnpj)}</span>
                      </p>
                    </div>
                  </div>
                  {result.creditsCost > 0 ? (
                    <Badge className="bg-blue-500 border-0 text-white px-3 py-1">
                      <CreditCard className="w-3 h-3 mr-1" />
                      -{result.creditsCost} credito
                    </Badge>
                  ) : (
                    <Badge className="bg-emerald-500 border-0 text-white px-3 py-1">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Consulta Gratuita
                    </Badge>
                  )}
                </div>

                {result.notFound ? (
                  <Card className="p-8 text-center border-emerald-200 dark:border-emerald-800/30 bg-emerald-50/50 dark:bg-emerald-950/20">
                    <Shield className="w-16 h-16 mx-auto mb-4 text-emerald-500" />
                    <h4 className="text-xl font-bold text-emerald-700 dark:text-emerald-400" data-testid="text-not-found">Nenhum registro encontrado</h4>
                    <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                      Este documento nao possui registros na base de dados colaborativa. Nenhuma restricao identificada.
                    </p>
                    <div className="flex justify-center gap-3 mt-4">
                      <Badge className="bg-emerald-100 text-emerald-800 border-0 px-4 py-1.5">Score: 100/100</Badge>
                      <Badge className="bg-emerald-100 text-emerald-800 border-0 px-4 py-1.5">Sem restricoes</Badge>
                    </div>
                  </Card>
                ) : (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6">
                      <ScoreGauge score={result.score} riskTier={result.riskTier} riskLabel={result.riskLabel} recommendation={result.recommendation} />

                      <div className="space-y-4">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <StatItem icon={Building2} label="Provedores encontrados" value={`${result.providersFound} provedor(es)`} color="bg-blue-100 dark:bg-blue-900/30" />
                          <StatItem icon={Target} label="Decisao recomendada" value={result.decisionReco === "Accept" ? "Aprovar" : result.decisionReco === "Review" ? "Revisar" : "Rejeitar"} color={result.decisionReco === "Accept" ? "bg-emerald-100 dark:bg-emerald-900/30" : result.decisionReco === "Review" ? "bg-amber-100 dark:bg-amber-900/30" : "bg-rose-100 dark:bg-rose-900/30"} />
                          <StatItem icon={Shield} label="Status" value={result.isOwnCustomer ? "Cliente proprio" : "Outro provedor"} color="bg-purple-100 dark:bg-purple-900/30" />
                        </div>

                        {(result.penalties.length > 0 || result.bonuses.length > 0) && (
                          <div>
                            <button
                              onClick={() => setShowScoreDetails(!showScoreDetails)}
                              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 transition-colors font-medium"
                              data-testid="button-toggle-score-details"
                            >
                              {showScoreDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              {showScoreDetails ? "Ocultar composicao do score" : "Ver composicao do score"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {showScoreDetails && (
                      <Card className="overflow-hidden">
                        <div className="bg-slate-50 dark:bg-slate-900/50 px-5 py-3 border-b">
                          <h4 className="text-sm font-bold flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-slate-500" />
                            Composicao do Score
                          </h4>
                        </div>
                        <div className="p-5">
                          <div className="flex items-center gap-2 text-sm mb-4">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                              <Hash className="w-4 h-4 text-slate-500" />
                            </div>
                            <span className="text-muted-foreground">Score Base:</span>
                            <span className="font-bold text-lg">100</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {result.penalties.length > 0 && (
                              <div>
                                <div className="flex items-center gap-2 mb-2">
                                  <XCircle className="w-4 h-4 text-rose-500" />
                                  <span className="text-xs font-bold text-rose-600 uppercase tracking-wide">Penalidades ({result.penalties.reduce((a, p) => a + p.points, 0)} pts)</span>
                                </div>
                                <div className="space-y-1.5">
                                  {result.penalties.map((p, i) => (
                                    <div key={i} className="flex items-center justify-between text-sm p-2.5 bg-rose-50 dark:bg-rose-950/20 rounded-lg border border-rose-100 dark:border-rose-900/20">
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <Minus className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
                                        <span className="text-rose-800 dark:text-rose-300 truncate">{p.reason}</span>
                                      </div>
                                      <span className="font-bold text-rose-600 ml-2 flex-shrink-0">{p.points}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {result.bonuses.length > 0 && (
                              <div>
                                <div className="flex items-center gap-2 mb-2">
                                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                                  <span className="text-xs font-bold text-emerald-600 uppercase tracking-wide">Bonus (+{result.bonuses.reduce((a, b) => a + b.points, 0)} pts)</span>
                                </div>
                                <div className="space-y-1.5">
                                  {result.bonuses.map((b, i) => (
                                    <div key={i} className="flex items-center justify-between text-sm p-2.5 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg border border-emerald-100 dark:border-emerald-900/20">
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <Plus className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                                        <span className="text-emerald-800 dark:text-emerald-300 truncate">{b.reason}</span>
                                      </div>
                                      <span className="font-bold text-emerald-600 ml-2 flex-shrink-0">+{b.points}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    )}

                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <Building2 className="w-5 h-5 text-slate-500" />
                        <h4 className="text-base font-bold">Detalhes por Provedor</h4>
                        <Badge variant="secondary" className="text-xs">{result.providersFound} resultado(s)</Badge>
                      </div>
                      <div className="space-y-4">
                        {result.providerDetails.map((detail, i) => (
                          <Card key={i} className="overflow-hidden" data-testid={`provider-detail-${i}`}>
                            <div className={`px-5 py-3 flex items-center justify-between border-b ${
                              detail.daysOverdue > 0
                                ? "bg-rose-50 dark:bg-rose-950/20 border-b-rose-100 dark:border-b-rose-900/20"
                                : "bg-emerald-50 dark:bg-emerald-950/20 border-b-emerald-100 dark:border-b-emerald-900/20"
                            }`}>
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                  detail.daysOverdue > 0 ? "bg-rose-100 dark:bg-rose-900/30" : "bg-emerald-100 dark:bg-emerald-900/30"
                                }`}>
                                  <Wifi className={`w-4 h-4 ${detail.daysOverdue > 0 ? "text-rose-600" : "text-emerald-600"}`} />
                                </div>
                                <div>
                                  <span className="font-bold text-sm">{detail.providerName}</span>
                                  {detail.isSameProvider && (
                                    <Badge variant="secondary" className="text-[10px] ml-2 py-0">Seu provedor</Badge>
                                  )}
                                </div>
                              </div>
                              <Badge className={`border-0 text-xs ${detail.daysOverdue > 0 ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"}`}>
                                {detail.status}
                              </Badge>
                            </div>
                            <div className="p-5">
                              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                                <div className="flex items-start gap-3">
                                  <User className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-xs text-muted-foreground">Nome do cliente</p>
                                    <p className="text-sm font-semibold">{detail.customerName}</p>
                                  </div>
                                </div>
                                <div className="flex items-start gap-3">
                                  <Timer className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-xs text-muted-foreground">Dias em atraso</p>
                                    <p className={`text-sm font-semibold ${detail.daysOverdue > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                                      {detail.daysOverdue > 0 ? `${detail.daysOverdue} dias` : "Nenhum"}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-start gap-3">
                                  <DollarSign className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-xs text-muted-foreground">Valor em aberto</p>
                                    <p className={`text-sm font-semibold ${(detail.overdueAmount && detail.overdueAmount > 0) || detail.overdueAmountRange ? "text-rose-600" : ""}`}>
                                      {detail.isSameProvider && detail.overdueAmount !== undefined
                                        ? detail.overdueAmount > 0 ? `R$ ${detail.overdueAmount.toFixed(2)}` : "Sem debito"
                                        : detail.overdueAmountRange || "Sem debito"}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-start gap-3">
                                  <FileText className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-xs text-muted-foreground">Faturas vencidas</p>
                                    <p className="text-sm font-semibold">{detail.overdueInvoicesCount} fatura(s)</p>
                                  </div>
                                </div>
                                <div className="flex items-start gap-3">
                                  <Package className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-xs text-muted-foreground">Equipamentos</p>
                                    <p className={`text-sm font-semibold ${detail.hasUnreturnedEquipment ? "text-rose-600" : "text-emerald-600"}`}>
                                      {detail.hasUnreturnedEquipment
                                        ? detail.isSameProvider
                                          ? `${detail.unreturnedEquipmentCount} nao devolvido(s)`
                                          : detail.equipmentPendingSummary
                                        : "Todos devolvidos"}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-start gap-3">
                                  <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-xs text-muted-foreground">Cliente desde</p>
                                    <p className="text-sm font-semibold">
                                      {new Date(detail.contractStartDate).toLocaleDateString("pt-BR")}
                                      <span className="text-xs text-muted-foreground font-normal ml-1">({Math.floor(detail.contractAgeDays / 30)}m)</span>
                                    </p>
                                  </div>
                                </div>
                              </div>

                              {detail.isSameProvider && detail.equipmentDetails && detail.equipmentDetails.length > 0 && (
                                <div className="mt-4 pt-4 border-t">
                                  <div className="flex items-center gap-2 mb-3">
                                    <Package className="w-4 h-4 text-rose-500" />
                                    <span className="text-xs font-bold text-rose-600 uppercase tracking-wide">Equipamentos pendentes</span>
                                  </div>
                                  <div className="space-y-2">
                                    {detail.equipmentDetails.map((eq, j) => (
                                      <div key={j} className="flex items-center justify-between text-sm p-3 bg-rose-50 dark:bg-rose-950/20 rounded-lg border border-rose-100 dark:border-rose-900/20">
                                        <div className="flex items-center gap-2">
                                          <Package className="w-4 h-4 text-rose-400" />
                                          <span className="font-medium">{eq.type} - {eq.brand} {eq.model}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <span className="text-rose-600 font-bold">R$ {parseFloat(eq.value).toFixed(2)}</span>
                                          {eq.inRecoveryProcess && (
                                            <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px]">Em recuperacao</Badge>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {detail.cancelledDate && (
                                <div className="mt-3 pt-3 border-t flex items-center gap-2 text-sm text-muted-foreground">
                                  <XCircle className="w-4 h-4 text-rose-400" />
                                  Contrato cancelado em {new Date(detail.cancelledDate).toLocaleDateString("pt-BR")}
                                </div>
                              )}
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>

                    {result.alerts.length > 0 && (
                      <Card className="overflow-hidden border-amber-200 dark:border-amber-800/30">
                        <div className="bg-amber-50 dark:bg-amber-950/30 px-5 py-3 border-b border-amber-200 dark:border-amber-800/30 flex items-center gap-2">
                          <ShieldAlert className="w-4 h-4 text-amber-600" />
                          <h4 className="text-sm font-bold text-amber-800 dark:text-amber-400">Alertas de Seguranca</h4>
                          <Badge className="bg-amber-200 text-amber-800 border-0 text-[10px] ml-auto">{result.alerts.length}</Badge>
                        </div>
                        <div className="p-4 space-y-2">
                          {result.alerts.map((alert, i) => (
                            <div key={i} className="flex items-start gap-3 p-3 bg-amber-50/50 dark:bg-amber-950/10 rounded-lg" data-testid={`alert-${i}`}>
                              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                              <span className="text-sm text-amber-800 dark:text-amber-300">{alert}</span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}

                    {result.recommendedActions.length > 0 && (
                      <Card className="overflow-hidden border-blue-200 dark:border-blue-800/30">
                        <div className="bg-blue-50 dark:bg-blue-950/30 px-5 py-3 border-b border-blue-200 dark:border-blue-800/30 flex items-center gap-2">
                          <Lightbulb className="w-4 h-4 text-blue-600" />
                          <h4 className="text-sm font-bold text-blue-800 dark:text-blue-400">Acoes Recomendadas</h4>
                        </div>
                        <div className="p-4 space-y-2">
                          {result.recommendedActions.map((action, i) => (
                            <div key={i} className="flex items-start gap-3 p-3 bg-blue-50/50 dark:bg-blue-950/10 rounded-lg" data-testid={`action-${i}`}>
                              <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-bold text-blue-600">{i + 1}</span>
                              </div>
                              <span className="text-sm text-blue-800 dark:text-blue-300">{action}</span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="historico">
          <Card className="overflow-hidden">
            <div className="px-6 py-4 border-b bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-slate-500" />
                  <h2 className="text-lg font-bold">Historico de Consultas</h2>
                </div>
                {data?.consultations?.length > 0 && (
                  <Badge variant="secondary">{data.consultations.length} consulta(s)</Badge>
                )}
              </div>
            </div>
            <div className="p-6">
              {data?.consultations?.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Search className="w-16 h-16 mx-auto mb-4 opacity-20" />
                  <p className="font-medium text-lg">Nenhuma consulta realizada</p>
                  <p className="text-sm mt-1">Realize sua primeira consulta na aba "Nova Consulta"</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {data?.consultations?.map((c: any) => {
                    const tier = c.score >= 80 ? "low" : c.score >= 50 ? "medium" : c.score >= 25 ? "high" : "critical";
                    const scoreColor = tier === "low" ? "text-emerald-600" : tier === "medium" ? "text-amber-600" : tier === "high" ? "text-orange-600" : "text-rose-600";
                    return (
                      <div key={c.id} className="flex items-center justify-between p-4 rounded-xl border bg-card hover:bg-muted/30 transition-colors" data-testid={`consultation-${c.id}`}>
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            c.approved ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-rose-100 dark:bg-rose-900/30"
                          }`}>
                            {c.approved ? <CheckCircle className="w-5 h-5 text-emerald-600" /> : <XCircle className="w-5 h-5 text-rose-600" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold font-mono">{formatCpfCnpj(c.cpfCnpj)}</span>
                              <Badge variant="outline" className="text-[10px] py-0">{c.searchType?.toUpperCase()}</Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {c.createdAt ? new Date(c.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className={`text-lg font-bold ${scoreColor}`}>{c.score}</span>
                            <span className="text-xs text-muted-foreground">/100</span>
                          </div>
                          <Badge className={`${riskColors[tier]} border-0 text-xs min-w-[70px] justify-center`}>
                            {c.decisionReco === "Accept" ? "Aprovar" : c.decisionReco === "Review" ? "Revisar" : "Rejeitar"}
                          </Badge>
                          {c.cost === 0 ? (
                            <Badge variant="secondary" className="text-[10px]">Gratis</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">-{c.cost} cred.</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="relatorios">
          <Card className="p-6">
            <div className="text-center py-16 text-muted-foreground">
              <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 opacity-30" />
              </div>
              <p className="font-bold text-lg">Relatorios em breve</p>
              <p className="text-sm mt-1">Funcionalidade em desenvolvimento</p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="info">
          <Card className="overflow-hidden">
            <div className="px-6 py-4 border-b bg-muted/20">
              <div className="flex items-center gap-3">
                <Info className="w-5 h-5 text-blue-500" />
                <h2 className="text-lg font-bold">Sobre a Consulta ISP</h2>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <p className="text-sm text-muted-foreground leading-relaxed">
                A Consulta ISP verifica o historico de um cliente em uma base de dados colaborativa entre provedores de internet.
                Funciona como um "SPC do setor de telecom", permitindo que provedores compartilhem informacoes sobre inadimplentes.
              </p>

              <div>
                <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
                  <Target className="w-4 h-4 text-slate-500" />
                  Classificacao de Risco
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {[
                    { range: "80-100", label: "Baixo Risco", desc: "Aprovar", dot: "bg-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-950/20", border: "border-emerald-200 dark:border-emerald-800/30" },
                    { range: "50-79", label: "Medio Risco", desc: "Aprovar com cautela", dot: "bg-amber-500", bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-800/30" },
                    { range: "25-49", label: "Alto Risco", desc: "Exigir garantias", dot: "bg-orange-500", bg: "bg-orange-50 dark:bg-orange-950/20", border: "border-orange-200 dark:border-orange-800/30" },
                    { range: "0-24", label: "Critico", desc: "Rejeitar", dot: "bg-rose-500", bg: "bg-rose-50 dark:bg-rose-950/20", border: "border-rose-200 dark:border-rose-800/30" },
                  ].map((tier) => (
                    <Card key={tier.range} className={`p-4 ${tier.bg} ${tier.border}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-3 h-3 rounded-full ${tier.dot}`} />
                        <span className="text-base font-bold">{tier.range}</span>
                      </div>
                      <p className="text-sm font-medium">{tier.label}</p>
                      <p className="text-xs text-muted-foreground">{tier.desc}</p>
                    </Card>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-slate-500" />
                  Regras de Creditos
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm">Consulta de cliente proprio</span>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-700 border-0">Gratuita</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-3">
                      <ArrowRight className="w-4 h-4 text-blue-500" />
                      <span className="text-sm">Consulta de cliente de outro provedor</span>
                    </div>
                    <Badge className="bg-blue-100 text-blue-700 border-0">1 credito</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-3">
                      <Search className="w-4 h-4 text-slate-500" />
                      <span className="text-sm">Documento nao encontrado</span>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-700 border-0">Gratuita</Badge>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-slate-500" />
                  Privacidade
                </h3>
                <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/30">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Ao consultar clientes de outros provedores, voce tera acesso a: nome, status de pagamento, faixa de valor em aberto,
                    dias de atraso, status de equipamentos e nome do provedor de origem. Dados sensiveis como endereco, telefone e email
                    nao sao compartilhados.
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
