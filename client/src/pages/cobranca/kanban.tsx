/**
 * /cobranca/kanban — o painel de cobrança em quadro.
 *
 * Decisão do dono (05/09/2026): "um painel de cobrança com kanban, onde o
 * operador vai se organizar com as cobranças, um fluxo organizado que
 * acompanhe a linha do tempo do cliente até pagar ou entrar em cancelamento".
 *
 * As colunas são o FLUXO DO OPERADOR (A contatar → Em contato → Negociando →
 * Acordo ativo → Pago | Cancelamento), não a régua: a etapa da régua (D+1..14,
 * D+15..29…) é selo no card e filtro no topo. A lista da fila (/cobranca/fila)
 * continua existindo como a outra visão do mesmo dado.
 *
 * KPIs vêm do servidor (a fila devolve `kpis` e `total` contados sobre todos
 * os casos vivos do recorte) — nunca de `itens.length` de uma página.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlarmClock, HandCoins, KanbanSquare, ListTodo, Pause, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { CARTEIRAS, ETAPA_IDS, ROTULO_CARTEIRA, type Carteira, type EtapaId } from "@shared/cobranca";
import { brl, Kpi, num, Segmentado } from "@/components/localizacao/ui";
import { AvisoNaoCarregou, BOTAO_SECUNDARIO, CabecalhoPainel, CONTROLE_CAMPO, EstadoVazio } from "@/components/painel/ui";
import { KanbanCobranca } from "@/components/cobranca/KanbanCobranca";
import { DialogoContato, type AlvoDoContato } from "@/components/cobranca/DialogoContato";
import { DialogoNegociacao, type AlvoDaNegociacao } from "@/components/cobranca/DialogoNegociacao";
import { DialogoCancelamento, type AlvoDoCancelamento } from "@/components/cobranca/DialogoCancelamento";
import { lerPolitica } from "@/components/cobranca/politica-form";
import { podeAdministrarCobranca } from "@/components/cobranca/permissoes";
import { etapaDoCard } from "@/components/cobranca/CardCaso";
import {
  API_CASOS, API_FILA, API_KANBAN, API_POLITICA, API_REGUA, lerKanban, lerRespostaDaFila,
  ROTA_CARTEIRA, ROTA_FILA, type ItemDaFila, type RespostaDaRegua,
} from "@/components/cobranca/tipos";
import { invalidarCobranca, mensagemDoErro, useSkeletonAtrasado } from "@/components/cobranca/ui";

type Escopo = "eu" | "todos" | "geral";
const OPCOES_ESCOPO: Array<{ k: Escopo; rotulo: string }> = [
  { k: "eu", rotulo: "Minha fila" },
  { k: "todos", rotulo: "Toda a equipe" },
  { k: "geral", rotulo: "Fila geral" },
];

/** A query string do quadro — só o que a rota aceita, e nada vazio. */
export function queryDoKanban(f: { escopo: Escopo; etapa: string; carteira: string; busca: string }): string {
  const p = new URLSearchParams();
  if (f.escopo === "eu") p.set("responsavel", "eu");
  if (f.escopo === "geral") p.set("responsavel", "geral");
  if (f.etapa) p.set("etapa", f.etapa);
  if (f.carteira) p.set("carteira", f.carteira);
  if (f.busca.trim()) p.set("busca", f.busca.trim());
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default function KanbanPage() {
  const { user, personificando } = useAuth();
  const { toast } = useToast();
  const podeAdministrar = podeAdministrarCobranca(user, personificando);
  const hoje = useMemo(() => new Date(), []);

  const [escopo, setEscopo] = useState<Escopo>("eu");
  const [etapa, setEtapa] = useState("");
  const [carteira, setCarteira] = useState("");
  const [buscaDigitada, setBuscaDigitada] = useState("");
  const [busca, setBusca] = useState("");

  const [contato, setContato] = useState<AlvoDoContato | null>(null);
  const [negociacao, setNegociacao] = useState<AlvoDaNegociacao | null>(null);
  const [cancelamento, setCancelamento] = useState<AlvoDoCancelamento | null>(null);

  const query = queryDoKanban({ escopo, etapa, carteira, busca });
  const chaveDoQuadro = useMemo(() => [`${API_KANBAN}${query}`], [query]);
  const { data, isLoading, isError, error, refetch } = useQuery<unknown>({ queryKey: chaveDoQuadro, staleTime: 15_000 });
  const { data: filaCrua } = useQuery<unknown>({ queryKey: [`${API_FILA}?responsavel=${escopo === "eu" ? "eu" : "todos"}&limite=1`], staleTime: 30_000 });
  const { data: regua } = useQuery<RespostaDaRegua>({ queryKey: [API_REGUA], staleTime: 300_000 });
  const { data: politicaCrua } = useQuery<unknown>({ queryKey: [API_POLITICA], staleTime: 300_000 });
  const politica = useMemo(() => (politicaCrua === undefined ? null : lerPolitica(politicaCrua)), [politicaCrua]);

  const quadro = useMemo(() => lerKanban(data), [data]);
  const fila = useMemo(() => lerRespostaDaFila(filaCrua), [filaCrua]);
  const mostrarSkeleton = useSkeletonAtrasado(isLoading);
  const vazio = !isLoading && quadro.colunas.every(c => c.casos.length === 0);

  const pegar = useMutation({
    mutationFn: async (casoId: number) => (await apiRequest("PATCH", `${API_CASOS}/${casoId}`, { responsavelUserId: user?.id })).json(),
    onSuccess: () => { invalidarCobranca(); toast({ title: "Caso é seu" }); },
    onError: (erro: Error) => toast({ title: "Não foi possível pegar o caso", description: mensagemDoErro(erro), variant: "destructive" }),
  });

  const abrirContato = (item: ItemDaFila) => {
    const { etapa: e } = etapaDoCard(item, regua?.etapas);
    setContato({ casoId: item.id, clienteNome: item.cliente.nome, canalSugerido: e?.canalSugerido ?? null });
  };
  const abrirNegociacao = (item: ItemDaFila) =>
    setNegociacao({ casoId: item.id, clienteNome: item.cliente.nome, valorAtual: item.valorAtual });
  const abrirCancelamento = (item: ItemDaFila) =>
    setCancelamento({ casoId: item.id, customerId: item.cliente.id, clienteNome: item.cliente.nome });

  const acoes = {
    onContato: abrirContato,
    onPegar: user ? (item: ItemDaFila) => pegar.mutate(item.id) : undefined,
    pegando: pegar.isPending,
  };

  const kpis = fila.kpis;

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6" data-testid="cobranca-kanban">
      <CabecalhoPainel
        titulo="Kanban de cobrança"
        descricao="Arraste o caso pelo fluxo: a contatar, em contato, negociando, acordo, pago ou cancelamento. A etapa da régua é o selo do card."
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            <Segmentado opcoes={OPCOES_ESCOPO} valor={escopo} onChange={setEscopo} rotulo="Escopo do quadro" />
            <Link href={ROTA_FILA} className={BOTAO_SECUNDARIO} data-testid="link-fila-lista"><ListTodo className="h-3.5 w-3.5" aria-hidden /> Lista</Link>
            <Link href={ROTA_CARTEIRA} className={BOTAO_SECUNDARIO} data-testid="link-carteira">Carteira</Link>
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" aria-label="Indicadores" data-testid="kpis-kanban">
        <Kpi icone={<KanbanSquare className="h-4 w-4" aria-hidden />} iconeCor="var(--brand-ink)" iconeBg="var(--brand-soft)" rotulo="casos vivos" valor={isLoading ? "…" : num(kpis?.casosVivos ?? quadro.total)} sub="no recorte" />
        <Kpi icone={<AlarmClock className="h-4 w-4" aria-hidden />} iconeCor={(kpis?.vencidos ?? 0) > 0 ? "var(--danger)" : "var(--text-muted)"} iconeBg={(kpis?.vencidos ?? 0) > 0 ? "var(--danger-bg)" : "var(--surface-2)"} rotulo="contato vencido" valor={isLoading ? "…" : num(kpis?.vencidos)} valorCor={(kpis?.vencidos ?? 0) > 0 ? "var(--danger)" : undefined} sub="passou da data" />
        <Kpi icone={<AlarmClock className="h-4 w-4" aria-hidden />} iconeCor="var(--gated)" iconeBg="var(--gated-bg)" rotulo="para hoje" valor={isLoading ? "…" : num(kpis?.paraHoje)} sub="contato marcado" />
        <Kpi icone={<HandCoins className="h-4 w-4" aria-hidden />} iconeCor="var(--money-neg)" iconeBg="var(--past-bg)" rotulo="em aberto" valor={isLoading ? "…" : brl(kpis?.emAberto)} valorCor={(kpis?.emAberto ?? 0) > 0 ? "var(--money-neg)" : undefined} sub="soma dos casos vivos" />
      </section>

      <div className="flex flex-wrap items-center gap-2" data-testid="filtros-kanban">
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-faint)]" aria-hidden />
          <input
            className={cn(CONTROLE_CAMPO, "w-[240px] pl-8")}
            placeholder="Buscar por nome ou documento"
            value={buscaDigitada}
            onChange={e => setBuscaDigitada(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") setBusca(buscaDigitada); }}
            onBlur={() => setBusca(buscaDigitada)}
            aria-label="Buscar no quadro"
            data-testid="busca-kanban"
          />
        </label>
        <select className={cn(CONTROLE_CAMPO, "w-auto")} value={etapa} onChange={e => setEtapa(e.target.value)} aria-label="Etapa da régua" data-testid="filtro-etapa">
          <option value="">Todas as etapas</option>
          {(regua?.etapas ?? []).map(e => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
          {!regua && ETAPA_IDS.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
        <select className={cn(CONTROLE_CAMPO, "w-auto")} value={carteira} onChange={e => setCarteira(e.target.value)} aria-label="Carteira" data-testid="filtro-carteira">
          <option value="">Ativos e ex-clientes</option>
          {CARTEIRAS.map(c => <option key={c} value={c}>{ROTULO_CARTEIRA[c as Carteira]}</option>)}
        </select>
        {(etapa || carteira || busca) && (
          <button type="button" className={cn(BOTAO_SECUNDARIO, "h-9")} onClick={() => { setEtapa(""); setCarteira(""); setBusca(""); setBuscaDigitada(""); }} data-testid="limpar-filtros-kanban">Limpar</button>
        )}
        {quadro.total !== null && <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--text-muted)]">{num(quadro.total)} casos no quadro</span>}
      </div>

      {quadro.pausada && (
        <p className="flex items-center gap-2 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--text-2)]" data-testid="aviso-pausada">
          <Pause className="h-3.5 w-3.5 text-[var(--danger)]" aria-hidden />
          <span><b className="text-[var(--danger)]">Régua pausada</b>{quadro.pausadaMotivo ? ` — ${quadro.pausadaMotivo}` : ""}: os casos não mudam de etapa sozinhos. O quadro continua valendo para o trabalho manual.</span>
        </p>
      )}

      {isError ? (
        <AvisoNaoCarregou aoTentarDeNovo={() => refetch()} testId="erro-kanban">Não foi possível carregar o quadro: {mensagemDoErro(error)}</AvisoNaoCarregou>
      ) : mostrarSkeleton ? (
        <div className="flex gap-3" aria-busy>{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[320px] w-[300px] flex-none rounded-lg" />)}</div>
      ) : vazio ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]" data-testid="kanban-vazio">
          <EstadoVazio Icone={KanbanSquare} titulo="Quadro vazio" descricao={escopo === "eu" ? "Nenhum caso atribuído a você. Troque para a equipe ou a fila geral, ou abra casos pela carteira." : "Nenhum caso vivo no recorte. Os casos nascem sozinhos pela régua diária, ou pela carteira."} />
        </div>
      ) : (
        <KanbanCobranca
          quadro={quadro}
          chaveDaQuery={chaveDoQuadro}
          etapas={regua?.etapas}
          hoje={hoje}
          podeAdministrar={podeAdministrar}
          acoes={acoes}
          onNegociar={abrirNegociacao}
          onCancelar={abrirCancelamento}
        />
      )}

      <p className="text-[11px] text-[var(--text-faint)]">
        Valor total no quadro: <span className="font-mono tabular-nums">{brl(quadro.colunas.filter(c => !c.fechada).reduce((s, c) => s + c.casos.reduce((t, x) => t + (x.valorAtual ?? 0), 0), 0))}</span> nos casos carregados · colunas fechadas mostram os últimos 30 dias.
      </p>

      <DialogoContato alvo={contato} aberto={contato !== null} onFechar={() => setContato(null)} />
      <DialogoNegociacao alvo={negociacao} politica={politica} aberto={negociacao !== null} onFechar={() => setNegociacao(null)} />
      <DialogoCancelamento alvo={cancelamento} aberto={cancelamento !== null} onFechar={() => setCancelamento(null)} />
    </div>
  );
}
