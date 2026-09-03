import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2, RefreshCw } from "lucide-react";
import Marca from "@/components/marca";
import {
  enderecoDeLoginDoServidor,
  reenviarVerificacao,
  type ResultadoDeReenvio,
} from "@/lib/verificacao-email";

type Status = "verifying" | "success" | "error" | "expired";

/**
 * Pedir outro link, com o endereco em maos.
 *
 * Vivia so no estado `expired`. O estado `error` — token ja usado, malformado
 * ou ausente, que e onde cai quem clica no link duas vezes ou cujo cliente de
 * e-mail cortou a URL — oferecia apenas "Ir para o login": uma saida que nao
 * resolve, porque sem o e-mail confirmado o login recusa. A pessoa ficava sem
 * caminho nenhum a partir dali.
 */
function BlocoDeReenvio({ testId }: { testId: string }) {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDeReenvio | null>(null);

  const pedir = async () => {
    if (!email.trim() || enviando) return;
    setEnviando(true);
    setResultado(null);
    setResultado(await reenviarVerificacao(email.trim()));
    setEnviando(false);
  };

  if (resultado?.ok) {
    return (
      <div className="bg-[var(--color-success-bg)] rounded p-4 text-center" data-testid={`${testId}-ok`}>
        <CheckCircle className="w-5 h-5 text-[var(--color-success)] mx-auto mb-2" />
        <p className="text-sm font-medium text-[var(--color-success)]">{resultado.mensagem}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-left">
      <label className="text-sm font-medium block text-[var(--color-ink)]" htmlFor={`${testId}-input`}>
        seu e-mail
      </label>
      <input
        id={`${testId}-input`}
        type="email"
        placeholder="voce@provedor.com.br"
        className="w-full border border-[var(--border)] rounded px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-ink)]"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        data-testid="input-resend-email"
      />
      <Button
        className="w-full gap-2"
        onClick={pedir}
        disabled={enviando || !email.trim()}
        data-testid={testId}
      >
        <RefreshCw className={`w-4 h-4 ${enviando ? "animate-spin" : ""}`} />
        {enviando ? "Enviando..." : "Reenviar link de verificação"}
      </Button>
      {resultado && !resultado.ok && (
        <p
          role="status"
          className="text-sm text-[var(--color-danger)] bg-[var(--color-danger-bg)] rounded px-3 py-2"
          data-testid={`${testId}-erro`}
        >
          {resultado.mensagem}
        </p>
      )}
    </div>
  );
}

export default function VerificarEmailPage() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<Status>("verifying");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setStatus("error");
      setErrorMessage("Link de verificação inválido ou incompleto.");
      return;
    }

    verify(token);
  }, []);

  /**
   * Manda para a tela de acesso do provedor, e nao para `/login` no host atual.
   *
   * O destino sai do CORPO DA RESPOSTA do servidor — nunca da URL desta pagina,
   * que qualquer um monta. `enderecoDeLoginDoServidor` ainda descarta caminho e
   * query do que recebe, entao o pior caso continua sendo uma tela de login.
   */
  const irParaOAcesso = (urlDoServidor: unknown) => {
    const destino = enderecoDeLoginDoServidor(urlDoServidor);
    if (!destino || new URL(destino).host === window.location.host) {
      navigate("/login");
      return;
    }
    window.location.assign(destino);
  };

  const verify = async (token: string) => {
    setStatus("verifying");
    try {
      const res = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
        credentials: "include",
      });
      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setTimeout(() => irParaOAcesso(data.urlDeEntrada), 2500);
      } else {
        if (data.code === "TOKEN_EXPIRED") {
          setStatus("expired");
        } else {
          setStatus("error");
        }
        setErrorMessage(data.message || "Erro ao verificar e-mail.");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Erro de conexão. Tente novamente.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-6" data-testid="verificar-email-page">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <Marca tamanho={36} />
        </div>

        <Card className="p-8 text-center" data-testid="verify-status-card">
          {status === "verifying" && (
            <>
              <div className="w-16 h-16 rounded-full bg-[var(--color-brand-bg)] flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 text-[var(--color-brand)] animate-spin" />
              </div>
              <h2 className="text-xl font-semibold mb-2" data-testid="text-verify-status">Verificando seu e-mail...</h2>
              <p className="text-[var(--color-muted)] text-sm">Aguarde um momento.</p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="w-16 h-16 rounded-full bg-[var(--color-success-bg)] flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-[var(--color-success)]" />
              </div>
              <h2 className="text-xl font-semibold mb-2 text-[var(--color-success)]" data-testid="text-verify-status">E-mail verificado</h2>
              <p className="text-[var(--color-muted)] text-sm mb-6">
                Seu e-mail foi confirmado. Você será levado à tela de acesso do seu provedor em instantes.
              </p>
              <div className="w-full bg-[var(--surface-inset)] rounded h-1.5">
                <div className="bg-[var(--color-success)] h-1.5 rounded animate-pulse w-full" />
              </div>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-16 h-16 rounded-full bg-[var(--color-danger-bg)] flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-[var(--color-danger)]" />
              </div>
              <h2 className="text-xl font-semibold mb-2" data-testid="text-verify-status">Link inválido</h2>
              <p className="text-[var(--color-muted)] text-sm mb-6">
                {errorMessage} Se você já confirmou antes, use o link abaixo para receber outro e confira depois se consegue entrar.
              </p>

              <BlocoDeReenvio testId="button-resend-from-error" />

              <button
                type="button"
                className="mt-4 text-sm text-[var(--color-brand)] hover:underline"
                onClick={() => navigate("/login")}
                data-testid="button-back-home"
              >
                Ir para o login
              </button>
            </>
          )}

          {status === "expired" && (
            <>
              <div className="w-16 h-16 rounded-full bg-[var(--color-gold-bg)] flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-[var(--color-gold)]" />
              </div>
              <h2 className="text-xl font-semibold mb-2" data-testid="text-verify-status">Link expirado</h2>
              <p className="text-[var(--color-muted)] text-sm mb-6">
                O link de verificação expirou (validade de 24 horas). Informe seu e-mail para receber um novo.
              </p>

              <BlocoDeReenvio testId="button-resend-from-expired" />

              <button
                type="button"
                className="mt-4 text-sm text-[var(--color-brand)] hover:underline"
                onClick={() => navigate("/login")}
                data-testid="button-back-login-expired"
              >
                Voltar ao login
              </button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
