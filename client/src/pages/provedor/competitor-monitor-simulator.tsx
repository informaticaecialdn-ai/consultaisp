/**
 * Competitor Monitor Simulator — Spec 014 — testa heurística de classificação
 * com SERPs hipotéticas, sem chamar Serper real.
 *
 * Consome POST /api/competitor-monitor/preview-classify.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

type Classification = "new_provider" | "existing_provider" | "unrelated" | "noise";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface HeuristicResult {
  classification: Classification;
  confidence: number;
  reasoning: string;
  matchedTerms: string[];
  needsLlmReview: boolean;
}

interface ClassifiedItem {
  search: SearchResult;
  heuristic: HeuristicResult;
  needsLlm: boolean;
}

interface Stats {
  total: number;
  newProvider: number;
  existingProvider: number;
  unrelated: number;
  noise: number;
  llmReviewNeeded: number;
}

interface PreviewResponse {
  ok: boolean;
  data?: { classified: ClassifiedItem[]; stats: Stats };
  error?: string;
}

const CLASSIFICATION_STYLE: Record<Classification, string> = {
  new_provider: "bg-red-50 text-red-900 border-red-300 dark:bg-red-900/20 dark:text-red-200",
  existing_provider: "bg-blue-50 text-blue-900 border-blue-300 dark:bg-blue-900/20 dark:text-blue-200",
  unrelated: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-900 dark:text-gray-300",
  noise: "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-900/20 dark:text-amber-200",
};

const CLASSIFICATION_LABEL: Record<Classification, string> = {
  new_provider: "🚨 Novo concorrente",
  existing_provider: "Já conhecido",
  unrelated: "Não relacionado",
  noise: "Ruído",
};

const PRESET_RESULTS: SearchResult[] = [
  {
    title: "FibraX agora em Londrina e Ibiporã",
    url: "https://fibrax-internet.com.br/cobertura/londrina",
    snippet: "Provedor de internet fibra óptica chegamos em Londrina com cobertura total.",
  },
  {
    title: "Sercomtel: novo plano fibra 1 Giga",
    url: "https://www.sercomtel.com.br/planos/fibra-giga",
    snippet: "Sercomtel apresenta plano de 1 Giga em fibra em Londrina e região.",
  },
  {
    title: "Roteador Wi-Fi 6 fibra - Mercado Livre",
    url: "https://www.mercadolivre.com.br/roteador-wifi-fibra",
    snippet: "Compre roteador para internet fibra com desconto.",
  },
  {
    title: "Provedor de Internet em Cambé - Facebook",
    url: "https://facebook.com/provedor-cambe",
    snippet: "Página oficial do provedor",
  },
  {
    title: "Internet em Londrina - lista de provedores",
    url: "https://blog-tecnologia.com.br/melhores-provedores-londrina",
    snippet: "Análise comparativa dos provedores de fibra em Londrina",
  },
];

const DEFAULT_CONTEXT = {
  cities: ["Londrina", "Ibiporã", "Cambé"],
  state: "PR",
  knownCompetitors: ["Sercomtel", "Copel Telecom"],
};

export default function CompetitorMonitorSimulatorPage() {
  const [results, setResults] = useState<SearchResult[]>(PRESET_RESULTS);
  const [cities, setCities] = useState(DEFAULT_CONTEXT.cities.join(", "));
  const [state, setState] = useState(DEFAULT_CONTEXT.state);
  const [knownCompetitors, setKnownCompetitors] = useState(DEFAULT_CONTEXT.knownCompetitors.join(", "));

  const mutation = useMutation<PreviewResponse, Error, { results: SearchResult[]; context: typeof DEFAULT_CONTEXT }>({
    mutationFn: async (body) => {
      const res = await apiRequest("POST", "/api/competitor-monitor/preview-classify", body);
      return res.json();
    },
  });

  const handleClassify = () => {
    mutation.mutate({
      results,
      context: {
        cities: cities.split(",").map((s) => s.trim()).filter(Boolean),
        state,
        knownCompetitors: knownCompetitors.split(",").map((s) => s.trim()).filter(Boolean),
      },
    });
  };

  const addResult = () => setResults([...results, { title: "", url: "https://", snippet: "" }]);
  const removeResult = (i: number) => setResults(results.filter((_, idx) => idx !== i));
  const updateResult = (i: number, field: keyof SearchResult, value: string) => {
    setResults(results.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  };

  return (
    <div className="container mx-auto py-8 px-4 space-y-6 max-w-7xl">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Simulador Geo-Monitor Competitivo</h1>
        <p className="text-muted-foreground">
          Spec 014 — Classifica resultados de busca (Google SERP) detectando novos
          concorrentes regionais. Heurística pré-LLM economiza tokens downstream.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contexto do tenant</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Cidades cobertas (separadas por vírgula)</Label>
            <Input value={cities} onChange={(e) => setCities(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">UF (2 letras)</Label>
            <Input value={state} onChange={(e) => setState(e.target.value)} maxLength={2} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Concorrentes conhecidos</Label>
            <Input value={knownCompetitors} onChange={(e) => setKnownCompetitors(e.target.value)} className="h-9" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Resultados de busca</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setResults(PRESET_RESULTS); mutation.reset(); }}>
              Restaurar preset
            </Button>
            <Button variant="outline" size="sm" onClick={addResult}>
              + Adicionar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {results.map((r, i) => (
            <div key={i} className="border rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">#{i + 1}</span>
                <Input
                  value={r.title}
                  onChange={(e) => updateResult(i, "title", e.target.value)}
                  placeholder="Título"
                  className="h-8 flex-1"
                />
                <Button variant="ghost" size="sm" onClick={() => removeResult(i)}>×</Button>
              </div>
              <Input
                value={r.url}
                onChange={(e) => updateResult(i, "url", e.target.value)}
                placeholder="https://exemplo.com.br"
                className="h-8 text-xs font-mono"
              />
              <Textarea
                value={r.snippet}
                onChange={(e) => updateResult(i, "snippet", e.target.value)}
                placeholder="Snippet do resultado"
                rows={2}
                className="text-xs"
              />
            </div>
          ))}

          <Button onClick={handleClassify} disabled={mutation.isPending || results.length === 0} className="w-full">
            {mutation.isPending ? "Classificando..." : `Classificar ${results.length} resultados`}
          </Button>
        </CardContent>
      </Card>

      {mutation.data?.ok && mutation.data.data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estatísticas</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <Stat label="Total" value={mutation.data.data.stats.total} />
              <Stat label="🚨 Novos" value={mutation.data.data.stats.newProvider} highlight={mutation.data.data.stats.newProvider > 0} />
              <Stat label="Conhecidos" value={mutation.data.data.stats.existingProvider} />
              <Stat label="Irrelevantes" value={mutation.data.data.stats.unrelated + mutation.data.data.stats.noise} />
              <Stat label="Precisa LLM" value={mutation.data.data.stats.llmReviewNeeded} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Classificações</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {mutation.data.data.classified.map((c, i) => (
                <div key={i} className={cn("border rounded-md p-3 space-y-2", CLASSIFICATION_STYLE[c.heuristic.classification])}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide">
                      {CLASSIFICATION_LABEL[c.heuristic.classification]}
                    </span>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="tabular-nums">confidence {(c.heuristic.confidence * 100).toFixed(0)}%</span>
                      {c.needsLlm && <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-900 font-medium">LLM</span>}
                    </div>
                  </div>
                  <div className="text-sm font-medium">{c.search.title}</div>
                  <div className="text-xs font-mono opacity-70 truncate">{c.search.url}</div>
                  <div className="text-xs opacity-90">{c.heuristic.reasoning}</div>
                  {c.heuristic.matchedTerms.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {c.heuristic.matchedTerms.map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 bg-background/60 rounded">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={cn("rounded-md border p-3", highlight && "border-red-300 bg-red-50 dark:bg-red-900/20")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
