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
  Target,
  MessageCircle,
  Bot,
  HeartPulse,
  Radar,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";

function TrialBanner() {
  const { data } = useQuery<any>({ queryKey: ["/api/provider/trial-status"], staleTime: 5 * 60 * 1000 });
  if (!data?.trial_ativo) return null;
  return (
    <div className="bg-[var(--color-gold-bg)] border-[0.5px] border-[var(--color-border)] rounded p-2.5 text-xs" data-testid="trial-banner">
      <div className="flex items-center gap-1.5 font-semibold text-[var(--color-gold)] mb-0.5">
        <Crown className="w-3 h-3" />
        Trial — {data.dias_restantes} dia{data.dias_restantes !== 1 ? "s" : ""} restante{data.dias_restantes !== 1 ? "s" : ""}
      </div>
      <p className="text-[var(--color-gold)] leading-relaxed">
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

// ═══════════════════════════════════════════════════════════════════════
// SIDEBAR PROVEDOR.AI — 9 grupos top-level (Spec 007 · DESIGN.md §4.1)
//
// Estrutura canônica que substitui blocos antigos (mainMenu/cobrancaMenu/
// financeMenu/toolsMenu/configMenu). Cada grupo é collapsible (exceto
// Dashboard e Time, que são atalhos diretos).
//
// Itens com comingSoon: placeholder até spec correspondente entrar.
// adminOnly: visível só para role="admin" do tenant.
// ═══════════════════════════════════════════════════════════════════════

type SidebarItem = {
  title: string;
  url?: string;            // rota direta; quando ausente + comingSoon, vira disabled
  icon: React.ComponentType<{ className?: string }>;
  testId?: string;
  comingSoon?: string;     // ex: "Spec 010" — exibe badge "Em breve"
  adminOnly?: boolean;
};

type SidebarGroupDef = {
  label: string;
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Quando definido, o grupo é um atalho direto (sem collapsible). */
  directUrl?: string;
  items?: SidebarItem[];
  /** Default collapse state quando collapsible. */
  defaultOpen?: boolean;
  adminOnly?: boolean;
};

const SIDEBAR_GROUPS: SidebarGroupDef[] = [
  {
    label: "Dashboard",
    key: "dashboard",
    icon: LayoutDashboard,
    directUrl: "/",
  },
  {
    label: "Clientes",
    key: "clientes",
    icon: Users,
    defaultOpen: true,
    items: [
      { title: "Inadimplentes", url: "/inadimplentes", icon: TrendingUp },
      { title: "Anti-Fraude", url: "/anti-fraude", icon: ShieldAlert },
      { title: "Mapa de Calor", url: "/mapa-calor", icon: MapPin },
      { title: "Consulta ISP (Rede)", url: "/consulta-isp", icon: Search },
      { title: "Consulta SPC", url: "/consulta-spc", icon: BarChart3 },
    ],
  },
  {
    label: "Cobrança",
    key: "cobranca",
    icon: Bot,
    defaultOpen: true,
    items: [
      { title: "Régua Pré-Vencimento", url: "/regua-pre-vencimento", icon: ClipboardList },
      { title: "Comunicações", url: "/comunicacoes", icon: MessageSquare },
    ],
  },
  {
    label: "Equipamentos",
    key: "equipamentos",
    icon: Package,
    items: [
      { title: "Importar Equip.", url: "/importacao-equipamentos", icon: Upload },
      { title: "Recuperações", icon: RefreshCw, comingSoon: "Spec 013 · Lucas" },
    ],
  },
  {
    label: "Carteiras",
    key: "carteiras",
    icon: Target,
    items: [
      { title: "Por região / POP", icon: MapPin, comingSoon: "Spec 015 · CRM Plus+" },
      { title: "Minhas tarefas", icon: ClipboardList, comingSoon: "Spec 015" },
    ],
  },
  {
    label: "Time Digital",
    key: "time",
    icon: Users,
    directUrl: "/time",
  },
  {
    label: "Anatel Shield",
    key: "anatel-shield",
    icon: Shield,
    items: [
      { title: "Notificações legais", icon: FileText, comingSoon: "Spec 010 · Carla" },
      { title: "Defesa Procon", icon: Shield, comingSoon: "Spec 010" },
      { title: "Status do shield", icon: Activity, comingSoon: "Spec 011 · Marcos" },
    ],
  },
  {
    label: "Relatórios",
    key: "relatorios",
    icon: BarChart3,
    items: [
      { title: "Benchmark Regional", url: "/benchmark-regional", icon: TrendingUp },
      { title: "Importação CSV", url: "/importacao", icon: Database },
      { title: "Provedor Index", icon: Activity, comingSoon: "Spec 011 · Marcos" },
    ],
  },
  {
    label: "Configurações",
    key: "configuracoes",
    icon: Settings,
    adminOnly: true,
    items: [
      { title: "Configurar Agentes", url: "/configuracoes/agentes", icon: Bot },
      { title: "Conexão Asaas", url: "/configuracoes/asaas", icon: CreditCard },
      { title: "WhatsApp Business", url: "/configuracoes/whatsapp", icon: MessageCircle },
      { title: "Regionalização", url: "/configuracoes/regionalizacao", icon: Globe },
      { title: "Painel do Provedor", url: "/painel-provedor", icon: Building2, testId: "link-painel-provedor" },
      { title: "Administração", url: "/administracao", icon: UserCog },
      { title: "Comprar Créditos", url: "/creditos", icon: CreditCard },
      { title: "Notas Fiscais", url: "/nfse", icon: FileText },
    ],
  },
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
    label: "Time Digital",
    key: "time-digital-group",
    collapsible: false,
    items: [
      { title: "Visao Agregada", hash: "time-digital", icon: Bot, testId: "link-admin-time-digital" },
    ],
  },
  {
    label: "Laboratorio de Engines",
    key: "laboratorio",
    collapsible: true,
    items: [
      { title: "Health Score 360", hash: "lab-health", icon: HeartPulse, testId: "link-admin-lab-health", url: "/health/simulador" },
      { title: "Calibrador de Pesos", hash: "lab-calibrador", icon: Settings, testId: "link-admin-lab-calibrador", url: "/health/calibrador" },
      { title: "Saida Silenciosa", hash: "lab-silent-exit", icon: TrendingUp, testId: "link-admin-lab-silent-exit", url: "/silent-exit/simulador" },
      { title: "Geo-Monitor Concorrente", hash: "lab-geo", icon: Radar, testId: "link-admin-lab-geo", url: "/competitor-monitor/simulador" },
      { title: "Pix Dinamico Decay", hash: "lab-pix", icon: Timer, testId: "link-admin-lab-pix", url: "/pix-dynamic/simulador" },
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
  {
    label: "Configuracoes",
    key: "configuracoes",
    collapsible: false,
    items: [
      { title: "Configuracoes", hash: "configuracoes", icon: Settings, testId: "link-admin-configuracoes" },
    ],
  },
  {
    label: "CRM Vendas",
    key: "crm",
    collapsible: true,
    items: [
      { title: "Dashboard", hash: "crm-dashboard", icon: Target, testId: "link-crm-dashboard" },
      { title: "Leads", hash: "crm-leads", icon: Target, testId: "link-crm-leads" },
      { title: "Pipeline", hash: "crm-pipeline", icon: Target, testId: "link-crm-pipeline" },
      { title: "Conversas", hash: "crm-conversas", icon: Target, testId: "link-crm-conversas" },
      { title: "Agentes", hash: "crm-agentes", icon: Target, testId: "link-crm-agentes" },
      { title: "Prospeccao", hash: "crm-prospeccao", icon: Target, testId: "link-crm-prospeccao" },
      { title: "Treinamento", hash: "crm-treinamento", icon: Target, testId: "link-crm-treinamento" },
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
        <SidebarGroupLabel className="text-xs font-semibold tracking-wider uppercase text-[var(--color-muted)] px-2 py-1.5">
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
          <SidebarGroupLabel className="text-xs font-semibold tracking-wider uppercase text-[var(--color-muted)] px-2 py-1.5 cursor-pointer flex items-center justify-between w-full hover:text-foreground transition-colors">
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

function ProviderSidebarGroup({
  group,
  location,
  search,
}: {
  group: SidebarGroupDef;
  location: string;
  search: string;
}) {
  const [open, setOpen] = useState<boolean>(group.defaultOpen ?? false);

  // Grupo "direct" (Dashboard, Time): atalho sem collapsible
  if (group.directUrl) {
    const isActive = location === group.directUrl;
    const GroupIcon = group.icon;
    return (
      <SidebarGroup className="py-0.5">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild data-active={isActive}>
                <Link href={group.directUrl}>
                  <GroupIcon className="w-4 h-4" />
                  <span className="font-medium">{group.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  const GroupIcon = group.icon;
  const items = group.items ?? [];

  return (
    <SidebarGroup className="py-0.5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel
            className="text-xs font-semibold tracking-wider uppercase text-[var(--color-muted)] px-2 py-1.5 cursor-pointer flex items-center justify-between w-full hover:text-foreground transition-colors"
            data-testid={`sidebar-group-${group.key}`}
          >
            <span className="flex items-center gap-2">
              <GroupIcon className="w-3.5 h-3.5" />
              {group.label}
            </span>
            <ChevronDown
              className={`w-3 h-3 transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}
            />
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const ItemIcon = item.icon;
                const isDisabled = !item.url || !!item.comingSoon;

                if (isDisabled) {
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        disabled
                        className="cursor-not-allowed opacity-60"
                        data-testid={`sidebar-coming-soon-${group.key}-${item.title}`}
                        title={item.comingSoon ? `Em breve · ${item.comingSoon}` : "Em breve"}
                      >
                        <ItemIcon className="w-4 h-4" />
                        <span className="flex-1 truncate">{item.title}</span>
                        <Badge
                          variant="outline"
                          className="ml-auto text-[9px] px-1.5 py-0 h-4 font-normal border-[var(--color-brand-amber-500)]/40 text-[var(--color-brand-amber-700)]"
                        >
                          Em breve
                        </Badge>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                const [itemPath, itemQuery] = item.url!.split("?");
                const isActive =
                  location === itemPath && (!itemQuery || search === `?${itemQuery}`);

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild data-active={isActive}>
                      <Link
                        href={item.url!}
                        data-testid={item.testId ?? `sidebar-${group.key}-${item.url!.replace(/\//g, "-")}`}
                      >
                        <ItemIcon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
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
              <div className="w-9 h-9 rounded bg-[var(--color-danger)] flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold leading-tight">Provedor.ai</span>
                <span className="text-xs text-[var(--color-muted)] leading-tight">Sistema Admin</span>
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
            <div className="w-8 h-8 rounded-full bg-[var(--color-danger-bg)] flex items-center justify-center text-sm font-bold text-[var(--color-danger)] flex-shrink-0">
              {user?.name?.charAt(0)?.toUpperCase() || "A"}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium truncate">{user?.name}</span>
              <span className="text-xs text-[var(--color-danger)] font-semibold uppercase tracking-wide">Super Admin</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-[var(--color-muted)] hover:text-foreground"
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
            <div className="w-9 h-9 rounded bg-[var(--color-navy)] flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold leading-tight">Provedor.ai</span>
              <span className="text-xs text-[var(--color-muted)] leading-tight">Cobrança Inteligente</span>
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        {SIDEBAR_GROUPS.filter((g) => !g.adminOnly || user?.role === "admin").map((group) => (
          <ProviderSidebarGroup
            key={group.key}
            group={group}
            location={location}
            search={search}
          />
        ))}
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-3">
        <TrialBanner />

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[var(--color-navy-bg)] flex items-center justify-center text-sm font-bold text-[var(--color-navy)]">
            {user?.name?.charAt(0)?.toUpperCase() || "U"}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-medium truncate">{user?.name}</span>
            <span className="text-xs text-[var(--color-muted)] truncate">{(provider as any)?.tradeName || provider?.name}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-[var(--color-muted)]" onClick={logout} data-testid="button-logout">
          <LogOut className="w-4 h-4" />
          Sair
        </Button>
        <a href="/lgpd" className="block text-center text-xs text-[var(--color-muted)]/60 hover:text-[var(--color-muted)] transition-colors" data-testid="link-lgpd">
          Política de Privacidade · LGPD
        </a>
      </SidebarFooter>
    </Sidebar>
  );
}
