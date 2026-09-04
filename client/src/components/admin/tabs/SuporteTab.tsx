import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MessageSquare, Globe, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { Selo, ALVO_CONTROLE, FOCO, type Icone } from "@/components/painel/ui";
import ChatPanel from "../ChatPanel";
import BuscaConsulta from "../BuscaConsulta";

/**
 * A busca por codigo mora aqui, e nao numa aba propria, porque e a mesma
 * pessoa no mesmo momento: o provedor abre um chamado dizendo "a consulta
 * CI-2609-K7F3M2 deu erro", e quem le a mensagem precisa da ficha ao lado da
 * conversa — nao a duas abas de distancia.
 *
 * ROUPA NOVA, MESMO COMPORTAMENTO. As tres sub-abas eram pilulas cheias da cor
 * de marca escrita na API antiga de token; agora sao a MESMA barra de abas da
 * Consulta ISP (`pages/consulta/consulta-isp.tsx`), que e a tela ja reescrita
 * contra o handoff: sublinhado de 2px na cor da marca, rotulo em `--text`
 * quando ativo e `--text-muted` quando nao. Nenhuma consulta, endpoint,
 * intervalo de refetch ou data-testid mudou.
 *
 * BUG CORRIGIDO DE PASSAGEM: a classe de fundo do contador de nao lidas
 * terminava com um `0` solto, sobra de uma substituicao de cor — com o digito
 * grudado no fim, o nome nao e mais uma classe que o Tailwind gere, e nenhum
 * fundo era emitido. O resultado era texto branco sobre transparente: o numero
 * de mensagens esperando resposta estava INVISIVEL nas duas abas. Agora ele e
 * um `Selo`, mono e tabular como todo numero.
 */

/** As sub-abas, na ordem em que a pessoa do suporte trabalha: primeiro quem
 *  paga, depois quem ainda nao e cliente, e por fim a ficha de uma consulta
 *  especifica citada numa das duas conversas. */
const ABAS: Array<{ id: Aba; rotulo: string; Icone: Icone; testId: string }> = [
  { id: "provedores", rotulo: "Provedores", Icone: MessageSquare, testId: "tab-support-providers" },
  { id: "visitantes", rotulo: "Visitantes do site", Icone: Globe, testId: "tab-support-visitors" },
  { id: "consulta", rotulo: "Buscar consulta", Icone: ScanSearch, testId: "tab-support-consulta" },
];

type Aba = "provedores" | "visitantes" | "consulta";

export default function SuporteTab() {
  const [sub, setSub] = useState<Aba>("provedores");

  const { data: chatThreads = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/chat/threads"],
    refetchInterval: 10000,
  });

  const { data: visitorChats = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/visitor-chats"],
    refetchInterval: 10000,
  });

  const providerUnread = chatThreads.reduce((s: number, t: any) => s + (t.unreadCount || 0), 0);
  const visitorUnread = visitorChats.reduce((s: number, c: any) => s + (c.unreadCount || 0), 0);

  /* Nao lidas por aba. O contador so aparece quando ha o que responder — um
     zero permanente ao lado do rotulo vira ruido e ensina a ignorar o numero. */
  const NAO_LIDAS: Record<Aba, number> = {
    provedores: providerUnread,
    visitantes: visitorUnread,
    consulta: 0,
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Seções do suporte"
        className="flex flex-wrap gap-0.5 border-b border-[var(--border)] mb-4"
      >
        {ABAS.map(({ id, rotulo, Icone: IconeAba, testId }) => {
          const ativa = sub === id;
          const naoLidas = NAO_LIDAS[id];
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`aba-suporte-${id}`}
              aria-selected={ativa}
              aria-controls={`painel-suporte-${id}`}
              onClick={() => setSub(id)}
              data-testid={testId}
              /* O anel de foco vem de `FOCO`. Escrito a mao — como estava aqui —
                 e facil perder a metade que pinta: `outline-2` sozinho so emite
                 a largura, e o anel fica invisivel sem ninguem notar ate testar
                 com o teclado. */
              className={cn(
                "inline-flex items-center gap-2 px-3.5 -mb-px text-[13px]",
                ALVO_CONTROLE,
                "border-b-2 motion-safe:transition-colors",
                FOCO,
                ativa
                  ? "border-[var(--brand)] text-[var(--text)] font-semibold"
                  : "border-transparent text-[var(--text-muted)] font-medium hover:text-[var(--text)]",
              )}
            >
              <IconeAba className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
              {rotulo}
              {naoLidas > 0 && (
                <Selo tom="marca" className="tabular-nums">
                  {naoLidas}
                  <span className="sr-only"> não lidas</span>
                </Selo>
              )}
            </button>
          );
        })}
      </div>

      {sub === "consulta" && (
        <div role="tabpanel" id="painel-suporte-consulta" aria-labelledby="aba-suporte-consulta">
          <BuscaConsulta />
        </div>
      )}
      {sub === "provedores" && (
        <div role="tabpanel" id="painel-suporte-provedores" aria-labelledby="aba-suporte-provedores">
          <ChatPanel
            variant="provider"
            threads={chatThreads}
            baseEndpoint="/api/admin/chat/threads"
            threadsQueryKey={["/api/admin/chat/threads"]}
          />
        </div>
      )}
      {sub === "visitantes" && (
        <div role="tabpanel" id="painel-suporte-visitantes" aria-labelledby="aba-suporte-visitantes">
          <ChatPanel
            variant="visitor"
            threads={visitorChats}
            baseEndpoint="/api/admin/visitor-chats"
            threadsQueryKey={["/api/admin/visitor-chats"]}
          />
        </div>
      )}
    </div>
  );
}
