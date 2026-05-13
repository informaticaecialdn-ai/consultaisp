import { useState } from "react";
import { useRoute } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, ShieldCheck } from "lucide-react";
import { DossieExportButton } from "@/components/dossie/DossieExportButton";
import { CustomerHealthPanel } from "@/components/health/CustomerHealthPanel";

function defaultPeriod() {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 24 * 3600 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default function ClienteDossiePage() {
  const [, params] = useRoute("/cliente/:customerId/dossie");
  const customerId = Number(params?.customerId ?? 0);

  const def = defaultPeriod();
  const [from, setFrom] = useState<string>(def.from);
  const [to, setTo] = useState<string>(def.to);

  if (!customerId) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <Card className="p-6 border-destructive">
          <p className="text-destructive">ID do cliente inválido.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileText className="w-6 h-6" /> Dossiê de Auditoria
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cliente #{customerId}. Gere o dossiê completo (comunicações, compliance, Pix, audit logs)
          para defesa em Procon, Anatel ou Justiça.
        </p>
      </div>

      <Card className="p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="from">Período: de</Label>
            <Input
              id="from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="input-dossie-from"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">até</Label>
            <Input
              id="to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="input-dossie-to"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Default: últimos 12 meses. Período máximo recomendado para performance: 12 meses.
        </p>

        <div className="flex gap-3 pt-2 border-t">
          <DossieExportButton customerId={customerId} from={from} to={to} format="pdf" />
        </div>
      </Card>

      {/* Spec 010A — Customer Health Score in-context */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Saúde do cliente</h2>
        <CustomerHealthPanel customerId={customerId} />
      </div>

      <Card className="p-6 bg-muted/30">
        <div className="flex gap-3">
          <ShieldCheck className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
          <div className="space-y-2 text-sm">
            <p className="font-medium">Integridade jurídica</p>
            <p className="text-muted-foreground">
              O dossiê é gerado a partir da tabela <code>audit_logs</code> (imutável via triggers
              Postgres que bloqueiam UPDATE/DELETE), garantindo que nenhum registro foi alterado
              após criação. Todas as comunicações outbound passaram pela validação prévia da
              agente de Compliance (Júlia), com fundamentação Anatel 765/2023, CDC arts. 42/71,
              LGPD e Lei 14.181/2021.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
