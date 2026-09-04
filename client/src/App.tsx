import { useState, useEffect, lazy, Suspense } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ErrorBoundary } from "@/components/error-boundary";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import ThemeToggle from "@/components/theme-toggle";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatWidget } from "@/components/chat-widget";
import { FaixaSuporte, useSessaoDeSuporte } from "@/components/FaixaSuporte";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarca } from "@/lib/marca";

// Auth
const LoginPage = lazy(() => import("@/pages/auth/login"));
const VerificarEmailPage = lazy(() => import("@/pages/auth/verificar-email"));

// Consulta
const ConsultaISPPage = lazy(() => import("@/pages/consulta/consulta-isp"));
const ConsultaCadastralPage = lazy(() => import("@/pages/consulta/consulta-cadastral"));
const ConsultaSPCPage = lazy(() => import("@/pages/consulta/consulta-spc"));
const AntiFraudePage = lazy(() => import("@/pages/consulta/anti-fraude"));

// Operacional
const InadimplentesPage = lazy(() => import("@/pages/operacional/inadimplentes"));
const LocalizacaoPage = lazy(() => import("@/pages/operacional/localizacao"));
const ImportacaoPage = lazy(() => import("@/pages/operacional/importacao"));
const EquipamentosPage = lazy(() => import("@/pages/operacional/equipamentos"));
const RecuperacaoPage = lazy(() => import("@/pages/operacional/recuperacao"));

// Financeiro
const NfsePage = lazy(() => import("@/pages/financeiro/nfse"));

// Admin
const AdminSistemaPage = lazy(() => import("@/pages/admin/admin-sistema"));
const AdminProvedorPage = lazy(() => import("@/pages/admin/admin-provedor"));
const AdminFinanceiroPage = lazy(() => import("@/pages/admin/admin-financeiro"));
const AdminCreditosPage = lazy(() => import("@/pages/admin/admin-creditos"));
const AdminLgpdPage = lazy(() => import("@/pages/admin/admin-lgpd"));
const AdminMarcasPage = lazy(() => import("@/pages/admin/admin-marcas"));

// Provedor
const DashboardPage = lazy(() => import("@/pages/provedor/dashboard"));
const PainelProvedorPage = lazy(() => import("@/pages/provedor/painel-provedor"));
const AdministracaoPage = lazy(() => import("@/pages/provedor/administracao"));
const CreditosPage = lazy(() => import("@/pages/provedor/creditos"));
const ConfiguracoesRegionalizacaoPage = lazy(() => import("@/pages/provedor/configuracoes-regionalizacao"));

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
        <Route path="/consulta-cadastral" component={ConsultaCadastralPage} />
        <Route path="/consulta-spc" component={ConsultaSPCPage} />
        <Route path="/anti-fraude" component={AntiFraudePage} />
        <Route path="/inadimplentes" component={InadimplentesPage} />
        {/* Consolidadas em /localizacao. Redirect preserva link salvo. */}
        <Route path="/mapa-calor"><Redirect to="/localizacao" /></Route>
        <Route path="/localizacao" component={LocalizacaoPage} />
        <Route path="/creditos" component={CreditosPage} />
        <Route path="/nfse" component={NfsePage} />
        <Route path="/importacao" component={ImportacaoPage} />
        <Route path="/importacao-equipamentos"><Redirect to="/equipamentos?importar=1" /></Route>
        <Route path="/equipamentos" component={EquipamentosPage} />
        <Route path="/recuperacao" component={RecuperacaoPage} />
        <Route path="/administracao" component={AdministracaoPage} />
        <Route path="/painel-provedor" component={PainelProvedorPage} />
        <Route path="/admin-sistema" component={AdminSistemaPage} />
        <Route path="/admin/provedor/:id" component={AdminProvedorPage} />
        <Route path="/admin/fatura/:id" component={InvoiceViewPage} />
        <Route path="/admin/financeiro" component={AdminFinanceiroPage} />
        <Route path="/admin/creditos" component={AdminCreditosPage} />
        <Route path="/admin/lgpd" component={AdminLgpdPage} />
        <Route path="/admin/marcas" component={AdminMarcasPage} />
        <Route path="/lgpd" component={LgpdPage} />
        <Route path="/configuracoes/regionalizacao" component={ConfiguracoesRegionalizacaoPage} />
        <Route path="/benchmark-regional"><Redirect to="/localizacao" /></Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

