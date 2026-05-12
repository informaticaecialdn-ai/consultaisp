/**
 * Silent Exit Simulator — Spec 013 — simulador visual do risco de saída
 * silenciosa do cliente.
 *
 * Consome POST /api/silent-exit/preview-risk com inputs hipotéticos.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

type HealthTrend = "declining" | "stable" | "improving";

interface SilentExitInputs {
  bandwidthDropPercent: number | null;
  portalLoginCount30d: number | null;
  portalLoginCountBaseline: number | null;
  secondViaSearches30d: number;
  ticketCount30d: number;
  ticketCountBaseline: number | null;
  utmCompetitorReferrer: boolean;
  daysWithoutLogin: number | null;
  recentPlanDowngrade: boolean;
  healthScoreTrend: HealthTrend | null;
}

type RiskLevel = "noise" | "low" | "medium" | "high";

interface RiskResult {
  riskScore: number;
  riskLevel: RiskLevel;
  contributions: Record<string, number>;
  recommendedAction: string;
}

interface PreviewResponse {
  ok: boolean;
  data?: RiskResult;
  error?: string;
}

const PRESETS: Record<string, SilentExitInputs> = {
  "Cliente saudável (sem sinais)": {
    bandwidthDropPercent: null,
    portalLoginCount30d: null,
    portalLoginCountBaseline: null,
    secondViaSearches30d: 0,
    ticketCount30d: 2,
    ticketCountBaseline: 3,
    utmCompetitorReferrer: false,
    daysWithoutLogin: 10,
    recentPlanDowngrade: false,
    healthScoreTrend: "stable",
  },
  "Risco médio (queda banda + downgrade)": {
    bandwidthDropPercent: 50,
    portalLoginCount30d: null,
    portalLoginCountBaseline: null,
    secondViaSearches30d: 1,
    ticketCount30d: 1,
    ticketCountBaseline: 2,
    utmCompetitorReferrer: false,
    daysWithoutLogin: 45,
    recentPlanDowngrade: true,
    healthScoreTrend: "declining",
  },
  "Saída iminente (todos sinais)": {
    bandwidthDropPercent: 80,
    portalLoginCount30d: 30,
    portalLoginCountBaseline: 5,
    secondViaSearches30d: 3,
    ticketCount30d: 0,
    ticketCountBaseline: 5,
    utmCompetitorReferrer: true,
    daysWithoutLogin: 120,
    recentPlanDowngrade: true,
    healthScoreTrend: "declining",
  },
};

const LEVEL_LABELS: Record<RiskLevel, string> = {
  noise: "Ruído",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
};

const LEVEL_COLORS: Record<RiskLevel, string> = {
  noise: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700",
  low: "bg-blue-50 text-blue-900 border-blue-300 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-700",
  medium: "bg-orange-50 text-orange-900 border-orange-300 dark:bg-orange-900/20 dark:text-orange-200 dark:border-orange-700",
  high: "bg-red-50 text-red-900 border-red-300 dark:bg-red-900/20 dark:text-red-200 dark:border-red-700",
};

const CONTRIBUTION_LABELS: Record<string, string> = {
  bandwidthDrop60: "Queda banda ≥60%",
  bandwidthDrop40: "Queda banda 40-60%",
  portalLogin5x: "Logins portal ≥5x baseline",
  secondVia2plus: "Buscou 2ª via ≥2x",
  utmCompetitor: "UTM referrer competidor",
  ticketDecrease: "Parou de reclamar (tickets <30% baseline)",
  daysWithoutLogin90: "≥90 dias sem login",
  planDowngrade: "Plan downgrade recente",
  healthTrendDeclining: "Health score declining",
};

export default function SilentExitSimulatorPage() {
  const [inputs, setInputs] = useState<SilentExitInputs>(
    PRESETS["Cliente saudável (sem sinais)"],
  );

  const mutation = useMutation<PreviewResponse, Error, SilentExitInputs>({
    mutationFn: async (body) => {
      const res = await apiRequest("POST", "/api/silent-exit/preview-risk", body);
      return res.json();
    },
  });

  const update = <K extends keyof SilentExitInputs>(key: K, value: SilentExitInputs[K]) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="container mx-auto py-8 px-4 space-y-6 max-w-7xl">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Simulador Saída Silenciosa</h1>
        <p className="text-muted-foreground">
          Spec 013 — Detecta sinais de cliente "psicologicamente saindo" antes do
          cancelamento formal. Intervir antes da decisão = retenção 2-3× maior.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cenários pré-definidos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.keys(PRESETS).map((name) => (
            <Button key={name} variant="outline" size="sm" onClick={() => { setInputs(PRESETS[name]); mutation.reset(); }}>
              {name}
            </Button>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sinais coletados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <NullablePercentField
              label="Queda de banda (% últimos 14d vs baseline 90d)"
              value={inputs.bandwidthDropPercent}
              onChange={(v) => update("bandwidthDropPercent", v)}
            />

            <div className="grid grid-cols-2 gap-3">
              <NullableNumberField
                label="Logins portal 30d"
                value={inputs.portalLoginCount30d}
                onChange={(v) => update("portalLoginCount30d", v)}
              />
              <NullableNumberField
                label="Logins portal baseline"
                value={inputs.portalLoginCountBaseline}
                onChange={(v) => update("portalLoginCountBaseline", v)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Buscas 2ª via 30d"
                value={inputs.secondViaSearches30d}
                onChange={(v) => update("secondViaSearches30d", v)}
              />
              <NumberField
                label="Tickets 30d"
                value={inputs.ticketCount30d}
                onChange={(v) => update("ticketCount30d", v)}
              />
            </div>

            <NullableNumberField
              label="Tickets baseline (média 90d)"
              value={inputs.ticketCountBaseline}
              onChange={(v) => update("ticketCountBaseline", v)}
            />

            <NullableNumberField
              label="Dias sem login portal"
              value={inputs.daysWithoutLogin}
              onChange={(v) => update("daysWithoutLogin", v)}
            />

            <div className="grid grid-cols-2 gap-3">
              <BooleanField
                label="UTM competidor detectado?"
                value={inputs.utmCompetitorReferrer}
                onChange={(v) => update("utmCompetitorReferrer", v)}
              />
              <BooleanField
                label="Plan downgrade recente?"
                value={inputs.recentPlanDowngrade}
                onChange={(v) => update("recentPlanDowngrade", v)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Tendência healthScore</Label>
              <div className="flex gap-1">
                {(["declining", "stable", "improving"] as const).map((t) => (
                  <Button
                    key={t}
                    variant={inputs.healthScoreTrend === t ? "default" : "outline"}
                    size="sm"
                    onClick={() => update("healthScoreTrend", t)}
                    className="flex-1"
                  >
                    {t}
                  </Button>
                ))}
                <Button
                  variant={inputs.healthScoreTrend === null ? "default" : "outline"}
                  size="sm"
                  onClick={() => update("healthScoreTrend", null)}
                  className="flex-1"
                >
                  null
                </Button>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={() => mutation.mutate(inputs)}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Calculando..." : "Calcular risco"}
            </Button>

            {mutation.isError && (
              <div className="text-sm text-destructive">Erro: {mutation.error?.message}</div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {mutation.data?.ok && mutation.data.data ? (
            <RiskResultCard result={mutation.data.data} />
          ) : (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground py-12">
                Configure sinais e clique em "Calcular risco".
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function RiskResultCard({ result }: { result: RiskResult }) {
  const contributions = Object.entries(result.contributions).sort(([, a], [, b]) => b - a);
  return (
    <div className="rounded-lg border bg-card text-card-foreground p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-5xl font-bold tabular-nums leading-none">{result.riskScore}</div>
          <div className="mt-1 text-sm text-muted-foreground">risco / 100</div>
        </div>
        <span className={cn("px-3 py-1.5 rounded-full text-sm font-medium border", LEVEL_COLORS[result.riskLevel])}>
          {LEVEL_LABELS[result.riskLevel]}
        </span>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Contribuições</h3>
        {contributions.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nenhum sinal contribuiu — cliente OK.</p>
        ) : (
          <div className="space-y-1.5">
            {contributions.map(([key, value]) => (
              <div key={key} className="flex justify-between text-sm">
                <span>{CONTRIBUTION_LABELS[key] ?? key}</span>
                <span className="tabular-nums font-medium">+{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-3 border-t">
        <h3 className="text-sm font-medium text-muted-foreground mb-1">Ação sugerida</h3>
        <p className="text-sm leading-relaxed">{result.recommendedAction}</p>
      </div>
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
        <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} className="h-8" />
      ) : (
        <div className="h-8 flex items-center px-3 text-xs text-muted-foreground border rounded-md">null</div>
      )}
    </div>
  );
}

function NullablePercentField(props: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return <NullableNumberField {...props} />;
}

function BooleanField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center h-8 px-3 border rounded-md gap-2">
        <Switch checked={value} onCheckedChange={onChange} />
        <span className="text-xs text-muted-foreground">{value ? "Sim" : "Não"}</span>
      </div>
    </div>
  );
}
