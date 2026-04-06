import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import LandingChatbot from "@/components/landing-chatbot";
import {
  Shield, Search, Bell, Database, CheckCircle2,
  ArrowRight, AlertTriangle, CreditCard, Lock,
  Zap, Globe, Router, TrendingDown,
  ChevronDown, ChevronUp, MapPin, Star
} from "lucide-react";

type ErpItem = { key: string; name: string; logoBase64: string | null };

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const fallbackErps: ErpItem[] = [
    { key: "ixc", name: "IXC Soft", logoBase64: null },
    { key: "sgp", name: "SGP", logoBase64: null },
    { key: "mk", name: "MK Solutions", logoBase64: null },
    { key: "hubsoft", name: "Hubsoft", logoBase64: null },
    { key: "voalle", name: "Voalle", logoBase64: null },
    { key: "rbx", name: "RBX ISP", logoBase64: null },
  ];
  const [erps, setErps] = useState<ErpItem[]>(fallbackErps);

  useEffect(() => {
    fetch("/api/public/erp-catalog")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data) && data.length > 0) setErps(data); })
      .catch(() => {});
  }, []);

  const goRegister = () => setLocation("/login?mode=register");
  const goLogin = () => setLocation("/login");

  return (
    <div className="min-h-screen bg-white overflow-x-hidden" data-testid="landing-page">

      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-base font-bold text-slate-900">Consulta ISP</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm text-slate-500">
            {[["Como funciona","como-funciona"],["Funcionalidades","funcionalidades"],["Preços","precos"],["FAQ","faq"]].map(([l,id]) => (
              <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({behavior:"smooth"})}
                className="hover:text-blue-600 transition-colors font-medium">{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="text-slate-600 hover:text-slate-900 text-sm h-9"
              onClick={goLogin} data-testid="button-landing-login">Login</Button>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white text-sm h-9 px-5 font-semibold rounded-lg"
              onClick={goRegister} data-testid="button-landing-cadastro">Começar grátis</Button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-16 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-16 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
              <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse" />
              Rede colaborativa de inadimplentes entre provedores
            </div>
            <h1 className="text-5xl font-black text-slate-900 leading-[1.05] tracking-tight mb-5" data-testid="text-hero-title">
              Consulte o CPF<br/>
              <span className="text-blue-600">antes de instalar.</span><br/>
              <span className="text-slate-400 text-3xl font-semibold">Evite o calote antes que aconteça.</span>
            </h1>
            <p className="text-lg text-slate-500 leading-relaxed mb-8 max-w-lg">
              Base colaborativa de inadimplentes entre provedores de internet.
              Score de crédito, histórico em toda a rede, alertas de migração e
              análise por endereço — tudo em uma plataforma.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-10">
              <Button size="lg" onClick={goRegister} data-testid="button-hero-cta"
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 gap-2 h-12 text-base font-bold rounded-xl">
                Criar conta grátis <ArrowRight className="w-4 h-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => document.getElementById("como-funciona")?.scrollIntoView({behavior:"smooth"})}
                className="border-slate-300 text-slate-600 px-8 h-12 text-base rounded-xl" data-testid="button-hero-features">
                Ver como funciona
              </Button>
            </div>
            <div className="flex items-center gap-6 pt-6 border-t border-slate-100">
              {[{v:"R$ 690",l:"prejuízo médio/inadimplente"},{v:"< 2s",l:"resultado da consulta"},{v:"Grátis",l:"consultas na sua base"}].map(s => (
                <div key={s.l}><p className="text-xl font-black text-slate-900">{s.v}</p><p className="text-xs text-slate-400 mt-0.5">{s.l}</p></div>
              ))}
            </div>
          </div>

          {/* Mockup hero */}
          <div className="relative hidden lg:block">
            <div className="bg-slate-100 rounded-2xl p-2 border border-slate-200">
              <div className="bg-slate-800 rounded-xl overflow-hidden">
                <div className="flex items-center gap-1.5 px-4 py-3 bg-slate-700">
                  <div className="w-3 h-3 rounded-full bg-red-400"/>
                  <div className="w-3 h-3 rounded-full bg-yellow-400"/>
                  <div className="w-3 h-3 rounded-full bg-green-400"/>
                  <div className="flex-1 bg-slate-600 rounded-md mx-3 px-3 py-1 text-xs text-slate-400">
                    consultaisp.com.br/consulta-isp
                  </div>
                </div>
                <div className="bg-white p-5">
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Search className="w-4 h-4 text-blue-600"/>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">CPF consultado</p>
                        <p className="text-sm font-bold text-slate-900">041.179.***-40</p>
                      </div>
                    </div>
                    <span className="text-xs bg-red-100 text-red-700 font-bold px-2.5 py-1 rounded-full">CRÍTICO</span>
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="relative w-14 h-14 flex-shrink-0">
                      <svg width="56" height="56" className="-rotate-90">
                        <circle cx="28" cy="28" r="22" fill="none" stroke="#FEE2E2" strokeWidth="5"/>
                        <circle cx="28" cy="28" r="22" fill="none" stroke="#DC2626" strokeWidth="5"
                          strokeDasharray="138" strokeDashoffset="117" strokeLinecap="round"/>
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-black text-red-600">15</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Score ISP / 100</p>
                      <div className="flex gap-2">
                        <span className="text-xs bg-red-100 text-red-700 font-semibold px-2 py-0.5 rounded">2 provedores</span>
                        <span className="text-xs bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded">2 equip. retidos</span>
                      </div>
                    </div>
                    <div className="ml-auto bg-red-600 text-white px-3 py-2 rounded-lg text-center">
                      <p className="text-[9px] opacity-80 uppercase font-semibold">Sugestão</p>
                      <p className="text-sm font-black">REJEITAR</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <p className="text-[9px] text-green-700 font-bold uppercase mb-1">Seu Provedor</p>
                      <p className="text-xs font-bold text-slate-800">VALDIRENE ***</p>
                      <p className="text-[10px] text-red-500 mt-1">325 dias · R$ 350</p>
                      <span className="text-[9px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded mt-1 inline-block">Grátis</span>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Outro Provedor</p>
                      <p className="text-xs font-bold text-slate-800">Dados restritos</p>
                      <p className="text-[10px] text-red-500 mt-1">1441 dias · R$400–600</p>
                      <span className="text-[9px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded mt-1 inline-block">1 crédito</span>
                    </div>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3 text-amber-600 flex-shrink-0"/>
                    <p className="text-[10px] text-amber-700 font-medium">2 equipamentos não devolvidos — R$ 580 em risco</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-3 -left-3 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-lg">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"/>
                <span className="text-xs font-semibold text-slate-700">Resultado em 1.8s</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BARRA ERPs */}
      <section className="bg-slate-50 border-y border-slate-200 py-4">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center gap-6 justify-between">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest whitespace-nowrap">Integra com</p>
          <div className="flex items-center gap-6 flex-wrap justify-center">
            {erps.map(erp => (
              <div key={erp.key} className="flex items-center gap-2 opacity-50 hover:opacity-100 transition-opacity">
                {erp.logoBase64 ? (
                  <img src={erp.logoBase64} alt={erp.name} className="h-6 object-contain"/>
                ) : (
                  <span className="text-slate-700 text-sm font-bold">{erp.name}</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 whitespace-nowrap">Ou via <span className="text-slate-600 font-medium">planilha CSV</span></p>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section id="como-funciona" className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-3">Simples assim</p>
            <h2 className="text-4xl font-black text-slate-900">3 passos. Resultado em 2 segundos.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {n:"01",icon:Database,title:"Configure em 15 min",desc:"Conecte seu ERP (IXC, SGP, MK Solutions) ou importe via planilha CSV. Sem instalação, sem técnico.",badge:"Setup: 15 min"},
              {n:"02",icon:Search,title:"Consulte antes de ativar",desc:"CPF, CNPJ ou endereço. Em menos de 2 segundos: score de risco, histórico na rede, equipamentos retidos e sugestão de decisão.",badge:"< 2 segundos"},
              {n:"03",icon:Bell,title:"Receba alertas anti-fraude",desc:"Quando seu cliente inadimplente é consultado por outro provedor para migrar, você recebe alerta imediato no WhatsApp.",badge:"Tempo real"},
            ].map((s,i) => (
              <div key={i} className="relative bg-white border border-slate-200 rounded-2xl p-6 hover:border-blue-300 hover:shadow-md transition-all">
                <span className="text-6xl font-black text-slate-100 absolute top-4 right-5 leading-none select-none">{s.n}</span>
                <div className="relative">
                  <div className="w-12 h-12 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-center mb-4">
                    <s.icon className="w-5 h-5 text-blue-600"/>
                  </div>
                  <span className="inline-block bg-blue-50 text-blue-700 text-xs font-bold px-3 py-1 rounded-full mb-3 border border-blue-100">{s.badge}</span>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">{s.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DORES */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-bold text-red-500 uppercase tracking-widest mb-3">As dores que custam mais caro</p>
            <h2 className="text-4xl font-black text-slate-900">Você reconhece alguma dessas situações?</h2>
            <p className="text-slate-500 mt-3 max-w-xl mx-auto">Cada uma tem solução dentro do Consulta ISP.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon:Search, color:"red", num:"10–30%",
                title:"\"Instalo sem saber o histórico do CPF\"",
                desc:"O cliente veio educado, assinou contrato, recebeu a ONU. Semanas depois: 3 faturas em aberto e sem sinal de vida. Ele já devia para dois provedores antes de você.",
                solution:"Consulta ISP — score de risco + histórico em toda a rede em 2 segundos.",
              },
              {
                icon:Bell, color:"orange", num:"75 dias",
                title:"\"Não sei quando meu inadimplente tenta migrar\"",
                desc:"A Resolução Anatel 765 obriga você a notificar em D+15 e aguardar até D+60. O cliente sabe disso — e usa esses 75 dias para contratar outro provedor sem pagar.",
                solution:"Anti-Fraude — alerta via WhatsApp em menos de 5 segundos quando o CPF é consultado.",
              },
              {
                icon:Router, color:"amber", num:"R$ 290",
                title:"\"ONU foi embora sem registro nem cobrança\"",
                desc:"Cancelou o contrato, ninguém foi buscar o equipamento. Técnico estava em instalação nova. Meses depois: cliente mudou, ONU perdida, R$ 280 no lixo.",
                solution:"Controle de equipamentos — registre via planilha, rastreie com modelo, serial e status.",
              },
              {
                icon:MapPin, color:"purple", num:"70%",
                title:"\"CPF limpo não é sinônimo de bom pagador\"",
                desc:"O inadimplente reincidente usa o CPF de um familiar ou apresenta um 'limpo'. Mas o endereço não mente — o imóvel acumula histórico de calotes invisíveis ao Serasa.",
                solution:"Consulta por endereço — cruza CEP + número em toda a rede, independente do CPF.",
              },
              {
                icon:CreditCard, color:"blue", num:"Burocracia",
                title:"\"Não consigo negativar no SPC/Serasa\"",
                desc:"Exige contrato direto, CNPJ com histórico, volume mínimo. Para ISP pequeno é caro e burocrático. O inadimplente circula limpo e contrata em outro lugar.",
                solution:"Consulta SPC integrada — acesse a negativação direto na plataforma, sem contrato adicional.",
              },
              {
                icon:TrendingDown, color:"red", num:"45 dias",
                title:"\"Bloqueio tarde: 45 dias de receita perdida\"",
                desc:"A equipe estava ocupada com chamados técnicos. Quando alguém bloqueou, já haviam passado quase 2 meses — e o cliente já estava procurando outro provedor.",
                solution:"Integração com ERP + alerta automático — base atualizada e risco identificado antes da ativação.",
              },
            ].map((d, i) => {
              const colors: Record<string,string> = {
                red:"border-red-200 bg-red-50",
                orange:"border-orange-200 bg-orange-50",
                amber:"border-amber-200 bg-amber-50",
                purple:"border-purple-200 bg-purple-50",
                blue:"border-blue-200 bg-blue-50",
              };
              const textColors: Record<string,string> = {
                red:"text-red-600", orange:"text-orange-600",
                amber:"text-amber-600", purple:"text-purple-600", blue:"text-blue-600",
              };
              return (
                <div key={i} className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colors[d.color]}`}>
                      <d.icon className={`w-5 h-5 ${textColors[d.color]}`}/>
                    </div>
                    <span className={`text-sm font-black ${textColors[d.color]}`}>{d.num}</span>
                  </div>
                  <h3 className={`text-sm font-bold mb-2 ${textColors[d.color]}`}>{d.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed flex-1 mb-4">{d.desc}</p>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Como resolvemos</p>
                    <p className="text-xs text-slate-700 font-medium">{d.solution}</p>
                  </div>
                  <Button onClick={goRegister} size="sm"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs h-9">
                    Resolver este problema →
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FUNCIONALIDADES */}
      <section id="funcionalidades" className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-3">O sistema em ação</p>
            <h2 className="text-4xl font-black text-slate-900">Interface pensada para o dia a dia do provedor</h2>
            <p className="text-slate-500 mt-3">Resultado claro, decisão rápida. Sem treinamento necessário.</p>
          </div>

          {/* Bloco 1: Consulta ISP */}
          <div className="grid lg:grid-cols-2 gap-12 items-center mb-20">
            <div className="bg-slate-100 rounded-2xl p-2 border border-slate-200">
              <div className="bg-slate-800 rounded-xl overflow-hidden">
                <div className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-700">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400"/>
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-400"/>
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400"/>
                  <span className="ml-2 text-xs text-slate-400">Consulta ISP — Resultado detalhado</span>
                </div>
                <div className="bg-white p-4">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                    <div>
                      <p className="text-xs text-slate-400">CPF consultado</p>
                      <p className="text-sm font-bold">987.654.321-00</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">ALTO RISCO</span>
                      <p className="text-xs text-slate-400 mt-1">Consultado há 2min</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs text-slate-500">Score de crédito</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div className="bg-red-500 h-full rounded-full" style={{width:"15%"}}/>
                    </div>
                    <span className="text-sm font-black text-red-600">15 / 100</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-2.5">
                      <p className="text-[9px] text-green-600 font-bold uppercase">Seu Provedor</p>
                      <p className="text-xs font-bold mt-1">João Pereira Lima</p>
                      <p className="text-[10px] text-slate-500">Rua das Flores, 142</p>
                      <div className="flex justify-between mt-2">
                        <span className="text-[10px] text-red-500 font-semibold">98 dias</span>
                        <span className="text-[10px] bg-green-100 text-green-700 font-bold px-1.5 rounded">Grátis</span>
                      </div>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                      <p className="text-[9px] text-slate-400 font-bold uppercase">Outro Provedor</p>
                      <p className="text-xs font-bold mt-1">João P. L•••</p>
                      <p className="text-[10px] text-slate-500">São Paulo - SP</p>
                      <div className="flex justify-between mt-2">
                        <span className="text-[10px] text-red-500 font-semibold">122 dias</span>
                        <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-1.5 rounded">1 crédito</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-red-600 text-white rounded-lg p-2.5 flex items-center gap-3">
                    <div className="text-center px-2 border-r border-red-500">
                      <p className="text-[8px] opacity-80 uppercase font-semibold">Sugestão IA</p>
                      <p className="text-sm font-black">REJEITAR</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold">3 equipamentos não devolvidos</p>
                      <p className="text-[10px] opacity-80">Valor em risco: R$ 810,00</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 text-xs font-bold px-3 py-1.5 rounded-full mb-5 border border-blue-100">
                <Search className="w-3.5 h-3.5"/>Consulta ISP
              </div>
              <h3 className="text-3xl font-black text-slate-900 mb-4">Score em 2 segundos.<br/><span className="text-slate-400">Decisão em 1 clique.</span></h3>
              <p className="text-slate-500 leading-relaxed mb-6">Consulte CPF, CNPJ ou endereço e receba score de 0 a 100, histórico em toda a rede colaborativa, equipamentos retidos e sugestão automática de APROVAR ou REJEITAR.</p>
              <ul className="space-y-3 mb-8">
                {["Histórico em todos os provedores da rede","Score calculado com IA","Equipamentos retidos por provedor","Busca por endereço — detecta CPF diferente no mesmo imóvel"].map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-slate-700">
                    <CheckCircle2 className="w-4 h-4 text-blue-500 flex-shrink-0"/>{f}
                  </li>
                ))}
              </ul>
              <Button onClick={goRegister} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 h-10 rounded-lg">
                Testar grátis →
              </Button>
            </div>
          </div>

          {/* Bloco 2: Anti-Fraude */}
          <div className="grid lg:grid-cols-2 gap-12 items-center mb-20">
            <div className="order-2 lg:order-1">
              <div className="inline-flex items-center gap-2 bg-red-50 text-red-700 text-xs font-bold px-3 py-1.5 rounded-full mb-5 border border-red-100">
                <Bell className="w-3.5 h-3.5"/>Anti-Fraude em Tempo Real
              </div>
              <h3 className="text-3xl font-black text-slate-900 mb-4">Seu inadimplente tentou migrar.<br/><span className="text-slate-400">Você fica sabendo agora.</span></h3>
              <p className="text-slate-500 leading-relaxed mb-6">A Resolução Anatel 765 dá 75 dias ao cliente antes de você poder cancelar. Ele sabe disso — e usa esse tempo para migrar sem pagar. Com o anti-fraude, você recebe o alerta enquanto ele ainda está tentando.</p>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
                <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-1">Resolução Anatel 765</p>
                <p className="text-sm text-amber-800">75 dias antes do cancelamento. O cliente usa cada um deles.</p>
              </div>
              <ul className="space-y-3 mb-8">
                {["Alerta em tempo real via WhatsApp e email","Identifica migradores seriais (2+ provedores)","Trajetória completa do cliente inadimplente","Configure regras por valor mínimo ou dias de atraso"].map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-slate-700">
                    <CheckCircle2 className="w-4 h-4 text-red-500 flex-shrink-0"/>{f}
                  </li>
                ))}
              </ul>
              <Button onClick={goRegister} className="bg-red-600 hover:bg-red-700 text-white font-bold px-6 h-10 rounded-lg">
                Ativar anti-fraude →
              </Button>
            </div>
            {/* Print Anti-Fraude */}
            <div className="order-1 lg:order-2 bg-slate-100 rounded-2xl p-2 border border-slate-200">
              <div className="bg-slate-800 rounded-xl overflow-hidden">
                <div className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-700">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400 animate-pulse"/>
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-400"/>
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400"/>
                  <span className="ml-2 text-xs text-slate-400">Anti-Fraude — Alertas</span>
                </div>
                <div className="bg-white p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Alertas recentes</p>
                    <span className="text-xs bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">3 ativos</span>
                  </div>
                  {[
                    {name:"VALDIRENE ***",desc:"CPF consultado por ViaFibra Net",dias:"325 dias",valor:"R$ 350",dot:"red"},
                    {name:"Carlos Eduardo M.",desc:"Tentativa de novo contrato detectada",dias:"95 dias",valor:"R$ 749",dot:"orange"},
                    {name:"Jose Santos",desc:"Migrador serial — 3 provedores",dias:"130 dias",valor:"R$ 1.200",dot:"red"},
                  ].map((a,i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${a.dot==="red"?"bg-red-500":"bg-orange-500"}`}/>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-900">{a.name}</p>
                        <p className="text-[10px] text-slate-500">{a.desc}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[10px] text-red-500 font-semibold">{a.dias}</p>
                        <p className="text-[10px] text-slate-500">{a.valor}</p>
                      </div>
                    </div>
                  ))}
                  <div className="mt-3 bg-slate-50 rounded-xl p-3">
                    <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wide mb-2">Trajetória do migrador</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {["SGP Telecom","NetFibra","ViaFibra ←"].map((p,i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${i===2?"bg-red-100 text-red-700":"bg-slate-200 text-slate-600"}`}>{p}</span>
                          {i<2&&<span className="text-slate-300 text-xs">→</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Grid features secundárias */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-10 border-t border-slate-100">
            {[
              {icon:Database,title:"Rede Colaborativa",desc:"Dados de inadimplência de provedores em toda a rede. Quanto mais participam, mais preciso fica.",color:"bg-blue-50",ic:"text-blue-600"},
              {icon:MapPin,title:"Análise por Endereço",desc:"Cruza CEP + número em toda a rede. Detecta inadimplente mesmo com CPF diferente no mesmo imóvel.",color:"bg-purple-50",ic:"text-purple-600"},
              {icon:CreditCard,title:"Consulta SPC Brasil",desc:"Score SPC, restrições financeiras e protestos integrados. Negativação sem contrato adicional.",color:"bg-green-50",ic:"text-green-600"},
              {icon:Zap,title:"Análise com IA",desc:"Recomendações automáticas: APROVAR, APROVAR COM RESSALVAS, RECUSAR ou REJEITAR.",color:"bg-amber-50",ic:"text-amber-600"},
            ].map((f,i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all">
                <div className={`w-10 h-10 ${f.color} rounded-lg flex items-center justify-center mb-4`}>
                  <f.icon className={`w-5 h-5 ${f.ic}`}/>
                </div>
                <h4 className="text-sm font-bold text-slate-900 mb-2">{f.title}</h4>
                <p className="text-xs text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DIFERENCIAIS vs MERCADO */}
      <section className="py-16 bg-slate-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-10">
            <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-3">Por que o Consulta ISP</p>
            <h2 className="text-3xl font-black text-slate-900">Tudo que o mercado oferece. Em uma plataforma.</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="p-4 text-left text-sm font-semibold text-slate-700 w-1/3">Funcionalidade</th>
                  <th className="p-4 text-center text-sm font-bold text-blue-600 bg-blue-50">Consulta ISP</th>
                  <th className="p-4 text-center text-sm font-semibold text-slate-500">SPC/Serasa</th>
                  <th className="p-4 text-center text-sm font-semibold text-slate-500">TeiaH Valid</th>
                  <th className="p-4 text-center text-sm font-semibold text-slate-500">ISP Score</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Consulta de CPF na rede ISP","✅","❌","❌","✅"],
                  ["Análise de risco por endereço","✅","❌","✅","❌"],
                  ["Anti-fraude — alerta de migração","✅","❌","❌","✅"],
                  ["Controle de equipamentos em comodato","✅","❌","❌","❌"],
                  ["Consulta SPC/Serasa integrada","✅","✅","❌","❌"],
                  ["Importação via planilha CSV","✅","❌","❌","✅"],
                  ["Integração ERP (IXC, SGP, MK)","✅","❌","✅","✅"],
                  ["Plano gratuito disponível","✅","❌","❌","✅"],
                ].map((row,i) => (
                  <tr key={i} className={i%2===0?"bg-white":"bg-slate-50/50"}>
                    <td className="p-4 text-sm text-slate-700 font-medium border-b border-slate-100">{row[0]}</td>
                    <td className="p-4 text-center bg-blue-50/50 border-b border-slate-100">
                      <span className={`text-sm font-bold ${row[1]==="✅"?"text-green-600":"text-slate-300"}`}>{row[1]}</span>
                    </td>
                    {[row[2],row[3],row[4]].map((v,j) => (
                      <td key={j} className="p-4 text-center border-b border-slate-100">
                        <span className={`text-sm ${v==="✅"?"text-green-600":"text-slate-300"}`}>{v}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* PREÇOS */}
      <section id="precos" className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-3">Transparência total</p>
            <h2 className="text-4xl font-black text-slate-900 mb-3">Planos para todo tamanho de provedor</h2>
            <p className="text-slate-500 max-w-lg mx-auto text-sm">Consultas na sua própria base são sempre gratuitas. Créditos para a rede colaborativa a partir de R$ 0,90/consulta.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {[
              {name:"Gratuito",price:"R$ 0",period:"para sempre",desc:"Para conhecer a plataforma",highlight:false,cta:"Criar conta grátis",
                features:["Consultas ilimitadas na sua base","30 créditos ISP para testar a rede","Anti-fraude básico","Importação via CSV","1 usuário"],
                off:["Créditos mensais inclusos","Notificação WhatsApp"]},
              {name:"Básico",price:"R$ 149",period:"/mês",desc:"Para provedores até 1.000 clientes",highlight:true,cta:"Começar agora",
                features:["Tudo do Gratuito","200 créditos ISP/mês inclusos","50 créditos SPC/mês inclusos","Anti-fraude + notificação WhatsApp","Integração com 1 ERP","3 usuários"],
                off:[]},
              {name:"Profissional",price:"R$ 349",period:"/mês",desc:"Para provedores acima de 1.000 clientes",highlight:false,cta:"Começar agora",
                features:["Tudo do Básico","500 créditos ISP/mês inclusos","150 créditos SPC/mês inclusos","Todos os ERPs integrados","Usuários ilimitados"],
                off:[]},
            ].map((plan,i) => (
              <div key={i} className={`rounded-2xl p-6 flex flex-col border transition-shadow hover:shadow-lg relative ${plan.highlight?"border-blue-400 border-2":"border-slate-200"}`}
                data-testid={`plan-${i}`}>
                {plan.highlight && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-black px-4 py-1 rounded-full">MAIS POPULAR</div>
                )}
                <h3 className="text-lg font-bold text-slate-900 mb-1">{plan.name}</h3>
                <div className="mb-1 flex items-baseline gap-1">
                  <span className="text-4xl font-black text-slate-900">{plan.price}</span>
                  <span className="text-sm text-slate-400">{plan.period}</span>
                </div>
                <p className="text-xs text-slate-500 mb-6">{plan.desc}</p>
                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5"/>{f}
                    </li>
                  ))}
                  {plan.off.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-400">
                      <span className="w-4 h-4 flex-shrink-0 mt-0.5 text-center text-slate-300">✗</span>{f}
                    </li>
                  ))}
                </ul>
                <Button onClick={goRegister}
                  className={`w-full font-bold h-11 rounded-xl ${plan.highlight?"bg-blue-600 hover:bg-blue-700 text-white":"bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200"}`}>
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-6 mt-8 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><Lock className="w-3 h-3"/>Sem contrato</span>
            <span className="flex items-center gap-1.5"><Shield className="w-3 h-3"/>Dados LGPD</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3 h-3"/>Cancele quando quiser</span>
          </div>
        </div>
      </section>

      {/* ERPs */}
      {erps.length > 0 && (
        <section className="py-14 bg-slate-50 border-y border-slate-200">
          <div className="max-w-6xl mx-auto px-6 text-center">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Integrações</p>
            <h3 className="text-2xl font-black text-slate-900 mb-2">ERPs integrados</h3>
            <p className="text-sm text-slate-500 mb-8">Integração em <strong>15 minutos</strong>. Sem programação. Sem técnico. Não usa ERP? Importe via planilha CSV.</p>
            <div className="flex items-center justify-center gap-8 flex-wrap">
              {erps.map(erp => (
                <div key={erp.key} className="flex flex-col items-center gap-2 hover:scale-110 transition-transform">
                  {erp.logoBase64 ? (
                    <img src={erp.logoBase64} alt={erp.name} className="h-8 object-contain"/>
                  ) : (
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Globe className="w-5 h-5 text-blue-600"/>
                    </div>
                  )}
                  <span className="text-xs font-semibold text-slate-600">{erp.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* TESTIMONIALS */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
              <Star className="w-3.5 h-3.5 fill-blue-600" />
              O que os provedores dizem
            </div>
            <h2 className="text-4xl font-black text-slate-900">ISPs que protegem sua receita</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6" data-testid="testimonials-section">
            {[
              { quote: "Em dois meses, bloqueamos 14 tentativas de contrato de inadimplentes que já estavam em fuga de outro provedor. Economia estimada: R$ 11.200 em equipamentos e mensalidades.", author: "Rodrigo M.", role: "Sócio-fundador", city: "ISP — Minas Gerais", stars: 5 },
              { quote: "O cruzamento de endereço salvou nossa operação duas vezes. CPF diferente, mesma casa, mesmo golpe. Sem o sistema, nunca identificaríamos. Agora é protocolo antes de qualquer instalação.", author: "Camila F.", role: "Gerente Operacional", city: "ISP — Interior de SP", stars: 5 },
              { quote: "Integrei com meu IXC Soft em 20 minutos. A sincronização automática funciona sem falhas há 8 meses. O alerta anti-fraude pagou o plano anual inteiro na primeira semana de uso.", author: "Tiago B.", role: "Diretor de TI", city: "ISP — Rio Grande do Sul", stars: 5 },
              { quote: "Testei o plano gratuito por 15 dias antes de assinar. Logo na primeira semana, identifiquei um cliente com histórico em 3 provedores da região. Assino até hoje.", author: "Marcela P.", role: "Supervisora de Atendimento", city: "ISP — Paraná", stars: 5 },
              { quote: "Antes ficávamos sabendo do calote só depois de instalar. Agora consultamos todo CPF antes de agendar a visita técnica. Zero instalação desperdiçada nos últimos 4 meses.", author: "Fábio L.", role: "Proprietário", city: "ISP — Goiás", stars: 5 },
              { quote: "A equipe de suporte respondeu minha dúvida de integração API em menos de 2 horas. Para quem tem sistema próprio, o webhook facilita muito — zero dependência do ERP.", author: "Juliana S.", role: "Coordenadora de CRM", city: "ISP — Bahia", stars: 5 },
            ].map((t, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col gap-4" data-testid={`testimonial-${i}`}>
                <div className="flex gap-0.5">
                  {Array.from({ length: t.stars }).map((_, s) => (
                    <Star key={s} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-slate-700 leading-relaxed flex-1">"{t.quote}"</p>
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-sm font-bold text-slate-900">{t.author}</p>
                  <p className="text-xs text-muted-foreground">{t.role} · {t.city}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 bg-white">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-black text-slate-900">Perguntas frequentes</h2>
          </div>
          <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-200" data-testid="faq-section">
            {[
              {q:"O que é a base de dados compartilhada?",a:"É uma base única onde todos os provedores registram seus inadimplentes. Quando você consulta um CPF, o sistema verifica em todos os provedores da rede e retorna dados anonimizados: dias de atraso, faixa de valor, equipamentos pendentes. Nunca dados pessoais identificáveis."},
              {q:"Consultas na minha própria base são cobradas?",a:"Não. Consultas de clientes do seu próprio provedor são sempre gratuitas e ilimitadas. Créditos são consumidos apenas quando a consulta retorna dados de outros provedores da rede — 1 crédito por provedor externo encontrado."},
              {q:"Como funciona a análise por endereço?",a:"Você informa o CEP e o número da residência. O sistema cruza em toda a rede de provedores e mostra o histórico de inadimplência associado àquele imóvel — independente do CPF do morador atual. Isso detecta casos onde o inadimplente usa o CPF de um parente mas mora no mesmo local."},
              {q:"Funciona para provedor pequeno com menos de 200 clientes?",a:"Sim, especialmente para pequenos. Uma ONU perdida representa muito mais para quem tem 150 clientes. O plano Gratuito já é suficiente para começar — e você começa a ver resultado no primeiro calote evitado."},
              {q:"Quanto tempo leva para configurar?",a:"15 minutos para conectar um ERP (IXC, SGP, MK Solutions, Voalle, ClickISP, Radius Manager) via API. Se preferir, importe sua base de inadimplentes via planilha CSV e comece a consultar imediatamente. Sem instalação, sem técnico."},
              {q:"Compartilhar dados de inadimplentes viola a LGPD?",a:"Não. O sistema compartilha apenas indicadores anonimizados — dias de atraso, faixa de valor e se há equipamentos pendentes. Nunca nome, CPF, endereço ou dados pessoais identificáveis. O sistema foi construído em conformidade com a LGPD."},
              {q:"E a Resolução Anatel 765 — como ela afeta meu provedor?",a:"A Resolução 765 obriga a notificar o cliente em D+15 e aguardar até D+60 antes de cancelar. São 75 dias que o inadimplente pode usar para contratar outro provedor sem pagar. Com o anti-fraude, você recebe alerta em tempo real quando ele tenta migrar — e pode agir antes que a ONU saia da sua mão."},
              {q:"Posso integrar via webhook com meu sistema próprio?",a:"Sim. Além das integrações nativas com ERPs, disponibilizamos um endpoint webhook seguro (POST /api/webhooks/erp-inadimplente) com autenticação por token. Ideal para sistemas proprietários, ERPs regionais ou scripts de automação. Configure em segundos pelo Painel do Provedor."},
              {q:"Como funciona o histórico na rede?",a:"Cada consulta realizada fica registrada de forma anônima. Quando você consulta um CPF, o sistema mostra quantos outros provedores já consultaram aquele documento nos últimos 30 dias — um sinal poderoso de risco: muitas consultas indicam que o candidato está tentando contratar serviço em vários provedores ao mesmo tempo."},
              {q:"O sistema alerta quando um cliente inadimplente tenta contratar em outro provedor?",a:"Sim, esse é o recurso Anti-Fraude. Quando um cliente inadimplente seu é consultado por outro provedor, você recebe um alerta imediato. Isso permite oferecer renegociação (reter o cliente) ou apenas registrar a tentativa de fuga — tudo com histórico para fins de auditoria e compliance."},
              {q:"Quais ERPs são suportados na integração automática?",a:"iXC Soft, SGP, MK Solutions, Tiacos, Hubsoft, Fly Speed, Netflash, Voalle, RBX, Unisat, ClickISP e Radius Manager. Solicitações para novos ERPs são avaliadas semanalmente — basta abrir um chamado pelo painel."},
              {q:"Os dados ficam seguros? Quem tem acesso à minha base?",a:"Cada provedor acessa apenas seus próprios dados completos. Para consulta cruzada na rede, apenas indicadores anonimizados são compartilhados. A infraestrutura usa criptografia em trânsito (TLS 1.3) e em repouso. Nenhum funcionário da Consulta ISP acessa sua base sem solicitação formal documentada."},
              {q:"Existe API pública para integração customizada?",a:"Sim. Disponibilizamos documentação de API REST completa para clientes dos planos Pro e Enterprise. Além do webhook de entrada, você pode consultar CPFs/CNPJs via API autenticada, integrar com CRM próprio e receber eventos em tempo real via webhook de saída."},
            ].map((faq, i) => (
              <div key={i} className="px-6" data-testid={`faq-${i}`}>
                <button className="w-full text-left py-5 flex items-center justify-between gap-4"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  <span className="text-sm font-semibold text-slate-900">{faq.q}</span>
                  {openFaq === i ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0"/> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0"/>}
                </button>
                {openFaq === i && <p className="text-sm text-slate-600 pb-5 leading-relaxed -mt-1">{faq.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="py-20 bg-blue-600">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-semibold px-3 py-1.5 rounded-full mb-8 border border-white/20">
            <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"/>
            Começa grátis — sem cartão de crédito
          </div>
          <h2 className="text-4xl sm:text-5xl font-black text-white mb-5 leading-tight">
            Consulte o próximo CPF<br/>
            <span className="text-blue-200">antes de instalar.</span>
          </h2>
          <p className="text-blue-100 mb-10 text-lg max-w-xl mx-auto leading-relaxed">
            Cadastro em 2 minutos. 30 créditos gratuitos para testar a rede.<br/>
            Consultas na sua base sempre gratuitas.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8">
            <Button size="lg" onClick={goRegister} data-testid="button-cta-bottom"
              className="bg-white text-blue-700 hover:bg-blue-50 px-10 gap-2 h-12 text-base font-black rounded-xl shadow-xl">
              Criar conta grátis <ArrowRight className="w-4 h-4"/>
            </Button>
            <Button size="lg" variant="outline" onClick={goLogin} data-testid="button-login-bottom"
              className="border-white/30 text-white hover:bg-white/10 px-8 h-12 text-base rounded-xl">
              Já tenho conta — Login
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-5 text-sm text-blue-100">
            <span className="flex items-center gap-2"><span className="text-white">✓</span>Gratuito na base própria</span>
            <span className="flex items-center gap-2"><span className="text-white">✓</span>Sem contrato de fidelidade</span>
            <span className="flex items-center gap-2"><span className="text-white">✓</span>LGPD compliant</span>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-slate-900 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Shield className="w-3.5 h-3.5 text-white"/>
            </div>
            <span className="text-white font-bold text-sm">Consulta ISP</span>
            <span className="text-slate-400 text-xs hidden sm:inline">Base colaborativa para provedores</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1"><Lock className="w-3 h-3"/>Dados criptografados</span>
            <span className="flex items-center gap-1"><Shield className="w-3 h-3"/>Privacidade LGPD</span>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 mt-5 pt-5 border-t border-slate-800">
          <p className="text-xs text-slate-500 text-center">
            Consulta ISP — Plataforma colaborativa de análise de crédito para provedores de internet do Brasil
          </p>
        </div>
      </footer>

      <LandingChatbot onNavigate={setLocation}/>
    </div>
  );
}
