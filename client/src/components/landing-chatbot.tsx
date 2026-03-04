import { useState, useEffect, useRef } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Message = {
  id: number;
  from: "bot" | "user";
  text: string;
};

const FLOW: Record<string, { text: string; options?: string[] }> = {
  start: {
    text: "Oi! Sou o assistente da Consulta ISP. Como posso te ajudar hoje?",
    options: [
      "Quero conhecer a plataforma",
      "Como funciona a base compartilhada?",
      "Quais sao os planos e precos?",
      "Preciso falar com um consultor",
    ],
  },
  "Quero conhecer a plataforma": {
    text: "A Consulta ISP e uma plataforma colaborativa onde provedores de internet compartilham dados de inadimplentes. Antes de ativar um novo cliente, voce consulta o CPF/CNPJ e recebe score de credito, alertas de fraude e sugestao de decisao em segundos.",
    options: [
      "Como funciona a base compartilhada?",
      "Quais sao os planos e precos?",
      "Quero criar minha conta",
    ],
  },
  "Como funciona a base compartilhada?": {
    text: "Cada provedor conecta seu ERP (IXC, SGP, MK Solutions) e o sistema consulta a base em tempo real. Quando voce pesquisa um CPF, o sistema verifica se ele aparece como inadimplente em qualquer provedor da rede. Os dados sao anonimizados — voce ve o risco, mas nunca dados pessoais de outros provedores.",
    options: [
      "E seguro compartilhar dados?",
      "Quais sao os planos e precos?",
      "Quero criar minha conta",
    ],
  },
  "E seguro compartilhar dados?": {
    text: "Sim! Dados pessoais ficam restritos ao provedor de origem. Outros provedores veem apenas indicadores de risco: dias de atraso, faixa de valor e equipamentos pendentes. Toda comunicacao usa criptografia e segue as melhores praticas de seguranca.",
    options: [
      "Quais sao os planos e precos?",
      "Quero criar minha conta",
      "Preciso falar com um consultor",
    ],
  },
  "Quais sao os planos e precos?": {
    text: "Temos 3 planos:\n\nGratis (R$ 0/mes) — consultas do proprio provedor gratuitas, 10 creditos/mes.\n\nProfissional (R$ 99/mes) — consultas ilimitadas, anti-fraude, mapa de calor, IA, integracao ERP, 100 creditos ISP/mes.\n\nEnterprise (sob consulta) — usuarios ilimitados, API dedicada, SLA e suporte prioritario.",
    options: [
      "Quero criar minha conta",
      "Quero o plano Profissional",
      "Preciso falar com um consultor",
    ],
  },
  "Quero criar minha conta": {
    text: "Otimo! Voce pode criar sua conta gratuitamente agora mesmo. Clique no botao abaixo para comecar:",
    options: ["Criar minha conta gratis", "Voltar ao inicio"],
  },
  "Quero o plano Profissional": {
    text: "Excelente escolha! O plano Profissional e o mais popular. Crie sua conta e faca upgrade direto na plataforma. Quer comecar agora?",
    options: ["Criar minha conta gratis", "Preciso falar com um consultor"],
  },
  "Preciso falar com um consultor": {
    text: "Claro! Deixe seus dados que nossa equipe comercial entra em contato rapidamente.",
    options: ["__form_contact"],
  },
  "Voltar ao inicio": {
    text: "Sem problemas! Em que posso te ajudar?",
    options: [
      "Quero conhecer a plataforma",
      "Como funciona a base compartilhada?",
      "Quais sao os planos e precos?",
      "Preciso falar com um consultor",
    ],
  },
};

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 mb-3">
      <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
        <MessageCircle className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="bg-slate-100 rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

