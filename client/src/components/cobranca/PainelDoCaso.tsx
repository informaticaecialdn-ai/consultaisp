/**
 * O painel do caso — o que o card do quadro deixou de carregar.
 *
 * Pedido do dono (06/09/2026): "quando clicar no card, mostrar um card na tela
 * com todas as informações da dívida, todos os boletos, e histórico da
 * cobrança… mostrar na tela". O card ficou com nome, documento e o valor
 * vencido; aqui vem o resto, em quatro blocos:
 *
 *   1. O QUE FAZER AGORA — o follow-up inteiro (próxima ação, dono, quando,
 *      último contato), a etapa da régua com a ação escrita, o canal sugerido
 *      e o telefone com WhatsApp.
 *   2. A DÍVIDA INTEIRA — quanto, desde quando, quantas faturas, a mais antiga
 *      e o valor na abertura do caso.
 *   3. TODOS OS BOLETOS — a tabela de `invoices` (migração 0027), fatura a
 *      fatura, com vencimento, valor, situação e a origem.
 *   4. O HISTÓRICO — os acordos com as parcelas e a linha do tempo do caso.
 *
 * A regra do dono manda em cada bloco: BLOCO AUSENTE ≠ BLOCO VAZIO. A rota
 * pode não mandar `faturas` (então a tela diz "—" e o motivo) ou mandar uma
 * lista vazia (então a tela diz que o ERP não devolveu fatura nenhuma). Em
 * nenhum dos dois casos aparece "R$ 0,00", que significaria "não deve nada".
 *
 * O molde é o `DrawerCaso` da recuperação de equipamentos: um `Sheet` à
 * direita, o item vindo do quadro mais recente (o pai o resolve pela chave, e
 * o painel nunca fica atrás do quadro) e a busca do detalhe por TanStack
 * Query. Fecha com Esc (o Radix cuida) e pelo botão "Fechar".
 */
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  CalendarClock, ClipboardList, FileText, Handshake, History, Hourglass,
  MessageCircle, MessageSquareShare, PhoneCall, Route, UserRound, Wallet,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { brl, Kicker, num, TRACO } from "@/components/localizacao/ui";
import { AvisoNaoCarregou, BOTAO_MARCA, BOTAO_SECUNDARIO, Td, Th, TabelaPainel } from "@/components/painel/ui";
import { ROTULO_CANAL, ROTULO_STATUS_DE_NEGOCIACAO, ROTULO_STATUS_DE_PARCELA, ROTULO_TIPO_DE_NEGOCIACAO, type Etapa, type StatusDeNegociacao, type StatusDeParcela, type TipoDeNegociacao } from "@shared/cobranca";
import {
  casoFechado, diasNoStatusDoCaso, etapaDoCard, MOTIVO_SEM_TEMPO_NA_COLUNA,
  resumoDoAcordo, textoDaFaixaDoDia, textoDoTempoNaColuna, TOM_DA_FAIXA_DO_DIA, vencimentoMaisAntigo,
  type AcoesDoCard,
} from "./CardCaso";
import { dataBr, dataCivilBr, dataHoraBr, hojeInput, proximoContato, whatsappDe } from "./formatacao";
import { LinhaDoTempo } from "./LinhaDoTempo";
import { acaoPrincipalDoCard, destinoDoBotaoDeAcordo, rotuloDoBotaoDeAcordo, tomDaEtapaDaRegua, tomDoTempoNaColuna, verboDaColuna } from "./movimentos-cobranca";
import {
  apiDetalheDoCaso, faturaEstaAberta, lerDetalheDoCaso,
  MOTIVO_BAIXADA_NO_ERP, MOTIVO_FATURA_ABERTA, MOTIVO_FATURA_PAGA,
  MOTIVO_NENHUMA_FATURA, MOTIVO_SEM_ACORDOS, MOTIVO_SEM_DIVIDA_DETALHADA,
  MOTIVO_SEM_FATURAS, MOTIVO_SEM_HISTORICO, ROTULO_STATUS_DE_FATURA,
  rotaDoCliente, rotuloDoStatusDeCaso,
  type FaturaDoCaso, type ItemDaFila, type NegociacaoDeCobranca,
} from "./tipos";
import {
  GRADE_LINHAS, Linha, LinkWhatsapp, mensagemDoErro, PilulaAtraso, SeloCarteira, SeloCobranca,
  SeloErp, SeloPrioridade, SeloQuadrante, SeloTom, Traco, useSkeletonAtrasado, type TomDeSelo,
} from "./ui";

