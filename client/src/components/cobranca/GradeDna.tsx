/**
 * A grade DNA 3×3 — COMO falar com cada tipo de cliente.
 *
 * Linhas = confiabilidade (em dia · oscila · crônico), colunas = fidelidade
 * (novo · médio · fiel). Cada célula é um botão com a contagem de casos vivos
 * do quadrante; a célula escolhida abre o painel ao lado com a diretiva para
 * o funcionário e a frase de abertura. A grade não dirige o timing — isso é
 * a régua — e a diretiva vem de `shared/cobranca/dna.ts`, nunca de texto
 * solto na tela.
 */
import { useMemo } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import {
  ABORDAGEM_POR_QUADRANTE, DIRETIVA_POR_ABORDAGEM, DIRETIVA_VULNERAVEL, FRASE_EXEMPLO_POR_QUADRANTE, FRASE_EXEMPLO_VULNERAVEL,
  GRADE_DNA, ROTULO_CONFIABILIDADE, ROTULO_FIDELIDADE, ROTULO_TOM, eixosDoQuadrante, familiaDoQuadrante,
  type Carteira, type Quadrante,
} from "@shared/cobranca";
import { cn } from "@/lib/utils";
import { brl, Kicker, num } from "@/components/localizacao/ui";
import { FOCO, BOTAO_SECUNDARIO } from "@/components/painel/ui";
import { ROTA_CARTEIRA_ATIVOS, ROTA_CARTEIRA_EX, type ContagemPorQuadrante } from "./tipos";
import { SeloQuadrante, Traco } from "./ui";

const COR_DA_FAMILIA = {
  ok: { tinta: "var(--ok)", fundo: "var(--ok-bg)", borda: "var(--ok-border)" },
  gated: { tinta: "var(--gated)", fundo: "var(--gated-bg)", borda: "var(--gated-border)" },
  past: { tinta: "var(--past)", fundo: "var(--past-bg)", borda: "var(--past-border)" },
} as const;

const COLUNAS = ["novo", "medio", "fiel"] as const;

export interface TotaisDoQuadrante {
  casos: number;
  valor: number;
}

/** Soma as contagens por quadrante (as duas carteiras juntas, ou só uma). */
export function totaisPorQuadrante(contagens: ContagemPorQuadrante[], carteira?: Carteira): Map<string, TotaisDoQuadrante> {
  const mapa = new Map<string, TotaisDoQuadrante>();
  for (const c of contagens) {
    if (carteira && c.carteira !== carteira) continue;
    const chave = c.quadrante ?? "sem";
    const atual = mapa.get(chave) ?? { casos: 0, valor: 0 };
    mapa.set(chave, { casos: atual.casos + c.casos, valor: atual.valor + c.valor });
  }
  return mapa;
}

/**
 * Quadrante sem linha na resposta: ZERO casos quando a resposta já chegou
 * (a rota só manda os quadrantes que têm caso), e "—" só enquanto carrega.
 * Traço depois de carregar diria "sem dado" onde o dado é "nenhum".
 */
export function contagemDoQuadrante(totais: Map<string, TotaisDoQuadrante>, quadrante: string, carregando: boolean): TotaisDoQuadrante | null {
  return totais.get(quadrante) ?? (carregando ? null : { casos: 0, valor: 0 });
}

