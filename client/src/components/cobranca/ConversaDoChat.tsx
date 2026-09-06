import { Link, useSearch } from "wouter";
import { Atendimento } from "@/components/chat/Atendimento";
import { BOTAO_CHAT_MARCA, LINK_CHAT } from "@/components/chat/PerfilDoCliente";
import { rotaChat } from "@/components/chat/tipos";
import type { ChatDoCaso } from "./tipos";

/** O bloco do chat na ficha do cliente 360. O atendimento é o daqui (Atendimento
 *  compacto) — o inbox externo do Chat BullQ não entra mais, por isso não há
 *  `inboxUrl`; e o caso já vem dentro de `chat`, por isso não há `casoId`. */
export function ConversaDoChat({
  chat,
  onEnviar,
  enviando,
}: {
  chat: ChatDoCaso | null;
  onEnviar?: () => void;
  enviando?: boolean;
}) {
  const search = useSearch();
  const carteira = new URLSearchParams(search).get("carteira") ?? "ativo";
  return (
    <div
      data-testid="conversa-do-chat"
      className="overflow-hidden rounded-lg border border-[var(--border)]"
    >
      {chat ? (
        <>
          <div className="flex items-center justify-between gap-3 p-3 text-xs">
            <strong>Conversa com o cliente</strong>
            <Link
              href={rotaChat("cobranca", chat.conversationId, carteira)}
              className={LINK_CHAT}
            >
              Abrir atendimento completo →
            </Link>
          </div>
          <Atendimento
            conversationId={chat.conversationId}
            origem="cobranca"
            compacto
          />
        </>
      ) : (
        <div className="space-y-2 p-3 text-xs text-[var(--text-muted)]">
          <p>
            O assistente inicia o contato. A resposta será encaminhada ao
            atendimento humano.
          </p>
          {onEnviar && (
            <button
              type="button"
              className={BOTAO_CHAT_MARCA}
              disabled={enviando}
              onClick={onEnviar}
            >
              {enviando ? "Iniciando…" : "Iniciar contato"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
