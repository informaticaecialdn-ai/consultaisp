import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import {
  Building2, Globe, Users, CreditCard, Settings, Copy, CheckCircle,
  ExternalLink, Plus, Trash2, Shield, User, Mail, Phone, Link2,
  BarChart3, Search, AlertTriangle, Wifi, Save, RefreshCw, Crown,
  Lock, Star
} from "lucide-react";

const MAIN_DOMAIN = "consultaisp.com.br";

const PLAN_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  free:       { label: "Gratuito",    color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", icon: Star },
  basic:      { label: "Basico",      color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", icon: Star },
  pro:        { label: "Profissional",color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300", icon: Crown },
  enterprise: { label: "Enterprise",  color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300", icon: Crown },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleCopy} data-testid="button-copy-subdomain">
      {copied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
}

export default function PainelProvedorPage() {
  const { user, provider } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("visao-geral");
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "user" });
  const [settings, setSettings] = useState({
    name: provider?.name || "",
    contactEmail: (provider as any)?.contactEmail || "",
    contactPhone: (provider as any)?.contactPhone || "",
    website: (provider as any)?.website || "",
  });

  const subdomainUrl = provider?.subdomain ? `https://${provider.subdomain}.${MAIN_DOMAIN}` : null;

  const { data: providerUsers = [], isLoading: usersLoading } = useQuery<any[]>({
    queryKey: ["/api/provider/users"],
  });

  const { data: dashStats } = useQuery<any>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: ispConsultations = [] } = useQuery<any[]>({
    queryKey: ["/api/isp-consultations"],
  });

  const { data: spcConsultations = [] } = useQuery<any[]>({
    queryKey: ["/api/spc-consultations"],
  });

  const settingsMutation = useMutation({
    mutationFn: async (data: typeof settings) => {
      const res = await apiRequest("PATCH", "/api/provider/settings", data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Configuracoes salvas", description: "Dados do provedor atualizados com sucesso." });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const addUserMutation = useMutation({
    mutationFn: async (data: typeof newUser) => {
      const res = await apiRequest("POST", "/api/provider/users", data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/provider/users"] });
      setNewUser({ name: "", email: "", password: "", role: "user" });
      setShowAddUser(false);
      toast({ title: "Usuario criado", description: "Novo usuario adicionado com sucesso." });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiRequest("DELETE", `/api/provider/users/${userId}`, undefined);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/provider/users"] });
      toast({ title: "Usuario removido" });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const planInfo = PLAN_LABELS[provider?.plan || "free"] || PLAN_LABELS.free;
  const PlanIcon = planInfo.icon;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" data-testid="painel-provedor-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold" data-testid="text-painel-title">{provider?.name}</h1>
              <Badge className={`text-xs gap-1 ${planInfo.color}`}>
                <PlanIcon className="w-3 h-3" />
                {planInfo.label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">Painel Administrativo do Provedor</p>
          </div>
        </div>
        {subdomainUrl && (
          <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 border">
            <Globe className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span className="text-sm font-mono text-blue-700 dark:text-blue-400" data-testid="text-subdomain-url">
              {provider?.subdomain}.{MAIN_DOMAIN}
            </span>
            <CopyButton text={subdomainUrl} />
            <a href={subdomainUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 text-muted-foreground hover:text-foreground" />
            </a>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="visao-geral" className="gap-1.5" data-testid="tab-visao-geral">
            <BarChart3 className="w-3.5 h-3.5" />Visao Geral
          </TabsTrigger>
          <TabsTrigger value="dados" className="gap-1.5" data-testid="tab-dados">
            <Building2 className="w-3.5 h-3.5" />Dados do Provedor
          </TabsTrigger>
          <TabsTrigger value="subdominio" className="gap-1.5" data-testid="tab-subdominio">
            <Globe className="w-3.5 h-3.5" />Subdominio
          </TabsTrigger>
          <TabsTrigger value="usuarios" className="gap-1.5" data-testid="tab-usuarios">
            <Users className="w-3.5 h-3.5" />Usuarios
          </TabsTrigger>
          <TabsTrigger value="creditos" className="gap-1.5" data-testid="tab-creditos">
            <CreditCard className="w-3.5 h-3.5" />Creditos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="visao-geral" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Clientes", value: dashStats?.totalCustomers ?? "-", icon: Users, color: "bg-blue-500" },
              { label: "Inadimplentes", value: dashStats?.defaulters ?? "-", icon: AlertTriangle, color: "bg-red-500" },
              { label: "Consultas ISP", value: ispConsultations.length, icon: Search, color: "bg-indigo-500" },
              { label: "Consultas SPC", value: spcConsultations.length, icon: BarChart3, color: "bg-purple-500" },
            ].map((s) => (
              <Card key={s.label} className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.color}`}>
                    <s.icon className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <p className="text-lg font-bold" data-testid={`stat-${s.label.toLowerCase()}`}>{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4" />Informacoes do Plano
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Plano atual</span>
                  <Badge className={planInfo.color}>{planInfo.label}</Badge>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge className={provider?.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}>
                    {provider?.status === "active" ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Creditos ISP</span>
                  <span className="font-semibold" data-testid="text-isp-credits">{provider?.ispCredits ?? 0}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-muted-foreground">Creditos SPC</span>
                  <span className="font-semibold" data-testid="text-spc-credits">{provider?.spcCredits ?? 0}</span>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Globe className="w-4 h-4" />Seu Subdominio SaaS
              </h3>
              {provider?.subdomain ? (
                <div className="space-y-3">
                  <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">URL do seu painel:</p>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono text-blue-700 dark:text-blue-300 flex-1 break-all">
                        {provider.subdomain}.{MAIN_DOMAIN}
                      </code>
                      <CopyButton text={`https://${provider.subdomain}.${MAIN_DOMAIN}`} />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Compartilhe esta URL com sua equipe para acessar o sistema diretamente no seu dominio personalizado.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Subdominio nao configurado.</p>
              )}
            </Card>
          </div>

          <Card className="p-5">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" />Usuarios do Provedor
            </h3>
            <div className="space-y-2">
              {providerUsers.slice(0, 3).map((u: any) => (
                <div key={u.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300">
                    {u.name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {u.role === "admin" ? "Admin" : "Usuario"}
                  </Badge>
                </div>
              ))}
              {providerUsers.length > 3 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  +{providerUsers.length - 3} usuario(s). <button className="text-blue-600" onClick={() => setActiveTab("usuarios")}>Ver todos</button>
                </p>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="dados">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Building2 className="w-5 h-5" />Dados do Provedor
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Nome do Provedor</label>
                <Input
                  value={settings.name}
                  onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                  data-testid="input-provider-name-settings"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">CNPJ</label>
                <Input value={provider?.cnpj || ""} readOnly className="bg-muted" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  <Mail className="w-3.5 h-3.5 inline mr-1" />Email de Contato
                </label>
                <Input
                  type="email"
                  placeholder="contato@seuprovedor.com.br"
                  value={settings.contactEmail}
                  onChange={(e) => setSettings({ ...settings, contactEmail: e.target.value })}
                  data-testid="input-contact-email"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  <Phone className="w-3.5 h-3.5 inline mr-1" />Telefone de Contato
                </label>
                <Input
                  placeholder="(00) 0000-0000"
                  value={settings.contactPhone}
                  onChange={(e) => setSettings({ ...settings, contactPhone: e.target.value })}
                  data-testid="input-contact-phone"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium mb-1.5 block">
                  <Link2 className="w-3.5 h-3.5 inline mr-1" />Website
                </label>
                <Input
                  placeholder="https://seuprovedor.com.br"
                  value={settings.website}
                  onChange={(e) => setSettings({ ...settings, website: e.target.value })}
                  data-testid="input-website"
                />
              </div>
            </div>
            <Button
              onClick={() => settingsMutation.mutate(settings)}
              disabled={settingsMutation.isPending}
              className="gap-2"
              data-testid="button-save-settings"
            >
              {settingsMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {settingsMutation.isPending ? "Salvando..." : "Salvar Alteracoes"}
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="subdominio">
          <div className="space-y-4">
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
                <Globe className="w-5 h-5" />Seu Subdominio no Consulta ISP
              </h2>
              <p className="text-sm text-muted-foreground mb-5">
                Este e o endereco exclusivo do seu provedor na plataforma Consulta ISP.
              </p>

              {provider?.subdomain ? (
                <>
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 rounded-xl p-5 border border-blue-100 dark:border-blue-900 mb-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Seu URL exclusivo</p>
                        <div className="flex items-center gap-2">
                          <Globe className="w-5 h-5 text-blue-600" />
                          <span className="text-xl font-bold font-mono text-blue-700 dark:text-blue-300" data-testid="text-full-subdomain">
                            {provider.subdomain}.{MAIN_DOMAIN}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <CopyButton text={`https://${provider.subdomain}.${MAIN_DOMAIN}`} />
                        <a
                          href={`https://${provider.subdomain}.${MAIN_DOMAIN}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid="link-open-subdomain"
                        >
                          <Button variant="outline" size="sm" className="gap-1.5">
                            <ExternalLink className="w-4 h-4" />
                            Abrir
                          </Button>
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <Card className="p-4 border-dashed">
                      <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-emerald-500" />Como usar o subdominio
                      </h3>
                      <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside">
                        <li>Compartilhe o link com sua equipe</li>
                        <li>Faca login com suas credenciais normais</li>
                        <li>Acesse todas as funcionalidades do Consulta ISP</li>
                        <li>Seu ambiente e isolado dos outros provedores</li>
                      </ol>
                    </Card>
                    <Card className="p-4 border-dashed">
                      <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
                        <Lock className="w-4 h-4 text-blue-500" />Seguranca e Isolamento
                      </h3>
                      <ul className="space-y-1.5 text-sm text-muted-foreground">
                        <li>Seus dados sao isolados por tenant</li>
                        <li>Apenas usuarios do seu provedor tem acesso</li>
                        <li>Base de dados compartilhada para consultas ISP</li>
                        <li>Conformidade com LGPD garantida</li>
                      </ul>
                    </Card>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Globe className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Nenhum subdominio configurado. Entre em contato com o suporte.</p>
                </div>
              )}
            </Card>

            <Card className="p-6 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900">
              <h3 className="font-semibold mb-2 flex items-center gap-2 text-amber-800 dark:text-amber-300">
                <Settings className="w-4 h-4" />DNS e Configuracao de Producao
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-400 mb-3">
                Para o subdominio funcionar em producao, o administrador do sistema deve configurar o DNS wildcard:
              </p>
              <div className="bg-white dark:bg-gray-900 rounded-lg p-3 space-y-2 text-xs font-mono">
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground w-16">Tipo</span>
                  <span className="text-muted-foreground w-24">Nome</span>
                  <span className="text-muted-foreground">Valor</span>
                </div>
                <div className="flex items-center gap-3 border-t pt-2">
                  <span className="w-16 font-bold text-blue-600">A</span>
                  <span className="w-24">*.consultaisp</span>
                  <span className="text-emerald-600">IP_DO_SERVIDOR</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-16 font-bold text-blue-600">CNAME</span>
                  <span className="w-24">www</span>
                  <span className="text-emerald-600">consultaisp.com.br</span>
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="usuarios">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Users className="w-5 h-5" />Usuarios do Provedor
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Gerencie quem tem acesso ao painel do {provider?.name}
                </p>
              </div>
              {user?.role === "admin" && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowAddUser(!showAddUser)}
                  data-testid="button-add-user"
                >
                  <Plus className="w-4 h-4" />
                  Novo Usuario
                </Button>
              )}
            </div>

            {showAddUser && (
              <div className="bg-muted/50 rounded-lg p-4 mb-5 space-y-3 border">
                <h3 className="font-medium text-sm">Adicionar Novo Usuario</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Nome</label>
                    <Input
                      placeholder="Nome completo"
                      value={newUser.name}
                      onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                      data-testid="input-new-user-name"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Email</label>
                    <Input
                      type="email"
                      placeholder="email@provedor.com"
                      value={newUser.email}
                      onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                      data-testid="input-new-user-email"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Senha temporaria</label>
                    <Input
                      type="password"
                      placeholder="Min. 6 caracteres"
                      value={newUser.password}
                      onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                      data-testid="input-new-user-password"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Papel</label>
                    <select
                      className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                      value={newUser.role}
                      onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                      data-testid="select-new-user-role"
                    >
                      <option value="user">Usuario</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => addUserMutation.mutate(newUser)}
                    disabled={addUserMutation.isPending}
                    data-testid="button-confirm-add-user"
                  >
                    {addUserMutation.isPending ? "Criando..." : "Criar Usuario"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowAddUser(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {usersLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="divide-y rounded-lg border overflow-hidden">
                {providerUsers.map((u: any) => (
                  <div key={u.id} className="flex items-center gap-4 px-4 py-3 bg-background" data-testid={`user-row-${u.id}`}>
                    <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300 flex-shrink-0">
                      {u.name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{u.name}</p>
                        {u.id === user?.id && (
                          <Badge variant="outline" className="text-xs px-1.5">Voce</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={`text-xs ${u.role === "admin" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
                      >
                        {u.role === "admin" ? "Admin" : "Usuario"}
                      </Badge>
                      {u.emailVerified ? (
                        <CheckCircle className="w-4 h-4 text-emerald-500" title="Email verificado" />
                      ) : (
                        <Mail className="w-4 h-4 text-amber-500" title="Email pendente" />
                      )}
                      {user?.role === "admin" && u.id !== user?.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => {
                            if (confirm(`Remover usuario ${u.name}?`)) {
                              deleteUserMutation.mutate(u.id);
                            }
                          }}
                          data-testid={`button-delete-user-${u.id}`}
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

        <TabsContent value="creditos">
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
                    <Search className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Creditos ISP</p>
                    <p className="text-3xl font-bold" data-testid="text-isp-credits-tab">{provider?.ispCredits ?? 0}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cada consulta ISP em outro provedor consome 1 credito. Consultas no proprio provedor sao gratuitas.
                </p>
              </Card>
              <Card className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500 flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Creditos SPC</p>
                    <p className="text-3xl font-bold" data-testid="text-spc-credits-tab">{provider?.spcCredits ?? 0}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cada consulta ao bureau SPC consome 1 credito SPC.
                </p>
              </Card>
            </div>

            <Card className="p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <CreditCard className="w-4 h-4" />Planos Disponiveis
              </h3>
              <div className="grid md:grid-cols-3 gap-4">
                {[
                  { plan: "Basico", price: "R$ 99/mes", isp: 200, spc: 50, color: "border-blue-200", badge: "bg-blue-100 text-blue-700" },
                  { plan: "Profissional", price: "R$ 249/mes", isp: 1000, spc: 200, color: "border-purple-200 ring-2 ring-purple-300", badge: "bg-purple-100 text-purple-700", highlight: true },
                  { plan: "Enterprise", price: "Sob consulta", isp: "Ilimitado", spc: "Ilimitado", color: "border-amber-200", badge: "bg-amber-100 text-amber-700" },
                ].map((p) => (
                  <div key={p.plan} className={`rounded-xl border p-4 relative ${p.color}`}>
                    {p.highlight && (
                      <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-purple-600 text-white text-xs">Popular</Badge>
                    )}
                    <p className="font-bold mb-1">{p.plan}</p>
                    <p className="text-2xl font-bold mb-3">{p.price}</p>
                    <ul className="space-y-1.5 text-sm text-muted-foreground mb-4">
                      <li>{p.isp} consultas ISP/mes</li>
                      <li>{p.spc} consultas SPC/mes</li>
                      <li>Subdominio personalizado</li>
                      <li>Suporte prioritario</li>
                    </ul>
                    <Button variant="outline" size="sm" className="w-full text-xs" data-testid={`button-plan-${p.plan.toLowerCase()}`}>
                      {provider?.plan === p.plan.toLowerCase() ? "Plano Atual" : "Assinar"}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