const PROVIDER_ONLY_PATHS = [
  "/", "/consulta-isp", "/consulta-cadastral", "/consulta-spc", "/anti-fraude",
  "/inadimplentes", "/mapa-calor", "/localizacao", "/creditos", "/nfse", "/importacao",
  "/importacao-equipamentos", "/equipamentos", "/recuperacao", "/administracao", "/painel-provedor",
  "/benchmark-regional",
];

/**
 * O espelho: as telas da PLATAFORMA, que listam dado de OUTROS provedores.
 *
 * Durante a personificacao elas saem da barra lateral, mas sumir do menu nao e
 * o mesmo que ficar inalcancavel — o endereco digitado a mao continuava
 * montando a tela. A recusa que vale e a do servidor (`requireSuperAdmin`
 * responde 403 na janela de suporte); esta lista existe para o suporte ver a
 * conta do provedor em vez de uma tela de erro atras da outra.
 *
 * `/admin/provedor/:id` nao esta aqui porque a lista compara caminho exato.
 * A tela dele ja recusa sozinha: e ela quem chama `GET .../:id/detail`, e a
 * resposta agora e 403.
 */
const PLATFORM_ONLY_PATHS = [
  "/admin-sistema", "/admin/financeiro", "/admin/creditos", "/admin/marcas", "/admin/lgpd",
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
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-[0_0_0_1px_var(--ring-warm),0_24px_48px_rgba(20,20,19,0.05)] max-w-md w-full p-6 space-y-4">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-[var(--color-gold-bg)]/30 flex items-center justify-center mx-auto mb-3">
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
          <button type="submit" disabled={loading} className="w-full bg-[var(--color-brand)] hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg text-sm disabled:opacity-50">
            {loading ? "Alterando..." : "Alterar Senha"}
          </button>
        </form>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const marca = useMarca();
  const { user, isLoading } = useAuth();
  const { sessao: sessaoDeSuporte, carregando: carregandoSuporte } = useSessaoDeSuporte();
  const [location, navigate] = useLocation();

  /**
   * As telas de provedor são o DESTINO de uma sessão de suporte, não um desvio.
   *
   * A regra abaixo expulsa superadmin de tudo que é do provedor, e é o que
   * mantém os dois painéis separados no dia a dia. Com uma liberação aberta ela
   * se inverte: o superadmin está ali justamente para operar a conta, e o desvio
   * para /admin-sistema tornaria a funcionalidade inteira inalcançável.
   *
   * Enquanto a resposta não chega ninguém é redirecionado (`carregandoSuporte`).
   * Expulsar primeiro e descobrir depois faria todo link de suporte cair em
   * /admin-sistema antes de a primeira requisição terminar.
   */
  const superadminSemSuporte =
    user?.role === "superadmin" && !carregandoSuporte && !sessaoDeSuporte;

  useEffect(() => {
    if (isLoading) return;

    if (user && location === "/login") {
      navigate(user.role === "superadmin" ? "/admin-sistema" : "/", { replace: true });
      return;
    }

    if (superadminSemSuporte && PROVIDER_ONLY_PATHS.includes(location)) {
      navigate("/admin-sistema", { replace: true });
      return;
    }

    // O sentido inverso: dentro da janela, as telas da plataforma nao sao dele.
    // O destino e "/" — o painel do provedor em que ele esta — e nao a tela de
    // login ou um erro: ele tem sessao, tem papel, e o que falta e so sair da
    // personificacao, o que a faixa vermelha oferece o tempo todo.
    if (sessaoDeSuporte && PLATFORM_ONLY_PATHS.includes(location)) {
      navigate("/", { replace: true });
    }
  }, [user, isLoading, superadminSemSuporte, sessaoDeSuporte, location, navigate]);

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
    /**
     * A política de privacidade é PÚBLICA, em qualquer host.
     *
     * `/lgpd` só existia dentro de `<Router/>`, que exige sessão: sem login ela
     * caía na landing (host da plataforma) ou na tela de login (host de tenant).
     * Quem mais precisa dessa página é justamente quem NÃO tem conta — o titular
     * que quer saber quem trata os dados dele, e a quem a LGPD garante essa
     * informação. `GET /api/public/lgpd-info` já é público e já resolve a marca
     * pelo host, então em domínio de revendedor a página nomeia o controlador
     * certo sozinha.
     */
    if (location === "/lgpd") {
      return <Suspense fallback={<PageLoader />}><LgpdPage /></Suspense>;
    }

    // Quem decide é o SERVIDOR, não o subdomínio.
    //
    // A regra antiga era `getSubdomain() ? login : landing`. Num domínio
    // próprio de revendedor (app.crednet.com.br) isso dá null, e o cliente dele
    // cairia na landing do Consulta ISP — a marca de outra empresa, na porta de
    // entrada dele. O servidor resolve a marca pelo host e diz em qual dos dois
    // contextos estamos (client/src/lib/marca.ts).
    if (marca.contexto === "tenant") {
      return <Suspense fallback={<PageLoader />}><LoginPage /></Suspense>;
    }
    return <Suspense fallback={<PageLoader />}><LandingPage /></Suspense>;
  }

  // Sem sessão de suporte — inclusive enquanto ela ainda não é conhecida — a tela
  // de provedor não chega a montar: o efeito acima já está redirecionando, e
  // pintar a página do provedor por um quadro mostraria dado de outro tenant a
  // quem talvez não tenha autorização nenhuma.
  // O espelho, pelo mesmo motivo: o desvio acima e um efeito, e um efeito roda
  // DEPOIS da pintura. Sem esta guarda, /admin-sistema digitado a mao dentro da
  // janela de suporte mostraria a lista de todos os provedores por um quadro
  // antes de o desvio levar embora — um quadro basta para ler a tela e para o
  // navegador guardar a resposta.
  //
  // O 403 do servidor ja esvazia os dados; isto evita o esqueleto da tela
  // errada. As duas defesas sao de camadas diferentes de proposito.
  if (sessaoDeSuporte && PLATFORM_ONLY_PATHS.includes(location)) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <FaixaSuporte />
        <div className="flex-1 flex items-center justify-center">
          <div className="space-y-4 w-64">
            <Skeleton className="h-8 w-48 mx-auto" />
            <Skeleton className="h-4 w-32 mx-auto" />
            <Skeleton className="h-2 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (user.role === "superadmin" && !sessaoDeSuporte && PROVIDER_ONLY_PATHS.includes(location)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        {/* Este é o caminho por onde a sessão de suporte MORRE: no segundo em que
            a liberação cai, esta guarda passa a valer e o shell inteiro some.
            Sem a faixa montada aqui também, o aviso de encerramento seria
            desmontado justamente no instante em que precisa aparecer, e o
            suporte veria apenas a tela trocar sozinha. */}
        <FaixaSuporte />
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
          <Skeleton className="h-2 w-full" />
        </div>
      </div>
    );
  }

  const style = {
    "--sidebar-width": "248px",   /* handoff Sidebar.md */
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full" data-module="consulta">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          {/**
           * A faixa é a PRIMEIRA linha da coluna de conteúdo, acima do cabeçalho.
           *
           * O lugar não é estético, é estrutural. A barra lateral do shadcn é
           * `fixed inset-y-0 h-svh` — colada no topo da janela e independente
           * desta coluna. Uma faixa de largura total, acima de tudo, seria
           * pintada por cima dos 40px superiores da barra lateral (a marca e o
           * botão de recolher) ou exigiria empurrar um elemento `fixed` que não
           * é nosso. Aqui ela ocupa a largura inteira do conteúdo, empurra
           * cabeçalho e <main> para baixo em fluxo normal — o <main> é
           * `flex-1 overflow-auto` e recalcula a própria altura sozinho — e não
           * cobre coisa nenhuma: nem a lateral, nem o cabeçalho, nem a rolagem.
           * No celular a lateral é gaveta (largura zero) e a faixa ocupa a tela
           * inteira de qualquer forma.
           */}
          <FaixaSuporte />
          <header className="flex items-center h-12 px-3 border-b border-[var(--border)] bg-[var(--surface)] sticky top-0 z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" aria-label="Abrir menu lateral" />
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
            </div>
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
