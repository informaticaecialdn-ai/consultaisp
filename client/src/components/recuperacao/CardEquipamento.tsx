/**
 * Card do kanban de recuperação — um equipamento retido, com o cliente e o
 * caso na mesma folha.
 *
 * Denso de propósito: o operador olha dezenas destes por dia. Tudo que é
 * número sai em mono tabular; o "dias retido" é o único número grande, porque
 * é o que decide a coluna e a cor. As mudanças que não são de coluna
 * (prioridade, etapa) ficam em select inline aqui mesmo — abrir um drawer
 * para trocar prioridade custaria três cliques em vez de um.
 *
 * `CardArrastavel` é a casca com o `useDraggable`; `CardEquipamento` é o
 * corpo puro, que o `DragOverlay` reaproveita sem os hooks.
 */
import { useDraggable, type DraggableAttributes, type DraggableSyntheticListeners } from "@dnd-kit/core";
import type { CSSProperties, ReactNode } from "react";
import { CalendarClock, GripVertical, History, MessageCircle, ShieldAlert, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brl, MONO } from "@/components/localizacao/ui";
import { dataCurta, dataHoraCurta as dataHora } from "./datas";
import { faixaDosDias, textoPrazo, type FaixaIdade } from "./movimentos";
import {
  ETAPAS_ABERTAS, PRIORIDADES, ROTULO_CANAL, ROTULO_COLUNA, ROTULO_ETAPA,
  ROTULO_METODO, ROTULO_PRIORIDADE, ROTULO_RESULTADO, type CardKanban,
} from "./tipos";

export interface AcoesCard {
  onPrioridade: (card: CardKanban, prioridade: string) => void;
  onEtapa: (card: CardKanban, etapa: string) => void;
  onContato: (card: CardKanban) => void;
  onAgendar: (card: CardKanban) => void;
  onDetalhes: (card: CardKanban) => void;
  onAbrirCaso: (card: CardKanban) => void;
}

/** Cor do "dias retido" por faixa — os mesmos tokens das colunas. */
export const COR_FAIXA: Record<FaixaIdade, string> = {
  ok: "var(--ok)",
  gated: "var(--gated)",
  past: "var(--past)",
  danger: "var(--danger)",
};

/** Contestado pode aparecer em qualquer idade — mas só se marca no drawer, com motivo. */
const ETAPAS_DO_SELECT = ETAPAS_ABERTAS.filter(etapa => etapa !== "contestado");

export const nomeDoEquipamento = (card: CardKanban) =>
  [card.equipamento.tipo, card.equipamento.marca, card.equipamento.modelo].filter(Boolean).join(" ");

/** Select inline do card: nativo, porque abre em cima de um kanban que rola em dois eixos. */
export function SelectInline({ valor, opcoes, rotulo, onChange, desabilitado }: {
  valor: string;
  opcoes: ReadonlyArray<{ valor: string; rotulo: string }>;
  rotulo: string;
  onChange: (valor: string) => void;
  desabilitado?: boolean;
}) {
  return (
    <select
      aria-label={rotulo}
      title={rotulo}
      value={valor}
      disabled={desabilitado}
      onChange={event => onChange(event.target.value)}
      className="h-8 min-w-0 max-w-full cursor-pointer rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 font-mono text-[11px] text-[var(--text-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {opcoes.map(opcao => <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>)}
    </select>
  );
}

