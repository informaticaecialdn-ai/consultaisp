/**
 * O card de um caso de cobrança no quadro — enxuto, para escanear a coluna.
 *
 * Pedido do dono (06/09/2026, com o print de um card de vinte linhas): "o card
 * está muito grande… simplificar o card com o nome do cliente, CPF e dados dos
 * valores vencidos. Quando clicar no card, mostrar um card na tela com todas as
 * informações da dívida, todos os boletos, e histórico da cobrança".
 *
 * Então o card diz QUATRO coisas e nada mais:
 *   1. o NOME do cliente;
 *   2. o DOCUMENTO por extenso — decisão do dono (06/09/2026): a carteira é do
 *      provedor, e o operador confere identidade ao telefone por ele. O que
 *      continua mascarado é o cliente de OUTRO provedor, no bureau;
 *   3. o VALOR VENCIDO com o ATRASO (D+N e a faixa);
 *   4. a FAIXA DO DIA, que é a ordem em que a coluna vem do servidor — sem ela
 *      o operador não sabe por que aquele card está na frente. Quando o caso
 *      está PARADO (vivo e sem data de próximo contato) a mesma faixa diz "sem
 *      próxima ação", que é o que aquilo significa: dois selos para o mesmo
 *      sinal seriam a parede de volta.
 * Mais um botão de ação rápida: Contato.
 *
 * TUDO O MAIS FOI PARA O PAINEL (`PainelDoCaso.tsx`), que abre no clique: a
 * ação da régua escrita, o canal sugerido, o follow-up inteiro, o acordo e as
 * parcelas, o telefone, a situação no ERP, o tempo na coluna, a conversa do
 * chat e os botões secundários. Nada foi apagado — mudou de lugar.
 *
 * ARRASTAR ≠ ABRIR. A alça de arrasto é só o ícone (`setActivatorNodeRef`); o
 * corpo do card é um `role="button"` com Enter, Espaço e anel de foco. Antes a
 * alça era o bloco de identidade inteiro, e transformá-lo em botão faria um
 * arrasto virar um clique.
 */
import type { KeyboardEvent } from "react";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical, Handshake, MessageSquareShare, PhoneCall, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { brl, TRACO } from "@/components/localizacao/ui";
import { BOTAO_SECUNDARIO, FOCO } from "@/components/painel/ui";
import { etapaParaAtraso, etapaPorId, ROTULO_MOTIVO_SEM_ETAPA, type Carteira, type Etapa, type EtapaId, type MotivoSemEtapa } from "@shared/cobranca";
import { dataCivilBr, proximoContato, type UrgenciaDoContato } from "./formatacao";
import { COR_DO_TOM, tomDaColunaDoKanban } from "./movimentos-cobranca";
import type { ItemDaFila, NegociacaoResumo } from "./tipos";
import { PilulaAtraso, SeloCobranca, type TomDeSelo } from "./ui";

export interface EtapaDoCard {
  etapa: Etapa | null;
  motivo: string | null;
  /** true quando a régua foi calculada aqui, porque o motor ainda não gravou a etapa no caso. */
  derivada: boolean;
}

/**
 * A etapa que o caso tem hoje: a que a ROTA decidiu; senão a gravada no caso;
 * e só em último caso a que a régua daria pelo atraso — dizendo que derivou.
 * O CARD não a mostra mais (foi para o painel), mas a página do quadro a usa
 * para o diálogo de contato e para a mensagem do chat, e o painel a exibe.
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

const DIA_MS = 86_400_000;
const inicioDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Os status em que o caso já saiu da esteira: nada de faixa do dia nem de ação. */
export const STATUS_FECHADOS = ["pago", "cancelamento", "baixado", "encerrado"] as const;

export function casoFechado(status: string): boolean {
  return (STATUS_FECHADOS as readonly string[]).includes(status);
}

export const MOTIVO_SEM_TEMPO_NA_COLUNA =
  "Tempo na coluna: o servidor ainda não informa desde quando o caso está neste status — a medição começa agora. `updatedAt` não serve: muda por qualquer motivo.";

/**
 * Há quantos dias o caso está NESTA coluna. Prefere o número que a rota
 * contou; sem ele, deriva de `statusDesde`; sem os dois, `null` — e a tela
 * mostra "—" com o motivo, nunca zero (zero é "chegou hoje", e é outra coisa).
 *
 * Data no futuro (relógio do servidor à frente) vira 0, não negativo.
 *
 * Mora aqui desde que o selo era do card; hoje quem o mostra é o painel.
 */
