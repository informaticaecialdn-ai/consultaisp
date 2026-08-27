import type { CSSProperties, ReactNode } from "react";
import { faixaDoScore } from "./relatorio-dados";

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

/* ── Faixas do score ──────────────────────────────────────────
   Espelham server/utils/isp-score.ts. O motor decide em quatro faixas
   (701+ / 501+ / 301+ / <=300); o relatório abre a faixa alta em duas para
   distinguir "Bom" de "Excelente" na leitura — sem mudar decisão nenhuma. */
export interface Band { label: string; color: string; tone: Tone; index: number }

/** O tom de cada faixa vira a variável CSS correspondente. */
const COR_DA_FAIXA: Record<string, string> = {
  danger: "var(--danger)", past: "var(--past)", gated: "var(--gated)",
  info: "var(--now)", ok: "var(--ok)", neutral: "var(--text-muted)",
};

/**
 * As fronteiras vêm de `faixaDoScore`, em relatorio-dados.ts — o mesmo módulo
 * que o PDF usa. Estavam duplicadas aqui, e uma régua de score com duas cópias
 * é uma régua que um dia mede diferente na tela e no papel. Aqui fica só a
 * tradução de tom para variável CSS, que é assunto de pintura.
 */
export function bandOf(score: number): Band {
  const f = faixaDoScore(score);
  return { label: f.label, color: COR_DA_FAIXA[f.tom] ?? "var(--text-muted)", tone: f.tom as Tone, index: f.indice };
}

/**
 * Barra segmentada do score — as cinco faixas em linha, a ativa acesa e as
 * demais apagadas, com o marcador na posição exata do score e a régua embaixo.
 *
 * Substituiu o anel do handoff v1: o anel dizia "quanto", a barra diz "quanto E
 * onde isso cai nas faixas de decisão" — que é a pergunta que o operador faz.
 */
export function ScoreBar({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(1000, score));
  const band = bandOf(clamped);
  const cores = ["var(--danger)", "var(--past)", "var(--gated)", "var(--now)", "var(--ok)"];
  const larguras = [30, 20, 20, 15, 15];
  const regua = ["0", "300", "500", "700", "850", "1000"];

  return (
    <div style={{ position: "relative", marginTop: 18 }}>
      <div style={{ display: "flex", gap: 2 }}>
        {cores.map((c, i) => (
          <div key={i} style={{
            height: 6, borderRadius: 3, background: c,
            width: `${larguras[i]}%`,
            opacity: i === band.index ? 1 : 0.22,
          }} />
        ))}
      </div>
      <div style={{
        position: "absolute", top: -4, left: `${clamped / 10}%`,
        transform: "translateX(-50%)", width: 2, height: 14,
        background: "var(--text)", borderRadius: 1,
      }} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        {regua.map(v => (
          <span key={v} style={{
            fontFamily: "var(--font-mono)", fontSize: 9,
            fontVariantNumeric: "tabular-nums", color: "var(--text-faint)",
          }}>
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Selo de proveniência do dado — REAL (consulta ao vivo) / CACHE / SEM REDE. */
export function ProvTag({ kind }: { kind: "real" | "cache" | "sem-rede" }) {
  const cfg = kind === "real"
    ? { label: "REAL", fg: "var(--ok)", bg: "var(--ok-bg)", border: "var(--ok-border)" }
    : kind === "cache"
    ? { label: "CACHE", fg: "var(--info)", bg: "var(--info-bg)", border: "var(--info-border)" }
    : { label: "SEM REDE", fg: "var(--text-muted)", bg: "var(--surface-inset)", border: "var(--border)" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
      letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 6,
      color: cfg.fg, background: cfg.bg, border: `1px solid ${cfg.border}`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: "currentColor" }} />
      {cfg.label}
    </span>
  );
}

/** Cabeçalho de coluna das tabelas do relatório — mono 9px caixa alta. */
export function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "var(--track-wide)",
      color: "var(--text-muted)", textAlign: right ? "right" : "left",
    }}>
      {children}
    </span>
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
      data-variant={primary ? "primary" : "ghost"}
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
