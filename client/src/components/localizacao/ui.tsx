/**
 * Primitivas da tela de Localização.
 *
 * Um lugar só para os formatadores e as escalas, porque a tela mostra o mesmo
 * número em quatro sítios — KPI, ranking, funil e mapa — e dois deles
 * arredondando por conta própria acabam discordando na frente do operador.
 */
import type { CSSProperties, ReactNode } from "react";

/* ── Formatação ─────────────────────────────────────────────────────────── */

export const brl = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);

export const num = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR").format(n ?? 0);

/** O argumento já é percentual (0–100), não fração. */
export const pct = (n: number | null | undefined, casas = 1) =>
  `${(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

/** Ausência de dado. Nunca "0", nunca "N/D" — zero é zero e é outra coisa. */
export const TRACO = "—";

/** Todo número é mono e tabular: coluna desalinhada destrói a leitura. */
export const MONO: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums lining-nums",
};

/* ── Severidade de inadimplência ────────────────────────────────────────── */

export type Zona = "ok" | "atencao" | "critico";

/** Os limites pertencem à zona mais grave. */
export function zonaDaTaxa(p: number): Zona {
  if (p >= 18) return "critico";
  if (p >= 8) return "atencao";
  return "ok";
}

/** Um token por zona. Rampas claras reprovaram contraste no tema escuro — o
 *  trilho pastel apagava justamente a barra dos piores bairros. */
export const ZONA_META: Record<Zona, { cor: string; bg: string; borda: string }> = {
  ok:      { cor: "var(--ok)",     bg: "var(--ok-bg)",     borda: "var(--ok-border)" },
  atencao: { cor: "var(--gated)",  bg: "var(--gated-bg)",  borda: "var(--gated-border)" },
  critico: { cor: "var(--danger)", bg: "var(--danger-bg)", borda: "var(--danger-border)" },
};

export const ZONAS_LEGENDA = [
  { rotulo: "<8%",   cor: "var(--ok)" },
  { rotulo: "8–18%", cor: "var(--gated)" },
  { rotulo: "≥18%",  cor: "var(--danger)" },
];

/* ── Blocos ─────────────────────────────────────────────────────────────── */

export const CARD: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
};

export function Kicker({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 500,
      textTransform: "uppercase", letterSpacing: "var(--track-wide)",
      color: "var(--text-muted)", ...style,
    }}>
      {children}
    </span>
  );
}

/** Chip de filtro. Retangular de 4px — badge redondo é proibido no sistema. */
export function Chip({
  ativo, onClick, children, contagem, titulo, desabilitado,
}: {
  ativo: boolean;
  onClick?: () => void;
  children: ReactNode;
  contagem?: number;
  titulo?: string;
  desabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      title={titulo}
      className="ds-ctl"
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        minHeight: 28, padding: "0 10px", borderRadius: 4,
        border: `1px solid ${ativo ? "var(--brand)" : "var(--border)"}`,
        background: ativo ? "var(--brand-soft)" : "var(--surface)",
        color: ativo ? "var(--brand-ink)" : "var(--text-2)",
        fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
        cursor: desabilitado ? "not-allowed" : "pointer",
        opacity: desabilitado ? 0.5 : 1,
      }}
    >
      {children}
      {contagem !== undefined && (
        <span style={{ ...MONO, fontWeight: 500, color: ativo ? "var(--brand-ink)" : "var(--text-muted)" }}>
          {num(contagem)}
        </span>
      )}
    </button>
  );
}

/** KPI do topo: pill de ícone + rótulo, valor e sublinha. */
export function Kpi({
  icone, iconeCor, iconeBg, rotulo, valor, valorMono = true, valorCor, sub, subMono, titulo,
}: {
  icone: ReactNode;
  iconeCor: string;
  iconeBg: string;
  rotulo: string;
  valor: string;
  valorMono?: boolean;
  valorCor?: string;
  sub?: string;
  subMono?: boolean;
  titulo?: string;
}) {
  return (
    <div title={titulo} style={{ ...CARD, display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px" }}>
      <span style={{
        width: 32, height: 32, flexShrink: 0, borderRadius: 6,
        display: "grid", placeItems: "center", background: iconeBg, color: iconeCor,
      }}>
        {icone}
      </span>
      <div style={{ minWidth: 0 }}>
        <Kicker>{rotulo}</Kicker>
        <p style={{
          ...(valorMono ? MONO : null),
          fontSize: 18, fontWeight: valorMono ? 500 : 600, letterSpacing: "-0.01em",
          marginTop: 3, color: valorCor ?? "var(--text)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {valor}
        </p>
        {sub && (
          <p style={{ ...(subMono ? MONO : null), fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}
