import { useState } from "react";
import { Sparkles, CheckCircle } from "lucide-react";
import type { ConsultaResult } from "./types";
import { Kicker, ReportButton } from "./report-ui";

interface Props {
  result: ConsultaResult;
}

/**
 * Parecer do agente — texto em streaming sobre o resultado já apresentado.
 *
 * Vive dentro do card do relatório, como mais uma seção separada por hairline.
 * O parecer é comentário sobre a decisão, nunca a decisão: por isso não tem
 * tinta de estado nem cor de marca no corpo — o número e o gate acima já
 * carregam o peso, e um bloco colorido aqui competiria com eles.
 */

/** Render do texto do agente: caixa-alta vira título de bloco, hífen vira item. */
function renderParecer(text: string) {
  return text.split("\n").map((line, i) => {
    const t = line.trim();
    if (!t) return <div key={i} style={{ height: 8 }} />;

    const isTitulo = t.length > 3 && t === t.toUpperCase() && /^[A-ZÁÉÍÓÚÂÊÔÀÃÕÇ\s·—-]{4,}$/.test(t);
    if (isTitulo) {
      return (
        <Kicker key={i} style={{ marginTop: 14, marginBottom: 4, color: "var(--text-muted)" }}>
          {t}
        </Kicker>
      );
    }

    if (t.startsWith("- ") || t.startsWith("• ")) {
      return (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span style={{ color: "var(--brand-ink)", lineHeight: 1.5 }}>·</span>
          <span style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
            {t.replace(/^[-•]\s+/, "")}
          </span>
        </div>
      );
    }

    return (
      <p key={i} style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>{t}</p>
    );
  });
}

export default function AiAnalysisSection({ result }: Props) {
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const [aiError, setAiError] = useState("");

  const runAIAnalysis = async (consultaResult: ConsultaResult) => {
    setAiText("");
    setAiLoading(true);
    setAiDone(false);
    setAiError("");
    try {
      const res = await fetch("/api/ai/analyze-consultation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: consultaResult }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Erro na analise");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") { setAiDone(true); break; }
            try {
              const parsed = JSON.parse(payload);
              if (parsed.error) { setAiError(parsed.error); break; }
              if (parsed.text) setAiText(prev => prev + parsed.text);
            } catch {}
          }
        }
      }
    } catch (err: any) {
      setAiError(err.message || "Erro desconhecido");
    } finally {
      setAiLoading(false);
      setAiDone(true);
    }
  };

  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "18px 24px" }} data-testid="panel-ai-analysis">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Kicker>Parecer do agente</Kicker>
          {aiLoading && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase",
              letterSpacing: "var(--track-wide)", color: "var(--text-faint)",
            }}>
              <span style={{
                width: 10, height: 10, borderRadius: 999, boxSizing: "border-box",
                border: "2px solid var(--action)", borderTopColor: "transparent",
                animation: "ci-spin .7s linear infinite",
              }} />
              Analisando
            </span>
          )}
          {aiDone && !aiError && aiText && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase",
              letterSpacing: "var(--track-wide)", color: "var(--ok)",
            }}>
              <CheckCircle size={11} /> Concluído
            </span>
          )}
        </div>
        {!aiLoading && (
          <ReportButton
            onClick={() => runAIAnalysis(result)}
            variant={aiText ? "ghost" : "primary"}
            testId="button-run-ai-consultation"
          >
            <Sparkles size={13} />
            {aiText ? "Nova análise" : "Analisar com IA"}
          </ReportButton>
        )}
      </div>

      {!aiText && !aiLoading && !aiError && (
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55, marginTop: 10 }}>
          O agente lê o relatório acima e devolve a interpretação em texto — fatores de risco,
          padrão de comportamento e condições sugeridas. O parecer não altera o score.
        </p>
      )}

      {aiError && (
        <p style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 10 }}>{aiError}</p>
      )}

      {aiText && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 2 }}>
          {renderParecer(aiText)}
          {aiLoading && (
            <span style={{
              display: "inline-block", width: 6, height: 15,
              background: "var(--brand-ink)", borderRadius: 2, marginLeft: 2,
            }} />
          )}
        </div>
      )}
    </div>
  );
}
