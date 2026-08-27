import type { ConsultaResult, ScoreFator } from "./types";
import { FATOR_LABELS } from "./constants";
import { ChevronRight, TrendingDown, TrendingUp, ShieldAlert } from "lucide-react";
import { useState } from "react";

interface Props {
  fatores?: ConsultaResult["fatoresScore"];
  composicao?: ConsultaResult["composicaoScore"];
  score?: number;
}

/**
 * COMPOSIÇÃO DO SCORE — motor v2: um extrato de conta, não seis barras.
 *
 * O formato antigo mostrava "Inadimplência 0/250" com barra vazia — penalidade
 * máxima lida como "sem problema". Aqui cada linha diz o que somou ou tirou
 * pontos, em ordem de impacto, e o teto aparece como regra explícita: o
 * provedor vê POR QUE o número é o que é, e decide.
 */
function ComposicaoV2({ composicao, score }: {
  composicao: NonNullable<ConsultaResult["composicaoScore"]>;
  score?: number;
}) {
  const { base, deducoes, bonus, teto } = composicao;
  const total = score ?? Math.max(0, Math.min(1000,
    Math.min(
      base + bonus.reduce((s, b) => s + b.pontos, 0) + deducoes.reduce((s, d) => s + d.pontos, 0),
      teto?.valor ?? 1000,
    )));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--color-muted)]">
          Composição do score
        </h3>
        <span className="font-mono text-[18px] font-semibold tabular-nums text-[var(--color-ink)]">
          {total}
          <span className="text-[13px] font-normal text-[var(--color-muted)]">/1000</span>
        </span>
      </div>

      {/* Base de partida */}
      <div className="flex items-baseline justify-between gap-3 py-2 border-b border-[var(--color-border)]">
        <span className="text-[13px] text-[var(--color-muted)]">
          Base — nada consta na rede ISP
        </span>
        <span className="font-mono text-[13px] font-semibold tabular-nums text-[var(--color-ink)]">
          {base}
        </span>
      </div>

      {/* Deduções: o que derrubou o score, do pior para o mais leve */}
      {deducoes.map((d, i) => (
        <div key={`d-${i}`} className="py-2 border-b border-[var(--color-border)]"
          data-testid={`score-deducao-${i}`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex items-center gap-2 text-[13px] text-[var(--color-ink)] min-w-0">
              <TrendingDown className="w-3.5 h-3.5 shrink-0 text-[var(--color-danger)]" />
              <span>{d.motivo}</span>
            </span>
            <span className="font-mono text-[13px] font-semibold tabular-nums text-[var(--color-danger)] shrink-0">
              {d.pontos}
            </span>
          </div>
          {d.detalhe && (
            <p className="text-[11.5px] text-[var(--color-muted)] mt-0.5 ml-[22px]">{d.detalhe}</p>
          )}
        </div>
      ))}

      {/* Bônus: histórico positivo comprovado */}
      {bonus.map((b, i) => (
        <div key={`b-${i}`} className="flex items-baseline justify-between gap-3 py-2 border-b border-[var(--color-border)]"
          data-testid={`score-bonus-${i}`}>
          <span className="flex items-center gap-2 text-[13px] text-[var(--color-ink)] min-w-0">
            <TrendingUp className="w-3.5 h-3.5 shrink-0 text-[var(--color-success)]" />
            <span>{b.motivo}</span>
          </span>
          <span className="font-mono text-[13px] font-semibold tabular-nums text-[var(--color-success)] shrink-0">
            +{b.pontos}
          </span>
        </div>
      ))}

      {deducoes.length === 0 && bonus.length === 0 && (
        <p className="py-2 text-[12.5px] text-[var(--color-muted)]">
          Sem sinais na rede — o score fica na base até existir histórico.
        </p>
      )}

      {/* Teto: a regra que limita, dita por extenso */}
      {teto && (
        <div className="flex items-start gap-2 mt-3 px-3 py-2.5 rounded bg-[var(--color-danger-bg)]"
          data-testid="score-teto">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-px text-[var(--color-danger)]" />
          <p className="text-[12.5px] leading-snug text-[var(--color-danger)]">
            <span className="font-semibold">{teto.motivo}</span> — o score não passa de{" "}
            <span className="font-mono font-semibold tabular-nums">{teto.valor}</span>{" "}
            enquanto a pendência existir, independente de qualquer histórico positivo.
          </p>
        </div>
      )}
    </div>
  );
}

/** Formato antigo (consultas gravadas antes do v2) — mantido para o histórico. */
function FatoresLegado({ fatores }: { fatores: NonNullable<ConsultaResult["fatoresScore"]> }) {
  const entries = Object.entries(fatores) as [string, ScoreFator][];
  const totalPontos = entries.reduce((s, [, f]) => s + f.pontos, 0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--color-muted)]">
          Composição do score
        </h3>
        <span className="font-mono text-[18px] font-semibold tabular-nums text-[var(--color-ink)]">
          {totalPontos}
          <span className="text-[13px] font-normal text-[var(--color-muted)]">/1000</span>
        </span>
      </div>
      {entries.map(([key, fator]) => {
        const meta = FATOR_LABELS[key] || { icon: "", label: key };
        const isExpanded = expandedKey === key;
        // No legado, pontos baixos em fator de risco significam penalidade
        // aplicada — a cor acompanha a perda, para a leitura não inverter.
        const perdido = fator.maximo - fator.pontos;
        return (
          <button key={key} className="w-full text-left" onClick={() => setExpandedKey(isExpanded ? null : key)}>
            <div className="flex items-center justify-between gap-3 py-2 border-b border-[var(--color-border)]">
              <span className="text-[13px] text-[var(--color-ink)]">{meta.label}</span>
              <span className="flex items-center gap-2">
                {perdido > 0 && (
                  <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--color-danger)]">
                    −{perdido}
                  </span>
                )}
                <span className="font-mono text-[12px] tabular-nums text-[var(--color-muted)]">
                  {fator.pontos}/{fator.maximo}
                </span>
                <ChevronRight className={`w-3.5 h-3.5 text-[var(--color-muted)] transition-transform ${isExpanded ? "rotate-90" : ""}`} />
              </span>
            </div>
            {isExpanded && (
              <p className="text-[11.5px] text-[var(--color-muted)] py-1.5">{fator.descricao}</p>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function ScoreBreakdownPanel({ fatores, composicao, score }: Props) {
  if (composicao) return <ComposicaoV2 composicao={composicao} score={score} />;
  if (fatores) return <FatoresLegado fatores={fatores} />;
  return null;
}