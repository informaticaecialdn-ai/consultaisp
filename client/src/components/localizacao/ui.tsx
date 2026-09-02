/**
 * Primitivas da tela de Localização.
 *
 * Um lugar só para os formatadores e as escalas, porque a tela mostra o mesmo
 * número em quatro sítios — KPI, ranking, funil e mapa — e dois deles
 * arredondando por conta própria acabam discordando na frente do operador.
 *
 * A anatomia segue a referência (Provedor.ai · Cobrança · Localização v3):
 * chip de filtro, pill de camada com dot, controle segmentado e a régua
 * absoluta das zonas. A geometria é a da pele: raio 4, borda de 1px, nada de
 * pill redondo.
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

/**
 * Trilho da barra do ranking: régua ABSOLUTA 0–100% tingida pelas zonas de
 * corte. 13,9% desenha 13,9% da largura sempre, e a barra cruza as faixas do
 * trilho — o olho lê em que zona o bairro está sem consultar a legenda.
 */
export const TRILHO_REGUA =
  "linear-gradient(90deg, var(--ok-bg) 0 8%, var(--gated-bg) 8% 18%, var(--danger-bg) 18% 100%)";

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
      aria-pressed={ativo}
      className="ds-ctl ds-chip"
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        minHeight: 28, padding: "0 11px", borderRadius: 4,
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

/**
 * Grupo de camadas do cabeçalho do mapa (`.layers` da referência): um trilho
 * rebaixado com as pills dentro. Ligada = superfície + anel; desligada =
 * transparente com o dot cinza.
 */
export function GrupoCamadas({ children }: { children: ReactNode }) {
  return (
    <div style={{
      display: "inline-flex", flexWrap: "wrap", gap: 4, padding: 3,
      border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface-2)",
    }}>
      {children}
    </div>
  );
}

/**
 * Pill de camada com dot de estado. Desabilitada continua clicável para o
 * tooltip: o operador precisa saber que a camada existe e o que falta para
 * ela aparecer — sumir da tela seria pior. O `onClick` é guardado em vez do
 * atributo `disabled`, que engole o title.
 */
export function Camada({
  label, dot, ligada, desabilitada, titulo, onToggle, extra,
}: {
  label: string;
  /** Cor do dot quando ligada. */
  dot: string;
  ligada: boolean;
  desabilitada?: boolean;
  titulo?: string;
  onToggle?: () => void;
  /** Contagem ou sufixo mono, opcional. */
  extra?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ligada}
      aria-disabled={desabilitada}
      title={titulo}
      onClick={desabilitada ? undefined : onToggle}
      className="ds-ctl"
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        height: 24, padding: "0 10px", border: 0, borderRadius: 4,
        background: ligada ? "var(--surface)" : "transparent",
        color: ligada ? "var(--text)" : desabilitada ? "var(--text-faint)" : "var(--text-muted)",
        boxShadow: ligada ? "0 0 0 1px var(--ring-subtle)" : "none",
        fontSize: 11, fontWeight: 500, whiteSpace: "nowrap",
        cursor: desabilitada ? "not-allowed" : "pointer",
      }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
        background: ligada ? dot : "var(--border-strong)",
      }} />
      {label}
      {extra}
    </button>
  );
}

/** Controle segmentado (ordenação do ranking): o ativo sobe em superfície. */
export function Segmentado<T extends string>({
  opcoes, valor, onChange, rotulo,
}: {
  opcoes: Array<{ k: T; rotulo: string }>;
  valor: T;
  onChange: (v: T) => void;
  rotulo: string;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} style={{
      display: "inline-flex", gap: 2, padding: 3,
      background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4,
    }}>
      {opcoes.map(o => {
        const ativo = valor === o.k;
        return (
          <button
            key={o.k}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onChange(o.k)}
            className="ds-ctl"
            style={{
              height: 24, padding: "0 10px", border: 0, borderRadius: 4,
              background: ativo ? "var(--surface)" : "transparent",
              color: ativo ? "var(--brand-ink)" : "var(--text-muted)",
              boxShadow: ativo ? "0 0 0 1px var(--ring-subtle)" : "none",
              fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", cursor: "pointer",
            }}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

/** Selo mono pequeno — proveniência ou data (`ERP · 31/08/26`). */
export function Selo({ children, titulo }: { children: ReactNode; titulo?: string }) {
  return (
    <span title={titulo} style={{
      ...MONO, fontSize: 10, padding: "3px 7px", borderRadius: 4,
      background: "var(--surface-inset)", color: "var(--text-muted)", whiteSpace: "nowrap",
    }}>
      {children}
    </span>
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
