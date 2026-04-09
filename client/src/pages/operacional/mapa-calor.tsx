import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import AzureHeatMap, { HeatPoint } from "@/components/maps/AzureHeatMap";
import {
  MapPin,
  AlertTriangle,
  Users,
  DollarSign,
  Building2,
  RefreshCw,
  TrendingUp,
  BarChart3,
  Flame,
  ShieldAlert,
  Info,
  Eye,
} from "lucide-react";

type ProviderHeatmapPoint = {
  id: number;
  name: string;
  latitude: string;
  longitude: string;
  city: string;
  totalOverdueAmount: string;
  maxDaysOverdue: number;
  overdueInvoicesCount: number;
  riskTier: string;
  paymentStatus: string;
};

type RegionalCluster = {
  lat: number;
  lng: number;
  city: string;
  count: number;
  totalOverdue: number;
};

type CityRanking = {
  city: string;
  lat: number;
  lng: number;
  count: number;
  totalOverdue: number;
  maxDays: number;
};

function formatCurrency(value: number | string | null | undefined): string {
  const num = typeof value === "string" ? parseFloat(value) : (value || 0);
  return `R$ ${num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function KpiCard({ label, value, icon: Icon, color, sub }: {
  label: string; value: string | number; icon: any; color: string; sub?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
          {sub && <p className="text-xs text-muted-foreground/70 mt-0.5">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}

function RiskBadge({ count }: { count: number }) {
  if (count >= 5) return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 text-xs">Critico</Badge>;
  if (count >= 3) return <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 text-xs">Alto</Badge>;
  if (count >= 2) return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-xs">Moderado</Badge>;
  return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs">Baixo</Badge>;
}

function RiskBarCell({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const bg = pct >= 75 ? "bg-red-500" : pct >= 50 ? "bg-orange-400" : pct >= 25 ? "bg-amber-400" : "bg-blue-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${bg}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium w-6 text-right">{pct}%</span>
    </div>
  );
}

export default function MapaCalorPage() {
  const { provider } = useAuth();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("provider");
  const [providerCenter, setProviderCenter] = useState<{ lat: number; lng: number } | null>(null);

  // Cache 24h no backend — frontend staleTime alto para evitar re-fetch desnecessario
  const HEATMAP_STALE = 5 * 60 * 1000; // 5 min no frontend (backend cacheia 24h)

  const { data: providerData = [], isLoading: providerLoading } = useQuery<ProviderHeatmapPoint[]>({
    queryKey: ["/api/heatmap/provider"],
    staleTime: HEATMAP_STALE,
  });

  const { data: regionalData = [], isLoading: regionalLoading } = useQuery<RegionalCluster[]>({
    queryKey: ["/api/heatmap/regional"],
    staleTime: HEATMAP_STALE,
  });

  const { data: cityRanking = [], isLoading: cityLoading } = useQuery<CityRanking[]>({
    queryKey: ["/api/heatmap/city-ranking"],
    staleTime: HEATMAP_STALE,
  });

  const { data: syncInfo, refetch: refetchSyncInfo } = useQuery<{
    lastSyncAt: string | null;
    totalIntegrations: number;
    lastCacheRefresh: string | null;
    totalCachePoints: number;
    refreshing: boolean;
  }>({
    queryKey: ["/api/heatmap/sync-info"],
    staleTime: 60000, // 1 min
  });

  const providerPoints: HeatPoint[] = providerData
    .map(p => ({
      lat: parseFloat(p.latitude),
      lng: parseFloat(p.longitude),
      weight: Math.max(0.2, ((p.maxDaysOverdue || 0) / 90) + (parseFloat(p.totalOverdueAmount || "0") / 500)),
    }))
    .filter(p => !isNaN(p.lat) && !isNaN(p.lng));

  useEffect(() => {
    const city = provider?.addressCity || "";
    const state = provider?.addressState || "";
    let cancelled = false;

    const fallbackToPoints = () => {
      if (providerPoints.length > 0) {
        const avgLat = providerPoints.reduce((s, p) => s + p.lat, 0) / providerPoints.length;
        const avgLng = providerPoints.reduce((s, p) => s + p.lng, 0) / providerPoints.length;
        setProviderCenter({ lat: avgLat, lng: avgLng });
      } else {
        setProviderCenter(null);
      }
    };

    if (!city) { fallbackToPoints(); return; }

    // Geocode via Nominatim (OpenStreetMap) — sem dependencia do Google
    const query = state ? `${city}, ${state}, Brasil` : `${city}, Brasil`;
    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br`, {
      headers: { "User-Agent": "ConsultaISP/1.0" },
    })
      .then(r => r.json())
      .then((data: any[]) => {
        if (cancelled) return;
        if (data[0]) {
          setProviderCenter({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
        } else {
          fallbackToPoints();
        }
      })
      .catch(() => { if (!cancelled) fallbackToPoints(); });

    return () => { cancelled = true; };
  }, [provider?.addressCity, provider?.addressState, providerPoints]);

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/heatmap/refresh"),
    onSuccess: () => {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["/api/heatmap/regional"] });
        qc.invalidateQueries({ queryKey: ["/api/heatmap/city-ranking"] });
        qc.invalidateQueries({ queryKey: ["/api/heatmap/provider"] });
        qc.invalidateQueries({ queryKey: ["/api/heatmap/sync-info"] });
      }, 3000);
    },
  });

  const regionalPoints: HeatPoint[] = regionalData
    .map(p => ({ lat: p.lat, lng: p.lng, weight: p.count }))
    .filter(p => !isNaN(p.lat) && !isNaN(p.lng));

  const totalOverdue = providerData.reduce((s, p) => s + parseFloat(p.totalOverdueAmount || "0"), 0);
  const criticalCount = providerData.filter(p => p.riskTier === "critical").length;
  const uniqueCities = new Set(providerData.map(p => p.city).filter(Boolean));

  const regionalTotal = regionalData.reduce((s, p) => s + p.count, 0);
  const maxCityCount = cityRanking.length > 0 ? cityRanking[0].count : 1;
  const maxCityOverdue = cityRanking.length > 0 ? Math.max(...cityRanking.map(c => c.totalOverdue), 1) : 1;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="mapa-calor-page">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
          <Flame className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-mapa-calor-title">Mapa de Calor de Inadimplencia</h1>
          <p className="text-sm text-muted-foreground">Visualizacao geografica e benchmarking regional de inadimplencia</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="provider" className="gap-1.5" data-testid="tab-meu-provedor">
            <Building2 className="w-3.5 h-3.5" />
            Meu Provedor
          </TabsTrigger>
          <TabsTrigger value="regional" className="gap-1.5" data-testid="tab-benchmarking">
            <BarChart3 className="w-3.5 h-3.5" />
            Benchmarking Regional
          </TabsTrigger>
        </TabsList>

        {/* ======================== MEU PROVEDOR ======================== */}
        <TabsContent value="provider" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Inadimplentes" value={providerData.length} icon={AlertTriangle} color="bg-red-500" />
            <KpiCard label="Valor em Aberto" value={formatCurrency(totalOverdue)} icon={DollarSign} color="bg-orange-500" />
            <KpiCard label="Risco Critico" value={criticalCount} icon={ShieldAlert} color="bg-rose-600" sub="acima de 90 dias" />
            <KpiCard label="Cidades" value={uniqueCities.size} icon={MapPin} color="bg-blue-500" sub="com ocorrencias" />
          </div>

          {providerLoading ? (
            <Card className="p-6 flex flex-col items-center justify-center py-20 gap-3">
              <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-navy)]" />
              <span className="text-sm font-semibold text-[var(--color-ink)]">Buscando inadimplentes nos ERPs...</span>
              <span className="text-xs text-[var(--color-muted)]">Geocodificando enderecos e montando mapa de calor</span>
            </Card>
          ) : (
            <Card className="p-4 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    {provider?.name}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {providerData.length} inadimplente{providerData.length !== 1 ? "s" : ""} com coordenadas
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex gap-0.5">
                      <span className="w-3 h-3 rounded-sm bg-green-500 opacity-70" />
                      <span className="w-3 h-3 rounded-sm bg-yellow-400" />
                      <span className="w-3 h-3 rounded-sm bg-orange-500" />
                      <span className="w-3 h-3 rounded-sm bg-red-600" />
                    </span>
                    Baixo → Critico
                  </div>
                  <div className="flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    Apenas clientes do seu provedor
                  </div>
                </div>
              </div>

              <div className="relative">
                <AzureHeatMap
                  key={`provider-${providerPoints.length}-${providerCenter?.lat}`}
                  points={providerPoints}
                  mode="provider"
                  defaultCenter={providerCenter}
                />
                {providerPoints.length === 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center bg-emerald-50/60 dark:bg-emerald-950/40 rounded-lg z-10">
                    <Eye className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
                    <p className="font-medium text-emerald-700 dark:text-emerald-300">Nenhum inadimplente com localizacao cadastrada</p>
                    <p className="text-sm text-muted-foreground mt-1">Clientes sem coordenadas geograficas nao aparecem no mapa.</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {providerData.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                <h3 className="font-semibold">Detalhes dos Inadimplentes</h3>
                <span className="ml-auto text-xs text-muted-foreground">{providerData.length} registros</span>
              </div>
              <div className="divide-y max-h-[300px] overflow-y-auto">
                {[...providerData]
                  .sort((a, b) => parseFloat(b.totalOverdueAmount || "0") - parseFloat(a.totalOverdueAmount || "0"))
                  .map((item) => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3" data-testid={`defaulter-row-${item.id}`}>
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        item.riskTier === "critical" ? "bg-red-500" :
                        item.riskTier === "high" ? "bg-orange-500" :
                        item.riskTier === "medium" ? "bg-amber-500" : "bg-emerald-500"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.city || "Sem cidade"} · {item.maxDaysOverdue}d de atraso</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-semibold">{formatCurrency(item.totalOverdueAmount)}</p>
                      </div>
                      <Badge className={`text-xs flex-shrink-0 ${
                        item.riskTier === "critical" ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" :
                        item.riskTier === "high" ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" :
                        "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                      }`}>
                        {item.riskTier === "critical" ? "Critico" : item.riskTier === "high" ? "Alto" : "Medio"}
                      </Badge>
                    </div>
                  ))}
              </div>
            </Card>
          )}
        </TabsContent>

        {/* ======================== BENCHMARKING REGIONAL ======================== */}
        <TabsContent value="regional" className="space-y-4">
          {/* Cache status banner */}
          <div className="flex items-center justify-between gap-2 bg-muted/40 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className={`w-3.5 h-3.5 flex-shrink-0 text-cyan-500 ${syncInfo?.refreshing ? "animate-spin" : ""}`} />
              <span>
                {syncInfo?.refreshing
                  ? "Buscando inadimplentes nos ERPs dos provedores..."
                  : syncInfo?.totalCachePoints
                  ? `${syncInfo.totalCachePoints} inadimplentes carregados do ERP · cache atualizado a cada 7 dias · ${
                      syncInfo?.lastCacheRefresh
                        ? new Date(syncInfo.lastCacheRefresh).toLocaleString("pt-BR")
                        : "Aguardando carga inicial"
                    }`
                  : `${syncInfo?.totalIntegrations ?? 0} integração${(syncInfo?.totalIntegrations ?? 0) !== 1 ? "ões" : ""} ERP configurada${(syncInfo?.totalIntegrations ?? 0) !== 1 ? "s" : ""} · aguardando carga do cache`}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs px-2 gap-1"
              disabled={refreshMutation.isPending || syncInfo?.refreshing}
              onClick={() => refreshMutation.mutate()}
              data-testid="button-refresh-heatmap"
            >
              <RefreshCw className={`w-3 h-3 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {regionalLoading ? (
              <Card className="lg:col-span-2 p-6 flex items-center justify-center py-20">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground mr-3" />
                <span className="text-muted-foreground">Carregando dados regionais...</span>
              </Card>
            ) : (
              <Card className="p-4 space-y-4 lg:col-span-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-500" />
                      Todos os Provedores
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {regionalTotal} inadimplentes na rede · dados anonimizados
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex gap-0.5">
                      <span className="w-3 h-3 rounded-sm bg-blue-400 opacity-70" />
                      <span className="w-3 h-3 rounded-sm bg-purple-500" />
                      <span className="w-3 h-3 rounded-sm bg-pink-500" />
                      <span className="w-3 h-3 rounded-sm bg-red-600" />
                    </span>
                    Baixo → Alto risco
                  </div>
                </div>
                <div className="relative">
                  <AzureHeatMap
                    key={`regional-${regionalPoints.length}`}
                    points={regionalPoints}
                    mode="regional"
                  />
                  {regionalPoints.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center bg-emerald-50/60 dark:bg-emerald-950/40 rounded-lg z-10">
                      <Eye className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
                      <p className="font-medium text-emerald-700 dark:text-emerald-300">Nenhum ponto de inadimplencia na rede</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Info className="w-3 h-3" />
                  Manchas de calor indicam concentracao de inadimplencia por area
                </div>
              </Card>
            )}
          </div>

          {cityRanking.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-500" />
                <h3 className="font-semibold">Ranking de Risco por Cidade</h3>
                <span className="ml-auto text-xs text-muted-foreground">{cityRanking.length} cidades</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">#</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Cidade</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground hidden sm:table-cell">Incidencias</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground hidden md:table-cell">Concentracao</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground hidden sm:table-cell">Valor Total</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground hidden lg:table-cell">Max. Atraso</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Risco</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {cityRanking.slice(0, 20).map((city, idx) => (
                      <tr key={city.city} className="hover:bg-muted/30 transition-colors" data-testid={`city-row-${idx}`}>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="font-medium">{city.city}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="font-semibold">{city.count}</span>
                          <span className="text-muted-foreground text-xs ml-1">inadimplentes</span>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell w-36">
                          <RiskBarCell value={city.count} max={maxCityCount} />
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell font-medium">{formatCurrency(city.totalOverdue)}</td>
                        <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">{city.maxDays}d</td>
                        <td className="px-4 py-3"><RiskBadge count={city.count} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {cityRanking.length > 0 && (
                <div className="px-4 py-3 border-t bg-muted/20 flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    Dados anonimizados de todos os provedores da plataforma. Use para identificar areas de risco antes de expandir a cobertura ou ajustar politicas de credito.
                  </span>
                </div>
              )}
            </Card>
          )}

          {cityLoading && (
            <Card className="p-6 flex items-center justify-center gap-3 py-10">
              <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Carregando ranking de cidades...</span>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
