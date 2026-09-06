/**
 * Primitivas da cobrança — o que as cinco telas repetem.
 *
 * A cara é a do Provedor.ai (carteira, 360, régua, fila); a pele é a desta
 * casa: tokens `--brand/--ok/--gated/--past/--danger`, mono tabular em todo
 * número, raio 4/8, hairline em vez de sombra, selo retangular. Tudo que já
 * existia em `painel/ui.tsx` e `localizacao/ui` é reaproveitado, não
 * redesenhado — o que nasce aqui é só o vocabulário próprio da cobrança
 * (quadrante, tom, etapa, atraso, composição da carteira, pílula de filtro).
 *
 * Só apresentação: nenhuma primitiva faz fetch nem aplica regra de negócio.
 */
// `jsx: preserve` no tsconfig: fora do Vite (o vitest, que renderiza selo e
// traço em SSR) o esbuild compila JSX para `React.createElement`.
import * as React from "react";
import { useEffect, useState, type ReactNode } from "react";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  familiaDoQuadrante, DIRETIVA_POR_TOM, ROTULO_CARTEIRA, ROTULO_PRIORIDADE, ROTULO_TOM,
  type Quadrante, type Tom,
} from "@shared/cobranca";
import { LadrilhoInicial, FOCO, ALVO_CONTROLE } from "@/components/painel/ui";
import { Kicker, num, TRACO } from "@/components/localizacao/ui";
import { faixaDoAtraso, rotuloDoAtraso, situacaoDoErp } from "./formatacao";
import { frasesDoErro, rotuloDoStatusDeCaso, type ComposicaoDaCarteira } from "./tipos";
import type { OpcaoDeFiltro } from "./filtros";

export { frasesDoErro };

/* ── Utilidades de tela ──────────────────────────────────────────────── */

/** Tudo de `/api/cobranca/*` muda quando um caso muda: um predicado só, em vez de uma lista que envelhece. */
export function invalidarCobranca() {
  queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0] ?? "").startsWith("/api/cobranca") });
}

/** A primeira frase do erro — para um aviso de uma linha (a faixa "não carregou"). */
export function mensagemDoErro(erro: unknown): string {
  return frasesDoErro(erro)[0];
}

/**
 * O que vai no `description` do toast: TODAS as frases que a API mandou. Uma
 * só vira texto; várias viram lista — a negociação recusada por três regras
 * mostra as três, não só a primeira.
 */
export function descricaoDoErro(erro: unknown): ReactNode {
  const frases = frasesDoErro(erro);
  if (frases.length === 1) return frases[0];
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {frases.map(f => <li key={f}>{f}</li>)}
    </ul>
  );
}

/**
 * Anel de foco do CHIP quando o controle focável vive escondido dentro dele
 * (a pílula de filtro tem um `<select>` com `opacity-0`). `FOCO` no select
 * pintava um anel num elemento invisível: com teclado, o filtro sumia. O
 * anel sobe para o chip via `:has(:focus-visible)` — só foco de teclado,
 * como o `FOCO` de `painel/ui.tsx`.
 */
export const FOCO_DENTRO =
  "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--brand)]";

/** Skeleton só depois de 300 ms: abaixo disso o piscar incomoda mais que o vazio (DESIGN_SYSTEM §6). */
export function useSkeletonAtrasado(carregando: boolean): boolean {
  const [mostrar, setMostrar] = useState(false);
  useEffect(() => {
    if (!carregando) { setMostrar(false); return; }
    const timer = setTimeout(() => setMostrar(true), 300);
    return () => clearTimeout(timer);
  }, [carregando]);
  return mostrar;
}

/** Ausência de dado, sempre igual — e apagada, para não parecer valor. */
export function Traco({ titulo }: { titulo?: string }) {
  return <span className="text-[var(--text-faint)]" title={titulo}>{TRACO}</span>;
}

/* ── Selos ───────────────────────────────────────────────────────────── */

export type TomDeSelo = "ok" | "gated" | "past" | "danger" | "marca" | "neutro" | "info";

const TONS_SELO: Record<TomDeSelo, string> = {
  ok: "bg-[var(--ok-bg)] text-[var(--ok)] border-[var(--ok-border)]",
  gated: "bg-[var(--gated-bg)] text-[var(--gated)] border-[var(--gated-border)]",
  past: "bg-[var(--past-bg)] text-[var(--past)] border-[var(--past-border)]",
  danger: "bg-[var(--danger-bg)] text-[var(--danger)] border-[var(--danger-border)]",
  info: "bg-[var(--info-bg)] text-[var(--info)] border-[var(--info-border)]",
  marca: "bg-[var(--brand-soft)] text-[var(--brand-ink)] border-transparent",
  neutro: "bg-[var(--surface-inset)] text-[var(--text-muted)] border-transparent",
};

