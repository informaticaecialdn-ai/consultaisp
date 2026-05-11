import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageCircle,
  Zap,
  Shield,
  Send,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { useWhatsappAccount } from "@/hooks/use-whatsapp-account";
import { EmbeddedSignupButton } from "@/components/whatsapp/EmbeddedSignupButton";
import { WhatsappStatusCard } from "@/components/whatsapp/WhatsappStatusCard";

export default function ConfiguracoesWhatsappPage() {
  const { data: account, isLoading, isError, error } = useWhatsappAccount();

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          WhatsApp Business · Configuracao
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Conecte sua conta Meta WhatsApp Business para que os agentes possam enviar e receber
          mensagens em nome do seu provedor.
        </p>
      </div>

      {isLoading ? (
        <Card className="p-6 space-y-4">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-32 w-full" />
        </Card>
      ) : isError ? (
        <Card className="p-6 border-red-200 bg-red-50">
          <p className="text-red-800 text-sm">
            Erro ao carregar status: {(error as Error)?.message || "desconhecido"}
          </p>
        </Card>
      ) : account?.connected ? (
        <>
          <WhatsappStatusCard account={account} />
          <Card className="p-4 flex items-center justify-between">
            <div>
              <h3 className="font-medium">Comunicacoes</h3>
              <p className="text-sm text-muted-foreground">
                Veja o historico de mensagens enviadas e recebidas.
              </p>
            </div>
            <Link href="/comunicacoes">
              <Button variant="outline" data-testid="link-comunicacoes">
                Ver Comunicacoes <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </Card>
        </>
      ) : (
        <Card className="p-8 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-7 h-7 text-green-700" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Conta nao conectada</h2>
              <p className="text-sm text-muted-foreground">
                Conecte sua conta WhatsApp Business via Meta Embedded Signup em poucos passos.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h4 className="font-medium text-sm">Cobranca automatica</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Agentes enviam lembretes e propostas direto no WhatsApp do cliente.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded bg-green-50 flex items-center justify-center flex-shrink-0">
                <Send className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h4 className="font-medium text-sm">Templates HSM</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Use templates aprovados pela Meta para mensagens fora da janela de 24h.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded bg-purple-50 flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h4 className="font-medium text-sm">LGPD ready</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Auditoria completa, opt-out automatico via PARAR, token criptografado AES-256.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between pt-4 border-t">
            <EmbeddedSignupButton />
            <a
              href="https://business.facebook.com/business/help/2087193751603668"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline flex items-center gap-1"
            >
              Saiba mais sobre Meta Business <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="bg-muted/50 rounded p-4 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">O que vai acontecer:</p>
            <ol className="list-decimal ml-4 space-y-1">
              <li>Voce sera redirecionado para a Meta para autorizar o acesso.</li>
              <li>Selecione sua WhatsApp Business Account (ou crie uma nova).</li>
              <li>Vincule o numero de telefone que sera usado pelo agente.</li>
              <li>Retornara aqui ja conectado.</li>
            </ol>
          </div>
        </Card>
      )}
    </div>
  );
}
