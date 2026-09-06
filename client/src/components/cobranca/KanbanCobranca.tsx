/**
 * O quadro de cobrança: colunas = fluxo do operador, cards = casos.
 *
 * Arrastar é uma INTENÇÃO que `movimentos-cobranca.ts` traduz antes de
 * qualquer requisição: PATCH direto (com otimismo e rollback), abrir a
 * negociação, abrir o cancelamento, ou recusar com o motivo no toast — nunca
 * uma coluna pintada que o servidor devolve com 409. O molde de DnD é o kanban
 * de recuperação de equipamentos (`pages/operacional/recuperacao.tsx`):
 * dnd-kit, sensores de ponteiro e teclado (setas trocam de coluna), overlay,
 * anúncios para leitor de tela.
 *
 * As colunas recolhidas (negativado · baixado · encerrado) só aparecem quando
 * o operador pede — são desfecho que se olha de vez em quando, não fila.
 */
import { useMemo, useState } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection,
  useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragStartEvent,
  type KeyboardCoordinateGetter, type UniqueIdentifier,
} from "@dnd-kit/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { brl, MONO, num } from "@/components/localizacao/ui";
import { BOTAO_SECUNDARIO } from "@/components/painel/ui";
import { ROTULO_STATUS_DE_CASO, type StatusDeCaso } from "@shared/cobranca/estados";
import type { Etapa } from "@shared/cobranca";
import { CardCaso, CardCasoArrastavel, chaveDoCard, type AcoesDoCard } from "./CardCaso";
import { avaliarMovimentoDeCaso, COLUNAS_RECOLHIDAS, COR_DO_TOM, tituloDoMovimento, tomDaColunaDoKanban, type MovimentoDeCaso } from "./movimentos-cobranca";
import { API_CASOS, type ColunaDoKanban, type ItemDaFila, type RespostaDoKanban } from "./tipos";
import { invalidarCobranca, mensagemDoErro } from "./ui";

export const LARGURA_COLUNA_COBRANCA = 300;

const ehStatus = (id: UniqueIdentifier | undefined): id is StatusDeCaso =>
  typeof id === "string" && id in ROTULO_STATUS_DE_CASO;

/** Setas ← → pulam de coluna em coluna, na ordem visual. */
const coordenadasPorColuna: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
  if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return undefined;
  const colunas = context.droppableContainers
    .getEnabled()
    .flatMap(c => (c.rect.current ? [{ id: c.id, rect: c.rect.current }] : []))
    .sort((a, b) => a.rect.left - b.rect.left);
  if (colunas.length === 0) return undefined;
  const referencia = context.collisionRect ? context.collisionRect.left + context.collisionRect.width / 2 : currentCoordinates.x;
  let atual = context.over ? colunas.findIndex(c => c.id === context.over?.id) : -1;
  if (atual < 0) atual = colunas.findIndex(c => referencia >= c.rect.left && referencia <= c.rect.left + c.rect.width);
  if (atual < 0) atual = event.code === "ArrowRight" ? -1 : colunas.length;
  const proxima = event.code === "ArrowRight" ? Math.min(colunas.length - 1, atual + 1) : Math.max(0, atual - 1);
  const alvo = colunas[proxima];
  const esquerdaAtual = context.collisionRect?.left ?? currentCoordinates.x;
  return { x: currentCoordinates.x + (alvo.rect.left + 8 - esquerdaAtual), y: currentCoordinates.y };
};

const detectarColisao: CollisionDetection = args => {
  const porPonteiro = pointerWithin(args);
  return porPonteiro.length > 0 ? porPonteiro : rectIntersection(args);
};

interface MudancaDeCaso {
  item: ItemDaFila;
  status: StatusDeCaso;
}

function moverNoQuadro(quadro: RespostaDoKanban, casoId: number, destino: StatusDeCaso): RespostaDoKanban {
  let movido: ItemDaFila | null = null;
  const semEle = quadro.colunas.map(c => {
    const restantes = c.casos.filter(x => {
      if (x.id === casoId) { movido = x; return false; }
      return true;
    });
    return restantes.length === c.casos.length ? c : { ...c, casos: restantes, total: Math.max(0, c.total - 1) };
  });
  if (!movido) return quadro;
  const atualizado: ItemDaFila = { ...(movido as ItemDaFila), status: destino };
  return {
    ...quadro,
    colunas: semEle.map(c => (c.status === destino ? { ...c, casos: [atualizado, ...c.casos], total: c.total + 1 } : c)),
  };
}

