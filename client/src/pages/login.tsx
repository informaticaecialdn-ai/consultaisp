import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle, Lock, Eye, EyeOff, MailCheck, RefreshCw, Globe, Building2, X, ArrowLeft } from "lucide-react";
import logoImg from "@assets/consulta-isp-icon-128x128_1773154852856.png";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getSubdomain } from "@/lib/subdomain";

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

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0,2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
  return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
}

type PageState = "login" | "register" | "check-email";

export default function LoginPage() {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const currentSubdomain = getSubdomain();
  const isSubdomainMode = !!currentSubdomain;

  const { data: tenantInfo } = useQuery<{ id: number; name: string; subdomain: string }>({
    queryKey: ["/api/tenant/resolve", currentSubdomain],
    queryFn: async () => {
      const res = await fetch(`/api/tenant/resolve?subdomain=${encodeURIComponent(currentSubdomain!)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: isSubdomainMode,
  });

  const [pageState, setPageState] = useState<PageState>(() => {
    if (isSubdomainMode) return "login";
    const params = new URLSearchParams(window.location.search);
    return params.get("mode") === "register" ? "register" : "login";
  });
  const [isLoading, setIsLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [subdomainEdited, setSubdomainEdited] = useState(false);
  const [subdomainStatus, setSubdomainStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [cnpjLookup, setCnpjLookup] = useState<"idle" | "loading" | "found" | "error">("idle");
  const [cnpjData, setCnpjData] = useState<any>(null);
  const [providerNameEdited, setProviderNameEdited] = useState(false);
  const [form, setForm] = useState({
    email: "",
    confirmEmail: "",
    password: "",
    confirmPassword: "",
    name: "",
    phone: "",
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
    if (pageState === "register") {
      if (form.email !== form.confirmEmail) {
        toast({ title: "Emails nao conferem", description: "O email e a confirmacao de email devem ser identicos.", variant: "destructive" });
        return;
      }
      if (form.password !== form.confirmPassword) {
        toast({ title: "Senhas nao conferem", description: "A senha e a confirmacao de senha devem ser identicas.", variant: "destructive" });
        return;
      }
    }
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
      const isRegister = pageState === "register";
      toast({
        title: isRegister ? "Nao foi possivel criar sua conta" : "Nao foi possivel entrar",
        description: err.message || (isRegister ? "Verifique os dados e tente novamente." : "Verifique seu email e senha e tente novamente."),
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
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-violet-700 flex flex-col" data-testid="login-page">
      <header className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center overflow-hidden">
            <img src={logoImg} alt="Consulta ISP" className="w-full h-full object-contain" />
          </div>
          <span className="text-lg font-bold text-white">Consulta ISP</span>
        </div>
        {!isSubdomainMode && (
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors"
            data-testid="button-back-to-site"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar ao site
          </button>
        )}
      </header>

      <div className="flex-1 flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-5xl flex flex-col lg:flex-row items-center gap-12 lg:gap-16">

          <div className="flex-1 text-white text-center lg:text-left max-w-lg">
            <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm rounded-full px-4 py-1.5 mb-6">
              <Shield className="w-4 h-4 text-yellow-300" />
              <span className="text-sm font-medium text-yellow-100">Plataforma Colaborativa de Credito</span>
            </div>

            <h1 className="text-3xl lg:text-4xl font-bold leading-tight mb-4">
              Proteja seu provedor,{" "}
              <span className="text-yellow-300">consulte antes</span>
              <br />de liberar contratos
            </h1>
            <p className="text-blue-100 text-base lg:text-lg mb-8 leading-relaxed">
              Base de dados <span className="text-yellow-200 font-medium">colaborativa</span> de clientes inadimplentes entre provedores. Consulte o historico e <span className="text-green-300 font-medium">reduza riscos</span> na sua operacao.
            </p>

            <p className="text-xs font-semibold tracking-widest text-blue-200 uppercase mb-3">Numeros da plataforma</p>
            <div className="grid grid-cols-3 gap-3 mb-8">
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 text-center border border-white/10">
                <span className="font-bold text-xl block text-yellow-300">100+</span>
                <span className="text-blue-200 text-xs">Provedores</span>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 text-center border border-white/10">
                <span className="font-bold text-xl block text-green-300">Multi</span>
                <span className="text-blue-200 text-xs">Base Colaborativa</span>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 text-center border border-white/10">
                <span className="font-bold text-xl block text-amber-300">99.9%</span>
                <span className="text-blue-200 text-xs">Uptime</span>
              </div>
            </div>

            <div className="space-y-2.5">
              {features.map((feature) => (
                <div key={feature} className="flex items-center gap-2.5 justify-center lg:justify-start">
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <span className="text-blue-100 text-sm">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="w-full max-w-md flex-shrink-0">
            {pageState === "check-email" ? (
              <Card className="p-8 shadow-2xl border-0" data-testid="check-email-card">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 rounded-full bg-violet-50 dark:bg-violet-950 flex items-center justify-center mx-auto mb-4">
                    <MailCheck className="w-8 h-8 text-violet-600" />
                  </div>
                  <h2 className="text-2xl font-bold mb-2" data-testid="text-check-email-title">
                    Verifique seu email
                  </h2>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Enviamos um link de confirmacao para
                  </p>
                  <p className="font-semibold mt-1" data-testid="text-pending-email">{pendingEmail}</p>
                </div>

                <div className="bg-violet-50 dark:bg-violet-950/30 rounded-lg p-4 mb-6 space-y-2">
                  {[
                    "Abra seu email e procure a mensagem do Consulta ISP",
                    "Clique no botao \"Confirmar Email\"",
                    "Voce sera redirecionado automaticamente para o sistema",
                  ].map((step, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-violet-600 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-semibold">
                        {i + 1}
                      </span>
                      <span className="text-sm text-muted-foreground">{step}</span>
                    </div>
                  ))}
                </div>

                <div className="text-center space-y-3">
                  <p className="text-sm text-muted-foreground">Nao recebeu o email?</p>
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
                    className="text-sm text-violet-600 font-medium"
                    onClick={() => setPageState("login")}
                    data-testid="button-back-to-login"
                  >
                    Voltar ao login
                  </button>
                </div>
              </Card>
            ) : (
              <Card className="p-8 shadow-2xl border-0">
                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-full bg-violet-50 dark:bg-violet-950 flex items-center justify-center mx-auto mb-3">
                    <Shield className="w-6 h-6 text-violet-600" />
                  </div>
                  <h2 className="text-xl font-bold" data-testid="text-login-title">
                    {isSubdomainMode
                      ? "Bem-vindo de volta"
                      : pageState === "register" ? "Cadastre-se" : "Bem-vindo de volta"}
                  </h2>
                  {isSubdomainMode && tenantInfo?.name && (
                    <p className="text-base font-semibold text-violet-600 mt-1" data-testid="text-provider-name">
                      {tenantInfo.name.split(" ").slice(0, 2).join(" ")}
                    </p>
                  )}
                  <p className="text-muted-foreground text-sm mt-1">
                    {isSubdomainMode
                      ? "Faca login para acessar o painel"
                      : pageState === "register" ? "Crie sua conta para acessar o sistema" : "Faca login para acessar o painel"}
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {pageState === "register" && (
                    <>
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Seu Nome Completo</label>
                        <Input
                          data-testid="input-name"
                          placeholder="Seu nome completo"
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Telefone</label>
                        <Input
                          data-testid="input-phone"
                          type="tel"
                          placeholder="(00) 00000-0000"
                          value={form.phone}
                          onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })}
                          required
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1.5 block flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5" />CNPJ da Empresa
                        </label>
                        <div className="relative">
                          <Input
                            data-testid="input-cnpj"
                            placeholder="00.000.000/0000-00"
                            value={form.cnpj}
                            onChange={(e) => setForm({ ...form, cnpj: formatCnpj(e.target.value) })}
                            className={
                              cnpjLookup === "found" ? "border-emerald-500 pr-8" :
                              cnpjLookup === "error" ? "border-red-400 pr-8" : "pr-8"
                            }
                            required
                          />
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                            {cnpjLookup === "loading" && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
                            {cnpjLookup === "found" && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                            {cnpjLookup === "error" && <X className="w-4 h-4 text-red-400" />}
                          </span>
                        </div>
                        {cnpjLookup === "loading" && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <RefreshCw className="w-3 h-3 animate-spin" />Buscando dados da empresa...
                          </p>
                        )}
                        {cnpjLookup === "found" && cnpjData && (
                          <div className="mt-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 space-y-1">
                            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                              <CheckCircle className="w-3.5 h-3.5" />Empresa encontrada
                            </p>
                            {cnpjData.razao_social && (
                              <p className="text-xs text-emerald-800 dark:text-emerald-300">
                                <span className="font-medium">Razao Social:</span> {cnpjData.razao_social}
                              </p>
                            )}
                            {cnpjData.nome_fantasia && (
                              <p className="text-xs text-emerald-800 dark:text-emerald-300">
                                <span className="font-medium">Nome Fantasia:</span> {cnpjData.nome_fantasia}
                              </p>
                            )}
                            {cnpjData.municipio && (
                              <p className="text-xs text-emerald-800 dark:text-emerald-300">
                                <span className="font-medium">Cidade:</span> {cnpjData.municipio} / {cnpjData.uf}
                              </p>
                            )}
                            {cnpjData.situacao_cadastral && (
                              <p className="text-xs text-emerald-800 dark:text-emerald-300">
                                <span className="font-medium">Situacao:</span>{" "}
                                <span className={cnpjData.situacao_cadastral === "ATIVA" ? "text-emerald-600 font-semibold" : "text-red-600"}>
                                  {cnpjData.situacao_cadastral}
                                </span>
                              </p>
                            )}
                          </div>
                        )}
                        {cnpjLookup === "error" && (
                          <p className="text-xs text-amber-600 mt-1">CNPJ nao encontrado na Receita Federal. Voce pode continuar o cadastro normalmente.</p>
                        )}
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">
                          Nome do Provedor
                          {cnpjLookup === "found" && !providerNameEdited && (
                            <span className="ml-2 text-xs text-emerald-600 font-normal">(preenchido automaticamente)</span>
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
                          required
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1.5 block flex items-center gap-1.5">
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
                              className={
                                subdomainStatus === "available" ? "border-emerald-500 pr-8" :
                                subdomainStatus === "taken" ? "border-red-500 pr-8" : "pr-8"
                              }
                              required
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs">
                              {subdomainStatus === "checking" && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                              {subdomainStatus === "available" && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                              {subdomainStatus === "taken" && <span className="text-red-500 font-bold">!</span>}
                            </span>
                          </div>
                          <span className="text-sm text-muted-foreground whitespace-nowrap">.consultaisp.com.br</span>
                        </div>
                        {subdomainStatus === "taken" && (
                          <p className="text-xs text-red-500 mt-1">Subdominio ja em uso. Escolha outro.</p>
                        )}
                        {subdomainStatus === "available" && (
                          <p className="text-xs text-emerald-600 mt-1">Subdominio disponivel!</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          Auto-gerado a partir do nome do provedor. Voce pode editar.
                        </p>
                      </div>
                    </>
                  )}

                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Email</label>
                    <Input
                      data-testid="input-email"
                      type="email"
                      placeholder="seu@email.com"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      required
                    />
                  </div>

                  {pageState === "register" && (
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Confirmar Email</label>
                      <Input
                        data-testid="input-confirm-email"
                        type="email"
                        placeholder="Repita seu email"
                        value={form.confirmEmail}
                        onChange={(e) => setForm({ ...form, confirmEmail: e.target.value })}
                        className={form.confirmEmail && form.confirmEmail !== form.email ? "border-red-400" : form.confirmEmail && form.confirmEmail === form.email ? "border-emerald-500" : ""}
                        required
                      />
                      {form.confirmEmail && form.confirmEmail !== form.email && (
                        <p className="text-xs text-red-500 mt-1">Os emails nao conferem</p>
                      )}
                      {form.confirmEmail && form.confirmEmail === form.email && (
                        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle className="w-3 h-3" />Emails conferem</p>
                      )}
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-sm font-medium">Senha</label>
                      {pageState === "login" && (
                        <button type="button" className="text-xs text-violet-600 hover:text-violet-700">
                          Esqueceu a senha?
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
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                        data-testid="button-toggle-password"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {pageState === "register" && (
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Confirmar Senha</label>
                      <div className="relative">
                        <Input
                          data-testid="input-confirm-password"
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="Repita sua senha"
                          className={`pr-10 ${form.confirmPassword && form.confirmPassword !== form.password ? "border-red-400" : form.confirmPassword && form.confirmPassword === form.password ? "border-emerald-500" : ""}`}
                          value={form.confirmPassword}
                          onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                          required
                        />
                        <button
                          type="button"
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          data-testid="button-toggle-confirm-password"
                        >
                          {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {form.confirmPassword && form.confirmPassword !== form.password && (
                        <p className="text-xs text-red-500 mt-1">As senhas nao conferem</p>
                      )}
                      {form.confirmPassword && form.confirmPassword === form.password && (
                        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle className="w-3 h-3" />Senhas conferem</p>
                      )}
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="w-full bg-violet-600 hover:bg-violet-700 h-11 text-base"
                    disabled={isLoading}
                    data-testid="button-submit-login"
                  >
                    {isLoading ? "Aguarde..." : pageState === "register" ? "Cadastrar" : "Entrar"}
                    {!isLoading && <ArrowLeft className="w-4 h-4 ml-2 rotate-180" />}
                  </Button>
                </form>

                {!isSubdomainMode && (
                  <p className="mt-5 text-center text-sm text-muted-foreground">
                    {pageState === "register" ? "Ja tem uma conta? " : "Ainda nao tem uma conta? "}
                    <button
                      type="button"
                      className="text-violet-600 font-semibold hover:text-violet-700"
                      onClick={() => setPageState(pageState === "register" ? "login" : "register")}
                      data-testid="button-toggle-register"
                    >
                      {pageState === "register" ? "Faca login" : "Cadastre-se"}
                    </button>
                  </p>
                )}

                <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="w-3 h-3" />
                  <span>Conexao segura e criptografada</span>
                </div>
              </Card>
            )}
          </div>

        </div>
      </div>

      <footer className="text-center py-4 text-white/40 text-xs">
        2025 Consulta ISP - Plataforma de Analise de Credito para Provedores de Internet
      </footer>
    </div>
  );
}