export default function LandingChatbot({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showBubbleHint, setShowBubbleHint] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState(false);
  const [currentOptions, setCurrentOptions] = useState<string[]>([]);
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactForm, setContactForm] = useState({ name: "", email: "", phone: "", provider: "" });
  const [contactSent, setContactSent] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgId = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setShowBubbleHint(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typing, showContactForm]);

  const addBotMessage = (text: string, options?: string[]) => {
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      msgId.current++;
      setMessages(prev => [...prev, { id: msgId.current, from: "bot", text }]);
      if (options) {
        if (options[0] === "__form_contact") {
          setShowContactForm(true);
          setCurrentOptions([]);
        } else {
          setCurrentOptions(options);
        }
      } else {
        setCurrentOptions([]);
      }
    }, 800 + Math.random() * 600);
  };

  const handleOpen = () => {
    setIsOpen(true);
    setShowBubbleHint(false);
    if (messages.length === 0) {
      const start = FLOW.start;
      addBotMessage(start.text, start.options);
    }
  };

  const handleOptionClick = (option: string) => {
    if (option === "Criar minha conta gratis") {
      msgId.current++;
      setMessages(prev => [...prev, { id: msgId.current, from: "user", text: option }]);
      setCurrentOptions([]);
      addBotMessage("Redirecionando voce para o cadastro...");
      setTimeout(() => onNavigate("/login?mode=register"), 1500);
      return;
    }

    msgId.current++;
    setMessages(prev => [...prev, { id: msgId.current, from: "user", text: option }]);
    setCurrentOptions([]);

    const flow = FLOW[option];
    if (flow) {
      addBotMessage(flow.text, flow.options);
    } else {
      addBotMessage("Desculpe, nao entendi. Como posso te ajudar?", FLOW.start.options);
    }
  };

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowContactForm(false);
    setContactSent(true);
    msgId.current++;
    setMessages(prev => [
      ...prev,
      { id: msgId.current, from: "user", text: `Nome: ${contactForm.name}\nEmail: ${contactForm.email}\nTelefone: ${contactForm.phone}${contactForm.provider ? `\nProvedor: ${contactForm.provider}` : ""}` },
    ]);
    addBotMessage(
      `Obrigado, ${contactForm.name.split(" ")[0]}! Seus dados foram registrados. Nossa equipe comercial entrara em contato em breve pelo email ${contactForm.email} ou telefone ${contactForm.phone}.`,
      ["Quero conhecer a plataforma", "Quais sao os planos e precos?", "Voltar ao inicio"]
    );
  };

  return (
    <>
      {!isOpen && showBubbleHint && (
        <div className="fixed bottom-24 right-6 z-50 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="bg-white rounded-2xl rounded-br-md shadow-xl border border-slate-200 p-4 max-w-[260px] relative">
            <button onClick={() => setShowBubbleHint(false)} className="absolute top-2 right-2 text-slate-400 hover:text-slate-600" data-testid="button-close-hint">
              <X className="w-3.5 h-3.5" />
            </button>
            <p className="text-sm text-slate-700 font-medium pr-4">Ola! Posso te ajudar a conhecer a plataforma?</p>
            <button onClick={handleOpen} className="text-xs text-blue-600 font-semibold mt-2 hover:underline" data-testid="button-hint-open">
              Falar agora
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
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white" />
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-3rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200" data-testid="chatbot-panel">
          <div className="bg-blue-600 px-5 py-4 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                <MessageCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">Consulta ISP</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-blue-100 text-xs">Online agora</span>
                </div>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-white/70 hover:text-white transition-colors" data-testid="button-chatbot-close">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-1 bg-slate-50/50">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.from === "user" ? "justify-end" : "items-end gap-2"} mb-3`}>
                {msg.from === "bot" && (
                  <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                    <MessageCircle className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
                <div className={`max-w-[80%] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                  msg.from === "user"
                    ? "bg-blue-600 text-white rounded-2xl rounded-br-md"
                    : "bg-white text-slate-700 rounded-2xl rounded-bl-md border border-slate-200 shadow-sm"
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}

            {typing && <TypingIndicator />}

            {showContactForm && !contactSent && (
              <div className="flex items-end gap-2 mb-3">
                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                  <MessageCircle className="w-3.5 h-3.5 text-white" />
                </div>
                <form onSubmit={handleContactSubmit} className="bg-white rounded-2xl rounded-bl-md border border-slate-200 shadow-sm p-4 space-y-2.5 max-w-[85%]">
                  <Input
                    placeholder="Seu nome"
                    value={contactForm.name}
                    onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))}
                    required
                    className="h-9 text-sm"
                    data-testid="input-chatbot-name"
                  />
                  <Input
                    placeholder="Email"
                    type="email"
                    value={contactForm.email}
                    onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))}
                    required
                    className="h-9 text-sm"
                    data-testid="input-chatbot-email"
                  />
                  <Input
                    placeholder="Telefone / WhatsApp"
                    value={contactForm.phone}
                    onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))}
                    required
                    className="h-9 text-sm"
                    data-testid="input-chatbot-phone"
                  />
                  <Input
                    placeholder="Nome do provedor (opcional)"
                    value={contactForm.provider}
                    onChange={e => setContactForm(f => ({ ...f, provider: e.target.value }))}
                    className="h-9 text-sm"
                    data-testid="input-chatbot-provider"
                  />
                  <Button type="submit" className="w-full h-9 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold" data-testid="button-chatbot-submit">
                    <Send className="w-3.5 h-3.5 mr-1.5" />
                    Enviar dados
                  </Button>
                </form>
              </div>
            )}

            {currentOptions.length > 0 && !typing && (
              <div className="flex flex-wrap gap-2 mt-2 pl-9">
                {currentOptions.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => handleOptionClick(opt)}
                    className="text-sm bg-white border border-blue-200 text-blue-700 px-3.5 py-2 rounded-xl hover:bg-blue-50 hover:border-blue-300 transition-colors text-left font-medium"
                    data-testid={`button-chatbot-option-${i}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 px-4 py-3 bg-white flex-shrink-0">
            <p className="text-[10px] text-slate-400 text-center">Consulta ISP — Atendimento comercial</p>
          </div>
        </div>
      )}
    </>
  );
}
