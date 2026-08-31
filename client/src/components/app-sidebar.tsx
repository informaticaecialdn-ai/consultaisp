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
  ScanSearch,
  IdCard,
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

} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { SimboloConsultaISP } from "@/components/marca";

function TrialBanner() {
  const { data } = useQuery<any>({ queryKey: ["/api/provider/trial-status"], staleTime: 5 * 60 * 1000 });
  if (!data?.trial_ativo) return null;
  return (
    <div className="bg-[var(--color-gold-bg)] rounded-lg p-2.5 text-xs" data-testid="trial-banner">
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
              {/* Logo em navy, não vermelho: o admin é instrumento, não alarme.
                  O vermelho fica reservado para o que é de fato perigoso. */}
              <SimboloConsultaISP tamanho={34} className="flex-shrink-0" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold tracking-[-0.01em] leading-tight text-[var(--color-ink)]">Consulta ISP</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-muted)] leading-tight">Sistema Admin</span>
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

  /* ── Sidebar do provedor — implementacao 1:1 do handoff Sidebar.md ──
     Nenhuma cor hex aqui: so var(--brand), var(--brand-soft), var(--brand-ink)
     e a escala --text-*. O tema troca via data-theme no <html>. */
  const NAV: Array<{ grupo: string; itens: Array<{ label: string; url: string; Icone: any; testId: string }> }> = [
    {
      grupo: "Principal",
      itens: [
        { label: "Dashboard",     url: "/",            Icone: LayoutDashboard, testId: "link-dashboard" },
        { label: "Consulta ISP",  url: "/consulta-isp", Icone: ScanSearch,     testId: "link-consulta-isp" },
        { label: "Consulta Cadastral", url: "/consulta-cadastral", Icone: IdCard, testId: "link-consulta-cadastral" },
        { label: "Consulta SPC",  url: "/consulta-spc", Icone: BarChart3,      testId: "link-consulta-spc" },
        { label: "Anti-Fraude",   url: "/anti-fraude",  Icone: ShieldAlert,    testId: "link-anti-fraude" },
        // Antes chamava "Meus Dados" e apontava para /benchmark-regional (territorio).
        // O handoff Sidebar.md listava /meus-dados — rota do prototipo — e seguir
        // aquilo ao pe da letra repontou o item para a pagina de LGPD do titular,
        // deixando a de territorio orfa no menu. Nome e destino corrigidos aqui.
        { label: "Localização",   url: "/localizacao", Icone: MapPin,   testId: "link-localizacao" },
      ],
    },
    {
      grupo: "Financeiro",
      itens: [
        { label: "Comprar Créditos", url: "/creditos", Icone: CreditCard, testId: "link-creditos" },
        { label: "Notas Fiscais",    url: "/nfse",     Icone: FileText,   testId: "link-nfse" },
      ],
    },
    {
      // Equipamento perdido e prejuizo direto do provedor e entra no score da
      // rede: merece grupo proprio, nao um item solto dentro de Gestao.
      grupo: "Equipamentos",
      itens: [
        { label: "Equipamentos", url: "/equipamentos", Icone: Package, testId: "link-equipamentos" },
      ],
    },
    {
      grupo: "Gestão",
      itens: [
        { label: "Importação",         url: "/importacao",      Icone: Upload,    testId: "link-importacao" },
        { label: "Painel do Provedor", url: "/painel-provedor", Icone: Building2, testId: "link-painel-provedor" },
      ],
    },
    {
      grupo: "Configurações",
      itens: [
        { label: "Regionalização", url: "/configuracoes/regionalizacao", Icone: MapPin, testId: "link-regionalizacao" },
      ],
    },
  ];

  // Prefixo, nao igualdade: subrota mantem o pai aceso. "/" e caso especial,
  // senao ficaria ativo em todas as rotas.
  const estaAtivo = (url: string) =>
    url === "/" ? location === "/" : location === url || location.startsWith(url + "/");

  return (
    <Sidebar>
      <div className="flex flex-col h-full bg-[var(--surface)] border-r border-[var(--border)]">

        {/* Cabecalho */}
        <div className="flex items-center gap-[10px] px-4 pt-[18px] pb-[14px]">
          <Link href="/">
            <div className="flex items-center gap-[10px] cursor-pointer">
              {/* Glifo: arco de score com ponteiro — o artefato que um bureau entrega.
                  Substitui os picos de sinal, que diziam "provedor de internet" e nao
                  "bureau de credito". Ecoa o medidor de score da propria tela de consulta.
                  (Diverge do Sidebar.md, que pedia para nao redesenhar o path anterior.) */}
              {/* Fundo claro com o arco em berinjela: o score vira o unico elemento
                  colorido da marca, entao ele e que carrega o destaque.
                  --surface-2 em vez de branco puro porque a sidebar ja e branca —
                  um quadrado branco sumiria nela. A hairline fecha a forma. */}
              <div className="w-[34px] h-[34px] rounded-lg bg-[var(--surface-2)] border border-[var(--border)] grid place-items-center flex-none">
                <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3.5 16.5a8.5 8.5 0 0 1 17 0" stroke="var(--brand)" strokeWidth="2.1"
                        strokeLinecap="round" />
                  <path d="M12 16.5l4.4-4.4" stroke="var(--brand)" strokeWidth="2.1"
                        strokeLinecap="round" />
                </svg>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[14px] font-bold tracking-[-0.02em] text-[var(--text)] leading-tight">
                  Consulta ISP
                </span>
                <span className="text-[11px] text-[var(--text-muted)] leading-tight">
                  Análise de Crédito
                </span>
              </div>
            </div>
          </Link>
        </div>

        {/* Navegacao */}
        <nav className="flex-1 overflow-y-auto px-2 py-1 flex flex-col gap-[14px]">
          {NAV.map(({ grupo, itens }) => (
            <div key={grupo}>
              <div className="px-2 pt-1 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] uppercase text-[var(--text-faint)]">
                {grupo}
              </div>
              <div className="flex flex-col gap-0.5">
                {itens.map(({ label, url, Icone, testId }) => {
                  const ativo = estaAtivo(url);
                  return (
                    // Wouter 3 ja renderiza a propria <a>; embrulhar outra gerava
                    // <a><a>, HTML invalido que quebra a navegacao por teclado.
                    // As props vao direto no Link.
                    <Link
                      key={url}
                      href={url}
                      data-testid={testId}
                      aria-current={ativo ? "page" : undefined}
                      className={`flex items-center gap-[10px] px-2.5 py-2 rounded-lg text-[13.5px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand)] motion-safe:transition-colors ${
                        ativo
                          ? "bg-[var(--brand-soft)] text-[var(--brand-ink)] font-semibold"
                          : "text-[var(--text-2)] font-medium hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                      }`}
                    >
                      <Icone className="w-4 h-4 flex-none" strokeWidth={2} />
                      <span className="truncate">{label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Rodape */}
        <div className="border-t border-[var(--border)] px-4 py-[14px] flex flex-col gap-[10px]">
          <TrialBanner />

          <div className="flex items-center gap-[10px]">
            <div className="w-[30px] h-[30px] rounded-full bg-[var(--brand-soft)] text-[var(--brand-ink)] grid place-items-center text-[12px] font-bold flex-none">
              {user?.name?.charAt(0)?.toUpperCase() || "U"}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[13px] font-semibold text-[var(--text)] truncate">
                {user?.name}
              </span>
              <span className="text-[11px] text-[var(--text-muted)] truncate">
                {(provider as any)?.tradeName || provider?.name}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={logout}
            data-testid="button-logout"
            className="flex items-center gap-[10px] text-[13px] text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] motion-safe:transition-colors"
          >
            <LogOut className="w-4 h-4 flex-none" strokeWidth={2} />
            Sair
          </button>

          <a
            href="/lgpd"
            data-testid="link-lgpd"
            className="text-center text-[11px] text-[var(--text-faint)] hover:text-[var(--text-muted)] motion-safe:transition-colors"
          >
            Política de Privacidade · LGPD
          </a>
        </div>
      </div>
    </Sidebar>
  );
}
