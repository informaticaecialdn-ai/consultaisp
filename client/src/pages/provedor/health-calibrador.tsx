/**
 * Health Calibrador — Spec 010A — owner ajusta os 6 pesos do health score
 * e vê impacto comparativo (default vs custom) lado-a-lado.
 *
 * Útil para:
 *   - Calibrar prioridades regionais (provedor de bairro pobre pode valorizar
 *     mais fidelidade vs pontualidade)
 *   - Testar sensibilidade antes de aplicar pesos custom tenant-wide
 *   - Validar que tier critical não é gerado em excesso (precision check)
 *
 * Consome:
 *   - POST /api/customer-health/calculate-preview (default weights)
 *   - POST /api/customer-health/calibrate (custom weights)
 */

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { HealthScoreCard, type HealthComponents, type HealthPredictions, type HealthRecommendation } from "@/components/health/HealthScoreCard";
import type { HealthTier } from "@/components/health/HealthBadge";
import { AlertCircle } from "lucide-react";

interface PreviewInputs {
  contractMonths: number;
  invoicesTotal: number;
  invoicesPaid: number;
  invoicesLate: number;
  invoicesOverdueCurrent: number;
  avgDaysLate30d: number | null;
  avgDaysLate90d: number | null;
  avgDaysLate365d: number | null;
  totalRevenueAccumulatedCents: number;
  brokenAgreementsCount: number;
  ticketCount30d: number;
  ticketCount90d: number;
  lastInteractionDays: number | null;
  avgSentimentScore90d: number | null;
  consultaIspScore: number | null;
}

interface HealthWeights {
  punctuality: number;
  loyalty: number;
  reliability: number;
  sentiment: number;
  engagement: number;
  externalScore: number;
}

interface ScoreResponse {
  ok: boolean;
  data?: {
    healthScore: number;
    healthTier: HealthTier;
    components: HealthComponents;
    predictions: HealthPredictions;
    recommendation: HealthRecommendation;
  };
  error?: string;
}

const DEFAULT_WEIGHTS: HealthWeights = {
  punctuality: 0.35,
  loyalty: 0.15,
  reliability: 0.15,
  sentiment: 0.1,
  engagement: 0.1,
  externalScore: 0.15,
};

const PRESETS: Record<string, PreviewInputs> = {
  "A3 — Fiel em dia": {
    contractMonths: 36,
    invoicesTotal: 36,
    invoicesPaid: 36,
    invoicesLate: 0,
    invoicesOverdueCurrent: 0,
    avgDaysLate30d: 0,
    avgDaysLate90d: 0,
    avgDaysLate365d: 1,
    totalRevenueAccumulatedCents: 360_000,
    brokenAgreementsCount: 0,
    ticketCount30d: 0,
    ticketCount90d: 1,
    lastInteractionDays: 30,
    avgSentimentScore90d: 0.6,
    consultaIspScore: 850,
  },
  "B2 — Oscila médio prazo": {
    contractMonths: 14,
    invoicesTotal: 14,
    invoicesPaid: 12,
    invoicesLate: 4,
    invoicesOverdueCurrent: 1,
    avgDaysLate30d: 7,
    avgDaysLate90d: 6,
    avgDaysLate365d: 5,
    totalRevenueAccumulatedCents: 140_000,
    brokenAgreementsCount: 1,
    ticketCount30d: 1,
    ticketCount90d: 3,
    lastInteractionDays: 12,
    avgSentimentScore90d: 0.0,
    consultaIspScore: 500,
  },
  "C3 — Crônico alto-risco": {
    contractMonths: 18,
    invoicesTotal: 18,
    invoicesPaid: 12,
    invoicesLate: 8,
    invoicesOverdueCurrent: 2,
    avgDaysLate30d: 12,
    avgDaysLate90d: 18,
    avgDaysLate365d: 22,
    totalRevenueAccumulatedCents: 120_000,
    brokenAgreementsCount: 4,
    ticketCount30d: 0,
    ticketCount90d: 2,
    lastInteractionDays: 60,
    avgSentimentScore90d: -0.3,
    consultaIspScore: 180,
  },
};

const COMPONENT_LABELS: Record<keyof HealthWeights, string> = {
  punctuality: "Pontualidade",
  loyalty: "Fidelidade",
  reliability: "Confiabilidade",
  sentiment: "Sentimento",
  engagement: "Engajamento",
  externalScore: "Score externo",
};

