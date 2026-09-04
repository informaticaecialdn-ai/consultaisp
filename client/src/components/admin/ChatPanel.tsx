import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  MessageSquare, RefreshCw, Search, Send, XCircle, CheckCircle, CheckCircle2,
  ExternalLink, Zap,
} from "lucide-react";
import {
  ALVO_CONTROLE, BOTAO_MARCA, BOTAO_SECUNDARIO, CAIXA_ICONE, DESABILITAVEL,
  EstadoVazio, FOCO, FOCO_INTERNO, KickerSecao, LadrilhoInicial, LinhasSkeleton,
  Selo, TITULO_CARTAO,
} from "@/components/painel/ui";
import { cn } from "@/lib/utils";
import {
  QUICK_REPLIES, chatRelTime, chatFullTime, chatDayLabel,
} from "./constants";

export type ChatVariant = "provider" | "visitor";

export interface ChatPanelProps {
  variant: ChatVariant;
  threads: any[];
  /** base endpoint e.g. "/api/admin/chat/threads" or "/api/admin/visitor-chats" */
  baseEndpoint: string;
  /** key used in react-query cache (must match the threads list queryKey) */
  threadsQueryKey: string[];
  title?: string;
}

/**
 * O painel de conversa do suporte — provedores e visitantes do site na mesma
 * peca, parametrizada por `variant`.
 *
 * ESTA RODADA E DE LINGUAGEM VISUAL. Nenhuma rota, queryKey, endpoint,
 * intervalo de refetch, permissao ou data-testid mudou. O `useEffect` que rola
 * a conversa ate o fim e o `messagesEndRef` no ultimo no da area rolavel
 * continuam onde estavam, letra por letra: a rolagem depende de o ref ser o
 * ULTIMO filho do elemento que tem `overflow-y-auto`, e essa relacao foi
 * preservada em cada ramo (carregando, vazio e com mensagens).
 *
 * O QUE MUDOU, E POR QUE
 * A tela estava escrita na API antiga de token, com nove classes da paleta
 * default do Tailwind espalhadas (cinco tons de azul e um de indigo, entre
 * anel de foco, borda de item ativo, icone e marca de lida). Agora fala pelas
 * primitivas de `@/components/painel/ui`, as mesmas do Painel do Provedor.
 *
 * TRES DECISOES QUE MUDAM PIXEL, declaradas:
 *
 * 1. O AVATAR PERDEU A COR. Ele era pintado por status (marca/verde quando
 *    aberto, cinza quando fechado) na lista, no cabecalho e na bolha. Era a
 *    terceira vez que a MESMA informacao aparecia na mesma linha — ja ha o selo
 *    "Aberta/Fechada" e o ponto de status ao lado do nome —, e a secao 3 do
 *    DESIGN_SYSTEM reserva saturacao para risco. Virou o mesmo ladrilho neutro
 *    de inicial que o `VisaoGeralTab` usa na lista de provedores.
 *
 * 2. O AVATAR DO ADMIN ESTAVA INVISIVEL. As classes eram duas paradas de
 *    gradiente da paleta default, sem nenhuma utilidade `bg-gradient-to-*` que
 *    as usasse: parada de gradiente sozinha nao emite fundo, entao era um "A"
 *    branco sobre transparente. Agora e `--brand-soft` com tinta `--brand-ink`,
 *    que e o par semantico correto e conversa com a bolha da propria pessoa.
 *
 * 3. OS TRES BOTOES DO CABECALHO VIRARAM TODOS SECUNDARIOS. "Reabrir" era o
 *    unico preenchido, e ao lado de "Painel" e "Fechar" isso dizia que reabrir
 *    e a acao principal da tela — nao e: a acao principal e responder, e ela
 *    mora no botao de enviar. Uma cor de acao por tela.
 *
 * Alvo de toque: todo controle daqui passou a compor `ALVO_CONTROLE` (36px no
 * mouse, 44px no dedo). Os botoes de icone (enviar, respostas rapidas) ganham o
 * eixo horizontal junto, porque `ALVO_CONTROLE` so garante a altura.
 *
 * SEGUNDA RODADA — AS COPIAS LOCAIS FORAM APAGADAS
 * Este arquivo tinha a propria caixa de botao de icone, o proprio anel de foco
 * (duas versoes), o proprio desabilitado e o proprio ladrilho de inicial. Todos
 * quatro viraram primitiva em `painel/ui` e agora vem de la — copia local e
 * exatamente por onde a divergencia volta, e este arquivo era uma das sete
 * fontes dela.
 *
 * DUAS MUDANCAS DE PIXEL, declaradas:
 * - o ladrilho de inicial passa de 12px para 13px de corpo (o valor da
 *   primitiva, que e o mesmo do `LadrilhoIcone` — sao o mesmo objeto em papeis
 *   diferentes);
 * - o ladrilho de PROVEDOR mostra UMA letra, e nao mais o monograma de duas
 *   (`providerInitials`). A primitiva deriva a inicial por conta propria de
 *   proposito, para que a mesma lista nao mostre "A" num lugar e "j" noutro; o
 *   nome inteiro continua escrito ao lado, e o ladrilho e `aria-hidden`.
 */

