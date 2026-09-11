/**
 * Landing page publica — desenho "/consulta.isp" (10/09/2026).
 *
 * O HTML de origem e o standalone que o dono aprovou; o que mudou aqui e o
 * que um arquivo solto nao consegue fazer:
 *
 * 1. **CSS ESCOPADO.** O desenho declara `--bg`, `--surface`, `--ink` — nomes
 *    que colidem com os tokens do sistema em `index.css`. Se entrassem por
 *    `:root`, TODA tela do app viraria creme. Por isso a folha inteira vive
 *    sob `.lp` (`landingpage.css`), e o app la dentro nao existe.
 * 2. **PRECO VEM DO SERVIDOR.** O standalone traz "R$ 0" e "R$ 99" no texto.
 *    Numero de vitrine que diverge do numero cobrado e a forma mais rapida de
 *    perder um cliente — entao o valor e os creditos inclusos saem de
 *    `GET /api/public/precos`, e o custo por consulta de `CUSTO_EM_CREDITOS`.
 * 3. **CTA leva a algum lugar.** No standalone os botoes apontam para `#cta`;
 *    aqui vao para `/login?mode=register` e `/login`, com href real (abrir em
 *    nova aba funciona) e navegacao pelo wouter no clique.
 * 4. O splash preto e o beacon do Cloudflare do arquivo original NAO vieram.
 */
import { useEffect, useState, type MouseEvent } from "react";
import { useLocation } from "wouter";
import LandingChatbot from "@/components/landing-chatbot";
import { CUSTO_EM_CREDITOS } from "@shared/schema";
import { usePrecosPublicos, planoPorChave, precoCurto, type PrecoDePlano } from "@/hooks/use-precos";
import "./landingpage.css";

/**
 * A landing só leva ao CADASTRO — não existe botão de login aqui (dono,
 * 11/09/2026). Cada provedor entra exclusivamente pelo endereço dele
 * (seuprovedor.consultaisp.com.br): na raiz o servidor recusa o login de
 * provedor (`hostPertenceAoProvider`, server/routes/auth.routes.ts) com
 * "Email ou senha incorretos", sem dizer mais para não revelar que a conta
 * existe. Um "Login" nesta página levava o provedor a errar sem ter errado.
 */
const CADASTRO = "/login?mode=register";
const WHATSAPP = "https://wa.me/5543991191100";

/** Um giro do banner do hero. O original usava 7s e reiniciava a cada clique. */
const GIRO_MS = 7000;

type Slide = { pill: string; strong: string; light: string; lead: string };

const SLIDES: Slide[] = [
  {
    pill: "O bureau de crédito dos provedores de internet",
    strong: "Saiba quem não vai pagar",
    light: "antes de instalar",
    lead: "O Consulta ISP é a base colaborativa entre provedores de internet. Consulte o CPF, o CNPJ ou o endereço e receba, em tempo real via API, o histórico de inadimplência na rede, os equipamentos retidos e uma sugestão de decisão — antes de liberar a instalação.",
  },
  {
    pill: "Cruzamento por endereço",
    strong: "CPF novo,",
    light: "mesma casa, mesmo calote",
    lead: "O golpe mais comum do setor troca o titular e mantém o imóvel. O Consulta ISP cruza CEP e número em toda a rede: se houver outros devedores naquele endereço, o sistema avisa antes da instalação.",
  },
  {
    pill: "Anti-fraude na migração",
    strong: "Ele tentou migrar.",
    light: "Você soube na hora.",
    lead: "Quando o seu inadimplente é consultado por outro provedor da rede, o alerta chega por e-mail e webhook no mesmo instante. Dá tempo de agir antes que a ONU saia da sua mão.",
  },
  {
    pill: "Consulta anônima por hash",
    strong: "Consulta anônima,",
    light: "resposta objetiva",
    lead: "Cada consulta é criada com um hash aleatório próprio. O resultado diz que existe dívida, há quanto tempo e em que faixa de valor — nunca em qual provedor. E o seu nome também não aparece para ninguém.",
  },
  {
    pill: "Inadimplência",
    strong: "O problema começa",
    light: "antes do primeiro atraso",
    lead: "Quando a fatura atrasa, o prejuízo já aconteceu: a ONU saiu do estoque, o técnico foi pago e a Resolução 765 dá ao cliente 75 dias antes do corte. A decisão que muda o resultado é a da hora da venda.",
  },
  {
    pill: "Novo módulo · Cobrança",
    strong: "A cobrança inteira",
    light: "em um quadro só",
    lead: "Carteiras de ativos e ex-clientes separadas, régua por dias de atraso, quadro de casos e negociação com desconto, parcelas e entrada dentro da política do seu provedor. O contato sai pelo WhatsApp do próprio provedor e a baixa da fatura volta do ERP.",
  },
  {
    pill: "Novo módulo · Recuperação de equipamentos",
    strong: "A ONU que ficou lá",
    light: "tem prazo, caso e responsável",
    lead: "Todo equipamento em comodato com retirada pendente entra numa fila por idade, com o prazo regulatório contando. Agende a retirada, escolha o método, registre a devolução ou dê baixa econômica quando o resgate custa mais que o aparelho.",
  },
];

