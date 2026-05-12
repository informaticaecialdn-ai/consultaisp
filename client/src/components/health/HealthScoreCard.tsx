/**
 * HealthScoreCard — Spec 010A — card detalhado com score + componentes
 * + predições + recomendação.
 *
 * Usado em:
 *   - Tab "Saúde" no cliente (variant="full")
 *   - Simulador (variant="full")
 *   - Tooltip rápido (variant="compact")
 */

import { cn } from "@/lib/utils";
import { HealthBadge, type HealthTier } from "./HealthBadge";

export interface HealthComponents {
  punctuality: number;
  loyalty: number;
  reliability: number;
  sentiment: number;
  engagement: number;
  externalScore: number;
}

export interface HealthPredictions {
  inadimplenciaRisk30dPercent: number;
  churnRisk60dPercent: number;
}

export interface HealthRecommendation {
  recommendedAction: string;
  recommendedAgent: string;
  severity: "none" | "monitor" | "act" | "human_intervention";
}

interface HealthScoreCardProps {
  healthScore: number;
  healthTier: HealthTier;
  components: HealthComponents;
  predictions: HealthPredictions;
  recommendation: HealthRecommendation;
  variant?: "full" | "compact";
  className?: string;
}

const COMPONENT_LABELS: Record<keyof HealthComponents, string> = {
  punctuality: "Pontualidade",
  loyalty: "Fidelidade",
  reliability: "Confiabilidade",
  sentiment: "Sentimento",
  engagement: "Engajamento",
  externalScore: "Score externo",
};

const COMPONENT_WEIGHTS: Record<keyof HealthComponents, number> = {
  punctuality: 35,
  loyalty: 15,
  reliability: 15,
  sentiment: 10,
  engagement: 10,
  externalScore: 15,
};

const SEVERITY_STYLES: Record<HealthRecommendation["severity"], string> = {
  none: "text-green-700 dark:text-green-300",
  monitor: "text-blue-700 dark:text-blue-300",
  act: "text-orange-700 dark:text-orange-300",
  human_intervention: "text-red-700 dark:text-red-300",
};

function ComponentBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min(100, (value / max) * 100);
  const color =
    value >= 80
      ? "bg-green-500"
      : value >= 60
        ? "bg-blue-500"
        : value >= 40
          ? "bg-orange-500"
          : "bg-red-500";
  return (
    <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
      <div className={cn("h-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function HealthScoreCard({
  healthScore,
  healthTier,
  components,
  predictions,
  recommendation,
  variant = "full",
  className,
}: HealthScoreCardProps) {
  if (variant === "compact") {
    return (
      <div className={cn("flex items-center gap-3 p-2 rounded-md border", className)}>
        <div className="text-2xl font-bold tabular-nums">{healthScore}</div>
        <div className="flex flex-col gap-1">
          <HealthBadge tier={healthTier} variant="small" />
          <span className="text-xs text-muted-foreground">
            Inadimp. {predictions.inadimplenciaRisk30dPercent}% · Churn {predictions.churnRisk60dPercent}%
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border bg-card text-card-foreground p-6 space-y-6", className)}>
      {/* Hero — score + tier */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-5xl font-bold tabular-nums leading-none">{healthScore}</div>
          <div className="mt-1 text-sm text-muted-foreground">de 100</div>
        </div>
        <HealthBadge tier={healthTier} score={healthScore} variant="large" />
      </div>

      {/* Componentes — grid 2 colunas, com barras */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">Componentes</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {(Object.keys(components) as Array<keyof HealthComponents>).map((key) => (
            <div key={key} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium">{COMPONENT_LABELS[key]}</span>
                <span className="tabular-nums text-muted-foreground">
                  {components[key]}/100 ({COMPONENT_WEIGHTS[key]}%)
                </span>
              </div>
              <ComponentBar value={components[key]} />
            </div>
          ))}
        </div>
      </div>

      {/* Predições heurísticas */}
      <div className="grid grid-cols-2 gap-4 pt-2 border-t">
        <div>
          <div className="text-xs text-muted-foreground">Risco inadimplência 30 dias</div>
          <div className="text-2xl font-semibold tabular-nums">
            {predictions.inadimplenciaRisk30dPercent}%
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Risco churn 60 dias</div>
          <div className="text-2xl font-semibold tabular-nums">
            {predictions.churnRisk60dPercent}%
          </div>
        </div>
      </div>

      {/* Recomendação */}
      <div className="pt-2 border-t space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">Recomendação</h3>
          <span className={cn("text-xs font-medium uppercase tracking-wide", SEVERITY_STYLES[recommendation.severity])}>
            {recommendation.severity}
          </span>
        </div>
        <p className="text-sm leading-relaxed">{recommendation.recommendedAction}</p>
        <div className="text-xs text-muted-foreground">
          Agente sugerido: <strong>{recommendation.recommendedAgent}</strong>
        </div>
      </div>
    </div>
  );
}
