/**
 * AtRiskDashboardCard — Spec 010A — card do dashboard com top N clientes
 * em risco (warning + critical), priorizado por inadimplenciaRisk30dPercent.
 *
 * Consome GET /api/dashboard/at-risk.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertTriangle, ChevronRight } from "lucide-react";
import { HealthBadge, type HealthTier } from "./HealthBadge";

interface AtRiskCustomer {
  customerId: number;
  customerName: string | null;
  healthScore: number;
  healthTier: HealthTier;
  inadimplenciaRisk30dPercent: number;
  churnRisk60dPercent: number;
  recommendedAgent: string;
  recommendedAction: string;
}

interface AtRiskResponse {
  ok: boolean;
  data?: {
    customers: AtRiskCustomer[];
    stats: {
      universeSize: number;
      atRiskCount: number;
      criticalCount: number;
      warningCount: number;
    };
    computedAt: string;
  };
  error?: string;
}

interface AtRiskDashboardCardProps {
  limit?: number;
}

export function AtRiskDashboardCard({ limit = 10 }: AtRiskDashboardCardProps) {
  const { data, isLoading, error } = useQuery<AtRiskResponse>({
    queryKey: [`/api/dashboard/at-risk?limit=${limit}`],
    staleTime: 10 * 60 * 1000,  // 10 min — recalcula on-the-fly, cache OK
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              Clientes em risco esta semana
            </CardTitle>
            {data?.ok && data.data && (
              <div className="mt-1 text-xs text-muted-foreground">
                {data.data.stats.criticalCount} críticos · {data.data.stats.warningCount} em alerta · entre {data.data.stats.universeSize} com fatura aberta
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Calculando...</span>
          </div>
        ) : error ? (
          <div className="text-sm text-destructive py-3">Erro: {error.message}</div>
        ) : !data?.ok || !data.data ? (
          <div className="text-sm text-muted-foreground py-3">{data?.error ?? "Sem dados"}</div>
        ) : data.data.customers.length === 0 ? (
          <div className="text-sm text-muted-foreground py-3">
            ✅ Nenhum cliente em risco esta semana — operação saudável.
          </div>
        ) : (
          <div className="space-y-2">
            {data.data.customers.map((c) => (
              <Link key={c.customerId} href={`/cliente/${c.customerId}/dossie`}>
                <a className="flex items-center justify-between p-3 rounded-md border hover:bg-muted/30 transition-colors cursor-pointer group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {c.customerName ?? `Cliente #${c.customerId}`}
                      </span>
                      <HealthBadge tier={c.healthTier} score={c.healthScore} variant="inline" />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Inadimplência 30d: <strong className="tabular-nums">{c.inadimplenciaRisk30dPercent}%</strong>
                      {" · "}
                      Churn 60d: <strong className="tabular-nums">{c.churnRisk60dPercent}%</strong>
                      {" · "}
                      → <strong>{c.recommendedAgent}</strong>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0 ml-2" />
                </a>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
