import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Shield, CheckCircle, Lock, ArrowRight, Eye, EyeOff, MailCheck, RefreshCw, Globe, Building2, X, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

function slugifySubdomain(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30);
}

function formatCnpj(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0,2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8)}`;
  return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12)}`;
}

type PageState = "login" | "register" | "check-email";

export default function LoginPage() {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [pageState, setPageState] = useState<PageState>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("mode") === "register" ? "register" : "login";
  });
  const [isLoading, setIsLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [subdomainEdited, setSubdomainEdited] = useState(false);
  const [subdomainStatus, setSubdomainStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [cnpjLookup, setCnpjLookup] = useState<"idle" | "loading" | "found" | "error">("idle");
  const [cnpjData, setCnpjData] = useState<any>(null);
  const [providerNameEdited, setProviderNameEdited] = useState(false);
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    providerName: "",
    cnpj: "",
    subdomain: "",
  });

  useEffect(() => {
    if (!subdomainEdited && form.providerName) {
      setForm(f => ({ ...f, subdomain: slugifySubdomain(f.providerName) }));
    }
  }, [form.providerName, subdomainEdited]);

  useEffect(() => {
    const digits = form.cnpj.replace(/\D/g, "");
    if (digits.length !== 14) {
      if (digits.length === 0) { setCnpjLookup("idle"); setCnpjData(null); }
      return;
    }
    setCnpjLookup("loading");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
        if (!res.ok) throw new Error("CNPJ nao encontrado");
        const data = await res.json();
        setCnpjData(data);
        setCnpjLookup("found");
        const fantasia = data.nome_fantasia?.trim();
        const razao = data.razao_social?.trim();
        const nome = fantasia || razao || "";
        if (nome && !providerNameEdited) {
          setForm(f => ({ ...f, providerName: nome }));
        }
      } catch {
        setCnpjLookup("error");
        setCnpjData(null);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [form.cnpj]);

  useEffect(() => {
    if (!form.subdomain || form.subdomain.length < 3) {
      setSubdomainStatus("idle");
      return;
    }
    setSubdomainStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const res = await apiRequest("GET", `/api/auth/check-subdomain?subdomain=${encodeURIComponent(form.subdomain)}`);
        const data = await res.json();
        setSubdomainStatus(data.available ? "available" : "taken");
      } catch {
        setSubdomainStatus("idle");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [form.subdomain]);

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
    <div className="min-h-screen flex" data-testid="login-page">
      <div className="hidden lg:flex lg:w-[55%] bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 relative flex-col justify-center p-12 text-white">
        <div className="absolute top-8 left-12 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight">Consulta ISP</span>
        </div>

        <div className="max-w-lg">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 text-white text-xs font-semibold px-4 py-1.5 rounded-full mb-8">
            <Shield className="w-3.5 h-3.5" />
            Base Colaborativa de Inadimplentes
          </div>

          <h1 className="text-4xl font-black leading-tight mb-4">
            Proteja seu provedor com a
            <span className="text-blue-200"> base compartilhada</span>
          </h1>
          <p className="text-blue-100 text-base leading-relaxed mb-10 max-w-md">
            Consulte CPF/CNPJ antes de ativar novos clientes. Dados de inadimplencia de centenas de provedores em uma unica plataforma.
          </p>

          <div className="grid grid-cols-3 gap-4 mb-10">
            {[
              { value: "100+", label: "Provedores" },
              { value: "50K+", label: "Consultas" },
              { value: "< 2s", label: "Resposta" },
            ].map(s => (
              <div key={s.label} className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-4 text-center border border-white/10">
                <p className="text-2xl font-black">{s.value}</p>
                <p className="text-blue-200 text-xs mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {[
              "Base Colaborativa de Inadimplentes entre Provedores",
              "Consulta de Historico de Inadimplencia por CPF/CNPJ",
              "Integracao com SPC Brasil para Analise Completa",
              "Sistema Anti-Fraude e Deteccao de Risco",
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-3">
                <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                <span className="text-blue-100 text-sm">{feature}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="absolute bottom-8 left-12 text-blue-300/60 text-xs">
          Consulta ISP - Plataforma de Analise de Credito para Provedores
        </p>
      </div>

      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="w-full max-w-md px-6">
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-blue-600 transition-colors mb-6"
            data-testid="button-back-to-site"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar ao site
          </button>

          <div className="lg:hidden flex items-center gap-2.5 mb-8 justify-center">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold">Consulta ISP</span>
          </div>

          {pageState === "check-email" ? (
            <Card className="rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200/60 p-8" data-testid="check-email-card">
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
                  <MailCheck className="w-8 h-8 text-blue-600" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-1" data-testid="text-check-email-title">
                  Verifique seu email
                </h2>
                <p className="text-slate-500 text-sm">
                  Enviamos um link de confirmacao para
                </p>
                <p className="font-semibold text-slate-900 mt-1" data-testid="text-pending-email">{pendingEmail}</p>
              </div>

              <div className="bg-blue-50 rounded-xl p-4 mb-6 space-y-2.5">
                {[
                  "Abra seu email e procure a mensagem do Consulta ISP",
                  "Clique no botao \"Confirmar Email\"",
                  "Voce sera redirecionado automaticamente para o sistema",
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-semibold">
                      {i + 1}
                    </span>
                    <span className="text-sm text-slate-600">{step}</span>
                  </div>
                ))}
              </div>

              <div className="text-center space-y-3">
                <p className="text-sm text-slate-500">Nao recebeu o email?</p>
                <Button
                  variant="outline"
                  className="w-full gap-2 h-11 rounded-xl"
                  onClick={handleResend}
                  disabled={resendLoading}
                  data-testid="button-resend-email"
                >
                  <RefreshCw className={`w-4 h-4 ${resendLoading ? "animate-spin" : ""}`} />
                  {resendLoading ? "Enviando..." : "Reenviar email de verificacao"}
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
            <Card className="rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200/60 p-8">
              <div className="text-center mb-8">
                <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-7 h-7 text-blue-600" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900" data-testid="text-login-title">
                  {pageState === "register" ? "Crie sua conta" : "Bem-vindo de volta"}
                </h2>
                <p className="text-slate-400 text-sm mt-1">
                  {pageState === "register" ? "Cadastre seu provedor para acessar o sistema" : "Faca login para acessar o painel"}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {pageState === "register" && (
                  <>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Seu Nome Completo</label>
                      <Input
                        data-testid="input-name"
                        placeholder="Seu nome completo"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="h-11 rounded-xl border-slate-200 bg-slate-50 focus:bg-white transition-colors"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5" />CNPJ da Empresa
                      </label>
                      <div className="relative">
                        <Input
                          data-testid="input-cnpj"
                          placeholder="00.000.000/0000-00"
                          value={form.cnpj}
                          onChange={(e) => setForm({ ...form, cnpj: formatCnpj(e.target.value) })}
                          className={`h-11 rounded-xl bg-slate-50 focus:bg-white transition-colors pr-8 ${
                            cnpjLookup === "found" ? "border-emerald-500" :
                            cnpjLookup === "error" ? "border-red-400" : "border-slate-200"
                          }`}
                          required
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2">
                          {cnpjLookup === "loading" && <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />}
                          {cnpjLookup === "found" && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                          {cnpjLookup === "error" && <X className="w-4 h-4 text-red-400" />}
                        </span>
                      </div>
                      {cnpjLookup === "loading" && (
                        <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 animate-spin" />Buscando dados da empresa...
                        </p>
                      )}
                      {cnpjLookup === "found" && cnpjData && (
                        <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-1">
                          <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
                            <CheckCircle className="w-3.5 h-3.5" />Empresa encontrada
                          </p>
                          {cnpjData.razao_social && (
                            <p className="text-xs text-emerald-800">
                              <span className="font-medium">Razao Social:</span> {cnpjData.razao_social}
                            </p>
                          )}
                          {cnpjData.nome_fantasia && (
                            <p className="text-xs text-emerald-800">
                              <span className="font-medium">Nome Fantasia:</span> {cnpjData.nome_fantasia}
                            </p>
                          )}
                          {cnpjData.municipio && (
                            <p className="text-xs text-emerald-800">
                              <span className="font-medium">Cidade:</span> {cnpjData.municipio} / {cnpjData.uf}
                            </p>
                          )}
                          {cnpjData.situacao_cadastral && (
                            <p className="text-xs text-emerald-800">
                              <span className="font-medium">Situacao:</span>{" "}
                              <span className={cnpjData.situacao_cadastral === "ATIVA" ? "text-emerald-600 font-semibold" : "text-red-600"}>
                                {cnpjData.situacao_cadastral}
                              </span>
                            </p>
                          )}
                        </div>
                      )}
                      {cnpjLookup === "error" && (
                        <p className="text-xs text-red-500 mt-1.5">CNPJ nao encontrado na Receita Federal. Verifique e tente novamente.</p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
                        Nome do Provedor
                        {cnpjLookup === "found" && !providerNameEdited && (
                          <span className="ml-2 text-emerald-600 normal-case tracking-normal font-normal">(preenchido automaticamente)</span>
                        )}
                      </label>
                      <Input
                        data-testid="input-provider-name"
                        placeholder="Nome do seu provedor"
                        value={form.providerName}
                        onChange={(e) => {
                          setProviderNameEdited(true);
                          setForm({ ...form, providerName: e.target.value });
                        }}
                        className="h-11 rounded-xl border-slate-200 bg-slate-50 focus:bg-white transition-colors"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5" />Subdominio do Painel
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Input
                            data-testid="input-subdomain"
                            placeholder="seuprovedor"
                            value={form.subdomain}
                            onChange={(e) => {
                              setSubdomainEdited(true);
                              const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);
                              setForm({ ...form, subdomain: val });
                            }}
                            className={`h-11 rounded-xl bg-slate-50 focus:bg-white transition-colors pr-8 ${
                              subdomainStatus === "available" ? "border-emerald-500" :
                              subdomainStatus === "taken" ? "border-red-500" : "border-slate-200"
                            }`}
                            required
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2">
                            {subdomainStatus === "checking" && <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                            {subdomainStatus === "available" && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                            {subdomainStatus === "taken" && <span className="text-red-500 font-bold text-sm">!</span>}
                          </span>
                        </div>
                        <span className="text-xs text-slate-400 whitespace-nowrap">.consultaisp.com.br</span>
                      </div>
                      {subdomainStatus === "taken" && (
                        <p className="text-xs text-red-500 mt-1.5">Subdominio ja em uso. Escolha outro.</p>
                      )}
                      {subdomainStatus === "available" && (
                        <p className="text-xs text-emerald-600 mt-1.5">Subdominio disponivel!</p>
                      )}
                      <p className="text-xs text-slate-400 mt-1.5">
                        Auto-gerado a partir do nome do provedor. Voce pode editar.
                      </p>
                    </div>
                  </>
                )}

                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Email</label>
                  <Input
                    data-testid="input-email"
                    type="email"
                    placeholder="seu@email.com"
                    className="h-11 rounded-xl border-slate-200 bg-slate-50 focus:bg-white transition-colors"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Senha</label>
                    {pageState === "login" && (
                      <button type="button" className="text-xs text-blue-600 font-medium" data-testid="button-forgot-password">
                        Esqueceu a senha?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      data-testid="input-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="******"
                      className="h-11 rounded-xl border-slate-200 bg-slate-50 focus:bg-white transition-colors pr-10"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      onClick={() => setShowPassword(!showPassword)}
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-base gap-2 shadow-lg shadow-blue-500/25"
                  disabled={isLoading}
                  data-testid="button-submit-login"
                >
                  {isLoading ? "Aguarde..." : pageState === "register" ? "Cadastrar" : "Entrar"}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </form>

              <div className="mt-6 text-center">
                <p className="text-sm text-slate-500">
                  {pageState === "register" ? "Ja tem uma conta?" : "Ainda nao tem uma conta?"}{" "}
                  <button
                    type="button"
                    className="text-blue-600 font-semibold hover:text-blue-700"
                    onClick={() => setPageState(pageState === "register" ? "login" : "register")}
                    data-testid="button-toggle-register"
                  >
                    {pageState === "register" ? "Faca login" : "Cadastre-se"}
                  </button>
                </p>
              </div>

              <div className="mt-5 text-center">
                <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
                  <Lock className="w-3 h-3" />
                  <span>Conexao segura e criptografada</span>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
