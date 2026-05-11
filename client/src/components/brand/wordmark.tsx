/**
 * Provedor.ai wordmark — placeholder serif (Fraunces) até logo SVG final.
 *
 * Uso:
 *   <ProvedorAiWordmark />            // size="md" default
 *   <ProvedorAiWordmark size="sm" />  // sidebar header, footer
 *   <ProvedorAiWordmark size="lg" />  // hero, splash
 *   <ProvedorAiWordmark mono />       // single-color (current text color)
 *
 * Fraunces já é carregada globalmente via client/index.html (Google Fonts).
 * Variantes visuais devem ser ajustadas aqui — não duplicar wordmark em outros lugares.
 */

import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<Size, string> = {
  sm: "text-base",   // 16px — sidebar header
  md: "text-xl",     // 20px — login/landing header
  lg: "text-4xl",    // 36px — hero
};

interface ProvedorAiWordmarkProps {
  size?: Size;
  /** Renderiza em uma única cor (currentColor) em vez do gradiente da marca. */
  mono?: boolean;
  className?: string;
}

export function ProvedorAiWordmark({
  size = "md",
  mono = false,
  className,
}: ProvedorAiWordmarkProps) {
  return (
    <span
      className={cn(
        "font-display font-semibold tracking-tight inline-flex items-baseline",
        SIZE_CLASSES[size],
        mono ? "text-current" : "text-[var(--color-brand-green-900)]",
        className,
      )}
      aria-label="Provedor.ai"
    >
      Provedor
      <span
        className={cn(
          "font-light",
          mono ? "opacity-70" : "text-[var(--color-brand-green-700)]",
        )}
      >
        .ai
      </span>
    </span>
  );
}
