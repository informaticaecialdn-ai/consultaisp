import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  MapPin,
  BarChart3,
  AlertTriangle,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type CepRanking = {
  cep5: string;
  city: string;
  count: number;
  totalOverdue: number;
  avgDaysOverdue: number;
  riskLevel: string;
};

type TrendPoint = {
  month: string;
  count: number;
  totalOverdue: number;
};

type MapPoint = {
  lat: number;
  lng: number;
  cep5: string;
  city: string;
  count: number;
  totalOverdue: number;
  riskLevel: string;
};

type DefaulterPoint = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  cep: string | null;
  city: string | null;
  address: string | null;
  totalOverdue: number;
  daysOverdue: number;
  riskTier: string;
};

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const riskColor: Record<string, string> = {
  critico: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  alto: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  medio: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  baixo: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

export default function BenchmarkRegionalPage() {
  const { data: ranking = [], isLoading: rankingLoading } = useQuery<CepRanking[]>({
    queryKey: ["/api/benchmark/cep-ranking"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: trend = [], isLoading: trendLoading } = useQuery<TrendPoint[]>({
    queryKey: ["/api/benchmark/trend"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: mapPoints = [] } = useQuery<MapPoint[]>({
    queryKey: ["/api/benchmark/map-points"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: defaulters = [] } = useQuery<DefaulterPoint[]>({
    queryKey: ["/api/benchmark/defaulters-map"],
    staleTime: 5 * 60 * 1000,
  });

  const trendDirection =
    trend.length >= 2 && trend[trend.length - 1].count > trend[trend.length - 2].count
      ? "up"
      : trend.length >= 2 && trend[trend.length - 1].count < trend[trend.length - 2].count
      ? "down"
      : "stable";

  const totalInadimplentes = ranking.reduce((s, r) => s + r.count, 0);
  const totalValor = ranking.reduce((s, r) => s + r.totalOverdue, 0);

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Meus Dados — Análise de Inadimplência</h1>
        <p className="text-sm text-muted-foreground">
          Visão analítica da sua base de inadimplentes: concentração geográfica, tendência e ranking por CEP
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Meus Inadimplentes</p>
          <p className="text-3xl font-bold mt-2 text-[var(--color-danger)]">{totalInadimplentes}</p>
          <p className="text-xs text-muted-foreground mt-1">clientes em atraso</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Valor em Aberto</p>
          <p className="text-3xl font-bold mt-2 text-[var(--color-danger)]">R$ {fmt(totalValor)}</p>
          <p className="text-xs text-muted-foreground mt-1">total pendente</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">CEPs Afetados</p>
          <p className="text-3xl font-bold mt-2">{ranking.length}</p>
          <p className="text-xs text-muted-foreground mt-1">regiões com inadimplência</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Tendência</p>
          <div className="flex items-center gap-2 mt-2">
            {trendDirection === "up" ? (
              <TrendingUp className="w-7 h-7 text-[var(--color-danger)]" />
            ) : trendDirection === "down" ? (
              <TrendingDown className="w-7 h-7 text-[var(--color-success)]" />
            ) : (
              <BarChart3 className="w-7 h-7 text-muted-foreground" />
            )}
            <span className="text-2xl font-bold">
              {trendDirection === "up" ? "Subindo" : trendDirection === "down" ? "Descendo" : "Estável"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">vs mês anterior</p>
        </Card>
      </div>

      {/* Tendencia 6 meses */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-[var(--color-navy)]" />
          <h2 className="font-semibold text-base">Minha Inadimplência — Últimos 6 Meses</h2>
        </div>
        {trendLoading ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground">Carregando...</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number, name: string) => [name === "count" ? value : `R$ ${fmt(value)}`, name === "count" ? "Inadimplentes" : "Valor"]} />
              <Line yAxisId="left" type="monotone" dataKey="count" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} name="Inadimplentes" />
              <Line yAxisId="right" type="monotone" dataKey="totalOverdue" stroke="#f97316" strokeWidth={2} dot={{ r: 4 }} name="Valor" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Ranking de CEPs */}
      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-[var(--color-gold)]" />
          <h2 className="font-semibold text-base">Ranking de CEPs — Meus Inadimplentes</h2>
          <span className="ml-auto text-sm text-muted-foreground">{ranking.length} CEPs</span>
        </div>
        {rankingLoading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando...</div>
        ) : ranking.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">Nenhum inadimplente cadastrado ainda. Sincronize com seu ERP ou importe via CSV para começar.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">CEP</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Cidade</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Inadimplentes</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Valor Total</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Media Atraso</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Risco</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {ranking.slice(0, 30).map((row) => (
                  <tr key={row.cep5} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-sm">{row.cep5}-000</td>
                    <td className="px-4 py-3 text-sm">{row.city || "—"}</td>
                    <td className="px-4 py-3 font-bold text-base">{row.count}</td>
                    <td className="px-4 py-3 font-semibold text-sm">R$ {fmt(row.totalOverdue)}</td>
                    <td className="px-4 py-3 text-sm">{row.avgDaysOverdue}d</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-xs ${riskColor[row.riskLevel] || ""}`}>
                        {row.riskLevel}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Mapa de inadimplentes individuais */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="w-5 h-5 text-[var(--color-navy)]" />
          <h2 className="font-semibold text-base">Mapa dos Meus Inadimplentes</h2>
          <span className="ml-auto text-sm text-muted-foreground">{defaulters.length} clientes plotados</span>
        </div>
        <DefaultersMap points={defaulters} />
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500" /> Até 30 dias</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500" /> 31-60 dias</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-orange-500" /> 61-90 dias</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500" /> +90 dias (crítico)</span>
        </div>
      </Card>
    </div>
  );
}

function BenchmarkMap({ points }: { points: MapPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: { type: "raster", tiles: ["/api/tiles/{z}/{x}/{y}.png"], tileSize: 256, attribution: "&copy; OpenStreetMap" },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-51.0, -23.3],
      zoom: 8,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-left");
    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapRef.current || points.length === 0) return;
    const map = mapRef.current;

    const addPoints = () => {
      if (map.getSource("risk-points")) {
        (map.getSource("risk-points") as any).setData({
          type: "FeatureCollection",
          features: points.map((p) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [p.lng, p.lat] },
            properties: { count: p.count, riskLevel: p.riskLevel, city: p.city, cep5: p.cep5, totalOverdue: p.totalOverdue },
          })),
        });
        return;
      }

      map.addSource("risk-points", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: points.map((p) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [p.lng, p.lat] },
            properties: { count: p.count, riskLevel: p.riskLevel, city: p.city, cep5: p.cep5, totalOverdue: p.totalOverdue },
          })),
        },
      });

      map.addLayer({
        id: "risk-circles",
        type: "circle",
        source: "risk-points",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 6, 5, 12, 10, 18, 20, 28],
          "circle-color": [
            "match", ["get", "riskLevel"],
            "critico", "#ef4444",
            "alto", "#f97316",
            "medio", "#eab308",
            "baixo", "#22c55e",
            "#999",
          ],
          "circle-opacity": 0.7,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#fff",
        },
      });

      map.on("click", "risk-circles", (e) => {
        if (!e.features?.[0]) return;
        const p = e.features[0].properties!;
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(`<strong>${p.cep5}-000</strong> ${p.city}<br/>${p.count} inadimplentes<br/>R$ ${Number(p.totalOverdue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`)
          .addTo(map);
      });

      map.on("mouseenter", "risk-circles", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "risk-circles", () => { map.getCanvas().style.cursor = ""; });

      if (points.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        points.forEach((p) => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: 40, maxZoom: 12 });
      }
    };

    if (map.loaded()) addPoints();
    else map.on("load", addPoints);
  }, [points]);

  return <div ref={containerRef} style={{ height: 400 }} className="w-full rounded-lg border" />;
}

function DefaultersMap({ points }: { points: DefaulterPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: { type: "raster", tiles: ["/api/tiles/{z}/{x}/{y}.png"], tileSize: 256, attribution: "&copy; OpenStreetMap" },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-51.0, -23.3],
      zoom: 8,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-left");
    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapRef.current || points.length === 0) return;
    const map = mapRef.current;

    const addPoints = () => {
      const features = points.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          name: p.name,
          cep: p.cep || "",
          city: p.city || "",
          address: p.address || "",
          totalOverdue: p.totalOverdue,
          daysOverdue: p.daysOverdue,
          riskTier: p.riskTier,
        },
      }));

      if (map.getSource("defaulters")) {
        (map.getSource("defaulters") as any).setData({ type: "FeatureCollection", features });
        return;
      }

      map.addSource("defaulters", {
        type: "geojson",
        data: { type: "FeatureCollection", features },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 40,
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "defaulters",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": ["step", ["get", "point_count"], "#3b82f6", 10, "#f59e0b", 50, "#ef4444"],
          "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 50, 32],
          "circle-opacity": 0.85,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "defaulters",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-size": 14,
        },
        paint: {
          "text-color": "#fff",
        },
      });

      map.addLayer({
        id: "defaulter-points",
        type: "circle",
        source: "defaulters",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match", ["get", "riskTier"],
            "critico", "#ef4444",
            "alto", "#f97316",
            "medio", "#f59e0b",
            "baixo", "#22c55e",
            "#6b7280",
          ],
          "circle-radius": 8,
          "circle-opacity": 0.85,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      map.on("click", "clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        const clusterId = features[0].properties!.cluster_id;
        (map.getSource("defaulters") as any).getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
          if (err) return;
          map.easeTo({ center: (features[0].geometry as any).coordinates, zoom });
        });
      });

      map.on("click", "defaulter-points", (e) => {
        if (!e.features?.[0]) return;
        const p = e.features[0].properties!;
        const coords = (e.features[0].geometry as any).coordinates.slice();
        const value = Number(p.totalOverdue).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
        new maplibregl.Popup()
          .setLngLat(coords)
          .setHTML(`
            <div style="font-size: 13px; line-height: 1.5;">
              <strong style="font-size: 14px;">${p.name}</strong><br/>
              ${p.address ? `<span style="color: #666;">${p.address}</span><br/>` : ""}
              ${p.cep ? `<span style="color: #666;">${p.cep} - ${p.city}</span><br/>` : ""}
              <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #eee;">
                <strong style="color: #dc2626;">R$ ${value}</strong><br/>
                <span style="color: #666;">${p.daysOverdue} dias em atraso</span>
              </div>
            </div>
          `)
          .addTo(map);
      });

      map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "defaulter-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "defaulter-points", () => { map.getCanvas().style.cursor = ""; });

      if (points.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        points.forEach((p) => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: 40, maxZoom: 13 });
      } else if (points.length === 1) {
        map.setCenter([points[0].lng, points[0].lat]);
        map.setZoom(14);
      }
    };

    if (map.loaded()) addPoints();
    else map.on("load", addPoints);
  }, [points]);

  return <div ref={containerRef} style={{ height: 500 }} className="w-full rounded-lg border" />;
}
