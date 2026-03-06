import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import {
  Shield, Building2, Users, CreditCard, BarChart3, MessageSquare,
  Plus, Trash2, RefreshCw, CheckCircle, XCircle, Search, Send,
  Globe, TrendingUp, Activity, ChevronRight, Settings2,
  ArrowUpDown, Clock, User, Crown, Star, FileText, DollarSign,
  TrendingDown, AlertCircle, CalendarCheck, Printer, Eye, Ban,
  ChevronDown, Zap, Link2, QrCode, Wallet, ScanLine, RotateCcw,
  ExternalLink, Copy, CheckCircle2, EyeOff, Terminal, Save, AlertTriangle,
  Database, Upload, X, Pencil, ImagePlus, ToggleLeft, ToggleRight
} from "lucide-react";
import type { ErpCatalog } from "@shared/schema";

const ERP_OPTIONS = [
  { key: "ixc",      name: "iXC Soft",    desc: "iXC Provedor",   grad: "from-blue-500 to-blue-600" },
  { key: "sgp",      name: "SGP",          desc: "Solucao Gestao", grad: "from-purple-500 to-purple-600" },
  { key: "mk",       name: "MK Solutions", desc: "MK-AUTH/ERP",    grad: "from-green-500 to-green-600" },
  { key: "tiacos",   name: "Tiacos",       desc: "Tiacos ISP",     grad: "from-orange-500 to-orange-600" },
  { key: "hubsoft",  name: "Hubsoft",      desc: "Hubsoft ERP",    grad: "from-indigo-500 to-indigo-600" },
  { key: "flyspeed", name: "Fly Speed",    desc: "Fly Speed ISP",  grad: "from-cyan-500 to-cyan-600" },
  { key: "netflash", name: "Netflash",     desc: "Netflash ISP",   grad: "from-rose-500 to-pink-600" },
];
const ERP_MAP: Record<string, string> = Object.fromEntries(ERP_OPTIONS.map(e => [e.key, e.name]));

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free:       { label: "Gratuito",     color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  basic:      { label: "Basico",       color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  pro:        { label: "Pro",          color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300" },
  enterprise: { label: "Enterprise",   color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
};

const QUICK_REPLIES = [
  "Olá! Como posso ajudar?",
  "Obrigado pelo contato. Vamos verificar isso para você.",
  "Seu pedido foi registrado e será processado em breve.",
  "Para resolver isso, precisamos de mais informações. Poderia detalhar melhor?",
  "O problema foi identificado e está sendo resolvido.",
  "Sua conta foi atualizada com sucesso!",
  "Por favor, acesse o painel e verifique se o problema persiste.",
];

function chatRelTime(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function chatFullTime(d: string): string {
  return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function chatDayLabel(d: string): string {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Hoje";
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function providerInitials(name: string): string {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

function ChatPanel({ threads }: { threads: any[] }) {
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

  const { data: msgs = [], isLoading: msgsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/chat/threads", activeThread?.id, "messages"],
    enabled: !!activeThread,
    refetchInterval: 4000,
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/admin/chat/threads/${activeThread.id}/messages`, { content });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/chat/threads", activeThread?.id, "messages"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
      setMessage("");
      setShowQuickReplies(false);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/chat/threads/${id}/status`, { status });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
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

  const filteredThreads = threads.filter(t => {
    const matchSearch = t.providerName.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || t.status === filter;
    return matchSearch && matchFilter;
  });

  const totalUnread = threads.reduce((s, t) => s + t.unreadCount, 0);

  const groupedMsgs = msgs.reduce<{ day: string; messages: any[] }[]>((groups, m) => {
    const day = chatDayLabel(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) { last.messages.push(m); }
    else { groups.push({ day, messages: [m] }); }
    return groups;
  }, []);

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 220px)", minHeight: "560px" }}>
      {/* Thread list */}
      <div className="w-80 flex-shrink-0 border rounded-xl overflow-hidden flex flex-col bg-background">
        <div className="px-4 py-3 border-b bg-muted/20">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-bold">Central de Suporte</p>
              <p className="text-xs text-muted-foreground">
                {totalUnread > 0 ? <span className="text-blue-600 font-medium">{totalUnread} nao lida(s)</span> : `${threads.length} conversa(s)`}
              </p>
            </div>
            {totalUnread > 0 && (
              <span className="w-6 h-6 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center font-bold" data-testid="badge-total-unread">{totalUnread}</span>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              className="w-full pl-8 pr-3 py-1.5 text-xs border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Buscar provedor..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-chat-search"
            />
          </div>
          <div className="flex gap-1 mt-2">
            {(["all", "open", "closed"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 text-[11px] py-1 rounded-md font-medium transition-colors ${filter === f ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
                data-testid={`filter-chat-${f}`}
              >
                {f === "all" ? "Todos" : f === "open" ? "Abertos" : "Fechados"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y">
          {filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground p-4 text-center">
              <MessageSquare className="w-8 h-8 opacity-20" />
              <p className="text-xs">{search ? "Nenhum resultado" : "Nenhuma conversa ainda"}</p>
            </div>
          ) : filteredThreads.map((t: any) => (
            <button
              key={t.id}
              className={`w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors ${activeThread?.id === t.id ? "bg-blue-50 border-l-2 border-l-blue-600" : ""}`}
              onClick={() => setActiveThread(t)}
              data-testid={`chat-thread-${t.id}`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white ${t.status === "open" ? "bg-gradient-to-br from-blue-500 to-indigo-600" : "bg-gradient-to-br from-gray-400 to-gray-500"}`}>
                  {providerInitials(t.providerName)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className={`text-sm truncate ${t.unreadCount > 0 ? "font-bold" : "font-medium"}`}>{t.providerName}</p>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">{t.lastMessageAt ? chatRelTime(t.lastMessageAt) : ""}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {t.lastMessage ? (
                      <span>{t.lastMessageFrom === "admin" ? "Você: " : ""}{t.lastMessage.slice(0, 50)}{t.lastMessage.length > 50 ? "…" : ""}</span>
                    ) : (
                      <span className="italic">Sem mensagens</span>
                    )}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${t.status === "open" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                      {t.status === "open" ? "Aberto" : "Fechado"}
                    </span>
                    {t.unreadCount > 0 && (
                      <span className="w-5 h-5 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold" data-testid={`unread-badge-${t.id}`}>
                        {t.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat window */}
      <div className="flex-1 border rounded-xl flex flex-col overflow-hidden bg-background">
        {!activeThread ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 flex items-center justify-center">
              <MessageSquare className="w-8 h-8 text-blue-400 opacity-60" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Selecione uma conversa</p>
              <p className="text-xs text-muted-foreground mt-1">Escolha um provedor ao lado para responder</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/10">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${activeThread.status === "open" ? "bg-gradient-to-br from-blue-500 to-indigo-600" : "bg-gradient-to-br from-gray-400 to-gray-500"}`}>
                  {providerInitials(activeThread.providerName)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{activeThread.providerName}</p>
                    <span className={`w-2 h-2 rounded-full ${activeThread.status === "open" ? "bg-emerald-500" : "bg-gray-400"}`} />
                  </div>
                  <p className="text-xs text-muted-foreground">{activeThread.subject}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-1.5 h-8"
                  onClick={() => navigate(`/admin/provedor/${activeThread.providerId}`)}
                  data-testid="button-goto-provider-panel"
                >
                  <ExternalLink className="w-3.5 h-3.5" />Painel
                </Button>
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
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-slate-50/30">
              {msgsLoading ? (
                <div className="flex items-center justify-center h-full">
                  <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : msgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                  <MessageSquare className="w-10 h-10 opacity-20" />
                  <p className="text-sm">Nenhuma mensagem ainda. Inicie a conversa!</p>
                </div>
              ) : groupedMsgs.map(group => (
                <div key={group.day} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[11px] text-muted-foreground font-medium px-2 py-0.5 bg-muted rounded-full">{group.day}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  {group.messages.map((m: any) => (
                    <div key={m.id} className={`flex items-end gap-2 ${m.isFromAdmin ? "justify-end" : "justify-start"}`}>
                      {!m.isFromAdmin && (
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                          {(m.senderName || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className={`max-w-[72%] ${m.isFromAdmin ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                        {!m.isFromAdmin && (
                          <p className="text-[10px] font-semibold text-muted-foreground ml-1">{m.senderName}</p>
                        )}
                        <div className={`rounded-2xl px-3.5 py-2.5 ${m.isFromAdmin
                          ? "bg-blue-600 text-white rounded-br-sm"
                          : "bg-white border rounded-bl-sm shadow-sm"
                        }`}>
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        </div>
                        <div className={`flex items-center gap-1 px-1 ${m.isFromAdmin ? "flex-row-reverse" : ""}`}>
                          <span className={`text-[10px] ${m.isFromAdmin ? "text-muted-foreground" : "text-muted-foreground"}`}>{chatFullTime(m.createdAt)}</span>
                          {m.isFromAdmin && (
                            <CheckCircle2 className={`w-3 h-3 ${m.isRead ? "text-blue-500" : "text-muted-foreground/40"}`} />
                          )}
                        </div>
                      </div>
                      {m.isFromAdmin && (
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                          A
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick replies */}
            {showQuickReplies && (
              <div className="border-t bg-muted/20 px-4 py-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Respostas rapidas</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_REPLIES.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => { setMessage(r); setShowQuickReplies(false); textareaRef.current?.focus(); }}
                      className="text-xs bg-white border rounded-full px-3 py-1 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors text-left max-w-[280px] truncate"
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
                <div className="px-5 py-3 text-center text-sm text-muted-foreground bg-muted/30">
                  Esta conversa esta fechada. Reabra para responder.
                </div>
              ) : (
                <div className="px-4 py-3 space-y-2">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 relative">
                      <Textarea
                        ref={textareaRef}
                        placeholder="Digite sua resposta... (Enter para enviar, Shift+Enter para nova linha)"
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        rows={2}
                        className="resize-none text-sm pr-2 min-h-[60px] max-h-[120px]"
                        data-testid="input-admin-chat-message"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
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
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 w-8 p-0 bg-blue-600 hover:bg-blue-700"
                        disabled={!message.trim() || sendMutation.isPending}
                        onClick={handleSend}
                        data-testid="button-admin-chat-send"
                      >
                        {sendMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground text-right">{message.length > 0 ? `${message.length} caracteres` : "Enter para enviar · Shift+Enter para nova linha"}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function generateSubdomainSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30);
}

function NewProviderForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [subdomainEdited, setSubdomainEdited] = useState(false);
  const [form, setForm] = useState({
    name: "", cnpj: "", subdomain: "", plan: "basic",
    adminName: "", adminEmail: "", adminPassword: "",
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/admin/providers", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Provedor criado com sucesso!" });
      onSuccess();
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setForm(p => ({
      ...p,
      name,
      subdomain: subdomainEdited ? p.subdomain : generateSubdomainSlug(name),
    }));
  };

  const handleSubdomainChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSubdomainEdited(true);
    setForm(p => ({ ...p, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30) }));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium mb-1 block">Nome do Provedor</label>
          <Input placeholder="NsLink Telecom" value={form.name} onChange={handleNameChange} data-testid="input-new-provider-name" />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">CNPJ</label>
          <Input placeholder="00.000.000/0000-00" value={form.cnpj} onChange={f("cnpj")} data-testid="input-new-provider-cnpj" />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Subdominio <span className="text-muted-foreground font-normal">(gerado automaticamente)</span></label>
          <div className="flex items-center gap-1">
            <Input placeholder="nslink" value={form.subdomain} onChange={handleSubdomainChange} className="flex-1 font-mono text-sm" data-testid="input-new-provider-subdomain" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">.consultaisp.com.br</span>
          </div>
          {form.subdomain && (
            <p className="text-[10px] text-muted-foreground mt-0.5">URL: <span className="font-mono">{form.subdomain}.consultaisp.com.br</span></p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Plano Inicial</label>
          <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={form.plan} onChange={f("plan")} data-testid="select-new-provider-plan">
            <option value="free">Gratuito</option>
            <option value="basic">Basico</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
      </div>
      <div className="border-t pt-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Admin do Provedor</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium mb-1 block">Nome</label>
            <Input placeholder="Nome completo" value={form.adminName} onChange={f("adminName")} data-testid="input-new-provider-admin-name" />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Email</label>
            <Input type="email" placeholder="admin@provedor.com" value={form.adminEmail} onChange={f("adminEmail")} data-testid="input-new-provider-admin-email" />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Senha</label>
            <Input type="password" placeholder="Min. 6 caracteres" value={form.adminPassword} onChange={f("adminPassword")} data-testid="input-new-provider-admin-password" />
          </div>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending} className="gap-2" data-testid="button-create-provider">
          {mutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Criar Provedor
        </Button>
        <Button variant="ghost" onClick={onSuccess}>Cancelar</Button>
      </div>
    </div>
  );
}

function VisitorChatPanel({ chats }: { chats: any[] }) {
  const [activeChat, setActiveChat] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const { toast } = useToast();
  const qc = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: msgs = [], isLoading: msgsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/visitor-chats", activeChat?.id, "messages"],
    enabled: !!activeChat,
    refetchInterval: 4000,
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/admin/visitor-chats/${activeChat.id}/messages`, { content });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/visitor-chats", activeChat?.id, "messages"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/visitor-chats"] });
      setMessage("");
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/visitor-chats/${id}/status`, { status });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/visitor-chats"] });
      setActiveChat((prev: any) => prev ? { ...prev, status: vars.status } : prev);
    },
  });

  useEffect(() => {
    if (msgs.length > 0) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [msgs.length, activeChat?.id]);

  const handleSend = () => {
    if (!message.trim() || !activeChat) return;
    sendMutation.mutate(message.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const filteredChats = chats.filter(c => {
    const matchSearch = c.visitorName.toLowerCase().includes(search.toLowerCase()) || c.visitorEmail.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || c.status === filter;
    return matchSearch && matchFilter;
  });

  const totalUnread = chats.reduce((s: number, c: any) => s + (c.unreadCount || 0), 0);

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 220px)", minHeight: "560px" }}>
      <div className="w-80 flex-shrink-0 border rounded-xl overflow-hidden flex flex-col bg-background">
        <div className="px-4 py-3 border-b bg-muted/20">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-bold">Chat Visitantes</p>
              <p className="text-xs text-muted-foreground">
                {totalUnread > 0 ? <span className="text-blue-600 font-medium">{totalUnread} nao lida(s)</span> : `${chats.length} conversa(s)`}
              </p>
            </div>
            {totalUnread > 0 && (
              <span className="w-6 h-6 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center font-bold">{totalUnread}</span>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              className="w-full pl-8 pr-3 py-1.5 text-xs border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Buscar visitante..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-visitor-chat-search"
            />
          </div>
          <div className="flex gap-1 mt-2">
            {(["all", "open", "closed"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 text-[11px] py-1 rounded-md font-medium transition-colors ${filter === f ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
                data-testid={`filter-visitor-${f}`}
              >
                {f === "all" ? "Todos" : f === "open" ? "Abertos" : "Fechados"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y">
          {filteredChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground p-4 text-center">
              <MessageSquare className="w-8 h-8 opacity-20" />
              <p className="text-xs">Nenhuma conversa de visitante</p>
            </div>
          ) : filteredChats.map((c: any) => (
            <button
              key={c.id}
              className={`w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors ${activeChat?.id === c.id ? "bg-blue-50 border-l-2 border-l-blue-600" : ""}`}
              onClick={() => setActiveChat(c)}
              data-testid={`visitor-chat-${c.id}`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white ${c.status === "open" ? "bg-gradient-to-br from-green-500 to-emerald-600" : "bg-gradient-to-br from-gray-400 to-gray-500"}`}>
                  {c.visitorName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className={`text-sm truncate ${c.unreadCount > 0 ? "font-bold" : "font-medium"}`}>{c.visitorName}</p>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">{c.lastMessageAt ? chatRelTime(c.lastMessageAt) : ""}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">{c.visitorEmail}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{c.lastMessage ? c.lastMessage.slice(0, 50) : <span className="italic">Sem mensagens</span>}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c.status === "open" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                      {c.status === "open" ? "Aberto" : "Fechado"}
                    </span>
                    {c.unreadCount > 0 && (
                      <span className="w-5 h-5 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{c.unreadCount}</span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 border rounded-xl flex flex-col overflow-hidden bg-background">
        {!activeChat ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500/10 to-emerald-500/10 flex items-center justify-center">
              <MessageSquare className="w-8 h-8 text-green-400 opacity-60" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Selecione uma conversa</p>
              <p className="text-xs text-muted-foreground mt-1">Escolha um visitante ao lado para responder</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/10">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${activeChat.status === "open" ? "bg-gradient-to-br from-green-500 to-emerald-600" : "bg-gradient-to-br from-gray-400 to-gray-500"}`}>
                  {activeChat.visitorName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-sm">{activeChat.visitorName}</p>
                  <p className="text-xs text-muted-foreground">{activeChat.visitorEmail}{activeChat.visitorPhone ? ` | ${activeChat.visitorPhone}` : ""}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeChat.status === "open" ? (
                  <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5" onClick={() => statusMutation.mutate({ id: activeChat.id, status: "closed" })} data-testid="button-close-visitor-chat">
                    <XCircle className="w-3.5 h-3.5" /> Encerrar
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5" onClick={() => statusMutation.mutate({ id: activeChat.id, status: "open" })} data-testid="button-reopen-visitor-chat">
                    <RefreshCw className="w-3.5 h-3.5" /> Reabrir
                  </Button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-slate-50/50">
              {msgsLoading ? (
                <div className="flex items-center justify-center h-full"><RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" /></div>
              ) : msgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                  <p className="text-xs">Nenhuma mensagem ainda</p>
                </div>
              ) : msgs.map((m: any) => (
                <div key={m.id} className={`flex items-end gap-2 ${m.isFromAdmin ? "justify-end" : "justify-start"}`}>
                  {!m.isFromAdmin && (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                      {activeChat.visitorName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className={`max-w-[70%] flex flex-col gap-0.5 ${m.isFromAdmin ? "items-end" : "items-start"}`}>
                    <div className={`rounded-2xl px-3.5 py-2.5 ${m.isFromAdmin ? "bg-blue-600 text-white rounded-br-sm" : "bg-white border rounded-bl-sm shadow-sm"}`}>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
                    </div>
                    <p className="text-[10px] px-1 text-muted-foreground">{chatFullTime(m.createdAt)}</p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t bg-background flex-shrink-0">
              {activeChat.status === "closed" ? (
                <div className="px-4 py-3 text-center text-xs text-muted-foreground">Conversa encerrada.</div>
              ) : (
                <div className="px-3 py-3 flex gap-2 items-end">
                  <textarea
                    ref={textareaRef}
                    placeholder="Responder visitante... (Enter para enviar)"
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={2}
                    className="flex-1 text-sm border rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[52px] max-h-[100px] bg-background"
                    data-testid="input-visitor-reply"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 w-9 p-0 rounded-xl bg-blue-600 hover:bg-blue-700 flex-shrink-0"
                    disabled={!message.trim() || sendMutation.isPending}
                    onClick={handleSend}
                    data-testid="button-visitor-reply-send"
                  >
                    {sendMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProviderCreditsModal({ provider, onClose }: { provider: any; onClose: () => void }) {
  const [isp, setIsp] = useState("0");
  const [spc, setSpc] = useState("0");
  const [notes, setNotes] = useState("");
  const [plan, setPlan] = useState(provider.plan);
  const { toast } = useToast();
  const qc = useQueryClient();

  const creditsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/providers/${provider.id}/credits`, {
        ispCredits: parseInt(isp) || 0, spcCredits: parseInt(spc) || 0, notes,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      toast({ title: "Creditos adicionados!" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const planMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/providers/${provider.id}/plan`, { plan, notes });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/plan-history"] });
      toast({ title: "Plano alterado!" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <CreditCard className="w-5 h-5" />Gerenciar {provider.name}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Alterar Plano</label>
            <div className="flex gap-2">
              <select
                className="flex-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                data-testid="select-provider-plan"
              >
                <option value="free">Gratuito</option>
                <option value="basic">Basico</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
              <Button onClick={() => planMutation.mutate()} disabled={planMutation.isPending || plan === provider.plan} className="gap-1" data-testid="button-save-plan">
                {planMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>

          <div className="border-t pt-3">
            <label className="text-sm font-medium mb-2 block">Adicionar Creditos</label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">ISP</label>
                <Input type="number" value={isp} onChange={(e) => setIsp(e.target.value)} placeholder="0" data-testid="input-isp-credits" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">SPC</label>
                <Input type="number" value={spc} onChange={(e) => setSpc(e.target.value)} placeholder="0" data-testid="input-spc-credits" />
              </div>
            </div>
            <div className="mb-2">
              <Input placeholder="Observacao (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-credit-notes" />
            </div>
            <Button onClick={() => creditsMutation.mutate()} disabled={creditsMutation.isPending} className="w-full gap-1.5" data-testid="button-add-credits">
              {creditsMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Adicionar Creditos
            </Button>
          </div>

          <div className="border-t pt-3 text-xs text-muted-foreground">
            Creditos atuais: ISP <strong>{provider.ispCredits}</strong> | SPC <strong>{provider.spcCredits}</strong>
          </div>
        </div>

        <Button variant="ghost" className="mt-3 w-full" onClick={onClose}>Fechar</Button>
      </div>
    </div>
  );
}

export default function AdminSistemaPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const VALID_TABS = ["painel", "cadastros", "provedores", "usuarios", "erps", "financeiro", "suporte", "integracoes"];

  const getInitialTab = () => {
    const hash = window.location.hash.replace("#", "");
    return VALID_TABS.includes(hash) ? hash : "painel";
  };

  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [supportSubTab, setSupportSubTab] = useState<"provedores" | "visitantes">("provedores");

  const changeTab = useCallback((tab: string) => {
    setActiveTab(tab);
    window.history.replaceState(null, "", `/admin-sistema#${tab}`);
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      if (VALID_TABS.includes(hash)) setActiveTab(hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const [showNewProvider, setShowNewProvider] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<any>(null);
  const [providerSearch, setProviderSearch] = useState("");
  const [cadastroSearch, setCadastroSearch] = useState("");
  const [cadastroFilter, setCadastroFilter] = useState("all");
  const [userSearch, setUserSearch] = useState("");
  const [invoiceFilter, setInvoiceFilter] = useState("all");
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({
    providerId: "", period: "", amount: "", planAtTime: "basic",
    ispCreditsIncluded: "0", spcCreditsIncluded: "0",
    dueDate: "", notes: "",
  });
  const isSuperAdmin = user?.role === "superadmin";
  const [, navigate] = useLocation();

  const [expandedN8n, setExpandedN8n] = useState<number | null>(null);
  const [n8nForms, setN8nForms] = useState<Record<number, { url: string; token: string; showToken: boolean; erpProvider: string }>>({});
  const [n8nTestResults, setN8nTestResults] = useState<Record<number, { ok: boolean; msg: string } | null>>({});
  const [n8nPending, setN8nPending] = useState<Record<number, { saving?: boolean; testing?: boolean }>>({});

  const getN8nForm = (p: any) => n8nForms[p.id] ?? { url: p.n8nWebhookUrl ?? "", token: p.n8nAuthToken ?? "", showToken: false, erpProvider: p.n8nErpProvider ?? "" };

  const saveN8nForProvider = async (providerId: number, form: { url: string; token: string; erpProvider?: string }) => {
    setN8nPending(prev => ({ ...prev, [providerId]: { ...prev[providerId], saving: true } }));
    try {
      await fetch(`/api/admin/providers/${providerId}/n8n-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n8nWebhookUrl: form.url, n8nAuthToken: form.token, n8nErpProvider: form.erpProvider || null }),
        credentials: "include",
      });
      toast({ title: "N8N salvo", description: "Configuracao N8N atualizada com sucesso." });
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
    } catch {
      toast({ title: "Erro", description: "Nao foi possivel salvar.", variant: "destructive" });
    } finally {
      setN8nPending(prev => ({ ...prev, [providerId]: { ...prev[providerId], saving: false } }));
    }
  };

  const testN8nForProvider = async (providerId: number) => {
    setN8nPending(prev => ({ ...prev, [providerId]: { ...prev[providerId], testing: true } }));
    setN8nTestResults(prev => ({ ...prev, [providerId]: null }));
    try {
      const r = await fetch(`/api/admin/providers/${providerId}/n8n-config/test`, { method: "POST", credentials: "include" });
      const d = await r.json();
      setN8nTestResults(prev => ({ ...prev, [providerId]: { ok: d.ok, msg: d.message } }));
    } catch {
      setN8nTestResults(prev => ({ ...prev, [providerId]: { ok: false, msg: "Erro de conexao" } }));
    } finally {
      setN8nPending(prev => ({ ...prev, [providerId]: { ...prev[providerId], testing: false } }));
    }
  };

  const toggleN8nForProvider = async (p: any) => {
    setN8nPending(prev => ({ ...prev, [p.id]: { ...prev[p.id], saving: true } }));
    try {
      await fetch(`/api/admin/providers/${p.id}/n8n-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n8nEnabled: !p.n8nEnabled }),
        credentials: "include",
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
    } catch {
      toast({ title: "Erro", description: "Nao foi possivel atualizar.", variant: "destructive" });
    } finally {
      setN8nPending(prev => ({ ...prev, [p.id]: { ...prev[p.id], saving: false } }));
    }
  };

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/admin/stats"],
    enabled: isSuperAdmin,
  });
  const { data: allProviders = [], isLoading: providersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    enabled: isSuperAdmin,
  });
  const { data: allUsers = [], isLoading: usersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    enabled: isSuperAdmin,
  });
  const { data: chatThreads = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/chat/threads"],
    refetchInterval: isSuperAdmin ? 10000 : false,
    enabled: isSuperAdmin,
  });
  const { data: visitorChats = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/visitor-chats"],
    refetchInterval: isSuperAdmin ? 10000 : false,
    enabled: isSuperAdmin,
  });
  const { data: planHistory = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/plan-history"],
    enabled: isSuperAdmin,
  });
  const { data: financialSummary } = useQuery<any>({
    queryKey: ["/api/admin/financial/summary"],
    enabled: isSuperAdmin,
  });
  const { data: allInvoices = [], isLoading: invoicesLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/invoices"],
    enabled: isSuperAdmin,
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/providers/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      toast({ title: "Provedor desativado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateVerificationMutation = useMutation({
    mutationFn: async ({ id, verificationStatus }: { id: number; verificationStatus: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/providers/${id}`, { verificationStatus });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      const statusLabels: Record<string, string> = { approved: "aprovado", rejected: "rejeitado", pending: "movido para pendente" };
      toast({ title: `Cadastro ${statusLabels[variables.verificationStatus] || "atualizado"} com sucesso` });
    },
    onError: (e: any) => toast({ title: "Erro ao atualizar status", description: e.message, variant: "destructive" }),
  });

  const resendVerificationMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/providers/${id}/resend-verification`, {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Email enviado", description: data.message || "Email de verificacao reenviado com sucesso." });
    },
    onError: (e: any) => toast({ title: "Erro ao reenviar email", description: e.message, variant: "destructive" }),
  });

  const deleteProviderMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/providers/${id}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      toast({ title: "Provedor excluido", description: "O cadastro e todos os dados associados foram removidos." });
    },
    onError: (e: any) => toast({ title: "Erro ao excluir", description: e.message, variant: "destructive" }),
  });


  const [editingEmailUser, setEditingEmailUser] = useState<{ id: number; name: string; email: string } | null>(null);
  const [newEmail, setNewEmail] = useState("");

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/users/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Usuario removido" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateEmailMutation = useMutation({
    mutationFn: async ({ id, email }: { id: number; email: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}/email`, { email });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Email atualizado", description: "O email de login foi alterado com sucesso." });
      setEditingEmailUser(null);
      setNewEmail("");
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/invoices", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      setShowNewInvoice(false);
      setInvoiceForm({ providerId: "", period: "", amount: "", planAtTime: "basic", ispCreditsIncluded: "0", spcCreditsIncluded: "0", dueDate: "", notes: "" });
      toast({ title: "Fatura emitida com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro ao emitir fatura", description: e.message, variant: "destructive" }),
  });

  const updateInvoiceStatusMutation = useMutation({
    mutationFn: async ({ id, status, paidAmount }: { id: number; status: string; paidAmount?: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/invoices/${id}/status`, { status, paidAmount });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      toast({ title: "Status da fatura atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const generateMonthlyMutation = useMutation({
    mutationFn: async (period: string) => {
      const res = await apiRequest("POST", "/api/admin/invoices/generate-monthly", { period });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      toast({ title: "Faturas geradas", description: data.message });
    },
    onError: (e: any) => toast({ title: "Erro ao gerar faturas", description: e.message, variant: "destructive" }),
  });

  const cancelInvoiceMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/invoices/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      toast({ title: "Fatura cancelada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const { data: asaasStatus } = useQuery<any>({
    queryKey: ["/api/admin/asaas/status"],
    enabled: isSuperAdmin && activeTab === "financeiro",
    staleTime: 60000,
  });

  const { data: erpCatalogList = [], isLoading: erpCatalogLoading, refetch: refetchErpCatalog } = useQuery<ErpCatalog[]>({
    queryKey: ["/api/erp-catalog"],
    enabled: isSuperAdmin,
  });

  const BLANK_ERP_FORM = { key: "", name: "", description: "", gradient: "from-teal-500 to-teal-600", authType: "bearer", authHint: "", active: true, logoBase64: "" };
  const [showErpForm, setShowErpForm] = useState(false);
  const [editingErp, setEditingErp] = useState<ErpCatalog | null>(null);
  const [erpForm, setErpForm] = useState({ ...BLANK_ERP_FORM });
  const [erpLogoPreview, setErpLogoPreview] = useState<string>("");

  const createErpMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/erp-catalog", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/erp-catalog"] });
      setShowErpForm(false);
      setEditingErp(null);
      setErpForm({ ...BLANK_ERP_FORM });
      setErpLogoPreview("");
      toast({ title: "ERP cadastrado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro ao cadastrar ERP", description: e.message, variant: "destructive" }),
  });

  const updateErpMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/admin/erp-catalog/${id}`, data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/erp-catalog"] });
      setShowErpForm(false);
      setEditingErp(null);
      setErpForm({ ...BLANK_ERP_FORM });
      setErpLogoPreview("");
      toast({ title: "ERP atualizado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro ao atualizar ERP", description: e.message, variant: "destructive" }),
  });

  const deleteErpMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/erp-catalog/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/erp-catalog"] });
      toast({ title: "ERP removido" });
    },
    onError: (e: any) => toast({ title: "Erro ao remover", description: e.message, variant: "destructive" }),
  });

  const toggleErpActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/erp-catalog/${id}`, { active });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/erp-catalog"] }),
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const handleErpLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast({ title: "Imagem muito grande", description: "Maximo 2MB", variant: "destructive" }); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setErpLogoPreview(base64);
      setErpForm(f => ({ ...f, logoBase64: base64 }));
    };
    reader.readAsDataURL(file);
  };

  const openEditErp = (erp: ErpCatalog) => {
    setEditingErp(erp);
    setErpForm({ key: erp.key, name: erp.name, description: erp.description ?? "", gradient: erp.gradient, authType: erp.authType, authHint: erp.authHint ?? "", active: erp.active, logoBase64: erp.logoBase64 ?? "" });
    setErpLogoPreview(erp.logoBase64 ?? "");
    setShowErpForm(true);
  };

  const handleErpSubmit = () => {
    if (!erpForm.key || !erpForm.name) { toast({ title: "Campos obrigatorios", description: "Chave e Nome sao obrigatorios", variant: "destructive" }); return; }
    const payload = { ...erpForm, logoBase64: erpForm.logoBase64 || null };
    if (editingErp) { updateErpMutation.mutate({ id: editingErp.id, data: payload }); }
    else { createErpMutation.mutate(payload); }
  };

  const [asaasChargeModal, setAsaasChargeModal] = useState<{ invoiceId: number; invoiceNumber: string } | null>(null);
  const [asaasPixModal, setAsaasPixModal] = useState<{ invoiceId: number; pixData: any } | null>(null);

  const createChargeMutation = useMutation({
    mutationFn: async ({ id, billingType }: { id: number; billingType: string }) => {
      const res = await apiRequest("POST", `/api/admin/invoices/${id}/asaas/charge`, { billingType });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      setAsaasChargeModal(null);
      toast({ title: "Cobranca Asaas criada", description: `ID: ${data.charge?.id}` });
    },
    onError: (e: any) => toast({ title: "Erro Asaas", description: e.message, variant: "destructive" }),
  });

  const syncChargeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/invoices/${id}/asaas/sync`, {});
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      toast({ title: "Status sincronizado com Asaas" });
    },
    onError: (e: any) => toast({ title: "Erro ao sincronizar", description: e.message, variant: "destructive" }),
  });

  const pixMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("GET", `/api/admin/invoices/${id}/asaas/pix`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data, id) => {
      const inv = (allInvoices as any[]).find((i: any) => i.id === id);
      setAsaasPixModal({ invoiceId: id as number, pixData: data });
    },
    onError: (e: any) => toast({ title: "Erro ao buscar PIX", description: e.message, variant: "destructive" }),
  });

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <Shield className="w-16 h-16 text-red-500 opacity-40" />
        <h2 className="text-xl font-bold">Acesso Restrito</h2>
        <p className="text-muted-foreground text-center">Esta area e exclusiva para administradores do sistema Consulta ISP.</p>
      </div>
    );
  }

  const filteredProviders = allProviders.filter((p: any) =>
    p.adminEmailVerified === true && (
      p.name.toLowerCase().includes(providerSearch.toLowerCase()) ||
      (p.subdomain || "").toLowerCase().includes(providerSearch.toLowerCase())
    )
  );

  const filteredCadastros = allProviders
    .filter((p: any) => {
      const matchesSearch = p.name.toLowerCase().includes(cadastroSearch.toLowerCase()) ||
        (p.contactEmail || "").toLowerCase().includes(cadastroSearch.toLowerCase()) ||
        (p.cnpj || "").includes(cadastroSearch);
      const matchesFilter = cadastroFilter === "all" || p.verificationStatus === cadastroFilter;
      return matchesSearch && matchesFilter;
    })
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const cadastroCounts = {
    all: allProviders.length,
    pending: allProviders.filter((p: any) => p.verificationStatus === "pending").length,
    approved: allProviders.filter((p: any) => p.verificationStatus === "approved").length,
    rejected: allProviders.filter((p: any) => p.verificationStatus === "rejected").length,
  };

  const filteredUsers = allUsers.filter(u =>
    u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  const totalUnread = chatThreads.reduce((sum: number, t: any) => sum + (t.unreadCount || 0), 0);

  const STAT_CARDS = [
    { label: "Provedores", value: stats?.providers ?? "-", icon: Building2, color: "from-blue-500 to-blue-600", sub: `${stats?.activeProviders ?? 0} ativos` },
    { label: "Usuarios", value: stats?.users ?? "-", icon: Users, color: "from-indigo-500 to-indigo-600", sub: "cadastrados" },
    { label: "Clientes", value: stats?.customers ?? "-", icon: User, color: "from-purple-500 to-purple-600", sub: "em todos os provedores" },
    { label: "Consultas ISP", value: stats?.ispConsultations ?? "-", icon: Search, color: "from-emerald-500 to-emerald-600", sub: "total realizado" },
    { label: "Consultas SPC", value: stats?.spcConsultations ?? "-", icon: BarChart3, color: "from-violet-500 to-violet-600", sub: "total realizado" },
    { label: "Mensagens novas", value: totalUnread, icon: MessageSquare, color: "from-rose-500 to-rose-600", sub: "aguardando resposta" },
  ];

  const VERIFICATION_LABELS: Record<string, { label: string; color: string; icon: any }> = {
    pending:  { label: "Pendente",   color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",   icon: Clock },
    approved: { label: "Aprovado",   color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300", icon: CheckCircle },
    rejected: { label: "Rejeitado",  color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",           icon: XCircle },
  };

  const PAGE_META: Record<string, { title: string; desc: string; icon: any; color: string }> = {
    painel:    { title: "Painel Geral",        desc: "Visao geral do sistema",          icon: BarChart3,    color: "from-red-600 to-rose-700" },
    cadastros:    { title: "Cadastros",            desc: "Cadastros realizados pela landing page",       icon: Activity,     color: "from-amber-600 to-orange-700" },
    provedores:   { title: "Provedores",          desc: "Gerencie todos os provedores",                icon: Building2,    color: "from-blue-600 to-indigo-700" },
    usuarios:     { title: "Usuarios",            desc: "Contas e acessos do sistema",                 icon: Users,        color: "from-violet-600 to-purple-700" },
    erps:         { title: "ERPs Cadastrados",    desc: "Gerencie os sistemas ERP suportados",         icon: Database,     color: "from-teal-600 to-emerald-700" },
    financeiro:   { title: "Faturas e Cobrancas", desc: "Receita, faturas e pagamentos",               icon: DollarSign,   color: "from-emerald-600 to-teal-700" },
    suporte:      { title: "Suporte",             desc: "Chat direto com provedores",                  icon: MessageSquare,color: "from-orange-500 to-amber-600" },
    integracoes:  { title: "Integracoes",         desc: "Status de integracao N8N e ERP por provedor", icon: Zap,          color: "from-orange-500 to-red-600" },
  };
  const meta = PAGE_META[activeTab] || PAGE_META.painel;
  const MetaIcon = meta.icon;

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto" data-testid="admin-sistema-page">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta.color} flex items-center justify-center flex-shrink-0`}>
          <MetaIcon className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight">{meta.title}</h1>
          <p className="text-xs text-muted-foreground">{meta.desc}</p>
        </div>
        <Badge className="ml-auto bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 gap-1.5 flex-shrink-0 text-xs">
          <Shield className="w-3 h-3" />Super Admin
        </Badge>
      </div>

      <div>
        {activeTab === "painel" && (<div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {STAT_CARDS.map((s) => (
              <Card key={s.label} className="p-4" data-testid={`stat-card-${s.label.toLowerCase().replace(/ /g, "-")}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center`}>
                    <s.icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="text-[11px] text-muted-foreground/70">{s.sub}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                <Building2 className="w-4 h-4" />Provedores Recentes
              </h3>
              <div className="space-y-2">
                {allProviders.slice(0, 5).map((p: any) => (
                  <div key={p.id} className="flex items-center gap-3 py-1.5 border-b last:border-0" data-testid={`provider-row-${p.id}`}>
                    <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300">
                      {p.name?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.subdomain}.consultaisp.com.br</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs ${PLAN_LABELS[p.plan]?.color || ""}`}>
                        {PLAN_LABELS[p.plan]?.label}
                      </Badge>
                      <span className={`w-2 h-2 rounded-full ${p.status === "active" ? "bg-emerald-500" : "bg-gray-400"}`} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                <ArrowUpDown className="w-4 h-4" />Historico de Planos
              </h3>
              <div className="space-y-2">
                {planHistory.slice(0, 5).map((h: any) => (
                  <div key={h.id} className="py-1.5 border-b last:border-0 text-sm">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {new Date(h.createdAt).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    {h.oldPlan && h.newPlan ? (
                      <p className="text-xs mt-0.5">
                        Plano: <strong>{PLAN_LABELS[h.oldPlan]?.label}</strong> → <strong>{PLAN_LABELS[h.newPlan]?.label}</strong>
                      </p>
                    ) : (
                      <p className="text-xs mt-0.5">
                        Creditos: ISP <strong>+{h.ispCreditsAdded}</strong> / SPC <strong>+{h.spcCreditsAdded}</strong>
                      </p>
                    )}
                    {h.notes && <p className="text-xs text-muted-foreground truncate">{h.notes}</p>}
                  </div>
                ))}
                {planHistory.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">Nenhum historico ainda</p>
                )}
              </div>
            </Card>
          </div>
        </div>)}

        {activeTab === "cadastros" && (<div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {(["all", "pending", "approved", "rejected"] as const).map((f) => {
              const labels: Record<string, { label: string; color: string; activeColor: string }> = {
                all:      { label: "Todos",     color: "text-gray-600",    activeColor: "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900" },
                pending:  { label: "Pendentes", color: "text-amber-600",   activeColor: "bg-amber-600 text-white" },
                approved: { label: "Aprovados", color: "text-emerald-600", activeColor: "bg-emerald-600 text-white" },
                rejected: { label: "Rejeitados",color: "text-red-600",     activeColor: "bg-red-600 text-white" },
              };
              const l = labels[f];
              const isActive = cadastroFilter === f;
              return (
                <button
                  key={f}
                  onClick={() => setCadastroFilter(f)}
                  className={`rounded-lg p-3 text-left transition-all border ${isActive ? l.activeColor + " border-transparent" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-gray-300"}`}
                  data-testid={`button-filter-cadastro-${f}`}
                >
                  <p className={`text-2xl font-bold ${isActive ? "" : l.color}`}>{cadastroCounts[f]}</p>
                  <p className={`text-xs mt-0.5 ${isActive ? "opacity-80" : "text-muted-foreground"}`}>{l.label}</p>
                </button>
              );
            })}
          </div>

          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, email ou CNPJ..."
              className="pl-9"
              value={cadastroSearch}
              onChange={(e) => setCadastroSearch(e.target.value)}
              data-testid="input-search-cadastro"
            />
          </div>

          <Card className="overflow-hidden">
            {providersLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredCadastros.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Activity className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">Nenhum cadastro encontrado</p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredCadastros.map((p: any) => {
                  const vs = VERIFICATION_LABELS[p.verificationStatus] || VERIFICATION_LABELS.pending;
                  const VsIcon = vs.icon;
                  const adminUser = allUsers.find((u: any) => u.providerId === p.id && u.role === "admin");
                  const createdDate = p.createdAt ? new Date(p.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
                  return (
                    <div key={p.id} className="px-5 py-4" data-testid={`cadastro-row-${p.id}`}>
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                          {p.name?.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm">{p.name}</p>
                            <Badge className={`text-xs gap-1 ${vs.color}`} data-testid={`badge-status-${p.id}`}>
                              <VsIcon className="w-3 h-3" />{vs.label}
                            </Badge>
                            {p.adminEmailVerified ? (
                              <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 gap-1" data-testid={`badge-email-verified-${p.id}`}>
                                <CheckCircle className="w-3 h-3" />Email verificado
                              </Badge>
                            ) : (
                              <Badge className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 gap-1" data-testid={`badge-email-unverified-${p.id}`}>
                                <AlertCircle className="w-3 h-3" />Email nao verificado
                              </Badge>
                            )}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                              <User className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{adminUser?.name || "-"}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Send className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{p.contactEmail || adminUser?.email || "-"}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <FileText className="w-3 h-3 flex-shrink-0" />
                              <span>{p.cnpj ? p.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : "-"}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Clock className="w-3 h-3 flex-shrink-0" />
                              <span>{createdDate}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Globe className="w-3 h-3 flex-shrink-0" />
                              <span>{p.subdomain ? `${p.subdomain}.consultaisp.com.br` : "-"}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <CreditCard className="w-3 h-3 flex-shrink-0" />
                              <span>Plano: {PLAN_LABELS[p.plan]?.label || p.plan}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Users className="w-3 h-3 flex-shrink-0" />
                              <span>{p.userCount || 0} usuario(s)</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.status === "active" ? "bg-emerald-500" : "bg-gray-400"}`} />
                              <span>{p.status === "active" ? "Ativo" : "Inativo"}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {p.verificationStatus === "pending" && (
                            <>
                              <Button
                                size="sm"
                                className="gap-1.5 text-xs h-8 bg-emerald-600 hover:bg-emerald-700"
                                onClick={() => updateVerificationMutation.mutate({ id: p.id, verificationStatus: "approved" })}
                                disabled={updateVerificationMutation.isPending}
                                data-testid={`button-approve-${p.id}`}
                              >
                                <CheckCircle className="w-3.5 h-3.5" />Aprovar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 text-xs h-8 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                                onClick={() => {
                                  if (confirm(`Rejeitar o cadastro de ${p.name}?`))
                                    updateVerificationMutation.mutate({ id: p.id, verificationStatus: "rejected" });
                                }}
                                disabled={updateVerificationMutation.isPending}
                                data-testid={`button-reject-${p.id}`}
                              >
                                <XCircle className="w-3.5 h-3.5" />Rejeitar
                              </Button>
                            </>
                          )}
                          {p.verificationStatus === "rejected" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 text-xs h-8"
                                onClick={() => updateVerificationMutation.mutate({ id: p.id, verificationStatus: "approved" })}
                                disabled={updateVerificationMutation.isPending}
                                data-testid={`button-reapprove-${p.id}`}
                              >
                                <CheckCircle className="w-3.5 h-3.5" />Aprovar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 text-xs h-8 text-amber-600 border-amber-200 hover:bg-amber-50"
                                onClick={() => updateVerificationMutation.mutate({ id: p.id, verificationStatus: "pending" })}
                                disabled={updateVerificationMutation.isPending}
                                data-testid={`button-set-pending-rejected-${p.id}`}
                              >
                                <Clock className="w-3.5 h-3.5" />Pendente
                              </Button>
                            </>
                          )}
                          {p.verificationStatus === "approved" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 text-xs h-8 text-amber-600 border-amber-200 hover:bg-amber-50"
                              onClick={() => updateVerificationMutation.mutate({ id: p.id, verificationStatus: "pending" })}
                              disabled={updateVerificationMutation.isPending}
                              data-testid={`button-set-pending-${p.id}`}
                            >
                              <Clock className="w-3.5 h-3.5" />Pendente
                            </Button>
                          )}
                          {!p.adminEmailVerified && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 text-xs h-8 text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                              onClick={() => resendVerificationMutation.mutate(p.id)}
                              disabled={resendVerificationMutation.isPending}
                              data-testid={`button-resend-email-${p.id}`}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />Reenviar Email
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs h-8 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                            onClick={() => {
                              if (confirm(`Excluir permanentemente o cadastro de "${p.name}"?\n\nTodos os dados associados (usuarios, clientes, consultas, faturas etc.) serao removidos. Esta acao nao pode ser desfeita.`))
                                deleteProviderMutation.mutate(p.id);
                            }}
                            disabled={deleteProviderMutation.isPending}
                            data-testid={`button-delete-cadastro-${p.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />Excluir
                          </Button>
                          <Button
                            variant="default"
                            size="sm"
                            className="gap-1.5 text-xs h-8"
                            onClick={() => navigate(`/admin/provedor/${p.id}`)}
                            data-testid={`button-view-cadastro-${p.id}`}
                          >
                            <Eye className="w-3.5 h-3.5" />Ver
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>)}

        {activeTab === "provedores" && (<div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar provedor..."
                className="pl-9"
                value={providerSearch}
                onChange={(e) => setProviderSearch(e.target.value)}
                data-testid="input-search-provider"
              />
            </div>
            <Button onClick={() => setShowNewProvider(!showNewProvider)} className="gap-1.5" data-testid="button-new-provider">
              <Plus className="w-4 h-4" />Novo Provedor
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
            Exibindo apenas provedores com email verificado. Cadastros pendentes ficam visiveis na aba <button className="font-medium text-violet-600 hover:underline" onClick={() => setActiveTab("cadastros")}>Cadastros</button>.
            <span className="ml-auto text-xs font-medium">{filteredProviders.length} provedor(es)</span>
          </div>

          {showNewProvider && (
            <Card className="p-5">
              <h3 className="font-semibold mb-4">Criar Novo Provedor</h3>
              <NewProviderForm onSuccess={() => setShowNewProvider(false)} />
            </Card>
          )}

          <Card className="overflow-hidden">
            {providersLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="divide-y">
                {filteredProviders.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-4 px-5 py-4" data-testid={`admin-provider-row-${p.id}`}>
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                      {p.name?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">{p.name}</p>
                        <span className={`w-2 h-2 rounded-full ${p.status === "active" ? "bg-emerald-500" : "bg-gray-400"}`} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{p.subdomain}.consultaisp.com.br</span>
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{p.userCount} usuarios</span>
                        <span>ISP: {p.ispCredits} | SPC: {p.spcCredits}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs ${PLAN_LABELS[p.plan]?.color || ""}`}>
                        {PLAN_LABELS[p.plan]?.label}
                      </Badge>
                      <Button
                        variant="default"
                        size="sm"
                        className="gap-1.5 text-xs h-8"
                        onClick={() => navigate(`/admin/provedor/${p.id}`)}
                        data-testid={`button-painel-provider-${p.id}`}
                      >
                        <ChevronRight className="w-3.5 h-3.5" />Painel
                      </Button>
                      {p.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => {
                            if (confirm(`Desativar ${p.name}?`)) deactivateMutation.mutate(p.id);
                          }}
                          data-testid={`button-deactivate-provider-${p.id}`}
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>)}

        {activeTab === "usuarios" && (<div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar usuario..."
                className="pl-9"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                data-testid="input-search-user"
              />
            </div>
            <Badge variant="secondary">{filteredUsers.length} usuario(s)</Badge>
          </div>

          {editingEmailUser && (
            <Card className="p-4 border-2 border-blue-200 dark:border-blue-900">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Pencil className="w-4 h-4 text-blue-600" />
                  Alterar email de login
                </h3>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingEmailUser(null); setNewEmail(""); }} data-testid="button-cancel-edit-email">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Usuario: <span className="font-medium text-foreground">{editingEmailUser.name}</span> — Email atual: <span className="font-medium text-foreground">{editingEmailUser.email}</span>
              </p>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Novo email de login"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="flex-1 max-w-sm"
                  data-testid="input-new-email"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newEmail.includes("@")) {
                      updateEmailMutation.mutate({ id: editingEmailUser.id, email: newEmail });
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={!newEmail.includes("@") || updateEmailMutation.isPending}
                  onClick={() => updateEmailMutation.mutate({ id: editingEmailUser.id, email: newEmail })}
                  data-testid="button-save-email"
                >
                  {updateEmailMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Salvar
                </Button>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            {usersLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="divide-y">
                {filteredUsers.map((u: any) => (
                  <div key={u.id} className="flex items-center gap-4 px-5 py-3" data-testid={`admin-user-row-${u.id}`}>
                    <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-sm font-bold text-indigo-700 dark:text-indigo-300">
                      {u.name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs ${
                        u.role === "superadmin" ? "bg-red-100 text-red-700" :
                        u.role === "admin" ? "bg-blue-100 text-blue-700" :
                        "bg-gray-100 text-gray-700"
                      }`}>
                        {u.role === "superadmin" ? "Super Admin" : u.role === "admin" ? "Admin" : "Usuario"}
                      </Badge>
                      {u.emailVerified ? (
                        <CheckCircle className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-amber-500" />
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                        onClick={() => { setEditingEmailUser({ id: u.id, name: u.name, email: u.email }); setNewEmail(""); }}
                        title="Alterar email"
                        data-testid={`button-edit-email-${u.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      {u.role !== "superadmin" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => {
                            if (confirm(`Remover usuario ${u.name}?`)) deleteUserMutation.mutate(u.id);
                          }}
                          data-testid={`button-delete-admin-user-${u.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>)}

        {activeTab === "erps" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-muted-foreground">
                {erpCatalogList.length} ERP(s) cadastrado(s). Adicione logos para deixar mais visual para os provedores.
              </p>
              <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => { setEditingErp(null); setErpForm({ ...BLANK_ERP_FORM }); setErpLogoPreview(""); setShowErpForm(true); }} data-testid="button-new-erp">
                <Plus className="w-3.5 h-3.5" />Novo ERP
              </Button>
            </div>

            {showErpForm && (
              <Card className="p-5 border-2 border-teal-200 dark:border-teal-900">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-sm">{editingErp ? "Editar ERP" : "Cadastrar Novo ERP"}</h3>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setShowErpForm(false); setEditingErp(null); }} data-testid="button-close-erp-form">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs font-medium mb-1 block">Chave (slug) *</Label>
                      <Input value={erpForm.key} onChange={e => setErpForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") }))} placeholder="ex: ixc, sgp, mk" disabled={!!editingErp} data-testid="input-erp-key" className="h-8 text-sm" />
                      <p className="text-[10px] text-muted-foreground mt-0.5">Identificador unico, sem espacos</p>
                    </div>
                    <div>
                      <Label className="text-xs font-medium mb-1 block">Nome do ERP *</Label>
                      <Input value={erpForm.name} onChange={e => setErpForm(f => ({ ...f, name: e.target.value }))} placeholder="ex: iXC Soft" data-testid="input-erp-name" className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs font-medium mb-1 block">Descricao</Label>
                      <Input value={erpForm.description} onChange={e => setErpForm(f => ({ ...f, description: e.target.value }))} placeholder="ex: ERP para provedores de internet" data-testid="input-erp-description" className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs font-medium mb-1 block">Tipo de autenticacao</Label>
                      <select className="w-full border rounded-md px-3 py-1.5 text-sm bg-background" value={erpForm.authType} onChange={e => setErpForm(f => ({ ...f, authType: e.target.value }))} data-testid="select-erp-auth-type">
                        <option value="bearer">Bearer Token</option>
                        <option value="basic">Basic Auth (usuario + token)</option>
                        <option value="apikey">API Key</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs font-medium mb-1 block">Dica de autenticacao</Label>
                      <Input value={erpForm.authHint} onChange={e => setErpForm(f => ({ ...f, authHint: e.target.value }))} placeholder="ex: Token: chave de API do sistema" data-testid="input-erp-auth-hint" className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs font-medium mb-1 block">Cor do gradiente</Label>
                      <select className="w-full border rounded-md px-3 py-1.5 text-sm bg-background" value={erpForm.gradient} onChange={e => setErpForm(f => ({ ...f, gradient: e.target.value }))} data-testid="select-erp-gradient">
                        {[
                          { label: "Azul", v: "from-blue-500 to-blue-600" },
                          { label: "Roxo", v: "from-purple-500 to-purple-600" },
                          { label: "Verde", v: "from-green-500 to-green-600" },
                          { label: "Laranja", v: "from-orange-500 to-orange-600" },
                          { label: "Indigo", v: "from-indigo-500 to-indigo-600" },
                          { label: "Ciano", v: "from-cyan-500 to-cyan-600" },
                          { label: "Rosa", v: "from-rose-500 to-pink-600" },
                          { label: "Teal", v: "from-teal-500 to-teal-600" },
                          { label: "Ambar", v: "from-amber-500 to-amber-600" },
                          { label: "Vermelho", v: "from-red-500 to-red-600" },
                          { label: "Cinza", v: "from-slate-500 to-slate-600" },
                          { label: "Branco", v: "from-white to-slate-100" },
                        ].map(g => <option key={g.v} value={g.v}>{g.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs font-medium mb-1 block">Logo do ERP</Label>
                      <div className="border-2 border-dashed rounded-xl p-4 flex flex-col items-center gap-3 bg-muted/20">
                        {erpLogoPreview ? (
                          <div className="relative">
                            <img src={erpLogoPreview} alt="Logo preview" className="w-20 h-20 object-contain rounded-lg border bg-white p-1" data-testid="img-erp-logo-preview" />
                            <button className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center" onClick={() => { setErpLogoPreview(""); setErpForm(f => ({ ...f, logoBase64: "" })); }}>
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className={`w-20 h-20 rounded-xl bg-gradient-to-br ${erpForm.gradient} flex items-center justify-center`}>
                            <span className="text-white text-xl font-bold">{(erpForm.name[0] || "?").toUpperCase()}</span>
                          </div>
                        )}
                        <label className="cursor-pointer" data-testid="label-upload-logo">
                          <input type="file" accept="image/*" className="hidden" onChange={handleErpLogoUpload} data-testid="input-erp-logo-file" />
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors border rounded-md px-3 py-1.5">
                            <ImagePlus className="w-3.5 h-3.5" />
                            {erpLogoPreview ? "Trocar logo" : "Enviar logo"}
                          </div>
                        </label>
                        <p className="text-[10px] text-muted-foreground text-center">PNG, JPG ou SVG. Max 2MB.<br/>Sem logo: inicial do nome sobre gradiente.</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setErpForm(f => ({ ...f, active: !f.active }))} className="p-0" data-testid="toggle-erp-active">
                        {erpForm.active ? <ToggleRight className="w-8 h-8 text-emerald-500" /> : <ToggleLeft className="w-8 h-8 text-slate-400" />}
                      </button>
                      <span className="text-sm">{erpForm.active ? "ERP Ativo (visivel para provedores)" : "ERP Inativo (oculto para provedores)"}</span>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button className="flex-1 h-8 text-xs gap-1" onClick={handleErpSubmit} disabled={createErpMutation.isPending || updateErpMutation.isPending} data-testid="button-save-erp">
                        <Save className="w-3.5 h-3.5" />{editingErp ? "Salvar alteracoes" : "Cadastrar ERP"}
                      </Button>
                      <Button variant="outline" className="h-8 text-xs" onClick={() => { setShowErpForm(false); setEditingErp(null); }}>Cancelar</Button>
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {erpCatalogLoading ? (
              <div className="flex items-center justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {erpCatalogList.map(erp => (
                  <Card key={erp.id} className={`relative overflow-hidden ${!erp.active ? "opacity-60" : ""}`} data-testid={`card-erp-${erp.id}`}>
                    <div className={`h-1.5 bg-gradient-to-r ${erp.gradient}`} />
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden ${erp.logoBase64 ? "bg-white border border-slate-200" : `bg-gradient-to-br ${erp.gradient}`}`}>
                          {erp.logoBase64 ? (
                            <img src={erp.logoBase64} alt={erp.name} className="w-full h-full object-contain p-1.5" data-testid={`img-erp-logo-${erp.id}`} />
                          ) : (
                            <span className="text-white text-xl font-bold">{erp.name[0].toUpperCase()}</span>
                          )}
                        </div>
                        <div className="flex gap-1 ml-2">
                          <button className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground" onClick={() => openEditErp(erp)} data-testid={`button-edit-erp-${erp.id}`}>
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button className="w-7 h-7 rounded-md hover:bg-red-50 dark:hover:bg-red-950 flex items-center justify-center text-muted-foreground hover:text-red-600" onClick={() => { if (confirm(`Remover "${erp.name}"?`)) deleteErpMutation.mutate(erp.id); }} data-testid={`button-delete-erp-${erp.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <h3 className="font-semibold text-sm leading-tight" data-testid={`text-erp-name-${erp.id}`}>{erp.name}</h3>
                      {erp.description && <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight" data-testid={`text-erp-desc-${erp.id}`}>{erp.description}</p>}
                      <div className="flex items-center justify-between mt-3 pt-3 border-t">
                        <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono" data-testid={`text-erp-key-${erp.id}`}>{erp.key}</code>
                        <button onClick={() => toggleErpActiveMutation.mutate({ id: erp.id, active: !erp.active })} data-testid={`toggle-erp-status-${erp.id}`}>
                          {erp.active
                            ? <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 text-[10px] h-5 cursor-pointer hover:opacity-80">Ativo</Badge>
                            : <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 text-[10px] h-5 cursor-pointer hover:opacity-80">Inativo</Badge>
                          }
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
                {erpCatalogList.length === 0 && (
                  <div className="col-span-full text-center py-12 text-muted-foreground">
                    <Database className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Nenhum ERP cadastrado ainda.</p>
                    <p className="text-xs mt-1">Clique em "Novo ERP" para adicionar.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "integracoes" && (
          <div className="space-y-4">
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex gap-3">
              <Zap className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-orange-800">
                <p className="font-semibold">Configuracao de Integracoes N8N</p>
                <p className="text-xs mt-0.5 text-orange-700">Configure a integracao N8N para cada provedor. Quando ativa, as consultas ISP sao processadas via API N8N em tempo real. O provedor apenas ve o status (ativo/inativo).</p>
              </div>
            </div>

            <Card className="overflow-hidden">
              <div className="px-5 py-3 border-b bg-slate-50/50 flex items-center justify-between">
                <p className="text-sm font-semibold">Provedores — Integracao N8N</p>
                <Badge variant="secondary">{allProviders.length} provedor(es)</Badge>
              </div>
              {providersLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="divide-y">
                  {allProviders.map((p: any) => {
                    const n8nActive = p.n8nEnabled && p.n8nWebhookUrl;
                    const n8nConfigured = !!p.n8nWebhookUrl;
                    const isOpen = expandedN8n === p.id;
                    const form = getN8nForm(p);
                    const testResult = n8nTestResults[p.id];
                    const isPending = n8nPending[p.id];
                    const erpName = p.n8nErpProvider ? (erpCatalogList.find((e: ErpCatalog) => e.key === p.n8nErpProvider)?.name ?? ERP_MAP[p.n8nErpProvider] ?? p.n8nErpProvider) : null;
                    const adminSelectedErp = n8nForms[p.id]?.erpProvider ?? p.n8nErpProvider ?? "";
                    return (
                      <div key={p.id} data-testid={`integracoes-row-${p.id}`}>
                        {/* Provider row */}
                        <div
                          className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-slate-50 transition-colors"
                          onClick={() => setExpandedN8n(isOpen ? null : p.id)}
                        >
                          <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300 flex-shrink-0">
                            {p.name?.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium">{p.name}</p>
                              {erpName && (
                                <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 flex-shrink-0">
                                  {erpName}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {n8nConfigured ? p.n8nWebhookUrl?.slice(0, 50) + (p.n8nWebhookUrl?.length > 50 ? "..." : "") : "Webhook nao configurado"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              n8nActive ? "bg-emerald-100 text-emerald-700" :
                              n8nConfigured ? "bg-amber-100 text-amber-700" :
                              "bg-slate-100 text-slate-500"
                            }`}>
                              {n8nActive ? "Ativo" : n8nConfigured ? "Inativo" : "Nao config."}
                            </span>
                            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                          </div>
                        </div>

                        {/* Expanded config form */}
                        {isOpen && (
                          <div className="px-5 pb-5 pt-3 bg-slate-50/70 border-t space-y-3">
                            {/* ERP selector */}
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-slate-600">ERP do Provedor</label>
                              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-1.5">
                                {(erpCatalogList.length > 0 ? erpCatalogList.filter(e => e.active) : ERP_OPTIONS).map((erp: any) => {
                                  const isSelected = adminSelectedErp === erp.key;
                                  const grad = erp.gradient ?? erp.grad ?? "from-slate-500 to-slate-600";
                                  return (
                                    <button
                                      key={erp.key}
                                      type="button"
                                      onClick={() => setN8nForms(prev => ({ ...prev, [p.id]: { ...getN8nForm(p), erpProvider: erp.key } }))}
                                      data-testid={`admin-erp-option-${p.id}-${erp.key}`}
                                      className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all text-center ${
                                        isSelected ? "border-violet-500 bg-violet-50" : "border-transparent bg-white hover:bg-slate-100 hover:border-slate-200"
                                      }`}
                                    >
                                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden ${erp.logoBase64 ? "bg-white border border-slate-200" : `bg-gradient-to-br ${grad}`}`}>
                                        {erp.logoBase64 ? (
                                          <img src={erp.logoBase64} alt={erp.name} className="w-full h-full object-contain p-0.5" />
                                        ) : (
                                          <span className="text-white text-xs font-bold">{erp.name[0]}</span>
                                        )}
                                      </div>
                                      <p className={`text-[10px] font-semibold leading-tight ${isSelected ? "text-violet-700" : "text-slate-600"}`}>{erp.name}</p>
                                    </button>
                                  );
                                })}
                              </div>
                              {adminSelectedErp && (
                                <button
                                  type="button"
                                  className="text-xs text-slate-400 hover:text-slate-600"
                                  onClick={() => setN8nForms(prev => ({ ...prev, [p.id]: { ...getN8nForm(p), erpProvider: "" } }))}
                                >
                                  Limpar selecao
                                </button>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-slate-600">URL do Webhook N8N</label>
                              <Input
                                placeholder="https://n8n-seu-servidor.com/webhook/isp-consult"
                                value={form.url}
                                onChange={e => setN8nForms(prev => ({ ...prev, [p.id]: { ...form, url: e.target.value } }))}
                                className="h-9 text-sm"
                                data-testid={`input-n8n-url-${p.id}`}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-slate-600">Token Basic Auth</label>
                              <div className="relative">
                                <Input
                                  type={form.showToken ? "text" : "password"}
                                  placeholder="Token Base64 de autenticacao"
                                  value={form.token}
                                  onChange={e => setN8nForms(prev => ({ ...prev, [p.id]: { ...form, token: e.target.value } }))}
                                  className="h-9 text-sm pr-9"
                                  data-testid={`input-n8n-token-${p.id}`}
                                />
                                <button
                                  type="button"
                                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                  onClick={() => setN8nForms(prev => ({ ...prev, [p.id]: { ...form, showToken: !form.showToken } }))}
                                >
                                  {form.showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                              <p className="text-xs text-muted-foreground">Header enviado: <code className="bg-slate-100 px-1 rounded">Authorization: Basic &lt;token&gt;</code></p>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button
                                size="sm"
                                className="h-8 text-xs gap-1.5 bg-orange-500 hover:bg-orange-600 text-white"
                                onClick={() => saveN8nForProvider(p.id, form)}
                                disabled={isPending?.saving || !form.url}
                                data-testid={`button-n8n-save-${p.id}`}
                              >
                                <Save className="w-3.5 h-3.5" />
                                {isPending?.saving ? "Salvando..." : "Salvar"}
                              </Button>
                              <Button
                                variant="outline" size="sm" className="h-8 text-xs gap-1.5"
                                onClick={() => testN8nForProvider(p.id)}
                                disabled={isPending?.testing || !n8nConfigured}
                                data-testid={`button-n8n-test-${p.id}`}
                              >
                                <Terminal className="w-3.5 h-3.5" />
                                {isPending?.testing ? "Testando..." : "Testar Conexao"}
                              </Button>
                              {n8nConfigured && (
                                <Button
                                  variant="ghost" size="sm"
                                  className={`h-8 text-xs gap-1.5 ${n8nActive ? "text-emerald-600" : "text-slate-500"}`}
                                  onClick={() => toggleN8nForProvider(p)}
                                  disabled={isPending?.saving}
                                  data-testid={`button-n8n-toggle-${p.id}`}
                                >
                                  <Zap className="w-3.5 h-3.5" />
                                  {n8nActive ? "Desativar" : "Ativar"}
                                </Button>
                              )}
                            </div>
                            {testResult && (
                              <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${testResult.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                                {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                                {testResult.msg}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {allProviders.length === 0 && (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      Nenhum provedor cadastrado
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ASAAS Charge Modal */}
        {asaasChargeModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAsaasChargeModal(null)}>
            <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <h2 className="text-base font-bold mb-1 flex items-center gap-2">
                <Wallet className="w-4 h-4 text-blue-500" />Cobrar via Asaas
              </h2>
              <p className="text-xs text-muted-foreground mb-4">Fatura {asaasChargeModal.invoiceNumber}</p>
              <div className="space-y-2">
                {[
                  { type: "UNDEFINED", label: "Livre (cliente escolhe)", icon: Wallet },
                  { type: "PIX", label: "PIX", icon: QrCode },
                  { type: "BOLETO", label: "Boleto Bancario", icon: ScanLine },
                ].map(opt => (
                  <button
                    key={opt.type}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                    disabled={createChargeMutation.isPending}
                    onClick={() => createChargeMutation.mutate({ id: asaasChargeModal.invoiceId, billingType: opt.type })}
                    data-testid={`button-charge-${opt.type.toLowerCase()}`}
                  >
                    {createChargeMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : (
                      <opt.icon className="w-4 h-4 text-blue-500" />
                    )}
                    <span className="text-sm font-medium">{opt.label}</span>
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="mt-3 w-full text-xs" onClick={() => setAsaasChargeModal(null)}>Cancelar</Button>
            </div>
          </div>
        )}

        {/* PIX QrCode Modal */}
        {asaasPixModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAsaasPixModal(null)}>
            <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-sm text-center" onClick={e => e.stopPropagation()}>
              <h2 className="text-base font-bold mb-1 flex items-center gap-2 justify-center">
                <QrCode className="w-4 h-4 text-blue-500" />QR Code PIX
              </h2>
              {asaasPixModal.pixData?.encodedImage ? (
                <img
                  src={`data:image/png;base64,${asaasPixModal.pixData.encodedImage}`}
                  alt="QR Code PIX"
                  className="mx-auto w-48 h-48 my-4 rounded-lg border"
                />
              ) : (
                <div className="w-48 h-48 mx-auto my-4 rounded-lg border bg-muted/30 flex items-center justify-center">
                  <QrCode className="w-12 h-12 text-muted-foreground opacity-40" />
                </div>
              )}
              {asaasPixModal.pixData?.payload && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">Codigo Copia e Cola:</p>
                  <div className="flex gap-2 items-center">
                    <code className="text-xs bg-muted rounded px-2 py-1 flex-1 text-left truncate">{asaasPixModal.pixData.payload}</code>
                    <Button
                      variant="outline" size="sm"
                      className="h-7 w-7 p-0 flex-shrink-0"
                      onClick={() => { navigator.clipboard.writeText(asaasPixModal.pixData.payload); toast({ title: "Copiado!" }); }}
                      data-testid="button-copy-pix"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
              <Button variant="ghost" size="sm" className="mt-3 w-full text-xs" onClick={() => setAsaasPixModal(null)}>Fechar</Button>
            </div>
          </div>
        )}

        {activeTab === "financeiro" && (<div className="space-y-5">
          {/* Asaas Status Bar */}
          {asaasStatus && (
            <Card className={`p-4 flex items-center justify-between gap-4 ${asaasStatus.configured ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${asaasStatus.configured ? "bg-emerald-100 dark:bg-emerald-900" : "bg-amber-100 dark:bg-amber-900"}`}>
                  <Wallet className={`w-4 h-4 ${asaasStatus.configured ? "text-emerald-600" : "text-amber-600"}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    Asaas {asaasStatus.configured ? (asaasStatus.mode === "sandbox" ? "— Sandbox ativo" : "— Producao ativo") : "— Nao configurado"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {asaasStatus.configured
                      ? `Saldo disponivel: R$ ${(asaasStatus.balance?.balance || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                      : "Configure a chave ASAAS_API_KEY para ativar cobranças automaticas"}
                  </p>
                </div>
              </div>
              {asaasStatus.configured && (
                <Badge className={asaasStatus.mode === "sandbox" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}>
                  {asaasStatus.mode === "sandbox" ? "Sandbox" : "Producao"}
                </Badge>
              )}
            </Card>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: "MRR",
                value: `R$ ${(financialSummary?.mrr || 0).toLocaleString("pt-BR")}`,
                sub: "Receita mensal recorrente",
                icon: TrendingUp,
                color: "from-emerald-500 to-emerald-600",
                testId: "kpi-mrr",
              },
              {
                label: "ARR",
                value: `R$ ${(financialSummary?.arr || 0).toLocaleString("pt-BR")}`,
                sub: "Receita anual recorrente",
                icon: DollarSign,
                color: "from-blue-500 to-blue-600",
                testId: "kpi-arr",
              },
              {
                label: "Em Aberto",
                value: `R$ ${(financialSummary?.pendingRevenue || 0).toLocaleString("pt-BR")}`,
                sub: `${financialSummary?.pendingCount || 0} faturas pendentes`,
                icon: AlertCircle,
                color: "from-amber-500 to-amber-600",
                testId: "kpi-pending",
              },
              {
                label: "Em Atraso",
                value: `R$ ${(financialSummary?.overdueRevenue || 0).toLocaleString("pt-BR")}`,
                sub: `${financialSummary?.overdueCount || 0} faturas vencidas`,
                icon: TrendingDown,
                color: "from-rose-500 to-rose-600",
                testId: "kpi-overdue",
              },
            ].map((card) => (
              <Card key={card.label} className="overflow-hidden" data-testid={card.testId}>
                <div className={`h-1.5 bg-gradient-to-r ${card.color}`} />
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{card.label}</span>
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${card.color} flex items-center justify-center`}>
                      <card.icon className="w-4 h-4 text-white" />
                    </div>
                  </div>
                  <p className="text-xl font-bold">{card.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
                </div>
              </Card>
            ))}
          </div>

          {/* Revenue chart + Plan distribution */}
          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2 p-5">
              <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-500" />Receita por Mes (ultimos 6 meses)
              </h3>
              <div className="flex items-end gap-2 h-32">
                {(financialSummary?.last6Months || []).map((m: any) => {
                  const max = Math.max(...(financialSummary?.last6Months || []).map((x: any) => x.revenue), 1);
                  const pct = max > 0 ? (m.revenue / max) * 100 : 0;
                  const [y, mo] = m.period.split("-");
                  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
                  const label = months[parseInt(mo) - 1];
                  return (
                    <div key={m.period} className="flex flex-col items-center flex-1 gap-1">
                      <span className="text-xs text-muted-foreground">{m.revenue > 0 ? `R$${m.revenue}` : ""}</span>
                      <div
                        className="w-full rounded-t-sm bg-gradient-to-t from-blue-500 to-indigo-400 transition-all"
                        style={{ height: `${Math.max(pct, 4)}%` }}
                      />
                      <span className="text-[10px] text-muted-foreground">{label}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                <Crown className="w-4 h-4 text-amber-500" />Distribuicao de Planos
              </h3>
              <div className="space-y-2">
                {Object.entries(financialSummary?.planDistribution || {}).map(([plan, count]: any) => {
                  const total = Object.values(financialSummary?.planDistribution || {}).reduce((a: any, b: any) => a + b, 0) as number;
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={plan}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium">{PLAN_LABELS[plan]?.label || plan}</span>
                        <span className="text-muted-foreground">{count} ({pct}%)</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {!financialSummary?.planDistribution && (
                  <p className="text-xs text-muted-foreground text-center py-4">Sem dados</p>
                )}
              </div>
            </Card>
          </div>

          {/* Invoice management */}
          <Card className="overflow-hidden">
            <div className="p-5 border-b">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-500" />Gestao de Faturas
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{allInvoices.length} fatura(s) no sistema</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => {
                      const period = new Date().toISOString().slice(0, 7);
                      if (confirm(`Gerar faturas mensais para ${period}?`)) generateMonthlyMutation.mutate(period);
                    }}
                    disabled={generateMonthlyMutation.isPending}
                    data-testid="button-generate-monthly-invoices"
                  >
                    {generateMonthlyMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    Gerar Mensais
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => setShowNewInvoice(!showNewInvoice)}
                    data-testid="button-new-invoice"
                  >
                    <Plus className="w-3.5 h-3.5" />Nova Fatura
                  </Button>
                </div>
              </div>

              {/* Filter */}
              <div className="flex gap-1.5 mt-4 flex-wrap">
                {[
                  { value: "all", label: "Todas" },
                  { value: "pending", label: "Pendentes" },
                  { value: "paid", label: "Pagas" },
                  { value: "overdue", label: "Vencidas" },
                  { value: "cancelled", label: "Canceladas" },
                ].map((f) => (
                  <Button
                    key={f.value}
                    size="sm"
                    variant={invoiceFilter === f.value ? "default" : "outline"}
                    className="h-7 text-xs px-3"
                    onClick={() => setInvoiceFilter(f.value)}
                    data-testid={`button-invoice-filter-${f.value}`}
                  >
                    {f.label}
                    {f.value !== "all" && (
                      <span className="ml-1 opacity-70">
                        ({allInvoices.filter((i: any) => i.status === f.value).length})
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </div>

            {/* New Invoice Form */}
            {showNewInvoice && (
              <div className="p-5 border-b bg-muted/30">
                <h4 className="font-medium text-sm mb-4">Emitir Nova Fatura</h4>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Provedor</Label>
                    <Select value={invoiceForm.providerId} onValueChange={(v) => {
                      const p = allProviders.find((x: any) => x.id.toString() === v);
                      const PLAN_PRICES: Record<string, number> = { free: 0, basic: 199, pro: 399, enterprise: 799 };
                      const PLAN_CREDITS_MAP: Record<string, { isp: number; spc: number }> = {
                        free: { isp: 50, spc: 0 }, basic: { isp: 200, spc: 50 }, pro: { isp: 500, spc: 150 }, enterprise: { isp: 1500, spc: 500 }
                      };
                      if (p) {
                        const credits = PLAN_CREDITS_MAP[p.plan] || { isp: 0, spc: 0 };
                        setInvoiceForm(f => ({ ...f, providerId: v, planAtTime: p.plan, amount: PLAN_PRICES[p.plan]?.toString() || "0", ispCreditsIncluded: credits.isp.toString(), spcCreditsIncluded: credits.spc.toString() }));
                      } else {
                        setInvoiceForm(f => ({ ...f, providerId: v }));
                      }
                    }}>
                      <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-invoice-provider">
                        <SelectValue placeholder="Selecionar provedor" />
                      </SelectTrigger>
                      <SelectContent>
                        {allProviders.map((p: any) => (
                          <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Periodo (AAAA-MM)</Label>
                    <Input
                      className="h-8 text-xs mt-1"
                      placeholder="2026-03"
                      value={invoiceForm.period}
                      onChange={(e) => setInvoiceForm(f => ({ ...f, period: e.target.value }))}
                      data-testid="input-invoice-period"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Plano Cobrado</Label>
                    <Select value={invoiceForm.planAtTime} onValueChange={(v) => {
                      const PLAN_PRICES: Record<string, number> = { free: 0, basic: 199, pro: 399, enterprise: 799 };
                      const PLAN_CREDITS_MAP: Record<string, { isp: number; spc: number }> = {
                        free: { isp: 50, spc: 0 }, basic: { isp: 200, spc: 50 }, pro: { isp: 500, spc: 150 }, enterprise: { isp: 1500, spc: 500 }
                      };
                      const credits = PLAN_CREDITS_MAP[v] || { isp: 0, spc: 0 };
                      setInvoiceForm(f => ({ ...f, planAtTime: v, amount: PLAN_PRICES[v]?.toString() || "0", ispCreditsIncluded: credits.isp.toString(), spcCreditsIncluded: credits.spc.toString() }));
                    }}>
                      <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-invoice-plan">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="free">Gratuito — R$ 0</SelectItem>
                        <SelectItem value="basic">Basico — R$ 199</SelectItem>
                        <SelectItem value="pro">Pro — R$ 399</SelectItem>
                        <SelectItem value="enterprise">Enterprise — R$ 799</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Valor (R$)</Label>
                    <Input
                      className="h-8 text-xs mt-1"
                      type="number"
                      placeholder="199"
                      value={invoiceForm.amount}
                      onChange={(e) => setInvoiceForm(f => ({ ...f, amount: e.target.value }))}
                      data-testid="input-invoice-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Vencimento</Label>
                    <Input
                      className="h-8 text-xs mt-1"
                      type="date"
                      value={invoiceForm.dueDate}
                      onChange={(e) => setInvoiceForm(f => ({ ...f, dueDate: e.target.value }))}
                      data-testid="input-invoice-due-date"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Observacoes (opcional)</Label>
                    <Input
                      className="h-8 text-xs mt-1"
                      placeholder="Observacao..."
                      value={invoiceForm.notes}
                      onChange={(e) => setInvoiceForm(f => ({ ...f, notes: e.target.value }))}
                      data-testid="input-invoice-notes"
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs"
                    disabled={createInvoiceMutation.isPending}
                    onClick={() => createInvoiceMutation.mutate(invoiceForm)}
                    data-testid="button-submit-invoice"
                  >
                    {createInvoiceMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                    Emitir Fatura
                  </Button>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowNewInvoice(false)}>Cancelar</Button>
                </div>
              </div>
            )}

            {/* Invoice Table */}
            {invoicesLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (() => {
              const filtered = invoiceFilter === "all" ? allInvoices : allInvoices.filter((i: any) => i.status === invoiceFilter);
              const STATUS_STYLE: Record<string, string> = {
                pending:   "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                paid:      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                overdue:   "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
                cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
              };
              const STATUS_LABEL: Record<string, string> = {
                pending: "Pendente", paid: "Pago", overdue: "Vencido", cancelled: "Cancelado"
              };
              return filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <FileText className="w-8 h-8 text-muted-foreground opacity-40" />
                  <p className="text-sm text-muted-foreground">Nenhuma fatura encontrada</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground">Numero</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground">Provedor</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground">Periodo</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground">Plano</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground">Valor</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground">Vencimento</th>
                        <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground">Status</th>
                        <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground">Acoes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filtered.map((inv: any) => {
                        const isOverdue = inv.status === "pending" && new Date(inv.dueDate) < new Date();
                        const displayStatus = isOverdue ? "overdue" : inv.status;
                        return (
                          <tr key={inv.id} className="hover:bg-muted/20 transition-colors" data-testid={`invoice-row-${inv.id}`}>
                            <td className="py-3 px-4">
                              <span className="font-mono text-xs font-medium text-blue-700 dark:text-blue-300">{inv.invoiceNumber}</span>
                            </td>
                            <td className="py-3 px-4">
                              <span className="font-medium text-xs">{inv.providerName}</span>
                            </td>
                            <td className="py-3 px-4 text-xs text-muted-foreground">{inv.period}</td>
                            <td className="py-3 px-4">
                              <Badge className={`text-xs ${PLAN_LABELS[inv.planAtTime]?.color || ""}`}>
                                {PLAN_LABELS[inv.planAtTime]?.label || inv.planAtTime}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-xs">
                              R$ {parseFloat(inv.paidAmount || inv.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-4 text-xs text-muted-foreground">
                              {new Date(inv.dueDate).toLocaleDateString("pt-BR")}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <Badge className={`text-xs ${STATUS_STYLE[displayStatus] || STATUS_STYLE.pending}`}>
                                  {STATUS_LABEL[displayStatus] || displayStatus}
                                </Badge>
                                {inv.asaasChargeId && (
                                  <span className="text-[9px] text-blue-500 font-medium flex items-center gap-0.5">
                                    <Wallet className="w-2.5 h-2.5" />Asaas
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost" size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => navigate(`/admin/fatura/${inv.id}`)}
                                  title="Ver fatura"
                                  data-testid={`button-view-invoice-${inv.id}`}
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                                {(inv.status === "pending" || displayStatus === "overdue") && !inv.asaasChargeId && asaasStatus?.configured && (
                                  <Button
                                    variant="ghost" size="sm"
                                    className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                    onClick={() => setAsaasChargeModal({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber })}
                                    title="Cobrar via Asaas"
                                    data-testid={`button-asaas-charge-${inv.id}`}
                                  >
                                    <Wallet className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                {inv.asaasChargeId && (
                                  <Button
                                    variant="ghost" size="sm"
                                    className="h-7 w-7 p-0 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50"
                                    onClick={() => syncChargeMutation.mutate(inv.id)}
                                    title="Sincronizar status com Asaas"
                                    disabled={syncChargeMutation.isPending}
                                    data-testid={`button-asaas-sync-${inv.id}`}
                                  >
                                    {syncChargeMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                                  </Button>
                                )}
                                {inv.asaasChargeId && inv.asaasBillingType === "PIX" && inv.status !== "paid" && (
                                  <Button
                                    variant="ghost" size="sm"
                                    className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                    onClick={() => pixMutation.mutate(inv.id)}
                                    title="QR Code PIX"
                                    disabled={pixMutation.isPending}
                                    data-testid={`button-asaas-pix-${inv.id}`}
                                  >
                                    <QrCode className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                {inv.asaasInvoiceUrl && (
                                  <a
                                    href={inv.asaasInvoiceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="h-7 w-7 p-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                    title="Link de pagamento Asaas"
                                    data-testid={`link-asaas-payment-${inv.id}`}
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                )}
                                {(inv.status === "pending" || displayStatus === "overdue") && (
                                  <Button
                                    variant="ghost" size="sm"
                                    className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                    onClick={() => updateInvoiceStatusMutation.mutate({ id: inv.id, status: "paid", paidAmount: inv.amount })}
                                    title="Marcar como pago manualmente"
                                    data-testid={`button-mark-paid-${inv.id}`}
                                  >
                                    <CheckCircle className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                {(inv.status === "pending" || displayStatus === "overdue") && (
                                  <Button
                                    variant="ghost" size="sm"
                                    className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                    onClick={() => { if (confirm("Cancelar esta fatura?")) cancelInvoiceMutation.mutate(inv.id); }}
                                    title="Cancelar fatura"
                                    data-testid={`button-cancel-invoice-${inv.id}`}
                                  >
                                    <Ban className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </Card>

          {/* Credits management and history */}
          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-blue-500" />Creditos por Provedor
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {allProviders.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span className="text-blue-600 font-medium">ISP: {p.ispCredits}</span>
                        <span className="text-purple-600 font-medium">SPC: {p.spcCredits}</span>
                      </div>
                    </div>
                    <Button
                      variant="outline" size="sm"
                      className="text-xs h-7 gap-1"
                      onClick={() => setSelectedProvider(p)}
                      data-testid={`button-manage-credits-${p.id}`}
                    >
                      <Plus className="w-3 h-3" />Creditos
                    </Button>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />Historico de Alteracoes
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {planHistory.map((h: any) => (
                  <div key={h.id} className="flex items-start gap-3 py-2 border-b last:border-0 text-sm">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      h.newPlan ? "bg-purple-100 text-purple-700" : "bg-emerald-100 text-emerald-700"
                    }`}>
                      {h.newPlan ? <ArrowUpDown className="w-3.5 h-3.5" /> : <Plus className="w-3 h-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-xs">
                          {h.newPlan
                            ? `${PLAN_LABELS[h.oldPlan]?.label} → ${PLAN_LABELS[h.newPlan]?.label}`
                            : `ISP +${h.ispCreditsAdded} / SPC +${h.spcCreditsAdded}`}
                        </span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(h.createdAt).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                      {h.notes && <p className="text-xs text-muted-foreground truncate">{h.notes}</p>}
                    </div>
                  </div>
                ))}
                {planHistory.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 text-center">Nenhum historico</p>
                )}
              </div>
            </Card>
          </div>
        </div>)}

        {activeTab === "suporte" && (<div>
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setSupportSubTab("provedores")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${supportSubTab === "provedores" ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
              data-testid="tab-support-providers"
            >
              Provedores
              {chatThreads.reduce((s: number, t: any) => s + (t.unreadCount || 0), 0) > 0 && (
                <span className="ml-2 w-5 h-5 inline-flex items-center justify-center bg-red-500 text-white text-[10px] rounded-full font-bold">
                  {chatThreads.reduce((s: number, t: any) => s + (t.unreadCount || 0), 0)}
                </span>
              )}
            </button>
            <button
              onClick={() => setSupportSubTab("visitantes")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${supportSubTab === "visitantes" ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
              data-testid="tab-support-visitors"
            >
              Visitantes do Site
              {visitorChats.reduce((s: number, c: any) => s + (c.unreadCount || 0), 0) > 0 && (
                <span className="ml-2 w-5 h-5 inline-flex items-center justify-center bg-red-500 text-white text-[10px] rounded-full font-bold">
                  {visitorChats.reduce((s: number, c: any) => s + (c.unreadCount || 0), 0)}
                </span>
              )}
            </button>
          </div>
          {supportSubTab === "provedores" && <ChatPanel threads={chatThreads} />}
          {supportSubTab === "visitantes" && <VisitorChatPanel chats={visitorChats} />}
        </div>)}
      </div>

      {selectedProvider && (
        <ProviderCreditsModal provider={selectedProvider} onClose={() => setSelectedProvider(null)} />
      )}
    </div>
  );
}