/** Os filtros da lista. O rotulo concorda com "conversa" — estava no masculino
 *  ("Todos", "Abertos") descrevendo uma lista de conversas. As chaves sao as
 *  mesmas de sempre: elas alimentam o estado e o data-testid. */
const FILTROS = [
  { id: "all", rotulo: "Todas" },
  { id: "open", rotulo: "Abertas" },
  { id: "closed", rotulo: "Fechadas" },
] as const;

export default function ChatPanel({
  variant, threads, baseEndpoint, threadsQueryKey, title,
}: ChatPanelProps) {
  const [activeThread, setActiveThread] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [, navigate] = useLocation();

  const isProvider = variant === "provider";

  const { data: msgs = [], isLoading: msgsLoading } = useQuery<any[]>({
    queryKey: [baseEndpoint, activeThread?.id, "messages"],
    enabled: !!activeThread,
    refetchInterval: 4000,
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `${baseEndpoint}/${activeThread.id}/messages`, { content });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [baseEndpoint, activeThread?.id, "messages"] });
      qc.invalidateQueries({ queryKey: threadsQueryKey });
      setMessage("");
      setShowQuickReplies(false);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `${baseEndpoint}/${id}/status`, { status });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: threadsQueryKey });
      setActiveThread((prev: any) => prev ? { ...prev, status: vars.status } : prev);
    },
  });

  useEffect(() => {
    if (msgs.length > 0) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [msgs.length, activeThread?.id]);

  const handleSend = () => {
    if (!message.trim() || !activeThread) return;
    sendMutation.mutate(message.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getDisplayName = (t: any) => isProvider ? (t.providerName || "") : (t.visitorName || "");
  const getSubline = (t: any) => isProvider ? (t.subject || "") : (t.visitorEmail || "");

  const filteredThreads = threads.filter(t => {
    const name = getDisplayName(t).toLowerCase();
    const email = (t.visitorEmail || "").toLowerCase();
    const q = search.toLowerCase();
    const matchSearch = isProvider ? name.includes(q) : (name.includes(q) || email.includes(q));
    const matchFilter = filter === "all" || t.status === filter;
    return matchSearch && matchFilter;
  });

  const totalUnread = threads.reduce((s: number, t: any) => s + (t.unreadCount || 0), 0);

  const groupedMsgs = msgs.reduce<{ day: string; messages: any[] }[]>((groups, m) => {
    const day = chatDayLabel(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) { last.messages.push(m); }
    else { groups.push({ day, messages: [m] }); }
    return groups;
  }, []);

  const panelTitle = title ?? (isProvider ? "Central de suporte" : "Visitantes do site");
  const searchPlaceholder = isProvider ? "Buscar provedor…" : "Buscar visitante…";
  const searchTestId = isProvider ? "input-chat-search" : "input-visitor-chat-search";
  const threadTestIdPrefix = isProvider ? "chat-thread" : "visitor-chat";
  const filterTestIdPrefix = isProvider ? "filter-chat" : "filter-visitor";

  /* Estado vazio de verdade (secao 6): icone, titulo e o que fazer a seguir.
     Antes era uma linha solta de texto cinza, que nao diz nada a quem chegou na
     tela sem saber por que a lista esta vazia. A busca sem resultado e um caso
     diferente de nao haver conversa nenhuma, e a saida tambem e. */
  const vazioLista = search
    ? {
        titulo: "Nenhum resultado",
        descricao: "Nenhuma conversa combina com o texto buscado. Limpe a busca ou troque o filtro acima.",
      }
    : filter !== "all"
    ? {
        titulo: filter === "open" ? "Nenhuma conversa aberta" : "Nenhuma conversa fechada",
        descricao: "Nada nesta situação no momento. Volte para “Todas” para ver a lista inteira.",
      }
    : isProvider
    ? {
        titulo: "Nenhuma conversa ainda",
        descricao: "Quando um provedor abrir um chamado pelo painel dele, a conversa aparece nesta lista.",
      }
    : {
        titulo: "Nenhuma conversa de visitante",
        descricao: "Quando alguém iniciar uma conversa pelo site, ela aparece nesta lista.",
      };

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 220px)", minHeight: "560px" }}>
      {/* Lista de conversas */}
      <div className="w-80 flex-none border border-[var(--border)] rounded-lg overflow-hidden flex flex-col bg-[var(--surface)]">
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              <p className={TITULO_CARTAO}>{panelTitle}</p>
              <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                {totalUnread > 0 ? (
                  <span className="text-[var(--brand)] font-medium">
                    <span className="font-mono tabular-nums">{totalUnread}</span>{" "}
                    não lida{totalUnread === 1 ? "" : "s"}
                  </span>
                ) : (
                  <>
                    <span className="font-mono tabular-nums">{threads.length}</span>{" "}
                    conversa{threads.length === 1 ? "" : "s"}
                  </>
                )}
              </p>
            </div>
            {totalUnread > 0 && (
              <Selo tom="marca" className="tabular-nums flex-none" testId="badge-total-unread">
                {totalUnread}
                <span className="sr-only"> não lidas</span>
              </Selo>
            )}
          </div>
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 flex-none text-[var(--text-faint)] pointer-events-none"
              strokeWidth={2}
              aria-hidden
            />
            <input
              className={`w-full ${ALVO_CONTROLE} pl-8 pr-3 rounded text-[12.5px] text-[var(--text)] bg-[var(--surface-inset)] border border-[var(--border-strong)] placeholder:text-[var(--text-faint)] ${FOCO}`}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid={searchTestId}
            />
          </div>
          <div className="flex gap-1 mt-2" role="group" aria-label="Filtrar conversas">
            {FILTROS.map(f => {
              const ativo = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={ativo}
                  className={`flex-1 ${ALVO_CONTROLE} rounded text-[12px] font-medium motion-safe:transition-colors ${FOCO} ${
                    ativo
                      ? "bg-[var(--brand)] text-[var(--text-on-brand)]"
                      : "bg-[var(--surface-inset)] text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
                  data-testid={`${filterTestIdPrefix}-${f.id}`}
                >
                  {f.rotulo}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--border-faint)]">
          {filteredThreads.length === 0 ? (
            <EstadoVazio
              Icone={MessageSquare}
              titulo={vazioLista.titulo}
              descricao={vazioLista.descricao}
              testId="lista-conversas-vazia"
            />
          ) : filteredThreads.map((t: any) => {
            const displayName = getDisplayName(t);
            const ativa = activeThread?.id === t.id;
            return (
              <button
                key={t.id}
                className={`w-full text-left px-4 py-3 border-l-2 motion-safe:transition-colors ${FOCO_INTERNO} ${
                  ativa
                    ? "bg-[var(--brand-soft)] border-l-[var(--brand)]"
                    : "border-l-transparent hover:bg-[var(--surface-2)]"
                }`}
                onClick={() => setActiveThread(t)}
                data-testid={`${threadTestIdPrefix}-${t.id}`}
              >
                <div className="flex items-start gap-3">
                  <LadrilhoInicial nome={displayName} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className={`text-[13px] text-[var(--text)] truncate ${t.unreadCount > 0 ? "font-semibold" : "font-medium"}`}>
                        {displayName}
                      </p>
                      <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)] flex-none">
                        {t.lastMessageAt ? chatRelTime(t.lastMessageAt) : ""}
                      </span>
                    </div>
                    {!isProvider && (
                      <p className="text-[12px] text-[var(--text-muted)] truncate">{t.visitorEmail}</p>
                    )}
                    <p className="text-[12px] text-[var(--text-muted)] truncate mt-0.5">
                      {t.lastMessage ? (
                        <span>{isProvider && t.lastMessageFrom === "admin" ? "Você: " : ""}{t.lastMessage.slice(0, 50)}{t.lastMessage.length > 50 ? "…" : ""}</span>
                      ) : (
                        <span className="text-[var(--text-faint)]">Sem mensagens</span>
                      )}
                    </p>
                    <div className="flex items-center justify-between gap-2 mt-1.5">
                      <Selo tom={t.status === "open" ? "ok" : "neutro"}>
                        {t.status === "open" ? "Aberta" : "Fechada"}
                      </Selo>
                      {t.unreadCount > 0 && (
                        <Selo tom="marca" className="tabular-nums" testId={`unread-badge-${t.id}`}>
                          {t.unreadCount}
                          <span className="sr-only"> não lidas</span>
                        </Selo>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversa */}
      <div className="flex-1 border border-[var(--border)] rounded-lg flex flex-col overflow-hidden bg-[var(--surface)]">
        {!activeThread ? (
          <div className="flex-1 grid place-items-center">
            <EstadoVazio
              Icone={MessageSquare}
              titulo="Selecione uma conversa"
              descricao={isProvider
                ? "Escolha um provedor na lista ao lado para ler o histórico e responder."
                : "Escolha um visitante na lista ao lado para ler o histórico e responder."}
              testId="chat-sem-conversa"
            />
          </div>
        ) : (
          <>
            {/* Cabecalho da conversa */}
            <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
              <div className="flex items-center gap-3 min-w-0">
                <LadrilhoInicial nome={getDisplayName(activeThread)} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={TITULO_CARTAO}>{getDisplayName(activeThread)}</p>
                    {isProvider && (
                      /* Ponto de status: o unico rounded-full permitido — e um
                         dot, nao um badge. */
                      <span
                        className={`w-2 h-2 rounded-full flex-none ${activeThread.status === "open" ? "bg-[var(--ok)]" : "bg-[var(--text-faint)]"}`}
                        title={activeThread.status === "open" ? "Conversa aberta" : "Conversa fechada"}
                      />
                    )}
                  </div>
                  <p className="text-[12px] text-[var(--text-muted)] truncate">
                    {isProvider ? getSubline(activeThread) : `${activeThread.visitorEmail}${activeThread.visitorPhone ? ` · ${activeThread.visitorPhone}` : ""}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-none">
                {isProvider && (
                  <button
                    type="button"
                    className={BOTAO_SECUNDARIO}
                    onClick={() => navigate(`/admin/provedor/${activeThread.providerId}`)}
                    data-testid="button-goto-provider-panel"
                  >
                    <ExternalLink className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                    Painel
                  </button>
                )}
                {isProvider ? (
                  <button
                    type="button"
                    className={BOTAO_SECUNDARIO}
                    onClick={() => statusMutation.mutate({
                      id: activeThread.id,
                      status: activeThread.status === "open" ? "closed" : "open",
                    })}
                    data-testid="button-toggle-thread-status"
                  >
                    {activeThread.status === "open" ? (
                      <><XCircle className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />Fechar</>
                    ) : (
                      <><CheckCircle className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />Reabrir</>
                    )}
                  </button>
                ) : activeThread.status === "open" ? (
                  <button
                    type="button"
                    className={BOTAO_SECUNDARIO}
                    onClick={() => statusMutation.mutate({ id: activeThread.id, status: "closed" })}
                    data-testid="button-close-visitor-chat"
                  >
                    <XCircle className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                    Encerrar
                  </button>
                ) : (
                  <button
                    type="button"
                    className={BOTAO_SECUNDARIO}
                    onClick={() => statusMutation.mutate({ id: activeThread.id, status: "open" })}
                    data-testid="button-reopen-visitor-chat"
                  >
                    <RefreshCw className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                    Reabrir
                  </button>
                )}
              </div>
            </div>

            {/* Mensagens. O `messagesEndRef` fecha esta area em TODOS os ramos —
                e dele que a rolagem automatica depende. */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-[var(--bg)]">
              {msgsLoading ? (
                <LinhasSkeleton linhas={5} />
              ) : msgs.length === 0 ? (
                <EstadoVazio
                  Icone={MessageSquare}
                  titulo="Nenhuma mensagem ainda"
                  descricao="Escreva a primeira mensagem no campo abaixo. Ela chega ao painel de quem abriu a conversa."
                  testId="chat-sem-mensagens"
                />
              ) : groupedMsgs.map(group => (
                <div key={group.day} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-[var(--border)]" />
                    <span className="font-mono text-[10px] font-medium uppercase tracking-[var(--track-wide)] tabular-nums text-[var(--text-faint)] px-2 py-0.5 rounded bg-[var(--surface-inset)]">
                      {group.day}
                    </span>
                    <div className="flex-1 h-px bg-[var(--border)]" />
                  </div>
                  {group.messages.map((m: any) => (
                    <div key={m.id} className={`flex items-end gap-2 ${m.isFromAdmin ? "justify-end" : "justify-start"}`}>
                      {!m.isFromAdmin && (
                        <LadrilhoInicial
                          tamanho="sm"
                          nome={m.senderName || getDisplayName(activeThread)}
                        />
                      )}
                      <div className={`max-w-[72%] ${m.isFromAdmin ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                        {!m.isFromAdmin && isProvider && (
                          <p className="text-[11px] font-semibold text-[var(--text-muted)] ml-1">{m.senderName}</p>
                        )}
                        <div className={`rounded px-3.5 py-2.5 ${m.isFromAdmin
                            ? "bg-[var(--brand)] text-[var(--text-on-brand)] rounded-br-sm"
                            : "bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] rounded-bl-sm"
                          }`}>
                          <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        </div>
                        <div className={`flex items-center gap-1 px-1 ${m.isFromAdmin ? "flex-row-reverse" : ""}`}>
                          <span className="font-mono tabular-nums text-[10.5px] text-[var(--text-muted)]">
                            {chatFullTime(m.createdAt)}
                          </span>
                          {m.isFromAdmin && isProvider && (
                            <CheckCircle2
                              className={`w-3 h-3 flex-none ${m.isRead ? "text-[var(--brand)]" : "text-[var(--text-faint)]"}`}
                              strokeWidth={2}
                              aria-label={m.isRead ? "Lida pelo provedor" : "Enviada, ainda não lida"}
                            />
                          )}
                        </div>
                      </div>
                      {m.isFromAdmin && (
                        /* O unico ladrilho com cor de marca da tela: marca quem
                           escreve daqui, e conversa com a bolha ao lado. A
                           forma e o tamanho saem da primitiva; so o par de cor
                           e sobrescrito, porque `LadrilhoInicial` e neutro por
                           regra (a inicial identifica, nao mede) e aqui a cor
                           nao mede nada — diz de que lado da conversa a bolha
                           esta. */
                        <LadrilhoInicial
                          nome="Atendimento"
                          tamanho="sm"
                          className="bg-[var(--brand-soft)] text-[var(--brand-ink)]"
                        />
                      )}
                    </div>
                  ))}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Respostas rapidas (so provedor) */}
            {isProvider && showQuickReplies && (
              <div className="border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
                <KickerSecao className="mb-2">Respostas rápidas</KickerSecao>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_REPLIES.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { setMessage(r); setShowQuickReplies(false); textareaRef.current?.focus(); }}
                      className={`inline-flex items-center ${ALVO_CONTROLE} rounded px-3 text-[12px] text-left max-w-[280px] truncate bg-[var(--surface)] border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--brand-soft)] hover:border-[var(--brand)] hover:text-[var(--brand-ink)] motion-safe:transition-colors ${FOCO}`}
                      data-testid={`quick-reply-${i}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Campo de resposta */}
            <div className="border-t border-[var(--border)] bg-[var(--surface)]">
              {activeThread.status !== "open" ? (
                <div className="px-5 py-3 text-center text-[12.5px] text-[var(--text-muted)] bg-[var(--surface-2)]">
                  {isProvider ? "Esta conversa está fechada. Reabra para responder." : "Conversa encerrada."}
                </div>
              ) : (
                <div className="px-4 py-3 space-y-2">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 relative">
                      <Textarea
                        ref={textareaRef}
                        placeholder={isProvider ? "Digite sua resposta… (Enter envia, Shift+Enter quebra a linha)" : "Responder ao visitante… (Enter envia)"}
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        rows={2}
                        className={`resize-none text-[13px] min-h-[78px] max-h-[120px] rounded bg-[var(--surface-inset)] border-[var(--border-strong)] text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:ring-0 focus-visible:ring-offset-0 ${FOCO}`}
                        data-testid={isProvider ? "input-admin-chat-message" : "input-visitor-reply"}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 flex-none">
                      {isProvider && (
                        /* Quadrado, mas NAO o `BotaoIcone` fantasma da
                           primitiva: os dois botoes desta coluna sao um par
                           empilhado ao lado do campo, e um fantasma sem borda
                           ao lado de um CTA cheio flutuaria sozinho. A caixa
                           (36px no mouse, 44x44 no dedo) vem da primitiva
                           `CAIXA_ICONE`, que existe para compor exatamente
                           assim com `BOTAO_SECUNDARIO`. */
                        <button
                          type="button"
                          className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE)}
                          onClick={() => setShowQuickReplies(v => !v)}
                          title="Respostas rápidas"
                          aria-label="Respostas rápidas"
                          aria-pressed={showQuickReplies}
                          data-testid="button-quick-replies"
                        >
                          <Zap className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                        </button>
                      )}
                      <button
                        type="button"
                        className={cn(BOTAO_MARCA, CAIXA_ICONE, DESABILITAVEL)}
                        disabled={!message.trim() || sendMutation.isPending}
                        onClick={handleSend}
                        aria-label="Enviar mensagem"
                        data-testid={isProvider ? "button-admin-chat-send" : "button-visitor-reply-send"}
                      >
                        {sendMutation.isPending
                          ? <RefreshCw className="w-3.5 h-3.5 flex-none motion-safe:animate-spin" strokeWidth={2} aria-hidden />
                          : <Send className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />}
                      </button>
                    </div>
                  </div>
                  {isProvider && (
                    <p className="text-[11.5px] text-[var(--text-muted)] text-right">
                      {message.length > 0 ? (
                        <><span className="font-mono tabular-nums">{message.length}</span> caracteres</>
                      ) : (
                        "Enter para enviar · Shift+Enter para nova linha"
                      )}
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
