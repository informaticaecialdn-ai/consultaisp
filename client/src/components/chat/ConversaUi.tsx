/**
 * As primitivas da tela de Conversas no porte do Provedor.ai (Cobrança ›
 * Atendimento › Conversas): balão com cauda, cabeçalho de quem falou com o selo
 * da funcionária digital, recibo de entrega, chip central, faixa do compositor,
 * atalho, pílula do rodapé e estado vazio.
 *
 * A estrutura, a densidade e as medidas são as da referência. Cor, raio e
 * profundidade são os do DESIGN_SYSTEM v5, e onde os dois brigam vence o
 * sistema: balão com 8px (não 12px), pílula e atalho com 4px (não 999px),
 * profundidade por anel de 1px (não `--shadow-sm`), nenhuma borda de 0,5px,
 * nenhum gradiente, fundo da conversa liso (sem a textura pontilhada).
 *
 * Nada aqui toca `window` nem `document` no render — o atendimento é
 * renderizado por SSR nos testes.
 */
import { Fragment, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  Check,
  CheckCheck,
  Clock,
  Users,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ALVO_TEXTO,
  CAIXA_ICONE,
  DESABILITAVEL,
  FOCO,
  type Icone,
} from "@/components/painel/ui";
import { iniciaisChat, NUM_CHAT } from "./PerfilDoCliente";
import { reciboDoStatus, trechosDoTexto, type Recibo } from "./conversa";

/* ── Estado vazio ─────────────────────────────────────────────────────── */

/** O `.empty` da referência: poço do ícone, título, corpo e a ação quando há uma. */
export function EstadoVazioChat({
  Icone: IconeVazio,
  titulo,
  children,
  acao,
  testId,
  className,
}: {
  Icone: Icone;
  titulo: ReactNode;
  children?: ReactNode;
  acao?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}
      data-testid={testId}
    >
      <span
        aria-hidden
        className="mb-3 grid h-12 w-12 place-items-center rounded-lg bg-[var(--surface-inset)]"
      >
        <IconeVazio className="h-[22px] w-[22px] text-[var(--text-muted)]" />
      </span>
      <p className="text-[15px] font-medium text-[var(--text)]">{titulo}</p>
      {children && (
        <div className="mt-1 max-w-[360px] text-[13px] leading-relaxed text-[var(--text-2)]">
          {children}
        </div>
      )}
      {acao && <div className="mt-4 flex flex-wrap justify-center gap-2">{acao}</div>}
    </div>
  );
}

/* ── Chip central e pílula de evento ──────────────────────────────────── */

/** O `.wa-day` da referência: o dia no topo e o "carregar anteriores". Retangular. */
export const CHIP_CENTRAL =
  "my-1 max-w-[85%] self-center rounded border border-[var(--border-strong)] bg-[var(--surface)] px-[13px] py-[5px] text-center text-[10.5px] font-semibold leading-none text-[var(--text-2)]";

/** O botão com cara de chip — alvo de toque e anel de foco. */
export const CHIP_CENTRAL_BOTAO = cn(
  CHIP_CENTRAL,
  ALVO_TEXTO,
  "justify-center hover:bg-[var(--surface-2)]",
  FOCO,
  DESABILITAVEL,
);

/** "Conversa transferida: Clara → Equipe". Derivada da troca de voz; gruda no balão seguinte. */
export function PilulaDeTransferencia({ de, para, hora }: { de: string; para: string; hora: string | null }) {
  return (
    <p
      className="mb-[3px] mt-1.5 inline-flex max-w-[85%] items-center gap-1.5 self-center rounded border border-[var(--border)] bg-[var(--surface)] px-[13px] py-[5px] text-center text-[11px] text-[var(--text-2)]"
      data-testid="chat-transferencia"
    >
      <ArrowRightLeft aria-hidden className="h-[11px] w-[11px] shrink-0 text-[var(--brand)]" />
      <span>
        Conversa transferida: <b className="font-semibold">{de}</b> → <b className="font-semibold">{para}</b>
      </span>
      {hora && <span className={cn("opacity-70", NUM_CHAT)}>· {hora}</span>}
    </p>
  );
}

