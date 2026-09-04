import {
  BarChart3, Activity, Building2, Users, Database, DollarSign,
  MessageSquare, RefreshCw, Settings, Clock, CheckCircle, XCircle,
} from "lucide-react";
import { rotuloDoPlano } from "@/lib/planos";
import { type TomSelo, type Icone } from "@/components/painel/ui";

export const VALID_TABS = [
  "painel",
  "cadastros",
  "provedores",
  "financeiro",
  "suporte",
  "configuracoes",
] as const;

export type AdminTabKey = (typeof VALID_TABS)[number];

/**
 * Meta das abas do admin. Sem cor por aba: no Bureau a identidade vem da
 * tipografia, e sete gradientes diferentes eram exatamente a bagunca.
 *
 * TEXTO DE TELA, secao 8 do DESIGN_SYSTEM: portugues com acento e sem jargao.
 * Duas descricoes falhavam nisso e foram reescritas:
 *   "Cadastros realizados pela landing page" -> "landing page" e palavra de
 *     quem constroi o site, nao de quem le a tela. Virou "pelo site".
 *   "Chat direto com provedores e visitantes" -> "conversas", e dito de quem
 *     sao os visitantes (do site), que sozinho nao se entendia.
 * "ERP" fica: e a palavra que o proprio provedor usa para o sistema dele.
 */
export const PAGE_META: Record<string, { title: string; desc: string; icon: Icone }> = {
  painel: { title: "Painel Geral", desc: "Visão geral do sistema", icon: BarChart3 },
  cadastros: { title: "Cadastros", desc: "Provedores que se cadastraram pelo site", icon: Activity },
  provedores: { title: "Provedores", desc: "Gerencie todos os provedores", icon: Building2 },
  financeiro: { title: "Faturas e Cobranças", desc: "Receita, faturas e pagamentos", icon: DollarSign },
  suporte: { title: "Suporte", desc: "Conversas com provedores e visitantes do site", icon: MessageSquare },
  configuracoes: { title: "Configurações", desc: "Catálogo de ERPs e configurações do sistema", icon: Settings },
  // Chaves antigas, ainda alcancadas por link salvo e por navegacao interna.
  usuarios: { title: "Usuários", desc: "Contas e acessos do sistema", icon: Users },
  erps: { title: "ERPs Cadastrados", desc: "Gerencie os sistemas ERP suportados", icon: Database },
  integracoes: { title: "Integrações", desc: "Configuração de ERP por provedor", icon: Database },
  sincronizacao: { title: "Sincronização automática", desc: "Agendamento e acompanhamento das varreduras de ERP", icon: RefreshCw },
};

/**
 * Plano, como selo do sistema.
 *
 * O ROTULO vem de `@/lib/planos` — fonte unica. So o TOM mora aqui, porque e
 * decisao desta tela.
 *
 * POR QUE SO O TOM
 * Havia um segundo campo aqui que devolvia uma string de classes pronta, para
 * quem ainda pintava a pilula de plano a mao. Ele nasceu @deprecated com um
 * contrato explicito — sai quando o ultimo consumidor migrar — e o contrato foi
 * cumprido: o VisaoGeralTab era o ultimo, e era justamente quem redigitava o
 * corpo inteiro do `Selo` (raio, padding, mono, caixa alta, tracking) so para
 * injetar aquela cor. Copia manuscrita e como a divergencia comeca: o proximo
 * ajuste de selo seria feito de um lado so. Com o campo fora, a unica forma de
 * pintar um plano e `<Selo tom={PLAN_LABELS[p.plan]?.tom}>` — nao ha mais o que
 * redigitar, e nao ha mais dois campos que possam discordar.
 *
 * O TOM DE CADA PLANO, PELO SIGNIFICADO
 * Plano nao e risco, e a secao 3 do DESIGN_SYSTEM reserva saturacao para risco.
 * Sobram dois tons honestos, e a linha que os separa e o catalogo de
 * `lib/planos.ts` — hoje `free` e `pro`:
 *   pro                      -> `marca`  : o plano pago que o produto oferece.
 *   free                     -> `neutro` : existe, nao paga, nao precisa de voz.
 *   basic, enterprise        -> `neutro` : fora do catalogo desde a migracao
 *     0014. So aparecem em registro historico (`plan_changes`, `plan_at_time`
 *     de fatura). Destacar com a cor da marca um plano que ninguem mais pode
 *     contratar confunde quem le a lista.
 *
 * MUDANCA DE PIXEL, DECLARADA: o `pro` era `--brand-soft` + `--brand-hover`, e
 * o comentario anterior registrava que `--brand-hover` NAO e o par semantico de
 * `--brand-soft` (esse e `--brand-ink`, index.css:39) — a troca ficou adiada
 * porque aquela rodada era de token, nao de cor. Adotar o tom `marca` da
 * primitiva resolve o adiamento pelo unico caminho que nao recria o problema:
 * quem decide a cor do selo passa a ser a primitiva, para os dois paineis de
 * uma vez.
 */
