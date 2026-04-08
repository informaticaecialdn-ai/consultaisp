import { useState, useEffect, useRef } from "react";
import { MessageCircle, X, Send, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ChatMessage = {
  id: number;
  content: string;
  isFromAdmin: boolean;
  senderName: string;
  createdAt: string;
};

const STORAGE_KEY = "visitor_chat_token";

function chatTimeLabel(d: string): string {
  return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 mb-3">
      <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
        <MessageCircle className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="bg-slate-100 rounded-lg rounded-bl-md px-4 py-3">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

export default function LandingChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [showBubbleHint, setShowBubbleHint] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatStatus, setChatStatus] = useState("open");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [contactForm, setContactForm] = useState({ name: "", email: "", phone: "" });
  const [starting, setStarting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setToken(saved);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setShowBubbleHint(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!token || !isOpen) return;
    const fetchMessages = async () => {
      try {
        const res = await fetch("/api/public/visitor-chat/messages", {
          headers: { "x-visitor-token": token },
        });
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages || []);
          setChatStatus(data.chat?.status || "open");
        }
      } catch {}
    };
    fetchMessages();
    const interval = setInterval(fetchMessages, 4000);
    return () => clearInterval(interval);
  }, [token, isOpen]);

  const handleOpen = () => {
    setIsOpen(true);
    setShowBubbleHint(false);
    setTimeout(() => textareaRef.current?.focus(), 150);
  };

  const handleStartChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactForm.name.trim() || !contactForm.email.trim()) return;
    setStarting(true);
    try {
      const res = await fetch("/api/public/visitor-chat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactForm),
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem(STORAGE_KEY, data.token);
        setToken(data.token);
      }
    } catch {}
    setStarting(false);
  };

  const handleSend = async () => {
    if (!message.trim() || !token || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/public/visitor-chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-visitor-token": token },
        body: JSON.stringify({ content: message.trim() }),
      });
      if (res.ok) {
        setMessage("");
        const msgRes = await fetch("/api/public/visitor-chat/messages", {
          headers: { "x-visitor-token": token },
        });
        if (msgRes.ok) {
          const data = await msgRes.json();
          setMessages(data.messages || []);
        }
      }
    } catch {}
    setSending(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {!isOpen && showBubbleHint && (
        <div className="fixed bottom-24 right-6 z-50 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="bg-white rounded-lg rounded-br-md shadow-xl border border-slate-200 p-4 max-w-[260px] relative">
            <button onClick={() => setShowBubbleHint(false)} className="absolute top-2 right-2 text-slate-400 hover:text-slate-600" data-testid="button-close-hint">
              <X className="w-3.5 h-3.5" />
            </button>
            <p className="text-sm text-slate-700 font-medium pr-4">Precisa de ajuda? Fale com nossa equipe!</p>
            <button onClick={handleOpen} className="text-xs text-blue-600 font-semibold mt-2 hover:underline" data-testid="button-hint-open">
              Iniciar conversa
            </button>
          </div>
        </div>
      )}

      {!isOpen && (
        <button
          onClick={handleOpen}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-blue-600 rounded-full shadow-xl flex items-center justify-center hover:scale-105 transition-transform hover:bg-blue-700"
          data-testid="button-chat-open"
        >
          <MessageCircle className="w-6 h-6 text-white" />
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-3rem)] bg-white rounded-lg shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200" data-testid="chat-widget-panel">
          <div className="bg-blue-600 px-5 py-4 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                <MessageCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">Consulta ISP</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-blue-100 text-xs">Atendimento comercial</span>
                </div>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-white/70 hover:text-white transition-colors" data-testid="button-chat-close">
              <X className="w-5 h-5" />
            </button>
          </div>

          {!token ? (
            <div className="flex-1 flex flex-col justify-center p-6">
              <div className="text-center mb-6">
                <div className="w-14 h-14 rounded-lg bg-blue-50 flex items-center justify-center mx-auto mb-3">
                  <MessageCircle className="w-7 h-7 text-blue-400" />
                </div>
                <p className="text-sm font-semibold text-slate-800">Fale com nossa equipe</p>
                <p className="text-xs text-slate-500 mt-1">Preencha seus dados para iniciar o atendimento</p>
              </div>
              <form onSubmit={handleStartChat} className="space-y-3">
                <Input
                  placeholder="Seu nome"
                  value={contactForm.name}
                  onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))}
                  required
                  className="h-10 text-sm"
                  data-testid="input-visitor-name"
                />
                <Input
                  placeholder="Email"
                  type="email"
                  value={contactForm.email}
                  onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))}
                  required
                  className="h-10 text-sm"
                  data-testid="input-visitor-email"
                />
                <Input
                  placeholder="Telefone / WhatsApp (opcional)"
                  value={contactForm.phone}
                  onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))}
                  className="h-10 text-sm"
                  data-testid="input-visitor-phone"
                />
                <Button type="submit" className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold" disabled={starting} data-testid="button-start-chat">
                  {starting ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                  Iniciar conversa
                </Button>
              </form>
              <div className="mt-4 bg-blue-50 rounded-lg px-4 py-3 text-xs text-blue-700">
                <p className="font-semibold mb-1">Horario de atendimento</p>
                <p>Seg-Sex: 08h-18h | Sab: 08h-12h</p>
              </div>
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-1 bg-slate-50/50">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
                    <TypingIndicator />
                    <p className="text-xs text-slate-500">Aguardando atendente... Envie sua mensagem!</p>
                  </div>
                ) : (
                  messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.isFromAdmin ? "items-end gap-2" : "justify-end"} mb-3`}>
                      {msg.isFromAdmin && (
                        <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                          <MessageCircle className="w-3.5 h-3.5 text-white" />
                        </div>
                      )}
                      <div className={`max-w-[80%] flex flex-col gap-0.5 ${msg.isFromAdmin ? "items-start" : "items-end"}`}>
                        {msg.isFromAdmin && (
                          <p className="text-xs font-semibold text-slate-500 ml-0.5">{msg.senderName}</p>
                        )}
                        <div className={`px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                          msg.isFromAdmin
                            ? "bg-white text-slate-700 rounded-lg rounded-bl-md border border-slate-200 shadow-sm"
                            : "bg-blue-600 text-white rounded-lg rounded-br-md"
                        }`}>
                          {msg.content}
                        </div>
                        <p className="text-xs text-slate-400 px-1">{chatTimeLabel(msg.createdAt)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-slate-200 bg-white flex-shrink-0">
                {chatStatus === "closed" ? (
                  <div className="px-4 py-3 text-center text-xs text-slate-500">
                    Esta conversa foi encerrada pelo atendente.
                  </div>
                ) : (
                  <div className="px-3 py-3 flex gap-2 items-end">
                    <textarea
                      ref={textareaRef}
                      placeholder="Digite sua mensagem..."
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={2}
                      className="flex-1 text-sm border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[52px] max-h-[100px]"
                      data-testid="input-visitor-message"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 w-9 p-0 rounded-lg bg-blue-600 hover:bg-blue-700 flex-shrink-0"
                      disabled={!message.trim() || sending}
                      onClick={handleSend}
                      data-testid="button-visitor-send"
                    >
                      {sending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                )}
                <p className="text-xs text-slate-400 text-center pb-2">Consulta ISP — Atendimento comercial</p>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
