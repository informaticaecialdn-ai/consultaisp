import type { CSSProperties, ReactNode } from "react";

/**
 * Primitivas do relatório de crédito — o vocabulário visual do handoff
 * "Provedor.AI · pele Razão · voz do módulo Consulta".
 *
 * Estas peças existem porque o relatório é UM card com seções separadas por
 * hairline, e cada seção repete os mesmos três elementos: kicker mono, pill de
 * estado e card tintado. Centralizar aqui é o que impede a tela de derivar de
 * volta para seis cards soltos com estilos ligeiramente diferentes.
 *
 * Todo valor vem de token. Nenhum hex mora neste arquivo.
 */

export type Tone = "ok" | "gated" | "danger" | "past" | "neutral" | "info";

const TONE: Record<Tone, { fg: string; bg: string; border: string }> = {
  ok:      { fg: "var(--ok)",         bg: "var(--ok-bg)",     border: "var(--ok-border)" },
  gated:   { fg: "var(--gated)",      bg: "var(--gated-bg)",  border: "var(--gated-border)" },
  danger:  { fg: "var(--danger)",     bg: "var(--danger-bg)", border: "var(--danger-border)" },
  past:    { fg: "var(--past)",       bg: "var(--past-bg)",   border: "var(--past-border)" },
  info:    { fg: "var(--info)",       bg: "var(--info-bg)",   border: "var(--info-border)" },
  neutral: { fg: "var(--text-muted)", bg: "var(--surface-2)", border: "var(--border)" },
};

/** Pill de estado: mono, caixa alta, retangular. Cor + rótulo, nunca só cor. */
export function pillStyle(tone: Tone): CSSProperties {
  const t = TONE[tone];
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
    textTransform: "uppercase", letterSpacing: "var(--track-wide)",
    // Pills quase sempre comecam com numero ("3 provedores", "1 credito").
    fontVariantNumeric: "tabular-nums",
    padding: "3px 9px", borderRadius: 6,
    background: t.bg, color: t.fg, border: `1px solid ${t.border}`,
    whiteSpace: "nowrap",
  };
}

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span style={pillStyle(tone)}>{children}</span>;
}

/** Rótulo de seção: mono 10px, caixa alta, tracking aberto, cor faint. */
export function Kicker({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "var(--track-wide)",
      color: "var(--text-faint)", ...style,
    }}>
      {children}
    </div>
  );
}

/** Seção do relatório — separada da anterior por hairline, nunca por card novo. */
export function ReportSection({ title, trailing, children, style }: {
  title?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "18px 24px", ...style }}>
      {(title || trailing) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          {title ? <Kicker>{title}</Kicker> : <span />}
          {trailing}
        </div>
      )}
      {children}
    </div>
  );
}

export interface TintCardData {
  kicker: string;
  tone: Tone;
  nome: string;
  linha: string;
  /** Segunda linha opcional, sempre em --gated: um agravante que não cabe na linha principal. */
  sub?: string;
  chip: string;
  chipTone?: Tone;
  fonte: string;
  /** Linha em --money-neg em vez da cor do tom — usado quando o número é dívida. */
  linhaNegativa?: boolean;
}

/**
 * Card tintado do relatório. O par "Seu provedor / Provedor parceiro" é a
 * unidade de leitura do bureau: o operador compara as duas colunas de relance.
 */
export function TintCard({ data }: { data: TintCardData }) {
  const t = TONE[data.tone];
  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.border}`,
      borderRadius: 10, padding: "14px 16px",
    }}>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "var(--track-wide)", color: t.fg,
      }}>
        {data.kicker}
      </div>
      <div style={{
        fontSize: 14.5, fontWeight: 700, marginTop: 6,
        letterSpacing: "var(--track-tight)", color: "var(--text)",
      }}>
        {data.nome}
      </div>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600,
        fontVariantNumeric: "tabular-nums", marginTop: 4,
        color: data.linhaNegativa ? "var(--money-neg)"
          : data.tone === "ok" || data.tone === "neutral" ? "var(--text-muted)" : t.fg,
      }}>
        {data.linha}
      </div>
      {data.sub && (
        <div style={{ fontSize: 11, color: "var(--gated)", marginTop: 3 }}>{data.sub}</div>
      )}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 8, marginTop: 10,
      }}>
        <span style={pillStyle(data.chipTone ?? data.tone)}>{data.chip}</span>
        <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{data.fonte}</span>
      </div>
    </div>
  );
}

/**
 * Grade do par "Seu provedor / Provedor parceiro" — SEMPRE 2 colunas.
 *
 * Com auto-fit, três ou mais parceiros viravam três colunas e a leitura por
 * coluna se perdia: o operador deixa de comparar sua base contra a rede e passa
 * a ler cards soltos. A quebra para 1 coluna no celular mora na classe .ds-duo.
 */
export function DuoGrid({ children }: { children: ReactNode }) {
  return <div className="ds-duo">{children}</div>;
}

/* ── Faixas do score ──────────────────────────────────────────
   Espelham server/utils/isp-score.ts. O motor decide em quatro faixas
   (701+ / 501+ / 301+ / <=300); o relatório abre a faixa alta em duas para
   distinguir "Bom" de "Excelente" na leitura — sem mudar decisão nenhuma. */
export interface Band { label: string; color: string; tone: Tone }

export function bandOf(score: number): Band {
  if (score <= 300) return { label: "Crítico", color: "var(--danger)", tone: "danger" };
  if (score <= 500) return { label: "Risco alto", color: "var(--past)", tone: "past" };
  if (score <= 700) return { label: "Risco médio", color: "var(--gated)", tone: "gated" };
  if (score <= 850) return { label: "Bom", color: "var(--now)", tone: "info" };
  return { label: "Excelente", color: "var(--ok)", tone: "ok" };
}

/** Anel do score — 60px, raio 25, stroke 7, aberto a partir do topo. */
export function ScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(1000, score));
  const band = bandOf(clamped);
  const CIRC = 157.1; // 2·π·25
  return (
    <div style={{ position: "relative", width: 60, height: 60, flexShrink: 0 }}>
      <svg width="60" height="60" viewBox="0 0 60 60" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="30" cy="30" r="25" fill="none" stroke="var(--surface-inset)" strokeWidth="7" />
        <circle
          cx="30" cy="30" r="25" fill="none"
          stroke={band.color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${((clamped / 1000) * CIRC).toFixed(1)} ${CIRC}`}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex",
        alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700,
        fontVariantNumeric: "tabular-nums", color: "var(--text)",
      }}>
        {clamped}
      </div>
    </div>
  );
}

/** Botão do cabeçalho do relatório — ghost ou primário, altura 32. */
export function ReportButton({ onClick, variant = "ghost", children, testId }: {
  onClick?: () => void;
  variant?: "ghost" | "primary";
  children: ReactNode;
  testId?: string;
}) {
  const primary = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="ds-ctl"
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        height: 32, padding: "0 12px", borderRadius: 8,
        fontSize: 12, fontWeight: 600, cursor: "pointer",
        fontFamily: "var(--font-sans)",
        // Ghost é transparente e sem borda (components.css do handoff): só o
        // CTA da direita carrega peso. Borda em todos empataria os três.
        background: primary ? "var(--action)" : "transparent",
        color: primary ? "var(--text-on-brand)" : "var(--text-2)",
        border: "1px solid transparent",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}
