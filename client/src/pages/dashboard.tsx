import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useEffect, useRef, useCallback, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  Users,
  Wifi,
  DollarSign,
  AlertTriangle,
  Search,
  ShieldAlert,
  Settings,
  UserPlus,
  RefreshCw,
  CreditCard,
  MapPin,
  Flame,
  ExternalLink,
  Eye,
} from "lucide-react";

type HeatPoint = { lat: number; lng: number; weight: number };

let heatScriptCached = false;
function loadHeatPlugin(): Promise<void> {
  return new Promise((resolve) => {
    if (heatScriptCached || (L as any).heatLayer) { heatScriptCached = true; resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js";
    s.onload = () => { heatScriptCached = true; resolve(); };
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

function MiniHeatMap({ points, providerPoints, defaultCenter }: { points: HeatPoint[]; providerPoints: any[]; defaultCenter?: [number, number] | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const heatRef = useRef<any>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { loadHeatPlugin().then(() => setReady(true)); }, []);

  const buildMap = useCallback(() => {
    if (!containerRef.current || !ready) return;

    if (!mapRef.current) {
      const BRAZIL_CENTER: [number, number] = [-15.8, -48.0];
      const center: [number, number] = defaultCenter ?? (points.length > 0
        ? [points.reduce((s, p) => s + p.lat, 0) / points.length, points.reduce((s, p) => s + p.lng, 0) / points.length]
        : BRAZIL_CENTER);
      const zoom = defaultCenter ? 11 : (points.length > 0 ? 9 : 5);

      mapRef.current = L.map(containerRef.current, {
        zoomControl: false,
        scrollWheelZoom: false,
        dragging: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        attributionControl: false,
      }).setView(center, zoom);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(mapRef.current);
      markersRef.current = L.layerGroup().addTo(mapRef.current);
    }

    if (heatRef.current) { mapRef.current.removeLayer(heatRef.current); heatRef.current = null; }
    if (markersRef.current) markersRef.current.clearLayers();

    if (points.length > 0 && (L as any).heatLayer) {
      heatRef.current = (L as any).heatLayer(
        points.map(p => [p.lat, p.lng, p.weight]),
        { radius: 40, blur: 22, maxZoom: 14, gradient: { 0.2: "#22c55e", 0.5: "#facc15", 0.75: "#f97316", 1.0: "#ef4444" }, minOpacity: 0.45 }
      ).addTo(mapRef.current);
    }

    if (markersRef.current) {
      for (const p of providerPoints) {
        const lat = parseFloat(p.latitude);
        const lng = parseFloat(p.longitude);
        if (isNaN(lat) || isNaN(lng)) continue;
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:8px;height:8px;background:#ef4444;border:1.5px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>`,
          iconSize: [8, 8],
          iconAnchor: [4, 4],
        });
        const marker = L.marker([lat, lng], { icon });
        marker.bindTooltip(`${p.name} · ${p.city || ""}`, { permanent: false, direction: "top", offset: [0, -6] });
        markersRef.current.addLayer(marker);
      }
    }

    if (points.length > 1 && !defaultCenter) {
      const group = L.featureGroup(points.map(p => L.circleMarker([p.lat, p.lng], { radius: 0 })));
      mapRef.current?.fitBounds(group.getBounds().pad(0.2));
    }
  }, [points, providerPoints, defaultCenter, ready]);

  useEffect(() => { buildMap(); }, [buildMap]);

  useEffect(() => () => {
    if (mapRef.current) { try { mapRef.current.stop(); mapRef.current.remove(); } catch {} mapRef.current = null; heatRef.current = null; markersRef.current = null; }
  }, []);

  return (
    <div className="relative rounded-lg overflow-hidden border">
      <div ref={containerRef} style={{ height: "260px" }} className="w-full" data-testid="dashboard-heatmap" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/60">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { provider } = useAuth();
  const [providerCenter, setProviderCenter] = useState<[number, number] | null>(null);

  const { data: stats, isLoading } = useQuery<any>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: heatmapData = [] } = useQuery<any[]>({
    queryKey: ["/api/heatmap/provider"],
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
    if (heatmapData.length > 0) {
      const topCustomer = [...heatmapData].sort(
        (a, b) => parseFloat(b.totalOverdueAmount || "0") - parseFloat(a.totalOverdueAmount || "0")
      )[0];
      const lat = parseFloat(topCustomer.latitude);
      const lng = parseFloat(topCustomer.longitude);
      if (!isNaN(lat) && !isNaN(lng)) setProviderCenter([lat, lng]);
    }
  }, [provider?.addressCity, provider?.addressState, heatmapData]);

  const heatPoints: HeatPoint[] = heatmapData
    .map(p => ({
      lat: parseFloat(p.latitude),
      lng: parseFloat(p.longitude),
      weight: Math.max(0.2, ((p.maxDaysOverdue || 0) / 90) + (parseFloat(p.totalOverdueAmount || "0") / 500)),
    }))
    .filter(p => !isNaN(p.lat) && !isNaN(p.lng));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="dashboard-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">Dashboard</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="default" className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 gap-1.5 px-3 py-1.5">
            <CreditCard className="w-3.5 h-3.5" />
            Creditos ISP: {stats?.ispCredits ?? "..."}
          </Badge>
          <Badge variant="default" className="bg-gradient-to-r from-pink-500 to-rose-500 text-white border-0 gap-1.5 px-3 py-1.5">
            <CreditCard className="w-3.5 h-3.5" />
            Creditos SPC: {stats?.spcCredits ?? "..."}
          </Badge>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-card-border p-4">
        <p className="text-sm text-muted-foreground">
          Bem-vindo ao painel de controle do <strong>{provider?.name}</strong>.
          Acompanhe seus clientes, inadimplentes e creditos em tempo real.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-6 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-32" />
            </Card>
          ))
        ) : (
          <>
            <Card className="p-6" data-testid="card-total-clients">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">Total de Clientes</p>
                <Users className="w-5 h-5 text-blue-500" />
              </div>
              <p className="text-3xl font-bold" data-testid="text-total-clients">{stats?.totalCustomers || 0}</p>
              <p className="text-xs text-muted-foreground mt-1">Inadimplentes: {stats?.defaulters || 0}</p>
            </Card>
            <Card className="p-6" data-testid="card-equipment">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">Equipamentos</p>
                <Wifi className="w-5 h-5 text-indigo-500" />
              </div>
              <p className="text-3xl font-bold" data-testid="text-equipment-value">
                R$ {Number(stats?.equipmentValue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{stats?.totalEquipment || 0} equipamentos</p>
            </Card>
            <Card className="p-6" data-testid="card-monthly-revenue">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">Total do Mes</p>
                <DollarSign className="w-5 h-5 text-emerald-500" />
              </div>
              <p className="text-3xl font-bold" data-testid="text-monthly-revenue">
                R$ {Number(stats?.monthlyRevenue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Faturas recebidas este mes</p>
            </Card>
            <Card className="p-6" data-testid="card-overdue">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">Debitos Acumulados</p>
                <AlertTriangle className="w-5 h-5 text-rose-500" />
              </div>
              <p className="text-3xl font-bold" data-testid="text-overdue-total">
                R$ {Number(stats?.overdueTotal || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Dividas acumuladas</p>
            </Card>
          </>
        )}
      </div>

      {/* Mapa de Calor de Inadimplencia */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
              <Flame className="w-4 h-4 text-orange-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold leading-tight">Mapa de Calor de Inadimplencia</h2>
              <p className="text-xs text-muted-foreground">Distribuicao geografica dos clientes em atraso</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 text-xs">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              {provider?.name}
            </Badge>
            <span className="text-sm font-medium text-muted-foreground" data-testid="text-defaulter-count">
              {stats?.defaulters || 0} inadimplentes
            </span>
            <Link href="/mapa-calor">
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" data-testid="button-view-full-map">
                <ExternalLink className="w-3.5 h-3.5" />
                Ver mapa completo
              </Button>
            </Link>
          </div>
        </div>

        {heatPoints.length === 0 ? (
          <div className="bg-muted/30 rounded-lg border p-8 flex flex-col items-center justify-center text-center gap-2">
            <Eye className="w-8 h-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">Nenhum inadimplente com coordenadas cadastradas</p>
            <p className="text-xs text-muted-foreground/70">Cadastre latitudes e longitudes nos clientes para visualizar o mapa.</p>
          </div>
        ) : (
          <>
            <MiniHeatMap
              key={`dash-${heatPoints.length}-${providerCenter?.[0]}`}
              points={heatPoints}
              providerPoints={heatmapData}
              defaultCenter={providerCenter}
            />
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="inline-flex gap-0.5">
                  <span className="w-3 h-2 rounded-sm bg-green-500 opacity-70" />
                  <span className="w-3 h-2 rounded-sm bg-yellow-400" />
                  <span className="w-3 h-2 rounded-sm bg-orange-500" />
                  <span className="w-3 h-2 rounded-sm bg-red-600" />
                </span>
                Baixo → Critico (dias de atraso + valor)
              </div>
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3 h-3" />
                {heatPoints.length} pontos visualizados
              </div>
            </div>
          </>
        )}
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-blue-600" />
          Acoes Rapidas
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/consulta-isp">
            <Card className="p-6 text-center cursor-pointer hover-elevate">
              <div className="w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-3">
                <Search className="w-7 h-7 text-blue-600" />
              </div>
              <span className="text-sm font-medium" data-testid="link-consultar-clientes">Consultar Clientes</span>
            </Card>
          </Link>
          <Link href="/anti-fraude">
            <Card className="p-6 text-center cursor-pointer hover-elevate">
              <div className="w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center mx-auto mb-3">
                <ShieldAlert className="w-7 h-7 text-rose-600" />
              </div>
              <span className="text-sm font-medium" data-testid="link-anti-fraude">Anti-Fraude</span>
            </Card>
          </Link>
          <Link href="/administracao">
            <Card className="p-6 text-center cursor-pointer hover-elevate">
              <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-3">
                <Settings className="w-7 h-7 text-amber-600" />
              </div>
              <span className="text-sm font-medium" data-testid="link-equipamentos">Equipamentos</span>
            </Card>
          </Link>
          <Link href="/inadimplentes">
            <Card className="p-6 text-center cursor-pointer hover-elevate">
              <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-3">
                <UserPlus className="w-7 h-7 text-emerald-600" />
              </div>
              <span className="text-sm font-medium" data-testid="link-novo-cliente">Novo Cliente</span>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