function Coluna({ coluna, cardAtivo, podeAdministrar, children }: {
  coluna: ColunaDoKanban; cardAtivo: ItemDaFila | null; podeAdministrar: boolean; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: coluna.status, data: { status: coluna.status } });
  const veredito: MovimentoDeCaso | null = cardAtivo && ehStatus(coluna.status) ? avaliarMovimentoDeCaso(cardAtivo, coluna.status, { podeAdministrar }) : null;
  const aceita = veredito !== null && veredito.tipo !== "recusado" && veredito.tipo !== "nenhum";
  const recusa = veredito !== null && veredito.tipo === "recusado";
  const anel = isOver && aceita ? "0 0 0 2px var(--brand)" : isOver && recusa ? "0 0 0 2px var(--danger)" : aceita ? "0 0 0 1px var(--brand)" : "0 0 0 1px var(--border)";
  const valor = coluna.casos.reduce((s, c) => s + (c.valorAtual ?? 0), 0);
  // A cor do funil (pedido do dono): borda no topo e contagem no tom da etapa —
  // neutro a contatar, azul em contato, ambar negociando, verde acordo/pago,
  // vermelho negativado, vinho cancelamento. Coluna fechada fica apagada.
  const tom = tomDaColunaDoKanban(coluna.status);
  const corDoTom = COR_DO_TOM[tom];
  return (
    <section
      ref={setNodeRef}
      aria-label={`${coluna.rotulo}: ${coluna.total} ${coluna.total === 1 ? "caso" : "casos"}`}
      data-coluna={coluna.status}
      data-tom={tom}
      data-aceita={cardAtivo ? String(aceita) : undefined}
      className="flex max-h-full flex-none flex-col overflow-hidden rounded-lg"
      style={{ width: LARGURA_COLUNA_COBRANCA, background: coluna.fechada ? "var(--surface-2)" : "var(--bg)", boxShadow: anel, borderTop: `3px solid ${coluna.fechada ? "var(--border-strong)" : corDoTom}`, opacity: recusa && !isOver ? 0.75 : 1, transition: "box-shadow .15s, opacity .15s" }}
    >
      <header className="flex items-baseline justify-between gap-2 px-3 pb-2 pt-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 truncate text-[13px] font-medium tracking-[-0.01em] text-[var(--text)]">
            <span className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: coluna.fechada ? "var(--border-strong)" : corDoTom }} aria-hidden />
            {coluna.rotulo}
          </h2>
          {coluna.fechada && <p className="text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]" style={MONO}>últimos 30 dias</p>}
          {coluna.truncado && <p className="text-[10px] text-[var(--text-faint)]" style={MONO}>mostrando {num(coluna.casos.length)} de {num(coluna.total)}</p>}
        </div>
        <div className="flex-none text-right" style={MONO}>
          <p className="text-[13px] font-medium tabular-nums" style={{ color: coluna.fechada || coluna.total === 0 ? "var(--text-muted)" : corDoTom }}>{num(coluna.total)}</p>
          <p className="text-[10px] tabular-nums text-[var(--text-muted)]">{brl(valor)}</p>
        </div>
      </header>
      <div className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" role="list" aria-label={`Casos em ${coluna.rotulo}`}>
        {coluna.casos.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center">
            <Inbox className="h-5 w-5 text-[var(--text-faint)]" aria-hidden />
            <p className="mt-2 text-[11px] leading-4 text-[var(--text-muted)]">{coluna.fechada ? "nada aqui nos últimos 30 dias" : "nenhum caso nesta coluna"}</p>
          </div>
        ) : children}
      </div>
    </section>
  );
}

