import { Search } from "lucide-react";
import { formatCpfCnpj } from "./utils";
import { Kicker, pillStyle, type Tone } from "./report-ui";

interface Props {
  consultations: any[];
}

/**
 * A ultima faixa e uma SOBRA, nao uma coluna.
 *
 * Todas as colunas aqui tem conteudo de tamanho fixo — data, CPF, score,
 * parecer, custo. Sem a sobra, a unica flexivel (o documento) engolia todo o
 * espaco livre: 1058px para um CPF quando a pagina passou a usar a largura
 * cheia, com um vao no meio da linha que obrigava o olho a atravessar a tela
 * para ligar a data ao parecer.
 *
 * Com ela, as colunas ficam do tamanho do que carregam e o excedente vai para a
 * direita — a linha continua compacta em qualquer monitor.
 */
const COLUNAS = "minmax(96px, 120px) minmax(120px, 300px) 56px 64px minmax(90px, 120px) 70px 1fr";

function parecer(decisionReco: string): { label: string; tone: Tone } {
  if (decisionReco === "Accept") return { label: "Aprovar", tone: "ok" };
  if (decisionReco === "Reject") return { label: "Rejeitar", tone: "danger" };
  return { label: "Analisar", tone: "gated" };
}

function Cabecalho({ children, alinharDireita }: { children: React.ReactNode; alinharDireita?: boolean }) {
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "var(--track-wide)",
      color: "var(--text-muted)", textAlign: alinharDireita ? "right" : "left",
    }}>
      {children}
    </span>
  );
}

export default function ConsultaHistoryTab({ consultations }: Props) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "18px 24px 10px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Kicker>Consultas recentes</Kicker>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
          {consultations.length} registro{consultations.length === 1 ? "" : "s"}
        </span>
      </div>

      {consultations.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <Search size={28} style={{ margin: "0 auto 12px", color: "var(--text-faint)" }} />
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Nenhuma consulta realizada ainda</p>
        </div>
      ) : (
        <>
          <div style={{
            display: "grid", gridTemplateColumns: COLUNAS, gap: 10,
            padding: "12px 0 8px", borderBottom: "1px solid var(--border-faint)",
          }}>
            <Cabecalho>Data</Cabecalho>
            <Cabecalho>Documento</Cabecalho>
            <Cabecalho>Tipo</Cabecalho>
            <Cabecalho alinharDireita>Score</Cabecalho>
            <Cabecalho>Parecer</Cabecalho>
            <Cabecalho alinharDireita>Custo</Cabecalho>
          </div>

          {consultations.map((c: any) => {
            const p = parecer(c.decisionReco);
            const dt = c.createdAt ? new Date(c.createdAt) : null;
            return (
              <div
                key={c.id}
                data-testid={`consultation-${c.id}`}
                style={{
                  display: "grid", gridTemplateColumns: COLUNAS, gap: 10, alignItems: "center",
                  padding: "10px 0", borderBottom: "1px solid var(--border-faint)",
                }}
              >
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-2)",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {dt ? dt.toLocaleDateString("pt-BR").slice(0, 5) + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                </span>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 12,
                  fontVariantNumeric: "tabular-nums", color: "var(--text)",
                }}>
                  {formatCpfCnpj(c.cpfCnpj)}
                </span>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase",
                  letterSpacing: "var(--track-wide)", color: "var(--text-muted)",
                }}>
                  {(c.searchType || "cpf").toUpperCase()}
                </span>
                {/* O motor devolve 0-1000. O "/100" que ficava aqui vinha da escala
                    antiga e fazia 300 parecer nota fora do intervalo. */}
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600,
                  fontVariantNumeric: "tabular-nums", textAlign: "right", color: "var(--text)",
                }}>
                  {c.score ?? "—"}
                </span>
                <span style={pillStyle(p.tone)}>{p.label}</span>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase",
                  letterSpacing: "var(--track-wide)", color: "var(--text-muted)", textAlign: "right",
                }}>
                  {c.cost === 0 ? "grátis" : `${c.cost} cred.`}
                </span>
              </div>
            );
          })}
          <div style={{ height: 10 }} />
        </>
      )}
    </div>
  );
}
