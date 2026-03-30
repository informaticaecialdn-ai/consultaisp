import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import {
  TrendingUp, TrendingDown, DollarSign, Users, BarChart3,
  AlertCircle, CheckCircle, ArrowUpRight, ArrowDownRight,
  RefreshCw, FileText, Plus, Eye, Ban, Wallet, RotateCcw,
  QrCode, ExternalLink, Copy, ArrowLeft, Zap, Crown,
  Target, Activity, PieChart, Calendar, Info, ChevronRight,
  ScanLine, ArrowUp, ArrowDown, Minus
} from "lucide-react";
import { PLAN_PRICES } from "@shared/schema";
const PLAN_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  free:       { label: "Gratuito",   color: "text-gray-600",   bg: "bg-gray-100" },
  basic:      { label: "Basico",     color: "text-blue-600",   bg: "bg-blue-100" },
  pro:        { label: "Pro",        color: "text-indigo-600", bg: "bg-indigo-100" },
  enterprise: { label: "Enterprise", color: "text-amber-600",  bg: "bg-amber-100" },
};

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n: number) {
  return n.toLocaleString("pt-BR");
}
function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}
function periodLabel(p: string) {
  const [y, m] = p.split("-");
  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${months[parseInt(m) - 1]}/${y.slice(2)}`;
}

type MetricCardProps = {
  label: string;
  value: string;
  sub?: string;
  icon: any;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  highlight?: boolean;
  color?: string;
  testId?: string;
  tooltip?: string;
};

function MetricCard({ label, value, sub, icon: Icon, trend, trendValue, highlight, color = "blue", testId, tooltip }: MetricCardProps) {
  const gradients: Record<string, string> = {
    blue:    "from-blue-500 to-blue-600",
    indigo:  "from-indigo-500 to-indigo-600",
    emerald: "from-emerald-500 to-emerald-600",
    amber:   "from-amber-500 to-amber-600",
    rose:    "from-rose-500 to-rose-600",
    purple:  "from-purple-500 to-purple-600",
    cyan:    "from-cyan-500 to-cyan-600",
    violet:  "from-violet-500 to-violet-600",
  };
  return (
    <Card className="overflow-hidden" data-testid={testId}>
      <div className={`h-1 bg-gradient-to-r ${gradients[color] || gradients.blue}`} />
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-muted-foreground font-semibold uppercase tracking-widest">{label}</span>
          <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradients[color] || gradients.blue} flex items-center justify-center`}>
            <Icon className="w-4 h-4 text-white" />
          </div>
        </div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        <div className="flex items-center justify-between mt-1">
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          {trendValue && trend && (
            <span className={`text-xs font-medium flex items-center gap-0.5 ${trend === "up" ? "text-emerald-600" : trend === "down" ? "text-rose-600" : "text-muted-foreground"}`}>
              {trend === "up" ? <ArrowUpRight className="w-3 h-3" /> : trend === "down" ? <ArrowDownRight className="w-3 h-3" /> : null}
              {trendValue}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function WaterfallBar({ label, value, type, max }: { label: string; value: number; type: "start"|"add"|"sub"|"end"; max: number }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 2) : 2;
  const colors = {
    start: "bg-slate-400",
    add:   "bg-emerald-500",
    sub:   "bg-rose-400",
    end:   "bg-blue-500",
  };
  const signs = { start: "", add: "+", sub: "-", end: "" };
  return (
    <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
      <span className="text-[10px] font-semibold text-muted-foreground text-center">
        {signs[type]}R${fmtInt(Math.round(value))}
      </span>
      <div
        className={`w-full rounded-t-sm ${colors[type]} transition-all`}
        style={{ height: `${pct}%`, minHeight: 8 }}
      />
      <span className="text-[9px] text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

export default function AdminFinanceiroPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const isSuperAdmin = user?.role === "superadmin";

  const [invoiceFilter, setInvoiceFilter] = useState("all");
  const [asaasChargeModal, setAsaasChargeModal] = useState<{ invoiceId: number; invoiceNumber: string } | null>(null);
  const [asaasPixModal, setAsaasPixModal] = useState<{ invoiceId: number; pixData: any } | null>(null);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({
    providerId: "", period: "", amount: "", planAtTime: "basic",
    ispCreditsIncluded: "0", spcCreditsIncluded: "0", dueDate: "", notes: "",
  });

  const { data: metrics, isLoading: metricsLoading } = useQuery<any>({
    queryKey: ["/api/admin/financial/saas-metrics"],
    enabled: isSuperAdmin,
    refetchInterval: 60000,
  });

  const { data: allProviders = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    enabled: isSuperAdmin,
  });

  const { data: allInvoices = [], isLoading: invoicesLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/invoices"],
    enabled: isSuperAdmin,
  });

  const { data: asaasStatus } = useQuery<any>({
    queryKey: ["/api/admin/asaas/status"],
    enabled: isSuperAdmin,
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
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/saas-metrics"] });
      setShowNewInvoice(false);
      setInvoiceForm({ providerId: "", period: "", amount: "", planAtTime: "basic", ispCreditsIncluded: "0", spcCreditsIncluded: "0", dueDate: "", notes: "" });
      toast({ title: "Fatura emitida com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateInvoiceStatusMutation = useMutation({
    mutationFn: async ({ id, status, paidAmount }: { id: number; status: string; paidAmount?: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/invoices/${id}/status`, { status, paidAmount });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/saas-metrics"] });
      toast({ title: "Status atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const cancelInvoiceMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/invoices/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/saas-metrics"] });
      toast({ title: "Fatura cancelada" });
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
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/saas-metrics"] });
      toast({ title: "Faturas geradas", description: data.message });
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
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/saas-metrics"] });
      toast({ title: "Sincronizado com Asaas" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const pixMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("GET", `/api/admin/invoices/${id}/asaas/pix`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data, id) => setAsaasPixModal({ invoiceId: id as number, pixData: data }),
    onError: (e: any) => toast({ title: "Erro ao buscar PIX", description: e.message, variant: "destructive" }),
  });

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <p className="text-muted-foreground">Acesso restrito a superadmin.</p>
      </div>
    );
  }

  const snap = metrics?.snapshot || {};
  const waterfall = metrics?.waterfall || {};
  const last12 = metrics?.last12Months || [];
  const invoiceHealth = metrics?.invoiceHealth || {};
  const planDist = metrics?.planDistribution || {};
  const provHealth = metrics?.providerBillingHealth || [];

  const maxWaterfall = Math.max(waterfall.startingMrr || 0, waterfall.endingMrr || 0, 1);
  const maxRevenue = Math.max(...last12.map((m: any) => m.billedRevenue || 0), 1);

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const filteredInvoices = invoiceFilter === "all"
    ? allInvoices
    : allInvoices.filter((i: any) => {
        if (invoiceFilter === "overdue") return i.status === "overdue" || (i.status === "pending" && new Date(i.dueDate) < now);
        return i.status === invoiceFilter;
      });

  const STATUS_STYLE: Record<string, string> = {
    pending:   "bg-amber-100 text-amber-700",
    paid:      "bg-emerald-100 text-emerald-700",
    overdue:   "bg-red-100 text-red-700",
    cancelled: "bg-gray-100 text-gray-600",
  };
  const STATUS_LABEL: Record<string, string> = {
    pending: "Pendente", paid: "Pago", overdue: "Vencido", cancelled: "Cancelado"
  };

  return (
    <div className="p-5 pb-10 space-y-6 max-w-[1400px] mx-auto">
      {/* Asaas Charge Modal */}
      {asaasChargeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAsaasChargeModal(null)}>
          <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-1 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-blue-500" />Cobrar via Asaas
            </h2>
            <p className="text-xs text-muted-foreground mb-4">Fatura {asaasChargeModal.invoiceNumber}</p>
            <div className="space-y-2">
              {[
                { type: "UNDEFINED", label: "Livre (cliente escolhe)", icon: Wallet },
                { type: "PIX", label: "PIX", icon: QrCode },
                { type: "BOLETO", label: "Boleto Bancario", icon: ScanLine },
              ].map(opt => (
                <button
                  key={opt.type}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                  disabled={createChargeMutation.isPending}
                  onClick={() => createChargeMutation.mutate({ id: asaasChargeModal.invoiceId, billingType: opt.type })}
                  data-testid={`button-charge-${opt.type.toLowerCase()}`}
                >
                  {createChargeMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" /> : <opt.icon className="w-4 h-4 text-blue-500" />}
                  <span className="text-sm font-medium">{opt.label}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-3 w-full text-xs" onClick={() => setAsaasChargeModal(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* PIX Modal */}
      {asaasPixModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAsaasPixModal(null)}>
          <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-sm text-center" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-1 flex items-center gap-2 justify-center"><QrCode className="w-4 h-4 text-blue-500" />QR Code PIX</h2>
            {asaasPixModal.pixData?.encodedImage
              ? <img src={`data:image/png;base64,${asaasPixModal.pixData.encodedImage}`} alt="QR Code PIX" className="mx-auto w-48 h-48 my-4 rounded-lg border" />
              : <div className="w-48 h-48 mx-auto my-4 rounded-lg border bg-muted/30 flex items-center justify-center"><QrCode className="w-12 h-12 text-muted-foreground opacity-40" /></div>
            }
            {asaasPixModal.pixData?.payload && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">Codigo Copia e Cola:</p>
                <div className="flex gap-2 items-center">
                  <code className="text-xs bg-muted rounded px-2 py-1 flex-1 text-left truncate">{asaasPixModal.pixData.payload}</code>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0 flex-shrink-0"
                    onClick={() => { navigator.clipboard.writeText(asaasPixModal.pixData.payload); toast({ title: "Copiado!" }); }}
                  ><Copy className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            )}
            <Button variant="ghost" size="sm" className="mt-3 w-full text-xs" onClick={() => setAsaasPixModal(null)}>Fechar</Button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate("/admin-sistema#financeiro")} data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-500" />Dashboard Financeiro SaaS
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })} — Metricas em tempo real
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {asaasStatus?.configured && (
            <Badge className={`text-xs ${asaasStatus.mode === "sandbox" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
              <Wallet className="w-3 h-3 mr-1" />{asaasStatus.mode === "sandbox" ? "Asaas Sandbox" : "Asaas Producao"}
            </Badge>
          )}
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => {
            qc.invalidateQueries({ queryKey: ["/api/admin/financial/saas-metrics"] });
            qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
          }} data-testid="button-refresh-metrics">
            <RefreshCw className="w-3.5 h-3.5" />Atualizar
          </Button>
        </div>
      </div>

      {metricsLoading ? (
        <div className="flex items-center justify-center py-24">
          <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* === ROW 1: PRIMARY KPIs === */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Receita Recorrente</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="MRR" value={`R$ ${fmt(snap.mrr || 0)}`}
                sub="Receita mensal recorrente" icon={TrendingUp} color="blue"
                testId="metric-mrr" />
              <MetricCard label="ARR" value={`R$ ${fmtInt(snap.arr || 0)}`}
                sub="Receita anual recorrente" icon={Target} color="indigo"
                testId="metric-arr" />
              <MetricCard label="ARPU" value={`R$ ${fmt(snap.arpu || 0)}`}
                sub={`${snap.payingProviders || 0} clientes pagantes`} icon={Users} color="purple"
                testId="metric-arpu" />
              <MetricCard label="LTV" value={`R$ ${fmtInt(snap.ltv || 0)}`}
                sub="Valor vitalicio estimado" icon={Crown} color="amber"
                testId="metric-ltv" />
            </div>
          </div>

          {/* === ROW 2: HEALTH KPIs === */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Saude do Negocio</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="overflow-hidden" data-testid="metric-churn">
                <div className={`h-1 bg-gradient-to-r ${(snap.monthlyChurnRate || 0) === 0 ? "from-emerald-400 to-emerald-500" : (snap.monthlyChurnRate || 0) < 3 ? "from-amber-400 to-amber-500" : "from-rose-400 to-rose-500"}`} />
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-muted-foreground font-semibold uppercase tracking-widest">Churn Mensal</span>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${(snap.monthlyChurnRate || 0) === 0 ? "bg-emerald-100" : (snap.monthlyChurnRate || 0) < 3 ? "bg-amber-100" : "bg-rose-100"}`}>
                      <TrendingDown className={`w-4 h-4 ${(snap.monthlyChurnRate || 0) === 0 ? "text-emerald-600" : (snap.monthlyChurnRate || 0) < 3 ? "text-amber-600" : "text-rose-600"}`} />
                    </div>
                  </div>
                  <p className="text-2xl font-bold">{fmtPct(snap.monthlyChurnRate || 0)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Anual: {fmtPct(snap.annualChurnRate || 0)}</p>
                </div>
              </Card>

              <Card className="overflow-hidden" data-testid="metric-nrr">
                <div className={`h-1 bg-gradient-to-r ${(snap.nrr || 100) >= 100 ? "from-emerald-400 to-emerald-500" : "from-amber-400 to-amber-500"}`} />
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-muted-foreground font-semibold uppercase tracking-widest">NRR</span>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${(snap.nrr || 100) >= 100 ? "bg-emerald-100" : "bg-amber-100"}`}>
                      <Activity className={`w-4 h-4 ${(snap.nrr || 100) >= 100 ? "text-emerald-600" : "text-amber-600"}`} />
                    </div>
                  </div>
                  <p className="text-2xl font-bold">{snap.nrr || 100}%</p>
                  <p className="text-xs text-muted-foreground mt-1">Retencao liquida de receita</p>
                </div>
              </Card>

              <MetricCard label="Clientes Ativos" value={fmtInt(snap.activeProviders || 0)}
                sub={`${snap.payingProviders || 0} pagantes · ${(snap.activeProviders || 0) - (snap.payingProviders || 0)} gratuitos`}
                icon={Users} color="cyan" testId="metric-active-providers" />

              <MetricCard label="Cobranca" value={`${invoiceHealth.collectionRate || 0}%`}
                sub={`R$ ${fmt(invoiceHealth.totalCollected || 0)} cobrado`}
                icon={CheckCircle}
                color={(invoiceHealth.collectionRate || 0) >= 90 ? "emerald" : (invoiceHealth.collectionRate || 0) >= 70 ? "amber" : "rose"}
                testId="metric-collection-rate" />
            </div>
          </div>

          {/* === ROW 3: MRR WATERFALL + TREND === */}
          <div className="grid lg:grid-cols-5 gap-4">
            {/* MRR Waterfall */}
            <Card className="lg:col-span-2 p-5">
              <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-500" />Waterfall de MRR
              </h3>
              <p className="text-xs text-muted-foreground mb-4">{now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</p>
              <div className="flex items-end gap-2 h-36">
                <WaterfallBar label="Inicio" value={waterfall.startingMrr || 0} type="start" max={maxWaterfall} />
                <div className="flex items-end text-muted-foreground self-center pb-4"><Plus className="w-3 h-3" /></div>
                <WaterfallBar label="Novo" value={waterfall.newMrr || 0} type="add" max={maxWaterfall} />
                <div className="flex items-end text-muted-foreground self-center pb-4"><Plus className="w-3 h-3" /></div>
                <WaterfallBar label="Expansao" value={waterfall.expansionMrr || 0} type="add" max={maxWaterfall} />
                <div className="flex items-end text-muted-foreground self-center pb-4"><Minus className="w-3 h-3" /></div>
                <WaterfallBar label="Contracão" value={waterfall.contractionMrr || 0} type="sub" max={maxWaterfall} />
                <div className="flex items-end text-muted-foreground self-center pb-4"><Minus className="w-3 h-3" /></div>
                <WaterfallBar label="Churn" value={waterfall.churnedMrr || 0} type="sub" max={maxWaterfall} />
                <div className="flex items-center self-center pb-4 text-muted-foreground text-xs">=</div>
                <WaterfallBar label="Final" value={waterfall.endingMrr || 0} type="end" max={maxWaterfall} />
              </div>
              {/* Summary row */}
              <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-2">
                {[
                  { label: "MRR Novo", value: waterfall.newMrr || 0, color: "text-emerald-600", icon: ArrowUp },
                  { label: "Expansao", value: waterfall.expansionMrr || 0, color: "text-emerald-500", icon: ArrowUp },
                  { label: "Contracão", value: waterfall.contractionMrr || 0, color: "text-rose-500", icon: ArrowDown },
                  { label: "Churn", value: waterfall.churnedMrr || 0, color: "text-rose-600", icon: ArrowDown },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <item.icon className={`w-3 h-3 ${item.color}`} />
                      <span className="text-[11px] text-muted-foreground">{item.label}</span>
                    </div>
                    <span className={`text-xs font-semibold ${item.color}`}>R$ {fmtInt(item.value)}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* 12-month Revenue Trend */}
            <Card className="lg:col-span-3 p-5">
              <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-indigo-500" />Receita Coletada (12 meses)
              </h3>
              <p className="text-xs text-muted-foreground mb-4">Faturas pagas por periodo</p>
              <div className="flex items-end gap-1.5 h-36">
                {last12.map((m: any) => {
                  const pct = maxRevenue > 0 ? (m.collectedRevenue / maxRevenue) * 100 : 0;
                  const isCurrent = m.period === currentPeriod;
                  return (
                    <div key={m.period} className="flex flex-col items-center flex-1 gap-1 group" title={`${periodLabel(m.period)}: R$ ${fmt(m.collectedRevenue)}`}>
                      <span className="text-[9px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        R${fmtInt(Math.round(m.collectedRevenue))}
                      </span>
                      <div
                        className={`w-full rounded-t-sm transition-all ${isCurrent ? "bg-gradient-to-t from-blue-500 to-indigo-400" : "bg-gradient-to-t from-blue-300 to-indigo-200"}`}
                        style={{ height: `${Math.max(pct, 3)}%` }}
                      />
                      <span className={`text-[9px] ${isCurrent ? "font-bold text-blue-600" : "text-muted-foreground"}`}>{periodLabel(m.period)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                <span>Total coletado (12m): <strong className="text-foreground">R$ {fmt(last12.reduce((s: number, m: any) => s + m.collectedRevenue, 0))}</strong></span>
                <span>Faturado: <strong className="text-foreground">R$ {fmt(last12.reduce((s: number, m: any) => s + m.billedRevenue, 0))}</strong></span>
              </div>
            </Card>
          </div>

          {/* === ROW 4: PLAN DISTRIBUTION + INVOICE HEALTH + MOVEMENTS === */}
          <div className="grid lg:grid-cols-3 gap-4">
            {/* Plan distribution */}
            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-amber-500" />Receita por Plano
              </h3>
              <div className="space-y-3">
                {Object.entries(planDist).sort(([, a]: any, [, b]: any) => b.mrr - a.mrr).map(([plan, data]: any) => {
                  const total = Object.values(planDist).reduce((s: number, d: any) => s + d.mrr, 0) as number;
                  const pct = total > 0 ? Math.round((data.mrr / total) * 100) : 0;
                  const pl = PLAN_LABELS[plan];
                  return (
                    <div key={plan}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${pl?.bg || "bg-gray-100"} border`} />
                          <span className="font-medium">{pl?.label || plan}</span>
                          <span className="text-muted-foreground">({data.count})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">R$ {fmtInt(data.mrr)}</span>
                          <span className="text-muted-foreground">{pct}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {Object.keys(planDist).length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Sem dados</p>}
              </div>
            </Card>

            {/* Invoice Health */}
            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4 text-rose-500" />Saude das Cobranças
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-xs text-muted-foreground">Taxa de cobranca</span>
                  <span className={`text-sm font-bold ${(invoiceHealth.collectionRate || 0) >= 90 ? "text-emerald-600" : (invoiceHealth.collectionRate || 0) >= 70 ? "text-amber-600" : "text-rose-600"}`}>
                    {invoiceHealth.collectionRate || 0}%
                  </span>
                </div>
                {[
                  { label: "Pagas", count: invoiceHealth.counts?.paid || 0, amount: invoiceHealth.totalCollected || 0, color: "text-emerald-600", bg: "bg-emerald-50" },
                  { label: "Pendentes", count: invoiceHealth.counts?.pending || 0, amount: 0, color: "text-amber-600", bg: "bg-amber-50" },
                  { label: "Vencidas", count: invoiceHealth.counts?.overdue || 0, amount: invoiceHealth.totalOverdue || 0, color: "text-rose-600", bg: "bg-rose-50" },
                ].map(row => (
                  <div key={row.label} className={`flex items-center justify-between px-3 py-2 rounded-lg ${row.bg}`}>
                    <div>
                      <p className={`text-xs font-semibold ${row.color}`}>{row.label}</p>
                      <p className="text-[11px] text-muted-foreground">{row.count} fatura(s)</p>
                    </div>
                    {row.amount > 0 && <span className={`text-xs font-bold ${row.color}`}>R$ {fmt(row.amount)}</span>}
                  </div>
                ))}
                {/* Aging */}
                {invoiceHealth.totalOverdue > 0 && (
                  <div className="mt-2 pt-2 border-t">
                    <p className="text-[11px] text-muted-foreground font-semibold mb-2 uppercase tracking-wide">Aging de inadimplencia</p>
                    {Object.entries(invoiceHealth.agingBuckets || {}).map(([range, val]: any) => (
                      val > 0 && (
                        <div key={range} className="flex items-center justify-between text-xs py-0.5">
                          <span className="text-muted-foreground">{range} dias</span>
                          <span className="font-semibold text-rose-600">R$ {fmt(val)}</span>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {/* MRR Movements this month */}
            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4 text-indigo-500" />Movimentacoes do Mes
              </h3>
              <div className="space-y-2">
                {waterfall.upgrades?.length > 0 && (
                  <>
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Upgrades</p>
                    {waterfall.upgrades.map((u: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-emerald-50">
                        <div>
                          <span className="font-medium text-emerald-800">{u.provider}</span>
                          <span className="text-emerald-600 ml-1">{PLAN_LABELS[u.from]?.label} → {PLAN_LABELS[u.to]?.label}</span>
                        </div>
                        <span className="text-emerald-700 font-bold">+R${u.delta}</span>
                      </div>
                    ))}
                  </>
                )}
                {waterfall.downgrades?.length > 0 && (
                  <>
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-2">Downgrades</p>
                    {waterfall.downgrades.map((d: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-amber-50">
                        <div>
                          <span className="font-medium text-amber-800">{d.provider}</span>
                          <span className="text-amber-600 ml-1">{PLAN_LABELS[d.from]?.label} → {PLAN_LABELS[d.to]?.label}</span>
                        </div>
                        <span className="text-amber-700 font-bold">-R${d.delta}</span>
                      </div>
                    ))}
                  </>
                )}
                {waterfall.churns?.length > 0 && (
                  <>
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-2">Churn</p>
                    {waterfall.churns.map((c: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-rose-50">
                        <div>
                          <span className="font-medium text-rose-800">{c.provider}</span>
                          <span className="text-rose-600 ml-1">{PLAN_LABELS[c.oldPlan]?.label} → Gratuito</span>
                        </div>
                        <span className="text-rose-700 font-bold">-R${c.mrr}</span>
                      </div>
                    ))}
                  </>
                )}
                {!waterfall.upgrades?.length && !waterfall.downgrades?.length && !waterfall.churns?.length && (
                  <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <CheckCircle className="w-8 h-8 text-emerald-400 opacity-60" />
                    <p className="text-xs text-muted-foreground text-center">Nenhuma movimentacao este mes</p>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* === ROW 5: PROVIDER BILLING HEALTH TABLE === */}
          <Card className="overflow-hidden">
            <div className="p-5 border-b flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-500" />Saude de Cobranca por Provedor
              </h3>
              <span className="text-xs text-muted-foreground">{provHealth.length} provedores</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/20">
                    <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground">Provedor</th>
                    <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground">Plano</th>
                    <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground">MRR</th>
                    <th className="text-center py-2.5 px-4 font-semibold text-muted-foreground">Faturas</th>
                    <th className="text-center py-2.5 px-4 font-semibold text-muted-foreground">Em Atraso</th>
                    <th className="text-center py-2.5 px-4 font-semibold text-muted-foreground">Status</th>
                    <th className="text-center py-2.5 px-4 font-semibold text-muted-foreground">Asaas</th>
                    <th className="text-center py-2.5 px-4 font-semibold text-muted-foreground">Acao</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {provHealth.sort((a: any, b: any) => b.mrr - a.mrr).map((p: any) => {
                    const pl = PLAN_LABELS[p.plan];
                    return (
                      <tr key={p.id} className="hover:bg-muted/10 transition-colors" data-testid={`provider-health-row-${p.id}`}>
                        <td className="py-2.5 px-4 font-medium">{p.name}</td>
                        <td className="py-2.5 px-4">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${pl?.bg} ${pl?.color}`}>{pl?.label || p.plan}</span>
                        </td>
                        <td className="py-2.5 px-4 text-right font-semibold">
                          {p.mrr > 0 ? `R$ ${fmtInt(p.mrr)}` : <span className="text-muted-foreground">Gratuito</span>}
                        </td>
                        <td className="py-2.5 px-4 text-center text-muted-foreground">{p.paidCount}/{p.invoicesCount}</td>
                        <td className="py-2.5 px-4 text-center">
                          {p.overdueCount > 0
                            ? <span className="text-rose-600 font-semibold">{p.overdueCount} (R${fmtInt(p.overdueAmount)})</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          {p.health === "good" && <Badge className="text-[10px] bg-emerald-100 text-emerald-700">Em dia</Badge>}
                          {p.health === "overdue" && <Badge className="text-[10px] bg-rose-100 text-rose-700">Inadimplente</Badge>}
                          {p.health === "new" && <Badge className="text-[10px] bg-gray-100 text-gray-600">Novo</Badge>}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          {p.hasAsaas ? <Wallet className="w-3.5 h-3.5 text-blue-500 mx-auto" title="Cobranca Asaas ativa" /> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] gap-1"
                            onClick={() => navigate(`/admin/provedor/${p.id}`)}
                            data-testid={`button-go-provider-${p.id}`}>
                            Ver <ChevronRight className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* === ROW 6: INVOICE MANAGEMENT === */}
          <Card className="overflow-hidden">
            <div className="p-5 border-b">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-500" />Gestao de Faturas
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{allInvoices.length} fatura(s) no sistema</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {asaasStatus?.configured && (
                    <div className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-2.5 py-1.5 rounded-lg">
                      <Wallet className="w-3.5 h-3.5" />
                      Asaas {asaasStatus.mode === "sandbox" ? "Sandbox" : "Producao"} ativo
                    </div>
                  )}
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs"
                    onClick={() => {
                      const period = currentPeriod;
                      if (confirm(`Gerar faturas mensais para ${period}?`)) generateMonthlyMutation.mutate(period);
                    }}
                    disabled={generateMonthlyMutation.isPending} data-testid="button-generate-monthly">
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
                  { value: "all", label: "Todas", count: allInvoices.length },
                  { value: "pending", label: "Pendentes", count: allInvoices.filter((i: any) => i.status === "pending" && new Date(i.dueDate) >= now).length },
                  { value: "paid", label: "Pagas", count: allInvoices.filter((i: any) => i.status === "paid").length },
                  { value: "overdue", label: "Vencidas", count: allInvoices.filter((i: any) => i.status === "overdue" || (i.status === "pending" && new Date(i.dueDate) < now)).length },
                  { value: "cancelled", label: "Canceladas", count: allInvoices.filter((i: any) => i.status === "cancelled").length },
                ].map(f => (
                  <Button key={f.value} size="sm" variant={invoiceFilter === f.value ? "default" : "outline"}
                    className="h-7 text-xs px-3" onClick={() => setInvoiceFilter(f.value)}
                    data-testid={`button-filter-${f.value}`}>
                    {f.label} <span className="ml-1 opacity-70">({f.count})</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* New Invoice Form */}
            {showNewInvoice && (
              <div className="p-5 border-b bg-muted/20">
                <h4 className="font-medium text-sm mb-4">Emitir Nova Fatura</h4>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Provedor</label>
                    <Select value={invoiceForm.providerId} onValueChange={(v) => {
                      const p = allProviders.find((x: any) => x.id.toString() === v);
                      if (p) {
                        const PLAN_CREDITS_MAP: Record<string, { isp: number; spc: number }> = {
                          free: { isp: 50, spc: 0 }, basic: { isp: 200, spc: 50 }, pro: { isp: 500, spc: 150 }, enterprise: { isp: 1500, spc: 500 }
                        };
                        const credits = PLAN_CREDITS_MAP[p.plan] || { isp: 0, spc: 0 };
                        setInvoiceForm(f => ({ ...f, providerId: v, planAtTime: p.plan, amount: (PLAN_PRICES[p.plan] || 0).toString(), ispCreditsIncluded: credits.isp.toString(), spcCreditsIncluded: credits.spc.toString() }));
                      } else setInvoiceForm(f => ({ ...f, providerId: v }));
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
                    <label className="text-xs font-medium mb-1 block">Periodo (AAAA-MM)</label>
                    <Input className="h-8 text-xs mt-1" placeholder={currentPeriod} value={invoiceForm.period} onChange={e => setInvoiceForm(f => ({ ...f, period: e.target.value }))} data-testid="input-invoice-period" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Plano Cobrado</label>
                    <Select value={invoiceForm.planAtTime} onValueChange={v => {
                      const PLAN_CREDITS_MAP: Record<string, { isp: number; spc: number }> = { free: { isp: 50, spc: 0 }, basic: { isp: 200, spc: 50 }, pro: { isp: 500, spc: 150 }, enterprise: { isp: 1500, spc: 500 } };
                      const credits = PLAN_CREDITS_MAP[v] || { isp: 0, spc: 0 };
                      setInvoiceForm(f => ({ ...f, planAtTime: v, amount: (PLAN_PRICES[v] || 0).toString(), ispCreditsIncluded: credits.isp.toString(), spcCreditsIncluded: credits.spc.toString() }));
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
                    <label className="text-xs font-medium mb-1 block">Valor (R$)</label>
                    <Input className="h-8 text-xs mt-1" type="number" placeholder="199" value={invoiceForm.amount} onChange={e => setInvoiceForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-invoice-amount" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Vencimento</label>
                    <Input className="h-8 text-xs mt-1" type="date" value={invoiceForm.dueDate} onChange={e => setInvoiceForm(f => ({ ...f, dueDate: e.target.value }))} data-testid="input-invoice-due-date" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Observacoes</label>
                    <Input className="h-8 text-xs mt-1" placeholder="Opcional..." value={invoiceForm.notes} onChange={e => setInvoiceForm(f => ({ ...f, notes: e.target.value }))} />
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
                <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <FileText className="w-8 h-8 text-muted-foreground opacity-40" />
                <p className="text-sm text-muted-foreground">Nenhuma fatura encontrada</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/20">
                      <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground">Numero</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground">Provedor</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground">Periodo</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground">Plano</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground">Valor</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground">Vencimento</th>
                      <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground">Status</th>
                      <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredInvoices.map((inv: any) => {
                      const isOverdue = inv.status === "pending" && new Date(inv.dueDate) < now;
                      const displayStatus = isOverdue ? "overdue" : inv.status;
                      return (
                        <tr key={inv.id} className="hover:bg-muted/10 transition-colors" data-testid={`invoice-row-${inv.id}`}>
                          <td className="py-3 px-4">
                            <span className="font-mono text-xs font-medium text-blue-700">{inv.invoiceNumber}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-medium text-xs">{inv.providerName}</span>
                          </td>
                          <td className="py-3 px-4 text-xs text-muted-foreground">{inv.period}</td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${PLAN_LABELS[inv.planAtTime]?.bg} ${PLAN_LABELS[inv.planAtTime]?.color}`}>
                              {PLAN_LABELS[inv.planAtTime]?.label || inv.planAtTime}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-xs">
                            R$ {fmt(parseFloat(inv.paidAmount || inv.amount))}
                          </td>
                          <td className="py-3 px-4 text-xs text-muted-foreground">
                            {new Date(inv.dueDate).toLocaleDateString("pt-BR")}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${STATUS_STYLE[displayStatus] || STATUS_STYLE.pending}`}>
                                {STATUS_LABEL[displayStatus] || displayStatus}
                              </span>
                              {inv.asaasChargeId && (
                                <span className="text-[9px] text-blue-500 font-medium flex items-center gap-0.5">
                                  <Wallet className="w-2.5 h-2.5" />Asaas
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-center gap-1">
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => navigate(`/admin/fatura/${inv.id}`)} title="Ver fatura" data-testid={`button-view-invoice-${inv.id}`}>
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                              {(inv.status === "pending" || isOverdue) && !inv.asaasChargeId && asaasStatus?.configured && (
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  onClick={() => setAsaasChargeModal({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber })}
                                  title="Cobrar via Asaas" data-testid={`button-asaas-charge-${inv.id}`}>
                                  <Wallet className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              {inv.asaasChargeId && (
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-indigo-500 hover:bg-indigo-50"
                                  onClick={() => syncChargeMutation.mutate(inv.id)} title="Sincronizar Asaas"
                                  disabled={syncChargeMutation.isPending} data-testid={`button-asaas-sync-${inv.id}`}>
                                  {syncChargeMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                                </Button>
                              )}
                              {inv.asaasInvoiceUrl && (
                                <a href={inv.asaasInvoiceUrl} target="_blank" rel="noopener noreferrer"
                                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                  title="Link de pagamento" data-testid={`link-asaas-payment-${inv.id}`}>
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}
                              {(inv.status === "pending" || isOverdue) && (
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-50"
                                  onClick={() => updateInvoiceStatusMutation.mutate({ id: inv.id, status: "paid", paidAmount: inv.amount })}
                                  title="Marcar como pago" data-testid={`button-mark-paid-${inv.id}`}>
                                  <CheckCircle className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              {(inv.status === "pending" || isOverdue) && (
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-rose-500 hover:bg-rose-50"
                                  onClick={() => { if (confirm("Cancelar esta fatura?")) cancelInvoiceMutation.mutate(inv.id); }}
                                  title="Cancelar fatura" data-testid={`button-cancel-invoice-${inv.id}`}>
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
            )}
          </Card>
        </>
      )}
    </div>
  );
}
