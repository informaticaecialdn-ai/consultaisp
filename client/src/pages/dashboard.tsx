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
  AlertTriangle,
  Search,
  RefreshCw,
  CreditCard,
  MapPin,
  Flame,
  ExternalLink,
  Eye,
  Wifi,
  Users,
  Package,
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
    if (data?.[0]?.lat && data?.[0]?.lon) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
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
        zoomControl: false, scrollWheelZoom: false, dragging: false,
        doubleClickZoom: false, boxZoom: false, keyboard: false, attributionControl: false,
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
        const lat = parseFloat(p.latitude); const lng = parseFloat(p.longitude);
        if (isNaN(lat) || isNaN(lng)) continue;
        const icon = L.divIcon({ className: "", html: `<div style="width:8px;height:8px;background:#ef4444;border:1.5px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>`, iconSize: [8, 8], iconAnchor: [4, 4] });
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
    if (mapRef.current) {
      try {
        const m = mapRef.current as any;
        // Cancel CSS transition immediately so transitionend never fires after remove()
        const pane = m._mapPane as HTMLElement | undefined;
        if (pane) { pane.style.transition = "none"; void pane.offsetWidth; }
        m._onZoomTransitionEnd = () => {};
        m._onZoomAnim = () => {};
        m.off();
        m.stop();
        m.remove();
      } catch {}
      mapRef.current = null; heatRef.current = null; markersRef.current = null;
    }
  }, []);

  return (
    <div className="relative rounded-xl overflow-hidden border border-border">
      <div ref={containerRef} style={{ height: "240px" }} className="w-full" data-testid="dashboard-heatmap" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/60">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DashboardPage() {
  const { provider } = useAuth();
  const [providerCenter, setProviderCenter] = useState<[number, number] | null>(null);

  const { data: stats, isLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: heatmapData = [] } = useQuery<any[]>({ queryKey: ["/api/heatmap/provider"] });

  useEffect(() => {
    const city = provider?.addressCity || "";
    const state = provider?.addressState || "";
    if (city) {
      geocodeCity(city, state).then(coords => { if (coords) setProviderCenter(coords); });
      return;
    }
    if (heatmapData.length > 0) {
      const top = [...heatmapData].sort((a, b) => parseFloat(b.totalOverdueAmount || "0") - parseFloat(a.totalOverdueAmount || "0"))[0];
      const lat = parseFloat(top.latitude); const lng = parseFloat(top.longitude);
      if (!isNaN(lat) && !isNaN(lng)) setProviderCenter([lat, lng]);
    }
  }, [provider?.addressCity, provider?.addressState, heatmapData]);

  const heatPoints: HeatPoint[] = heatmapData
    .map(p => ({ lat: parseFloat(p.latitude), lng: parseFloat(p.longitude), weight: Math.max(0.2, ((p.maxDaysOverdue || 0) / 90) + (parseFloat(p.totalOverdueAmount || "0") / 500)) }))
    .filter(p => !isNaN(p.lat) && !isNaN(p.lng));

  const kpiCards = [
    {
      label: "Inadimplentes",
      value: isLoading ? null : stats?.defaulters ?? 0,
      sub: isLoading ? null : `${stats?.overdueInvoicesCount ?? 0} faturas em atraso`,
      icon: Users,
      accent: "from-rose-500 to-red-600",
      iconBg: "bg-rose-100 dark:bg-rose-900/30",
      iconColor: "text-rose-600",
      testId: "card-defaulters",
    },
    {
      label: "Total em Aberto",
      value: isLoading ? null : `R$ ${fmt(Number(stats?.overdueTotal ?? 0))}`,
      sub: "valor acumulado inadimplente",
      icon: AlertTriangle,
      accent: "from-orange-500 to-amber-500",
      iconBg: "bg-orange-100 dark:bg-orange-900/30",
      iconColor: "text-orange-600",
      testId: "card-overdue-total",
    },
    {
      label: "Equipamentos Retidos",
      value: isLoading ? null : stats?.unreturnedEquipmentCount ?? 0,
      sub: "nao devolvidos por inadimplentes",
      icon: Wifi,
      accent: "from-violet-500 to-indigo-600",
      iconBg: "bg-violet-100 dark:bg-violet-900/30",
      iconColor: "text-violet-600",
      testId: "card-equipment-count",
    },
    {
      label: "Valor em Risco",
      value: isLoading ? null : `R$ ${fmt(Number(stats?.unreturnedEquipmentValue ?? 0))}`,
      sub: "valor dos equipamentos retidos",
      icon: Package,
      accent: "from-sky-500 to-blue-600",
      iconBg: "bg-sky-100 dark:bg-sky-900/30",
      iconColor: "text-sky-600",
      testId: "card-equipment-value",
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="dashboard-page">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">Central de Inadimplencia</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{provider?.name} — monitoramento em tempo real</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5 text-xs font-semibold border-blue-300 text-blue-700 dark:text-blue-400">
            <CreditCard className="w-3.5 h-3.5" />
            ISP {stats?.ispCredits ?? "..."}
          </Badge>
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5 text-xs font-semibold border-pink-300 text-pink-700 dark:text-pink-400">
            <CreditCard className="w-3.5 h-3.5" />
            SPC {stats?.spcCredits ?? "..."}
          </Badge>
          <Link href="/consulta-isp">
            <Button size="sm" className="gap-1.5 h-8 text-xs" data-testid="button-consultar">
              <Search className="w-3.5 h-3.5" />
              Consultar CPF/CNPJ
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <Card key={card.testId} className="relative overflow-hidden p-5" data-testid={card.testId}>
            <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${card.accent}`} />
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
              <div className={`w-9 h-9 rounded-lg ${card.iconBg} flex items-center justify-center flex-shrink-0`}>
                <card.icon className={`w-4.5 h-4.5 ${card.iconColor}`} style={{ width: "18px", height: "18px" }} />
              </div>
            </div>
            {card.value === null ? (
              <>
                <Skeleton className="h-8 w-24 mb-1" />
                <Skeleton className="h-3 w-32" />
              </>
            ) : (
              <>
                <p className="text-2xl font-bold tracking-tight" data-testid={`value-${card.testId}`}>{card.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
              </>
            )}
          </Card>
        ))}
      </div>

      {/* Mapa de Calor */}
      <Card className="overflow-hidden" data-testid="card-heatmap">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-500" />
            <div>
              <span className="font-semibold text-sm">Mapa de Calor de Inadimplencia</span>
              <p className="text-xs text-muted-foreground">Distribuicao geografica dos clientes em atraso</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground" data-testid="text-defaulter-count">
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

        <div className="p-4">
          {heatPoints.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 flex flex-col items-center justify-center text-center gap-2 bg-muted/20">
              <MapPin className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">Nenhum ponto de calor disponivel</p>
              <p className="text-xs text-muted-foreground/60">Cadastre coordenadas nos clientes inadimplentes para visualizar o mapa.</p>
            </div>
          ) : (
            <>
              <MiniHeatMap
                key={`dash-${heatPoints.length}-${providerCenter?.[0]}`}
                points={heatPoints}
                providerPoints={heatmapData}
                defaultCenter={providerCenter}
              />
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex gap-0.5">
                    <span className="w-3 h-2 rounded-sm bg-green-500 opacity-70" />
                    <span className="w-3 h-2 rounded-sm bg-yellow-400" />
                    <span className="w-3 h-2 rounded-sm bg-orange-500" />
                    <span className="w-3 h-2 rounded-sm bg-red-600" />
                  </span>
                  Baixo → Critico
                </div>
                <span>{heatPoints.length} pontos visualizados</span>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
