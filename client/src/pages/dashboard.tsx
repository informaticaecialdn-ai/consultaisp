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
  ShieldAlert,
  RefreshCw,
  CreditCard,
  MapPin,
  Flame,
  ExternalLink,
  Eye,
  Wifi,
  TrendingUp,
  Users,
  ChevronRight,
  Clock,
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

const RISK_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  critical: { label: "Critico",  color: "text-red-700 dark:text-red-400",    bg: "bg-red-500",    dot: "bg-red-500" },
  high:     { label: "Alto",     color: "text-orange-700 dark:text-orange-400", bg: "bg-orange-500", dot: "bg-orange-500" },
  medium:   { label: "Medio",    color: "text-yellow-700 dark:text-yellow-400", bg: "bg-yellow-500", dot: "bg-yellow-500" },
  low:      { label: "Baixo",    color: "text-green-700 dark:text-green-400",  bg: "bg-green-500",  dot: "bg-green-500" },
};

function RiskBadge({ tier }: { tier: string }) {
  const cfg = RISK_CONFIG[tier] ?? RISK_CONFIG.low;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.color} bg-current/10`}
      style={{ background: "transparent" }}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

export default function DashboardPage() {
  const { provider } = useAuth();
  const [providerCenter, setProviderCenter] = useState<[number, number] | null>(null);

  const { data: stats, isLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: defaultersList = [], isLoading: listLoading } = useQuery<any[]>({ queryKey: ["/api/dashboard/defaulters"] });
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

  const totalRisk = (stats?.criticalCount || 0) + (stats?.highCount || 0) + (stats?.mediumCount || 0);
  const riskBar = (v: number) => totalRisk > 0 ? Math.round((v / totalRisk) * 100) : 0;

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

      {/* Main content: Lista + Risco */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Top Inadimplentes */}
        <Card className="lg:col-span-2 overflow-hidden" data-testid="card-top-defaulters">
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-rose-500" />
              <span className="font-semibold text-sm">Maiores Inadimplentes</span>
            </div>
            <Link href="/inadimplentes">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground">
                Ver todos
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>

          {listLoading ? (
            <div className="divide-y">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : defaultersList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <Eye className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="font-medium text-muted-foreground">Nenhum inadimplente registrado</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Os inadimplentes aparecerão aqui quando houver faturas em atraso.</p>
            </div>
          ) : (
            <div className="divide-y">
              {defaultersList.slice(0, 8).map((d, idx) => (
                <div key={d.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors" data-testid={`row-defaulter-${d.id}`}>
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-xs font-bold text-muted-foreground">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" data-testid={`text-name-${d.id}`}>{d.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {d.city && (
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                          <MapPin className="w-3 h-3" />{d.city}{d.state ? `, ${d.state}` : ""}
                        </span>
                      )}
                      {d.maxDaysOverdue > 0 && (
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                          <Clock className="w-3 h-3" />{d.maxDaysOverdue}d
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-rose-600 dark:text-rose-400" data-testid={`text-amount-${d.id}`}>
                      R$ {fmt(Number(d.totalOverdueAmount || 0))}
                    </p>
                    <div className="flex justify-end mt-0.5">
                      <RiskBadge tier={d.riskTier || "low"} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Distribuição de Risco */}
        <div className="space-y-4">
          <Card className="overflow-hidden" data-testid="card-risk-distribution">
            <div className="flex items-center gap-2 p-4 border-b">
              <ShieldAlert className="w-4 h-4 text-orange-500" />
              <span className="font-semibold text-sm">Distribuicao de Risco</span>
            </div>
            <div className="p-4 space-y-4">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-2 w-full rounded-full" />
                  </div>
                ))
              ) : totalRisk === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Sem inadimplentes com risco classificado</p>
              ) : (
                [
                  { key: "critical", count: stats?.criticalCount ?? 0 },
                  { key: "high",     count: stats?.highCount ?? 0 },
                  { key: "medium",   count: stats?.mediumCount ?? 0 },
                ].map(({ key, count }) => {
                  const cfg = RISK_CONFIG[key];
                  const pct = riskBar(count);
                  return (
                    <div key={key} data-testid={`risk-bar-${key}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                        <span className="text-xs text-muted-foreground">{count} cliente{count !== 1 ? "s" : ""} · {pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${cfg.bg} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          {/* Acoes rapidas */}
          <Card className="overflow-hidden" data-testid="card-quick-actions">
            <div className="p-3 border-b">
              <span className="font-semibold text-sm">Acoes Rapidas</span>
            </div>
            <div className="p-2 space-y-1">
              {[
                { href: "/inadimplentes", icon: Users, label: "Gerenciar Inadimplentes", color: "text-rose-600" },
                { href: "/consulta-isp", icon: Search, label: "Consulta ISP", color: "text-blue-600" },
                { href: "/anti-fraude", icon: ShieldAlert, label: "Anti-Fraude", color: "text-orange-600" },
                { href: "/mapa-calor", icon: Flame, label: "Mapa de Calor", color: "text-amber-600" },
              ].map(({ href, icon: Icon, label, color }) => (
                <Link key={href} href={href}>
                  <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid={`btn-quick-${href.replace("/", "")}`}>
                    <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
                    <span className="text-sm font-medium">{label}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
                  </button>
                </Link>
              ))}
            </div>
          </Card>
        </div>
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
