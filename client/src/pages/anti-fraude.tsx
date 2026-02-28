import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  ShieldAlert,
  Bell,
  BarChart3,
  Shuffle,
  BrainCircuit,
  BookOpen,
  Settings,
  CheckCircle,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

export default function AntiFraudePage() {
  const { data: alerts, isLoading } = useQuery<any[]>({
    queryKey: ["/api/anti-fraud/alerts"],
  });

  const activeAlerts = alerts?.filter(a => !a.resolved) || [];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="anti-fraude-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-anti-fraude-title">Modulo Anti-Fraude</h1>
            <p className="text-sm text-muted-foreground">Monitore clientes de alto risco e proteja seu negocio contra fraudes.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon">
            <Bell className="w-4 h-4" />
          </Button>
          <Button variant="secondary" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="alertas" className="space-y-4">
        <TabsList>
          <TabsTrigger value="alertas" className="gap-1.5" data-testid="tab-alertas">
            <Bell className="w-3.5 h-3.5" />
            Alertas
          </TabsTrigger>
          <TabsTrigger value="score" className="gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />
            Score de Risco
          </TabsTrigger>
          <TabsTrigger value="padroes" className="gap-1.5">
            <Shuffle className="w-3.5 h-3.5" />
            Padroes
          </TabsTrigger>
          <TabsTrigger value="ia" className="gap-1.5">
            <BrainCircuit className="w-3.5 h-3.5" />
            Analise IA
          </TabsTrigger>
          <TabsTrigger value="regras" className="gap-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            Regras
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1.5">
            <Settings className="w-3.5 h-3.5" />
            Configuracoes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="alertas">
          <Card className="p-6">
            {activeAlerts.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-emerald-600" />
                </div>
                <h3 className="text-lg font-semibold mb-2" data-testid="text-tudo-certo">Tudo Certo!</h3>
                <p className="text-muted-foreground">Nenhum alerta de fraude ativo foi encontrado.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeAlerts.map((alert) => (
                  <div key={alert.id} className="flex items-start gap-4 p-4 bg-muted/30 rounded-lg" data-testid={`alert-${alert.id}`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      alert.severity === "high" ? "bg-rose-100 dark:bg-rose-900/30" :
                      alert.severity === "medium" ? "bg-amber-100 dark:bg-amber-900/30" :
                      "bg-blue-100 dark:bg-blue-900/30"
                    }`}>
                      <AlertTriangle className={`w-5 h-5 ${
                        alert.severity === "high" ? "text-rose-600" :
                        alert.severity === "medium" ? "text-amber-600" :
                        "text-blue-600"
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold">{alert.type}</span>
                        <Badge
                          variant={alert.severity === "high" ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          {alert.severity === "high" ? "Alto" : alert.severity === "medium" ? "Medio" : "Baixo"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{alert.message}</p>
                      <span className="text-xs text-muted-foreground mt-1 block">
                        {alert.createdAt ? new Date(alert.createdAt).toLocaleDateString("pt-BR") : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="score">
          <Card className="p-6">
            <div className="text-center py-12 text-muted-foreground">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Score de Risco</p>
              <p className="text-sm mt-1">Analise de risco baseada em IA em breve</p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="padroes">
          <Card className="p-6">
            <div className="text-center py-12 text-muted-foreground">
              <Shuffle className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Deteccao de Padroes</p>
              <p className="text-sm mt-1">Analise de padroes de fraude em desenvolvimento</p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="ia">
          <Card className="p-6">
            <div className="text-center py-12 text-muted-foreground">
              <BrainCircuit className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Analise com IA</p>
              <p className="text-sm mt-1">Inteligencia artificial aplicada a deteccao de fraudes</p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="regras">
          <Card className="p-6">
            <div className="text-center py-12 text-muted-foreground">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Regras Personalizadas</p>
              <p className="text-sm mt-1">Configure regras de deteccao de fraude</p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="config">
          <Card className="p-6">
            <div className="text-center py-12 text-muted-foreground">
              <Settings className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Configuracoes</p>
              <p className="text-sm mt-1">Ajuste as configuracoes do modulo anti-fraude</p>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
