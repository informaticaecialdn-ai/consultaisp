import type { ConsultaResult, ScoreFator } from "./types";
import { FATOR_LABELS } from "./constants";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

interface Props {
  fatores: ConsultaResult["fatoresScore"];
}

function BarSegment({ pontos, maximo, color }: { pontos: number; maximo: number; color: string }) {
  const pct = maximo > 0 ? (pontos / maximo) * 100 : 0;
  return (
    <div className="flex-1 flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--color-tag-bg)" }}>
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function getBarColor(pontos: number, maximo: number): string {
  if (maximo === 0) return "var(--color-muted)";
  const pct = (pontos / maximo) * 100;
  if (pct >= 80) return "#2E8B57";
  if (pct >= 50) return "#C9A820";
  if (pct >= 25) return "#D97A2B";
  return "#C44040";
}

export default function ScoreBreakdownPanel({ fatores }: Props) {
  if (!fatores) return null;
  const entries = Object.entries(fatores) as [string, ScoreFator][];
  const totalPontos = entries.reduce((s, [, f]) => s + f.pontos, 0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Composicao do Score
        </h3>
        <span className="text-lg font-extrabold tabular-nums" style={{ color: "var(--color-ink)" }}>
          {totalPontos}
          <span className="text-sm font-semibold" style={{ color: "var(--color-muted)" }}>/1000</span>
        </span>
      </div>

      <div className="space-y-0">
        {entries.map(([key, fator]) => {
          const meta = FATOR_LABELS[key] || { icon: "📊", label: key };
          const color = getBarColor(fator.pontos, fator.maximo);
          const pct = fator.maximo > 0 ? Math.round((fator.pontos / fator.maximo) * 100) : 0;
          const isExpanded = expandedKey === key;

          return (
            <button
              key={key}
              className="w-full text-left group"
              onClick={() => setExpandedKey(isExpanded ? null : key)}
            >
              <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors hover:bg-[var(--color-tag-bg)]">
                {/* Icon circle */}
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm"
                  style={{ backgroundColor: color + "18" }}
                >
                  {meta.icon}
                </div>

                {/* Label + bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                      {meta.label}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold tabular-nums" style={{ color }}>
                        {fator.pontos}
                      </span>
                      <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                        /{fator.maximo}
                      </span>
                    </div>
                  </div>
                  <BarSegment pontos={fator.pontos} maximo={fator.maximo} color={color} />
                </div>

                {/* Expand arrow */}
                <ChevronRight
                  className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                  style={{ color: "var(--color-muted)" }}
                />
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="ml-14 mr-8 pb-2 -mt-0.5">
                  <p className="text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
                    {fator.descricao}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className="text-xs font-semibold px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: color + "18", color }}
                    >
                      {pct}% do maximo
                    </span>
                    <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                      Peso: {fator.peso}
                    </span>
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
