import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CreditCard, Zap, CheckCircle, ShoppingCart,
  QrCode, Copy, ExternalLink, RefreshCw, Clock, CheckCheck,
  XCircle, Wallet, ScanLine, ArrowRight, Info, History,
  Search, Shield,
} from "lucide-react";

const ISP_PACKAGES = [
  { id: "isp-50",   name: "50 Consultas ISP",   credits: 50,   price: 4990,  priceLabel: "R$ 49,90",  perUnit: "R$ 1,00/consulta" },
  { id: "isp-100",  name: "100 Consultas ISP",  credits: 100,  price: 8990,  priceLabel: "R$ 89,90",  perUnit: "R$ 0,90/consulta", popular: true },
  { id: "isp-250",  name: "250 Consultas ISP",  credits: 250,  price: 19990, priceLabel: "R$ 199,90", perUnit: "R$ 0,80/consulta" },
  { id: "isp-500",  name: "500 Consultas ISP",  credits: 500,  price: 34990, priceLabel: "R$ 349,90", perUnit: "R$ 0,70/consulta" },
];

const SPC_PACKAGES = [
  { id: "spc-10",   name: "10 Consultas SPC",   credits: 10,   price: 4990,  priceLabel: "R$ 49,90",  perUnit: "R$ 4,99/consulta" },
  { id: "spc-30",   name: "30 Consultas SPC",   credits: 30,   price: 12990, priceLabel: "R$ 129,90", perUnit: "R$ 4,33/consulta", popular: true },
  { id: "spc-50",   name: "50 Consultas SPC",   credits: 50,   price: 19990, priceLabel: "R$ 199,90", perUnit: "R$ 4,00/consulta" },
  { id: "spc-100",  name: "100 Consultas SPC",  credits: 100,  price: 34990, priceLabel: "R$ 349,90", perUnit: "R$ 3,50/consulta" },
];

const STATUS_STYLES: Record<string, { badge: string; label: string; icon: any }> = {
  pending:   { badge: "bg-amber-100 text-amber-700",  label: "Aguardando Pagamento", icon: Clock },
  paid:      { badge: "bg-emerald-100 text-emerald-700", label: "Creditos Liberados", icon: CheckCheck },
  cancelled: { badge: "bg-gray-100 text-gray-600",    label: "Cancelado",            icon: XCircle },
  overdue:   { badge: "bg-red-100 text-red-700",      label: "Vencido",              icon: XCircle },
};

