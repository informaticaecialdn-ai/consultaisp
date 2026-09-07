/**
 * A visão LISTA do quadro — os mesmos casos, em tabela.
 *
 * Handoff de design (07/09/2026), seção 6. O quadro é para trabalhar caso a
 * caso e arrastar; a lista é para varrer muitos de uma vez — comparar valores,
 * achar um nome, ver quem está travado sem abrir cinco colunas.
 *
 * Ela NÃO busca dado próprio. Lê a mesma resposta do kanban, com os mesmos
 * filtros, e por isso o total do rodapé vale nas duas visões.
 *
 * ── A HONESTIDADE QUE ESTA TELA EXIGE ──────────────────────────────────
 *
 * A resposta do quadro vem AGRUPADA por coluna, e cada coluna tem teto
 * (`porColuna`, com `truncado` quando estourou). No quadro isso é visível: a
 * coluna diz "mostrando N de M". Achatado numa lista, o mesmo dado vira uma
 * tabela que PARECE completa e não é — o operador rolaria até o fim e concluiria
 * que viu todos os casos do recorte.
 *
 * Por isso a lista soma quantos ficaram de fora e diz, no rodapé, exatamente
 * quantos são e por quê. Nunca escondemos o corte.
 *
 * A ORDEM aqui é por VALOR VENCIDO, do maior para o menor — e não a ordem do
 * dia do quadro. A ordem do dia é por coluna (vencido, hoje, sem data,
 * agendado) e não sobrevive ao achatamento: misturar quatro filas de urgência
 * numa só produziria uma sequência que não quer dizer nada. Numa lista o que
 * se procura é "onde está o dinheiro", e isso a coluna de valor responde.
 */
import { cn } from "@/lib/utils";
import { brl, num, TRACO } from "@/components/localizacao/ui";
import { FOCO, Td, TabelaPainel, Th } from "@/components/painel/ui";
import { rotuloDoStatusDeCaso, type ItemDaFila, type RespostaDoKanban } from "./tipos";
import type { Etapa } from "@shared/cobranca";
import { proximoContato } from "./formatacao";
import { casoFechado, etapaDoCard, textoDaFaixaDoDia, TOM_DA_FAIXA_DO_DIA } from "./CardCaso";
import { PilulaAtraso, SeloCobranca } from "./ui";

const NUM = "font-mono tabular-nums";

export const MOTIVO_SEM_PASSO =
  "Caso sem próxima ação escrita. Abra o caso e defina o que fazer e quando — caso parado vira dívida perdida.";

/** Uma linha da lista: o caso mais a coluna em que ele está. */
export interface LinhaDaLista {
  item: ItemDaFila;
  coluna: string;
  rotuloDaColuna: string;
}

/**
 * Achata as colunas numa lista só, do maior valor vencido para o menor, e
 * conta quantos casos o teto por coluna deixou de fora.
 *
 * Colunas FECHADAS (pago, cancelamento, baixado…) ficam de fora: a lista é a
 * outra visão do TRABALHO, e o trabalho é o que está vivo. O quadro mostra os
 * encerrados atrás de um botão justamente por isso.
 */
export function achatarParaLista(quadro: RespostaDoKanban): { linhas: LinhaDaLista[]; ocultos: number } {
  const linhas: LinhaDaLista[] = [];
  let ocultos = 0;
  for (const coluna of quadro.colunas) {
    if (coluna.fechada) continue;
    for (const item of coluna.casos) {
      linhas.push({ item, coluna: coluna.status, rotuloDaColuna: coluna.rotulo });
    }
    // `total` é o tamanho REAL da coluna no servidor; `casos` é o que coube.
    if (coluna.truncado) ocultos += Math.max(0, coluna.total - coluna.casos.length);
  }
  linhas.sort((a, b) => (b.item.valorAtual ?? 0) - (a.item.valorAtual ?? 0));
  return { linhas, ocultos };
}

export function ListaDeCasos({ quadro, etapas, hoje, onAbrir, testId = "lista-de-casos" }: {
  quadro: RespostaDoKanban;
  etapas: readonly Etapa[] | undefined;
  hoje: Date;
  onAbrir: (item: ItemDaFila) => void;
  testId?: string;
}) {
  const { linhas, ocultos } = achatarParaLista(quadro);

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <TabelaPainel testId={`${testId}-tabela`}>
          <thead className="bg-[var(--surface-2)]">
            <tr>
              <Th>cliente</Th>
              <Th>documento</Th>
              <Th alinhamento="direita">vencido</Th>
              <Th alinhamento="direita">atraso</Th>
              <Th>coluna</Th>
              <Th>etapa da régua</Th>
              <Th>próximo passo</Th>
              <Th>faixa do dia</Th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ item, coluna, rotuloDaColuna }) => {
              const { etapa, motivo } = etapaDoCard(item, etapas);
              const contato = proximoContato(item.proximoContatoEm, hoje);
              const fechado = casoFechado(item.status);
              const passo = item.proximaAcao?.trim() || etapa?.acao || null;
              return (
                <tr
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onAbrir(item)}
                  onKeyDown={e => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onAbrir(item);
                  }}
                  className={cn("cursor-pointer hover:bg-[var(--surface-2)]", FOCO)}
                  title="Abrir o caso: dívida, boletos e negociação"
                  data-testid={`lista-linha-${item.id}`}
                >
                  <Td className="max-w-[220px] truncate font-semibold text-[var(--text)]">{item.cliente.nome}</Td>
                  <Td num alinhamento="esquerda" className="text-[var(--text-muted)]">{item.cliente.cpfCnpj || TRACO}</Td>
                  <Td num className="font-semibold text-[var(--money-neg)]">{brl(item.valorAtual)}</Td>
                  <Td alinhamento="direita"><PilulaAtraso dias={item.cliente.diasAtraso} /></Td>
                  <Td className="text-[var(--text-2)]">{rotuloDaColuna || rotuloDoStatusDeCaso(coluna) || coluna}</Td>
                  <Td className="text-[var(--text-2)]">{etapa?.rotulo ?? motivo ?? TRACO}</Td>
                  <Td className="max-w-[260px] truncate">
                    {passo ?? <span title={MOTIVO_SEM_PASSO} className="text-[var(--text-faint)]">{TRACO}</span>}
                  </Td>
                  <Td>
                    {fechado ? (
                      <span className={cn(NUM, "text-[var(--text-faint)]")}>{TRACO}</span>
                    ) : (
                      <SeloCobranca tom={TOM_DA_FAIXA_DO_DIA[contato.urgencia]} className="normal-case tracking-normal">
                        {textoDaFaixaDoDia(contato.urgencia, contato.texto)}
                      </SeloCobranca>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TabelaPainel>
      </div>

      <p className="text-[11px] text-[var(--text-faint)]" data-testid={`${testId}-rodape`}>
        <span className={cn(NUM, "text-[var(--text-2)]")}>{num(linhas.length)}</span> casos vivos nesta lista, do maior
        valor vencido para o menor.
        {ocultos > 0 && (
          <>
            {" "}
            <b className="font-medium text-[var(--text-2)]" data-testid={`${testId}-ocultos`}>
              Mais <span className={NUM}>{num(ocultos)}</span> não couberam
            </b>{" "}
            — o servidor manda no máximo um punhado de casos por coluna, e o resto fica de fora até você
            filtrar. Use a busca ou a faixa de atraso para estreitar o recorte.
          </>
        )}{" "}
        Colunas encerradas (pago, cancelamento, baixado) não entram: a lista é a outra visão do trabalho vivo.
      </p>
    </div>
  );
}
