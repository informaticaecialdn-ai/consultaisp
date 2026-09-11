/**
 * A porta de entrada da PLATAFORMA — desenho "/consulta.isp" (standalone do
 * dono, 10/09/2026), continuação da landing: quem clica "Criar conta grátis"
 * no bloco escuro dela chega num bloco escuro com a mesma marca, e não num
 * painel cinza-violeta.
 *
 * Só no host da plataforma (e nos subdomínios dos provedores dela). Revendedor
 * de white label continua na tela neutra com a marca dele (`login.tsx`): este
 * traje é a identidade da plataforma, e vesti-lo num domínio de revendedor
 * seria mostrar a marca de outra empresa na porta dele.
 *
 * O que o standalone trazia e NÃO veio, pela regra do dono de só publicar dado
 * real e verificável:
 * - "Rede online · 47 provedores ativos": a base tinha 6. O número sai de
 *   `GET /api/public/rede`, contado no servidor; sem resposta, fica só
 *   "Rede online" — nunca um número de antes.
 * - "R$690 prejuízo médio evitado": nada no sistema mede isso. No lugar, o
 *   preço da consulta, lido de `CUSTO_EM_CREDITOS`.
 * - O link "Termos" (não existe página de termos) e os `href="#"`.
 * O "Manter conectado por 30 dias" do desenho é real: o servidor estende a
 * sessão (ver `duracaoDaSessao` em server/auth.ts).
 */
import { useState, type FormEvent, type InputHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CUSTO_EM_CREDITOS } from "@shared/schema";
import { WordmarkConsultaISP, TAGLINE_DA_MARCA } from "@/components/marca";
import { usePrecosPublicos, planoPorChave } from "@/hooks/use-precos";
import CadastroWizard from "@/pages/auth/cadastro-wizard";
import {
  useFluxoDeLogin, pedirLinkDeSenha, redefinirSenha, tokenDeRedefinicao,
} from "@/pages/auth/login-fluxo";
import "./login-plataforma.css";

const WHATSAPP_SUPORTE = "https://wa.me/5543991191100";

/** "6 provedores ativos" / "1 provedor ativo". */
function textoDoSelo(provedoresAtivos: number | undefined): string {
  if (typeof provedoresAtivos !== "number") return "Rede online";
  return `Rede online · ${provedoresAtivos} ${provedoresAtivos === 1 ? "provedor ativo" : "provedores ativos"}`;
}

/** Cabeçalho do cartão: o "/c.i" do ícone de app do kit, o título e a linha de apoio. */
function CabecalhoDoCartao({ titulo, destaque, children }: { titulo: string; destaque: string; children?: ReactNode }) {
  return (
    <div className="card-head">
      <div className="card-brand-mini" aria-hidden="true">
        <span className="slash">/</span>c<span className="ext">.i</span>
      </div>
      <h2 data-testid="text-login-title">
        {titulo} <strong>{destaque}</strong>
      </h2>
      {children && <p>{children}</p>}
    </div>
  );
}

/**
 * Campo no traje do desenho: rótulo em mono, prefixo e, na senha, o "Ver".
 * `acessorio` vai na linha do rótulo (o "Esqueci a senha"); `dentro`, no fim
 * do próprio campo (o "Ver").
 */
function Campo({
  id, rotulo, prefixo, acessorio, dentro, ...input
}: {
  id: string; rotulo: string; prefixo: string; acessorio?: ReactNode; dentro?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <div className="field-label">
        <label htmlFor={id}>{rotulo}</label>
        {acessorio}
      </div>
      <div className="field-input">
        <span className="prefix" aria-hidden="true">{prefixo}</span>
        <input id={id} {...input} />
        {dentro}
      </div>
    </div>
  );
}

