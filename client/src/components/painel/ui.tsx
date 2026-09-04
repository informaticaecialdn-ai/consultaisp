/**
 * Primitivas de painel — o vocabulario visual do Painel do Provedor, extraido.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * O painel SaaS (superadmin) e o painel do provedor nao pareciam o mesmo produto,
 * e a causa nao era gosto: eram dois vocabularios de token. Medido por grep,
 * `components/admin` + `pages/admin` estava 70% na API antiga de token e
 * `pages/provedor` 84% nos nomes canonicos (`--text`, `--surface`, `--brand`...).
 * (O literal da API antiga nao aparece escrito neste arquivo de proposito: uma
 * auditoria por grep nao pode ser envenenada pelo comentario que conta que ela
 * saiu.)
 * Duas telas escritas em linguas diferentes divergem em tudo o mais: tamanho de
 * rotulo, raio, densidade, tratamento de carregamento.
 *
 * Unificar por copia resolveria a tela de hoje e criaria a divergencia do mes que
 * vem — o primeiro ajuste feito de um lado so ja quebra o pareamento. Por isso a
 * linguagem vira PRIMITIVA: um lugar unico onde tamanho, cor e espacamento vivem,
 * e ambos os paineis consomem. Se o valor mudar, muda para os dois.
 *
 * A REFERENCIA e o Painel do Provedor (`pages/provedor/dashboard.tsx`), que ja
 * estava correto contra o DESIGN_SYSTEM.md. Os valores aqui foram portados de la
 * letra por letra, de proposito e sem "melhorias": qualquer ajuste no caminho
 * faria a propria referencia divergir de si mesma, e ai nao haveria mais
 * referencia. Ajuste de valor visual e uma decisao a parte, feita aqui, uma vez.
 *
 * SEGUNDA LEVA (Selo, BotaoLink, EstadoVazio, LinhasSkeleton, LadrilhoIcone e o
 * titulo de cartao)
 * Estas nasceram LOCAIS dentro do painel do admin, no mesmo commit que criou a
 * primitiva para acabar com duplicacao — e o painel do provedor nao tinha
 * equivalente de nenhuma. Era a semente da divergencia: o proximo ajuste de
 * badge seria feito de um lado so. Subiram para ca.
 * Ao portar, cada uma foi lida contra o DESIGN_SYSTEM, nao contra quem chegou
 * primeiro. Onde as duas telas divergiam, a decisao esta escrita no comentario
 * da propria primitiva — alvo de toque em `ALVO_CONTROLE`, cor de ladrilho em
 * `LadrilhoIcone`.
 *
 * TERCEIRA LEVA (tabela, rotulo de campo, botao de icone, desabilitado, anel de
 * foco e ladrilho de inicial)
 * A leva anterior cobria cartao, selo, vazio e skeleton — e nao cobria nada
 * disto. Sete arquivos, sem se falar, escreveram os proprios: cabecalho de
 * tabela em 3 valores, celula em 3, rotulo de campo em 4 vozes, estado
 * desabilitado em 4 valores sob 2 nomes, botao de icone em 3 tamanhos. Ou seja,
 * a rodada que existia para matar a divergencia replantou uma safra dela, e
 * pelo mesmo motivo: o vocabulario faltava, entao cada tela inventou o seu.
 *
 * COMO A DIVERGENCIA FOI RESOLVIDA: pelo DESIGN_SYSTEM, nao pela contagem. Em
 * tabela e em rotulo de campo o valor mais repetido PERDEU, porque o documento
 * e explicito nos dois casos (secao 6 `.ds-table`, secao 2 rotulo mono). Cada
 * escolha esta escrita no comentario da primitiva, com o que foi descartado.
 *
 * REGRAS DE USO
 * - So apresentacao. Nenhuma primitiva faz fetch, query ou aplica regra de negocio.
 * - Navegacao fica FORA: quem usa envolve em <Link> do wouter. O <a> do Link
 *   participa da grade, e embutir isso aqui mudaria o layout de quem ja funciona.
 * - Todas aceitam `testId` para preservar os data-testid de que testes e automacao
 *   dependem.
 */
import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Rotulo de dado: Inter 10.5px, caixa alta, tracking aberto, texto auxiliar.
 *  Mesma voz no rotulo de metrica, no rotulo de pilula e no kicker de secao —
 *  e isso que faz a pagina inteira soar como um instrumento so. */
const ROTULO =
  "text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]";

/** Numero de metrica: mono tabular em --text. Acento e acao; dado e dado. */
const VALOR_METRICA =
  "mt-1.5 font-mono text-[21px] font-medium tracking-[-0.02em] text-[var(--text)] tabular-nums";

/** Titulo de cartao. Mesmo corpo do titulo do `CartaoAcao`, e de proposito: a
 *  hierarquia da pagina e kicker (caixa alta pequena) > titulo de cartao >
 *  corpo. Nasceu redigitado dentro do painel do admin; subiu para ca para que o
 *  proximo ajuste de corpo valha para os dois paineis de uma vez. */
export const TITULO_CARTAO = "text-[13.5px] font-semibold text-[var(--text)] leading-tight";

/** ALVO DE TOQUE — a regra que reconcilia densidade com a secao 7.
 *
 *  O produto tinha dois tamanhos de CTA: 44px no painel do admin (secao 7:
 *  alvo minimo de toque) e 36px no painel do provedor (secao 4: densidade e
 *  decisao de produto). As duas leituras estao certas, so nao no mesmo
 *  ponteiro. A tecnica que o projeto ja usa em `components/ui/button.tsx`
 *  (variantes `sm` e `icon`) resolve: denso no mouse, 44px no dedo.
 *
 *  Use em qualquer controle novo destes paineis. */
export const ALVO_CONTROLE = "min-h-[36px] [@media(pointer:coarse)]:min-h-11";

/** ABAS na pele do painel: poco de superficie, aba ativa erguida por anel de
 *  1px — profundidade e borda, nunca sombra (secao 5.2). O anel de foco do
 *  primitivo (ring-2 em `--ring`, que aponta para a marca) fica como esta.
 *
 *  Moraram duplicadas em `components/admin/ProviderDrawer.tsx` e
 *  `pages/admin/admin-marcas.tsx`, copiadas letra por letra e declaradas como
 *  divida nas duas. Duas telas com o mesmo componente de aba e aparencia que
 *  diverge no primeiro ajuste nao e economia nenhuma.
 *
 *  A contagem de colunas fica LITERAL, e nao interpolada: o Tailwind gera CSS
 *  varrendo o fonte em busca de nomes de classe inteiros, entao um
 *  `grid-cols-${n}` montado em tempo de execucao nunca chega a existir no
 *  bundle — a barra de abas perderia a grade e viraria uma pilha, sem erro em
 *  lugar nenhum. As duas telas usam quatro. */
export const ABA = `${ALVO_CONTROLE} rounded text-[12.5px] font-medium text-[var(--text-muted)] data-[state=active]:bg-[var(--surface)] data-[state=active]:text-[var(--text)] data-[state=active]:shadow-[0_0_0_1px_var(--border)]`;

