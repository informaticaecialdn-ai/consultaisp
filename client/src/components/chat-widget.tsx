import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { MessageSquare, X, Send, RefreshCw, ChevronDown, Headphones } from "lucide-react";

function chatDayLabel(d: string): string {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Hoje";
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function chatFullTime(d: string): string {
  return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: chatData, isLoading } = useQuery<{ thread: any; messages: any[] }>({
    queryKey: ["/api/chat/thread"],
    enabled: open,
    refetchInterval: open ? 4000 : false,
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/chat/unread"],
    refetchInterval: 20000,
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", "/api/chat/thread/messages", { content });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/chat/thread"] });
      qc.invalidateQueries({ queryKey: ["/api/chat/unread"] });
      setMessage("");
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (open) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, [open, chatData?.messages?.length]);

  if (user?.role === "superadmin") return null;

  const unreadCount = unreadData?.count || 0;
  const messages = chatData?.messages || [];
  const thread = chatData?.thread;

  const handleSend = () => {
    if (!message.trim()) return;
    sendMutation.mutate(message.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const groupedMsgs = messages.reduce<{ day: string; messages: any[] }[]>((groups, m) => {
    const day = chatDayLabel(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) { last.messages.push(m); }
    else { groups.push({ day, messages: [m] }); }
    return groups;
  }, []);

  const isClosed = thread?.status === "closed";

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open && (
        <div
          className="absolute bottom-16 right-0 bg-background border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ width: "380px", height: "520px" }}
          data-testid="chat-window"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Headphones className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-none">Suporte Consulta ISP</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isClosed ? "bg-gray-300" : "bg-emerald-400"}`} />
                  <span className="text-[11px] text-blue-100">{isClosed ? "Conversa encerrada" : "Suporte disponivel"}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
              data-testid="button-close-chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-slate-50/50">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
                <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center">
                  <MessageSquare className="w-7 h-7 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Como podemos ajudar?</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Envie uma mensagem e nossa equipe responderá em breve durante o horario comercial.
                  </p>
                </div>
                <div className="bg-blue-50 rounded-xl px-4 py-3 text-xs text-blue-700 text-left w-full">
                  <p className="font-semibold mb-1">Horario de atendimento</p>
                  <p>Seg–Sex: 08h–18h</p>
                  <p>Sab: 08h–12h</p>
                </div>
              </div>
            ) : groupedMsgs.map(group => (
              <div key={group.day} className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] text-muted-foreground font-medium px-2">{group.day}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {group.messages.map((m: any) => (
                  <div key={m.id} className={`flex items-end gap-2 ${m.isFromAdmin ? "justify-start" : "justify-end"}`}>
                    {m.isFromAdmin && (
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                        A
                      </div>
                    )}
                    <div className={`max-w-[80%] flex flex-col gap-0.5 ${m.isFromAdmin ? "items-start" : "items-end"}`}>
                      {m.isFromAdmin && (
                        <p className="text-[10px] font-semibold text-muted-foreground ml-0.5">{m.senderName}</p>
                      )}
                      <div className={`rounded-2xl px-3.5 py-2.5 ${m.isFromAdmin
                        ? "bg-white border rounded-bl-sm shadow-sm"
                        : "bg-blue-600 text-white rounded-br-sm"
                      }`}>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
                      </div>
                      <p className={`text-[10px] px-1 ${m.isFromAdmin ? "text-muted-foreground" : "text-muted-foreground"}`}>
                        {chatFullTime(m.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t bg-background flex-shrink-0">
            {isClosed ? (
              <div className="px-4 py-3 text-center text-xs text-muted-foreground bg-muted/30">
                Esta conversa foi encerrada pelo suporte.
              </div>
            ) : (
              <div className="px-3 py-3 flex gap-2 items-end">
                <textarea
                  ref={textareaRef}
                  placeholder="Mensagem... (Enter para enviar)"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  className="flex-1 text-sm border rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[52px] max-h-[100px] bg-background"
                  data-testid="input-chat-message"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-9 w-9 p-0 rounded-xl bg-blue-600 hover:bg-blue-700 flex-shrink-0"
                  disabled={!message.trim() || sendMutation.isPending}
                  onClick={handleSend}
                  data-testid="button-chat-send"
                >
                  {sendMutation.isPending
                    ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    : <Send className="w-3.5 h-3.5" />
                  }
                </Button>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground text-center pb-2">Shift+Enter para nova linha</p>
          </div>
        </div>
      )}

      {/* FAB button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="relative w-13 h-13 w-[52px] h-[52px] bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95"
        data-testid="button-open-chat"
      >
        {open ? (
          <ChevronDown className="w-5 h-5 text-white" />
        ) : (
          <MessageSquare className="w-5 h-5 text-white" />
        )}
        {!open && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold animate-pulse" data-testid="badge-unread-count">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
