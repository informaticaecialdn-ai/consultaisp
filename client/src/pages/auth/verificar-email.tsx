import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, CheckCircle, XCircle, Loader2, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

type Status = "verifying" | "success" | "error" | "expired";

export default function VerificarEmailPage() {
  const [, navigate] = useLocation();
  const { login } = useAuth();
  const [status, setStatus] = useState<Status>("verifying");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setStatus("error");
      setErrorMessage("Link de verificacao invalido ou incompleto.");
      return;
    }

    verify(token);
  }, []);

  const verify = async (token: string) => {
    setStatus("verifying");
    try {
      const res = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
        credentials: "include",
      });
      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setTimeout(() => navigate("/login"), 2500);
      } else {
        if (data.code === "TOKEN_EXPIRED") {
          setStatus("expired");
        } else {
          setStatus("error");
        }
        setErrorMessage(data.message || "Erro ao verificar email.");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Erro de conexao. Tente novamente.");
    }
  };

  const [resendEmail, setResendEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone, setResendDone] = useState(false);

  const handleResend = async () => {
    if (!resendEmail) return;
    setResendLoading(true);
    try {
      await apiRequest("POST", "/api/auth/resend-verification", { email: resendEmail });
      setResendDone(true);
    } catch {
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800 p-6" data-testid="verificar-email-page">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold">Consulta ISP</span>
        </div>

        <Card className="p-8 text-center" data-testid="verify-status-card">
          {status === "verifying" && (
            <>
              <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              </div>
              <h2 className="text-xl font-bold mb-2" data-testid="text-verify-status">Verificando seu email...</h2>
              <p className="text-muted-foreground text-sm">Aguarde um momento.</p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold mb-2 text-emerald-700 dark:text-emerald-400" data-testid="text-verify-status">Email verificado!</h2>
              <p className="text-muted-foreground text-sm mb-6">
                Seu email foi confirmado com sucesso. Voce sera redirecionado para o sistema em instantes.
              </p>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div className="bg-emerald-500 h-1.5 rounded-full animate-pulse w-full" />
              </div>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-950 flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-red-600" />
              </div>
              <h2 className="text-xl font-bold mb-2" data-testid="text-verify-status">Link invalido</h2>
              <p className="text-muted-foreground text-sm mb-6">{errorMessage}</p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate("/")}
                data-testid="button-back-home"
              >
                Ir para o login
              </Button>
            </>
          )}

          {status === "expired" && (
            <>
              <div className="w-16 h-16 rounded-full bg-amber-50 dark:bg-amber-950 flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-amber-600" />
              </div>
              <h2 className="text-xl font-bold mb-2" data-testid="text-verify-status">Link expirado</h2>
              <p className="text-muted-foreground text-sm mb-6">
                O link de verificacao expirou (validade de 24 horas). Informe seu email para receber um novo link.
              </p>

              {resendDone ? (
                <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-4 text-center">
                  <CheckCircle className="w-5 h-5 text-emerald-600 mx-auto mb-2" />
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Novo link enviado! Verifique seu email.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <input
                    type="email"
                    placeholder="seu@email.com"
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    data-testid="input-resend-email"
                  />
                  <Button
                    className="w-full gap-2"
                    onClick={handleResend}
                    disabled={resendLoading || !resendEmail}
                    data-testid="button-resend-from-expired"
                  >
                    <RefreshCw className={`w-4 h-4 ${resendLoading ? "animate-spin" : ""}`} />
                    {resendLoading ? "Enviando..." : "Reenviar link de verificacao"}
                  </Button>
                  <button
                    type="button"
                    className="text-sm text-blue-600"
                    onClick={() => navigate("/")}
                    data-testid="button-back-login-expired"
                  >
                    Voltar ao login
                  </button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
