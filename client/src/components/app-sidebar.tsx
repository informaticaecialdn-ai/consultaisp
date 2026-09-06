import { carteiraDaNavegacao, caminhoNaCarteira, retornoDaCarteira } from "@/components/cobranca/carteiras";
import * as React from "react";
import { useLocation, useSearch, Link } from "wouter";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/ui/sidebar";
import {
  ScanSearch,
  Kanban,
  IdCard,
  LayoutDashboard,
  BarChart3,
  ShieldAlert,
  MapPin,
  CreditCard,
  Upload,
  Settings,
  Shield,
  LogOut,
  Building2,
  Crown,
  Activity,
  FileText,
  MessageSquare,
  TrendingUp,
  ShoppingCart,
  ClipboardList,
  Package,
  Palette,
  Users,
  Wallet,
  ListTodo,
  Route,
  Scale,
  UserX,
  ChevronRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { SimboloDaMarca } from "@/components/marca";
import { useMarca } from "@/lib/marca";

/* ==================================================================== */
/* Casca compartilhada                                                  */
/* ==================================================================== */

/**
 * A sidebar serve dois papeis — provedor e superadmin — e ate aqui os dois
 * falavam linguas visuais diferentes: o admin escrito na API antiga
 * (`--color-*`), com secoes recolhiveis, sem rodape de LGPD e com outro
 * tratamento de marca. Nao eram dois produtos; pareciam.
 *
 * A REFERENCIA e o lado do provedor, que ja estava correto contra o
 * DESIGN_SYSTEM.md. Os blocos abaixo sao a casca unica: mesma marca, mesmo
 * rotulo de grupo, mesmo item, mesmo rodape. O que muda entre os papeis e o
 * CONTEUDO (quais itens, qual subtitulo) — nunca a forma.
 *
 * Valores portados letra por letra do lado do provedor. Ajuste visual e uma
 * decisao a parte, feita aqui, uma vez, para os dois.
 */

/** Rotulo de grupo — mesma voz do rotulo de metrica do painel. */
const ROTULO_GRUPO =
  "px-2 pt-1 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] uppercase text-[var(--text-faint)]";

/** ALVO DE TOQUE — a metade grossa da regra de `ALVO_CONTROLE`
 *  (`components/painel/ui.tsx`), que por sua vez vem de `components/ui/button.tsx`.
 *
 *  Aqui entra so o `[@media(pointer:coarse)]`, sem o piso de 36px da constante
 *  compartilhada. Motivo: os controles desta sidebar ja tem a altura que devem
 *  ter no ponteiro fino — o item de navegacao chega a 36px pelo proprio padding,
 *  e "Sair" e a linha de LGPD sao texto, que a densidade da sidebar quer curto.
 *  Cravar um piso de 36px neles engordaria o desktop para resolver um problema
 *  que so existe no dedo (secao 4: densidade e decisao de produto). O que nao se
 *  negocia e a secao 7, e ela fala do toque: no ponteiro grosso, todo controle
 *  daqui vai a 44px.
 *
 *  Vale para os DOIS paineis: a sidebar e uma so desde a unificacao, entao a
 *  correcao feita aqui chega ao provedor e ao superadmin de uma vez. */
const ALVO_NO_DEDO = "[@media(pointer:coarse)]:min-h-11";

/** Anel de foco na cor da marca. Todo controle do arquivo usa este mesmo anel —
 *  foco que muda de aparencia entre a navegacao e a marca faz o operador perder
 *  o cursor de teclado. */
const FOCO_MARCA =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]";

/** Item de navegacao. O anel de foco e para dentro (`offset-[-2px]`) porque o
 *  item encosta na borda da sidebar e um anel para fora seria cortado.
 *  Raio de 6px: a secao 5.1 reserva os 8px para card. */
const ITEM_BASE =
  `flex items-center gap-[10px] px-2.5 py-2 ${ALVO_NO_DEDO} rounded-md text-[13.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand)] motion-safe:transition-colors`;
const ITEM_ATIVO = "bg-[var(--brand-soft)] text-[var(--brand-ink)] font-semibold";
const ITEM_INATIVO =
  "text-[var(--text-2)] font-medium hover:bg-[var(--surface-2)] hover:text-[var(--text)]";

type Icone = React.ElementType;

