/**
 * O card de um caso de cobrança no kanban — a história do caso sem abrir a ficha.
 *
 * Pedido do dono (05/09/2026): "as informações não identificam o cliente; o
 * valor que ele deve, quais são as parcelas; é um card de cobrança, precisa
 * ter dados para entender na visualização o que se trata". Então o card diz,
 * nesta ordem: QUEM (nome inteiro, cidade e bairro, documento, situação do
 * contrato), QUANTO E DESDE QUANDO (dívida, faturas vencidas, a mais antiga,
 * o valor na abertura do caso), O QUE JÁ FOI COMBINADO (o acordo vivo e o
 * andamento das parcelas), O QUE FAZER AGORA (a etapa da régua com a ação e o
 * tom do DNA) e COM QUEM (responsável, próximo e último contato, telefone,
 * chat). As ações são as da fila: contato, pegar, enviar ao chat, 360.
 *
 * A alça de arrasto é o bloco de identidade (o `activator` do dnd-kit), para
 * o clique num botão não começar um arrasto — o mesmo cuidado do card de
 * equipamento.
 */
import { useDraggable } from "@dnd-kit/core";
import { Link } from "wouter";
import { CalendarClock, ClipboardList, GripVertical, Handshake, MessageCircle, MessageSquareShare, PhoneCall, Route, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { brl, num, TRACO } from "@/components/localizacao/ui";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, FOCO } from "@/components/painel/ui";
import {
  etapaParaAtraso, etapaPorId, janelaDaEtapa, ROTULO_MOTIVO_SEM_ETAPA, ROTULO_STATUS_DE_CASO, ROTULO_STATUS_DE_NEGOCIACAO, ROTULO_TIPO_DE_NEGOCIACAO,
  type Carteira, type Etapa, type EtapaId, type MotivoSemEtapa, type StatusDeCaso, type StatusDeNegociacao, type TipoDeNegociacao,
} from "@shared/cobranca";
import { dataBr, dataCivilBr, dataHoraBr, proximoContato, situacaoDoErp, whatsappDe } from "./formatacao";
import { tomDaEtapaDaRegua } from "./movimentos-cobranca";
import { rotaDoCliente, type ItemDaFila, type NegociacaoResumo } from "./tipos";
import { Avatar, LinkWhatsapp, PilulaAtraso, SeloCobranca, SeloPrioridade, SeloQuadrante, SeloTom, Traco } from "./ui";

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

/** A data em que a fatura mais antiga venceu: hoje menos os dias de atraso — o sync guarda só o agregado. */
export function vencimentoMaisAntigo(diasAtraso: number, hoje: Date): Date | null {
  if (diasAtraso <= 0) return null;
  return new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - diasAtraso);
}

/** "3x de R$ 100,00 · 1/3 pagas · próxima 10/09 (atrasada)" — o acordo numa linha. */
export function resumoDoAcordo(n: NegociacaoResumo): string {
  const partes: string[] = [];
  if (n.tipo === "parcelamento" && n.parcelas > 0) {
    partes.push(`${n.parcelas}x${n.valorParcela !== null ? ` de ${brl(n.valorParcela)}` : ""}`);
    if (n.entrada > 0) partes.push(`entrada ${brl(n.entrada)}`);
    partes.push(`${n.parcelasPagas}/${n.parcelas} pagas`);
  } else {
    partes.push(`à vista ${brl(n.valorNegociado)}`);
  }
  if (n.proximaParcela) partes.push(`próxima ${dataCivilBr(n.proximaParcela.vencimento)}${n.proximaParcela.atrasada ? " (atrasada)" : ""}`);
  return partes.join(" · ");
}

export interface AcoesDoCard {
  onContato: (item: ItemDaFila) => void;
  onPegar?: (item: ItemDaFila) => void;
  pegando?: boolean;
  /** "Enviar p/ cobranca": abre a conversa do cliente no Chat BullQ com a mensagem da regua. So aparece com o chat pronto. */
  onEnviarParaChat?: (item: ItemDaFila) => void;
  /** O caso cujo envio esta em curso (desabilita so o botao dele). */
  enviandoParaChat?: number | null;
  /** O inbox do chat, para o selo "conversa" abrir a conversa la. */
  inboxUrl?: string | null;
}

export function chaveDoCard(item: ItemDaFila): string {
  return `caso-${item.id}`;
}