/* ── Balão ────────────────────────────────────────────────────────────── */

/**
 * A cauda do último balão da corrida. Desenhada em SVG, com a própria linha de
 * 1px, porque o balão sobe por anel e um triângulo sem contorno quebraria a borda.
 */
function CaudaDoBalao({ saida }: { saida: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 8 8"
      className={cn(
        "pointer-events-none absolute -bottom-px h-2 w-2",
        saida ? "-right-[7px] -scale-x-100 fill-[var(--ok-bg)]" : "-left-[7px] fill-[var(--surface)]",
      )}
    >
      <path d="M8 0 L8 8 L0 8 Z" />
      <path d="M7.5 0 L0.5 7.5 L8 7.5" fill="none" strokeWidth="1" className="stroke-[var(--border)]" />
    </svg>
  );
}

/**
 * A linha e o balão. Recebido à esquerda em `--surface`; enviado à direita em
 * `--ok-bg` — funcionária e equipe usam o MESMO balão, a diferença é o
 * cabeçalho. Sem avatar ao lado. 10px entre corridas, 2px dentro delas.
 */
export function BalaoDaConversa({
  saida,
  inicioCorrida,
  fimCorrida,
  cabecalho,
  meta,
  pendente,
  children,
}: {
  saida: boolean;
  inicioCorrida: boolean;
  fimCorrida: boolean;
  cabecalho?: ReactNode;
  meta: ReactNode;
  pendente?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex w-full",
        saida ? "justify-end" : "justify-start",
        inicioCorrida ? "mt-2.5" : "mt-0.5",
      )}
    >
      <article
        className={cn(
          "relative max-w-[68%] break-words rounded-lg px-3 pb-2.5 pt-2 text-[13.5px] leading-normal text-[var(--text)] shadow-[0_0_0_1px_var(--border)]",
          saida ? "bg-[var(--ok-bg)]" : "bg-[var(--surface)]",
          fimCorrida && (saida ? "rounded-br-none" : "rounded-bl-none"),
          pendente && "opacity-80",
        )}
        data-testid={pendente ? "chat-balao-enviando" : "chat-balao"}
      >
        {fimCorrida && <CaudaDoBalao saida={saida} />}
        {cabecalho}
        {children}
        {meta}
      </article>
    </div>
  );
}

/** O corpo com o negrito e o bloco mono do WhatsApp, montado em nós do React. */
export function TextoDoBalao({ texto }: { texto: string }) {
  return (
    <span className="whitespace-pre-wrap">
      {trechosDoTexto(texto).map((t, i) =>
        t.tipo === "negrito" ? (
          <strong key={i} className="font-semibold">
            {t.valor}
          </strong>
        ) : t.tipo === "bloco" ? (
          <code
            key={i}
            className={cn(
              "my-[3px] block break-all rounded bg-[var(--surface-inset)] px-2 py-1.5 text-xs leading-normal",
              NUM_CHAT,
            )}
          >
            {t.valor}
          </code>
        ) : (
          <Fragment key={i}>{t.valor}</Fragment>
        ),
      )}
    </span>
  );
}

/* ── Quem falou ───────────────────────────────────────────────────────── */

const SELO_AUTOR =
  "inline-flex items-center gap-[3px] rounded px-[6px] py-[2px] font-mono text-[10px] font-semibold uppercase leading-none tracking-[var(--track-wide)]";

/**
 * O rosto da funcionária digital: a inicial do nome dela num círculo. Sem retrato
 * inventado. Em --brand-soft com --brand-ink, como o selo IA ao lado — a marca
 * CHEIA é ação e não pinta pessoa (a mesma regra do AvatarChat, que é neutro).
 */
export function AvatarDaFuncionaria({ nome, className }: { nome: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[8px] font-bold leading-none text-[var(--brand-ink)] shadow-[0_0_0_1px_var(--border)]", // avatar
        className,
      )}
    >
      {iniciaisChat(nome).slice(0, 1)}
    </span>
  );
}

