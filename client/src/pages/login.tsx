import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  Users,
  Search,
  BarChart3,
  CheckCircle,
  Lock,
  Mail,
  Eye,
  EyeOff,
  Building2,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  Globe,
  ShieldCheck,
  Database,
  TrendingUp,
  FileSearch,
  UserCheck,
} from "lucide-react";

type Step = "login" | "register" | "verify";

function CNPJ_mask(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function VerificationCodeInput({ onComplete }: { onComplete: (code: string) => void }) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...digits];
    newDigits[index] = value.slice(-1);
    setDigits(newDigits);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    const complete = newDigits.join("");
    if (complete.length === 6) {
      onComplete(complete);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const newDigits = [...digits];
      newDigits[index - 1] = "";
      setDigits(newDigits);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const newDigits = [...digits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pasted[i] || "";
    }
    setDigits(newDigits);
    if (pasted.length === 6) {
      onComplete(pasted);
    } else {
      inputRefs.current[Math.min(pasted.length, 5)]?.focus();
    }
  };

  return (
    <div className="flex gap-2 justify-center" data-testid="verification-code-inputs">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => { inputRefs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          className="w-12 h-14 text-center text-xl font-bold border-2 rounded-xl bg-background focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900 outline-none transition-all"
          data-testid={`input-code-${i}`}
        />
      ))}
    </div>
  );
}

