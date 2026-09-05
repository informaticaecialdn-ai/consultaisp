/**
 * /recuperacao — CRM de recuperação de equipamentos, kanban por idade.
 *
 * A coluna de cada card é decidida no servidor a partir da data de rescisão
 * (`GET /api/equipment/recovery-board`). Esta tela não calcula idade: só
 * desenha o que veio, filtra e traduz arrasto em PATCH — a tabela do que cada
 * arrasto significa está em `components/recuperacao/movimentos.ts`.
 *
 * Otimismo com rollback: o card muda de coluna no gesto, o servidor confirma
 * atrás; se recusar, o board anterior volta e o motivo vai para o toast.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection,
  useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragStartEvent,
  type KeyboardCoordinateGetter, type UniqueIdentifier,
} from "@dnd-kit/core";
import { AlertTriangle, ClipboardList, Kanban as KanbanIcon, PackageCheck, Plus, Search, Timer, Truck, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { brl, Kpi, num } from "@/components/localizacao/ui";
import { CardArrastavel, CardEquipamento, nomeDoEquipamento, OPCOES_PRIORIDADE, type AcoesCard } from "@/components/recuperacao/CardEquipamento";
import { KanbanColuna, LARGURA_COLUNA } from "@/components/recuperacao/KanbanColuna";
import { DialogoAbrirCaso } from "@/components/recuperacao/DialogoAbrirCaso";
import { DialogoAgendar } from "@/components/recuperacao/DialogoAgendar";
import { DialogoContato, invalidarTudoDoCaso, mensagemDoErro } from "@/components/recuperacao/DialogoContato";
import { API_CHAT_BULLQ, chatProntoParaEnviar, lerIntegracaoDoChat } from "@/components/cobranca/tipos";
import { DrawerCaso } from "@/components/recuperacao/DrawerCaso";
import {
  avaliarMovimento, cidadesDosCards, filtrarCards, FILTROS_INICIAIS, type FiltrosKanban,
} from "@/components/recuperacao/movimentos";
import {
  ORDEM_COLUNAS, QUERY_BOARD, ROTULO_COLUNA, ROTULO_ETAPA, ROTULO_PRIORIDADE,
  type BoardKanban, type CardKanban, type ColunaKanban,
} from "@/components/recuperacao/tipos";

/* ── Utilitários da tela ─────────────────────────────────────────────── */

/** Skeleton só depois de 300 ms: abaixo disso o piscar incomoda mais do que o vazio. */
function useSkeletonAtrasado(carregando: boolean) {
  const [mostrar, setMostrar] = useState(false);
  useEffect(() => {
    if (!carregando) { setMostrar(false); return; }
    const timer = setTimeout(() => setMostrar(true), 300);
    return () => clearTimeout(timer);
  }, [carregando]);
  return mostrar;
}

const ehColuna = (id: UniqueIdentifier): id is ColunaKanban => ORDEM_COLUNAS.includes(id as ColunaKanban);

/**
 * Teclado: seta esquerda/direita pula de coluna em coluna, em vez dos 25 px
 * do getter padrão — com colunas de ~300 px o operador precisaria de doze
 * toques para atravessar uma. A posição vertical não muda: coluna é o único
 * destino que existe.
 */
const coordenadasPorColuna: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
  if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return undefined;
  const colunas = context.droppableContainers
    .getEnabled()
    .flatMap(container => (container.rect.current ? [{ id: container.id, rect: container.rect.current }] : []))
    .sort((a, b) => a.rect.left - b.rect.left);
  if (colunas.length === 0) return undefined;

  const referencia = context.collisionRect ? context.collisionRect.left + context.collisionRect.width / 2 : currentCoordinates.x;
  let atual = context.over ? colunas.findIndex(coluna => coluna.id === context.over?.id) : -1;
  if (atual < 0) atual = colunas.findIndex(coluna => referencia >= coluna.rect.left && referencia <= coluna.rect.left + coluna.rect.width);
  if (atual < 0) atual = event.code === "ArrowRight" ? -1 : colunas.length;

  const proxima = event.code === "ArrowRight" ? Math.min(colunas.length - 1, atual + 1) : Math.max(0, atual - 1);
  const alvo = colunas[proxima];
  const esquerdaAtual = context.collisionRect?.left ?? currentCoordinates.x;
  return { x: currentCoordinates.x + (alvo.rect.left + 8 - esquerdaAtual), y: currentCoordinates.y };
};

