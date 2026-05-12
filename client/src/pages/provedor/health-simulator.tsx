/**
 * Health Simulator — Spec 010A — página para owner testar o motor de
 * health score com cenários hipotéticos.
 *
 * Consome `POST /api/customer-health/calculate-preview` que opera sobre
 * inputs fornecidos, sem DB. Útil para:
 *   - Visualizar comportamento dos pesos atuais
 *   - Validar cálculos antes de rodar cron em produção
 *   - Demo para tenant entender o sistema
 *
 * Pré-requisito: schema customer_health_snapshots ainda não autorizado,
 * portanto esta é a única forma de ver o sistema funcionando atualmente.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { HealthScoreCard, type HealthComponents, type HealthPredictions, type HealthRecommendation } from "@/components/health/HealthScoreCard";
import type { HealthTier } from "@/components/health/HealthBadge";
import { apiRequest } from "@/lib/queryClient";

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

interface PreviewResponse {
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
  "B3 — Fiel mas oscilando (queda recente)": {
    contractMonths: 28,
    invoicesTotal: 28,
    invoicesPaid: 26,
    invoicesLate: 2,
    invoicesOverdueCurrent: 1,
    avgDaysLate30d: 8,
    avgDaysLate90d: 4,
    avgDaysLate365d: 2,
    totalRevenueAccumulatedCents: 280_000,
    brokenAgreementsCount: 1,
    ticketCount30d: 2,
    ticketCount90d: 4,
    lastInteractionDays: 5,
    avgSentimentScore90d: -0.2,
    consultaIspScore: 620,
  },
  "A1 — Novo em dia": {
    contractMonths: 2,
    invoicesTotal: 2,
    invoicesPaid: 2,
    invoicesLate: 0,
    invoicesOverdueCurrent: 0,
    avgDaysLate30d: 0,
    avgDaysLate90d: 0,
    avgDaysLate365d: null,
    totalRevenueAccumulatedCents: 20_000,
    brokenAgreementsCount: 0,
    ticketCount30d: 1,
    ticketCount90d: 1,
    lastInteractionDays: 10,
    avgSentimentScore90d: 0.4,
    consultaIspScore: 700,
  },
};

export default function HealthSimulatorPage() {
  const [inputs, setInputs] = useState<PreviewInputs>(PRESETS["A3 — Fiel em dia"]);

  const mutation = useMutation<PreviewResponse, Error, PreviewInputs>({
    mutationFn: async (body) => {
      const res = await apiRequest("POST", "/api/customer-health/calculate-preview", body);
      return res.json();
    },
  });

  const loadPreset = (name: string) => {
    setInputs(PRESETS[name]);
    mutation.reset();
  };

  const update = <K extends keyof PreviewInputs>(key: K, value: PreviewInputs[K]) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="container mx-auto py-8 px-4 space-y-6 max-w-7xl">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Simulador Customer Health 360º</h1>
        <p className="text-muted-foreground">
          Spec 010A — Teste o motor de health score com cenários hipotéticos. Útil antes
          de rodar cron em produção.
        </p>
      </div>

      {/* Presets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cenários pré-definidos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.keys(PRESETS).map((name) => (
            <Button key={name} variant="outline" size="sm" onClick={() => loadPreset(name)}>
              {name}
            </Button>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Coluna esquerda — inputs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inputs do cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Meses de contrato" value={inputs.contractMonths} onChange={(v) => update("contractMonths", v)} />
              <NumberField label="Faturas total" value={inputs.invoicesTotal} onChange={(v) => update("invoicesTotal", v)} />
              <NumberField label="Faturas pagas" value={inputs.invoicesPaid} onChange={(v) => update("invoicesPaid", v)} />
              <NumberField label="Faturas com atraso" value={inputs.invoicesLate} onChange={(v) => update("invoicesLate", v)} />
              <NumberField label="Faturas vencidas agora" value={inputs.invoicesOverdueCurrent} onChange={(v) => update("invoicesOverdueCurrent", v)} />
              <NumberField label="Quebras de acordo" value={inputs.brokenAgreementsCount} onChange={(v) => update("brokenAgreementsCount", v)} />
              <NullableNumberField label="Média dias atraso 90d" value={inputs.avgDaysLate90d} onChange={(v) => update("avgDaysLate90d", v)} />
              <NullableNumberField label="Score Consulta ISP (0-1000)" value={inputs.consultaIspScore} onChange={(v) => update("consultaIspScore", v)} />
              <NullableNumberField label="Dias desde última interação" value={inputs.lastInteractionDays} onChange={(v) => update("lastInteractionDays", v)} />
              <NumberField label="Tickets 30 dias" value={inputs.ticketCount30d} onChange={(v) => update("ticketCount30d", v)} />
            </div>

            <SentimentSlider value={inputs.avgSentimentScore90d} onChange={(v) => update("avgSentimentScore90d", v)} />

            <Button
              className="w-full"
              onClick={() => mutation.mutate(inputs)}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Calculando..." : "Calcular Health Score"}
            </Button>

            {mutation.isError && (
              <div className="text-sm text-destructive">
                Erro: {mutation.error?.message}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Coluna direita — resultado */}
        <div className="space-y-4">
          {mutation.data?.ok && mutation.data.data ? (
            <HealthScoreCard
              healthScore={mutation.data.data.healthScore}
              healthTier={mutation.data.data.healthTier}
              components={mutation.data.data.components}
              predictions={mutation.data.data.predictions}
              recommendation={mutation.data.data.recommendation}
            />
          ) : (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground py-12">
                Carregue um preset ou ajuste os inputs e clique em "Calcular".
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Subcomponents ─── */

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-8"
      />
    </div>
  );
}

function NullableNumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs flex justify-between">
        <span>{label}</span>
        <Switch
          checked={value !== null}
          onCheckedChange={(checked) => onChange(checked ? (value ?? 0) : null)}
          className="scale-75"
        />
      </Label>
      {value !== null && (
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="h-8"
        />
      )}
      {value === null && (
        <div className="h-8 flex items-center px-3 text-xs text-muted-foreground border rounded-md">null (sem dados)</div>
      )}
    </div>
  );
}

function SentimentSlider({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs flex justify-between">
        <span>Sentiment médio 90 dias (-1 a +1)</span>
        <Switch
          checked={value !== null}
          onCheckedChange={(checked) => onChange(checked ? (value ?? 0) : null)}
          className="scale-75"
        />
      </Label>
      {value !== null ? (
        <>
          <Slider
            value={[value]}
            min={-1}
            max={1}
            step={0.1}
            onValueChange={([v]) => onChange(v)}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Negativo</span>
            <span className="tabular-nums font-medium">{value.toFixed(1)}</span>
            <span>Positivo</span>
          </div>
        </>
      ) : (
        <div className="h-9 flex items-center px-3 text-xs text-muted-foreground border rounded-md">null (sem interação)</div>
      )}
    </div>
  );
}
