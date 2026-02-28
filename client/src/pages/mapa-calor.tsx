import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  MapPin,
  AlertTriangle,
  Users,
  DollarSign,
  Building2,
  RefreshCw,
  Settings,
  Eye,
  Info,
  Key,
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

type RegionalHeatmapPoint = {
  lat: number;
  lng: number;
  count: number;
  totalOverdue: number;
};

function formatCurrency(value: number | string | null | undefined): string {
  const num = typeof value === "string" ? parseFloat(value) : (value || 0);
  return `R$ ${num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: any; color: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-lg font-bold" data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    </Card>
  );
}

function GoogleMap({ apiKey, points, mode, radius }: {
  apiKey: string;
  points: { lat: number; lng: number; weight: number }[];
  mode: "provider" | "regional";
  radius: number;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const heatmapRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    if (!apiKey) return;
    const existingScript = document.querySelector(`script[src*="maps.googleapis.com"]`);
    if (existingScript) {
      if ((window as any).google?.maps) {
        setScriptLoaded(true);
      } else {
        existingScript.addEventListener("load", () => setScriptLoaded(true));
      }
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=visualization&callback=__gmapsCallback`;
    script.async = true;
    script.defer = true;
    (window as any).__gmapsCallback = () => {
      setScriptLoaded(true);
      delete (window as any).__gmapsCallback;
    };
    document.head.appendChild(script);
  }, [apiKey]);

  const initMap = useCallback(() => {
    if (!mapRef.current || !scriptLoaded || !(window as any).google?.maps) return;

    if (!mapInstanceRef.current) {
      const center = points.length > 0
        ? { lat: points.reduce((s, p) => s + p.lat, 0) / points.length, lng: points.reduce((s, p) => s + p.lng, 0) / points.length }
        : { lat: -23.5505, lng: -46.6340 };

      mapInstanceRef.current = new google.maps.Map(mapRef.current, {
        center,
        zoom: points.length > 0 ? 6 : 5,
        mapTypeId: "roadmap",
        styles: [
          { featureType: "poi", stylers: [{ visibility: "off" }] },
          { featureType: "transit", stylers: [{ visibility: "off" }] },
        ],
      });
    }

    if (heatmapRef.current) {
      heatmapRef.current.setMap(null);
    }
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    if (points.length > 0) {
      const heatmapData = points.map(p => ({
        location: new google.maps.LatLng(p.lat, p.lng),
        weight: p.weight,
      }));

      const gradient = mode === "provider"
        ? [
            "rgba(0, 255, 0, 0)",
            "rgba(255, 255, 0, 0.6)",
            "rgba(255, 165, 0, 0.8)",
            "rgba(255, 0, 0, 1)",
          ]
        : [
            "rgba(0, 0, 255, 0)",
            "rgba(0, 128, 255, 0.4)",
            "rgba(128, 0, 255, 0.6)",
            "rgba(255, 0, 128, 0.8)",
            "rgba(255, 0, 0, 1)",
          ];

      heatmapRef.current = new google.maps.visualization.HeatmapLayer({
        data: heatmapData,
        map: mapInstanceRef.current,
        radius: radius,
        gradient,
        opacity: 0.7,
      });

      if (mode === "regional") {
        const uniquePoints = new Map<string, { lat: number; lng: number; weight: number }>();
        points.forEach(p => {
          const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
          const existing = uniquePoints.get(key);
          if (existing) {
            existing.weight += p.weight;
          } else {
            uniquePoints.set(key, { ...p });
          }
        });

        uniquePoints.forEach((p) => {
          if (p.weight >= 1) {
            const marker = new google.maps.Marker({
              position: { lat: p.lat, lng: p.lng },
              map: mapInstanceRef.current,
              label: {
                text: String(Math.round(p.weight)),
                color: "#fff",
                fontWeight: "bold",
                fontSize: "11px",
              },
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 16 + Math.min(p.weight * 2, 20),
                fillColor: p.weight >= 3 ? "#ef4444" : p.weight >= 2 ? "#f97316" : "#eab308",
                fillOpacity: 0.85,
                strokeColor: "#fff",
                strokeWeight: 2,
              },
            });
            markersRef.current.push(marker);
          }
        });
      }

      const bounds = new google.maps.LatLngBounds();
      points.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
      mapInstanceRef.current?.fitBounds(bounds, 60);
    }
  }, [points, mode, radius, scriptLoaded]);

  useEffect(() => {
    initMap();
  }, [initMap]);

  useEffect(() => {
    if (heatmapRef.current) {
      heatmapRef.current.set("radius", radius);
    }
  }, [radius]);

  return (
    <div
      ref={mapRef}
      className="w-full h-[500px] rounded-lg border"
      data-testid="google-map-container"
    />
  );
}

