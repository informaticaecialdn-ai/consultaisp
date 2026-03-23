import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import LandingChatbot from "@/components/landing-chatbot";
import {
  Shield,
  Search,
  BarChart3,
  Users,
  Zap,
  Lock,
  ArrowRight,
  AlertTriangle,
  CreditCard,
  Building2,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Database,
  Bot,
  Share2,
  Globe,
  Router,
  CheckCircle,
  Bell,
  Wifi,
  UserX,
  MapPin,
  Clock,
  Package,
  FileText,
  Activity,
} from "lucide-react";

type ErpItem = { key: string; name: string; description: string | null; logoBase64: string | null; gradient: string };

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [calcClientes, setCalcClientes] = useState(300);
  const [calcTaxa, setCalcTaxa] = useState(10);
  const [calcEquip, setCalcEquip] = useState(2);

  const fallbackErps: ErpItem[] = [
    { key: "ixc", name: "IXC Soft", description: null, logoBase64: "/erp-logos/ixc.png", gradient: "from-white to-slate-100" },
    { key: "sgp", name: "SGP", description: null, logoBase64: "/erp-logos/sgp.png", gradient: "from-white to-slate-100" },
    { key: "mk", name: "MK Solutions", description: null, logoBase64: "/erp-logos/mk.png", gradient: "from-white to-slate-100" },
    { key: "hubsoft", name: "Hubsoft", description: null, logoBase64: "/erp-logos/hubsoft.png", gradient: "from-white to-slate-100" },
    { key: "voalle", name: "Voalle", description: null, logoBase64: "/erp-logos/voalle.png", gradient: "from-white to-slate-100" },
    { key: "rbx", name: "RBX ISP", description: null, logoBase64: "/erp-logos/rbx.png", gradient: "from-white to-slate-100" },
  ];
  const [erps, setErps] = useState<ErpItem[]>(fallbackErps);

  useEffect(() => {
    fetch("/api/public/erp-catalog")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data) && data.length > 0) setErps(data); })
      .catch(() => {});
  }, []);

  const goLogin = () => setLocation("/login");
  const goRegister = () => setLocation("/login?mode=register");

  return (
    <div className="min-h-screen bg-white overflow-x-hidden" data-testid="landing-page">

      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200/60 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold text-slate-900 tracking-tight">Consulta ISP</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-500">
            <button onClick={() => document.getElementById("como-funciona")?.scrollIntoView({ behavior: "smooth" })} className="hover:text-blue-600 transition-colors" data-testid="nav-como-funciona">Como funciona</button>
            <button onClick={() => document.getElementById("funcionalidades")?.scrollIntoView({ behavior: "smooth" })} className="hover:text-blue-600 transition-colors" data-testid="nav-funcionalidades">Funcionalidades</button>
            <button onClick={() => document.getElementById("precos")?.scrollIntoView({ behavior: "smooth" })} className="hover:text-blue-600 transition-colors" data-testid="nav-precos">Preços</button>
            <button onClick={() => document.getElementById("faq")?.scrollIntoView({ behavior: "smooth" })} className="hover:text-blue-600 transition-colors" data-testid="nav-faq">FAQ</button>
          </div>
          <div className="flex items-center gap-2.5">
            <Button variant="outline" className="border-blue-600 text-blue-600 text-sm h-9 font-semibold" onClick={goLogin} data-testid="button-landing-login">Login</Button>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white text-sm h-9 gap-1.5" onClick={goRegister} data-testid="button-landing-cadastro">Criar Conta Grátis</Button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative bg-gradient-to-br from-blue-600 to-blue-800 pt-16 overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-500/20 rounded-full -translate-y-1/2 translate-x-1/3" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-900/30 rounded-full translate-y-1/2 -translate-x-1/3" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="text-white">
              <div className="inline-flex items-center gap-2 bg-white/15 text-white text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-6">
                <Share2 className="w-3.5 h-3.5" />
                Rede colaborativa entre provedores
              </div>
              <h1 className="text-4xl sm:text-5xl font-black leading-[1.1] tracking-tight mb-6" data-testid="text-hero-title">
                Você está instalando ONU<br />
                <span className="text-blue-200">em quem já deve em outro provedor.</span>
              </h1>
              <p className="text-blue-100 text-lg leading-relaxed mb-8 max-w-lg">
                A Resolução Anatel 765 dá 75 dias ao cliente antes de você poder cancelar.
                Ele sabe disso — e usa esse tempo para migrar sem pagar.
                Com o Consulta ISP, você consulta o histórico em 2 segundos <strong className="text-white">antes de instalar</strong>.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 mb-10">
                <Button size="lg" className="bg-white text-blue-700 hover:bg-blue-50 px-8 gap-2 h-12 text-base font-bold shadow-lg" onClick={goRegister} data-testid="button-hero-cta">
                  Criar Conta Grátis
                  <ArrowRight className="w-4 h-4" />
                </Button>
                <Button size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10 px-6 h-12 text-base gap-2" onClick={() => document.getElementById("como-funciona")?.scrollIntoView({ behavior: "smooth" })} data-testid="button-hero-features">
                  Como funciona
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-6 pt-8 border-t border-white/20">
                {[
                  { v: "100+", l: "Provedores na rede" },
                  { v: "< 2s", l: "Resultado da consulta" },
                  { v: "Grátis", l: "Na sua própria base" },
                ].map(s => (
                  <div key={s.l}>
                    <p className="text-2xl font-black text-white">{s.v}</p>
                    <p className="text-xs text-blue-200 mt-0.5">{s.l}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Mockup da tela de consulta */}
            <div className="hidden lg:block">
              <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
                <div className="bg-slate-800 px-4 py-3 flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                  <span className="ml-2 text-xs text-slate-400 font-mono">Consulta ISP — Resultado</span>
                </div>
                <div className="p-5 space-y-3">
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-blue-600" />
                        <span className="text-sm font-semibold text-slate-700">CPF: 987.654.321-00</span>
                      </div>
                      <span className="text-[11px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">CRÍTICO</span>
                    </div>
                    <div className="flex gap-4 text-xs text-slate-500 mt-1">
                      <span>Score: <strong className="text-red-600">15/100</strong></span>
                      <span>2 provedores</span>
                      <span className="text-red-500 font-semibold">R$ 609,50 em aberto</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                      <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Seu provedor</p>
                      <p className="text-sm font-bold text-slate-900">João P. Lima</p>
                      <p className="text-xs text-slate-500">98 dias de atraso</p>
                      <span className="inline-block mt-1.5 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">Grátis</span>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Outro provedor</p>
                      <p className="text-sm font-bold text-slate-900">Dados restritos</p>
                      <p className="text-xs text-slate-500">122 dias de atraso</p>
                      <span className="inline-block mt-1.5 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">1 crédito</span>
                    </div>
                  </div>
                  <div className="bg-red-600 rounded-xl p-4 flex items-center gap-3">
                    <div className="bg-white/20 px-3 py-2 rounded-lg text-center">
                      <p className="text-[9px] text-white/70 font-semibold uppercase">Sugestão</p>
                      <p className="text-white font-black text-sm">REJEITAR</p>
                    </div>
                    <div>
                      <p className="text-xs text-white font-semibold">3 equipamentos não devolvidos</p>
                      <p className="text-xs text-red-200">Valor em risco: R$ 810,00</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* NÚMEROS DE MERCADO */}
      <section className="py-10 bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
            {[
              { stat: "19.000+", desc: "ISPs regionais no Brasil", sub: "63,8% do market share de banda larga", color: "text-blue-400" },
              { stat: "73 milhões", desc: "brasileiros negativados", sub: "Recorde histórico em 2025 (CNDL/SPC)", color: "text-red-400" },
              { stat: "R$ 400", desc: "custo médio de ativar cliente FTTH", sub: "ONU + instalação + ativação", color: "text-amber-400" },
              { stat: "R$ 690", desc: "prejuízo médio por inadimplente", sub: "dívida + equipamento não devolvido", color: "text-orange-400" },
            ].map((item, i) => (
              <div key={i}>
                <p className={`text-3xl sm:text-4xl font-black ${item.color} mb-1`}>{item.stat}</p>
                <p className="text-sm font-semibold text-white mb-0.5">{item.desc}</p>
                <p className="text-xs text-slate-400">{item.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5 DORES — Mapeamento problema → solução */}
      <section className="py-16 bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 text-red-600 text-xs font-bold uppercase tracking-widest mb-3">
              <AlertTriangle className="w-4 h-4" />
              As 5 dores que mais custam ao provedor
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">Você reconhece alguma dessas situações?</h2>
            <p className="text-slate-500 mt-3 max-w-2xl mx-auto">
              Mapeamos as principais dores de provedores regionais e construímos uma plataforma para resolver cada uma delas.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                pain: "Instalo sem saber o histórico do CPF",
                context: "O cliente veio educado, pareceu confiável. Mas devia em dois provedores antes de você e nunca devolveu a ONU.",
                solution: "Consulta ISP na rede colaborativa",
                solutionDesc: "Score de risco + histórico em menos de 2 segundos antes de ativar qualquer cliente.",
                icon: Search, painColor: "text-red-600", bg: "border-red-100 hover:border-red-300",
                badge: "bg-red-100 text-red-700", badgeText: "Alto impacto",
              },
              {
                pain: "Não sei quando meu inadimplente tenta migrar",
                context: "Ele sabe que a Anatel te obriga a notificar em D+15 e aguardar até D+60 antes de cancelar. Usa esse tempo para sair com sua ONU.",
                solution: "Anti-Fraude em tempo real",
                solutionDesc: "Alerta via WhatsApp/e-mail em menos de 5 segundos quando o CPF é consultado por outro provedor.",
                icon: Bell, painColor: "text-orange-600", bg: "border-orange-100 hover:border-orange-300",
                badge: "bg-orange-100 text-orange-700", badgeText: "Alto impacto",
              },
              {
                pain: "ONU foi embora sem registro nem cobrança",
                context: "Cancelou o contrato, ninguém buscou o equipamento. Técnico estava em instalação nova. Meses depois: cliente mudou, ONU perdida, R$ 280 no lixo.",
                solution: "Controle de equipamentos",
                solutionDesc: "Rastreie cada ONU e roteador com modelo, serial, cliente e status de recuperação em comodato.",
                icon: Router, painColor: "text-amber-600", bg: "border-amber-100 hover:border-amber-300",
                badge: "bg-amber-100 text-amber-700", badgeText: "Médio-Alto impacto",
              },
              {
                pain: "Não consigo negativar no SPC/Serasa",
                context: "Exige contrato direto, CNPJ com histórico, volume mínimo. Para ISP pequeno é caro e burocrático. O inadimplente circula limpo e contrata em outro lugar.",
                solution: "Consulta SPC integrada",
                solutionDesc: "Acesso à negativação via plataforma sem contrato direto com SPC — disponível no plano Básico.",
                icon: FileText, painColor: "text-purple-600", bg: "border-purple-100 hover:border-purple-300",
                badge: "bg-purple-100 text-purple-700", badgeText: "Médio impacto",
              },
              {
                pain: "Tenho medo de violar a LGPD ao trocar dados com outro provedor",
                context: "Quer compartilhar info do inadimplente com o provedor da cidade ao lado mas tem receio de estar infringindo a lei. Na dúvida, não faz nada.",
                solution: "Compartilhamento 100% LGPD",
                solutionDesc: "A base compartilha apenas indicadores anonimizados — sem CPF, nome ou endereço visíveis para outros provedores.",
                icon: Lock, painColor: "text-blue-600", bg: "border-blue-100 hover:border-blue-300",
                badge: "bg-blue-100 text-blue-700", badgeText: "Regulatório",
              },
              {
                pain: "Bloqueio tarde: 45 dias de receita perdida",
                context: "A equipe estava ocupada com chamados técnicos. Quando alguém bloqueou, já haviam se passado quase 2 meses — e o cliente já estava procurando outro provedor.",
                solution: "Integração com ERP + alerta automático",
                solutionDesc: "A base é atualizada automaticamente via IXC/SGP. Identifique risco antes de instalar e evite acumular inadimplentes.",
                icon: Clock, painColor: "text-red-700", bg: "border-red-100 hover:border-red-300",
                badge: "bg-red-100 text-red-800", badgeText: "Alto impacto",
              },
            ].map((item, i) => (
              <div key={i} className={`border-2 ${item.bg} rounded-2xl p-5 transition-all hover:shadow-md`} data-testid={`pain-${i}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl ${item.badge.replace("text-", "bg-").split(" ")[0].replace("bg-", "bg-")} bg-opacity-20 flex items-center justify-center`}>
                    <item.icon className={`w-5 h-5 ${item.painColor}`} />
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.badge}`}>{item.badgeText}</span>
                </div>
                <p className={`text-sm font-black ${item.painColor} mb-1.5`}>"{item.pain}"</p>
                <p className="text-xs text-slate-500 leading-relaxed mb-3">{item.context}</p>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">Como resolvemos</p>
                  <p className="text-xs font-bold text-slate-900 mb-1">{item.solution}</p>
                  <p className="text-xs text-slate-500 leading-relaxed">{item.solutionDesc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* A SOLUÇÃO — Rede Colaborativa */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 text-blue-600 text-xs font-bold uppercase tracking-widest mb-3">
              <Share2 className="w-4 h-4" />
              A solução: rede colaborativa
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">Provedores que se protegem juntos</h2>
            <p className="text-slate-500 mt-3 max-w-2xl mx-auto">
              Cada provedor registra seus inadimplentes. Toda a rede se beneficia.
              Quanto mais provedores participam, mais precisa e poderosa fica a proteção.
            </p>
          </div>

          {/* Diagrama */}
          <div className="bg-gradient-to-br from-blue-50 to-slate-50 rounded-3xl p-8 border border-blue-100 mb-10">
            <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-0">
              {[
                { label: "Provedor A", sub: "Cadastra inadimplentes", icon: Building2, color: "bg-blue-600" },
                null,
                { label: "Base compartilhada", sub: "Dados anonimizados + Score IA", icon: Database, color: "bg-blue-700", big: true },
                null,
                { label: "Provedor B", sub: "Consulta antes de instalar", icon: Search, color: "bg-emerald-600" },
              ].map((step, i) => {
                if (step === null) {
                  return (
                    <div key={i} className="hidden md:flex items-center px-3 text-blue-300">
                      <div className="w-8 h-0.5 bg-blue-300" />
                      <ArrowRight className="w-4 h-4 -ml-1" />
                    </div>
                  );
                }
                return (
                  <div key={i} className={`flex flex-col items-center text-center ${step.big ? "scale-110" : ""}`}>
                    <div className={`${step.color} ${step.big ? "w-20 h-20" : "w-14 h-14"} rounded-2xl flex items-center justify-center mb-3 shadow-lg`}>
                      <step.icon className={`${step.big ? "w-9 h-9" : "w-6 h-6"} text-white`} />
                    </div>
                    <p className={`font-bold text-slate-900 ${step.big ? "text-base" : "text-sm"}`}>{step.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5 max-w-[120px]">{step.sub}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3 pilares */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Database, color: "bg-blue-600", bg: "bg-blue-50 border-blue-200",
                title: "Dados unificados",
                desc: "Informações de centenas de provedores em uma única base. Consulte e saiba se o CPF tem histórico em qualquer provedor da rede.",
              },
              {
                icon: Lock, color: "bg-emerald-600", bg: "bg-emerald-50 border-emerald-200",
                title: "Privacidade garantida",
                desc: "Dados pessoais restritos ao provedor de origem. Outros veem apenas status: dias de atraso, faixa de valor e equipamentos — nunca dados identificáveis.",
              },
              {
                icon: Users, color: "bg-purple-600", bg: "bg-purple-50 border-purple-200",
                title: "Efeito de rede",
                desc: "Cada novo membro aumenta a proteção de todos. A base fica mais completa e precisa conforme mais provedores participam.",
              },
            ].map((item, i) => (
              <div key={i} className={`${item.bg} rounded-2xl p-6 border`} data-testid={`shared-db-${i}`}>
                <div className={`w-12 h-12 rounded-xl ${item.color} flex items-center justify-center mb-4`}>
                  <item.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-2">{item.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ANTI-FRAUDE EM AÇÃO */}
      <section className="py-20 bg-slate-900 overflow-hidden relative">
        <div className="absolute inset-0">
          <div className="absolute top-20 left-1/4 w-96 h-96 bg-red-900/20 rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-1/4 w-80 h-80 bg-blue-900/20 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 text-red-400 text-xs font-bold uppercase tracking-widest mb-3">
              <AlertTriangle className="w-4 h-4" />
              Anti-Fraude em Tempo Real
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-white">
              Seu inadimplente tentou contratar<br />em outro provedor.{" "}
              <span className="text-red-400">Você fica sabendo agora.</span>
            </h2>
            <p className="text-slate-400 mt-4 max-w-2xl mx-auto">
              A Resolução Anatel 765 obriga notificação em D+15 e aguardar até D+60 antes de cancelar.
              O inadimplente <strong className="text-slate-300">sabe disso</strong> — e usa esses 75 dias para migrar sem pagar.
              Com o anti-fraude, você recebe o alerta enquanto ele ainda está tentando.
            </p>
            <div className="inline-flex items-center gap-2 mt-4 bg-red-900/40 border border-red-700/40 text-red-300 text-xs font-semibold px-4 py-2 rounded-full">
              <AlertTriangle className="w-3.5 h-3.5" />
              Resolução Anatel 765: 75 dias antes do cancelamento. O cliente usa cada um deles.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 max-w-5xl mx-auto mb-14">
            {[
              {
                emoji: "😤",
                title: "Cliente inadimplente",
                desc: "R$ 850 em aberto. 95 dias de atraso. ONU não devolvida.",
                border: "border-red-500/40 bg-red-950/40",
                text: "text-red-400",
              },
              {
                emoji: "🚪",
                title: "Tenta migrar",
                desc: "Vai contratar internet em outro provedor da sua cidade.",
                border: "border-amber-500/40 bg-amber-950/40",
                text: "text-amber-400",
              },
              {
                emoji: "🔍",
                title: "Novo provedor consulta",
                desc: "O novo provedor usa o Consulta ISP para checar o CPF.",
                border: "border-blue-500/40 bg-blue-950/40",
                text: "text-blue-400",
              },
              {
                emoji: "🚨",
                title: "Você recebe o alerta",
                desc: "Notificação imediata: seu inadimplente está tentando migrar.",
                border: "border-green-500/40 bg-green-950/40",
                text: "text-green-400",
              },
            ].map((step, i) => (
              <div key={i} className="flex md:flex-col items-start md:items-stretch gap-2">
                <div className={`border ${step.border} rounded-2xl p-5 text-center flex-1`}>
                  <div className="text-4xl mb-3">{step.emoji}</div>
                  <h3 className={`text-sm font-bold ${step.text} mb-2`}>{step.title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{step.desc}</p>
                </div>
                {i < 3 && <div className="hidden md:block text-slate-600 text-xl text-center mt-8">→</div>}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl mx-auto">
            {[
              { stat: "70%", desc: "dos churns são por mudança de endereço — o cliente leva o equipamento" },
              { stat: "< 5s", desc: "para você receber o alerta anti-fraude por WhatsApp ou e-mail" },
              { stat: "R$ 690", desc: "prejuízo médio por inadimplente entre dívida e equipamento retido" },
            ].map((s, i) => (
              <div key={i} className="text-center bg-white/5 border border-white/10 rounded-2xl p-6">
                <p className="text-4xl font-black text-white mb-2">{s.stat}</p>
                <p className="text-sm text-slate-400 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RISCO POR ENDEREÇO */}
      <section className="py-16 bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* Left: texto */}
            <div>
              <div className="inline-flex items-center gap-2 bg-blue-500/20 text-blue-300 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-6">
                <MapPin className="w-3.5 h-3.5" />
                Nova funcionalidade — Consulta por Endereço
              </div>
              <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">
                CPF limpo<br />
                <span className="text-red-400">não é sinônimo de bom pagador.</span>
              </h2>
              <p className="text-slate-400 text-lg leading-relaxed mb-6">
                O inadimplente reincidente sabe o jogo: ele usa o CPF de um familiar, apresenta um documento "limpo"
                e você instala normalmente. Semanas depois, a conta não é paga.
              </p>
              <p className="text-slate-300 text-base leading-relaxed mb-8">
                <strong className="text-white">O endereço não mente.</strong> Mesmo com CPF diferente, o cliente mora no mesmo lugar.
                A Consulta ISP cruza o CEP + número da residência em todos os provedores parceiros e mostra o histórico de risco do endereço.
              </p>

              <div className="space-y-3">
                {[
                  { icon: MapPin, text: "Digite o CEP → o logradouro é preenchido automaticamente" },
                  { icon: Search, text: "Informe o número e complemento → busca em toda a rede colaborativa" },
                  { icon: AlertTriangle, text: "Descubra se houve calotes naquele endereço — independente do CPF" },
                  { icon: Shield, text: "Funciona mesmo quando o cliente usa o CPF de parentes" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg bg-blue-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <item.icon className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <p className="text-slate-300 text-sm">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: mockup do painel CEP expandido */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl">
              {/* window chrome */}
              <div className="bg-slate-950 px-4 py-2.5 flex items-center gap-2">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                </div>
                <span className="text-slate-500 text-[11px] ml-2 font-mono">Consulta ISP — Busca por Endereço</span>
              </div>

              <div className="p-5 space-y-4">
                {/* input CEP */}
                <div>
                  <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide mb-1.5">Documento ou CEP</p>
                  <div className="bg-slate-700 border border-blue-500 rounded-xl px-4 py-3 flex items-center gap-3">
                    <span className="text-white font-mono text-sm">86671-200</span>
                    <div className="ml-auto flex items-center gap-1.5 text-blue-400">
                      <MapPin className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold">CEP</span>
                    </div>
                  </div>
                </div>

                {/* endereço resolvido */}
                <div className="border-2 border-blue-500/40 bg-blue-900/20 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[10px] text-blue-400 font-bold uppercase tracking-wide mb-0.5">Endereço localizado</p>
                      <p className="text-sm font-black text-white">Rua das Palmeiras</p>
                      <p className="text-xs text-slate-400">Vila Nova · Londrina/PR</p>
                    </div>
                    <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-1 rounded-lg">CEP confirmado</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] text-slate-400 mb-1">Número *</p>
                      <div className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2">
                        <span className="text-white text-sm font-mono">142</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 mb-1">Complemento</p>
                      <div className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2">
                        <span className="text-slate-500 text-sm">Apto 12</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <div className="flex-1 bg-blue-600 text-white text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" />
                      Buscar risco por endereço
                    </div>
                  </div>
                </div>

                {/* resultado fictício */}
                <div className="bg-red-900/30 border border-red-700/40 rounded-xl p-3 flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-red-300">2 registros de inadimplência neste endereço</p>
                    <p className="text-[10px] text-red-400/80">CPFs diferentes — histórico de reincidência detectado</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section id="como-funciona" className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">Como funciona</h2>
            <p className="text-slate-500 mt-3">3 passos para proteger seu provedor</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                n: "1", title: "Configure em 15 minutos",
                desc: "Crie sua conta gratuitamente e conecte seu ERP (IXC, SGP, MK Solutions) ou importe via planilha CSV. Sem instalação, sem técnico.",
                icon: Building2, badge: "Setup: 15 min", badgeColor: "bg-blue-50 text-blue-700 border border-blue-200",
              },
              {
                n: "2", title: "Consulte antes de ativar",
                desc: "Antes de instalar, consulte o CPF ou CNPJ. Em menos de 2 segundos: score de risco, histórico em outros provedores, equipamentos pendentes e sugestão de decisão.",
                icon: Search, badge: "Resultado: < 2s", badgeColor: "bg-emerald-50 text-emerald-700 border border-emerald-200",
              },
              {
                n: "3", title: "Receba alertas anti-fraude",
                desc: "Quando um inadimplente seu tenta contratar em outro provedor da rede, você recebe notificação imediata por WhatsApp ou e-mail.",
                icon: Bell, badge: "Alerta em tempo real", badgeColor: "bg-amber-50 text-amber-700 border border-amber-200",
              },
            ].map((step, i) => (
              <div key={i} className="border border-slate-200 rounded-2xl p-6 hover:shadow-lg hover:border-blue-200 transition-all" data-testid={`step-${step.n}`}>
                <div className="flex items-center justify-between mb-5">
                  <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                    <step.icon className="w-6 h-6 text-white" />
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${step.badgeColor}`}>{step.badge}</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0">{step.n}</span>
                  <h3 className="text-base font-bold text-slate-900">{step.title}</h3>
                </div>
                <p className="text-sm text-slate-500 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CALCULADORA DE ECONOMIA */}
      <section id="calculadora" className="py-20 bg-slate-50 border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 text-green-600 text-xs font-bold uppercase tracking-widest mb-3">
              <TrendingUp className="w-4 h-4" />
              Calculadora de Economia
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">Quanto você está perdendo por mês?</h2>
            <p className="text-slate-500 mt-3 max-w-xl mx-auto">
              Ajuste os valores do seu provedor e veja o impacto financeiro da inadimplência.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Sliders */}
            <div className="space-y-8">
              {[
                {
                  label: "Clientes ativos", value: calcClientes, setValue: setCalcClientes,
                  min: 50, max: 5000, step: 50,
                  display: calcClientes.toLocaleString("pt-BR"),
                  color: "accent-blue-600 text-blue-600",
                  min_label: "50", max_label: "5.000",
                  testid: "calc-clientes",
                },
                {
                  label: "Taxa de inadimplência estimada", value: calcTaxa, setValue: setCalcTaxa,
                  min: 2, max: 40, step: 1,
                  display: `${calcTaxa}%`,
                  color: "accent-red-500 text-red-500",
                  min_label: "2% (ótimo)", max_label: "40% (crítico)",
                  testid: "calc-taxa",
                },
                {
                  label: "Equipamentos em comodato por cliente", value: calcEquip, setValue: setCalcEquip,
                  min: 1, max: 4, step: 1,
                  display: `${calcEquip} equip.`,
                  color: "accent-amber-500 text-amber-600",
                  min_label: "1 (só ONU)", max_label: "4 (ONU + roteador...)",
                  testid: "calc-equip",
                },
              ].map((s, i) => (
                <div key={i}>
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-sm font-semibold text-slate-700">{s.label}</label>
                    <span className={`text-2xl font-black ${s.color.split(" ")[1]}`}>{s.display}</span>
                  </div>
                  <input
                    type="range" min={s.min} max={s.max} step={s.step} value={s.value}
                    onChange={e => s.setValue(Number(e.target.value))}
                    className={`w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer ${s.color.split(" ")[0]}`}
                    data-testid={s.testid}
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>{s.min_label}</span><span>{s.max_label}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Resultados */}
            <div className="space-y-4">
              {(() => {
                const inadimplentes = Math.round(calcClientes * (calcTaxa / 100));
                const prejDivida = inadimplentes * 149;
                const prejEquip = inadimplentes * calcEquip * 290;
                const prejTotal = prejDivida + prejEquip;
                const economia = Math.round(prejTotal * 0.70);
                const roi = Math.round(economia / 149);
                const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
                return (
                  <>
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
                      <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1">Inadimplentes estimados</p>
                      <p className="text-4xl font-black text-red-600">{inadimplentes.toLocaleString("pt-BR")}<span className="text-lg font-semibold text-red-400 ml-1">clientes</span></p>
                      <p className="text-sm text-red-400 mt-1">com {calcTaxa}% de taxa sobre {calcClientes.toLocaleString("pt-BR")} clientes</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                        <p className="text-xs font-semibold text-orange-500 uppercase tracking-wide mb-1">Perda em dívidas/mês</p>
                        <p className="text-2xl font-black text-orange-600">{fmt(prejDivida)}</p>
                      </div>
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">Equipamentos em risco</p>
                        <p className="text-2xl font-black text-amber-700">{fmt(prejEquip)}</p>
                      </div>
                    </div>
                    <div className="bg-slate-900 rounded-2xl p-6">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Prejuízo total estimado/mês</p>
                      <p className="text-5xl font-black text-white">{fmt(prejTotal)}</p>
                      <div className="border-t border-slate-700 mt-4 pt-4">
                        <p className="text-xs font-semibold text-green-400 uppercase tracking-wide mb-1">Com Consulta ISP você evita até 70%</p>
                        <p className="text-3xl font-black text-green-400">{fmt(economia)}<span className="text-lg font-semibold text-green-500 ml-1">/mês protegidos</span></p>
                        <p className="text-xs text-slate-500 mt-2">ROI estimado: <strong className="text-white">{roi}x</strong> o custo do plano Básico (R$ 149/mês)</p>
                      </div>
                    </div>
                    <Button size="lg" className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2 h-12 text-base font-bold" onClick={goRegister}>
                      Proteger meu provedor agora <ArrowRight className="w-4 h-4" />
                    </Button>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </section>

      {/* PRINTS DO SISTEMA */}
      <section className="py-20 bg-white border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 text-blue-600 text-xs font-bold uppercase tracking-widest mb-3">
              <Activity className="w-4 h-4" />
              Veja o sistema em ação
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">Interface pensada para o dia a dia do provedor</h2>
            <p className="text-slate-500 mt-3 max-w-xl mx-auto">
              Consulta em segundos, resultado claro, sem treinamento necessário.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Print 1: Tela de consulta completa */}
            <div className="rounded-2xl overflow-hidden shadow-xl border border-slate-200">
              <div className="bg-slate-800 px-4 py-2.5 flex items-center gap-2">
                <div className="flex gap-1.5"><div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" /></div>
                <span className="ml-1 text-xs text-slate-400 font-mono">Consulta ISP — Resultado detalhado</span>
              </div>
              <div className="bg-slate-100 p-4 space-y-3">
                {/* Header da consulta */}
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">CPF consultado</p>
                      <p className="text-sm font-bold text-slate-900">987.654.321-00</p>
                    </div>
                    <div className="text-right">
                      <span className="inline-block bg-red-100 text-red-700 text-xs font-bold px-2.5 py-1 rounded-full">ALTO RISCO</span>
                      <p className="text-xs text-slate-400 mt-1">Consultado há 2min</p>
                    </div>
                  </div>
                  {/* Score bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-500">Score de crédito</span>
                      <span className="font-bold text-red-600">15 / 100</span>
                    </div>
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-red-500 rounded-full" style={{ width: "15%" }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>Crítico</span><span>Baixo</span><span>Médio</span><span>Bom</span><span>Excelente</span>
                    </div>
                  </div>
                </div>
                {/* Registros */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <p className="text-[10px] font-bold text-emerald-700 uppercase">Seu provedor</p>
                      <span className="ml-auto text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">Grátis</span>
                    </div>
                    <p className="text-sm font-bold text-slate-900">João Pereira Lima</p>
                    <p className="text-xs text-slate-500 mt-0.5">Rua das Flores, 142</p>
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between text-xs"><span className="text-slate-400">Atraso</span><span className="text-red-600 font-semibold">98 dias</span></div>
                      <div className="flex justify-between text-xs"><span className="text-slate-400">Valor</span><span className="text-red-600 font-semibold">R$ 449,70</span></div>
                      <div className="flex justify-between text-xs"><span className="text-slate-400">Faturas</span><span className="font-semibold">3 em atraso</span></div>
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-2 h-2 rounded-full bg-slate-400" />
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Outro provedor</p>
                      <span className="ml-auto text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">1 crédito</span>
                    </div>
                    <p className="text-sm font-bold text-slate-700">João P. L•••</p>
                    <p className="text-xs text-slate-400 mt-0.5">São Paulo - SP</p>
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between text-xs"><span className="text-slate-400">Atraso</span><span className="text-red-600 font-semibold">122 dias</span></div>
                      <div className="flex justify-between text-xs"><span className="text-slate-400">Faixa</span><span className="font-semibold">R$ 100–500</span></div>
                      <div className="flex justify-between text-xs"><span className="text-slate-400">Equip.</span><span className="text-amber-600 font-semibold">2 retidos</span></div>
                    </div>
                  </div>
                </div>
                {/* Sugestão IA */}
                <div className="bg-red-600 rounded-xl p-3 flex items-center gap-3">
                  <div className="bg-white/20 px-3 py-2 rounded-lg text-center flex-shrink-0">
                    <p className="text-[9px] text-white/70 uppercase font-bold">Sugestão IA</p>
                    <p className="text-white font-black">REJEITAR</p>
                  </div>
                  <div>
                    <p className="text-xs text-white font-semibold">3 equipamentos não devolvidos</p>
                    <p className="text-xs text-red-200">Valor em risco: R$ 810,00 · 2 provedores na rede</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Print 2: Painel de equipamentos + anti-fraude */}
            <div className="space-y-4">
              {/* Anti-fraude alert */}
              <div className="rounded-2xl overflow-hidden shadow-xl border border-slate-200">
                <div className="bg-slate-800 px-4 py-2.5 flex items-center gap-2">
                  <div className="flex gap-1.5"><div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" /></div>
                  <span className="ml-1 text-xs text-slate-400 font-mono">Anti-Fraude — Alertas</span>
                </div>
                <div className="bg-slate-100 p-4 space-y-2">
                  <div className="bg-white rounded-xl p-3 border border-slate-200">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Alertas recentes</p>
                    {[
                      { nome: "João P. Lima", acao: "CPF consultado por provedor da rede", tempo: "há 3min", cor: "bg-red-500" },
                      { nome: "Maria S. Costa", acao: "Tentativa de novo contrato detectada", tempo: "há 1h", cor: "bg-orange-500" },
                      { nome: "Carlos E. Moraes", acao: "CPF consultado por provedor da rede", tempo: "há 2h", cor: "bg-red-500" },
                    ].map((alerta, i) => (
                      <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                        <div className={`w-2 h-2 rounded-full ${alerta.cor} flex-shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-900">{alerta.nome}</p>
                          <p className="text-[10px] text-slate-500 truncate">{alerta.acao}</p>
                        </div>
                        <span className="text-[10px] text-slate-400 flex-shrink-0">{alerta.tempo}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Controle de equipamentos */}
              <div className="rounded-2xl overflow-hidden shadow-xl border border-slate-200">
                <div className="bg-slate-800 px-4 py-2.5 flex items-center gap-2">
                  <div className="flex gap-1.5"><div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" /></div>
                  <span className="ml-1 text-xs text-slate-400 font-mono">Equipamentos em comodato</span>
                </div>
                <div className="bg-slate-100 p-4">
                  <div className="bg-white rounded-xl p-3 border border-slate-200">
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      {[
                        { label: "Em campo", value: "1.247", color: "text-blue-600" },
                        { label: "Não devolvidos", value: "38", color: "text-red-600" },
                        { label: "Valor em risco", value: "R$ 11.400", color: "text-amber-600" },
                      ].map((stat, i) => (
                        <div key={i} className="text-center">
                          <p className={`text-lg font-black ${stat.color}`}>{stat.value}</p>
                          <p className="text-[10px] text-slate-400">{stat.label}</p>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      {[
                        { equip: "ONU ZTE F601", cliente: "João P. Lima", dias: "98 dias", valor: "R$ 180,00", status: "Não devolvida" },
                        { equip: "Roteador TP-Link", cliente: "Maria S. Costa", dias: "62 dias", valor: "R$ 290,00", status: "Pendente" },
                      ].map((eq, i) => (
                        <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
                          <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Wifi className="w-3.5 h-3.5 text-amber-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-900">{eq.equip}</p>
                            <p className="text-[10px] text-slate-400">{eq.cliente} · {eq.dias}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs font-bold text-red-600">{eq.valor}</p>
                            <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold">{eq.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FUNCIONALIDADES */}
      <section id="funcionalidades" className="py-16 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">Funcionalidades completas</h2>
            <p className="text-slate-500 mt-3 max-w-xl mx-auto">Uma plataforma completa para proteger seu provedor</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Search, title: "Consulta ISP", desc: "Consulte CPF/CNPJ na rede colaborativa. Score de risco, histórico de pagamentos e equipamentos retidos em segundos.", color: "bg-blue-600" },
              { icon: BarChart3, title: "Score de Crédito", desc: "Score de 0 a 100 calculado com dados reais de toda a rede. Quanto mais provedores participam, mais preciso.", color: "bg-green-600" },
              { icon: Shield, title: "Anti-Fraude", desc: "Alerta em tempo real quando um cliente seu inadimplente tenta contratar serviço em outro provedor da rede.", color: "bg-red-600" },
              { icon: Bot, title: "Análise com IA", desc: "Inteligência artificial gera recomendações personalizadas para cada consulta: aprovar, analisar ou rejeitar.", color: "bg-indigo-600" },
              { icon: Router, title: "Controle de Equipamentos", desc: "Rastreie ONUs, roteadores e switches não devolvidos com valor, modelo, serial e status de recuperação.", color: "bg-amber-600" },
              { icon: Globe, title: "Integração com ERP", desc: "Conecte IXC, SGP ou MK Solutions. A base é atualizada automaticamente a cada sincronização.", color: "bg-blue-700" },
            ].map((f, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md hover:border-blue-200 transition-all group" data-testid={`feature-${i}`}>
                <div className={`w-10 h-10 rounded-lg ${f.color} flex items-center justify-center mb-3 group-hover:scale-105 transition-transform`}>
                  <f.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ERPs */}
      {erps.length > 0 && (
        <section className="py-12 bg-white border-t border-slate-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-8">
              <span className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full mb-3">Integrações</span>
              <h2 className="text-2xl font-black text-slate-900">ERPs Integrados</h2>
              <p className="text-slate-500 mt-2 text-sm">
                Integração em <strong>15 minutos</strong>. Sem programação. Sem técnico.
                Não usa ERP? Importe via planilha CSV.
              </p>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 max-w-3xl mx-auto">
              {erps.map(erp => (
                <div key={erp.key} className="flex flex-col items-center gap-2 py-3 hover:scale-105 transition-transform" data-testid={`erp-card-${erp.key}`}>
                  {erp.logoBase64 ? (
                    <img src={erp.logoBase64} alt={erp.name} className="w-10 h-10 object-contain rounded-lg" />
                  ) : (
                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${erp.gradient} flex items-center justify-center`}>
                      <Globe className="w-5 h-5 text-white" />
                    </div>
                  )}
                  <span className="text-xs font-semibold text-slate-700">{erp.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* PREÇOS */}
      <section id="precos" className="py-16 bg-slate-50 border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 text-blue-600 text-xs font-bold uppercase tracking-widest mb-3">
              <CreditCard className="w-4 h-4" />
              Simples e transparente
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">Planos para todo tamanho de provedor</h2>
            <p className="text-slate-500 mt-3 max-w-lg mx-auto">
              Consultas na sua própria base são <strong>sempre gratuitas</strong>.
              Créditos para a rede colaborativa a partir de R$ 0,90.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              {
                name: "Gratuito", price: "R$ 0", period: "/mês para sempre",
                desc: "Para começar sem custo", highlight: false,
                features: ["Consultas ilimitadas na sua base", "30 créditos ISP para testar a rede", "Anti-fraude básico", "Importação via CSV", "1 usuário"],
                notIncluded: ["Créditos mensais inclusos", "Integração automática ERP"],
                cta: "Criar Conta Grátis",
              },
              {
                name: "Básico", price: "R$ 149", period: "/mês",
                desc: "Para provedores com até 1.000 clientes", highlight: true, badge: "Mais Popular",
                features: ["Tudo do Gratuito", "200 créditos ISP/mês inclusos", "50 créditos SPC/mês inclusos", "Anti-fraude + notificação WhatsApp", "Integração com 1 ERP", "3 usuários", "Suporte por chat"],
                notIncluded: ["Consulta em lote"],
                cta: "Começar Agora",
              },
              {
                name: "Profissional", price: "R$ 349", period: "/mês",
                desc: "Para provedores com mais de 1.000 clientes", highlight: false,
                features: ["Tudo do Básico", "500 créditos ISP/mês inclusos", "150 créditos SPC/mês inclusos", "Todos os ERPs integrados", "Consulta em lote (até 500 CPFs)", "Usuários ilimitados", "Suporte prioritário"],
                notIncluded: [],
                cta: "Começar Agora",
              },
            ].map((plan, i) => (
              <div key={i} className={`relative border rounded-2xl p-6 flex flex-col bg-white ${plan.highlight ? "border-blue-600 ring-2 ring-blue-600 ring-offset-2" : "border-slate-200"}`} data-testid={`plan-${i}`}>
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-4 py-1 rounded-full">Mais Popular</div>
                )}
                <div className="mb-5">
                  <h3 className="font-bold text-slate-900 text-lg">{plan.name}</h3>
                  <div className="mt-2 flex items-end gap-1">
                    <span className="text-4xl font-black text-slate-900">{plan.price}</span>
                    <span className="text-sm text-slate-400 mb-1">{plan.period}</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">{plan.desc}</p>
                </div>
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f, fi) => (
                    <li key={fi} className="flex items-start gap-2 text-sm text-slate-700">
                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                  {plan.notIncluded.map((f, fi) => (
                    <li key={fi} className="flex items-start gap-2 text-sm text-slate-400">
                      <span className="w-4 h-4 flex-shrink-0 mt-0.5 text-center font-bold text-slate-300">✗</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Button onClick={goRegister} className={plan.highlight ? "w-full bg-blue-600 hover:bg-blue-700 text-white font-bold" : "w-full font-bold"} variant={plan.highlight ? "default" : "outline"}>
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>

          <p className="text-center text-sm text-slate-400 mt-8">
            Pacotes de créditos avulsos a partir de <strong className="text-slate-600">R$ 49,90</strong> (50 créditos ISP). Os créditos não expiram.
          </p>
          <div className="flex items-center justify-center gap-6 mt-3 text-xs text-slate-400">
            <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Sem fidelidade</span>
            <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> LGPD</span>
            <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> Cancele quando quiser</span>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-black text-slate-900">Dúvidas frequentes</h2>
          </div>
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-2xl overflow-hidden bg-white" data-testid="faq-section">
            {[
              { q: "O que é a base de dados compartilhada?", a: "É uma base única onde todos os provedores registram seus inadimplentes. Quando você consulta um CPF, o sistema verifica se ele aparece na base de qualquer provedor da rede, retornando informações anonimizadas como dias de atraso, faixa de valor e equipamentos pendentes." },
              { q: "Quanto custa utilizar a plataforma?", a: "O cadastro é gratuito. Consultas de clientes do próprio provedor são sempre gratuitas. Para ver dados de outros provedores na base compartilhada, o custo é de 1 crédito por consulta. Créditos podem ser adquiridos em pacotes acessíveis." },
              { q: "Meus dados estão seguros?", a: "Sim. Dados pessoais ficam restritos ao provedor de origem. Outros provedores veem apenas indicadores de risco — dias de atraso, faixa de valor, equipamentos — sem acesso a nomes, endereços ou dados identificáveis. Toda comunicação usa criptografia." },
              { q: "Quais ERPs são compatíveis?", a: "A plataforma integra nativamente com IXC Provedor, SGP e MK Solutions. Quem não usa ERP pode importar via planilha CSV em qualquer formato." },
              { q: "Como funciona o anti-fraude?", a: "Quando um cliente seu inadimplente é consultado por outro provedor da rede, você recebe um alerta em tempo real via WhatsApp ou e-mail. Isso indica que ele pode estar tentando contratar internet em outro lugar sem quitar a dívida com você." },
              { q: "Funciona para provedor pequeno com menos de 200 clientes?", a: "Sim, especialmente para pequenos. Para um provedor com 150 clientes, o custo de uma única ONU perdida (R$ 280) representa muito mais proporcionalmente. O plano Gratuito já é suficiente para começar — consultas na sua própria base são sempre gratuitas, sem limite." },
              { q: "Compartilhar dados de inadimplentes viola a LGPD?", a: "Não, quando feito corretamente. O Consulta ISP foi desenhado em conformidade com a LGPD: outros provedores jamais veem o nome completo, CPF, endereço ou dados pessoais identificáveis do seu cliente. A base compartilhada expõe apenas indicadores anonimizados — dias de atraso, faixa de valor e quantidade de equipamentos pendentes. Isso é equiparável ao compartilhamento de dados de risco de crédito feito por bureaus como SPC e Serasa, previsto no art. 7º, IX da LGPD (interesse legítimo)." },
              { q: "E a Resolução Anatel 765 — como ela afeta meu provedor?", a: "A Resolução 765 obriga você a notificar o cliente com antecedência antes de suspender (D+15) e aguardar até D+60 para cancelar definitivamente. São 75 dias em que o cliente inadimplente sabe que pode continuar usando — ou migrar sem pagar. O anti-fraude do Consulta ISP alerta você em tempo real quando o CPF do seu inadimplente é consultado por outro provedor, permitindo agir (cobrar, negociar, recuperar o equipamento) enquanto ele ainda está na sua rede e antes de virar um prejuízo definitivo." },
            ].map((faq, i) => (
              <div key={i} className="px-6">
                <button className="w-full text-left py-5 flex items-center justify-between gap-4" onClick={() => setOpenFaq(openFaq === i ? null : i)} data-testid={`faq-${i}`}>
                  <span className="text-sm font-semibold text-slate-900">{faq.q}</span>
                  {openFaq === i ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                </button>
                {openFaq === i && <p className="text-sm text-slate-600 pb-5 leading-relaxed -mt-1">{faq.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="py-20 bg-blue-600 relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/3 w-96 h-96 bg-blue-500/30 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/3 w-80 h-80 bg-blue-800/30 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/15 text-white text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-6">
            <Share2 className="w-3.5 h-3.5" />
            Junte-se à rede colaborativa
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">
            Proteja seu provedor com<br />
            <span className="text-blue-200">dados de toda a rede.</span>
          </h2>
          <p className="text-lg text-blue-100 mb-8 max-w-xl mx-auto">
            Cadastro em 2 minutos. Sem cartão de crédito. 30 créditos gratuitos para testar a rede colaborativa.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" className="bg-white text-blue-700 hover:bg-blue-50 px-10 gap-2 h-12 text-base font-bold shadow-xl" onClick={goRegister} data-testid="button-cta-bottom">
              Criar Conta Grátis <ArrowRight className="w-4 h-4" />
            </Button>
            <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 px-8 gap-2 h-12 text-base" onClick={goLogin} data-testid="button-login-bottom">
              Já tenho conta — Login
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 text-sm text-blue-200 mt-8">
            <span className="flex items-center gap-2"><span className="text-green-300">✓</span> Gratuito na base própria</span>
            <span className="flex items-center gap-2"><span className="text-green-300">✓</span> Sem contrato de fidelidade</span>
            <span className="flex items-center gap-2"><span className="text-green-300">✓</span> Dados protegidos pela LGPD</span>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-slate-900 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <span className="text-white font-bold">Consulta ISP</span>
              <span className="text-slate-400 text-sm hidden sm:inline">Base colaborativa de crédito para provedores</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Dados criptografados</span>
              <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> Privacidade garantida</span>
            </div>
          </div>
          <div className="border-t border-slate-800 mt-6 pt-6 text-center">
            <p className="text-xs text-slate-500">
              Consulta ISP — Plataforma colaborativa de análise de crédito para provedores de internet do Brasil
            </p>
          </div>
        </div>
      </footer>

      <LandingChatbot onNavigate={setLocation} />
    </div>
  );
}
