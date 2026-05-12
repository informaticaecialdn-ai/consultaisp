/**
 * HealthBadge — Spec 010A — badge visual do tier de saúde do cliente.
 *
 * Usa cores semânticas do design system:
 *   - gold (80-100):     verde-floresta + dourado
 *   - healthy (60-79):   verde
 *   - warning (40-59):   âmbar
 *   - critical (0-39):   vermelho/rosa
 *
 * Variantes:
 *   - inline: só badge compacto (tabelas)
 *   - small: badge + score + label
 *   - large: badge + score + label + componente expandido
 */

import { cn } from "@/lib/utils";

export type HealthTier = "gold" | "healthy" | "warning" | "critical";

interface HealthBadgeProps {
  tier: HealthTier;
  score?: number;  // 0-100
  variant?: "inline" | "small" | "large";
  className?: string;
}

const TIER_LABELS: Record<HealthTier, string> = {
  gold: "Ouro",
  healthy: "Saudável",
  warning: "Atenção",
  critical: "Crítico",
};

const TIER_STYLES: Record<HealthTier, string> = {
  gold: "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-700",
  healthy: "bg-green-50 text-green-900 border-green-300 dark:bg-green-900/20 dark:text-green-200 dark:border-green-700",
  warning: "bg-orange-50 text-orange-900 border-orange-300 dark:bg-orange-900/20 dark:text-orange-200 dark:border-orange-700",
  critical: "bg-red-50 text-red-900 border-red-300 dark:bg-red-900/20 dark:text-red-200 dark:border-red-700",
};

const TIER_DOT: Record<HealthTier, string> = {
  gold: "bg-amber-500",
  healthy: "bg-green-500",
  warning: "bg-orange-500",
  critical: "bg-red-500",
};

const SIZE_CLASSES = {
  inline: "px-1.5 py-0.5 text-[10px] gap-1",
  small: "px-2 py-1 text-xs gap-1.5",
  large: "px-3 py-1.5 text-sm gap-2",
} as const;

export function HealthBadge({ tier, score, variant = "small", className }: HealthBadgeProps) {
  const label = TIER_LABELS[tier];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium",
        TIER_STYLES[tier],
        SIZE_CLASSES[variant],
        className,
      )}
      title={score !== undefined ? `Health score: ${score}/100` : label}
    >
      <span className={cn("rounded-full", TIER_DOT[tier], variant === "inline" ? "w-1.5 h-1.5" : "w-2 h-2")} />
      <span>{label}</span>
      {score !== undefined && variant !== "inline" && (
        <span className="opacity-70 tabular-nums">{score}</span>
      )}
    </span>
  );
}
