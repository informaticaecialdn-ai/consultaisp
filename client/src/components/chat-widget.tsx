import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { MessageSquare, X, Send, RefreshCw, ChevronDown, Minimize2 } from "lucide-react";

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: chatData, isLoading } = useQuery<{ thread: any; messages: any[] }>({
    queryKey: ["/api/chat/thread"],
    enabled: open,
    refetchInterval: open ? 5000 : false,
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/chat/unread"],
    refetchInterval: 30000,
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
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (open && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatData?.messages, open]);

  if (user?.role === "superadmin") return null;

  const unreadCount = unreadData?.count || 0;
  const messages = chatData?.messages || [];

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    sendMutation.mutate(message);
  };

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open && (
        <div className="absolute bottom-14 right-0 w-80 bg-background border rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ height: "420px" }}>
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <span className="text-sm font-semibold">Suporte Consulta ISP</span>
            </div>
            <button onClick={() => setOpen(false)} className="hover:opacity-70 transition-opacity" data-testid="button-close-chat">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <MessageSquare className="w-10 h-10 opacity-20" />
                <div>
                  <p className="text-sm font-medium">Suporte tecnico</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Envie uma mensagem e nossa equipe responderá em breve.
                  </p>
                </div>
              </div>
            ) : messages.map((m: any) => (
              <div key={m.id} className={`flex ${m.isFromAdmin ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${m.isFromAdmin
                  ? "bg-muted rounded-bl-sm"
                  : "bg-blue-600 text-white rounded-br-sm"
                }`}>
                  {m.isFromAdmin && (
                    <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">{m.senderName}</p>
                  )}
                  <p className="text-sm">{m.content}</p>
                  <p className={`text-[10px] mt-0.5 ${m.isFromAdmin ? "text-muted-foreground" : "text-blue-200"}`}>
                    {new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSend} className="flex gap-2 p-3 border-t">
            <Input
              placeholder="Mensagem..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="flex-1 h-9 text-sm"
              data-testid="input-chat-message"
            />
            <Button
              type="submit"
              size="sm"
              className="h-9 w-9 p-0"
              disabled={!message.trim() || sendMutation.isPending}
              data-testid="button-chat-send"
            >
              {sendMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </Button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        className="relative w-12 h-12 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-shadow"
        data-testid="button-open-chat"
      >
        {open ? (
          <ChevronDown className="w-5 h-5 text-white" />
        ) : (
          <MessageSquare className="w-5 h-5 text-white" />
        )}
        {!open && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold" data-testid="badge-unread-count">
            {unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