/** Retangular, mono, caixa alta — o selo do painel, mais os tons `past` e `info` que a cobrança usa. */
export function SeloCobranca({ tom = "neutro", titulo, className, testId, children }: {
  tom?: TomDeSelo; titulo?: string; className?: string; testId?: string; children: ReactNode;
}) {
  return (
    <span
      title={titulo}
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-[7px] py-[3px] font-mono text-[10px] font-medium uppercase tracking-[var(--track-wide)] whitespace-nowrap tabular-nums",
        TONS_SELO[tom],
        className,
      )}
    >
      {children}
    </span>
  );
}

const FAMILIA_PARA_TOM: Record<"ok" | "gated" | "past", TomDeSelo> = { ok: "ok", gated: "gated", past: "past" };

/** O código do quadrante (A1..C3) pintado pela família: A em dia, B oscila, C crônico. */
export function SeloQuadrante({ quadrante, testId }: { quadrante: string | null | undefined; testId?: string }) {
  if (!quadrante) return <Traco titulo="Sem DNA: o ERP não informou a data do contrato" />;
  const q = quadrante as Quadrante;
  const tom = /^[ABC][123]$/.test(q) ? FAMILIA_PARA_TOM[familiaDoQuadrante(q)] : "neutro";
  return <SeloCobranca tom={tom} testId={testId} titulo="Quadrante do DNA 3×3">{quadrante}</SeloCobranca>;
}

/** O tom sugerido ao funcionário; a diretiva inteira vai no title. */
export function SeloTom({ tom }: { tom: string | null | undefined }) {
  if (!tom) return <Traco titulo="Sem tom sugerido: sem data de contrato não há DNA" />;
  const rotulo = ROTULO_TOM[tom as Tom] ?? tom;
  const diretiva = DIRETIVA_POR_TOM[tom as Tom];
  return (
    <SeloCobranca tom={tom === "humanizado_vulneravel" ? "info" : "neutro"} titulo={diretiva} className="normal-case tracking-normal">
      {rotulo}
    </SeloCobranca>
  );
}

export function SeloErp({ status }: { status: string | null | undefined }) {
  const s = situacaoDoErp(status);
  return <SeloCobranca tom={s.tom} titulo="Situação no ERP, como veio no último sync">{s.rotulo}</SeloCobranca>;
}

export function SeloCarteira({ carteira }: { carteira: string | null | undefined }) {
  if (!carteira) return <Traco />;
  const exCliente = carteira === "ex_cliente";
  const rotulo = carteira === "ativo" ? "Cliente" : carteira === "ex_cliente" ? ROTULO_CARTEIRA.ex_cliente : carteira;
  return <SeloCobranca tom={exCliente ? "past" : "ok"} titulo="Carteira fixada na abertura do caso">{rotulo}</SeloCobranca>;
}

/** O fluxo do operador (decisão (a), 05/09/2026): aberto → em contato → negociando → acordo → pago; cancelamento é terminal. */
const TOM_DO_STATUS_DE_CASO: Record<string, TomDeSelo> = {
  aberto: "neutro",
  em_contato: "info",
  negociando: "gated",
  acordo_ativo: "ok",
  negativado: "danger",
  pago: "ok",
  cancelamento: "past",
  baixado: "neutro",
  encerrado: "neutro",
};

export function SeloStatusCaso({ status, testId }: { status: string | null | undefined; testId?: string }) {
  if (!status) return <SeloCobranca tom="neutro" titulo="Cliente sem caso de cobrança aberto" testId={testId}>sem caso</SeloCobranca>;
  return (
    <SeloCobranca tom={TOM_DO_STATUS_DE_CASO[status] ?? "neutro"} testId={testId}>
      {rotuloDoStatusDeCaso(status)}
    </SeloCobranca>
  );
}

const TOM_DA_PRIORIDADE: Record<string, TomDeSelo> = { critica: "danger", alta: "gated", normal: "neutro", baixa: "neutro" };

