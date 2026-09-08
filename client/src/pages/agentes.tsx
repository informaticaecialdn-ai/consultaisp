/**
 * Agentes de IA — o console do provedor.
 *
 * É o `/ai-agents` do Chat BullQ trazido para dentro do Consulta ISP: os
 * mesmos objetos (agente, skill, conexão, execução), a mesma loja (o fork
 * continua guardando e executando), com a organização resolvida pelo provedor
 * da sessão. Ninguém aqui digita organização nem vê token.
 *
 * A aba vive na URL (`?aba=`) para que um link colado abra onde a pessoa
 * estava — o mesmo acordo do Painel do Provedor.
 */
import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Bot, ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { CabecalhoPainel } from "@/components/painel/ui";
import { cn } from "@/lib/utils";
import { AbaAgentes } from "@/components/agentes/AbaAgentes";
import { AbaSkills } from "@/components/agentes/AbaSkills";
import { AbaConexoes } from "@/components/agentes/AbaConexoes";
import { AbaExecucoes, AbaResumo } from "@/components/agentes/AbaExecucoes";
import { ABAS_DO_CONSOLE, abaValida, ROTA_AGENTES, type AbaDoConsole } from "@/components/agentes/tipos";

interface EstadoDaIntegracao { ligado?: boolean; canal?: { id: string } | null }

export default function AgentesPage() {
  const [, navegar] = useLocation();
  // `useLocation` do wouter devolve SÓ o caminho — a query fica de fora, e ler
  // a aba de dentro dele deixava a tela presa no resumo para sempre. Quem
  // enxerga a query é `useSearch`.
  const busca = useSearch();
  const { user } = useAuth();
  const podeAdministrar = user?.role === "admin" || user?.role === "superadmin";

  const daUrl = abaValida(new URLSearchParams(busca).get("aba"));
  const [aba, setAba] = useState<AbaDoConsole>(daUrl);
  useEffect(() => { setAba(daUrl); }, [daUrl]);

  const integracao = useQuery<EstadoDaIntegracao>({
    queryKey: ["/api/chat-bullq/integracao"], staleTime: 60_000, retry: false,
  });
  const semChat = integracao.data ? integracao.data.ligado === false : false;

  const trocar = (proxima: AbaDoConsole) => {
    setAba(proxima);
    navegar(`${ROTA_AGENTES}?aba=${proxima}`, { replace: true });
  };

  return (
    <div className="space-y-5 p-4 sm:p-6" data-testid="pagina-agentes">
      <CabecalhoPainel
        titulo={<span className="inline-flex items-center gap-2"><Bot className="h-5 w-5 text-[var(--brand)]" aria-hidden /> Agentes de IA</span>}
        descricao="Quem conversa com o cliente por você: o papel de cada agente, o que ele pode executar e o que já executou."
        testIdTitulo="titulo-agentes"
      />

      {semChat && (
        <p className="rounded-md border border-[var(--gated-border)] bg-[var(--gated-bg)] p-3 text-[12.5px] leading-5 text-[var(--gated)]">
          O chat ainda não está ligado neste provedor. Os agentes vivem no atendimento — ligue a integração em{" "}
          <a href="/painel-provedor?tab=chat" className="underline underline-offset-2">Painel do Provedor → Chat</a>{" "}
          <ExternalLink className="inline h-3 w-3" aria-hidden /> antes de configurar.
        </p>
      )}

      <div role="tablist" aria-label="Seções do console de agentes"
        className="flex flex-wrap gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-inset)] p-1">
        {ABAS_DO_CONSOLE.map(a => (
          <button
            key={a.chave} role="tab" aria-selected={aba === a.chave}
            onClick={() => trocar(a.chave)}
            className={cn(
              "min-h-[36px] rounded px-3 text-[12.5px] font-medium motion-safe:transition-colors",
              aba === a.chave
                ? "bg-[var(--surface)] text-[var(--text)] shadow-[0_0_0_1px_var(--border)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-2)]",
            )}
            data-testid={`console-aba-${a.chave}`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba === "resumo" && <AbaResumo />}
      {aba === "agentes" && <AbaAgentes podeAdministrar={podeAdministrar} />}
      {aba === "skills" && <AbaSkills podeAdministrar={podeAdministrar} />}
      {aba === "conexoes" && <AbaConexoes podeAdministrar={podeAdministrar} />}
      {aba === "execucoes" && <AbaExecucoes />}
    </div>
  );
}
