import { useState, useEffect, lazy, Suspense } from "react";
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

// Financeiro
const NfsePage = lazy(() => import("@/pages/financeiro/nfse"));

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
        <Route path="/nfse" component={NfsePage} />
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
        <Route path="/benchmark-regional" component={BenchmarkRegionalPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

const PROVIDER_ONLY_PATHS = [
  "/", "/consulta-isp", "/consulta-spc", "/anti-fraude",
  "/inadimplentes", "/mapa-calor", "/creditos", "/nfse", "/importacao",
  "/importacao-equipamentos", "/administracao", "/painel-provedor",
  "/benchmark-regional",
];

function ChangePasswordModal() {
  const { mustChangePassword, clearMustChangePassword } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!mustChangePassword) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 6) { setError("Senha deve ter no minimo 6 caracteres"); return; }
    if (newPassword !== confirmPassword) { setError("Senhas nao conferem"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Erro ao alterar senha"); return; }
      clearMustChangePassword();
    } catch { setError("Erro de conexao"); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m9-7a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <h2 className="text-xl font-bold">Alterar Senha</h2>
          <p className="text-sm text-gray-500 mt-1">Por seguranca, altere sua senha antes de continuar.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950/20 rounded px-3 py-2">{error}</p>}
          <div>
            <label className="text-sm font-medium block mb-1">Nova Senha</label>
            <input type="password" className="w-full border rounded-lg px-3 py-2 text-sm" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoFocus minLength={6} required />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Confirmar Senha</label>
            <input type="password" className="w-full border rounded-lg px-3 py-2 text-sm" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={6} required />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg text-sm disabled:opacity-50">
            {loading ? "Alterando..." : "Alterar Senha"}
          </button>
        </form>
      </div>
    </div>
  );
}

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
          <header className="flex items-center h-12 px-3 border-b-[0.5px] border-[var(--color-border)] bg-[var(--color-surface)] sticky top-0 z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" aria-label="Abrir menu lateral" />
          </header>
          <main className="flex-1 overflow-auto bg-[var(--color-bg)]">
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
            <ChangePasswordModal />
            <AuthenticatedApp />
          </AuthProvider>
        </ErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
