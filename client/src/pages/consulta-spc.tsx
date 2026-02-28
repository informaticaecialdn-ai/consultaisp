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
  User,
  Building2,
  ClipboardCopy,
  XCircle,
  Scale,
  Eye,
  Target,
} from "lucide-react";

interface SpcResult {
  cpfCnpj: string;
  cadastralData: {
    nome: string;
    cpfCnpj: string;
    dataNascimento?: string;
    dataFundacao?: string;
    nomeMae?: string;
    situacaoRf: string;
    obitoRegistrado: boolean;
    tipo: "PF" | "PJ";
  };
  score: number;
  riskLevel: string;
  riskLabel: string;
  recommendation: string;
  status: string;
  restrictions: {
    type: string;
    description: string;
    severity: string;
    creditor: string;
    value: string;
    date: string;
    origin: string;
  }[];
  totalRestrictions: number;
  previousConsultations: {
    total: number;
    last90Days: number;
    bySegment: Record<string, number>;
  };
  alerts: { type: string; message: string; severity: string }[];
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

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, (score / 1000) * 100));
  let color = "from-rose-500 to-rose-600";
  if (score >= 901) color = "from-emerald-400 to-emerald-600";
  else if (score >= 701) color = "from-emerald-500 to-emerald-600";
  else if (score >= 501) color = "from-amber-400 to-amber-600";
  else if (score >= 301) color = "from-orange-400 to-orange-600";

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between">
        <span className="text-4xl font-bold" data-testid="text-spc-score-value">{score}</span>
        <span className="text-sm text-muted-foreground">/1000</span>
      </div>
      <div className="w-full bg-muted h-3 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-1000`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>0</span>
        <span>300</span>
        <span>500</span>
        <span>700</span>
        <span>900</span>
        <span>1000</span>
      </div>
    </div>
  );
}

