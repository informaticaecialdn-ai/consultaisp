import { useQuery } from "@tanstack/react-query";
import { STALE_DASHBOARD } from "@/lib/queryClient";
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
  RefreshCw,
  CreditCard,
  MapPin,
  Flame,
  ExternalLink,
  Eye,
  Wifi,
  Users,
  Package,
  Shield,
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

const geocodeQueue: Array<{ resolve: (v: [number, number] | null) => void; city: string; state?: string }> = [];
let geocodeProcessing = false;

async function processGeocodeQueue(): Promise<void> {
  if (geocodeProcessing || geocodeQueue.length === 0) return;
  geocodeProcessing = true;
  while (geocodeQueue.length > 0) {
    const item = geocodeQueue.shift()!;
    try {
      const q = encodeURIComponent([item.city, item.state, "Brasil"].filter(Boolean).join(", "));
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=br`, {
        headers: { "Accept-Language": "pt-BR" },
      });
      const data = await res.json();
      if (data?.[0]?.lat && data?.[0]?.lon) {
        item.resolve([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
      } else {
        item.resolve(null);
      }
    } catch {
      item.resolve(null);
    }
    if (geocodeQueue.length > 0) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }
  geocodeProcessing = false;
}

function geocodeCity(city: string, state?: string): Promise<[number, number] | null> {
  if (!city) return Promise.resolve(null);
  return new Promise((resolve) => {
    geocodeQueue.push({ resolve, city, state });
    processGeocodeQueue();
  });
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
        zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
      }).setView(center, zoom);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(mapRef.current);
      markersRef.current = L.layerGroup().addTo(mapRef.current);
    }
    if (heatRef.current) { mapRef.current.removeLayer(heatRef.current); heatRef.current = null; }
    if (markersRef.current) markersRef.current.clearLayers();
    if (points.length > 0 && (L as any).heatLayer) {
      heatRef.current = (L as any).heatLayer(
        points.map(p => [p.lat, p.lng, p.weight]),
        { radius: 40, blur: 22, maxZoom: 14, gradient: { 0.2: "#1A4A2E", 0.5: "#B8860B", 0.75: "#c45a1a", 1.0: "#8B1A1A" }, minOpacity: 0.45 }
      ).addTo(mapRef.current);
    }
    if (markersRef.current) {
      for (const p of providerPoints) {
        const lat = parseFloat(p.latitude); const lng = parseFloat(p.longitude);
        if (isNaN(lat) || isNaN(lng)) continue;
        const icon = L.divIcon({ className: "", html: `<div style="width:6px;height:6px;background:#8B1A1A;border:1px solid #fff;border-radius:50%"></div>`, iconSize: [6, 6], iconAnchor: [3, 3] });
        const marker = L.marker([lat, lng], { icon });
        marker.bindTooltip(`${p.name} · ${p.city || ""}`, { permanent: false, direction: "top", offset: [0, -6] });
        markersRef.current.addLayer(marker);
      }
    }
    if (points.length > 1 && !defaultCenter) {
      const group = L.featureGroup(points.map(p => L.circleMarker([p.lat, p.lng], { radius: 0 })));
      mapRef.current?.fitBounds(group.getBounds().pad(0.2), { animate: false });
    }
  }, [points, providerPoints, defaultCenter, ready]);

  useEffect(() => { buildMap(); }, [buildMap]);

  useEffect(() => () => {
    if (mapRef.current) {
      try {
        const m = mapRef.current as any;
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
    <div className="relative rounded overflow-hidden border-[0.5px] border-[var(--color-border)]">
      <div ref={containerRef} style={{ height: "240px" }} className="w-full" data-testid="dashboard-heatmap" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-tag-bg)]/60">
          <RefreshCw className="w-5 h-5 animate-spin text-[var(--color-muted)]" />
        </div>
      )}
    </div>
  );
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DashboardPage() {
  const { provider, partnerCode } = useAuth();
  const [providerCenter, setProviderCenter] = useState<[number, number] | null>(null);

  const { data: stats, isLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"], staleTime: STALE_DASHBOARD });
  const { data: heatmapData = [] } = useQuery<any[]>({ queryKey: ["/api/heatmap/provider"], staleTime: STALE_DASHBOARD });

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
      label: "inadimplentes",
      value: isLoading ? null : stats?.defaulters ?? 0,
      sub: isLoading ? null : `${stats?.overdueInvoicesCount ?? 0} faturas em atraso`,
      color: "var(--color-danger)",
      colorBg: "var(--color-danger-bg)",
      testId: "card-defaulters",
    },
    {
      label: "total em aberto",
      value: isLoading ? null : `R$ ${fmt(Number(stats?.overdueTotal ?? 0))}`,
      sub: "valor acumulado inadimplente",
      color: "var(--color-gold)",
      colorBg: "var(--color-gold-bg)",
      testId: "card-overdue-total",
    },
    {
      label: "equipamentos retidos",
      value: isLoading ? null : stats?.unreturnedEquipmentCount ?? 0,
      sub: "nao devolvidos por inadimplentes",
      color: "var(--color-navy)",
      colorBg: "var(--color-navy-bg)",
      testId: "card-equipment-count",
    },
    {
      label: "valor em risco",
      value: isLoading ? null : `R$ ${fmt(Number(stats?.unreturnedEquipmentValue ?? 0))}`,
      sub: "valor dos equipamentos retidos",
      color: "var(--color-navy)",
      colorBg: "var(--color-navy-bg)",
      testId: "card-equipment-value",
    },
  ];

  return (
    <div className="p-4 lg:p-5 space-y-5 max-w-7xl mx-auto bg-[var(--color-bg)]" data-testid="dashboard-page">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-lg font-semibold text-[var(--color-ink)]" data-testid="text-dashboard-title">
            central de inadimplencia
          </h1>
          <p className="text-sm text-[var(--color-muted)]">{provider?.name}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Codigo do Provedor */}
          {partnerCode && (
          <div className="flex items-center gap-2 border border-[var(--color-success)] rounded-md px-3 py-2 bg-[var(--color-success-bg)]">
            <Shield className="w-4 h-4 text-[var(--color-success)] flex-shrink-0" />
            <div>
              <p className="font-mono text-sm font-bold text-[var(--color-success)] leading-none whitespace-nowrap" data-testid="text-partner-code">
                {partnerCode}
              </p>
              <p className="text-[10px] text-[var(--color-muted)] leading-tight mt-0.5">seu codigo</p>
            </div>
          </div>
          )}
          {/* Provedores parceiros */}
          <div className="flex items-center gap-2 border border-[var(--color-border)] rounded-md px-3 py-2 bg-[var(--color-surface)]">
            <Users className="w-4 h-4 text-[var(--color-steel)]" />
            <div className="text-right">
              <p className="font-mono text-lg font-bold text-[var(--color-ink)] leading-none" data-testid="text-partner-count">
                {stats?.partnerCount ?? "..."}
              </p>
              <p className="text-xs text-[var(--color-muted)] leading-tight">parceiros</p>
            </div>
          </div>
          {/* ISP Credits */}
          <div className="flex items-center gap-2 border border-[var(--color-border)] rounded-md px-3 py-2 bg-[var(--color-navy-bg)]">
            <CreditCard className="w-4 h-4 text-[var(--color-navy)]" />
            <div className="text-right">
              <p className="font-mono text-lg font-bold text-[var(--color-navy)] leading-none" data-testid="text-isp-credits">
                {stats?.ispCredits ?? "..."}
              </p>
              <p className="text-xs text-[var(--color-muted)] leading-tight">ISP</p>
            </div>
          </div>
          {/* SPC Credits */}
          <div className="flex items-center gap-2 border border-[var(--color-border)] rounded-md px-3 py-2 bg-[var(--color-gold-bg)]">
            <CreditCard className="w-4 h-4 text-[var(--color-gold)]" />
            <div className="text-right">
              <p className="font-mono text-lg font-bold text-[var(--color-gold)] leading-none" data-testid="text-spc-credits">
                {stats?.spcCredits ?? "..."}
              </p>
              <p className="text-xs text-[var(--color-muted)] leading-tight">SPC</p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <Card key={card.testId} className="p-4" data-testid={card.testId}>
            <span
              className="font-mono text-xs uppercase tracking-[0.08em]"
              style={{ color: "var(--color-muted)" }}
            >
              {card.label}
            </span>
            {card.value === null ? (
              <>
                <Skeleton className="h-7 w-24 mt-2 mb-1" />
                <Skeleton className="h-3 w-32" />
              </>
            ) : (
              <>
                <p
                  className="font-mono text-2xl font-medium mt-2"
                  style={{ color: card.color }}
                  data-testid={`value-${card.testId}`}
                >
                  {card.value}
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>{card.sub}</p>
              </>
            )}
          </Card>
        ))}
      </div>

      {/* Mapa de Calor */}
      <div>
        <div className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-muted)] mb-4 pb-2 border-b-[0.5px] border-[var(--color-border)]">
          mapa de calor
        </div>

        <Card className="overflow-hidden" data-testid="card-heatmap">
          <div className="flex items-center justify-between p-4 border-b-[0.5px] border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4" style={{ color: "var(--color-gold)" }} />
              <div>
                <span className="font-display text-sm font-semibold text-[var(--color-ink)]">Distribuicao de inadimplencia</span>
                <p className="text-xs text-[var(--color-muted)]">clientes em atraso por regiao</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-[var(--color-muted)]" data-testid="text-defaulter-count">
                {stats?.defaulters || 0} inadimplentes
              </span>
              <Link href="/mapa-calor">
                <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-view-full-map">
                  <ExternalLink className="w-3.5 h-3.5" />
                  ver mapa completo
                </Button>
              </Link>
            </div>
          </div>

          <div className="p-4">
            {heatPoints.length === 0 ? (
              <div className="rounded border-[0.5px] border-dashed border-[var(--color-border)] p-10 flex flex-col items-center justify-center text-center gap-2 bg-[var(--color-bg)]">
                <MapPin className="w-6 h-6 text-[var(--color-muted)]" style={{ opacity: 0.4 }} />
                <p className="text-sm font-body text-[var(--color-muted)]">Nenhum ponto de calor disponivel</p>
                <p className="text-xs text-[var(--color-muted)]" style={{ opacity: 0.6 }}>Cadastre coordenadas nos clientes inadimplentes para visualizar o mapa.</p>
              </div>
            ) : (
              <>
                <MiniHeatMap
                  key={`dash-${heatPoints.length}-${providerCenter?.[0]}`}
                  points={heatPoints}
                  providerPoints={heatmapData}
                  defaultCenter={providerCenter}
                />
                <div className="mt-3 flex items-center gap-4 text-xs font-mono text-[var(--color-muted)] border-t-[0.5px] border-[var(--color-border)] pt-3">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex gap-px">
                      <span className="w-3 h-1 rounded-sm" style={{ background: "var(--color-success)" }} />
                      <span className="w-3 h-1 rounded-sm" style={{ background: "var(--color-gold)" }} />
                      <span className="w-3 h-1 rounded-sm" style={{ background: "#c45a1a" }} />
                      <span className="w-3 h-1 rounded-sm" style={{ background: "var(--color-danger)" }} />
                    </span>
                    baixo → critico
                  </div>
                  <span>{heatPoints.length} pontos</span>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