export function diasNoStatusDoCaso(
  caso: { diasNoStatus?: number | null; statusDesde?: string | null },
  hoje: Date,
): number | null {
  if (typeof caso.diasNoStatus === "number" && Number.isFinite(caso.diasNoStatus)) {
    return Math.max(0, Math.trunc(caso.diasNoStatus));
  }
  if (!caso.statusDesde) return null;
  const desde = new Date(caso.statusDesde);
  if (Number.isNaN(desde.getTime())) return null;
  return Math.max(0, Math.round((inicioDoDia(hoje) - inicioDoDia(desde)) / DIA_MS));
}

/** "há 3 dias aqui" · "chegou hoje" — o texto do selo de tempo na coluna. */
export function textoDoTempoNaColuna(dias: number | null): string {
  if (dias === null) return TRACO;
  if (dias === 0) return "chegou hoje";
  return `há ${dias} ${dias === 1 ? "dia" : "dias"} aqui`;
}

/** A data em que a fatura mais antiga venceu: hoje menos os dias de atraso — o agregado do sync. */
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
  if (n.proximaParcela) partes.push(`${n.proximaParcela.numero === 0 ? "entrada" : "próxima"} ${dataCivilBr(n.proximaParcela.vencimento)}${n.proximaParcela.atrasada ? " (atrasada)" : ""}`);
  return partes.join(" · ");
}

/**
 * A FAIXA DO DIA no card, que é a mesma ordem em que a coluna vem do servidor:
 * contato vencido, de hoje, sem data (o caso parado) e por fim os agendados.
 *
 * "Sem data" é vermelho como "vencido" de propósito: caso vivo sem próximo
 * contato está parado, e parado vira dívida perdida.
 */
export const TOM_DA_FAIXA_DO_DIA: Record<UrgenciaDoContato, TomDeSelo> = {
  vencido: "danger",
  hoje: "gated",
  sem_data: "danger",
  futuro: "neutro",
};

const TITULO_DA_FAIXA_DO_DIA: Record<UrgenciaDoContato, string> = {
  vencido: "Contato vencido: passou da data marcada. A coluna traz estes primeiro, do mais antigo para o mais novo.",
  hoje: "Contato marcado para hoje.",
  sem_data: "Caso sem próxima ação marcada: está parado, e parado vira dívida perdida. Abra o caso e defina a data no próximo contato.",
  futuro: "Contato agendado: vem depois do que está vencido, de hoje e do que está parado.",
};

/**
 * O texto da faixa. Caso PARADO (sem data de próximo contato) lê "sem próxima
 * ação" e não "sem data": as duas frases descrevem o mesmo campo vazio, e o
 * card só tem espaço para a que diz o que fazer.
 */
export function textoDaFaixaDoDia(urgencia: UrgenciaDoContato, texto: string): string {
  return urgencia === "sem_data" ? "sem próxima ação" : texto;
}

export interface AcoesDoCard {
  /** Clicar no card: abre o painel com a dívida inteira, os boletos e o histórico. */
  onAbrir?: (item: ItemDaFila) => void;
  onContato: (item: ItemDaFila) => void;
  onPegar?: (item: ItemDaFila) => void;
  pegando?: boolean;
  /** "Enviar p/ cobranca": abre a conversa do cliente no Chat BullQ com a mensagem da regua. So aparece com o chat pronto. */
  onEnviarParaChat?: (item: ItemDaFila) => void;
  /** O caso cujo envio esta em curso (desabilita so o botao dele). */
  enviandoParaChat?: number | null;
  /** O inbox do chat, para o selo "conversa" abrir a conversa la. */
  inboxUrl?: string | null;
  /**
   * O verbo da coluna: em contato se PROPÕE o acordo, negociando se REGISTRA o
   * aceite. Sem ele o painel não oferece acordo — nenhum botão promete o que a
   * tela não sabe abrir.
   */
  onNegociar?: (item: ItemDaFila) => void;
}

export function chaveDoCard(item: ItemDaFila): string {
  return `caso-${item.id}`;
}

/**
 * A AÇÃO RÁPIDA de cada posto (handoff de design, 07/09/2026): o botão do card
 * é o verbo da coluna, e não o mesmo "Contato" em toda parte.
 *
 * `acordo_ativo` é o único que não age no card: dar baixa numa parcela exige
 * saber QUAL parcela, e o card não as carrega. O botão abre o caso, que é onde
 * as parcelas estão — e o `title` diz isso antes do clique, em vez de prometer
 * uma baixa que não acontece ali.
 */
