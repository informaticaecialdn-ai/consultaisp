import { Search, Clock } from "lucide-react";
import { formatCpfCnpj } from "./utils";
import { Kicker, pillStyle, type Tone } from "./report-ui";

interface TimelineEntry {
  date: string;
  score: number | null;
  decision: string | null;
  searchType: string;
  provider: string;
  alerts: string[];
  isSameProvider: boolean;
}

interface Props {
  timelineData: { timeline: TimelineEntry[] } | undefined;
  cpfCnpj: string;
  isLoading: boolean;
}

/** Faixas do motor (0-1000). Os cortes antigos eram 200/100 — escala de outro sistema. */
function parecerDe(score: number | null, decision: string | null): { label: string; tone: Tone } {
  if (decision === "Accept") return { label: "Aprovar", tone: "ok" };
  if (decision === "Reject") return { label: "Rejeitar", tone: "danger" };
  if (decision === "Review") return { label: "Analisar", tone: "gated" };
  if (score == null) return { label: "Sem score", tone: "neutral" };
  if (score > 700) return { label: "Aprovar", tone: "ok" };
  if (score > 300) return { label: "Analisar", tone: "gated" };
  return { label: "Rejeitar", tone: "danger" };
}

function Vazio({ icone: Icone, texto }: { icone: typeof Search; texto: string }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 0" }}>
      <Icone size={28} style={{ margin: "0 auto 12px", color: "var(--text-faint)" }} />
      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{texto}</p>
    </div>
  );
}

export default function TimelineTab({ timelineData, cpfCnpj, isLoading }: Props) {
  const linhas = timelineData?.timeline ?? [];

  /* Delta: quanto o score andou entre a consulta mais antiga e a mais recente.
     A API devolve do mais recente para o mais antigo. */
  const comScore = linhas.filter(e => e.score != null);
  const delta = comScore.length >= 2
    ? comScore[0].score! - comScore[comScore.length - 1].score!
    : null;
  const meses = comScore.length >= 2
    ? Math.max(1, Math.round(
        (new Date(comScore[0].date).getTime() - new Date(comScore[comScore.length - 1].date).getTime())
        / (1000 * 60 * 60 * 24 * 30),
      ))
    : null;

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "18px 24px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <Kicker>
          Evolução do documento{cpfCnpj ? ` · ${formatCpfCnpj(cpfCnpj)}` : ""}
        </Kicker>
        {delta != null && meses != null && (
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 10,
            fontVariantNumeric: "tabular-nums",
            color: delta < 0 ? "var(--past)" : delta > 0 ? "var(--ok)" : "var(--text-muted)",
          }}>
            {delta > 0 ? "+" : ""}{delta} pontos em {meses} {meses === 1 ? "mês" : "meses"}
          </span>
        )}
      </div>

      {!cpfCnpj ? (
        <Vazio icone={Search} texto="Realize uma consulta para ver a evolução do documento" />
      ) : isLoading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "48px 0" }}>
          <span style={{
            width: 12, height: 12, borderRadius: 999, boxSizing: "border-box",
            border: "2px solid var(--action)", borderTopColor: "transparent",
            animation: "ci-spin .7s linear infinite",
          }} />
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Carregando timeline…</span>
        </div>
      ) : linhas.length === 0 ? (
        <Vazio icone={Clock} texto="Nenhum histórico encontrado para este documento" />
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column" }}>
          {linhas.map((tl, i) => {
            const p = parecerDe(tl.score, tl.decision);
            return (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "110px 90px 140px 1fr",
                gap: 14, alignItems: "center", padding: "11px 0",
                borderBottom: "1px solid var(--border-faint)",
              }}>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-2)",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {new Date(tl.date).toLocaleDateString("pt-BR")}
                </span>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600,
                  fontVariantNumeric: "tabular-nums", color: "var(--text)",
                }}>
                  {tl.score ?? "—"}
                </span>
                <span style={pillStyle(p.tone)}>{p.label}</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {tl.isSameProvider ? "Sua consulta" : "Provedor parceiro"} · {tl.provider}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
