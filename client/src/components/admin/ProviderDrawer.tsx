import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  CreditCard, RefreshCw, Save, Plus, Terminal, CheckCircle2, AlertTriangle,
  Eye, EyeOff, ExternalLink, Trash2, User,
} from "lucide-react";
import { ERP_OPTIONS, ERP_MAP, PLAN_LABELS } from "./constants";
import type { ErpCatalog } from "@shared/schema";

interface ProviderDrawerProps {
  providerId: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

interface ErpFormState {
  url: string;
  token: string;
  showToken: boolean;
  erpProvider: string;
}

export default function ProviderDrawer({ providerId, open, onOpenChange }: ProviderDrawerProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [activeSubTab, setActiveSubTab] = useState("dados");

  // Fetch the provider from the list cache (or refetch list)
  const { data: allProviders = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    enabled: open,
  });
  const provider = allProviders.find((p: any) => p.id === providerId);

  const { data: allUsers = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    enabled: open,
  });
  const providerUsers = allUsers.filter((u: any) => u.providerId === providerId);

  const { data: erpCatalogList = [] } = useQuery<ErpCatalog[]>({
    queryKey: ["/api/erp-catalog"],
    enabled: open,
  });

  // Creditos state
  const [isp, setIsp] = useState("0");
  const [spc, setSpc] = useState("0");
  const [notes, setNotes] = useState("");

  // Plano state
  const [plan, setPlan] = useState("basic");

  // ERP state
  const [erpForm, setErpForm] = useState<ErpFormState>({ url: "", token: "", showToken: false, erpProvider: "" });
  const [erpTestResult, setErpTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Reset state when provider changes
  useEffect(() => {
    if (provider) {
      setPlan(provider.plan || "basic");
      setErpForm({
        url: provider.erpUrl ?? "",
        token: provider.erpToken ?? "",
        showToken: false,
        erpProvider: provider.erpSource ?? "",
      });
      setErpTestResult(null);
      setIsp("0");
      setSpc("0");
      setNotes("");
    }
  }, [provider?.id]);

  const creditsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/providers/${providerId}/credits`, {
        ispCredits: parseInt(isp) || 0, spcCredits: parseInt(spc) || 0, notes,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/plan-history"] });
      toast({ title: "Creditos adicionados!" });
      setIsp("0");
      setSpc("0");
      setNotes("");
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const planMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/providers/${providerId}/plan`, { plan, notes });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/plan-history"] });
      toast({ title: "Plano alterado!" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  // ERP save mutation (replaces raw fetch at admin-sistema.tsx lines 1169-1217)
  const saveErpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/admin/providers/${providerId}/erp-config`, {
        erpSource: erpForm.erpProvider || "ixc",
        apiUrl: erpForm.url,
        apiToken: erpForm.token,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "ERP salvo", description: "Configuracao de integracao atualizada com sucesso." });
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
    },
    onError: () => toast({ title: "Erro", description: "Nao foi possivel salvar.", variant: "destructive" }),
  });

  const testErpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/providers/${providerId}/erp-test`, {});
      return res.json();
    },
    onSuccess: (d: any) => {
      setErpTestResult({ ok: d.ok, msg: d.message });
    },
    onError: () => {
      setErpTestResult({ ok: false, msg: "Erro de conexao" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/users/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Usuario removido" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  if (!provider) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Carregando...</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  const erpName = provider.erpSource
    ? (erpCatalogList.find((e: ErpCatalog) => e.key === provider.erpSource)?.name ?? ERP_MAP[provider.erpSource] ?? provider.erpSource)
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="provider-drawer">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-bold text-white">
              {provider.name?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle>{provider.name}</SheetTitle>
              <SheetDescription>
                {provider.subdomain}.consultaisp.com.br · ISP: {provider.ispCredits} · SPC: {provider.spcCredits}
              </SheetDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => navigate(`/admin/provedor/${provider.id}`)}
              data-testid="button-open-provider-full-panel"
            >
              <ExternalLink className="w-3.5 h-3.5" />Painel Completo
            </Button>
          </div>
        </SheetHeader>

        <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="dados" data-testid="tab-provider-dados">Dados</TabsTrigger>
            <TabsTrigger value="usuarios" data-testid="tab-provider-usuarios">Usuarios</TabsTrigger>
            <TabsTrigger value="creditos" data-testid="tab-provider-creditos">Creditos</TabsTrigger>
            <TabsTrigger value="plano" data-testid="tab-provider-plano">Plano</TabsTrigger>
            <TabsTrigger value="erp" data-testid="tab-provider-erp">ERP</TabsTrigger>
          </TabsList>

          {/* Dados tab */}
          <TabsContent value="dados" className="space-y-3 pt-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-[var(--color-muted)] text-xs">Razao Social:</span><p className="font-medium">{provider.name}</p></div>
              <div><span className="text-[var(--color-muted)] text-xs">Nome Fantasia:</span><p className="font-medium">{provider.tradeName || "—"}</p></div>
              <div><span className="text-[var(--color-muted)] text-xs">CNPJ:</span><p className="font-mono text-xs">{provider.cnpj || "—"}</p></div>
              <div><span className="text-[var(--color-muted)] text-xs">Telefone:</span><p>{provider.contactPhone || "—"}</p></div>
              <div className="col-span-2"><span className="text-[var(--color-muted)] text-xs">Email:</span><p>{provider.contactEmail || "—"}</p></div>
              <div className="col-span-2"><span className="text-[var(--color-muted)] text-xs">Endereco:</span><p>{provider.addressStreet || ""} {provider.addressNumber || ""}, {provider.addressCity || ""}/{provider.addressState || ""}</p></div>
              <div><span className="text-[var(--color-muted)] text-xs">Plano atual:</span><p><Badge className={`text-xs ${PLAN_LABELS[provider.plan]?.color || ""}`}>{PLAN_LABELS[provider.plan]?.label}</Badge></p></div>
              <div><span className="text-[var(--color-muted)] text-xs">Status:</span><p>{provider.status === "active" ? "Ativo" : "Inativo"}</p></div>
            </div>
            <p className="text-xs text-[var(--color-muted)] pt-2 border-t">
              Para editar os dados cadastrais detalhados, use o Painel Completo.
            </p>
          </TabsContent>

          {/* Usuarios tab */}
          <TabsContent value="usuarios" className="space-y-2 pt-4">
            <p className="text-xs text-[var(--color-muted)]">{providerUsers.length} usuario(s) vinculado(s) a este provedor</p>
            {providerUsers.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)] text-center py-6">Nenhum usuario cadastrado</p>
            ) : providerUsers.map((u: any) => (
              <div key={u.id} className="flex items-center gap-3 border rounded px-3 py-2" data-testid={`drawer-user-row-${u.id}`}>
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-700">
                  <User className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{u.name}</p>
                  <p className="text-xs text-[var(--color-muted)] truncate">{u.email}</p>
                </div>
                <Badge className="text-xs">
                  {u.role === "admin" ? "Admin" : "Usuario"}
                </Badge>
                {u.role !== "superadmin" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-red-500"
                    onClick={() => { if (confirm(`Remover usuario ${u.name}?`)) deleteUserMutation.mutate(u.id); }}
                    data-testid={`drawer-button-delete-user-${u.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </TabsContent>

          {/* Creditos tab */}
          <TabsContent value="creditos" className="space-y-4 pt-4">
            <div className="border rounded p-3 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <CreditCard className="w-4 h-4" />Adicionar Creditos
              </h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">ISP</Label>
                  <Input type="number" value={isp} onChange={(e) => setIsp(e.target.value)} placeholder="0" data-testid="input-isp-credits" />
                </div>
                <div>
                  <Label className="text-xs">SPC</Label>
                  <Input type="number" value={spc} onChange={(e) => setSpc(e.target.value)} placeholder="0" data-testid="input-spc-credits" />
                </div>
              </div>
              <Input placeholder="Observacao (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-credit-notes" />
              <Button
                onClick={() => creditsMutation.mutate()}
                disabled={creditsMutation.isPending}
                className="w-full gap-1.5"
                data-testid="button-add-credits"
              >
                {creditsMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Adicionar Creditos
              </Button>
              <p className="text-xs text-[var(--color-muted)]">
                Creditos atuais: ISP <strong>{provider.ispCredits}</strong> | SPC <strong>{provider.spcCredits}</strong>
              </p>
            </div>
          </TabsContent>

          {/* Plano tab */}
          <TabsContent value="plano" className="space-y-4 pt-4">
            <div className="border rounded p-3 space-y-3">
              <h4 className="text-sm font-semibold">Alterar Plano</h4>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                data-testid="select-provider-plan"
              >
                <option value="free">Gratuito</option>
                <option value="basic">Basico</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
              <Input
                placeholder="Observacao (opcional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                data-testid="input-plan-notes"
              />
              <Button
                onClick={() => planMutation.mutate()}
                disabled={planMutation.isPending || plan === provider.plan}
                className="w-full gap-1.5"
                data-testid="button-save-plan"
              >
                {planMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar Plano
              </Button>
              <p className="text-xs text-[var(--color-muted)]">
                Plano atual: <strong>{PLAN_LABELS[provider.plan]?.label || provider.plan}</strong>
              </p>
            </div>
          </TabsContent>

          {/* ERP tab */}
          <TabsContent value="erp" className="space-y-3 pt-4">
            {erpName && (
              <div className="text-xs text-[var(--color-muted)]">
                ERP atual: <Badge className="bg-[var(--color-navy-bg)] text-[var(--color-navy)]">{erpName}</Badge>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Selecione o ERP</Label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {(erpCatalogList.length > 0 ? erpCatalogList.filter((e: any) => e.active) : ERP_OPTIONS).map((erp: any) => {
                  const isSelected = erpForm.erpProvider === erp.key;
                  const grad = erp.gradient ?? erp.grad ?? "from-slate-500 to-slate-600";
                  return (
                    <button
                      key={erp.key}
                      type="button"
                      onClick={() => {
                        const currentErp = erpForm.erpProvider;
                        if (currentErp && currentErp !== erp.key) {
                          setErpForm({ url: "", token: "", showToken: false, erpProvider: erp.key });
                        } else {
                          setErpForm(f => ({ ...f, erpProvider: erp.key }));
                        }
                        setErpTestResult(null);
                      }}
                      className={`flex flex-col items-center gap-1 p-2 rounded border-2 transition-all text-center ${
                        isSelected ? "border-[var(--color-navy)] bg-[var(--color-navy-bg)]" : "border-transparent bg-[var(--color-surface)] hover:bg-slate-100"
                      }`}
                      data-testid={`drawer-erp-option-${erp.key}`}
                    >
                      <div className={`w-8 h-8 rounded flex items-center justify-center overflow-hidden ${erp.logoBase64 ? "bg-[var(--color-surface)] border" : grad}`}>
                        {erp.logoBase64 ? (
                          <img src={erp.logoBase64} alt={erp.name} className="w-full h-full object-contain p-0.5" />
                        ) : (
                          <span className="text-white text-xs font-bold">{erp.name[0]}</span>
                        )}
                      </div>
                      <p className={`text-xs font-semibold leading-tight ${isSelected ? "text-[var(--color-navy)]" : "text-[var(--color-muted)]"}`}>{erp.name}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {erpForm.erpProvider && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Endereco do Servidor</Label>
                  <Input
                    placeholder="https://erp.seudominio.com.br"
                    value={erpForm.url}
                    onChange={e => setErpForm(f => ({ ...f, url: e.target.value }))}
                    className="h-10 text-sm font-mono"
                    data-testid="input-drawer-erp-url"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Token / Credencial</Label>
                  <div className="relative">
                    <Input
                      type={erpForm.showToken ? "text" : "password"}
                      placeholder="Credencial de acesso"
                      value={erpForm.token}
                      onChange={e => setErpForm(f => ({ ...f, token: e.target.value }))}
                      className="h-10 text-sm font-mono pr-9"
                      data-testid="input-drawer-erp-token"
                    />
                    <button
                      type="button"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
                      onClick={() => setErpForm(f => ({ ...f, showToken: !f.showToken }))}
                    >
                      {erpForm.showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => saveErpMutation.mutate()}
                    disabled={saveErpMutation.isPending || !erpForm.url || !erpForm.erpProvider}
                    data-testid="button-drawer-erp-save"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saveErpMutation.isPending ? "Salvando..." : "Salvar"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => { setErpTestResult(null); testErpMutation.mutate(); }}
                    disabled={testErpMutation.isPending || !erpForm.url}
                    data-testid="button-drawer-erp-test"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    {testErpMutation.isPending ? "Testando..." : "Testar Conexao"}
                  </Button>
                </div>
                {erpTestResult && (
                  <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded ${erpTestResult.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-[var(--color-danger-bg)] text-[var(--color-danger)] border border-red-200"}`}>
                    {erpTestResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                    {erpTestResult.msg}
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