export function SeloPrioridade({ prioridade }: { prioridade: string | null | undefined }) {
  if (!prioridade) return <Traco />;
  return (
    <SeloCobranca tom={TOM_DA_PRIORIDADE[prioridade] ?? "neutro"}>
      {ROTULO_PRIORIDADE[prioridade as keyof typeof ROTULO_PRIORIDADE] ?? prioridade}
    </SeloCobranca>
  );
}

/**
 * O lugar de um dado que a fase 1 não tem (fatura a fatura, NPS, CSAT, LTV,
 * propensão). Como o Provedor.ai faz com "A-CRIAR"/"PENDENTE": o espaço fica
 * marcado, nunca preenchido com zero.
 */
export function SeloFase2({ motivo = "Depende de fatura a fatura — fase 2" }: { motivo?: string }) {
  return <SeloCobranca tom="gated" titulo={motivo}>fase 2</SeloCobranca>;
}

/** "D+45 · crítico": o número e o nome da faixa, para quem não distingue a cor. */
export function PilulaAtraso({ dias, testId }: { dias: number; testId?: string }) {
  if (dias <= 0) return <Traco titulo="Sem atraso" />;
  const faixa = faixaDoAtraso(dias);
  return (
    <SeloCobranca tom={faixa.tom} testId={testId} titulo={`${dias} dias de atraso (a fatura mais antiga)`}>
      {rotuloDoAtraso(dias)} · {faixa.rotulo}
    </SeloCobranca>
  );
}

/* ── Composição da carteira ──────────────────────────────────────────── */

/**
 * Barra empilhada em dia / em cobrança / ex com dívida — o universo inteiro
 * da base, independente dos filtros. Cada fatia tem `title` e a legenda repete
 * rótulo, contagem e %, então a cor é redundante, não portadora.
 */
export function BarraComposicao({ composicao, carregando, testId, carteira }: {
  composicao: ComposicaoDaCarteira | null | undefined;
  carteira?: "ativo" | "ex_cliente";
  carregando?: boolean;
  testId?: string;
}) {
  const fatias = composicao
    ? [
        { id: "emDia", rotulo: "Ativos em dia", cor: "var(--ok)", n: composicao.emDia },
        { id: "emCobranca", rotulo: "Em cobrança", cor: "var(--gated)", n: composicao.emCobranca },
        { id: "exComDivida", rotulo: "Ex-clientes com dívida", cor: "var(--past)", n: composicao.exComDivida },
      ].filter(f => !carteira || (carteira === "ativo" ? f.id !== "exComDivida" : f.id === "exComDivida"))
    : null;
  const universo = fatias ? fatias.reduce((s, f) => s + f.n, 0) : 0;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-[14px] py-3" data-testid={testId}>
      <div className="flex flex-wrap items-baseline gap-2">
        <Kicker>composição da carteira</Kicker>
        <span className="text-[11px] text-[var(--text-faint)]">{carteira ? "toda a carteira selecionada" : "a base inteira"} · independe dos filtros</span>
      </div>
      <div className="mt-2 flex h-3 overflow-hidden rounded bg-[var(--surface-3)]" aria-hidden>
        {!carregando && fatias && universo > 0 && fatias.map(f => f.n > 0 && (
          <span key={f.id} title={`${f.rotulo} · ${num(f.n)}`} style={{ width: `${(f.n / universo) * 100}%`, background: f.cor }} className="block h-full" />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[var(--text-2)]">
        {fatias ? fatias.map(f => (
          <span key={f.id} className="inline-flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-sm" style={{ background: f.cor }} aria-hidden />
            {f.rotulo} <b className="font-mono font-medium tabular-nums">{num(f.n)}</b>
            <span className="font-mono tabular-nums text-[var(--text-muted)]">· {universo > 0 ? Math.round((f.n / universo) * 100) : 0}%</span>
          </span>
        )) : (
          <span className="text-[var(--text-muted)]">{carregando ? "…" : `${TRACO} sem dado`}</span>
        )}
      </div>
    </div>
  );
}

/* ── Pílula de filtro ────────────────────────────────────────────────── */

/**
 * Chip com um `<select>` nativo dentro: acessível de graça (teclado, leitor
 * de tela, celular) e sem popover para gerir. Ligado, ganha a borda e o fundo
 * da marca, como o chip de filtro de Localização.
 */
export function FiltroPilula({ rotulo, valor, opcoes, onChange, titulo, rotuloVazio = "Todos", testId }: {
  rotulo: string;
  valor: string;
  opcoes: OpcaoDeFiltro[];
  onChange: (valor: string) => void;
  /** O que o filtro significa — no `title` do chip. A opção leva o seu próprio (`OpcaoDeFiltro.titulo`). */
  titulo?: string;
  /** O rótulo do "sem recorte". `Todos` serve à maioria; o de atraso diz "Todas as faixas". */
  rotuloVazio?: string;
  testId?: string;
}) {
  const ativo = valor !== "";
  const atual = opcoes.find(o => o.valor === valor);
  return (
    <label
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded border px-2.5 text-[12px] font-medium whitespace-nowrap cursor-pointer motion-safe:transition-colors",
        ALVO_CONTROLE,
        FOCO_DENTRO,
        ativo
          ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-ink)]"
          : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--border-strong)]",
      )}
      data-testid={testId}
      title={titulo}
    >
      {/* O chip carrega número (faixa de dias, de dívida): mono tabular, como todo número. */}
      <span>{rotulo}{ativo && atual ? <span className="font-mono tabular-nums">: {atual.chip ?? atual.rotulo}</span> : ""}</span>
      <span aria-hidden className="text-[var(--text-muted)]">▾</span>
      <select
        aria-label={rotulo}
        value={valor}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 outline-none"
      >
        <option value="">{rotuloVazio}</option>
        {opcoes.map(o => <option key={o.valor} value={o.valor} title={o.titulo}>{o.rotulo}</option>)}
      </select>
    </label>
  );
}