const NUM = "font-mono tabular-nums";

/* ── Faturas: o que cada situação PODE afirmar ───────────────────────── */

export interface SituacaoDaFatura {
  rotulo: string;
  tom: TomDeSelo;
  titulo: string;
}

/** "AAAA-MM-DD" da fatura, sem `new Date` — a coluna é UTC e vira o dia anterior em Brasília. */
export function diaDaFatura(vencimento: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(vencimento ?? "");
  return m ? m[1] : null;
}

/**
 * A situação de uma fatura, dita com o que o dado permite:
 * — "vencida"/"a vencer" para o que continua PENDENTE no ERP;
 * — "baixada no ERP" para o que sumiu dos pendentes numa varredura completa
 *   (pagamento PROVÁVEL, sem confirmação de valor — nenhum ERP nos confirma);
 * — "paga" só para a baixa com valor confirmado, que hoje só o CSV produz.
 * Status desconhecido sai como veio, em tom neutro: nunca se chuta.
 */
export function situacaoDaFatura(f: FaturaDoCaso, hoje: Date): SituacaoDaFatura {
  const rotulo = ROTULO_STATUS_DE_FATURA[f.status] ?? (f.status || TRACO);
  if (f.status === "baixada_no_erp") {
    return {
      rotulo,
      tom: "info",
      titulo: f.baixadaEm ? `${MOTIVO_BAIXADA_NO_ERP} Sumiu dos pendentes em ${dataBr(f.baixadaEm)}.` : MOTIVO_BAIXADA_NO_ERP,
    };
  }
  if (f.status === "paid") return { rotulo, tom: "ok", titulo: MOTIVO_FATURA_PAGA };
  if (faturaEstaAberta(f.status)) {
    const dia = diaDaFatura(f.vencimento);
    if (dia === null) return { rotulo, tom: "gated", titulo: `${MOTIVO_FATURA_ABERTA} Sem data de vencimento no ERP.` };
    return dia < hojeInput(hoje)
      ? { rotulo: "vencida", tom: "danger", titulo: `${MOTIVO_FATURA_ABERTA} O vencimento já passou.` }
      : { rotulo: "a vencer", tom: "gated", titulo: `${MOTIVO_FATURA_ABERTA} Ainda não venceu.` };
  }
  return { rotulo, tom: "neutro", titulo: `Situação "${f.status}" como veio do ERP — a tela não a interpreta.` };
}

export interface ResumoDasFaturas {
  total: number;
  vencidas: number;
  aVencer: number;
  baixadas: number;
  pagas: number;
  /** A soma do que continua PENDENTE. `null` quando nenhuma fatura aberta tem valor. */
  somaAberta: number | null;
}

/** O rodapé da tabela: quantas de cada situação e quanto ainda está pendente. */
export function resumoDasFaturas(faturas: readonly FaturaDoCaso[], hoje: Date): ResumoDasFaturas {
  let vencidas = 0, aVencer = 0, baixadas = 0, pagas = 0;
  let soma = 0, comValor = 0;
  for (const f of faturas) {
    const s = situacaoDaFatura(f, hoje);
    if (s.rotulo === "vencida") vencidas += 1;
    else if (s.rotulo === "a vencer") aVencer += 1;
    if (f.status === "baixada_no_erp") baixadas += 1;
    if (f.status === "paid") pagas += 1;
    if (faturaEstaAberta(f.status) && f.valor !== null) { soma += f.valor; comValor += 1; }
  }
  return {
    total: faturas.length,
    vencidas,
    aVencer,
    baixadas,
    pagas,
    somaAberta: comValor > 0 ? Math.round(soma * 100) / 100 : null,
  };
}

/* ── Blocos ──────────────────────────────────────────────────────────── */