const PERGUNTAS: { q: string; a: string }[] = [
  {
    q: "O que é a base de dados compartilhada?",
    a: "É uma base única onde todos os provedores registram seus inadimplentes. Quando você consulta um CPF, o sistema verifica em todos os provedores da rede e retorna dados anonimizados: dias de atraso, faixa de valor, equipamentos pendentes. Nunca dados pessoais identificáveis.",
  },
  {
    q: "Consultas na minha própria base são cobradas?",
    a: "Não. Consultas de clientes do seu próprio provedor são sempre gratuitas e ilimitadas. O crédito é consumido só quando a consulta encontra registro em outro provedor da rede: 1 crédito por consulta positiva, tanto faz se um ou cinco provedores tiverem registro daquele CPF.",
  },
  {
    q: "Como funciona a análise por endereço?",
    a: "Você informa o CEP e o número da residência. O sistema cruza em toda a rede de provedores e mostra o histórico de inadimplência associado àquele imóvel — independente do CPF do morador atual. Isso detecta casos onde o inadimplente usa o CPF de um parente mas mora no mesmo local.",
  },
  {
    q: "Quanto tempo leva para configurar?",
    a: "15 minutos para conectar um ERP (IXC, MK Solutions, SGP, Hubsoft, Voalle, RBX ISP) via API. A consulta vai ao ERP ao vivo, então o dado da decisão é sempre o de agora. Em paralelo, uma varredura completa da sua base roda três vezes por semana e alimenta o mapa de inadimplência. Sem instalação, sem técnico.",
  },
  {
    q: "Compartilhar dados de inadimplentes viola a LGPD?",
    a: "Não. O sistema compartilha apenas indicadores anonimizados — dias de atraso, faixa de valor e se há equipamentos pendentes. Nunca nome, CPF, endereço ou dados pessoais identificáveis. O sistema foi construído em conformidade com a LGPD.",
  },
  {
    q: "E a Resolução Anatel 765 — como ela afeta meu provedor?",
    a: "A Resolução 765 obriga a notificar o cliente em D+15 e aguardar até D+60 antes de cancelar. São 75 dias que o inadimplente pode usar para contratar outro provedor sem pagar. Com o anti-fraude, você recebe alerta em tempo real quando ele tenta migrar — e pode agir antes que a ONU saia da sua mão.",
  },
  {
    q: "Quais ERPs são suportados na integração automática?",
    a: "IXC Soft, SGP, MK Solutions, Hubsoft, Voalle, RBX ISP e outros. Solicitações para novos ERPs são avaliadas semanalmente — basta abrir um chamado pelo painel.",
  },
];

/** "1 crédito" / "3 créditos" — plural errado ja denunciou tabela desatualizada antes. */
function emCreditos(n: number): string {
  return `${n} crédito${n === 1 ? "" : "s"}`;
}

/**
 * O preco no card da vitrine, com os tres estados que a leitura tem.
 *
 * O terceiro e o que costuma faltar: com a leitura falhada `precos` fica
 * `undefined` em definitivo, e um esqueleto pulsando para sempre no lugar do
 * valor e pior do que dizer que o numero nao carregou.
 */
