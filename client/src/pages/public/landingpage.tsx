import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import LandingChatbot from "@/components/landing-chatbot";
import {
  Shield, Search, Bell, Database, CheckCircle2,
  ArrowRight, AlertTriangle, CreditCard, Lock,
  Zap, Router, MapPin, Star, Menu
} from "lucide-react";

type ErpItem = { key: string; name: string; logoBase64: string | null };

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
            {[["Como funciona","como-funciona"],["Funcionalidades","funcionalidades"],["Precos","precos"],["FAQ","faq"]].map(([l,id]) => (
              <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({behavior:"smooth"})}
                className="hover:text-[var(--color-navy)] transition-colors font-medium">{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="hidden md:inline-flex text-[var(--color-muted)] hover:text-[var(--color-ink)] text-sm h-9"
              onClick={goLogin} data-testid="button-landing-login">Login</Button>
            <Button className="hidden md:inline-flex bg-[var(--color-navy)] hover:bg-[var(--color-steel)] text-white text-sm h-9 px-5 font-semibold rounded"
              onClick={goRegister} data-testid="button-landing-cadastro">Comecar gratis</Button>
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="md:hidden text-[var(--color-muted)] hover:text-[var(--color-ink)]" data-testid="button-mobile-menu">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 bg-[var(--color-surface)] border-l border-[var(--color-border)]">
                <nav className="flex flex-col gap-4 mt-8">
                  {[["Como funciona","como-funciona"],["Funcionalidades","funcionalidades"],["Precos","precos"],["FAQ","faq"]].map(([l,id]) => (
                    <button key={id} onClick={() => { setMobileMenuOpen(false); document.getElementById(id)?.scrollIntoView({behavior:"smooth"}); }}
                      className="text-left text-sm font-medium text-[var(--color-ink)] hover:text-[var(--color-navy)] transition-colors py-2 border-b border-[var(--color-border)]">{l}</button>
                  ))}
                  <Button className="w-full bg-[var(--color-navy)] hover:bg-[var(--color-steel)] text-white text-sm h-10 font-semibold rounded mt-2"
                    onClick={() => { setMobileMenuOpen(false); goLogin(); }}>Login</Button>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-16 bg-[var(--color-bg)]">
        <div className="max-w-6xl mx-auto px-6 py-16 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-[var(--color-navy-bg)] border border-[var(--color-border)] text-[var(--color-navy)] text-xs font-semibold px-3 py-1.5 rounded-sm mb-6">
              <div className="w-1.5 h-1.5 bg-[var(--color-navy)] rounded-full animate-pulse" />
              Rede colaborativa de inadimplentes entre provedores
            </div>
            <h1 className="font-display font-light text-5xl text-[var(--color-ink)] leading-[1.05] tracking-tight mb-5" data-testid="text-hero-title">
              Saiba quem nao vai pagar —<br/>
              <span className="text-[var(--color-navy)]">antes de instalar.</span>
            </h1>
            <p className="text-lg text-[var(--color-muted)] leading-relaxed mb-8 max-w-lg">
              A rede colaborativa que revela o historico de inadimplencia de qualquer CPF entre provedores de internet. Score de risco em 2 segundos.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-10">
              <Button size="lg" onClick={goRegister} data-testid="button-hero-cta"
                className="bg-[var(--color-navy)] hover:bg-[var(--color-steel)] text-white px-8 gap-2 h-12 text-base font-bold rounded">
                Criar conta gratis <ArrowRight className="w-4 h-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => document.getElementById("como-funciona")?.scrollIntoView({behavior:"smooth"})}
                className="border-[var(--color-border)] text-[var(--color-muted)] px-8 h-12 text-base rounded" data-testid="button-hero-features">
                Ver como funciona
              </Button>
            </div>
            <div className="flex items-center gap-6 pt-6 border-t border-[var(--color-border)]">
              {[{v:"R$ 690",l:"prejuizo medio/inadimplente"},{v:"< 2s",l:"resultado da consulta"},{v:"Gratis",l:"consultas na sua base"}].map(s => (
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
                      <div className="w-8 h-8 bg-[var(--color-navy-bg)] rounded flex items-center justify-center">
                        <Search className="w-4 h-4 text-[var(--color-navy)]"/>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--color-muted)]">CPF consultado</p>
                        <p className="text-sm font-bold text-[var(--color-ink)]">041.179.***-40</p>
                      </div>
                    </div>
                    <span className="text-xs bg-[var(--color-danger-bg)] text-[var(--color-danger)] font-bold px-2.5 py-1 rounded-sm">CRITICO</span>
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
                        <span className="text-xs bg-[var(--color-gold-bg)] text-[var(--color-gold)] font-semibold px-2 py-0.5 rounded">2 equip. retidos</span>
                      </div>
                    </div>
                    <div className="ml-auto bg-[var(--color-danger)] text-white px-3 py-2 rounded text-center">
                      <p className="font-mono text-xs opacity-80 uppercase font-semibold">Sugestao</p>
                      <p className="text-sm font-black">REJEITAR</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-[var(--color-success-bg)] border border-[var(--color-border)] rounded p-3">
                      <p className="font-mono text-xs text-[var(--color-success)] font-bold uppercase mb-1">Seu Provedor</p>
                      <p className="text-xs font-bold text-[var(--color-ink)]">VALDIRENE ***</p>
                      <p className="text-xs text-[var(--color-danger)] mt-1">325 dias · R$ 350</p>
                      <span className="text-xs bg-[var(--color-success-bg)] text-[var(--color-success)] font-bold px-1.5 py-0.5 rounded mt-1 inline-block">Gratis</span>
                    </div>
                    <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded p-3">
                      <p className="font-mono text-xs text-[var(--color-muted)] font-bold uppercase mb-1">Outro Provedor</p>
                      <p className="text-xs font-bold text-[var(--color-ink)]">Dados restritos</p>
                      <p className="text-xs text-[var(--color-danger)] mt-1">1441 dias · R$400-600</p>
                      <span className="text-xs bg-[var(--color-navy-bg)] text-[var(--color-navy)] font-bold px-1.5 py-0.5 rounded mt-1 inline-block">1 credito</span>
                    </div>
                  </div>
                  <div className="bg-[var(--color-gold-bg)] border border-[var(--color-border)] rounded p-2.5 flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3 text-[var(--color-gold)] flex-shrink-0"/>
                    <p className="text-xs text-[var(--color-gold)] font-medium">2 equipamentos nao devolvidos — R$ 580 em risco</p>
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
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-muted)] whitespace-nowrap">Integra com</p>
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
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-muted)] mb-3">Simples assim</p>
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)]">3 passos. Resultado em <span className="font-mono">2</span> segundos.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {n:"01",icon:Database,title:"Configure em 15 min",desc:"Conecte seu ERP (IXC, SGP, MK Solutions) ou importe via planilha CSV. Sem instalacao, sem tecnico.",badge:"Setup: 15 min"},
              {n:"02",icon:Search,title:"Consulte antes de ativar",desc:"CPF, CNPJ ou endereco. Em menos de 2 segundos: score de risco, historico na rede, equipamentos retidos e sugestao de decisao.",badge:"< 2 segundos"},
              {n:"03",icon:Bell,title:"Receba alertas anti-fraude",desc:"Quando seu cliente inadimplente e consultado por outro provedor para migrar, voce recebe alerta imediato no WhatsApp.",badge:"Tempo real"},
            ].map((s,i) => (
              <div key={i} className="relative bg-[var(--color-surface)] border-[0.5px] border-[var(--color-border)] rounded p-6 hover:border-[var(--color-navy)] transition-all">
                <span className="font-mono text-6xl font-black text-[var(--color-tag-bg)] absolute top-4 right-5 leading-none select-none">{s.n}</span>
                <div className="relative">
                  <div className="w-12 h-12 bg-[var(--color-navy-bg)] border border-[var(--color-border)] rounded flex items-center justify-center mb-4">
                    <s.icon className="w-5 h-5 text-[var(--color-navy)]"/>
                  </div>
                  <span className="inline-block bg-[var(--color-navy-bg)] text-[var(--color-navy)] text-xs font-bold px-3 py-1 rounded-sm mb-3 border border-[var(--color-border)]">{s.badge}</span>
                  <h3 className="font-display font-semibold text-lg text-[var(--color-ink)] mb-2">{s.title}</h3>
                  <p className="text-sm text-[var(--color-muted)] leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FUNCIONALIDADES */}
      <section id="funcionalidades" className="py-20 bg-[var(--color-bg)]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-muted)] mb-3">Funcionalidades</p>
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)]">Tudo que voce precisa para proteger sua receita</h2>
            <p className="text-[var(--color-muted)] mt-3 max-w-xl mx-auto">Cada funcionalidade resolve um problema real do dia a dia do provedor.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {icon:Search, color:"bg-[var(--color-navy-bg)]", ic:"text-[var(--color-navy)]", title:"Consulta ISP", desc:"Score de risco em 2 segundos. Historico de inadimplencia em toda a rede colaborativa, equipamentos retidos e sugestao automatica de decisao."},
              {icon:Bell, color:"bg-[var(--color-danger-bg)]", ic:"text-[var(--color-danger)]", title:"Anti-Fraude", desc:"Alerta via WhatsApp em tempo real quando seu cliente inadimplente e consultado por outro provedor. Detecta migradores seriais."},
              {icon:Router, color:"bg-[var(--color-gold-bg)]", ic:"text-[var(--color-gold)]", title:"Controle de Equipamentos", desc:"Registre ONUs por modelo, serial e status. Rastreie equipamentos em comodato e identifique retencoes antes que virem prejuizo."},
              {icon:MapPin, color:"bg-[var(--color-navy-bg)]", ic:"text-[var(--color-navy)]", title:"Consulta por Endereco", desc:"Cruza CEP + numero em toda a rede. Detecta inadimplencia no imovel mesmo com CPF diferente — identifica golpes de familiares."},
              {icon:CreditCard, color:"bg-[var(--color-success-bg)]", ic:"text-[var(--color-success)]", title:"SPC Integrada", desc:"Score SPC, restricoes financeiras e protestos direto na plataforma. Negativacao sem contrato adicional com Serasa."},
              {icon:Zap, color:"bg-[var(--color-gold-bg)]", ic:"text-[var(--color-gold)]", title:"Analise com IA", desc:"Recomendacoes automaticas baseadas em inteligencia artificial: APROVAR, APROVAR COM RESSALVAS ou REJEITAR."},
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

      {/* PRECOS */}
      <section id="precos" className="py-20 bg-[var(--color-bg)]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-muted)] mb-3">Precos</p>
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)] mb-3">Simples, transparente, sem surpresa</h2>
            <p className="text-[var(--color-muted)] max-w-lg mx-auto text-sm">Consultas na sua propria base sao sempre gratuitas. Pague apenas pelo que usar na rede.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {/* Gratuito */}
            <div className="rounded p-6 flex flex-col border-[0.5px] border-[var(--color-border)] transition-all" data-testid="plan-0">
              <h3 className="font-display font-semibold text-lg text-[var(--color-ink)] mb-1">Gratuito</h3>
              <div className="mb-1 flex items-baseline gap-1">
                <span className="text-4xl font-mono font-black text-[var(--color-ink)]">R$ 0</span>
                <span className="text-sm text-[var(--color-muted)]">para sempre</span>
              </div>
              <p className="text-xs text-[var(--color-muted)] mb-6">Para conhecer a plataforma</p>
              <ul className="space-y-2.5 mb-6 flex-1">
                {["40 creditos para testar a rede","Consultas ilimitadas na sua base","Anti-fraude basico","Importacao via CSV","1 usuario"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                    <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] flex-shrink-0 mt-0.5"/>{f}
                  </li>
                ))}
              </ul>
              <Button onClick={goRegister}
                className="w-full font-bold h-11 rounded bg-[var(--color-bg)] hover:bg-[var(--color-tag-bg)] text-[var(--color-ink)] border border-[var(--color-border)]">
                Criar conta gratis
              </Button>
            </div>
            {/* Profissional */}
            <div className="rounded p-6 flex flex-col border-2 border-[var(--color-navy)] transition-all relative" data-testid="plan-1">
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[var(--color-navy)] text-white text-xs font-black px-4 py-1 rounded-sm">RECOMENDADO</div>
              <h3 className="font-display font-semibold text-lg text-[var(--color-ink)] mb-1">Profissional</h3>
              <div className="mb-1 flex items-baseline gap-1">
                <span className="text-4xl font-mono font-black text-[var(--color-ink)]">R$ 99</span>
                <span className="text-sm text-[var(--color-muted)]">/mes</span>
              </div>
              <p className="text-xs text-[var(--color-muted)] mb-6">Acesso completo para seu provedor</p>
              <ul className="space-y-2.5 mb-6 flex-1">
                {["Acesso completo a toda a rede","Todos os ERPs integrados","Usuarios ilimitados","Anti-fraude completo + WhatsApp","Consulta em lote (ate 500 CPFs)","Suporte prioritario"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                    <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] flex-shrink-0 mt-0.5"/>{f}
                  </li>
                ))}
              </ul>
              <Button onClick={goRegister}
                className="w-full font-bold h-11 rounded bg-[var(--color-navy)] hover:bg-[var(--color-steel)] text-white">
                Comecar agora
              </Button>
            </div>
          </div>

          {/* Per-query pricing */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-6 max-w-3xl mx-auto mt-8">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-muted)] mb-4">Custo por consulta</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                  <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] flex-shrink-0"/>Consulta na propria base
                </span>
                <span className="text-sm font-bold text-[var(--color-success)]">GRATIS</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                  <CheckCircle2 className="w-4 h-4 text-[var(--color-navy)] flex-shrink-0"/>Consulta colaborativa (outros provedores)
                </span>
                <span className="text-sm font-bold text-[var(--color-navy)]">R$ 1,00 / CPF</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                  <CheckCircle2 className="w-4 h-4 text-[var(--color-navy)] flex-shrink-0"/>Consulta SPC/Serasa
                </span>
                <span className="text-sm font-bold text-[var(--color-navy)]">R$ 4,00 / CPF</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-6 mt-8 text-xs text-[var(--color-muted)]">
            <span className="flex items-center gap-1.5"><Lock className="w-3 h-3"/>Sem contrato</span>
            <span className="flex items-center gap-1.5"><Shield className="w-3 h-3"/>Dados LGPD</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3 h-3"/>Cancele quando quiser</span>
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="py-20 bg-[var(--color-bg)]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-[var(--color-navy-bg)] text-[var(--color-navy)] text-xs font-semibold px-3 py-1.5 rounded-sm mb-4">
              <Star className="w-3.5 h-3.5 fill-[var(--color-navy)]" />
              O que os provedores dizem
            </div>
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)]">ISPs que protegem sua receita</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6" data-testid="testimonials-section">
            {[
              { quote: "Em dois meses, bloqueamos 14 tentativas de contrato de inadimplentes que ja estavam em fuga de outro provedor. Economia estimada: R$ 11.200 em equipamentos e mensalidades.", author: "Rodrigo M.", role: "Socio-fundador", city: "ISP — Minas Gerais", stars: 5 },
              { quote: "O cruzamento de endereco salvou nossa operacao duas vezes. CPF diferente, mesma casa, mesmo golpe. Sem o sistema, nunca identificariamos. Agora e protocolo antes de qualquer instalacao.", author: "Camila F.", role: "Gerente Operacional", city: "ISP — Interior de SP", stars: 5 },
              { quote: "Integrei com meu IXC Soft em 20 minutos. A sincronizacao automatica funciona sem falhas ha 8 meses. O alerta anti-fraude pagou o plano anual inteiro na primeira semana de uso.", author: "Tiago B.", role: "Diretor de TI", city: "ISP — Rio Grande do Sul", stars: 5 },
              { quote: "Testei o plano gratuito por 15 dias antes de assinar. Logo na primeira semana, identifiquei um cliente com historico em 3 provedores da regiao. Assino ate hoje.", author: "Marcela P.", role: "Supervisora de Atendimento", city: "ISP — Parana", stars: 5 },
              { quote: "Antes ficavamos sabendo da inadimplencia so depois de instalar. Agora consultamos todo CPF antes de agendar a visita tecnica. Zero instalacao desperdicada nos ultimos 4 meses.", author: "Fabio L.", role: "Proprietario", city: "ISP — Goias", stars: 5 },
              { quote: "A equipe de suporte respondeu minha duvida de integracao API em menos de 2 horas. Para quem tem sistema proprio, o webhook facilita muito — zero dependencia do ERP.", author: "Juliana S.", role: "Coordenadora de CRM", city: "ISP — Bahia", stars: 5 },
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

          {/* Comparativo */}
          <div className="mt-16">
            <h3 className="font-display font-semibold text-2xl text-[var(--color-ink)] text-center mb-8">Comparativo com o mercado</h3>
            <div className="overflow-x-auto">
              <table className="w-full bg-[var(--color-surface)] rounded border-[0.5px] border-[var(--color-border)] overflow-hidden">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="p-4 text-left text-sm font-semibold text-[var(--color-ink)] w-1/3">Funcionalidade</th>
                    <th className="p-4 text-center text-sm font-bold text-[var(--color-navy)] bg-[var(--color-navy-bg)]">Consulta ISP</th>
                    <th className="p-4 text-center text-sm font-semibold text-[var(--color-muted)]">SPC/Serasa</th>
                    <th className="p-4 text-center text-sm font-semibold text-[var(--color-muted)]">TeiaH Valid</th>
                    <th className="p-4 text-center text-sm font-semibold text-[var(--color-muted)]">ISP Score</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Consulta de CPF na rede ISP","yes","no","no","yes"],
                    ["Analise de risco por endereco","yes","no","yes","no"],
                    ["Anti-fraude — alerta de migracao","yes","no","no","yes"],
                    ["Controle de equipamentos em comodato","yes","no","no","no"],
                    ["Consulta SPC/Serasa integrada","yes","yes","no","no"],
                    ["Importacao via planilha CSV","yes","no","no","yes"],
                    ["Integracao ERP (IXC, SGP, MK)","yes","no","yes","yes"],
                    ["Plano gratuito disponivel","yes","no","no","yes"],
                  ].map((row,i) => (
                    <tr key={i} className={i%2===0?"bg-[var(--color-surface)]":"bg-[var(--color-bg)]"}>
                      <td className="p-4 text-sm text-[var(--color-ink)] font-medium border-b border-[var(--color-border)]">{row[0]}</td>
                      <td className="p-4 text-center bg-[var(--color-navy-bg)]/50 border-b border-[var(--color-border)]">
                        <span className={`text-sm font-bold ${row[1]==="yes"?"text-[var(--color-success)]":"text-[var(--color-border)]"}`}>{row[1]==="yes"?"✅":"❌"}</span>
                      </td>
                      {[row[2],row[3],row[4]].map((v,j) => (
                        <td key={j} className="p-4 text-center border-b border-[var(--color-border)]">
                          <span className={`text-sm ${v==="yes"?"text-[var(--color-success)]":"text-[var(--color-border)]"}`}>{v==="yes"?"✅":"❌"}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 bg-[var(--color-bg)]">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)]">Perguntas frequentes</h2>
          </div>
          <Accordion type="single" collapsible className="border-[0.5px] border-[var(--color-border)] rounded overflow-hidden" data-testid="faq-section">
            {[
              {q:"O que e a base de dados compartilhada?",a:"E uma base unica onde todos os provedores registram seus inadimplentes. Quando voce consulta um CPF, o sistema verifica em todos os provedores da rede e retorna dados anonimizados: dias de atraso, faixa de valor, equipamentos pendentes. Nunca dados pessoais identificaveis."},
              {q:"Consultas na minha propria base sao cobradas?",a:"Nao. Consultas de clientes do seu proprio provedor sao sempre gratuitas e ilimitadas. Creditos sao consumidos apenas quando a consulta retorna dados de outros provedores da rede — 1 credito por provedor externo encontrado."},
              {q:"Como funciona a analise por endereco?",a:"Voce informa o CEP e o numero da residencia. O sistema cruza em toda a rede de provedores e mostra o historico de inadimplencia associado aquele imovel — independente do CPF do morador atual. Isso detecta casos onde o inadimplente usa o CPF de um parente mas mora no mesmo local."},
              {q:"Quanto tempo leva para configurar?",a:"15 minutos para conectar um ERP (IXC, SGP, MK Solutions, Voalle, Hubsoft, RBX ISP) via API. Se preferir, importe sua base de inadimplentes via planilha CSV e comece a consultar imediatamente. Sem instalacao, sem tecnico."},
              {q:"Compartilhar dados de inadimplentes viola a LGPD?",a:"Nao. O sistema compartilha apenas indicadores anonimizados — dias de atraso, faixa de valor e se ha equipamentos pendentes. Nunca nome, CPF, endereco ou dados pessoais identificaveis. O sistema foi construido em conformidade com a LGPD."},
              {q:"E a Resolucao Anatel 765 — como ela afeta meu provedor?",a:"A Resolucao 765 obriga a notificar o cliente em D+15 e aguardar ate D+60 antes de cancelar. Sao 75 dias que o inadimplente pode usar para contratar outro provedor sem pagar. Com o anti-fraude, voce recebe alerta em tempo real quando ele tenta migrar — e pode agir antes que a ONU saia da sua mao."},
              {q:"Quais ERPs sao suportados na integracao automatica?",a:"IXC Soft, SGP, MK Solutions, Hubsoft, Voalle, RBX ISP e outros. Solicitacoes para novos ERPs sao avaliadas semanalmente — basta abrir um chamado pelo painel."},
            ].map((faq, i) => (
              <AccordionItem key={i} value={`faq-${i}`} className="border-b border-[var(--color-border)] last:border-0" data-testid={`faq-${i}`}>
                <AccordionTrigger className="px-6 py-5 text-sm font-semibold text-[var(--color-ink)] hover:no-underline">{faq.q}</AccordionTrigger>
                <AccordionContent className="px-6 pb-5 text-sm text-[var(--color-muted)] leading-relaxed">{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="py-20 bg-[var(--color-navy)]">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-semibold px-3 py-1.5 rounded-sm mb-8 border border-white/20">
            <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"/>
            Comeca gratis — sem cartao de credito
          </div>
          <h2 className="font-display font-light text-4xl sm:text-5xl text-white mb-5 leading-tight">
            Saiba quem nao vai pagar<br/>
            <span className="text-blue-200">antes de instalar.</span>
          </h2>
          <p className="text-blue-100 mb-10 text-lg max-w-xl mx-auto leading-relaxed">
            Cadastro em 2 minutos. 40 creditos gratuitos para testar a rede.<br/>
            Consultas na sua base sempre gratuitas.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8">
            <Button size="lg" onClick={goRegister} data-testid="button-cta-bottom"
              className="bg-white text-[var(--color-navy)] hover:bg-[var(--color-navy-bg)] px-10 gap-2 h-12 text-base font-black rounded">
              Criar conta gratis <ArrowRight className="w-4 h-4"/>
            </Button>
            <Button size="lg" variant="outline" onClick={goLogin} data-testid="button-login-bottom"
              className="border-white/30 text-white hover:bg-white/10 px-8 h-12 text-base rounded">
              Ja tenho conta — Login
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-5 text-sm text-blue-100">
            <span className="flex items-center gap-2"><span className="text-white">✓</span>Gratuito na base propria</span>
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
            Consulta ISP — Plataforma colaborativa de analise de credito para provedores de internet do Brasil
          </p>
        </div>
      </footer>

      <LandingChatbot onNavigate={setLocation}/>
    </div>
  );
}