/** Ponteiro dentro da coluna primeiro; se o ponteiro estiver fora (teclado), a interseção do card. */
const detectarColisao: CollisionDetection = args => {
  const porPonteiro = pointerWithin(args);
  return porPonteiro.length > 0 ? porPonteiro : rectIntersection(args);
};

interface MudancaCaso {
  chave: string;
  caseId: number;
  payload: Record<string, unknown>;
  otimista: (card: CardKanban) => CardKanban;
  titulo: string;
  descricao?: string;
}

const agoraIso = () => new Date().toISOString();

/* ── Página ──────────────────────────────────────────────────────────── */

export default function RecuperacaoPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: board, isLoading, isError, error, refetch } = useQuery<BoardKanban>({ queryKey: [QUERY_BOARD], staleTime: 30_000 });
  const mostrarSkeleton = useSkeletonAtrasado(isLoading);

  const [filtros, setFiltros] = useState<FiltrosKanban>(FILTROS_INICIAIS);
  const [chaveDrawer, setChaveDrawer] = useState<string | null>(null);
  const [chaveContato, setChaveContato] = useState<string | null>(null);
  const [chaveAgendar, setChaveAgendar] = useState<string | null>(null);
  const [abrirCaso, setAbrirCaso] = useState<{ aberto: boolean; chave: string | null }>({ aberto: false, chave: null });
  const [baixa, setBaixa] = useState<{ chave: string; motivo: string } | null>(null);
  const [cardAtivo, setCardAtivo] = useState<CardKanban | null>(null);

  const cards = board?.cards ?? [];
  const cardPorChave = useMemo(() => new Map(cards.map(card => [card.chave, card])), [cards]);
  const cardDe = (chave: string | null) => (chave ? cardPorChave.get(chave) ?? null : null);

  const cardsFiltrados = useMemo(() => filtrarCards(cards, filtros), [cards, filtros]);
  const porColuna = useMemo(() => {
    const mapa = new Map<ColunaKanban, CardKanban[]>();
    for (const chave of ORDEM_COLUNAS) mapa.set(chave, []);
    for (const card of cardsFiltrados) mapa.get(card.coluna)?.push(card);
    return mapa;
  }, [cardsFiltrados]);
  const cidades = useMemo(() => cidadesDosCards(cards), [cards]);
  const candidatosSemCaso = useMemo(() => cards.filter(card => card.coluna === "sem_data"), [cards]);
  const filtrosAtivos = filtros.busca.trim() !== "" || filtros.prioridade !== "todas" || filtros.responsavel !== "todos" || filtros.cidade !== "todas";

  const sensores = useSensors(
    // 6 px de tolerância: clique em select e botão dentro do card não vira arrasto.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: coordenadasPorColuna }),
  );

  /* ── Mutação única com otimismo ──────────────────────────────────── */

  const mudarCaso = useMutation({
    mutationFn: async (mudanca: MudancaCaso) => {
      const response = await apiRequest("PATCH", `/api/equipment/recovery-cases/${mudanca.caseId}`, mudanca.payload);
      return response.json();
    },
    onMutate: async (mudanca: MudancaCaso) => {
      await queryClient.cancelQueries({ queryKey: [QUERY_BOARD] });
      const anterior = queryClient.getQueryData<BoardKanban>([QUERY_BOARD]);
      if (anterior) {
        queryClient.setQueryData<BoardKanban>([QUERY_BOARD], {
          ...anterior,
          cards: anterior.cards.map(card => (card.chave === mudanca.chave ? mudanca.otimista(card) : card)),
        });
      }
      return { anterior };
    },
    onError: (erro: Error, _mudanca, contexto) => {
      if (contexto?.anterior) queryClient.setQueryData([QUERY_BOARD], contexto.anterior);
      toast({ title: "Não foi possível atualizar o caso", description: mensagemDoErro(erro), variant: "destructive" });
    },
    onSuccess: (_dados, mudanca) => toast({ title: mudanca.titulo, description: mudanca.descricao }),
    onSettled: (_dados, _erro, mudanca) => invalidarTudoDoCaso(mudanca.caseId),
  });

  const chaveOcupada = mudarCaso.isPending ? mudarCaso.variables?.chave ?? null : null;

  const concluir = (card: CardKanban) => {
    if (!card.caseId) return;
    mudarCaso.mutate({
      chave: card.chave,
      caseId: card.caseId,
      payload: { status: "concluido" },
      otimista: atual => ({ ...atual, coluna: "recuperado", caso: atual.caso && { ...atual.caso, status: "concluido", encerradoEm: agoraIso() } }),
      titulo: "Equipamento recuperado",
      descricao: `${nomeDoEquipamento(card)} · ${card.cliente.nome}`,
    });
  };

  const confirmarBaixa = () => {
    const card = cardDe(baixa?.chave ?? null);
    if (!card?.caseId || !baixa) return;
    const motivo = baixa.motivo.trim();
    mudarCaso.mutate({
      chave: card.chave,
      caseId: card.caseId,
      payload: { status: "baixado_economico", ...(motivo ? { notes: motivo } : {}) },
      otimista: atual => ({ ...atual, coluna: "baixado", caso: atual.caso && { ...atual.caso, status: "baixado_economico", encerradoEm: agoraIso(), notas: motivo || atual.caso.notas } }),
      titulo: "Equipamento baixado",
      descricao: `${nomeDoEquipamento(card)} · ${card.cliente.nome}`,
    });
    setBaixa(null);
  };

  // O chat com o cliente (Chat BullQ): "Chat" no card so aparece com o numero do provedor ativo.
  const { data: integracaoDoChatCrua } = useQuery<unknown>({ queryKey: [`${API_CHAT_BULLQ}/integracao`], staleTime: 300_000 });
  const chatPronto = chatProntoParaEnviar(lerIntegracaoDoChat(integracaoDoChatCrua));
  const enviarParaChat = useMutation({
    mutationFn: async (card: CardKanban) => {
      if (!card.caseId) throw new Error("Este equipamento ainda nao tem caso de retirada");
      return (await apiRequest("POST", `${API_CHAT_BULLQ}/recuperacao/${card.caseId}/enviar`, {})).json();
    },
    onSuccess: (r: { reaproveitada?: boolean }, card) => {
      if (card.caseId) invalidarTudoDoCaso(card.caseId);
      toast({ title: r.reaproveitada ? "Mensagem enviada na conversa que já existia" : "Retirada enviada para o chat", description: "A conversa segue no inbox do chat; o contato fica registrado no caso." });
    },
    onError: (erro: Error) => toast({ title: "Não foi possível enviar para o chat", description: mensagemDoErro(erro), variant: "destructive" }),
  });

  const acoes: AcoesCard = {
    onEnviarParaChat: chatPronto ? card => enviarParaChat.mutate(card) : undefined,
    onPrioridade: (card, prioridade) => {
      if (!card.caseId || card.caso?.prioridade === prioridade) return;
      mudarCaso.mutate({
        chave: card.chave,
        caseId: card.caseId,
        payload: { priority: prioridade },
        otimista: atual => ({ ...atual, caso: atual.caso && { ...atual.caso, prioridade } }),
        titulo: `Prioridade: ${ROTULO_PRIORIDADE[prioridade] ?? prioridade}`,
      });
    },
    onEtapa: (card, etapa) => {
      if (!card.caseId || card.caso?.status === etapa) return;
      mudarCaso.mutate({
        chave: card.chave,
        caseId: card.caseId,
        payload: { status: etapa },
        otimista: atual => ({ ...atual, caso: atual.caso && { ...atual.caso, status: etapa } }),
        titulo: `Etapa: ${ROTULO_ETAPA[etapa] ?? etapa}`,
      });
    },
    onContato: card => setChaveContato(card.chave),
    onAgendar: card => setChaveAgendar(card.chave),
    onDetalhes: card => setChaveDrawer(card.chave),
    onAbrirCaso: card => setAbrirCaso({ aberto: true, chave: card.chave }),
  };

  /* ── Arrastar e soltar ───────────────────────────────────────────── */

  const aoComecarArrasto = (event: DragStartEvent) => {
    const dados = event.active.data.current as { card?: CardKanban } | undefined;
    setCardAtivo(dados?.card ?? cardPorChave.get(String(event.active.id)) ?? null);
  };

  const aoSoltar = (event: DragEndEvent) => {
    const card = cardAtivo;
    setCardAtivo(null);
    if (!card || !event.over || !ehColuna(event.over.id)) return;
    const movimento = avaliarMovimento(card, event.over.id);
    switch (movimento.tipo) {
      case "nenhum":
        return;
      case "recusado":
        toast({ title: "Movimento não permitido", description: movimento.motivo, variant: "destructive" });
        return;
      case "concluir":
        concluir(card);
        return;
      case "baixar":
        setBaixa({ chave: card.chave, motivo: "" });
        return;
      case "abrir_caso":
        setAbrirCaso({ aberto: true, chave: card.chave });
        return;
    }
  };

  const nomeDoAtivo = (id: UniqueIdentifier) => {
    const card = cardPorChave.get(String(id));
    return card ? `${nomeDoEquipamento(card)} de ${card.cliente.nome}` : "card";
  };
  const anuncios: Announcements = {
    onDragStart: ({ active }) => `${nomeDoAtivo(active.id)} levantado. Use as setas para escolher a coluna.`,
    onDragOver: ({ over }) => (over && ehColuna(over.id) ? `Sobre a coluna ${ROTULO_COLUNA[over.id]}.` : "Fora de qualquer coluna."),
    onDragEnd: ({ over }) => (over && ehColuna(over.id) ? `Solto na coluna ${ROTULO_COLUNA[over.id]}.` : "Arrasto cancelado."),
    onDragCancel: () => "Arrasto cancelado.",
  };

  /* ── Render ──────────────────────────────────────────────────────── */

  const cardDrawer = cardDe(chaveDrawer);
  const cardBaixa = cardDe(baixa?.chave ?? null);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6" data-testid="recuperacao-page">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-medium leading-tight tracking-[-0.02em] text-[var(--text)]">Recuperação de equipamentos</h1>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">Kanban por idade desde a rescisão. Arraste para recuperar ou baixar; a idade vem da data, não do arrasto.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => navigate("/equipamentos")}>
            <ClipboardList className="mr-1.5 h-4 w-4" aria-hidden /> Ver patrimônio
          </Button>
          <Button className="min-h-11" onClick={() => setAbrirCaso({ aberto: true, chave: null })} data-testid="botao-novo-caso">
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Novo caso
          </Button>
        </div>
      </header>

      {mostrarSkeleton ? (
        <>
          <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" aria-busy>
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[74px] rounded-lg" />)}
          </section>
          <Skeleton className="h-11 w-full rounded-lg" />
          <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[420px] flex-none rounded-lg" style={{ width: LARGURA_COLUNA }} />)}
          </div>
        </>
      ) : isError ? (
        <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-6 py-8 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-[var(--danger)]" aria-hidden />
          <h2 className="mt-3 text-[15px] font-medium text-[var(--text)]">Não foi possível carregar o kanban</h2>
          <p className="mx-auto mt-1 max-w-[52ch] text-[13px] text-[var(--text-2)]">{mensagemDoErro(error)}</p>
          <Button variant="outline" className="mt-4 min-h-11" onClick={() => refetch()}>Tentar de novo</Button>
        </div>
      ) : !board ? null : board.cards.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-14 text-center">
          <Truck className="mx-auto h-8 w-8 text-[var(--text-faint)]" aria-hidden />
          <h2 className="mt-4 text-[15px] font-medium text-[var(--text)]">Nenhum equipamento em recuperação</h2>
          <p className="mx-auto mt-2 max-w-[56ch] text-[13px] leading-5 text-[var(--text-muted)]">
            A fila nasce do patrimônio: um equipamento com retirada pendente entra aqui em "sem data", e abrir o caso com a data da rescisão o leva para a faixa de idade certa. Nada é inventado a partir da data de cadastro.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button className="min-h-11" onClick={() => navigate("/equipamentos")}>Ir para o patrimônio</Button>
          </div>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" aria-label="Indicadores">
            <Kpi icone={<KanbanIcon className="h-4 w-4" aria-hidden />} iconeCor="var(--brand-ink)" iconeBg="var(--brand-soft)" rotulo="retidos" valor={num(board.kpis.retidos)} sub="sem data + em recuperação" />
            <Kpi icone={<AlertTriangle className="h-4 w-4" aria-hidden />} iconeCor="var(--gated)" iconeBg="var(--gated-bg)" rotulo="valor em risco" valor={brl(board.kpis.valorEmRisco)} sub="patrimônio ainda não recuperado" />
            <Kpi icone={<Timer className="h-4 w-4" aria-hidden />} iconeCor={board.kpis.prazoCritico > 0 ? "var(--danger)" : "var(--text-muted)"} iconeBg={board.kpis.prazoCritico > 0 ? "var(--danger-bg)" : "var(--surface-inset)"} rotulo="prazo crítico" valor={num(board.kpis.prazoCritico)} valorCor={board.kpis.prazoCritico > 0 ? "var(--danger)" : undefined} sub="10 dias ou menos para o prazo" />
            <Kpi icone={<PackageCheck className="h-4 w-4" aria-hidden />} iconeCor="var(--ok)" iconeBg="var(--ok-bg)" rotulo="recuperados 30 d" valor={num(board.kpis.recuperados30d)} sub={brl(board.kpis.valorRecuperado30d)} subMono />
          </section>

          <section className="flex flex-col gap-2 lg:flex-row lg:items-center" aria-label="Filtros">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
              <Input aria-label="Buscar por cliente, documento, série, MAC ou patrimônio" value={filtros.busca} onChange={event => setFiltros(atual => ({ ...atual, busca: event.target.value }))} placeholder="Cliente, CPF/CNPJ, série, MAC ou patrimônio" className="min-h-11 pl-9" />
            </div>
            <Select value={filtros.prioridade} onValueChange={valor => setFiltros(atual => ({ ...atual, prioridade: valor }))}>
              <SelectTrigger className="min-h-11 lg:w-[160px]" aria-label="Prioridade"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Toda prioridade</SelectItem>
                {OPCOES_PRIORIDADE.map(opcao => <SelectItem key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtros.responsavel} onValueChange={valor => setFiltros(atual => ({ ...atual, responsavel: valor }))}>
              <SelectTrigger className="min-h-11 lg:w-[190px]" aria-label="Responsável"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todo responsável</SelectItem>
                <SelectItem value="sem">Sem responsável</SelectItem>
                {board.responsaveis.map(usuario => <SelectItem key={usuario.id} value={String(usuario.id)}>{usuario.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtros.cidade} onValueChange={valor => setFiltros(atual => ({ ...atual, cidade: valor }))}>
              <SelectTrigger className="min-h-11 lg:w-[180px]" aria-label="Cidade"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Toda cidade</SelectItem>
                {cidades.map(cidade => <SelectItem key={cidade} value={cidade}>{cidade}</SelectItem>)}
              </SelectContent>
            </Select>
            {filtrosAtivos && (
              <Button variant="ghost" className="min-h-11" onClick={() => setFiltros(FILTROS_INICIAIS)}>
                <X className="mr-1 h-4 w-4" aria-hidden /> Limpar
              </Button>
            )}
          </section>

          {filtrosAtivos && cardsFiltrados.length === 0 && (
            <p className="text-[12px] text-[var(--text-muted)]">Nenhum card com os filtros atuais — {num(cards.length)} no total.</p>
          )}

          <DndContext
            sensors={sensores}
            collisionDetection={detectarColisao}
            onDragStart={aoComecarArrasto}
            onDragEnd={aoSoltar}
            onDragCancel={() => setCardAtivo(null)}
            accessibility={{
              announcements: anuncios,
              screenReaderInstructions: { draggable: "Pressione espaço para pegar o card, setas esquerda e direita para mudar de coluna, espaço de novo para soltar. Esc cancela." },
            }}
          >
            <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3" style={{ height: "calc(100vh - 330px)", minHeight: 440 }} data-testid="kanban">
              {ORDEM_COLUNAS.map(chave => {
                const lista = porColuna.get(chave) ?? [];
                const valor = lista.reduce((total, card) => total + (card.equipamento.valor ?? 0), 0);
                const rotulo = board.colunas.find(coluna => coluna.chave === chave)?.rotulo ?? ROTULO_COLUNA[chave];
                return (
                  <Fragment key={chave}>
                    {/* Hairline entre a fila e as saídas: encerrado não é a próxima etapa, é o fim. */}
                    {chave === "recuperado" && <div aria-hidden className="w-px flex-none self-stretch bg-[var(--border-strong)]" />}
                    <KanbanColuna chave={chave} rotulo={rotulo} quantidade={lista.length} valor={valor} cardAtivo={cardAtivo}>
                      {lista.map(card => (
                        <div key={card.chave} role="listitem">
                          <CardArrastavel card={card} acoes={acoes} ocupado={chaveOcupada === card.chave} />
                        </div>
                      ))}
                    </KanbanColuna>
                  </Fragment>
                );
              })}
            </div>

            <DragOverlay dropAnimation={null}>
              {cardAtivo && (
                <div style={{ width: LARGURA_COLUNA - 16 }}>
                  <CardEquipamento card={cardAtivo} acoes={acoes} overlay />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </>
      )}

      {/* Diálogos — recebem o card mais recente pela chave, nunca uma cópia velha. */}
      <DialogoContato card={cardDe(chaveContato)} aberto={chaveContato !== null} onFechar={() => setChaveContato(null)} />
      <DialogoAgendar card={cardDe(chaveAgendar)} aberto={chaveAgendar !== null} onFechar={() => setChaveAgendar(null)} />
      <DialogoAbrirCaso
        aberto={abrirCaso.aberto}
        onFechar={() => setAbrirCaso({ aberto: false, chave: null })}
        cardInicial={cardDe(abrirCaso.chave)}
        candidatos={candidatosSemCaso}
        responsaveis={board?.responsaveis ?? []}
      />
      <DrawerCaso
        card={cardDrawer}
        aberto={chaveDrawer !== null}
        onFechar={() => setChaveDrawer(null)}
        responsaveis={board?.responsaveis ?? []}
        onContato={acoes.onContato}
        onAgendar={acoes.onAgendar}
        onConcluir={card => { concluir(card); setChaveDrawer(null); }}
        onBaixar={card => setBaixa({ chave: card.chave, motivo: "" })}
        onAbrirCaso={card => { setChaveDrawer(null); acoes.onAbrirCaso(card); }}
      />

      <AlertDialog open={baixa !== null} onOpenChange={open => { if (!open) setBaixa(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Baixar equipamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {cardBaixa ? `${nomeDoEquipamento(cardBaixa)} de ${cardBaixa.cliente.nome}` : "O equipamento"} sai da fila como baixa econômica. Caso encerrado não volta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="baixa-motivo">Motivo (opcional)</Label>
            <Textarea id="baixa-motivo" className="mt-1" placeholder="Ex.: valor abaixo do custo de retirada" value={baixa?.motivo ?? ""} onChange={event => setBaixa(atual => (atual ? { ...atual, motivo: event.target.value } : atual))} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={confirmarBaixa}>Baixar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
