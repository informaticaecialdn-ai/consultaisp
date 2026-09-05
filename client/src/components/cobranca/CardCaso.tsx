/**
 * O card de um caso de cobrança no kanban.
 *
 * Mostra o que o operador precisa para decidir o próximo gesto sem abrir a
 * ficha: quem é, quanto deve há quantos dias, em que ETAPA da régua está (selo,
 * não coluna — a coluna é o fluxo do operador), o tom sugerido pelo DNA, de
 * quem é o caso e quando é o próximo contato. As ações são as mesmas da fila:
 * registrar contato, pegar para mim, abrir o 360.
 *
 * A alça de arrasto é o card inteiro menos os botões (o `activator` do dnd-kit
 * fica no bloco de identidade), para o clique em "Registrar contato" não
 * começar um arrasto — o mesmo cuidado do card de equipamento.
 */
import { useDraggable } from "@dnd-kit/core";
import { Link } from "wouter";
import { CalendarClock, GripVertical, MessageCircle, PhoneCall, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { brl, TRACO } from "@/components/localizacao/ui";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, FOCO } from "@/components/painel/ui";
import {
  etapaParaAtraso, etapaPorId, janelaDaEtapa, ROTULO_MOTIVO_SEM_ETAPA,
  type Carteira, type Etapa, type EtapaId, type MotivoSemEtapa,
} from "@shared/cobranca";
import { dataHoraBr, proximoContato, whatsappDe } from "./formatacao";
import { rotaDoCliente, type ItemDaFila } from "./tipos";
import { Avatar, LinkWhatsapp, PilulaAtraso, SeloCarteira, SeloPrioridade, SeloQuadrante, SeloTom, Traco } from "./ui";

export interface EtapaDoCard {
  etapa: Etapa | null;
  motivo: string | null;
  /** true quando a régua foi calculada aqui, porque o motor ainda não gravou a etapa no caso. */
  derivada: boolean;
}

/**
 * A etapa que o card mostra: a que a ROTA decidiu hoje; senão a gravada no
 * caso; e só em último caso a que a régua daria pelo atraso — dizendo que
 * derivou. Espelha `etapaDaLinha` da fila; vive aqui para o card não importar
 * uma página.
 */
export function etapaDoCard(item: ItemDaFila, etapas: readonly Etapa[] | undefined): EtapaDoCard {
  if (item.regua) {
    const deHoje = item.regua.etapa ? etapaPorId(item.regua.etapa as EtapaId, etapas) : null;
    if (deHoje) return { etapa: deHoje, motivo: null, derivada: false };
    if (item.regua.motivo) {
      return { etapa: null, motivo: ROTULO_MOTIVO_SEM_ETAPA[item.regua.motivo as MotivoSemEtapa] ?? String(item.regua.motivo), derivada: false };
    }
  }
  if (item.etapaAtual) {
    const gravada = etapaPorId(item.etapaAtual as EtapaId, etapas);
    if (gravada) return { etapa: gravada, motivo: null, derivada: false };
  }
  const decisao = etapaParaAtraso(item.cliente.diasAtraso, item.carteira as Carteira, etapas);
  return decisao.etapa
    ? { etapa: decisao.etapa, motivo: null, derivada: true }
    : { etapa: null, motivo: ROTULO_MOTIVO_SEM_ETAPA[decisao.motivo], derivada: true };
}

export interface AcoesDoCard {
  onContato: (item: ItemDaFila) => void;
  onPegar?: (item: ItemDaFila) => void;
  pegando?: boolean;
}

export function chaveDoCard(item: ItemDaFila): string {
  return `caso-${item.id}`;
}

