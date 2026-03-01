import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import {
  Shield, Building2, Users, CreditCard, BarChart3, MessageSquare,
  Plus, Trash2, RefreshCw, CheckCircle, XCircle, Search, Send,
  Globe, TrendingUp, Activity, ChevronRight, Settings2,
  ArrowUpDown, Clock, User, Crown, Star
} from "lucide-react";

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free:       { label: "Gratuito",     color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  basic:      { label: "Basico",       color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  pro:        { label: "Pro",          color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300" },
  enterprise: { label: "Enterprise",   color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
};

function ChatPanel({ threads }: { threads: any[] }) {
  const [activeThread, setActiveThread] = useState<any>(null);
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: msgs = [], isLoading: msgsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/chat/threads", activeThread?.id, "messages"],
    enabled: !!activeThread,
    refetchInterval: 5000,
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/admin/chat/threads/${activeThread.id}/messages`, { content });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/chat/threads", activeThread?.id, "messages"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
      setMessage("");
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/chat/threads/${id}/status`, { status });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] }),
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !activeThread) return;
    sendMutation.mutate(message);
  };

  return (
    <div className="flex gap-4 h-[600px]">
      <div className="w-72 flex-shrink-0 border rounded-xl overflow-hidden flex flex-col">
        <div className="px-3 py-2.5 border-b bg-muted/30">
          <p className="text-sm font-semibold">Conversas de Suporte</p>
          <p className="text-xs text-muted-foreground">{threads.length} provedor(es)</p>
        </div>
        <div className="flex-1 overflow-y-auto divide-y">
          {threads.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4 text-center">
              Nenhuma conversa ainda
            </div>
          ) : threads.map((t: any) => (
            <button
              key={t.id}
              className={`w-full text-left px-3 py-3 hover:bg-muted/50 transition-colors ${activeThread?.id === t.id ? "bg-blue-50 dark:bg-blue-950/30" : ""}`}
              onClick={() => setActiveThread(t)}
              data-testid={`chat-thread-${t.id}`}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{t.providerName}</p>
                  <p className="text-xs text-muted-foreground truncate">{t.subject}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {t.unreadCount > 0 && (
                    <span className="w-5 h-5 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                      {t.unreadCount}
                    </span>
                  )}
                  <Badge className={`text-[10px] px-1.5 ${t.status === "open" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                    {t.status === "open" ? "Aberto" : "Fechado"}
                  </Badge>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 border rounded-xl flex flex-col overflow-hidden">
        {!activeThread ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <MessageSquare className="w-12 h-12 opacity-20" />
            <p className="text-sm">Selecione uma conversa para responder</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
              <div>
                <p className="font-semibold text-sm">{activeThread.providerName}</p>
                <p className="text-xs text-muted-foreground">{activeThread.subject}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => statusMutation.mutate({
                  id: activeThread.id,
                  status: activeThread.status === "open" ? "closed" : "open",
                })}
                data-testid="button-toggle-thread-status"
              >
                {activeThread.status === "open" ? (
                  <><XCircle className="w-3.5 h-3.5" />Fechar</>
                ) : (
                  <><CheckCircle className="w-3.5 h-3.5" />Reabrir</>
                )}
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {msgsLoading ? (
                <div className="flex items-center justify-center h-full">
                  <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : msgs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Nenhuma mensagem ainda
                </div>
              ) : msgs.map((m: any) => (
                <div key={m.id} className={`flex ${m.isFromAdmin ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${m.isFromAdmin
                    ? "bg-blue-600 text-white rounded-br-sm"
                    : "bg-muted rounded-bl-sm"
                  }`}>
                    {!m.isFromAdmin && (
                      <p className="text-[10px] font-semibold mb-0.5 text-muted-foreground">{m.senderName}</p>
                    )}
                    <p className="text-sm">{m.content}</p>
                    <p className={`text-[10px] mt-1 ${m.isFromAdmin ? "text-blue-200" : "text-muted-foreground"}`}>
                      {new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleSend} className="flex gap-2 p-3 border-t">
              <Input
                placeholder="Digite sua resposta..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={activeThread.status !== "open"}
                data-testid="input-admin-chat-message"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!message.trim() || sendMutation.isPending || activeThread.status !== "open"}
                className="gap-1.5"
                data-testid="button-admin-chat-send"
              >
                {sendMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function NewProviderForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "", cnpj: "", subdomain: "", plan: "basic",
    adminName: "", adminEmail: "", adminPassword: "",
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/admin/providers", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Provedor criado com sucesso!" });
      onSuccess();
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium mb-1 block">Nome do Provedor</label>
          <Input placeholder="NsLink Telecom" value={form.name} onChange={f("name")} data-testid="input-new-provider-name" />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">CNPJ</label>
          <Input placeholder="00.000.000/0000-00" value={form.cnpj} onChange={f("cnpj")} data-testid="input-new-provider-cnpj" />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Subdominio</label>
          <div className="flex items-center gap-1">
            <Input placeholder="nslink" value={form.subdomain} onChange={f("subdomain")} className="flex-1" data-testid="input-new-provider-subdomain" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">.consultaisp.com.br</span>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Plano Inicial</label>
          <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={form.plan} onChange={f("plan")} data-testid="select-new-provider-plan">
            <option value="free">Gratuito</option>
            <option value="basic">Basico</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
      </div>
      <div className="border-t pt-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Admin do Provedor</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium mb-1 block">Nome</label>
            <Input placeholder="Nome completo" value={form.adminName} onChange={f("adminName")} data-testid="input-new-provider-admin-name" />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Email</label>
            <Input type="email" placeholder="admin@provedor.com" value={form.adminEmail} onChange={f("adminEmail")} data-testid="input-new-provider-admin-email" />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Senha</label>
            <Input type="password" placeholder="Min. 6 caracteres" value={form.adminPassword} onChange={f("adminPassword")} data-testid="input-new-provider-admin-password" />
          </div>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending} className="gap-2" data-testid="button-create-provider">
          {mutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Criar Provedor
        </Button>
        <Button variant="ghost" onClick={onSuccess}>Cancelar</Button>
      </div>
    </div>
  );
}

function ProviderCreditsModal({ provider, onClose }: { provider: any; onClose: () => void }) {
  const [isp, setIsp] = useState("0");
  const [spc, setSpc] = useState("0");
  const [notes, setNotes] = useState("");
  const [plan, setPlan] = useState(provider.plan);
  const { toast } = useToast();
  const qc = useQueryClient();

  const creditsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/providers/${provider.id}/credits`, {
        ispCredits: parseInt(isp) || 0, spcCredits: parseInt(spc) || 0, notes,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      toast({ title: "Creditos adicionados!" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const planMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/providers/${provider.id}/plan`, { plan, notes });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/plan-history"] });
      toast({ title: "Plano alterado!" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <CreditCard className="w-5 h-5" />Gerenciar {provider.name}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Alterar Plano</label>
            <div className="flex gap-2">
              <select
                className="flex-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                data-testid="select-provider-plan"
              >
                <option value="free">Gratuito</option>
                <option value="basic">Basico</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
              <Button onClick={() => planMutation.mutate()} disabled={planMutation.isPending || plan === provider.plan} className="gap-1" data-testid="button-save-plan">
                {planMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>

          <div className="border-t pt-3">
            <label className="text-sm font-medium mb-2 block">Adicionar Creditos</label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">ISP</label>
                <Input type="number" value={isp} onChange={(e) => setIsp(e.target.value)} placeholder="0" data-testid="input-isp-credits" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">SPC</label>
                <Input type="number" value={spc} onChange={(e) => setSpc(e.target.value)} placeholder="0" data-testid="input-spc-credits" />
              </div>
            </div>
            <div className="mb-2">
              <Input placeholder="Observacao (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-credit-notes" />
            </div>
            <Button onClick={() => creditsMutation.mutate()} disabled={creditsMutation.isPending} className="w-full gap-1.5" data-testid="button-add-credits">
              {creditsMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Adicionar Creditos
            </Button>
          </div>

          <div className="border-t pt-3 text-xs text-muted-foreground">
            Creditos atuais: ISP <strong>{provider.ispCredits}</strong> | SPC <strong>{provider.spcCredits}</strong>
          </div>
        </div>

        <Button variant="ghost" className="mt-3 w-full" onClick={onClose}>Fechar</Button>
      </div>
    </div>
  );
}

export default function AdminSistemaPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("painel");
  const [showNewProvider, setShowNewProvider] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<any>(null);
  const [providerSearch, setProviderSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const isSuperAdmin = user?.role === "superadmin";

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/admin/stats"],
    enabled: isSuperAdmin,
  });
  const { data: allProviders = [], isLoading: providersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    enabled: isSuperAdmin,
  });
  const { data: allUsers = [], isLoading: usersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    enabled: isSuperAdmin,
  });
  const { data: chatThreads = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/chat/threads"],
    refetchInterval: isSuperAdmin ? 10000 : false,
    enabled: isSuperAdmin,
  });
  const { data: planHistory = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/plan-history"],
    enabled: isSuperAdmin,
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/providers/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      toast({ title: "Provedor desativado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
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

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <Shield className="w-16 h-16 text-red-500 opacity-40" />
        <h2 className="text-xl font-bold">Acesso Restrito</h2>
        <p className="text-muted-foreground text-center">Esta area e exclusiva para administradores do sistema Consulta ISP.</p>
      </div>
    );
  }

  const filteredProviders = allProviders.filter(p =>
    p.name.toLowerCase().includes(providerSearch.toLowerCase()) ||
    (p.subdomain || "").toLowerCase().includes(providerSearch.toLowerCase())
  );

  const filteredUsers = allUsers.filter(u =>
    u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  const totalUnread = chatThreads.reduce((sum: number, t: any) => sum + (t.unreadCount || 0), 0);

  const STAT_CARDS = [
    { label: "Provedores", value: stats?.providers ?? "-", icon: Building2, color: "from-blue-500 to-blue-600", sub: `${stats?.activeProviders ?? 0} ativos` },
    { label: "Usuarios", value: stats?.users ?? "-", icon: Users, color: "from-indigo-500 to-indigo-600", sub: "cadastrados" },
    { label: "Clientes", value: stats?.customers ?? "-", icon: User, color: "from-purple-500 to-purple-600", sub: "em todos os provedores" },
    { label: "Consultas ISP", value: stats?.ispConsultations ?? "-", icon: Search, color: "from-emerald-500 to-emerald-600", sub: "total realizado" },
    { label: "Consultas SPC", value: stats?.spcConsultations ?? "-", icon: BarChart3, color: "from-violet-500 to-violet-600", sub: "total realizado" },
    { label: "Mensagens novas", value: totalUnread, icon: MessageSquare, color: "from-rose-500 to-rose-600", sub: "aguardando resposta" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="admin-sistema-page">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-red-600 to-rose-700 flex items-center justify-center">
          <Shield className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Painel Administrativo</h1>
          <p className="text-sm text-muted-foreground">Gerenciamento total do sistema Consulta ISP</p>
        </div>
        <Badge className="ml-auto bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 gap-1.5">
          <Shield className="w-3 h-3" />Super Admin
        </Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="painel" className="gap-1.5" data-testid="tab-admin-painel">
            <Activity className="w-3.5 h-3.5" />Painel Geral
          </TabsTrigger>
          <TabsTrigger value="provedores" className="gap-1.5" data-testid="tab-admin-provedores">
            <Building2 className="w-3.5 h-3.5" />Provedores
          </TabsTrigger>
          <TabsTrigger value="usuarios" className="gap-1.5" data-testid="tab-admin-usuarios">
            <Users className="w-3.5 h-3.5" />Usuarios
          </TabsTrigger>
          <TabsTrigger value="financeiro" className="gap-1.5" data-testid="tab-admin-financeiro">
            <CreditCard className="w-3.5 h-3.5" />Financeiro
          </TabsTrigger>
          <TabsTrigger value="suporte" className="gap-1.5 relative" data-testid="tab-admin-suporte">
            <MessageSquare className="w-3.5 h-3.5" />
            Suporte
            {totalUnread > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
                {totalUnread}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="painel" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {STAT_CARDS.map((s) => (
              <Card key={s.label} className="p-4" data-testid={`stat-card-${s.label.toLowerCase().replace(/ /g, "-")}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center`}>
                    <s.icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="text-[11px] text-muted-foreground/70">{s.sub}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                <Building2 className="w-4 h-4" />Provedores Recentes
              </h3>
              <div className="space-y-2">
                {allProviders.slice(0, 5).map((p: any) => (
                  <div key={p.id} className="flex items-center gap-3 py-1.5 border-b last:border-0" data-testid={`provider-row-${p.id}`}>
                    <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300">
                      {p.name?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.subdomain}.consultaisp.com.br</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs ${PLAN_LABELS[p.plan]?.color || ""}`}>
                        {PLAN_LABELS[p.plan]?.label}
                      </Badge>
                      <span className={`w-2 h-2 rounded-full ${p.status === "active" ? "bg-emerald-500" : "bg-gray-400"}`} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                <ArrowUpDown className="w-4 h-4" />Historico de Planos
              </h3>
              <div className="space-y-2">
                {planHistory.slice(0, 5).map((h: any) => (
                  <div key={h.id} className="py-1.5 border-b last:border-0 text-sm">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {new Date(h.createdAt).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    {h.oldPlan && h.newPlan ? (
                      <p className="text-xs mt-0.5">
                        Plano: <strong>{PLAN_LABELS[h.oldPlan]?.label}</strong> → <strong>{PLAN_LABELS[h.newPlan]?.label}</strong>
                      </p>
                    ) : (
                      <p className="text-xs mt-0.5">
                        Creditos: ISP <strong>+{h.ispCreditsAdded}</strong> / SPC <strong>+{h.spcCreditsAdded}</strong>
                      </p>
                    )}
                    {h.notes && <p className="text-xs text-muted-foreground truncate">{h.notes}</p>}
                  </div>
                ))}
                {planHistory.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">Nenhum historico ainda</p>
                )}
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="provedores" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar provedor..."
                className="pl-9"
                value={providerSearch}
                onChange={(e) => setProviderSearch(e.target.value)}
                data-testid="input-search-provider"
              />
            </div>
            <Button onClick={() => setShowNewProvider(!showNewProvider)} className="gap-1.5" data-testid="button-new-provider">
              <Plus className="w-4 h-4" />Novo Provedor
            </Button>
          </div>

          {showNewProvider && (
            <Card className="p-5">
              <h3 className="font-semibold mb-4">Criar Novo Provedor</h3>
              <NewProviderForm onSuccess={() => setShowNewProvider(false)} />
            </Card>
          )}

          <Card className="overflow-hidden">
            {providersLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="divide-y">
                {filteredProviders.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-4 px-5 py-4" data-testid={`admin-provider-row-${p.id}`}>
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                      {p.name?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">{p.name}</p>
                        <span className={`w-2 h-2 rounded-full ${p.status === "active" ? "bg-emerald-500" : "bg-gray-400"}`} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{p.subdomain}.consultaisp.com.br</span>
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{p.userCount} usuarios</span>
                        <span>ISP: {p.ispCredits} | SPC: {p.spcCredits}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs ${PLAN_LABELS[p.plan]?.color || ""}`}>
                        {PLAN_LABELS[p.plan]?.label}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs h-8"
                        onClick={() => setSelectedProvider(p)}
                        data-testid={`button-manage-provider-${p.id}`}
                      >
                        <Settings2 className="w-3.5 h-3.5" />Gerenciar
                      </Button>
                      {p.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => {
                            if (confirm(`Desativar ${p.name}?`)) deactivateMutation.mutate(p.id);
                          }}
                          data-testid={`button-deactivate-provider-${p.id}`}
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="usuarios" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar usuario..."
                className="pl-9"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                data-testid="input-search-user"
              />
            </div>
            <Badge variant="secondary">{filteredUsers.length} usuario(s)</Badge>
          </div>
          <Card className="overflow-hidden">
            {usersLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="divide-y">
                {filteredUsers.map((u: any) => (
                  <div key={u.id} className="flex items-center gap-4 px-5 py-3" data-testid={`admin-user-row-${u.id}`}>
                    <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-sm font-bold text-indigo-700 dark:text-indigo-300">
                      {u.name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs ${
                        u.role === "superadmin" ? "bg-red-100 text-red-700" :
                        u.role === "admin" ? "bg-blue-100 text-blue-700" :
                        "bg-gray-100 text-gray-700"
                      }`}>
                        {u.role === "superadmin" ? "Super Admin" : u.role === "admin" ? "Admin" : "Usuario"}
                      </Badge>
                      {u.emailVerified ? (
                        <CheckCircle className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-amber-500" />
                      )}
                      {u.role !== "superadmin" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => {
                            if (confirm(`Remover usuario ${u.name}?`)) deleteUserMutation.mutate(u.id);
                          }}
                          data-testid={`button-delete-admin-user-${u.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="financeiro" className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            {allProviders.map((p: any) => (
              <Card key={p.id} className="p-4" data-testid={`financial-card-${p.id}`}>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="font-semibold text-sm">{p.name}</p>
                    <Badge className={`text-xs mt-1 ${PLAN_LABELS[p.plan]?.color || ""}`}>
                      {PLAN_LABELS[p.plan]?.label}
                    </Badge>
                  </div>
                  <span className={`w-2 h-2 rounded-full mt-1.5 ${p.status === "active" ? "bg-emerald-500" : "bg-gray-400"}`} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-center mb-3">
                  <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-2">
                    <p className="text-xs text-muted-foreground">ISP</p>
                    <p className="text-lg font-bold text-blue-700 dark:text-blue-300">{p.ispCredits}</p>
                  </div>
                  <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-2">
                    <p className="text-xs text-muted-foreground">SPC</p>
                    <p className="text-lg font-bold text-purple-700 dark:text-purple-300">{p.spcCredits}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs gap-1.5"
                  onClick={() => setSelectedProvider(p)}
                  data-testid={`button-financial-manage-${p.id}`}
                >
                  <CreditCard className="w-3.5 h-3.5" />Gerenciar Creditos
                </Button>
              </Card>
            ))}
          </div>

          <Card className="p-5">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4" />Historico de Alteracoes
            </h3>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {planHistory.map((h: any) => (
                <div key={h.id} className="flex items-start gap-3 py-2 border-b last:border-0 text-sm">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    h.newPlan ? "bg-purple-100 text-purple-700" : "bg-emerald-100 text-emerald-700"
                  }`}>
                    {h.newPlan ? <ArrowUpDown className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-xs">
                        {h.newPlan
                          ? `Plano: ${PLAN_LABELS[h.oldPlan]?.label} → ${PLAN_LABELS[h.newPlan]?.label}`
                          : `Creditos: ISP +${h.ispCreditsAdded} / SPC +${h.spcCreditsAdded}`}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(h.createdAt).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    {h.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{h.notes}</p>}
                    {h.changedByName && <p className="text-xs text-muted-foreground/70">{h.changedByName}</p>}
                  </div>
                </div>
              ))}
              {planHistory.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">Nenhum historico de alteracoes</p>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="suporte">
          <ChatPanel threads={chatThreads} />
        </TabsContent>
      </Tabs>

      {selectedProvider && (
        <ProviderCreditsModal provider={selectedProvider} onClose={() => setSelectedProvider(null)} />
      )}
    </div>
  );
}
