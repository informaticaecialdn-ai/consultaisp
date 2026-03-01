import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
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
  TrendingDown,
  TrendingUp,
  MapPin,
  Flame,
  ExternalLink,
  Eye,
  RefreshCw,
  CreditCard,
  CheckCircle2,
  Clock,
  Zap,
  ChevronRight,
  Activity,
  Package,
  BarChart3,
} from "lucide-react";

// ─── Leaflet Heat Map ─────────────────────────────────────────────────────────

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

function MiniHeatMap({ points, providerPoints, defaultCenter }: {
  points: HeatPoint[];
  providerPoints: any[];
  defaultCenter?: [number, number] | null;
}) {
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
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:8px;height:8px;background:#ef4444;border:1.5px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>`,
          iconSize: [8, 8], iconAnchor: [4, 4],
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
    if (mapRef.current) {
      try {
        const m = mapRef.current as any;
        m._onZoomTransitionEnd = () => {};
        m._onZoomAnim = () => {};
        m.off(); m.stop(); m.remove();
      } catch {}
      mapRef.current = null; heatRef.current = null; markersRef.current = null;
    }
  }, []);

  return (
    <div className="relative rounded-xl overflow-hidden border border-border" data-testid="dashboard-heatmap">
      <div ref={containerRef} style={{ height: "240px" }} className="w-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/60">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function RiskBadge({ tier }: { tier: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    critical: { label: "Crítico", cls: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400" },
    high:     { label: "Alto",    cls: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400" },
    medium:   { label: "Médio",   cls: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400" },
    low:      { label: "Baixo",   cls: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400" },
  };
  const { label, cls } = map[tier] ?? map.low;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>;
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { provider } = useAuth();
  const [providerCenter, setProviderCenter] = useState<[number, number] | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: heatmapData = [] } = useQuery<any[]>({ queryKey: ["/api/heatmap/provider"] });
  const { data: defaultersRaw = [], isLoading: defLoading } = useQuery<any[]>({ queryKey: ["/api/defaulters"] });

  useEffect(() => {
    const city = provider?.addressCity || "";
    const state = provider?.addressState || "";
    if (city) {
      geocodeCity(city, state).then(c => { if (c) setProviderCenter(c); });
      return;
    }
    if (heatmapData.length > 0) {
      const top = [...heatmapData].sort((a, b) => parseFloat(b.totalOverdueAmount || "0") - parseFloat(a.totalOverdueAmount || "0"))[0];
      const lat = parseFloat(top.latitude); const lng = parseFloat(top.longitude);
      if (!isNaN(lat) && !isNaN(lng)) setProviderCenter([lat, lng]);
    }
  }, [provider?.addressCity, provider?.addressState, heatmapData]);

  // ─ Computed metrics ─────────────────────────────────────────────────────────
  const totalCustomers = stats?.totalCustomers || 0;
  const overdueTotal = Number(stats?.overdueTotal || 0);
  const monthlyRevenue = Number(stats?.monthlyRevenue || 0);
  const equipmentValue = Number(stats?.equipmentValue || 0);
  const ispCredits = stats?.ispCredits ?? 0;
  const spcCredits = stats?.spcCredits ?? 0;

  // Unique defaulters from heatmap (one entry per customer)
  const uniqueDefaulters = heatmapData.length;
  const defaulterRate = totalCustomers > 0 ? (uniqueDefaulters / totalCustomers) * 100 : 0;

  // Risk tier breakdown
  const riskBreakdown = {
    critical: heatmapData.filter(c => c.riskTier === "critical"),
    high:     heatmapData.filter(c => c.riskTier === "high"),
    medium:   heatmapData.filter(c => c.riskTier === "medium"),
    low:      heatmapData.filter(c => c.riskTier === "low"),
  };

  // Top defaulters by value (max 7)
  const topDefaulters = [...heatmapData]
    .sort((a, b) => parseFloat(b.totalOverdueAmount || "0") - parseFloat(a.totalOverdueAmount || "0"))
    .slice(0, 7);

  // Heat map points
  const heatPoints: HeatPoint[] = heatmapData
    .map(p => ({
      lat: parseFloat(p.latitude), lng: parseFloat(p.longitude),
      weight: Math.max(0.2, ((p.maxDaysOverdue || 0) / 90) + (parseFloat(p.totalOverdueAmount || "0") / 500)),
    }))
    .filter(p => !isNaN(p.lat) && !isNaN(p.lng));

  // Active clients (non-defaulters)
  const activeClients = Math.max(0, totalCustomers - uniqueDefaulters);

  // Invoices agrupados por período de atraso
  const getDaysOverdue = (dueDate: string) => {
    const due = new Date(dueDate);
    const now = new Date();
    return Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86400000));
  };
  const invoicesByPeriod = {
    d90plus: defaultersRaw.filter(d => getDaysOverdue(d.dueDate) > 90).length,
    d60to90: defaultersRaw.filter(d => { const x = getDaysOverdue(d.dueDate); return x > 60 && x <= 90; }).length,
    d30to60: defaultersRaw.filter(d => { const x = getDaysOverdue(d.dueDate); return x > 30 && x <= 60; }).length,
    d0to30:  defaultersRaw.filter(d => getDaysOverdue(d.dueDate) <= 30).length,
  };
  const totalInvoices = defaultersRaw.length;

  const isLoading = statsLoading || defLoading;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="dashboard-page">

      {/* ─── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">
            Painel de Controle
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {provider?.name} — visão geral da base de clientes e inadimplência
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className="bg-blue-600 hover:bg-blue-700 text-white border-0 gap-1.5 px-3 py-1.5 text-xs font-medium">
            <CreditCard className="w-3.5 h-3.5" />
            ISP {ispCredits} créditos
          </Badge>
          <Badge className="bg-rose-600 hover:bg-rose-700 text-white border-0 gap-1.5 px-3 py-1.5 text-xs font-medium">
            <CreditCard className="w-3.5 h-3.5" />
            SPC {spcCredits} créditos
          </Badge>
        </div>
      </div>

      {/* ─── KPI cards ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Clientes */}
        <Card className="p-4 border-l-4 border-l-blue-500" data-testid="card-total-clients">
          {isLoading ? <KpiSkeleton /> : (
            <>
              <div className="flex items-start justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Clientes</p>
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center">
                  <Users className="w-4 h-4 text-blue-600" />
                </div>
              </div>
              <p className="text-3xl font-bold mt-2 tabular-nums" data-testid="text-total-clients">{totalCustomers}</p>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                {activeClients} em dia
              </p>
            </>
          )}
        </Card>

        {/* Inadimplentes */}
        <Card className="p-4 border-l-4 border-l-rose-500" data-testid="card-defaulters">
          {isLoading ? <KpiSkeleton /> : (
            <>
              <div className="flex items-start justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Inadimplentes</p>
                <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                </div>
              </div>
              <p className="text-3xl font-bold mt-2 tabular-nums text-rose-600">{uniqueDefaulters}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {defaultersRaw.length} fatura{defaultersRaw.length !== 1 ? "s" : ""} em atraso
              </p>
            </>
          )}
        </Card>

        {/* Taxa */}
        <Card className="p-4 border-l-4 border-l-orange-500" data-testid="card-default-rate">
          {isLoading ? <KpiSkeleton /> : (
            <>
              <div className="flex items-start justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Taxa Inad.</p>
                <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-950/40 flex items-center justify-center">
                  <TrendingDown className="w-4 h-4 text-orange-600" />
                </div>
              </div>
              <p className="text-3xl font-bold mt-2 tabular-nums text-orange-600">
                {defaulterRate.toFixed(1)}%
              </p>
              <Progress value={Math.min(100, defaulterRate)} className="mt-2 h-1.5" />
            </>
          )}
        </Card>

        {/* Em atraso */}
        <Card className="p-4 border-l-4 border-l-amber-500" data-testid="card-overdue">
          {isLoading ? <KpiSkeleton /> : (
            <>
              <div className="flex items-start justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Em Atraso</p>
                <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-amber-600" />
                </div>
              </div>
              <p className="text-2xl font-bold mt-2 tabular-nums" data-testid="text-overdue-total">
                R$ {fmt(overdueTotal)}
              </p>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <TrendingDown className="w-3 h-3 text-rose-500" />
                a recuperar
              </p>
            </>
          )}
        </Card>

        {/* Receita do mês */}
        <Card className="p-4 border-l-4 border-l-emerald-500" data-testid="card-monthly-revenue">
          {isLoading ? <KpiSkeleton /> : (
            <>
              <div className="flex items-start justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Receita Mês</p>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                </div>
              </div>
              <p className="text-2xl font-bold mt-2 tabular-nums text-emerald-600" data-testid="text-monthly-revenue">
                R$ {fmt(monthlyRevenue)}
              </p>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                faturas pagas
              </p>
            </>
          )}
        </Card>
      </div>

      {/* ─── Middle section: Top defaulters + Risk breakdown ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Top inadimplentes */}
        <Card className="lg:col-span-3 p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
              </div>
              <h2 className="font-semibold text-sm">Maiores Devedores</h2>
            </div>
            <Link href="/inadimplentes">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7 px-2" data-testid="link-view-all-defaulters">
                Ver todos <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
          {defLoading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : topDefaulters.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center px-4">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3" />
              <p className="font-medium text-sm">Sem inadimplentes</p>
              <p className="text-xs text-muted-foreground mt-1">Todos os clientes estão em dia</p>
            </div>
          ) : (
            <div className="divide-y">
              {topDefaulters.map((d, i) => {
                const amount = parseFloat(d.totalOverdueAmount || "0");
                const maxAmount = parseFloat(topDefaulters[0].totalOverdueAmount || "1");
                return (
                  <div key={d.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors" data-testid={`defaulter-row-${d.id}`}>
                    <span className="w-5 text-xs font-mono text-muted-foreground text-right flex-shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{d.name}</p>
                        <RiskBadge tier={d.riskTier} />
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-rose-500"
                            style={{ width: `${Math.min(100, (amount / maxAmount) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {d.city || "—"}
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-semibold text-sm tabular-nums">R$ {fmt(amount)}</p>
                      <p className="text-xs text-muted-foreground">{d.maxDaysOverdue || 0} dias</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Distribuição de Risco + Período */}
        <div className="lg:col-span-2 space-y-4">

          {/* Risco por Tier */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-orange-50 dark:bg-orange-950/40 flex items-center justify-center">
                <Activity className="w-4 h-4 text-orange-600" />
              </div>
              <h2 className="font-semibold text-sm">Distribuição de Risco</h2>
            </div>
            {defLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : uniqueDefaulters === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Sem dados de risco</p>
            ) : (
              <div className="space-y-3">
                {[
                  { key: "critical", label: "Crítico", desc: "90+ dias",  color: "bg-rose-500",   bg: "bg-rose-50 dark:bg-rose-950/30", text: "text-rose-700 dark:text-rose-400" },
                  { key: "high",     label: "Alto",    desc: "60–90 dias", color: "bg-orange-500", bg: "bg-orange-50 dark:bg-orange-950/30", text: "text-orange-700 dark:text-orange-400" },
                  { key: "medium",   label: "Médio",   desc: "30–60 dias", color: "bg-amber-500",  bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-400" },
                  { key: "low",      label: "Baixo",   desc: "até 30 dias", color: "bg-blue-500",  bg: "bg-blue-50 dark:bg-blue-950/30", text: "text-blue-700 dark:text-blue-400" },
                ].map(({ key, label, desc, color, bg, text }) => {
                  const count = riskBreakdown[key as keyof typeof riskBreakdown].length;
                  const pct = uniqueDefaulters > 0 ? Math.round((count / uniqueDefaulters) * 100) : 0;
                  return (
                    <div key={key} className={`rounded-lg p-3 ${bg}`} data-testid={`risk-tier-${key}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div>
                          <span className={`text-xs font-semibold ${text}`}>{label}</span>
                          <span className="text-xs text-muted-foreground ml-1.5">{desc}</span>
                        </div>
                        <span className="text-sm font-bold tabular-nums">{count}</span>
                      </div>
                      <div className="h-1.5 bg-white/60 dark:bg-black/20 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Faturas por período */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center">
                <Clock className="w-4 h-4 text-indigo-600" />
              </div>
              <h2 className="font-semibold text-sm">Faturas por Período</h2>
            </div>
            {defLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { label: "+ 90 dias", count: invoicesByPeriod.d90plus, color: "bg-rose-500" },
                  { label: "60 – 90",   count: invoicesByPeriod.d60to90, color: "bg-orange-500" },
                  { label: "30 – 60",   count: invoicesByPeriod.d30to60, color: "bg-amber-500" },
                  { label: "0 – 30",    count: invoicesByPeriod.d0to30,  color: "bg-blue-400" },
                ].map(({ label, count, color }) => (
                  <div key={label} className="flex items-center gap-2 text-xs">
                    <span className="w-16 text-muted-foreground shrink-0">{label}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${color}`}
                        style={{ width: totalInvoices > 0 ? `${Math.min(100, (count / totalInvoices) * 100)}%` : "0%" }}
                      />
                    </div>
                    <span className="w-5 text-right font-semibold tabular-nums">{count}</span>
                  </div>
                ))}
                {totalInvoices === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">Nenhuma fatura em atraso</p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ─── Mapa de Calor ───────────────────────────────────────────────────── */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-orange-50 dark:bg-orange-950/40 flex items-center justify-center">
              <Flame className="w-4 h-4 text-orange-600" />
            </div>
            <div>
              <h2 className="font-semibold text-sm">Mapa de Calor de Inadimplência</h2>
              <p className="text-xs text-muted-foreground">Distribuição geográfica dos clientes em atraso</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" data-testid="text-defaulter-count">
              {heatPoints.length} pontos
            </span>
            <Link href="/mapa-calor">
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" data-testid="button-view-full-map">
                <ExternalLink className="w-3.5 h-3.5" />
                Mapa completo
              </Button>
            </Link>
          </div>
        </div>

        <div className="p-4">
          {heatPoints.length === 0 ? (
            <div className="bg-muted/30 rounded-xl border border-dashed p-10 flex flex-col items-center justify-center text-center gap-2">
              <Eye className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">Nenhum ponto georreferenciado</p>
              <p className="text-xs text-muted-foreground/70">Adicione latitude e longitude nos cadastros de clientes para ativar o mapa.</p>
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
                  Baixo → Crítico
                </div>
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3 h-3" />
                  {heatPoints.length} cliente{heatPoints.length !== 1 ? "s" : ""} visualizados
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* ─── Visão Base de Clientes ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Clientes Adimplentes</p>
            {isLoading ? <Skeleton className="h-8 w-16 mt-1" /> : (
              <p className="text-2xl font-bold mt-0.5 tabular-nums">{activeClients}</p>
            )}
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-950/30 flex items-center justify-center flex-shrink-0">
            <Package className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Equipamentos (Valor)</p>
            {isLoading ? <Skeleton className="h-8 w-24 mt-1" /> : (
              <p className="text-2xl font-bold mt-0.5 tabular-nums">R$ {fmt(equipmentValue)}</p>
            )}
            <p className="text-xs text-muted-foreground">{stats?.totalEquipment || 0} unidades</p>
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-sky-50 dark:bg-sky-950/30 flex items-center justify-center flex-shrink-0">
            <BarChart3 className="w-6 h-6 text-sky-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Ticket Médio Atraso</p>
            {isLoading ? <Skeleton className="h-8 w-24 mt-1" /> : (
              <p className="text-2xl font-bold mt-0.5 tabular-nums">
                R$ {uniqueDefaulters > 0 ? fmt(overdueTotal / uniqueDefaulters) : "0,00"}
              </p>
            )}
            <p className="text-xs text-muted-foreground">por cliente inadimplente</p>
          </div>
        </Card>
      </div>

      {/* ─── Ações Rápidas ────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-amber-500" />
          <h2 className="font-semibold text-sm">Ações Rápidas</h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { href: "/consulta-isp",  icon: Search,     color: "bg-blue-50 dark:bg-blue-950/30",    iconColor: "text-blue-600",   label: "Consultar ISP",    sub: "Banco compartilhado" },
            { href: "/anti-fraude",   icon: ShieldAlert, color: "bg-rose-50 dark:bg-rose-950/30",   iconColor: "text-rose-600",   label: "Anti-Fraude",       sub: "Verificação de risco" },
            { href: "/inadimplentes", icon: AlertTriangle, color: "bg-orange-50 dark:bg-orange-950/30", iconColor: "text-orange-600", label: "Inadimplentes",  sub: `${uniqueDefaulters} clientes` },
            { href: "/mapa-calor",    icon: MapPin,     color: "bg-emerald-50 dark:bg-emerald-950/30", iconColor: "text-emerald-600", label: "Mapa de Calor", sub: "Distribuição geográfica" },
          ].map(({ href, icon: Icon, color, iconColor, label, sub }) => (
            <Link key={href} href={href}>
              <Card className="p-4 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 group" data-testid={`link-${label.toLowerCase().replace(/\s/g, "-")}`}>
                <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center mb-3`}>
                  <Icon className={`w-5 h-5 ${iconColor}`} />
                </div>
                <p className="font-semibold text-sm">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 mt-2 group-hover:text-muted-foreground transition-colors" />
              </Card>
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-24 mt-2" />
      <Skeleton className="h-3 w-28" />
    </div>
  );
}
