import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CreditCard, Package, Zap, Crown, CheckCircle, ShoppingCart,
  QrCode, Copy, ExternalLink, RefreshCw, Clock, CheckCheck,
  XCircle, Wallet, ScanLine, ArrowRight, Info, History,
} from "lucide-react";

const PACKAGES = [
  {
    id: "basico", name: "Basico", ispCredits: 50, spcCredits: 20,
    price: 4990, priceLabel: "R$ 49,90",
    icon: Package, color: "blue",
    perIsp: "R$ 0,99 / consulta ISP",
  },
  {
    id: "profissional", name: "Profissional", ispCredits: 200, spcCredits: 100,
    price: 14990, priceLabel: "R$ 149,90", popular: true,
    icon: Zap, color: "indigo",
    perIsp: "R$ 0,74 / consulta ISP",
  },
  {
    id: "enterprise", name: "Enterprise", ispCredits: 500, spcCredits: 300,
    price: 29990, priceLabel: "R$ 299,90",
    icon: Crown, color: "amber",
    perIsp: "R$ 0,59 / consulta ISP",
  },
];

const STATUS_STYLES: Record<string, { badge: string; label: string; icon: any }> = {
  pending:   { badge: "bg-amber-100 text-amber-700",  label: "Aguardando Pagamento", icon: Clock },
  paid:      { badge: "bg-emerald-100 text-emerald-700", label: "Creditos Liberados", icon: CheckCheck },
  cancelled: { badge: "bg-gray-100 text-gray-600",    label: "Cancelado",            icon: XCircle },
  overdue:   { badge: "bg-red-100 text-red-700",      label: "Vencido",              icon: XCircle },
};

function fmt(n: number) {
  return new Date(n).toLocaleDateString("pt-BR");
}