function MissingKeyMessage() {
  return (
    <Card className="p-6">
      <div className="bg-amber-50 dark:bg-amber-950/20 rounded-lg p-8 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
          <Key className="w-8 h-8 text-amber-600" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Chave do Google Maps necessaria</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-md">
          Para visualizar o mapa de calor, configure a chave da API do Google Maps
          no painel de segredos (Secrets) do projeto.
        </p>
        <div className="bg-white dark:bg-gray-900 rounded-lg p-4 text-left text-sm space-y-2 max-w-lg w-full">
          <p className="font-medium">Como configurar:</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>Acesse <span className="font-medium text-foreground">console.cloud.google.com</span></li>
            <li>Crie ou selecione um projeto</li>
            <li>Ative a <span className="font-medium text-foreground">Maps JavaScript API</span></li>
            <li>Va em Credenciais e crie uma chave de API</li>
            <li>No Replit, va em Secrets e adicione <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">GOOGLE_MAPS_API_KEY</code></li>
          </ol>
        </div>
      </div>
    </Card>
  );
}

export default function MapaCalorPage() {
  const { provider } = useAuth();
  const [radius, setRadius] = useState([40]);
  const [activeTab, setActiveTab] = useState("provider");

  const { data: mapsKeyData } = useQuery<{ key: string }>({
    queryKey: ["/api/config/maps-key"],
  });

  const { data: providerData = [], isLoading: providerLoading, isError: providerError } = useQuery<ProviderHeatmapPoint[]>({
    queryKey: ["/api/heatmap/provider"],
  });

  const { data: regionalData = [], isLoading: regionalLoading, isError: regionalError } = useQuery<RegionalHeatmapPoint[]>({
    queryKey: ["/api/heatmap/regional"],
  });

  const apiKey = mapsKeyData?.key || "";
  const hasKey = apiKey.length > 10;

  const providerPoints = providerData.map(p => ({
    lat: parseFloat(p.latitude),
    lng: parseFloat(p.longitude),
    weight: Math.max(1, (p.maxDaysOverdue || 0) / 30 + parseFloat(p.totalOverdueAmount || "0") / 200),
  })).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

  const regionalPoints = regionalData.map(p => ({
    lat: p.lat,
    lng: p.lng,
    weight: p.count,
  })).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

  const totalOverdue = providerData.reduce((sum, p) => sum + parseFloat(p.totalOverdueAmount || "0"), 0);
  const criticalCount = providerData.filter(p => p.riskTier === "critical").length;
  const highCount = providerData.filter(p => p.riskTier === "high").length;
  const uniqueCities = new Set(providerData.map(p => p.city).filter(Boolean));

  const regionalTotal = regionalData.reduce((s, p) => s + p.count, 0);
  const regionalTotalOverdue = regionalData.reduce((s, p) => s + p.totalOverdue, 0);
  const regionalHotspots = regionalData.filter(p => p.count >= 2).length;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="mapa-calor-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <MapPin className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-mapa-calor-title">Mapa de Calor</h1>
            <p className="text-sm text-muted-foreground">Visualizacao geografica de inadimplencia</p>
          </div>
        </div>
        {hasKey && (
          <Button
            variant="secondary"
            className="gap-2"
            data-testid="button-refresh-map"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="provider" className="gap-1.5" data-testid="tab-meu-provedor">
            <Building2 className="w-3.5 h-3.5" />
            Meu Provedor
          </TabsTrigger>
          <TabsTrigger value="regional" className="gap-1.5" data-testid="tab-benchmarking">
            <Users className="w-3.5 h-3.5" />
            Benchmarking Regional
          </TabsTrigger>
        </TabsList>

        <TabsContent value="provider" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Inadimplentes" value={providerData.length} icon={AlertTriangle} color="bg-red-500" />
            <StatCard label="Valor em Aberto" value={formatCurrency(totalOverdue)} icon={DollarSign} color="bg-orange-500" />
            <StatCard label="Criticos" value={criticalCount} icon={AlertTriangle} color="bg-rose-600" />
            <StatCard label="Cidades" value={uniqueCities.size} icon={MapPin} color="bg-blue-500" />
          </div>

          {providerError ? (
            <Card className="p-6">
              <div className="flex items-center justify-center py-12 text-center">
                <AlertTriangle className="w-6 h-6 text-red-500 mr-3" />
                <span className="text-muted-foreground">Erro ao carregar dados do provedor. Tente novamente.</span>
              </div>
            </Card>
          ) : !hasKey ? (
            <MissingKeyMessage />
          ) : providerLoading ? (
            <Card className="p-6">
              <div className="flex items-center justify-center py-20">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground mr-3" />
                <span className="text-muted-foreground">Carregando dados do mapa...</span>
              </div>
            </Card>
          ) : (
            <Card className="p-4 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    {provider?.name}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {providerData.length} inadimplente{providerData.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Settings className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Raio</span>
                  <div className="w-32">
                    <Slider
                      value={radius}
                      onValueChange={setRadius}
                      max={100}
                      min={10}
                      step={5}
                      data-testid="slider-radius"
                    />
                  </div>
                  <span className="text-xs font-medium w-6 text-right">{radius[0]}</span>
                </div>
              </div>

              {providerPoints.length === 0 ? (
                <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-12 text-center">
                  <Eye className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">Nenhum inadimplente com localizacao</p>
                  <p className="text-sm text-muted-foreground mt-1">Todos os clientes estao em dia ou sem coordenadas cadastradas.</p>
                </div>
              ) : (
                <GoogleMap apiKey={apiKey} points={providerPoints} mode="provider" radius={radius[0]} />
              )}

              <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-gradient-to-r from-yellow-400 to-red-500" />
                  Intensidade = dias de atraso + valor em aberto
                </div>
                <div className="flex items-center gap-1.5">
                  <Info className="w-3 h-3" />
                  Apenas clientes do seu provedor
                </div>
              </div>
            </Card>
          )}

          {providerData.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b">
                <h3 className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Detalhes dos Inadimplentes
                </h3>
              </div>
              <div className="divide-y max-h-[300px] overflow-y-auto">
                {providerData.map((item) => (
                  <div key={item.id} className="flex items-center gap-4 px-4 py-3" data-testid={`defaulter-row-${item.id}`}>
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      item.riskTier === "critical" ? "bg-red-500" :
                      item.riskTier === "high" ? "bg-orange-500" :
                      item.riskTier === "medium" ? "bg-amber-500" : "bg-emerald-500"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.city || "Sem cidade"}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold">{formatCurrency(item.totalOverdueAmount)}</p>
                      <p className="text-xs text-muted-foreground">{item.maxDaysOverdue} dias</p>
                    </div>
                    <Badge
                      className={`text-xs flex-shrink-0 ${
                        item.riskTier === "critical" ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" :
                        item.riskTier === "high" ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" :
                        "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                      }`}
                    >
                      {item.riskTier === "critical" ? "Critico" : item.riskTier === "high" ? "Alto" : "Medio"}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="regional" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Inadimplentes" value={regionalTotal} icon={Users} color="bg-purple-500" />
            <StatCard label="Valor Total" value={formatCurrency(regionalTotalOverdue)} icon={DollarSign} color="bg-indigo-500" />
            <StatCard label="Pontos Focais" value={regionalHotspots} icon={MapPin} color="bg-rose-500" />
            <StatCard label="Provedores" value="Todos" icon={Building2} color="bg-blue-500" />
          </div>

          {regionalError ? (
            <Card className="p-6">
              <div className="flex items-center justify-center py-12 text-center">
                <AlertTriangle className="w-6 h-6 text-red-500 mr-3" />
                <span className="text-muted-foreground">Erro ao carregar dados regionais. Tente novamente.</span>
              </div>
            </Card>
          ) : !hasKey ? (
            <MissingKeyMessage />
          ) : regionalLoading ? (
            <Card className="p-6">
              <div className="flex items-center justify-center py-20">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground mr-3" />
                <span className="text-muted-foreground">Carregando dados regionais...</span>
              </div>
            </Card>
          ) : (
            <Card className="p-4 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-purple-500" />
                    Todos os Provedores
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {regionalTotal} inadimplente{regionalTotal !== 1 ? "s" : ""} na rede
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Settings className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Raio</span>
                  <div className="w-32">
                    <Slider
                      value={radius}
                      onValueChange={setRadius}
                      max={100}
                      min={10}
                      step={5}
                      data-testid="slider-radius-regional"
                    />
                  </div>
                  <span className="text-xs font-medium w-6 text-right">{radius[0]}</span>
                </div>
              </div>

              {regionalPoints.length === 0 ? (
                <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-12 text-center">
                  <Eye className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">Nenhum ponto de inadimplencia na rede</p>
                </div>
              ) : (
                <GoogleMap apiKey={apiKey} points={regionalPoints} mode="regional" radius={radius[0]} />
              )}

              <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-gradient-to-r from-blue-400 via-purple-500 to-red-500" />
                  Intensidade = quantidade de clientes inadimplentes
                </div>
                <div className="flex items-center gap-1.5">
                  <Info className="w-3 h-3" />
                  Dados anonimizados de todos os provedores
                </div>
              </div>
            </Card>
          )}

          {regionalData.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b">
                <h3 className="font-semibold flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Pontos Focais de Inadimplencia
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Apenas manchas com quantidade de clientes (dados anonimizados)
                </p>
              </div>
              <div className="divide-y max-h-[300px] overflow-y-auto">
                {regionalData
                  .sort((a, b) => b.count - a.count)
                  .map((item, idx) => (
                  <div key={idx} className="flex items-center gap-4 px-4 py-3" data-testid={`regional-point-${idx}`}>
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${
                      item.count >= 3 ? "bg-red-500" : item.count >= 2 ? "bg-orange-500" : "bg-amber-500"
                    }`}>
                      {item.count}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">
                        Ponto {idx + 1}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold">{item.count} cliente{item.count > 1 ? "s" : ""}</p>
                      <p className="text-xs text-muted-foreground">{formatCurrency(item.totalOverdue)} em aberto</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
