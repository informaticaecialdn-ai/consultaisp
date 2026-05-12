/**
 * CustomerHealthPanel — Spec 010A — busca + renderiza health score de um
 * cliente real consumindo /api/customers/:id/health.
 *
 * Usado em:
 *   - /cliente/:customerId/dossie (tab inline)
 *   - /clientes/[id] (futuro: tab "Saúde")
 *   - Qualquer lugar que precise mostrar score sem owner inserir dados
 */

import { useQuery } from "@tanstack/react-query";
import { HealthScoreCard, type HealthComponents, type HealthPredictions, type HealthRecommendation } from "./HealthScoreCard";
import type { HealthTier } from "./HealthBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

interface CustomerHealthResponse {
  ok: boolean;
  data?: {
    customerId: number;
    healthScore: number;
    healthTier: HealthTier;
    components: HealthComponents;
    predictions: HealthPredictions;
    recommendation: HealthRecommendation;
    inputsSnapshot: unknown;
    computedAt: string;
    source: string;
  };
  error?: string;
}

interface CustomerHealthPanelProps {
  customerId: number;
  variant?: "full" | "compact";
}

export function CustomerHealthPanel({ customerId, variant = "full" }: CustomerHealthPanelProps) {
  const { data, isLoading, error } = useQuery<CustomerHealthResponse>({
    queryKey: [`/api/customers/${customerId}/health`],
    enabled: customerId > 0,
    staleTime: 5 * 60 * 1000,  // 5 min cache (cálculo on-the-fly, vale revalidar)
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Calculando saúde do cliente...</span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          Erro ao carregar health score: {error.message}
        </CardContent>
      </Card>
    );
  }

  if (!data?.ok || !data.data) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          {data?.error ?? "Health score indisponível"}
        </CardContent>
      </Card>
    );
  }

  return (
    <HealthScoreCard
      healthScore={data.data.healthScore}
      healthTier={data.data.healthTier}
      components={data.data.components}
      predictions={data.data.predictions}
      recommendation={data.data.recommendation}
      variant={variant}
    />
  );
}
