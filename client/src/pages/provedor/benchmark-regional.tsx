import { useQuery } from "@tanstack/react-query";
import { STALE_DASHBOARD } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  ShieldAlert,
  BarChart3,
  MapPin,
} from "lucide-react";

interface BenchmarkData {
  own: { avgScore: number; totalConsultations: number; inadimplenciaPct: number };
  regional: { avgScore: number; totalConsultations: number; inadimplenciaPct: number };
  migradores: { own: number; regional: number };
  topRiskCeps: Array<{ cep: string; avgScore: number; count: number }>;
  trend: { scoreDeltaPct: number; direction: "up" | "down" | "stable" };
  providersInRegion: number;
}

export default function BenchmarkRegionalPage() {
  const { provider } = useAuth();

  const { data, isLoading } = useQuery<BenchmarkData>({
    queryKey: ["/api/isp-consultations/benchmark"],
    staleTime: STALE_DASHBOARD,
  });

  const TrendIcon = data?.trend.direction === "up" ? TrendingUp
    : data?.trend.direction === "down" ? TrendingDown
    : Minus;

  const trendColor = data?.trend.direction === "up" ? "text-green-600"
    : data?.trend.direction === "down" ? "text-red-600"
    : "text-muted-foreground";

  const kpiCards = [
    {
      label: "Inadimplencia",
      value: data?.own.inadimplenciaPct,
      valueSuffix: "%",
      sub: `Media regional: ${data?.regional.inadimplenciaPct ?? 0}%`,
      badge: data && data.own.inadimplenciaPct <= data.regional.inadimplenciaPct
        ? { text: "Abaixo da media", variant: "default" as const, className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0" }
        : { text: "Acima da media", variant: "default" as const, className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0" },
      icon: BarChart3,
      accent: "from-rose-500 to-red-600",
      iconBg: "bg-rose-100 dark:bg-rose-900/30",
      iconColor: "text-rose-600",
    },
    {
      label: "Score Medio",
      value: data?.own.avgScore,
      valueSuffix: "",
      sub: `Media regional: ${data?.regional.avgScore ?? 0}`,
      badge: data && data.own.avgScore >= data.regional.avgScore
        ? { text: "Acima da media", variant: "default" as const, className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0" }
        : { text: "Abaixo da media", variant: "default" as const, className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0" },
      icon: ShieldAlert,
      accent: "from-blue-500 to-indigo-600",
      iconBg: "bg-blue-100 dark:bg-blue-900/30",
      iconColor: "text-blue-600",
    },
    {
      label: "Migradores (mes)",
      value: data?.migradores.own,
      valueSuffix: "",
      sub: `Regional: ${data?.migradores.regional ?? 0}`,
      badge: null,
      icon: Users,
      accent: "from-amber-500 to-orange-600",
      iconBg: "bg-amber-100 dark:bg-amber-900/30",
      iconColor: "text-amber-600",
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Benchmark Regional</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {provider?.name} — comparativo com provedores da regiao
          </p>
        </div>
        {isLoading ? (
          <Skeleton className="h-7 w-36" />
        ) : (
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5 text-xs font-semibold">
            <Users className="w-3.5 h-3.5" />
            {data?.providersInRegion ?? 0} provedores na regiao
          </Badge>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {kpiCards.map((card) => (
          <Card key={card.label} className="relative overflow-hidden p-5">
            <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${card.accent}`} />
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
              <div className={`w-9 h-9 rounded-lg ${card.iconBg} flex items-center justify-center flex-shrink-0`}>
                <card.icon className={`${card.iconColor}`} style={{ width: "18px", height: "18px" }} />
              </div>
            </div>
            {isLoading ? (
              <>
                <Skeleton className="h-8 w-24 mb-1" />
                <Skeleton className="h-3 w-32" />
              </>
            ) : (
              <>
                <p className="text-2xl font-bold tracking-tight">
                  {card.value ?? 0}{card.valueSuffix}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
                {card.badge && (
                  <Badge className={`mt-2 text-xs ${card.badge.className}`}>
                    {card.badge.text}
                  </Badge>
                )}
              </>
            )}
          </Card>
        ))}
      </div>

      {/* Top Risk CEPs */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b">
          <MapPin className="w-4 h-4 text-orange-500" />
          <div>
            <span className="font-semibold text-sm">Top 5 CEPs com Maior Risco</span>
            <p className="text-xs text-muted-foreground">Regioes com menor score medio nos ultimos 30 dias</p>
          </div>
        </div>
        <div className="p-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !data?.topRiskCeps?.length ? (
            <div className="rounded-lg border border-dashed p-10 flex flex-col items-center justify-center text-center gap-2 bg-muted/20">
              <MapPin className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">Nenhum dado de CEP disponivel</p>
              <p className="text-xs text-muted-foreground/60">Realize consultas para gerar dados regionais.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">CEP</th>
                  <th className="pb-2 font-medium text-right">Score Medio</th>
                  <th className="pb-2 font-medium text-right">Consultas</th>
                </tr>
              </thead>
              <tbody>
                {data.topRiskCeps.map((cep) => (
                  <tr key={cep.cep} className="border-b last:border-0">
                    <td className="py-2.5 font-mono text-xs">{cep.cep}</td>
                    <td className="py-2.5 text-right">
                      <Badge
                        variant="outline"
                        className={
                          cep.avgScore < 300
                            ? "border-red-300 text-red-700 dark:text-red-400"
                            : cep.avgScore < 500
                            ? "border-amber-300 text-amber-700 dark:text-amber-400"
                            : "border-green-300 text-green-700 dark:text-green-400"
                        }
                      >
                        {cep.avgScore}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-right text-muted-foreground">{cep.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Trend Card */}
      <Card className="relative overflow-hidden p-5">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-gray-400 to-gray-500" />
        <div className="flex items-center gap-4">
          {isLoading ? (
            <>
              <Skeleton className="w-10 h-10 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </>
          ) : (
            <>
              <div className={`w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0`}>
                <TrendIcon className={`w-5 h-5 ${trendColor}`} />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  Tendencia Regional{" "}
                  <span className={trendColor}>
                    {data?.trend.direction === "up" && "+"}
                    {data?.trend.scoreDeltaPct ?? 0}%
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {data?.trend.direction === "up"
                    ? "Score medio regional subindo em relacao ao mes anterior"
                    : data?.trend.direction === "down"
                    ? "Score medio regional caindo em relacao ao mes anterior"
                    : "Score medio regional estavel em relacao ao mes anterior"}
                </p>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