/**
 * O `.wa-who` da referência, só no primeiro balão enviado da corrida: a
 * funcionária com o selo IA; a conta do provedor com o selo EQUIPE (não
 * "humano": o envio comum não diz se foi gente ou servidor).
 */
export function CabecalhoDoAutor({ autor, nome }: { autor: "funcionaria" | "equipe"; nome: string }) {
  return (
    <p
      className="mb-[5px] flex items-center gap-1.5 text-[11px] font-bold leading-none text-[var(--brand-ink)]"
      data-testid={`chat-autor-${autor}`}
    >
      {autor === "funcionaria" && <AvatarDaFuncionaria nome={nome} />}
      <span className="min-w-0 truncate">{nome}</span>
      {autor === "funcionaria" ? (
        <span
          className={cn(SELO_AUTOR, "bg-[var(--brand-soft)] text-[var(--brand)]")}
          title="Funcionária digital: mensagem escrita pelo agente de IA do provedor"
        >
          IA
        </span>
      ) : (
        <span
          className={cn(SELO_AUTOR, "border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]")}
          title="Enviada pela conta do provedor: atendente, primeiro contato ou texto do servidor"
        >
          <Users aria-hidden className="h-[9px] w-[9px]" />
          Equipe
        </span>
      )}
    </p>
  );
}

/* ── Hora e recibo ────────────────────────────────────────────────────── */

const ICONE_DO_RECIBO: Record<Recibo, { Icone: Icone; classe: string }> = {
  enviando: { Icone: Clock, classe: "h-3 w-3" },
  enviada: { Icone: Check, classe: "h-[13px] w-[13px]" },
  entregue: { Icone: CheckCheck, classe: "h-[13px] w-[13px]" },
  lida: { Icone: CheckCheck, classe: "h-[13px] w-[13px] text-[var(--brand)]" },
  falhou: { Icone: AlertCircle, classe: "h-[13px] w-[13px] text-[var(--danger)]" },
};

/**
 * Hora e, no enviado, o recibo do status REAL do fork — relógio, ✓, ✓✓, ✓✓ na
 * marca, alerta. Status desconhecido não vira tique: sai por extenso. O rótulo
 * por extenso vai sempre ao leitor de tela e ao `title`.
 */
export function MetaDoBalao({
  hora,
  canal,
  saida,
  status,
  rotulo,
}: {
  hora: string | null;
  canal: string | null;
  saida: boolean;
  status: string;
  rotulo: string;
}) {
  const recibo = saida ? reciboDoStatus(status) : null;
  const icone = recibo ? ICONE_DO_RECIBO[recibo] : null;
  return (
    <span
      className={cn(
        "float-right -mb-[7px] -mr-1 ml-2.5 mt-2.5 inline-flex items-center gap-[3px] whitespace-nowrap text-[10px] font-medium leading-none",
        saida ? "text-[var(--text-2)]" : "text-[var(--text-muted)]",
      )}
      title={rotulo}
    >
      {canal && <span>{canal} ·</span>}
      {hora && <span className={NUM_CHAT}>{hora}</span>}
      {icone ? (
        <>
          <icone.Icone aria-hidden className={icone.classe} />
          <span className="sr-only">{rotulo}</span>
        </>
      ) : saida ? (
        <span>· {rotulo}</span>
      ) : (
        <span className="sr-only">{rotulo}</span>
      )}
    </span>
  );
}

/* ── Compositor ───────────────────────────────────────────────────────── */

/** A faixa do topo do compositor: bloqueio, aviso do canal, falha de envio. */
const TOM_DA_FAIXA = {
  gated: { caixa: "border-[var(--gated-border)] bg-[var(--gated-bg)]", icone: "text-[var(--gated)]" },
  danger: { caixa: "border-[var(--danger-border)] bg-[var(--danger-bg)]", icone: "text-[var(--danger)]" },
  neutro: { caixa: "border-[var(--border)] bg-[var(--surface-2)]", icone: "text-[var(--text-muted)]" },
} as const;

