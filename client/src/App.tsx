import { useEffect, lazy, Suspense } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ErrorBoundary } from "@/components/error-boundary";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatWidget } from "@/components/chat-widget";
import { Skeleton } from "@/components/ui/skeleton";
import { getSubdomain } from "@/lib/subdomain";

// Auth
const LoginPage = lazy(() => import("@/pages/auth/login"));
const VerificarEmailPage = lazy(() => import("@/pages/auth/verificar-email"));

// Consulta
const ConsultaISPPage = lazy(() => import("@/pages/consulta/consulta-isp"));
const ConsultaSPCPage = lazy(() => import("@/pages/consulta/consulta-spc"));
const AntiFraudePage = lazy(() => import("@/pages/consulta/anti-fraude"));

// Operacional
const InadimplentesPage = lazy(() => import("@/pages/operacional/inadimplentes"));
const MapaCalorPage = lazy(() => import("@/pages/operacional/mapa-calor"));
const ImportacaoPage = lazy(() => import("@/pages/operacional/importacao"));
const ImportacaoEquipamentosPage = lazy(() => import("@/pages/operacional/importacao-equipamentos"));

// Admin
const AdminSistemaPage = lazy(() => import("@/pages/admin/admin-sistema"));
const AdminProvedorPage = lazy(() => import("@/pages/admin/admin-provedor"));
const AdminFinanceiroPage = lazy(() => import("@/pages/admin/admin-financeiro"));
const AdminCreditosPage = lazy(() => import("@/pages/admin/admin-creditos"));
const AdminLgpdPage = lazy(() => import("@/pages/admin/admin-lgpd"));

// Provedor
const DashboardPage = lazy(() => import("@/pages/provedor/dashboard"));
const PainelProvedorPage = lazy(() => import("@/pages/provedor/painel-provedor"));
const AdministracaoPage = lazy(() => import("@/pages/provedor/administracao"));
const CreditosPage = lazy(() => import("@/pages/provedor/creditos"));
const ConfiguracoesRegionalizacaoPage = lazy(() => import("@/pages/provedor/configuracoes-regionalizacao"));
const ConfiguracoesAlertasPage = lazy(() => import("@/pages/provedor/configuracoes-alertas"));
const BenchmarkRegionalPage = lazy(() => import("@/pages/provedor/benchmark-regional"));

// Public
const LandingPage = lazy(() => import("@/pages/public/landingpage"));
const LgpdPage = lazy(() => import("@/pages/public/lgpd"));
const MeusDadosPage = lazy(() => import("@/pages/public/meus-dados"));
const InvoiceViewPage = lazy(() => import("@/pages/public/invoice-view"));
const NotFound = lazy(() => import("@/pages/public/not-found"));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="space-y-4 w-64">
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto" />
        <Skeleton className="h-2 w-full" />
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/consulta-isp" component={ConsultaISPPage} />
        <Route path="/consulta-spc" component={ConsultaSPCPage} />
        <Route path="/anti-fraude" component={AntiFraudePage} />
        <Route path="/inadimplentes" component={InadimplentesPage} />
        <Route path="/mapa-calor" component={MapaCalorPage} />
        <Route path="/creditos" component={CreditosPage} />
        <Route path="/importacao" component={ImportacaoPage} />
        <Route path="/importacao-equipamentos" component={ImportacaoEquipamentosPage} />
        <Route path="/administracao" component={AdministracaoPage} />
        <Route path="/painel-provedor" component={PainelProvedorPage} />
        <Route path="/admin-sistema" component={AdminSistemaPage} />
        <Route path="/admin/provedor/:id" component={AdminProvedorPage} />
        <Route path="/admin/fatura/:id" component={InvoiceViewPage} />
        <Route path="/admin/financeiro" component={AdminFinanceiroPage} />
        <Route path="/admin/creditos" component={AdminCreditosPage} />
        <Route path="/admin/lgpd" component={AdminLgpdPage} />
        <Route path="/lgpd" component={LgpdPage} />
        <Route path="/configuracoes/regionalizacao" component={ConfiguracoesRegionalizacaoPage} />
        <Route path="/configuracoes-alertas" component={ConfiguracoesAlertasPage} />
        <Route path="/benchmark-regional" component={BenchmarkRegionalPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

const PROVIDER_ONLY_PATHS = [
  "/", "/consulta-isp", "/consulta-spc", "/anti-fraude",
  "/inadimplentes", "/mapa-calor", "/creditos", "/importacao",
  "/importacao-equipamentos", "/administracao", "/painel-provedor",
  "/benchmark-regional", "/configuracoes-alertas",
];

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (isLoading) return;

    if (user && location === "/login") {
      navigate(user.role === "superadmin" ? "/admin-sistema" : "/", { replace: true });
      return;
    }

    if (user && user.role === "superadmin" && PROVIDER_ONLY_PATHS.includes(location)) {
      navigate("/admin-sistema", { replace: true });
    }
  }, [user, isLoading, location, navigate]);

  if (location === "/meus-dados") {
    return <Suspense fallback={<PageLoader />}><MeusDadosPage /></Suspense>;
  }

  if (location === "/verificar-email") {
    return <Suspense fallback={<PageLoader />}><VerificarEmailPage /></Suspense>;
  }

  if (location === "/login") {
    if (isLoading || user) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="space-y-4 w-64">
            <Skeleton className="h-8 w-48 mx-auto" />
            <Skeleton className="h-4 w-32 mx-auto" />
            <Skeleton className="h-2 w-full" />
          </div>
        </div>
      );
    }
    return <Suspense fallback={<PageLoader />}><LoginPage /></Suspense>;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
          <Skeleton className="h-2 w-full" />
        </div>
      </div>
    );
  }

  if (!user) {
    const subdomain = getSubdomain();
    if (subdomain) {
      return <Suspense fallback={<PageLoader />}><LoginPage /></Suspense>;
    }
    return <Suspense fallback={<PageLoader />}><LandingPage /></Suspense>;
  }

  if (user.role === "superadmin" && PROVIDER_ONLY_PATHS.includes(location)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
          <Skeleton className="h-2 w-full" />
        </div>
      </div>
    );
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center gap-2 p-3 border-b bg-background/95 backdrop-blur-sm sticky top-0 z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </header>
          <main className="flex-1 overflow-auto bg-background">
            <Router />
          </main>
          <ChatWidget />
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ErrorBoundary>
          <AuthProvider>
            <AuthenticatedApp />
          </AuthProvider>
        </ErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
