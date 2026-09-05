/**
 * A linha do tempo do caso — tudo que aconteceu, do mais novo ao mais velho.
 *
 * O storage grava a trilha mecânica (etapa, responsável, acordo, parcela,
 * encerramento) e o funcionário grava o que declara (contato, promessa,
 * nota). Aqui os dois viram a mesma lista, com a palavra de
 * `shared/cobranca/estados.ts` para cada chave — o mesmo dicionário do
 * diálogo e do card, para o operador não ler "Contato" num lugar e
 * "Tentativa" no outro.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { ROTULO_CANAL, ROTULO_RESULTADO, ROTULO_TIPO_DE_EVENTO, type CanalDeContato, type ResultadoDeContato, type TipoDeEvento } from "@shared/cobranca";
import { dataHoraBr } from "./formatacao";
import type { EventoDeCobranca } from "./tipos";

const COR_DO_TIPO: Record<string, string> = {
  contato: "var(--brand)",
  promessa: "var(--gated)",
  negociacao_proposta: "var(--gated)",
  acordo_aceito: "var(--ok)",
  acordo_quebrado: "var(--danger)",
  parcela_paga: "var(--ok)",
  etapa_mudou: "var(--info)",
  responsavel_mudou: "var(--info)",
  nota: "var(--text-muted)",
  suspensao: "var(--past)",
  negativacao: "var(--danger)",
  encerramento: "var(--text-muted)",
};

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : null;
}

/** O título de uma linha: o tipo, mais o que o metadata acrescenta (canal · resultado, de → para). */
export function descreverEvento(e: EventoDeCobranca): string {
  const tipo = ROTULO_TIPO_DE_EVENTO[e.tipo as TipoDeEvento] ?? e.tipo;
  if (e.tipo === "contato") {
    const canal = ROTULO_CANAL[e.canal as CanalDeContato] ?? e.canal;
    const resultado = ROTULO_RESULTADO[e.resultado as ResultadoDeContato] ?? e.resultado;
    return [tipo, canal, resultado].filter(Boolean).join(" · ");
  }
  const meta = e.metadata ?? {};
  const de = texto(meta.de);
  const para = texto(meta.para);
  if ((e.tipo === "etapa_mudou" || e.tipo === "responsavel_mudou") && (de || para)) {
    return `${tipo}: ${de ?? "—"} → ${para ?? "—"}`;
  }
  return tipo;
}

export function LinhaDoTempo({ eventos, carregando, testId }: { eventos: EventoDeCobranca[]; carregando?: boolean; testId?: string }) {
  return (
    <div className="divide-y divide-[var(--border-faint)] rounded-lg border border-[var(--border)]" data-testid={testId}>
      {carregando ? (
        <div className="space-y-2 p-3" aria-hidden><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : eventos.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">Nenhum evento registrado ainda.</p>
      ) : eventos.map(e => (
        <div key={e.id} className="flex gap-3 px-3 py-2.5" data-testid={`evento-${e.id}`}>
          <span className="mt-1.5 h-2 w-2 flex-none rounded-full" style={{ background: COR_DO_TIPO[e.tipo] ?? "var(--text-faint)" }} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <p className="text-[12px] font-medium text-[var(--text)]">{descreverEvento(e)}</p>
              <time dateTime={e.ocorridoEm} className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{dataHoraBr(e.ocorridoEm)}</time>
            </div>
            {e.notas && <p className="mt-0.5 whitespace-pre-line text-[11.5px] leading-4 text-[var(--text-2)]">{e.notas}</p>}
            <p className="mt-0.5 text-[10.5px] text-[var(--text-faint)]">
              {e.userId === null ? "sistema" : (e.usuarioNome ?? `usuário #${e.userId}`)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
