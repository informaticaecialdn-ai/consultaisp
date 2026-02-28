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
  UserSearch,
} from "lucide-react";

export default function ConsultaSPCPage() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<any>(null);

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
          <p className="text-2xl font-bold" data-testid="text-spc-today">{isLoading ? <Skeleton className="h-7 w-8" /> : data?.todayCount}</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/30 dark:to-orange-900/20 border-orange-200/50 dark:border-orange-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Consultas Mes</span>
            <CalendarDays className="w-5 h-5 text-orange-500" />
          </div>
          <p className="text-2xl font-bold" data-testid="text-spc-month">{isLoading ? <Skeleton className="h-7 w-8" /> : data?.monthCount}</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/20 border-emerald-200/50 dark:border-emerald-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Aprovacao Media</span>
            <CheckCircle className="w-5 h-5 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold">
            {isLoading ? <Skeleton className="h-7 w-8" /> : (
              data?.consultations?.length > 0
                ? Math.round((data.consultations.filter((c: any) => (c.score || 0) >= 500).length / data.consultations.length) * 100) + "%"
                : "0%"
            )}
          </p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-pink-50 to-pink-100/50 dark:from-pink-950/30 dark:to-pink-900/20 border-pink-200/50 dark:border-pink-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground">Score Medio</span>
            <BarChart3 className="w-5 h-5 text-pink-500" />
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

            <div className="flex gap-3">
              <div className="relative flex-1">
                <UserSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  data-testid="input-spc-search"
                  placeholder="Digite o CPF ou CNPJ..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-10"
                />
              </div>
              <Button
                onClick={handleSearch}
                disabled={!query.trim() || mutation.isPending}
                className="bg-gradient-to-r from-purple-600 to-purple-700"
                data-testid="button-consultar-spc"
              >
                <Search className="w-4 h-4 mr-2" />
                {mutation.isPending ? "Consultando..." : "Consultar SPC"}
              </Button>
            </div>

            <div className="mt-4 bg-purple-50 dark:bg-purple-950/30 rounded-lg p-4 flex items-start gap-3">
              <Info className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Consulta Oficial SPC:</span> Cada consulta consome 1 credito e e processada diretamente no banco de dados do SPC Brasil.
              </p>
            </div>

            {result && (
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Resultado da Consulta SPC</h3>
                  <Badge
                    variant={result.status === "regular" ? "default" : "destructive"}
                    className={result.status === "regular" ? "bg-emerald-500 border-0" : ""}
                  >
                    {result.status === "regular" ? "Regular" : "Irregular"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Card className="p-4">
                    <span className="text-xs text-muted-foreground">Score SPC</span>
                    <p className="text-3xl font-bold mt-1" data-testid="text-spc-result-score">{result.score}</p>
                    <div className="w-full bg-muted h-2 rounded-full mt-2">
                      <div
                        className={`h-full rounded-full ${result.score >= 600 ? "bg-emerald-500" : result.score >= 400 ? "bg-amber-500" : "bg-rose-500"}`}
                        style={{ width: `${Math.min(100, (result.score / 1000) * 100)}%` }}
                      />
                    </div>
                  </Card>
                  <Card className="p-4">
                    <span className="text-xs text-muted-foreground">Restricoes</span>
                    <p className="text-3xl font-bold mt-1">{result.restrictions?.length || 0}</p>
                  </Card>
                </div>

                {result.restrictions && result.restrictions.length > 0 && (
                  <Card className="p-4">
                    <h4 className="text-sm font-semibold mb-3">Restricoes Encontradas</h4>
                    {result.restrictions.map((r: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-rose-50 dark:bg-rose-950/20 rounded-lg mb-2">
                        <span className="text-sm">{r.type}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium">{r.value}</span>
                          <span className="text-xs text-muted-foreground">{r.date}</span>
                        </div>
                      </div>
                    ))}
                  </Card>
                )}
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
                {data?.consultations?.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${(c.score || 0) >= 500 ? "bg-emerald-500" : "bg-rose-500"}`} />
                      <span className="text-sm font-medium">{c.cpfCnpj}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">Score: {c.score}</span>
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
            <h2 className="text-lg font-semibold mb-4">Sobre a Consulta SPC</h2>
            <p className="text-sm text-muted-foreground">
              A Consulta SPC verifica a situacao cadastral do CPF/CNPJ diretamente nos bureaus de credito (SPC Brasil). Mostra restricoes financeiras, protestos e historico de credito.
            </p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
