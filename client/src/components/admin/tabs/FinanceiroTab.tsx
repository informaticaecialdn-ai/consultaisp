import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Wallet, TrendingUp, DollarSign, AlertCircle, TrendingDown, BarChart3, Crown,
  Plus, RefreshCw, Zap, FileText, Clock, ArrowUpDown, CreditCard, QrCode, Copy,
} from "lucide-react";
import { PLAN_PRICES } from "@shared/schema";
import { PLAN_LABELS } from "../constants";
import InvoiceTable from "../InvoiceTable";

export default function FinanceiroTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [invoiceFilter, setInvoiceFilter] = useState("all");
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({
    providerId: "", period: "", amount: "", planAtTime: "basic",
    ispCreditsIncluded: "0", spcCreditsIncluded: "0",
    dueDate: "", notes: "",
  });

  const [asaasChargeModal, setAsaasChargeModal] = useState<{ invoiceId: number; invoiceNumber: string } | null>(null);
  const [asaasPixModal, setAsaasPixModal] = useState<{ invoiceId: number; pixData: any } | null>(null);

  const { data: allProviders = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
  });
  const { data: planHistory = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/plan-history"],
  });
  const { data: financialSummary } = useQuery<any>({
    queryKey: ["/api/admin/financial/summary"],
  });
  const { data: allInvoices = [], isLoading: invoicesLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/invoices"],
  });
  const { data: asaasStatus } = useQuery<any>({
    queryKey: ["/api/admin/asaas/status"],
    staleTime: 60000,
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/invoices", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      setShowNewInvoice(false);
      setInvoiceForm({ providerId: "", period: "", amount: "", planAtTime: "basic", ispCreditsIncluded: "0", spcCreditsIncluded: "0", dueDate: "", notes: "" });
      toast({ title: "Fatura emitida com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro ao emitir fatura", description: e.message, variant: "destructive" }),
  });

  const updateInvoiceStatusMutation = useMutation({
    mutationFn: async ({ id, status, paidAmount }: { id: number; status: string; paidAmount?: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/invoices/${id}/status`, { status, paidAmount });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      toast({ title: "Status da fatura atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const generateMonthlyMutation = useMutation({
    mutationFn: async (period: string) => {
      const res = await apiRequest("POST", "/api/admin/invoices/generate-monthly", { period });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      toast({ title: "Faturas geradas", description: data.message });
    },
    onError: (e: any) => toast({ title: "Erro ao gerar faturas", description: e.message, variant: "destructive" }),
  });

  const cancelInvoiceMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/invoices/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      toast({ title: "Fatura cancelada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const createChargeMutation = useMutation({
    mutationFn: async ({ id, billingType }: { id: number; billingType: string }) => {
      const res = await apiRequest("POST", `/api/admin/invoices/${id}/asaas/charge`, { billingType });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      setAsaasChargeModal(null);
      toast({ title: "Cobranca Asaas criada", description: `ID: ${data.charge?.id}` });
    },
    onError: (e: any) => toast({ title: "Erro Asaas", description: e.message, variant: "destructive" }),
  });

  const syncChargeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/invoices/${id}/asaas/sync`, {});
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      toast({ title: "Status sincronizado com Asaas" });
    },
    onError: (e: any) => toast({ title: "Erro ao sincronizar", description: e.message, variant: "destructive" }),
  });

  const pixMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("GET", `/api/admin/invoices/${id}/asaas/pix`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data, id) => {
      setAsaasPixModal({ invoiceId: id as number, pixData: data });
    },
    onError: (e: any) => toast({ title: "Erro ao buscar PIX", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      {/* Asaas Status Bar */}
      {asaasStatus && (
        <Card className={`p-4 flex items-center justify-between gap-4 ${asaasStatus.configured ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-amber-200 bg-[var(--color-gold-bg)]/50 dark:border-amber-800 dark:bg-amber-950/20"}`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${asaasStatus.configured ? "bg-emerald-100 dark:bg-emerald-900" : "bg-amber-100 dark:bg-amber-900"}`}>
              <Wallet className={`w-4 h-4 ${asaasStatus.configured ? "text-emerald-600" : "text-[var(--color-gold)]"}`} />
            </div>
            <div>
              <p className="text-sm font-semibold">
                Asaas {asaasStatus.configured ? (asaasStatus.mode === "sandbox" ? "— Sandbox ativo" : "— Producao ativo") : "— Nao configurado"}
              </p>
              <p className="text-xs text-[var(--color-muted)]">
                {asaasStatus.configured
                  ? `Saldo disponivel: R$ ${(asaasStatus.balance?.balance || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                  : "Configure a chave ASAAS_API_KEY para ativar cobranças automaticas"}
              </p>
            </div>
          </div>
          {asaasStatus.configured && (
            <Badge className={asaasStatus.mode === "sandbox" ? "bg-amber-100 text-[var(--color-gold)]" : "bg-emerald-100 text-emerald-700"}>
              {asaasStatus.mode === "sandbox" ? "Sandbox" : "Producao"}
            </Badge>
          )}
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "MRR", value: `R$ ${(financialSummary?.mrr || 0).toLocaleString("pt-BR")}`, sub: "Receita mensal recorrente", icon: TrendingUp, color: "from-emerald-500 to-emerald-600", testId: "kpi-mrr" },
          { label: "ARR", value: `R$ ${(financialSummary?.arr || 0).toLocaleString("pt-BR")}`, sub: "Receita anual recorrente", icon: DollarSign, color: "from-blue-500 to-blue-600", testId: "kpi-arr" },
          { label: "Em Aberto", value: `R$ ${(financialSummary?.pendingRevenue || 0).toLocaleString("pt-BR")}`, sub: `${financialSummary?.pendingCount || 0} faturas pendentes`, icon: AlertCircle, color: "from-amber-500 to-amber-600", testId: "kpi-pending" },
          { label: "Em Atraso", value: `R$ ${(financialSummary?.overdueRevenue || 0).toLocaleString("pt-BR")}`, sub: `${financialSummary?.overdueCount || 0} faturas vencidas`, icon: TrendingDown, color: "from-rose-500 to-rose-600", testId: "kpi-overdue" },
        ].map((card) => (
          <Card key={card.label} className="overflow-hidden" data-testid={card.testId}>
            <div className={`h-1.5 ${card.color}`} />
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[var(--color-muted)] font-medium uppercase tracking-wider">{card.label}</span>
                <div className={`w-8 h-8 rounded ${card.color} flex items-center justify-center`}>
                  <card.icon className="w-4 h-4 text-white" />
                </div>
              </div>
              <p className="text-xl font-bold">{card.value}</p>
              <p className="text-xs text-[var(--color-muted)] mt-0.5">{card.sub}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Revenue chart + Plan distribution */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-5">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-500" />Receita por Mes (ultimos 6 meses)
          </h3>
          <div className="flex items-end gap-2 h-32">
            {(financialSummary?.last6Months || []).map((m: any) => {
              const max = Math.max(...(financialSummary?.last6Months || []).map((x: any) => x.revenue), 1);
              const pct = max > 0 ? (m.revenue / max) * 100 : 0;
              const mo = m.period.split("-")[1];
              const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
              const label = months[parseInt(mo) - 1];
              return (
                <div key={m.period} className="flex flex-col items-center flex-1 gap-1">
                  <span className="text-xs text-[var(--color-muted)]">{m.revenue > 0 ? `R$${m.revenue}` : ""}</span>
                  <div className="w-full rounded-t-sm from-blue-500 to-indigo-400 transition-all" style={{ height: `${Math.max(pct, 4)}%` }} />
                  <span className="text-xs text-[var(--color-muted)]">{label}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-500" />Distribuicao de Planos
          </h3>
          <div className="space-y-2">
            {Object.entries(financialSummary?.planDistribution || {}).map(([plan, count]: any) => {
              const total = Object.values(financialSummary?.planDistribution || {}).reduce((a: any, b: any) => a + b, 0) as number;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={plan}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium">{PLAN_LABELS[plan]?.label || plan}</span>
                    <span className="text-[var(--color-muted)]">{count} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full from-blue-500 to-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {!financialSummary?.planDistribution && (
              <p className="text-xs text-[var(--color-muted)] text-center py-4">Sem dados</p>
            )}
          </div>
        </Card>
      </div>

      {/* Invoice management */}
      <Card className="overflow-hidden">
        <div className="p-5 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-500" />Gestao de Faturas
              </h3>
              <p className="text-xs text-[var(--color-muted)] mt-0.5">{allInvoices.length} fatura(s) no sistema</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => {
                  const period = new Date().toISOString().slice(0, 7);
                  if (confirm(`Gerar faturas mensais para ${period}?`)) generateMonthlyMutation.mutate(period);
                }}
                disabled={generateMonthlyMutation.isPending}
                data-testid="button-generate-monthly-invoices"
              >
                {generateMonthlyMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Gerar Mensais
              </Button>
              <Button size="sm" className="gap-1.5 text-xs" onClick={() => setShowNewInvoice(!showNewInvoice)} data-testid="button-new-invoice">
                <Plus className="w-3.5 h-3.5" />Nova Fatura
              </Button>
            </div>
          </div>

          {/* Filter */}
          <div className="flex gap-1.5 mt-4 flex-wrap">
            {[
              { value: "all", label: "Todas" },
              { value: "pending", label: "Pendentes" },
              { value: "paid", label: "Pagas" },
              { value: "overdue", label: "Vencidas" },
              { value: "cancelled", label: "Canceladas" },
            ].map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={invoiceFilter === f.value ? "default" : "outline"}
                className="h-7 text-xs px-3"
                onClick={() => setInvoiceFilter(f.value)}
                data-testid={`button-invoice-filter-${f.value}`}
              >
                {f.label}
                {f.value !== "all" && (
                  <span className="ml-1 opacity-70">
                    ({allInvoices.filter((i: any) => i.status === f.value).length})
                  </span>
                )}
              </Button>
            ))}
          </div>
        </div>

        {/* New Invoice Form */}
        {showNewInvoice && (
          <div className="p-5 border-b bg-muted/30">
            <h4 className="font-medium text-sm mb-4">Emitir Nova Fatura</h4>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Provedor</Label>
                <Select value={invoiceForm.providerId} onValueChange={(v) => {
                  const p = allProviders.find((x: any) => x.id.toString() === v);
                  const PLAN_CREDITS_MAP: Record<string, { isp: number; spc: number }> = {
                    free: { isp: 50, spc: 0 }, basic: { isp: 200, spc: 50 }, pro: { isp: 500, spc: 150 }, enterprise: { isp: 1500, spc: 500 }
                  };
                  if (p) {
                    const credits = PLAN_CREDITS_MAP[p.plan] || { isp: 0, spc: 0 };
                    setInvoiceForm(f => ({ ...f, providerId: v, planAtTime: p.plan, amount: PLAN_PRICES[p.plan as keyof typeof PLAN_PRICES]?.toString() || "0", ispCreditsIncluded: credits.isp.toString(), spcCreditsIncluded: credits.spc.toString() }));
                  } else {
                    setInvoiceForm(f => ({ ...f, providerId: v }));
                  }
                }}>
                  <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-invoice-provider">
                    <SelectValue placeholder="Selecionar provedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {allProviders.map((p: any) => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Periodo (AAAA-MM)</Label>
                <Input className="h-8 text-xs mt-1" placeholder="2026-03" value={invoiceForm.period} onChange={(e) => setInvoiceForm(f => ({ ...f, period: e.target.value }))} data-testid="input-invoice-period" />
              </div>
              <div>
                <Label className="text-xs">Plano Cobrado</Label>
                <Select value={invoiceForm.planAtTime} onValueChange={(v) => {
                  const PLAN_CREDITS_MAP: Record<string, { isp: number; spc: number }> = {
                    free: { isp: 50, spc: 0 }, basic: { isp: 200, spc: 50 }, pro: { isp: 500, spc: 150 }, enterprise: { isp: 1500, spc: 500 }
                  };
                  const credits = PLAN_CREDITS_MAP[v] || { isp: 0, spc: 0 };
                  setInvoiceForm(f => ({ ...f, planAtTime: v, amount: PLAN_PRICES[v as keyof typeof PLAN_PRICES]?.toString() || "0", ispCreditsIncluded: credits.isp.toString(), spcCreditsIncluded: credits.spc.toString() }));
                }}>
                  <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-invoice-plan">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Gratuito — R$ 0</SelectItem>
                    <SelectItem value="basic">Basico — R$ 199</SelectItem>
                    <SelectItem value="pro">Pro — R$ 399</SelectItem>
                    <SelectItem value="enterprise">Enterprise — R$ 799</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Valor (R$)</Label>
                <Input className="h-8 text-xs mt-1" type="number" placeholder="199" value={invoiceForm.amount} onChange={(e) => setInvoiceForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-invoice-amount" />
              </div>
              <div>
                <Label className="text-xs">Vencimento</Label>
                <Input className="h-8 text-xs mt-1" type="date" value={invoiceForm.dueDate} onChange={(e) => setInvoiceForm(f => ({ ...f, dueDate: e.target.value }))} data-testid="input-invoice-due-date" />
              </div>
              <div>
                <Label className="text-xs">Observacoes (opcional)</Label>
                <Input className="h-8 text-xs mt-1" placeholder="Observacao..." value={invoiceForm.notes} onChange={(e) => setInvoiceForm(f => ({ ...f, notes: e.target.value }))} data-testid="input-invoice-notes" />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" className="gap-1.5 text-xs" disabled={createInvoiceMutation.isPending} onClick={() => createInvoiceMutation.mutate(invoiceForm)} data-testid="button-submit-invoice">
                {createInvoiceMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                Emitir Fatura
              </Button>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowNewInvoice(false)}>Cancelar</Button>
            </div>
          </div>
        )}

        {/* Invoice Table */}
        {invoicesLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 animate-spin text-[var(--color-muted)]" />
          </div>
        ) : (
          <InvoiceTable
            invoices={allInvoices}
            filter={invoiceFilter}
            asaasConfigured={!!asaasStatus?.configured}
            onOpenAsaasCharge={setAsaasChargeModal}
            onSyncCharge={(id) => syncChargeMutation.mutate(id)}
            onOpenPix={(id) => pixMutation.mutate(id)}
            onMarkPaid={(id, amount) => updateInvoiceStatusMutation.mutate({ id, status: "paid", paidAmount: amount })}
            onCancel={(id) => cancelInvoiceMutation.mutate(id)}
            syncChargePending={syncChargeMutation.isPending}
            pixPending={pixMutation.isPending}
          />
        )}
      </Card>

      {/* Credits management and history */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-blue-500" />Creditos por Provedor
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {allProviders.map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <div className="flex items-center gap-3 text-xs text-[var(--color-muted)] mt-0.5">
                    <span className="text-[var(--color-navy)] font-medium">ISP: {p.ispCredits}</span>
                    <span className="text-purple-600 font-medium">SPC: {p.spcCredits}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--color-muted)] pt-2 border-t mt-2">
            Para adicionar creditos a um provedor, abra o drawer dele na aba Provedores.
          </p>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-[var(--color-muted)]" />Historico de Alteracoes
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {planHistory.map((h: any) => (
              <div key={h.id} className="flex items-start gap-3 py-2 border-b last:border-0 text-sm">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${h.newPlan ? "bg-purple-100 text-purple-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {h.newPlan ? <ArrowUpDown className="w-3.5 h-3.5" /> : <Plus className="w-3 h-3" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-xs">
                      {h.newPlan
                        ? `${PLAN_LABELS[h.oldPlan]?.label} → ${PLAN_LABELS[h.newPlan]?.label}`
                        : `ISP +${h.ispCreditsAdded} / SPC +${h.spcCreditsAdded}`}
                    </span>
                    <span className="text-xs text-[var(--color-muted)] whitespace-nowrap">
                      {new Date(h.createdAt).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                  {h.notes && <p className="text-xs text-[var(--color-muted)] truncate">{h.notes}</p>}
                </div>
              </div>
            ))}
            {planHistory.length === 0 && (
              <p className="text-xs text-[var(--color-muted)] py-4 text-center">Nenhum historico</p>
            )}
          </div>
        </Card>
      </div>

      {/* ASAAS Charge Modal */}
      {asaasChargeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAsaasChargeModal(null)}>
          <div className="bg-background rounded p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-1 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-blue-500" />Cobrar via Asaas
            </h2>
            <p className="text-xs text-[var(--color-muted)] mb-4">Fatura {asaasChargeModal.invoiceNumber}</p>
            <div className="space-y-2">
              {[
                { type: "UNDEFINED", label: "Livre (cliente escolhe)", icon: Wallet },
                { type: "PIX", label: "PIX", icon: QrCode },
                { type: "BOLETO", label: "Boleto Bancario", icon: CreditCard },
              ].map(opt => (
                <button
                  key={opt.type}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded border hover:bg-muted/50 transition-colors text-left"
                  disabled={createChargeMutation.isPending}
                  onClick={() => createChargeMutation.mutate({ id: asaasChargeModal.invoiceId, billingType: opt.type })}
                  data-testid={`button-charge-${opt.type.toLowerCase()}`}
                >
                  {createChargeMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-[var(--color-muted)]" />
                  ) : (
                    <opt.icon className="w-4 h-4 text-blue-500" />
                  )}
                  <span className="text-sm font-medium">{opt.label}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-3 w-full text-xs" onClick={() => setAsaasChargeModal(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* PIX QrCode Modal */}
      {asaasPixModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAsaasPixModal(null)}>
          <div className="bg-background rounded p-6 w-full max-w-sm text-center" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-1 flex items-center gap-2 justify-center">
              <QrCode className="w-4 h-4 text-blue-500" />QR Code PIX
            </h2>
            {asaasPixModal.pixData?.encodedImage ? (
              <img src={`data:image/png;base64,${asaasPixModal.pixData.encodedImage}`} alt="QR Code PIX" className="mx-auto w-48 h-48 my-4 rounded border" />
            ) : (
              <div className="w-48 h-48 mx-auto my-4 rounded border bg-muted/30 flex items-center justify-center">
                <QrCode className="w-12 h-12 text-[var(--color-muted)] opacity-40" />
              </div>
            )}
            {asaasPixModal.pixData?.payload && (
              <div className="mt-2">
                <p className="text-xs text-[var(--color-muted)] mb-1">Codigo Copia e Cola:</p>
                <div className="flex gap-2 items-center">
                  <code className="text-xs bg-muted rounded px-2 py-1 flex-1 text-left truncate">{asaasPixModal.pixData.payload}</code>
                  <Button
                    variant="outline" size="sm"
                    className="h-7 w-7 p-0 flex-shrink-0"
                    onClick={() => { navigator.clipboard.writeText(asaasPixModal.pixData.payload); toast({ title: "Copiado!" }); }}
                    data-testid="button-copy-pix"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
            <Button variant="ghost" size="sm" className="mt-3 w-full text-xs" onClick={() => setAsaasPixModal(null)}>Fechar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
