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
 * KPIs vêm do servidor (a rota devolve `kpis` e `total` contados sobre todos
 * os casos vivos do recorte) — nunca de `itens.length` de uma página.
 *
 * O quadro é o único lugar do trabalho do dia (pedido do dono, 06/09/2026), e
 * por isso carrega o que só a fila tinha: as colunas vêm na ORDEM DO DIA
 * (`ordem: "dia"` no storage — vencido, hoje, sem data, agendado), o card diz
 * a que faixa pertence, e os indicadores incluem "críticos".
 *
 * E o quadro é uma ESTEIRA (pedido do dono, 06/09/2026): cada coluna é um
 * posto com um VERBO — o que se faz ali para o caso sair — e a conta do que
 * está travado; e o topo mostra o FLUXO DO DIA (entraram · resolvidos), porque
 * só o estoque esconde um quadro onde entra o dobro do que sai.
 *
 * O CARD É ENXUTO (pedido do dono, 06/09/2026: "o card está muito grande"):
 * nome, documento mascarado, o valor vencido com o atraso e a faixa do dia.
 * Clicar abre o `PainelDoCaso` — a dívida inteira, todos os boletos e o
 * histórico da cobrança —, e é lá que moram a etapa da régua, o canal
 * sugerido, o follow-up, o tempo na coluna e as ações secundárias.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { carteiraDaNavegacao, caminhoNaCarteira, retornoDaCarteira, NOME_DA_CARTEIRA } from "@/components/cobranca/carteiras";
import { NavegacaoCarteiras } from "@/components/cobranca/NavegacaoCarteiras";
import { FiltroDeAtraso } from "@/components/cobranca/filtro-atraso";
import { AlarmClock, ArrowRightLeft, ClipboardList, HandCoins, KanbanSquare, Pause, Search, Siren, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ETAPA_IDS, type Carteira, type EtapaId } from "@shared/cobranca";
import { brl, Kicker, Kpi, num, Segmentado, TRACO } from "@/components/localizacao/ui";
import { AvisoNaoCarregou, BOTAO_SECUNDARIO, CabecalhoPainel, CONTROLE_CAMPO, EstadoVazio } from "@/components/painel/ui";
import { KanbanCobranca } from "@/components/cobranca/KanbanCobranca";
import { DialogoContato, type AlvoDoContato } from "@/components/cobranca/DialogoContato";
import { DialogoNegociacao, type AlvoDaNegociacao } from "@/components/cobranca/DialogoNegociacao";
import { DialogoCancelamento, type AlvoDoCancelamento } from "@/components/cobranca/DialogoCancelamento";
import { lerPolitica } from "@/components/cobranca/politica-form";
import { podeAdministrarCobranca } from "@/components/cobranca/permissoes";
import { etapaDoCard } from "@/components/cobranca/CardCaso";
import {
  API_CASOS, API_CHAT_BULLQ, API_KANBAN, API_POLITICA, API_REGUA, apiEnviarCasoParaChat, apiRecuperacao, chatProntoParaEnviar,
  DIAS_DA_RECUPERACAO, lerIntegracaoDoChat, lerKanban, lerRecuperacao, type ItemDaFila, type KpisDaFila, type RespostaDaRegua,
} from "@/components/cobranca/tipos";
import { invalidarCobranca, mensagemDoErro, useSkeletonAtrasado } from "@/components/cobranca/ui";

type Escopo = "eu" | "todos" | "geral";
const OPCOES_ESCOPO: Array<{ k: Escopo; rotulo: string }> = [
  { k: "eu", rotulo: "Minha fila" },
  { k: "todos", rotulo: "Toda a equipe" },
  { k: "geral", rotulo: "Fila geral" },
];