export default function ConsultaSPCPage() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SpcResult | null>(null);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/spc-consultations"],
  });

  const mutation = useMutation({
    mutationFn: async (cpfCnpj: string) => {
      const res = await apiRequest("POST", "/api/spc-consultations", { cpfCnpj });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data.result);
      queryClient.invalidateQueries({ queryKey: ["/api/spc-consultations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Consulta realizada", description: "Consulta SPC processada com sucesso" });
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
    return null;
  };

  const detectedType = getDetectedType(query);

  const riskColors: Record<string, string> = {
    very_low: "bg-emerald-100 text-emerald-800",
    low: "bg-emerald-100 text-emerald-800",
    medium: "bg-amber-100 text-amber-800",
    high: "bg-orange-100 text-orange-800",
    very_high: "bg-rose-100 text-rose-800",
  };

  const severityColors: Record<string, string> = {
    medium: "bg-amber-100 text-amber-700 border-amber-200",
    high: "bg-rose-100 text-rose-700 border-rose-200",
    critical: "bg-red-100 text-red-800 border-red-300",
  };

  const severityLabels: Record<string, string> = {
    medium: "Media",
    high: "Alta",
    critical: "Critica",
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="consulta-spc-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-consulta-spc-title">Consulta SPC</h1>
            <p className="text-sm text-muted-foreground">Consulta oficial no SPC Brasil</p>
          </div>
        </div>
        <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-sm">
          <CreditCard className="w-4 h-4 text-purple-600" />
          Creditos SPC: <span className="font-bold" data-testid="text-spc-credits">{data?.credits ?? "..."}</span>
        </Badge>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/20 border-purple-200/50 dark:border-purple-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Consultas Hoje</span>
            <TrendingUp className="w-5 h-5 text-purple-500" />
          </div>
          <div className="text-2xl font-bold" data-testid="text-spc-today">{isLoading ? <Skeleton className="h-7 w-8" /> : data?.todayCount}</div>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/30 dark:to-orange-900/20 border-orange-200/50 dark:border-orange-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Consultas Mes</span>
            <CalendarDays className="w-5 h-5 text-orange-500" />
          </div>
          <div className="text-2xl font-bold" data-testid="text-spc-month">{isLoading ? <Skeleton className="h-7 w-8" /> : data?.monthCount}</div>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/20 border-emerald-200/50 dark:border-emerald-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Taxa Limpo</span>
            <CheckCircle className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold">
            {isLoading ? <Skeleton className="h-7 w-8" /> : (
              data?.consultations?.length > 0
                ? Math.round((data.consultations.filter((c: any) => (c.score || 0) >= 500).length / data.consultations.length) * 100) + "%"
                : "0%"
            )}
          </div>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-pink-50 to-pink-100/50 dark:from-pink-950/30 dark:to-pink-900/20 border-pink-200/50 dark:border-pink-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Score Medio</span>
            <BarChart3 className="w-5 h-5 text-pink-500" />
          </div>
          <div className="text-2xl font-bold">
            {isLoading ? <Skeleton className="h-7 w-8" /> : (
              data?.consultations?.length > 0
                ? Math.round(data.consultations.reduce((acc: number, c: any) => acc + (c.score || 0), 0) / data.consultations.length)
                : 0
            )}
          </div>
        </Card>
      </div>

      <Tabs defaultValue="nova" className="space-y-4">
        <TabsList>
          <TabsTrigger value="nova" className="gap-1.5" data-testid="tab-spc-nova">
            <Search className="w-3.5 h-3.5" />
            Nova Consulta
          </TabsTrigger>
          <TabsTrigger value="historico" className="gap-1.5" data-testid="tab-spc-historico">
            <Clock className="w-3.5 h-3.5" />
            Historico
          </TabsTrigger>
          <TabsTrigger value="relatorios" className="gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Relatorios
          </TabsTrigger>
          <TabsTrigger value="info" className="gap-1.5">
            <Info className="w-3.5 h-3.5" />
            Informacoes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="nova">
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <BarChart3 className="w-5 h-5 text-purple-600" />
              <h2 className="text-lg font-semibold">Realizar Consulta SPC</h2>
            </div>

            <div className="flex gap-3 items-center">
              <div className="relative flex-1">
                <Input
                  data-testid="input-spc-search"
                  placeholder="Digite CPF ou CNPJ"
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
                  data-testid="button-spc-paste"
                >
                  <ClipboardCopy className="w-4 h-4" />
                </button>
              </div>
              <Button variant="ghost" onClick={() => { setQuery(""); setResult(null); }} data-testid="button-clear-spc">
                Limpar
              </Button>
              <Button
                onClick={handleSearch}
                disabled={!query.trim() || mutation.isPending}
                className="bg-gradient-to-r from-purple-600 to-purple-700"
                data-testid="button-consultar-spc"
              >
                {mutation.isPending ? "Consultando..." : "Consultar SPC"}
              </Button>
            </div>

            {detectedType && (
              <div className="mt-2 flex items-center gap-1.5" data-testid="text-spc-detected-type">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-medium text-emerald-600">{detectedType} detectado</span>
              </div>
            )}

            <div className="mt-4 bg-purple-50 dark:bg-purple-950/30 rounded-lg p-4 flex items-start gap-3">
              <Info className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Consulta Oficial SPC:</span> Cada consulta consome{" "}
                <span className="font-bold text-purple-600">1 credito SPC</span> e retorna dados cadastrais, score, restricoes financeiras, protestos e historico de consultas.
              </p>
            </div>

            {result && (
              <div className="mt-6 space-y-5" data-testid="spc-result">
                <div className="border rounded-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-purple-800 to-purple-900 text-white px-6 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <BarChart3 className="w-5 h-5" />
                        <div>
                          <h3 className="text-lg font-semibold">Consulta SPC - {result.cadastralData.tipo === "PF" ? "CPF" : "CNPJ"}: {formatCpfCnpj(result.cpfCnpj)}</h3>
                          <p className="text-sm text-purple-200">Servico de Protecao ao Credito</p>
                        </div>
                      </div>
                      <Badge className={`border-0 ${result.status === "clean" ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"}`}>
                        {result.status === "clean" ? "Limpo" : "Com Restricoes"}
                      </Badge>
                    </div>
                  </div>

                  <div className="p-6 space-y-6">
                    <Card className="p-4 bg-slate-50 dark:bg-slate-900/30">
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <User className="w-4 h-4" />
                        Dados Cadastrais
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Nome:</span>
                          <p className="font-medium" data-testid="text-spc-nome">{result.cadastralData.nome}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{result.cadastralData.tipo === "PF" ? "CPF" : "CNPJ"}:</span>
                          <p className="font-medium">{formatCpfCnpj(result.cadastralData.cpfCnpj)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{result.cadastralData.tipo === "PF" ? "Nascimento" : "Fundacao"}:</span>
                          <p className="font-medium">{result.cadastralData.dataNascimento || result.cadastralData.dataFundacao}</p>
                        </div>
                        {result.cadastralData.nomeMae && (
                          <div>
                            <span className="text-muted-foreground">Nome da Mae:</span>
                            <p className="font-medium">{result.cadastralData.nomeMae}</p>
                          </div>
                        )}
                        <div>
                          <span className="text-muted-foreground">Situacao RF:</span>
                          <p className="font-medium flex items-center gap-1.5">
                            {result.cadastralData.situacaoRf === "Regular" ? (
                              <><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> <span className="text-emerald-700">Regular</span></>
                            ) : (
                              <><XCircle className="w-3.5 h-3.5 text-rose-500" /> <span className="text-rose-700">Irregular</span></>
                            )}
                          </p>
                        </div>
                        {result.cadastralData.obitoRegistrado && (
                          <div>
                            <span className="text-muted-foreground">Obito:</span>
                            <p className="font-medium text-rose-700 flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5" /> Registrado
                            </p>
                          </div>
                        )}
                      </div>
                    </Card>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Card className="p-4">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                          <BarChart3 className="w-4 h-4" />
                          Score de Credito
                        </h4>
                        <ScoreBar score={result.score} />
                        <div className="mt-3 flex items-center gap-2">
                          <Badge className={`${riskColors[result.riskLevel]} border-0`} data-testid="text-spc-risk">
                            {result.riskLabel}
                          </Badge>
                        </div>
                      </Card>

                      <Card className="p-4">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                          <Target className="w-4 h-4" />
                          Recomendacao
                        </h4>
                        <div className="flex flex-col gap-3">
                          <p className="text-lg font-semibold" data-testid="text-spc-recommendation">{result.recommendation}</p>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="p-2 bg-muted/50 rounded">
                              <span className="text-muted-foreground">Restricoes:</span>
                              <p className="font-bold text-lg">{result.restrictions.length}</p>
                            </div>
                            <div className="p-2 bg-muted/50 rounded">
                              <span className="text-muted-foreground">Total Dividas:</span>
                              <p className="font-bold text-lg">R$ {result.totalRestrictions.toFixed(2)}</p>
                            </div>
                          </div>
                        </div>
                      </Card>
                    </div>

                    {result.restrictions.length > 0 && (
                      <Card className="p-4">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2 text-rose-700">
                          <AlertTriangle className="w-4 h-4" />
                          Restricoes Encontradas: {result.restrictions.length}
                        </h4>
                        <div className="space-y-2">
                          {result.restrictions.map((r, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between p-3 rounded-lg border bg-white dark:bg-slate-900"
                              data-testid={`restriction-${i}`}
                            >
                              <div className="flex items-center gap-3">
                                <Badge className={`${severityColors[r.severity]} border text-xs`}>
                                  {r.type}
                                </Badge>
                                <div>
                                  <p className="text-sm font-medium">{r.creditor}</p>
                                  <p className="text-xs text-muted-foreground">{r.description}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold">R$ {parseFloat(r.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                                <p className="text-xs text-muted-foreground">{new Date(r.date).toLocaleDateString("pt-BR")}</p>
                                <Badge variant="outline" className="text-[10px] mt-0.5">{severityLabels[r.severity]}</Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 p-3 bg-rose-50 dark:bg-rose-950/20 rounded-lg flex items-center justify-between">
                          <span className="text-sm font-semibold text-rose-700">Total em Restricoes:</span>
                          <span className="text-lg font-bold text-rose-700">R$ {result.totalRestrictions.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                        </div>
                      </Card>
                    )}

                    {result.status === "clean" && (
                      <Card className="p-6 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 text-center">
                        <Shield className="w-10 h-10 mx-auto mb-2 text-emerald-500" />
                        <p className="text-lg font-semibold text-emerald-700">Nenhuma restricao encontrada</p>
                        <p className="text-sm text-emerald-600 mt-1">Este documento esta limpo no SPC Brasil</p>
                      </Card>
                    )}

                    <Card className="p-4">
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Eye className="w-4 h-4" />
                        Consultas Anteriores (ultimos 90 dias): {result.previousConsultations.total}
                      </h4>
                      <div className="space-y-1">
                        {Object.entries(result.previousConsultations.bySegment).map(([segment, count]) => (
                          <div key={segment} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                            <span>{segment}</span>
                            <span className="font-medium">{count}</span>
                          </div>
                        ))}
                      </div>
                    </Card>

                    {result.alerts.length > 0 && (
                      <Card className="p-4 bg-amber-50 dark:bg-amber-950/20 border-amber-200">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2 text-amber-800">
                          <AlertTriangle className="w-4 h-4" />
                          Alertas Especiais
                        </h4>
                        <div className="space-y-2">
                          {result.alerts.map((alert, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm" data-testid={`spc-alert-${i}`}>
                              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${alert.severity === "critical" ? "bg-rose-500" : alert.severity === "high" ? "bg-orange-500" : "bg-amber-500"}`} />
                              <span className="text-amber-900">{alert.message}</span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="historico">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Historico de Consultas SPC</h2>
            {data?.consultations?.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Nenhuma consulta SPC realizada ainda</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data?.consultations?.map((c: any) => {
                  const resultData = c.result as any;
                  const riskLevel = resultData?.riskLevel || (c.score >= 700 ? "low" : c.score >= 500 ? "medium" : "high");
                  const statusLabel = resultData?.status === "clean" ? "Limpo" : resultData?.restrictions?.length > 0 ? `${resultData.restrictions.length} restricoes` : "Com restricoes";
                  return (
                    <div key={c.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg" data-testid={`spc-consultation-${c.id}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${(c.score || 0) >= 500 ? "bg-emerald-500" : "bg-rose-500"}`} />
                        <div>
                          <span className="text-sm font-medium">{formatCpfCnpj(c.cpfCnpj)}</span>
                          {resultData?.cadastralData?.nome && (
                            <span className="text-xs text-muted-foreground ml-2">{resultData.cadastralData.nome}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">Score: {c.score}/1000</span>
                        <Badge className={`${riskColors[riskLevel] || "bg-muted"} border-0 text-xs`}>
                          {statusLabel}
                        </Badge>
                        <Badge variant="outline" className="text-xs">-1 credito</Badge>
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
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Relatorios em breve</p>
              <p className="text-sm mt-1">Funcionalidade em desenvolvimento</p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="info">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Sobre a Consulta SPC</h2>
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>Integracao com o SPC Brasil (Servico de Protecao ao Credito), um dos maiores bureaus de credito do pais. Permite consultar a situacao financeira completa de CPF ou CNPJ.</p>

              <div>
                <h3 className="font-semibold text-foreground mb-2">Classificacao de Score (0-1000)</h3>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-rose-600" />
                      <span className="text-xs font-medium text-foreground">0-300</span>
                    </div>
                    <p className="text-xs">Risco Muito Alto</p>
                  </Card>
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-orange-500" />
                      <span className="text-xs font-medium text-foreground">301-500</span>
                    </div>
                    <p className="text-xs">Risco Alto</p>
                  </Card>
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-amber-500" />
                      <span className="text-xs font-medium text-foreground">501-700</span>
                    </div>
                    <p className="text-xs">Risco Medio</p>
                  </Card>
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-emerald-500" />
                      <span className="text-xs font-medium text-foreground">701-900</span>
                    </div>
                    <p className="text-xs">Risco Baixo</p>
                  </Card>
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-emerald-400" />
                      <span className="text-xs font-medium text-foreground">901-1000</span>
                    </div>
                    <p className="text-xs">Risco Muito Baixo</p>
                  </Card>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-2">Tipos de Restricoes</h3>
                <div className="space-y-1">
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-amber-100 text-amber-700 border-amber-200 border text-xs">PEFIN</Badge>
                      <span>Pendencia Financeira</span>
                    </div>
                    <span className="text-amber-600 font-medium">Media</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-rose-100 text-rose-700 border-rose-200 border text-xs">REFIN</Badge>
                      <span>Restricao Financeira</span>
                    </div>
                    <span className="text-rose-600 font-medium">Alta</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-rose-100 text-rose-700 border-rose-200 border text-xs">CCF</Badge>
                      <span>Cheque sem Fundo</span>
                    </div>
                    <span className="text-rose-600 font-medium">Alta</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-rose-100 text-rose-700 border-rose-200 border text-xs">Protesto</Badge>
                      <span>Titulo protestado em cartorio</span>
                    </div>
                    <span className="text-rose-600 font-medium">Alta</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-red-100 text-red-800 border-red-300 border text-xs">Acao Judicial</Badge>
                      <span>Processo de cobranca</span>
                    </div>
                    <span className="text-red-700 font-medium">Muito Alta</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-red-100 text-red-800 border-red-300 border text-xs">Falencia</Badge>
                      <span>Processo falimentar</span>
                    </div>
                    <span className="text-red-700 font-medium">Critica</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-2">Fluxo Recomendado</h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                    <span className="font-bold text-blue-600">1.</span>
                    <div>
                      <p className="font-medium text-foreground">Consulta ISP (rapida e barata)</p>
                      <p className="text-xs">Verifica historico em provedores. Se encontrar restricoes, recusar.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg">
                    <span className="font-bold text-purple-600">2.</span>
                    <div>
                      <p className="font-medium text-foreground">Consulta SPC (completa)</p>
                      <p className="text-xs">Confirma situacao financeira geral. Score + restricoes + historico.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg">
                    <span className="font-bold text-emerald-600">3.</span>
                    <div>
                      <p className="font-medium text-foreground">Decisao Final</p>
                      <p className="text-xs">ISP limpo + SPC limpo = Aprovar. ISP com pendencia = Recusar ou garantias.</p>
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