export default function CreditosPage() {
  const { provider } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedPkg, setSelectedPkg] = useState<{ pkg: any; type: "isp" | "spc" } | null>(null);
  const [payModal, setPayModal] = useState<{ order: any; charge: any } | null>(null);
  const [pixModal, setPixModal] = useState<{ pixData: any } | null>(null);
  const [activeTab, setActiveTab] = useState<"isp" | "spc">("isp");

  const { data: orders = [], isLoading: ordersLoading } = useQuery<any[]>({
    queryKey: ["/api/credits/orders"],
  });

  const purchaseMutation = useMutation({
    mutationFn: async ({ packageId, billingType }: { packageId: string; billingType: string }) => {
      const res = await apiRequest("POST", "/api/credits/purchase", { packageId, billingType });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/credits/orders"] });
      qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setSelectedPkg(null);
      setPayModal(data);
      toast({ title: "Pedido criado com sucesso!" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const pixMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const res = await apiRequest("GET", `/api/credits/orders/${orderId}/asaas/pix`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => setPixModal({ pixData: data }),
    onError: (e: any) => toast({ title: "Erro ao buscar PIX", description: e.message, variant: "destructive" }),
  });

  const pendingOrders = orders.filter(o => o.status === "pending" || o.status === "overdue");

  const renderPackageCard = (pkg: any, type: "isp" | "spc") => {
    const isIsp = type === "isp";
    const colorBg = isIsp ? "bg-blue-100" : "bg-purple-100";
    const colorText = isIsp ? "text-blue-600" : "text-purple-600";
    const ringColor = isIsp ? "ring-blue-500" : "ring-purple-500";
    const badgeColor = isIsp ? "bg-blue-600" : "bg-purple-600";

    return (
      <Card key={pkg.id}
        className={`p-4 relative overflow-hidden cursor-pointer transition-all hover:shadow-md ${pkg.popular ? `ring-2 ${ringColor}` : "hover:ring-1 hover:ring-border"}`}
        onClick={() => setSelectedPkg({ pkg, type })}
        data-testid={`package-${pkg.id}`}>
        {pkg.popular && (
          <Badge className={`absolute top-2.5 right-2.5 ${badgeColor} border-0 text-white text-[10px]`}>Mais Popular</Badge>
        )}
        <div className="mb-3">
          <div className={`w-9 h-9 rounded-lg mb-2 flex items-center justify-center ${colorBg}`}>
            {isIsp ? <Search className={`w-4 h-4 ${colorText}`} /> : <Shield className={`w-4 h-4 ${colorText}`} />}
          </div>
          <h3 className="font-bold text-sm">{pkg.credits} creditos</h3>
          <p className="text-lg font-bold mt-0.5">{pkg.priceLabel}</p>
          <p className="text-[11px] text-muted-foreground">{pkg.perUnit}</p>
        </div>
        <div className="space-y-1 mb-3">
          <div className="flex items-center gap-1.5 text-xs">
            <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0" />
            <span><strong>{pkg.credits}</strong> consultas {type.toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0" />
            <span>Liberacao imediata via PIX</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0" />
            <span>Creditos nao expiram</span>
          </div>
        </div>
        <Button className="w-full gap-1.5 text-xs h-8" variant={pkg.popular ? "default" : "secondary"}
          data-testid={`button-buy-${pkg.id}`}>
          <ShoppingCart className="w-3.5 h-3.5" />Comprar
          <ArrowRight className="w-3 h-3 ml-auto" />
        </Button>
      </Card>
    );
  };

  return (
    <div className="p-5 pb-10 space-y-6 max-w-4xl mx-auto" data-testid="creditos-page">

      {selectedPkg && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedPkg(null)}>
          <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className={`w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center ${selectedPkg.type === "isp" ? "bg-blue-100" : "bg-purple-100"}`}>
                {selectedPkg.type === "isp"
                  ? <Search className="w-6 h-6 text-blue-600" />
                  : <Shield className="w-6 h-6 text-purple-600" />}
              </div>
              <h2 className="text-base font-bold">{selectedPkg.pkg.name}</h2>
              <p className="text-2xl font-bold mt-1">{selectedPkg.pkg.priceLabel}</p>
              <p className="text-xs text-muted-foreground mt-1">{selectedPkg.pkg.credits} creditos {selectedPkg.type.toUpperCase()}</p>
            </div>
            <p className="text-sm font-medium text-center mb-3">Escolha a forma de pagamento:</p>
            <div className="space-y-2">
              {[
                { type: "UNDEFINED", label: "Livre — cliente escolhe", icon: Wallet },
                { type: "PIX", label: "PIX — aprovacao imediata", icon: QrCode },
                { type: "BOLETO", label: "Boleto Bancario", icon: ScanLine },
              ].map(opt => (
                <button key={opt.type}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                  disabled={purchaseMutation.isPending}
                  onClick={() => purchaseMutation.mutate({ packageId: selectedPkg.pkg.id, billingType: opt.type })}
                  data-testid={`button-pay-${opt.type.toLowerCase()}`}>
                  {purchaseMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" /> : <opt.icon className="w-4 h-4 text-blue-500" />}
                  <span className="text-sm font-medium">{opt.label}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-3 w-full text-xs" onClick={() => setSelectedPkg(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      {payModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setPayModal(null)}>
          <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="w-12 h-12 rounded-xl mx-auto mb-3 bg-emerald-100 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-emerald-600" />
              </div>
              <h2 className="text-base font-bold">Pedido Criado!</h2>
              <p className="text-xs text-muted-foreground mt-1">{payModal.order?.orderNumber}</p>
            </div>
            {payModal.charge ? (
              <div className="space-y-3">
                <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
                  <p className="font-semibold mb-1 flex items-center gap-1"><Info className="w-3.5 h-3.5" />Aguardando Pagamento</p>
                  <p>Apos o pagamento, seus creditos sao liberados automaticamente em ate 5 minutos.</p>
                </div>
                <div className="flex flex-col gap-2">
                  {payModal.charge.invoiceUrl && (
                    <a href={payModal.charge.invoiceUrl} target="_blank" rel="noopener noreferrer">
                      <Button className="w-full gap-2 text-xs" size="sm">
                        <ExternalLink className="w-3.5 h-3.5" />Abrir Link de Pagamento
                      </Button>
                    </a>
                  )}
                  {payModal.charge.billingType === "PIX" && (
                    <Button variant="outline" size="sm" className="w-full gap-2 text-xs"
                      onClick={() => { pixMutation.mutate(payModal.order.id); setPayModal(null); }}>
                      <QrCode className="w-3.5 h-3.5" />Ver QR Code PIX
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-800">
                <p className="font-semibold mb-1">Pedido registrado</p>
                <p>Nossa equipe processara seu pedido em breve. Entre em contato se necessario.</p>
              </div>
            )}
            <Button variant="ghost" size="sm" className="mt-3 w-full text-xs" onClick={() => setPayModal(null)}>Fechar</Button>
          </div>
        </div>
      )}

      {pixModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setPixModal(null)}>
          <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-sm text-center" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-1 flex items-center gap-2 justify-center"><QrCode className="w-4 h-4 text-blue-500" />QR Code PIX</h2>
            <p className="text-xs text-muted-foreground mb-3">Escaneie com seu banco para pagar</p>
            {pixModal.pixData?.encodedImage
              ? <img src={`data:image/png;base64,${pixModal.pixData.encodedImage}`} alt="QR Code PIX" className="mx-auto w-48 h-48 rounded-lg border" />
              : <div className="w-48 h-48 mx-auto rounded-lg border bg-muted/30 flex items-center justify-center"><QrCode className="w-12 h-12 text-muted-foreground opacity-40" /></div>}
            {pixModal.pixData?.payload && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground mb-1">Copia e Cola PIX:</p>
                <div className="flex gap-2">
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

      <div className="flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
          <CreditCard className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold" data-testid="text-creditos-title">Comprar Creditos</h1>
          <p className="text-sm text-muted-foreground">Consultas ISP e SPC sao produtos separados com valores diferentes</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5 bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200/60">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Creditos ISP</span>
            <Search className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-3xl font-bold" data-testid="text-isp-credits-balance">{provider?.ispCredits ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">disponiveis</p>
        </Card>
        <Card className="p-5 bg-gradient-to-br from-purple-50 to-purple-100/50 border-purple-200/60">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Creditos SPC</span>
            <Shield className="w-4 h-4 text-purple-500" />
          </div>
          <p className="text-3xl font-bold" data-testid="text-spc-credits-balance">{provider?.spcCredits ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">disponiveis</p>
        </Card>
      </div>

      {pendingOrders.length > 0 && (
        <Card className="p-4 border-amber-200 bg-amber-50/60">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-amber-600" />
            <h3 className="font-semibold text-sm text-amber-800">Pagamentos Pendentes</h3>
            <Badge className="bg-amber-200 text-amber-800 text-[10px]">{pendingOrders.length}</Badge>
          </div>
          <div className="space-y-2">
            {pendingOrders.map((order: any) => {
              const ct = order.creditType || "mixed";
              const isIsp = ct === "isp";
              const isSpc = ct === "spc";
              const creditCount = isIsp ? order.ispCredits : (isSpc ? order.spcCredits : `${order.ispCredits} ISP + ${order.spcCredits} SPC`);
              const typeLabel = ct === "mixed" ? "" : ct.toUpperCase();
              return (
                <div key={order.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-amber-100" data-testid={`pending-order-${order.id}`}>
                  <div>
                    <p className="text-xs font-semibold">{order.orderNumber}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {order.packageName} · {creditCount} {typeLabel} · R$ {parseFloat(order.amount).toFixed(2).replace(".", ",")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {order.asaasChargeId && (
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600"
                        onClick={() => pixMutation.mutate(order.id)} title="Ver QR Code PIX"
                        disabled={pixMutation.isPending} data-testid={`button-pix-${order.id}`}>
                        {pixMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                    {order.asaasInvoiceUrl && (
                      <a href={order.asaasInvoiceUrl} target="_blank" rel="noopener noreferrer"
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-blue-600 transition-colors">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div>
        <div className="flex items-center gap-3 mb-4">
          <button
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${activeTab === "isp" ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
            onClick={() => setActiveTab("isp")}
            data-testid="tab-isp-packages">
            <Search className="w-4 h-4" />Consulta ISP
          </button>
          <button
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${activeTab === "spc" ? "bg-purple-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
            onClick={() => setActiveTab("spc")}
            data-testid="tab-spc-packages">
            <Shield className="w-4 h-4" />Consulta SPC
          </button>
        </div>

        {activeTab === "isp" && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Search className="w-4 h-4 text-blue-500" />
              <h2 className="text-base font-semibold">Pacotes de Consulta ISP</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Consulte inadimplentes na base colaborativa de provedores. Identifique clientes com historico de inadimplencia em outros ISPs.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {ISP_PACKAGES.map(pkg => renderPackageCard(pkg, "isp"))}
            </div>
          </div>
        )}

        {activeTab === "spc" && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-purple-500" />
              <h2 className="text-base font-semibold">Pacotes de Consulta SPC</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Consulte CPF/CNPJ diretamente no SPC/Serasa. Obtenha score de credito, pendencias financeiras e restritivos.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {SPC_PACKAGES.map(pkg => renderPackageCard(pkg, "spc"))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-3 text-center flex items-center justify-center gap-1">
          <Info className="w-3.5 h-3.5" />
          Creditos nao expiram. Processamento via PIX em ate 5 minutos.
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Historico de Pedidos</h3>
          <span className="text-xs text-muted-foreground ml-auto">{orders.length} pedido(s)</span>
        </div>
        {ordersLoading ? (
          <div className="flex items-center justify-center py-10">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <ShoppingCart className="w-8 h-8 text-muted-foreground opacity-30" />
            <p className="text-sm text-muted-foreground">Nenhum pedido ainda</p>
          </div>
        ) : (
          <div className="divide-y">
            {orders.map((order: any) => {
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
              const typeText = isIsp ? "ISP" : isSpc ? "SPC" : "Misto";
              return (
                <div key={order.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/10 transition-colors" data-testid={`order-row-${order.id}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${order.status === "paid" ? "bg-emerald-100" : order.status === "cancelled" ? "bg-gray-100" : "bg-amber-100"}`}>
                    <st.icon className={`w-4 h-4 ${order.status === "paid" ? "text-emerald-600" : order.status === "cancelled" ? "text-gray-500" : "text-amber-600"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold text-muted-foreground">{order.orderNumber}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${st.badge}`}>{st.label}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeBadge}`}>{typeText}</span>
                    </div>
                    <p className="text-xs mt-0.5">{order.packageName} · <strong>{creditLabel}</strong></p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold">R$ {parseFloat(order.amount).toFixed(2).replace(".", ",")}</p>
                    {order.createdAt && <p className="text-[10px] text-muted-foreground">{new Date(order.createdAt).toLocaleDateString("pt-BR")}</p>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {order.status === "pending" && order.asaasChargeId && (
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-500"
                        onClick={() => pixMutation.mutate(order.id)} disabled={pixMutation.isPending}
                        title="QR Code PIX" data-testid={`button-history-pix-${order.id}`}>
                        <QrCode className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {order.asaasInvoiceUrl && (
                      <a href={order.asaasInvoiceUrl} target="_blank" rel="noopener noreferrer"
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-blue-600">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
