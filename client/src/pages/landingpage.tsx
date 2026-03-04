import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Shield,
  Search,
  BarChart3,
  Users,
  Zap,
  Lock,
  CheckCircle,
  ArrowRight,
  Flame,
  AlertTriangle,
  CreditCard,
  Building2,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Database,
  Bot,
  MapPin,
  Share2,
  Globe,
  Router,
  Play,
  Star,
} from "lucide-react";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const goLogin = () => setLocation("/login");

  return (
    <div className="min-h-screen bg-white overflow-x-hidden" data-testid="landing-page">

      <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
              <Shield className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-lg font-bold text-white tracking-tight">Consulta ISP</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            <button onClick={() => document.getElementById("como-funciona")?.scrollIntoView({ behavior: "smooth" })} className="hover:text-white transition-colors" data-testid="nav-como-funciona">Como funciona</button>
            <button onClick={() => document.getElementById("funcionalidades")?.scrollIntoView({ behavior: "smooth" })} className="hover:text-white transition-colors" data-testid="nav-funcionalidades">Funcionalidades</button>
            <button onClick={() => document.getElementById("planos")?.scrollIntoView({ behavior: "smooth" })} className="hover:text-white transition-colors" data-testid="nav-planos">Planos</button>
            <button onClick={() => document.getElementById("faq")?.scrollIntoView({ behavior: "smooth" })} className="hover:text-white transition-colors" data-testid="nav-faq">FAQ</button>
          </div>
          <div className="flex items-center gap-2.5">
            <Button variant="ghost" className="text-slate-300 hover:text-white text-sm h-9" onClick={goLogin} data-testid="button-landing-login">
              Login
            </Button>
            <Button className="bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 text-white text-sm h-9 gap-1.5 shadow-lg shadow-blue-500/25" onClick={goLogin} data-testid="button-landing-cadastro">
              Criar Conta Gratis
            </Button>
          </div>
        </div>
      </nav>

      <section className="relative bg-slate-950 pt-16 overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-20 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-1/4 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl" />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMC41IiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDMpIi8+PC9zdmc+')] opacity-60" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
                <Database className="w-3.5 h-3.5" />
                Base de dados compartilhada entre provedores
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white leading-[1.1] tracking-tight" data-testid="text-hero-title">
                A base de dados
                <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent"> compartilhada </span>
                que protege seu provedor
              </h1>
              <p className="text-lg text-slate-400 mt-6 leading-relaxed max-w-lg">
                Provedores de internet compartilham dados de inadimplentes de forma anonimizada. Consulte CPF/CNPJ antes de ativar e reduza perdas com calotes e equipamentos nao devolvidos.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 mt-8">
                <Button size="lg" className="bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 text-white px-8 gap-2 h-12 text-base font-bold shadow-xl shadow-blue-500/20" onClick={goLogin} data-testid="button-hero-cta">
                  Criar Conta Gratis
                  <ArrowRight className="w-4 h-4" />
                </Button>
                <Button size="lg" variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white px-8 gap-2 h-12 text-base" onClick={() => document.getElementById("como-funciona")?.scrollIntoView({ behavior: "smooth" })} data-testid="button-hero-features">
                  <Play className="w-4 h-4" />
                  Como funciona
                </Button>
              </div>
              <div className="flex items-center gap-6 mt-10 pt-8 border-t border-slate-800">
                {[
                  { v: "100+", l: "Provedores" },
                  { v: "50K+", l: "Consultas" },
                  { v: "< 2s", l: "Resposta" },
                ].map(s => (
                  <div key={s.l}>
                    <p className="text-2xl font-black text-white">{s.v}</p>
                    <p className="text-xs text-slate-500">{s.l}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative hidden lg:block">
              <div className="relative bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur shadow-2xl">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-2 text-xs text-slate-500">Consulta ISP — Base Compartilhada</span>
                </div>
                <div className="space-y-3">
                  <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-blue-400" />
                        <span className="text-sm text-slate-300">CPF: 987.654.321-00</span>
                      </div>
                      <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-semibold">CRITICO</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span>2 provedores</span>
                      <span>Score: 15/100</span>
                      <span className="text-red-400">R$ 609,50 em aberto</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                      <p className="text-[10px] text-blue-400 font-semibold uppercase">Seu Provedor</p>
                      <p className="text-sm text-white font-bold mt-1">Joao P. Lima</p>
                      <p className="text-xs text-slate-500 mt-0.5">98 dias atraso</p>
                      <span className="inline-block mt-2 text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-semibold">Gratuita</span>
                    </div>
                    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3">
                      <p className="text-[10px] text-slate-500 font-semibold uppercase">Outro Provedor</p>
                      <p className="text-sm text-white font-bold mt-1">Dados restritos</p>
                      <p className="text-xs text-slate-500 mt-0.5">122 dias atraso</p>
                      <span className="inline-block mt-2 text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-semibold">1 Credito</span>
                    </div>
                  </div>
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-3">
                    <div className="bg-red-500 text-white px-3 py-1.5 rounded-lg text-center min-w-[5rem]">
                      <p className="text-[9px] font-semibold opacity-80 uppercase">Sugestao</p>
                      <p className="text-base font-black">REJEITAR</p>
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-red-300 font-semibold">Equipamentos pendentes</p>
                      <p className="text-xs text-slate-500">3 equip. nao devolvidos — R$ 810,00</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-2xl flex items-center justify-center shadow-xl opacity-80">
                <Shield className="w-10 h-10 text-white" />
              </div>
            </div>
          </div>
        </div>

        <div className="relative bg-gradient-to-r from-blue-600 to-cyan-500 py-1" />
      </section>

      <section className="py-16 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 text-blue-600 text-xs font-bold uppercase tracking-widest mb-3">
              <Share2 className="w-4 h-4" />
              Poder da rede colaborativa
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">
              Base de dados compartilhada
            </h2>
            <p className="text-slate-500 mt-3 max-w-2xl mx-auto">
              Cada provedor contribui com dados de inadimplentes. A rede cresce e protege todos.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Database,
                title: "Dados unificados",
                desc: "Informacoes de inadimplencia de centenas de provedores consolidadas em uma unica base. Consulte e saiba se o CPF tem historico em qualquer provedor da rede.",
                accent: "from-blue-500 to-blue-600",
                bg: "bg-blue-50",
              },
              {
                icon: Lock,
                title: "Anonimizado e seguro",
                desc: "Dados pessoais ficam restritos ao provedor de origem. Outros provedores veem apenas status de inadimplencia, faixa de valor e dias de atraso — nunca dados identificaveis.",
                accent: "from-emerald-500 to-emerald-600",
                bg: "bg-emerald-50",
              },
              {
                icon: Users,
                title: "Efeito de rede",
                desc: "Quanto mais provedores participam, mais completa e precisa fica a base. Cada novo membro aumenta a protecao de todos contra inadimplentes recorrentes.",
                accent: "from-purple-500 to-purple-600",
                bg: "bg-purple-50",
              },
            ].map((item, i) => (
              <div key={i} className={`${item.bg} rounded-2xl p-6 border border-slate-200 hover:shadow-lg transition-all group`} data-testid={`shared-db-${i}`}>
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${item.accent} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                  <item.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{item.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-center">
              <div className="lg:col-span-2">
                <h3 className="text-xl font-bold text-slate-900 mb-2">Como a base compartilhada funciona</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Quando um provedor importa seus inadimplentes, esses dados ficam disponiveis de forma anonimizada para consulta por qualquer outro provedor da rede. Se voce consulta um CPF e ele existe na base de outro provedor, voce recebe os indicadores de risco sem ver dados pessoais.
                </p>
              </div>
              <div className="lg:col-span-3 flex items-center justify-center gap-3 flex-wrap">
                {[
                  { label: "Provedor A", sub: "importa inadimplentes", color: "bg-blue-500" },
                  { label: "Base compartilhada", sub: "dados anonimizados", color: "bg-gradient-to-r from-blue-500 to-cyan-400" },
                  { label: "Provedor B", sub: "consulta CPF", color: "bg-emerald-500" },
                ].map((step, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="text-center">
                      <div className={`${step.color} text-white px-4 py-2.5 rounded-xl shadow-lg`}>
                        <p className="text-sm font-bold">{step.label}</p>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1.5">{step.sub}</p>
                    </div>
                    {i < 2 && <ArrowRight className="w-5 h-5 text-slate-300 flex-shrink-0" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="como-funciona" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">Como funciona</h2>
            <p className="text-slate-500 mt-3">3 passos para proteger seu provedor</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 md:gap-0">
            {[
              { n: "1", title: "Cadastre e importe", desc: "Crie sua conta gratuitamente, conecte seu ERP (IXC, SGP, MK Solutions) e importe sua base de inadimplentes automaticamente.", icon: Building2, color: "bg-blue-600" },
              { n: "2", title: "Consulte o CPF/CNPJ", desc: "Antes de ativar um novo cliente, consulte na base compartilhada. Receba score, alertas de fraude e sugestao de decisao em segundos.", icon: Search, color: "bg-cyan-600" },
              { n: "3", title: "Reduza perdas", desc: "Tome decisoes baseadas em dados reais de toda a rede. Reduza inadimplencia, recupere equipamentos e proteja sua receita.", icon: TrendingUp, color: "bg-emerald-600" },
            ].map((step, i) => (
              <div key={i} className="relative text-center px-8 py-10 group" data-testid={`step-${step.n}`}>
                {i < 2 && <div className="hidden md:block absolute top-1/3 right-0 w-full h-0.5 bg-gradient-to-r from-transparent via-slate-200 to-transparent translate-x-1/2 z-0" />}
                <div className="relative z-10">
                  <div className={`w-16 h-16 ${step.color} rounded-2xl flex items-center justify-center mx-auto shadow-xl group-hover:scale-110 transition-transform`}>
                    <step.icon className="w-7 h-7 text-white" />
                  </div>
                  <div className="w-8 h-8 bg-white border-2 border-slate-200 rounded-full flex items-center justify-center mx-auto -mt-3 relative z-20 shadow-sm">
                    <span className="text-xs font-black text-slate-900">{step.n}</span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mt-4 mb-2">{step.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed max-w-xs mx-auto">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="funcionalidades" className="py-20 bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black text-white">Funcionalidades completas</h2>
            <p className="text-slate-400 mt-3 max-w-xl mx-auto">Tudo que seu provedor precisa em uma unica plataforma</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Search, title: "Consulta ISP", desc: "Consulte CPF/CNPJ na base compartilhada de provedores. Historico de pagamentos, equipamentos e restricoes.", gradient: "from-blue-500 to-blue-600" },
              { icon: BarChart3, title: "Score de Credito", desc: "Score de 0 a 100 baseado em atrasos, valores, equipamentos e historico em multiplos provedores.", gradient: "from-emerald-500 to-emerald-600" },
              { icon: Shield, title: "Anti-Fraude", desc: "Alertas em tempo real quando seus inadimplentes sao consultados por outros provedores.", gradient: "from-red-500 to-rose-600" },
              { icon: Flame, title: "Mapa de Calor", desc: "Visualizacao geografica das areas com maior concentracao de inadimplencia na sua regiao.", gradient: "from-orange-500 to-amber-500" },
              { icon: Bot, title: "Analise com IA", desc: "Inteligencia artificial gera recomendacoes personalizadas para cada consulta realizada.", gradient: "from-indigo-500 to-violet-500" },
              { icon: CreditCard, title: "Consulta SPC", desc: "Dados do SPC Brasil direto na plataforma. Score, restricoes financeiras e protestos.", gradient: "from-teal-500 to-cyan-500" },
              { icon: Globe, title: "Integracao com ERP", desc: "Conecte IXC, SGP ou MK Solutions e mantenha a base atualizada automaticamente.", gradient: "from-cyan-500 to-blue-500" },
              { icon: Router, title: "Controle de Equipamentos", desc: "Rastreie equipamentos nao devolvidos com valor, modelo e status de recuperacao.", gradient: "from-amber-500 to-orange-500" },
              { icon: TrendingUp, title: "Relatorios e Dashboards", desc: "Indicadores de inadimplencia, volume de consultas, creditos e distribuicao de risco.", gradient: "from-purple-500 to-pink-500" },
            ].map((f, i) => (
              <div key={i} className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 hover:border-slate-700 hover:bg-slate-900/80 transition-all group" data-testid={`feature-${i}`}>
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform`}>
                  <f.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-base font-bold text-white mb-1.5">{f.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="planos" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">Planos simples e transparentes</h2>
            <p className="text-slate-500 mt-3">Comece gratis. Escale conforme seu provedor cresce.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              {
                name: "Gratis",
                price: "R$ 0",
                period: "/mes",
                desc: "Para provedores iniciando",
                cta: "Comecar Gratis",
                popular: false,
                features: [
                  "Consultas do proprio provedor gratuitas",
                  "Score de credito basico",
                  "Base de dados compartilhada",
                  "1 usuario",
                  "10 creditos/mes para consultas externas",
                ],
              },
              {
                name: "Profissional",
                price: "R$ 99",
                period: "/mes",
                desc: "Para provedores em crescimento",
                cta: "Comecar Agora",
                popular: true,
                features: [
                  "Tudo do plano Gratis",
                  "Consultas ilimitadas na base compartilhada",
                  "Anti-fraude com alertas em tempo real",
                  "Mapa de calor geografico",
                  "Analise com IA",
                  "Integracao com ERP",
                  "5 usuarios",
                  "100 creditos SPC/mes",
                ],
              },
              {
                name: "Enterprise",
                price: "Sob consulta",
                period: "",
                desc: "Para grandes operacoes",
                cta: "Falar com Vendas",
                popular: false,
                features: [
                  "Tudo do plano Profissional",
                  "Usuarios ilimitados",
                  "API dedicada",
                  "SLA garantido",
                  "Suporte prioritario",
                  "Creditos SPC ilimitados",
                  "Relatorios personalizados",
                  "Onboarding dedicado",
                ],
              },
            ].map((plan, i) => (
              <div key={i} className={`relative rounded-2xl border-2 p-6 ${plan.popular ? "border-blue-500 bg-blue-50/50 shadow-xl shadow-blue-500/10" : "border-slate-200 bg-white"}`} data-testid={`plan-${i}`}>
                {plan.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-gradient-to-r from-blue-500 to-cyan-400 text-white text-xs font-bold px-4 py-1 rounded-full shadow-lg flex items-center gap-1">
                      <Star className="w-3 h-3" /> Mais popular
                    </span>
                  </div>
                )}
                <div className="text-center mb-6 pt-2">
                  <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{plan.desc}</p>
                  <div className="mt-4">
                    <span className="text-4xl font-black text-slate-900">{plan.price}</span>
                    <span className="text-sm text-slate-500">{plan.period}</span>
                  </div>
                </div>
                <ul className="space-y-2.5 mb-6">
                  {plan.features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-slate-700">
                      <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className={`w-full h-11 font-bold ${plan.popular ? "bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 text-white shadow-lg" : "bg-slate-900 hover:bg-slate-800 text-white"}`}
                  onClick={goLogin}
                  data-testid={`button-plan-${i}`}
                >
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-black text-slate-900">Por que provedores escolhem a Consulta ISP</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: Database, stat: "Base unica", desc: "Dados de inadimplencia de toda a rede de provedores em um so lugar" },
              { icon: Zap, stat: "< 2 segundos", desc: "Resultado completo com score, alertas e sugestao de decisao" },
              { icon: Lock, stat: "100% seguro", desc: "Dados anonimizados e criptografados seguindo melhores praticas" },
              { icon: AlertTriangle, stat: "Anti-fraude", desc: "Alertas automaticos quando seus inadimplentes tentam contratar em outro provedor" },
            ].map((item, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 text-center hover:shadow-md transition-shadow" data-testid={`why-${i}`}>
                <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-3">
                  <item.icon className="w-6 h-6 text-blue-600" />
                </div>
                <p className="text-lg font-black text-slate-900 mb-1">{item.stat}</p>
                <p className="text-sm text-slate-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="py-20 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-black text-slate-900">Perguntas frequentes</h2>
          </div>
          <div className="space-y-0 divide-y divide-slate-200 border border-slate-200 rounded-2xl overflow-hidden bg-white" data-testid="faq-section">
            {[
              { q: "O que e a base de dados compartilhada?", a: "E uma base unica onde todos os provedores registram seus inadimplentes. Quando voce consulta um CPF, o sistema verifica se ele aparece na base de qualquer provedor da rede, retornando informacoes anonimizadas como dias de atraso, faixa de valor e equipamentos pendentes." },
              { q: "Quanto custa utilizar a plataforma?", a: "O cadastro e gratuito. Consultas de clientes do proprio provedor sao sempre gratuitas. Para ver dados de outros provedores na base compartilhada, o custo e de 1 credito por consulta. Creditos podem ser adquiridos em pacotes acessiveis." },
              { q: "Meus dados estao seguros?", a: "Sim. Dados pessoais ficam restritos ao provedor de origem. Outros provedores veem apenas indicadores de risco (dias de atraso, faixa de valor, equipamentos) sem acesso a nomes, enderecos ou dados identificaveis. Toda comunicacao usa criptografia." },
              { q: "Quais ERPs sao compativeis?", a: "A plataforma integra nativamente com IXC Provedor, SGP (Sistema Gerencial Provedor) e MK Solutions. A importacao da base de inadimplentes e feita de forma automatica via API/webhook." },
              { q: "Como funciona o sistema anti-fraude?", a: "Quando um cliente seu que esta inadimplente e consultado por outro provedor, voce recebe um alerta em tempo real. Isso indica que ele pode estar tentando contratar servico em outro local sem quitar a divida com voce." },
              { q: "O score de credito e confiavel?", a: "O score e calculado com dados reais de pagamento de toda a rede. Quanto mais provedores participam, mais preciso fica. A analise com IA complementa com recomendacoes contextuais para cada situacao." },
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

      <section className="py-20 bg-slate-950 relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/3 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/3 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">
            Proteja seu provedor com a base compartilhada
          </h2>
          <p className="text-lg text-slate-400 mb-8 max-w-2xl mx-auto">
            Junte-se a rede de provedores que ja reduzem perdas com inadimplencia usando dados colaborativos e inteligencia artificial.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" className="bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 text-white px-10 gap-2 h-13 text-base font-bold shadow-xl shadow-blue-500/25" onClick={goLogin} data-testid="button-cta-bottom">
              Criar Conta Gratis
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button size="lg" variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white px-8 gap-2 h-13 text-base" onClick={goLogin} data-testid="button-login-bottom">
              Ja tenho conta — Login
            </Button>
          </div>
        </div>
      </section>

      <footer className="bg-slate-950 border-t border-slate-800 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <span className="text-white font-bold">Consulta ISP</span>
              <span className="text-slate-600 text-sm hidden sm:inline">Base de dados compartilhada para provedores</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Dados criptografados</span>
              <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> Privacidade garantida</span>
            </div>
          </div>
          <div className="border-t border-slate-800 mt-6 pt-6 text-center">
            <p className="text-xs text-slate-600">
              Consulta ISP — Plataforma colaborativa de analise de credito para provedores de internet do Brasil
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