const NUM = "font-mono tabular-nums";

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
  const situacao = situacaoDoErp(cliente.statusErp);
  const fechado = ["pago", "cancelamento", "baixado", "encerrado"].includes(item.status);
  const maisAntiga = vencimentoMaisAntigo(cliente.diasAtraso, hoje);
  const faturas = cliente.faturasAbertas ?? null;
  const acordo = item.negociacao ?? null;
  const lugar = [cliente.bairro, cliente.cidade].filter(Boolean).join(" · ");
  // Follow-up: caso vivo sem data de proximo contato esta PARADO — e o que vira divida perdida.
  const parado = !overlay && item.proximoContatoEm === null && !fechado;

  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[12px]",
        overlay && "shadow-[0_0_0_1px_var(--brand),0_12px_32px_-14px_rgba(20,19,26,.35)]",
        ocupado && "opacity-60",
      )}
      data-testid={`card-caso-${item.id}`}
    >
      {/* QUEM — a alça de arrasto */}
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
          <p className="text-[12.5px] font-semibold leading-4 text-[var(--text)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden" title={cliente.nome} data-testid={`card-nome-${item.id}`}>{cliente.nome}</p>
          <p className={cn(NUM, "truncate text-[10.5px] text-[var(--text-muted)]")}>{cliente.cpfCnpj}{lugar ? <span className="font-sans"> · {lugar}</span> : null}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <SeloCobranca tom={situacao.tom} titulo="Situação do contrato no ERP, como veio no último sync">{situacao.rotulo}</SeloCobranca>
            <SeloPrioridade prioridade={item.prioridade} />
          </div>
        </div>
      </div>

      {/* QUANTO E DESDE QUANDO */}
      <div className="mt-2 rounded-lg bg-[var(--surface-2)] px-2.5 py-2" data-testid={`card-divida-${item.id}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">deve</span>
          <span className={cn(NUM, "text-[16px] font-semibold leading-none text-[var(--money-neg)]")}>{brl(item.valorAtual)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <PilulaAtraso dias={cliente.diasAtraso} />
          <span className={cn(NUM, "text-[11px] text-[var(--text-2)]")}>
            {faturas !== null ? `${num(faturas)} fatura${faturas === 1 ? "" : "s"} vencida${faturas === 1 ? "" : "s"}` : "faturas —"}
            {maisAntiga ? ` · a mais antiga venceu ${dataBr(maisAntiga.toISOString())}` : ""}
          </span>
        </div>
        {item.valorAbertura !== item.valorAtual && (
          <p className={cn(NUM, "mt-1 text-[10.5px] text-[var(--text-faint)]")}>na abertura do caso: {brl(item.valorAbertura)} · {dataBr(item.abertoEm)}</p>
        )}
        {acordo && (
          <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-4 text-[var(--text-2)]" data-testid={`card-acordo-${item.id}`}>
            <Handshake className="mt-0.5 h-3 w-3 flex-none text-[var(--ok)]" aria-hidden />
            <span>
              <b className="text-[var(--text)]">{ROTULO_TIPO_DE_NEGOCIACAO[acordo.tipo as TipoDeNegociacao] ?? acordo.tipo}</b>
              <span className="text-[var(--text-muted)]"> · {ROTULO_STATUS_DE_NEGOCIACAO[acordo.status as StatusDeNegociacao] ?? acordo.status}</span>
              <br /><span className={NUM}>{resumoDoAcordo(acordo)}</span>
            </span>
          </p>
        )}
      </div>

      {/* O QUE FAZER AGORA */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {etapa ? (
          <SeloCobranca
            tom={tomDaEtapaDaRegua(etapa.id)}
            titulo={derivada ? `${etapa.acao} — etapa derivada do atraso; o motor ainda não gravou` : etapa.acao}
            testId={`card-etapa-${item.id}`}
          >
            {etapa.rotulo} <span className="tabular-nums normal-case tracking-normal">{janelaDaEtapa(etapa)}</span>
            {derivada && <span aria-label="derivada do atraso">≈</span>}
          </SeloCobranca>
        ) : (
          <span className="text-[10.5px] text-[var(--text-muted)]" title={motivo ?? undefined}>{motivo ?? <Traco />}</span>
        )}
        <SeloQuadrante quadrante={quadrante} />
        <SeloTom tom={tom} />
        {item.chat && (
          acoes.inboxUrl ? (
            <a href={acoes.inboxUrl} target="_blank" rel="noreferrer noopener" onClick={e => e.stopPropagation()} className="inline-flex" title={`Conversa no chat · ${item.chat.status}`} data-testid={`card-chat-${item.id}`}>
              <SeloCobranca tom="info" className="normal-case tracking-normal"><MessageSquareShare className="h-3 w-3" aria-hidden /> chat · {item.chat.status.toLowerCase()}</SeloCobranca>
            </a>
          ) : (
            <SeloCobranca tom="info" className="normal-case tracking-normal" titulo={`Conversa no chat · ${item.chat.status}`} testId={`card-chat-${item.id}`}><MessageSquareShare className="h-3 w-3" aria-hidden /> chat · {item.chat.status.toLowerCase()}</SeloCobranca>
          )
        )}
      </div>
      {etapa && (
        <p className="mt-1 flex items-start gap-1 text-[11px] leading-4 text-[var(--text-2)]" title={etapa.acao} data-testid={`card-acao-${item.id}`}>
          <Route className="mt-0.5 h-3 w-3 flex-none text-[var(--text-faint)]" aria-hidden />
          <span className="[display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{etapa.acao}</span>
        </p>
      )}

      {/* FOLLOW-UP — as quatro coisas que todo caso precisa ter claras: próxima ação, dono, quando, status */}
      <div
        className={cn("mt-2 rounded-lg border px-2.5 py-2", parado ? "border-[var(--danger-border)] bg-[var(--danger-bg)]" : "border-[var(--border-faint)] bg-[var(--surface)]")}
        data-testid={`card-followup-${item.id}`}
        data-parado={parado ? "true" : undefined}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">follow-up</span>
          <span className={cn("font-mono text-[10px] uppercase tracking-[var(--track-wide)]", parado ? "text-[var(--danger)]" : "text-[var(--text-faint)]")}>{ROTULO_STATUS_DE_CASO[item.status as StatusDeCaso] ?? item.status}</span>
        </div>
        <p className="mt-1 flex items-start gap-1 text-[11.5px] leading-4 text-[var(--text)]" data-testid={`card-proxima-acao-${item.id}`}>
          <ClipboardList className={cn("mt-0.5 h-3 w-3 flex-none", parado ? "text-[var(--danger)]" : "text-[var(--text-faint)]")} aria-hidden />
          {parado ? (
            <span className="font-medium text-[var(--danger)]">sem próxima ação — defina no próximo contato</span>
          ) : item.proximaAcao ? (
            <span className="font-medium">{item.proximaAcao}</span>
          ) : (
            <span className="text-[var(--text-2)]" title="A régua sugere; o operador confirma no próximo contato">{etapa ? `≈ ${etapa.acao}` : "—"}</span>
          )}
        </p>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
          <dt className="flex items-center gap-1 text-[var(--text-faint)]"><UserRound className="h-3 w-3" aria-hidden /></dt>
          <dd className="truncate text-[var(--text-2)]">{item.responsavelNome ?? <span className="text-[var(--text-faint)]">fila geral · sem dono</span>}</dd>
          <dt className="flex items-center gap-1 text-[var(--text-faint)]"><CalendarClock className="h-3 w-3" aria-hidden /></dt>
          <dd
            className={cn(NUM, contato.urgencia === "vencido" ? "text-[var(--danger)]" : contato.urgencia === "hoje" ? "text-[var(--gated)]" : contato.urgencia === "sem_data" ? "text-[var(--danger)]" : "text-[var(--text-2)]")}
            title={item.proximoContatoEm ? dataHoraBr(item.proximoContatoEm) : undefined}
          >
            {contato.urgencia === "sem_data" ? "sem data" : `próximo contato ${contato.texto}`}{item.ultimoContatoEm ? <span className="text-[var(--text-faint)]"> · último {dataBr(item.ultimoContatoEm)}</span> : <span className="text-[var(--text-faint)]"> · nenhum contato ainda</span>}
          </dd>
          <dt className="flex items-center gap-1 text-[var(--text-faint)]"><PhoneCall className="h-3 w-3" aria-hidden /></dt>
          <dd className={cn(NUM, "flex items-center gap-1 truncate text-[var(--text-2)]")}>
            {cliente.telefone ?? TRACO}
            {whatsapp && !overlay && <LinkWhatsapp whatsapp={whatsapp} nome={cliente.nome}><MessageCircle className="h-3.5 w-3.5" aria-hidden /></LinkWhatsapp>}
          </dd>
        </dl>
      </div>

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
          {acoes.onEnviarParaChat && !item.chat && (
            <button type="button" className={cn(BOTAO_SECUNDARIO, "h-8 px-2.5 text-[11.5px]")} disabled={acoes.enviandoParaChat === item.id} title="Abre a conversa do cliente no WhatsApp do provedor com a mensagem da etapa" onClick={() => acoes.onEnviarParaChat?.(item)} data-testid={`card-enviar-chat-${item.id}`}>
              <MessageSquareShare className="h-3 w-3" aria-hidden /> {acoes.enviandoParaChat === item.id ? "Enviando…" : "Enviar p/ cobrança"}
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
