import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, Trash2, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useAsaasAccount, useConnectAsaas, useDisconnectAsaas } from "@/hooks/use-asaas-account";

export default function ConfiguracoesAsaasPage() {
  const { data: account, isLoading } = useAsaasAccount();
  const connect = useConnectAsaas();
  const disconnect = useDisconnectAsaas();

  const [apiKey, setApiKey] = useState("");
  const [webhookToken, setWebhookToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await connect.mutateAsync({ apiKey, webhookToken });
      setApiKey("");
      setWebhookToken("");
    } catch (err) {
      setError((err as Error)?.message ?? "Erro desconhecido");
    }
  }

  async function handleDisconnect() {
    if (!confirm("Desconectar a conta Asaas? Isso vai suspender o Bruno automaticamente.")) return;
    setError(null);
    try {
      await disconnect.mutateAsync();
    } catch (err) {
      setError((err as Error)?.message ?? "Erro ao desconectar");
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <CreditCard className="w-6 h-6" /> Configuração Asaas
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Conecte a chave Asaas do seu provedor. O Bruno usa essa chave para gerar Pix dinâmico
          das faturas a vencer. A chave é cifrada (AES-256-GCM) antes de ser salva.
        </p>
      </div>

      {isLoading ? (
        <Card className="p-6 space-y-4">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </Card>
      ) : account?.connected ? (
        <Card className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <h2 className="font-semibold">Conta Conectada</h2>
                <Badge variant={account.mode === "production" ? "success" : "gold"}>
                  {account.mode === "production" ? "Produção" : "Sandbox"}
                </Badge>
              </div>
              <dl className="text-sm space-y-1">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Chave:</dt>
                  <dd className="font-mono">{account.maskedApiKey ?? "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Status:</dt>
                  <dd>{account.accountStatus ?? "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Última utilização:</dt>
                  <dd>{account.lastUsedAt ? new Date(account.lastUsedAt).toLocaleString("pt-BR") : "nunca"}</dd>
                </div>
              </dl>
            </div>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
              data-testid="button-disconnect-asaas"
            >
              {disconnect.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Desconectar
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          <form onSubmit={handleConnect} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">Chave Asaas (api_key)</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="$aact_prod_... ou $aact_test_..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
                minLength={20}
                data-testid="input-asaas-api-key"
              />
              <p className="text-xs text-muted-foreground">
                Encontre em: Asaas → Integrações → API e Webhooks → API Key.
                O prefixo <code>$aact_test_</code> indica sandbox; <code>$aact_prod_</code> indica produção.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhookToken">Token de Webhook</Label>
              <Input
                id="webhookToken"
                type="password"
                placeholder="Token longo aleatório (mín 16 caracteres)"
                value={webhookToken}
                onChange={(e) => setWebhookToken(e.target.value)}
                required
                minLength={16}
                data-testid="input-asaas-webhook-token"
              />
              <p className="text-xs text-muted-foreground">
                Escolha um token aleatório longo. Configure-o no Asaas → Integrações → Webhooks.
                URL do webhook: <code>https://provedor.ai/webhooks/asaas</code>.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={connect.isPending || !apiKey || !webhookToken}
              data-testid="button-connect-asaas"
            >
              {connect.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Testar e Salvar
            </Button>
          </form>
        </Card>
      )}

      <Card className="p-6 bg-muted/30">
        <h3 className="font-medium mb-2">Como funciona</h3>
        <ol className="text-sm space-y-1 list-decimal list-inside text-muted-foreground">
          <li>Você cola a chave Asaas — validamos chamando o endpoint <code>/myAccount</code> da Asaas.</li>
          <li>Detectamos automaticamente se é sandbox ou produção pelo prefixo.</li>
          <li>A chave é cifrada com AES-256-GCM antes de ser persistida.</li>
          <li>O Bruno usa essa chave para criar cobranças Pix dinâmicas D-3/D-1.</li>
          <li>O webhook Asaas chama nossa API quando pagamento é confirmado → Sofia agradece.</li>
        </ol>
      </Card>
    </div>
  );
}
