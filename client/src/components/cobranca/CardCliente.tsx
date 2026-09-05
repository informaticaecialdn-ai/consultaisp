/**
 * Um cliente da carteira — o card e a linha da tabela, célula a célula com a
 * mesma regra: dado ausente é "—", nunca zero, nunca chute.
 *
 * O molde é o `.ct-card` do Provedor.ai (avatar · nome · cidade · plano ·
 * selos · em aberto · atraso · saúde · rodapé), na pele desta casa. O plano
 * é sempre "—" na fase 1: `customers` não guarda o plano, e o card diz isso
 * no title em vez de esconder a coluna.
 */
import { CalendarClock, Milestone, UserRound } from "lucide-react";
import { etapaPorId, ROTULO_MOTIVO_SEM_ETAPA, type Etapa, type EtapaId, type MotivoSemEtapa } from "@shared/cobranca";
import { cn } from "@/lib/utils";
import { brl, TRACO } from "@/components/localizacao/ui";
import { FOCO, Td } from "@/components/painel/ui";
import { faixaDoScore, proximoContato } from "./formatacao";
import type { ItemDaCarteira } from "./tipos";
import { Avatar, BarraDeScore, PilulaAtraso, SeloErp, SeloQuadrante, SeloStatusCaso, Traco } from "./ui";

const MOTIVO_SEM_PLANO = "O sync do ERP não traz o plano — fase 2";

function rotuloDaEtapa(id: string | null, etapas?: readonly Etapa[]): string | null {
  if (!id) return null;
  return etapaPorId(id as EtapaId, etapas)?.rotulo ?? id;
}

/**
 * A etapa gravada no caso; sem caso, a que a régua daria hoje (a rota a
 * manda em `regua`), marcada como "hoje" para não parecer que há caso.
 */
function etapaDoItem(item: ItemDaCarteira, etapas?: readonly Etapa[]) {
  const gravada = rotuloDaEtapa(item.caso?.etapa ?? null, etapas);
  if (gravada) return gravada;
  if (item.regua?.rotulo) return <span title="Sem caso aberto: é a etapa que a régua dá para o atraso de hoje">{item.regua.rotulo} <span className="text-[var(--text-faint)]">· hoje</span></span>;
  if (item.regua?.motivo) return <span className="text-[var(--text-faint)]">{ROTULO_MOTIVO_SEM_ETAPA[item.regua.motivo as MotivoSemEtapa] ?? item.regua.motivo}</span>;
  return <Traco titulo="Sem caso: sem etapa" />;
}

export function CardCliente({ item, etapas, hoje, onAbrir }: {
  item: ItemDaCarteira;
  etapas?: readonly Etapa[];
  hoje: Date;
  onAbrir: () => void;
}) {
  const devendo = item.dividaAtual > 0;
  const score = item.ispScore;
  const faixa = score !== null ? faixaDoScore(score) : null;
  const contato = item.caso ? proximoContato(item.caso.proximoContatoEm, hoje) : null;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(); } }}
      aria-label={`${item.nome} — abrir cliente 360`}
      data-testid={`card-cliente-${item.customerId}`}
      className={cn(
        "flex cursor-pointer flex-col gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-[14px] py-3 text-left hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] motion-safe:transition-colors",
        FOCO,
      )}
    >
      <div className="flex items-center gap-2.5">
        <Avatar nome={item.nome} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold leading-tight text-[var(--text)]">{item.nome}</p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
            {item.cidade ?? TRACO}{item.bairro ? ` · ${item.bairro}` : ""} · <span title={MOTIVO_SEM_PLANO}>{item.plano ?? "plano —"}</span>
          </p>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">{item.documentoMascarado}</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <SeloErp status={item.statusErp} />
        <SeloQuadrante quadrante={item.quadrante} />
        <SeloStatusCaso status={item.caso?.status ?? null} />
      </div>

      <div className="flex items-baseline gap-2 rounded bg-[var(--surface-2)] px-2.5 py-2">
        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]">{devendo ? "em aberto" : "situação"}</p>
          <p className={cn("font-mono text-[17px] font-medium tabular-nums tracking-[-0.01em]", devendo ? "text-[var(--money-neg)]" : "text-[var(--ok)]")}>
            {devendo ? brl(item.dividaAtual) : "em dia"}
          </p>
        </div>
        <span className="ml-auto"><PilulaAtraso dias={item.diasAtraso} /></span>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-[42px] font-mono text-[9.5px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]">crédito</span>
        <BarraDeScore score={score} cor={faixa?.cor ?? "var(--border-strong)"} />
        <span className="w-8 text-right font-mono text-[12px] font-medium tabular-nums text-[var(--text)]" title={faixa ? `Score ISP ${score} — ${faixa.rotulo}` : "Sem score ISP"}>
          {score !== null ? score : TRACO}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t border-[var(--border-faint)] pt-2 text-[11px]">
        <dt className="flex items-center gap-1 text-[var(--text-faint)]"><Milestone className="h-3 w-3" aria-hidden /> etapa</dt>
        <dd className="truncate text-[var(--text-2)]">{etapaDoItem(item, etapas)}</dd>
        <dt className="flex items-center gap-1 text-[var(--text-faint)]"><UserRound className="h-3 w-3" aria-hidden /> resp.</dt>
        <dd className="truncate text-[var(--text-2)]">{item.caso ? (item.caso.responsavel?.nome ?? <span className="text-[var(--text-faint)]">fila geral</span>) : <Traco />}</dd>
        <dt className="flex items-center gap-1 text-[var(--text-faint)]"><CalendarClock className="h-3 w-3" aria-hidden /> contato</dt>
        <dd className={cn("truncate font-mono tabular-nums", contato?.urgencia === "vencido" ? "text-[var(--danger)]" : "text-[var(--text-2)]")}>
          {contato ? contato.texto : <Traco />}
        </dd>
      </dl>
    </article>
  );
}