function Preco({ plano, sufixo, erro }: { plano: PrecoDePlano | undefined; sufixo: string; erro: boolean }) {
  if (plano) {
    return (
      <>
        <span className="val">{precoCurto(plano)}</span>
        <span className="per">{sufixo}</span>
      </>
    );
  }
  if (erro) {
    return <span className="per" data-testid="preco-indisponivel">Preço indisponível no momento</span>;
  }
  return <span className="price-esqueleto" aria-hidden />;
}

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [slide, setSlide] = useState(0);
  const [faqAberta, setFaqAberta] = useState<number | null>(0);

  const { data: precos, isError: erroPrecos } = usePrecosPublicos();
  const planoFree = planoPorChave(precos, "free");
  const planoPro = planoPorChave(precos, "pro");

  /**
   * `scroll-behavior` precisa morar no elemento que rola — o `<html>` —, e a
   * folha da landing e escopada em `.lp`. Sem esta classe o link de ancora
   * salta seco.
   */
  useEffect(() => {
    document.documentElement.classList.add("lp-scroll");
    return () => document.documentElement.classList.remove("lp-scroll");
  }, []);

  /**
   * Um `setTimeout` por slide, e nao um `setInterval`: mudar de slide na mao
   * troca a dependencia do efeito e o relogio recomeca — o comportamento do
   * original. Com `prefers-reduced-motion` nao ha giro automatico.
   */
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => setSlide((i) => (i + 1) % SLIDES.length), GIRO_MS);
    return () => clearTimeout(t);
  }, [slide]);

  const atual = SLIDES[slide];
  const classeDoSlide = (i: number) => `hero-slide${i === slide ? " active" : ""}`;
  const irPara = (destino: string) => (e: MouseEvent) => {
    e.preventDefault();
    setLocation(destino);
  };

  const creditosFree = planoFree
    ? `${planoFree.creditosInclusos.isp} créditos para testar a rede`
    : "Créditos de boas-vindas para testar a rede";

  /**
   * O Profissional nao inclui credito — e ACESSO (decisao do dono em
   * 10/09/2026). Ainda assim a frase segue o NUMERO do servidor em vez de
   * afirmar "sem franquia" por conta propria: se a tabela voltar a incluir
   * credito, o card conta a verdade sem ninguem lembrar de vir aqui.
   */
  const notaPro = planoPro && planoPro.creditosInclusos.isp > 0
    ? `${planoPro.creditosInclusos.isp} créditos por mês inclusos. Consultas além disso, por crédito.`
    : "Acesso à plataforma inteira. Consulta na rede é paga por crédito, sem franquia mensal.";

  return (
    <>
      <div className="lp">
        {/* =================== BARRA UTILITÁRIA =================== */}
        <div className="utilbar">
          <div className="utilbar-inner">
            <div className="utilbar-msg">Rede colaborativa de provedores de internet do Brasil</div>
            <a className="utilbar-link" href="https://wa.me/5543991191100?text=Ol%C3%A1%21%20Sou%20provedor%20e%20quero%20conhecer%20o%20Consulta%20ISP." target="_blank" rel="noopener">Falar no WhatsApp</a>
          </div>
        </div>

        {/* =================== NAV =================== */}
        <nav className="nav">
          <div className="nav-inner">
            <a href="#topo" className="logo logo-nav" aria-label="/consulta.isp">
              <span className="logo-mark"><span className="slash">/</span>consulta<span className="ext">.isp</span></span>
              <span className="logo-tag">Rede Colaborativa</span>
            </a>
            <div className="nav-links">
              <a href="#o-que-e">O que é</a>
              <a href="#rede">A rede</a>
              <a href="#funcionalidades">Funcionalidades</a>
              <a href="#precos">Preços</a>
              <a href="#faq">FAQ</a>
            </div>
            <div className="nav-right">
              <a href={CADASTRO} className="btn btn-primary" onClick={irPara(CADASTRO)}>Começar grátis</a>
            </div>
          </div>
        </nav>

        {/* =================== HERO / BANNER ROTATIVO =================== */}
        <section id="topo" className="hero">
          <div className="hero-grid"></div>
          <div className="hero-inner">
            {/* Coluna esquerda: texto muda por slide */}
            <div className="hero-left">
              <div className="pill on-dark" id="heroPill">
                <span className="dot"></span>
                <span id="heroPillText">{atual.pill}</span>
              </div>
              <h1>
                <span className="strong" id="heroH1Strong">{atual.strong}</span>
                <span className="light" id="heroH1Light">{atual.light}</span>
              </h1>
              <p className="hero-lead" id="heroLead">
                {atual.lead}
              </p>
              <div className="hero-ctas">
                <a href={CADASTRO} className="btn btn-primary on-dark btn-lg" onClick={irPara(CADASTRO)}>Criar conta grátis <span className="arrow">→</span></a>
                <a href={WHATSAPP} target="_blank" rel="noopener" className="btn btn-secondary on-dark btn-lg">Falar no WhatsApp</a>
              </div>
              <div className="hero-guarantees">
                <span className="item"><span className="check">✓</span> Consultas na sua base sempre grátis</span>
                <span className="item"><span className="check">✓</span> Consulta anônima, com hash por consulta</span>
                <span className="item"><span className="check">✓</span> Conformidade com a LGPD</span>
              </div>
              <div className="banner-controls">
                <div className="banner-bars" id="bannerBars" role="tablist">
                  {SLIDES.map((s, i) => (
                    <button
                      key={s.pill}
                      type="button"
                      role="tab"
                      aria-label={s.pill}
                      aria-selected={i === slide}
                      className={i === slide ? "active" : undefined}
                      onClick={() => setSlide(i)}
                    />
                  ))}
                </div>
                <div className="banner-arrows">
                  <button type="button" id="btnPrev" aria-label="Slide anterior" onClick={() => setSlide((i) => (i - 1 + SLIDES.length) % SLIDES.length)}>←</button>
                  <button type="button" id="btnNext" aria-label="Próximo slide" onClick={() => setSlide((i) => (i + 1) % SLIDES.length)}>→</button>
                </div>
              </div>
            </div>

            {/* Coluna direita: visual muda por slide */}
            <div className="hero-right">
              <div className="hero-rings" aria-hidden="true"><div className="hero-ring-3"></div></div>
              <div className="hero-visual" id="heroVisual">

                {/* SLIDE 1 */}
                <div className={classeDoSlide(0)} data-slide="0">
                  <div className="mock-browser">
                    <div className="mock-titlebar">
                      <div className="tb-dots"><div className="tb-dot"></div><div className="tb-dot"></div><div className="tb-dot"></div></div>
                      <div className="tb-url">consultaisp.com.br/consulta-isp</div>
                    </div>
                    <div className="mock-body">
                      <div className="mock-header">
                        <div>
                          <div className="mock-label">CPF consultado</div>
                          <div className="mock-cpf">041.179.***-40</div>
                        </div>
                        <span className="mock-badge neg">CRÍTICO</span>
                      </div>
                      <div className="mock-score-row">
                        <div className="score-ring">
                          <svg width="60" height="60"><circle cx="30" cy="30" r="24" fill="none" stroke="#F0E1DE" strokeWidth="6"/><circle cx="30" cy="30" r="24" fill="none" stroke="#8A2A20" strokeWidth="6" strokeDasharray="151" strokeDashoffset="128" strokeLinecap="round"/></svg>
                          <div className="score-num">152</div>
                        </div>
                        <div className="mock-chips">
                          <span className="mock-chip">2 provedores</span>
                          <span className="mock-chip">2 equip. retidos</span>
                        </div>
                      </div>
                      <div className="mock-suggestion">
                        <span className="lbl">Sugestão</span>
                        <span className="val">REJEITAR</span>
                      </div>
                      <div className="mock-two">
                        <div className="mock-two-card self">
                          <div className="who">O seu provedor</div>
                          <div className="val">325 dias · R$ 350</div>
                          <div className="cost">GRÁTIS</div>
                        </div>
                        <div className="mock-two-card">
                          <div className="who">Outro provedor</div>
                          <div className="val">1441 dias · R$ 890</div>
                          <div className="cost">1 CRÉDITO</div>
                        </div>
                      </div>
                      <div className="mock-alert">2 equipamentos não devolvidos — R$ 580 em risco</div>
                    </div>
                  </div>
                  <div className="float-card float-tl">
                    <div className="lbl">Instalação evitada</div>
                    <div className="val">R$ 930</div>
                    <div className="sub">ONU + 2 meses</div>
                  </div>
                  <div className="float-card float-br">
                    <div className="lbl">Consulta ao vivo</div>
                    <div className="val">Via API</div>
                    <div className="sub">Resposta em segundos</div>
                  </div>
                </div>

                {/* SLIDE 2 */}
                <div className={classeDoSlide(1)} data-slide="1">
                  <div className="side-card">
                    <div className="head">
                      <span className="head-title">Consulta por endereço</span>
                    </div>
                    <h3>Rua das Palmeiras, 412 — Centro</h3>
                    <div className="sub">CEP 88010-000 · cruzamento em toda a rede</div>
                    <div className="side-row neg">
                      <div className="info">
                        <span className="line">CPF 041.***.***-40</span>
                        <span className="sub">325 dias em atraso · morador atual</span>
                      </div>
                      <span className="tag neg">DEVEDOR</span>
                    </div>
                    <div className="side-row neg">
                      <div className="info">
                        <span className="line">CPF 712.***.***-08</span>
                        <span className="sub">1441 dias em atraso · mesmo imóvel</span>
                      </div>
                      <span className="tag neg">DEVEDOR</span>
                    </div>
                    <div className="mock-alert" style={{ marginTop: "14px" }}>CPF novo, mesmo endereço. O sistema aponta os dois registros anteriores do imóvel.</div>
                  </div>
                </div>

                {/* SLIDE 3 */}
                <div className={classeDoSlide(2)} data-slide="2">
                  <div className="side-card">
                    <div className="head">
                      <span className="head-title">Alerta anti-fraude</span>
                      <span className="mock-badge neg" style={{ animation: "ci-pulso 2.4s ease-in-out infinite" }}>AGORA</span>
                    </div>
                    <h3>Seu inadimplente foi consultado por outro provedor da rede</h3>
                    <div className="sub">Consulta anônima — nenhum dos lados sabe quem é o outro.</div>
                    <div className="side-list-item">
                      <span className="k">Dívida na sua base</span>
                      <span className="v" style={{ color: "var(--neg)" }}>R$ 350 · 325 DIAS</span>
                    </div>
                    <div className="side-list-item">
                      <span className="k">Equipamento em comodato</span>
                      <span className="v" style={{ color: "var(--warn)" }}>2 ONUs · R$ 580</span>
                    </div>
                    <div className="side-list-item">
                      <span className="k">Canal do aviso</span>
                      <span className="v">E-MAIL + WEBHOOK</span>
                    </div>
                  </div>
                </div>

                {/* SLIDE 4 */}
                <div className={classeDoSlide(3)} data-slide="3">
                  <div className="side-card">
                    <div className="head">
                      <span className="head-title">Consulta anônima por hash</span>
                    </div>
                    <div className="side-hash">a7f3c9e1-4b28-47d6-9c05-e81b2f6d33a0</div>
                    <div className="side-note">Hash gerado só para esta consulta. Não vincula sua identidade, nem a de quem registrou a dívida.</div>
                    <div className="side-list-item pos">
                      <span className="k">Existe dívida na rede</span>
                      <span className="v">SIM · 2 REGISTROS</span>
                    </div>
                    <div className="side-list-item pos">
                      <span className="k">Tempo de atraso e faixa</span>
                      <span className="v">VISÍVEL</span>
                    </div>
                    <div className="side-list-item neutral">
                      <span className="k">Nome do provedor da dívida</span>
                      <span className="v">NUNCA</span>
                    </div>
                    <div className="side-list-item neutral">
                      <span className="k">Dados pessoais do devedor</span>
                      <span className="v">NUNCA</span>
                    </div>
                  </div>
                </div>

                {/* SLIDE 5 */}
                <div className={classeDoSlide(4)} data-slide="4">
                  <div className="side-card side-questions">
                    <div className="head">
                      <span className="head-title">As perguntas que a venda não responde</span>
                    </div>
                    <div className="side-list-item neutral">
                      <span className="q-num">?</span>
                      <span className="k">Ele já deve pra quem?</span>
                    </div>
                    <div className="side-list-item neutral">
                      <span className="q-num">?</span>
                      <span className="k">Tem devedor nesse endereço?</span>
                    </div>
                    <div className="side-list-item neutral">
                      <span className="q-num">?</span>
                      <span className="k">A ONU volta?</span>
                    </div>
                    <div className="side-close">Cláusula de fidelidade não substitui análise. O Consulta ISP responde as três em segundos, antes da ordem de serviço.</div>
                  </div>
                </div>

                {/* SLIDE 6 */}
                <div className={classeDoSlide(5)} data-slide="5">
                  <div className="side-card">
                    <div className="head">
                      <span className="head-title">Quadro de cobrança</span>
                    </div>
                    <div className="kanban-header">
                      <span className="kanban-pill active">Ativos</span>
                      <span className="kanban-pill idle">Ex-clientes</span>
                    </div>
                    <div className="kanban-cols">
                      <div className="kanban-col">
                        <div className="lbl">Aviso</div>
                        <div className="num">18</div>
                        <div className="note">antes do corte</div>
                      </div>
                      <div className="kanban-col">
                        <div className="lbl">Negociando</div>
                        <div className="num" style={{ color: "var(--warn)" }}>07</div>
                        <div className="note">acordo em curso</div>
                      </div>
                      <div className="kanban-col">
                        <div className="lbl">Acordo</div>
                        <div className="num" style={{ color: "var(--pos)" }}>05</div>
                        <div className="note">parcelas ativas</div>
                      </div>
                      <div className="kanban-col">
                        <div className="lbl">Perdido</div>
                        <div className="num" style={{ color: "var(--neg)" }}>02</div>
                        <div className="note">baixa contábil</div>
                      </div>
                    </div>
                    <div className="side-close">Acordo dentro da política: desconto, parcelas e entrada mínima por faixa de atraso — o sistema não deixa passar do teto.</div>
                    <div className="kanban-tags">
                      <span className="kanban-tag">Régua por dias de atraso</span>
                      <span className="kanban-tag">WhatsApp do provedor</span>
                      <span className="kanban-tag">Baixa via ERP</span>
                      <span className="kanban-tag">Prescrição vigiada</span>
                    </div>
                  </div>
                </div>

                {/* SLIDE 7 */}
                <div className={classeDoSlide(6)} data-slide="6">
                  <div className="side-card">
                    <div className="head">
                      <span className="head-title">Comodato a recuperar</span>
                      <span className="mock-badge neg">1 EM PRAZO CRÍTICO</span>
                    </div>
                    <div className="side-row neg">
                      <div className="info">
                        <span className="line">ONU Nokia · ALCLFC65623D</span>
                        <span className="sub">rescisão 12/07 · em comodato</span>
                      </div>
                      <span className="tag neg">4 DIAS</span>
                    </div>
                    <div className="side-row warn">
                      <div className="info">
                        <span className="line">ONU Intelbras 110 · SN-4471</span>
                        <span className="sub">retirada agendada 18/09</span>
                      </div>
                      <span className="tag warn">22 DIAS</span>
                    </div>
                    <div className="side-row pos">
                      <div className="info">
                        <span className="line">Roteador TP-Link · SN-9902</span>
                        <span className="sub">devolvido na loja 02/09</span>
                      </div>
                      <span className="tag pos">ENCERRADO</span>
                    </div>
                    <div className="kanban-tags" style={{ marginTop: "14px" }}>
                      <span className="kanban-tag">Retirada gratuita ou logística reversa</span>
                      <span className="kanban-tag">Baixa econômica com motivo</span>
                      <span className="kanban-tag">Fila por idade do caso</span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </section>

        {/* =================== MURO DE ERPs =================== */}
        <section className="erps">
          <div className="erps-inner">
            <div className="erps-title">Integra com os principais ERPs do mercado ISP</div>
            <div className="erps-chips">
              <span className="chip"><span className="chip-dot"></span>IXC Soft</span>
              <span className="chip"><span className="chip-dot"></span>MK Solutions</span>
              <span className="chip"><span className="chip-dot"></span>Hubsoft</span>
              <span className="chip"><span className="chip-dot"></span>SGP</span>
              <span className="chip"><span className="chip-dot"></span>Voalle</span>
              <span className="chip"><span className="chip-dot"></span>RBX ISP</span>
              <span className="chip"><span className="chip-dot"></span>API aberta</span>
            </div>
          </div>
        </section>

        {/* =================== O QUE É + JORNADA =================== */}
        <section id="o-que-e" className="section-alt section-pad">
          <div className="container">
            <div className="kicker">O que é</div>
            <div className="two-col">
              <h2>A decisão de crédito entra <em>no meio da sua venda</em></h2>
              <p className="lead">
                O Consulta ISP não é um bureau de crédito nem um sistema de cobrança. É a consulta que faltava entre o pedido do cliente e a ordem de serviço: um minuto de verificação na rede de provedores que decide se aquela instalação vira receita ou prejuízo.
              </p>
            </div>
            <div className="journey">
              <div className="journey-card">
                <span className="num">01</span>
                <span className="title">Pedido do cliente</span>
                <p className="desc">Venda entra pelo balcão, telefone ou WhatsApp.</p>
                <span className="tag">seu ERP</span>
              </div>
              <div className="journey-card hi">
                <span className="num">02</span>
                <span className="title">Consulta na rede</span>
                <p className="desc">CPF, CNPJ ou endereço conferidos ao vivo no ERP de todos os provedores conectados. Hash aleatório por consulta, sem identificar quem registrou.</p>
                <span className="tag">/consulta.isp</span>
              </div>
              <div className="journey-card hi">
                <span className="num">03</span>
                <span className="title">Decisão</span>
                <p className="desc">Score de 0 a 1000, equipamentos retidos e sugestão: aprovar, atenção, análise manual ou rejeitar.</p>
                <span className="tag">/consulta.isp</span>
              </div>
              <div className="journey-card">
                <span className="num">04</span>
                <span className="title">Instalação</span>
                <p className="desc">Técnico só sai com risco conhecido e registrado na proposta.</p>
                <span className="tag">seu ERP</span>
              </div>
              <div className="journey-card hi">
                <span className="num">05</span>
                <span className="title">Cobrança e alerta</span>
                <p className="desc">Se atrasar, o registro entra na rede e o anti-fraude avisa quando ele tentar migrar.</p>
                <span className="tag">/consulta.isp</span>
              </div>
            </div>
            <p className="journey-note">Os passos 02, 03 e 05 são o Consulta ISP. O resto continua no seu ERP, como já é hoje.</p>
          </div>
        </section>

        {/* =================== DOIS PILARES =================== */}
        <section className="section-light section-pad">
          <div className="container">
            <div className="kicker">Dois pilares</div>
            <h2>Prevenção na venda e <em>defesa da carteira</em></h2>
            <p className="lead">Escolha a ponta que mais aperta hoje. As duas usam a mesma base e o mesmo crédito.</p>
            <div className="pillars">
              <article className="pillar-card">
                <span className="pillar-label">Pilar 01 · Prevenção na venda</span>
                <h3>A verificação que acontece antes de a ONU sair do estoque.</h3>
                <p>Filtra o cliente no minuto da proposta e evita instalação de quem já é conhecido da rede.</p>
                <ul className="pillar-list">
                  <li>
                    <span className="n">01</span>
                    <div><div className="t">Consulta ISP</div><div className="d">Score de risco na rede colaborativa, ao vivo.</div></div>
                  </li>
                  <li>
                    <span className="n">02</span>
                    <div><div className="t">Consulta cadastral</div><div className="d">Quem é o cliente, na fonte: Receita, endereços, sócios.</div></div>
                  </li>
                  <li>
                    <span className="n">03</span>
                    <div><div className="t">Cruzamento por endereço</div><div className="d">Mesma casa, CPF novo. Se houver outros devedores naquele imóvel, o sistema avisa.</div></div>
                  </li>
                  <li>
                    <span className="n">04</span>
                    <div><div className="t">Parecer por IA</div><div className="d">Aprovar, aprovar com atenção, análise manual ou rejeitar.</div></div>
                  </li>
                </ul>
              </article>
              <article className="pillar-card">
                <span className="pillar-label">Pilar 02 · Defesa da carteira</span>
                <h3>O que fazer com o inadimplente que você já tem dentro de casa.</h3>
                <p>Recupera equipamento, negocia dentro da política e evita que o devedor migre invisível.</p>
                <ul className="pillar-list">
                  <li>
                    <span className="n">01</span>
                    <div><div className="t">Cobrança</div><div className="d">Carteiras de ativos e ex-clientes separadas, régua por dias de atraso e um quadro com o caso de cada devedor.</div></div>
                  </li>
                  <li>
                    <span className="n">02</span>
                    <div><div className="t">Acordo dentro da política</div><div className="d">Desconto, entrada e parcelas por faixa de atraso — o sistema não deixa passar do teto que você definiu.</div></div>
                  </li>
                  <li>
                    <span className="n">03</span>
                    <div><div className="t">Anti-fraude</div><div className="d">Alerta no instante em que seu devedor é consultado por outro provedor.</div></div>
                  </li>
                  <li>
                    <span className="n">04</span>
                    <div><div className="t">Recuperação de equipamentos</div><div className="d">ONU em comodato por modelo, serial e status, em fila por idade do caso, com o prazo correndo.</div></div>
                  </li>
                  <li>
                    <span className="n">05</span>
                    <div><div className="t">SPC integrada</div><div className="d">Score, restrições e negativação sem contrato à parte.</div></div>
                  </li>
                  <li>
                    <span className="n">06</span>
                    <div><div className="t">Mapa de inadimplência</div><div className="d">Onde a sua base perde dinheiro, por bairro.</div></div>
                  </li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        {/* =================== A REDE COLABORATIVA (DARK) =================== */}
        <section id="rede" className="rede">
          <div className="rede-inner">
            <div className="kicker on-dark">A rede colaborativa</div>
            <div className="two-col">
              <h2 className="on-dark">O dado que um provedor registra <em>protege todos os outros</em></h2>
              <p className="lead on-dark">
                Nenhum provedor tem histórico suficiente sozinho. O inadimplente que sai da sua base é cliente novo na base do vizinho — e volta a ser prejuízo três meses depois. A rede fecha esse circuito: cada provedor conectado alimenta e consulta o mesmo mapa de risco.
              </p>
            </div>

            {/* Topologia */}
            <div className="topo">
              <div className="topo-head">
                <div className="kicker on-dark" style={{ margin: "0" }}>Topologia da integração</div>
                <div className="desc">Seu ERP conversa com a rede por API. Nada de cadastro manual, nada para baixar.</div>
              </div>
              <div className="topo-row">
                <div className="topo-node">
                  <div className="lbl">Seu provedor</div>
                  <div className="name">ERP integrado</div>
                  <div className="state">chave de API ativa</div>
                </div>
                <div className="topo-node">
                  <div className="lbl">Provedor da rede</div>
                  <div className="name">ERP integrado</div>
                  <div className="state">responde ao vivo</div>
                </div>
                <div className="topo-node">
                  <div className="lbl">Provedor da rede</div>
                  <div className="name">ERP integrado</div>
                  <div className="state">responde ao vivo</div>
                </div>
              </div>
              <div className="topo-connector">
                <div className="rule"></div>
                <div className="txt">↓ REQUISIÇÃO · RESPOSTA ↑</div>
                <div className="rule mirror"></div>
              </div>
              <div className="topo-api">
                <div className="topo-api-icon">API</div>
                <div className="topo-api-text">
                  <div className="t">/consulta.isp · camada de consulta</div>
                  <div className="s">pergunta ao ERP de cada provedor no momento da sua consulta</div>
                </div>
              </div>
              <div className="topo-connector">
                <div className="rule"></div>
                <div className="txt">↓ RESULTADO EM SEGUNDOS</div>
                <div className="rule mirror"></div>
              </div>
              <div className="topo-node" style={{ maxWidth: "420px", margin: "0 auto" }}>
                <div className="lbl">Sua tela de consulta</div>
                <div className="name">score · dívidas na rede · equipamentos · sugestão</div>
              </div>
              <div className="rede-guarantees">
                <span className="chip"><span className="chip-dot"></span>Uma chave de API e está pronto</span>
                <span className="chip"><span className="chip-dot"></span>Sem cadastro manual de inadimplente</span>
                <span className="chip"><span className="chip-dot"></span>Nada para baixar, nada para enviar</span>
              </div>
            </div>

            {/* Três etapas da rede */}
            <div className="rede-steps">
              <div className="rede-step">
                <div className="n">01</div>
                <div className="t">Você conecta o ERP</div>
                <div className="d">Uma chave de API e a sua base de inadimplentes passa a alimentar o mapa da rede. Nenhum dado pessoal sai do seu servidor.</div>
              </div>
              <div className="rede-step">
                <div className="n">02</div>
                <div className="t">A rede responde ao vivo</div>
                <div className="d">Ao consultar um CPF, o sistema pergunta na hora ao ERP de cada provedor conectado. A resposta é o estado de agora, não o de um cadastro velho.</div>
              </div>
              <div className="rede-step">
                <div className="n">03</div>
                <div className="t">O aviso volta para você</div>
                <div className="d">Quando o seu devedor é consultado por outro provedor da rede, você sabe na mesma hora — por e-mail e webhook.</div>
              </div>
            </div>

            {/* Anonimato + LGPD */}
            <div className="rede-pair">
              <div className="card">
                <div className="lbl">Consulta anônima</div>
                <p className="txt">Cada consulta é criada com um hash aleatório próprio. O resultado diz que existe dívida, há quanto tempo e em que faixa de valor — nunca em qual provedor. Nenhum provedor da rede sabe o nome de quem registrou a dívida, e o seu nome também não aparece para ninguém.</p>
              </div>
              <div className="card">
                <div className="lbl">LGPD</div>
                <p className="txt">A rede troca indicadores, não pessoas. Dias de atraso, faixa de valor e equipamentos pendentes circulam entre os provedores. Nome, CPF, endereço e telefone nunca saem da base de origem.</p>
              </div>
            </div>
          </div>
        </section>

        {/* =================== ANTES / DEPOIS =================== */}
        <section className="section-alt section-pad">
          <div className="container container-narrow">
            <div className="kicker">Antes e depois</div>
            <h2>A mesma venda, com e sem <em>a consulta</em></h2>
            <div className="compare">
              <article className="compare-card compare-neg">
                <div className="compare-head">Sem o Consulta ISP</div>
                <div className="compare-row"><span className="when">Dia 0</span><span>Venda aprovada com o CPF limpo no SPC. O débito dele é de internet, e internet não vai para o SPC.</span></div>
                <div className="compare-row"><span className="when">Dia 1</span><span>Técnico sai, ONU instalada, contrato assinado.</span></div>
                <div className="compare-row"><span className="when">D+15</span><span>Primeira fatura atrasa. Notificação obrigatória pela Resolução 765.</span></div>
                <div className="compare-row"><span className="when">D+60</span><span>Só agora o corte é permitido. Dois meses de serviço prestado sem receber.</span></div>
                <div className="compare-row"><span className="when">D+90</span><span>Equipamento não voltou. O cliente já está instalado no provedor vizinho.</span></div>
                <div className="compare-close">Resultado: ONU perdida, três meses sem receber e um chamado de cobrança que ninguém vai ganhar.</div>
              </article>
              <article className="compare-card compare-pos">
                <div className="compare-head">Com o Consulta ISP</div>
                <div className="compare-row"><span className="when">Dia 0</span><span>Antes da ordem de serviço, o CPF vai à rede. Score 152, dois provedores com registro.</span></div>
                <div className="compare-row"><span className="when">1 min</span><span>O painel mostra 325 dias de atraso na sua própria base e dois equipamentos retidos.</span></div>
                <div className="compare-row"><span className="when">Decisão</span><span>Sugestão automática: rejeitar. Ou aprovar com caução e sem comodato de equipamento.</span></div>
                <div className="compare-row"><span className="when">Depois</span><span>O caso fica registrado. Se ele procurar outro provedor, a rede avisa.</span></div>
                <div className="compare-row"><span className="when">Sempre</span><span>A consulta na sua própria base é gratuita e ilimitada.</span></div>
                <div className="compare-close">Resultado: equipamento no estoque, técnico livre para uma venda boa e o risco documentado na proposta.</div>
              </article>
            </div>
          </div>
        </section>

        {/* =================== FUNCIONALIDADES =================== */}
        <section id="funcionalidades" className="section-light section-pad">
          <div className="container">
            <div className="kicker">Funcionalidades</div>
            <h2>Sete ferramentas, <em>um único crédito</em></h2>
            <p className="lead">Cada funcionalidade resolve um problema real do dia a dia do provedor.</p>
            <div className="feats">
              <article className="feat-card">
                <div className="feat-head">
                  <div className="feat-sigil">ISP</div>
                  <div className="feat-title">Consulta ISP</div>
                </div>
                <p className="feat-desc">Score de risco 0–1000 em tempo real. Histórico de inadimplência em toda a rede colaborativa, equipamentos retidos e sugestão automática de decisão.</p>
              </article>
              <article className="feat-card">
                <div className="feat-head">
                  <div className="feat-sigil">CAD</div>
                  <div className="feat-title">Consulta cadastral</div>
                </div>
                <p className="feat-desc">Dados do CPF ou CNPJ direto na fonte: nome, situação na Receita, endereços, telefones, sócios, processos e capacidade de pagamento. Serve para confirmar quem é o cliente antes de instalar.</p>
              </article>
              <article className="feat-card">
                <div className="feat-head">
                  <div className="feat-sigil">AF</div>
                  <div className="feat-title">Anti-fraude</div>
                </div>
                <p className="feat-desc">Alerta por e-mail e webhook no instante em que seu cliente inadimplente é consultado por outro provedor. Detecta migradores seriais.</p>
              </article>
              <article className="feat-card">
                <div className="feat-head">
                  <div className="feat-sigil">ONU</div>
                  <div className="feat-title">Controle de equipamentos</div>
                </div>
                <p className="feat-desc">Registre ONUs por modelo, serial e status. Rastreie equipamentos em comodato e identifique retenções antes que virem prejuízo.</p>
              </article>
              <article className="feat-card">
                <div className="feat-head">
                  <div className="feat-sigil">END</div>
                  <div className="feat-title">Consulta por endereço</div>
                </div>
                <p className="feat-desc">Cruza CEP e número em toda a rede. Detecta inadimplência no imóvel mesmo com CPF diferente — identifica golpes de familiares.</p>
              </article>
              <article className="feat-card">
                <div className="feat-head">
                  <div className="feat-sigil">SPC</div>
                  <div className="feat-title">SPC integrada</div>
                </div>
                <p className="feat-desc">Score SPC, restrições financeiras e protestos direto na plataforma. Negativação sem contrato adicional com Serasa.</p>
              </article>
              <article className="feat-card">
                <div className="feat-head">
                  <div className="feat-sigil">IA</div>
                  <div className="feat-title">Análise com IA</div>
                </div>
                <p className="feat-desc">Recomendação automática a partir do score: aprovar, aprovar com atenção, análise manual ou rejeitar — com o parecer escrito por IA.</p>
              </article>
            </div>
          </div>
        </section>

        {/* =================== PREÇOS =================== */}
        <section id="precos" className="section-alt section-pad">
          <div className="container container-narrow">
            <div className="kicker">Preços</div>
            <h2>Simples, transparente, <em>sem surpresa</em></h2>
            <p className="lead">Consultas na sua própria base são sempre gratuitas. Você paga apenas pelo que usar na rede.</p>

            <div className="prices">
              <article className="price-card">
                <h3 className="price-title">Gratuito</h3>
                <div className="price-value">
                  <Preco plano={planoFree} sufixo="para sempre" erro={erroPrecos} />
                </div>
                <div className="price-note">Para conhecer a plataforma</div>
                <ul className="price-list">
                  <li>{creditosFree}</li>
                  <li>Consultas ilimitadas na sua base</li>
                  <li>Anti-fraude ligado desde o primeiro dia</li>
                  <li>Integração com o seu ERP</li>
                </ul>
                <a href={CADASTRO} className="btn btn-secondary" style={{ width: "100%" }} onClick={irPara(CADASTRO)}>Criar conta grátis</a>
              </article>
              <article className="price-card hi">
                <span className="price-recomended">Recomendado</span>
                <h3 className="price-title">Profissional</h3>
                <div className="price-value">
                  <Preco plano={planoPro} sufixo="/mês" erro={erroPrecos} />
                </div>
                <div className="price-note">{notaPro}</div>
                <ul className="price-list">
                  <li>Cobrança: carteiras de ativos e ex-clientes, régua por atraso e quadro de casos</li>
                  <li>Acordo dentro da política do provedor: desconto, entrada e parcelas com teto</li>
                  <li>Recuperação de equipamentos em comodato, com prazo e responsável</li>
                  <li>Anti-fraude por e-mail e webhook</li>
                  <li>Consulta cadastral, SPC Brasil e cruzamento por endereço</li>
                  <li>Mapa de inadimplência por bairro</li>
                  <li>Integração com o seu ERP</li>
                </ul>
                <a href={CADASTRO} className="btn btn-primary" style={{ width: "100%" }} onClick={irPara(CADASTRO)}>Começar agora <span className="arrow">→</span></a>
              </article>
            </div>

            <div className="price-table">
              <div className="price-table-title">Custo por consulta</div>
              <div className="price-table-row"><span className="k">Consulta na própria base</span><span className="v free">GRÁTIS</span></div>
              <div className="price-table-row"><span className="k">Consulta ISP (rede colaborativa)</span><span className="v">{emCreditos(CUSTO_EM_CREDITOS.isp)} por consulta positiva</span></div>
              <div className="price-table-row"><span className="k">Consulta cadastral (dados do CPF/CNPJ)</span><span className="v">{emCreditos(CUSTO_EM_CREDITOS.cadastral)}</span></div>
              <div className="price-table-row"><span className="k">Consulta SPC Brasil</span><span className="v">{emCreditos(CUSTO_EM_CREDITOS.spc)}</span></div>
              <p className="price-table-foot">Crédito só é debitado quando a consulta encontra registro em outro provedor. Consulta que volta limpa não custa nada.</p>
            </div>
          </div>
        </section>

        {/* =================== FAQ =================== */}
        <section id="faq" className="section-light section-pad">
          <div className="container container-faq">
            <div className="kicker">FAQ</div>
            <h2>Perguntas frequentes</h2>
            <div className="faq-list" id="faqList">
              {PERGUNTAS.map((p, i) => (
                <details key={p.q} className={i === faqAberta ? "faq-item open" : "faq-item"} open={i === faqAberta}>
                  <summary
                    className="faq-q"
                    onClick={(e) => {
                      e.preventDefault();
                      setFaqAberta(i === faqAberta ? null : i);
                    }}
                  >
                    {p.q} <span className="sign"></span>
                  </summary>
                  <div className="faq-a">{p.a}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* =================== CTA FINAL =================== */}
        <section id="cta" className="final-cta">
          <div className="final-cta-inner">
            <div className="pill on-dark"><span className="dot"></span> Começa grátis — sem cartão de crédito</div>
            <h2>Consulte o próximo CPF <em>antes de mandar o técnico</em></h2>
            <p>Cadastro em 2 minutos e 50 créditos gratuitos para testar a rede. Consultas na sua base seguem sempre gratuitas.</p>
            <div className="final-cta-buttons">
              <a href={CADASTRO} className="btn btn-primary on-dark btn-lg" style={{ background: "#F5F3EE", color: "#0E0D0B" }} onClick={irPara(CADASTRO)}>Criar conta grátis <span className="arrow">→</span></a>
              <a href={WHATSAPP} target="_blank" rel="noopener" className="btn btn-secondary on-dark btn-lg">Tirar dúvida no WhatsApp</a>
            </div>
          </div>
        </section>

        {/* =================== FOOTER =================== */}
        <footer>
          <div className="footer-inner">
            <div className="footer-top">
              <div className="footer-brand-block">
                <span className="logo logo-footer on-dark">
                  <span className="logo-mark"><span className="slash">/</span>consulta<span className="ext">.isp</span></span>
                  <span className="logo-tag">Rede Colaborativa</span>
                </span>
                <span>Base colaborativa para provedores</span>
              </div>
              <div className="footer-links">
                <span>Dados criptografados</span>
                <a href="/lgpd" onClick={irPara("/lgpd")}>Privacidade LGPD</a>
                <a href={WHATSAPP} target="_blank" rel="noopener">WhatsApp</a>
              </div>
            </div>
            <div className="footer-bottom">
              /consulta.isp — A base colaborativa entre provedores de internet do Brasil
            </div>
          </div>
        </footer>
      </div>
      <LandingChatbot />
    </>
  );
}
