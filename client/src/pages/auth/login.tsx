import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Shield, CheckCircle, Lock, Eye, EyeOff, MailCheck, RefreshCw, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getSubdomain } from "@/lib/subdomain";
import { useMarca } from "@/lib/marca";
import Marca, { SimboloDaMarca } from "@/components/marca";
import CadastroWizard from "@/pages/auth/cadastro-wizard";

type PageState = "login" | "register" | "check-email" | "forgot" | "reset";

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message); return; }
      setSent(true);
    } catch { setError("Erro de conexao"); } finally { setLoading(false); }
  };

  if (sent) {
    return (
      <div className="text-center py-4">
        <div className="w-12 h-12 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center mx-auto mb-3">
          <CheckCircle className="w-6 h-6 text-[var(--color-success)]" />
        </div>
        <h3 className="font-semibold text-lg mb-2">Email enviado</h3>
        <p className="text-sm text-[var(--color-muted)] mb-4">Se o email estiver cadastrado, voce recebera instrucoes para redefinir sua senha.</p>
        <Button variant="ghost" onClick={onBack} className="text-[var(--color-brand)]">Voltar ao login</Button>
      </div>
    );
  }

  return (
    <div className="py-2">
      <h3 className="font-semibold text-lg text-center mb-2">Esqueci minha senha</h3>
      <p className="text-sm text-[var(--color-muted)] text-center mb-4">Informe seu email e enviaremos um link para redefinir sua senha.</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p className="text-sm text-[var(--color-danger)] bg-[var(--color-danger-bg)] rounded px-3 py-2">{error}</p>}
        <Input type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} required />
        <Button type="submit" disabled={loading} className="w-full bg-[var(--color-brand)] hover:bg-[var(--color-steel)] text-white font-semibold">
          {loading ? "Enviando..." : "Enviar link de redefinicao"}
        </Button>
      </form>
      <button type="button" onClick={onBack} className="mt-3 text-sm text-[var(--color-brand)] hover:underline w-full text-center block">Voltar ao login</button>
    </div>
  );
}

