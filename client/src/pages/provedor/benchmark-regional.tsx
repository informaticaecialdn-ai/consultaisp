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

type NeighborhoodStat = {
  city: string;
  neighborhood: string;
  total: number;
  overdue: number;
  pct: number;
  totalOverdue: number;
  avgDaysOverdue: number;
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

  const { data: neighborhoodStats = [] } = useQuery<NeighborhoodStat[]>({
    queryKey: ["/api/benchmark/neighborhood-stats"],
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
          Visão analítica da sua base de inadimplentes: concentração geográfica, tendência e ranking por bairro
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
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Bairros Afetados</p>
          <p className="text-3xl font-bold mt-2">{ranking.length}</p>
          <p className="text-xs text-muted-foreground mt-1">bairros com inadimplência</p>
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

      {/* Ranking por Cidade + Bairro */}
      {rankingLoading ? (
        <Card className="p-8 text-center text-muted-foreground">Carregando...</Card>
      ) : ranking.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">Nenhum inadimplente cadastrado ainda. Sincronize com seu ERP ou importe via CSV para começar.</Card>
      ) : (
        <CityRankingCards ranking={ranking} stats={neighborhoodStats} />
      )}

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

function CityRankingCards({ ranking, stats }: { ranking: CepRanking[]; stats: NeighborhoodStat[] }) {
  // Se stats veio do novo endpoint, usa ele (tem total+overdue+pct). Senao fallback pro ranking antigo.
  const useStats = stats.length > 0;

  // Agrupar por cidade
  const cityGroups = new Map<string, {
    bairros: Array<{ name: string; total: number; overdue: number; pct: number; totalOverdue: number; avgDays: number }>;
    totalClients: number; totalOverdue: number; totalOverdueAmount: number; avgDays: number;
  }>();

  if (useStats) {
    for (const s of stats) {
      const existing = cityGroups.get(s.city);
      const bairro = { name: s.neighborhood, total: s.total, overdue: s.overdue, pct: s.pct, totalOverdue: s.totalOverdue, avgDays: s.avgDaysOverdue };
      if (existing) {
        existing.bairros.push(bairro);
        existing.totalClients += s.total;
        existing.totalOverdue += s.overdue;
        existing.totalOverdueAmount += s.totalOverdue;
      } else {
        cityGroups.set(s.city, {
          bairros: [bairro],
          totalClients: s.total,
          totalOverdue: s.overdue,
          totalOverdueAmount: s.totalOverdue,
          avgDays: s.avgDaysOverdue,
        });
      }
    }
  } else {
    for (const row of ranking) {
      const parts = row.city.split(" — ");
      const cityName = parts[0] || "Sem cidade";
      const bairroName = parts[1] || "Sem bairro";
      const existing = cityGroups.get(cityName);
      const bairro = { name: bairroName, total: row.count, overdue: row.count, pct: 100, totalOverdue: row.totalOverdue, avgDays: row.avgDaysOverdue };
      if (existing) {
        existing.bairros.push(bairro);
        existing.totalClients += row.count;
        existing.totalOverdue += row.count;
        existing.totalOverdueAmount += row.totalOverdue;
      } else {
        cityGroups.set(cityName, {
          bairros: [bairro],
          totalClients: row.count,
          totalOverdue: row.count,
          totalOverdueAmount: row.totalOverdue,
          avgDays: row.avgDaysOverdue,
        });
      }
    }
  }

  const sortedCities = Array.from(cityGroups.entries()).sort((a, b) => b[1].totalOverdue - a[1].totalOverdue);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <MapPin className="w-5 h-5 text-[var(--color-navy)]" />
        <h2 className="font-semibold text-lg">Inadimplencia por Cidade</h2>
        <span className="ml-auto text-sm text-muted-foreground">{sortedCities.length} cidades</span>
      </div>

      <div className="space-y-4">
        {sortedCities.map(([cityName, data]) => {
          const cityPct = data.totalClients > 0 ? Math.round((data.totalOverdue / data.totalClients) * 100) : 0;
          const cityRisk = cityPct >= 60 ? "critico" : cityPct >= 30 ? "alto" : cityPct >= 10 ? "medio" : "baixo";
          const barColor = cityRisk === "critico" ? "bg-red-500" : cityRisk === "alto" ? "bg-orange-500" : cityRisk === "medio" ? "bg-amber-500" : "bg-green-500";

          return (
            <Card key={cityName} className="overflow-hidden">
              <div className="px-5 pt-4 pb-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-3 h-3 rounded-full shrink-0 ${barColor}`} />
                    <h3 className="font-bold text-base truncate">{cityName}</h3>
                    <Badge className={`text-[10px] shrink-0 ${riskColor[cityRisk] || ""}`}>{cityRisk}</Badge>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 text-right flex-wrap">
                    {useStats && (
                      <div>
                        <p className="text-lg font-bold">{data.totalClients.toLocaleString("pt-BR")}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">total clientes</p>
                      </div>
                    )}
                    <div>
                      <p className="text-lg font-bold text-[var(--color-danger)]">{data.totalOverdue.toLocaleString("pt-BR")}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">inadimplentes</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-[var(--color-danger)]">{cityPct}%</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">inadimplencia</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold">R$ {fmt(data.totalOverdueAmount)}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">em aberto</p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.max(cityPct, 2)}%` }} />
                  </div>
                  <span className="text-xs font-semibold w-12 text-right">{cityPct}%</span>
                </div>
              </div>

              <div className="border-t max-h-[280px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/30 sticky top-0 z-10">
                      <th className="text-left pl-5 pr-2 py-2 text-muted-foreground font-medium">Bairro</th>
                      {useStats && <th className="text-right px-2 py-2 text-muted-foreground font-medium">Total</th>}
                      <th className="text-right px-2 py-2 text-muted-foreground font-medium">Inadimpl.</th>
                      <th className="text-right px-2 py-2 text-muted-foreground font-medium">%</th>
                      <th className="text-right px-2 py-2 text-muted-foreground font-medium hidden sm:table-cell">Valor</th>
                      <th className="text-left px-2 pr-5 py-2 text-muted-foreground font-medium w-28">Inadimplencia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {data.bairros.sort((a, b) => b.overdue - a.overdue).map((b, i) => {
                      const pctColor = b.pct >= 60 ? "text-red-600" : b.pct >= 30 ? "text-orange-600" : b.pct >= 10 ? "text-amber-600" : "text-green-600";
                      const pctBar = b.pct >= 60 ? "bg-red-500" : b.pct >= 30 ? "bg-orange-500" : b.pct >= 10 ? "bg-amber-500" : "bg-green-500";
                      return (
                        <tr key={i} className="hover:bg-muted/10 transition-colors">
                          <td className="pl-5 pr-2 py-2 text-sm">{b.name}</td>
                          {useStats && <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{b.total}</td>}
                          <td className="px-2 py-2 text-right font-semibold tabular-nums">{b.overdue}</td>
                          <td className={`px-2 py-2 text-right font-bold tabular-nums ${pctColor}`}>{b.pct}%</td>
                          <td className="px-2 py-2 text-right text-muted-foreground hidden sm:table-cell">R$ {fmt(b.totalOverdue)}</td>
                          <td className="px-2 pr-5 py-2">
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${pctBar}`} style={{ width: `${Math.max(b.pct, 3)}%` }} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>
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