/** A mesma leitura em forma de linha — a tabela da visão "Tabela". */
export function LinhaDoCliente({ item, etapas, hoje, onAbrir }: {
  item: ItemDaCarteira;
  etapas?: readonly Etapa[];
  hoje: Date;
  onAbrir: () => void;
}) {
  const score = item.ispScore;
  const faixa = score !== null ? faixaDoScore(score) : null;
  const contato = item.caso ? proximoContato(item.caso.proximoContatoEm, hoje) : null;
  return (
    <tr
      onClick={onAbrir}
      tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter") onAbrir(); }}
      className={cn("cursor-pointer hover:bg-[var(--surface-2)]", FOCO)}
      data-testid={`linha-cliente-${item.customerId}`}
    >
      <Td>
        <div className="flex items-center gap-2">
          <Avatar nome={item.nome} tamanho="sm" />
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-medium text-[var(--text)]">{item.nome}</p>
            <p className="truncate text-[11px] text-[var(--text-muted)]">{item.cidade ?? TRACO}{item.bairro ? ` · ${item.bairro}` : ""}</p>
          </div>
        </div>
      </Td>
      <Td num alinhamento="esquerda">{item.documentoMascarado}</Td>
      <Td><span title={MOTIVO_SEM_PLANO}>{item.plano ?? <Traco titulo={MOTIVO_SEM_PLANO} />}</span></Td>
      <Td><SeloErp status={item.statusErp} /></Td>
      <Td num className={item.dividaAtual > 0 ? "text-[var(--money-neg)]" : undefined}>{item.dividaAtual > 0 ? brl(item.dividaAtual) : <Traco />}</Td>
      <Td alinhamento="direita"><PilulaAtraso dias={item.diasAtraso} /></Td>
      <Td><SeloQuadrante quadrante={item.quadrante} /></Td>
      <Td>
        <span className="inline-flex w-[88px] items-center gap-2">
          <BarraDeScore score={score} cor={faixa?.cor ?? "var(--border-strong)"} />
          <span className="font-mono text-[12px] tabular-nums">{score !== null ? score : TRACO}</span>
        </span>
      </Td>
      <Td>{etapaDoItem(item, etapas)}</Td>
      <Td>{item.caso ? (item.caso.responsavel?.nome ?? <span className="text-[var(--text-faint)]">fila geral</span>) : <Traco />}</Td>
      <Td num alinhamento="esquerda" className={contato?.urgencia === "vencido" ? "text-[var(--danger)]" : undefined}>{contato ? contato.texto : <Traco />}</Td>
      <Td><SeloStatusCaso status={item.caso?.status ?? null} /></Td>
    </tr>
  );
}