export default function CreditosPage() {
  const { provider } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [payModal, setPayModal] = useState<{ order: any; charge: any } | null>(null);
  const [pixModal, setPixModal] = useState<{ pixData: any } | null>(null);

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
  const historyOrders = orders;

  const selectedPackage = PACKAGES.find(p => p.id === selectedPkg);

  return (
    <div className="p-5 pb-10 space-y-6 max-w-4xl mx-auto" data-testid="creditos-page">

      {/* Payment Method Modal */}
      {selectedPackage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedPkg(null)}>
          <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className={`w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center ${selectedPackage.color === "blue" ? "bg-blue-100" : selectedPackage.color === "indigo" ? "bg-indigo-100" : "bg-amber-100"}`}>
                <selectedPackage.icon className={`w-6 h-6 ${selectedPackage.color === "blue" ? "text-blue-600" : selectedPackage.color === "indigo" ? "text-indigo-600" : "text-amber-600"}`} />
              </div>
              <h2 className="text-base font-bold">Pacote {selectedPackage.name}</h2>
              <p className="text-2xl font-bold mt-1">{selectedPackage.priceLabel}</p>
              <p className="text-xs text-muted-foreground mt-1">{selectedPackage.ispCredits} ISP + {selectedPackage.spcCredits} SPC</p>
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
                  onClick={() => purchaseMutation.mutate({ packageId: selectedPackage.id, billingType: opt.type })}
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

      {/* Order Success Modal */}
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

      {/* PIX Modal */}
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

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
          <CreditCard className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold" data-testid="text-creditos-title">Comprar Creditos</h1>
          <p className="text-sm text-muted-foreground">Recarregue seu saldo para consultas ISP e SPC</p>
        </div>
      </div>

      {/* Saldo atual */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5 bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200/60">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Creditos ISP</span>
            <CreditCard className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-3xl font-bold" data-testid="text-isp-credits-balance">{provider?.ispCredits ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">disponiveis · R$ 1,00/consulta</p>
        </Card>
        <Card className="p-5 bg-gradient-to-br from-purple-50 to-purple-100/50 border-purple-200/60">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Creditos SPC</span>
            <CreditCard className="w-4 h-4 text-purple-500" />
          </div>
          <p className="text-3xl font-bold" data-testid="text-spc-credits-balance">{provider?.spcCredits ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">disponiveis · R$ 1,00/consulta</p>
        </Card>
      </div>

      {/* Pedidos pendentes */}
      {pendingOrders.length > 0 && (
        <Card className="p-4 border-amber-200 bg-amber-50/60">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-amber-600" />
            <h3 className="font-semibold text-sm text-amber-800">Pagamentos Pendentes</h3>
            <Badge className="bg-amber-200 text-amber-800 text-[10px]">{pendingOrders.length}</Badge>
          </div>
          <div className="space-y-2">
            {pendingOrders.map((order: any) => (
              <div key={order.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-amber-100" data-testid={`pending-order-${order.id}`}>
                <div>
                  <p className="text-xs font-semibold">{order.orderNumber}</p>
                  <p className="text-[11px] text-muted-foreground">{order.packageName} · {order.ispCredits} ISP + {order.spcCredits} SPC · R$ {parseFloat(order.amount).toFixed(2).replace(".", ",")}</p>
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
            ))}
          </div>
        </Card>
      )}

      {/* Pacotes */}
      <div>
        <h2 className="text-base font-semibold mb-3">Pacotes de Creditos</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PACKAGES.map(pkg => (
            <Card key={pkg.id}
              className={`p-5 relative overflow-hidden cursor-pointer transition-all hover:shadow-md ${pkg.popular ? "ring-2 ring-blue-500" : "hover:ring-1 hover:ring-border"}`}
              onClick={() => setSelectedPkg(pkg.id)}
              data-testid={`package-${pkg.id}`}>
              {pkg.popular && (
                <Badge className="absolute top-3 right-3 bg-blue-600 border-0 text-white text-[10px]">Mais Popular</Badge>
              )}
              <div className="mb-4">
                <div className={`w-10 h-10 rounded-xl mb-3 flex items-center justify-center ${pkg.color === "blue" ? "bg-blue-100" : pkg.color === "indigo" ? "bg-indigo-100" : "bg-amber-100"}`}>
                  <pkg.icon className={`w-5 h-5 ${pkg.color === "blue" ? "text-blue-600" : pkg.color === "indigo" ? "text-indigo-600" : "text-amber-600"}`} />
                </div>
                <h3 className="font-bold">{pkg.name}</h3>
                <p className="text-xl font-bold mt-1">{pkg.priceLabel}</p>
                <p className="text-xs text-muted-foreground">{pkg.perIsp}</p>
              </div>
              <div className="space-y-1.5 mb-5">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  <span><strong>{pkg.ispCredits}</strong> Creditos ISP</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  <span><strong>{pkg.spcCredits}</strong> Creditos SPC</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  <span>Liberacao imediata via PIX</span>
                </div>
              </div>
              <Button className="w-full gap-2 text-sm" variant={pkg.popular ? "default" : "secondary"}
                data-testid={`button-buy-${pkg.id}`}>
                <ShoppingCart className="w-4 h-4" />Comprar
                <ArrowRight className="w-3.5 h-3.5 ml-auto" />
              </Button>
            </Card>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3 text-center flex items-center justify-center gap-1">
          <Info className="w-3.5 h-3.5" />
          Creditos nao expiram. Processamento via PIX em ate 5 minutos.
        </p>
      </div>

      {/* Historico de pedidos */}
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
            {historyOrders.map((order: any) => {
              const st = STATUS_STYLES[order.status] || STATUS_STYLES.pending;
              return (
                <div key={order.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/10 transition-colors" data-testid={`order-row-${order.id}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${order.status === "paid" ? "bg-emerald-100" : order.status === "cancelled" ? "bg-gray-100" : "bg-amber-100"}`}>
                    <st.icon className={`w-4 h-4 ${order.status === "paid" ? "text-emerald-600" : order.status === "cancelled" ? "text-gray-500" : "text-amber-600"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold text-muted-foreground">{order.orderNumber}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${st.badge}`}>{st.label}</span>
                      {order.asaasChargeId && <Wallet className="w-3 h-3 text-blue-400" title="Cobranca Asaas" />}
                    </div>
                    <p className="text-xs mt-0.5">{order.packageName} · <strong>{order.ispCredits}</strong> ISP + <strong>{order.spcCredits}</strong> SPC</p>
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
