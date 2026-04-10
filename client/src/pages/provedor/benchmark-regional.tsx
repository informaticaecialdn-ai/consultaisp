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
        <h1 className="text-xl font-bold">Benchmark Regional</h1>
        <p className="text-sm text-muted-foreground">
          Analise de inadimplencia por regiao — dados da rede de provedores
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Inadimplentes na Rede</p>
          <p className="text-2xl font-bold mt-1">{totalInadimplentes}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Valor em Aberto</p>
          <p className="text-2xl font-bold mt-1">R$ {fmt(totalValor)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase">CEPs com Risco</p>
          <p className="text-2xl font-bold mt-1">{ranking.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Tendencia</p>
          <div className="flex items-center gap-2 mt-1">
            {trendDirection === "up" ? (
              <TrendingUp className="w-5 h-5 text-red-500" />
            ) : trendDirection === "down" ? (
              <TrendingDown className="w-5 h-5 text-green-500" />
            ) : (
              <BarChart3 className="w-5 h-5 text-muted-foreground" />
            )}
            <span className="text-2xl font-bold">
              {trendDirection === "up" ? "Subindo" : trendDirection === "down" ? "Descendo" : "Estavel"}
            </span>
          </div>
        </Card>
      </div>

      {/* Tendencia 6 meses */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Tendencia Regional — Ultimos 6 Meses</h2>
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
          <AlertTriangle className="w-4 h-4 text-orange-500" />
          <h2 className="font-semibold text-sm">Ranking de CEPs por Risco</h2>
          <span className="ml-auto text-xs text-muted-foreground">{ranking.length} CEPs</span>
        </div>
        {rankingLoading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando...</div>
        ) : ranking.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">Nenhum dado disponivel. Os dados serao carregados apos a sincronizacao com os ERPs.</div>
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
                    <td className="px-4 py-3 font-mono">{row.cep5}-***</td>
                    <td className="px-4 py-3">{row.city || "—"}</td>
                    <td className="px-4 py-3 font-semibold">{row.count}</td>
                    <td className="px-4 py-3">R$ {fmt(row.totalOverdue)}</td>
                    <td className="px-4 py-3">{row.avgDaysOverdue}d</td>
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

      {/* Mapa de risco */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Mapa de Risco por Bairro</h2>
        </div>
        <BenchmarkMap points={mapPoints} />
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500" /> Baixo</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500" /> Medio</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-orange-500" /> Alto</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500" /> Critico</span>
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
          .setHTML(`<strong>${p.cep5}-***</strong> ${p.city}<br/>${p.count} inadimplentes<br/>R$ ${Number(p.totalOverdue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`)
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
