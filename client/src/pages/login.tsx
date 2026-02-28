import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Shield, Users, Search, BarChart3, CheckCircle, Lock, Mail, Zap, Eye, EyeOff } from "lucide-react";

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
    <div className="min-h-screen flex" data-testid="login-page">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 relative flex-col justify-between p-12 text-white">
        <div>
          <div className="flex items-center gap-3 mb-16">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold">Consulta ISP</span>
          </div>
          <h1 className="text-4xl font-bold leading-tight mb-4">
            Base de Inadimplentes<br />Compartilhada
          </h1>
          <p className="text-blue-100 text-lg mb-12 max-w-md">
            Analise de credito baseada em base de dados colaborativa de clientes inadimplentes de provedores. Consulte o historico antes de liberar novos contratos!
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-12">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-yellow-300" />
              <span className="font-semibold text-lg">100+</span>
            </div>
            <span className="text-blue-200 text-sm">Provedores Ativos</span>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Search className="w-5 h-5 text-purple-300" />
              <span className="font-semibold text-lg">Multi</span>
            </div>
            <span className="text-blue-200 text-sm">Base Colaborativa</span>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-5 h-5 text-green-300" />
              <span className="font-semibold text-lg">99.9%</span>
            </div>
            <span className="text-blue-200 text-sm">Uptime Garantido</span>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-5 h-5 text-orange-300" />
              <span className="font-semibold text-lg">#1</span>
            </div>
            <span className="text-blue-200 text-sm">Melhor do Mercado</span>
          </div>
        </div>

        <div className="space-y-3">
          {[
            "Base Colaborativa de Inadimplentes entre Provedores",
            "Consulta de Historico de Inadimplencia por CPF/CNPJ",
            "Integracao com SPC Brasil para Analise Completa",
            "Sistema Anti-Fraude e Deteccao de Risco",
          ].map((feature) => (
            <div key={feature} className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
              <span className="text-blue-100 text-sm">{feature}</span>
            </div>
          ))}
        </div>

        <p className="text-blue-300 text-xs mt-8">
          2025 ISP Analizze - Plataforma de Analise de Credito para Provedores de Internet
        </p>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold">Consulta ISP</span>
          </div>

          <Card className="p-8">
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center mx-auto mb-4">
                <Shield className="w-7 h-7 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold" data-testid="text-login-title">
                {isRegister ? "Cadastre-se" : "Bem-vindo!"}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {isRegister ? "Crie sua conta para acessar o sistema" : "Faca login para acessar o sistema"}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Nome</label>
                    <Input
                      data-testid="input-name"
                      placeholder="Seu nome completo"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Nome do Provedor</label>
                    <Input
                      data-testid="input-provider-name"
                      placeholder="Nome do seu provedor"
                      value={form.providerName}
                      onChange={(e) => setForm({ ...form, providerName: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">CNPJ</label>
                    <Input
                      data-testid="input-cnpj"
                      placeholder="00.000.000/0000-00"
                      value={form.cnpj}
                      onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                      required
                    />
                  </div>
                </>
              )}

              <div>
                <label className="text-sm font-medium mb-1.5 block">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    data-testid="input-email"
                    type="email"
                    placeholder="seu@email.com"
                    className="pl-10"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium">Senha</label>
                  {!isRegister && (
                    <button type="button" className="text-xs text-blue-600">
                      Esqueceu a senha?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    data-testid="input-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="******"
                    className="pl-10 pr-10"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                    data-testid="button-toggle-password"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600"
                disabled={isLoading}
                data-testid="button-submit-login"
              >
                <Zap className="w-4 h-4 mr-2" />
                {isLoading ? "Aguarde..." : isRegister ? "Cadastrar" : "Entrar no Sistema"}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground">
                {isRegister ? "Ja tem uma conta?" : "Ainda nao tem uma conta?"}{" "}
                <button
                  type="button"
                  className="text-blue-600 font-medium"
                  onClick={() => setIsRegister(!isRegister)}
                  data-testid="button-toggle-register"
                >
                  {isRegister ? "Faca login" : "Cadastre seu provedor"}
                </button>
              </p>
            </div>

            <div className="mt-4 text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="w-3 h-3" />
                <span>Conexao segura e criptografada</span>
              </div>
            </div>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-4">
            ISP Analizze v2.0 - Sistema de Analise de Credito
          </p>
        </div>
      </div>
    </div>
  );
}
