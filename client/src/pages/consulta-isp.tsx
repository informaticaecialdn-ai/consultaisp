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
  X,
  Clock,
  FileText,
  CreditCard,
  AlertTriangle,
  Shield,
} from "lucide-react";

export default function ConsultaISPPage() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<any>(null);

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

  const getSearchType = (val: string) => {
    const cleaned = val.replace(/\D/g, "");
    if (cleaned.length === 11) return "CPF";
    if (cleaned.length === 14) return "CNPJ";
    if (cleaned.length === 8) return "CEP";
    return "";
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="consulta-isp-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <Search className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-consulta-isp-title">Consulta ISP</h1>
            <p className="text-sm text-muted-foreground">Sistema de analise de credito para provedores de internet</p>
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
            <TrendingUp className="w-5 h-5 text-orange-500" />
          </div>
          <p className="text-2xl font-bold" data-testid="text-isp-today">{isLoading ? <Skeleton className="h-7 w-8" /> : data?.todayCount}</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/30 dark:to-orange-900/20 border-orange-200/50 dark:border-orange-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Consultas Mes</span>
            <CalendarDays className="w-5 h-5 text-orange-500" />
          </div>
          <p className="text-2xl font-bold" data-testid="text-isp-month">{isLoading ? <Skeleton className="h-7 w-8" /> : data?.monthCount}</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/20 border-emerald-200/50 dark:border-emerald-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Taxa Aprovacao</span>
            <CheckCircle className="w-5 h-5 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold">
            {isLoading ? <Skeleton className="h-7 w-8" /> : (
              data?.consultations?.length > 0
                ? Math.round((data.consultations.filter((c: any) => c.approved).length / data.consultations.length) * 100) + "%"
                : "0%"
            )}
          </p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/20 border-purple-200/50 dark:border-purple-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Score Medio ISP</span>
            <BarChart3 className="w-5 h-5 text-purple-500" />
          </div>
          <p className="text-2xl font-bold">
            {isLoading ? <Skeleton className="h-7 w-8" /> : (
              data?.consultations?.length > 0
                ? Math.round(data.consultations.reduce((acc: number, c: any) => acc + (c.score || 0), 0) / data.consultations.length)
                : 0
            )}
          </p>
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
              <Search className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold">Realizar Consulta ISP</h2>
            </div>

            <div className="flex gap-3">
              <div className="relative flex-1">
                <Input
                  data-testid="input-isp-search"
                  placeholder="Digite CPF, CNPJ ou CEP"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pr-10"
                />
                {query && (
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => { setQuery(""); setResult(null); }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
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
                <Search className="w-4 h-4 mr-2" />
                {mutation.isPending ? "Consultando..." : "Consultar ISP"}
              </Button>
            </div>

            <div className="mt-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg p-4 flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Busca Inteligente:</span> Digite um{" "}
                <span className="font-bold text-foreground">CPF</span> (11 digitos),{" "}
                <span className="font-bold text-foreground">CNPJ</span> (14 digitos) ou{" "}
                <span className="font-bold text-foreground">CEP</span> (8 digitos).{" "}
                O sistema detecta automaticamente o tipo de busca.
              </p>
            </div>

            {result && (
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Resultado da Consulta</h3>
                  <Badge
                    variant={result.approved ? "default" : "destructive"}
                    className={result.approved ? "bg-emerald-500 border-0" : ""}
                  >
                    {result.approved ? "Aprovado" : "Reprovado"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="p-4">
                    <span className="text-xs text-muted-foreground">Score ISP</span>
                    <p className="text-2xl font-bold mt-1" data-testid="text-result-score">
                      {result.score}
                    </p>
                    <div className="w-full bg-muted h-2 rounded-full mt-2">
                      <div
                        className={`h-full rounded-full ${result.score >= 600 ? "bg-emerald-500" : result.score >= 400 ? "bg-amber-500" : "bg-rose-500"}`}
                        style={{ width: `${Math.min(100, (result.score / 1000) * 100)}%` }}
                      />
                    </div>
                  </Card>
                  <Card className="p-4">
                    <span className="text-xs text-muted-foreground">Registros Encontrados</span>
                    <p className="text-2xl font-bold mt-1">{result.recordsFound}</p>
                  </Card>
                  <Card className="p-4">
                    <span className="text-xs text-muted-foreground">Provedores</span>
                    <p className="text-2xl font-bold mt-1">{result.providersFound}</p>
                  </Card>
                  <Card className="p-4">
                    <span className="text-xs text-muted-foreground">Inadimplencia</span>
                    <p className="text-2xl font-bold mt-1 flex items-center gap-2">
                      {result.hasDefaultHistory ? (
                        <>
                          <AlertTriangle className="w-5 h-5 text-rose-500" />
                          <span className="text-rose-500">Sim</span>
                        </>
                      ) : (
                        <>
                          <Shield className="w-5 h-5 text-emerald-500" />
                          <span className="text-emerald-500">Nao</span>
                        </>
                      )}
                    </p>
                  </Card>
                </div>

                {result.details && result.details.length > 0 && (
                  <Card className="p-4">
                    <h4 className="text-sm font-semibold mb-3">Detalhes dos Registros</h4>
                    <div className="space-y-2">
                      {result.details.map((d: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className={`w-2.5 h-2.5 rounded-full ${d.status === "active" ? "bg-emerald-500" : "bg-rose-500"}`} />
                            <span className="text-sm">{d.providerName}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-muted-foreground">{d.city}</span>
                            <Badge variant={d.status === "active" ? "secondary" : "destructive"} className="text-xs">
                              {d.status === "active" ? "Ativo" : "Inadimplente"}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="historico">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Historico de Consultas</h2>
            {data?.consultations?.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Nenhuma consulta realizada ainda</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data?.consultations?.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg" data-testid={`consultation-${c.id}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${c.approved ? "bg-emerald-500" : "bg-rose-500"}`} />
                      <div>
                        <span className="text-sm font-medium">{c.cpfCnpj}</span>
                        <span className="text-xs text-muted-foreground ml-3">{c.searchType?.toUpperCase()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">Score: {c.score}</span>
                      <Badge variant={c.approved ? "secondary" : "destructive"} className="text-xs">
                        {c.approved ? "Aprovado" : "Reprovado"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {c.createdAt ? new Date(c.createdAt).toLocaleDateString("pt-BR") : ""}
                      </span>
                    </div>
                  </div>
                ))}
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
            <h2 className="text-lg font-semibold mb-4">Sobre a Consulta ISP</h2>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>A Consulta ISP verifica o historico de um cliente em uma base de dados colaborativa entre provedores de internet.</p>
              <p>O score ISP e calculado com base nos registros encontrados, historico de pagamento e ocorrencias em outros provedores.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span className="text-sm font-medium text-foreground">600-1000</span>
                  </div>
                  <p className="text-xs">Score excelente - Cliente confiavel</p>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="text-sm font-medium text-foreground">400-599</span>
                  </div>
                  <p className="text-xs">Score moderado - Atencao necessaria</p>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full bg-rose-500" />
                    <span className="text-sm font-medium text-foreground">0-399</span>
                  </div>
                  <p className="text-xs">Score baixo - Alto risco</p>
                </Card>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
