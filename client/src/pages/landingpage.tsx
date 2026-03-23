import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import LandingChatbot from "@/components/landing-chatbot";
import imgLucro from "@assets/image_1774227760707.png";
import imgFluxo from "@assets/image_1774227783643.png";
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
            {/* Left */}
            <div className="text-white">
              <div className="inline-flex items-center gap-2 bg-white/15 text-white text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-6">
                <Share2 className="w-3.5 h-3.5" />
                Rede colaborativa entre provedores
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-5xl font-black leading-[1.1] tracking-tight mb-6" data-testid="text-hero-title">
                Saiba o histórico do cliente<br />
                <span className="text-blue-200">antes de instalar.</span>
              </h1>
              <p className="text-blue-100 text-lg leading-relaxed mb-8 max-w-lg">
                Provedores compartilham dados de inadimplência em uma base colaborativa.
                Consulte CPF/CNPJ em menos de 2 segundos e proteja seu provedor de calotes e equipamentos não devolvidos.
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

            {/* Right — mockup card */}
            <div className="hidden lg:block">
              <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
                <div className="bg-slate-800 px-4 py-3 flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                  <span className="ml-2 text-xs text-slate-400 font-mono">consulta-isp.com.br</span>
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

      {/* O PROBLEMA — seção com as imagens */}
      <section className="py-16 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 text-red-600 text-xs font-bold uppercase tracking-widest mb-3">
              <AlertTriangle className="w-4 h-4" />
              O problema real do seu provedor
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">
              Inadimplência mata o fluxo de caixa
            </h2>
            <p className="text-slate-500 mt-3 max-w-2xl mx-auto">
              ISPs regionais operam com taxas de inadimplência entre <strong>10% e 30%</strong>.
              Cada cliente caloteiro representa <strong>R$ 690 de prejuízo</strong> entre dívida e equipamento não devolvido.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* Imagem 1 */}
            <div className="rounded-2xl overflow-hidden shadow-lg border border-slate-200 bg-white">
              <div className="bg-blue-600 px-5 py-3">
                <h3 className="text-white font-bold text-sm">Lucro no papel ≠ dinheiro no caixa</h3>
                <p className="text-blue-200 text-xs mt-0.5">Calotes criam o "lucro fantasma" — você fatura mas não recebe</p>
              </div>
              <img
                src={imgLucro}
                alt="Lucro não é caixa - impacto financeiro da inadimplência"
                className="w-full object-cover"
              />
            </div>

            {/* Imagem 2 */}
            <div className="rounded-2xl overflow-hidden shadow-lg border border-slate-200 bg-white">
              <div className="bg-blue-700 px-5 py-3">
                <h3 className="text-white font-bold text-sm">Inadimplente = colapso do fluxo de caixa</h3>
                <p className="text-blue-200 text-xs mt-0.5">Receitas que não entram geram pressão em todas as saídas</p>
              </div>
              <img
                src={imgFluxo}
                alt="Fluxo de caixa - monitor do negócio"
                className="w-full object-cover"
              />
            </div>
          </div>

          {/* Dados chave embaixo das imagens */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8">
            {[
              { stat: "19.000+", desc: "ISPs regionais no Brasil", color: "text-blue-600" },
              { stat: "73 mi", desc: "brasileiros negativados em 2025", color: "text-red-600" },
              { stat: "R$ 400", desc: "custo médio de ativar um cliente FTTH", color: "text-amber-600" },
              { stat: "R$ 690", desc: "prejuízo médio por inadimplente", color: "text-orange-600" },
            ].map((item, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 text-center shadow-sm">
                <p className={`text-3xl font-black ${item.color} mb-1`}>{item.stat}</p>
                <p className="text-xs text-slate-500 leading-tight">{item.desc}</p>
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
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">
              Provedores que se protegem juntos
            </h2>
            <p className="text-slate-500 mt-3 max-w-2xl mx-auto">
              Cada provedor registra seus inadimplentes. Toda a rede se beneficia.
              Quanto mais provedores participam, mais precisa e poderosa fica a proteção.
            </p>
          </div>

          {/* Diagrama da rede */}
          <div className="bg-gradient-to-br from-blue-50 to-slate-50 rounded-3xl p-8 border border-blue-100 mb-12">
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
                icon: Database,
                color: "bg-blue-600",
                bg: "bg-blue-50 border-blue-200",
                title: "Dados unificados",
                desc: "Informações de inadimplência de centenas de provedores em uma única base. Consulte e saiba se o CPF tem histórico negativo em qualquer provedor da rede.",
              },
              {
                icon: Lock,
                color: "bg-emerald-600",
                bg: "bg-emerald-50 border-emerald-200",
                title: "Privacidade garantida",
                desc: "Dados pessoais ficam restritos ao provedor de origem. Outros veem apenas indicadores: dias de atraso, faixa de valor e equipamentos pendentes — nunca nomes ou endereços.",
              },
              {
                icon: Users,
                color: "bg-purple-600",
                bg: "bg-purple-50 border-purple-200",
                title: "Efeito de rede",
                desc: "Quanto mais provedores participam, mais completa e precisa fica a base. Cada novo membro protege a todos contra inadimplentes recorrentes que migram entre provedores.",
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

      {/* COMO FUNCIONA */}
      <section id="como-funciona" className="py-16 bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black text-white">Como funciona</h2>
            <p className="text-slate-400 mt-3">3 passos para proteger seu provedor</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                n: "1",
                title: "Configure em 15 minutos",
                desc: "Crie sua conta gratuitamente e conecte seu ERP (IXC, SGP, MK Solutions) ou importe via planilha CSV. Sem instalação, sem técnico.",
                icon: Building2,
                badge: "Setup: 15 min",
                badgeColor: "bg-blue-500/20 text-blue-300",
              },
              {
                n: "2",
                title: "Consulte antes de ativar",
                desc: "Antes de instalar, consulte o CPF ou CNPJ. Em menos de 2 segundos: score de risco, histórico em outros provedores, equipamentos pendentes e sugestão de decisão.",
                icon: Search,
                badge: "Resultado: < 2s",
                badgeColor: "bg-emerald-500/20 text-emerald-300",
              },
              {
                n: "3",
                title: "Receba alertas anti-fraude",
                desc: "Quando um inadimplente seu tenta contratar em outro provedor da rede, você recebe uma notificação imediata por WhatsApp ou e-mail.",
                icon: Bell,
                badge: "Alerta em tempo real",
                badgeColor: "bg-amber-500/20 text-amber-300",
              },
            ].map((step, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-6" data-testid={`step-${step.n}`}>
                <div className="flex items-center justify-between mb-5">
                  <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                    <step.icon className="w-6 h-6 text-white" />
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${step.badgeColor}`}>
                    {step.badge}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0">{step.n}</span>
                  <h3 className="text-base font-bold text-white">{step.title}</h3>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FUNCIONALIDADES */}
      <section id="funcionalidades" className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">Tudo que você precisa</h2>
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
              <div key={i} className="border border-slate-200 rounded-xl p-5 hover:shadow-md hover:border-blue-200 transition-all group" data-testid={`feature-${i}`}>
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
        <section className="py-12 bg-slate-50 border-t border-slate-100">
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
      <section id="precos" className="py-16 bg-white">
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
                name: "Gratuito",
                price: "R$ 0",
                period: "/mês para sempre",
                desc: "Para começar sem custo",
                highlight: false,
                features: [
                  "Consultas ilimitadas na sua base",
                  "30 créditos ISP para testar a rede",
                  "Anti-fraude básico",
                  "Importação via CSV",
                  "1 usuário",
                ],
                notIncluded: ["Créditos mensais inclusos", "Integração automática ERP"],
                cta: "Criar Conta Grátis",
              },
              {
                name: "Básico",
                price: "R$ 149",
                period: "/mês",
                desc: "Para provedores com até 1.000 clientes",
                highlight: true,
                badge: "Mais Popular",
                features: [
                  "Tudo do Gratuito",
                  "200 créditos ISP/mês inclusos",
                  "50 créditos SPC/mês inclusos",
                  "Anti-fraude + notificação WhatsApp",
                  "Integração com 1 ERP",
                  "3 usuários",
                  "Suporte por chat",
                ],
                notIncluded: ["Consulta em lote"],
                cta: "Começar Agora",
              },
              {
                name: "Profissional",
                price: "R$ 349",
                period: "/mês",
                desc: "Para provedores com mais de 1.000 clientes",
                highlight: false,
                features: [
                  "Tudo do Básico",
                  "500 créditos ISP/mês inclusos",
                  "150 créditos SPC/mês inclusos",
                  "Todos os ERPs integrados",
                  "Consulta em lote (até 500 CPFs)",
                  "Usuários ilimitados",
                  "Suporte prioritário",
                ],
                notIncluded: [],
                cta: "Começar Agora",
              },
            ].map((plan, i) => (
              <div
                key={i}
                className={`relative border rounded-2xl p-6 flex flex-col ${
                  plan.highlight
                    ? "border-blue-600 ring-2 ring-blue-600 ring-offset-2"
                    : "border-slate-200"
                }`}
                data-testid={`plan-${i}`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-4 py-1 rounded-full">
                    Mais Popular
                  </div>
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
                      <span className="w-4 h-4 flex-shrink-0 mt-0.5 text-center text-slate-300 font-bold">✗</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={goRegister}
                  className={plan.highlight ? "w-full bg-blue-600 hover:bg-blue-700 text-white font-bold" : "w-full font-bold"}
                  variant={plan.highlight ? "default" : "outline"}
                >
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
      <section id="faq" className="py-16 bg-slate-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-black text-slate-900">Dúvidas frequentes</h2>
          </div>
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-2xl overflow-hidden bg-white" data-testid="faq-section">
            {[
              {
                q: "O que é a base de dados compartilhada?",
                a: "É uma base única onde todos os provedores registram seus inadimplentes. Quando você consulta um CPF, o sistema verifica se ele aparece na base de qualquer provedor da rede, retornando informações anonimizadas como dias de atraso, faixa de valor e equipamentos pendentes.",
              },
              {
                q: "Quanto custa utilizar a plataforma?",
                a: "O cadastro é gratuito. Consultas de clientes do próprio provedor são sempre gratuitas. Para ver dados de outros provedores na base compartilhada, o custo é de 1 crédito por consulta. Créditos podem ser adquiridos em pacotes acessíveis.",
              },
              {
                q: "Meus dados estão seguros?",
                a: "Sim. Dados pessoais ficam restritos ao provedor de origem. Outros provedores veem apenas indicadores de risco — dias de atraso, faixa de valor, equipamentos — sem acesso a nomes, endereços ou dados identificáveis. Toda comunicação usa criptografia.",
              },
              {
                q: "Quais ERPs são compatíveis?",
                a: "A plataforma integra nativamente com IXC Provedor, SGP e MK Solutions. Quem não usa ERP pode importar via planilha CSV em qualquer formato.",
              },
              {
                q: "Como funciona o anti-fraude?",
                a: "Quando um cliente seu inadimplente é consultado por outro provedor da rede, você recebe um alerta em tempo real via WhatsApp ou e-mail. Isso indica que ele pode estar tentando contratar internet em outro lugar sem quitar a dívida com você.",
              },
              {
                q: "Funciona para provedor pequeno com menos de 200 clientes?",
                a: "Sim, especialmente para pequenos. Para um provedor com 150 clientes, o custo de uma única ONU perdida (R$ 280) representa muito mais proporcionalmente. O plano Gratuito já é suficiente para começar — consultas na sua própria base são sempre gratuitas, sem limite.",
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
            Junte-se à rede colaborativa
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">
            Proteja seu provedor com<br />
            <span className="text-blue-200">dados de toda a rede.</span>
          </h2>
          <p className="text-lg text-blue-100 mb-8 max-w-xl mx-auto">
            Cadastro em 2 minutos. Sem cartão de crédito.
            30 créditos gratuitos para testar a rede colaborativa.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" className="bg-white text-blue-700 hover:bg-blue-50 px-10 gap-2 h-12 text-base font-bold shadow-xl" onClick={goRegister} data-testid="button-cta-bottom">
              Criar Conta Grátis
              <ArrowRight className="w-4 h-4" />
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
