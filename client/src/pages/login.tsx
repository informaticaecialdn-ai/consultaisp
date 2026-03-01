import { useState, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Shield,
  Users,
  Search,
  AlertTriangle,
  CheckCircle,
  Lock,
  Mail,
  Eye,
  EyeOff,
  MailCheck,
  RefreshCw,
  ArrowRight,
  Database,
  TrendingDown,
  Zap,
  ChevronDown,
} from "lucide-react";

type PageState = "login" | "register" | "check-email";

const steps = [
  {
    num: "01",
    title: "Cadastre seu provedor",
    desc: "Crie sua conta gratuitamente com email, nome e CNPJ do seu provedor de internet.",
  },
  {
    num: "02",
    title: "Consulte CPF ou CNPJ",
    desc: "Digite o documento do cliente antes de fechar qualquer contrato de servico.",
  },
  {
    num: "03",
    title: "Receba o Score ISP",
    desc: "Obtenha uma pontuacao de 0 a 100 com historico completo de inadimplencias.",
  },
  {
    num: "04",
    title: "Tome a melhor decisao",
    desc: "Aprove, exija garantias ou rejeite contratos com seguranca e embasamento.",
  },
];

const features = [
  "Base colaborativa compartilhada entre provedores do setor",
  "Consulta de historico de inadimplencia por CPF ou CNPJ",
  "Integracao com SPC Brasil para analise completa de credito",
  "Sistema anti-fraude com deteccao automatica de risco",
  "Mapa de calor geografico dos inadimplentes da sua regiao",
  "Score ISP com penalidades e bonus calculados em tempo real",
];

