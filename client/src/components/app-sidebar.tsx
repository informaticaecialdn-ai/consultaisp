import { useLocation, useSearch, Link } from "wouter";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  LayoutDashboard,
  Search,
  BarChart3,
  ShieldAlert,
  Users,
  MapPin,
  CreditCard,
  Upload,
  Settings,
  Shield,
  LogOut,
  Building2,
  Globe,
  ExternalLink,
  Crown,
  Activity,
  ChevronDown,
  FileText,
  MessageSquare,
  UserCog,
  TrendingUp,
  ShoppingCart,
  Zap,
  Database,
  ClipboardList,
  Package,
  RefreshCw,
  Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";

function TrialBanner() {
  const { data } = useQuery<any>({ queryKey: ["/api/provider/trial-status"], staleTime: 5 * 60 * 1000 });
  if (!data?.trial_ativo) return null;
  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 text-xs" data-testid="trial-banner">
      <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400 mb-0.5">
        <Crown className="w-3 h-3" />
        Trial — {data.dias_restantes} dia{data.dias_restantes !== 1 ? "s" : ""} restante{data.dias_restantes !== 1 ? "s" : ""}
      </div>
      <p className="text-amber-600 dark:text-amber-500 leading-relaxed">
        Aproveite todos os recursos. Assine para continuar após o período de avaliação.
      </p>
    </div>
  );
}

const PLAN_LABELS: Record<string, string> = {
  free: "Gratuito",
  basic: "Basico",
  pro: "Pro",
  enterprise: "Enterprise",
};

const mainMenu = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Consulta ISP", url: "/consulta-isp", icon: Search },
  { title: "Consulta SPC", url: "/consulta-spc", icon: BarChart3 },
  { title: "Anti-Fraude", url: "/anti-fraude", icon: ShieldAlert },
  { title: "Benchmark Regional", url: "/benchmark-regional", icon: TrendingUp },
];

const defaulterMenu = [
  { title: "Inadimplentes", url: "/inadimplentes", icon: Users },
  { title: "Mapa de Calor", url: "/mapa-calor", icon: MapPin },
];

const financeMenu = [
  { title: "Comprar Creditos", url: "/creditos", icon: CreditCard },
];

const toolsMenu = [
  { title: "Importacao", url: "/importacao", icon: Upload },
  { title: "Importar Equip.", url: "/importacao-equipamentos", icon: Package },
];

const configMenu = [
  { title: "Regionalizacao", url: "/configuracoes/regionalizacao", icon: MapPin },
  { title: "Alertas", url: "/configuracoes-alertas", icon: Bell },
];

const ADMIN_GROUPS = [
  {
    label: "Visao Geral",
    key: "overview",
    collapsible: false,
    items: [
      { title: "Painel Geral", hash: "painel", icon: Activity, testId: "link-admin-painel" },
    ],
  },
  {
    label: "Gestao",
    key: "gestao",
    collapsible: true,
    items: [
      { title: "Cadastros", hash: "cadastros", icon: ClipboardList, testId: "link-admin-cadastros" },
      { title: "Provedores", hash: "provedores", icon: Building2, testId: "link-admin-provedores" },
      { title: "Usuarios", hash: "usuarios", icon: UserCog, testId: "link-admin-usuarios" },
      { title: "ERPs Cadastrados", hash: "erps", icon: Database, testId: "link-admin-erps" },
      { title: "Integracoes", hash: "integracoes", icon: Zap, testId: "link-admin-integracoes" },
      { title: "Sincronizacao Auto", hash: "sincronizacao", icon: RefreshCw, testId: "link-admin-sincronizacao" },
    ],
  },
  {
    label: "Financeiro",
    key: "financeiro",
    collapsible: true,
    items: [
      { title: "Dashboard SaaS", hash: "financeiro-dash", icon: TrendingUp, testId: "link-admin-financeiro-dash", url: "/admin/financeiro" },
      { title: "Faturas e Cobrancas", hash: "financeiro", icon: FileText, testId: "link-admin-financeiro" },
      { title: "Pedidos de Creditos", hash: "creditos-dash", icon: ShoppingCart, testId: "link-admin-creditos", url: "/admin/creditos" },
    ],
  },
  {
    label: "Compliance",
    key: "compliance",
    collapsible: false,
    items: [
      { title: "LGPD / Titulares", hash: "lgpd-titulares", icon: Shield, testId: "link-admin-lgpd", url: "/admin/lgpd" },
    ],
  },
  {
    label: "Suporte",
    key: "suporte",
    collapsible: false,
    items: [
      { title: "Chat com Provedores", hash: "suporte", icon: MessageSquare, testId: "link-admin-suporte" },
    ],
  },
];