export type AcaoRapida = "contato" | "propor" | "aceite" | "parcelas";

export const ACAO_RAPIDA_DA_COLUNA: Record<string, AcaoRapida> = {
  aberto: "contato",
  em_contato: "propor",
  negociando: "aceite",
  acordo_ativo: "parcelas",
};

export const ROTULO_DA_ACAO_RAPIDA: Record<AcaoRapida, { rotulo: string; titulo: string }> = {
  contato: { rotulo: "Contato", titulo: "Registrar um contato com o cliente e marcar a próxima ação" },
  propor: { rotulo: "Propor", titulo: "Propor um acordo dentro do que a política autoriza" },
  aceite: { rotulo: "Aceite", titulo: "Registrar que o cliente aceitou o acordo" },
  parcelas: { rotulo: "Parcelas", titulo: "Abrir o caso para ver as parcelas do acordo — a baixa é feita na ficha do cliente" },
};

export function acaoRapidaDoCaso(status: string): AcaoRapida {
  return ACAO_RAPIDA_DA_COLUNA[status] ?? "contato";
}

/** A ETAPA e o PASSO do poço. `passo`: o follow-up escrito vence a ação da régua. */
export function passoDoCaso(item: ItemDaFila, etapa: Etapa | null): string | null {
  const escrito = item.proximaAcao?.trim();
  if (escrito) return escrito;
  return etapa?.acao?.trim() || null;
}

export const MOTIVO_SEM_PASSO_NO_CARD =
  "Sem próxima ação: nem o caso tem follow-up escrito, nem a etapa da régua traz a ação. Caso parado vira dívida perdida.";

/** A tela de atendimento da cobranca: abre uma conversa por `?conversa=` e um caso por `?caso=`. */
const ROTA_CHAT_COBRANCA = "/cobranca/chat";

/**
 * Para onde o botao de conversa leva. SEMPRE leva a algum lugar.
 *
 * Pedido do dono (06/09/2026, com o print do card): "a conversa nao esta
 * ativa". Estava mesmo: quando o provedor ainda nao tinha numero de WhatsApp
 * ligado, o botao virava um texto cinza inerte — e em producao NENHUM provedor
 * tem (a integracao esta 'provisionado', sem canal). Um botao que nao vai a
 * lugar nenhum nao explica nada; a tela de conversas explica.
 *
 * Com conversa aberta, vai para ela. Sem conversa, leva o CASO para a tela de
 * conversas, que oferece iniciar — e, se o WhatsApp nao estiver conectado, diz
 * exatamente isso e onde conectar. Navegar sempre da certo; e a mensagem que
 * depende do canal.
 */
export function rotaDaConversaDoCaso(item: ItemDaFila): string {
  const p = new URLSearchParams();
  if (item.chat) p.set("conversa", item.chat.conversationId);
  else p.set("caso", String(item.id));
  p.set("carteira", item.carteira);
  return `${ROTA_CHAT_COBRANCA}?${p}`;
}

const NUM = "font-mono tabular-nums";

const TITULO_DO_DOCUMENTO =
  "CPF/CNPJ do cliente, como está no cadastro do ERP. A carteira é do provedor: o documento sai por extenso para conferir identidade, achar o cliente no ERP e emitir segunda via.";