export function GradeDna({ contagens, carteira, carregando = false, selecionado, onSelecionar, testId }: {
  contagens: ContagemPorQuadrante[];
  /** Filtra as contagens e vai na URL do link "ver carteira"; sem ela, as duas carteiras somam. */
  carteira?: Carteira;
  /** Enquanto a resposta não chegou, célula sem contagem é "—"; depois, é zero. */
  carregando?: boolean;
  selecionado: Quadrante;
  onSelecionar: (q: Quadrante) => void;
  testId?: string;
}) {
  const totais = useMemo(() => totaisPorQuadrante(contagens, carteira), [contagens, carteira]);
  const classificados = Array.from(totais.entries()).filter(([k]) => k !== "sem").reduce((s, [, t]) => s + t.casos, 0);
  const semClassificacao = totais.get("sem")?.casos ?? 0;
  const q = selecionado;
  const eixos = eixosDoQuadrante(q);
  const familia = familiaDoQuadrante(q);
  const cor = COR_DA_FAMILIA[familia];
  const totalDoQ = contagemDoQuadrante(totais, q, carregando);
  const pctDoQ = totalDoQ && classificados > 0 ? ((totalDoQ.casos / classificados) * 100).toFixed(1).replace(".", ",") : null;
  const abordagem = ABORDAGEM_POR_QUADRANTE[q];
  // Cada carteira tem o proprio espaco na tela: o link ja abre o certo.
  const linkCarteira = `${carteira === "ex_cliente" ? ROTA_CARTEIRA_EX : ROTA_CARTEIRA_ATIVOS}?quadrante=${q}`;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]" data-testid={testId}>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <p className="mb-3 text-[12px] text-[var(--text-muted)]">
          <b className="font-mono tabular-nums text-[var(--text)]">{num(classificados)}</b> casos classificados
          {semClassificacao > 0 && (
            <> · <b className="font-mono tabular-nums text-[var(--gated)]">{num(semClassificacao)}</b> sem DNA <span className="text-[var(--text-faint)]">(sem data de contrato no ERP)</span></>
          )}
          {" "}· ↑ confiabilidade de pagamento · → fidelidade
        </p>
        <div className="grid grid-cols-[72px_repeat(3,minmax(0,1fr))] gap-1.5" role="grid" aria-label="Grade DNA 3×3">
          <div />
          {COLUNAS.map(c => (
            <div key={c} className="pb-1 text-center font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{ROTULO_FIDELIDADE[c]}</div>
          ))}
          {GRADE_DNA.map(linha => (
            <LinhaDaGrade
              key={linha.confiabilidade}
              rotulo={ROTULO_CONFIABILIDADE[linha.confiabilidade]}
              quadrantes={linha.quadrantes}
              totais={totais}
              carregando={carregando}
              selecionado={selecionado}
              onSelecionar={onSelecionar}
            />
          ))}
        </div>
      </div>

      <aside className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5" aria-live="polite" data-testid="dna-detalhe">
        <div className="flex items-center gap-3">
          <span
            className="grid h-11 w-11 flex-none place-items-center rounded-lg font-mono text-[15px] font-semibold"
            style={{ background: cor.fundo, color: cor.tinta, border: `1px solid ${cor.borda}` }}
            aria-hidden
          >
            {q}
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-medium leading-tight tracking-[var(--track-tight)] text-[var(--text)]">{ROTULO_TOM[abordagem]}</h3>
            <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
              {ROTULO_FIDELIDADE[eixos.fidelidade]} · {ROTULO_CONFIABILIDADE[eixos.confiabilidade]} ·{" "}
              {totalDoQ ? <span className="font-mono tabular-nums">{num(totalDoQ.casos)} casos{pctDoQ ? ` (${pctDoQ}%)` : ""} · {brl(totalDoQ.valor)}</span> : <Traco />}
            </p>
          </div>
        </div>

        <div>
          <Kicker>como falar com este tipo</Kicker>
          <p className="mt-1 text-[12.5px] leading-5 text-[var(--text-2)]">{DIRETIVA_POR_ABORDAGEM[abordagem]}</p>
        </div>

        <div>
          <Kicker>frase de abertura</Kicker>
          <p className="mt-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[12.5px] italic leading-5 text-[var(--text-2)]">“{FRASE_EXEMPLO_POR_QUADRANTE[q]}”</p>
        </div>

        <div className="rounded border border-[var(--info-border)] bg-[var(--info-bg)] px-3 py-2 text-[11.5px] leading-4 text-[var(--text-2)]">
          <b className="text-[var(--info)]">A exceção que manda:</b> cliente vulnerável (Lei 14.181) sobrepõe qualquer quadrante. {DIRETIVA_VULNERAVEL} <span className="italic">“{FRASE_EXEMPLO_VULNERAVEL}”</span>
        </div>

        <Link href={linkCarteira} className={cn(BOTAO_SECUNDARIO, "self-start")} data-testid="dna-ver-carteira">
          <SeloQuadrante quadrante={q} /> ver carteira deste quadrante <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </aside>
    </div>
  );
}

function LinhaDaGrade({ rotulo, quadrantes, totais, carregando, selecionado, onSelecionar }: {
  rotulo: string;
  quadrantes: readonly Quadrante[];
  totais: Map<string, TotaisDoQuadrante>;
  carregando: boolean;
  selecionado: Quadrante;
  onSelecionar: (q: Quadrante) => void;
}) {
  return (
    <>
      <div className="flex items-center font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{rotulo}</div>
      {quadrantes.map(q => {
        const cor = COR_DA_FAMILIA[familiaDoQuadrante(q)];
        const t = contagemDoQuadrante(totais, q, carregando);
        const ativo = selecionado === q;
        return (
          <button
            key={q}
            type="button"
            role="gridcell"
            aria-pressed={ativo}
            onClick={() => onSelecionar(q)}
            data-testid={`dna-celula-${q}`}
            className={cn("flex min-h-[76px] flex-col items-start justify-between rounded-lg border px-2.5 py-2 text-left motion-safe:transition-[box-shadow]", FOCO)}
            style={{
              background: cor.fundo,
              borderColor: ativo ? cor.tinta : cor.borda,
              boxShadow: ativo ? `0 0 0 1px ${cor.tinta}` : undefined,
            }}
          >
            <span className="font-mono text-[12px] font-semibold" style={{ color: cor.tinta }}>{q}</span>
            <span className="font-mono text-[15px] font-medium tabular-nums leading-none text-[var(--text)]">
              {t ? num(t.casos) : <span className="text-[var(--text-faint)]">—</span>}
              <span className="ml-1 font-sans text-[10px] font-normal text-[var(--text-muted)]">casos</span>
            </span>
            <span className="text-[10.5px] leading-tight text-[var(--text-2)]">{ROTULO_TOM[ABORDAGEM_POR_QUADRANTE[q]]}</span>
          </button>
        );
      })}
    </>
  );
}
