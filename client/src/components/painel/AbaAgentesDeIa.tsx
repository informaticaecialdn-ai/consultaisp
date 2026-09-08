/**
 * Painel do Provedor > aba Agentes de IA — o console do Chat BullQ por dentro.
 *
 * São os mesmos objetos do `/ai-agents` do fork (agente, skill, conexão,
 * execução) e a mesma loja: o fork continua guardando e executando. O que muda
 * é a porta — a organização sai do `providerId` da sessão, e ninguém digita
 * organização nem vê token.
 *
 * MUDOU DE CASA em 07/09/2026, a pedido do dono ("agentes de IA tem que estar
 * dentro de painel do provedor"). Nasceu como a página `/agentes`, item próprio
 * no menu de Gestão; virou aba daqui, que é onde mora todo o resto da
 * configuração do provedor — empresa, usuários, ERP, chat, anti-fraude,
 * cobrança. É o mesmo movimento que a política de cobrança fez um dia antes, e
 * pela mesma razão: configurar quem fala com o cliente não é trabalho do dia,
 * é ajuste do provedor. O endereço antigo continua roteado como
 * REDIRECIONAMENTO, com a sub-aba preservada.
 *
 * A sub-aba viaja em `?aba=`, ao lado do `?tab=` do painel — dois parâmetros,
 * dois níveis, e um link colado abre exatamente onde a pessoa estava.
 */
import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CabecalhoPainel } from "@/components/painel/ui";
import { cn } from "@/lib/utils";
import { AbaAgentes } from "@/components/agentes/AbaAgentes";
import { AbaSkills } from "@/components/agentes/AbaSkills";
import { AbaConexoes } from "@/components/agentes/AbaConexoes";
import { AbaExecucoes, AbaResumo } from "@/components/agentes/AbaExecucoes";
import { ABAS_DO_CONSOLE, abaValida, ROTA_AGENTES, type AbaDoConsole } from "@/components/agentes/tipos";

interface EstadoDaIntegracao { ligado?: boolean; canal?: { id: string } | null }

export function AbaAgentesDeIa({ podeAdministrar }: { podeAdministrar: boolean }) {
  const [, navegar] = useLocation();
  // `useLocation` do wouter devolve SÓ o caminho — a query fica de fora, e ler
  // a sub-aba de dentro dele deixava a tela presa no resumo para sempre. Quem
  // enxerga a query é `useSearch`.
  const busca = useSearch();
  const daUrl = abaValida(new URLSearchParams(busca).get("aba"));
  const [aba, setAba] = useState<AbaDoConsole>(daUrl);
  useEffect(() => { setAba(daUrl); }, [daUrl]);

  const integracao = useQuery<EstadoDaIntegracao>({
    queryKey: ["/api/chat-bullq/integracao"], staleTime: 60_000, retry: false,
  });
  const semChat = integracao.data ? integracao.data.ligado === false : false;

  // `ROTA_AGENTES` já carrega `?tab=agentes`; a sub-aba entra com `&`. Trocar
  // por `?` derrubaria a aba do painel e a tela voltaria para a Visão Geral.
  const trocar = (proxima: AbaDoConsole) => {
    setAba(proxima);
    navegar(`${ROTA_AGENTES}&aba=${proxima}`, { replace: true });
  };

  return (
    <div className="space-y-4" data-testid="painel-agentes">
      <CabecalhoPainel
        titulo="Agentes de IA"
        nivel="h2"
        descricao="Quem conversa com o cliente por você: o papel de cada agente, o que ele pode executar e o que já executou."
        testIdTitulo="titulo-agentes"
      />

      {semChat && (
        <p className="rounded-md border border-[var(--gated-border)] bg-[var(--gated-bg)] p-3 text-[12.5px] leading-5 text-[var(--gated)]">
          O chat ainda não está ligado neste provedor. Os agentes vivem no atendimento — ligue a integração na{" "}
          <Link href="/painel-provedor?tab=chat" className="underline underline-offset-2">aba Chat</Link>{" "}
          antes de configurar.
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
