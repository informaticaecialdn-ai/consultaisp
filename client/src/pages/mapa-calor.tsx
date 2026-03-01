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
  clusterPoints,
  defaultCenter,
  height = 480,
}: {
  points: HeatPoint[];
  mode: "provider" | "regional";
  clusterPoints?: RegionalCluster[];
  defaultCenter?: [number, number] | null;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const heatRef = useRef<any>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
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
      const zoom = defaultCenter ? 11 : (points.length > 0 ? 7 : 5);

      mapRef.current = L.map(containerRef.current, { zoomControl: true, scrollWheelZoom: false }).setView(center, zoom);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(mapRef.current);

      markersRef.current = L.layerGroup().addTo(mapRef.current);
    }

    if (heatRef.current) {
      mapRef.current.removeLayer(heatRef.current);
      heatRef.current = null;
    }
    if (markersRef.current) markersRef.current.clearLayers();

    if (points.length > 0 && (L as any).heatLayer) {
      const gradient = mode === "provider"
        ? { 0.2: "#22c55e", 0.5: "#facc15", 0.75: "#f97316", 1.0: "#ef4444" }
        : { 0.1: "#3b82f6", 0.4: "#8b5cf6", 0.7: "#ec4899", 1.0: "#ef4444" };

      heatRef.current = (L as any).heatLayer(
        points.map(p => [p.lat, p.lng, p.weight]),
        { radius: 35, blur: 20, maxZoom: 14, gradient, minOpacity: 0.4 }
      ).addTo(mapRef.current);
    }

    if (mode === "provider" && clusterPoints && markersRef.current) {
      for (const c of clusterPoints) {
        const lat = parseFloat(String(c.lat));
        const lng = parseFloat(String(c.lng));
        if (isNaN(lat) || isNaN(lng)) continue;
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:10px;height:10px;background:#ef4444;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        });
        const marker = L.marker([lat, lng], { icon });
        const p = c as any;
        if (p.name) {
          marker.bindPopup(`<b>${p.name}</b><br>${p.city || ""}<br>${formatCurrency(p.totalOverdueAmount)} em aberto<br>${p.maxDaysOverdue || 0} dias de atraso`, { closeButton: false });
        }
        markersRef.current.addLayer(marker);
      }
    }

    if (points.length > 1 && !defaultCenter) {
      const group = L.featureGroup(points.map(p => L.circleMarker([p.lat, p.lng], { radius: 0 })));
      mapRef.current.fitBounds(group.getBounds().pad(0.15));
    }
  }, [points, mode, clusterPoints, defaultCenter, ready]);

  useEffect(() => {
    initMap();
  }, [initMap]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        try { mapRef.current.stop(); mapRef.current.remove(); } catch {}
        mapRef.current = null;
        heatRef.current = null;
        markersRef.current = null;
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

  const { data: cityRanking = [] } = useQuery<CityRanking[]>({
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
                  clusterPoints={providerData as any}
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
          {regionalLoading ? (
            <Card className="p-6 flex items-center justify-center py-20">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground mr-3" />
              <span className="text-muted-foreground">Carregando dados regionais...</span>
            </Card>
          ) : regionalPoints.length === 0 ? (
            <Card className="p-12 text-center">
              <Eye className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
              <p className="font-medium text-emerald-700 dark:text-emerald-300">Nenhum ponto de inadimplencia na rede</p>
            </Card>
          ) : (
            <LeafletHeatMap
              key={`regional-${regionalPoints.length}-${providerCenter?.[0]}`}
              points={regionalPoints}
              mode="regional"
              clusterPoints={regionalData}
              defaultCenter={providerCenter}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