function EsqueciASenha({ aoVoltar }: { aoVoltar: () => void }) {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const resposta = await pedirLinkDeSenha(email.trim());
    setEnviando(false);
    if (resposta.ok) setEnviado(true);
    else setErro(resposta.mensagem);
  };

  if (enviado) {
    return (
      <>
        <CabecalhoDoCartao titulo="Link" destaque="enviado.">
          Se o e-mail estiver cadastrado, as instruções para criar uma senha nova chegam em alguns minutos.
        </CabecalhoDoCartao>
        <button type="button" className="btn btn-secondary" onClick={aoVoltar}>Voltar ao login</button>
      </>
    );
  }

  return (
    <>
      <CabecalhoDoCartao titulo="Esqueci" destaque="a senha.">
        Informe o e-mail da conta e enviamos um link para criar uma senha nova.
      </CabecalhoDoCartao>
      <form className="form-da-marca" onSubmit={enviar}>
        <Campo
          id="esqueci-email" rotulo="E-mail" prefixo="@"
          type="email" placeholder="voce@seuprovedor.com.br" autoComplete="username" required
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
        {erro && <div className="status visible error" role="alert">{erro}</div>}
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          {enviando ? "Enviando..." : <>Enviar link <span className="arrow" aria-hidden="true">→</span></>}
        </button>
      </form>
      <div className="linha-links">
        <button type="button" className="link-texto" onClick={aoVoltar}>Voltar ao login</button>
      </div>
    </>
  );
}

function NovaSenha({ aoVoltar }: { aoVoltar: () => void }) {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [feito, setFeito] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (senha !== confirmacao) { setErro("As senhas não conferem."); return; }
    setErro(null);
    setEnviando(true);
    const resposta = await redefinirSenha(tokenDeRedefinicao(), senha);
    setEnviando(false);
    if (resposta.ok) setFeito(true);
    else setErro(resposta.mensagem);
  };

  if (feito) {
    return (
      <>
        <CabecalhoDoCartao titulo="Senha" destaque="alterada.">
          Entre com a senha nova.
        </CabecalhoDoCartao>
        <button type="button" className="btn btn-primary" onClick={aoVoltar}>
          Ir para o login <span className="arrow" aria-hidden="true">→</span>
        </button>
      </>
    );
  }

  return (
    <>
      <CabecalhoDoCartao titulo="Nova" destaque="senha.">
        Mínimo de 6 caracteres.
      </CabecalhoDoCartao>
      <form className="form-da-marca" onSubmit={enviar}>
        <Campo
          id="nova-senha" rotulo="Nova senha" prefixo="*"
          type="password" autoComplete="new-password" minLength={6} required
          value={senha} onChange={(e) => setSenha(e.target.value)}
        />
        <Campo
          id="nova-senha-confirmacao" rotulo="Confirmar senha" prefixo="*"
          type="password" autoComplete="new-password" minLength={6} required
          value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)}
        />
        {erro && <div className="status visible error" role="alert">{erro}</div>}
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          {enviando ? "Alterando..." : "Redefinir senha"}
        </button>
      </form>
    </>
  );
}