export default function HealthCalibradorPage() {
  const [inputs, setInputs] = useState<PreviewInputs>(PRESETS["B2 — Oscila médio prazo"]);
  const [weights, setWeights] = useState<HealthWeights>(DEFAULT_WEIGHTS);

  // Soma dos pesos deve ser 1.0 (UI mostra erro se não está)
  const weightSum = Object.values(weights).reduce((s, v) => s + v, 0);
  const sumOk = Math.abs(weightSum - 1) < 0.01;

  const defaultMutation = useMutation<ScoreResponse, Error, PreviewInputs>({
    mutationFn: async (body) => {
      const res = await apiRequest("POST", "/api/customer-health/calculate-preview", body);
      return res.json();
    },
  });

  const customMutation = useMutation<ScoreResponse, Error, { inputs: PreviewInputs; weights: HealthWeights }>({
    mutationFn: async (body) => {
      const res = await apiRequest("POST", "/api/customer-health/calibrate", body);
      return res.json();
    },
  });

  // Recalcula automaticamente quando inputs ou weights mudam (debounced via mutation cache)
  useEffect(() => {
    defaultMutation.mutate(inputs);
    if (sumOk) {
      customMutation.mutate({ inputs, weights });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, weights, sumOk]);

  const updateWeight = (key: keyof HealthWeights, value: number) => {
    setWeights((prev) => ({ ...prev, [key]: value }));
  };

  /** Normaliza proporcionalmente para somar exatamente 1.0 */
  const normalizeWeights = () => {
    const sum = Object.values(weights).reduce((s, v) => s + v, 0);
    if (sum === 0) {
      setWeights(DEFAULT_WEIGHTS);
      return;
    }
    setWeights({
      punctuality: weights.punctuality / sum,
      loyalty: weights.loyalty / sum,
      reliability: weights.reliability / sum,
      sentiment: weights.sentiment / sum,
      engagement: weights.engagement / sum,
      externalScore: weights.externalScore / sum,
    });
  };

  const scoreDiff =
    defaultMutation.data?.data && customMutation.data?.data
      ? customMutation.data.data.healthScore - defaultMutation.data.data.healthScore
      : 0;

  return (
    <div className="container mx-auto py-8 px-4 space-y-6 max-w-7xl">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Calibrador de Pesos — Health Score</h1>
        <p className="text-muted-foreground">
          Spec 010A — Ajuste os 6 pesos do health score e veja impacto comparativo
          lado-a-lado (default vs custom). Útil para calibrar prioridades regionais
          ou validar precision do tier critical.
        </p>
      </div>

      {/* Presets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cenário de cliente</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.keys(PRESETS).map((name) => (
            <Button
              key={name}
              variant="outline"
              size="sm"
              onClick={() => setInputs(PRESETS[name])}
            >
              {name}
            </Button>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Coluna 1 — Sliders de pesos */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <div className="flex justify-between items-start">
              <CardTitle className="text-base">Pesos customizados</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setWeights(DEFAULT_WEIGHTS)}>
                Resetar default
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(Object.keys(weights) as Array<keyof HealthWeights>).map((key) => (
              <div key={key} className="space-y-2">
                <div className="flex justify-between items-baseline text-sm">
                  <Label className="font-medium">{COMPONENT_LABELS[key]}</Label>
                  <span className="tabular-nums">
                    <span className="text-base font-semibold">{(weights[key] * 100).toFixed(0)}%</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      default {(DEFAULT_WEIGHTS[key] * 100).toFixed(0)}%
                    </span>
                  </span>
                </div>
                <Slider
                  value={[Math.round(weights[key] * 100)]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={([v]) => updateWeight(key, v / 100)}
                />
              </div>
            ))}

            <div className={cn("p-3 rounded-md border text-sm flex items-center justify-between", sumOk ? "bg-green-50 border-green-300 text-green-900 dark:bg-green-900/20 dark:text-green-200" : "bg-orange-50 border-orange-300 text-orange-900 dark:bg-orange-900/20 dark:text-orange-200")}>
              <span>
                Soma: <strong className="tabular-nums">{(weightSum * 100).toFixed(1)}%</strong>
                {sumOk ? " ✓" : " (deve ser 100%)"}
              </span>
              {!sumOk && (
                <Button size="sm" variant="outline" onClick={normalizeWeights}>
                  Normalizar
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Coluna 2 — Resultado default */}
        <div className="space-y-3">
          <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Default (pesos canônicos)
          </div>
          {defaultMutation.data?.ok && defaultMutation.data.data ? (
            <HealthScoreCard
              healthScore={defaultMutation.data.data.healthScore}
              healthTier={defaultMutation.data.data.healthTier}
              components={defaultMutation.data.data.components}
              predictions={defaultMutation.data.data.predictions}
              recommendation={defaultMutation.data.data.recommendation}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                {defaultMutation.isPending ? "Calculando..." : "—"}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Coluna 3 — Resultado custom */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Custom (pesos ajustados)
            </div>
            {customMutation.data?.data && defaultMutation.data?.data && scoreDiff !== 0 && (
              <span
                className={cn(
                  "px-2 py-0.5 rounded-md text-xs font-bold tabular-nums",
                  scoreDiff > 0
                    ? "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200"
                    : "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200",
                )}
              >
                {scoreDiff > 0 ? "+" : ""}{scoreDiff}
              </span>
            )}
          </div>

          {!sumOk ? (
            <Card className="border-orange-300">
              <CardContent className="py-12 text-center text-sm flex items-center justify-center gap-2 text-orange-700 dark:text-orange-300">
                <AlertCircle className="w-4 h-4" />
                Soma dos pesos deve ser 100%
              </CardContent>
            </Card>
          ) : customMutation.data?.ok && customMutation.data.data ? (
            <HealthScoreCard
              healthScore={customMutation.data.data.healthScore}
              healthTier={customMutation.data.data.healthTier}
              components={customMutation.data.data.components}
              predictions={customMutation.data.data.predictions}
              recommendation={customMutation.data.data.recommendation}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                {customMutation.isPending ? "Calculando..." : "—"}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Tabela de inputs editáveis (collapsed default — owner pode expandir) */}
      <details className="rounded-lg border bg-card">
        <summary className="p-4 cursor-pointer font-medium text-sm">
          Inputs do cliente (clique para editar)
        </summary>
        <div className="p-4 pt-0 grid grid-cols-2 md:grid-cols-3 gap-3">
          <NumberField label="Meses contrato" value={inputs.contractMonths} onChange={(v) => setInputs({ ...inputs, contractMonths: v })} />
          <NumberField label="Faturas total" value={inputs.invoicesTotal} onChange={(v) => setInputs({ ...inputs, invoicesTotal: v })} />
          <NumberField label="Faturas atrasadas" value={inputs.invoicesLate} onChange={(v) => setInputs({ ...inputs, invoicesLate: v })} />
          <NumberField label="Vencidas agora" value={inputs.invoicesOverdueCurrent} onChange={(v) => setInputs({ ...inputs, invoicesOverdueCurrent: v })} />
          <NumberField label="Quebras de acordo" value={inputs.brokenAgreementsCount} onChange={(v) => setInputs({ ...inputs, brokenAgreementsCount: v })} />
          <NullableNumberField label="Avg dias atraso 90d" value={inputs.avgDaysLate90d} onChange={(v) => setInputs({ ...inputs, avgDaysLate90d: v })} />
          <NullableNumberField label="Score ISP (0-1000)" value={inputs.consultaIspScore} onChange={(v) => setInputs({ ...inputs, consultaIspScore: v })} />
          <NullableNumberField label="Dias última interação" value={inputs.lastInteractionDays} onChange={(v) => setInputs({ ...inputs, lastInteractionDays: v })} />
          <NullableNumberField label="Sentiment 90d (-1 a +1)" value={inputs.avgSentimentScore90d} onChange={(v) => setInputs({ ...inputs, avgSentimentScore90d: v })} />
        </div>
      </details>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} className="h-8" />
    </div>
  );
}

function NullableNumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs flex justify-between">
        <span>{label}</span>
        <Switch checked={value !== null} onCheckedChange={(c) => onChange(c ? (value ?? 0) : null)} className="scale-75" />
      </Label>
      {value !== null ? (
        <Input type="number" step="0.1" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} className="h-8" />
      ) : (
        <div className="h-8 flex items-center px-3 text-xs text-muted-foreground border rounded-md">null</div>
      )}
    </div>
  );
}
