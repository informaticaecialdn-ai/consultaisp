/**
 * O fluxo da porta de entrada — entrar, criar conta, confirmar e-mail,
 * esqueci/redefinir senha — sem nenhum visual.
 *
 * Existem DUAS telas para ele (10/09/2026): a da plataforma, no desenho
 * "/consulta.isp" (`login-plataforma.tsx`), e a do revendedor, neutra e com a
 * marca dele (`login.tsx`). A regra de negocio mora aqui uma vez so; o que muda
 * entre as duas e so como cada uma mostra o mesmo estado.
 */
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useMarca } from "@/lib/marca";
import { getSubdomain } from "@/lib/subdomain";
import { reenviarVerificacao, type ResultadoDeReenvio } from "@/lib/verificacao-email";

export type PageState = "login" | "register" | "check-email" | "forgot" | "reset";

export type RespostaDeSenha = { ok: true } | { ok: false; mensagem: string };

/** O token do link de redefinicao, quando a pessoa chegou por ele. */
export function tokenDeRedefinicao(): string {
  return new URLSearchParams(window.location.search).get("reset") || "";
}

/**
 * Em que estado a tela abre.
 *
 * Link de redefinicao manda sempre. No modo tenant nao ha cadastro publico —
 * `?mode=register` num dominio de revendedor abriria provedor novo a partir da
 * marca dele —, entao ali o parametro e ignorado.
 */
export function estadoInicial(modoTenant: boolean): PageState {
  const params = new URLSearchParams(window.location.search);
  if (params.get("reset")) return "reset";
  if (modoTenant) return "login";
  return params.get("mode") === "register" ? "register" : "login";
}

/** POST /api/auth/forgot-password — a resposta e a mesma exista a conta ou nao. */
export async function pedirLinkDeSenha(email: string): Promise<RespostaDeSenha> {
  try {
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, mensagem: data.message || "Não foi possível enviar o link agora. Tente de novo em instantes." };
  } catch {
    return { ok: false, mensagem: "Sem conexão com o servidor. Confira a internet e tente de novo." };
  }
}

/** POST /api/auth/reset-password com o token do link. */
export async function redefinirSenha(token: string, novaSenha: string): Promise<RespostaDeSenha> {
  try {
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: novaSenha }),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, mensagem: data.message || "Não foi possível redefinir a senha. Peça um link novo." };
  } catch {
    return { ok: false, mensagem: "Sem conexão com o servidor. Confira a internet e tente de novo." };
  }
}

type Opcoes = {
  /** A tela do revendedor avisa por toast; a da plataforma mostra no cartao. */
  aoFalharLogin?: (mensagem: string) => void;
  aoReenviar?: (resultado: ResultadoDeReenvio) => void;
};

export function useFluxoDeLogin(opcoes: Opcoes = {}) {
  const { login } = useAuth();
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

  const [pageState, setPageState] = useState<PageState>(() => estadoInicial(isSubdomainMode));
  const [isLoading, setIsLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [resultadoReenvio, setResultadoReenvio] = useState<ResultadoDeReenvio | null>(null);
  const [erroDoLogin, setErroDoLogin] = useState<string | null>(null);
  /** "Manter conectado por 30 dias". Desmarcado e o de hoje: 48 horas. */
  const [lembrar, setLembrar] = useState(false);
  /**
   * A tela de "verifique seu e-mail" pode ser alcancada de tres lugares, e num
   * deles o endereco ainda nao e sabido: o atalho "não recebi o e-mail" com o
   * campo de login vazio. So nesse caso ela pede o endereco; vindo do cadastro
   * ou de um login recusado por e-mail nao verificado, o endereco ja e certo e
   * um campo editavel so convidaria a digitar errado.
   */
  const [pedirEmailDoReenvio, setPedirEmailDoReenvio] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  const irParaReenvio = (email: string) => {
    setPendingEmail(email);
    setPedirEmailDoReenvio(!email);
    setResultadoReenvio(null);
    setPageState("check-email");
  };

  const irPara = (estado: PageState) => {
    setErroDoLogin(null);
    setPageState(estado);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErroDoLogin(null);
    setIsLoading(true);
    try {
      await login(form.email, form.password, lembrar);
    } catch (err: any) {
      if (err.code === "EMAIL_NOT_VERIFIED") {
        irParaReenvio(err.email || form.email);
        return;
      }
      const mensagem = err.message || "Confira o e-mail e a senha e tente de novo.";
      setErroDoLogin(mensagem);
      opcoes.aoFalharLogin?.(mensagem);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * O reenvio passa por `reenviarVerificacao`, que preserva o STATUS.
   *
   * Com `apiRequest` toda resposta ruim virava um `Error` sem status, e o 429
   * do limitador — "seu pedido anterior saiu, espere" — era mostrado como
   * "Nao foi possivel reenviar. Tente novamente", que e um convite a clicar de
   * novo e empurrar a espera para mais longe.
   */
  const handleResend = async () => {
    const alvo = pendingEmail.trim();
    if (!alvo || resendLoading) return;
    setResendLoading(true);
    setResultadoReenvio(null);
    const resultado = await reenviarVerificacao(alvo);
    setResultadoReenvio(resultado);
    setResendLoading(false);
    opcoes.aoReenviar?.(resultado);
  };

  return {
    marca, isSubdomainMode, tenantInfo,
    pageState, irPara,
    form, setForm, lembrar, setLembrar, showPassword, setShowPassword,
    isLoading, erroDoLogin, handleSubmit,
    pendingEmail, setPendingEmail, pedirEmailDoReenvio, resultadoReenvio, resendLoading,
    irParaReenvio, handleResend,
  };
}
