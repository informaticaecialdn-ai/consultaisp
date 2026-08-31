import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import LandingChatbot from "@/components/landing-chatbot";
import Marca, { SimboloConsultaISP } from "@/components/marca";
import { PLAN_PRICES, PLAN_CREDITS, CUSTO_EM_CREDITOS } from "@shared/schema";
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
        <div className="max-w-[1800px] mx-auto px-6 h-16 flex items-center justify-between">
          <Marca tamanho={30} />
          <div className="hidden lg:flex items-center gap-7 text-sm text-[var(--color-muted)]">
            {[["Como funciona","como-funciona"],["Funcionalidades","funcionalidades"],["Preços","precos"],["FAQ","faq"]].map(([l,id]) => (
              <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({behavior:"smooth"})}
                className="cursor-pointer hover:text-[var(--color-brand)] transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 rounded-sm">{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="hidden lg:inline-flex text-[var(--color-muted)] hover:text-[var(--color-ink)] text-sm h-9"
              onClick={goLogin} data-testid="button-landing-login">Login</Button>
            <Button className="hidden lg:inline-flex bg-[var(--color-brand)] hover:bg-[var(--color-steel)] text-[var(--text-on-brand)] text-sm h-9 px-5 font-semibold rounded"
              onClick={goRegister} data-testid="button-landing-cadastro">Começar grátis</Button>
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="lg:hidden text-[var(--color-muted)] hover:text-[var(--color-ink)]" data-testid="button-mobile-menu">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 bg-[var(--color-surface)] border-l border-[var(--color-border)]">
                <nav className="flex flex-col gap-4 mt-8">
                  {[["Como funciona","como-funciona"],["Funcionalidades","funcionalidades"],["Preços","precos"],["FAQ","faq"]].map(([l,id]) => (
                    <button key={id} onClick={() => { setMobileMenuOpen(false); document.getElementById(id)?.scrollIntoView({behavior:"smooth"}); }}
                      className="cursor-pointer text-left text-sm font-medium text-[var(--color-ink)] hover:text-[var(--color-brand)] transition-colors py-2 border-b border-[var(--color-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]">{l}</button>
                  ))}
                  <Button className="w-full bg-[var(--color-brand)] hover:bg-[var(--color-steel)] text-[var(--text-on-brand)] text-sm h-10 font-semibold rounded mt-2"
                    onClick={() => { setMobileMenuOpen(false); goLogin(); }}>Login</Button>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-16 bg-[var(--color-bg)]">
        <div className="max-w-[1800px] mx-auto px-6 py-10 sm:py-14 lg:py-16 grid lg:grid-cols-2 gap-10 lg:gap-12 items-center">
          {/* `min-w-0` nao e detalhe: item de grid nasce com `min-width: auto`,
              que o impede de encolher abaixo do proprio conteudo. Em 375px a
              linha de botoes tem 427px de min-content e esticava a coluna
              inteira para 407px — o titulo saia cortado, lia-se "Consulte o
              CP". Com o zero a faixa volta aos 327px que cabem na tela. */}
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 bg-[var(--color-brand-bg)] border border-[var(--color-border)] text-[var(--color-brand)] text-xs font-semibold px-3 py-1.5 rounded-sm mb-6">
              <div className="w-1.5 h-1.5 bg-[var(--color-brand)] rounded-full animate-pulse" />
              Plataforma Colaborativa de Credito para ISPs
            </div>
            {/* Os tamanhos sao ARBITRARIOS de proposito — nao troque por
                `text-3xl sm:text-4xl lg:text-5xl`.

                `client/src/index.css` marca toda utilitaria `.text-*` com
                `!important`, e repete o bloco com especificidade maior sob
                `[data-testid="landing-page"]`. Como `!important` vence
                independentemente da ordem, a classe SEM prefixo mata as
                variantes: com os presets este titulo ficava travado em 36px de
                768px para cima — `lg:text-5xl` nunca aplicava.

                Valor arbitrario gera um seletor que aquelas regras nao casam
                (`.lg\:text-\[3rem\]`), entao a escada volta a funcionar. Medido
                depois da troca: 30px em 390, 36px em 768, 48px em 1440.

                A raiz e o `!important` do index.css, que afeta o app inteiro e
                merece decisao propria. */}
            <h1 className="font-display font-light text-[1.875rem] sm:text-[2.25rem] lg:text-[3rem] text-[var(--color-ink)] leading-[1.08] lg:leading-[1.05] tracking-tight text-balance mb-5" data-testid="text-hero-title">
              Consulte o CPF antes de instalar.<br/>
              <span className="text-[var(--color-brand)]">Evite perdas antes que acontecam.</span>
            </h1>
            <p className="text-lg text-[var(--color-muted)] leading-relaxed mb-8 max-w-[60ch] lg:max-w-[38rem]">
              Score de risco em tempo real, direto do ERP de toda a rede de provedores. Saiba se o cliente ja deixou dividas em outro provedor antes de liberar a instalacao.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-10">
              <Button size="lg" onClick={goRegister} data-testid="button-hero-cta"
                className="bg-[var(--color-brand)] hover:bg-[var(--color-steel)] text-[var(--text-on-brand)] w-full sm:w-auto px-5 sm:px-8 gap-2 h-12 text-base font-bold rounded whitespace-normal sm:whitespace-nowrap">
                Proteger Meu Provedor — Gratis <ArrowRight className="w-4 h-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => document.getElementById("como-funciona")?.scrollIntoView({behavior:"smooth"})}
                className="border-[var(--color-border)] text-[var(--color-muted)] w-full sm:w-auto px-5 sm:px-8 h-12 text-base rounded" data-testid="button-hero-features">
                Ver como funciona
              </Button>
            </div>
            <div className="flex items-center gap-6 pt-6 border-t border-[var(--color-border)]">
              {[{v:"R$ 690",l:"prejuizo medio evitado"},{v:"ao vivo",l:"consulta direto no ERP"},{v:"Gratis",l:"consultas na propria base"}].map(s => (
                <div key={s.l}><p className="text-xl font-mono font-black text-[var(--color-ink)]">{s.v}</p><p className="text-xs text-[var(--color-muted)] mt-0.5">{s.l}</p></div>
              ))}
            </div>
          </div>

          {/* Mockup hero */}
          <div className="relative hidden lg:block">
            <div className="bg-[var(--surface-3)] rounded p-2 border border-[var(--color-border)]">
              <div className="bg-[#1A1922] rounded overflow-hidden">
                <div className="flex items-center gap-1.5 px-4 py-3 bg-[#201F2A]">
                  <div className="w-3 h-3 rounded-full bg-[var(--color-danger)]"/>
                  <div className="w-3 h-3 rounded-full bg-[var(--color-gold)]"/>
                  <div className="w-3 h-3 rounded-full bg-[var(--color-success)]"/>
                  <div className="flex-1 bg-[#2F2D3A] rounded-md mx-3 px-3 py-1 text-xs text-[#918DA1]">
                    consultaisp.com.br/consulta-isp
                  </div>
                </div>
                <div className="bg-[var(--color-bg)] p-5">
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--color-border)]">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-[var(--color-brand-bg)] rounded flex items-center justify-center">
                        <Search className="w-4 h-4 text-[var(--color-brand)]"/>
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
                        <span className="text-sm font-mono font-black text-[var(--color-danger)]">152</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--color-muted)] mb-1">Score ISP / 1000</p>
                      <div className="flex gap-2">
                        <span className="text-xs bg-[var(--color-danger-bg)] text-[var(--color-danger)] font-semibold px-2 py-0.5 rounded">2 provedores</span>
                        <span className="text-xs bg-[var(--color-gold-bg)] text-[var(--color-gold)] font-semibold px-2 py-0.5 rounded">2 equip. retidos</span>
                      </div>
                    </div>
                    <div className="ml-auto bg-[var(--color-danger)] text-[var(--text-on-brand)] px-3 py-2 rounded text-center">
                      <p className="font-mono text-xs opacity-80 uppercase font-semibold">Sugestão</p>
                      <p className="text-sm font-black">REJEITAR</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-[var(--color-success-bg)] border border-[var(--color-border)] rounded p-3">
                      <p className="font-mono text-xs text-[var(--color-success)] font-bold uppercase mb-1">Seu Provedor</p>
                      <p className="text-xs font-bold text-[var(--color-ink)]">VALDIRENE ***</p>
                      <p className="text-xs text-[var(--color-danger)] mt-1">325 dias · R$ 350</p>
                      <span className="text-xs bg-[var(--color-success-bg)] text-[var(--color-success)] font-bold px-1.5 py-0.5 rounded mt-1 inline-block">Grátis</span>
                    </div>
                    <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded p-3">
                      <p className="font-mono text-xs text-[var(--color-muted)] font-bold uppercase mb-1">Outro Provedor</p>
                      <p className="text-xs font-bold text-[var(--color-ink)]">Dados restritos</p>
                      <p className="text-xs text-[var(--color-danger)] mt-1">1441 dias · R$400-600</p>
                      <span className="text-xs bg-[var(--color-brand-bg)] text-[var(--color-brand)] font-bold px-1.5 py-0.5 rounded mt-1 inline-block">1 crédito</span>
                    </div>
                  </div>
                  <div className="bg-[var(--color-gold-bg)] border border-[var(--color-border)] rounded p-2.5 flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3 text-[var(--color-gold)] flex-shrink-0"/>
                    <p className="text-xs text-[var(--color-gold)] font-medium">2 equipamentos não devolvidos — R$ 580 em risco</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-3 -left-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse"/>
                <span className="text-xs font-semibold text-[var(--color-ink)]">Consulta ao vivo na rede</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BARRA ERPs */}
      <section className="bg-[var(--color-surface)] border-y border-[var(--color-border)] py-6">
        <div className="max-w-[1800px] mx-auto px-6">
          <p className="text-center font-mono text-xs uppercase tracking-[0.15em] text-[var(--color-muted)] mb-5">Integra com os principais ERPs do mercado ISP</p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            {[
              { name: "IXC Soft", color: "var(--cat-blue)" },
              { name: "MK Solutions", color: "var(--cat-green)" },
              { name: "Hubsoft", color: "var(--cat-violet)" },
              { name: "SGP", color: "var(--cat-orange)" },
              { name: "Voalle", color: "var(--cat-teal)" },
              { name: "RBX ISP", color: "var(--cat-red)" },
            ].map(erp => (
              <div key={erp.name} className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-[var(--color-brand)]/30 transition-colors">
                <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: erp.color }}>
                  <Router className="w-3.5 h-3.5 text-[var(--text-on-brand)]" />
                </div>
                <span className="text-sm font-semibold text-[var(--color-ink)]">{erp.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section id="como-funciona" className="py-12 sm:py-16 lg:py-20 bg-[var(--color-bg)]">
        <div className="max-w-[1800px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-muted)] mb-3">Simples assim</p>
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)]">3 passos. Resposta antes de instalar.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {n:"01",icon:Database,title:"Configure em 15 min",desc:"Conecte seu ERP (IXC, MK Solutions, SGP, Hubsoft, Voalle, RBX ISP) via API. Sem instalacao, sem tecnico.",badge:"Setup: 15 min"},
              {n:"02",icon:Search,title:"Consulte antes de ativar",desc:"CPF, CNPJ ou endereço. Score de risco, histórico na rede, equipamentos retidos e sugestão de decisão — buscados ao vivo no ERP dos parceiros.",badge:"Tempo real"},
              {n:"03",icon:Bell,title:"Receba alertas anti-fraude",desc:"Quando seu cliente inadimplente é consultado por outro provedor para migrar, você recebe alerta imediato por e-mail e webhook.",badge:"Tempo real"},
            ].map((s,i) => (
              <div key={i} className="relative bg-[var(--color-surface)] border border-[var(--border)] rounded p-6 hover:border-[var(--color-brand)] transition-all">
                <span className="font-mono text-6xl font-black text-[var(--color-tag-bg)] absolute top-4 right-5 leading-none select-none">{s.n}</span>
                <div className="relative">
                  <div className="w-12 h-12 bg-[var(--color-brand-bg)] border border-[var(--color-border)] rounded flex items-center justify-center mb-4">
                    <s.icon className="w-5 h-5 text-[var(--color-brand)]"/>
                  </div>
                  <span className="inline-block bg-[var(--color-brand-bg)] text-[var(--color-brand)] text-xs font-bold px-3 py-1 rounded-sm mb-3 border border-[var(--color-border)]">{s.badge}</span>
                  <h3 className="font-display font-semibold text-lg text-[var(--color-ink)] mb-2">{s.title}</h3>
                  <p className="text-sm text-[var(--color-muted)] leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FUNCIONALIDADES */}
      <section id="funcionalidades" className="py-12 sm:py-16 lg:py-20 bg-[var(--color-bg)]">
        <div className="max-w-[1800px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-muted)] mb-3">Funcionalidades</p>
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)]">Tudo que você precisa para proteger sua receita</h2>
            <p className="text-[var(--color-muted)] mt-3 max-w-xl mx-auto">Cada funcionalidade resolve um problema real do dia a dia do provedor.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {icon:Search, color:"bg-[var(--color-brand-bg)]", ic:"text-[var(--color-brand)]", title:"Consulta ISP", desc:"Score de risco 0–1000 em tempo real. Histórico de inadimplência em toda a rede colaborativa, equipamentos retidos e sugestão automática de decisão."},
              {icon:Search, color:"bg-[var(--color-brand-bg)]", ic:"text-[var(--color-brand)]", title:"Consulta Cadastral", desc:"Dados do CPF ou CNPJ direto na fonte: nome, situação na Receita, endereços, telefones, sócios, processos e capacidade de pagamento. Serve para confirmar quem é o cliente antes de instalar."},
              {icon:Bell, color:"bg-[var(--color-danger-bg)]", ic:"text-[var(--color-danger)]", title:"Anti-Fraude", desc:"Alerta por e-mail e webhook no instante em que seu cliente inadimplente é consultado por outro provedor. Detecta migradores seriais."},
              {icon:Router, color:"bg-[var(--color-gold-bg)]", ic:"text-[var(--color-gold)]", title:"Controle de Equipamentos", desc:"Registre ONUs por modelo, serial e status. Rastreie equipamentos em comodato e identifique retenções antes que virem prejuízo."},
              {icon:MapPin, color:"bg-[var(--color-brand-bg)]", ic:"text-[var(--color-brand)]", title:"Consulta por Endereço", desc:"Cruza CEP + número em toda a rede. Detecta inadimplência no imóvel mesmo com CPF diferente — identifica golpes de familiares."},
              {icon:CreditCard, color:"bg-[var(--color-success-bg)]", ic:"text-[var(--color-success)]", title:"SPC Integrada", desc:"Score SPC, restrições financeiras e protestos direto na plataforma. Negativação sem contrato adicional com Serasa."},
              {icon:Zap, color:"bg-[var(--color-gold-bg)]", ic:"text-[var(--color-gold)]", title:"Análise com IA", desc:"Recomendação automática a partir do score: APROVAR, APROVAR COM ATENÇÃO, ANÁLISE MANUAL ou REJEITAR — com o parecer escrito por IA."},
            ].map((f,i) => (
              <div key={i} className="bg-[var(--color-surface)] border border-[var(--border)] rounded p-5 hover:border-[var(--color-brand)] transition-all">
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
      <section id="precos" className="py-12 sm:py-16 lg:py-20 bg-[var(--color-bg)]">
        <div className="max-w-[1800px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-muted)] mb-3">Preços</p>
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)] mb-3">Simples, transparente, sem surpresa</h2>
            <p className="text-[var(--color-muted)] max-w-lg mx-auto text-sm">Consultas na sua própria base são sempre gratuitas. Pague apenas pelo que usar na rede.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {/* Gratuito */}
            <div className="rounded p-6 flex flex-col border border-[var(--border)] transition-all" data-testid="plan-0">
              <h3 className="font-display font-semibold text-lg text-[var(--color-ink)] mb-1">Gratuito</h3>
              <div className="mb-1 flex items-baseline gap-1">
                <span className="text-4xl font-mono font-black text-[var(--color-ink)]">R$ 0</span>
                <span className="text-sm text-[var(--color-muted)]">para sempre</span>
              </div>
              <p className="text-xs text-[var(--color-muted)] mb-6">Para conhecer a plataforma</p>
              <ul className="space-y-2.5 mb-6 flex-1">
                {[`${PLAN_CREDITS.free.isp} creditos para testar a rede`,"Consultas ilimitadas na sua base","Anti-fraude basico","Importacao via CSV"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                    <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] flex-shrink-0 mt-0.5"/>{f}
                  </li>
                ))}
              </ul>
              <Button onClick={goRegister}
                className="w-full font-bold h-11 rounded bg-[var(--color-bg)] hover:bg-[var(--color-tag-bg)] text-[var(--color-ink)] border border-[var(--color-border)]">
                Criar conta grátis
              </Button>
            </div>
            {/* Profissional */}
            <div className="rounded p-6 flex flex-col border-2 border-[var(--color-brand)] transition-all relative" data-testid="plan-1">
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[var(--color-brand)] text-[var(--text-on-brand)] text-xs font-black px-4 py-1 rounded-sm">RECOMENDADO</div>
              <h3 className="font-display font-semibold text-lg text-[var(--color-ink)] mb-1">Profissional</h3>
              <div className="mb-1 flex items-baseline gap-1">
                <span className="text-4xl font-mono font-black text-[var(--color-ink)]">R$ {PLAN_PRICES.pro}</span>
                <span className="text-sm text-[var(--color-muted)]">/mes</span>
              </div>
              <p className="text-xs text-[var(--color-muted)] mb-6">Acesso completo para seu provedor</p>
              <ul className="space-y-2.5 mb-6 flex-1">
                {[`${PLAN_CREDITS.pro.isp} creditos ISP + ${PLAN_CREDITS.pro.spc} SPC por mes`,"Os 6 ERPs integrados","Anti-fraude por e-mail e webhook","Consulta cadastral (BigDataCorp)","Consulta SPC Brasil","Cruzamento por endereco"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                    <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] flex-shrink-0 mt-0.5"/>{f}
                  </li>
                ))}
              </ul>
              <Button onClick={goRegister}
                className="w-full font-bold h-11 rounded bg-[var(--color-brand)] hover:bg-[var(--color-steel)] text-[var(--text-on-brand)]">
                Começar agora
              </Button>
            </div>
          </div>

          {/* Per-query pricing */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-6 max-w-3xl mx-auto mt-8">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-muted)] mb-4">Custo por consulta</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                  <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] flex-shrink-0"/>Consulta na própria base
                </span>
                <span className="text-sm font-bold text-[var(--color-success)]">GRÁTIS</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                  <CheckCircle2 className="w-4 h-4 text-[var(--color-brand)] flex-shrink-0"/>Consulta ISP (rede colaborativa)
                </span>
                <span className="text-sm font-bold text-[var(--color-brand)]">{CUSTO_EM_CREDITOS.isp} credito por provedor com registro</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                  <CheckCircle2 className="w-4 h-4 text-[var(--color-brand)] flex-shrink-0"/>Consulta cadastral (dados do CPF/CNPJ)
                </span>
                <span className="text-sm font-bold text-[var(--color-brand)]">{CUSTO_EM_CREDITOS.cadastral} creditos</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                  <CheckCircle2 className="w-4 h-4 text-[var(--color-brand)] flex-shrink-0"/>Consulta SPC Brasil
                </span>
                <span className="text-sm font-bold text-[var(--color-brand)]">{CUSTO_EM_CREDITOS.spc} creditos</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-8 text-xs text-[var(--color-muted)]">
            <span className="flex items-center gap-1.5"><Lock className="w-3 h-3 shrink-0"/>Sem contrato</span>
            <span className="flex items-center gap-1.5"><Shield className="w-3 h-3 shrink-0"/>Dados LGPD</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3 h-3 shrink-0"/>Cancele quando quiser</span>
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="py-12 sm:py-16 lg:py-20 bg-[var(--color-bg)]">
        <div className="max-w-[1800px] mx-auto px-6">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-[var(--color-brand-bg)] text-[var(--color-brand)] text-xs font-semibold px-3 py-1.5 rounded-sm mb-4">
              <Star className="w-3.5 h-3.5 fill-[var(--color-brand)]" />
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
              { quote: "Antes ficávamos sabendo da inadimplência só depois de instalar. Agora consultamos todo CPF antes de agendar a visita técnica. Zero instalação desperdiçada nos últimos 4 meses.", author: "Fábio L.", role: "Proprietário", city: "ISP — Goiás", stars: 5 },
              { quote: "A equipe de suporte respondeu minha dúvida de integração API em menos de 2 horas. Para quem tem sistema próprio, o webhook facilita muito — zero dependência do ERP.", author: "Juliana S.", role: "Coordenadora de CRM", city: "ISP — Bahia", stars: 5 },
            ].map((t, i) => (
              <div key={i} className="bg-[var(--color-surface)] rounded border border-[var(--border)] p-6 flex flex-col gap-4" data-testid={`testimonial-${i}`}>
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
              <table className="w-full bg-[var(--color-surface)] rounded border border-[var(--border)] overflow-hidden">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="p-4 text-left text-sm font-semibold text-[var(--color-ink)] w-1/3">Funcionalidade</th>
                    <th className="p-4 text-center text-sm font-bold text-[var(--color-brand)] bg-[var(--color-brand-bg)]">Consulta ISP</th>
                    <th className="p-4 text-center text-sm font-semibold text-[var(--color-muted)]">SPC/Serasa</th>
                    <th className="p-4 text-center text-sm font-semibold text-[var(--color-muted)]">TeiaH Valid</th>
                    <th className="p-4 text-center text-sm font-semibold text-[var(--color-muted)]">ISP Score</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Consulta de CPF na rede ISP","yes","no","no","yes"],
                    ["Análise de risco por endereço","yes","no","yes","no"],
                    ["Anti-fraude — alerta de migração","yes","no","no","yes"],
                    ["Controle de equipamentos em comodato","yes","no","no","no"],
                    ["Consulta SPC/Serasa integrada","yes","yes","no","no"],
                    ["Importação via planilha CSV","yes","no","no","yes"],
                    ["Integração ERP (IXC, SGP, MK)","yes","no","yes","yes"],
                    ["Plano gratuito disponível","yes","no","no","yes"],
                  ].map((row,i) => (
                    <tr key={i} className={i%2===0?"bg-[var(--color-surface)]":"bg-[var(--color-bg)]"}>
                      <td className="p-4 text-sm text-[var(--color-ink)] font-medium border-b border-[var(--color-border)]">{row[0]}</td>
                      <td className="p-4 text-center bg-[var(--color-brand-bg)]/50 border-b border-[var(--color-border)]">
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
      <section id="faq" className="py-12 sm:py-16 lg:py-20 bg-[var(--color-bg)]">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="font-display font-light text-4xl text-[var(--color-ink)]">Perguntas frequentes</h2>
          </div>
          <Accordion type="single" collapsible className="border border-[var(--border)] rounded overflow-hidden" data-testid="faq-section">
            {[
              {q:"O que é a base de dados compartilhada?",a:"É uma base única onde todos os provedores registram seus inadimplentes. Quando você consulta um CPF, o sistema verifica em todos os provedores da rede e retorna dados anonimizados: dias de atraso, faixa de valor, equipamentos pendentes. Nunca dados pessoais identificáveis."},
              {q:"Consultas na minha própria base são cobradas?",a:"Não. Consultas de clientes do seu próprio provedor são sempre gratuitas e ilimitadas. Créditos são consumidos apenas quando a consulta retorna dados de outros provedores da rede — 1 crédito por provedor externo encontrado."},
              {q:"Como funciona a análise por endereço?",a:"Você informa o CEP e o número da residência. O sistema cruza em toda a rede de provedores e mostra o histórico de inadimplência associado àquele imóvel — independente do CPF do morador atual. Isso detecta casos onde o inadimplente usa o CPF de um parente mas mora no mesmo local."},
              {q:"Quanto tempo leva para configurar?",a:"15 minutos para conectar um ERP (IXC, MK Solutions, SGP, Hubsoft, Voalle, RBX ISP) via API. A consulta vai ao ERP AO VIVO, entao o dado da decisao e sempre o de agora. Em paralelo, uma varredura completa da sua base roda tres vezes por semana e alimenta o mapa de inadimplencia. Sem instalacao, sem tecnico."},
              {q:"Compartilhar dados de inadimplentes viola a LGPD?",a:"Não. O sistema compartilha apenas indicadores anonimizados — dias de atraso, faixa de valor e se há equipamentos pendentes. Nunca nome, CPF, endereço ou dados pessoais identificáveis. O sistema foi construído em conformidade com a LGPD."},
              {q:"E a Resolução Anatel 765 — como ela afeta meu provedor?",a:"A Resolução 765 obriga a notificar o cliente em D+15 e aguardar até D+60 antes de cancelar. São 75 dias que o inadimplente pode usar para contratar outro provedor sem pagar. Com o anti-fraude, você recebe alerta em tempo real quando ele tenta migrar — e pode agir antes que a ONU saia da sua mão."},
              {q:"Quais ERPs são suportados na integração automática?",a:"IXC Soft, SGP, MK Solutions, Hubsoft, Voalle, RBX ISP e outros. Solicitações para novos ERPs são avaliadas semanalmente — basta abrir um chamado pelo painel."},
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
      <section className="py-12 sm:py-16 lg:py-20 bg-[var(--color-brand)]">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 bg-[var(--text-on-brand)]/10 text-[var(--text-on-brand)] text-xs font-semibold px-3 py-1.5 rounded-sm mb-8 border border-[var(--text-on-brand)]/25">
            <div className="w-1.5 h-1.5 bg-[var(--text-on-brand)] rounded-full animate-pulse"/>
            Começa grátis — sem cartão de crédito
          </div>
          <h2 className="font-display font-light text-[2.25rem] sm:text-[3rem] text-[var(--text-on-brand)] mb-5 leading-tight">
            Saiba quem não vai pagar<br/>
            <span className="text-[var(--text-on-brand)]/75">antes de instalar.</span>
          </h2>
          <p className="text-[var(--text-on-brand)]/85 mb-10 text-lg max-w-xl mx-auto leading-relaxed">
            Cadastro em 2 minutos. 40 créditos gratuitos para testar a rede.<br/>
            Consultas na sua base sempre gratuitas.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8">
            <Button size="lg" onClick={goRegister} data-testid="button-cta-bottom"
              className="bg-white text-[var(--color-brand)] hover:bg-[var(--color-brand-bg)] px-10 gap-2 h-12 text-base font-black rounded">
              Criar conta grátis <ArrowRight className="w-4 h-4"/>
            </Button>
            <Button size="lg" variant="outline" onClick={goLogin} data-testid="button-login-bottom"
              className="border-[var(--text-on-brand)]/35 text-[var(--text-on-brand)] hover:bg-[var(--text-on-brand)]/10 px-8 h-12 text-base rounded">
              Já tenho conta — Login
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-5 text-sm text-[var(--text-on-brand)]/85">
            <span className="flex items-center gap-2"><span className="text-[var(--text-on-brand)]">✓</span>Gratuito na base própria</span>
            <span className="flex items-center gap-2"><span className="text-[var(--text-on-brand)]">✓</span>Sem contrato de fidelidade</span>
            <span className="flex items-center gap-2"><span className="text-[var(--text-on-brand)]">✓</span>LGPD compliant</span>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-[#1A1714] py-8">
        <div className="max-w-[1800px] mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <SimboloConsultaISP tamanho={26} />
            <span className="text-white font-bold text-sm">Consulta ISP</span>
            <span className="text-[#918DA1] text-xs hidden sm:inline">Base colaborativa para provedores</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-[#918DA1]">
            <span className="flex items-center gap-1"><Lock className="w-3 h-3 shrink-0"/>Dados criptografados</span>
            <span className="flex items-center gap-1"><Shield className="w-3 h-3 shrink-0"/>Privacidade LGPD</span>
          </div>
        </div>
        <div className="max-w-[1800px] mx-auto px-6 mt-5 pt-5 border-t border-[#2F2D3A]">
          <p className="text-xs text-[#918DA1] text-center">
            Consulta ISP — Plataforma colaborativa de análise de crédito para provedores de internet do Brasil
          </p>
        </div>
      </footer>

      <LandingChatbot onNavigate={setLocation}/>
    </div>
  );
}
