import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Shield, Lock, Mail, Zap, Eye, EyeOff, CheckCircle } from "lucide-react";

export default function LoginPage() {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const [isRegister, setIsRegister] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
      if (isRegister) {
        await register(form);
      } else {
        await login(form.email, form.password);
      }
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message || "Erro ao fazer login",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f7fb] relative" data-testid="login-page">
      <div className="min-h-screen flex flex-col">
        <div className="flex-1 flex flex-col lg:flex-row items-start justify-between max-w-[1400px] mx-auto w-full px-6 lg:px-16 py-10 lg:py-12">

          <div className="lg:max-w-[540px] w-full">
            <div className="flex items-center gap-3 mb-12">
              <div className="w-9 h-9 rounded-full border-2 border-[#7c3aed] flex items-center justify-center">
                <Shield className="w-4 h-4 text-[#7c3aed]" />
              </div>
              <span className="text-lg font-bold text-[#1e293b]">Consulta ISP</span>
            </div>

            <h1 className="text-[2.2rem] lg:text-[2.6rem] font-extrabold leading-[1.1] text-[#0f172a] mb-5">
              Base de Inadimplentes<br />Compartilhada
            </h1>
            <p className="text-[#64748b] text-[15px] mb-10 max-w-[480px] leading-relaxed">
              Analise de credito baseada em base de dados colaborativa de clientes inadimplentes de provedores. Consulte o historico antes de liberar novos contratos!
            </p>

            <div className="grid grid-cols-2 gap-3 mb-10 max-w-[440px]">
              <div className="bg-gradient-to-br from-[#4f8cf7] to-[#3370e8] rounded-2xl px-5 py-5 text-white">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-[#fbbf24]" fill="currentColor" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                  </div>
                  <span className="text-xl font-bold">100+</span>
                </div>
                <span className="text-white/80 text-xs font-medium">Provedores Ativos</span>
              </div>

              <div className="bg-gradient-to-br from-[#a78bfa] to-[#7c3aed] rounded-2xl px-5 py-5 text-white">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
                  </div>
                  <span className="text-xl font-bold">Multi</span>
                </div>
                <span className="text-white/80 text-xs font-medium">Base Colaborativa</span>
              </div>

              <div className="bg-gradient-to-br from-[#34d399] to-[#10b981] rounded-2xl px-5 py-5 text-white">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-[#fbbf24]" fill="currentColor" viewBox="0 0 24 24"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>
                  </div>
                  <span className="text-xl font-bold">99.9%</span>
                </div>
                <span className="text-white/80 text-xs font-medium">Uptime Garantido</span>
              </div>

              <div className="bg-gradient-to-br from-[#fbbf24] to-[#f59e0b] rounded-2xl px-5 py-5 text-white">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2z"/></svg>
                  </div>
                  <span className="text-xl font-bold">#1</span>
                </div>
                <span className="text-white/80 text-xs font-medium">Melhor do Mercado</span>
              </div>
            </div>

            <div className="space-y-2.5 mb-6">
              {[
                "Base Colaborativa de Inadimplentes entre Provedores",
                "Consulta de Historico de Inadimplencia por CPF/CNPJ",
                "Integracao com SPC Brasil para Analise Completa",
                "Sistema Anti-Fraude e Deteccao de Risco",
              ].map((feature) => (
                <div key={feature} className="flex items-center gap-2.5">
                  <CheckCircle className="w-[18px] h-[18px] text-[#10b981] flex-shrink-0" />
                  <span className="text-[#334155] text-[13px] font-medium">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="w-full lg:w-auto lg:min-w-[380px] lg:max-w-[400px] mt-8 lg:mt-16">
            <div className="bg-white rounded-2xl shadow-[0_4px_40px_rgba(0,0,0,0.08)] p-8">
              <div className="text-center mb-7">
                <div className="w-14 h-14 rounded-full bg-[#ede9fe] flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-7 h-7 text-[#7c3aed]" />
                </div>
                <h2 className="text-[22px] font-bold text-[#0f172a]" data-testid="text-login-title">
                  {isRegister ? "Cadastre-se" : "Bem-vindo!"}
                </h2>
                <p className="text-[#94a3b8] text-sm mt-1">
                  {isRegister ? "Crie sua conta para acessar o sistema" : "Faca login para acessar o sistema"}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {isRegister && (
                  <>
                    <div>
                      <label className="text-[13px] font-medium text-[#475569] mb-1.5 block">Nome</label>
                      <Input
                        data-testid="input-name"
                        placeholder="Seu nome completo"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        required
                        className="h-11 bg-[#f8fafc] border-[#e2e8f0] rounded-xl text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[13px] font-medium text-[#475569] mb-1.5 block">Nome do Provedor</label>
                      <Input
                        data-testid="input-provider-name"
                        placeholder="Nome do seu provedor"
                        value={form.providerName}
                        onChange={(e) => setForm({ ...form, providerName: e.target.value })}
                        required
                        className="h-11 bg-[#f8fafc] border-[#e2e8f0] rounded-xl text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[13px] font-medium text-[#475569] mb-1.5 block">CNPJ</label>
                      <Input
                        data-testid="input-cnpj"
                        placeholder="00.000.000/0000-00"
                        value={form.cnpj}
                        onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                        required
                        className="h-11 bg-[#f8fafc] border-[#e2e8f0] rounded-xl text-sm"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="text-[13px] font-medium text-[#475569] mb-1.5 block">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94a3b8]" />
                    <Input
                      data-testid="input-email"
                      type="email"
                      placeholder="seu@email.com"
                      className="h-11 pl-10 bg-[#f8fafc] border-[#e2e8f0] rounded-xl text-sm"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[13px] font-medium text-[#475569]">Senha</label>
                    {!isRegister && (
                      <button type="button" className="text-xs text-[#3b82f6] font-medium">
                        Esqueceu a senha?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94a3b8]" />
                    <Input
                      data-testid="input-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="******"
                      className="h-11 pl-10 pr-10 bg-[#f8fafc] border-[#e2e8f0] rounded-xl text-sm"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#94a3b8]"
                      onClick={() => setShowPassword(!showPassword)}
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 bg-gradient-to-r from-[#3b82f6] to-[#6366f1] text-white font-medium rounded-xl text-sm mt-1"
                  disabled={isLoading}
                  data-testid="button-submit-login"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  {isLoading ? "Aguarde..." : isRegister ? "Cadastrar" : "Entrar no Sistema"}
                </Button>
              </form>

              <div className="mt-5 text-center">
                <p className="text-[13px] text-[#64748b]">
                  {isRegister ? "Ja tem uma conta? " : "Ainda nao tem uma conta? "}
                  <button
                    type="button"
                    className="text-[#3b82f6] font-semibold"
                    onClick={() => setIsRegister(!isRegister)}
                    data-testid="button-toggle-register"
                  >
                    {isRegister ? "Faca login" : "Cadastre seu provedor"}
                  </button>
                </p>
              </div>

              <div className="mt-4 text-center">
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#94a3b8]">
                  <Lock className="w-3 h-3" />
                  <span>Conexao segura e criptografada</span>
                </div>
              </div>
            </div>

            <p className="text-center text-[11px] text-[#94a3b8] mt-4">
              Consulta ISP v2.0 - Sistema de Analise de Credito
            </p>
          </div>
        </div>

        <div className="px-6 lg:px-16 pb-6">
          <p className="text-[11px] text-[#94a3b8]">
            &copy; 2025 Consulta ISP - Plataforma de Analise de Credito para Provedores de Internet
          </p>
        </div>
      </div>
    </div>
  );
}