export default function LoginPage() {
  const { login, register, verifyEmail, resendCode } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("login");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    providerName: "",
    cnpj: "",
  });

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await login(form.email, form.password);
      if (result?.requiresVerification) {
        setVerificationEmail(result.email);
        setStep("verify");
        toast({
          title: "Verificacao necessaria",
          description: "Um codigo foi enviado para o seu email.",
        });
      }
    } catch (err: any) {
      toast({
        title: "Erro no login",
        description: err.message || "Email ou senha incorretos",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 6) {
      toast({ title: "Senha fraca", description: "A senha deve ter pelo menos 6 caracteres", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const result = await register(form);
      if (result?.requiresVerification) {
        setVerificationEmail(result.email);
        setStep("verify");
        setResendCooldown(60);
        toast({
          title: "Conta criada!",
          description: "Verifique o codigo enviado para o seu email.",
        });
      }
    } catch (err: any) {
      toast({
        title: "Erro no cadastro",
        description: err.message || "Nao foi possivel criar a conta",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (code: string) => {
    setIsLoading(true);
    try {
      await verifyEmail(verificationEmail, code);
      toast({ title: "Email verificado!", description: "Bem-vindo ao Consulta ISP" });
    } catch (err: any) {
      toast({
        title: "Codigo invalido",
        description: err.message || "Verifique o codigo e tente novamente",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    try {
      await resendCode(verificationEmail);
      setResendCooldown(60);
      toast({ title: "Codigo reenviado", description: "Verifique sua caixa de entrada" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen flex" data-testid="login-page">
      <div className="hidden lg:flex lg:w-[55%] relative flex-col overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950" />
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }} />

        <div className="relative flex flex-col h-full p-10 z-10">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 flex items-center justify-center">
              <Shield className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <span className="text-lg font-bold text-white tracking-tight">Consulta ISP</span>
              <p className="text-[10px] text-blue-300 font-medium tracking-widest uppercase">Plataforma de Credito</p>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-center max-w-lg">
            <Badge className="w-fit mb-6 bg-blue-500/20 text-blue-300 border-blue-500/30 hover:bg-blue-500/20 px-3 py-1 text-xs">
              <Globe className="w-3 h-3 mr-1.5" />
              Plataforma colaborativa entre provedores
            </Badge>

            <h1 className="text-4xl font-bold text-white leading-[1.15] mb-4">
              Proteja seu provedor<br />
              com inteligencia<br />
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">colaborativa</span>
            </h1>

            <p className="text-blue-200/80 text-base leading-relaxed mb-10 max-w-md">
              Consulte o historico de inadimplencia de clientes antes de liberar novos contratos. 
              Reduza perdas com a base compartilhada entre provedores.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-10">
              {[
                { icon: Database, label: "Base Compartilhada", desc: "Dados de inadimplentes entre provedores", color: "text-blue-400" },
                { icon: ShieldCheck, label: "Anti-Fraude", desc: "Deteccao automatica de riscos", color: "text-emerald-400" },
                { icon: FileSearch, label: "Consulta SPC", desc: "Integracao com bureau de credito", color: "text-purple-400" },
                { icon: TrendingUp, label: "Analise de Risco", desc: "Score e classificacao inteligente", color: "text-amber-400" },
              ].map(({ icon: Icon, label, desc, color }) => (
                <div key={label} className="bg-white/[0.04] backdrop-blur-sm border border-white/[0.06] rounded-xl p-4 hover:bg-white/[0.07] transition-colors">
                  <Icon className={`w-5 h-5 ${color} mb-2.5`} />
                  <p className="text-white text-sm font-medium">{label}</p>
                  <p className="text-blue-300/60 text-xs mt-0.5">{desc}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-6">
              <div className="flex -space-x-2">
                {["bg-blue-500", "bg-indigo-500", "bg-violet-500", "bg-purple-500"].map((bg, i) => (
                  <div key={i} className={`w-8 h-8 rounded-full ${bg} border-2 border-slate-900 flex items-center justify-center`}>
                    <UserCheck className="w-3.5 h-3.5 text-white" />
                  </div>
                ))}
              </div>
              <div>
                <p className="text-white text-sm font-semibold">100+ provedores</p>
                <p className="text-blue-300/60 text-xs">ja utilizam a plataforma</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-blue-400/40 text-xs">
              2025 ISP Analizze - Plataforma de Analise de Credito
            </p>
            <div className="flex items-center gap-1.5 text-blue-400/40 text-xs">
              <Lock className="w-3 h-3" />
              <span>Criptografia SSL</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 bg-gray-50 dark:bg-gray-950">
        <div className="w-full max-w-[420px]">
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold">Consulta ISP</span>
          </div>

          {step === "verify" ? (
            <Card className="p-7 shadow-lg border-0 bg-white dark:bg-gray-900">
              <button
                type="button"
                onClick={() => setStep("login")}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
                data-testid="button-back-login"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar ao login
              </button>

              <div className="text-center mb-8">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center mx-auto mb-5">
                  <Mail className="w-8 h-8 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold" data-testid="text-verify-title">Verifique seu email</h2>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  Enviamos um codigo de 6 digitos para<br />
                  <span className="font-medium text-foreground" data-testid="text-verify-email">{verificationEmail}</span>
                </p>
              </div>

              <div className="mb-6">
                <VerificationCodeInput onComplete={handleVerify} />
              </div>

              {isLoading && (
                <div className="flex items-center justify-center gap-2 mb-4 text-sm text-muted-foreground">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Verificando...
                </div>
              )}

              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-1">Nao recebeu o codigo?</p>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendCooldown > 0}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors"
                  data-testid="button-resend-code"
                >
                  {resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : "Reenviar codigo"}
                </button>
              </div>

              <div className="mt-6 pt-5 border-t">
                <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 flex gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                    <p className="font-medium mb-0.5">Modo demonstracao</p>
                    <p>O codigo de verificacao aparece nos logs do servidor. Em producao, sera enviado por email.</p>
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-7 shadow-lg border-0 bg-white dark:bg-gray-900">
              <div className="text-center mb-7">
                <h2 className="text-xl font-bold" data-testid="text-login-title">
                  {step === "register" ? "Cadastre seu provedor" : "Acesse sua conta"}
                </h2>
                <p className="text-sm text-muted-foreground mt-1.5">
                  {step === "register"
                    ? "Crie sua conta e comece a proteger seu provedor"
                    : "Entre com suas credenciais para continuar"}
                </p>
              </div>

              <div className="flex gap-2 mb-6">
                <button
                  type="button"
                  onClick={() => setStep("login")}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${step === "login" ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-muted-foreground hover:text-foreground"}`}
                  data-testid="button-tab-login"
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => setStep("register")}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${step === "register" ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-muted-foreground hover:text-foreground"}`}
                  data-testid="button-tab-register"
                >
                  Cadastro
                </button>
              </div>

              <form onSubmit={step === "register" ? handleRegister : handleLogin} className="space-y-4">
                {step === "register" && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wide">Nome completo</label>
                      <div className="relative">
                        <UserCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          data-testid="input-name"
                          placeholder="Seu nome completo"
                          className="pl-10 h-11"
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wide">Nome do provedor</label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          data-testid="input-provider-name"
                          placeholder="Ex: NetFibra Telecom"
                          className="pl-10 h-11"
                          value={form.providerName}
                          onChange={(e) => setForm({ ...form, providerName: e.target.value })}
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wide">CNPJ</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          data-testid="input-cnpj"
                          placeholder="00.000.000/0001-00"
                          className="pl-10 h-11"
                          value={form.cnpj}
                          onChange={(e) => setForm({ ...form, cnpj: CNPJ_mask(e.target.value) })}
                          required
                        />
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wide">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      data-testid="input-email"
                      type="email"
                      placeholder="seu@provedor.com.br"
                      className="pl-10 h-11"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Senha</label>
                    {step === "login" && (
                      <button type="button" className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors" data-testid="link-forgot-password">
                        Esqueceu?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      data-testid="input-password"
                      type={showPassword ? "text" : "password"}
                      placeholder={step === "register" ? "Minimo 6 caracteres" : "Sua senha"}
                      className="pl-10 pr-10 h-11"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm"
                  disabled={isLoading}
                  data-testid="button-submit-login"
                >
                  {isLoading ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : step === "register" ? (
                    <UserCheck className="w-4 h-4 mr-2" />
                  ) : (
                    <Lock className="w-4 h-4 mr-2" />
                  )}
                  {isLoading
                    ? "Aguarde..."
                    : step === "register"
                      ? "Criar conta e verificar email"
                      : "Entrar"}
                </Button>
              </form>

              {step === "register" && (
                <p className="text-center text-xs text-muted-foreground mt-4 leading-relaxed">
                  Ao se cadastrar, voce concorda com os{" "}
                  <span className="text-blue-600 cursor-pointer">Termos de Uso</span> e{" "}
                  <span className="text-blue-600 cursor-pointer">Politica de Privacidade</span>
                </p>
              )}

              <div className="mt-5 pt-5 border-t flex items-center justify-center gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Dados protegidos</span>
                </div>
                <span className="text-border">|</span>
                <div className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Conexao segura</span>
                </div>
              </div>
            </Card>
          )}

          <p className="text-center text-xs text-muted-foreground mt-5">
            ISP Analizze v2.0 - Plataforma de Analise de Credito
          </p>
        </div>
      </div>
    </div>
  );
}