function Secao({ kicker, icone, acoes, children, testId }: {
  kicker: string; icone?: ReactNode; acoes?: ReactNode; children: ReactNode; testId?: string;
}) {
  return (
    <section className="border-b border-[var(--border)] px-5 py-4" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[var(--text-faint)]">{icone}<Kicker>{kicker}</Kicker></span>
        {acoes}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** A ausência de um BLOCO — diferente da ausência de conteúdo dentro dele. */
function BlocoAusente({ motivo, testId }: { motivo: string; testId?: string }) {
  return (
    <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[11.5px] leading-4 text-[var(--text-muted)]" title={motivo} data-testid={testId}>
      <Traco /> {motivo}
    </p>
  );
}

function TabelaDeFaturas({ faturas, hoje }: { faturas: readonly FaturaDoCaso[]; hoje: Date }) {
  const resumo = resumoDasFaturas(faturas, hoje);
  return (
    <>
      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <TabelaPainel testId="tabela-faturas">
          <thead>
            <tr>
              <Th>vencimento</Th>
              <Th>descrição</Th>
              <Th alinhamento="direita">valor</Th>
              <Th>situação</Th>
            </tr>
          </thead>
          <tbody>
            {faturas.map(f => {
              const s = situacaoDaFatura(f, hoje);
              const origem = [f.erpSource ? `origem ${f.erpSource}` : null, f.erpRef ? `nº ${f.erpRef} no ERP` : null].filter(Boolean).join(" · ");
              return (
                <tr key={f.id} data-testid={`fatura-${f.id}`}>
                  <Td num alinhamento="esquerda" title={origem || undefined}>{f.vencimento ? dataCivilBr(f.vencimento) : <Traco titulo="O ERP não devolveu o vencimento desta fatura." />}</Td>
                  <Td className="max-w-[180px] truncate" title={f.descricao ?? undefined}>{f.descricao ?? <Traco titulo="Sem descrição no ERP." />}</Td>
                  <Td num className={faturaEstaAberta(f.status) ? "text-[var(--money-neg)]" : undefined}>
                    {f.valor !== null ? brl(f.valor) : <Traco titulo="O ERP não devolveu o valor desta fatura." />}
                  </Td>
                  <Td><SeloCobranca tom={s.tom} titulo={s.titulo} className="normal-case tracking-normal">{s.rotulo}</SeloCobranca></Td>
                </tr>
              );
            })}
          </tbody>
        </TabelaPainel>
      </div>
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-muted)]" data-testid="faturas-resumo">
        <span><b className={cn(NUM, "font-medium text-[var(--text-2)]")}>{num(resumo.total)}</b> no total</span>
        <span><b className={cn(NUM, "font-medium text-[var(--danger)]")}>{num(resumo.vencidas)}</b> vencidas</span>
        <span><b className={cn(NUM, "font-medium text-[var(--text-2)]")}>{num(resumo.aVencer)}</b> a vencer</span>
        <span title={MOTIVO_BAIXADA_NO_ERP}><b className={cn(NUM, "font-medium text-[var(--info)]")}>{num(resumo.baixadas)}</b> baixadas no ERP</span>
        <span title="Soma das faturas que continuam pendentes no ERP. Fatura sem valor não entra — não vira zero.">
          pendente <b className={cn(NUM, "font-medium text-[var(--money-neg)]")}>{resumo.somaAberta !== null ? brl(resumo.somaAberta) : TRACO}</b>
        </span>
      </p>
      <p className="mt-1 text-[10.5px] leading-4 text-[var(--text-faint)]" data-testid="faturas-nota">
        {MOTIVO_BAIXADA_NO_ERP}
      </p>
    </>
  );
}

