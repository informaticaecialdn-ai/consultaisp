/**
 * Pix Dynamic Simulator — Spec 009 — visualiza tiers temporais de uma oferta
 * Pix dinâmica e simula evolução no tempo.
 *
 * Consome POST /api/pix-dynamic/preview-offer.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

interface ResolvedTier {
  index: number;
  discountPercent: number;
  amountCents: number;
  label: string;
  validFrom: string;
  validUntil: string;
}

interface OfferState {
  currentTier: ResolvedTier | null;
  nextTier: ResolvedTier | null;
  nextTransitionAt: string | null;
  finalExpiresAt: string;
  isExpired: boolean;
}

interface PreviewResponse {
  ok: boolean;
  data?: {
    config: { baseAmountCents: number; createdAt: string; now: string };
    resolvedTiers: ResolvedTier[];
    state: OfferState;
    customerText: string[];
  };
  error?: string;
}

function formatBrl(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

export default function PixDynamicSimulatorPage() {
  // Default: oferta criada agora, baseAmount R$ 99,90
  const nowIso = new Date().toISOString();
  const [baseAmountCents, setBaseAmountCents] = useState(9990);
  const [createdAt] = useState(nowIso);
  // hoursAfterCreation: simular momento X horas após criação
  const [hoursAfterCreation, setHoursAfterCreation] = useState(0);

  const mutation = useMutation<PreviewResponse, Error, void>({
    mutationFn: async () => {
      const created = new Date(createdAt);
      const simulatedNow = new Date(created.getTime() + hoursAfterCreation * 3600 * 1000);
      const res = await apiRequest("POST", "/api/pix-dynamic/preview-offer", {
        baseAmountCents,
        createdAt,
        now: simulatedNow.toISOString(),
      });
      return res.json();
    },
  });

  return (
    <div className="container mx-auto py-8 px-4 space-y-6 max-w-7xl">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Simulador Pix Dinâmico</h1>
        <p className="text-muted-foreground">
          Spec 009 — Oferta em camadas temporais com decay progressivo de desconto.
          Comportamental Kahneman: cliente paga rápido para garantir desconto.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuração da oferta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1">
              <Label className="text-xs">Valor base (centavos — sem desconto)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={baseAmountCents}
                  onChange={(e) => setBaseAmountCents(Number(e.target.value) || 100)}
                  className="h-9"
                  min={100}
                />
                <span className="text-sm text-muted-foreground tabular-nums">= R$ {formatBrl(baseAmountCents)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs flex justify-between">
                <span>Simular momento (horas após criação)</span>
                <span className="font-medium tabular-nums">{hoursAfterCreation}h</span>
              </Label>
              <Slider
                value={[hoursAfterCreation]}
                min={0}
                max={28}
                step={0.5}
                onValueChange={([v]) => setHoursAfterCreation(v)}
              />
              <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
                <span>0h (tier 0)</span>
                <span>2h (tier 1)</span>
                <span>6h (tier 2)</span>
                <span>24h+ (expirado)</span>
              </div>
            </div>

            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              <div>Default tiers (Spec 009):</div>
              <div>• Tier 0: primeiras 2h — <strong>10% off</strong></div>
              <div>• Tier 1: próximas 4h — <strong>5% off</strong></div>
              <div>• Tier 2: 18h restantes — valor cheio</div>
            </div>

            <Button className="w-full" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? "Calculando..." : "Calcular tiers"}
            </Button>

            {mutation.isError && (
              <div className="text-sm text-destructive">Erro: {mutation.error?.message}</div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {mutation.data?.ok && mutation.data.data ? (
            <OfferResultCard data={mutation.data.data} />
          ) : (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground py-12">
                Configure o valor e clique em "Calcular tiers".
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function OfferResultCard({ data }: { data: NonNullable<PreviewResponse["data"]> }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estado atual da oferta</CardTitle>
        </CardHeader>
        <CardContent>
          {data.state.isExpired ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-2">⏰</div>
              <div className="font-medium text-orange-700 dark:text-orange-300">Oferta expirada</div>
              <div className="text-xs text-muted-foreground mt-1">
                Final em {formatTime(data.state.finalExpiresAt)}. Fluxo padrão de cobrança assume.
              </div>
            </div>
          ) : data.state.currentTier ? (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-3xl font-bold tabular-nums">
                    R$ {formatBrl(data.state.currentTier.amountCents)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{data.state.currentTier.label}</div>
                </div>
                {data.state.currentTier.discountPercent > 0 && (
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-50 text-green-900 border border-green-300 dark:bg-green-900/20 dark:text-green-200">
                    {data.state.currentTier.discountPercent}% off
                  </span>
                )}
              </div>

              <div className="text-xs text-muted-foreground">
                Válido até <strong>{formatTime(data.state.currentTier.validUntil)}</strong>
              </div>

              {data.state.nextTier && (
                <div className="pt-3 border-t text-xs text-muted-foreground">
                  Próximo tier em <strong>{formatTime(data.state.nextTransitionAt!)}</strong>:
                  R$ {formatBrl(data.state.nextTier.amountCents)} ({data.state.nextTier.discountPercent}% off)
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Sem tier ativo neste momento.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline dos tiers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.resolvedTiers.map((t) => {
            const isActive = data.state.currentTier?.index === t.index;
            return (
              <div
                key={t.index}
                className={cn(
                  "border rounded-md p-3 transition-colors",
                  isActive ? "bg-primary/10 border-primary" : "bg-card",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">
                    {isActive && "▶ "}Tier {t.index} — {t.label}
                  </div>
                  <div className="text-sm tabular-nums">
                    R$ {formatBrl(t.amountCents)}
                    {t.discountPercent > 0 && (
                      <span className="ml-2 text-xs text-green-700 dark:text-green-300">
                        -{t.discountPercent}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-1 font-mono">
                  {formatTime(t.validFrom)} → {formatTime(t.validUntil)}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mensagem enviada ao cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm border-l-2 border-primary/40 pl-3">
            {data.customerText.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