export const LISTA_ABAS = "grid w-full grid-cols-4 h-auto p-1 bg-[var(--surface-inset)] rounded-md";

/** LARGURA do alvo, para controle quadrado. `ALVO_CONTROLE` so fala de altura;
 *  num botao de icone o eixo horizontal precisa acompanhar, senao no dedo o
 *  alvo tem 44px de altura e 36 de largura — e a secao 7 fala dos dois eixos.
 *
 *  O `!px-0` existe porque isto se compoe em cima de `BOTAO_SECUNDARIO` /
 *  `BOTAO_MARCA`, que ja trazem padding horizontal: a ordem das classes dentro
 *  de uma string nao decide quem vence entre duas utilidades `px`. */
export const CAIXA_ICONE = `${ALVO_CONTROLE} !px-0 w-9 [@media(pointer:coarse)]:w-11`;

/** ALVO DE UM CONTROLE COM CARA DE TEXTO — o "Tentar de novo" sublinhado, o
 *  "ver todos" no fim de uma lista.
 *
 *  `ALVO_CONTROLE` nao serve aqui: os 36px do piso dele engordariam uma faixa
 *  de aviso de 16px para 36px so por causa do link, e a secao 4 trata densidade
 *  como decisao de produto. Mas 16px de altura tambem nao passa na secao 7, que
 *  e nao negociavel — no dedo o alvo tem de ter 44px.
 *
 *  A saida e a mesma tecnica do resto do arquivo, com o piso do ponteiro fino
 *  removido: no mouse o controle mantem a altura do proprio texto, no ponteiro
 *  grosso ele cresce para 44px. O `inline-flex` existe para o crescimento
 *  centralizar o texto em vez de empurra-lo para o topo da caixa; ele nao muda
 *  nada no ponteiro fino, onde a caixa ja tem a altura da linha.
 *
 *  So a ALTURA e tratada: a largura de um rotulo de duas palavras ja passa dos
 *  44px com folga. Para controle curto ou quadrado use `CAIXA_ICONE`. */
export const ALVO_TEXTO = "inline-flex items-center [@media(pointer:coarse)]:min-h-11";

/** ANEL DE FOCO — secao 7, nao negociavel.
 *
 *  ARMADILHA: `focus-visible:outline-2` sozinho NAO pinta nada. O Tailwind so
 *  emite `outline-width` a partir dele; sem o `focus-visible:outline` cru, que
 *  e quem emite `outline-style: solid`, o anel tem largura e nenhum traco. Foi
 *  por isso que a classe virou constante: escrita a mao, some a metade que
 *  importa e ninguem percebe ate testar com o teclado. */
export const FOCO =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]";

/** Mesmo anel, desenhado para DENTRO. Use em item de lista, linha de tabela e
 *  qualquer alvo colado na borda de um painel — com o deslocamento para fora,
 *  a borda do container corta o anel e o foco fica invisivel de novo. */
export const FOCO_INTERNO =
  "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--brand)]";

/** ESTADO DESABILITADO — um valor so, e o porque de ser este.
 *
 *  Havia quatro valores sob dois nomes: opacidade 40 ou 50, e o par de
 *  modificadores em toda combinacao. Duas decisoes resolvem:
 *
 *  1. OPACIDADE 50, e nao 40. O desabilitado nao entra no minimo de contraste
 *     da secao 7, mas 40% joga ate a tinta mais escura para perto do papel — o
 *     operador deixa de LER o botao travado, e o rotulo dele e justamente o que
 *     explica o que falta fazer. 50% e a mais rasa das duas.
 *  2. `cursor-not-allowed`, e nao `pointer-events-none`. Os dois juntos, como
 *     estavam em uma das copias, sao contraditorios: sem eventos de ponteiro o
 *     cursor nunca troca e a regra nunca chega a valer. O cursor e a unica
 *     coisa que AVISA que o controle esta travado — e um `<button disabled>` ja
 *     ignora o clique por conta propria, entao nao ha o que bloquear.
 *
 *  Para controle que NAO e `<button>` (ancora, div clicavel), onde o navegador
 *  nao ignora o clique sozinho, use `DESABILITAVEL_INERTE`. */
export const DESABILITAVEL = "disabled:opacity-50 disabled:cursor-not-allowed";

/** `DESABILITAVEL` mais o bloqueio de evento. So para controle que o navegador
 *  nao trava sozinho — e o preco e perder o cursor de aviso e o tooltip. */
export const DESABILITAVEL_INERTE = `${DESABILITAVEL} disabled:pointer-events-none`;

/** Botao secundario (fundo de superficie, borda forte). Foco com anel visivel —
 *  nao negociavel. */
export const BOTAO_SECUNDARIO = `inline-flex items-center justify-center gap-1.5 ${ALVO_CONTROLE} px-3.5 rounded text-[12.5px] font-medium text-[var(--text)] bg-[var(--surface)] border border-[var(--border-strong)] hover:bg-[var(--surface-2)] ${FOCO} motion-safe:transition-colors`;

/** Botao de marca (CTA cheio). Mesmos valores do botao "Comprar" do painel do
 *  provedor, mais a regra de alvo de toque. */
export const BOTAO_MARCA = `inline-flex items-center justify-center gap-1.5 flex-none ${ALVO_CONTROLE} text-[12.5px] font-medium px-3 py-2 rounded bg-[var(--brand)] text-white hover:opacity-90 ${FOCO} motion-safe:transition-opacity active:scale-[0.97]`;

/** Icone de lucide-react. O pacote nao exporta o tipo, e o
 *  `ForwardRefExoticComponent` dele nao encaixa em `ComponentType<...>` — os dois
 *  declaram `propTypes` opcional com P diferente. `ElementType` aceita qualquer
 *  componente renderavel, que e exatamente o contrato aqui. */
export type Icone = React.ElementType;

/* ------------------------------------------------------------------ */
/* Cabecalho de pagina                                                 */
/* ------------------------------------------------------------------ */

