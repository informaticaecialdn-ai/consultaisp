import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { usePrecos, camposDaFatura, planoPorChave } from "@/hooks/use-precos";
import { rotuloDoPlano } from "@/lib/planos";
import {
  ArrowLeft, Building2, Users, CreditCard, BarChart3, Activity,
  Globe, Mail, Phone, Calendar, Shield, CheckCircle, XCircle,
  Plus, RefreshCw, TrendingUp, TrendingDown, FileText, DollarSign,
  Clock, AlertCircle, Zap, Star, Crown, Edit2, Save, X, Eye,
  Printer, Ban, RotateCcw, Copy, EyeOff, Wifi, Database, AlertTriangle, ChevronRight,
  KeyRound
} from "lucide-react";
import FormularioErp, { type ConectorMeta } from "@/components/erp/FormularioErp";

/**
 * SO ROTULO E COR. PRECO E CREDITO VEM DE `usePrecos()`.
 *
 * Aqui morava um `PLAN_CONFIG` com preco e creditos cravados — basic 199, pro
 * 399 com 500 ISP e 150 SPC — que ninguem sincronizou quando a tabela virou
 * `shared/planos.ts` (pro = R$ 99, sem credito incluso). O cartao anunciava
 * "Mensalidade R$ 399,00" sem nenhum clique, o seletor oferecia "Pro — R$ 399"
 * e o modal de fatura abria com esse valor. Como `POST /api/admin/invoices`
 * grava o `amount` do corpo sem conferir contra o plano, nascia fatura de
 * R$ 399 num plano que `generate-monthly` cobra a R$ 99.
 *
 * O rotulo pode ficar aqui porque nao varia por marca; o preco varia, e por
 * isso so o servidor sabe dizer qual e.
 */
const PLANO_VISUAL: Record<string, { rotulo: string; cor: string }> = {
  free: { rotulo: rotuloDoPlano("free"), cor: "bg-[var(--color-tag-bg)] text-[var(--text-2)]" },
  pro: { rotulo: rotuloDoPlano("pro"), cor: "bg-[var(--brand-soft)] text-[var(--brand-ink)]" },
  basic: { rotulo: rotuloDoPlano("basic"), cor: "bg-[var(--color-tag-bg)] text-[var(--text-2)]" },
  enterprise: { rotulo: rotuloDoPlano("enterprise"), cor: "bg-[var(--color-tag-bg)] text-[var(--text-2)]" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:    { label: "Ativo",     color: "bg-[var(--color-success-bg)] text-[var(--color-success)]" },
  inactive:  { label: "Inativo",   color: "bg-[var(--color-tag-bg)] text-gray-500" },
  suspended: { label: "Suspenso",  color: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]" },
};

function fmt(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR");
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR");
}

function StatCard({ icon: Icon, label, value, sub, color = "text-blue-600" }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <Card className="p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg bg-muted ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-xl font-bold leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </Card>
  );
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:   { label: "Pendente",   cls: "bg-[var(--color-gold-bg)] text-[var(--color-gold)]" },
    paid:      { label: "Paga",       cls: "bg-[var(--color-success-bg)] text-[var(--color-success)]" },
    overdue:   { label: "Vencida",    cls: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]" },
    cancelled: { label: "Cancelada",  cls: "bg-[var(--color-tag-bg)] text-gray-500" },
  };
  const s = map[status] || { label: status, cls: "bg-[var(--color-tag-bg)] text-[var(--color-muted)]" };
  return <Badge className={`${s.cls} border-0 text-xs font-medium`}>{s.label}</Badge>;
}

