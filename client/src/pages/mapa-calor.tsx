import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect, useRef, useCallback } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
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
          {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>}
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


let heatScriptLoaded = false;

function loadHeatPlugin(): Promise<void> {
  return new Promise((resolve) => {
    if (heatScriptLoaded || (L as any).heatLayer) { heatScriptLoaded = true; resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js";
    s.onload = () => { heatScriptLoaded = true; resolve(); };
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

async function geocodeCity(city: string, state?: string): Promise<[number, number] | null> {
  if (!city) return null;
  try {
    const q = encodeURIComponent([city, state, "Brasil"].filter(Boolean).join(", "));
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=br`, {
      headers: { "Accept-Language": "pt-BR" },
    });
    const data = await res.json();
    if (data?.[0]?.lat && data?.[0]?.lon) {
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
  } catch {}
  return null;
}

type HeatPoint = { lat: number; lng: number; weight: number };

function LeafletHeatMap({
  points,
  mode,
  defaultCenter,
  height = 480,
}: {
  points: HeatPoint[];
  mode: "provider" | "regional";
  defaultCenter?: [number, number] | null;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const heatRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadHeatPlugin().then(() => setReady(true));
  }, []);

  const initMap = useCallback(async () => {
    if (!containerRef.current || !ready) return;

    if (!mapRef.current) {
      const BRAZIL_CENTER: [number, number] = [-15.8, -48.0];
      const center: [number, number] = defaultCenter ?? (points.length > 0
        ? [
            points.reduce((s, p) => s + p.lat, 0) / points.length,
            points.reduce((s, p) => s + p.lng, 0) / points.length,
          ]
        : BRAZIL_CENTER);
      const zoom = defaultCenter ? 13 : (points.length > 0 ? 7 : 5);

      mapRef.current = L.map(containerRef.current, { zoomControl: true, scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView(center, zoom);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(mapRef.current);
    }

    if (heatRef.current) {
      mapRef.current.removeLayer(heatRef.current);
      heatRef.current = null;
    }

    if (points.length > 0 && (L as any).heatLayer) {
      const maxW = Math.max(...points.map(p => p.weight), 1);
      const heatData = points.map(p => [p.lat, p.lng, p.weight / maxW]);

      const gradient = mode === "provider"
        ? { 0.0: "rgba(34,197,94,0)", 0.2: "#86efac", 0.4: "#fde047", 0.6: "#fb923c", 0.8: "#ef4444", 1.0: "#991b1b" }
        : { 0.0: "rgba(59,130,246,0)", 0.2: "#93c5fd", 0.4: "#a78bfa", 0.6: "#e879f9", 0.8: "#f43f5e", 1.0: "#881337" };

      heatRef.current = (L as any).heatLayer(
        heatData,
        { radius: 18, blur: 15, maxZoom: 17, gradient, minOpacity: 0.35, max: 1.0 }
      ).addTo(mapRef.current);
    }

    if (points.length > 1 && !defaultCenter) {
      const group = L.featureGroup(points.map(p => L.circleMarker([p.lat, p.lng], { radius: 0 })));
      mapRef.current.fitBounds(group.getBounds().pad(0.15), { animate: false });
    }
  }, [points, mode, defaultCenter, ready]);

  useEffect(() => {
    initMap();
  }, [initMap]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        try {
          const m = mapRef.current as any;
          const pane = m._mapPane as HTMLElement | undefined;
          if (pane) {
            pane.style.transition = "none";
            void pane.offsetWidth;
            L.DomEvent.off(pane as any);
          }
          m._animatingZoom = false;
          m._onZoomTransitionEnd = () => {};
          m.off();
          m.stop();
          m.remove();
        } catch {}
        mapRef.current = null;
        heatRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        style={{ height: `${height}px` }}
        className="w-full rounded-lg border z-0"
        data-testid="leaflet-map-container"
      />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/60 rounded-lg">
          <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

export default function MapaCalorPage() {
  const { provider } = useAuth();
  const [activeTab, setActiveTab] = useState("provider");
  const [providerCenter, setProviderCenter] = useState<[number, number] | null>(null);

  const { data: providerData = [], isLoading: providerLoading } = useQuery<ProviderHeatmapPoint[]>({
    queryKey: ["/api/heatmap/provider"],
  });

  const { data: regionalData = [], isLoading: regionalLoading } = useQuery<RegionalCluster[]>({
    queryKey: ["/api/heatmap/regional"],
  });

  const { data: cityRanking = [], isLoading: cityLoading } = useQuery<CityRanking[]>({
    queryKey: ["/api/heatmap/city-ranking"],
  });

  useEffect(() => {
    const city = provider?.addressCity || "";
    const state = provider?.addressState || "";
    if (city) {
      geocodeCity(city, state).then(coords => {
        if (coords) setProviderCenter(coords);
      });
      return;
    }
    if (cityRanking.length > 0) {
      const top = cityRanking[0];
      if (top.lat && top.lng) setProviderCenter([top.lat, top.lng]);
    }
  }, [provider?.addressCity, provider?.addressState, cityRanking]);

  const providerPoints: HeatPoint[] = providerData
    .map(p => ({
      lat: parseFloat(p.latitude),
      lng: parseFloat(p.longitude),
      weight: Math.max(0.2, ((p.maxDaysOverdue || 0) / 90) + (parseFloat(p.totalOverdueAmount || "0") / 500)),
    }))
    .filter(p => !isNaN(p.lat) && !isNaN(p.lng));

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
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
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
            <Card className="p-6 flex items-center justify-center py-20">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground mr-3" />
              <span className="text-muted-foreground">Carregando mapa...</span>
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

              {providerPoints.length === 0 ? (
                <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-12 text-center border border-emerald-200 dark:border-emerald-900">
                  <Eye className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">Nenhum inadimplente com localizacao cadastrada</p>
                  <p className="text-sm text-muted-foreground mt-1">Clientes sem coordenadas geograficas nao aparecem no mapa.</p>
                </div>
              ) : (
                <LeafletHeatMap
                  key={`provider-${providerPoints.length}-${providerCenter?.[0]}`}
                  points={providerPoints}
                  mode="provider"
                  defaultCenter={providerCenter}
                />
              )}
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
                {regionalPoints.length === 0 ? (
                  <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-12 text-center border border-emerald-200 dark:border-emerald-900">
                    <Eye className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
                    <p className="font-medium text-emerald-700 dark:text-emerald-300">Nenhum ponto de inadimplencia na rede</p>
                  </div>
                ) : (
                  <LeafletHeatMap
                    key={`regional-${regionalPoints.length}-${providerCenter?.[0]}`}
                    points={regionalPoints}
                    mode="regional"
                    defaultCenter={providerCenter}
                  />
                )}
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
