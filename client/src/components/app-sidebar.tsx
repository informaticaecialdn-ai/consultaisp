import { useLocation, Link } from "wouter";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
  { title: "Administracao", url: "/administracao", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, provider, logout } = useAuth();
  const subdomain = (provider as any)?.subdomain;
  const planLabel = PLAN_LABELS[provider?.plan || "free"] || "Gratuito";
  const isPro = provider?.plan === "pro" || provider?.plan === "enterprise";

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
            Ferramentas
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {toolsMenu.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild data-active={location === item.url}>
                    <Link href={item.url}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-3">
        {subdomain && (
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 px-3 py-2">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <Globe className="w-3 h-3 text-blue-500 flex-shrink-0" />
                <span className="text-[11px] font-mono text-blue-700 dark:text-blue-300 truncate" data-testid="text-sidebar-subdomain">
                  {subdomain}.consultaisp.com.br
                </span>
              </div>
              <a
                href={`https://${subdomain}.consultaisp.com.br`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0"
                data-testid="link-subdomain-external"
              >
                <ExternalLink className="w-3 h-3 text-blue-400 hover:text-blue-600" />
              </a>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              {isPro ? (
                <Crown className="w-3 h-3 text-amber-500" />
              ) : null}
              <span className="text-[10px] text-muted-foreground">Plano {planLabel}</span>
              <Badge className="text-[9px] px-1 h-4 ml-auto bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                {planLabel}
              </Badge>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300">
            {user?.name?.charAt(0)?.toUpperCase() || "U"}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-medium truncate">{user?.name}</span>
            <span className="text-[11px] text-muted-foreground truncate">{provider?.name}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={logout}
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4" />
          Sair
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