/**
 * O glifo da plataforma: arco de score com ponteiro, o artefato que um bureau
 * entrega. Ecoa o medidor da propria tela de consulta.
 *
 * Fundo `--surface-2` e nao branco puro: a sidebar ja e branca, e um quadrado
 * branco sumiria nela. A hairline fecha a forma.
 */
function LadrilhoDaPlataforma() {
  return (
    <div className="w-[34px] h-[34px] rounded-lg bg-[var(--surface-2)] border border-[var(--border)] grid place-items-center flex-none">
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3.5 16.5a8.5 8.5 0 0 1 17 0" stroke="var(--brand)" strokeWidth="2.1" strokeLinecap="round" />
        <path d="M12 16.5l4.4-4.4" stroke="var(--brand)" strokeWidth="2.1" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** Classe do CONTROLE que envolve o bloco de marca — o <button> do superadmin e
 *  o <Link> do provedor, que levam ao painel inicial.
 *
 *  Sendo controle, segue a regra dos controles: anel de foco da marca e alvo de
 *  toque. Antes o bloco ficava com o outline padrao do navegador — visivel, mas
 *  o foco trocava de aparencia ao passar da navegacao para a marca, e um cursor
 *  de teclado que muda de forma e um cursor que se perde. */
const CONTROLE_MARCA = `flex items-center w-full text-left rounded-md ${ALVO_NO_DEDO} ${FOCO_MARCA}`;

/**
 * Bloco de marca do topo.
 *
 * O SUBTITULO difere de proposito entre os papeis — "Analise de Credito" e
 * "Sistema Admin" dizem em que produto voce esta, e apaga-lo seria perder
 * informacao. O TRATAMENTO (tamanho do ladrilho, corpo, peso e cor do nome,
 * corpo do subtitulo) e o mesmo nos dois: e ele que diz "mesma casa".
 */
function CabecalhoSidebar({
  simbolo,
  nome,
  subtitulo,
}: {
  simbolo: React.ReactNode;
  nome: React.ReactNode;
  subtitulo: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-[10px] cursor-pointer">
      {simbolo}
      <div className="flex flex-col min-w-0">
        <span className="text-[14px] font-bold tracking-[-0.02em] text-[var(--text)] leading-tight truncate">
          {nome}
        </span>
        <span className="text-[11px] text-[var(--text-muted)] leading-tight truncate">
          {subtitulo}
        </span>
      </div>
    </div>
  );
}

/**
 * Grupo de navegacao — rotulo e itens, sempre visiveis nos dois paineis.
 * Os menus de carteira dentro de Cobranca recolhem suas proprias operacoes.
 */
function GrupoNav({ titulo, children }: { titulo: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className={ROTULO_GRUPO}>{titulo}</div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

/**
 * Item de navegacao. Aceita `href` (rota) ou `acao` (o admin navega por hash
 * dentro de /admin-sistema): a forma e a mesma, so o mecanismo muda.
 */
function ItemNav({
  label,
  Icone,
  ativo,
  href,
  acao,
  testId,
  children,
}: {
  label: React.ReactNode;
  Icone: Icone;
  ativo: boolean;
  href?: string;
  acao?: () => void;
  testId?: string;
  /** Adorno a direita — hoje so o contador de alertas. */
  children?: React.ReactNode;
}) {
  const classe = `${ITEM_BASE} ${ativo ? ITEM_ATIVO : ITEM_INATIVO}`;
  const conteudo = (
    <>
      <Icone className="w-4 h-4 flex-none" strokeWidth={2} />
      <span className="truncate">{label}</span>
      {children}
    </>
  );

  if (href) {
    // Wouter 3 ja renderiza a propria <a>; embrulhar outra gerava <a><a>,
    // HTML invalido que quebra a navegacao por teclado.
    return (
      <Link
        href={href}
        data-testid={testId}
        aria-current={ativo ? "page" : undefined}
        className={classe}
      >
        {conteudo}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={acao}
      data-testid={testId}
      aria-current={ativo ? "page" : undefined}
      className={`${classe} w-full text-left`}
    >
      {conteudo}
    </button>
  );
}

/**
 * Rodape — quem esta logado, sair e a LGPD.
 *
 * O link de LGPD existia so no lado do provedor. O superadmin opera dado de
 * titular igual (ou mais), entao esconder dele a politica nao protegia nada;
 * so tornava a pagina mais dificil de achar exatamente para quem mais mexe
 * nesses dados.
 */
function RodapeSidebar({
  inicial,
  titulo,
  subtitulo,
  logout,
  children,
}: {
  inicial: string;
  titulo: React.ReactNode;
  subtitulo: React.ReactNode;
  logout: () => void;
  /** Slot acima do bloco de usuario (o aviso de trial, no provedor). */
  children?: React.ReactNode;
}) {
  return (
    <div className="border-t border-[var(--border)] px-4 py-[14px] flex flex-col gap-[10px]">
      {children}

      <div className="flex items-center gap-[10px]">
        <div className="w-[30px] h-[30px] rounded-full bg-[var(--brand-soft)] text-[var(--brand-ink)] grid place-items-center text-[12px] font-bold flex-none">
          {inicial}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[13px] font-semibold text-[var(--text)] truncate">{titulo}</span>
          <span className="text-[11px] text-[var(--text-muted)] truncate">{subtitulo}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={logout}
        data-testid="button-logout"
        className={`flex items-center gap-[10px] ${ALVO_NO_DEDO} rounded-md text-[13px] text-[var(--text-muted)] hover:text-[var(--text)] ${FOCO_MARCA} motion-safe:transition-colors`}
      >
        <LogOut className="w-4 h-4 flex-none" strokeWidth={2} />
        Sair
      </button>

      <a
        href="/lgpd"
        data-testid="link-lgpd"
        className={`flex items-center justify-center ${ALVO_NO_DEDO} rounded-md text-[11px] text-[var(--text-faint)] hover:text-[var(--text-muted)] ${FOCO_MARCA} motion-safe:transition-colors`}
      >
        Política de Privacidade · LGPD
      </a>
    </div>
  );
}

/** Casca: superficie, borda e as tres faixas (marca, navegacao, rodape). */
function CascaSidebar({
  cabecalho,
  children,
  rodape,
}: {
  cabecalho: React.ReactNode;
  children: React.ReactNode;
  rodape: React.ReactNode;
}) {
  return (
    <Sidebar>
      <div className="flex flex-col h-full bg-[var(--surface)] border-r border-[var(--border)]">
        <div className="flex items-center gap-[10px] px-4 pt-[18px] pb-[14px]">{cabecalho}</div>
        <nav className="flex-1 overflow-y-auto px-2 py-1 flex flex-col gap-[14px]">{children}</nav>
        {rodape}
      </div>
    </Sidebar>
  );
}

/* ==================================================================== */
/* Avisos                                                               */
/* ==================================================================== */

function TrialBanner() {
  const { data } = useQuery<any>({ queryKey: ["/api/provider/trial-status"], staleTime: 5 * 60 * 1000 });
  if (!data?.trial_ativo) return null;
  return (
    <div className="bg-[var(--gated-bg)] rounded-lg p-2.5 text-xs" data-testid="trial-banner">
      <div className="flex items-center gap-1.5 font-semibold text-[var(--gated)] mb-0.5">
        <Crown className="w-3 h-3" />
        Trial — {data.dias_restantes} dia{data.dias_restantes !== 1 ? "s" : ""} restante{data.dias_restantes !== 1 ? "s" : ""}
      </div>
      <p className="text-[var(--gated)] leading-relaxed">
        Aproveite todos os recursos. Assine para continuar após o período de avaliação.
      </p>
    </div>
  );
}

/**
 * Alertas de fuga em aberto, ao lado do item Anti-Fraude.
 *
 * "O provedor e avisado no anti-fraude" precisa ser verdade tambem para quem
 * esta na tela: sem o numero aqui, o aviso so existia no e-mail e na pagina,
 * e a pagina so e aberta por quem ja sabe que tem algo la. Componente proprio
 * para o hook nao entrar na ordem de hooks da sidebar, que tem retorno
 * antecipado para o superadmin.
 */
function ContadorDeAlertas() {
  const { data } = useQuery<Array<{ status: string }>>({
    queryKey: ["/api/anti-fraud/alerts"],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const abertos = (data ?? []).filter(a => a.status === "new" || a.status === "active").length;
  if (abertos === 0) return null;
  return (
    <span
      className="ml-auto min-w-[20px] h-5 px-1.5 rounded grid place-items-center text-[10.5px] font-semibold font-mono tabular-nums bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger-border)]"
      aria-label={`${abertos} alerta${abertos === 1 ? "" : "s"} de fuga em aberto`}
      data-testid="badge-anti-fraude"
    >
      {abertos}
    </span>
  );
}

/* ==================================================================== */
/* Conteudo: superadmin                                                 */
/* ==================================================================== */

type ItemAdmin = {
  title: string;
  hash: string;
  icon: Icone;
  testId: string;
  /** Item que e rota propria; sem isso, navega por hash dentro de /admin-sistema. */
  url?: string;
};

const ADMIN_GROUPS: Array<{ label: string; key: string; items: ItemAdmin[] }> = [
  {
    label: "Visão Geral",
    key: "overview",
    items: [
      { title: "Painel Geral", hash: "painel", icon: Activity, testId: "link-admin-painel" },
    ],
  },
  {
    label: "Gestão",
    key: "gestao",
    items: [
      { title: "Cadastros", hash: "cadastros", icon: ClipboardList, testId: "link-admin-cadastros" },
      { title: "Provedores", hash: "provedores", icon: Building2, testId: "link-admin-provedores" },
      { title: "Marcas White Label", hash: "marcas", icon: Palette, testId: "link-admin-marcas", url: "/admin/marcas" },
    ],
  },
  {
    label: "Financeiro",
    key: "financeiro",
    items: [
      { title: "Dashboard SaaS", hash: "financeiro-dash", icon: TrendingUp, testId: "link-admin-financeiro-dash", url: "/admin/financeiro" },
      { title: "Faturas e Cobranças", hash: "financeiro", icon: FileText, testId: "link-admin-financeiro" },
      { title: "Pedidos de Créditos", hash: "creditos-dash", icon: ShoppingCart, testId: "link-admin-creditos", url: "/admin/creditos" },
    ],
  },
  {
    label: "Compliance",
    key: "compliance",
    items: [
      { title: "LGPD / Titulares", hash: "lgpd-titulares", icon: Shield, testId: "link-admin-lgpd", url: "/admin/lgpd" },
    ],
  },
  {
    label: "Suporte",
    key: "suporte",
    items: [
      { title: "Chat com Provedores", hash: "suporte", icon: MessageSquare, testId: "link-admin-suporte" },
    ],
  },
  {
    label: "Configurações",
    key: "configuracoes",
    items: [
      { title: "Configurações", hash: "configuracoes", icon: Settings, testId: "link-admin-configuracoes" },
    ],
  },
];

/* ==================================================================== */
/* Conteudo: provedor                                                   */
/* ==================================================================== */

type ItemDeNav = { label: string; url: string; Icone: Icone; testId: string };

export const NAV_PROVEDOR: Array<{
  grupo: string;
  /** Cada menu com filhos abre suas operacoes; so o destino atual acende. */
  itens: Array<ItemDeNav & { filhos?: ItemDeNav[] }>;
}> = [
  {
    grupo: "Principal",
    itens: [
      { label: "Dashboard",     url: "/",            Icone: LayoutDashboard, testId: "link-dashboard" },
      { label: "Consulta ISP",  url: "/consulta-isp", Icone: ScanSearch,     testId: "link-consulta-isp" },
      { label: "Consulta Cadastral", url: "/consulta-cadastral", Icone: IdCard, testId: "link-consulta-cadastral" },
      { label: "Consulta SPC",  url: "/consulta-spc", Icone: BarChart3,      testId: "link-consulta-spc" },
      { label: "Anti-Fraude",   url: "/anti-fraude",  Icone: ShieldAlert,    testId: "link-anti-fraude" },
      // Antes chamava "Meus Dados" e apontava para /benchmark-regional (territorio).
      // O handoff Sidebar.md listava /meus-dados — rota do prototipo — e seguir
      // aquilo ao pe da letra repontou o item para a pagina de LGPD do titular,
      // deixando a de territorio orfa no menu. Nome e destino corrigidos aqui.
      { label: "Localização",   url: "/localizacao", Icone: MapPin,   testId: "link-localizacao" },
    ],
  },
  {
    // A cobranca e um trabalho proprio — carteira, fila, regua e politica —
    // feito por um funcionario do provedor. Grupo entre Principal e Financeiro
    // porque vem depois de consultar e antes de comprar credito (05/09/2026).
    grupo: "Cobrança",
    itens: [
      { label: "Conversas", url: "/cobranca/chat", Icone: MessageSquare, testId: "link-cobranca-chat" },
      // Os destinos de cada menu fixam a carteira mesmo quando a navegacao
      // comeca fora da cobranca ou na operacao da outra carteira.
      {
        label: "Clientes Ativos", url: "/cobranca/ativos", Icone: Users, testId: "menu-cobranca-ativos",
        filhos: [
          { label: "Visão geral", url: caminhoNaCarteira("/cobranca/ativos", "ativo"), Icone: Wallet, testId: "link-cobranca-ativos" },
          { label: "Fila do dia", url: caminhoNaCarteira("/cobranca/fila", "ativo"), Icone: ListTodo, testId: "link-cobranca-ativos-fila" },
          { label: "Kanban", url: caminhoNaCarteira("/cobranca/kanban", "ativo"), Icone: Kanban, testId: "link-cobranca-ativos-kanban" },
          { label: "Régua / DNA", url: caminhoNaCarteira("/cobranca/regua", "ativo"), Icone: Route, testId: "link-cobranca-ativos-regua" },
        ],
      },
      {
        label: "Ex-Clientes", url: "/cobranca/ex-clientes", Icone: UserX, testId: "menu-cobranca-ex-clientes",
        filhos: [
          { label: "Visão geral", url: caminhoNaCarteira("/cobranca/ex-clientes", "ex_cliente"), Icone: Wallet, testId: "link-cobranca-ex-clientes" },
          { label: "Fila do dia", url: caminhoNaCarteira("/cobranca/fila", "ex_cliente"), Icone: ListTodo, testId: "link-cobranca-ex-clientes-fila" },
          { label: "Kanban", url: caminhoNaCarteira("/cobranca/kanban", "ex_cliente"), Icone: Kanban, testId: "link-cobranca-ex-clientes-kanban" },
          { label: "Régua / DNA", url: caminhoNaCarteira("/cobranca/regua", "ex_cliente"), Icone: Route, testId: "link-cobranca-ex-clientes-regua" },
        ],
      },
      { label: "Política",    url: "/cobranca/politica", Icone: Scale,    testId: "link-cobranca-politica" },
    ],
  },
  {
    grupo: "Financeiro",
    itens: [
      { label: "Comprar Créditos", url: "/creditos", Icone: CreditCard, testId: "link-creditos" },
      { label: "Notas Fiscais",    url: "/nfse",     Icone: FileText,   testId: "link-nfse" },
    ],
  },
  {
    // Equipamento perdido e prejuizo direto do provedor e entra no score da
    // rede: merece grupo proprio, nao um item solto dentro de Gestao.
    grupo: "Equipamentos",
    itens: [
      { label: "Equipamentos", url: "/equipamentos", Icone: Package, testId: "link-equipamentos" },
      // Kanban por idade desde a rescisão: a fila de retirada em forma de quadro.
      { label: "Recuperação",  url: "/recuperacao",  Icone: Kanban,  testId: "link-recuperacao" },
      { label: "Conversas", url: "/equipamentos/chat", Icone: MessageSquare, testId: "link-equipamentos-chat" },
    ],
  },
  {
    grupo: "Gestão",
    itens: [
      { label: "Importação",         url: "/importacao",      Icone: Upload,    testId: "link-importacao" },
      { label: "Painel do Provedor", url: "/painel-provedor", Icone: Building2, testId: "link-painel-provedor" },
    ],
  },
  {
    grupo: "Configurações",
    itens: [
      { label: "Regionalização", url: "/configuracoes/regionalizacao", Icone: MapPin, testId: "link-regionalizacao" },
    ],
  },
];

/* ==================================================================== */
/* Conteudo: revendedor                                                 */
/* ==================================================================== */

/**
 * O menu de quem revende — e so o que EXISTE na fase 1.
 *
 * Provedores, Comissoes, Precos e Relatorios estao desenhados no mesmo
 * documento e chegam nas fases 2 a 4. Nao entram aqui antes das telas: item de
 * menu que leva a rota sem componente cai no 404, e um menu que promete quatro
 * telas quebradas ensina o revendedor a nao confiar no menu. Ha teste travando
 * este acordo — todo `url` daqui tem de estar em `REVENDA_PATHS` (App.tsx).
 *
 * Um grupo so porque sao tres itens: rotulo de grupo existe para separar
 * assunto, e com tres itens nao ha assunto a separar. Quando as telas das fases
 * seguintes entrarem, este grupo se divide.
 */
export const NAV_REVENDEDOR: Array<{
  grupo: string;
  itens: Array<{ label: string; url: string; Icone: Icone; testId: string }>;
}> = [
  {
    grupo: "Revenda",
    itens: [
      { label: "Visão geral", url: "/revenda",          Icone: LayoutDashboard, testId: "link-revenda-visao-geral" },
      { label: "Minha marca", url: "/revenda/marca",    Icone: Palette,         testId: "link-revenda-marca" },
      { label: "Equipe",      url: "/revenda/usuarios", Icone: Users,           testId: "link-revenda-usuarios" },
    ],
  },
];

/**
 * Qual item do menu de revenda esta aceso.
 *
 * `/revenda` e a RAIZ deste painel e por isso casa exato, exatamente como "/"
 * no menu do provedor. Com a regra de prefixo que vale para os outros itens,
 * "Visão geral" ficaria aceso junto com "Minha marca" e "Equipe" — duas linhas
 * destacadas ao mesmo tempo, e o operador deixa de saber onde esta.
 *
 * Os demais mantem o prefixo por segmento, para que uma subrota futura
 * (/revenda/marca/dominio, por exemplo) mantenha o pai aceso.
 */
export function itemDeRevendaAtivo(url: string, caminho: string): boolean {
  if (url === "/revenda") return caminho === "/revenda";
  return caminho === url || caminho.startsWith(url + "/");
}

/**
 * Qual item do menu do provedor esta aceso.
 *
 * Os destinos compartilhados (fila, quadro e regua) distinguem a carteira
 * pela query; a ficha acende a visao geral da carteira de origem. As demais
 * subrotas mantem o pai aceso, com excecao da raiz exata do painel.
 */
export function itemDeProvedorAtivo(url: string, caminho: string, search = ""): boolean {
  const [rota, consulta] = url.split("?");
  const carteiraDoItem = new URLSearchParams(consulta).get("carteira");
  const carteiraAtual = carteiraDaNavegacao(caminho, search);
  if (carteiraDoItem && carteiraDoItem !== carteiraAtual) return false;
  if (rota === "/") return caminho === "/";
  if (rota === "/cobranca") return false;
  if ((caminho === "/cobranca" || caminho.startsWith("/cobranca/cliente/")) && (rota === "/cobranca/ativos" || rota === "/cobranca/ex-clientes")) {
    return rota === retornoDaCarteira(carteiraAtual);
  }
  return caminho === rota || caminho.startsWith(rota + "/");
}

/* ==================================================================== */

export function AppSidebar() {
  const marca = useMarca();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const { user, provider, marca: marcaDaSessao, personificando, logout } = useAuth();

  /**
   * QUAL DOS DOIS MENUS — a pergunta nao e "quem e voce", e "onde voce esta".
   *
   * O criterio era `role === "superadmin"`, e ele quebra na unica situacao em
   * que os dois deixam de ser a mesma coisa: o acesso de suporte. Ali a sessao
   * ganha o `providerId` do provedor e MANTEM `role` como superadmin de
   * proposito (server/auth.ts) — e o que separa suporte de admin de verdade no
   * log e na faixa vermelha. Pelo papel, o suporte via o menu da plataforma:
   * Provedores, Marcas, Dashboard SaaS, e nenhum item levando a uma tela do
   * provedor que ele entrou para atender. O escopo liberado so era alcancavel
   * digitando URL a mao.
   *
   * `personificando` vem de `GET /api/auth/me`, que le `session.suporte` — a
   * janela que a trava reconfere a cada requisicao. Nao e autorizacao nenhuma:
   * o servidor decide o que responde, isto so decide o que se navega.
   *
   * O QUE O SUPORTE PERDE, E POR QUE ISSO E O CERTO
   * Enquanto personificando ele deixa de ver Provedores, Marcas White Label e
   * Dashboard SaaS. Aquelas telas sao da plataforma e listam dado de OUTROS
   * provedores; a janela que o provedor A abriu autoriza olhar o dado de A, e
   * so. Um suporte dentro da conta de A com a lista de todos os provedores na
   * frente usa o consentimento de A para ver o que nao tem nada a ver com A —
   * exatamente o isolamento que este produto vende. Elas voltam quando ele sai,
   * que e um clique na faixa.
   *
   * E O CAMINHO DE VOLTA nao se duplica aqui. A faixa vermelha ja carrega o
   * "sair" e ela e permanente, no topo, em toda tela. Um segundo botao na
   * sidebar seria uma segunda implementacao do mesmo encerramento (a da faixa
   * chama a rota E apaga o lembrete de personificacao), com o risco classico de
   * uma das duas ficar para tras — e sairia da faixa justamente o que a torna
   * util: ser o unico lugar onde o estado de suporte se le e se desfaz.
   */
  const menuDaPlataforma = user?.role === "superadmin" && !personificando;

  const [activeHash, setActiveHash] = useState(() =>
    typeof window !== "undefined" ? window.location.hash.replace("#", "") || "painel" : "painel"
  );

  useEffect(() => {
    if (!menuDaPlataforma) return;
    const handleHashChange = () => {
      setActiveHash(window.location.hash.replace("#", "") || "painel");
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [menuDaPlataforma]);

  const handleAdminNavigate = (hash: string) => {
    setActiveHash(hash);
    if (location !== "/admin-sistema") {
      navigate("/admin-sistema");
    }
    window.history.replaceState(null, "", `/admin-sistema#${hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  if (menuDaPlataforma) {
    return (
      <CascaSidebar
        cabecalho={
          <button
            type="button"
            onClick={() => handleAdminNavigate("painel")}
            className={CONTROLE_MARCA}
          >
            {/* Marca da plataforma, sempre: o painel do superadmin nao pertence
                a nenhum revendedor, e exibir a marca de um seria mentira. */}
            <CabecalhoSidebar
              simbolo={<LadrilhoDaPlataforma />}
              nome="Consulta ISP"
              subtitulo="Sistema Admin"
            />
          </button>
        }
        rodape={
          <RodapeSidebar
            inicial={user?.name?.charAt(0)?.toUpperCase() || "A"}
            titulo={user?.name}
            subtitulo="Super Admin"
            logout={logout}
          />
        }
      >
        {ADMIN_GROUPS.map((group) => (
          <GrupoNav key={group.key} titulo={group.label}>
            {group.items.map((item) => (
              <ItemNav
                key={item.hash}
                label={item.title}
                Icone={item.icon}
                ativo={item.url ? location === item.url : activeHash === item.hash}
                href={item.url}
                acao={item.url ? undefined : () => handleAdminNavigate(item.hash)}
                testId={item.testId}
              />
            ))}
          </GrupoNav>
        ))}
      </CascaSidebar>
    );
  }

  /**
   * TERCEIRO RAMO: o revendedor. Vem antes do provedor porque o ramo de baixo
   * nao pergunta papel nenhum — ele e o "todo o resto", e o revendedor cairia
   * nele por omissao, com o menu de consultas e inadimplentes de um provedor
   * que ele nao tem.
   *
   * O NOME DO PRODUTO tem duas fontes e elas quase sempre concordam. Prefiro a
   * da SESSAO (`useAuth().marca`): ela e a marca que este usuario administra, e
   * o revendedor so consegue logar no dominio proprio dela
   * (`hostPertenceAMarca`). A de `useMarca()` vem do host, injetada no HTML, e
   * cai para "Consulta ISP" quando `window.__MARCA__` falta — o que colocaria a
   * marca da PLATAFORMA no topo do painel de um revendedor. A ordem inverte esse
   * risco: a sessao manda, o host completa.
   *
   * O SIMBOLO, ao contrario, so pode vir do host: `SimboloDaMarca` desenha a
   * logo por `<img src=/api/marca/:id/logo>` e o `/me` nao carrega imagem de
   * proposito. Nos dois casos que existem hoje e a mesma marca.
   *
   * SEM TrialBanner (trial e do provedor; a rota nem existe no servidor), SEM
   * ContadorDeAlertas (anti-fraude e do provedor, e o revendedor nunca ve
   * cliente de ninguem) e SEM ChatWidget — este ultimo fica em App.tsx/chat-widget.
   */
  if (user?.role === "revendedor") {
    const nomeProduto = marcaDaSessao?.nomeProduto || marca.nomeProduto;
    /* A assinatura so vale quando o HOST resolveu uma marca de verdade. Sem
       esse cuidado, num ambiente sem a injecao do HTML (dev em localhost, onde
       `hostPertenceAMarca` ainda deixa o revendedor entrar) o painel dele sairia
       com o nome da marca por cima da assinatura da PLATAFORMA. */
    const assinatura = marca.marcaId !== null ? marca.assinatura : null;
    return (
      <CascaSidebar
        cabecalho={
          <Link href="/revenda" className={CONTROLE_MARCA}>
            <CabecalhoSidebar
              simbolo={
                marca.marcaId !== null ? <SimboloDaMarca tamanho={34} /> : <LadrilhoDaPlataforma />
              }
              nome={nomeProduto}
              /* Com assinatura, a voz da marca vence. Sem ela, o rotulo diz em
                 QUAL painel voce esta — o mesmo trabalho que "Sistema Admin"
                 faz no ramo do superadmin, e que aqui importa mais ainda:
                 revendedor e provedor podem vestir a MESMA marca. */
              subtitulo={assinatura || "Revenda"}
            />
          </Link>
        }
        rodape={
          <RodapeSidebar
            inicial={user?.name?.charAt(0)?.toUpperCase() || "R"}
            titulo={user?.name}
            subtitulo={`Revenda · ${nomeProduto}`}
            logout={logout}
          />
        }
      >
        {NAV_REVENDEDOR.map(({ grupo, itens }) => (
          <GrupoNav key={grupo} titulo={grupo}>
            {itens.map(({ label, url, Icone, testId }) => (
              <ItemNav
                key={url}
                label={label}
                Icone={Icone}
                ativo={itemDeRevendaAtivo(url, location)}
                href={url}
                testId={testId}
              />
            ))}
          </GrupoNav>
        ))}
      </CascaSidebar>
    );
  }

  const estaAtivo = (url: string) => itemDeProvedorAtivo(url, location, search);
  const hrefDaOperacao = (url: string) => (location === "/cobranca" || location.startsWith("/cobranca/")) && url === "/cobranca/chat"
    ? caminhoNaCarteira(url, carteiraDaNavegacao(location, search)) : url;

  return (
    <CascaSidebar
      cabecalho={
        <Link href="/" className={CONTROLE_MARCA}>
          {/* White label: a marca do revendedor entra aqui (logo por <img>, ou
              monograma quando ele ainda nao subiu um). Sem revendedor, fica o
              arco de score da plataforma, intacto — white label nao e desculpa
              para redesenhar a marca-mae. */}
          <CabecalhoSidebar
            simbolo={
              marca.marcaId !== null ? <SimboloDaMarca tamanho={34} /> : <LadrilhoDaPlataforma />
            }
            nome={marca.nomeProduto}
            subtitulo={marca.marcaId === null ? "Análise de Crédito" : (marca.assinatura ?? "")}
          />
        </Link>
      }
      rodape={
        <RodapeSidebar
          inicial={user?.name?.charAt(0)?.toUpperCase() || "U"}
          titulo={user?.name}
          subtitulo={(provider as any)?.tradeName || provider?.name}
          logout={logout}
        >
          <TrialBanner />
        </RodapeSidebar>
      }
    >
      {NAV_PROVEDOR.map(({ grupo, itens }) => (
        <GrupoNav key={grupo} titulo={grupo}>
          {itens.map(({ label, url, Icone, testId, filhos }) => filhos ? (
            <details key={url} open={filhos.some(f => estaAtivo(f.url))} className="group/carteira" data-testid={testId}>
              <summary className={`${ITEM_BASE} ${ITEM_INATIVO} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                <Icone className="w-4 h-4 flex-none" strokeWidth={2} aria-hidden="true" />
                <span className="truncate">{label}</span>
                <ChevronRight className="ml-auto w-3.5 h-3.5 flex-none group-open/carteira:rotate-90 motion-safe:transition-transform" aria-hidden="true" />
              </summary>
              <div className="ml-[18px] flex flex-col gap-0.5 border-l border-[var(--border)] pl-2" role="group" aria-label={label}>
                {filhos.map(f => (
                  <ItemNav key={f.url} label={f.label} Icone={f.Icone} ativo={estaAtivo(f.url)} href={f.url} testId={f.testId} />
                ))}
              </div>
            </details>
          ) : (
            <ItemNav
              key={url}
              label={label}
              Icone={Icone}
              ativo={estaAtivo(url)}
              href={hrefDaOperacao(url)}
              testId={testId}
            >
              {url === "/anti-fraude" && <ContadorDeAlertas />}
            </ItemNav>
          ))}
        </GrupoNav>
      ))}
    </CascaSidebar>
  );
}
