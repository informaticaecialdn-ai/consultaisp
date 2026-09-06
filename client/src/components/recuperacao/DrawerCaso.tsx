/**
 * Drawer de detalhes do card — equipamento, cliente, caso editável e a
 * linha do tempo de eventos.
 *
 * O card é passado pelo pai a partir do board mais recente (pela chave), então
 * o que está aqui nunca fica atrás do kanban: salvou, invalidou, o drawer
 * redesenha com o dado do servidor. O único estado local é o formulário.
 *
 * Contestação só se marca aqui, com motivo: a rota recusa `contestado` sem
 * `disputeReason`, e um select inline no card não teria onde pedir o texto.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ChatDaRecuperacao } from "@/components/chat/ChatDaRecuperacao";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClock, History, MessageCircle, PackageCheck, PackageX, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { brl, MONO, TRACO } from "@/components/localizacao/ui";
import { Kicker } from "@/components/consulta/report-ui";
import { COR_FAIXA, nomeDoEquipamento, OPCOES_PRIORIDADE, Selo } from "./CardEquipamento";
import { dataBr, dataHoraBr } from "./datas";
import { invalidarTudoDoCaso, mensagemDoErro } from "./DialogoContato";
import { ehColunaEncerrada, faixaDosDias, textoPrazo } from "./movimentos";
import {
  ETAPAS_ABERTAS, ROTULO_CANAL, ROTULO_COLUNA, ROTULO_ETAPA, ROTULO_METODO, ROTULO_PRIORIDADE,
  ROTULO_RESULTADO, ROTULO_STATUS_EQUIPAMENTO, type CardKanban, type EventoCaso, type Responsavel,
} from "./tipos";

interface DrawerCasoProps {
  card: CardKanban | null;
  aberto: boolean;
  onFechar: () => void;
  responsaveis: Responsavel[];
  onContato: (card: CardKanban) => void;
  onAgendar: (card: CardKanban) => void;
  onConcluir: (card: CardKanban) => void;
  onBaixar: (card: CardKanban) => void;
  onAbrirCaso: (card: CardKanban) => void;
}

function Linha({ rotulo, children, mono }: { rotulo: string; children: ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-[11px] text-[var(--text-faint)]">{rotulo}</dt>
      <dd className="min-w-0 truncate text-[12px] text-[var(--text-2)]" style={mono ? MONO : undefined}>{children}</dd>
    </>
  );
}

function descreverEvento(evento: EventoCaso): string {
  if (evento.type === "tentativa") {
    return `${ROTULO_CANAL[evento.channel ?? ""] ?? evento.channel ?? "contato"}: ${ROTULO_RESULTADO[evento.result ?? ""] ?? evento.result ?? ""}`;
  }
  if (evento.type === "status_alterado") {
    return `${ROTULO_ETAPA[evento.fromStatus ?? ""] ?? evento.fromStatus ?? "—"} → ${ROTULO_ETAPA[evento.toStatus ?? ""] ?? evento.toStatus ?? "—"}`;
  }
  return evento.type.replaceAll("_", " ");
}

export function DrawerCaso({ card, aberto, onFechar, responsaveis, onContato, onAgendar, onConcluir, onBaixar, onAbrirCaso }: DrawerCasoProps) {
  const { toast } = useToast();
  const caso = card?.caso ?? null;
  const caseId = card?.caseId ?? null;
  const encerrado = card ? ehColunaEncerrada(card.coluna) : false;

  const [form, setForm] = useState({ status: "", priority: "", assignedToUserId: "", disputeReason: "", notes: "" });

  useEffect(() => {
    if (!caso) return;
    setForm({
      status: caso.status,
      priority: caso.prioridade,
      assignedToUserId: caso.responsavel ? String(caso.responsavel.id) : "",
      disputeReason: "",
      notes: caso.notas ?? "",
    });
    // Só quando troca de caso: o refetch do board não pode apagar o que o operador está digitando.
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: eventos = [], isLoading: carregandoEventos } = useQuery<EventoCaso[]>({
    queryKey: [`/api/equipment/recovery-cases/${caseId}/events`],
    enabled: aberto && caseId !== null,
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!caseId || !caso) throw new Error("Este equipamento ainda não tem caso aberto");
      const payload: Record<string, unknown> = {};
      if (form.status !== caso.status) payload.status = form.status;
      if (form.priority !== caso.prioridade) payload.priority = form.priority;
      const responsavelAtual = caso.responsavel ? String(caso.responsavel.id) : "";
      if (form.assignedToUserId !== responsavelAtual) payload.assignedToUserId = form.assignedToUserId ? Number(form.assignedToUserId) : null;
      if (form.notes.trim() !== (caso.notas ?? "")) payload.notes = form.notes.trim();
      if (form.status === "contestado" && caso.status !== "contestado") payload.disputeReason = form.disputeReason.trim();
      if (Object.keys(payload).length === 0) throw new Error("Nada mudou para salvar");
      const response = await apiRequest("PATCH", `/api/equipment/recovery-cases/${caseId}`, payload);
      return response.json();
    },
    onSuccess: () => {
      invalidarTudoDoCaso(caseId);
      toast({ title: "Caso atualizado" });
    },
    onError: (error: Error) => toast({ title: "Não foi possível salvar", description: mensagemDoErro(error), variant: "destructive" }),
  });

  const contestando = form.status === "contestado" && caso?.status !== "contestado";
  const faixa = caso ? faixaDosDias(caso.diasRetido) : null;

  return (
    <Sheet open={aberto} onOpenChange={open => { if (!open) onFechar(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[600px]">
        {card && (
          <>
            <SheetHeader className="border-b border-[var(--border)] px-5 py-4 pr-12 text-left">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Kicker>{caseId ? `caso #${caseId}` : "sem caso aberto"} · {ROTULO_COLUNA[card.coluna]}</Kicker>
                  <SheetTitle className="mt-1 truncate text-[16px] font-medium tracking-[-0.02em] text-[var(--text)]">{nomeDoEquipamento(card)}</SheetTitle>
                  <SheetDescription className="mt-0.5 text-[12px] text-[var(--text-muted)]">{card.cliente.nome} · <span style={MONO}>{card.cliente.documento}</span></SheetDescription>
                </div>
                {caso && faixa && (
                  <div className="flex-none text-right">
                    <p className="text-[28px] font-light leading-none tracking-[-0.028em]" style={{ ...MONO, color: encerrado ? "var(--text-muted)" : COR_FAIXA[faixa] }}>{caso.diasRetido}</p>
                    <p className="mt-0.5 text-[9px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]" style={MONO}>dias retido</p>
                    {!encerrado && <p className="mt-1 text-[10px]" style={{ ...MONO, color: caso.diasRestantes <= 10 ? "var(--danger)" : "var(--text-muted)" }}>{textoPrazo(caso.diasRestantes)}</p>}
                  </div>
                )}
              </div>
              {caso && (caso.contestadoEm || caso.bureauStatus === "ativo_validado" || caso.bureauStatus === "contestado_bloqueado") && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {caso.contestadoEm && <Selo tom="past"><ShieldAlert className="h-3 w-3" aria-hidden /> contestado em {dataBr(caso.contestadoEm)}</Selo>}
                  {caso.bureauStatus === "ativo_validado" && <Selo tom="ok"><ShieldCheck className="h-3 w-3" aria-hidden /> sinal validado no bureau</Selo>}
                  {caso.bureauStatus === "contestado_bloqueado" && <Selo tom="danger">sinal bloqueado</Selo>}
                </div>
              )}
            </SheetHeader>
            {caseId && <div className="px-5 pt-4"><ChatDaRecuperacao key={caseId} casoId={caseId} /></div>}

            {/* Equipamento */}
            <section className="border-b border-[var(--border)] px-5 py-4">
              <Kicker>equipamento</Kicker>
              <dl className="mt-2 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5">
                <Linha rotulo="tipo">{card.equipamento.tipo}</Linha>
                <Linha rotulo="marca / modelo">{[card.equipamento.marca, card.equipamento.modelo].filter(Boolean).join(" ") || TRACO}</Linha>
                <Linha rotulo="série" mono>{card.equipamento.serie ?? TRACO}</Linha>
                <Linha rotulo="mac" mono>{card.equipamento.mac ?? TRACO}</Linha>
                <Linha rotulo="patrimônio" mono>{card.equipamento.patrimonio ?? TRACO}</Linha>
                <Linha rotulo="valor" mono>{card.equipamento.valor !== null ? brl(card.equipamento.valor) : TRACO}</Linha>
                <Linha rotulo="situação">{ROTULO_STATUS_EQUIPAMENTO[card.equipamento.status] ?? card.equipamento.status}</Linha>
              </dl>
            </section>

            {/* Cliente */}
            <section className="border-b border-[var(--border)] px-5 py-4">
              <Kicker>cliente</Kicker>
              <dl className="mt-2 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5">
                <Linha rotulo="nome">{card.cliente.nome}</Linha>
                <Linha rotulo="documento" mono>{card.cliente.documento}</Linha>
                <Linha rotulo="telefone">
                  <span className="inline-flex items-center gap-2">
                    <span style={MONO}>{card.cliente.telefone ?? TRACO}</span>
                    {card.cliente.whatsapp && (
                      <a href={`https://wa.me/${card.cliente.whatsapp}`} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-7 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-[var(--ok)] hover:bg-[var(--ok-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand)]">
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
                      </a>
                    )}
                  </span>
                </Linha>
                <Linha rotulo="endereço">{[card.cliente.endereco, card.cliente.bairro, card.cliente.cidade && (card.cliente.uf ? `${card.cliente.cidade}/${card.cliente.uf}` : card.cliente.cidade)].filter(Boolean).join(" · ") || TRACO}</Linha>
                <Linha rotulo="situação">{card.cliente.situacao}</Linha>
                <Linha rotulo="dívida" mono>
                  {card.cliente.dividaEmAberto > 0
                    ? <span className="text-[var(--money-neg)]">{brl(card.cliente.dividaEmAberto)}{card.cliente.diasEmAtraso > 0 ? ` · ${card.cliente.diasEmAtraso} d atraso` : ""}</span>
                    : "em dia"}
                </Linha>
              </dl>
            </section>

            {/* Caso */}
            <section className="border-b border-[var(--border)] px-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <Kicker>caso</Kicker>
                {caso && <span className="text-[11px] text-[var(--text-muted)]" style={MONO}>rescisão {dataBr(caso.rescisaoEm)} · prazo {dataBr(caso.prazoAt)}</span>}
              </div>

              {!caso ? (
                <div className="mt-3 rounded-lg border border-dashed border-[var(--border)] px-4 py-5 text-center">
                  <p className="text-[12px] leading-5 text-[var(--text-muted)]">Sem caso aberto. A idade no kanban nasce da data da rescisão — abra o caso para o equipamento entrar na fila.</p>
                  <Button className="mt-3 min-h-11" onClick={() => onAbrirCaso(card)}>Abrir caso</Button>
                </div>
              ) : encerrado ? (
                <dl className="mt-2 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5">
                  <Linha rotulo="desfecho">{ROTULO_ETAPA[caso.status] ?? caso.status}</Linha>
                  <Linha rotulo="encerrado em" mono>{dataHoraBr(caso.encerradoEm)}</Linha>
                  <Linha rotulo="prioridade">{ROTULO_PRIORIDADE[caso.prioridade] ?? caso.prioridade}</Linha>
                  <Linha rotulo="responsável">{caso.responsavel?.nome ?? TRACO}</Linha>
                  <Linha rotulo="tentativas" mono>{caso.tentativas.total}</Linha>
                  {caso.notas && <Linha rotulo="notas">{caso.notas}</Linha>}
                </dl>
              ) : (
                <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); salvar.mutate(); }}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Etapa</Label>
                      <Select value={form.status} onValueChange={value => setForm(atual => ({ ...atual, status: value }))}>
                        <SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>{ETAPAS_ABERTAS.map(valor => <SelectItem key={valor} value={valor}>{ROTULO_ETAPA[valor]}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Prioridade</Label>
                      <Select value={form.priority} onValueChange={value => setForm(atual => ({ ...atual, priority: value }))}>
                        <SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>{OPCOES_PRIORIDADE.map(opcao => <SelectItem key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  {contestando && (
                    <div>
                      <Label htmlFor="drawer-motivo">Motivo da contestação</Label>
                      <Textarea id="drawer-motivo" required className="mt-1" placeholder="O que o titular alega" value={form.disputeReason} onChange={event => setForm(atual => ({ ...atual, disputeReason: event.target.value }))} />
                    </div>
                  )}
                  <div>
                    <Label>Responsável</Label>
                    <Select value={form.assignedToUserId || "sem"} onValueChange={value => setForm(atual => ({ ...atual, assignedToUserId: value === "sem" ? "" : value }))}>
                      <SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sem">Sem responsável</SelectItem>
                        {responsaveis.map(usuario => <SelectItem key={usuario.id} value={String(usuario.id)}>{usuario.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 rounded-lg bg-[var(--surface-2)] px-3 py-2">
                    <Linha rotulo="agendamento" mono>{caso.agendadoEm ? `${dataHoraBr(caso.agendadoEm)}${caso.metodo ? ` · ${ROTULO_METODO[caso.metodo] ?? caso.metodo}` : ""}` : "sem agendamento"}</Linha>
                    <Linha rotulo="notificação" mono>{caso.notificadoEm ? dataBr(caso.notificadoEm) : "não registrada"}</Linha>
                    <Linha rotulo="tentativas" mono>{caso.tentativas.total}{caso.tentativas.ultima ? ` · última ${dataBr(caso.tentativas.ultima.em)}` : ""}</Linha>
                  </dl>
                  <div>
                    <Label htmlFor="drawer-notas">Notas internas</Label>
                    <Textarea id="drawer-notas" className="mt-1" value={form.notes} onChange={event => setForm(atual => ({ ...atual, notes: event.target.value }))} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" className="min-h-11" disabled={salvar.isPending || (contestando && !form.disputeReason.trim())}>{salvar.isPending ? "Salvando..." : "Salvar alterações"}</Button>
                    <Button type="button" variant="outline" className="min-h-11" onClick={() => onContato(card)}><History className="mr-1.5 h-4 w-4" aria-hidden /> Registrar contato</Button>
                    <Button type="button" variant="outline" className="min-h-11" onClick={() => onAgendar(card)}><CalendarClock className="mr-1.5 h-4 w-4" aria-hidden /> Agendar</Button>
                  </div>
                  <div className="flex flex-wrap gap-2 border-t border-[var(--border-faint)] pt-3">
                    <Button type="button" variant="outline" className="min-h-11 text-[var(--ok)]" onClick={() => onConcluir(card)}><PackageCheck className="mr-1.5 h-4 w-4" aria-hidden /> Marcar como recuperado</Button>
                    <Button type="button" variant="ghost" className="min-h-11 text-[var(--text-muted)]" onClick={() => onBaixar(card)}><PackageX className="mr-1.5 h-4 w-4" aria-hidden /> Baixar</Button>
                  </div>
                </form>
              )}
            </section>

            {/* Linha do tempo */}
            {caseId !== null && (
              <section className="px-5 py-4">
                <Kicker>linha do tempo</Kicker>
                <div className="mt-2 divide-y divide-[var(--border-faint)] rounded-lg border border-[var(--border)]">
                  {carregandoEventos ? (
                    <div className="space-y-2 p-3"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
                  ) : eventos.length === 0 ? (
                    <p className="px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">Nenhum evento registrado.</p>
                  ) : eventos.map(evento => (
                    <div key={evento.id} className="flex gap-3 px-3 py-2.5">
                      <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-[var(--brand)]" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                          <p className="text-[12px] font-medium text-[var(--text)]">{descreverEvento(evento)}</p>
                          <time dateTime={evento.occurredAt} className="text-[10px] text-[var(--text-muted)]" style={MONO}>{dataHoraBr(evento.occurredAt)}</time>
                        </div>
                        {evento.notes && <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{evento.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