export default function LoginDaPlataforma() {
  const [, setLocation] = useLocation();
  const fluxo = useFluxoDeLogin();
  const {
    marca, isSubdomainMode, tenantInfo, pageState, irPara,
    form, setForm, lembrar, setLembrar, showPassword, setShowPassword,
    isLoading, erroDoLogin, handleSubmit,
    pendingEmail, setPendingEmail, pedirEmailDoReenvio, resultadoReenvio, resendLoading,
    irParaReenvio, handleResend,
  } = fluxo;

  const { data: rede } = useQuery<{ provedoresAtivos: number }>({
    queryKey: ["/api/public/rede"],
    staleTime: 5 * 60_000,
  });
  const { data: precos } = usePrecosPublicos();
  const creditosDeBoasVindas = planoPorChave(precos, "free")?.creditosInclusos.isp;
  const convite = typeof creditosDeBoasVindas === "number" && creditosDeBoasVindas > 0
    ? `Criar conta grátis · ${creditosDeBoasVindas} créditos`
    : "Criar conta grátis";

  const irParaRota = (destino: string) => (e: MouseEvent) => {
    e.preventDefault();
    setLocation(destino);
  };
  const trocarPara = (estado: "login" | "register") => (e: MouseEvent) => {
    e.preventDefault();
    irPara(estado);
  };

  const marcaDaColuna = <WordmarkConsultaISP tamanho={22} tagline={TAGLINE_DA_MARCA} sobreEscuro />;

  return (
    <div className="lg" data-testid="login-page">
      <main className="page">

        {/* ── COLUNA DE APRESENTAÇÃO ─────────────────────────────── */}
        <section className="side-info">
          {isSubdomainMode ? (
            <span className="brand">{marcaDaColuna}</span>
          ) : (
            <a href="/" className="brand" onClick={irParaRota("/")} data-testid="button-back-to-site">
              {marcaDaColuna}
              <span className="sr-only">— voltar ao site</span>
            </a>
          )}

          <div className="pill" data-testid="selo-da-rede">
            <span className="dot" aria-hidden="true" />
            <span>{textoDoSelo(rede?.provedoresAtivos)}</span>
          </div>

          <h1>Consulte o CPF <strong>antes</strong> de instalar. <em>Antes de perder.</em></h1>

          <p className="lead">
            A base colaborativa entre provedores de internet. Score de risco em tempo real,
            direto do ERP de toda a rede — para você não ser o próximo a pagar pelo calote.
          </p>

          <div className="metrics">
            <div className="metric pos">
              <div className="val">{CUSTO_EM_CREDITOS.isp}</div>
              <div className="lbl">Crédito por<br />consulta positiva</div>
            </div>
            <div className="metric">
              <div className="val">15<span style={{ fontSize: "0.55em" }}>min</span></div>
              <div className="lbl">Setup via<br />API</div>
            </div>
            <div className="metric warn">
              <div className="val">75<span style={{ fontSize: "0.55em" }}>d</span></div>
              <div className="lbl">Reg. 765<br />sem cortar</div>
            </div>
          </div>

          <div className="guarantees">
            <div className="item"><span className="check" aria-hidden="true">✓</span>Consultas na sua base sempre grátis</div>
            <div className="item"><span className="check" aria-hidden="true">✓</span>Consulta anônima com hash por operação</div>
            <div className="item"><span className="check" aria-hidden="true">✓</span>Conformidade com a LGPD</div>
          </div>
        </section>

        {/* ── CARTÃO ─────────────────────────────────────────────── */}
        <section className="side-form">
          <div className="login-card">

            {pageState === "login" && (
              <>
                <CabecalhoDoCartao titulo="Bem-vindo" destaque="de volta.">
                  Entre com seu e-mail e senha para acessar<br />o painel do seu provedor.
                </CabecalhoDoCartao>
                {isSubdomainMode && tenantInfo?.name && (
                  <p className="email-pendente" style={{ textAlign: "center", margin: "-12px 0 20px" }} data-testid="text-provider-name">
                    {tenantInfo.name.split(" ").slice(0, 2).join(" ")}
                  </p>
                )}

                <form className="form-da-marca" onSubmit={handleSubmit}>
                  <Campo
                    id="login-email" rotulo="E-mail" prefixo="@" data-testid="input-email"
                    type="email" placeholder="voce@seuprovedor.com.br" autoComplete="username" required
                    value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                  <Campo
                    id="login-senha" rotulo="Senha" prefixo="*" data-testid="input-password"
                    type={showPassword ? "text" : "password"} placeholder="••••••••••"
                    autoComplete="current-password" required
                    value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                    acessorio={
                      <button type="button" className="link-forgot" onClick={() => irPara("forgot")}>
                        Esqueci a senha
                      </button>
                    }
                    dentro={
                      <button
                        type="button" className="toggle" data-testid="button-toggle-password"
                        aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? "Ocultar" : "Ver"}
                      </button>
                    }
                  />

                  <label className="field-check">
                    <input
                      type="checkbox" checked={lembrar} data-testid="checkbox-manter-conectado"
                      onChange={(e) => setLembrar(e.target.checked)}
                    />
                    <span>Manter conectado por 30 dias</span>
                  </label>

                  {erroDoLogin && <div className="status visible error" role="alert">{erroDoLogin}</div>}

                  <button type="submit" className="btn btn-primary" disabled={isLoading} data-testid="button-submit-login">
                    {isLoading ? "Entrando..." : <>Entrar na plataforma <span className="arrow" aria-hidden="true">→</span></>}
                  </button>
                </form>

                {/* O reenvio fica visível ANTES de um login recusado: quem nunca recebeu
                    o primeiro e-mail não tem por que adivinhar que precisa errar a senha
                    para achar o botão. */}
                <div className="linha-links">
                  <button
                    type="button" className="link-texto" data-testid="button-nao-recebi-confirmacao"
                    onClick={() => irParaReenvio(form.email.trim())}
                  >
                    Não recebi o e-mail de confirmação
                  </button>
                </div>

                {!isSubdomainMode && (
                  <div className="signup-row">
                    Provedor novo?{" "}
                    <a href="/login?mode=register" onClick={trocarPara("register")} data-testid="button-toggle-register">
                      {convite}
                    </a>
                  </div>
                )}
              </>
            )}

            {pageState === "register" && (
              <>
                <CabecalhoDoCartao titulo="Crie sua" destaque="conta grátis.">
                  {typeof creditosDeBoasVindas === "number" && creditosDeBoasVindas > 0
                    ? `${creditosDeBoasVindas} créditos para testar a rede. Consultas na sua base, sempre grátis.`
                    : "Consultas na sua base, sempre grátis."}
                </CabecalhoDoCartao>
                <CadastroWizard aoPrecisarVerificar={(email) => irParaReenvio(email)} />
                <div className="signup-row">
                  Já tem conta?{" "}
                  <a href="/login" onClick={trocarPara("login")} data-testid="button-toggle-register">Entrar</a>
                </div>
              </>
            )}

            {pageState === "check-email" && (
              <div data-testid="check-email-card">
                <CabecalhoDoCartao titulo="Confirme" destaque="seu e-mail.">
                  {pedirEmailDoReenvio
                    ? "Informe o e-mail do cadastro e enviamos outro link de confirmação."
                    : "Enviamos um link de confirmação para"}
                </CabecalhoDoCartao>
                {!pedirEmailDoReenvio && (
                  <p className="email-pendente" style={{ textAlign: "center", margin: "-16px 0 20px" }} data-testid="text-pending-email">
                    {pendingEmail}
                  </p>
                )}

                <ol className="passos">
                  {[
                    `Abra o e-mail e procure a mensagem do ${marca.nomeProduto}.`,
                    "Clique em \"Confirmar e-mail\".",
                    "Você entra no sistema automaticamente.",
                  ].map((passo, i) => (
                    <li key={passo}><span className="n">{i + 1}</span><span>{passo}</span></li>
                  ))}
                </ol>

                <div className="form-da-marca">
                  {pedirEmailDoReenvio && (
                    <Campo
                      id="reenvio-email" rotulo="E-mail do cadastro" prefixo="@" data-testid="input-reenvio-email"
                      type="email" placeholder="voce@seuprovedor.com.br" autoComplete="username"
                      value={pendingEmail} onChange={(e) => setPendingEmail(e.target.value)}
                    />
                  )}
                  <button
                    type="button" className="btn btn-secondary" data-testid="button-resend-email"
                    onClick={handleResend} disabled={resendLoading || !pendingEmail.trim()}
                  >
                    {resendLoading ? "Enviando..." : "Reenviar e-mail de confirmação"}
                  </button>
                  {resultadoReenvio && (
                    <div
                      role="status" data-testid="text-resultado-reenvio"
                      className={`status visible ${resultadoReenvio.ok ? "success" : "error"}`}
                    >
                      {resultadoReenvio.mensagem}
                    </div>
                  )}
                </div>

                <div className="linha-links">
                  <button type="button" className="link-texto" onClick={() => irPara("login")} data-testid="button-back-to-login">
                    Voltar ao login
                  </button>
                </div>
              </div>
            )}

            {pageState === "forgot" && <EsqueciASenha aoVoltar={() => irPara("login")} />}
            {pageState === "reset" && <NovaSenha aoVoltar={() => irPara("login")} />}

            <div className="card-foot">Conexão criptografada · TLS 1.3</div>
          </div>
        </section>

        {/* ── RODAPÉ ─────────────────────────────────────────────── */}
        <footer className="page-footer">
          <span>© {new Date().getFullYear()} · /consulta.isp · Rede colaborativa de crédito para provedores</span>
          <div className="footer-links">
            <a href="/lgpd" onClick={irParaRota("/lgpd")}>Privacidade</a>
            <a href={WHATSAPP_SUPORTE} target="_blank" rel="noopener noreferrer">Suporte</a>
          </div>
        </footer>

      </main>
    </div>
  );
}
