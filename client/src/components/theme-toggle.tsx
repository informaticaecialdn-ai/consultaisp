import { Moon, Sun } from "lucide-react";
import { FOCO } from "@/components/painel/ui";
import { cn } from "@/lib/utils";

/**
 * Alterna claro/escuro.
 *
 * O tema escuro inteiro ja existia em index.css desde a v3.0, mas nada nunca
 * aplicava a classe — metade dos tokens era codigo morto.
 *
 * Quem aplica o tema e o script inline em client/index.html, que roda ANTES do
 * primeiro paint (sem flash de tema errado). Este botao so grava a preferencia
 * e recarrega.
 *
 * Por que recarregar em vez de so trocar a classe: alternando em runtime o
 * navegador nao reinvalidava as custom properties — a classe mudava e as cores
 * continuavam as anteriores. Forcar reflow nao resolveu. Recarregar e o caminho
 * confiavel, e a troca de tema nao e acao de alta frequencia.
 */

const CHAVE = "consultaisp-tema";

function temaAtual(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export default function ThemeToggle() {
  const atual = typeof document !== "undefined" ? temaAtual() : "light";
  const proximo = atual === "dark" ? "light" : "dark";

  const trocar = () => {
    try { localStorage.setItem(CHAVE, proximo); } catch { /* modo privado: ignora */ }
    window.location.reload();
  };

  return (
    <button
      type="button"
      onClick={trocar}
      data-testid="button-theme-toggle"
      aria-label={proximo === "dark" ? "Ativar tema escuro" : "Ativar tema claro"}
      title={proximo === "dark" ? "Tema escuro" : "Tema claro"}
      className={cn(
        // 32px no mouse (a barra e densa), 44x44 no dedo — secao 7 fala dos DOIS
        // eixos, e o botao e quadrado.
        "w-8 h-8 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11",
        "grid place-items-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-strong)]",
        FOCO,
        "motion-safe:transition-colors",
      )}
    >
      {atual === "dark" ? <Sun className="w-4 h-4" strokeWidth={2} /> : <Moon className="w-4 h-4" strokeWidth={2} />}
    </button>
  );
}
