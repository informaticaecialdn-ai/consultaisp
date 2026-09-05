/**
 * A conversa do caso no Chat BullQ, vista de dentro da ficha 360.
 *
 * Pedido do dono (05/09/2026): o funcionario conversa com o cliente que vai
 * cobrar "direto aqui no sistema". A conversa vive no Chat BullQ (o inbox de
 * la e onde se responde); aqui a ficha mostra o estado dela e as ultimas
 * mensagens, e leva ao inbox com um clique. Sem conversa ainda, o bloco e o
 * proprio botao de enviar.
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, MessageSquareShare, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { BOTAO_SECUNDARIO } from "@/components/painel/ui";
import { dataHoraBr } from "./formatacao";
import { apiConversaDoCaso, type ChatDoCaso } from "./tipos";
import { SeloCobranca, Traco } from "./ui";

interface MensagemDaConversa { id: string; direcao: "INBOUND" | "OUTBOUND"; texto: string | null; status: string | null; quem: string | null; em: string }
interface ConversaDoCasoResposta { conversationId: string; status: string; abertaEm: string; ultimoEventoEm: string | null; inboxUrl: string; mensagens: MensagemDaConversa[]; erro: string | null }

const ROTULO_STATUS: Record<string, string> = { PENDING: "aguardando atendente", BOT: "com o agente", OPEN: "em atendimento", WAITING: "aguardando cliente", CLOSED: "encerrada" };
const TOM_STATUS: Record<string, "info" | "gated" | "ok" | "neutro"> = { PENDING: "gated", BOT: "info", OPEN: "ok", WAITING: "gated", CLOSED: "neutro" };

export function ConversaDoChat({ casoId, chat, inboxUrl, onEnviar, enviando }: {
  casoId: number;
  chat: ChatDoCaso | null;
  inboxUrl: string | null;
  onEnviar?: () => void;
  enviando?: boolean;
}) {
  const { data, isFetching, refetch, isError } = useQuery<ConversaDoCasoResposta>({
    queryKey: [apiConversaDoCaso(casoId)],
    enabled: chat !== null,
    staleTime: 30_000,
  });
  const status = data?.status ?? chat?.status ?? null;
  const link = data?.inboxUrl ?? inboxUrl;

  return (
    <div className="flex flex-col gap-1.5" data-testid="conversa-do-chat">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">Conversa · chat</span>
        {status && <SeloCobranca tom={TOM_STATUS[status] ?? "neutro"} className="normal-case tracking-normal" testId="status-conversa-chat">{ROTULO_STATUS[status] ?? status.toLowerCase()}</SeloCobranca>}
        {chat && <button type="button" className="ml-auto text-[var(--text-faint)] hover:text-[var(--text)]" onClick={() => refetch()} aria-label="Atualizar conversa" title="Atualizar"><RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} aria-hidden /></button>}
      </div>

      {!chat ? (
        <div className="text-[12.5px] text-[var(--text-muted)]">
          ainda não enviado para o chat
          {onEnviar && (
            <button type="button" className={cn(BOTAO_SECUNDARIO, "ml-2 h-8 px-2.5 text-[11.5px]")} disabled={enviando} onClick={onEnviar} data-testid="conversa-enviar-chat">
              <MessageSquareShare className="h-3 w-3" aria-hidden /> {enviando ? "Enviando…" : "Enviar para cobrança"}
            </button>
          )}
        </div>
      ) : (
        <>
          {isError || data?.erro ? (
            <p className="text-[11.5px] text-[var(--text-muted)]">a conversa existe, mas o chat não respondeu agora{data?.erro ? ` — ${data.erro}` : ""}</p>
          ) : (data?.mensagens.length ?? 0) === 0 ? (
            <p className="text-[11.5px] text-[var(--text-muted)]">{data ? "sem mensagens ainda" : "carregando…"}</p>
          ) : (
            <ul className="flex max-h-[220px] flex-col gap-1 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2" data-testid="mensagens-do-chat">
              {data!.mensagens.slice(-8).map(m => (
                <li key={m.id} className={cn("max-w-[92%] rounded-lg px-2.5 py-1.5 text-[12px] leading-4", m.direcao === "OUTBOUND" ? "self-end bg-[var(--brand-soft)] text-[var(--brand-ink)]" : "self-start border border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)]")}>
                  {m.texto ?? <Traco titulo="mensagem sem texto (mídia)" />}
                  <span className="mt-0.5 block font-mono text-[9.5px] tabular-nums text-[var(--text-faint)]">{m.quem ? `${m.quem} · ` : ""}{dataHoraBr(m.em)}{m.status ? ` · ${m.status.toLowerCase()}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
          {link && (
            <a href={link} target="_blank" rel="noreferrer noopener" className="inline-flex w-fit items-center gap-1 text-[12px] font-semibold text-[var(--brand)] hover:underline" data-testid="abrir-no-chat">
              <ExternalLink className="h-3 w-3" aria-hidden /> abrir no chat para responder
            </a>
          )}
        </>
      )}
    </div>
  );
}