function ResetPasswordForm({ onBack }: { onBack: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const params = new URLSearchParams(window.location.search);
  const token = params.get("reset") || "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("Senhas nao conferem"); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message); return; }
      setDone(true);
    } catch { setError("Erro de conexao"); } finally { setLoading(false); }
  };

  if (done) {
    return (
      <div className="text-center py-4">
        <div className="w-12 h-12 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center mx-auto mb-3">
          <CheckCircle className="w-6 h-6 text-[var(--color-success)]" />
        </div>
        <h3 className="font-semibold text-lg mb-2">Senha alterada</h3>
        <p className="text-sm text-[var(--color-muted)] mb-4">Sua senha foi redefinida com sucesso. Faca login com a nova senha.</p>
        <Button onClick={onBack} className="bg-[var(--color-brand)] text-white">Ir para login</Button>
      </div>
    );
  }

  return (
    <div className="py-2">
      <h3 className="font-semibold text-lg text-center mb-2">Redefinir senha</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p className="text-sm text-[var(--color-danger)] bg-[var(--color-danger-bg)] rounded px-3 py-2">{error}</p>}
        <Input type="password" placeholder="Nova senha" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required />
        <Input type="password" placeholder="Confirmar senha" value={confirm} onChange={e => setConfirm(e.target.value)} minLength={6} required />
        <Button type="submit" disabled={loading} className="w-full bg-[var(--color-brand)] hover:bg-[var(--color-steel)] text-white font-semibold">
          {loading ? "Alterando..." : "Redefinir senha"}
        </Button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const marca = useMarca();
  const currentSubdomain = getSubdomain();
  /**
   * Modo tenant = só login, sem o formulário público de cadastro.
   *
   * Era `!!getSubdomain()`. Num domínio próprio de revendedor isso dá false, e
   * a porta de entrada dele passaria a oferecer "criar conta" na plataforma —
   * qualquer visitante abriria um provedor novo a partir da marca dele. Quem
   * responde agora é o contexto que o servidor resolveu pelo host.
   */
  const isSubdomainMode = marca.contexto === "tenant";

  const { data: tenantInfo } = useQuery<{ id: number; name: string; subdomain: string }>({
    queryKey: ["/api/tenant/resolve", currentSubdomain],
    queryFn: async () => {
      const res = await fetch(`/api/tenant/resolve?subdomain=${encodeURIComponent(currentSubdomain!)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!currentSubdomain,
  });

  const [pageState, setPageState] = useState<PageState>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset")) return "reset";
    if (isSubdomainMode) return "login";
    return params.get("mode") === "register" ? "register" : "login";
  });
  const [isLoading, setIsLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");

  /**
   * Só o par de login. Todo o estado do cadastro — CNPJ, busca na Receita,
   * subdomínio sugerido, confirmações — mudou para `CadastroWizard`, que é
   * quem precisa dele. Aqui sobravam nove campos e três efeitos que nenhuma
   * tela deste arquivo lia mais.
   */
  const [form, setForm] = useState({ email: "", password: "" });

  /**
   * Só o login. O cadastro saiu deste formulário e virou `CadastroWizard`, que
   * pede empresa, responsável e acesso em três etapas — ver o arquivo dele.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login(form.email, form.password);
    } catch (err: any) {
      if (err.code === "EMAIL_NOT_VERIFIED") {
        setPendingEmail(err.email || form.email);
        setPageState("check-email");
        return;
      }
      toast({
        title: "Nao foi possivel entrar",
        description: err.message || "Verifique seu email e senha e tente novamente.",
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

  const features = [
    "Base Colaborativa de Inadimplentes entre Provedores",
    "Consulta de Historico de Inadimplencia por CPF/CNPJ",
    "Integracao com SPC Brasil para Analise Completa",
    "Sistema Anti-Fraude e Deteccao de Risco",
  ];

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col" data-testid="login-page">
      <header className="flex items-center justify-between px-8 py-5">
        <Marca tamanho={32} />
        {!isSubdomainMode && (
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
            data-testid="button-back-to-site"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar ao site
          </button>
        )}
      </header>

      <div className="flex-1 flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-5xl flex flex-col lg:flex-row items-center gap-12 lg:gap-16">

          <div className="flex-1 text-[var(--color-ink)] text-center lg:text-left max-w-lg">
            <div className="inline-flex items-center gap-2 bg-[var(--color-brand-bg)] rounded-sm px-4 py-1.5 mb-6">
              <Shield className="w-4 h-4 text-[var(--color-gold)]" />
              <span className="text-sm font-medium text-[var(--color-brand)]">Plataforma Colaborativa de Credito</span>
            </div>

            <h1 className="font-display text-3xl lg:text-4xl font-light leading-tight mb-4">
              Proteja seu provedor,{" "}
              <span className="text-[var(--color-gold)] font-semibold">consulte antes</span>
              <br />de liberar contratos
            </h1>
            <p className="text-[var(--color-muted)] text-base lg:text-lg mb-8 leading-relaxed">
              Base de dados <span className="text-[var(--color-gold)] font-medium">colaborativa</span> de clientes inadimplentes entre provedores. Consulte o historico e <span className="text-[var(--color-success)] font-medium">reduza riscos</span> na sua operacao.
            </p>

            <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-muted)] mb-3">Numeros da plataforma</p>
            <div className="grid grid-cols-3 gap-3 mb-8">
              <div className="bg-[var(--color-surface)] rounded p-4 text-center border border-[var(--border)]">
                <span className="font-mono font-semibold text-xl block text-[var(--color-gold)]">100+</span>
                <span className="text-[var(--color-muted)] text-xs">Provedores</span>
              </div>
              <div className="bg-[var(--color-surface)] rounded p-4 text-center border border-[var(--border)]">
                <span className="font-mono font-semibold text-xl block text-[var(--color-success)]">Multi</span>
                <span className="text-[var(--color-muted)] text-xs">Base Colaborativa</span>
              </div>
              <div className="bg-[var(--color-surface)] rounded p-4 text-center border border-[var(--border)]">
                <span className="font-mono font-semibold text-xl block text-[var(--color-gold)]">99.9%</span>
                <span className="text-[var(--color-muted)] text-xs">Uptime</span>
              </div>
            </div>

            <div className="space-y-2.5">
              {features.map((feature) => (
                <div key={feature} className="flex items-center gap-2.5 justify-center lg:justify-start">
                  <CheckCircle className="w-4 h-4 text-[var(--color-success)] flex-shrink-0" />
                  <span className="text-[var(--color-muted)] text-sm">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="w-full max-w-md flex-shrink-0">
            {pageState === "check-email" ? (
              <Card className="p-8 border border-[var(--border)] rounded bg-[var(--color-surface)]" data-testid="check-email-card">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 rounded-full bg-[var(--color-brand)]/10 flex items-center justify-center mx-auto mb-4">
                    <MailCheck className="w-8 h-8 text-[var(--color-brand)]" />
                  </div>
                  <h2 className="font-display text-2xl font-semibold mb-2" data-testid="text-check-email-title">
                    Verifique seu email
                  </h2>
                  <p className="text-[var(--color-muted)] text-sm leading-relaxed">
                    Enviamos um link de confirmacao para
                  </p>
                  <p className="font-semibold mt-1 text-[var(--color-ink)]" data-testid="text-pending-email">{pendingEmail}</p>
                </div>

                <div className="bg-[var(--color-brand)]/5 rounded p-4 mb-6 space-y-2">
                  {[
                    `Abra seu email e procure a mensagem do ${marca.nomeProduto}`,
                    "Clique no botao \"Confirmar Email\"",
                    "Voce sera redirecionado automaticamente para o sistema",
                  ].map((step, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-[var(--color-brand)] text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-semibold">
                        {i + 1}
                      </span>
                      <span className="text-sm text-[var(--color-muted)]">{step}</span>
                    </div>
                  ))}
                </div>

                <div className="text-center space-y-3">
                  <p className="text-sm text-[var(--color-muted)]">Nao recebeu o email?</p>
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={handleResend}
                    disabled={resendLoading}
                    data-testid="button-resend-email"
                  >
                    <RefreshCw className={`w-4 h-4 ${resendLoading ? "animate-spin" : ""}`} />
                    {resendLoading ? "Enviando..." : "Reenviar email de verificacao"}
                  </Button>
                  <button
                    type="button"
                    className="text-sm text-[var(--color-brand)] font-medium hover:text-[var(--color-steel)]"
                    onClick={() => setPageState("login")}
                    data-testid="button-back-to-login"
                  >
                    Voltar ao login
                  </button>
                </div>
              </Card>
            ) : (
              <Card className="p-8 border border-[var(--border)] rounded bg-[var(--color-surface)]">
                <div className="text-center mb-6">
                  <SimboloDaMarca tamanho={46} className="mx-auto mb-3" />
                  <h2 className="font-display text-xl font-semibold" data-testid="text-login-title">
                    {isSubdomainMode
                      ? "Bem-vindo de volta"
                      : pageState === "register" ? "Cadastre-se" : "Bem-vindo de volta"}
                  </h2>
                  {isSubdomainMode && tenantInfo?.name && (
                    <p className="text-base font-semibold text-[var(--color-brand)] mt-1" data-testid="text-provider-name">
                      {tenantInfo.name.split(" ").slice(0, 2).join(" ")}
                    </p>
                  )}
                  <p className="text-[var(--color-muted)] text-sm mt-1">
                    {isSubdomainMode
                      ? "Faca login para acessar o painel"
                      : pageState === "register" ? "Crie sua conta para acessar o sistema" : "Faca login para acessar o painel"}
                  </p>
                </div>


                {pageState === "register" && (
                  <CadastroWizard
                    aoPrecisarVerificar={(email) => { setPendingEmail(email); setPageState("check-email"); }}
                    aoVoltarParaLogin={() => setPageState("login")}
                  />
                )}

                {pageState === "login" && (
                <form onSubmit={handleSubmit} className="space-y-4">

                  <div>
                    <label className="text-sm font-medium mb-1.5 block text-[var(--color-ink)]">Email</label>
                    <Input
                      data-testid="input-email"
                      type="email"
                      placeholder="seu@email.com"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      required
                    />
                  </div>


                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-sm font-medium text-[var(--color-ink)]">Senha</label>
                      {pageState === "login" && (
                        <button type="button" className="text-xs text-[var(--color-brand)] hover:underline" onClick={() => setPageState("forgot" as any)}>
                          Esqueci minha senha
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        data-testid="input-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="********"
                        className="pr-10"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        required
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                        onClick={() => setShowPassword(!showPassword)}
                        data-testid="button-toggle-password"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>



                  <Button
                    type="submit"
                    className="w-full bg-[var(--color-brand)] hover:bg-[var(--color-steel)] h-11 text-base"
                    disabled={isLoading}
                    data-testid="button-submit-login"
                  >
                    {isLoading ? "Aguarde..." : "Entrar"}
                    {!isLoading && <ArrowLeft className="w-4 h-4 ml-2 rotate-180" />}
                  </Button>
                </form>
                )}

                {pageState === "forgot" && (
                  <ForgotPasswordForm onBack={() => setPageState("login")} />
                )}

                {pageState === "reset" && (
                  <ResetPasswordForm onBack={() => setPageState("login")} />
                )}

                {!isSubdomainMode && pageState !== "forgot" && pageState !== "reset" && (
                  <p className="mt-5 text-center text-sm text-[var(--color-muted)]">
                    {pageState === "register" ? "Ja tem uma conta? " : "Ainda nao tem uma conta? "}
                    <button
                      type="button"
                      className="text-[var(--color-brand)] font-semibold hover:text-[var(--color-steel)]"
                      onClick={() => setPageState(pageState === "register" ? "login" : "register")}
                      data-testid="button-toggle-register"
                    >
                      {pageState === "register" ? "Faca login" : "Cadastre-se"}
                    </button>
                  </p>
                )}

                <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-[var(--color-muted)]">
                  <Lock className="w-3 h-3" />
                  <span>Conexao segura e criptografada</span>
                </div>
              </Card>
            )}
          </div>

        </div>
      </div>

      <footer className="text-center py-4 text-[var(--color-muted)] text-xs">
        2026 {marca.nomeProduto} — Analise de credito para provedores de internet
      </footer>
    </div>
  );
}
