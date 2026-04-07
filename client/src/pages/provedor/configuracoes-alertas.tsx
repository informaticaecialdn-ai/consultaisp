import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Bell, Webhook, Send, Check, Clock, Loader2 } from "lucide-react";

interface AlertSettings {
  proactiveAlertsEnabled: boolean;
  webhookUrl: string;
}

interface ProactiveAlert {
  id: number;
  cpfCnpj: string;
  channel: string;
  sentAt: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

function maskCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.***.***.${digits.slice(9)}`;
  }
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}

export default function ConfiguracoesAlertas() {
  const { toast } = useToast();
  const [webhookUrl, setWebhookUrl] = useState("");

  const { data: settings, isLoading: settingsLoading } = useQuery<AlertSettings>({
    queryKey: ["/api/providers/alert-settings"],
    staleTime: 30_000,
  });

  const { data: alerts = [], isLoading: alertsLoading } = useQuery<ProactiveAlert[]>({
    queryKey: ["/api/providers/proactive-alerts"],
    staleTime: 30_000,
  });

  // Sync local state when settings load
  useState(() => {
    if (settings?.webhookUrl) setWebhookUrl(settings.webhookUrl);
  });

  const updateSettings = useMutation({
    mutationFn: async (data: Partial<AlertSettings>) => {
      const res = await apiRequest("PUT", "/api/providers/alert-settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/providers/alert-settings"] });
      toast({ title: "Configuracoes salvas" });
    },
    onError: () => {
      toast({ title: "Erro ao salvar configuracoes", variant: "destructive" });
    },
  });

  const testWebhook = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/providers/alert-settings/test-webhook", { webhookUrl: url });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "Webhook testado com sucesso", description: `Status: ${data.status}` });
      } else {
        toast({ title: "Webhook respondeu com erro", description: `Status: ${data.status}`, variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "Falha ao testar webhook", variant: "destructive" });
    },
  });

  const acknowledgeAlert = useMutation({
    mutationFn: async (alertId: number) => {
      const res = await apiRequest("PATCH", `/api/providers/proactive-alerts/${alertId}/acknowledge`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/providers/proactive-alerts"] });
    },
  });

  const handleToggle = (enabled: boolean) => {
    updateSettings.mutate({ proactiveAlertsEnabled: enabled, webhookUrl: webhookUrl || "" });
  };

  const handleSaveWebhook = () => {
    updateSettings.mutate({
      proactiveAlertsEnabled: settings?.proactiveAlertsEnabled ?? true,
      webhookUrl,
    });
  };

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Alertas Proativos</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Receba notificacoes quando um cliente seu for consultado por outro provedor
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Configuracoes de Alerta
          </CardTitle>
          <CardDescription>
            Quando outro provedor consultar o CPF de um cliente ativo seu, voce sera notificado por email.
            A identidade do provedor que consultou nunca e revelada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Receber alertas de migracao</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ativar notificacao por email quando seu cliente for consultado
              </p>
            </div>
            <Switch
              checked={settings?.proactiveAlertsEnabled ?? true}
              onCheckedChange={handleToggle}
              disabled={updateSettings.isPending}
            />
          </div>

          <hr />

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Webhook className="w-4 h-4 text-muted-foreground" />
              <Label className="text-sm font-medium">URL de Webhook (opcional)</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Alem do email, receba alertas via POST HTTP no seu sistema
            </p>
            <div className="flex gap-2">
              <Input
                value={webhookUrl || settings?.webhookUrl || ""}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://seu-sistema.com/webhook/alertas"
                className="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => testWebhook.mutate(webhookUrl || settings?.webhookUrl || "")}
                disabled={testWebhook.isPending || !(webhookUrl || settings?.webhookUrl)}
              >
                {testWebhook.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span className="ml-1.5">Testar</span>
              </Button>
            </div>
            <Button size="sm" onClick={handleSaveWebhook} disabled={updateSettings.isPending}>
              Salvar Webhook
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Ultimos Alertas Recebidos
          </CardTitle>
          <CardDescription>
            Historico de alertas proativos de migracao
          </CardDescription>
        </CardHeader>
        <CardContent>
          {alertsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Nenhum alerta recebido ainda
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CPF/CNPJ</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell className="font-mono text-sm">{maskCpf(alert.cpfCnpj)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {alert.channel === "both" ? "Email + Webhook" : alert.channel === "webhook" ? "Webhook" : "Email"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(alert.sentAt).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      {alert.acknowledged ? (
                        <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400">
                          <Check className="w-3 h-3 mr-1" />
                          Confirmado
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                          Pendente
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!alert.acknowledged && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => acknowledgeAlert.mutate(alert.id)}
                          disabled={acknowledgeAlert.isPending}
                        >
                          <Check className="w-4 h-4 mr-1" />
                          Confirmar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