export const PLAN_LABELS: Record<string, { label: string; tom: TomSelo }> = {
  free: selo("free", "neutro"),
  pro: selo("pro", "marca"),
  basic: selo("basic", "neutro"),
  enterprise: selo("enterprise", "neutro"),
};

function selo(chave: string, tom: TomSelo) {
  return { label: rotuloDoPlano(chave), tom };
}

/**
 * Situacao da conferencia de cadastro do provedor.
 *
 * Estava aqui como `Record<...> = {}` — um mapa vazio que devolvia `undefined`
 * para toda chave, com o comentario "populated at use-site to avoid circular
 * icon imports". Nao ha circularidade nenhuma: `lucide-react` nao importa nada
 * deste projeto. O efeito real era um contrato armadilha, e o CadastrosTab
 * mantendo a propria copia, escrita na API antiga de token.
 * Preenchido de verdade, no mesmo formato do plano.
 *
 * Aqui a saturacao E legitima: pendente/aprovado/rejeitado e exatamente o eixo
 * que a secao 3 reserva para ela — `gated` e a porta que ainda nao abriu,
 * `danger` e a que fechou.
 */
export const VERIFICATION_LABELS: Record<
  string,
  { label: string; tom: TomSelo; Icone: Icone }
> = {
  pending: { label: "Pendente", tom: "gated", Icone: Clock },
  approved: { label: "Aprovado", tom: "ok", Icone: CheckCircle },
  rejected: { label: "Rejeitado", tom: "danger", Icone: XCircle },
};

/**
 * Os ERPs que o servidor sabe falar. Uma entrada por conector registrado em
 * `server/erp/index.ts` — dez, nem mais nem menos.
 *
 * SAIRAM TRES FANTASMAS: `tiacos`, `flyspeed` e `netflash` nunca tiveram
 * conector. Estavam aqui e em filtro visivel ao provedor, ou seja, a plataforma
 * anunciava integracao com ERP que ela nao integra. Nome de ERP que nao existe
 * nao e enfeite: e promessa.
 *
 * FICARAM AS QUATRO CASCAS (`topsapp`, `radiusnet`, `gere`, `receitanet`, que
 * declaram `naoImplementado` no conector) porque esta lista NAO escolhe ERP —
 * ela TRADUZ. O unico consumidor e `ERP_MAP`, e o unico consumidor de `ERP_MAP`
 * le uma chave que ja esta no banco (`erpSource` de uma integracao gravada) e
 * quer o nome de gente. Quem tem uma dessas quatro gravadas precisa ver
 * "TopSApp" e nao `topsapp`; esconder a traducao nao desimplementa o conector,
 * so piora a leitura da tela do superadmin. Se um dia esta lista virar SELETOR,
 * ai sim a casca importa — e a decisao muda junto com o papel.
 *
 * SAIU O CAMPO `grad`: eram treze gradientes da paleta default do Tailwind (um
 * par de paradas de gradiente por ERP), duas proibicoes da secao 7 de uma vez. Nao
 * tinha consumidor — o que a tela de catalogo pinta e `erp.gradient`, coluna do
 * proprio `erp_catalog`, outro dado. Campo morto que so servia de exemplo ruim.
 */
export const ERP_OPTIONS: { key: string; name: string; desc: string }[] = [
  { key: "ixc", name: "iXC Soft", desc: "iXC Provedor" },
  { key: "mk", name: "MK Solutions", desc: "MK-Auth" },
  { key: "sgp", name: "SGP", desc: "Sistema Gerencial de Provedores" },
  { key: "hubsoft", name: "Hubsoft", desc: "Hubsoft ERP" },
  { key: "voalle", name: "Voalle", desc: "Voalle ERP" },
  { key: "rbx", name: "RBX ISP", desc: "RBXSoft" },
  { key: "topsapp", name: "TopSApp", desc: "TopSApp ERP" },
  { key: "radiusnet", name: "RadiusNet", desc: "RadiusNet ERP" },
  { key: "gere", name: "Gere", desc: "Gere ERP" },
  { key: "receitanet", name: "ReceitaNet", desc: "ReceitaNet ERP" },
];

/** Chave gravada -> nome de gente. Nunca devolve vazio: quem chama cai na
 *  propria chave, que ao menos e verdade. */
export const ERP_MAP: Record<string, string> = Object.fromEntries(ERP_OPTIONS.map(e => [e.key, e.name]));

export const QUICK_REPLIES = [
  "Olá! Como posso ajudar?",
  "Obrigado pelo contato. Vamos verificar isso para você.",
  "Seu pedido foi registrado e será processado em breve.",
  "Para resolver isso, precisamos de mais informações. Poderia detalhar melhor?",
  "O problema foi identificado e está sendo resolvido.",
  "Sua conta foi atualizada com sucesso!",
  "Por favor, acesse o painel e verifique se o problema persiste.",
];

export function chatRelTime(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function chatFullTime(d: string): string {
  return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function chatDayLabel(d: string): string {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Hoje";
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function providerInitials(name: string): string {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
