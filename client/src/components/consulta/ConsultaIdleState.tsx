import { Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Estado ocioso das abas de consulta — o que aparece antes de existir resultado.
 *
 * Antes disto a aba renderizava a barra de busca e deixava o corpo VAZIO para
 * quem já tinha consultado alguma vez: a caixa de vazio só aparecia com
 * totalConsultas === 0 e nenhuma página passava `metrics`. Os cards de
 * capacidade resolvem isso — eles explicam o que a consulta entrega e ficam
 * sempre presentes, independente do histórico.
 *
 * NAO exibe historico de consultas: existe uma aba "Historico" dedicada a isso.
 *
 * Nao faz nenhuma chamada de API — consome os dados que a pagina ja carregou.
 */

type Metric = { label: string; value: string | number; suffix?: string; testId: string };

export type IdleCard = { icon: LucideIcon; title: string; text: string };

interface Props {
  /** Usado apenas para decidir entre "provedor novo" e "ja tem historico". */
  totalConsultas: number;
  /** Omitir quando a pagina ja exibe metricas proprias acima (caso do SPC). */
  metrics?: Metric[];
  /** Cards de capacidade — o que esta consulta entrega. Vazio esconde a grade. */
  cards?: IdleCard[];
  /** Copy do estado vazio — muda entre ISP, Cadastral e SPC. */
  emptyTitle: string;
  emptyDescription: string;
  emptyCta: string;
  /** testid do input de busca, para o CTA do estado vazio focar o campo certo */
  searchInputTestId: string;
}

function MetricCard({ label, value, suffix, testId }: Metric) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "12px 14px",
    }}>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "var(--track-wide)",
        color: "var(--text-muted)",
      }}>
        {label}
      </div>
      <div
        style={{
          marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 21, fontWeight: 500,
          letterSpacing: "var(--track-tight)", fontVariantNumeric: "tabular-nums",
          color: "var(--text)",
        }}
        data-testid={testId}
      >
        {value}
        {suffix && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{suffix}</span>}
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
  cards = [],
  emptyTitle,
  emptyDescription,
  emptyCta,
  searchInputTestId,
}: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="consulta-idle-state">
      {metrics.length > 0 && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10,
        }}>
          {metrics.map(m => <MetricCard key={m.testId} {...m} />)}
        </div>
      )}

      {cards.length > 0 && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14,
        }}>
          {cards.map(c => (
            <div key={c.title} style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 10, padding: "16px 18px",
            }}>
              <div style={{ color: "var(--brand-ink)", display: "flex" }}>
                <c.icon size={18} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 10, color: "var(--text)" }}>
                {c.title}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 3 }}>
                {c.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* A caixa de vazio só entra quando NÃO há cards de capacidade: com os
          cards na tela ela vira um segundo bloco dizendo a mesma coisa. */}
      {totalConsultas === 0 && cards.length === 0 && (
        /* Vazio de verdade — provedor ainda nao consultou nada */
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "48px 24px", textAlign: "center",
        }}>
          <Search size={30} style={{ margin: "0 auto 16px", color: "var(--text-faint)" }} />
          <h3 style={{
            fontSize: 16, fontWeight: 600, letterSpacing: "var(--track-tight)", color: "var(--text)",
          }}>
            {emptyTitle}
          </h3>
          <p style={{
            marginTop: 8, marginBottom: 24, marginLeft: "auto", marginRight: "auto",
            maxWidth: "46ch", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55,
          }}>
            {emptyDescription}
          </p>
          <button
            type="button"
            onClick={() => focusSearch(searchInputTestId)}
            className="ds-ctl"
            data-testid="button-empty-consultar"
            style={{
              minHeight: 44, padding: "0 18px", borderRadius: 8, border: "none", cursor: "pointer",
              fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "var(--track-wide)",
              background: "var(--action)", color: "var(--text-on-brand)",
            }}
          >
            {emptyCta}
          </button>
        </div>
      )}
    </div>
  );
}
