import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  MessageSquare, RefreshCw, Search, Send, XCircle, CheckCircle, CheckCircle2,
  ExternalLink, Zap,
} from "lucide-react";
import {
  QUICK_REPLIES, chatRelTime, chatFullTime, chatDayLabel, providerInitials,
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
 * Generic chat panel that replaces both the old provider ChatPanel and the
 * old VisitorChatPanel. Parameterized by variant + endpoints.
 */
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

  const panelTitle = title ?? (isProvider ? "Central de Suporte" : "Chat Visitantes");
  const searchPlaceholder = isProvider ? "Buscar provedor..." : "Buscar visitante...";
  const searchTestId = isProvider ? "input-chat-search" : "input-visitor-chat-search";
  const threadTestIdPrefix = isProvider ? "chat-thread" : "visitor-chat";
  const filterTestIdPrefix = isProvider ? "filter-chat" : "filter-visitor";
  const emptyListMsg = isProvider ? (search ? "Nenhum resultado" : "Nenhuma conversa ainda") : "Nenhuma conversa de visitante";

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 220px)", minHeight: "560px" }}>
      {/* Thread list */}
      <div className="w-80 flex-shrink-0 border rounded overflow-hidden flex flex-col bg-background">
        <div className="px-4 py-3 border-b bg-muted/20">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-bold">{panelTitle}</p>
              <p className="text-xs text-[var(--color-muted)]">
                {totalUnread > 0 ? <span className="text-[var(--color-navy)] font-medium">{totalUnread} nao lida(s)</span> : `${threads.length} conversa(s)`}
              </p>
            </div>
            {totalUnread > 0 && (
              <span className="w-6 h-6 bg-[var(--color-navy)] text-white text-xs rounded-full flex items-center justify-center font-bold" data-testid="badge-total-unread">{totalUnread}</span>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-muted)]" />
            <input
              className="w-full pl-8 pr-3 py-1.5 text-xs border rounded bg-background focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder={searchPlaceholder}
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid={searchTestId}
            />
          </div>
          <div className="flex gap-1 mt-2">
            {(["all", "open", "closed"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 text-xs py-1 rounded-md font-medium transition-colors ${filter === f ? "bg-[var(--color-navy)] text-white" : "bg-muted text-[var(--color-muted)] hover:bg-muted/70"}`}
                data-testid={`${filterTestIdPrefix}-${f}`}
              >
                {f === "all" ? "Todos" : f === "open" ? "Abertos" : "Fechados"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y">
          {filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--color-muted)] p-4 text-center">
              <MessageSquare className="w-8 h-8 opacity-20" />
              <p className="text-xs">{emptyListMsg}</p>
            </div>
          ) : filteredThreads.map((t: any) => {
            const displayName = getDisplayName(t);
            const initial = isProvider ? providerInitials(displayName) : displayName.charAt(0).toUpperCase();
            const baseColor = isProvider
              ? (t.status === "open" ? "from-blue-500 to-indigo-600" : "from-gray-400 to-gray-500")
              : (t.status === "open" ? "from-green-500 to-emerald-600" : "from-gray-400 to-gray-500");
            return (
              <button
                key={t.id}
                className={`w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors ${activeThread?.id === t.id ? "bg-[var(--color-navy-bg)] border-l-2 border-l-blue-600" : ""}`}
                onClick={() => setActiveThread(t)}
                data-testid={`${threadTestIdPrefix}-${t.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white ${baseColor}`}>
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className={`text-sm truncate ${t.unreadCount > 0 ? "font-bold" : "font-medium"}`}>{displayName}</p>
                      <span className="text-xs text-[var(--color-muted)] flex-shrink-0">{t.lastMessageAt ? chatRelTime(t.lastMessageAt) : ""}</span>
                    </div>
                    {!isProvider && <p className="text-xs text-[var(--color-muted)] truncate">{t.visitorEmail}</p>}
                    <p className="text-xs text-[var(--color-muted)] truncate mt-0.5">
                      {t.lastMessage ? (
                        <span>{isProvider && t.lastMessageFrom === "admin" ? "Você: " : ""}{t.lastMessage.slice(0, 50)}{t.lastMessage.length > 50 ? "…" : ""}</span>
                      ) : (
                        <span className="italic">Sem mensagens</span>
                      )}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${t.status === "open" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                        {t.status === "open" ? "Aberto" : "Fechado"}
                      </span>
                      {t.unreadCount > 0 && (
                        <span className="w-5 h-5 bg-[var(--color-navy)] text-white text-xs rounded-full flex items-center justify-center font-bold" data-testid={`unread-badge-${t.id}`}>
                          {t.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat window */}
      <div className="flex-1 border rounded flex flex-col overflow-hidden bg-background">
        {!activeThread ? (
          <div className="flex-1 flex flex-col items-center justify-center text-[var(--color-muted)] gap-4">
            <div className="w-16 h-16 rounded from-blue-500/10 to-indigo-500/10 flex items-center justify-center">
              <MessageSquare className="w-8 h-8 text-blue-400 opacity-60" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Selecione uma conversa</p>
              <p className="text-xs text-[var(--color-muted)] mt-1">
                {isProvider ? "Escolha um provedor ao lado para responder" : "Escolha um visitante ao lado para responder"}
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/10">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${
                  isProvider
                    ? (activeThread.status === "open" ? "from-blue-500 to-indigo-600" : "from-gray-400 to-gray-500")
                    : (activeThread.status === "open" ? "from-green-500 to-emerald-600" : "from-gray-400 to-gray-500")
                }`}>
                  {isProvider ? providerInitials(getDisplayName(activeThread)) : getDisplayName(activeThread).charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{getDisplayName(activeThread)}</p>
                    {isProvider && (
                      <span className={`w-2 h-2 rounded-full ${activeThread.status === "open" ? "bg-emerald-500" : "bg-gray-400"}`} />
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-muted)]">
                    {isProvider ? getSubline(activeThread) : `${activeThread.visitorEmail}${activeThread.visitorPhone ? ` | ${activeThread.visitorPhone}` : ""}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isProvider && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs gap-1.5 h-8"
                    onClick={() => navigate(`/admin/provedor/${activeThread.providerId}`)}
                    data-testid="button-goto-provider-panel"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />Painel
                  </Button>
                )}
                {isProvider ? (
                  <Button
                    variant={activeThread.status === "open" ? "outline" : "default"}
                    size="sm"
                    className="text-xs gap-1.5 h-8"
                    onClick={() => statusMutation.mutate({
                      id: activeThread.id,
                      status: activeThread.status === "open" ? "closed" : "open",
                    })}
                    data-testid="button-toggle-thread-status"
                  >
                    {activeThread.status === "open" ? (
                      <><XCircle className="w-3.5 h-3.5" />Fechar</>
                    ) : (
                      <><CheckCircle className="w-3.5 h-3.5" />Reabrir</>
                    )}
                  </Button>
                ) : activeThread.status === "open" ? (
                  <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5" onClick={() => statusMutation.mutate({ id: activeThread.id, status: "closed" })} data-testid="button-close-visitor-chat">
                    <XCircle className="w-3.5 h-3.5" /> Encerrar
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5" onClick={() => statusMutation.mutate({ id: activeThread.id, status: "open" })} data-testid="button-reopen-visitor-chat">
                    <RefreshCw className="w-3.5 h-3.5" /> Reabrir
                  </Button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-[var(--color-bg)]/30">
              {msgsLoading ? (
                <div className="flex items-center justify-center h-full">
                  <RefreshCw className="w-4 h-4 animate-spin text-[var(--color-muted)]" />
                </div>
              ) : msgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--color-muted)]">
                  <MessageSquare className="w-10 h-10 opacity-20" />
                  <p className="text-sm">Nenhuma mensagem ainda. Inicie a conversa!</p>
                </div>
              ) : groupedMsgs.map(group => (
                <div key={group.day} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-[var(--color-muted)] font-medium px-2 py-0.5 bg-muted rounded-full">{group.day}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  {group.messages.map((m: any) => (
                    <div key={m.id} className={`flex items-end gap-2 ${m.isFromAdmin ? "justify-end" : "justify-start"}`}>
                      {!m.isFromAdmin && (
                        <div className="w-7 h-7 rounded-full from-slate-400 to-slate-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                          {(m.senderName || getDisplayName(activeThread) || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className={`max-w-[72%] ${m.isFromAdmin ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                        {!m.isFromAdmin && isProvider && (
                          <p className="text-xs font-semibold text-[var(--color-muted)] ml-1">{m.senderName}</p>
                        )}
                        <div className={`rounded px-3.5 py-2.5 ${m.isFromAdmin
                            ? "bg-[var(--color-navy)] text-white rounded-br-sm"
                            : "bg-[var(--color-surface)] border rounded-bl-sm"
                          }`}>
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        </div>
                        <div className={`flex items-center gap-1 px-1 ${m.isFromAdmin ? "flex-row-reverse" : ""}`}>
                          <span className="text-xs text-[var(--color-muted)]">{chatFullTime(m.createdAt)}</span>
                          {m.isFromAdmin && isProvider && (
                            <CheckCircle2 className={`w-3 h-3 ${m.isRead ? "text-blue-500" : "text-[var(--color-muted)]/40"}`} />
                          )}
                        </div>
                      </div>
                      {m.isFromAdmin && (
                        <div className="w-7 h-7 rounded-full from-blue-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                          A
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick replies (provider only) */}
            {isProvider && showQuickReplies && (
              <div className="border-t bg-muted/20 px-4 py-2">
                <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">Respostas rapidas</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_REPLIES.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => { setMessage(r); setShowQuickReplies(false); textareaRef.current?.focus(); }}
                      className="text-xs bg-[var(--color-surface)] border rounded-full px-3 py-1 hover:bg-[var(--color-navy-bg)] hover:border-blue-300 hover:text-[var(--color-navy)] transition-colors text-left max-w-[280px] truncate"
                      data-testid={`quick-reply-${i}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input area */}
            <div className="border-t bg-background">
              {activeThread.status !== "open" ? (
                <div className="px-5 py-3 text-center text-sm text-[var(--color-muted)] bg-muted/30">
                  {isProvider ? "Esta conversa esta fechada. Reabra para responder." : "Conversa encerrada."}
                </div>
              ) : (
                <div className="px-4 py-3 space-y-2">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 relative">
                      <Textarea
                        ref={textareaRef}
                        placeholder={isProvider ? "Digite sua resposta... (Enter para enviar, Shift+Enter para nova linha)" : "Responder visitante... (Enter para enviar)"}
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        rows={2}
                        className="resize-none text-sm pr-2 min-h-[60px] max-h-[120px]"
                        data-testid={isProvider ? "input-admin-chat-message" : "input-visitor-reply"}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      {isProvider && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => setShowQuickReplies(v => !v)}
                          title="Respostas rapidas"
                          data-testid="button-quick-replies"
                        >
                          <Zap className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 w-8 p-0 bg-[var(--color-navy)] hover:bg-[var(--color-steel)]"
                        disabled={!message.trim() || sendMutation.isPending}
                        onClick={handleSend}
                        data-testid={isProvider ? "button-admin-chat-send" : "button-visitor-reply-send"}
                      >
                        {sendMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>
                  {isProvider && (
                    <p className="text-xs text-[var(--color-muted)] text-right">{message.length > 0 ? `${message.length} caracteres` : "Enter para enviar · Shift+Enter para nova linha"}</p>
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
