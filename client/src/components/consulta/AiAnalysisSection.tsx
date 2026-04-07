import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, CheckCircle } from "lucide-react";
import type { ConsultaResult } from "./types";
import { renderAIText } from "./utils";

interface Props {
  result: ConsultaResult;
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
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4" data-testid="panel-ai-analysis">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-600" />
          <h4 className="text-sm font-semibold text-indigo-700">Analise Inteligente</h4>
          {aiLoading && (
            <span className="text-xs text-indigo-500 flex items-center gap-1">
              <div className="w-3 h-3 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
              Analisando...
            </span>
          )}
          {aiDone && !aiError && (
            <span className="text-xs text-emerald-600 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              Concluido
            </span>
          )}
        </div>
        {!aiLoading && (
          <Button
            size="sm"
            variant={aiText ? "outline" : "default"}
            className={aiText ? "text-xs h-7 gap-1" : "text-xs h-7 gap-1 bg-indigo-600 hover:bg-indigo-700 text-white"}
            onClick={() => runAIAnalysis(result)}
            data-testid="button-run-ai-consultation"
          >
            <Sparkles className="w-3 h-3" />
            {aiText ? "Nova Analise" : "Analisar com IA"}
          </Button>
        )}
      </div>
      {!aiText && !aiLoading && !aiError && (
        <p className="text-xs text-indigo-600/70">
          Clique em "Analisar com IA" para obter uma interpretacao especializada deste resultado.
        </p>
      )}
      {aiError && <p className="text-sm text-red-600">{aiError}</p>}
      {aiText && (
        <div className="space-y-1 mt-2">
          {renderAIText(aiText)}
          {aiLoading && <span className="inline-block w-1.5 h-4 bg-indigo-500 animate-pulse ml-0.5 rounded-sm" />}
        </div>
      )}
    </div>
  );
}
