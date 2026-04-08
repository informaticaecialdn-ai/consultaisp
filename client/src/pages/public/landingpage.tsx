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
    <div className="min-h-screen bg-[var(--color-bg)] overflow-x-hidden" data-testid="landing-page">

      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-[var(--color-navy)] flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-base font-bold font-display text-[var(--color-ink)]">Consulta ISP</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm text-[var(--color-muted)]">
            {[["Como funciona","como-funciona"],["Funcionalidades","funcionalidades"],["Preços","precos"],["FAQ","faq"]].map(([l,id]) => (
              <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({behavior:"smooth"})}
                className="hover:text-[var(--color-navy)] transition-colors font-medium">{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="text-[var(--color-muted)] hover:text-[var(--color-ink)] text-sm h-9"
              onClick={goLogin} data-testid="button-landing-login">Login</Button>
            <Button className="bg-[var(--color-navy)] hover:bg-[var(--color-steel)] text-white text-sm h-9 px-5 font-semibold rounded"
              onClick={goRegister} data-testid="button-landing-cadastro">Começar grátis</Button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-16 bg-[var(--color-bg)]">
        <div className="max-w-6xl mx-auto px-6 py-16 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 text-[var(--color-navy)] text-xs font-semibold px-3 py-1.5 rounded-sm mb-6">
              <div className="w-1.5 h-1.5 bg-[var(--color-navy)] rounded-full animate-pulse" />
              Rede colaborativa de inadimplentes entre provedores
            </div>
            <h1 className="font-display font-light text-5xl text-[var(--color-ink)] leading-[1.05] tracking-tight mb-5" data-testid="text-hero-title">
              Consulte o CPF<br/>
              <span className="text-[var(--color-navy)]">antes de instalar.</span><br/>
              <span className="text-[var(--color-muted)] text-3xl font-semibold">Evite o calote antes que aconteça.</span>
            </h1>
            <p className="text-lg text-[var(--color-muted)] leading-relaxed mb-8 max-w-lg">
              Base colaborativa de inadimplentes entre provedores de internet.
              Score de crédito, histórico em toda a rede, alertas de migração e
              análise por endereço — tudo em uma plataforma.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-10">
              <Button size="lg" onClick={goRegister} data-testid="button-hero-cta"
                className="bg-[var(--color-navy)] hover:bg-[var(--color-steel)] text-white px-8 gap-2 h-12 text-base font-bold rounded">
                Criar conta grátis <ArrowRight className="w-4 h-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => document.getElementById("como-funciona")?.scrollIntoView({behavior:"smooth"})}
                className="border-[var(--color-border)] text-[var(--color-muted)] px-8 h-12 text-base rounded" data-testid="button-hero-features">
                Ver como funciona
              </Button>
            </div>
            <div className="flex items-center gap-6 pt-6 border-t border-[var(--color-border)]">
              {[{v:"R$ 690",l:"prejuízo médio/inadimplente"},{v:"< 2s",l:"resultado da consulta"},{v:"Grátis",l:"consultas na sua base"}].map(s => (
                <div key={s.l}><p className="text-xl font-mono font-black text-[var(--color-ink)]">{s.v}</p><p className="text-xs text-[var(--color-muted)] mt-0.5">{s.l}</p></div>
              ))}
            </div>
          </div>

          {/* Mockup hero */}
          <div className="relative hidden lg:block">
            <div className="bg-slate-100 rounded p-2 border border-[var(--color-border)]">
              <div className="bg-slate-800 rounded overflow-hidden">
                <div className="flex items-center gap-1.5 px-4 py-3 bg-slate-700">
                  <div className="w-3 h-3 rounded-full bg-[var(--color-danger)]"/>
                  <div className="w-3 h-3 rounded-full bg-[var(--color-gold)]"/>
                  <div className="w-3 h-3 rounded-full bg-[var(--color-success)]"/>
                  <div className="flex-1 bg-slate-600 rounded-md mx-3 px-3 py-1 text-xs text-[var(--color-muted)]">
                    consultaisp.com.br/consulta-isp
                  </div>
                </div>
                <div className="bg-[var(--color-bg)] p-5">
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--color-border)]">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-blue-100 rounded flex items-center justify-center">
                        <Search className="w-4 h-4 text-[var(--color-navy)]"/>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--color-muted)]">CPF consultado</p>
                        <p className="text-sm font-bold text-[var(--color-ink)]">041.179.***-40</p>
                      </div>
                    </div>
                    <span className="text-xs bg-[var(--color-danger-bg)] text-[var(--color-danger)] font-bold px-2.5 py-1 rounded-sm">CRÍTICO</span>
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="relative w-14 h-14 flex-shrink-0">
                      <svg width="56" height="56" className="-rotate-90">
                        <circle cx="28" cy="28" r="22" fill="none" stroke="#FEE2E2" strokeWidth="5"/>
                        <circle cx="28" cy="28" r="22" fill="none" stroke="#DC2626" strokeWidth="5"
                          strokeDasharray="138" strokeDashoffset="117" strokeLinecap="round"/>
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-mono font-black text-[var(--color-danger)]">15</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--color-muted)] mb-1">Score ISP / 100</p>
                      <div className="flex gap-2">
                        <span className="text-xs bg-[var(--color-danger-bg)] text-[var(--color-danger)] font-semibold px-2 py-0.5 rounded">2 provedores</span>
                        <span className="text-xs bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded">2 equip. retidos</span>
                      </div>
                    </div>
                    <div className="ml-auto bg-[var(--color-danger)] text-white px-3 py-2 rounded text-center">
                      <p className="font-mono text-[9px] opacity-80 uppercase font-semibold">Sugestão</p>
                      <p className="text-sm font-black">REJEITAR</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-[var(--color-success-bg)] border border-[var(--color-border)] rounded p-3">
                      <p className="font-mono text-[9px] text-[var(--color-success)] font-bold uppercase mb-1">Seu Provedor</p>
                      <p className="text-xs font-bold text-[var(--color-ink)]">VALDIRENE ***</p>
                      <p className="text-[10px] text-[var(--color-danger)] mt-1">325 dias · R$ 350</p>
                      <span className="text-[9px] bg-[var(--color-success-bg)] text-[var(--color-success)] font-bold px-1.5 py-0.5 rounded mt-1 inline-block">Grátis</span>
                    </div>
                    <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded p-3">
                      <p className="font-mono text-[9px] text-[var(--color-muted)] font-bold uppercase mb-1">Outro Provedor</p>
                      <p className="text-xs font-bold text-[var(--color-ink)]">Dados restritos</p>
                      <p className="text-[10px] text-[var(--color-danger)] mt-1">1441 dias · R$400–600</p>
                      <span className="text-[9px] bg-blue-100 text-[var(--color-navy)] font-bold px-1.5 py-0.5 rounded mt-1 inline-block">1 crédito</span>
                    </div>
                  </div>
                  <div className="bg-[var(--color-gold-bg)] border border-[var(--color-border)] rounded p-2.5 flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3 text-[var(--color-gold)] flex-shrink-0"/>
                    <p className="text-[10px] text-[var(--color-gold)] font-medium">2 equipamentos não devolvidos — R$ 580 em risco</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-3 -left-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse"/>
                <span className="text-xs font-semibold text-[var(--color-ink)]">Resultado em <span className="font-mono">1.8s</span></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BARRA ERPs */}
      <section className="bg-[var(--color-bg)] border-y border-[var(--color-border)] py-4">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center gap-6 justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] whitespace-nowrap">Integra com</p>
          <div className="flex items-center gap-6 flex-wrap justify-center">
            {erps.map(erp => (
              <div key={erp.key} className="flex items-center gap-2 opacity-50 hover:opacity-100 transition-opacity">
                {erp.logoBase64 ? (
                  <img src={erp.logoBase64} alt={erp.name} className="h-6 object-contain"/>
                ) : (
                  <span className="text-[var(--color-ink)] text-sm font-bold">{erp.name}</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--color-muted)] whitespace-nowrap">Ou via <span className="text-[var(--color-ink)] font-medium">planilha CSV</span></p>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section id="como-funciona" className="py-20 bg-[var(--color-bg)]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] mb-3">Simples assim</p>
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)]">3 passos. Resultado em <span className="font-mono">2</span> segundos.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {n:"01",icon:Database,title:"Configure em 15 min",desc:"Conecte seu ERP (IXC, SGP, MK Solutions) ou importe via planilha CSV. Sem instalação, sem técnico.",badge:"Setup: 15 min"},
              {n:"02",icon:Search,title:"Consulte antes de ativar",desc:"CPF, CNPJ ou endereço. Em menos de 2 segundos: score de risco, histórico na rede, equipamentos retidos e sugestão de decisão.",badge:"< 2 segundos"},
              {n:"03",icon:Bell,title:"Receba alertas anti-fraude",desc:"Quando seu cliente inadimplente é consultado por outro provedor para migrar, você recebe alerta imediato no WhatsApp.",badge:"Tempo real"},
            ].map((s,i) => (
              <div key={i} className="relative bg-[var(--color-surface)] border-[0.5px] border-[var(--color-border)] rounded p-6 hover:border-[var(--color-navy)] transition-all">
                <span className="font-mono text-6xl font-black text-slate-100 absolute top-4 right-5 leading-none select-none">{s.n}</span>
                <div className="relative">
                  <div className="w-12 h-12 bg-blue-50 border border-blue-100 rounded flex items-center justify-center mb-4">
                    <s.icon className="w-5 h-5 text-[var(--color-navy)]"/>
                  </div>
                  <span className="inline-block bg-blue-50 text-[var(--color-navy)] text-xs font-bold px-3 py-1 rounded-sm mb-3 border border-blue-100">{s.badge}</span>
                  <h3 className="font-display font-semibold text-lg text-[var(--color-ink)] mb-2">{s.title}</h3>
                  <p className="text-sm text-[var(--color-muted)] leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DORES */}
      <section className="py-20 bg-[var(--color-bg)]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-danger)] mb-3">As dores que custam mais caro</p>
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)]">Você reconhece alguma dessas situações?</h2>
            <p className="text-[var(--color-muted)] mt-3 max-w-xl mx-auto">Cada uma tem solução dentro do Consulta ISP.</p>
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
                red:"border-[var(--color-danger)] bg-[var(--color-danger-bg)]",
                orange:"border-orange-200 bg-orange-50",
                amber:"border-[var(--color-gold)] bg-[var(--color-gold-bg)]",
                purple:"border-purple-200 bg-purple-50",
                blue:"border-[var(--color-navy)] bg-blue-50",
              };
              const textColors: Record<string,string> = {
                red:"text-[var(--color-danger)]", orange:"text-orange-600",
                amber:"text-[var(--color-gold)]", purple:"text-purple-600", blue:"text-[var(--color-navy)]",
              };
              return (
                <div key={i} className="bg-[var(--color-surface)] border-[0.5px] border-[var(--color-border)] rounded p-6 flex flex-col transition-all">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-10 h-10 rounded flex items-center justify-center ${colors[d.color]}`}>
                      <d.icon className={`w-5 h-5 ${textColors[d.color]}`}/>
                    </div>
                    <span className={`text-sm font-mono font-black ${textColors[d.color]}`}>{d.num}</span>
                  </div>
                  <h3 className={`font-display font-semibold text-sm mb-2 ${textColors[d.color]}`}>{d.title}</h3>
                  <p className="text-sm text-[var(--color-muted)] leading-relaxed flex-1 mb-4">{d.desc}</p>
                  <div className="bg-[var(--color-bg)] border-[0.5px] border-[var(--color-border)] rounded p-3 mb-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] mb-1">Como resolvemos</p>
                    <p className="text-xs text-[var(--color-ink)] font-medium">{d.solution}</p>
                  </div>
                  <Button onClick={goRegister} size="sm"
                    className="w-full bg-[var(--color-navy)] hover:bg-[var(--color-steel)] text-white font-semibold rounded text-xs h-9">
                    Resolver este problema →
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FUNCIONALIDADES */}
      <section id="funcionalidades" className="py-20 bg-[var(--color-bg)]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] mb-3">O sistema em ação</p>
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)]">Interface pensada para o dia a dia do provedor</h2>
            <p className="text-[var(--color-muted)] mt-3">Resultado claro, decisão rápida. Sem treinamento necessário.</p>
          </div>

          {/* Bloco 1: Consulta ISP */}
          <div className="grid lg:grid-cols-2 gap-12 items-center mb-20">
            <div className="bg-slate-100 rounded p-2 border border-[var(--color-border)]">
              <div className="bg-slate-800 rounded overflow-hidden">
                <div className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-700">
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-danger)]"/>
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-gold)]"/>
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-success)]"/>
                  <span className="ml-2 text-xs text-[var(--color-muted)]">Consulta ISP — Resultado detalhado</span>
                </div>
                <div className="bg-[var(--color-bg)] p-4">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--color-border)]">
                    <div>
                      <p className="text-xs text-[var(--color-muted)]">CPF consultado</p>
                      <p className="text-sm font-bold">987.654.321-00</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs bg-[var(--color-danger-bg)] text-[var(--color-danger)] font-bold px-2 py-0.5 rounded-sm">ALTO RISCO</span>
                      <p className="text-xs text-[var(--color-muted)] mt-1">Consultado há 2min</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs text-[var(--color-muted)]">Score de crédito</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div className="bg-[var(--color-danger)] h-full rounded-full" style={{width:"15%"}}/>
                    </div>
                    <span className="text-sm font-mono font-black text-[var(--color-danger)]">15 / 100</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-[var(--color-success-bg)] border border-[var(--color-border)] rounded p-2.5">
                      <p className="font-mono text-[9px] text-[var(--color-success)] font-bold uppercase">Seu Provedor</p>
                      <p className="text-xs font-bold mt-1">João Pereira Lima</p>
                      <p className="text-[10px] text-[var(--color-muted)]">Rua das Flores, 142</p>
                      <div className="flex justify-between mt-2">
                        <span className="text-[10px] text-[var(--color-danger)] font-semibold">98 dias</span>
                        <span className="text-[10px] bg-[var(--color-success-bg)] text-[var(--color-success)] font-bold px-1.5 rounded">Grátis</span>
                      </div>
                    </div>
                    <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded p-2.5">
                      <p className="font-mono text-[9px] text-[var(--color-muted)] font-bold uppercase">Outro Provedor</p>
                      <p className="text-xs font-bold mt-1">João P. L•••</p>
                      <p className="text-[10px] text-[var(--color-muted)]">São Paulo - SP</p>
                      <div className="flex justify-between mt-2">
                        <span className="text-[10px] text-[var(--color-danger)] font-semibold">122 dias</span>
                        <span className="text-[10px] bg-blue-100 text-[var(--color-navy)] font-bold px-1.5 rounded">1 crédito</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-[var(--color-danger)] text-white rounded p-2.5 flex items-center gap-3">
                    <div className="text-center px-2 border-r border-red-500">
                      <p className="font-mono text-[8px] opacity-80 uppercase font-semibold">Sugestão IA</p>
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
              <div className="inline-flex items-center gap-2 bg-blue-50 text-[var(--color-navy)] text-xs font-bold px-3 py-1.5 rounded-sm mb-5 border border-blue-100">
                <Search className="w-3.5 h-3.5"/>Consulta ISP
              </div>
              <h3 className="font-display font-light text-3xl text-[var(--color-ink)] mb-4">Score em <span className="font-mono">2</span> segundos.<br/><span className="text-[var(--color-muted)]">Decisão em 1 clique.</span></h3>
              <p className="text-[var(--color-muted)] leading-relaxed mb-6">Consulte CPF, CNPJ ou endereço e receba score de 0 a 100, histórico em toda a rede colaborativa, equipamentos retidos e sugestão automática de APROVAR ou REJEITAR.</p>
              <ul className="space-y-3 mb-8">
                {["Histórico em todos os provedores da rede","Score calculado com IA","Equipamentos retidos por provedor","Busca por endereço — detecta CPF diferente no mesmo imóvel"].map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-[var(--color-ink)]">
                    <CheckCircle2 className="w-4 h-4 text-[var(--color-navy)] flex-shrink-0"/>{f}
                  </li>
                ))}
              </ul>
              <Button onClick={goRegister} className="bg-[var(--color-navy)] hover:bg-[var(--color-steel)] text-white font-bold px-6 h-10 rounded">
                Testar grátis →
              </Button>
            </div>
          </div>

          {/* Bloco 2: Anti-Fraude */}
          <div className="grid lg:grid-cols-2 gap-12 items-center mb-20">
            <div className="order-2 lg:order-1">
              <div className="inline-flex items-center gap-2 bg-[var(--color-danger-bg)] text-[var(--color-danger)] text-xs font-bold px-3 py-1.5 rounded-sm mb-5 border border-[var(--color-danger-bg)]">
                <Bell className="w-3.5 h-3.5"/>Anti-Fraude em Tempo Real
              </div>
              <h3 className="font-display font-light text-3xl text-[var(--color-ink)] mb-4">Seu inadimplente tentou migrar.<br/><span className="text-[var(--color-muted)]">Você fica sabendo agora.</span></h3>
              <p className="text-[var(--color-muted)] leading-relaxed mb-6">A Resolução Anatel 765 dá 75 dias ao cliente antes de você poder cancelar. Ele sabe disso — e usa esse tempo para migrar sem pagar. Com o anti-fraude, você recebe o alerta enquanto ele ainda está tentando.</p>
              <div className="bg-[var(--color-gold-bg)] border border-[var(--color-border)] rounded p-4 mb-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-gold)] mb-1">Resolução Anatel 765</p>
                <p className="text-sm text-[var(--color-ink)]">75 dias antes do cancelamento. O cliente usa cada um deles.</p>
              </div>
              <ul className="space-y-3 mb-8">
                {["Alerta em tempo real via WhatsApp e email","Identifica migradores seriais (2+ provedores)","Trajetória completa do cliente inadimplente","Configure regras por valor mínimo ou dias de atraso"].map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-[var(--color-ink)]">
                    <CheckCircle2 className="w-4 h-4 text-[var(--color-danger)] flex-shrink-0"/>{f}
                  </li>
                ))}
              </ul>
              <Button onClick={goRegister} className="bg-[var(--color-danger)] hover:opacity-90 text-white font-bold px-6 h-10 rounded">
                Ativar anti-fraude →
              </Button>
            </div>
            {/* Print Anti-Fraude */}
            <div className="order-1 lg:order-2 bg-slate-100 rounded p-2 border border-[var(--color-border)]">
              <div className="bg-slate-800 rounded overflow-hidden">
                <div className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-700">
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-danger)] animate-pulse"/>
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-gold)]"/>
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-success)]"/>
                  <span className="ml-2 text-xs text-[var(--color-muted)]">Anti-Fraude — Alertas</span>
                </div>
                <div className="bg-[var(--color-bg)] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink)]">Alertas recentes</p>
                    <span className="text-xs bg-[var(--color-danger-bg)] text-[var(--color-danger)] font-bold px-2 py-0.5 rounded-sm">3 ativos</span>
                  </div>
                  {[
                    {name:"VALDIRENE ***",desc:"CPF consultado por ViaFibra Net",dias:"325 dias",valor:"R$ 350",dot:"red"},
                    {name:"Carlos Eduardo M.",desc:"Tentativa de novo contrato detectada",dias:"95 dias",valor:"R$ 749",dot:"orange"},
                    {name:"Jose Santos",desc:"Migrador serial — 3 provedores",dias:"130 dias",valor:"R$ 1.200",dot:"red"},
                  ].map((a,i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5 border-b border-[var(--color-border)] last:border-0">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${a.dot==="red"?"bg-[var(--color-danger)]":"bg-orange-500"}`}/>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-[var(--color-ink)]">{a.name}</p>
                        <p className="text-[10px] text-[var(--color-muted)]">{a.desc}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[10px] text-[var(--color-danger)] font-semibold">{a.dias}</p>
                        <p className="text-[10px] text-[var(--color-muted)]">{a.valor}</p>
                      </div>
                    </div>
                  ))}
                  <div className="mt-3 bg-[var(--color-bg)] rounded p-3">
                    <p className="font-mono text-[9px] text-[var(--color-muted)] uppercase tracking-[0.12em] mb-2">Trajetória do migrador</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {["SGP Telecom","NetFibra","ViaFibra ←"].map((p,i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${i===2?"bg-[var(--color-danger-bg)] text-[var(--color-danger)]":"bg-slate-200 text-[var(--color-muted)]"}`}>{p}</span>
                          {i<2&&<span className="text-[var(--color-border)] text-xs">→</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Grid features secundárias */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-10 border-t border-[var(--color-border)]">
            {[
              {icon:Database,title:"Rede Colaborativa",desc:"Dados de inadimplência de provedores em toda a rede. Quanto mais participam, mais preciso fica.",color:"bg-blue-50",ic:"text-[var(--color-navy)]"},
              {icon:MapPin,title:"Análise por Endereço",desc:"Cruza CEP + número em toda a rede. Detecta inadimplente mesmo com CPF diferente no mesmo imóvel.",color:"bg-purple-50",ic:"text-purple-600"},
              {icon:CreditCard,title:"Consulta SPC Brasil",desc:"Score SPC, restrições financeiras e protestos integrados. Negativação sem contrato adicional.",color:"bg-[var(--color-success-bg)]",ic:"text-[var(--color-success)]"},
              {icon:Zap,title:"Análise com IA",desc:"Recomendações automáticas: APROVAR, APROVAR COM RESSALVAS, RECUSAR ou REJEITAR.",color:"bg-[var(--color-gold-bg)]",ic:"text-[var(--color-gold)]"},
            ].map((f,i) => (
              <div key={i} className="bg-[var(--color-surface)] border-[0.5px] border-[var(--color-border)] rounded p-5 hover:border-[var(--color-navy)] transition-all">
                <div className={`w-10 h-10 ${f.color} rounded flex items-center justify-center mb-4`}>
                  <f.icon className={`w-5 h-5 ${f.ic}`}/>
                </div>
                <h4 className="font-display font-semibold text-sm text-[var(--color-ink)] mb-2">{f.title}</h4>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DIFERENCIAIS vs MERCADO */}
      <section className="py-16 bg-[var(--color-bg)]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] mb-3">Por que o Consulta ISP</p>
            <h2 className="font-display font-light text-3xl text-[var(--color-ink)]">Tudo que o mercado oferece. Em uma plataforma.</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full bg-[var(--color-surface)] rounded border-[0.5px] border-[var(--color-border)] overflow-hidden">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="p-4 text-left text-sm font-semibold text-[var(--color-ink)] w-1/3">Funcionalidade</th>
                  <th className="p-4 text-center text-sm font-bold text-[var(--color-navy)] bg-blue-50">Consulta ISP</th>
                  <th className="p-4 text-center text-sm font-semibold text-[var(--color-muted)]">SPC/Serasa</th>
                  <th className="p-4 text-center text-sm font-semibold text-[var(--color-muted)]">TeiaH Valid</th>
                  <th className="p-4 text-center text-sm font-semibold text-[var(--color-muted)]">ISP Score</th>
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
                  <tr key={i} className={i%2===0?"bg-[var(--color-surface)]":"bg-[var(--color-bg)]"}>
                    <td className="p-4 text-sm text-[var(--color-ink)] font-medium border-b border-[var(--color-border)]">{row[0]}</td>
                    <td className="p-4 text-center bg-blue-50/50 border-b border-[var(--color-border)]">
                      <span className={`text-sm font-bold ${row[1]==="✅"?"text-[var(--color-success)]":"text-[var(--color-border)]"}`}>{row[1]}</span>
                    </td>
                    {[row[2],row[3],row[4]].map((v,j) => (
                      <td key={j} className="p-4 text-center border-b border-[var(--color-border)]">
                        <span className={`text-sm ${v==="✅"?"text-[var(--color-success)]":"text-[var(--color-border)]"}`}>{v}</span>
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
      <section id="precos" className="py-20 bg-[var(--color-bg)]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] mb-3">Transparência total</p>
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)] mb-3">Planos para todo tamanho de provedor</h2>
            <p className="text-[var(--color-muted)] max-w-lg mx-auto text-sm">Consultas na sua própria base são sempre gratuitas. Créditos para a rede colaborativa a partir de R$ 0,90/consulta.</p>
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
              <div key={i} className={`rounded p-6 flex flex-col border-[0.5px] transition-all relative ${plan.highlight?"border-[var(--color-navy)] border-2":"border-[var(--color-border)]"}`}
                data-testid={`plan-${i}`}>
                {plan.highlight && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[var(--color-navy)] text-white text-xs font-black px-4 py-1 rounded-sm">MAIS POPULAR</div>
                )}
                <h3 className="font-display font-semibold text-lg text-[var(--color-ink)] mb-1">{plan.name}</h3>
                <div className="mb-1 flex items-baseline gap-1">
                  <span className="text-4xl font-mono font-black text-[var(--color-ink)]">{plan.price}</span>
                  <span className="text-sm text-[var(--color-muted)]">{plan.period}</span>
                </div>
                <p className="text-xs text-[var(--color-muted)] mb-6">{plan.desc}</p>
                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                      <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] flex-shrink-0 mt-0.5"/>{f}
                    </li>
                  ))}
                  {plan.off.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-[var(--color-muted)]">
                      <span className="w-4 h-4 flex-shrink-0 mt-0.5 text-center text-[var(--color-border)]">✗</span>{f}
                    </li>
                  ))}
                </ul>
                <Button onClick={goRegister}
                  className={`w-full font-bold h-11 rounded ${plan.highlight?"bg-[var(--color-navy)] hover:bg-[var(--color-steel)] text-white":"bg-[var(--color-bg)] hover:bg-slate-200 text-[var(--color-ink)] border border-[var(--color-border)]"}`}>
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-6 mt-8 text-xs text-[var(--color-muted)]">
            <span className="flex items-center gap-1.5"><Lock className="w-3 h-3"/>Sem contrato</span>
            <span className="flex items-center gap-1.5"><Shield className="w-3 h-3"/>Dados LGPD</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3 h-3"/>Cancele quando quiser</span>
          </div>
        </div>
      </section>

      {/* ERPs */}
      {erps.length > 0 && (
        <section className="py-14 bg-[var(--color-bg)] border-y border-[var(--color-border)]">
          <div className="max-w-6xl mx-auto px-6 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] mb-2">Integrações</p>
            <h3 className="font-display font-semibold text-2xl text-[var(--color-ink)] mb-2">ERPs integrados</h3>
            <p className="text-sm text-[var(--color-muted)] mb-8">Integração em <strong>15 minutos</strong>. Sem programação. Sem técnico. Não usa ERP? Importe via planilha CSV.</p>
            <div className="flex items-center justify-center gap-8 flex-wrap">
              {erps.map(erp => (
                <div key={erp.key} className="flex flex-col items-center gap-2 hover:scale-110 transition-transform">
                  {erp.logoBase64 ? (
                    <img src={erp.logoBase64} alt={erp.name} className="h-8 object-contain"/>
                  ) : (
                    <div className="w-10 h-10 bg-blue-100 rounded flex items-center justify-center">
                      <Globe className="w-5 h-5 text-[var(--color-navy)]"/>
                    </div>
                  )}
                  <span className="text-xs font-semibold text-[var(--color-muted)]">{erp.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* TESTIMONIALS */}
      <section className="py-20 bg-[var(--color-bg)]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-blue-100 text-[var(--color-navy)] text-xs font-semibold px-3 py-1.5 rounded-sm mb-4">
              <Star className="w-3.5 h-3.5 fill-[var(--color-navy)]" />
              O que os provedores dizem
            </div>
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)]">ISPs que protegem sua receita</h2>
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
              <div key={i} className="bg-[var(--color-surface)] rounded border-[0.5px] border-[var(--color-border)] p-6 flex flex-col gap-4" data-testid={`testimonial-${i}`}>
                <div className="flex gap-0.5">
                  {Array.from({ length: t.stars }).map((_, s) => (
                    <Star key={s} className="w-4 h-4 fill-[var(--color-gold)] text-[var(--color-gold)]" />
                  ))}
                </div>
                <p className="text-sm text-[var(--color-ink)] leading-relaxed flex-1">"{t.quote}"</p>
                <div className="border-t border-[var(--color-border)] pt-4">
                  <p className="text-sm font-bold text-[var(--color-ink)]">{t.author}</p>
                  <p className="text-xs text-[var(--color-muted)]">{t.role} · {t.city}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 bg-[var(--color-bg)]">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)]">Perguntas frequentes</h2>
          </div>
          <div className="border-[0.5px] border-[var(--color-border)] rounded overflow-hidden divide-y divide-[var(--color-border)]" data-testid="faq-section">
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
                  <span className="text-sm font-semibold text-[var(--color-ink)]">{faq.q}</span>
                  {openFaq === i ? <ChevronUp className="w-4 h-4 text-[var(--color-muted)] flex-shrink-0"/> : <ChevronDown className="w-4 h-4 text-[var(--color-muted)] flex-shrink-0"/>}
                </button>
                {openFaq === i && <p className="text-sm text-[var(--color-muted)] pb-5 leading-relaxed -mt-1">{faq.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="py-20 bg-[var(--color-navy)]">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-semibold px-3 py-1.5 rounded-sm mb-8 border border-white/20">
            <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"/>
            Começa grátis — sem cartão de crédito
          </div>
          <h2 className="font-display font-light text-4xl sm:text-5xl text-white mb-5 leading-tight">
            Consulte o próximo CPF<br/>
            <span className="text-blue-200">antes de instalar.</span>
          </h2>
          <p className="text-blue-100 mb-10 text-lg max-w-xl mx-auto leading-relaxed">
            Cadastro em 2 minutos. 30 créditos gratuitos para testar a rede.<br/>
            Consultas na sua base sempre gratuitas.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8">
            <Button size="lg" onClick={goRegister} data-testid="button-cta-bottom"
              className="bg-white text-[var(--color-navy)] hover:bg-blue-50 px-10 gap-2 h-12 text-base font-black rounded">
              Criar conta grátis <ArrowRight className="w-4 h-4"/>
            </Button>
            <Button size="lg" variant="outline" onClick={goLogin} data-testid="button-login-bottom"
              className="border-white/30 text-white hover:bg-white/10 px-8 h-12 text-base rounded">
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
      <footer className="bg-[#1A1714] py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-[var(--color-navy)] flex items-center justify-center">
              <Shield className="w-3.5 h-3.5 text-white"/>
            </div>
            <span className="text-white font-bold text-sm">Consulta ISP</span>
            <span className="text-[var(--color-muted)] text-xs hidden sm:inline">Base colaborativa para provedores</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-[var(--color-muted)]">
            <span className="flex items-center gap-1"><Lock className="w-3 h-3"/>Dados criptografados</span>
            <span className="flex items-center gap-1"><Shield className="w-3 h-3"/>Privacidade LGPD</span>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 mt-5 pt-5 border-t border-slate-800">
          <p className="text-xs text-[var(--color-muted)] text-center">
            Consulta ISP — Plataforma colaborativa de análise de crédito para provedores de internet do Brasil
          </p>
        </div>
      </footer>

      <LandingChatbot onNavigate={setLocation}/>
    </div>
  );
}
