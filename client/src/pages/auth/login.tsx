import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Lock, Eye, EyeOff, MailCheck, RefreshCw, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { useMarca } from "@/lib/marca";
import Marca, { SimboloDaMarca } from "@/components/marca";
import CadastroWizard from "@/pages/auth/cadastro-wizard";
import LoginDaPlataforma from "@/pages/auth/login-plataforma";
import { useFluxoDeLogin, pedirLinkDeSenha, redefinirSenha, tokenDeRedefinicao } from "@/pages/auth/login-fluxo";

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const resposta = await pedirLinkDeSenha(email.trim());
    setLoading(false);
    if (resposta.ok) setSent(true);
    else setError(resposta.mensagem);
  };

  if (sent) {
    return (
      <div className="text-center py-4">
        <div className="w-12 h-12 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center mx-auto mb-3">
          <CheckCircle className="w-6 h-6 text-[var(--color-success)]" />
        </div>
        <h3 className="font-semibold text-lg mb-2">Email enviado</h3>
        <p className="text-sm text-[var(--color-muted)] mb-4">Se o e-mail estiver cadastrado, você receberá as instruções para redefinir sua senha.</p>
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("As senhas não conferem"); return; }
    setError("");
    setLoading(true);
    const resposta = await redefinirSenha(tokenDeRedefinicao(), password);
    setLoading(false);
    if (resposta.ok) setDone(true);
    else setError(resposta.mensagem);
  };

  if (done) {
    return (
      <div className="text-center py-4">
        <div className="w-12 h-12 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center mx-auto mb-3">
          <CheckCircle className="w-6 h-6 text-[var(--color-success)]" />
        </div>
        <h3 className="font-semibold text-lg mb-2">Senha alterada</h3>
        <p className="text-sm text-[var(--color-muted)] mb-4">Sua senha foi redefinida. Faça login com a nova senha.</p>
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

/**
 * Qual porta de entrada este host veste.
 *
 * Marca da plataforma (o dominio dela e os subdominios dos provedores dela):
 * o desenho "/consulta.isp", continuacao da landing. Marca de revendedor: a tela
 * neutra abaixo, com o logo e as cores dele — o traje da plataforma na porta de
 * um revendedor seria a marca de outra empresa na casa dele.
 */
export default function LoginPage() {
  const marca = useMarca();
  return marca.marcaId === null ? <LoginDaPlataforma /> : <LoginDoRevendedor />;
}

function LoginDoRevendedor() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const {
    marca, isSubdomainMode, tenantInfo, pageState, irPara,
    form, setForm, showPassword, setShowPassword, isLoading, handleSubmit,
    pendingEmail, setPendingEmail, pedirEmailDoReenvio, resultadoReenvio, resendLoading,
    irParaReenvio, handleResend,
  } = useFluxoDeLogin({
    aoFalharLogin: (mensagem) => toast({ title: "Não foi possível entrar", description: mensagem, variant: "destructive" }),
    aoReenviar: (resultado) => { if (resultado.ok) toast({ title: "E-mail enviado", description: resultado.mensagem }); },
  });
  const setPageState = irPara;

  const features = [
    "Base colaborativa de inadimplência entre provedores",
    "Histórico na rede por CPF, CNPJ ou endereço, ao vivo no ERP",
    "Consulta SPC Brasil integrada",
    "Anti-fraude: aviso quando o seu cliente inadimplente é consultado por outro provedor",
  ];

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col" data-testid="login-page">
      <header className="flex items-center justify-between px-8 py-5">
        <Marca tamanho={32} comAssinatura />
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
            {/* Traje da marca /consulta.isp (10/09/2026): kicker em mono, destaque
                em italico na tinta — sem o selo dourado e sem cor de semantica
                enfeitando palavra. Os "Numeros da plataforma" (100+ provedores,
                99.9% de uptime) SAIRAM: nenhum dos dois e medido pelo sistema, e a
                regra do dono e so dado real e verificavel. */}
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)] mb-5">
              Base colaborativa entre provedores
            </p>

            <h1 className="font-display text-3xl lg:text-4xl font-light leading-tight tracking-[-0.025em] mb-4 [text-wrap:balance]">
              Proteja seu provedor:{" "}
              <em className="font-medium italic text-[var(--text)]">consulte antes</em> de liberar o contrato
            </h1>
            <p className="text-[var(--color-muted)] text-base lg:text-lg mb-8 leading-relaxed">
              A base colaborativa de inadimplência entre provedores de internet. Consulte o histórico na rede e reduza o risco da sua operação.
            </p>

            <div className="space-y-2.5">
              {features.map((feature) => (
                <div key={feature} className="flex items-center gap-2.5 justify-center lg:justify-start">
                  <CheckCircle className="w-4 h-4 text-[var(--text)] flex-shrink-0" />
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
                    Verifique seu e-mail
                  </h2>
                  {pedirEmailDoReenvio ? (
                    <p className="text-[var(--color-muted)] text-sm leading-relaxed">
                      Informe o e-mail do cadastro e enviamos outro link de confirmação.
                    </p>
                  ) : (
                    <>
                      <p className="text-[var(--color-muted)] text-sm leading-relaxed">
                        Enviamos um link de confirmação para
                      </p>
                      <p className="font-semibold mt-1 text-[var(--color-ink)]" data-testid="text-pending-email">{pendingEmail}</p>
                    </>
                  )}
                </div>

                <div className="bg-[var(--color-brand)]/5 rounded p-4 mb-6 space-y-2">
                  {[
                    `Abra seu email e procure a mensagem do ${marca.nomeProduto}`,
                    "Clique no botao \"Confirmar Email\"",
                    "Você será levado ao sistema automaticamente",
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
                  <p className="text-sm text-[var(--color-muted)]">Não recebeu o e-mail?</p>
                  {pedirEmailDoReenvio && (
                    <Input
                      type="email"
                      placeholder="seu@email.com"
                      value={pendingEmail}
                      onChange={(e) => setPendingEmail(e.target.value)}
                      data-testid="input-reenvio-email"
                    />
                  )}
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={handleResend}
                    disabled={resendLoading || !pendingEmail.trim()}
                    data-testid="button-resend-email"
                  >
                    <RefreshCw className={`w-4 h-4 ${resendLoading ? "animate-spin" : ""}`} />
                    {resendLoading ? "Enviando..." : "Reenviar e-mail de verificação"}
                  </Button>
                  {resultadoReenvio && (
                    <p
                      role="status"
                      data-testid="text-resultado-reenvio"
                      className={`text-sm rounded px-3 py-2 text-left ${
                        resultadoReenvio.ok
                          ? "text-[var(--color-success)] bg-[var(--color-success-bg)]"
                          : "text-[var(--color-danger)] bg-[var(--color-danger-bg)]"
                      }`}
                    >
                      {resultadoReenvio.mensagem}
                    </p>
                  )}
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
                      ? "Faça login para acessar o painel"
                      : pageState === "register" ? "Crie sua conta para acessar o sistema" : "Faça login para acessar o painel"}
                  </p>
                </div>


                {pageState === "register" && (
                  <CadastroWizard
                    aoPrecisarVerificar={(email) => irParaReenvio(email)}
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

                  {/*
                    O reenvio so aparecia depois de uma tentativa de login
                    recusada por e-mail nao verificado. Quem nunca recebeu o
                    primeiro e-mail nao tem por que adivinhar que precisa errar
                    o login para achar o botao — e a mensagem que ele ve ali e
                    generica. Aqui o caminho fica visivel antes disso, ja com o
                    endereco digitado no campo acima, quando houver.
                  */}
                  <button
                    type="button"
                    className="w-full text-center text-xs text-[var(--color-muted)] hover:text-[var(--color-brand)] hover:underline"
                    onClick={() => irParaReenvio(form.email.trim())}
                    data-testid="button-nao-recebi-confirmacao"
                  >
                    Não recebi o e-mail de confirmação
                  </button>
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
                    {pageState === "register" ? "Já tem uma conta? " : "Ainda não tem uma conta? "}
                    <button
                      type="button"
                      className="text-[var(--color-brand)] font-semibold hover:text-[var(--color-steel)]"
                      onClick={() => setPageState(pageState === "register" ? "login" : "register")}
                      data-testid="button-toggle-register"
                    >
                      {pageState === "register" ? "Faça login" : "Cadastre-se"}
                    </button>
                  </p>
                )}

                <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-[var(--color-muted)]">
                  <Lock className="w-3 h-3" />
                  <span>Conexão segura e criptografada</span>
                </div>
              </Card>
            )}
          </div>

        </div>
      </div>

      <footer className="text-center py-4 text-[var(--color-muted)] text-xs">
        2026 {marca.nomeProduto} — base colaborativa entre provedores de internet
      </footer>
    </div>
  );
}
