import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, ArrowLeft, Download } from "lucide-react";
import { useLocation } from "wouter";
import { usePrecosPublicos, planoPorChave } from "@/hooks/use-precos";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:   { label: "Pendente",   color: "bg-[var(--color-gold-bg)] text-[var(--color-gold)]" },
  paid:      { label: "Pago",       color: "bg-[var(--color-success-bg)] text-[var(--color-success)]" },
  overdue:   { label: "Vencido",    color: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelado",  color: "bg-[var(--color-tag-bg)] text-[var(--color-muted)]" },
};


function formatCurrency(value: string | number): string {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, "");
  if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  return cnpj;
}

function formatPeriod(period: string): string {
  const [year, month] = period.split("-");
  const months = ["","Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  return `${months[parseInt(month)]} / ${year}`;
}

export default function InvoiceViewPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();

  const { data: invoice, isLoading, isError } = useQuery<any>({
    queryKey: ["/api/admin/invoices", params.id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/invoices/${params.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Fatura nao encontrada");
      return res.json();
    },
  });

  /**
   * So o ROTULO do plano vem daqui. Os creditos da fatura sao os que ela
   * gravou (`ispCreditsIncluded`), nunca os da tabela de hoje: uma fatura de
   * marco tem que continuar dizendo o que prometeu em marco.
   */
  const { data: precos } = usePrecosPublicos();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (isError || !invoice) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-muted-foreground">Fatura nao encontrada.</p>
        <Button variant="outline" onClick={() => navigate("/admin-sistema")} className="gap-2">
          <ArrowLeft className="w-4 h-4" />Voltar ao Painel
        </Button>
      </div>
    );
  }

  const status = STATUS_LABELS[invoice.status] || STATUS_LABELS.pending;
  const unitValue = parseFloat(invoice.amount);
  const baseValue = unitValue;
  const discount = 0;
  const total = baseValue - discount;
  const totalStr = formatCurrency(invoice.paidAmount || invoice.amount);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 print:bg-white">
      <div className="max-w-3xl mx-auto p-6 print:p-0">
        <div className="flex items-center justify-between mb-6 print:hidden">
          <Button variant="outline" onClick={() => navigate("/admin-sistema")} className="gap-2">
            <ArrowLeft className="w-4 h-4" />Voltar
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()} className="gap-2">
              <Printer className="w-4 h-4" />Imprimir
            </Button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-[0_0_0_1px_var(--ring-warm),0_24px_48px_rgba(20,20,19,0.05)] p-8 print:shadow-none print:rounded-none">
          <div className="flex items-start justify-between mb-8">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">CI</span>
                </div>
                <div>
                  <h1 className="text-lg font-bold leading-tight">Consulta ISP</h1>
                  <p className="text-xs text-muted-foreground">CNPJ: 00.000.000/0001-00</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">consultaisp.com.br</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Nota Fiscal de Servicos</p>
              <p className="text-2xl font-bold text-blue-700 mt-1">{invoice.invoiceNumber}</p>
              <Badge className={`mt-2 ${status.color}`}>{status.label}</Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-8 pb-8 border-b">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2">Tomador de Servicos</p>
              <p className="font-semibold">{invoice.providerName}</p>
              <p className="text-sm text-muted-foreground">CNPJ: {formatCnpj(invoice.providerCnpj)}</p>
              {invoice.providerSubdomain && (
                <p className="text-sm text-muted-foreground">{invoice.providerSubdomain}.consultaisp.com.br</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2">Dados da Fatura</p>
              <p className="text-sm"><span className="text-muted-foreground">Competencia:</span> <span className="font-medium">{formatPeriod(invoice.period)}</span></p>
              <p className="text-sm"><span className="text-muted-foreground">Emissao:</span> <span className="font-medium">{new Date(invoice.createdAt).toLocaleDateString("pt-BR")}</span></p>
              <p className="text-sm"><span className="text-muted-foreground">Vencimento:</span> <span className="font-medium">{new Date(invoice.dueDate).toLocaleDateString("pt-BR")}</span></p>
              {invoice.paidDate && (
                <p className="text-sm"><span className="text-muted-foreground">Pagamento:</span> <span className="font-medium text-[var(--color-success)]">{new Date(invoice.paidDate).toLocaleDateString("pt-BR")}</span></p>
              )}
            </div>
          </div>

          <table className="w-full mb-8">
            <thead>
              <tr className="border-b">
                <th className="text-left text-xs text-muted-foreground uppercase tracking-wider pb-2">Descricao</th>
                <th className="text-center text-xs text-muted-foreground uppercase tracking-wider pb-2">Qtd</th>
                <th className="text-right text-xs text-muted-foreground uppercase tracking-wider pb-2">Valor Unit.</th>
                <th className="text-right text-xs text-muted-foreground uppercase tracking-wider pb-2">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="py-3">
                  <p className="font-medium text-sm">Plano {planoPorChave(precos, invoice.planAtTime)?.rotulo || invoice.planAtTime}</p>
                  <p className="text-xs text-muted-foreground">Assinatura mensal - {formatPeriod(invoice.period)}</p>
                  <p className="text-xs text-muted-foreground">Inclui: {invoice.ispCreditsIncluded} creditos ISP + {invoice.spcCreditsIncluded} creditos SPC</p>
                </td>
                <td className="py-3 text-center text-sm">1</td>
                <td className="py-3 text-right text-sm">{formatCurrency(invoice.amount)}</td>
                <td className="py-3 text-right text-sm font-medium">{formatCurrency(invoice.amount)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} />
                <td className="pt-4 text-right text-sm text-muted-foreground">Subtotal</td>
                <td className="pt-4 text-right text-sm">{formatCurrency(invoice.amount)}</td>
              </tr>
              {discount > 0 && (
                <tr>
                  <td colSpan={2} />
                  <td className="text-right text-sm text-muted-foreground">Desconto</td>
                  <td className="text-right text-sm text-[var(--color-success)]">-{formatCurrency(discount)}</td>
                </tr>
              )}
              <tr className="border-t">
                <td colSpan={2} />
                <td className="pt-3 text-right font-bold">Total</td>
                <td className="pt-3 text-right font-bold text-blue-700 text-lg">{totalStr}</td>
              </tr>
            </tfoot>
          </table>

          <div className="grid grid-cols-2 gap-6 pt-6 border-t">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2">Observacoes</p>
              <p className="text-sm text-muted-foreground">{invoice.notes || "Referente a assinatura mensal da plataforma Consulta ISP."}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2">Emitido por</p>
              <p className="text-sm font-medium">{invoice.createdByName || "Administrador do Sistema"}</p>
              <p className="text-xs text-muted-foreground">Consulta ISP — Sistema de Analise de Credito</p>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t text-center">
            <p className="text-xs text-muted-foreground">Este documento e gerado automaticamente pela plataforma Consulta ISP. Em caso de duvidas, entre em contato pelo suporte.</p>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          body { margin: 0; padding: 0; }
          @page { margin: 1cm; }
        }
      `}</style>
    </div>
  );
}