/* ── Blocos ──────────────────────────────────────────────────────────── */

/** Card com kicker: a unidade de conteúdo das telas. `acoes` fica à direita do título. */
export function Cartao({ kicker, titulo, acoes, children, className, testId }: {
  kicker?: ReactNode;
  titulo?: ReactNode;
  acoes?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5", className)} data-testid={testId}>
      {(kicker || titulo || acoes) && (
        <header className="mb-2.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {kicker && <Kicker>{kicker}</Kicker>}
            {titulo && <h2 className="text-[13.5px] font-semibold leading-tight text-[var(--text)]">{titulo}</h2>}
          </div>
          {acoes && <div className="flex flex-none flex-wrap items-center gap-2">{acoes}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Linha rótulo/valor de um `<dl class="grid grid-cols-[96px_1fr]">` — a mesma do drawer de recuperação. */
export function Linha({ rotulo, children, mono, testId }: { rotulo: string; children: ReactNode; mono?: boolean; testId?: string }) {
  return (
    <>
      <dt className="text-[11px] text-[var(--text-faint)]">{rotulo}</dt>
      <dd className={cn("min-w-0 text-[12px] text-[var(--text-2)]", mono && "font-mono tabular-nums")} data-testid={testId}>{children}</dd>
    </>
  );
}

/** A grade das linhas acima. */
export const GRADE_LINHAS = "grid grid-cols-[104px_1fr] gap-x-3 gap-y-1.5";

/** Pessoa: círculo, como a seção 5.1 autoriza para avatar. */
export function Avatar({ nome, tamanho = "md" }: { nome: string; tamanho?: "sm" | "md" | "lg" }) {
  return <LadrilhoInicial nome={nome} forma="avatar" tamanho={tamanho} />;
}

/** Barra de score 0–1000 (isp_score) com a cor da faixa; sem score, trilho vazio + "—". */
export function BarraDeScore({ score, cor }: { score: number | null; cor: string }) {
  const largura = score !== null ? Math.max(0, Math.min(100, score / 10)) : 0;
  return (
    <span className="inline-flex h-1.5 flex-1 overflow-hidden rounded-sm bg-[var(--surface-3)]" aria-hidden>
      <span className="block h-full rounded-sm" style={{ width: `${largura}%`, background: score !== null ? cor : "var(--border-strong)" }} />
    </span>
  );
}

/** Link do WhatsApp — o ícone verde ao lado do telefone, como no card de recuperação. */
export function LinkWhatsapp({ whatsapp, nome, children }: { whatsapp: string; nome: string; children: ReactNode }) {
  return (
    <a
      href={`https://wa.me/${whatsapp}`}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`Abrir WhatsApp de ${nome}`}
      title="Abrir conversa no WhatsApp"
      className={cn("inline-flex min-h-7 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-[var(--ok)] hover:bg-[var(--ok-bg)]", FOCO)}
      onClick={e => e.stopPropagation()}
    >
      {children}
    </a>
  );
}