export function CardCaso({ item, etapas, hoje, acoes, ocupado, overlay, alca }: {
  item: ItemDaFila;
  etapas: readonly Etapa[] | undefined;
  hoje: Date;
  acoes: AcoesDoCard;
  ocupado?: boolean;
  /** Renderizado dentro do DragOverlay: sem alça e sem botões vivos. */
  overlay?: boolean;
  alca?: { ref: (el: HTMLElement | null) => void; listeners: Record<string, unknown> | undefined; atributos: Record<string, unknown> };
}) {
  const { cliente } = item;
  const { etapa, motivo, derivada } = etapaDoCard(item, etapas);
  const contato = proximoContato(item.proximoContatoEm, hoje);
  const whatsapp = whatsappDe(cliente.telefone);
  const tom = item.tomSugerido ?? item.tom;
  const quadrante = item.quadrante ?? item.quadranteDna;
  const podePegar = item.responsavelUserId === null && acoes.onPegar !== undefined;

  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[12px]",
        overlay && "shadow-[0_0_0_1px_var(--brand),0_12px_32px_-14px_rgba(20,19,26,.35)]",
        ocupado && "opacity-60",
      )}
      data-testid={`card-caso-${item.id}`}
    >
      <div
        ref={alca?.ref}
        {...(alca?.listeners ?? {})}
        {...(alca?.atributos ?? {})}
        className={cn("flex items-start gap-2", alca && "cursor-grab active:cursor-grabbing", FOCO, "rounded")}
        aria-label={`${cliente.nome} · ${brl(item.valorAtual)} · ${cliente.diasAtraso} dias`}
      >
        {alca && <GripVertical className="mt-0.5 h-3.5 w-3.5 flex-none text-[var(--text-faint)]" aria-hidden />}
        <Avatar nome={cliente.nome} tamanho="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold text-[var(--text)]">{cliente.nome}</p>
          <p className="truncate font-mono text-[10.5px] tabular-nums text-[var(--text-muted)]">{cliente.cpfCnpj}</p>
        </div>
        <div className="flex-none text-right">
          <p className="font-mono text-[12.5px] font-semibold tabular-nums text-[var(--money-neg)]">{brl(item.valorAtual)}</p>
          <PilulaAtraso dias={cliente.diasAtraso} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {etapa ? (
          <span
            className="inline-flex items-center gap-1 rounded bg-[var(--brand-soft)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--brand-ink)]"
            title={derivada ? `${etapa.acao} — etapa derivada do atraso; o motor ainda não gravou` : etapa.acao}
            data-testid={`card-etapa-${item.id}`}
          >
            {etapa.rotulo} <span className="tabular-nums normal-case tracking-normal">{janelaDaEtapa(etapa)}</span>
            {derivada && <span aria-label="derivada do atraso">≈</span>}
          </span>
        ) : (
          <span className="text-[10.5px] text-[var(--text-muted)]" title={motivo ?? undefined}>{motivo ?? <Traco />}</span>
        )}
        <SeloQuadrante quadrante={quadrante} />
        <SeloTom tom={tom} />
        <SeloCarteira carteira={item.carteira} />
        <SeloPrioridade prioridade={item.prioridade} />
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <dt className="flex items-center gap-1 text-[var(--text-faint)]"><UserRound className="h-3 w-3" aria-hidden /></dt>
        <dd className="truncate text-[var(--text-2)]">{item.responsavelNome ?? <span className="text-[var(--text-faint)]">fila geral</span>}</dd>
        <dt className="flex items-center gap-1 text-[var(--text-faint)]"><CalendarClock className="h-3 w-3" aria-hidden /></dt>
        <dd
          className={cn("font-mono tabular-nums", contato.urgencia === "vencido" ? "text-[var(--danger)]" : contato.urgencia === "hoje" ? "text-[var(--gated)]" : "text-[var(--text-2)]")}
          title={item.proximoContatoEm ? dataHoraBr(item.proximoContatoEm) : undefined}
        >
          {contato.texto}
        </dd>
        <dt className="flex items-center gap-1 text-[var(--text-faint)]"><PhoneCall className="h-3 w-3" aria-hidden /></dt>
        <dd className="flex items-center gap-1 truncate font-mono tabular-nums text-[var(--text-2)]">
          {cliente.telefone ?? TRACO}
          {whatsapp && !overlay && <LinkWhatsapp whatsapp={whatsapp} nome={cliente.nome}><MessageCircle className="h-3.5 w-3.5" aria-hidden /></LinkWhatsapp>}
        </dd>
      </dl>

      {!overlay && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className={cn(BOTAO_MARCA, "h-8 px-2.5 text-[11.5px]")} onClick={() => acoes.onContato(item)} data-testid={`card-contato-${item.id}`}>
            <PhoneCall className="h-3 w-3" aria-hidden /> Contato
          </button>
          {podePegar && (
            <button type="button" className={cn(BOTAO_SECUNDARIO, "h-8 px-2.5 text-[11.5px]")} disabled={acoes.pegando} onClick={() => acoes.onPegar?.(item)} data-testid={`card-pegar-${item.id}`}>
              <UserRound className="h-3 w-3" aria-hidden /> Pegar
            </button>
          )}
          <Link href={rotaDoCliente(cliente.id)} className={cn(BOTAO_SECUNDARIO, "h-8 px-2.5 text-[11.5px]")} data-testid={`card-360-${item.id}`}>360</Link>
        </div>
      )}
    </div>
  );
}

export function CardCasoArrastavel({ item, etapas, hoje, acoes, ocupado }: {
  item: ItemDaFila; etapas: readonly Etapa[] | undefined; hoje: Date; acoes: AcoesDoCard; ocupado?: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: chaveDoCard(item),
    data: { item },
    disabled: ocupado,
  });
  return (
    <article ref={setNodeRef} role="listitem" style={{ opacity: isDragging ? 0.35 : 1 }} data-testid={`card-arrastavel-${item.id}`}>
      <CardCaso
        item={item}
        etapas={etapas}
        hoje={hoje}
        acoes={acoes}
        ocupado={ocupado}
        alca={{ ref: setActivatorNodeRef, listeners: listeners as Record<string, unknown> | undefined, atributos: attributes as unknown as Record<string, unknown> }}
      />
    </article>
  );
}
