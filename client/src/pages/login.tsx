import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Shield,
  Lock,
  Mail,
  Eye,
  EyeOff,
  MailCheck,
  RefreshCw,
  ArrowRight,
  Users,
  Search,
  AlertTriangle,
  Database,
  UserPlus,
  CheckCircle,
} from "lucide-react";

type PageState = "login" | "register" | "check-email";

const STATS = [
  { value: "100+", label: "Provedores Ativos" },
  { value: "3", label: "Tipos de Consulta" },
  { value: "R$ 50K+", label: "Inadimplencias Bloqueadas" },
];

const HOW_IT_WORKS = [
  {
    icon: UserPlus,
    title: "Cadastre-se",
    desc: "Crie sua conta com email e os dados do seu provedor de internet.",
  },
  {
    icon: Search,
    title: "Consulte CPF/CNPJ",
    desc: "Busque na base colaborativa de inadimplentes antes de assinar contratos.",
  },
  {
    icon: CheckCircle,
    title: "Analise o Score",
    desc: "Veja pontuacao detalhada, penalidades e recomendacao de aprovacao.",
  },
  {
    icon: Database,
    title: "Proteja a Rede",
    desc: "Compartilhe dados e ajude toda a comunidade de provedores.",
  },
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
      toast({ title: "Email enviado", description: data.message });
    } catch {
      toast({ title: "Erro", description: "Nao foi possivel reenviar o email.", variant: "destructive" });
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #312e81 70%, #4c1d95 100%)" }}
      data-testid="login-page"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.15) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.12) 0%, transparent 50%)",
        }}
      />

      <div className="relative z-10 flex-1 flex flex-col justify-between p-8 lg:p-12 xl:p-16 lg:max-w-[58%]">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center backdrop-blur-sm">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="text-white font-bold text-lg tracking-tight">Consulta ISP</span>
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-2xl">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-300" />
              <span className="text-white/90 text-sm font-medium">Base Colaborativa de Inadimplentes</span>
            </div>
          </div>

          <h1 className="text-5xl xl:text-6xl font-extrabold leading-tight mb-5 text-white tracking-tight">
            Consulte antes,{" "}
            <span style={{ color: "#fbbf24" }}>proteja<br />seu provedor</span>
          </h1>

          <p className="text-white/60 text-lg mb-10 max-w-lg leading-relaxed">
            Acesse a base colaborativa de clientes inadimplentes de provedores. Consulte o historico antes de liberar novos contratos e evite prejuizos.
          </p>

          <div className="grid grid-cols-3 gap-3 mb-10">
            {STATS.map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-white/15 backdrop-blur-sm p-4"
                style={{ background: "rgba(255,255,255,0.07)" }}
              >
                <p className="text-white font-bold text-2xl mb-0.5" data-testid={`stat-${stat.label.toLowerCase().replace(/\s/g, "-")}`}>
                  {stat.value}
                </p>
                <p className="text-white/50 text-xs">{stat.label}</p>
              </div>
            ))}
          </div>

          <div className="mb-4">
            <p className="text-white/40 text-xs font-semibold tracking-widest uppercase mb-3">Como funciona</p>
            <div className="grid grid-cols-2 gap-3">
              {HOW_IT_WORKS.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="rounded-xl border border-white/10 p-4 backdrop-blur-sm"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-indigo-500/30 flex items-center justify-center">
                      <Icon className="w-3.5 h-3.5 text-indigo-300" />
                    </div>
                    <span className="text-white font-semibold text-sm">{title}</span>
                  </div>
                  <p className="text-white/45 text-xs leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          <button className="text-indigo-300 text-sm font-medium flex items-center gap-1 mt-3 hover:text-indigo-200 transition-colors w-fit">
            Ver todos os recursos
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <p className="text-white/25 text-xs mt-10">
          2025 Consulta ISP - Plataforma de Analise de Credito para Provedores
        </p>
      </div>

      <div className="relative z-10 flex items-center justify-center p-6 lg:p-8 lg:w-[42%] xl:w-[38%]">
        <div className="w-full max-w-sm">

          {pageState === "check-email" ? (
            <div
              className="rounded-2xl p-8 shadow-2xl"
              style={{ background: "#ffffff" }}
              data-testid="check-email-card"
            >
              <div className="text-center mb-6">
                <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center mx-auto mb-4">
                  <MailCheck className="w-7 h-7 text-indigo-600" />
                </div>
                <h2 className="text-gray-900 text-xl font-bold mb-1" data-testid="text-check-email-title">
                  Verifique seu email
                </h2>
                <p className="text-gray-500 text-sm">
                  Enviamos um link de confirmacao para
                </p>
                <p className="text-gray-800 font-semibold text-sm mt-1" data-testid="text-pending-email">
                  {pendingEmail}
                </p>
              </div>

              <div className="bg-indigo-50 rounded-xl p-4 mb-5 space-y-2.5">
                {[
                  "Abra seu email e procure a mensagem do Consulta ISP",
                  "Clique em \"Confirmar Email\"",
                  "Voce sera redirecionado automaticamente",
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-semibold">
                      {i + 1}
                    </span>
                    <span className="text-gray-600 text-sm">{step}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-3 text-center">
                <p className="text-gray-400 text-xs">Nao recebeu o email?</p>
                <button
                  onClick={handleResend}
                  disabled={resendLoading}
                  className="w-full border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  data-testid="button-resend-email"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${resendLoading ? "animate-spin" : ""}`} />
                  {resendLoading ? "Enviando..." : "Reenviar link de verificacao"}
                </button>
                <button
                  onClick={() => setPageState("login")}
                  className="text-indigo-600 text-sm font-medium hover:underline"
                  data-testid="button-back-to-login"
                >
                  Voltar ao login
                </button>
              </div>
            </div>
          ) : (
            <div
              className="rounded-2xl p-8 shadow-2xl"
              style={{ background: "#ffffff" }}
            >
              <div className="text-center mb-6">
                <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-6 h-6 text-indigo-600" />
                </div>
                <h2 className="text-gray-900 text-xl font-bold mb-0.5" data-testid="text-login-title">
                  {pageState === "register" ? "Crie sua conta" : "Bem-vindo de volta"}
                </h2>
                <p className="text-gray-400 text-sm">
                  {pageState === "register"
                    ? "Cadastre seu provedor e comece a consultar"
                    : "Faca login para acessar o painel"}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {pageState === "register" && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                        Nome
                      </label>
                      <Input
                        data-testid="input-name"
                        placeholder="Seu nome completo"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="border-gray-200 bg-gray-50 focus:bg-white rounded-xl h-11 text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                        Nome do Provedor
                      </label>
                      <Input
                        data-testid="input-provider-name"
                        placeholder="Nome do seu provedor"
                        value={form.providerName}
                        onChange={(e) => setForm({ ...form, providerName: e.target.value })}
                        className="border-gray-200 bg-gray-50 focus:bg-white rounded-xl h-11 text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                        CNPJ
                      </label>
                      <Input
                        data-testid="input-cnpj"
                        placeholder="00.000.000/0000-00"
                        value={form.cnpj}
                        onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                        className="border-gray-200 bg-gray-50 focus:bg-white rounded-xl h-11 text-sm"
                        required
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      data-testid="input-email"
                      type="email"
                      placeholder="seu@email.com"
                      className="pl-10 border-gray-200 bg-gray-50 focus:bg-white rounded-xl h-11 text-sm"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Senha
                    </label>
                    {pageState === "login" && (
                      <button type="button" className="text-xs text-indigo-600 font-medium hover:underline">
                        Esqueceu a senha?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      data-testid="input-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      className="pl-10 pr-10 border-gray-200 bg-gray-50 focus:bg-white rounded-xl h-11 text-sm"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      onClick={() => setShowPassword(!showPassword)}
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 rounded-xl h-11 font-semibold text-white text-sm transition-all disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
                  data-testid="button-submit-login"
                >
                  {isLoading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      {pageState === "register" ? "Cadastrar" : "Entrar"}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-5 text-center">
                <p className="text-gray-400 text-sm">
                  {pageState === "register" ? "Ja tem uma conta? " : "Ainda nao tem uma conta? "}
                  <button
                    type="button"
                    className="text-indigo-600 font-semibold hover:underline"
                    onClick={() => setPageState(pageState === "register" ? "login" : "register")}
                    data-testid="button-toggle-register"
                  >
                    {pageState === "register" ? "Faca login" : "Cadastre-se"}
                  </button>
                </p>
              </div>

              <div className="mt-4 flex items-center justify-center gap-1.5 text-gray-400 text-xs">
                <Lock className="w-3 h-3" />
                <span>Conexao segura e criptografada</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