export default function AdminProvedorPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const providerId = parseInt(id || "0");

  const [activeTab, setActiveTab] = useState("geral");
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", contactEmail: "", contactPhone: "", website: "", subdomain: "" });
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [planForm, setPlanForm] = useState({ plan: "", notes: "" });
  const [creditsForm, setCreditsForm] = useState({ ispCredits: "", spcCredits: "", bigdataCredits: "", notes: "" });
  const [invoiceForm, setInvoiceForm] = useState({ period: "", amount: "", planAtTime: "basic", ispCreditsIncluded: "", spcCreditsIncluded: "", dueDate: "", notes: "" });
  const [editingEmailUser, setEditingEmailUser] = useState<{ id: number; name: string; email: string } | null>(null);
  const [newEmail, setNewEmail] = useState("");

  const isSuperAdmin = user?.role === "superadmin";

  /**
   * Preco e credito do plano sao do servidor, que e quem cobra. Com o white
   * label eles ainda passam a depender da marca que o provedor veste, e uma
   * constante compilada no bundle nao tem como saber disso.
   */
  const { data: precos, isLoading: carregandoPrecos, isError: erroPrecos, refetch: recarregarPrecos } = usePrecos();

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/admin/providers", providerId, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/providers/${providerId}/detail`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    enabled: !!providerId && isSuperAdmin,
  });

  const editMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("PATCH", `/api/admin/providers/${providerId}`, body);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      setEditMode(false);
      toast({ title: "Provedor atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const planMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", `/api/admin/providers/${providerId}/plan`, body);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      setShowPlanModal(false);
      toast({ title: "Plano alterado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const creditsMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", `/api/admin/providers/${providerId}/credits`, body);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      setShowCreditsModal(false);
      toast({ title: "Creditos adicionados" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const invoiceMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/admin/invoices", body);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      setShowInvoiceModal(false);
      toast({ title: "Fatura criada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("PATCH", `/api/admin/providers/${providerId}`, { status });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      toast({ title: "Status atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const invoiceStatusMutation = useMutation({
    mutationFn: async ({ invoiceId, status }: { invoiceId: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/invoices/${invoiceId}/status`, { status });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      toast({ title: "Fatura atualizada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateEmailMutation = useMutation({
    mutationFn: async ({ id, email }: { id: number; email: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}/email`, { email });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      toast({ title: "Email atualizado", description: "O email de login foi alterado com sucesso." });
      setEditingEmailUser(null);
      setNewEmail("");
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center">
          <Shield className="w-12 h-12 text-red-400 mx-auto mb-2" />
          <p className="text-muted-foreground">Acesso restrito a superadmins</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded w-48" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}
        </div>
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-2" />
          <p className="text-muted-foreground">Provedor nao encontrado</p>
          <Button variant="ghost" className="mt-4" onClick={() => navigate("/admin-sistema")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Voltar
          </Button>
        </div>
      </div>
    );
  }

  const { provider, users, stats, invoices, planHistory, financial, recentIsp, recentSpc } = data;
  const visual = PLANO_VISUAL[provider.plan] || { rotulo: provider.plan, cor: "bg-[var(--color-tag-bg)] text-[var(--text-2)]" };
  const planoCobrado = planoPorChave(precos, provider.plan);
  const statusCfg = STATUS_CONFIG[provider.status] || STATUS_CONFIG.active;

  /**
   * "de N do plano" so quando o plano DECLARA credito incluso. O card dizia
   * "de 500 do plano" para o Profissional, que hoje nao inclui nenhum — a
   * consulta na rede se paga por credito. Sem tabela nao ha o que afirmar.
   */
  const inclusoNoPlano = (campo: "isp" | "spc"): string | undefined => {
    if (!planoCobrado) return undefined;
    const incluso = planoCobrado.creditosInclusos[campo];
    return incluso > 0 ? `de ${incluso} do plano` : "sem crédito incluso";
  };

  /**
   * O formulario de fatura so preenche valor a partir da tabela. Sem ela
   * `camposDaFatura` devolve `null` e os campos ficam INTOCADOS, em vez de
   * caírem para um numero inventado — era `String(plan.price)`, R$ 399 da
   * tabela morta desta tela.
   */
  const abrirNovaFatura = () => {
    setInvoiceForm({
      period: "", amount: "", planAtTime: provider.plan,
      ispCreditsIncluded: "", spcCreditsIncluded: "", dueDate: "", notes: "",
      ...(camposDaFatura(precos, provider.plan) ?? {}),
    });
    setShowInvoiceModal(true);
  };

  /** Sem tabela nao ha valor confiavel para gravar numa fatura. */
  const podeEmitirFatura = Boolean(precos);

  const startEdit = () => {
    setEditForm({
      name: provider.name || "",
      contactEmail: provider.contactEmail || "",
      contactPhone: provider.contactPhone || "",
      website: provider.website || "",
      subdomain: provider.subdomain || "",
    });
    setActiveTab("geral");
    setEditMode(true);
  };

  const startPlanChange = () => {
    setPlanForm({ plan: provider.plan, notes: "" });
    setShowPlanModal(true);
  };

  return (
    <div className="p-4 lg:p-6 space-y-5" data-testid="admin-provedor-page">
      {/* Header */}
      <div className="flex items-start gap-4 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/admin-sistema#provedores")}
          data-testid="button-back-provedores"
          className="text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Provedores
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
            {provider.name?.charAt(0)?.toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-provider-name">{provider.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge className={`${visual.cor} border-0 text-xs font-semibold`} data-testid="badge-plano">
                {visual.rotulo}
              </Badge>
              <Badge className={`${statusCfg.color} border-0 text-xs font-medium`}>
                {statusCfg.label}
              </Badge>
              {provider.subdomain && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Globe className="w-3 h-3" /> {provider.subdomain}.consultaisp.com.br
                </span>
              )}
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Desde {fmtDate(provider.createdAt)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={startEdit} data-testid="button-edit-provider">
            <Edit2 className="w-4 h-4 mr-1" /> Editar
          </Button>
          <Button variant="outline" size="sm" onClick={startPlanChange} data-testid="button-change-plan">
            <Star className="w-4 h-4 mr-1" /> Plano
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowCreditsModal(true)} data-testid="button-add-credits">
            <Zap className="w-4 h-4 mr-1" /> Creditos
          </Button>
          <Button variant="outline" size="sm" onClick={abrirNovaFatura} data-testid="button-create-invoice">
            <FileText className="w-4 h-4 mr-1" /> Fatura
          </Button>
          {provider.status === "active" ? (
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => statusMutation.mutate("suspended")}
              data-testid="button-suspend-provider"
              disabled={statusMutation.isPending}
            >
              <Ban className="w-4 h-4 mr-1" /> Suspender
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="text-green-600 border-green-200 hover:bg-green-50"
              onClick={() => statusMutation.mutate("active")}
              data-testid="button-activate-provider"
              disabled={statusMutation.isPending}
            >
              <CheckCircle className="w-4 h-4 mr-1" /> Ativar
            </Button>
          )}
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Users} label="Clientes" value={stats.customers} sub="cadastrados" color="text-blue-600" />
        <StatCard icon={Activity} label="Equipamentos" value={stats.equipment} sub="ativos" color="text-indigo-600" />
        <StatCard icon={BarChart3} label="Consultas ISP" value={stats.ispConsultations} sub={`${stats.ispConsultationsMonth} este mes`} color="text-violet-600" />
        <StatCard icon={TrendingUp} label="Consultas SPC" value={stats.spcConsultations} sub={`${stats.spcConsultationsMonth} este mes`} color="text-purple-600" />
        <StatCard icon={Zap} label="Creditos ISP" value={provider.ispCredits} sub={inclusoNoPlano("isp")} color="text-[var(--color-gold)]" />
        <StatCard icon={CreditCard} label="Creditos SPC" value={provider.spcCredits} sub={inclusoNoPlano("spc")} color="text-[var(--color-brand)]" />
        <StatCard icon={CreditCard} label="Creditos Cadastral" value={provider.bigdataCredits ?? 0} sub="consulta cadastral" color="text-[var(--color-steel)]" />
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="border bg-muted/30 p-0.5" data-testid="tabs-provider">
          <TabsTrigger value="geral" data-testid="tab-geral" className="text-sm">Geral</TabsTrigger>
          <TabsTrigger value="financeiro" data-testid="tab-financeiro" className="text-sm">Financeiro</TabsTrigger>
          <TabsTrigger value="usuarios" data-testid="tab-usuarios" className="text-sm">Usuarios</TabsTrigger>
          <TabsTrigger value="consumo" data-testid="tab-consumo" className="text-sm">Consumo</TabsTrigger>
          <TabsTrigger value="historico" data-testid="tab-historico" className="text-sm">Historico</TabsTrigger>
          <TabsTrigger value="integracao" data-testid="tab-integracao" className="text-sm">Integracao ERP</TabsTrigger>
        </TabsList>

        {/* TAB: GERAL */}
        <TabsContent value="geral">
          {editMode ? (
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Editar Informacoes</h3>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditMode(false)}><X className="w-4 h-4" /></Button>
                  <Button size="sm" onClick={() => editMutation.mutate(editForm)} disabled={editMutation.isPending} data-testid="button-save-edit">
                    <Save className="w-4 h-4 mr-1" /> {editMutation.isPending ? "Salvando..." : "Salvar"}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-name">Nome</Label>
                  <Input id="edit-name" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} data-testid="input-edit-name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-subdomain">Subdominio</Label>
                  <Input id="edit-subdomain" value={editForm.subdomain} onChange={e => setEditForm(f => ({ ...f, subdomain: e.target.value }))} data-testid="input-edit-subdomain" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-email">Email de Contato</Label>
                  <Input id="edit-email" type="email" value={editForm.contactEmail} onChange={e => setEditForm(f => ({ ...f, contactEmail: e.target.value }))} data-testid="input-edit-email" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-phone">Telefone</Label>
                  <Input id="edit-phone" value={editForm.contactPhone} onChange={e => setEditForm(f => ({ ...f, contactPhone: e.target.value }))} data-testid="input-edit-phone" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="edit-website">Website</Label>
                  <Input id="edit-website" value={editForm.website} onChange={e => setEditForm(f => ({ ...f, website: e.target.value }))} data-testid="input-edit-website" />
                </div>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-5 space-y-4">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Cadastro</h3>
                <div className="space-y-3">
                  <InfoRow label="Razao Social" value={provider.name} icon={Building2} />
                  <InfoRow label="CNPJ" value={provider.cnpj} icon={FileText} />
                  <InfoRow label="Subdominio" value={provider.subdomain ? `${provider.subdomain}.consultaisp.com.br` : "Nao configurado"} icon={Globe} />
                  <InfoRow label="Email de contato" value={provider.contactEmail || "—"} icon={Mail} />
                  <InfoRow label="Telefone" value={provider.contactPhone || "—"} icon={Phone} />
                  <InfoRow label="Website" value={provider.website || "—"} icon={Globe} />
                  <InfoRow label="Cadastrado em" value={fmtDate(provider.createdAt)} icon={Calendar} />
                </div>
              </Card>

              <Card className="p-5 space-y-4">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Plano e Creditos</h3>
                {erroPrecos && (
                  <div className="rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2" data-testid="erro-precos-plano">
                    <p className="text-xs text-[var(--danger)]">Nao foi possivel carregar a tabela de precos.</p>
                    <button type="button" className="text-xs underline mt-0.5 text-[var(--danger)]" onClick={() => recarregarPrecos()}>
                      Tentar de novo
                    </button>
                  </div>
                )}
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Plano atual</span>
                    <Badge className={`${visual.cor} border-0 font-semibold`}>{visual.rotulo}</Badge>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Mensalidade</span>
                    {carregandoPrecos ? (
                      <span className="h-4 w-20 rounded bg-[var(--surface-inset)] animate-pulse" data-testid="skeleton-mensalidade" />
                    ) : planoCobrado ? (
                      <span className="font-mono font-semibold tabular-nums" data-testid="text-mensalidade">{planoCobrado.precoLabel}</span>
                    ) : (
                      /* Ausencia de preco nao e gratuidade: a tela cala em vez
                         de afirmar um valor que o servidor nao confirmou. */
                      <span className="text-sm text-muted-foreground" data-testid="mensalidade-indisponivel">Tabela indisponivel</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Creditos ISP</span>
                    <span className="font-mono font-semibold tabular-nums text-[var(--text)]">
                      {provider.ispCredits}{planoCobrado && planoCobrado.creditosInclusos.isp > 0 ? ` / ${planoCobrado.creditosInclusos.isp}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Creditos SPC</span>
                    <span className="font-mono font-semibold tabular-nums text-[var(--text)]">
                      {provider.spcCredits}{planoCobrado && planoCobrado.creditosInclusos.spc > 0 ? ` / ${planoCobrado.creditosInclusos.spc}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <Badge className={`${statusCfg.color} border-0`}>{statusCfg.label}</Badge>
                  </div>
                </div>
              </Card>

              {provider.subdomain && (
                <Card className="p-5 space-y-4 md:col-span-2 border-blue-200 bg-blue-50/30" data-testid="card-dns-config">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-blue-600" />
                      <h3 className="font-semibold text-sm text-[var(--color-brand)]">Configuracao DNS do Subdominio</h3>
                    </div>
                    <Badge className="bg-[var(--color-gold-bg)] text-[var(--color-gold)] border-amber-200 text-xs font-medium" data-testid="badge-dns-status">
                      Configurar manualmente
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Configure o registro abaixo no painel DNS do dominio <span className="font-semibold">consultaisp.com.br</span> para ativar o subdominio deste provedor.
                  </p>
                  <div className="bg-white rounded-lg border border-blue-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-blue-100/60 border-b border-blue-200">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-blue-700">Nome / Host</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-blue-700">Tipo</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-blue-700">Destino / Valor</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-blue-700">TTL</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="px-4 py-3 font-mono text-sm font-medium" data-testid="dns-host">{provider.subdomain}</td>
                          <td className="px-4 py-3">
                            <Badge className="bg-violet-100 text-violet-700 border-violet-200 text-xs font-mono">CNAME</Badge>
                          </td>
                          <td className="px-4 py-3 font-mono text-sm text-blue-700" data-testid="dns-destination">app.consultaisp.com.br</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">3600</td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => { navigator.clipboard.writeText(`${provider.subdomain}\tCNAME\tapp.consultaisp.com.br`); }}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-[var(--color-brand)] font-medium"
                              data-testid="button-copy-dns-record"
                            >
                              <Copy className="w-3 h-3" />Copiar
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2 bg-white rounded-lg border border-blue-200 px-3 py-2 flex-1 min-w-0">
                      <Globe className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                      <span className="text-xs font-mono text-slate-700 truncate" data-testid="text-full-subdomain-url">{provider.subdomain}.consultaisp.com.br</span>
                      <button
                        onClick={() => { navigator.clipboard.writeText(`${provider.subdomain}.consultaisp.com.br`); }}
                        className="ml-auto flex-shrink-0 text-blue-500 hover:text-blue-700"
                        data-testid="button-copy-subdomain-url"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </Card>
              )}

              <Card className="p-5 space-y-3 md:col-span-2">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Resumo Financeiro</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Total Pago</p>
                    <p className="text-lg font-bold text-green-700">{fmt(financial.totalPaid)}</p>
                  </div>
                  <div className="text-center p-3 bg-yellow-50 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Em Aberto</p>
                    <p className="text-lg font-bold text-[var(--color-gold)]">{fmt(financial.totalPending)}</p>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Vencido</p>
                    <p className="text-lg font-bold text-red-700">{fmt(financial.totalOverdue)}</p>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* TAB: FINANCEIRO */}
        <TabsContent value="financeiro">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/20">
              <h3 className="font-semibold">Faturas do Provedor</h3>
              <Button size="sm" variant="outline" onClick={abrirNovaFatura} data-testid="button-new-invoice-fin">
                <Plus className="w-4 h-4 mr-1" /> Nova Fatura
              </Button>
            </div>
            {invoices.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Nenhuma fatura encontrada</div>
            ) : (
              <div className="divide-y">
                {invoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors" data-testid={`row-invoice-${inv.id}`}>
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="text-sm font-mono font-semibold">{inv.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">{inv.period} · Vence {fmtDate(inv.dueDate)}</p>
                      </div>
                      <InvoiceStatusBadge status={inv.status} />
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-semibold">{fmt(parseFloat(inv.amount))}</span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(`/admin/fatura/${inv.id}`, "_blank")}
                          data-testid={`button-view-invoice-${inv.id}`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {inv.status !== "paid" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-green-600"
                            onClick={() => invoiceStatusMutation.mutate({ invoiceId: inv.id, status: "paid" })}
                            data-testid={`button-mark-paid-${inv.id}`}
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {inv.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600"
                            onClick={() => invoiceStatusMutation.mutate({ invoiceId: inv.id, status: "overdue" })}
                            data-testid={`button-mark-overdue-${inv.id}`}
                          >
                            <AlertCircle className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* TAB: USUARIOS */}
        <TabsContent value="usuarios">
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b bg-muted/20">
              <h3 className="font-semibold">Usuarios do Provedor</h3>
              <p className="text-xs text-muted-foreground">{users.length} usuario(s) cadastrado(s)</p>
            </div>

            {editingEmailUser && (
              <div className="mx-5 my-3 p-4 border border-[var(--border)] rounded-lg bg-[var(--surface-inset)]">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Edit2 className="w-4 h-4 text-blue-600" />
                    Alterar email de login
                  </h4>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingEmailUser(null); setNewEmail(""); }} data-testid="button-cancel-edit-email">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Usuario: <span className="font-medium text-foreground">{editingEmailUser.name}</span> — Email atual: <span className="font-medium text-foreground">{editingEmailUser.email}</span>
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Novo email de login"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="flex-1 max-w-sm"
                    data-testid="input-new-email"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newEmail.includes("@")) {
                        updateEmailMutation.mutate({ id: editingEmailUser.id, email: newEmail });
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={!newEmail.includes("@") || updateEmailMutation.isPending}
                    onClick={() => updateEmailMutation.mutate({ id: editingEmailUser.id, email: newEmail })}
                    data-testid="button-save-email"
                  >
                    {updateEmailMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Salvar
                  </Button>
                </div>
              </div>
            )}

            {users.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Nenhum usuario encontrado</div>
            ) : (
              <div className="divide-y">
                {users.map((u: any) => (
                  <div key={u.id} className="flex items-center justify-between px-5 py-3" data-testid={`row-user-${u.id}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700 flex-shrink-0">
                        {u.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className={`border-0 text-xs ${u.role === "admin" ? "bg-[var(--color-brand-bg)] text-[var(--color-brand)]" : "bg-[var(--color-tag-bg)] text-[var(--color-muted)]"}`}>
                        {u.role === "admin" ? "Admin" : "Usuario"}
                      </Badge>
                      {u.emailVerified ? (
                        <CheckCircle className="w-4 h-4 text-[var(--color-success)]" title="Email verificado" />
                      ) : (
                        <XCircle className="w-4 h-4 text-gray-400" title="Email nao verificado" />
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                        onClick={() => { setEditingEmailUser({ id: u.id, name: u.name, email: u.email }); setNewEmail(""); }}
                        title="Alterar email"
                        data-testid={`button-edit-email-${u.id}`}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <span className="text-xs text-muted-foreground">{fmtDate(u.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* TAB: CONSUMO */}
        <TabsContent value="consumo">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="overflow-hidden">
              <div className="px-5 py-3 border-b bg-blue-50">
                <h3 className="font-semibold text-[var(--color-brand)] flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" /> Consultas ISP
                </h3>
                <p className="text-xs text-blue-600">{stats.ispConsultations} total · {stats.ispConsultationsMonth} este mes</p>
              </div>
              {recentIsp.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">Nenhuma consulta ISP</div>
              ) : (
                <div className="divide-y max-h-80 overflow-y-auto">
                  {recentIsp.map((c: any) => (
                    <div key={c.id} className="px-4 py-2.5 flex items-center justify-between" data-testid={`row-isp-${c.id}`}>
                      <div>
                        <p className="text-sm font-mono font-medium">{c.cpfCnpj}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[180px]">{c.name || "—"}</p>
                      </div>
                      <span className="text-xs text-muted-foreground">{fmtDateTime(c.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <div className="px-5 py-3 border-b bg-purple-50">
                <h3 className="font-semibold text-purple-800 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Consultas SPC
                </h3>
                <p className="text-xs text-purple-600">{stats.spcConsultations} total · {stats.spcConsultationsMonth} este mes</p>
              </div>
              {recentSpc.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">Nenhuma consulta SPC</div>
              ) : (
                <div className="divide-y max-h-80 overflow-y-auto">
                  {recentSpc.map((c: any) => (
                    <div key={c.id} className="px-4 py-2.5 flex items-center justify-between" data-testid={`row-spc-${c.id}`}>
                      <div>
                        <p className="text-sm font-mono font-medium">{c.cpfCnpj}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[180px]">{c.name || "—"}</p>
                      </div>
                      <span className="text-xs text-muted-foreground">{fmtDateTime(c.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* TAB: HISTORICO */}
        <TabsContent value="historico">
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b bg-muted/20">
              <h3 className="font-semibold">Historico de Alteracoes</h3>
              <p className="text-xs text-muted-foreground">Mudancas de plano e creditos</p>
            </div>
            {planHistory.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Nenhuma alteracao registrada</div>
            ) : (
              <div className="divide-y">
                {planHistory.map((h: any) => (
                  <div key={h.id} className="px-5 py-3 flex items-start gap-3" data-testid={`row-history-${h.id}`}>
                    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                      {h.oldPlan ? <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" /> : <Zap className="w-3.5 h-3.5 text-orange-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      {h.oldPlan ? (
                        <p className="text-sm font-medium">
                          Plano alterado: <span className="text-muted-foreground">{PLANO_VISUAL[h.oldPlan]?.rotulo || h.oldPlan}</span>
                          {" → "}
                          <span className="font-semibold text-[var(--brand-ink)]">{PLANO_VISUAL[h.newPlan]?.rotulo || h.newPlan}</span>
                        </p>
                      ) : (
                        <p className="text-sm font-medium">
                          Creditos adicionados:
                          {h.ispCreditsAdded > 0 && <span className="text-blue-600"> +{h.ispCreditsAdded} ISP</span>}
                          {h.spcCreditsAdded > 0 && <span className="text-purple-600"> +{h.spcCreditsAdded} SPC</span>}
                        </p>
                      )}
                      {h.notes && <p className="text-xs text-muted-foreground mt-0.5">{h.notes}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {h.changedByName} · {fmtDateTime(h.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* TAB: INTEGRACAO ERP */}
        {/* `provider.erpSource` e `provider.erpEnabled` iam daqui e chegavam
            sempre `undefined`: a tabela `providers` nao tem essas colunas e
            /detail devolve o registro cru. A aba lia integracao de la e
            deduzia "Configurado" de um valor que nunca existiu — tudo agora
            sai de `erp_integrations`. */}
        <IntegracaoTab providerId={providerId} ativo={activeTab === "integracao"} />

      </Tabs>

      {/* Modal: Alterar Plano */}
      {showPlanModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPlanModal(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Alterar Plano</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowPlanModal(false)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="space-y-3">
              {carregandoPrecos && (
                <div className="h-9 rounded bg-[var(--surface-inset)] animate-pulse" data-testid="skeleton-precos-plano" />
              )}
              {erroPrecos && (
                /* Anunciar plano com preco desta tela foi exatamente o defeito.
                   Sem a tabela do servidor o seletor nao tem o que oferecer. */
                <div className="rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2" data-testid="erro-precos-troca-plano">
                  <p className="text-xs text-[var(--danger)]">
                    Nao foi possivel carregar a tabela de precos. O plano nao pode ser trocado sem ela.
                  </p>
                  <button type="button" className="text-xs underline mt-0.5 text-[var(--danger)]" onClick={() => recarregarPrecos()}>
                    Tentar de novo
                  </button>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Plano</Label>
                <Select value={planForm.plan} disabled={!precos} onValueChange={v => setPlanForm(f => ({ ...f, plan: v }))}>
                  <SelectTrigger data-testid="select-plan">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(precos?.planos ?? []).map(p => (
                      <SelectItem key={p.chave} value={p.chave}>{p.rotulo} — {p.precoLabel}/mes</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Observacao (opcional)</Label>
                <Textarea
                  value={planForm.notes}
                  onChange={e => setPlanForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Motivo da mudanca de plano..."
                  rows={2}
                  data-testid="textarea-plan-notes"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowPlanModal(false)}>Cancelar</Button>
              <Button
                onClick={() => planMutation.mutate(planForm)}
                disabled={planMutation.isPending || !planForm.plan || !precos}
                data-testid="button-confirm-plan"
              >
                {planMutation.isPending ? "Salvando..." : "Confirmar"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Modal: Adicionar Creditos */}
      {showCreditsModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCreditsModal(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Adicionar Creditos</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowCreditsModal(false)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-600 mb-1">Atual ISP</p>
                <p className="text-xl font-bold text-blue-700">{provider.ispCredits}</p>
              </div>
              <div className="p-3 bg-[var(--color-tag-bg)] rounded-lg">
                <p className="text-xs text-[var(--color-muted)] mb-1">Atual SPC</p>
                <p className="text-xl font-bold text-[var(--color-brand)]">{provider.spcCredits}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Creditos ISP a adicionar</Label>
                <Input
                  type="number"
                  value={creditsForm.ispCredits}
                  onChange={e => setCreditsForm(f => ({ ...f, ispCredits: e.target.value }))}
                  placeholder="0"
                  data-testid="input-isp-credits"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Creditos SPC a adicionar</Label>
                <Input
                  type="number"
                  value={creditsForm.spcCredits}
                  onChange={e => setCreditsForm(f => ({ ...f, spcCredits: e.target.value }))}
                  placeholder="0"
                  data-testid="input-spc-credits"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Creditos Consulta Cadastral a adicionar</Label>
                <Input
                  type="number"
                  value={creditsForm.bigdataCredits}
                  onChange={e => setCreditsForm(f => ({ ...f, bigdataCredits: e.target.value }))}
                  placeholder="0"
                  data-testid="input-bigdata-credits"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Observacao (opcional)</Label>
                <Input
                  value={creditsForm.notes}
                  onChange={e => setCreditsForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Motivo..."
                  data-testid="input-credits-notes"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowCreditsModal(false)}>Cancelar</Button>
              <Button
                onClick={() => creditsMutation.mutate({
                  ispCredits: parseInt(creditsForm.ispCredits) || 0,
                  spcCredits: parseInt(creditsForm.spcCredits) || 0,
                  bigdataCredits: parseInt(creditsForm.bigdataCredits) || 0,
                  notes: creditsForm.notes,
                })}
                disabled={creditsMutation.isPending}
                data-testid="button-confirm-credits"
              >
                {creditsMutation.isPending ? "Salvando..." : "Adicionar"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Modal: Nova Fatura */}
      {showInvoiceModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowInvoiceModal(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Nova Fatura</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowInvoiceModal(false)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="space-y-3">
              {carregandoPrecos && (
                <div className="h-9 rounded bg-[var(--surface-inset)] animate-pulse" data-testid="skeleton-precos-fatura" />
              )}
              {erroPrecos && (
                /* Sem a tabela o formulario nao sabe quanto cobrar, e o campo
                   vazio ao lado do botao ativo era o convite ao R$ 0,00. */
                <div className="rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2" data-testid="erro-precos-fatura">
                  <p className="text-xs text-[var(--danger)]">
                    Nao foi possivel carregar a tabela de precos. A fatura nao pode ser emitida sem ela.
                  </p>
                  <button type="button" className="text-xs underline mt-0.5 text-[var(--danger)]" onClick={() => recarregarPrecos()}>
                    Tentar de novo
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Periodo (AAAA-MM)</Label>
                  <Input
                    value={invoiceForm.period}
                    onChange={e => setInvoiceForm(f => ({ ...f, period: e.target.value }))}
                    placeholder="2026-03"
                    data-testid="input-invoice-period"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Valor (R$)</Label>
                  <Input
                    type="number"
                    value={invoiceForm.amount}
                    onChange={e => setInvoiceForm(f => ({ ...f, amount: e.target.value }))}
                    data-testid="input-invoice-amount"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Creditos ISP</Label>
                  <Input
                    type="number"
                    value={invoiceForm.ispCreditsIncluded}
                    onChange={e => setInvoiceForm(f => ({ ...f, ispCreditsIncluded: e.target.value }))}
                    data-testid="input-invoice-isp"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Creditos SPC</Label>
                  <Input
                    type="number"
                    value={invoiceForm.spcCreditsIncluded}
                    onChange={e => setInvoiceForm(f => ({ ...f, spcCreditsIncluded: e.target.value }))}
                    data-testid="input-invoice-spc"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Vencimento</Label>
                <Input
                  type="date"
                  value={invoiceForm.dueDate}
                  onChange={e => setInvoiceForm(f => ({ ...f, dueDate: e.target.value }))}
                  data-testid="input-invoice-due"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Observacoes</Label>
                <Input
                  value={invoiceForm.notes}
                  onChange={e => setInvoiceForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Observacoes..."
                  data-testid="input-invoice-notes"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowInvoiceModal(false)}>Cancelar</Button>
              <Button
                onClick={() => invoiceMutation.mutate({
                  providerId: String(providerId),
                  period: invoiceForm.period,
                  amount: invoiceForm.amount,
                  planAtTime: invoiceForm.planAtTime,
                  ispCreditsIncluded: invoiceForm.ispCreditsIncluded || "0",
                  spcCreditsIncluded: invoiceForm.spcCreditsIncluded || "0",
                  dueDate: invoiceForm.dueDate,
                  notes: invoiceForm.notes,
                })}
                disabled={!podeEmitirFatura || invoiceMutation.isPending || !invoiceForm.period || !invoiceForm.amount}
                data-testid="button-confirm-invoice"
              >
                {invoiceMutation.isPending ? "Criando..." : "Criar Fatura"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ============================ INTEGRACAO ERP ============================ */

/**
 * A configuracao do ERP mora AQUI, no painel SaaS.
 *
 * O painel do provedor virou vitrine: ele diz se esta integrado e nada mais.
 * Quem digita credencial, testa conexao e dispara varredura e o superadmin —
 * esta tela. O motivo nao e de layout: as rotas de escrita do provedor exigiam
 * so `requireAuth`, entao qualquer operador de role "user" gravava credencial
 * de ERP por curl. Tirar o formulario de la sem trazer para ca deixaria o
 * produto sem lugar nenhum para configurar.
 */

interface IntegracaoAdmin {
  id: number;
  erpSource: string;
  isEnabled: boolean;
  status: string | null;
  apiUrl: string | null;
  apiToken: string | null;
  apiUser: string | null;
  mkContraSenha: string | null;
  clientId: string | null;
  clientSecret: string | null;
  extraConfig: Record<string, string> | null;
  /**
   * A credencial esta gravada mas este servidor nao consegue LE-LA — a chave
   * deriva do SESSION_SECRET, e ele mudou (troca de segredo, base restaurada de
   * outro ambiente). O servidor devolve os quatro campos secretos em branco (o
   * texto cifrado nao serve de nada no navegador) e liga esta marca.
   *
   * Ignora-la e o pior desfecho possivel: a linha leria "Sem credencial", o
   * operador salvaria por cima achando que nunca houve nada, e como segredo
   * vazio significa "nao mexe" no upsert, o valor ilegivel continuaria no banco
   * e o sync continuaria falhando — com a tela dizendo que salvou.
   */
  credencialIlegivel: boolean;
  /**
   * `syncIntervalHours` NAO entra aqui de proposito.
   *
   * A coluna existe, o Zod da rota a aceita e o seed a preenche, mas nenhum
   * agendador a le: a cadencia real e a da varredura completa — segunda, quarta
   * e sexta as 03:00 (server/services/erp-agenda.ts). Publicar "intervalo 12h"
   * numa tela e prometer um numero que nenhum codigo honra.
   */
  notes: string | null;
  totalSynced: number;
  totalErrors: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
}

interface LogSyncAdmin {
  id: number;
  erpSource: string;
  status: string;
  recordsProcessed: number;
  recordsFailed: number;
  /**
   * A coluna e `synced_at`. Esta tela lia `createdAt`, que `erp_sync_logs`
   * nunca teve: toda linha do historico imprimia "Invalid Date".
   */
  syncedAt: string | null;
  ipAddress: string | null;
}

/**
 * O conector como /api/erp-connectors o entrega para esta tela.
 *
 * `naoImplementado` marca o conector que esta registrado so para figurar no
 * catalogo — nenhum metodo dele fala com o ERP. Ausente significa implementado.
 * O campo mora aqui, e nao em `ConectorMeta`, porque aquele tipo pertence a
 * outra frente; quando ele passar a declarar a marca, este alias sai.
 */
type ConectorAdmin = ConectorMeta & { naoImplementado?: boolean };

/**
 * Uma linha da lista "Integracoes deste provedor".
 *
 * `conector` e opcional porque a integracao manda na lista: existe linha em
 * `erp_integrations` cujo `erpSource` nao tem mais conector registrado, e ela
 * precisa aparecer mesmo assim — sem conector, sem campos, so o aviso.
 */
type ItemErp = { fonte: string; conector?: ConectorAdmin; integracao: IntegracaoAdmin };

type ResultadoTeste = { ok: boolean; message: string; latencyMs?: number };
type ResultadoSync = { tipo: "info" | "erro" | "ok"; texto: string };

const PILL_BASE =
  "inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[var(--track-wide)]";

/**
 * O selo do conector que ainda nao fala com a API do ERP.
 *
 * Nasceu na lista suspensa de "Adicionar integracao", mas a linha que JA existe
 * para um desses ERPs precisa do MESMO selo — se ele so trancasse a porta da
 * frente, a linha antiga continuaria lendo "Configurado / Ativo" e o provedor
 * leria "Integrada" para um ERP que nenhuma varredura consegue ler. Texto e
 * estilo moram aqui para que os dois lugares nao divirjam com o tempo.
 */
const ROTULO_CONECTOR_PENDENTE = "Conector em desenvolvimento";
const PILL_CONECTOR_PENDENTE = `${PILL_BASE} bg-[var(--surface-inset)] text-[var(--text-muted)]`;

/**
 * O selo da credencial gravada que este servidor nao consegue ler.
 *
 * Ele SUBSTITUI "Sem credencial", nunca soma: os dois dizem coisas opostas e o
 * que o operador faz depende de qual e. "Sem credencial" convida a preencher do
 * zero — e preencher o que ja tem valor apagaria nada, porque campo secreto
 * vazio significa "nao mexe" no servidor. "Credencial ilegivel" diz a unica
 * coisa que resolve: digitar o segredo de novo.
 *
 * Cor de perigo, e nao de atencao: enquanto ninguem redigitar, toda varredura
 * deste ERP falha, e a integracao caminha para a pausa automatica.
 */
const ROTULO_CREDENCIAL_ILEGIVEL = "Credencial ilegivel";
const PILL_CREDENCIAL_ILEGIVEL = `${PILL_BASE} bg-[var(--danger-bg)] text-[var(--danger)]`;

/** Os campos que o servidor guarda cifrados — os unicos zerados quando a credencial nao abre. */
const CAMPOS_SECRETOS = ["apiToken", "apiUser", "mkContraSenha", "clientSecret"] as const;

/**
 * Ficou algum segredo em branco neste Salvar?
 *
 * Numa linha ilegivel a resposta precisa ser nao para TODOS os segredos que o
 * conector declara, e nao so para um: o servidor zerou os quatro na leitura, e
 * segredo em branco no upsert significa "mantem o que esta la" — ou seja,
 * mantem justamente o valor que nao abre. Redigitar so o token do Hubsoft e
 * deixar o client secret em branco produziria de novo o desfecho que esta marca
 * existe para evitar: a tela diz "salvo" e a varredura continua falhando.
 *
 * So os campos presentes no corpo entram na conta — o formulario manda o que o
 * conector declara, e cobrar um campo que a tela nem desenha travaria o Salvar
 * para sempre.
 */
function segredoEmBranco(corpo: Record<string, unknown>): boolean {
  return CAMPOS_SECRETOS.some(k => k in corpo && !String(corpo[k] ?? "").trim());
}

const PILL_SYNC: Record<string, { texto: string; cls: string }> = {
  success: { texto: "Sucesso", cls: "bg-[var(--ok-bg)] text-[var(--ok)]" },
  error: { texto: "Erro", cls: "bg-[var(--danger-bg)] text-[var(--danger)]" },
  partial: { texto: "Parcial", cls: "bg-[var(--gated-bg)] text-[var(--gated)]" },
  /**
   * `reativado` nao e varredura: e a marca de que o superadmin religou a
   * integracao, e o batente que faz a contagem de falhas consecutivas
   * recomecar. Sem esta linha ela caia no ramo generico e o historico imprimia
   * o identificador cru no lugar de portugues.
   */
  reativado: { texto: "Reativado", cls: "bg-[var(--info-bg)] text-[var(--info)]" },
};

function relDateAdmin(d: string | null): string {
  if (!d) return "Nunca";
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (diff < 60) return `${diff}min atras`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h atras`;
  return `${Math.floor(diff / 1440)}d atras`;
}

/** Numerais por extenso do aviso de pausa. O indice e a propria contagem. */
const CONTAGEM_EXTENSO = ["", "Uma", "Duas", "Tres", "Quatro", "Cinco", "Seis", "Sete", "Oito", "Nove", "Dez"];

/**
 * O aviso e prosa, e prosa se escreve por extenso.
 *
 * O ramo singular ja dizia "Uma integracao"; o plural imprimia o algarismo em
 * Inter, que e numero sem mono — o design system nao admite. Escrever "Duas",
 * "Tres" resolve sem enfiar font-mono no meio de uma frase corrida, e dez cobre
 * o catalogo inteiro de conectores. Acima disso (linhas de ERP que nem conector
 * tem mais) o algarismo aparece, e ai vai em mono como todo numero do sistema.
 */
function frasePausadas(quantidade: number) {
  const resto = quantidade === 1 ? "integracao foi pausada" : "integracoes foram pausadas";
  const extenso = CONTAGEM_EXTENSO[quantidade];
  /* A frase inteira sai daqui, inclusive o fecho: o container e flex, e devolver
     pedacos faria do algarismo um item de flex com `gap` no lugar do espaco. */
  if (extenso) return <span>{`${extenso} ${resto} por falhas consecutivas`}</span>;
  return (
    <span>
      <span className="font-mono tabular-nums">{quantidade}</span> {resto} por falhas consecutivas
    </span>
  );
}

/**
 * O rotulo sai do catalogo de conectores, nao de uma lista cravada na tela.
 *
 * A lista daqui trazia tiacos, flyspeed e netflash — ERPs sem nenhum conector
 * no servidor. Um log de origem desconhecida cai no proprio identificador, que
 * ao menos e verdade.
 */
function rotuloErp(source: string, conectores: ConectorMeta[]): string {
  return conectores.find(c => c.name === source)?.label ?? source;
}

function IntegracaoTab({ providerId, ativo }: { providerId: number; ativo: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const chave = ["/api/admin/providers", providerId, "integration"];

  /**
   * `enabled` amarra a busca a aba aberta.
   *
   * O payload traz a credencial de todo ERP do provedor DECIFRADA. Sem esta
   * trava ele saia no primeiro render de qualquer aba — Financeiro, Usuarios,
   * Historico — e ficava no cache do navegador de quem nunca abriu Integracao.
   */
  const { data, isLoading, isError, refetch, isFetching } = useQuery<{
    token: string | null;
    integrations: IntegracaoAdmin[];
    logs: LogSyncAdmin[];
  }>({
    queryKey: chave,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/providers/${providerId}/integration`);
      return res.json();
    },
    enabled: ativo,
  });

  /** Os campos de cada ERP vem do proprio servidor que os consome. */
  const {
    data: conectores = [],
    isLoading: carregandoConectores,
    isError: erroConectores,
    refetch: recarregarConectores,
  } = useQuery<ConectorAdmin[]>({
    queryKey: ["/api/erp-connectors"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/erp-connectors");
      return res.json();
    },
    enabled: ativo,
  });

  const [expandido, setExpandido] = useState<string | null>(null);
  /** O ERP escolhido na lista suspensa de "Adicionar integracao" — ainda sem linha no banco. */
  const [novoErp, setNovoErp] = useState<string | null>(null);
  /** O gatilho da lista suspensa, para o estado vazio conseguir mandar o foco para la. */
  const seletorRef = useRef<HTMLButtonElement | null>(null);
  const [resultadoTeste, setResultadoTeste] = useState<Record<string, ResultadoTeste | null>>({});
  const [resultadoSync, setResultadoSync] = useState<Record<string, ResultadoSync | null>>({});

  /**
   * Temporizadores do acompanhamento, por ERP.
   *
   * Sem eles, cada clique deixava um `setInterval` de 15 minutos solto: sair da
   * tela nao o parava, e clicar duas vezes no mesmo ERP acumulava dois. Guardar
   * por `source` permite trocar o anterior e limpar tudo na desmontagem.
   */
  const acompanhamentoRef = useRef<Record<string, { intervalo: number; teto: number }>>({});
  useEffect(() => () => {
    for (const t of Object.values(acompanhamentoRef.current)) {
      window.clearInterval(t.intervalo);
      window.clearTimeout(t.teto);
    }
  }, []);

  const acompanhar = (source: string) => {
    const anterior = acompanhamentoRef.current[source];
    if (anterior) {
      window.clearInterval(anterior.intervalo);
      window.clearTimeout(anterior.teto);
    }
    const intervalo = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "integration"] });
    }, 15000);
    const teto = window.setTimeout(() => {
      window.clearInterval(intervalo);
      delete acompanhamentoRef.current[source];
    }, 15 * 60 * 1000);
    acompanhamentoRef.current[source] = { intervalo, teto };
  };

  const salvarMutation = useMutation({
    mutationFn: async ({ source, corpo }: { source: string; corpo: Record<string, unknown>; reativando?: boolean }) => {
      const res = await apiRequest("PUT", `/api/admin/providers/${providerId}/erp/${source}`, corpo);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (_dados, variaveis) => {
      // Nenhuma mutation desta tela invalidava a chave da aba: o formulario
      // salvava e continuava exibindo o valor antigo ate um F5. Depois de
      // religar isso e o que tira a marca de pausa da tela — sem a invalidacao
      // o operador reativa e continua lendo "Pausado por falhas".
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "integration"] });
      // Integracao recem-criada: a linha passa a existir, o ERP sai da lista
      // suspensa e o formulario de baixo desapareceria sem explicacao. Abrir o
      // item na secao de cima mostra para onde ele foi.
      if (novoErp === variaveis.source) {
        setNovoErp(null);
        setExpandido(variaveis.source);
      }
      toast({
        title: variaveis.reativando ? "Integracao reativada" : "Integracao salva",
        description: variaveis.reativando
          ? "A contagem de falhas recomeca do zero na proxima varredura automatica."
          : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  /**
   * Teste e sync respondem com significado tambem fora do 2xx — 400 "configure
   * a URL e o token", 409 "ja existe uma varredura". `apiRequest` estoura antes
   * de a tela ler o corpo, entao aqui o fetch e cru de proposito e a mensagem
   * do servidor chega inteira ao operador.
   */
  const testarMutation = useMutation({
    mutationFn: async (source: string) => {
      const res = await fetch(`/api/admin/providers/${providerId}/erp/${source}/test`, {
        method: "POST",
        credentials: "include",
      });
      const corpo = await res.json().catch(() => ({} as any));
      return { source, corpo };
    },
    onSuccess: ({ source, corpo }) => {
      setResultadoTeste(r => ({
        ...r,
        [source]: {
          ok: !!corpo.ok,
          message: corpo.message || (corpo.ok ? "Conexao estabelecida." : "Nao foi possivel conectar."),
          latencyMs: corpo.latencyMs,
        },
      }));
    },
    onError: (_e, source) => {
      setResultadoTeste(r => ({ ...r, [source]: { ok: false, message: "Nao consegui falar com o servidor." } }));
    },
  });

  /**
   * Dispara a varredura e volta na hora.
   *
   * A rota responde 202 assim que enfileira: a sincronizacao leva minutos, o
   * proxy corta em 60s, e um `res.json()` de um 504 em HTML mostrava "Erro ao
   * sincronizar" para um sync que estava rodando e ia terminar bem. A mensagem
   * de sucesso, quando chegava, lia `data.synced` e `data.total`, campos que a
   * rota nunca devolveu: sairia "undefined registros sincronizados".
   *
   * O desfecho de verdade mora no historico logo abaixo, que passa a recarregar
   * sozinho enquanto ha varredura em andamento.
   */
  const sincronizarMutation = useMutation({
    mutationFn: async (source: string) => {
      const res = await fetch(`/api/admin/providers/${providerId}/sync/${source}`, {
        method: "POST",
        credentials: "include",
      });
      const corpo = await res.json().catch(() => ({} as any));
      return { source, status: res.status, corpo };
    },
    onSuccess: ({ source, status, corpo }) => {
      if (status === 409) {
        setResultadoSync(r => ({
          ...r,
          [source]: { tipo: "info", texto: corpo.message || "Sincronizacao ja em andamento." },
        }));
        return;
      }
      if (!corpo.ok) {
        setResultadoSync(r => ({
          ...r,
          [source]: { tipo: "erro", texto: corpo.message || "Nao foi possivel iniciar a sincronizacao." },
        }));
        return;
      }
      setResultadoSync(r => ({
        ...r,
        [source]: { tipo: "info", texto: "Sincronizacao iniciada — o resultado aparece no historico ao terminar." },
      }));
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "integration"] });
      // A varredura leva minutos; rele o historico ate ele registrar o
      // desfecho. So quando ela de fato comecou — em 409 ja saimos acima, e
      // num erro nao ha o que acompanhar.
      acompanhar(source);
    },
    onError: (_e, source) => {
      setResultadoSync(r => ({ ...r, [source]: { tipo: "erro", texto: "Nao consegui falar com o servidor." } }));
    },
  });

  const ocupadoDe = (source: string) => ({
    salvando: salvarMutation.isPending && salvarMutation.variables?.source === source,
    testando: testarMutation.isPending && testarMutation.variables === source,
    sincronizando: sincronizarMutation.isPending && sincronizarMutation.variables === source,
  });

  if (isLoading || carregandoConectores) {
    return (
      <TabsContent value="integracao" className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-[var(--surface-inset)] animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-lg bg-[var(--surface-inset)] animate-pulse" />
      </TabsContent>
    );
  }

  /**
   * Falha de leitura NAO pode virar tela vazia.
   *
   * Sem esta saida, um GET que quebrou caia em `data?.integrations ?? []` e
   * todo conector aparecia como "Sem credencial" — convite para o operador
   * digitar por cima de uma integracao que existe e esta configurada. Aqui a
   * tela diz que nao conseguiu ler e nao mostra a lista.
   */
  if (isError || erroConectores) {
    return (
      <TabsContent value="integracao" className="space-y-4" data-testid="tab-content-integracao">
        <Card className="px-5 py-6" data-testid="erp-erro-carregamento">
          <p className="flex items-center gap-2 text-sm font-medium text-[var(--danger)]">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            Nao foi possivel carregar a integracao ERP
          </p>
          <p className="mt-1.5 text-xs text-[var(--text-2)]">
            A leitura falhou — o que voce ve nao e a configuracao do provedor. Nao preencha
            credencial agora: uma integracao ja configurada apareceria como vazia e gravar por
            cima apagaria o que esta funcionando.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3 h-8 rounded-[4px] text-xs"
            disabled={isFetching}
            onClick={() => {
              if (isError) refetch();
              if (erroConectores) recarregarConectores();
            }}
            data-testid="button-recarregar-integracao"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Tentar novamente
          </Button>
        </Card>
      </TabsContent>
    );
  }

  const integrations = data?.integrations ?? [];
  const logs = data?.logs ?? [];

  /**
   * `configurado` e AND, nunca OR.
   *
   * Um registro so com a URL lia "Configurado" e mentia: testar e sincronizar
   * exigem os dois campos, e a rota devolve 400 antes de tentar qualquer coisa.
   */
  const estaConfigurado = (i?: IntegracaoAdmin) => !!(i?.apiUrl && i?.apiToken);

  const porFonte = new Map(integrations.map(i => [i.erpSource, i]));
  const porConector = new Map(conectores.map(c => [c.name, c]));

  /**
   * Ha conector capaz de ler este ERP?
   *
   * Nao basta a linha estar ligada e com credencial: sem conector registrado, ou
   * com um que so figura no catalogo, nenhuma varredura traz um registro. Contar
   * essas linhas como ativas fazia o resumo do topo prometer sincronizacao que
   * nunca aconteceu.
   */
  const leDados = (source: string) => {
    const c = porConector.get(source);
    return !!c && !c.naoImplementado;
  };

  /**
   * A lista de cima sai das INTEGRACOES, nao do catalogo de conectores.
   *
   * Empilhar os dez conectores obrigava o operador a rolar dez cartoes para
   * achar o unico que o provedor usa. E uma linha de erpSource sem conector
   * registrado — sobra de configuracao antiga — nunca aparecia: o que nao
   * estava no catalogo sumia da tela, e nao havia como sequer saber que
   * existia. Aqui ela entra, sem formulario, porque nao ha campos a editar.
   */
  const integrados: ItemErp[] = integrations
    .map(i => ({ fonte: i.erpSource, conector: porConector.get(i.erpSource), integracao: i }))
    .sort((a, b) =>
      rotuloErp(a.fonte, conectores).localeCompare(rotuloErp(b.fonte, conectores), "pt-BR"),
    );

  /** A lista suspensa so oferece o que ainda NAO tem linha para este provedor. */
  const disponiveis = [...conectores]
    .filter(c => !porFonte.has(c.name))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  /**
   * O formulario em branco vive enquanto a linha nao existe.
   *
   * Assim que o salvar volta e a leitura traz a integracao, o item migra para a
   * secao de cima — manter aqui um segundo formulario para o mesmo ERP daria
   * dois lugares para editar a mesma credencial.
   */
  const escolhido = novoErp && !porFonte.has(novoErp) ? porConector.get(novoErp) : undefined;
  /* A lista suspensa ja trava o conector so casca, mas o catalogo e recarregado
     enquanto a tela vive: se um ERP virar stub depois de escolhido, o
     formulario de credencial some junto com a possibilidade de salva-lo. */
  const conectorNovo = escolhido?.naoImplementado ? undefined : escolhido;

  const ativos = integrations.filter(i => i.isEnabled && estaConfigurado(i) && leDados(i.erpSource)).length;
  const totalSincronizado = integrations.reduce((s, i) => s + (i.totalSynced || 0), 0);
  const totalErros = integrations.reduce((s, i) => s + (i.totalErrors || 0), 0);
  const pausados = integrations.filter(i => i.status === "pausado_por_falhas");
  /**
   * A instrucao do aviso muda conforme haja o que corrigir.
   *
   * "Corrija a credencial e reative" e conselho errado quando a pausa veio de um
   * conector que ainda nao fala com a API do ERP: a credencial esta certa, e
   * religar so faria a proxima varredura pausar de novo — e o provedor receber
   * outro e-mail sobre um problema que nao e dele.
   */
  const pausadosCorrigiveis = pausados.filter(i => !porConector.get(i.erpSource)?.naoImplementado);
  const pausadosPendentes = pausados.filter(i => !!porConector.get(i.erpSource)?.naoImplementado);

  /**
   * As linhas cuja credencial o servidor nao conseguiu decifrar.
   *
   * O aviso sobe ao topo porque o defeito nao e de uma linha so: a chave deriva
   * do SESSION_SECRET, entao quando ele muda TODAS as credenciais gravadas com
   * o anterior param de abrir de uma vez. Ver a marca so ao expandir cada linha
   * esconderia a extensao do estrago.
   */
  const ilegiveis = integrations.filter(i => i.credencialIlegivel);

  const resumo = [
    { label: "ERPs ativos", valor: ativos.toLocaleString("pt-BR"), cor: "text-[var(--ok)]" },
    { label: "Registros sincronizados", valor: totalSincronizado.toLocaleString("pt-BR"), cor: "text-[var(--text)]" },
    { label: "Erros acumulados", valor: totalErros.toLocaleString("pt-BR"), cor: totalErros > 0 ? "text-[var(--danger)]" : "text-[var(--text)]" },
  ];

  return (
    <TabsContent value="integracao" className="space-y-4" data-testid="tab-content-integracao">
      <div className="grid grid-cols-3 gap-3">
        {resumo.map(s => (
          <Card key={s.label} className="p-3">
            <p className="font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{s.label}</p>
            <p className={`mt-1 font-mono text-xl font-medium tabular-nums ${s.cor}`}>{s.valor}</p>
          </Card>
        ))}
      </div>

      {/* Antes do aviso de pausa de proposito: quando as duas coisas aparecem
          juntas, a credencial ilegivel e a CAUSA e a pausa e o efeito. Ler
          primeiro "corrija a credencial e reative" mandaria religar uma
          integracao que voltaria a falhar na varredura seguinte. */}
      {ilegiveis.length > 0 && (
        <div
          className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3"
          data-testid="aviso-credencial-ilegivel"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-[var(--danger)]">
            <KeyRound className="h-4 w-4 flex-shrink-0" />
            {ilegiveis.length === 1
              ? "Uma credencial gravada nao pode ser lida por este servidor"
              : "Credenciais gravadas que este servidor nao consegue ler"}
          </p>
          <p className="mt-1 text-xs text-[var(--text-2)]">
            {/* O texto e impessoal de proposito: a lista pode ter um ERP ou
                todos, e "o segredo gravado" serve aos dois sem plural postico. */}
            {ilegiveis.map(i => rotuloErp(i.erpSource, conectores)).join(", ")} — o segredo gravado
            continua no banco, mas foi cifrado com outra chave de servidor e nao abre mais aqui.
            {/* A instrucao inteira do reparo mora nesta frase porque e ela que
                separa "ilegivel" de "faltando": quem le "faltando" salva por
                cima e acha que resolveu. */}
            {" "}Precisa ser <strong className="font-medium">digitado de novo</strong>: abra a
            integracao abaixo e preencha os campos secretos. Salvar com campo em branco mantem o
            valor ilegivel — em branco significa manter o que ja esta la —, e a varredura segue
            falhando.
          </p>
        </div>
      )}

      {pausados.length > 0 && (
        <div
          className="rounded-lg border border-[var(--gated-border)] bg-[var(--gated-bg)] px-4 py-3"
          data-testid="aviso-pausado-por-falhas"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-[var(--gated)]">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {frasePausadas(pausados.length)}
          </p>
          {pausadosCorrigiveis.length > 0 && (
            <p className="mt-1 text-xs text-[var(--text-2)]">
              {pausadosCorrigiveis.map(i => rotuloErp(i.erpSource, conectores)).join(", ")} — corrija a credencial, teste a conexao e reative abaixo.
            </p>
          )}
          {pausadosPendentes.length > 0 && (
            <p className="mt-1 text-xs text-[var(--text-2)]" data-testid="aviso-pausado-conector-pendente">
              {pausadosPendentes.map(i => rotuloErp(i.erpSource, conectores)).join(", ")} — a pausa veio do
              conector, que ainda nao conversa com a API desse ERP. A credencial do provedor nao tem
              defeito e nao ha o que reativar.
            </p>
          )}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-5 py-3">
          <h3 className="flex items-center gap-2 font-semibold">
            <Wifi className="h-4 w-4 text-[var(--brand)]" />
            Integracoes deste provedor
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Credenciais, teste de conexao e sincronizacao. O provedor so visualiza o que esta integrado.
          </p>
          {/* A cadencia vem da agenda da varredura (server/services/erp-agenda.ts),
              nao da coluna `sync_interval_hours` — que existe e ninguem le. */}
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Varredura automatica: <span className="font-mono tabular-nums">segunda, quarta e sexta as 03:00</span>.
            Tres varreduras seguidas com falha pausam a integracao e avisam o provedor.
          </p>
        </div>

        {integrados.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center" data-testid="erp-empty-state">
            <Wifi className="h-8 w-8 text-[var(--text-faint)]" />
            <p className="text-sm font-medium text-[var(--text)]">Nenhum ERP integrado</p>
            <p className="max-w-md text-xs text-[var(--text-muted)]">
              Este provedor ainda nao tem integracao configurada. A integracao comeca na lista
              suspensa abaixo: escolha o ERP, preencha as credenciais e salve.
            </p>
            {disponiveis.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                // 44px de altura: e o alvo de toque minimo do design system, e
                // este e o unico caminho de saida do estado vazio.
                className="mt-2 h-11 rounded-[4px] px-4 text-xs"
                onClick={() => seletorRef.current?.focus()}
                data-testid="button-ir-para-seletor-erp"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Escolher ERP
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {integrados.map(({ fonte, conector, integracao: intg }) => {
              const rotulo = rotuloErp(fonte, conectores);
              const configurado = estaConfigurado(intg);
              const aberto = expandido === fonte;
              const pillUltimo = intg?.lastSyncStatus ? PILL_SYNC[intg.lastSyncStatus] : undefined;
              const pausado = intg?.status === "pausado_por_falhas";
              const reativando = ocupadoDe(fonte).salvando;

              /**
               * `pendente` e o conector que esta no catalogo mas nao fala com o
               * ERP: todo metodo dele devolve erro. A marca ja travava a lista
               * suspensa; aqui ela precisa valer para a linha que JA existe —
               * ate esta mudanca o painel do provedor aceitava qualquer fonte
               * suportada, entao ha linha assim no banco.
               *
               * `editavel` junta os dois casos em que nao ha o que salvar,
               * testar ou sincronizar: sem conector nenhum, ou com um que so
               * figura no catalogo. O servidor recusa as tres acoes nos dois, e
               * abrir o formulario seria oferecer botao que volta com erro.
               */
              const pendente = !!conector?.naoImplementado;
              const editavel = !!conector && !pendente;

              /**
               * A credencial existe no banco e este servidor nao consegue abrir.
               *
               * Vem marcada da rota justamente para nao ser confundida com
               * ausencia: os campos secretos chegam em branco nos dois casos, e
               * so a marca distingue "nunca foi preenchida" de "foi, e nao abre".
               */
              const ilegivel = !!intg?.credencialIlegivel;

              /* O bloco de identidade e sempre o mesmo; o que muda e se ele abre
                 formulario. Fora do caso editavel nao ha o que abrir, e um
                 <button> que nao faz nada e pior que texto. */
              const identidade = (
                <>
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-[var(--surface-inset)]">
                    <Database className="h-4 w-4 text-[var(--text-2)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{rotulo}</p>
                      {/* Tres estados, nao dois: configurado, sem credencial e
                          credencial que nao abre. O terceiro chegava aqui como
                          "Sem credencial" — a leitura que faz o operador salvar
                          por cima e sair achando que consertou. */}
                      <span
                        className={
                          ilegivel
                            ? PILL_CREDENCIAL_ILEGIVEL
                            : `${PILL_BASE} ${configurado ? "bg-[var(--ok-bg)] text-[var(--ok)]" : "bg-[var(--surface-inset)] text-[var(--text-muted)]"}`
                        }
                        data-testid={`badge-erp-configurado-${fonte}`}
                      >
                        {ilegivel ? ROTULO_CREDENCIAL_ILEGIVEL : configurado ? "Configurado" : "Sem credencial"}
                      </span>
                      {/* Pausada, a integracao esta desligada — mas dizer so
                          "Inativo" esconde QUEM a desligou. O selo de pausa
                          substitui o par ativo/inativo em vez de somar a ele. */}
                      <span
                        className={`${PILL_BASE} ${
                          pausado
                            ? "bg-[var(--gated-bg)] text-[var(--gated)]"
                            : intg?.isEnabled
                              ? "bg-[var(--brand-soft)] text-[var(--brand-ink)]"
                              : "bg-[var(--surface-inset)] text-[var(--text-muted)]"
                        }`}
                        data-testid={`badge-erp-status-${fonte}`}
                      >
                        {pausado ? "Pausado por falhas" : intg?.isEnabled ? "Ativo" : "Inativo"}
                      </span>
                      {!conector && (
                        <span
                          className={`${PILL_BASE} bg-[var(--gated-bg)] text-[var(--gated)]`}
                          data-testid={`badge-erp-sem-conector-${fonte}`}
                        >
                          Sem conector
                        </span>
                      )}
                      {pendente && (
                        <span
                          className={PILL_CONECTOR_PENDENTE}
                          data-testid={`badge-erp-indisponivel-${fonte}`}
                        >
                          {ROTULO_CONECTOR_PENDENTE}
                        </span>
                      )}
                      {configurado && pillUltimo && (
                        <span className={`${PILL_BASE} ${pillUltimo.cls}`}>{pillUltimo.texto}</span>
                      )}
                    </div>
                    {ilegivel ? (
                      /* "Preencha as credenciais", a linha do caso vazio, seria
                         mentira aqui: elas estao preenchidas. O que falta e
                         redigitar. */
                      <p className="mt-0.5 text-xs text-[var(--danger)]">
                        A credencial gravada nao abre neste servidor — precisa ser digitada de novo.
                      </p>
                    ) : configurado ? (
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        <span className="font-mono">{intg!.apiUrl?.replace(/https?:\/\//, "").slice(0, 50)}</span>
                        {" · "}
                        <span className="font-mono tabular-nums">{(intg!.totalSynced || 0).toLocaleString("pt-BR")}</span> registros
                        {" · "}
                        {/* As linhas de ERP se empilham e esta e a ultima coluna
                            de dado da frase: em Inter os "45min"/"3h"/"12d" de
                            uma linha nao caem sobre os da outra. */}
                        <span className="font-mono tabular-nums">{relDateAdmin(intg!.lastSyncAt)}</span>
                        {(intg!.totalErrors || 0) > 0 && (
                          <span className="ml-1 text-[var(--danger)]">
                            · <span className="font-mono tabular-nums">{intg!.totalErrors}</span> erros
                          </span>
                        )}
                      </p>
                    ) : editavel ? (
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        Preencha as credenciais para habilitar teste e sincronizacao.
                      </p>
                    ) : (
                      /* Sem conector — ou com um que so figura no catalogo —
                         credencial nenhuma habilita teste ou varredura, e
                         prometer isso mandaria o operador procurar campo que a
                         tela nao vai abrir. O aviso logo abaixo diz o porque. */
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        Nenhuma varredura le este ERP.
                      </p>
                    )}
                  </div>
                </>
              );

              return (
                <div key={fonte} className="px-5 py-4" data-testid={`row-erp-${fonte}`}>
                  {editavel ? (
                    <button
                      type="button"
                      // `ds-ctl` traz o anel de foco do sistema (index.css); o
                      // anel padrao do navegador aparecia, mas com outra cor e
                      // outra espessura que a dos demais controles da tela.
                      className="ds-ctl flex w-full items-center gap-3 rounded-[4px] text-left"
                      onClick={() => setExpandido(aberto ? null : fonte)}
                      data-testid={`button-toggle-erp-${fonte}`}
                    >
                      {identidade}
                      <ChevronRight
                        className={`h-4 w-4 flex-shrink-0 text-[var(--text-muted)] transition-transform ${aberto ? "rotate-90" : ""}`}
                      />
                    </button>
                  ) : (
                    <div className="flex w-full items-center gap-3">{identidade}</div>
                  )}

                  {!conector && (
                    <div className="mt-3 pl-[52px]" data-testid={`erp-sem-conector-${fonte}`}>
                      <div className="rounded-lg border border-[var(--gated-border)] bg-[var(--gated-bg)] px-3 py-2.5">
                        {/* O identificador do ERP ja esta no titulo da linha; repeti-lo
                            aqui so publicaria de novo um nome tecnico que nao ajuda quem le. */}
                        <p className="text-xs text-[var(--text-2)]">
                          Este ERP nao e mais suportado: nao ha conector para ele, entao nao ha
                          campos para editar nem varredura que o leia. Esta linha sobrou de uma
                          configuracao antiga e continua visivel para que voce saiba que ela existe.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* O par do selo: o selo diz o estado, este bloco diz o que ele
                      custa. Sem o texto, "Conector em desenvolvimento" ao lado de
                      "Ativo" seria mais uma marca para o operador decifrar. */}
                  {pendente && (
                    <div className="mt-3 pl-[52px]" data-testid={`erp-conector-pendente-${fonte}`}>
                      <div className="rounded-lg border border-[var(--gated-border)] bg-[var(--gated-bg)] px-3 py-2.5">
                        <p className="text-xs text-[var(--text-2)]">
                          O conector deste ERP ainda nao conversa com a API dele: existe so para
                          constar no catalogo, e nenhuma varredura consegue trazer dados. Salvar
                          credencial, testar conexao e sincronizar ficam indisponiveis aqui — o
                          servidor recusa as tres enquanto o conector nao for concluido.
                        </p>
                        {pausado && (
                          /* O pior desfecho do corte automatico: o provedor recebeu
                             e-mail de pausa por falhas de um ERP que nunca leu nada.
                             Religar so repetiria o ciclo, entao a linha nao oferece
                             o botao de reativar — oferece a explicacao. */
                          <p className="mt-2 text-xs text-[var(--text-2)]">
                            As varreduras automaticas falharam ate a pausa e o provedor foi avisado
                            por e-mail. Nao ha nada a corrigir do lado dele: a falha e do conector,
                            nao da credencial. Reativar so repetiria a pausa.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* O par do selo "Credencial ilegivel": o selo nomeia o estado,
                      este bloco diz o que fazer. Aparece com a linha fechada
                      porque a acao (redigitar) exige abrir o formulario — sem o
                      aviso aqui, o operador nao teria motivo para abrir. */}
                  {ilegivel && (
                    <div className="mt-3 pl-[52px]" data-testid={`erp-credencial-ilegivel-${fonte}`}>
                      <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2.5">
                        <p className="text-xs text-[var(--text-2)]">
                          A credencial deste ERP esta gravada, mas foi cifrada com outro segredo de
                          servidor e nao pode ser lida aqui. Ela nao esta faltando — esta ilegivel — e,
                          enquanto continuar assim, toda varredura falha na autenticacao.
                        </p>
                        <p className="mt-2 text-xs text-[var(--text-2)]">
                          {editavel
                            ? "Abra o formulario e digite os segredos de novo, todos eles. Salvar com campo em branco nao conserta: em branco significa manter o valor que ja esta gravado, e o valor gravado e justamente o que nao abre."
                            : "Nao ha formulario para este ERP nesta tela, entao a credencial nao pode ser redigitada aqui. Avise o suporte tecnico."}
                        </p>
                        {pausado && (
                          /* Sem esta frase, o aviso de pausa logo acima mandaria
                             religar — e religar sem redigitar repete a pausa e
                             dispara outro e-mail ao provedor. */
                          <p className="mt-2 text-xs text-[var(--text-2)]">
                            As varreduras seguidas com falha ja pausaram esta integracao e o provedor
                            foi avisado por e-mail. Reativar sem redigitar a credencial repetiria a
                            pausa: salve o segredo novo com a integracao ativa e ela volta a rodar.
                          </p>
                        )}
                        {editavel && !aberto && (
                          <Button
                            size="sm"
                            className="mt-2 h-8 rounded-[4px] text-xs"
                            onClick={() => setExpandido(fonte)}
                            data-testid={`button-redigitar-credencial-${fonte}`}
                          >
                            Redigitar credencial
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Fora do <button> de cima de proposito: botao dentro de
                      botao e HTML invalido e o clique de religar viraria um
                      abre/fecha do formulario. */}
                  {pausado && !pendente && !ilegivel && (
                    <div className="mt-3 pl-[52px]" data-testid={`erp-pausado-${fonte}`}>
                      <div className="rounded-lg border border-[var(--gated-border)] bg-[var(--gated-bg)] px-3 py-2.5">
                        <p className="text-xs text-[var(--text-2)]">
                          O sistema desligou esta integracao sozinho apos tres varreduras automaticas
                          seguidas com falha, e avisou o provedor por e-mail. Corrija a credencial,
                          teste a conexao e religue — a contagem de falhas recomeca do zero.
                        </p>
                        <Button
                          size="sm"
                          className="mt-2 h-8 rounded-[4px] text-xs"
                          disabled={reativando}
                          onClick={() =>
                            salvarMutation.mutate({
                              source: fonte,
                              // So `isEnabled`: a rota grava o que chega, e mandar
                              // os outros campos vazios apagaria a credencial que
                              // esta la. Quem limpa o status e registra a
                              // reativacao e o servidor.
                              corpo: { isEnabled: true },
                              reativando: true,
                            })
                          }
                          data-testid={`button-reativar-erp-${fonte}`}
                        >
                          {reativando ? "Reativando..." : "Reativar integracao"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {editavel && aberto && (
                    <div className="mt-4 pl-[52px]" data-testid={`form-erp-${fonte}`}>
                      <FormularioErp
                        conector={conector!}
                        integracao={intg}
                        ocupado={ocupadoDe(fonte)}
                        resultadoTeste={resultadoTeste[fonte] ?? null}
                        resultadoSync={resultadoSync[fonte] ?? null}
                        onSalvar={corpo => {
                          /* A ultima barreira do defeito: numa linha ilegivel, um
                             Salvar com segredo em branco volta 200 e nao muda
                             nada no banco — a tela diria "Integracao salva" e o
                             sync continuaria falhando. Melhor recusar aqui do que
                             confirmar um conserto que nao aconteceu. */
                          if (ilegivel && segredoEmBranco(corpo)) {
                            toast({
                              title: "Credencial nao foi redigitada",
                              description:
                                "Um dos campos secretos ficou em branco, e em branco o servidor mantem o valor que ja esta gravado — o mesmo que ele nao consegue ler. Digite os segredos de novo antes de salvar.",
                              variant: "destructive",
                            });
                            return;
                          }
                          salvarMutation.mutate({ source: fonte, corpo });
                        }}
                        onTestar={() => testarMutation.mutate(fonte)}
                        onSincronizar={() => sincronizarMutation.mutate(fonte)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-5 py-3">
          <h3 className="flex items-center gap-2 font-semibold">
            <Plus className="h-4 w-4 text-[var(--brand)]" />
            Adicionar integracao
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Escolha um dos ERPs disponiveis para configurar. Ao salvar, ele passa a constar acima.
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          {conectores.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]" data-testid="erp-sem-catalogo">
              {/* O caminho da rota nao ajuda quem le a tela e publica a API para
                  qualquer um com acesso ao painel (DESIGN_SYSTEM, secao 8). O
                  operador precisa saber o que fazer, nao onde o dado nasceu. */}
              O sistema nao devolveu nenhum ERP para integrar agora. Recarregue a pagina; se a lista
              continuar vazia, avise o suporte tecnico.
            </p>
          ) : disponiveis.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]" data-testid="erp-todos-integrados">
              Todos os ERPs disponiveis ja estao integrados com este provedor.
            </p>
          ) : (
            <>
              <div className="max-w-sm">
                <Label
                  htmlFor="select-novo-erp"
                  className="mb-1.5 block font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]"
                >
                  ERP disponivel
                </Label>
                <Select
                  value={novoErp ?? ""}
                  onValueChange={fonte => {
                    // Trocar de ERP joga fora o que estava digitado: o `key` do
                    // formulario carrega a fonte, entao React desmonta o antigo
                    // em vez de reaproveitar o estado. Sem isso o token de um
                    // ERP apareceria no formulario de outro.
                    setNovoErp(fonte);
                    setResultadoTeste(r => ({ ...r, [fonte]: null }));
                    setResultadoSync(r => ({ ...r, [fonte]: null }));
                  }}
                >
                  <SelectTrigger
                    id="select-novo-erp"
                    ref={seletorRef}
                    className="h-11 rounded-[4px]"
                    data-testid="select-novo-erp"
                  >
                    <SelectValue placeholder="Selecione um ERP" />
                  </SelectTrigger>
                  <SelectContent>
                    {disponiveis.map(c => (
                      <SelectItem
                        key={c.name}
                        value={c.name}
                        /* O conector so casca aparece, mas travado. Escondido, o
                           operador nao saberia que o sistema conhece o ERP e
                           abriria chamado perguntando se ha suporte; oferecido,
                           ele salvaria a credencial, a linha nasceria
                           "Configurado / Ativo" e o provedor leria "Integrada"
                           ate a primeira varredura falhar. */
                        disabled={!!c.naoImplementado}
                        data-testid={`option-erp-${c.name}`}
                      >
                        <span className="flex items-center gap-2">
                          {rotuloErp(c.name, conectores)}
                          {/* Mesmo testid da linha ja integrada: a lista suspensa so
                              oferece ERP sem linha, entao os dois nunca coexistem para
                              a mesma fonte. */}
                          {c.naoImplementado && (
                            <span
                              className={PILL_CONECTOR_PENDENTE}
                              data-testid={`badge-erp-indisponivel-${c.name}`}
                            >
                              {ROTULO_CONECTOR_PENDENTE}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Enquanto nenhum ERP esta escolhido nao ha formulario: um form
                  em branco sem dono convida a digitar credencial sem saber
                  para quem ela vai. */}
              {conectorNovo && (
                <div className="border-t border-[var(--border)] pt-4" data-testid={`form-novo-erp-${conectorNovo.name}`}>
                  <FormularioErp
                    key={conectorNovo.name}
                    conector={conectorNovo}
                    ocupado={ocupadoDe(conectorNovo.name)}
                    resultadoTeste={resultadoTeste[conectorNovo.name] ?? null}
                    resultadoSync={resultadoSync[conectorNovo.name] ?? null}
                    onSalvar={corpo => salvarMutation.mutate({ source: conectorNovo.name, corpo })}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-5 py-3">
          <h3 className="font-semibold">Historico de sincronizacao</h3>
          <p className="text-xs text-[var(--text-muted)]">Ultimas 20 varreduras</p>
        </div>
        {logs.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">Nenhuma sincronizacao registrada</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--surface-2)]">
                  {["ERP", "Status", "Registros", "Data", "IP"].map(h => (
                    <th
                      key={h}
                      className="border-b border-[var(--border)] px-4 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map(log => {
                  const pill = PILL_SYNC[log.status] ?? { texto: log.status, cls: "bg-[var(--surface-inset)] text-[var(--text-muted)]" };
                  return (
                    <tr key={log.id} data-testid={`row-synclog-${log.id}`}>
                      <td className="border-b border-[var(--border)] px-4 py-2 font-medium">{rotuloErp(log.erpSource, conectores)}</td>
                      <td className="border-b border-[var(--border)] px-4 py-2">
                        <span className={`${PILL_BASE} ${pill.cls}`}>{pill.texto}</span>
                      </td>
                      <td className="border-b border-[var(--border)] px-4 py-2 font-mono text-xs tabular-nums text-[var(--text-2)]">
                        {/* A linha de reativacao nao processou registro nenhum:
                            "0 ok" leria como varredura que nao achou ninguem. */}
                        {log.status === "reativado" ? (
                          <span className="text-[var(--text-muted)]">—</span>
                        ) : (
                          <>
                            {log.recordsProcessed} ok
                            {log.recordsFailed > 0 && ` · ${log.recordsFailed} falhas`}
                          </>
                        )}
                      </td>
                      <td className="border-b border-[var(--border)] px-4 py-2 font-mono text-xs tabular-nums text-[var(--text-muted)]">
                        {fmtDateTime(log.syncedAt)}
                      </td>
                      <td className="border-b border-[var(--border)] px-4 py-2 font-mono text-xs text-[var(--text-muted)]">
                        {log.ipAddress || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </TabsContent>
  );
}


function InfoRow({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b last:border-0">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-all">{value}</p>
      </div>
    </div>
  );
}
