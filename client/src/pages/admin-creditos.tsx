import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import {
  CreditCard, Plus, RefreshCw, CheckCircle, XCircle, Clock,
  Wallet, QrCode, Copy, ExternalLink, RotateCcw, CheckCheck,
  ScanLine, ArrowUpRight, History, Search, Shield,
  Filter, Users, DollarSign, TrendingUp, ShoppingCart,
} from "lucide-react";

const ISP_PACKAGES = [
  { id: "isp-50",  name: "50 ISP",  credits: 50,   price: "49.90" },
  { id: "isp-100", name: "100 ISP", credits: 100,  price: "89.90" },
  { id: "isp-250", name: "250 ISP", credits: 250,  price: "199.90" },
  { id: "isp-500", name: "500 ISP", credits: 500,  price: "349.90" },
];

const SPC_PACKAGES = [
  { id: "spc-10",  name: "10 SPC",  credits: 10,   price: "49.90" },
  { id: "spc-30",  name: "30 SPC",  credits: 30,   price: "129.90" },
  { id: "spc-50",  name: "50 SPC",  credits: 50,   price: "199.90" },
  { id: "spc-100", name: "100 SPC", credits: 100,  price: "349.90" },
];

const ALL_PACKAGES = [
  ...ISP_PACKAGES.map(p => ({ ...p, creditType: "isp" })),
  ...SPC_PACKAGES.map(p => ({ ...p, creditType: "spc" })),
];

