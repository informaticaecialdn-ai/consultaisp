import { useState } from "react";
import { useRoute, Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FileText, ShieldCheck, LayoutGrid, RotateCcw } from "lucide-react";
import { DossieExportButton } from "@/components/dossie/DossieExportButton";
import { CustomerHealthPanel } from "@/components/health/CustomerHealthPanel";
import { CustomerProfilePanel } from "@/components/customer/CustomerProfilePanel";

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

      {/* Spec 012.5 — links pras telas Cliente 360 (mockadas) */}
      <Card className="p-4 bg-gradient-to-r from-emerald-50 to-amber-50 border-emerald-200">
        <div className="flex items-start gap-3">
          <LayoutGrid className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-900">Cliente 360º — visão operacional completa (DEMO)</p>
            <p className="text-xs text-muted-foreground mt-1 mb-3">
              Telas com dados mockados replicando os mockups visuais. Backend real será construído nas Specs 010A/011/012/013.
              Use para ver como vai ficar a tela operacional final dos agentes Marcos/Bruno/Rafael/Carla/Daniel/Lucas.
            </p>
            <div className="flex gap-2 flex-wrap">
              <Link href={`/cliente/${customerId}/360-cobranca`}>
                <Button size="sm" variant="default" className="gap-1.5 bg-emerald-700 hover:bg-emerald-800">
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Cliente 360 Cobrança
                </Button>
              </Link>
              <Link href={`/cliente/${customerId}/360-recuperacao`}>
                <Button size="sm" variant="outline" className="gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50">
                  <RotateCcw className="w-3.5 h-3.5" />
                  Cliente 360 Recuperação
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </Card>

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

      {/* Quick win Cliente 360 — Identidade + Contrato + Equipamentos */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Identificação & Cobrança</h2>
        <CustomerProfilePanel customerId={customerId} />
      </div>

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