export function CabecalhoPainel({
  titulo,
  descricao,
  acoes,
  testId,
  testIdTitulo,
}: {
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  /** Pilulas e botoes a direita. Envolvem sozinhos em <Link> quando navegam. */
  acoes?: React.ReactNode;
  testId?: string;
  testIdTitulo?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap" data-testid={testId}>
      <div>
        <h1
          className="text-[19px] font-medium tracking-[-0.02em] text-[var(--text)] leading-tight"
          data-testid={testIdTitulo}
        >
          {titulo}
        </h1>
        {descricao != null && (
          <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{descricao}</p>
        )}
      </div>
      {acoes && <div className="flex items-center gap-3 flex-wrap">{acoes}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pilula de cabecalho                                                 */
/* ------------------------------------------------------------------ */

/** Bloco compacto com icone, valor mono e rotulo em caixa alta, ao lado do titulo.
 *
 *  Dois tons, e a diferenca nao e decorativa:
 *  - `neutro`  — identificador que se le e se dita (codigo do parceiro). Alinhado
 *    a esquerda como texto, corpo menor, tinta normal.
 *  - `marca`   — leitura numerica de saldo. Alinhada a direita para a unidade
 *    ficar sob o numero, corpo maior, na cor da marca porque leva a uma acao.
 *
 *  `interativa` liga o affordance de clique; combine com <Link> por fora. */
export function PilulaCabecalho({
  Icone,
  valor,
  rotulo,
  tom = "neutro",
  interativa = false,
  titleAtributo,
  testId,
  testIdValor,
}: {
  Icone: Icone;
  valor: React.ReactNode;
  rotulo: React.ReactNode;
  tom?: "neutro" | "marca";
  interativa?: boolean;
  /** Tooltip nativo — usado para explicar o que o valor significa. */
  titleAtributo?: string;
  testId?: string;
  testIdValor?: string;
}) {
  const marca = tom === "marca";
  return (
    <div
      className={cn(
        "flex items-center gap-2 border border-[var(--border)] rounded-lg px-2.5 py-1.5 bg-[var(--surface)]",
        interativa &&
          "cursor-pointer hover:border-[var(--border-strong)] motion-safe:transition-colors",
      )}
      title={titleAtributo}
      data-testid={testId}
    >
      <Icone
        className={cn(
          "w-4 h-4 flex-none",
          marca ? "text-[var(--brand)]" : "text-[var(--text-faint)]",
        )}
        strokeWidth={2}
      />
      <div className={marca ? "text-right" : undefined}>
        <p
          className={cn(
            "font-mono font-medium tabular-nums leading-none",
            marca ? "text-[15px] text-[var(--brand)]" : "text-[12px] text-[var(--text)]",
          )}
          data-testid={testIdValor}
        >
          {valor}
        </p>
        <p className={cn(ROTULO, "leading-tight mt-1")}>{rotulo}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cartao de metrica                                                   */
/* ------------------------------------------------------------------ */

/** Slot de ESTADO: ocupa exatamente a caixa que o numero ocuparia — 21px de
 *  corpo com o line-height 1.5 do body = 31.5px — e centraliza o conteudo nela.
 *  E isso que mantem os cartoes da mesma linha na mesma linha de base quando um
 *  deles nao tem numero para mostrar. */
const SLOT_ESTADO = "mt-1.5 flex items-center min-h-[31.5px]";

type BaseMetrica = {
  rotulo: React.ReactNode;
  Icone?: Icone;
  sub?: React.ReactNode;
  acao?: React.ReactNode;
  carregando?: boolean;
  testId?: string;
  testIdValor?: string;
  className?: string;
};

/** Rotulo mono-caixa-alta + numero mono tabular. Icone opcional e sempre neutro:
 *  quando toda metrica da linha e informativa, cor por card vira ruido — a pele
 *  reserva saturacao para risco.
 *
 *  `valor` OU `estado`, nunca os dois — o tipo obriga a escolher:
 *  - `valor` e a leitura numerica, e o que o cartao existe para mostrar.
 *  - `estado` e para o que nao e numero (um selo de "Executando", "Sem dados").
 *    Antes isso entrava pelo slot de `valor`, e um selo de 10px no lugar de um
 *    numero de 21px derrubava a linha de base dos cartoes irmaos e esvaziava a
 *    identidade numerica do card. O slot de estado guarda a altura da caixa do
 *    numero em vez de fingir que o selo e um.
 *
 *  `acao` coloca um controle a direita (ex.: comprar credito de onde se ve o
 *  saldo, sem viagem ate outra tela).
 *  `carregando` troca a leitura por skeleton; para o tracinho "—" basta passar o
 *  proprio "—" como valor. */
export function CartaoMetrica({
  rotulo,
  valor,
  estado,
  Icone,
  sub,
  acao,
  carregando = false,
  testId,
  testIdValor,
  className,
}: BaseMetrica &
  (
    | { valor: React.ReactNode; estado?: never }
    | { estado: React.ReactNode; valor?: never }
  )) {
  const subLinha = sub ? (
    <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{sub}</p>
  ) : null;

  return (
    <Card
      className={cn("px-[14px] py-3", acao && "flex items-center justify-between gap-3", className)}
      data-testid={testId}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {Icone && (
            <Icone className="w-4 h-4 flex-none text-[var(--text-faint)]" strokeWidth={2} />
          )}
          <span className={ROTULO}>{rotulo}</span>
        </div>
        {carregando ? (
          <Skeleton className="h-7 w-16 mt-1.5" />
        ) : estado !== undefined ? (
          <>
            <div className={SLOT_ESTADO} data-testid={testIdValor}>
              {estado}
            </div>
            {subLinha}
          </>
        ) : (
          <>
            <p className={VALOR_METRICA} data-testid={testIdValor}>
              {valor}
            </p>
            {subLinha}
          </>
        )}
      </div>
      {acao}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Kicker de secao                                                     */
/* ------------------------------------------------------------------ */

/** Titulo de secao no mesmo corpo do rotulo de metrica. Ele organiza sem competir
 *  com o titulo da pagina — a hierarquia vem do tracking e da cor, nao do tamanho. */
export function KickerSecao({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <h2 className={cn(ROTULO, "mb-3", className)} data-testid={testId}>
      {children}
    </h2>
  );
}

/* ------------------------------------------------------------------ */
/* Cartao de acao                                                      */
/* ------------------------------------------------------------------ */

/** Ladrilho de icone + titulo + descricao. E como uma capacidade do sistema se
 *  apresenta: quem nao sabe a sidebar de cor descobre o que existe por aqui.
 *  Uma cor de marca so — o ladrilho e --brand-soft em todos os cards. */
export function CartaoAcao({
  titulo,
  descricao,
  Icone,
  testId,
}: {
  titulo: React.ReactNode;
  descricao: React.ReactNode;
  Icone: Icone;
  testId?: string;
}) {
  return (
    <div
      className="h-full flex flex-col gap-2.5 p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] motion-safe:transition-colors cursor-pointer"
      data-testid={testId}
    >
      <LadrilhoIcone Icone={Icone} tom="marca" />
      <div>
        <p className={TITULO_CARTAO}>{titulo}</p>
        <p className="text-[12px] text-[var(--text-muted)] leading-snug mt-1">{descricao}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ladrilho de icone                                                   */
/* ------------------------------------------------------------------ */

/** REGRA DO LADRILHO — o tom diz o que ha atras do icone, e nao decora.
 *
 *  Havia tres tratamentos convivendo sem regra declarada. A regra e esta:
 *  - `marca`  (--brand-soft / --brand-ink): ha para onde ir. O bloco inteiro
 *    leva a algum lugar — e o caso do CartaoAcao.
 *  - `vazio`  (--surface-inset / --text-faint): ainda nao ha dado. O ladrilho
 *    nao pode prometer uma acao que o bloco nao tem; quem convida e o CTA
 *    embaixo dele, nao o ladrilho.
 *  - `risco`  (--danger-bg / --danger): porta fechada ou falha. Saturacao so
 *    quando significa risco (DESIGN_SYSTEM secao 3) — por isso um tom de
 *    risco nunca pode ser usado como enfeite.
 *
 *  Dois tamanhos, ambos com raio de 8px: `md` (36px) para ladrilho dentro de
 *  card denso, `lg` (40px) para bloco centralizado, onde ele e o unico
 *  elemento grafico da area. */
const TONS_LADRILHO = {
  marca: { fundo: "bg-[var(--brand-soft)]", tinta: "text-[var(--brand-ink)]" },
  vazio: { fundo: "bg-[var(--surface-inset)]", tinta: "text-[var(--text-faint)]" },
  risco: { fundo: "bg-[var(--danger-bg)]", tinta: "text-[var(--danger)]" },
} as const;

export type TomLadrilho = keyof typeof TONS_LADRILHO;

const TAMANHOS_LADRILHO = {
  md: { caixa: "w-9 h-9", icone: "w-[18px] h-[18px]" },
  lg: { caixa: "w-10 h-10", icone: "w-5 h-5" },
} as const;

export function LadrilhoIcone({
  Icone: IconeLadrilho,
  tom = "vazio",
  tamanho = "md",
  className,
}: {
  Icone: Icone;
  tom?: TomLadrilho;
  tamanho?: keyof typeof TAMANHOS_LADRILHO;
  className?: string;
}) {
  const cor = TONS_LADRILHO[tom];
  const medida = TAMANHOS_LADRILHO[tamanho];
  return (
    <div
      className={cn(
        "rounded-lg grid place-items-center flex-none",
        medida.caixa,
        cor.fundo,
        className,
      )}
      aria-hidden
    >
      <IconeLadrilho className={cn(medida.icone, cor.tinta)} strokeWidth={2} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Selo de estado                                                      */
/* ------------------------------------------------------------------ */

/** Pares semanticos do selo. Retangular, mono, caixa alta — nunca pill.
 *  `neutro` existe para o caso honesto: estado que nao da para afirmar. */
export const TONS_SELO = {
  ok: "bg-[var(--ok-bg)] text-[var(--ok)]",
  gated: "bg-[var(--gated-bg)] text-[var(--gated)]",
  danger: "bg-[var(--danger-bg)] text-[var(--danger)]",
  marca: "bg-[var(--brand-soft)] text-[var(--brand-ink)]",
  neutro: "bg-[var(--surface-inset)] text-[var(--text-muted)]",
} as const;

export type TomSelo = keyof typeof TONS_SELO;

/** Estado curto e retangular. Nasceu local no painel do admin; o painel do
 *  provedor nao tinha equivalente, e era exatamente por ai que a divergencia
 *  ia comecar — o proximo ajuste de badge seria feito de um lado so. */
export function Selo({
  tom = "neutro",
  Icone: IconeSelo,
  girando = false,
  className,
  testId,
  children,
}: {
  tom?: TomSelo;
  Icone?: Icone;
  /** So para processo em execucao: o giro precisa ser o unico movimento da tela. */
  girando?: boolean;
  className?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-[7px] py-[3px] font-mono text-[10px] font-medium uppercase tracking-[var(--track-wide)]",
        TONS_SELO[tom],
        className,
      )}
      data-testid={testId}
    >
      {IconeSelo && (
        <IconeSelo
          className={cn("w-3 h-3 flex-none", girando && "motion-safe:animate-spin")}
          strokeWidth={2}
        />
      )}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Botao de link                                                       */
/* ------------------------------------------------------------------ */

/** CTA secundario que E o proprio <a> — use com href/ancora. Para rota do
 *  wouter, nao envolva em <Link> (dois <a> aninhados nao sao HTML valido):
 *  use `<Link href><button className={BOTAO_SECUNDARIO}>` no lugar. */
export function BotaoLink({
  href,
  seta = true,
  testId,
  children,
}: {
  href: string;
  /** A seta diz "isto sai daqui". Desligue quando a acao nao navega. */
  seta?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} className={BOTAO_SECUNDARIO} data-testid={testId}>
      {children}
      {seta && <ArrowRight className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Estado vazio                                                        */
/* ------------------------------------------------------------------ */

/** Icone + titulo + descricao + CTA, como manda o DESIGN_SYSTEM (secao 6).
 *  Texto solto no meio de um card nao diz o que fazer a seguir.
 *
 *  O ladrilho e `vazio`, nunca `marca`: nao ha dado atras dele, e um ladrilho
 *  na cor da marca prometeria uma entrada que o bloco nao tem. Quem carrega a
 *  acao aqui e o CTA. */
export function EstadoVazio({
  Icone: IconeVazio,
  titulo,
  descricao,
  cta,
  testId,
}: {
  Icone: Icone;
  titulo: React.ReactNode;
  descricao: React.ReactNode;
  cta?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-6 py-9" data-testid={testId}>
      <LadrilhoIcone Icone={IconeVazio} tom="vazio" tamanho="lg" />
      <p className={TITULO_CARTAO}>{titulo}</p>
      <p className="text-[12px] text-[var(--text-muted)] leading-snug max-w-[46ch]">{descricao}</p>
      {cta && <div className="mt-1">{cta}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Carregamento de lista                                               */
/* ------------------------------------------------------------------ */

/** Acima de 300ms a tela mostra a FORMA do que vem — nunca um spinner, nunca a
 *  palavra "Carregando". */
export function LinhasSkeleton({ linhas = 4 }: { linhas?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-1.5">
          <Skeleton className="w-8 h-8 rounded flex-none" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabela                                                              */
/* ------------------------------------------------------------------ */

/** CABECALHO DE COLUNA — a `.ds-table th` da secao 6, ao pe da letra.
 *
 *  Havia tres valores em producao. O DESIGN_SYSTEM decide, e o mais repetido
 *  perde:
 *  - CORPO 9,5px, e nao 10px. A secao 6 crava 9.5px no `th`. O rotulo de 10px
 *    e o do SELO e o do KICKER; se o cabecalho de tabela usar o mesmo corpo,
 *    ele para de ser cabecalho e vira mais um rotulo solto na tela.
 *  - PADDING 9px/14px, que e o que a secao 6 escreve. Duas das copias usavam
 *    px-4 (16px), o que desalinhava a coluna do cabecalho da coluna da celula.
 *  - FUNDO `--surface-2`: a secao 3.1 nomeia esse token, com todas as letras,
 *    como "cabecalho de tabela". Duas copias deixavam o cabecalho transparente
 *    e o cabecalho sumia quando a tabela rolava sob ele.
 *  - HAIRLINE embaixo, estrutural (`--border`): e ele que separa cabeca de
 *    corpo. A secao 6 pede no `th` e no `td`.
 *
 *  UM DESVIO DECLARADO: a secao 6 crava `letter-spacing: .1em`, mas a secao 2
 *  manda usar `var(--track-wide)` e nunca cravar o valor — senao cabecalho,
 *  selo e kicker abrem em medidas diferentes na mesma tela. O TOKEN vence, e
 *  esse desvio ja estava escrito em uma das copias.
 *
 *  `whitespace-nowrap` porque rotulo de coluna que quebra em duas linhas
 *  levanta a altura da cabeca inteira por causa de uma coluna so. */
export const TABELA_TH =
  "text-left px-3.5 py-[9px] font-mono text-[9.5px] font-medium uppercase tracking-[var(--track-wide)] text-[var(--text-muted)] whitespace-nowrap border-b border-[var(--border)] bg-[var(--surface-2)]";

/** CELULA — padding 10px/14px e hairline, como a secao 6 escreve.
 *
 *  O corpo (12,5px) e a tinta (`--text-2`) nao estao na secao 6; vem das copias,
 *  onde eram unanimes. Ficam aqui como padrao e nao como lei: `cn()` resolve o
 *  conflito, entao passar outra tinta na `className` sobrescreve sem briga. */
export const TABELA_TD =
  "px-3.5 py-2.5 align-middle text-[12.5px] text-[var(--text-2)] border-b border-[var(--border)]";

/** A `.num` da secao 6: "toda coluna numerica leva isto. E o detalhe que mais
 *  carrega organizacao." Valor, data, contagem, CPF, identificador. */
export const TABELA_NUM = "font-mono tabular-nums";

const ALINHAMENTO_CELULA = {
  esquerda: "text-left",
  centro: "text-center",
  direita: "text-right",
} as const;

export type AlinhamentoCelula = keyof typeof ALINHAMENTO_CELULA;

/** A tabela e o seu container de rolagem. O container e obrigatorio e por isso
 *  esta embutido: sem ele, uma tabela larga empurra a PAGINA para o lado e a
 *  navegacao inteira sai da tela no celular. */
export function TabelaPainel({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full", className)} data-testid={testId}>
        {children}
      </table>
    </div>
  );
}

/** Celula de cabecalho. `<Th>` no lugar de `<th className={TH}>`. */
export function Th({
  alinhamento = "esquerda",
  className,
  children,
  ...resto
}: React.ThHTMLAttributes<HTMLTableCellElement> & { alinhamento?: AlinhamentoCelula }) {
  return (
    <th className={cn(TABELA_TH, ALINHAMENTO_CELULA[alinhamento], className)} {...resto}>
      {children}
    </th>
  );
}

/** Celula de corpo.
 *
 *  `num` faz o trabalho da `.num` da secao 6 E alinha a direita, de proposito:
 *  numero alinhado a esquerda nao forma coluna, e formar coluna e a razao de
 *  existir da regra. Quando o valor e mono mas se le como identificador (numero
 *  de fatura, CPF), passe `alinhamento="esquerda"` junto — e lembre de dar o
 *  mesmo alinhamento ao `<Th>`, senao a cabeca aponta para um lado e o dado
 *  para o outro. */
export function Td({
  num = false,
  alinhamento,
  className,
  children,
  ...resto
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  num?: boolean;
  alinhamento?: AlinhamentoCelula;
}) {
  const alinha = alinhamento ?? (num ? "direita" : "esquerda");
  return (
    <td
      className={cn(TABELA_TD, num && TABELA_NUM, ALINHAMENTO_CELULA[alinha], className)}
      {...resto}
    >
      {children}
    </td>
  );
}

/* ------------------------------------------------------------------ */
/* Rotulo de campo                                                     */
/* ------------------------------------------------------------------ */

/** ROTULO DE CAMPO DE FORMULARIO — mono, 10px, caixa alta, tracking pelo token.
 *
 *  Estava em quatro vozes diferentes no painel. A secao 2 nao deixa margem:
 *  "Label mono em caixa alta com tracking aberto — use o token var(--track-wide),
 *  10px. Nao crave o valor". A voz mais repetida (Inter 10,5px com o tracking
 *  cravado) perde nos dois pontos; a que sobrevive e a mono.
 *
 *  TINTA `--text-muted`, e nao `--text-faint`: rotulo de campo precisa ser LIDO
 *  para se preencher a caixa, e a 10px o faint fica abaixo do minimo da secao 7.
 *
 *  E O TOM DE VOZ? A secao 8 pede substantivo direto em minusculas. As duas
 *  regras convivem: escreva o rotulo em minusculas ("razão social", "vencimento")
 *  e deixe a caixa alta para o CSS. Assim o texto continua legivel no codigo e
 *  na busca, e a tela mantem uma voz de rotulo so.
 *
 *  NAO CONFUNDA com o rotulo de METRICA (o do `CartaoMetrica`, do `KickerSecao`
 *  e da `PilulaCabecalho`): aquele nomeia um NUMERO em destaque, este nomeia uma
 *  CAIXA que se preenche. Sao papeis diferentes, e por ora vozes diferentes —
 *  ver o aviso da entrega. */
export const ROTULO_CAMPO =
  "mb-1 block font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]";

/** So o texto do rotulo. E um `<span>`, e nao um `<label>`, para poder viver
 *  dentro do `<label>` de quem ja monta o par por conta propria. */
export function RotuloCampo({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <span className={cn(ROTULO_CAMPO, className)} data-testid={testId}>
      {children}
    </span>
  );
}

/** Rotulo + controle, com associacao IMPLICITA (o controle vive dentro do
 *  `<label>`). Prefira isto a `<label>` e `<input>` soltos: sem `htmlFor` ou
 *  aninhamento, clicar no rotulo nao foca a caixa e o leitor de tela nao
 *  anuncia o nome do campo. */
export function Campo({
  rotulo,
  children,
  className,
  testId,
}: {
  rotulo: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <label className={cn("block", className)} data-testid={testId}>
      <RotuloCampo>{rotulo}</RotuloCampo>
      {children}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Caixa do campo                                                      */
/* ------------------------------------------------------------------ */

/** A CAIXA QUE SE PREENCHE — campo de texto e seletor, a mesma.
 *
 *  O rotulo ja tinha primitiva (`RotuloCampo`, `Campo`); a caixa embaixo dele,
 *  nao. O resultado eram TRES nomes com TRES alturas no mesmo painel:
 *  - `ALVO_CONTROLE` sozinho sobre o `Input` compartilhado — que traz altura
 *    fixa de 40px. O minimo de 36px nao vence uma altura MAIOR, entao no mouse
 *    a caixa continuava com 40px e so crescia no ponteiro grosso;
 *  - `ALVO_CONTROLE` sobre um `<select>` nativo, que nao traz altura nenhuma:
 *    36px de verdade;
 *  - a mesma composicao com `h-auto`, no vocabulario financeiro, que desarma a
 *    altura fixa e tambem da 36px.
 *  Ou seja: no passo 2 do cadastro de provedor, "Subdominio" (campo de texto,
 *  40px) fica ao lado de "Plano inicial" (seletor, 36px), na mesma grade, com
 *  4px de diferenca — e os dois ao lado de botoes de 36px. E o desalinhamento
 *  que a secao 6 chama de "o detalhe que mais carrega organizacao", ao contrario.
 *
 *  VENCE 36px, com `h-auto`. Nao e a contagem: `ALVO_CONTROLE` ja declarou 36px
 *  como A altura de controle destes paineis (ver `BOTAO_ICONE`), e todo botao
 *  do painel tem essa medida. Uma caixa de 40px ao lado de um botao de 36px na
 *  mesma linha e exatamente a divergencia que a primitiva existe para acabar.
 *  Densidade e decisao de produto (secao 4) e o alvo de toque continua inteiro:
 *  `ALVO_CONTROLE` leva a 44px no ponteiro grosso (secao 7).
 *
 *  CORPO 12,5px. Havia 13px nas copias de seletor e os 14px que o `Input` base
 *  deixa passar quando ninguem diz nada — dentro do MESMO formulario. 12,5px e
 *  o corpo de controle desta casa: e o do botao secundario, o do botao de marca,
 *  o da aba e o da celula de tabela. Campo com corpo proprio faria a linha do
 *  formulario ter duas escalas de texto sem motivo.
 *
 *  BORDA `--border-strong` e RAIO de 4px, os dois pelo nome: a secao 3.1 reserva
 *  esse token para input ("a caixa precisa ler como area editavel") e a secao
 *  5.1 crava 4px em campo.
 *
 *  ANEL DE FOCO INCLUIDO, e e uma mudanca de pixel declarada. O `Input`
 *  compartilhado desenha o proprio foco com um anel de 1px sobre um token de
 *  FUNDO suave — quase invisivel —, e a secao 7 chama anel de foco de nao
 *  negociavel. `FOCO` entra aqui para que campo e seletor sejam focaveis a
 *  vista pelo mesmo tratamento do resto do painel.
 *
 *  SERVE OS DOIS porque cada face traz o que a outra nao tem: o `<select>`
 *  nativo comeca sem borda, sem raio e sem cor, e o `Input` compartilhado ja
 *  traz borda e padding — declarar tudo aqui nao conflita com ele (`cn()`
 *  resolve o par repetido) e deixa o seletor completo com uma constante so.
 *
 *  A HOMONIMA MORREU. `components/admin/financeiro-ui.tsx` exportava uma
 *  constante local de MESMO NOME com estes mesmos valores menos o anel de foco
 *  e menos o padding horizontal — e era ELA que as tres telas financeiras
 *  importavam. O efeito nao era estetico: campo e seletor daquelas telas
 *  ficavam sem anel de foco visivel, que a secao 7 chama de nao negociavel, e
 *  o defeito era invisivel na revisao porque o nome importado batia com o da
 *  primitiva. Hoje ha uma definicao so, esta; `financeiro-ui` apenas REEXPORTA
 *  este simbolo, para que as tres telas ganhassem o anel sem que nenhuma delas
 *  precisasse ser tocada. */
export const CONTROLE_CAMPO = cn(
  ALVO_CONTROLE,
  "h-auto w-full rounded border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[12.5px] text-[var(--text)]",
  FOCO,
  "motion-safe:transition-colors",
);

/** A MESMA CAIXA, para texto de varias linhas (`<textarea>`).
 *
 *  `CONTROLE_CAMPO` sozinho nao serve: ele so tem padding horizontal, porque a
 *  caixa de uma linha centraliza o texto verticalmente por conta propria. Num
 *  textarea o texto comeca colado na borda de cima, e o piso de 36px vira uma
 *  caixa de uma linha so — que e justamente o que o campo multilinha nao e.
 *
 *  Por isso o padding vertical entra e o piso vira `min-h-20` (80px, ~3 linhas
 *  no corpo de 12,5px): altura suficiente para o campo ANUNCIAR que aceita mais
 *  de uma linha antes de o operador comecar a escrever. O alvo de toque
 *  continua satisfeito com folga, entao `ALVO_CONTROLE` nao e necessario aqui.
 *
 *  `resize-y`: encolher na horizontal quebraria a grade do formulario; crescer
 *  na vertical e exatamente o que quem escreve um texto longo precisa. */
export const CONTROLE_CAMPO_MULTILINHA = cn(
  "block h-auto min-h-20 w-full resize-y rounded border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-[12.5px] leading-normal text-[var(--text)]",
  FOCO,
  "motion-safe:transition-colors",
);

/* ------------------------------------------------------------------ */
/* Botao de icone                                                      */
/* ------------------------------------------------------------------ */

/** BOTAO SO DE ICONE — o caso que mais viola a secao 7, e o porque do tamanho.
 *
 *  Estava em tres tamanhos: 32px, 36px e 36px escrito de outro jeito. Todos
 *  chegavam a 44px no ponteiro grosso, entao o desempate nao e a secao 7 e sim
 *  a coerencia: `ALVO_CONTROLE` ja fixou 36px como A altura de controle destes
 *  paineis. Um botao de 32px ao lado de um chip de 36px na mesma barra e
 *  exatamente a divergencia que a primitiva existe para acabar — vence 36px.
 *
 *  Quadrado: a altura vem de `ALVO_CONTROLE`, a largura de `CAIXA_ICONE`, e as
 *  duas crescem na MESMA media query. Denso no mouse, 44x44 no dedo.
 *
 *  Fantasma de proposito: sem fundo e sem borda no repouso. Sao seis destes
 *  lado a lado numa linha de tabela; com preenchimento, a linha vira uma barra
 *  de botoes e o dado que ela carrega perde a vez. */
export const BOTAO_ICONE = cn(
  "inline-flex items-center justify-center flex-none rounded",
  CAIXA_ICONE,
  "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-inset)]",
  FOCO,
  "motion-safe:transition-colors",
  DESABILITAVEL,
);

/** Variante adversa (excluir, revogar, cancelar). A tinta de risco so aparece
 *  no hover: saturacao e reservada a risco (secao 3), e um icone vermelho em
 *  repouso, repetido em toda linha, transforma a tabela num alarme continuo —
 *  o que faz o operador parar de ver o alarme que importa. */
export const BOTAO_ICONE_RISCO = cn(
  BOTAO_ICONE,
  "hover:text-[var(--danger)] hover:bg-[var(--danger-bg)]",
);

/** `rotulo` e OBRIGATORIO e nao e decoracao: um botao so de icone nao tem texto
 *  nenhum, entao sem ele o leitor de tela anuncia "botao" e mais nada. Vira
 *  `aria-label` e `title` de uma vez — o mesmo texto que o mouse revela e o que
 *  o teclado ouve. */
export function BotaoIcone({
  Icone: IconeBotao,
  rotulo,
  tom = "neutro",
  girando = false,
  className,
  testId,
  type = "button",
  ...resto
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & {
  Icone: Icone;
  /** Em portugues e no infinitivo, como manda a secao 8: "Cancelar a fatura". */
  rotulo: string;
  tom?: "neutro" | "risco";
  /** So para acao em andamento. O giro precisa ser o unico movimento da tela. */
  girando?: boolean;
  testId?: string;
}) {
  return (
    <button
      type={type}
      className={cn(tom === "risco" ? BOTAO_ICONE_RISCO : BOTAO_ICONE, className)}
      aria-label={rotulo}
      title={rotulo}
      data-testid={testId}
      {...resto}
    >
      <IconeBotao
        className={cn("w-3.5 h-3.5 flex-none", girando && "motion-safe:animate-spin")}
        strokeWidth={2}
        aria-hidden
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Ladrilho de inicial                                                 */
/* ------------------------------------------------------------------ */

/** A caixa com a primeira letra do nome, ao lado do nome.
 *
 *  DUAS FORMAS, e a diferenca esta na secao 5.1 — que lista `rounded-full`
 *  entre os poucos casos permitidos, e o caso e "avatar":
 *  - `ladrilho` (raio 4px) — representa uma COISA: provedor, marca, conversa.
 *    Canto seco e a identidade do sistema; empresa nao tem rosto.
 *  - `avatar`  (circulo)   — representa uma PESSOA. E o unico redondo aqui, e a
 *    secao 5.1 o autoriza por nome.
 *  As copias divergiam justamente nisso, e nenhuma estava errada: uma desenhava
 *  provedor, a outra desenhava usuario. O que faltava era a regra escrita.
 *
 *  SEM COR POR ESTADO. O ladrilho e sempre `--surface-inset` com tinta de texto:
 *  a inicial identifica, nao mede. Quem carrega estado e o selo ao lado.
 *
 *  A INICIAL SAI DAQUI, e nao do chamador. Cada copia refazia
 *  `nome.charAt(0)` por conta propria e uma delas esquecia a caixa alta, entao
 *  a mesma lista mostrava "A" e "j". Nome vazio deixa o ladrilho vazio, que ao
 *  menos mantem a coluna alinhada — melhor do que inventar um caractere.
 *
 *  `aria-hidden` porque a letra e o nome que ja esta escrito ao lado; anunciada,
 *  o leitor de tela le a inicial e depois o nome inteiro. */
const TAMANHOS_INICIAL = {
  sm: { caixa: "w-7 h-7", corpo: "text-[11px]" },
  md: { caixa: "w-9 h-9", corpo: "text-[13px]" },
  lg: { caixa: "w-10 h-10", corpo: "text-[15px]" },
} as const;

export function LadrilhoInicial({
  nome,
  forma = "ladrilho",
  tamanho = "md",
  className,
}: {
  nome?: string | null;
  forma?: "ladrilho" | "avatar";
  tamanho?: keyof typeof TAMANHOS_INICIAL;
  className?: string;
}) {
  const medida = TAMANHOS_INICIAL[tamanho];
  const inicial = (nome ?? "").trim().charAt(0).toUpperCase();
  return (
    <div
      className={cn(
        "grid place-items-center flex-none font-semibold bg-[var(--surface-inset)] text-[var(--text-2)]",
        forma === "avatar" ? "rounded-full" : "rounded",
        medida.caixa,
        medida.corpo,
        className,
      )}
      aria-hidden
    >
      {inicial}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dinheiro                                                            */
/* ------------------------------------------------------------------ */

/** DINHEIRO, UMA VEZ SO — e o porque de ele morar AQUI, e nao no vocabulario
 *  financeiro do superadmin.
 *
 *  Havia QUATRO formatadores de real no produto: este par, um `fmt()` local na
 *  tela de detalhe do provedor, outro na tela de creditos do provedor, e o
 *  "R$" mais `toLocaleString` escrito a mao dentro de duas tabelas. Os quatro
 *  produziam textos parecidos e regras diferentes — um com centavos, outro sem,
 *  e os escritos a mao SEM mono tabular, que e a unica coisa que faz uma coluna
 *  de dinheiro se ler como coluna (secao 2).
 *
 *  A causa da divergencia era a moradia: `Dinheiro` nasceu em
 *  `components/admin/financeiro-ui.tsx`, que e vocabulario do FINANCEIRO DO
 *  SUPERADMIN. Uma tela do painel do provedor nao vai — e nao deve — importar
 *  cobranca do Asaas para escrever um valor, entao ela reescrevia o formatador.
 *  Mas formatar real nao e assunto de cobranca: e apresentacao de numero, que e
 *  o que este arquivo publica. Subiu para ca, e `financeiro-ui` reexporta o
 *  simbolo para as tres telas financeiras nao precisarem ser tocadas. */
const REAL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
});

/** Sem centavos. So onde a largura e apertada — rotulo em cima da barra de um
 *  grafico, linha de movimentacao — e o centavo nao decide nada. */
const REAL_CURTO = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

/** O texto do valor, sem marcacao. So para onde nao cabe elemento — o `title`
 *  nativo de uma barra de grafico, que devolve o valor exato que o rotulo
 *  arredonda, ou o `aria-label` de um controle.
 *
 *  NA TELA, dinheiro e sempre `<Dinheiro>`. Uma string crua perde o mono
 *  tabular no caminho, e um valor em Inter no meio de uma coluna de valores em
 *  mono desalinha a coluna inteira. */
export function textoDeReal(valor: unknown, curto = false) {
  const n = typeof valor === "number" ? valor : parseFloat(String(valor ?? ""));
  return (curto ? REAL_CURTO : REAL).format(Number.isFinite(n) ? n : 0);
}

/** TODO VALOR MONETARIO DO PAINEL PASSA POR AQUI.
 *
 *  Mono tabular sempre (secao 2: "todo numero e mono e tabular" — coluna de
 *  dinheiro desalinhada e a leitura destruida), e a tinta de dinheiro negativo
 *  e `--money-neg`, que a secao 3.1 nomeia exatamente assim: "sinal de valor,
 *  todo numero negativo". E o mesmo valor de `--past`; o que muda e o nome do
 *  papel, e o papel aqui e o sinal do numero.
 *
 *  `sinal` existe para a parcela que chega como MAGNITUDE positiva e so o
 *  contexto sabe que ela subtrai — contracao, cancelamento, rebaixamento de
 *  plano. Passar o sinal de menos escreve o menos E pinta de negativo, para os
 *  dois nao poderem discordar; era isso que as telas faziam a mao, cada uma com
 *  o seu par de classes.
 *
 *  Uma cor NAO sai daqui: fatura vencida. Ali o vermelho nao e o sinal do
 *  numero (o valor e positivo, alguem deve), e atraso — `--past` pelo papel de
 *  atraso, passado na `className` por quem sabe que aquilo esta vencido. */
export function Dinheiro({
  valor,
  curto = false,
  sinal,
  className,
}: {
  valor: unknown;
  curto?: boolean;
  sinal?: "+" | "−";
  className?: string;
}) {
  const n = typeof valor === "number" ? valor : parseFloat(String(valor ?? ""));
  const numero = Number.isFinite(n) ? n : 0;
  const negativo = numero < 0 || sinal === "−";
  return (
    <span
      className={cn("font-mono tabular-nums", negativo && "text-[var(--money-neg)]", className)}
    >
      {sinal}
      {(curto ? REAL_CURTO : REAL).format(numero)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

/** Titulo de modal. Nem o corpo do titulo de cartao (13,5px) nem o do titulo de
 *  pagina (19px): o modal E a tela enquanto esta aberto, entao seu titulo fica
 *  acima do de cartao; e ele cabe numa caixa de 384px, entao fica abaixo do de
 *  pagina. Tracking apertado pelo token, como manda a secao 2 para heading. */
export const TITULO_MODAL =
  "text-[15px] font-medium tracking-[var(--track-tight)] text-[var(--text)] flex items-center gap-2";

/** CASCA DE MODAL — e o porque de ela ter subido para a primitiva.
 *
 *  A moldura nasceu PRIVADA dentro de `components/admin/financeiro-ui.tsx`,
 *  para os dois modais do Asaas. O efeito colateral foi silencioso e caro: a
 *  acessibilidade que aqueles dois modais ganharam — `role="dialog"`,
 *  `aria-modal`, `aria-label` — nao chegou a NENHUM outro modal do painel, que
 *  seguiu sendo uma `div` sobre um fundo escuro. Para o leitor de tela isso
 *  significa que o conteudo atras continua fazendo parte da leitura e que a
 *  caixa aberta nao tem nome.
 *
 *  Modal e vocabulario de PAINEL, nao de financeiro: quem abre uma caixa por
 *  cima da tela nao esta cobrando nada. Subiu para ca sem uma mudanca de pixel;
 *  `financeiro-ui` consome daqui.
 *
 *  Sombra: o UNICO caso do sistema com lift (secao 5.2) — anel de 1px mais uma
 *  sombra baixa. Padding 20px, o mais denso dos dois que existiam (secao 4:
 *  densidade e decisao de produto, e a caixa e pequena).
 *
 *  `rotulo` e OBRIGATORIO: e ele que vira `aria-label`. Escreva o mesmo texto
 *  do titulo visivel — duas frases diferentes para a mesma caixa fazem quem ve
 *  e quem ouve estarem em telas diferentes. */
export function MolduraModal({
  rotulo,
  centralizado = false,
  onFechar,
  children,
}: {
  rotulo: string;
  /** Para modal de conteudo unico e centrado (um QR Code). Nao use em
   *  formulario: rotulo de campo centralizado perde a coluna de leitura. */
  centralizado?: boolean;
  onFechar: () => void;
  children: React.ReactNode;
}) {
  /* Escape fecha. Sem isto, quem navega por teclado so tem uma saida: encontrar
     o botao de cancelar. Clicar no fundo ja fechava — mas clicar no fundo e
     gesto de ponteiro, e um modal que so obedece o mouse deixa de fora
     exatamente quem mais depende do teclado.
     O listener vive no `document` porque o foco pode estar em qualquer campo
     do formulario dentro do modal, e um handler preso a moldura so ouviria o
     que borbulha ate ela. */
  const caixa = React.useRef<HTMLDivElement>(null);

  /* O TAB FICA DENTRO DA CAIXA.
     `aria-modal="true"` PROMETE isso a quem usa leitor de tela, e a promessa
     nao estava sendo cumprida: o Tab continuava percorrendo a pagina atras do
     modal, onde os controles estao visualmente cobertos pelo overlay mas
     seguem focaveis e clicaveis pelo teclado. Quem navega por teclado saia da
     caixa sem perceber e passava a operar uma tela que nao esta vendo — na
     caixa de remover acesso, o botao seguinte e "Remover".
     A volta e ciclica (do ultimo para o primeiro e vice-versa), que e o
     comportamento que a WAI-ARIA descreve para dialogo modal. */
  React.useEffect(() => {
    const focaveis = () => Array.from(
      caixa.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(el => el.offsetParent !== null || el === document.activeElement);

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onFechar(); return; }
      if (e.key !== "Tab") return;
      const lista = focaveis();
      if (lista.length === 0) { e.preventDefault(); return; }
      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];
      const atual = document.activeElement as HTMLElement | null;
      // Foco fora da caixa (a pagina de tras, ou nada) volta para dentro.
      if (!atual || !caixa.current?.contains(atual)) {
        e.preventDefault();
        primeiro.focus();
        return;
      }
      if (e.shiftKey && atual === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && atual === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  /* O foco entra na caixa ao abrir e VOLTA para quem a abriu ao fechar.
     Sem a volta, fechar o modal joga o foco no `<body>` e a proxima tecla Tab
     recomeca do topo da pagina — quem abriu a caixa a partir de uma linha da
     tabela perderia o lugar a cada abertura. */
  React.useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const primeiro = caixa.current?.querySelector<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    );
    (primeiro ?? caixa.current)?.focus();
    return () => anterior?.focus?.();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--overlay)]"
      onClick={onFechar}
    >
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-label={rotulo}
        /* -1 para a caixa poder receber o foco quando nao ha nenhum controle
           dentro dela; ela continua fora da ordem natural do Tab. */
        tabIndex={-1}
        className={cn(
          "w-full max-w-sm rounded-lg bg-[var(--surface)] p-5 outline-none",
          "shadow-[0_0_0_1px_var(--ring-warm),0_12px_32px_-14px_rgba(20,19,26,0.20)]",
          centralizado && "text-center",
        )}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Aviso de carga que falhou                                           */
/* ------------------------------------------------------------------ */

/** "NAO FOI POSSIVEL CARREGAR" — a faixa de aviso com o botao de tentar de novo.
 *
 *  Este bloco estava escrito SEIS vezes no painel (a tabela de precos em tres
 *  pontos do detalhe do provedor, na pagina financeira, na aba financeira e na
 *  tela de pedidos de credito), e as copias ja divergiam: padding de 2,5 contra
 *  3, umas com `rounded` no botao e outras sem.
 *
 *  O DEFEITO COMUM AS SEIS era o alvo: o "Tentar de novo" e um texto de 12px
 *  sublinhado, ou seja, uns 16px de altura clicavel — menos de metade dos 44px
 *  que a secao 7 exige e nao negocia. `ALVO_TEXTO` resolve sem engordar o aviso
 *  no mouse: ver o comentario daquela constante.
 *
 *  A COR e `--danger`, e nao `--past`: a secao 3.1 separa os dois papeis, e
 *  aqui nao ha atraso nenhum — ha uma porta fechada, uma requisicao que falhou.
 *
 *  A FRASE fica com quem chama, porque o que falhou muda o que dizer, e a secao
 *  8 pede erro afirmativo e util ("a fatura nao pode ser emitida sem ela"), nao
 *  um "Erro ao carregar" generico que a primitiva escreveria por todo mundo.
 *
 *  Para a falha que ocupa a AREA INTEIRA de um card ou de uma lista — ladrilho
 *  de risco, titulo e CTA no centro — o bloco e outro: `EstadoVazio` com um CTA,
 *  ou o bloco proprio da tela. Esta peca e a faixa compacta que vive DENTRO de
 *  um formulario, acima do campo que ficou sem dado. */
export function AvisoNaoCarregou({
  children,
  aoTentarDeNovo,
  rotuloAcao = "Tentar de novo",
  className,
  testId,
  testIdAcao,
}: {
  /** A frase do erro. Direta e util (secao 8): diga o que deixou de ser
   *  possivel, e nao o codigo da falha. */
  children: React.ReactNode;
  /** Sem isto a faixa fica so com a frase — use quando nao ha o que repetir. */
  aoTentarDeNovo?: () => void;
  rotuloAcao?: string;
  className?: string;
  testId?: string;
  testIdAcao?: string;
}) {
  return (
    <div
      className={cn(
        "rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2",
        className,
      )}
      data-testid={testId}
    >
      <p className="text-[12px] text-[var(--danger)]">{children}</p>
      {aoTentarDeNovo && (
        <button
          type="button"
          className={cn(
            ALVO_TEXTO,
            "mt-0.5 rounded text-[12px] underline text-[var(--danger)]",
            FOCO,
          )}
          onClick={aoTentarDeNovo}
          data-testid={testIdAcao}
        >
          {rotuloAcao}
        </button>
      )}
    </div>
  );
}