const STATUS_STYLES: Record<string, { badge: string; label: string; icon: any }> = {
  pending:   { badge: "bg-amber-100 text-amber-700",   label: "Pendente",  icon: Clock },
  paid:      { badge: "bg-emerald-100 text-emerald-700", label: "Pago",    icon: CheckCheck },
  cancelled: { badge: "bg-gray-100 text-gray-600",     label: "Cancelado", icon: XCircle },
  overdue:   { badge: "bg-red-100 text-red-700",       label: "Vencido",   icon: XCircle },
};

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AdminCreditosPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isSuperAdmin = user?.role === "superadmin";

  const [showNewOrder, setShowNewOrder] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterProvider, setFilterProvider] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [asaasChargeModal, setAsaasChargeModal] = useState<{ orderId: number; orderNumber: string; amount: string } | null>(null);
  const [pixModal, setPixModal] = useState<{ pixData: any } | null>(null);
  const [form, setForm] = useState({
    providerId: "", packageId: "isp-100",
    creditType: "isp", customCredits: "100", customAmount: "99.90",
    notes: "", billingType: "",
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/credit-orders"],
    enabled: isSuperAdmin,
    refetchInterval: 30000,
  });

  const { data: allProviders = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    enabled: isSuperAdmin,
  });

  const { data: asaasStatus } = useQuery<any>({
    queryKey: ["/api/admin/asaas/status"],
    enabled: isSuperAdmin,
    staleTime: 60000,
  });

  const createOrderMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/credit-orders", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/credit-orders"] });
      setShowNewOrder(false);
      setForm({ providerId: "", packageId: "isp-100", creditType: "isp", customCredits: "100", customAmount: "99.90", notes: "", billingType: "" });
      toast({ title: "Pedido criado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const releaseMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/credit-orders/${id}/release`, {});
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/credit-orders"] });
      toast({ title: "Creditos liberados!", description: data.message });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/admin/credit-orders/${id}`, { status: "cancelled" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/credit-orders"] });
      toast({ title: "Pedido cancelado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const createChargeMutation = useMutation({
    mutationFn: async ({ id, billingType }: { id: number; billingType: string }) => {
      const res = await apiRequest("POST", `/api/admin/credit-orders/${id}/asaas/charge`, { billingType });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/credit-orders"] });
      setAsaasChargeModal(null);
      toast({ title: "Cobranca Asaas criada" });
    },
    onError: (e: any) => toast({ title: "Erro Asaas", description: e.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/credit-orders/${id}/asaas/sync`, {});
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/credit-orders"] });
      toast({ title: "Sincronizado", description: data.message || "Status atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const pixMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("GET", `/api/admin/credit-orders/${id}/asaas/pix`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => setPixModal({ pixData: data }),
    onError: (e: any) => toast({ title: "Erro PIX", description: e.message, variant: "destructive" }),
  });

  if (!isSuperAdmin) {
    return <div className="flex items-center justify-center h-full"><p className="text-muted-foreground">Acesso restrito a superadmin.</p></div>;
  }

  const filteredOrders = orders.filter(o => {
    if (filterStatus !== "all" && o.status !== filterStatus) return false;
    if (filterProvider !== "all" && o.providerId.toString() !== filterProvider) return false;
    if (filterType !== "all" && o.creditType !== filterType) return false;
    return true;
  });

  const totalPending = orders.filter(o => o.status === "pending").length;
  const totalRevenue = orders.filter(o => o.status === "paid").reduce((s: number, o: any) => s + parseFloat(o.amount), 0);
  const totalIspReleased = orders.filter(o => o.status === "paid").reduce((s: number, o: any) => s + o.ispCredits, 0);
  const totalSpcReleased = orders.filter(o => o.status === "paid").reduce((s: number, o: any) => s + o.spcCredits, 0);

  const selectedPkg = ALL_PACKAGES.find(p => p.id === form.packageId);

  return (
    <div className="p-5 pb-10 space-y-5 max-w-[1200px] mx-auto">
      {asaasChargeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAsaasChargeModal(null)}>
          <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-1 flex items-center gap-2"><Wallet className="w-4 h-4 text-blue-500" />Cobrar via Asaas</h2>
            <p className="text-xs text-muted-foreground mb-4">Pedido {asaasChargeModal.orderNumber} · R$ {parseFloat(asaasChargeModal.amount).toFixed(2).replace(".", ",")}</p>
            <div className="space-y-2">
              {[
                { type: "UNDEFINED", label: "Livre — cliente escolhe", icon: Wallet },
                { type: "PIX", label: "PIX", icon: QrCode },
                { type: "BOLETO", label: "Boleto Bancario", icon: ScanLine },
              ].map(opt => (
                <button key={opt.type}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                  disabled={createChargeMutation.isPending}
                  onClick={() => createChargeMutation.mutate({ id: asaasChargeModal.orderId, billingType: opt.type })}
                  data-testid={`button-modal-charge-${opt.type.toLowerCase()}`}>
                  {createChargeMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" /> : <opt.icon className="w-4 h-4 text-blue-500" />}
                  <span className="text-sm font-medium">{opt.label}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-3 w-full text-xs" onClick={() => setAsaasChargeModal(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      {pixModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setPixModal(null)}>
          <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-sm text-center" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-1 flex items-center gap-2 justify-center"><QrCode className="w-4 h-4 text-blue-500" />QR Code PIX</h2>
            {pixModal.pixData?.encodedImage
              ? <img src={`data:image/png;base64,${pixModal.pixData.encodedImage}`} alt="QR Code PIX" className="mx-auto w-48 h-48 my-4 rounded-lg border" />
              : <div className="w-48 h-48 mx-auto my-4 rounded-lg border bg-muted/30 flex items-center justify-center"><QrCode className="w-12 h-12 text-muted-foreground opacity-40" /></div>}
            {pixModal.pixData?.payload && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Copia e Cola:</p>
                <div className="flex gap-2 items-center">
                  <code className="text-xs bg-muted rounded px-2 py-1 flex-1 text-left truncate">{pixModal.pixData.payload}</code>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0 flex-shrink-0"
                    onClick={() => { navigator.clipboard.writeText(pixModal.pixData.payload); toast({ title: "Copiado!" }); }}>
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
            <Button variant="ghost" size="sm" className="mt-3 w-full text-xs" onClick={() => setPixModal(null)}>Fechar</Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-emerald-500" />Pedidos de Creditos
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Gerencie compras de creditos ISP e SPC dos provedores</p>
        </div>
        <div className="flex items-center gap-2">
          {asaasStatus?.configured && (
            <Badge className={`text-xs ${asaasStatus.mode === "sandbox" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
              <Wallet className="w-3 h-3 mr-1" />{asaasStatus.mode === "sandbox" ? "Sandbox" : "Producao"}
            </Badge>
          )}
          <Button variant="outline" size="sm" className="gap-1.5 text-xs"
            onClick={() => qc.invalidateQueries({ queryKey: ["/api/admin/credit-orders"] })}
            data-testid="button-refresh-orders">
            <RefreshCw className="w-3.5 h-3.5" />Atualizar
          </Button>
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setShowNewOrder(!showNewOrder)} data-testid="button-new-order">
            <Plus className="w-3.5 h-3.5" />Novo Pedido
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: "Total de Pedidos", value: orders.length.toString(), icon: ShoppingCart, color: "from-blue-500 to-blue-600" },
          { label: "Pendentes", value: totalPending.toString(), icon: Clock, color: "from-amber-500 to-amber-600" },
          { label: "Receita Gerada", value: `R$ ${fmt(totalRevenue)}`, icon: DollarSign, color: "from-emerald-500 to-emerald-600" },
          { label: "ISP Liberados", value: totalIspReleased.toLocaleString("pt-BR"), icon: Search, color: "from-blue-500 to-blue-600" },
          { label: "SPC Liberados", value: totalSpcReleased.toLocaleString("pt-BR"), icon: Shield, color: "from-purple-500 to-purple-600" },
        ].map(card => (
          <Card key={card.label} className="overflow-hidden">
            <div className={`h-1 bg-gradient-to-r ${card.color}`} />
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-muted-foreground font-semibold uppercase tracking-widest">{card.label}</span>
                <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${card.color} flex items-center justify-center`}>
                  <card.icon className="w-3.5 h-3.5 text-white" />
                </div>
              </div>
              <p className="text-xl font-bold">{card.value}</p>
            </div>
          </Card>
        ))}
      </div>

      {showNewOrder && (
        <Card className="p-5 border-blue-200 bg-blue-50/30">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-blue-500" />Gerar Pedido de Credito
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Provedor *</label>
              <Select value={form.providerId} onValueChange={v => setForm(f => ({ ...f, providerId: v }))}>
                <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-order-provider">
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
              <label className="text-xs font-medium mb-1 block">Pacote *</label>
              <Select value={form.packageId} onValueChange={v => {
                const pkg = ALL_PACKAGES.find(p => p.id === v);
                setForm(f => ({
                  ...f, packageId: v,
                  creditType: pkg ? pkg.creditType : f.creditType,
                  customCredits: pkg ? pkg.credits.toString() : f.customCredits,
                  customAmount: pkg ? pkg.price : f.customAmount,
                }));
              }}>
                <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-order-package">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__label_isp" disabled>-- Consulta ISP --</SelectItem>
                  {ISP_PACKAGES.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} — R$ {p.price}</SelectItem>
                  ))}
                  <SelectItem value="__label_spc" disabled>-- Consulta SPC --</SelectItem>
                  {SPC_PACKAGES.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} — R$ {p.price}</SelectItem>
                  ))}
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Cobranca Asaas (opcional)</label>
              <Select value={form.billingType} onValueChange={v => setForm(f => ({ ...f, billingType: v }))}>
                <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-order-billing">
                  <SelectValue placeholder="Sem cobranca Asaas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem cobranca automatica</SelectItem>
                  <SelectItem value="UNDEFINED">Asaas — Livre</SelectItem>
                  <SelectItem value="PIX">Asaas — PIX</SelectItem>
                  <SelectItem value="BOLETO">Asaas — Boleto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.packageId === "custom" && (
              <>
                <div>
                  <label className="text-xs font-medium mb-1 block">Tipo de Credito</label>
                  <Select value={form.creditType} onValueChange={v => setForm(f => ({ ...f, creditType: v }))}>
                    <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-custom-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="isp">Consulta ISP</SelectItem>
                      <SelectItem value="spc">Consulta SPC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Quantidade de Creditos</label>
                  <Input className="h-8 text-xs mt-1" type="number" value={form.customCredits} onChange={e => setForm(f => ({ ...f, customCredits: e.target.value }))} data-testid="input-custom-credits" />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Valor (R$)</label>
                  <Input className="h-8 text-xs mt-1" type="number" step="0.01" value={form.customAmount} onChange={e => setForm(f => ({ ...f, customAmount: e.target.value }))} data-testid="input-custom-amount" />
                </div>
              </>
            )}
            <div className={form.packageId === "custom" ? "lg:col-span-3" : "lg:col-span-3"}>
              <label className="text-xs font-medium mb-1 block">Observacoes (opcional)</label>
              <Input className="h-8 text-xs mt-1" placeholder="Ex: Cortesia, campanha especial..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          {form.providerId && form.packageId && (
            <div className="mt-3 p-3 bg-background rounded-lg border text-xs flex items-center gap-4">
              <div>
                <span className="text-muted-foreground">Provedor: </span>
                <strong>{allProviders.find((p: any) => p.id.toString() === form.providerId)?.name || "—"}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Creditos: </span>
                <strong>
                  {form.packageId === "custom"
                    ? `${form.customCredits} ${form.creditType.toUpperCase()}`
                    : `${selectedPkg?.credits} ${selectedPkg?.creditType.toUpperCase()}`}
                </strong>
              </div>
              <div>
                <span className="text-muted-foreground">Valor: </span>
                <strong>R$ {form.packageId === "custom" ? parseFloat(form.customAmount || "0").toFixed(2) : parseFloat(selectedPkg?.price || "0").toFixed(2)}</strong>
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <Button size="sm" className="gap-1.5 text-xs" disabled={!form.providerId || createOrderMutation.isPending}
              onClick={() => createOrderMutation.mutate({
                providerId: form.providerId,
                packageId: (form.packageId === "custom" || form.packageId.startsWith("__")) ? undefined : form.packageId,
                creditType: form.creditType,
                customCredits: form.customCredits,
                customAmount: form.customAmount,
                notes: form.notes,
                billingType: (form.billingType && form.billingType !== "none") ? form.billingType : undefined,
              })}
              data-testid="button-submit-order">
              {createOrderMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Criar Pedido
            </Button>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowNewOrder(false)} data-testid="button-cancel-new-order">Cancelar</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="p-4 border-b flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            {[
              { v: "all", l: "Todos", count: orders.length },
              { v: "pending", l: "Pendentes", count: orders.filter((o: any) => o.status === "pending").length },
              { v: "paid", l: "Pagos", count: orders.filter((o: any) => o.status === "paid").length },
              { v: "cancelled", l: "Cancelados", count: orders.filter((o: any) => o.status === "cancelled").length },
            ].map(f => (
              <Button key={f.v} size="sm" variant={filterStatus === f.v ? "default" : "outline"}
                className="h-7 text-xs px-3" onClick={() => setFilterStatus(f.v)}
                data-testid={`button-filter-status-${f.v}`}>
                {f.l} ({f.count})
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="h-7 text-xs w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos tipos</SelectItem>
                <SelectItem value="isp">ISP</SelectItem>
                <SelectItem value="spc">SPC</SelectItem>
                <SelectItem value="mixed">Misto</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterProvider} onValueChange={setFilterProvider}>
              <SelectTrigger className="h-7 text-xs w-44">
                <SelectValue placeholder="Todos os provedores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os provedores</SelectItem>
                {allProviders.map((p: any) => (
                  <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {ordersLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <ShoppingCart className="w-8 h-8 text-muted-foreground opacity-30" />
            <p className="text-sm text-muted-foreground">Nenhum pedido encontrado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/20">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground">Pedido</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground">Provedor</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground">Tipo</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground">Creditos</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground">Valor</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground">Status</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground">Data</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredOrders.map((order: any) => {
                  const st = STATUS_STYLES[order.status] || STATUS_STYLES.pending;
                  const ct = order.creditType || "mixed";
                  const isIsp = ct === "isp";
                  const isSpc = ct === "spc";
                  const creditLabel = isIsp
                    ? `${order.ispCredits} ISP`
                    : isSpc
                      ? `${order.spcCredits} SPC`
                      : `${order.ispCredits} ISP + ${order.spcCredits} SPC`;
                  const typeBadge = isIsp
                    ? "bg-blue-100 text-blue-700"
                    : isSpc
                      ? "bg-purple-100 text-purple-700"
                      : "bg-gray-100 text-gray-600";
                  const typeLabel = isIsp ? "ISP" : isSpc ? "SPC" : "Misto";
                  return (
                    <tr key={order.id} className="hover:bg-muted/10 transition-colors" data-testid={`order-row-${order.id}`}>
                      <td className="py-3 px-4">
                        <span className="font-mono text-xs font-semibold text-blue-700">{order.orderNumber}</span>
                        {order.notes && <p className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[120px]">{order.notes}</p>}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs font-medium">{order.providerName}</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${typeBadge}`}>
                          {isIsp ? <Search className="w-3 h-3 inline mr-0.5" /> : isSpc ? <Shield className="w-3 h-3 inline mr-0.5" /> : null}
                          {typeLabel}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center text-xs font-semibold">{creditLabel}</td>
                      <td className="py-3 px-4 text-right text-xs font-bold">R$ {parseFloat(order.amount).toFixed(2).replace(".", ",")}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${st.badge}`}>{st.label}</span>
                        {order.asaasChargeId && <Wallet className="w-3 h-3 text-blue-400 inline ml-1" title="Asaas" />}
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        {order.createdAt && new Date(order.createdAt).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-1">
                          {order.status === "pending" && (
                            <>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-600"
                                title="Liberar creditos" onClick={() => releaseMutation.mutate(order.id)}
                                disabled={releaseMutation.isPending} data-testid={`button-release-${order.id}`}>
                                <CheckCircle className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500"
                                title="Cancelar pedido" onClick={() => cancelMutation.mutate(order.id)}
                                disabled={cancelMutation.isPending} data-testid={`button-cancel-${order.id}`}>
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                              {!order.asaasChargeId && (
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-500"
                                  title="Cobrar via Asaas" onClick={() => setAsaasChargeModal({ orderId: order.id, orderNumber: order.orderNumber, amount: order.amount })}
                                  data-testid={`button-charge-${order.id}`}>
                                  <ArrowUpRight className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </>
                          )}
                          {order.asaasChargeId && (
                            <>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-indigo-500"
                                title="Sincronizar Asaas" onClick={() => syncMutation.mutate(order.id)}
                                disabled={syncMutation.isPending} data-testid={`button-sync-${order.id}`}>
                                <RotateCcw className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-500"
                                title="QR Code PIX" onClick={() => pixMutation.mutate(order.id)}
                                disabled={pixMutation.isPending} data-testid={`button-pix-${order.id}`}>
                                <QrCode className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          {order.asaasInvoiceUrl && (
                            <a href={order.asaasInvoiceUrl} target="_blank" rel="noopener noreferrer"
                              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-blue-600">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
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
    </div>
  );
}
