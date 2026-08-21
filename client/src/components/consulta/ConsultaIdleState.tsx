import { Search } from "lucide-react";

/**
 * Estado ocioso das abas de consulta — o que aparece antes de existir resultado.
 *
 * Antes disto a aba renderizava apenas a barra de busca e deixava o resto da pagina
 * em branco. DESIGN_SYSTEM.md secao 6 trata estado vazio como estado real.
 *
 * NAO exibe historico de consultas: existe uma aba "Historico" dedicada a isso.
 * Repetir a lista aqui duplicava funcionalidade no lugar errado.
 *
 * Nao faz nenhuma chamada de API — consome os dados que a pagina ja carregou.
 */

type Metric = { label: string; value: string | number; suffix?: string; testId: string };

interface Props {
  /** Usado apenas para decidir entre "provedor novo" e "ja tem historico". */
  totalConsultas: number;
  /** Omitir quando a pagina ja exibe metricas proprias acima (caso do SPC). */
  metrics?: Metric[];
  /** Copy do estado vazio — muda entre ISP e SPC. */
  emptyTitle: string;
  emptyDescription: string;
  emptyCta: string;
  /** testid do input de busca, para o CTA do estado vazio focar o campo certo */
  searchInputTestId: string;
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
  // Defaults defensivos: prop ausente deve degradar, nao derrubar a pagina.
  totalConsultas = 0,
  metrics = [],
  emptyTitle,
  emptyDescription,
  emptyCta,
  searchInputTestId,
}: Props) {
  return (
    <div className="space-y-4" data-testid="consulta-idle-state">
      {/* Metricas — promovidas do cabecalho, onde estavam comprimidas em texto mono inline */}
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {metrics.map(m => <MetricCard key={m.testId} {...m} />)}
        </div>
      )}

      {totalConsultas === 0 && (
        /* Vazio de verdade — provedor ainda nao consultou nada */
        <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-6 py-12 text-center">
          <Search className="w-8 h-8 mx-auto mb-4 text-[var(--color-muted)] opacity-50" />
          <h3 className="font-medium text-base tracking-[-0.01em] text-[var(--color-ink)]">
            {emptyTitle}
          </h3>
          <p className="mt-2 mb-6 mx-auto max-w-[46ch] text-sm text-[var(--color-muted)]">
            {emptyDescription}
          </p>
          <button
            type="button"
            onClick={() => focusSearch(searchInputTestId)}
            data-testid="button-empty-consultar"
            className="min-h-[44px] font-mono text-[11px] tracking-[0.06em] px-4 py-2 rounded bg-[var(--color-brand)] text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))] motion-safe:transition-opacity active:scale-[0.97]"
          >
            {emptyCta}
          </button>
        </div>
      )}
    </div>
  );
}
