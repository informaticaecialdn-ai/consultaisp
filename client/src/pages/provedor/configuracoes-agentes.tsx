import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, AlertCircle, CheckCircle2, Bot } from "lucide-react";
import {
  useAgentToggles,
  useUpdateAgentToggles,
  type AgentTogglesPatch,
} from "@/hooks/use-agent-toggles";

function toTime(value: string | null | undefined): string {
  if (!value) return "00:00";
  return value.slice(0, 5);
}

export default function ConfiguracoesAgentesPage() {
  const { data: config, isLoading } = useAgentToggles();
  const update = useUpdateAgentToggles();

  const [form, setForm] = useState<AgentTogglesPatch>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  useEffect(() => {
    if (config) {
      setForm({
        brunoAtivo: config.brunoAtivo,
        sofiaAtiva: config.sofiaAtiva,
        schedulerHoraLocal: toTime(config.schedulerHoraLocal),
        janelaInicio: toTime(config.janelaInicio),
        janelaFim: toTime(config.janelaFim),
        permiteSabado: config.permiteSabado,
        permiteDomingo: config.permiteDomingo,
        templateBrunoNome: config.templateBrunoNome,
        templateSofiaNome: config.templateSofiaNome,
      });
    }
  }, [config]);

  function patch<K extends keyof AgentTogglesPatch>(key: K, value: AgentTogglesPatch[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setError(null);
    setSuccess(false);
    try {
      await update.mutateAsync(form);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError((err as Error)?.message ?? "Erro ao salvar");
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 max-w-3xl space-y-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Bot className="w-6 h-6" /> Funcionários Digitais
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ative/desative cada agente, configure janela horária de envio e templates HSM.
          Toda mudança fica registrada em audit log para defesa em Procon/Anatel.
        </p>
      </div>

      {/* Agentes */}
      <Card className="p-6 space-y-5">
        <h2 className="font-semibold">Agentes Ativos</h2>

        <div className="flex items-start justify-between gap-4 border-b pb-4">
          <div className="space-y-0.5">
            <Label htmlFor="brunoAtivo" className="text-base">Bruno — Atendente Preventivo</Label>
            <p className="text-sm text-muted-foreground">
              Envia lembretes de fatura D-3 e D-1 antes do vencimento, com Pix anexado.
              Exige conta Asaas conectada.
            </p>
          </div>
          <Switch
            id="brunoAtivo"
            checked={!!form.brunoAtivo}
            onCheckedChange={(v) => patch("brunoAtivo", v)}
            data-testid="switch-bruno"
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="sofiaAtiva" className="text-base">Sofia — Atendente de Relacionamento</Label>
            <p className="text-sm text-muted-foreground">
              Agradece o cliente assim que o pagamento cai (webhook Asaas).
              Mensagem cordial, sem upsell.
            </p>
          </div>
          <Switch
            id="sofiaAtiva"
            checked={!!form.sofiaAtiva}
            onCheckedChange={(v) => patch("sofiaAtiva", v)}
            data-testid="switch-sofia"
          />
        </div>
      </Card>

      {/* Janela horária */}
      <Card className="p-6 space-y-5">
        <h2 className="font-semibold">Janela horária de envio (Anatel 765)</h2>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="schedulerHora">Hora do scheduler diário</Label>
            <Input
              id="schedulerHora"
              type="time"
              value={toTime(form.schedulerHoraLocal)}
              onChange={(e) => patch("schedulerHoraLocal", e.target.value)}
              data-testid="input-scheduler-hora"
            />
            <p className="text-xs text-muted-foreground">Quando o Bruno varre faturas</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="janelaInicio">Janela início</Label>
            <Input
              id="janelaInicio"
              type="time"
              value={toTime(form.janelaInicio)}
              onChange={(e) => patch("janelaInicio", e.target.value)}
              data-testid="input-janela-inicio"
            />
            <p className="text-xs text-muted-foreground">Antes disso não envia</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="janelaFim">Janela fim</Label>
            <Input
              id="janelaFim"
              type="time"
              value={toTime(form.janelaFim)}
              onChange={(e) => patch("janelaFim", e.target.value)}
              data-testid="input-janela-fim"
            />
            <p className="text-xs text-muted-foreground">Depois disso não envia</p>
          </div>
        </div>

        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={!!form.permiteSabado}
              onCheckedChange={(v) => patch("permiteSabado", !!v)}
              data-testid="checkbox-sabado"
            />
            <span className="text-sm">Permite envio aos sábados</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={!!form.permiteDomingo}
              onCheckedChange={(v) => patch("permiteDomingo", !!v)}
              data-testid="checkbox-domingo"
            />
            <span className="text-sm">Permite envio aos domingos</span>
          </label>
        </div>

        <p className="text-xs text-muted-foreground bg-muted/30 p-3 rounded">
          Anatel 765/2023 + CDC art. 71: lembretes pré-vencimento são permitidos como comunicação
          preventiva (não cobrança), mas respeitamos janela razoável. Default 08:00-20:00, sem domingo.
        </p>
      </Card>

      {/* Templates HSM */}
      <Card className="p-6 space-y-5">
        <h2 className="font-semibold">Templates HSM aprovados pelo Meta</h2>

        <div className="space-y-2">
          <Label htmlFor="templateBruno">Template Bruno (D-3/D-1)</Label>
          <Input
            id="templateBruno"
            placeholder="lembrete_prevencimento_v1"
            value={form.templateBrunoNome ?? ""}
            onChange={(e) => patch("templateBrunoNome", e.target.value || null)}
            data-testid="input-template-bruno"
          />
          <p className="text-xs text-muted-foreground">
            Nome exato do template aprovado no Meta Business Manager.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="templateSofia">Template Sofia (agradecimento)</Label>
          <Input
            id="templateSofia"
            placeholder="agradecimento_pagamento_v1"
            value={form.templateSofiaNome ?? ""}
            onChange={(e) => patch("templateSofiaNome", e.target.value || null)}
            data-testid="input-template-sofia"
          />
        </div>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={update.isPending}
          data-testid="button-save-toggles"
        >
          {update.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Salvar configurações
        </Button>
        {success && (
          <span className="text-sm text-green-600 flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" /> Salvo
          </span>
        )}
        {error && (
          <span className="text-sm text-destructive flex items-center gap-1">
            <AlertCircle className="w-4 h-4" /> {error}
          </span>
        )}
      </div>
    </div>
  );
}
