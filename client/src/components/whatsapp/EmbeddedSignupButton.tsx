import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageCircle, Loader2 } from "lucide-react";

interface Props {
  className?: string;
  size?: "default" | "sm" | "lg";
}

/**
 * Botão para iniciar o fluxo de Embedded Signup da Meta WhatsApp Business.
 * Redireciona para /auth/whatsapp/initiate (handler backend abre popup FB.login).
 */
export function EmbeddedSignupButton({ className, size = "lg" }: Props) {
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    setLoading(true);
    window.location.href = "/auth/whatsapp/initiate";
  };

  return (
    <Button
      onClick={handleClick}
      disabled={loading}
      size={size}
      className={className}
      data-testid="button-whatsapp-connect"
    >
      {loading ? (
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
      ) : (
        <MessageCircle className="w-5 h-5 mr-2" />
      )}
      {loading ? "Redirecionando..." : "Conectar Meta WhatsApp Business"}
    </Button>
  );
}