/** A query string do quadro — só o que a rota aceita, e nada vazio. */
export function queryDoKanban(f: { escopo: Escopo; etapa: string; carteira: string; busca: string; atraso?: string }): string {
  const p = new URLSearchParams();
  if (f.escopo === "eu") p.set("responsavel", "eu");
  if (f.escopo === "geral") p.set("responsavel", "geral");
  if (f.etapa) p.set("etapa", f.etapa);
  if (f.carteira) p.set("carteira", f.carteira);
  if (f.atraso) p.set("atraso", f.atraso);
  if (f.busca.trim()) p.set("busca", f.busca.trim());
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const MOTIVO_SEM_FLUXO_DO_DIA =
  "Fluxo de hoje: o servidor ainda não conta quantos casos entraram e quantos foram resolvidos no dia. Escrever 0 diria que o dia não rendeu — e isso a tela não sabe.";

/** O outro motivo de não haver número: a rota não varreu o recorte (o mesmo que apaga os demais indicadores). */
export const MOTIVO_RECORTE_SEM_INDICADORES =
  "Fluxo de hoje: a rota não contou os indicadores deste recorte — o quadro é grande demais para varrer. Filtre por etapa, carteira ou busca.";

const TITULO_DO_FLUXO_DO_DIA =
  "Entraram: casos abertos hoje. Resolvidos: casos encerrados hoje (pago, baixado, encerrado ou cancelamento). Contados pelo servidor sobre o mesmo recorte do quadro.";

/**
 * O FLUXO DO DIA da esteira (pedido do dono, 06/09/2026): quantos casos
 * entraram e quantos saíram resolvidos hoje. Sem os dois números a coluna
 * conta o estoque e nunca a vazão — dá para o quadro parecer estável enquanto
 * entra o dobro do que sai.
 *
 * Os números são do SERVIDOR. Enquanto a rota não os mandar, é "—" com o
 * motivo: contar aqui só daria a conta da página.
 */
export function FluxoDoDia({ kpis, carregando }: { kpis: KpisDaFila | null; carregando: boolean }) {
  const temFluxo = typeof kpis?.entraramHoje === "number" || typeof kpis?.resolvidosHoje === "number";
  const valor = (n: number | null | undefined) => (carregando ? "…" : typeof n === "number" ? num(n) : TRACO);
  return (
    <div
      className="col-span-2 flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5"
      title={temFluxo ? TITULO_DO_FLUXO_DO_DIA : kpis === null ? MOTIVO_RECORTE_SEM_INDICADORES : MOTIVO_SEM_FLUXO_DO_DIA}
      data-testid="fluxo-do-dia"
    >
      <span className="grid h-8 w-8 flex-none place-items-center rounded-md" style={{ background: temFluxo ? "var(--info-bg)" : "var(--surface-2)", color: temFluxo ? "var(--info)" : "var(--text-muted)" }}>
        <ArrowRightLeft className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <Kicker>fluxo de hoje</Kicker>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
          <span>
            <b className="font-mono text-[16px] font-medium tabular-nums text-[var(--text)]" data-testid="fluxo-entraram">{valor(kpis?.entraramHoje)}</b> entraram
          </span>
          <span>
            <b className="font-mono text-[16px] font-medium tabular-nums" style={{ color: temFluxo && (kpis?.resolvidosHoje ?? 0) > 0 ? "var(--ok)" : "var(--text)" }} data-testid="fluxo-resolvidos">{valor(kpis?.resolvidosHoje)}</b> resolvidos
          </span>
        </p>
      </div>
    </div>
  );
}

export default function KanbanPage() {
  const [caminho] = useLocation();
  const carteira = carteiraDaNavegacao(caminho, useSearch());
  return <QuadroDaCarteira key={carteira} carteira={carteira} />;
}

function QuadroDaCarteira({ carteira }: { carteira: Carteira }) {
  const { user, personificando } = useAuth();
  const { toast } = useToast();
  const [caminho] = useLocation();

  const podeAdministrar = podeAdministrarCobranca(user, personificando);
  const hoje = useMemo(() => new Date(), []);

  const [escopo, setEscopo] = useState<Escopo>("eu");
  const [etapa, setEtapa] = useState("");
  // A faixa de atraso do dono (ate 7 · 8-15 · 16-30 · 31-60 · 61-90 · +90).
  const [atraso, setAtraso] = useState("");
  const [buscaDigitada, setBuscaDigitada] = useState("");
  const [busca, setBusca] = useState("");

  const [contato, setContato] = useState<AlvoDoContato | null>(null);
  const [negociacao, setNegociacao] = useState<AlvoDaNegociacao | null>(null);
  const [cancelamento, setCancelamento] = useState<AlvoDoCancelamento | null>(null);

  const query = queryDoKanban({ escopo, etapa, carteira, busca, atraso });
  const chaveDoQuadro = useMemo(() => [`${API_KANBAN}${query}`], [query]);
  const { data, isLoading, isError, error, refetch } = useQuery<unknown>({ queryKey: chaveDoQuadro, staleTime: 15_000 });
  const { data: regua } = useQuery<RespostaDaRegua>({ queryKey: [API_REGUA], staleTime: 300_000 });
  const { data: politicaCrua } = useQuery<unknown>({ queryKey: [API_POLITICA], staleTime: 300_000 });
  const politica = useMemo(() => (politicaCrua === undefined ? null : lerPolitica(politicaCrua)), [politicaCrua]);

  const quadro = useMemo(() => lerKanban(data), [data]);
  const mostrarSkeleton = useSkeletonAtrasado(isLoading);
  const vazio = !isLoading && quadro.colunas.every(c => c.casos.length === 0);

  // O chat com o cliente (Chat BullQ): so oferece "Enviar p/ cobranca" com o numero do provedor ativo.
  const { data: integracaoCrua } = useQuery<unknown>({ queryKey: [`${API_CHAT_BULLQ}/integracao`], staleTime: 300_000 });
  const integracaoDoChat = useMemo(() => lerIntegracaoDoChat(integracaoCrua), [integracaoCrua]);
  const chatPronto = chatProntoParaEnviar(integracaoDoChat);
  const enviarParaChat = useMutation({
    mutationFn: async (item: ItemDaFila) => {
      const { etapa: e } = etapaDoCard(item, regua?.etapas);
      return (await apiRequest("POST", apiEnviarCasoParaChat(item.id), { acaoDaEtapa: e?.acao ?? undefined })).json();
    },
    onSuccess: (r: { reaproveitada?: boolean }) => {
      invalidarCobranca();
      toast({ title: r.reaproveitada ? "Conversa existente aberta" : "Primeiro contato enviado", description: "Continue pelo botão de conversa do caso, dentro de Cobrança." });
    },
    onError: (erro: Error) => toast({ title: "Não foi possível enviar para o chat", description: mensagemDoErro(erro), variant: "destructive" }),
  });

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
    // O verbo da coluna no botão do card: em contato PROPÕE, negociando REGISTRA o aceite.
    onNegociar: abrirNegociacao,
    onPegar: user ? (item: ItemDaFila) => pegar.mutate(item.id) : undefined,
    pegando: pegar.isPending,
    onEnviarParaChat: chatPronto ? (item: ItemDaFila) => enviarParaChat.mutate(item) : undefined,
    enviandoParaChat: enviarParaChat.isPending ? enviarParaChat.variables?.id ?? null : null,
    inboxUrl: integracaoDoChat?.inboxUrl ?? null,
  };

  // Só o mesmo recorte das colunas: a fila inclui casos gerais e não é uma reserva equivalente.
  const kpis = quadro.kpis;

  /**
   * O que a cobrança RECUPEROU depois de um contato (C6 do 2Safe): faturas que
   * sumiram dos pendentes do ERP numa varredura completa, até `janelaDias`
   * depois de um contato registrado. É do PROVEDOR inteiro, não do recorte do
   * quadro — a fatura é do cliente, não do caso —, e o card diz isso.
   * Sem fatura vinda do ERP o valor é "—" com o motivo, nunca R$ 0,00.
   */
  const { data: recuperacaoCrua, isLoading: carregandoRecuperacao } = useQuery<unknown>({
    queryKey: [apiRecuperacao(DIAS_DA_RECUPERACAO)],
    staleTime: 300_000,
  });
  const recuperacao = useMemo(() => (recuperacaoCrua === undefined ? null : lerRecuperacao(recuperacaoCrua)), [recuperacaoCrua]);
  const tituloDaRecuperacao = recuperacao?.base
    ? `${num(recuperacao.faturas)} fatura(s) de ${num(recuperacao.clientes)} cliente(s) baixadas no ERP até ${num(recuperacao.janelaDias)} dias depois de um contato. Pagamento provável: nenhum ERP confirma o valor pago. Vale para toda a carteira, não para o recorte do quadro.`
    : recuperacao?.motivo ?? "Indicador ainda não carregado.";

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6" data-testid="cobranca-kanban">
      <CabecalhoPainel
        titulo={`Kanban · ${NOME_DA_CARTEIRA[carteira]}`}
        descricao="A esteira da cobrança: cada coluna diz o que se faz ali para o caso sair e quantos estão travados. A coluna vem na ordem do dia — vencido, hoje, sem data, agendado. O card traz o essencial (quem, quanto, há quanto tempo); clique nele para ver a dívida inteira, todos os boletos e o histórico da cobrança."
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            <Segmentado opcoes={OPCOES_ESCOPO} valor={escopo} onChange={setEscopo} rotulo="Escopo do quadro" />
            <Link href={retornoDaCarteira(carteira)} className={BOTAO_SECUNDARIO} data-testid="link-carteira">Carteira</Link>
          </div>
        }
      />

      <NavegacaoCarteiras carteira={carteira} destino={caminho} />

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" aria-label="Indicadores" data-testid="kpis-kanban">
        <Kpi icone={<KanbanSquare className="h-4 w-4" aria-hidden />} iconeCor="var(--brand-ink)" iconeBg="var(--brand-soft)" rotulo="casos vivos" valor={isLoading ? "…" : num(kpis?.casosVivos)} sub="no recorte" />
        <Kpi icone={<AlarmClock className="h-4 w-4" aria-hidden />} iconeCor={(kpis?.vencidos ?? 0) > 0 ? "var(--danger)" : "var(--text-muted)"} iconeBg={(kpis?.vencidos ?? 0) > 0 ? "var(--danger-bg)" : "var(--surface-2)"} rotulo="contato vencido" valor={isLoading ? "…" : num(kpis?.vencidos)} valorCor={(kpis?.vencidos ?? 0) > 0 ? "var(--danger)" : undefined} sub="passou da data" />
        <Kpi icone={<AlarmClock className="h-4 w-4" aria-hidden />} iconeCor="var(--gated)" iconeBg="var(--gated-bg)" rotulo="para hoje" valor={isLoading ? "…" : num(kpis?.paraHoje)} sub="contato marcado" />
        {/* Críticos: o indicador que só a fila tinha. Prioridade crítica no MESMO recorte do quadro. */}
        <Kpi icone={<Siren className="h-4 w-4" aria-hidden />} iconeCor={(kpis?.criticos ?? 0) > 0 ? "var(--danger)" : "var(--text-muted)"} iconeBg={(kpis?.criticos ?? 0) > 0 ? "var(--danger-bg)" : "var(--surface-2)"} rotulo="críticos" valor={isLoading ? "…" : num(kpis?.criticos)} valorCor={(kpis?.criticos ?? 0) > 0 ? "var(--danger)" : undefined} sub="prioridade crítica" />
        {/* Follow-up: caso sem proxima acao vira divida perdida — o quadro conta quantos estao parados. */}
        <Kpi icone={<ClipboardList className="h-4 w-4" aria-hidden />} iconeCor={(kpis?.semProximaAcao ?? 0) > 0 ? "var(--danger)" : "var(--text-muted)"} iconeBg={(kpis?.semProximaAcao ?? 0) > 0 ? "var(--danger-bg)" : "var(--surface-2)"} rotulo="sem próxima ação" valor={isLoading ? "…" : num(kpis?.semProximaAcao)} valorCor={(kpis?.semProximaAcao ?? 0) > 0 ? "var(--danger)" : undefined} sub="caso parado vira dívida perdida" />
        <Kpi icone={<HandCoins className="h-4 w-4" aria-hidden />} iconeCor="var(--money-neg)" iconeBg="var(--past-bg)" rotulo="em aberto" valor={isLoading ? "…" : brl(kpis?.emAberto)} valorCor={(kpis?.emAberto ?? 0) > 0 ? "var(--money-neg)" : undefined} sub="soma dos casos vivos" />
        {/* Recuperado: o único indicador que não sai do quadro — ver o comentário em `recuperacao`. */}
        <Kpi
          icone={<TrendingUp className="h-4 w-4" aria-hidden />}
          iconeCor={recuperacao?.base ? "var(--ok)" : "var(--text-muted)"}
          iconeBg={recuperacao?.base ? "var(--ok-bg)" : "var(--surface-2)"}
          rotulo="recuperado"
          valor={carregandoRecuperacao ? "…" : recuperacao?.base ? brl(recuperacao.valor) : TRACO}
          valorCor={recuperacao?.base && (recuperacao.valor ?? 0) > 0 ? "var(--ok)" : undefined}
          sub={`${DIAS_DA_RECUPERACAO} dias · após contato · toda a carteira`}
          titulo={tituloDaRecuperacao}
        />
        <FluxoDoDia kpis={kpis} carregando={isLoading} />
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
        <FiltroDeAtraso valor={atraso} onChange={setAtraso} carteira={carteira} />
        <select className={cn(CONTROLE_CAMPO, "w-auto")} value={etapa} onChange={e => setEtapa(e.target.value)} aria-label="Etapa da régua" data-testid="filtro-etapa">
          <option value="">Todas as etapas</option>
          {(regua?.etapas ?? []).map(e => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
          {!regua && ETAPA_IDS.map(id => <option key={id} value={id}>{id}</option>)}
        </select>

        {(etapa || atraso || busca) && (
          <button type="button" className={cn(BOTAO_SECUNDARIO, "h-9")} onClick={() => { setEtapa(""); setAtraso(""); setBusca(""); setBuscaDigitada(""); }} data-testid="limpar-filtros-kanban">Limpar</button>
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

      <p className="text-[11px] text-[var(--text-faint)]" data-testid="rodape-kanban">
        <span data-testid="ordem-do-dia" title="A ordem vem do servidor, sobre a coluna inteira — não é a página reordenada na tela.">
          Cada coluna vem na <b className="font-medium text-[var(--text-2)]">ordem do dia</b>: contato vencido (o mais antigo primeiro), depois o de hoje, depois o que está sem data — o caso parado — e por fim os agendados; a prioridade crítica sobe dentro de cada faixa.
        </span>{" "}
        Valor total no quadro: <span className="font-mono tabular-nums">{brl(quadro.colunas.filter(c => !c.fechada).reduce((s, c) => s + c.casos.reduce((t, x) => t + (x.valorAtual ?? 0), 0), 0))}</span> nos casos carregados · colunas fechadas mostram os últimos 30 dias, do encerramento mais recente para o mais antigo.
      </p>

      <DialogoContato alvo={contato} aberto={contato !== null} onFechar={() => setContato(null)} />
      <DialogoNegociacao alvo={negociacao} politica={politica} aberto={negociacao !== null} onFechar={() => setNegociacao(null)} />
      <DialogoCancelamento alvo={cancelamento} aberto={cancelamento !== null} onFechar={() => setCancelamento(null)} />
    </div>
  );
}