export function CardCaso({ item, hoje, acoes, ocupado, overlay, alca, etapas }: {
  item: ItemDaFila;
  hoje: Date;
  acoes: AcoesDoCard;
  /** As etapas da régua, para o poço dizer em que ponto o caso está. */
  etapas?: readonly Etapa[];
  ocupado?: boolean;
  /** Renderizado dentro do DragOverlay: sem alça, sem clique e sem botão. */
  overlay?: boolean;
  alca?: { ref: (el: HTMLElement | null) => void; listeners: Record<string, unknown> | undefined; atributos: Record<string, unknown> };
}) {
  const { cliente } = item;
  const contato = proximoContato(item.proximoContatoEm, hoje);
  const fechado = casoFechado(item.status);
  // A faixa de 3px no tom da COLUNA: no quadro ela agrupa; arrastado, o card
  // leva a cor de onde veio, e o operador sabe o que está movendo.
  const tomDaColuna = COR_DO_TOM[tomDaColunaDoKanban(item.status)];
  const { etapa, motivo: motivoDaEtapa } = etapaDoCard(item, etapas);
  const passo = passoDoCaso(item, etapa);
  const acao = ROTULO_DA_ACAO_RAPIDA[acaoRapidaDoCaso(item.status)];
  const abrir = !overlay && acoes.onAbrir ? () => acoes.onAbrir?.(item) : null;

  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 pb-2 pt-2.5 text-[12px]",
        overlay && "shadow-[0_0_0_1px_var(--brand),0_12px_32px_-14px_rgba(20,19,26,.35)]",
        ocupado && "opacity-60",
      )}
      style={{ borderLeft: `3px solid ${tomDaColuna}` }}
      data-testid={`card-caso-${item.id}`}
    >
      <div className="flex items-start gap-1.5">
        {/* A ALÇA é só o ícone: arrastar daqui, clicar no resto. */}
        {alca && (
          <span
            ref={alca.ref}
            {...(alca.listeners ?? {})}
            {...(alca.atributos ?? {})}
            className={cn(
              "flex flex-none items-start justify-center rounded pt-[3px] text-[var(--text-faint)] hover:text-[var(--text-muted)]",
              // No dedo a alça precisa ser um alvo de verdade (DESIGN_SYSTEM §7:
              // 44×44). No mouse ela fica estreita, para não roubar largura da
              // coluna — o ponteiro fino acerta 18px sem esforço.
              "min-h-[24px] w-[18px] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:items-center",
              "cursor-grab active:cursor-grabbing",
              FOCO,
            )}
            aria-label={`Arrastar o caso de ${cliente.nome} para outra coluna`}
            title="Arraste por aqui para mudar o caso de coluna"
            data-testid={`card-alca-${item.id}`}
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}

        {/* O CORPO abre o painel: clique, Enter ou Espaço. */}
        <div
          className={cn("min-w-0 flex-1 rounded", abrir && "cursor-pointer", FOCO)}
          {...(abrir
            ? {
                role: "button",
                tabIndex: 0,
                onClick: abrir,
                onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  // Espaço rolaria a coluna; Enter dispararia o form de cima.
                  e.preventDefault();
                  abrir();
                },
                "aria-label": `Abrir o caso de ${cliente.nome} · ${brl(item.valorAtual)} · ${cliente.diasAtraso} dias de atraso`,
              }
            : {})}
          data-testid={`card-abrir-${item.id}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className="truncate text-[12.5px] font-semibold leading-[1.25] text-[var(--text)]"
                title={cliente.nome}
                data-testid={`card-nome-${item.id}`}
              >
                {cliente.nome}
              </p>
              <p className={cn(NUM, "mt-px truncate text-[10.5px] text-[var(--text-muted)]")} title={TITULO_DO_DOCUMENTO} data-testid={`card-documento-${item.id}`}>
                {cliente.cpfCnpj || TRACO}
              </p>
            </div>
            <div className="flex-none text-right" data-testid={`card-divida-${item.id}`}>
              <p className={cn(NUM, "text-[15px] font-semibold leading-none text-[var(--money-neg)]")}>{brl(item.valorAtual)}</p>
              <p className="mt-1"><PilulaAtraso dias={cliente.diasAtraso} /></p>
            </div>
          </div>

          {/*
            A ETAPA da régua, em uma linha (pedido do dono, 07/09/2026:
            "deixar só etapa").

            O poço nasceu com duas linhas — etapa e passo —, e o PASSO estourou o
            card: a ação da régua é um parágrafo inteiro ("Notificar formalmente
            que o serviço será suspenso e registrar a data da notificação. A
            suspensão só pode acontecer 15 dias depois de o aviso ser entregue"),
            e ela é a MESMA para todos os casos da etapa. Repetida em cada card,
            empurrava o resto para fora da tela e não distinguia caso nenhum.

            A etapa sozinha responde o que o operador pergunta ao escanear a
            coluna: em que ponto da régua este caso está. O passo por extenso
            continua no painel, que abre no clique e tem espaço para ele.
          */}
          {!fechado && (
            <dl className="mt-2 flex items-baseline gap-2 overflow-hidden rounded-md border border-[var(--border-faint)] bg-[var(--surface-2)] px-2.5 py-1.5" data-testid={`card-poco-${item.id}`}>
              <dt className={cn(NUM, "flex-none text-[9.5px] font-semibold uppercase leading-[1.4] tracking-[var(--track-wide)] text-[var(--text-faint)]")}>etapa</dt>
              <dd
                className="m-0 min-w-0 flex-1 truncate text-[11.5px] leading-[1.4] text-[var(--text-2)]"
                // O passo por extenso vive no title: quem quiser a ação inteira
                // passa o mouse, e quem só escaneia a coluna não paga por ela.
                title={passo ? `${etapa?.rotulo ?? motivoDaEtapa ?? "Etapa"} — ${passo}` : etapa?.rotulo ?? motivoDaEtapa ?? MOTIVO_SEM_PASSO_NO_CARD}
                data-testid={`card-etapa-${item.id}`}
              >
                {etapa?.rotulo ?? motivoDaEtapa ?? TRACO}
              </dd>
            </dl>
          )}

        </div>
      </div>

      {/*
        As ações rápidas ficam FORA do corpo clicável: clicar nelas não pode
        abrir o painel.

        A da conversa é pedido do dono (06/09/2026): "o card precisa ter botão
        para ir para a conversa" e, no dia seguinte, "a conversa não está
        ativa". Agora ela SEMPRE navega — ver `rotaDaConversaDoCaso`.

        O SELO E OS BOTÕES EM LINHAS SEPARADAS (pedido do dono, 07/09/2026:
        "arrumar o card que está cortando"). Na mesma linha, o selo da faixa do
        dia mais dois botões passavam dos 296px da coluna e o segundo botão saía
        cortado pela borda — botão pela metade não se clica e nem se lê. Duas
        linhas, com os botões numa grade de dois, é o rodapé que a versão
        anterior já tinha e que cabe em qualquer largura de rótulo.
      */}
      {!overlay && (
        <div className="mt-2 flex flex-col gap-1.5">
          {!fechado && (
            <SeloCobranca
              tom={TOM_DA_FAIXA_DO_DIA[contato.urgencia]}
              titulo={TITULO_DA_FAIXA_DO_DIA[contato.urgencia]}
              className="w-fit normal-case tracking-normal"
              testId={`card-faixa-do-dia-${item.id}`}
            >
              {textoDaFaixaDoDia(contato.urgencia, contato.texto)}
            </SeloCobranca>
          )}
          <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className={cn(BOTAO_SECUNDARIO, "h-7 min-w-0 px-2 text-[11.5px]")}
            title={acao.titulo}
            onClick={() => {
              const qual = acaoRapidaDoCaso(item.status);
              if (qual === "contato") return acoes.onContato(item);
              if (qual === "parcelas") return acoes.onAbrir?.(item) ?? acoes.onContato(item);
              // propor e aceite são o mesmo diálogo; o verbo muda com a coluna.
              return acoes.onNegociar?.(item) ?? acoes.onContato(item);
            }}
            data-testid={`card-contato-${item.id}`}
          >
            {acaoRapidaDoCaso(item.status) === "contato" ? <PhoneCall className="h-3.5 w-3.5 flex-none" aria-hidden />
              : acaoRapidaDoCaso(item.status) === "parcelas" ? <Wallet className="h-3.5 w-3.5 flex-none" aria-hidden />
              : <Handshake className="h-3.5 w-3.5 flex-none" aria-hidden />}
            <span className="truncate">{acao.rotulo}</span>
          </button>
          <a
            href={rotaDaConversaDoCaso(item)}
            className={cn(BOTAO_SECUNDARIO, "h-7 min-w-0 px-2 text-[11.5px]")}
            title={item.chat
              ? `Abrir a conversa deste cliente · ${item.chat.status.toLowerCase()}`
              : "Ainda não há conversa com este cliente. Abre a tela de conversas com o caso pronto para iniciar."}
            data-testid={`card-conversa-${item.id}`}
          >
            <MessageSquareShare className="h-3.5 w-3.5 flex-none" aria-hidden /> <span className="truncate">Conversa</span>
          </a>
          </div>
        </div>
      )}
    </div>
  );
}

export function CardCasoArrastavel({ item, hoje, acoes, ocupado, etapas }: {
  item: ItemDaFila; hoje: Date; acoes: AcoesDoCard; ocupado?: boolean; etapas?: readonly Etapa[];
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
        hoje={hoje}
        acoes={acoes}
        ocupado={ocupado}
        etapas={etapas}
        alca={{ ref: setActivatorNodeRef, listeners: listeners as Record<string, unknown> | undefined, atributos: attributes as unknown as Record<string, unknown> }}
      />
    </article>
  );
}