export default function LoginPage() {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const [pageState, setPageState] = useState<PageState>("login");
  const [isLoading, setIsLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    providerName: "",
    cnpj: "",
  });

  const formRef = useRef<HTMLDivElement>(null);

  const scrollToForm = (mode: "login" | "register") => {
    setPageState(mode);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (pageState === "register") {
        const result = await register(form);
        if (result.needsVerification) {
          setPendingEmail(result.email);
          setPageState("check-email");
        }
      } else {
        await login(form.email, form.password);
      }
    } catch (err: any) {
      if (err.code === "EMAIL_NOT_VERIFIED") {
        setPendingEmail(err.email || form.email);
        setPageState("check-email");
        return;
      }
      toast({
        title: "Erro",
        description: err.message || "Erro ao fazer login",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setResendLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/resend-verification", { email: pendingEmail });
      const data = await res.json();
      toast({
        title: "Email enviado",
        description: data.message || "Novo link de verificacao enviado com sucesso.",
      });
    } catch {
      toast({
        title: "Erro",
        description: "Nao foi possivel reenviar o email. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950" data-testid="login-page">

      {/* ── HEADER ── */}
      <header className="sticky top-0 z-50 bg-white/90 dark:bg-gray-950/90 backdrop-blur border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight">Consulta ISP</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              onClick={() => scrollToForm("login")}
              data-testid="button-header-login"
            >
              Entrar
            </button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm"
              onClick={() => scrollToForm("register")}
              data-testid="button-header-register"
            >
              Cadastre-se
            </Button>
          </div>
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          SPC do setor de telecom
        </div>

        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 dark:text-white leading-tight mb-5">
          Consulte antes de contratar.<br />
          <span className="text-blue-600">Proteja seu provedor.</span>
        </h1>

        <p className="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Base colaborativa de inadimplentes compartilhada entre provedores de internet.
          Consulte o historico de qualquer CPF ou CNPJ antes de liberar um contrato.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            size="lg"
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2 text-base px-8"
            onClick={() => scrollToForm("register")}
            data-testid="button-hero-register"
          >
            Cadastre seu provedor gratis
            <ArrowRight className="w-4 h-4" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="gap-2 text-base px-8 border-gray-200 dark:border-gray-700"
            onClick={() => scrollToForm("login")}
            data-testid="button-hero-login"
          >
            Ja tenho conta
          </Button>
        </div>

        <button
          className="mt-14 flex flex-col items-center gap-1 mx-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          onClick={() => document.getElementById("stats")?.scrollIntoView({ behavior: "smooth" })}
        >
          <span className="text-xs">Saiba mais</span>
          <ChevronDown className="w-4 h-4 animate-bounce" />
        </button>
      </section>

      {/* ── STATS ── */}
      <section id="stats" className="border-y border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
        <div className="max-w-5xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { icon: Users, value: "100+", label: "Provedores ativos", color: "text-blue-600" },
            { icon: Database, value: "1 base", label: "Compartilhada e colaborativa", color: "text-indigo-600" },
            { icon: TrendingDown, value: "Score", label: "0 a 100 por CPF/CNPJ", color: "text-violet-600" },
            { icon: AlertTriangle, value: "Anti-fraude", label: "Alertas automaticos em tempo real", color: "text-rose-500" },
          ].map(({ icon: Icon, value, label, color }) => (
            <div key={label} className="flex flex-col items-center gap-2">
              <Icon className={`w-6 h-6 ${color} mb-1`} />
              <span className="text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight">{value}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400 leading-tight">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Como funciona</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Em 4 passos simples, seu provedor esta protegido</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {steps.map((step) => (
            <div key={step.num} className="flex gap-4 p-5 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-blue-100 dark:hover:border-blue-900 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 transition-all">
              <span className="text-2xl font-black text-blue-200 dark:text-blue-900 w-10 flex-shrink-0 leading-none pt-0.5">
                {step.num}
              </span>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1">{step.title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <div className="grid md:grid-cols-2 gap-x-16 gap-y-4 items-start">
            <div className="md:pr-8">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
                Tudo que seu provedor precisa para proteger a receita
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">
                O Consulta ISP e o SPC do setor de telecomunicacoes. Compartilhe dados de inadimplentes e consulte a base de outros provedores antes de liberar novos contratos.
              </p>
            </div>
            <ul className="space-y-3">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-3">
                  <CheckCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-gray-600 dark:text-gray-300">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── FORM SECTION ── */}
      <section className="max-w-5xl mx-auto px-6 py-20" ref={formRef}>
        <div className="max-w-md mx-auto">

          {pageState === "check-email" ? (
            <Card className="p-8 border-gray-100 dark:border-gray-800 shadow-sm" data-testid="check-email-card">
              <div className="text-center mb-6">
                <div className="w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center mx-auto mb-4">
                  <MailCheck className="w-7 h-7 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold mb-1" data-testid="text-check-email-title">
                  Verifique seu email
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Enviamos um link de confirmacao para
                </p>
                <p className="font-semibold text-sm mt-0.5" data-testid="text-pending-email">{pendingEmail}</p>
              </div>

              <div className="space-y-2 mb-6">
                {[
                  "Abra seu email e procure a mensagem do Consulta ISP",
                  "Clique no botao \"Confirmar Email\"",
                  "Voce sera redirecionado automaticamente",
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-semibold">
                      {i + 1}
                    </span>
                    <span className="text-sm text-gray-600 dark:text-gray-400">{step}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-3 text-center">
                <p className="text-xs text-gray-400">Nao recebeu o email?</p>
                <Button
                  variant="outline"
                  className="w-full gap-2 border-gray-200 dark:border-gray-700"
                  onClick={handleResend}
                  disabled={resendLoading}
                  data-testid="button-resend-email"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${resendLoading ? "animate-spin" : ""}`} />
                  {resendLoading ? "Enviando..." : "Reenviar link de verificacao"}
                </Button>
                <button
                  type="button"
                  className="text-sm text-blue-600 font-medium"
                  onClick={() => setPageState("login")}
                  data-testid="button-back-to-login"
                >
                  Voltar ao login
                </button>
              </div>
            </Card>

          ) : (
            <>
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1" data-testid="text-login-title">
                  {pageState === "register" ? "Crie sua conta" : "Bem-vindo de volta"}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {pageState === "register"
                    ? "Cadastre seu provedor para acessar a base colaborativa"
                    : "Faca login para acessar o painel"}
                </p>
              </div>

              <Card className="p-7 border-gray-100 dark:border-gray-800 shadow-sm">
                <form onSubmit={handleSubmit} className="space-y-4">
                  {pageState === "register" && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                          Nome completo
                        </label>
                        <Input
                          data-testid="input-name"
                          placeholder="Seu nome completo"
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          className="border-gray-200 dark:border-gray-700 h-10"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                          Nome do provedor
                        </label>
                        <Input
                          data-testid="input-provider-name"
                          placeholder="Nome do seu provedor de internet"
                          value={form.providerName}
                          onChange={(e) => setForm({ ...form, providerName: e.target.value })}
                          className="border-gray-200 dark:border-gray-700 h-10"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                          CNPJ
                        </label>
                        <Input
                          data-testid="input-cnpj"
                          placeholder="00.000.000/0000-00"
                          value={form.cnpj}
                          onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                          className="border-gray-200 dark:border-gray-700 h-10"
                          required
                        />
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Email
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        data-testid="input-email"
                        type="email"
                        placeholder="seu@provedor.com.br"
                        className="pl-9 border-gray-200 dark:border-gray-700 h-10"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Senha</label>
                      {pageState === "login" && (
                        <button type="button" className="text-xs text-blue-600 hover:underline">
                          Esqueceu a senha?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        data-testid="input-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Minimo 6 caracteres"
                        className="pl-9 pr-10 border-gray-200 dark:border-gray-700 h-10"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        required
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        onClick={() => setShowPassword(!showPassword)}
                        data-testid="button-toggle-password"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white h-10 mt-1"
                    disabled={isLoading}
                    data-testid="button-submit-login"
                  >
                    {isLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Zap className="w-4 h-4 mr-2" />
                    )}
                    {isLoading ? "Aguarde..." : pageState === "register" ? "Criar conta" : "Entrar"}
                  </Button>
                </form>

                <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800 text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {pageState === "register" ? "Ja tem uma conta?" : "Ainda nao tem uma conta?"}{" "}
                    <button
                      type="button"
                      className="text-blue-600 font-semibold hover:underline"
                      onClick={() => setPageState(pageState === "register" ? "login" : "register")}
                      data-testid="button-toggle-register"
                    >
                      {pageState === "register" ? "Faca login" : "Cadastre-se"}
                    </button>
                  </p>
                </div>
              </Card>

              <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-400">
                <Lock className="w-3 h-3" />
                <span>Conexao segura e criptografada</span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-gray-100 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
              <Shield className="w-3 h-3 text-white" />
            </div>
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Consulta ISP</span>
          </div>
          <p className="text-xs text-gray-400">
            2026 ISP Analizze - Plataforma de analise de credito para provedores de internet
          </p>
        </div>
      </footer>
    </div>
  );
}
