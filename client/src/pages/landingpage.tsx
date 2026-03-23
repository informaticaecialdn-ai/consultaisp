import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import LandingChatbot from "@/components/landing-chatbot";
import {
  Shield, Search, BarChart3, Users, Zap, Lock,
  ArrowRight, AlertTriangle, CreditCard, Share2,
  ChevronDown, ChevronUp, Globe, Router,
  CheckCircle, Bell, Database, Bot,
} from "lucide-react";

type ErpItem = { key: string; name: string; description: string | null; logoBase64: string | null; gradient: string };

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-8 border-t border-white/20">
                {[
                  { v: "19.000+", l: "ISPs no Brasil" },
                  { v: "R$ 690", l: "prejuízo médio/inadimplente" },
                  { v: "< 2s", l: "resultado da consulta" },
                  { v: "Grátis", l: "na sua própria base" },
                ].map(s => (
                  <div key={s.l}>
                    <p className="text-2xl font-black text-white">{s.v}</p>
                    <p className="text-xs text-blue-200 mt-0.5">{s.l}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Mockup */}
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

      {/* BARRA DE ERPS */}
      {erps.length > 0 && (
        <section className="py-4 bg-slate-900 border-b border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row items-center gap-4 justify-between">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest whitespace-nowrap">Integra com</p>
              <div className="flex items-center gap-6 flex-wrap justify-center">
                {erps.map(erp => (
                  <div key={erp.key} className="flex items-center gap-2 opacity-50 hover:opacity-80 transition-opacity">
                    {erp.logoBase64 ? (
                      <img src={erp.logoBase64} alt={erp.name} className="h-6 object-contain brightness-0 invert" />
                    ) : (
                      <span className="text-white text-xs font-bold">{erp.name}</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500 whitespace-nowrap">
                Ou via <span className="text-slate-300">planilha CSV</span>
              </p>
            </div>
          </div>
        </section>
      )}

      {/* 3 DORES */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 text-red-600 text-xs font-bold uppercase tracking-widest mb-3">
              <AlertTriangle className="w-4 h-4" />
              Por que provedores perdem dinheiro
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">
              Seu próximo cliente inadimplente<br />
              <span className="text-slate-400">está com o CPF "limpo" no seu ERP.</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                icon: Search,
                color: "text-red-500", bg: "bg-red-50", border: "border-red-100",
                num: "10–30%",
                title: "Taxa de inadimplência média",
                desc: "ISPs regionais operam 6× acima do limite saudável (5%). O custo de ativar um cliente FTTH é ~R$ 400 — e você descobre a dívida só depois.",
              },
              {
                icon: Router,
                color: "text-amber-500", bg: "bg-amber-50", border: "border-amber-100",
                num: "R$ 290",
                title: "Valor médio de uma ONU",
                desc: "Equipamento em comodato que o inadimplente leva quando cancela. Sem rastreamento, você não tem como cobrar nem recuperar.",
              },
              {
                icon: Users,
                color: "text-purple-500", bg: "bg-purple-50", border: "border-purple-100",
                num: "70%",
                title: "Churns por mudança de endereço",
                desc: "O cliente cancela, muda e contrata em outro provedor — levando a dívida e a ONU. Sem alerta, ele recomeça o ciclo com você como próximo.",
              },
            ].map((card, i) => (
              <div key={i} className={`border ${card.border} rounded-2xl p-7 hover:shadow-lg transition-shadow`} data-testid={`pain-${i}`}>
                <div className={`w-12 h-12 ${card.bg} rounded-xl flex items-center justify-center mb-5`}>
                  <card.icon className={`w-6 h-6 ${card.color}`} />
                </div>
                <p className={`text-3xl font-black ${card.color} mb-2`}>{card.num}</p>
                <h3 className="text-base font-bold text-slate-900 mb-2">{card.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section id="como-funciona" className="py-20 bg-slate-50 border-t border-slate-100">
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
                icon: Database, badge: "Setup: 15 min", badgeColor: "bg-blue-50 text-blue-700 border border-blue-200",
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
              <div key={i} className="border border-slate-200 bg-white rounded-2xl p-6 hover:shadow-lg hover:border-blue-200 transition-all" data-testid={`step-${step.n}`}>
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

      {/* FUNCIONALIDADES — Anti-Fraude em destaque */}
      <section id="funcionalidades" className="py-20 bg-slate-900 overflow-hidden relative">
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
              A Anatel obriga você a aguardar 75 dias antes de cancelar.
              O cliente inadimplente <strong className="text-slate-300">sabe disso</strong> — e usa esse tempo para migrar sem pagar.
              Com o anti-fraude, você recebe o alerta enquanto ele ainda está tentando.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 max-w-5xl mx-auto mb-14">
            {[
              { emoji: "😤", title: "Cliente inadimplente", desc: "R$ 850 em aberto. 95 dias de atraso. ONU não devolvida.", border: "border-red-500/40 bg-red-950/40", text: "text-red-400" },
              { emoji: "🚪", title: "Tenta migrar", desc: "Vai contratar internet em outro provedor da sua cidade.", border: "border-amber-500/40 bg-amber-950/40", text: "text-amber-400" },
              { emoji: "🔍", title: "Novo provedor consulta", desc: "O novo provedor usa o Consulta ISP para checar o CPF.", border: "border-blue-500/40 bg-blue-950/40", text: "text-blue-400" },
              { emoji: "🚨", title: "Você recebe o alerta", desc: "Notificação imediata: seu inadimplente está tentando migrar.", border: "border-green-500/40 bg-green-950/40", text: "text-green-400" },
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

          {/* Grid features secundárias */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-white/10 pt-14">
            {[
              { icon: Search, title: "Consulta ISP", desc: "Score de risco + histórico em toda a rede em menos de 2 segundos.", color: "text-blue-400", bg: "bg-blue-900/30 border-blue-800/40" },
              { icon: BarChart3, title: "Score de Crédito", desc: "Score 0–100 calculado com dados reais da rede colaborativa.", color: "text-green-400", bg: "bg-green-900/30 border-green-800/40" },
              { icon: Bot, title: "Análise com IA", desc: "Recomendações personalizadas por IA para cada consulta realizada.", color: "text-indigo-400", bg: "bg-indigo-900/30 border-indigo-800/40" },
              { icon: Router, title: "Controle de Equipamentos", desc: "Rastreie ONUs e roteadores em comodato com status de recuperação.", color: "text-amber-400", bg: "bg-amber-900/30 border-amber-800/40" },
            ].map((f, i) => (
              <div key={i} className={`border ${f.bg} rounded-xl p-5`} data-testid={`feature-${i}`}>
                <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center mb-4">
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                <h4 className="text-sm font-bold text-white mb-2">{f.title}</h4>
                <p className="text-xs text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PREÇOS */}
      <section id="precos" className="py-20 bg-slate-50 border-t border-slate-100">
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
                desc: "Para provedores com até 1.000 clientes", highlight: true,
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
            Pacotes avulsos a partir de <strong className="text-slate-600">R$ 49,90</strong> (50 créditos ISP). Os créditos não expiram.
          </p>
          <div className="flex items-center justify-center gap-6 mt-3 text-xs text-slate-400">
            <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Sem fidelidade</span>
            <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> LGPD</span>
            <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> Cancele quando quiser</span>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-black text-slate-900">Dúvidas frequentes</h2>
          </div>
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-2xl overflow-hidden bg-white" data-testid="faq-section">
            {[
              {
                q: "O que é a base de dados compartilhada?",
                a: "É uma base única onde todos os provedores registram seus inadimplentes. Quando você consulta um CPF, o sistema verifica em qualquer provedor da rede e retorna dados anonimizados: dias de atraso, faixa de valor e equipamentos pendentes — nunca dados pessoais identificáveis.",
              },
              {
                q: "Consultas na minha própria base são cobradas?",
                a: "Não. Consultas de clientes do seu próprio provedor são sempre gratuitas e ilimitadas. Créditos são consumidos apenas quando a consulta retorna dados de outros provedores da rede — 1 crédito por provedor externo encontrado.",
              },
              {
                q: "Quanto tempo leva para configurar?",
                a: "15 minutos para conectar um ERP (IXC, SGP, MK Solutions) via API. Se preferir, importe sua base de inadimplentes via planilha CSV e comece a consultar imediatamente. Sem instalação, sem técnico.",
              },
              {
                q: "Como funciona o anti-fraude?",
                a: "Quando um cliente seu inadimplente é consultado por outro provedor da rede, você recebe um alerta em tempo real via WhatsApp ou e-mail. Isso indica que ele pode estar tentando contratar internet em outro lugar sem quitar a dívida com você.",
              },
              {
                q: "Compartilhar dados de inadimplentes viola a LGPD?",
                a: "Não. O Consulta ISP foi desenhado em conformidade com a LGPD: outros provedores jamais veem o nome completo, CPF, endereço ou dados pessoais identificáveis. A base expõe apenas indicadores anonimizados — dias de atraso, faixa de valor e quantidade de equipamentos pendentes.",
              },
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
            Cada calote evitado paga o plano inteiro
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
              <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> Privacidade LGPD</span>
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
