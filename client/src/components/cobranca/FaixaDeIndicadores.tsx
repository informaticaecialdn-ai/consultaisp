/**
 * Os INDICADORES do quadro — quatro cartões com número herói.
 *
 * Duas rodadas de pedido do dono, na ordem:
 *
 * 1. 06/09/2026, com o print do Kanban: "melhorar essas informações, toma
 *    metade da tela". Eram oito cards de 76px em três fileiras, mais de 340px
 *    acima do quadro. Viraram uma tira de células de ~48px.
 * 2. 07/09/2026, com o handoff de design: a tira vira QUATRO cartões, cada um
 *    com rótulo, número grande e uma linha de apoio que diz de onde o número
 *    sai. O que a tira tinha de melhor — nada de ícone decorativo, nenhum
 *    número sem explicação — continua.
 *
 * A linha de APOIO é a novidade que faz a diferença: na tira, o subtítulo de
 * cada indicador tinha virado `title`, e explicação escondida em tooltip não
 * sobrevive a print nem a celular. Aqui ela é texto permanente, e o `title`
 * fica com o detalhe longo.
 *
 * A faixa de 3px à esquerda é o único lugar em que a cor semântica aparece
 * sempre; o NÚMERO só recebe cor quando ela significa risco, como manda o
 * sistema ("o número é --color-ink, nunca o acento").
 */
import type { ReactNode } from "react";

/** Um cartão da tira. `apoio` é a linha que explica o número; `tom`, a faixa da esquerda. */
export interface Indicador {
  chave: string;
  rotulo: string;
  valor: string;
  /** A linha de baixo: de onde o número sai, ou o que ele decompõe. */
  apoio?: ReactNode;
  /** Cor do NÚMERO — só quando ela significa risco. */
  cor?: string;
  /** Cor da faixa de 3px à esquerda. Sempre presente: é ela que separa os quatro. */
  tom?: string;
  titulo?: string;
  testId?: string;
}

const ROTULO =
  "block truncate font-mono text-[10px] font-semibold uppercase leading-none tracking-[var(--track-wide)] text-[var(--text-faint)]";
/**
 * `clamp` porque o valor pode ser "R$ 1.284.930,00" numa coluna de 190px: o
 * número encolhe até caber e nunca quebra no meio (`whitespace-nowrap`).
 */
const VALOR =
  "mt-2 block truncate font-mono text-[clamp(21px,2vw,26px)] font-semibold leading-none tabular-nums whitespace-nowrap";

export function FaixaDeIndicadores({ itens, rotulo, testId }: {
  itens: Indicador[];
  rotulo: string;
  testId?: string;
}) {
  return (
    <section
      className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3"
      aria-label={rotulo}
      data-testid={testId}
    >
      {itens.map(i => (
        <div
          key={i.chave}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3"
          style={{ borderLeft: `3px solid ${i.tom ?? "var(--border-strong)"}` }}
          title={i.titulo}
          data-testid={i.testId}
        >
          <span className={ROTULO}>{i.rotulo}</span>
          <span className={VALOR} style={{ color: i.cor ?? "var(--text)", letterSpacing: "var(--track-tight)" }}>{i.valor}</span>
          {i.apoio !== undefined && (
            <p className="mt-1.5 text-[11.5px] leading-4 text-[var(--text-muted)]">{i.apoio}</p>
          )}
        </div>
      ))}
    </section>
  );
}
