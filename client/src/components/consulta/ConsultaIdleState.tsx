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
    <div className="bg-[var(--color-surface)] rounded-lg px-[14px] py-3 border border-[var(--color-border)]">
      <span className="block font-mono text-[10px] uppercase tracking-[0.11em] text-[var(--color-muted)]">
        {label}
      </span>
      <div
        className="mt-1.5 font-mono text-[21px] font-medium tracking-[-0.02em] text-[var(--color-ink)] tabular-nums"
        data-testid={testId}
      >
        {value}
        {suffix && <span className="text-[12px] text-[var(--color-muted)]">{suffix}</span>}
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
  // Defaults defensivos: durante a migracao do design system um caller ficou
  // momentaneamente sem `metrics` e o componente derrubou a pagina inteira no
  // ErrorBoundary. Prop ausente deve degradar, nao quebrar.
  consultations = [],
  metrics = [],
  onRerun,
  emptyTitle,
  emptyDescription,
  emptyCta,
  searchInputTestId,
}: Props) {
  const recent = consultations.slice(0, 5);

  return (
    <div className="space-y-4" data-testid="consulta-idle-state">
      {/* Metricas — promovidas do cabecalho, onde estavam comprimidas em texto mono inline */}
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {metrics.map(m => <MetricCard key={m.testId} {...m} />)}
        </div>
      )}

      {recent.length > 0 ? (
        /* Tabela, nao lista de cards. Cabecalho de coluna e o que transforma
           "algumas linhas" em "registro" — e o que faz a tela ler como bureau. */
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]">
            <span className="font-mono text-[10px] uppercase tracking-[0.11em] text-[var(--color-muted)]">
              Consultas recentes
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.11em] text-[var(--color-muted)]">
              Últimas {recent.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[520px]">
              <thead>
                <tr>
                  {["CPF / CNPJ", "Score", "Decisão", "Custo", "Quando"].map(h => (
                    <th
                      key={h}
                      className="text-left font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] text-[var(--color-muted)] px-4 py-2 border-b border-[var(--color-border)]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map(c => {
                  const dec = DECISION[c.decisionReco as keyof typeof DECISION];
                  const cor = scoreToken(c.score);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => onRerun(c.cpfCnpj)}
                      tabIndex={0}
                      role="button"
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRerun(c.cpfCnpj); } }}
                      data-testid={`rerun-${c.id}`}
                      className="group cursor-pointer border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-bg)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[hsl(var(--ring))] motion-safe:transition-colors"
                    >
                      <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--color-ink)] whitespace-nowrap">
                        {formatCpfCnpj(c.cpfCnpj)}
                      </td>

                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="font-mono tabular-nums font-medium" style={{ color: cor }}>
                            {c.score ?? "—"}
                          </span>
                          {c.score !== null && (
                            <span className="hidden md:block w-[52px] h-[3px] rounded-sm bg-[var(--color-border)] overflow-hidden">
                              <span
                                className="block h-full rounded-sm"
                                style={{ width: `${Math.min(100, c.score / 10)}%`, background: cor }}
                              />
                            </span>
                          )}
                        </span>
                      </td>

                      <td className="px-4 py-2.5">
                        {dec ? (
                          <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.04em] px-2 py-0.5 rounded ${dec.cls}`}>
                            {/* SPC nao grava decisao — nesse caso a celula fica vazia */}
                            <i className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />
                            {dec.label}
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] text-[var(--color-muted)]">—</span>
                        )}
                      </td>

                      <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--color-muted)] text-[12px] whitespace-nowrap">
                        {c.cost === undefined ? "—" : c.cost === 0 ? "grátis" : `−${c.cost} cred`}
                      </td>

                      <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--color-muted)] text-[12px] whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          {relativeDate(c.createdAt)}
                          <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:transition-opacity" />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
