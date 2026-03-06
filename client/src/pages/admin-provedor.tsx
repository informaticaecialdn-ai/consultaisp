import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import {
  ArrowLeft, Building2, Users, CreditCard, BarChart3, Activity,
  Globe, Mail, Phone, Calendar, Shield, CheckCircle, XCircle,
  Plus, RefreshCw, TrendingUp, TrendingDown, FileText, DollarSign,
  Clock, AlertCircle, Zap, Star, Crown, Edit2, Save, X, Eye,
  Printer, Ban, RotateCcw, Copy, EyeOff, Wifi, Database, AlertTriangle
} from "lucide-react";

const PLAN_CONFIG: Record<string, { label: string; color: string; isp: number; spc: number; price: number }> = {
  free:       { label: "Gratuito",   color: "bg-gray-100 text-gray-700",   isp: 50,   spc: 0,   price: 0 },
  basic:      { label: "Basico",     color: "bg-blue-100 text-blue-700",   isp: 200,  spc: 50,  price: 199 },
  pro:        { label: "Pro",        color: "bg-indigo-100 text-indigo-700", isp: 500, spc: 150, price: 399 },
  enterprise: { label: "Enterprise", color: "bg-amber-100 text-amber-700", isp: 1500, spc: 500, price: 799 },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:    { label: "Ativo",     color: "bg-green-100 text-green-700" },
  inactive:  { label: "Inativo",   color: "bg-gray-100 text-gray-500" },
  suspended: { label: "Suspenso",  color: "bg-red-100 text-red-700" },
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
    pending:   { label: "Pendente",   cls: "bg-yellow-100 text-yellow-700" },
    paid:      { label: "Paga",       cls: "bg-green-100 text-green-700" },
    overdue:   { label: "Vencida",    cls: "bg-red-100 text-red-700" },
    cancelled: { label: "Cancelada",  cls: "bg-gray-100 text-gray-500" },
  };
  const s = map[status] || { label: status, cls: "bg-gray-100 text-gray-600" };
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
  const [creditsForm, setCreditsForm] = useState({ ispCredits: "", spcCredits: "", notes: "" });
  const [invoiceForm, setInvoiceForm] = useState({ period: "", amount: "", planAtTime: "basic", ispCreditsIncluded: "", spcCreditsIncluded: "", dueDate: "", notes: "" });
  const [editingEmailUser, setEditingEmailUser] = useState<{ id: number; name: string; email: string } | null>(null);
  const [newEmail, setNewEmail] = useState("");

  const isSuperAdmin = user?.role === "superadmin";

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/admin/providers", providerId, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/providers/${providerId}/detail`);
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
          {[...Array(6)].map((_, i) => <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />)}
        </div>
        <div className="h-64 bg-muted animate-pulse rounded-xl" />
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
  const plan = PLAN_CONFIG[provider.plan] || PLAN_CONFIG.free;
  const statusCfg = STATUS_CONFIG[provider.status] || STATUS_CONFIG.active;

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
    <div className="p-6 space-y-5 max-w-7xl mx-auto" data-testid="admin-provedor-page">
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
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
            {provider.name?.charAt(0)?.toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-provider-name">{provider.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge className={`${plan.color} border-0 text-xs font-semibold`}>
                {plan.label}
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
          <Button variant="outline" size="sm" onClick={() => {
            setInvoiceForm({ period: "", amount: String(plan.price), planAtTime: provider.plan, ispCreditsIncluded: "", spcCreditsIncluded: "", dueDate: "", notes: "" });
            setShowInvoiceModal(true);
          }} data-testid="button-create-invoice">
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
        <StatCard icon={Zap} label="Creditos ISP" value={provider.ispCredits} sub={`de ${plan.isp} do plano`} color="text-orange-500" />
        <StatCard icon={CreditCard} label="Creditos SPC" value={provider.spcCredits} sub={`de ${plan.spc} do plano`} color="text-pink-500" />
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
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Plano atual</span>
                    <Badge className={`${plan.color} border-0 font-semibold`}>{plan.label}</Badge>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Mensalidade</span>
                    <span className="font-semibold">{fmt(plan.price)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Creditos ISP</span>
                    <span className="font-semibold text-blue-600">{provider.ispCredits} / {plan.isp}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Creditos SPC</span>
                    <span className="font-semibold text-purple-600">{provider.spcCredits} / {plan.spc}</span>
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
                      <h3 className="font-semibold text-sm text-blue-800">Configuracao DNS do Subdominio</h3>
                    </div>
                    <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs font-medium" data-testid="badge-dns-status">
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
                          <td className="px-4 py-3 font-mono text-sm text-blue-700" data-testid="dns-destination">consultaisp-isp.replit.app</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">3600</td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => { navigator.clipboard.writeText(`${provider.subdomain}\tCNAME\tconsultaisp-isp.replit.app`); }}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
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
                    <p className="text-lg font-bold text-yellow-700">{fmt(financial.totalPending)}</p>
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
              <Button size="sm" variant="outline" onClick={() => {
                setInvoiceForm({ period: "", amount: String(plan.price), planAtTime: provider.plan, ispCreditsIncluded: "", spcCreditsIncluded: "", dueDate: "", notes: "" });
                setShowInvoiceModal(true);
              }} data-testid="button-new-invoice-fin">
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
              <div className="mx-5 my-3 p-4 border-2 border-blue-200 dark:border-blue-900 rounded-lg bg-blue-50/50 dark:bg-blue-950/30">
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
                      <Badge className={`border-0 text-xs ${u.role === "admin" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                        {u.role === "admin" ? "Admin" : "Usuario"}
                      </Badge>
                      {u.emailVerified ? (
                        <CheckCircle className="w-4 h-4 text-green-500" title="Email verificado" />
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
                <h3 className="font-semibold text-blue-800 flex items-center gap-2">
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
                          Plano alterado: <span className="text-muted-foreground">{PLAN_CONFIG[h.oldPlan]?.label || h.oldPlan}</span>
                          {" → "}
                          <span className="font-semibold text-blue-600">{PLAN_CONFIG[h.newPlan]?.label || h.newPlan}</span>
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
        <IntegracaoTab providerId={parseInt(id!)} n8nErpProvider={provider.n8nErpProvider} n8nEnabled={provider.n8nEnabled} />

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
              <div className="space-y-1.5">
                <Label>Plano</Label>
                <Select value={planForm.plan} onValueChange={v => setPlanForm(f => ({ ...f, plan: v }))}>
                  <SelectTrigger data-testid="select-plan">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PLAN_CONFIG).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label} — {fmt(v.price)}/mes</SelectItem>
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
                disabled={planMutation.isPending || !planForm.plan}
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
              <div className="p-3 bg-purple-50 rounded-lg">
                <p className="text-xs text-purple-600 mb-1">Atual SPC</p>
                <p className="text-xl font-bold text-purple-700">{provider.spcCredits}</p>
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
                    placeholder={String(plan.isp)}
                    data-testid="input-invoice-isp"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Creditos SPC</Label>
                  <Input
                    type="number"
                    value={invoiceForm.spcCreditsIncluded}
                    onChange={e => setInvoiceForm(f => ({ ...f, spcCreditsIncluded: e.target.value }))}
                    placeholder={String(plan.spc)}
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
                disabled={invoiceMutation.isPending || !invoiceForm.period || !invoiceForm.amount}
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

const ERP_NAMES: Record<string, string> = {
  ixc: "iXC Soft", sgp: "SGP", mk: "MK Solutions",
  tiacos: "Tiacos", hubsoft: "Hubsoft", flyspeed: "Fly Speed", netflash: "Netflash",
};

const ADMIN_ERP_LIST = [
  { key: "ixc",      name: "iXC Soft",    grad: "from-blue-500 to-blue-600" },
  { key: "sgp",      name: "SGP",          grad: "from-purple-500 to-purple-600" },
  { key: "mk",       name: "MK Solutions", grad: "from-green-500 to-green-600" },
  { key: "tiacos",   name: "Tiacos",       grad: "from-orange-500 to-orange-600" },
  { key: "hubsoft",  name: "Hubsoft",      grad: "from-indigo-500 to-indigo-600" },
  { key: "flyspeed", name: "Fly Speed",    grad: "from-cyan-500 to-cyan-600" },
  { key: "netflash", name: "Netflash",     grad: "from-rose-500 to-pink-600" },
];

function relDateAdmin(d: string | null): string {
  if (!d) return "Nunca";
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (diff < 60) return `${diff}min atras`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h atras`;
  return `${Math.floor(diff / 1440)}d atras`;
}

function IntegracaoTab({ providerId, n8nErpProvider, n8nEnabled }: { providerId: number; n8nErpProvider: string | null; n8nEnabled: boolean }) {
  const { data, isLoading } = useQuery<{
    token: string;
    integrations: Array<{
      id: number; erpSource: string; isEnabled: boolean;
      apiUrl: string | null; apiToken: string | null;
      totalSynced: number; totalErrors: number;
      lastSyncAt: string | null; lastSyncStatus: string | null;
    }>;
    logs: Array<{ id: number; erpSource: string; status: string; recordsProcessed: number; recordsFailed: number; createdAt: string; ipAddress: string | null }>;
  }>({
    queryKey: ["/api/admin/providers", providerId, "integration"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/providers/${providerId}/integration`);
      if (!res.ok) throw new Error("Erro ao carregar integracao");
      return res.json();
    },
  });

  if (isLoading) return (
    <TabsContent value="integracao">
      <div className="p-8 text-center text-muted-foreground text-sm">Carregando...</div>
    </TabsContent>
  );

  const integrations = data?.integrations || [];
  const logs = data?.logs || [];

  const getIntg = (key: string) => integrations.find(i => i.erpSource === key);

  const integrationsWithCreds = integrations.filter(i => i.apiUrl && i.apiToken);
  const activeErpKeys = new Set<string>([
    ...integrationsWithCreds.map(i => i.erpSource),
    ...(n8nErpProvider ? [n8nErpProvider] : []),
  ]);
  const displayErps = ADMIN_ERP_LIST.filter(e => activeErpKeys.has(e.key));
  const hasAnyErp = displayErps.length > 0;

  return (
    <TabsContent value="integracao" className="space-y-4" data-testid="tab-content-integracao">
      {/* Header stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "ERPs Ativos", value: n8nEnabled && n8nErpProvider ? 1 : integrations.filter(i => i.isEnabled).length, color: "text-emerald-600" },
          { label: "Total Sincronizados", value: integrations.reduce((s, i) => s + (i.totalSynced || 0), 0).toLocaleString("pt-BR"), color: "text-blue-600" },
          { label: "Total de Erros", value: integrations.reduce((s, i) => s + (i.totalErrors || 0), 0).toLocaleString("pt-BR"), color: "text-rose-500" },
        ].map(s => (
          <Card key={s.label} className="p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
          </Card>
        ))}
      </div>

      {/* ERP Card — somente o integrado */}
      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/20">
          <h3 className="font-semibold flex items-center gap-2"><Wifi className="w-4 h-4 text-violet-500" />Integracao ERP</h3>
          <p className="text-xs text-muted-foreground">ERP integrado ao provedor (somente leitura)</p>
        </div>
        {!hasAnyErp ? (
          <div className="px-5 py-8 flex flex-col items-center gap-2 text-center text-muted-foreground" data-testid="erp-empty-state">
            <Wifi className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">Nenhuma integracao ERP configurada</p>
            <p className="text-xs">O provedor ainda nao possui um ERP integrado ao sistema.</p>
          </div>
        ) : (
          <div className="divide-y">
            {displayErps.map(erp => {
              const intg = getIntg(erp.key);
              const isN8n = n8nErpProvider === erp.key;
              const hasCredentials = !!(intg?.apiUrl && intg?.apiToken);
              const isEnabled = isN8n ? n8nEnabled : (intg?.isEnabled ?? false);
              const status = intg?.lastSyncStatus ?? null;
              return (
                <div key={erp.key} className="px-5 py-4 flex items-center gap-3" data-testid={`row-erp-${erp.key}`}>
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${erp.grad} flex items-center justify-center flex-shrink-0`}>
                    <Wifi className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold">{erp.name}</p>
                      {isN8n && (
                        <span className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full font-medium">Via N8N</span>
                      )}
                      {hasCredentials && status && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          status === "success" ? "bg-emerald-100 text-emerald-700" :
                          status === "error" ? "bg-red-100 text-red-700" :
                          "bg-amber-100 text-amber-700"
                        }`}>{status === "success" ? "Sucesso" : status === "error" ? "Erro" : "Parcial"}</span>
                      )}
                    </div>
                    {hasCredentials ? (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {intg!.apiUrl?.replace(/https?:\/\//, "").slice(0, 50)} ·{" "}
                        {(intg!.totalSynced || 0).toLocaleString("pt-BR")} registros · {relDateAdmin(intg!.lastSyncAt)}
                        {(intg!.totalErrors || 0) > 0 && <span className="text-rose-500 ml-1">· {intg!.totalErrors} erros</span>}
                      </p>
                    ) : isN8n ? (
                      <p className="text-xs text-muted-foreground mt-0.5">Configurado pelo administrador do sistema</p>
                    ) : null}
                  </div>
                  <Badge className={`border-0 text-xs flex-shrink-0 ${isEnabled ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`} data-testid={`badge-erp-status-${erp.key}`}>
                    {isEnabled ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Sync Logs */}
      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/20">
          <h3 className="font-semibold">Historico de Sincronizacao</h3>
          <p className="text-xs text-muted-foreground">Ultimas 20 sincronizacoes</p>
        </div>
        {logs.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Nenhuma sincronizacao registrada</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">ERP</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Registros</th>
                  <th className="text-left px-4 py-2 font-medium">Data</th>
                  <th className="text-left px-4 py-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log) => (
                  <tr key={log.id} data-testid={`row-synclog-${log.id}`}>
                    <td className="px-4 py-2 font-medium">{ERP_NAMES[log.erpSource] || log.erpSource}</td>
                    <td className="px-4 py-2">
                      <Badge className={`text-xs border-0 ${log.status === "success" ? "bg-green-100 text-green-700" : log.status === "error" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>
                        {log.status === "success" ? "Sucesso" : log.status === "error" ? "Erro" : log.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {log.recordsProcessed} ok{log.recordsFailed > 0 && ` · ${log.recordsFailed} falhas`}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{new Date(log.createdAt).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs font-mono">{log.ipAddress || "—"}</td>
                  </tr>
                ))}
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