function CartaoDeAcordo({ n }: { n: NegociacaoDeCobranca }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5" data-testid={`acordo-${n.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-[var(--text)]">
          {ROTULO_TIPO_DE_NEGOCIACAO[n.tipo as TipoDeNegociacao] ?? n.tipo}
        </span>
        <SeloCobranca tom={n.status === "quebrada" ? "danger" : n.status === "cumprida" || n.status === "ativa" ? "ok" : n.status === "cancelada" ? "neutro" : "gated"}>
          {ROTULO_STATUS_DE_NEGOCIACAO[n.status as StatusDeNegociacao] ?? n.status}
        </SeloCobranca>
      </div>
      <p className={cn(NUM, "mt-1 text-[11.5px] text-[var(--text-2)]")}>
        {brl(n.valorOriginal)} → <b className="font-medium text-[var(--text)]">{brl(n.valorNegociado)}</b>
        {n.descontoPct > 0 ? <span className="text-[var(--ok)]"> · {n.descontoPct}% de desconto</span> : null}
        {n.entrada > 0 ? ` · entrada ${brl(n.entrada)}` : ""}
        {n.parcelas > 0 ? ` · ${n.parcelas}x${n.valorParcela !== null ? ` de ${brl(n.valorParcela)}` : ""}` : ""}
      </p>
      <p className="mt-0.5 text-[10.5px] text-[var(--text-faint)]">
        proposto em <span className={NUM}>{dataBr(n.createdAt)}</span>
        {n.aceitaEm ? <> · aceito em <span className={NUM}>{dataBr(n.aceitaEm)}</span></> : ""}
        {n.quebradaEm ? <> · quebrado em <span className={NUM}>{dataBr(n.quebradaEm)}</span></> : ""}
      </p>
      {n.parcelamento.length > 0 && (
        <ul className="mt-1.5 divide-y divide-[var(--border-faint)] rounded border border-[var(--border)] bg-[var(--surface)]">
          {n.parcelamento.map(p => (
            <li key={p.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11.5px]" data-testid={`parcela-${p.id}`}>
              <span className={cn(NUM, "text-[var(--text-2)]")}>{p.numero}/{n.parcelas} · vence {dataCivilBr(p.vencimento)}</span>
              <span className="flex items-center gap-2">
                <span className={cn(NUM, "text-[var(--text)]")}>{brl(p.valor)}</span>
                <SeloCobranca tom={p.status === "paga" ? "ok" : p.status === "atrasada" ? "danger" : p.status === "cancelada" ? "neutro" : "gated"}>
                  {ROTULO_STATUS_DE_PARCELA[p.status as StatusDeParcela] ?? p.status}
                </SeloCobranca>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── O painel ────────────────────────────────────────────────────────── */

export function PainelDoCaso({ item, etapas, hoje, aberto, onFechar, acoes }: {
  /** O caso, resolvido pelo pai no quadro mais recente — nunca uma cópia velha. */
  item: ItemDaFila | null;
  etapas: readonly Etapa[] | undefined;
  hoje: Date;
  aberto: boolean;
  onFechar: () => void;
  acoes: AcoesDoCard;
}) {
  const casoId = item?.id ?? null;
  const { data, isLoading, isError, error, refetch } = useQuery<unknown>({
    queryKey: [casoId === null ? "sem-caso" : apiDetalheDoCaso(casoId)],
    enabled: aberto && casoId !== null,
    staleTime: 15_000,
  });
  const detalhe = useMemo(() => (data === undefined ? null : lerDetalheDoCaso(data)), [data]);
  const pendente = aberto && casoId !== null && isLoading && !isError;
  // Skeleton só depois de 300 ms (DESIGN_SYSTEM §6); antes disso o bloco fica
  // vazio — e nunca com o texto "a rota não mandou", que seria mentira enquanto
  // a resposta está a caminho.
  const mostrarSkeleton = useSkeletonAtrasado(pendente);

  return (
    <Sheet open={aberto} onOpenChange={o => { if (!o) onFechar(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[640px]" data-testid="painel-do-caso">
        {item && (
          <ConteudoDoPainel
            item={item}
            etapas={etapas}
            hoje={hoje}
            acoes={acoes}
            onFechar={onFechar}
            detalhe={detalhe}
            pendente={pendente}
            carregando={mostrarSkeleton}
            erro={isError ? mensagemDoErro(error) : null}
            aoTentarDeNovo={() => refetch()}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ConteudoDoPainel({ item, etapas, hoje, acoes, onFechar, detalhe, pendente, carregando, erro, aoTentarDeNovo }: {
  item: ItemDaFila;
  etapas: readonly Etapa[] | undefined;
  hoje: Date;
  acoes: AcoesDoCard;
  onFechar: () => void;
  detalhe: ReturnType<typeof lerDetalheDoCaso> | null;
  /** A resposta ainda está a caminho: nada de "a rota não mandou" enquanto isto for true. */
  pendente: boolean;
  /** Passou dos 300 ms: mostre a FORMA do que vem. */
  carregando: boolean;
  erro: string | null;
  aoTentarDeNovo: () => void;
}) {
  const { cliente } = item;
  const { etapa, motivo, derivada } = etapaDoCard(item, etapas);
  const contato = proximoContato(item.proximoContatoEm, hoje);
  const whatsapp = whatsappDe(cliente.telefone);
  const fechado = casoFechado(item.status);
  const parado = item.proximoContatoEm === null && !fechado;
  const diasAqui = diasNoStatusDoCaso(item, hoje);
  const lugar = [cliente.bairro, cliente.cidade].filter(Boolean).join(" · ");

  // A dívida: o bloco da rota vence; sem ele, o agregado do sync que o quadro já traz.
  const divida = detalhe?.divida ?? null;
  const total = divida?.total ?? item.valorAtual;
  const diasAtraso = divida?.diasAtraso ?? cliente.diasAtraso;
  const faturasAbertas = divida?.faturasAbertas ?? cliente.faturasAbertas ?? null;
  const maisAntiga = divida?.vencimentoMaisAntigo ?? vencimentoMaisAntigo(diasAtraso, hoje)?.toISOString() ?? null;
  const acordoVivo = item.negociacao ?? null;

  const rotuloDoAcordo = rotuloDoBotaoDeAcordo(item.status);
  const acordoNaFicha = destinoDoBotaoDeAcordo(item.status) === "ficha";
  const ofereceAcordo = !fechado && rotuloDoAcordo !== null && (acordoNaFicha || acoes.onNegociar !== undefined);
  // O VERBO DA COLUNA (decisão de 06/09/2026, herdada do card): em "Negociando"
  // o trabalho é fechar o acordo, e destacar "Contato" mandaria o operador
  // repetir o que ele já fez. O contato continua ali, como secundário.
  const acordoEhPrincipal = ofereceAcordo && acaoPrincipalDoCard(item.status) === "acordo";
  const podePegar = item.responsavelUserId === null && acoes.onPegar !== undefined;

  return (
    <>
      <SheetHeader className="border-b border-[var(--border)] px-5 py-4 pr-12 text-left" data-testid="painel-identidade">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Kicker>caso #{item.id} · {rotuloDoStatusDeCaso(item.status)}</Kicker>
            <SheetTitle className="mt-1 text-[16px] font-medium leading-tight tracking-[var(--track-tight)] text-[var(--text)]">{cliente.nome}</SheetTitle>
            <SheetDescription className="mt-0.5 text-[12px] text-[var(--text-muted)]">
              <span
                className={NUM}
                title="CPF/CNPJ do cliente, como está no cadastro do ERP."
                data-testid="painel-documento"
              >
                {cliente.cpfCnpj || TRACO}
              </span>
              {lugar ? ` · ${lugar}` : ""}
            </SheetDescription>
          </div>
          <div className="flex-none text-right">
            <p className={cn(NUM, "text-[24px] font-light leading-none tracking-[-0.028em] text-[var(--money-neg)]")} data-testid="painel-valor">{brl(total)}</p>
            <p className="mt-1"><PilulaAtraso dias={diasAtraso} testId="painel-atraso" /></p>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <SeloErp status={cliente.statusErp} />
          <SeloCarteira carteira={item.carteira} />
          <SeloPrioridade prioridade={item.prioridade} />
          {!fechado && (
            <SeloCobranca tom={TOM_DA_FAIXA_DO_DIA[contato.urgencia]} className="normal-case tracking-normal" testId="painel-faixa-do-dia">
              <CalendarClock className="h-3 w-3" aria-hidden /> {textoDaFaixaDoDia(contato.urgencia, contato.texto)}
            </SeloCobranca>
          )}
          {!fechado && (
            <SeloCobranca
              tom={tomDoTempoNaColuna(diasAqui)}
              titulo={diasAqui === null ? MOTIVO_SEM_TEMPO_NA_COLUNA : `Tempo nesta coluna ("${rotuloDoStatusDeCaso(item.status)}").`}
              className="normal-case tracking-normal"
              testId="painel-tempo-na-coluna"
            >
              <Hourglass className="h-3 w-3" aria-hidden /> {textoDoTempoNaColuna(diasAqui)}
            </SeloCobranca>
          )}
          <SeloQuadrante quadrante={item.quadrante ?? item.quadranteDna} />
          <SeloTom tom={item.tomSugerido ?? item.tom} />
          {item.chat && (
            <a
              href={`/cobranca/chat?conversa=${encodeURIComponent(item.chat.conversationId)}&carteira=${item.carteira}`}
              className="inline-flex"
              title={`Conversa no chat · ${item.chat.status}`}
              data-testid="painel-chat"
            >
              <SeloCobranca tom="info" className="normal-case tracking-normal"><MessageSquareShare className="h-3 w-3" aria-hidden /> chat · {item.chat.status.toLowerCase()}</SeloCobranca>
            </a>
          )}
        </div>
      </SheetHeader>

      {/* AÇÕES — as que saíram do card, no alto para não exigir rolagem */}
      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-5 py-3" data-testid="painel-acoes">
        <button type="button" className={acordoEhPrincipal ? BOTAO_SECUNDARIO : BOTAO_MARCA} onClick={() => acoes.onContato(item)} data-testid="painel-contato">
          <PhoneCall className="h-3.5 w-3.5" aria-hidden /> Registrar contato
        </button>
        {ofereceAcordo && (acordoNaFicha ? (
          <Link
            href={rotaDoCliente(cliente.id, item.carteira)}
            className={acordoEhPrincipal ? BOTAO_MARCA : BOTAO_SECUNDARIO}
            title={`${verboDaColuna(item.status) ?? "registrar o aceite"} — o aceite se registra na ficha do cliente, sobre a proposta que já existe`}
            data-testid="painel-acordo"
          >
            <Handshake className="h-3.5 w-3.5" aria-hidden /> {rotuloDoAcordo}
          </Link>
        ) : (
          <button
            type="button"
            className={acordoEhPrincipal ? BOTAO_MARCA : BOTAO_SECUNDARIO}
            title={`O que tira o caso desta coluna: ${verboDaColuna(item.status) ?? "concluir"}`}
            onClick={() => acoes.onNegociar?.(item)}
            data-testid="painel-acordo"
          >
            <Handshake className="h-3.5 w-3.5" aria-hidden /> {rotuloDoAcordo}
          </button>
        ))}
        {podePegar && (
          <button type="button" className={BOTAO_SECUNDARIO} disabled={acoes.pegando} onClick={() => acoes.onPegar?.(item)} data-testid="painel-pegar">
            <UserRound className="h-3.5 w-3.5" aria-hidden /> Pegar
          </button>
        )}
        {acoes.onEnviarParaChat && !item.chat && (
          <button
            type="button"
            className={BOTAO_SECUNDARIO}
            disabled={acoes.enviandoParaChat === item.id}
            title="Abre a conversa do cliente no WhatsApp do provedor com a mensagem da etapa"
            onClick={() => acoes.onEnviarParaChat?.(item)}
            data-testid="painel-enviar-chat"
          >
            <MessageSquareShare className="h-3.5 w-3.5" aria-hidden /> {acoes.enviandoParaChat === item.id ? "Enviando…" : "Enviar p/ cobrança"}
          </button>
        )}
        <Link href={rotaDoCliente(cliente.id, item.carteira)} className={BOTAO_SECUNDARIO} data-testid="painel-360">360</Link>
        <button type="button" className={cn(BOTAO_SECUNDARIO, "ml-auto")} onClick={onFechar} data-testid="painel-fechar">Fechar</button>
      </div>

      {erro && (
        <div className="px-5 pt-4">
          <AvisoNaoCarregou aoTentarDeNovo={aoTentarDeNovo} testId="painel-erro">
            Não foi possível carregar o detalhe deste caso: {erro}. A identidade e o follow-up acima vêm do quadro; a dívida fatura a fatura e o histórico só aparecem com a rota respondendo.
          </AvisoNaoCarregou>
        </div>
      )}

      {/* 1. O QUE FAZER AGORA */}
      <Secao kicker="o que fazer agora" icone={<ClipboardList className="h-3.5 w-3.5" aria-hidden />} testId="painel-followup">
        <p
          className={cn("flex items-start gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] leading-4", parado ? "border-[var(--danger-border)] bg-[var(--danger-bg)]" : "border-[var(--border-faint)] bg-[var(--surface-2)]")}
          data-testid="painel-proxima-acao"
          data-parado={parado ? "true" : undefined}
        >
          {parado ? (
            <span className="font-medium text-[var(--danger)]">sem próxima ação — o caso está parado, e parado vira dívida perdida. Registre o contato e marque a data.</span>
          ) : item.proximaAcao ? (
            <span className="font-medium text-[var(--text)]">{item.proximaAcao}</span>
          ) : (
            <span className="text-[var(--text-2)]" title="A régua sugere; o operador confirma no próximo contato">{etapa ? `≈ ${etapa.acao}` : TRACO}</span>
          )}
        </p>
        <dl className={cn(GRADE_LINHAS, "mt-2")}>
          <Linha rotulo="responsável">{item.responsavelNome ?? <Traco titulo="Fila geral: ninguém puxou o caso." />}</Linha>
          <Linha rotulo="próximo contato" mono testId="painel-proximo-contato">
            {item.proximoContatoEm ? dataHoraBr(item.proximoContatoEm) : <Traco titulo="Sem data marcada: o caso está parado." />}
            <span className="text-[var(--text-faint)]"> · {textoDaFaixaDoDia(contato.urgencia, contato.texto)}</span>
          </Linha>
          <Linha rotulo="último contato" mono>{item.ultimoContatoEm ? dataBr(item.ultimoContatoEm) : <Traco titulo="Nenhum contato registrado ainda." />}</Linha>
          <Linha rotulo="telefone" mono>
            <span className="inline-flex items-center gap-1.5">
              {cliente.telefone ?? <Traco titulo="O ERP não devolveu telefone deste cliente." />}
              {whatsapp && <LinkWhatsapp whatsapp={whatsapp} nome={cliente.nome}><MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp</LinkWhatsapp>}
            </span>
          </Linha>
        </dl>
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="painel-etapa">
          {etapa ? (
            <SeloCobranca tom={tomDaEtapaDaRegua(etapa.id)} titulo={derivada ? "Etapa derivada do atraso: o motor ainda não a gravou no caso." : "Etapa da régua de cobrança"}>
              {etapa.rotulo}{derivada && <span aria-label="derivada do atraso"> ≈</span>}
            </SeloCobranca>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]" title={motivo ?? undefined}>{motivo ?? <Traco />}</span>
          )}
          {etapa && (
            <span className="text-[11px] text-[var(--text-muted)]" data-testid="painel-canal">
              canal sugerido <b className="font-medium text-[var(--text-2)]">{ROTULO_CANAL[etapa.canalSugerido]}</b>
            </span>
          )}
        </div>
        {etapa && (
          <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-4 text-[var(--text-2)]" data-testid="painel-acao-da-regua">
            <Route className="mt-0.5 h-3 w-3 flex-none text-[var(--text-faint)]" aria-hidden />
            <span>{etapa.acao}</span>
          </p>
        )}
      </Secao>

      {/* 2. A DÍVIDA INTEIRA */}
      <Secao kicker="a dívida" icone={<Wallet className="h-3.5 w-3.5" aria-hidden />} testId="painel-divida">
        <dl className={GRADE_LINHAS}>
          <Linha rotulo="deve hoje" mono testId="painel-divida-total"><span className="text-[var(--money-neg)]">{brl(total)}</span></Linha>
          <Linha rotulo="atraso" mono>{diasAtraso > 0 ? `${diasAtraso} dia${diasAtraso === 1 ? "" : "s"}` : <Traco titulo="Sem atraso registrado." />}</Linha>
          <Linha rotulo="faturas abertas" mono testId="painel-faturas-abertas">
            {faturasAbertas !== null ? num(faturasAbertas) : <Traco titulo="A rota não informou quantas faturas estão abertas." />}
          </Linha>
          <Linha rotulo="mais antiga" mono>
            {maisAntiga
              ? <span title={divida?.vencimentoMaisAntigo ? "Vencimento da fatura mais antiga, fatura a fatura." : "Derivado do agregado do sync: hoje menos os dias de atraso."}>{dataCivilBr(maisAntiga.slice(0, 10))}{divida?.vencimentoMaisAntigo ? "" : " ≈"}</span>
              : <Traco titulo="Sem atraso: não há fatura vencida." />}
          </Linha>
          <Linha rotulo="na abertura" mono>{brl(item.valorAbertura)} · {dataBr(item.abertoEm)}</Linha>
        </dl>
        {divida === null && <p className="mt-2 text-[10.5px] leading-4 text-[var(--text-faint)]" data-testid="painel-divida-motivo">{MOTIVO_SEM_DIVIDA_DETALHADA}</p>}
        {divida?.motivo && <p className="mt-2 text-[10.5px] leading-4 text-[var(--text-faint)]">{divida.motivo}</p>}
        {acordoVivo && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-[var(--ok-border)] bg-[var(--ok-bg)] px-3 py-2 text-[11.5px] leading-4 text-[var(--text-2)]" data-testid="painel-acordo-vivo">
            <Handshake className="mt-0.5 h-3 w-3 flex-none text-[var(--ok)]" aria-hidden />
            <span>
              <b className="text-[var(--text)]">{ROTULO_TIPO_DE_NEGOCIACAO[acordoVivo.tipo as TipoDeNegociacao] ?? acordoVivo.tipo}</b>
              <span className="text-[var(--text-muted)]"> · {ROTULO_STATUS_DE_NEGOCIACAO[acordoVivo.status as StatusDeNegociacao] ?? acordoVivo.status}</span>
              <br /><span className={NUM}>{resumoDoAcordo(acordoVivo)}</span>
            </span>
          </p>
        )}
      </Secao>

      {/* 3. TODOS OS BOLETOS */}
      <Secao kicker="todos os boletos" icone={<FileText className="h-3.5 w-3.5" aria-hidden />} testId="painel-faturas">
        {pendente ? (
          carregando ? <div className="space-y-2" aria-busy><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div> : <div className="h-9" aria-hidden />
        ) : detalhe === null || detalhe.faturas === null ? (
          <BlocoAusente motivo={MOTIVO_SEM_FATURAS} testId="painel-faturas-ausente" />
        ) : detalhe.faturas.length === 0 ? (
          <BlocoAusente motivo={MOTIVO_NENHUMA_FATURA} testId="painel-faturas-vazio" />
        ) : (
          <TabelaDeFaturas faturas={detalhe.faturas} hoje={hoje} />
        )}
      </Secao>

      {/* 4a. OS ACORDOS */}
      <Secao kicker="acordos" icone={<Handshake className="h-3.5 w-3.5" aria-hidden />} testId="painel-acordos">
        {pendente ? (
          carregando ? <div className="space-y-2" aria-busy><Skeleton className="h-16" /></div> : <div className="h-9" aria-hidden />
        ) : detalhe === null || detalhe.negociacoes === null ? (
          <BlocoAusente motivo={MOTIVO_SEM_ACORDOS} testId="painel-acordos-ausente" />
        ) : detalhe.negociacoes.length === 0 ? (
          <p className="text-[11.5px] text-[var(--text-muted)]" data-testid="painel-acordos-vazio">Nenhum acordo proposto neste caso.</p>
        ) : (
          <div className="space-y-2">{detalhe.negociacoes.map(n => <CartaoDeAcordo key={n.id} n={n} />)}</div>
        )}
      </Secao>

      {/* 4b. O HISTÓRICO DA COBRANÇA */}
      <Secao kicker="histórico da cobrança" icone={<History className="h-3.5 w-3.5" aria-hidden />} testId="painel-historico">
        {pendente ? (
          <LinhaDoTempo eventos={[]} carregando testId="painel-linha-do-tempo" />
        ) : detalhe === null || detalhe.eventos === null ? (
          <BlocoAusente motivo={MOTIVO_SEM_HISTORICO} testId="painel-historico-ausente" />
        ) : (
          <LinhaDoTempo eventos={detalhe.eventos} testId="painel-linha-do-tempo" />
        )}
      </Secao>
    </>
  );
}