export function FaixaDoCompositor({
  tom,
  Icone: IconeFaixa,
  titulo,
  children,
  acoes,
  testId,
  alerta,
}: {
  tom: keyof typeof TOM_DA_FAIXA;
  Icone: Icone;
  titulo?: ReactNode;
  children?: ReactNode;
  acoes?: ReactNode;
  testId?: string;
  alerta?: boolean;
}) {
  const t = TOM_DA_FAIXA[tom];
  // No celular a faixa aperta 2px em cima e embaixo: com o aviso do canal e o "assuma", eram 20px de histórico a menos.
  return (
    <div
      role={alerta ? "alert" : "status"}
      data-testid={testId}
      className={cn("mb-2.5 flex flex-wrap items-start gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs text-[var(--text-2)] max-sm:mb-2 max-sm:py-1.5", t.caixa)}
    >
      <IconeFaixa aria-hidden className={cn("mt-px h-3.5 w-3.5 shrink-0", t.icone)} />
      <div className="min-w-0 flex-1">
        {titulo && <p className="font-semibold text-[var(--text)]">{titulo}</p>}
        {children}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-x-3">{acoes}</div>}
    </div>
  );
}

/** O `.conv-short` da referência: atalho do compositor, retangular, ícone na marca. */
export const ATALHO = cn(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-[var(--border)] bg-[var(--surface)] px-[11px] py-[7px] text-xs font-semibold leading-none text-[var(--text)] hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] motion-safe:transition-colors",
  ALVO_TEXTO,
  FOCO,
  DESABILITAVEL,
);
export const ICONE_DO_ATALHO = "h-[13px] w-[13px] shrink-0 text-[var(--brand)]";

/** O `.wa-icbtn`: botão de ícone da linha de entrada. */
export const BOTAO_ICONE_COMPOSITOR = cn(
  "inline-flex shrink-0 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-inset)] hover:text-[var(--text)] motion-safe:transition-colors",
  CAIXA_ICONE,
  FOCO,
  DESABILITAVEL,
);

/**
 * A pílula do rodapé do compositor: Sessão → Envio. Em "atenção" o âmbar fica na
 * borda e no ícone, e o texto em --text-2: --gated sobre --gated-bg dá ~3,6:1,
 * abaixo de AA para 10,5px — a mesma regra das faixas e do atendimento.
 */
const TOM_DA_PILULA = {
  ok: { caixa: "border-[var(--ok-border)] bg-[var(--surface)] text-[var(--ok)]", icone: "" },
  atencao: { caixa: "border-[var(--gated)] bg-[var(--gated-bg)] text-[var(--text-2)]", icone: "text-[var(--gated)]" },
  bloqueado: { caixa: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]", icone: "" },
  neutro: { caixa: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]", icone: "" },
} as const;

export function PilulaDoRodape({
  estado,
  Icone: IconePilula,
  titulo,
  testId,
  girar,
  children,
}: {
  estado: keyof typeof TOM_DA_PILULA;
  Icone: Icone;
  titulo?: string;
  testId?: string;
  girar?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      title={titulo}
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-[3px] text-[10.5px] font-semibold leading-none",
        TOM_DA_PILULA[estado].caixa,
      )}
    >
      <IconePilula aria-hidden className={cn("h-2.5 w-2.5", TOM_DA_PILULA[estado].icone, girar && "motion-safe:animate-spin")} />
      {children}
    </span>
  );
}

/* ── Carregando ───────────────────────────────────────────────────────── */

/** A forma da linha da fila: círculo, nome, prévia e selos. */
export function SkeletonDaFila({ linhas = 6 }: { linhas?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="flex gap-[11px] border-b border-[var(--border)] px-3.5 py-3">
          <Skeleton className="h-[38px] w-[38px] shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-[7px]">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-2.5 w-2/5" />
            <Skeleton className="h-2.5 w-[90%]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A forma da conversa: cabeçalho e três balões, alternando os lados. */
export function SkeletonDaConversa() {
  return (
    <div aria-hidden className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-2.5 w-3/5" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 px-7 py-5">
        <Skeleton className="h-12 w-[55%] rounded-lg" />
        <Skeleton className="ml-auto h-12 w-1/2 rounded-lg" />
        <Skeleton className="h-12 w-3/5 rounded-lg" />
      </div>
    </div>
  );
}
