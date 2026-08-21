import { Search, ArrowUpRight, Clock } from "lucide-react";
import { formatCpfCnpj } from "./utils";

/**
 * Estado ocioso da aba "Nova Consulta" — o que aparece antes de existir resultado.
 *
 * Antes desta tela existir, a aba renderizava apenas a barra de busca e deixava o
 * resto da pagina vazio. DESIGN_SYSTEM.md secao 6 trata estado vazio como estado
 * real: nunca deixar painel em branco.
 *
 * Nao faz nenhuma chamada de API — consome os dados que a pagina ja carregou.
 */

type Consultation = {
  id: number;
  cpfCnpj: string;
  score: number | null;
  createdAt: string | null;
  /** Presentes no ISP; ausentes no SPC, que so grava score. */
  approved?: boolean;
  decisionReco?: string | null;
  cost?: number;
};

type Metric = { label: string; value: string | number; suffix?: string; testId: string };

interface Props {
  consultations: Consultation[];
  /** Omitir quando a pagina ja exibe metricas proprias acima (caso do SPC). */
  metrics?: Metric[];
  onRerun: (cpfCnpj: string) => void;
  /** Copy do estado vazio — muda entre ISP e SPC. */
  emptyTitle: string;
  emptyDescription: string;
  emptyCta: string;
  /** testid do input de busca, para o CTA do estado vazio focar o campo certo */
  searchInputTestId: string;
}

const DECISION = {
  Accept: { label: "Aprovar", cls: "bg-[var(--color-success-bg)] text-[var(--color-success)]" },
  Review: { label: "Revisar", cls: "bg-[var(--color-gold-bg)] text-[var(--color-gold)]" },
  Reject: { label: "Rejeitar", cls: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]" },
} as const;

/**
 * Faixas espelhadas de server/utils/isp-score.ts (701 / 501 / 301) — o score
 * gravado em isp_consultations e 0-1000, nao 0-100. Se o motor mudar de faixa,
 * este mapa muda junto.
 */
function scoreToken(score: number | null) {
  if (score === null) return "var(--color-muted)";
  if (score >= 701) return "var(--score-high)";      // excelente
  if (score >= 501) return "var(--score-medium)";    // bom
  if (score >= 301) return "var(--score-low)";       // baixo
  return "var(--score-critical)";                     // muito baixo
}

function relativeDate(d: string | null) {
  if (!d) return "—";
  const min = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

function MetricCard({ label, value, suffix, testId }: Metric) {
  return (
    <div className="bg-[var(--color-surface)] rounded-lg px-5 py-4 shadow-[0_0_0_1px_var(--ring-subtle)]">
      <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-muted)]">
        {label}
      </span>
      <div className="mt-2 font-mono text-2xl font-medium text-[var(--color-ink)] tabular-nums" data-testid={testId}>
        {value}
        {suffix && <span className="text-base text-[var(--color-muted)]">{suffix}</span>}
      </div>
    </div>
  );
}

function focusSearch(testId: string) {
  const el = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  el?.focus();
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export default function ConsultaIdleState({
  consultations,
  metrics,
  onRerun,
  emptyTitle,
  emptyDescription,
  emptyCta,
  searchInputTestId,
}: Props) {
  const recent = consultations.slice(0, 5);

  return (
    <div className="space-y-6" data-testid="consulta-idle-state">
      {/* Metricas — promovidas do cabecalho, onde estavam comprimidas em texto mono inline */}
      {metrics && metrics.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {metrics.map(m => <MetricCard key={m.testId} {...m} />)}
        </div>
      )}

      {recent.length > 0 ? (
        <div>
          <div className="flex items-baseline justify-between pb-2 mb-3 border-b border-[var(--color-border)]">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
              Consultas recentes
            </span>
            <span className="font-mono text-[10px] text-[var(--color-muted)]">
              clique para consultar de novo
            </span>
          </div>

          <ul className="flex flex-col gap-2">
            {recent.map(c => {
              const dec = DECISION[c.decisionReco as keyof typeof DECISION];
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onRerun(c.cpfCnpj)}
                    data-testid={`rerun-${c.id}`}
                    className="group w-full min-h-[44px] flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--color-surface)] text-left shadow-[0_0_0_1px_var(--ring-subtle)] hover:shadow-[0_0_0_1px_var(--ring-warm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))] motion-safe:transition-shadow"
                  >
                    {/* SPC nao grava aprovacao — nesse caso o dot herda a faixa do score */}
                    <span
                      className="w-2 h-2 rounded-full flex-none"
                      style={{
                        background: c.approved === undefined
                          ? scoreToken(c.score)
                          : c.approved ? "var(--color-success)" : "var(--color-danger)",
                      }}
                    />

                    <span className="font-mono text-sm text-[var(--color-ink)] tabular-nums">
                      {formatCpfCnpj(c.cpfCnpj)}
                    </span>

                    <span
                      className="font-mono text-sm font-medium tabular-nums"
                      style={{ color: scoreToken(c.score) }}
                    >
                      {c.score ?? "—"}
                    </span>

                    {dec && (
                      <span className={`font-mono text-[10px] tracking-[0.06em] px-2 py-0.5 rounded ${dec.cls}`}>
                        {dec.label}
                      </span>
                    )}

                    <span className="ml-auto flex items-center gap-3">
                      {c.cost !== undefined && (
                        <span className="font-mono text-[10px] text-[var(--color-muted)] tabular-nums">
                          {c.cost === 0 ? "grátis" : `-${c.cost} cred`}
                        </span>
                      )}
                      <span className="hidden sm:flex items-center gap-1 font-mono text-[10px] text-[var(--color-muted)] tabular-nums">
                        <Clock className="w-3 h-3" />
                        {relativeDate(c.createdAt)}
                      </span>
                      <ArrowUpRight className="w-4 h-4 text-[var(--color-muted)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:transition-opacity" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        /* Vazio de verdade — provedor ainda nao consultou nada */
        <div className="rounded-lg bg-[var(--color-surface)] shadow-[0_0_0_1px_var(--ring-subtle)] px-6 py-12 text-center">
          <Search className="w-8 h-8 mx-auto mb-4 text-[var(--color-muted)] opacity-50" />
          <h3 className="font-display font-semibold text-base text-[var(--color-ink)]">
            {emptyTitle}
          </h3>
          <p className="mt-2 mb-6 mx-auto max-w-[46ch] text-sm text-[var(--color-muted)]">
            {emptyDescription}
          </p>
          <button
            type="button"
            onClick={() => focusSearch(searchInputTestId)}
            data-testid="button-empty-consultar"
            className="min-h-[44px] font-mono text-[11px] tracking-[0.06em] px-4 py-2 rounded-lg bg-[var(--color-brand)] text-[var(--color-surface)] shadow-[0_0_0_1px_var(--color-brand)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))] motion-safe:transition-opacity active:scale-[0.97]"
          >
            {emptyCta}
          </button>
        </div>
      )}
    </div>
  );
}