/** Selo retangular, mono, 10px — nunca pill. */
export function Selo({ tom, children, titulo }: { tom: "ok" | "gated" | "past" | "danger" | "neutro"; children: ReactNode; titulo?: string }) {
  const cores: Record<typeof tom, CSSProperties> = {
    ok: { background: "var(--ok-bg)", color: "var(--ok)", border: "1px solid var(--ok-border)" },
    gated: { background: "var(--gated-bg)", color: "var(--gated)", border: "1px solid var(--gated-border)" },
    past: { background: "var(--past-bg)", color: "var(--past)", border: "1px solid var(--past-border)" },
    danger: { background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" },
    neutro: { background: "var(--surface-inset)", color: "var(--text-muted)", border: "1px solid transparent" },
  };
  return (
    <span title={titulo} style={{ ...MONO, ...cores[tom], display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 500, letterSpacing: "0.04em", padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

export const OPCOES_PRIORIDADE = PRIORIDADES.map(valor => ({ valor, rotulo: ROTULO_PRIORIDADE[valor] }));
const OPCOES_ETAPA = ETAPAS_DO_SELECT.map(valor => ({ valor, rotulo: ROTULO_ETAPA[valor] }));

interface CardEquipamentoProps {
  card: CardKanban;
  acoes: AcoesCard;
  /** Mutação em voo neste card: selects travados, leve opacidade. */
  ocupado?: boolean;
  /** Renderizado dentro do DragOverlay — sem alça e sem foco. */
  overlay?: boolean;
  /** Ref e listeners da alça, vindos do `useDraggable`. */
  alca?: {
    ref: (node: HTMLElement | null) => void;
    listeners: DraggableSyntheticListeners;
    atributos: DraggableAttributes;
  };
}

export function CardEquipamento({ card, acoes, ocupado, overlay, alca }: CardEquipamentoProps) {
  const { equipamento, cliente, caso } = card;
  const faixa = caso ? faixaDosDias(caso.diasRetido) : null;
  const encerrado = card.coluna === "recuperado" || card.coluna === "baixado";
  const identificacao = [
    equipamento.serie && `SN ${equipamento.serie}`,
    equipamento.mac,
    equipamento.patrimonio && `PAT ${equipamento.patrimonio}`,
  ].filter(Boolean).join(" · ");
  const enderecoCurto = [cliente.bairro, cliente.cidade && (cliente.uf ? `${cliente.cidade}/${cliente.uf}` : cliente.cidade)].filter(Boolean).join(" · ");
  const etapaNoSelect = caso && ETAPAS_DO_SELECT.includes(caso.status as typeof ETAPAS_DO_SELECT[number]);

  return (
    <div
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[12px] text-[var(--text-2)]"
      style={{ opacity: ocupado ? 0.6 : 1, boxShadow: overlay ? "0 0 0 1px var(--ring-warm), 0 12px 32px -14px rgba(20, 19, 26, 0.35)" : undefined }}
    >
      {/* Linha 1 — a alça de arrasto é a faixa inteira: alvo largo, sem roubar espaço. */}
      <div
        ref={alca?.ref}
        {...(alca?.atributos ?? {})}
        {...(alca?.listeners ?? {})}
        aria-roledescription={alca ? "card arrastável" : undefined}
        aria-label={alca ? `Arrastar ${nomeDoEquipamento(card)} de ${cliente.nome} (${ROTULO_COLUNA[card.coluna]})` : undefined}
        className={`flex min-h-11 items-center gap-2 rounded-t-lg px-3 py-2 ${alca ? "cursor-grab touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand)] active:cursor-grabbing" : ""}`}
        style={{ touchAction: alca ? "none" : undefined }}
      >
        {alca && <GripVertical className="h-4 w-4 flex-none text-[var(--text-faint)]" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-tight text-[var(--text)]">{equipamento.tipo}{(equipamento.marca || equipamento.modelo) && <span className="font-normal text-[var(--text-muted)]"> · {[equipamento.marca, equipamento.modelo].filter(Boolean).join(" ")}</span>}</p>
          {identificacao && <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]" style={MONO}>{identificacao}</p>}
        </div>
        <span className="flex-none text-[13px] font-medium text-[var(--text)]" style={MONO}>{equipamento.valor !== null ? brl(equipamento.valor) : "—"}</span>
      </div>

      {/* Cliente */}
      <div className="border-t border-[var(--border-faint)] px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium text-[var(--text)]">{cliente.nome}</p>
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]" style={MONO}>{cliente.documento}</p>
          </div>
          {cliente.dividaEmAberto > 0 && (
            <span className="flex-none text-right text-[11px]" style={MONO} title="Dívida em aberto na carteira">
              <span className="text-[var(--money-neg)]">{brl(cliente.dividaEmAberto)}</span>
              {cliente.diasEmAtraso > 0 && <span className="block text-[10px] text-[var(--text-faint)]">{cliente.diasEmAtraso} d atraso</span>}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
          {cliente.telefone && (
            <span className="inline-flex items-center gap-1" style={MONO}>
              {cliente.telefone}
              {cliente.whatsapp && !overlay && (
                <a
                  href={`https://wa.me/${cliente.whatsapp}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`Abrir WhatsApp de ${cliente.nome}`}
                  title="Abrir conversa no WhatsApp"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--ok)] hover:bg-[var(--ok-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand)]"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                </a>
              )}
            </span>
          )}
          {enderecoCurto && <span className="truncate text-[var(--text-muted)]">{enderecoCurto}</span>}
        </div>
      </div>

      {/* Caso */}
      {caso && faixa ? (
        <div className="border-t border-[var(--border-faint)] px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {encerrado || !etapaNoSelect ? (
                <Selo tom={card.coluna === "recuperado" ? "ok" : encerrado ? "neutro" : caso.status === "contestado" ? "past" : "neutro"}>
                  {ROTULO_ETAPA[caso.status] ?? caso.status}
                </Selo>
              ) : (
                <SelectInline rotulo="Etapa do caso" valor={caso.status} opcoes={OPCOES_ETAPA} onChange={etapa => acoes.onEtapa(card, etapa)} desabilitado={ocupado || overlay} />
              )}
              {encerrado ? (
                <Selo tom="neutro">prioridade {ROTULO_PRIORIDADE[caso.prioridade] ?? caso.prioridade}</Selo>
              ) : (
                <SelectInline rotulo="Prioridade" valor={caso.prioridade} opcoes={OPCOES_PRIORIDADE} onChange={prioridade => acoes.onPrioridade(card, prioridade)} desabilitado={ocupado || overlay} />
              )}
            </div>
            <div className="flex-none text-right">
              <p className="text-[22px] font-medium leading-none tracking-[-0.02em]" style={{ ...MONO, color: encerrado ? "var(--text-muted)" : COR_FAIXA[faixa] }}>
                {caso.diasRetido}
              </p>
              <p className="mt-0.5 text-[9px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]" style={MONO}>dias retido</p>
              {!encerrado && (
                <p className="mt-1 text-[10px]" style={{ ...MONO, color: caso.diasRestantes <= 10 ? "var(--danger)" : "var(--text-muted)" }}>
                  {textoPrazo(caso.diasRestantes)}
                </p>
              )}
              {encerrado && caso.encerradoEm && (
                <p className="mt-1 text-[10px] text-[var(--text-muted)]" style={MONO}>encerrado {dataCurta(caso.encerradoEm)}</p>
              )}
            </div>
          </div>

          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
            <dt className="flex items-center gap-1 text-[var(--text-faint)]"><UserRound className="h-3 w-3" aria-hidden /> resp.</dt>
            <dd className="truncate text-[var(--text-2)]">{caso.responsavel?.nome ?? <span className="text-[var(--text-faint)]">sem responsável</span>}</dd>
            <dt className="flex items-center gap-1 text-[var(--text-faint)]"><CalendarClock className="h-3 w-3" aria-hidden /> agenda</dt>
            <dd className="truncate text-[var(--text-2)]" style={MONO}>{caso.agendadoEm ? `${dataHora(caso.agendadoEm)}${caso.metodo ? ` · ${ROTULO_METODO[caso.metodo] ?? caso.metodo}` : ""}` : <span className="font-sans text-[var(--text-faint)]">sem agendamento</span>}</dd>
            <dt className="flex items-center gap-1 text-[var(--text-faint)]"><History className="h-3 w-3" aria-hidden /> último</dt>
            <dd className="truncate text-[var(--text-2)]">
              {caso.tentativas.ultima
                ? <>{ROTULO_CANAL[caso.tentativas.ultima.canal ?? ""] ?? caso.tentativas.ultima.canal ?? "—"} · {ROTULO_RESULTADO[caso.tentativas.ultima.resultado ?? ""] ?? caso.tentativas.ultima.resultado ?? "—"} · <span style={MONO}>{dataCurta(caso.tentativas.ultima.em)}</span></>
                : <span className="text-[var(--text-faint)]">nenhum contato ainda</span>}
              {caso.tentativas.total > 0 && <span className="ml-1 text-[var(--text-faint)]" style={MONO}>({caso.tentativas.total})</span>}
            </dd>
          </dl>

          {(caso.contestadoEm || caso.bureauStatus === "ativo_validado" || caso.bureauStatus === "contestado_bloqueado") && (
            <div className="mt-2 flex flex-wrap gap-1">
              {caso.contestadoEm && <Selo tom="past" titulo={`Contestado em ${dataCurta(caso.contestadoEm)}`}><ShieldAlert className="h-3 w-3" aria-hidden /> contestado</Selo>}
              {caso.bureauStatus === "ativo_validado" && <Selo tom="ok" titulo="Ocorrência visível na Consulta ISP"><ShieldCheck className="h-3 w-3" aria-hidden /> sinal validado</Selo>}
              {caso.bureauStatus === "contestado_bloqueado" && <Selo tom="danger" titulo="Sinal bloqueado por contestação">sinal bloqueado</Selo>}
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-[var(--border-faint)] px-3 py-2">
          <p className="text-[11px] leading-4 text-[var(--text-muted)]">Sem caso aberto: informe a rescisão para a idade aparecer.</p>
        </div>
      )}

      {/* Ações — 44px de alvo, ghost, hairline em cima. */}
      {!overlay && (
        <div className="flex border-t border-[var(--border-faint)]">
          {caso ? (
            <>
              {!encerrado && <Button type="button" variant="ghost" size="sm" className="min-h-11 flex-1 rounded-none rounded-bl-lg text-[12px]" onClick={() => acoes.onContato(card)}>Contato</Button>}
              {!encerrado && <Button type="button" variant="ghost" size="sm" className="min-h-11 flex-1 rounded-none border-l border-[var(--border-faint)] text-[12px]" onClick={() => acoes.onAgendar(card)}>Agendar</Button>}
              <Button type="button" variant="ghost" size="sm" className={`min-h-11 flex-1 rounded-none rounded-br-lg text-[12px] text-[var(--brand)] ${encerrado ? "rounded-bl-lg" : "border-l border-[var(--border-faint)]"}`} onClick={() => acoes.onDetalhes(card)}>Detalhes</Button>
            </>
          ) : (
            <Button type="button" variant="ghost" size="sm" className="min-h-11 flex-1 rounded-none rounded-b-lg text-[12px] text-[var(--brand)]" onClick={() => acoes.onAbrirCaso(card)} data-testid={`abrir-caso-${card.equipamento.id}`}>
              Abrir caso
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Casca com o `useDraggable`: mede o card inteiro, mas só a linha 1 é a alça. */
export function CardArrastavel({ card, acoes, ocupado }: { card: CardKanban; acoes: AcoesCard; ocupado?: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: card.chave,
    data: { card },
    disabled: ocupado,
  });

  return (
    <article
      ref={setNodeRef}
      data-testid={`card-${card.chave}`}
      aria-label={`${nomeDoEquipamento(card)} · ${card.cliente.nome}`}
      // O original fica como sombra no lugar enquanto o overlay viaja: o olho sabe de onde saiu.
      style={{ opacity: isDragging ? 0.35 : 1 }}
    >
      <CardEquipamento
        card={card}
        acoes={acoes}
        ocupado={ocupado}
        alca={{ ref: setActivatorNodeRef, listeners, atributos: attributes }}
      />
    </article>
  );
}
