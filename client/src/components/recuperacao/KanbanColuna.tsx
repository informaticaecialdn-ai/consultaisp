/**
 * Coluna do kanban — a área que recebe o drop.
 *
 * Enquanto um card está no ar, a coluna diz se aceita ou não ANTES do drop:
 * anel berinjela para destino válido, anel `--danger` tracejado para o
 * recusado. O aviso em toast ainda vem no drop, mas o operador já não
 * precisa tentar para descobrir que idade não se arrasta.
 *
 * Encerradas (recuperado / baixado) ficam em `--surface-2`, separadas do
 * fluxo: são saída, não etapa.
 */
import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { brl, MONO, num } from "@/components/localizacao/ui";
import { avaliarMovimento, ehColunaEncerrada } from "./movimentos";
import type { CardKanban, ColunaKanban } from "./tipos";

interface KanbanColunaProps {
  chave: ColunaKanban;
  rotulo: string;
  quantidade: number;
  valor: number;
  /** Card em arrasto, para pintar o destino como válido ou não. */
  cardAtivo: CardKanban | null;
  children: ReactNode;
}

export const LARGURA_COLUNA = 296;

export function KanbanColuna({ chave, rotulo, quantidade, valor, cardAtivo, children }: KanbanColunaProps) {
  const { setNodeRef, isOver } = useDroppable({ id: chave, data: { coluna: chave } });
  const encerrada = ehColunaEncerrada(chave);

  const veredito = cardAtivo ? avaliarMovimento(cardAtivo, chave) : null;
  const aceita = veredito !== null && veredito.tipo !== "recusado" && veredito.tipo !== "nenhum";
  const recusa = veredito !== null && veredito.tipo === "recusado";

  const anel = isOver && aceita
    ? "0 0 0 2px var(--brand)"
    : isOver && recusa
      ? "0 0 0 2px var(--danger)"
      : aceita
        ? "0 0 0 1px var(--brand)"
        : "0 0 0 1px var(--border)";

  const vazio = quantidade === 0;
  const textoVazio = chave === "sem_data"
    ? "nenhum equipamento sem data de rescisão"
    : encerrada
      ? "nada encerrado nos últimos 90 dias"
      : "nenhum equipamento nesta faixa";

  return (
    <section
      ref={setNodeRef}
      aria-label={`${rotulo}: ${quantidade} ${quantidade === 1 ? "equipamento" : "equipamentos"}`}
      data-coluna={chave}
      data-aceita={cardAtivo ? String(aceita) : undefined}
      className="flex max-h-full flex-none flex-col rounded-lg"
      style={{
        width: LARGURA_COLUNA,
        background: encerrada ? "var(--surface-2)" : "var(--bg)",
        boxShadow: anel,
        opacity: recusa && !isOver ? 0.75 : 1,
        transition: "box-shadow .15s, opacity .15s",
      }}
    >
      <header className="flex items-baseline justify-between gap-2 px-3 pb-2 pt-3">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-medium tracking-[-0.01em] text-[var(--text)]">{rotulo}</h2>
          {encerrada && <p className="text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]" style={MONO}>últimos 90 dias</p>}
          {chave === "sem_data" && <p className="text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]" style={MONO}>sem caso aberto</p>}
        </div>
        <div className="flex-none text-right" style={MONO}>
          <p className="text-[13px] font-medium text-[var(--text)]">{num(quantidade)}</p>
          <p className="text-[10px] text-[var(--text-muted)]">{brl(valor)}</p>
        </div>
      </header>

      <div className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" role="list" aria-label={`Cards de ${rotulo}`}>
        {vazio ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center">
            <Inbox className="h-5 w-5 text-[var(--text-faint)]" aria-hidden />
            <p className="mt-2 text-[11px] leading-4 text-[var(--text-muted)]">{textoVazio}</p>
          </div>
        ) : children}
      </div>
    </section>
  );
}
