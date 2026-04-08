import { useQuery } from "@tanstack/react-query";
import { STALE_DASHBOARD } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useState, useEffect } from "react";
import GoogleHeatMap, { HeatPoint } from "@/components/maps/GoogleHeatMap";
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

const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DashboardPage() {
  const { provider, partnerCode } = useAuth();
  const [providerCenter, setProviderCenter] = useState<{ lat: number; lng: number } | null>(null);

  const { data: stats, isLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"], staleTime: STALE_DASHBOARD });
  const { data: heatmapData = [] } = useQuery<any[]>({ queryKey: ["/api/heatmap/provider"], staleTime: STALE_DASHBOARD });

  useEffect(() => {
    if (heatmapData.length > 0) {
      const top = [...heatmapData].sort((a, b) => parseFloat(b.totalOverdueAmount || "0") - parseFloat(a.totalOverdueAmount || "0"))[0];
      const lat = parseFloat(top.latitude); const lng = parseFloat(top.longitude);
      if (!isNaN(lat) && !isNaN(lng)) setProviderCenter({ lat, lng });
    }
  }, [heatmapData]);

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
          <div className="flex items-center gap-2 border border-[var(--color-danger)] rounded-md px-3 py-2 bg-[var(--color-danger-bg)]">
            <Shield className="w-4 h-4 text-[var(--color-danger)] flex-shrink-0" />
            <div>
              <p className="font-mono text-sm font-bold text-[var(--color-danger)] leading-none whitespace-nowrap" data-testid="text-partner-code">
                {partnerCode}
              </p>
              <p className="text-[10px] text-[var(--color-muted)] leading-tight mt-0.5">seu codigo</p>
            </div>
          </div>
          )}
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
            <div className="relative">
              <GoogleHeatMap
                key={`dash-${heatPoints.length}-${providerCenter?.lat}`}
                points={heatPoints}
                mode="provider"
                defaultCenter={providerCenter}
                height={240}
                preview
              />
              {heatPoints.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-2 bg-[var(--color-bg)]/60 rounded-lg z-10">
                  <MapPin className="w-6 h-6 text-[var(--color-muted)]" style={{ opacity: 0.4 }} />
                  <p className="text-sm font-body text-[var(--color-muted)]">Nenhum ponto de calor disponivel</p>
                  <p className="text-xs text-[var(--color-muted)]" style={{ opacity: 0.6 }}>Cadastre coordenadas nos clientes inadimplentes para visualizar o mapa.</p>
                </div>
              )}
            </div>
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
          </div>
        </Card>
      </div>
    </div>
  );
}
