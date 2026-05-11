import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageCircle, AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { WhatsappAccountResponse } from "@/hooks/use-whatsapp-account";
import { useDisconnectWhatsapp } from "@/hooks/use-whatsapp-account";
import { useToast } from "@/hooks/use-toast";

interface Props {
  account: WhatsappAccountResponse;
}

function formatPhoneNumberId(id?: string) {
  if (!id) return "—";
  // phoneNumberId é numérico Meta. Não temos display_phone_number direto, então
  // exibimos o display_name + o ID com mascaramento parcial.
  if (id.length <= 6) return id;
  return `${id.slice(0, 4)}••••${id.slice(-4)}`;
}

function QualityBadge({ rating }: { rating?: string | null }) {
  if (!rating) {
    return <Badge variant="secondary">Sem dados</Badge>;
  }
  const r = rating.toUpperCase();
  if (r === "GREEN") {
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-300">
        <CheckCircle2 className="w-3 h-3 mr-1" /> Verde (excelente)
      </Badge>
    );
  }
  if (r === "YELLOW") {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-300">
        <AlertTriangle className="w-3 h-3 mr-1" /> Amarelo (atencao)
      </Badge>
    );
  }
  if (r === "RED") {
    return (
      <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-red-300">
        <XCircle className="w-3 h-3 mr-1" /> Vermelho (risco)
      </Badge>
    );
  }
  return <Badge variant="secondary">{rating}</Badge>;
}

function WabaStatusBadge({ status }: { status?: string | null }) {
  const s = (status || "pending").toLowerCase();
  if (s === "verified") {
    return <Badge className="bg-green-100 text-green-800 border-green-300">Verificada</Badge>;
  }
  if (s === "revoked") {
    return <Badge className="bg-red-100 text-red-800 border-red-300">Revogada</Badge>;
  }
  return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">Pendente</Badge>;
}

export function WhatsappStatusCard({ account }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const disconnect = useDisconnectWhatsapp();
  const { toast } = useToast();

  const tokenExp = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;
  const daysLeft = tokenExp
    ? Math.ceil((tokenExp.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const tokenWarning = daysLeft !== null && daysLeft < 15;

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      toast({ title: "Desconectado", description: "Conta WhatsApp foi desconectada." });
      setConfirmOpen(false);
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err?.message ?? "Falha ao desconectar",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Card className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <MessageCircle className="w-6 h-6 text-green-700" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">
                {account.displayName || "WhatsApp Business"}
              </h3>
              <p className="text-sm text-muted-foreground">
                Phone ID: {formatPhoneNumberId(account.phoneNumberId)}
              </p>
            </div>
          </div>
          <WabaStatusBadge status={account.wabaStatus} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Quality Rating
            </p>
            <QualityBadge rating={account.qualityRating} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              WABA ID
            </p>
            <code className="text-xs bg-muted px-2 py-1 rounded">
              {account.wabaId || "—"}
            </code>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Token expira em
            </p>
            <div className={`flex items-center gap-2 text-sm ${tokenWarning ? "text-red-600 font-medium" : ""}`}>
              <Clock className="w-4 h-4" />
              {tokenExp ? (
                <>
                  {tokenExp.toLocaleDateString("pt-BR")}{" "}
                  <span className="text-xs">
                    ({daysLeft !== null ? `${daysLeft} dia(s)` : ""})
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Sem expiracao definida</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Conectado em
            </p>
            <p className="text-sm">
              {account.createdAt
                ? new Date(account.createdAt).toLocaleDateString("pt-BR")
                : "—"}
            </p>
          </div>
        </div>

        {tokenWarning && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              Seu token expira em menos de 15 dias. Reconecte para evitar interrupcao nos envios.
            </span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            disabled={disconnect.isPending}
            data-testid="button-whatsapp-disconnect"
          >
            Desconectar
          </Button>
        </div>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar WhatsApp Business?</DialogTitle>
            <DialogDescription>
              Apos desconectar, os agentes nao poderao mais enviar nem receber mensagens via
              WhatsApp. O historico de comunicacoes sera preservado. Voce podera reconectar a
              qualquer momento.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={disconnect.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? "Desconectando..." : "Confirmar desconexao"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