export function KanbanCobranca({ quadro, chaveDaQuery, etapas, hoje, podeAdministrar, acoes, onNegociar, onCancelar }: {
  quadro: RespostaDoKanban;
  /** A queryKey do quadro — é nela que o otimismo escreve e desfaz. */
  chaveDaQuery: unknown[];
  etapas: readonly Etapa[] | undefined;
  hoje: Date;
  podeAdministrar: boolean;
  acoes: AcoesDoCard;
  onNegociar: (item: ItemDaFila) => void;
  onCancelar: (item: ItemDaFila) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cardAtivo, setCardAtivo] = useState<ItemDaFila | null>(null);
  const [mostrarRecolhidas, setMostrarRecolhidas] = useState(false);

  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: coordenadasPorColuna }),
  );

  const porChave = useMemo(() => {
    const m = new Map<string, ItemDaFila>();
    for (const c of quadro.colunas) for (const item of c.casos) m.set(chaveDoCard(item), item);
    return m;
  }, [quadro]);

  const mover = useMutation({
    mutationFn: async (m: MudancaDeCaso) => (await apiRequest("PATCH", `${API_CASOS}/${m.item.id}`, { status: m.status })).json(),
    onMutate: async (m: MudancaDeCaso) => {
      await queryClient.cancelQueries({ queryKey: chaveDaQuery });
      const anterior = queryClient.getQueryData<RespostaDoKanban>(chaveDaQuery);
      if (anterior) queryClient.setQueryData<RespostaDoKanban>(chaveDaQuery, moverNoQuadro(anterior, m.item.id, m.status));
      return { anterior };
    },
    onError: (erro: Error, _m, contexto) => {
      if (contexto?.anterior) queryClient.setQueryData(chaveDaQuery, contexto.anterior);
      toast({ title: "Não foi possível mover o caso", description: mensagemDoErro(erro), variant: "destructive" });
    },
    onSuccess: (_d, m) => toast({ title: tituloDoMovimento(m.status) }),
    onSettled: () => invalidarCobranca(),
  });
  const ocupadoId = mover.isPending ? mover.variables?.item.id ?? null : null;

  const aoComecar = (e: DragStartEvent) => {
    const dados = e.active.data.current as { item?: ItemDaFila } | undefined;
    setCardAtivo(dados?.item ?? porChave.get(String(e.active.id)) ?? null);
  };
  const aoSoltar = (e: DragEndEvent) => {
    const item = cardAtivo;
    setCardAtivo(null);
    if (!item || !e.over || !ehStatus(e.over.id)) return;
    const movimento = avaliarMovimentoDeCaso(item, e.over.id, { podeAdministrar });
    switch (movimento.tipo) {
      case "nenhum": return;
      case "recusado": toast({ title: "Movimento não permitido", description: movimento.motivo, variant: "destructive" }); return;
      case "negociar": onNegociar(item); return;
      case "cancelar": onCancelar(item); return;
      case "direto": mover.mutate({ item, status: movimento.status }); return;
    }
  };

  const nomeDoAtivo = (id: UniqueIdentifier) => porChave.get(String(id))?.cliente.nome ?? "caso";
  const anuncios: Announcements = {
    onDragStart: ({ active }) => `${nomeDoAtivo(active.id)} levantado. Use as setas para escolher a coluna.`,
    onDragOver: ({ over }) => (over && ehStatus(over.id) ? `Sobre a coluna ${ROTULO_STATUS_DE_CASO[over.id]}.` : "Fora de qualquer coluna."),
    onDragEnd: ({ over }) => (over && ehStatus(over.id) ? `Solto na coluna ${ROTULO_STATUS_DE_CASO[over.id]}.` : "Arrasto cancelado."),
    onDragCancel: () => "Arrasto cancelado.",
  };

  const visiveis = quadro.colunas.filter(c => mostrarRecolhidas || !(COLUNAS_RECOLHIDAS as readonly string[]).includes(c.status));
  const recolhidasTotal = quadro.colunas.filter(c => (COLUNAS_RECOLHIDAS as readonly string[]).includes(c.status)).reduce((s, c) => s + c.total, 0);

  return (
    <div className="flex flex-col gap-2" data-testid="kanban-cobranca">
      <div className="flex items-center justify-end">
        <button type="button" className={cn(BOTAO_SECUNDARIO, "h-8 text-[11.5px]")} onClick={() => setMostrarRecolhidas(v => !v)} data-testid="botao-recolhidas">
          {mostrarRecolhidas ? "Ocultar encerrados" : `Encerrados (${num(recolhidasTotal)})`}
        </button>
      </div>
      <DndContext sensors={sensores} collisionDetection={detectarColisao} accessibility={{ announcements: anuncios }} onDragStart={aoComecar} onDragEnd={aoSoltar} onDragCancel={() => setCardAtivo(null)}>
        <div className="flex gap-3 overflow-x-auto pb-2" data-testid="colunas-kanban">
          {visiveis.map(coluna => (
            <Coluna key={coluna.status} coluna={coluna} cardAtivo={cardAtivo} podeAdministrar={podeAdministrar}>
              {coluna.casos.map(item => (
                <CardCasoArrastavel key={item.id} item={item} etapas={etapas} hoje={hoje} acoes={acoes} ocupado={ocupadoId === item.id} />
              ))}
            </Coluna>
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {cardAtivo && <div style={{ width: LARGURA_COLUNA_COBRANCA - 16 }}><CardCaso item={cardAtivo} etapas={etapas} hoje={hoje} acoes={acoes} overlay /></div>}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
