/**
 * A FAIXA DE INDICADORES do quadro — os mesmos números, numa tira só.
 *
 * Pedido do dono (06/09/2026, com o print do Kanban): "melhorar essas
 * informações, toma metade da tela". Tomava mesmo. Os oito indicadores eram
 * oito cards de 76px num grid de quatro colunas: três fileiras, mais de 340px
 * de altura acima do quadro. Numa tela de notebook o operador rolava a página
 * inteira antes de ver a primeira coluna da esteira — e a esteira é o trabalho.
 *
 * Aqui os oito viram células de uma tira de ~48px: rótulo mono em caixa alta e
 * o número embaixo, separados por hairline de 1px (o grid tem `gap-px` sobre
 * fundo `--border`, então a linha aparece também onde a tira quebra). Nenhum
 * indicador foi removido, nenhum `title` foi perdido — o que saiu foi o ícone
 * de 32px de cada card, que só repetia o que o rótulo já diz, e o quadrado
 * colorido em volta dele.
 *
 * O número segue mono e `tabular-nums`, e a cor semântica continua entrando só
 * quando significa risco: um número sem risco é `--text`, como manda o sistema
 * ("o número é --color-ink, nunca o acento").
 */
import type { ReactNode } from "react";

/** Uma célula da tira. `valorNode` existe para o fluxo do dia, que tem dois números. */
export interface Indicador {
  chave: string;
  rotulo: string;
  valor?: string;
  valorNode?: ReactNode;
  cor?: string;
  titulo?: string;
  testId?: string;
}

const ROTULO =
  "block truncate font-mono text-[9.5px] font-medium uppercase leading-none tracking-[var(--track-wide)] text-[var(--text-muted)]";
const VALOR = "mt-1 block truncate font-mono text-[15px] font-medium leading-none tabular-nums";

export function FaixaDeIndicadores({ itens, rotulo, testId }: {
  itens: Indicador[];
  rotulo: string;
  testId?: string;
}) {
  return (
    <section
      // gap-px sobre o fundo da borda: o hairline nasce entre as células, e
      // continua certo quando a tira quebra em duas fileiras.
      className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4 xl:grid-cols-8"
      aria-label={rotulo}
      data-testid={testId}
    >
      {itens.map(i => (
        <div key={i.chave} className="bg-[var(--surface)] px-3 py-2.5" title={i.titulo} data-testid={i.testId}>
          <span className={ROTULO}>{i.rotulo}</span>
          {i.valorNode ?? (
            <span className={VALOR} style={{ color: i.cor ?? "var(--text)" }}>{i.valor}</span>
          )}
        </div>
      ))}
    </section>
  );
}