function AdminCollapsibleGroup({
  group,
  activeHash,
  onNavigate,
  onNavigateDirect,
}: {
  group: (typeof ADMIN_GROUPS)[number];
  activeHash: string;
  onNavigate: (hash: string) => void;
  onNavigateDirect: (url: string) => void;
}) {
  const [open, setOpen] = useState<boolean>(true);
  const [location] = useLocation();

  const ItemButton = ({ item }: { item: (typeof ADMIN_GROUPS)[number]["items"][number] }) => {
    const isActive = (item as any).url ? location === (item as any).url : activeHash === item.hash;
    return (
      <SidebarMenuItem key={item.hash}>
        <SidebarMenuButton
          data-active={isActive}
          data-testid={item.testId}
          onClick={() => (item as any).url ? onNavigateDirect((item as any).url) : onNavigate(item.hash)}
          className="cursor-pointer"
        >
          <item.icon className="w-4 h-4" />
          <span>{item.title}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  if (!group.collapsible) {
    return (
      <SidebarGroup className="py-0.5">
        <SidebarGroupLabel className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground px-2 py-1.5">
          {group.label}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {group.items.map((item) => <ItemButton key={item.hash} item={item} />)}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup className="py-0.5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground px-2 py-1.5 cursor-pointer flex items-center justify-between w-full hover:text-foreground transition-colors">
            <span>{group.label}</span>
            <ChevronDown
              className={`w-3 h-3 transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}
            />
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => <ItemButton key={item.hash} item={item} />)}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const { user, provider, logout } = useAuth();
  const subdomain = (provider as any)?.subdomain;
  const planLabel = PLAN_LABELS[provider?.plan || "free"] || "Gratuito";
  const isPro = provider?.plan === "pro" || provider?.plan === "enterprise";
  const isSuperAdmin = user?.role === "superadmin";

  const [activeHash, setActiveHash] = useState(() =>
    typeof window !== "undefined" ? window.location.hash.replace("#", "") || "painel" : "painel"
  );

  useEffect(() => {
    if (!isSuperAdmin) return;
    const handleHashChange = () => {
      setActiveHash(window.location.hash.replace("#", "") || "painel");
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [isSuperAdmin]);

  const handleAdminNavigate = (hash: string) => {
    setActiveHash(hash);
    if (location !== "/admin-sistema") {
      navigate("/admin-sistema");
    }
    window.history.replaceState(null, "", `/admin-sistema#${hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  if (isSuperAdmin) {
    return (
      <Sidebar>
        <SidebarHeader className="p-4 pb-3">
          <button onClick={() => handleAdminNavigate("painel")} className="w-full text-left">
            <div className="flex items-center gap-3 cursor-pointer">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 to-rose-700 flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold leading-tight">Consulta ISP</span>
                <span className="text-[11px] text-muted-foreground leading-tight">Sistema Admin</span>
              </div>
            </div>
          </button>
        </SidebarHeader>

        <SidebarContent className="gap-0">
          {ADMIN_GROUPS.map((group) => (
            <AdminCollapsibleGroup key={group.key} group={group} activeHash={activeHash} onNavigate={handleAdminNavigate} onNavigateDirect={navigate} />
          ))}
        </SidebarContent>

        <SidebarFooter className="p-4 space-y-3 border-t">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-rose-100 dark:bg-rose-950 flex items-center justify-center text-sm font-bold text-rose-700 dark:text-rose-300 flex-shrink-0">
              {user?.name?.charAt(0)?.toUpperCase() || "A"}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium truncate">{user?.name}</span>
              <span className="text-[10px] text-rose-600 dark:text-rose-400 font-semibold uppercase tracking-wide">Super Admin</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            onClick={logout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />Sair
          </Button>
        </SidebarFooter>
      </Sidebar>
    );
  }

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/">
          <div className="flex items-center gap-3 cursor-pointer">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold leading-tight">Consulta ISP</span>
              <span className="text-[11px] text-muted-foreground leading-tight">Analise de Credito</span>
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
            Principal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainMenu.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild data-active={location === item.url}>
                    <Link href={item.url}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
            Inadimplente
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {defaulterMenu.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild data-active={location === item.url}>
                    <Link href={item.url}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
            Financeiro
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {financeMenu.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild data-active={location === item.url}>
                    <Link href={item.url}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
            Gestao
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {toolsMenu.map((item) => {
                const [itemPath, itemQuery] = item.url.split("?");
                const isActive = location === itemPath && (!itemQuery || search === `?${itemQuery}`);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild data-active={isActive}>
                      <Link href={item.url}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              <SidebarMenuItem>
                <SidebarMenuButton asChild data-active={location === "/painel-provedor"}>
                  <Link href="/painel-provedor" data-testid="link-painel-provedor">
                    <Building2 className="w-4 h-4" />
                    <span>Painel do Provedor</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {(user?.role === "admin") && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
              Configuracoes
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {configMenu.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild data-active={location === item.url}>
                      <Link href={item.url}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-3">
        <TrialBanner />

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300">
            {user?.name?.charAt(0)?.toUpperCase() || "U"}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-medium truncate">{user?.name}</span>
            <span className="text-[11px] text-muted-foreground truncate">{provider?.name}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={logout} data-testid="button-logout">
          <LogOut className="w-4 h-4" />
          Sair
        </Button>
        <a href="/lgpd" className="block text-center text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors" data-testid="link-lgpd">
          Política de Privacidade · LGPD
        </a>
      </SidebarFooter>
    </Sidebar>
  );
}
