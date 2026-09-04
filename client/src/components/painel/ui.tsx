/**
 * Primitivas de painel — o vocabulario visual do Painel do Provedor, extraido.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * O painel SaaS (superadmin) e o painel do provedor nao pareciam o mesmo produto,
 * e a causa nao era gosto: eram dois vocabularios de token. Medido por grep,
 * `components/admin` + `pages/admin` estava 70% na API antiga (`--color-*`) e
 * `pages/provedor` 84% nos nomes canonicos (`--text`, `--surface`, `--brand`...).
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

/** Botao secundario (fundo de superficie, borda forte). Foco com anel visivel —
 *  nao negociavel. */
export const BOTAO_SECUNDARIO = `inline-flex items-center justify-center gap-1.5 ${ALVO_CONTROLE} px-3.5 rounded text-[12.5px] font-medium text-[var(--text)] bg-[var(--surface)] border border-[var(--border-strong)] hover:bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] motion-safe:transition-colors`;

/** Botao de marca (CTA cheio). Mesmos valores do botao "Comprar" do painel do
 *  provedor, mais a regra de alvo de toque. */
export const BOTAO_MARCA = `inline-flex items-center justify-center gap-1.5 flex-none ${ALVO_CONTROLE} text-[12.5px] font-medium px-3 py-2 rounded bg-[var(--brand)] text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] motion-safe:transition-opacity active:scale-[0.97]`;

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
