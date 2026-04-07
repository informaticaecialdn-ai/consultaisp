import type { ConsultaResult, ScoreFator } from "./types";
import { FATOR_LABELS } from "./constants";

interface Props {
  fatores: ConsultaResult["fatoresScore"];
}

export default function ScoreBreakdownPanel({ fatores }: Props) {
  if (!fatores) return null;
  const entries = Object.entries(fatores) as [string, ScoreFator][];
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Composicao do Score ISP</p>
      <div className="space-y-2.5">
        {entries.map(([key, fator]) => {
          const meta = FATOR_LABELS[key] || { icon: "📊", label: key };
          const pct = fator.maximo > 0 ? (fator.pontos / fator.maximo) * 100 : 0;
          const barColor = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-slate-700">
                  {meta.icon} {meta.label}
                </span>
                <span className="text-sm font-bold text-slate-500">
                  {fator.pontos}/{fator.maximo} <span className="text-slate-400">({fator.peso})</span>
                </span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${barColor} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{fator.descricao}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-600">Score Total</span>
        <span className="text-lg font-black text-slate-900 font-mono">
          {entries.reduce((s, [, f]) => s + f.pontos, 0)}/1000
        </span>
      </div>
    </div>
  );
}
