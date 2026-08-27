import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Eye, Wallet, RefreshCw, RotateCcw, QrCode, CheckCircle, Ban, ExternalLink,
} from "lucide-react";
import { PLAN_LABELS } from "./constants";

export interface InvoiceTableProps {
  invoices: any[];
  filter: string;
  asaasConfigured: boolean;
  onOpenAsaasCharge: (inv: { invoiceId: number; invoiceNumber: string }) => void;
  onSyncCharge: (id: number) => void;
  onOpenPix: (id: number) => void;
  onMarkPaid: (id: number, amount: string) => void;
  onCancel: (id: number) => void;
  syncChargePending: boolean;
  pixPending: boolean;
}

export default function InvoiceTable({
  invoices, filter, asaasConfigured,
  onOpenAsaasCharge, onSyncCharge, onOpenPix, onMarkPaid, onCancel,
  syncChargePending, pixPending,
}: InvoiceTableProps) {
  const [, navigate] = useLocation();
  const filtered = filter === "all" ? invoices : invoices.filter((i: any) => i.status === filter);

  const STATUS_STYLE: Record<string, string> = {
    pending: "bg-[var(--color-gold-bg)] text-[var(--color-gold)]",
    paid: "bg-[var(--color-success-bg)] text-[var(--color-success)]",
    overdue: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
    cancelled: "bg-[var(--color-tag-bg)] text-[var(--color-muted)]",
  };
  const STATUS_LABEL: Record<string, string> = {
    pending: "Pendente", paid: "Pago", overdue: "Vencido", cancelled: "Cancelado",
  };

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <p className="text-sm text-[var(--color-muted)]">Nenhuma fatura encontrada</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--color-muted)]">Numero</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--color-muted)]">Provedor</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--color-muted)]">Periodo</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--color-muted)]">Plano</th>
            <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--color-muted)]">Valor</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--color-muted)]">Vencimento</th>
            <th className="text-center py-3 px-4 text-xs font-semibold text-[var(--color-muted)]">Status</th>
            <th className="text-center py-3 px-4 text-xs font-semibold text-[var(--color-muted)]">Acoes</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {filtered.map((inv: any) => {
            const isOverdue = inv.status === "pending" && new Date(inv.dueDate) < new Date();
            const displayStatus = isOverdue ? "overdue" : inv.status;
            return (
              <tr key={inv.id} className="hover:bg-muted/20 transition-colors" data-testid={`invoice-row-${inv.id}`}>
                <td className="py-3 px-4">
                  <span className="font-mono text-xs font-medium text-[var(--color-brand)] dark:text-blue-300">{inv.invoiceNumber}</span>
                </td>
                <td className="py-3 px-4">
                  <span className="font-medium text-xs">{inv.providerName}</span>
                </td>
                <td className="py-3 px-4 text-xs text-[var(--color-muted)]">{inv.period}</td>
                <td className="py-3 px-4">
                  <Badge className={`text-xs ${PLAN_LABELS[inv.planAtTime]?.color || ""}`}>
                    {PLAN_LABELS[inv.planAtTime]?.label || inv.planAtTime}
                  </Badge>
                </td>
                <td className="py-3 px-4 text-right font-semibold text-xs">
                  R$ {parseFloat(inv.paidAmount || inv.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </td>
                <td className="py-3 px-4 text-xs text-[var(--color-muted)]">
                  {new Date(inv.dueDate).toLocaleDateString("pt-BR")}
                </td>
                <td className="py-3 px-4 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <Badge className={`text-xs ${STATUS_STYLE[displayStatus] || STATUS_STYLE.pending}`}>
                      {STATUS_LABEL[displayStatus] || displayStatus}
                    </Badge>
                    {inv.asaasChargeId && (
                      <span className="text-xs text-blue-500 font-medium flex items-center gap-0.5">
                        <Wallet className="w-2.5 h-2.5" />Asaas
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center justify-center gap-1">
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => navigate(`/admin/fatura/${inv.id}`)}
                      title="Ver fatura"
                      data-testid={`button-view-invoice-${inv.id}`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                    {(inv.status === "pending" || displayStatus === "overdue") && !inv.asaasChargeId && asaasConfigured && (
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 w-7 p-0 text-[var(--color-brand)] hover:bg-[var(--color-brand-bg)]"
                        onClick={() => onOpenAsaasCharge({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber })}
                        title="Cobrar via Asaas"
                        data-testid={`button-asaas-charge-${inv.id}`}
                      >
                        <Wallet className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {inv.asaasChargeId && (
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 w-7 p-0 text-indigo-500 hover:bg-indigo-50"
                        onClick={() => onSyncCharge(inv.id)}
                        title="Sincronizar status com Asaas"
                        disabled={syncChargePending}
                        data-testid={`button-asaas-sync-${inv.id}`}
                      >
                        {syncChargePending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                    {inv.asaasChargeId && inv.asaasBillingType === "PIX" && inv.status !== "paid" && (
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 w-7 p-0 text-[var(--color-success)] hover:bg-[var(--color-success-bg)]"
                        onClick={() => onOpenPix(inv.id)}
                        title="QR Code PIX"
                        disabled={pixPending}
                        data-testid={`button-asaas-pix-${inv.id}`}
                      >
                        <QrCode className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {inv.asaasInvoiceUrl && (
                      <a
                        href={inv.asaasInvoiceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-7 w-7 p-0 inline-flex items-center justify-center rounded-md text-[var(--color-muted)] hover:text-[var(--color-brand)] hover:bg-[var(--color-brand-bg)] transition-colors"
                        title="Link de pagamento Asaas"
                        data-testid={`link-asaas-payment-${inv.id}`}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {(inv.status === "pending" || displayStatus === "overdue") && (
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 w-7 p-0 text-[var(--color-success)] hover:bg-[var(--color-success-bg)]"
                        onClick={() => onMarkPaid(inv.id, inv.amount)}
                        title="Marcar como pago manualmente"
                        data-testid={`button-mark-paid-${inv.id}`}
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {(inv.status === "pending" || displayStatus === "overdue") && (
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 w-7 p-0 text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]"
                        onClick={() => { if (confirm("Cancelar esta fatura?")) onCancel(inv.id); }}
                        title="Cancelar fatura"
                        data-testid={`button-cancel-invoice-${inv.id}`}
                      >
                        <Ban className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
