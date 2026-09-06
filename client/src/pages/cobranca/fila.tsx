/**
 * /cobranca/fila — a fila do dia do funcionário.
 *
 * `GET /api/cobranca/fila?responsavel=eu|todos`: os casos dele mais a fila
 * geral (sem responsável), já na ordem do servidor — prioridade, vencidos
 * primeiro, depois a data do próximo contato, depois o valor. A tela separa
 * "para hoje" (vencido, hoje ou sem data) de "agendados", diz a ação da
 * etapa e o tom do DNA, e abre o diálogo de contato sem sair da fila.
 *
 * A etapa de cada linha é a gravada no caso (`etapaAtual`); quando o motor
 * ainda não a preencheu, a tela a deriva do atraso com a régua do provedor —
 * e diz que foi derivada.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { carteiraDaNavegacao, caminhoNaCarteira, retornoDaCarteira, NOME_DA_CARTEIRA } from "@/components/cobranca/carteiras";
import { NavegacaoCarteiras } from "@/components/cobranca/NavegacaoCarteiras";
import { AlarmClock, CalendarClock, HandCoins, ListTodo, MessageCircle, Pause, PhoneCall, UserRound } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { etapaParaAtraso, etapaPorId, janelaDaEtapa, ROTULO_CANAL, ROTULO_MOTIVO_SEM_ETAPA, type Carteira, type Etapa, type EtapaId, type MotivoSemEtapa } from "@shared/cobranca";
import { brl, Kpi, num, Segmentado, TRACO } from "@/components/localizacao/ui";
import { AvisoNaoCarregou, BOTAO_MARCA, BOTAO_SECUNDARIO, CabecalhoPainel, EstadoVazio, FOCO } from "@/components/painel/ui";
import { DialogoContato, type AlvoDoContato } from "@/components/cobranca/DialogoContato";
import { dataHoraBr, proximoContato, whatsappDe, type UrgenciaDoContato } from "@/components/cobranca/formatacao";
import { API_CASOS, API_FILA, API_REGUA, lerRespostaDaFila, ROTA_KANBAN, ROTA_REGUA, rotaDoCliente, type ItemDaFila, type RespostaDaRegua } from "@/components/cobranca/tipos";
import { Avatar, invalidarCobranca, LinkWhatsapp, mensagemDoErro, PilulaAtraso, SeloCarteira, SeloPrioridade, SeloQuadrante, SeloStatusCaso, SeloTom, Traco, useSkeletonAtrasado } from "@/components/cobranca/ui";

type Escopo = "eu" | "todos";
const OPCOES_ESCOPO: Array<{ k: Escopo; rotulo: string }> = [
  { k: "eu", rotulo: "Minha fila" },
  { k: "todos", rotulo: "Toda a equipe" },
];

const PARA_HOJE: ReadonlySet<UrgenciaDoContato> = new Set(["vencido", "hoje", "sem_data"]);

interface EtapaDaLinha {
  etapa: Etapa | null;
  motivo: string | null;
  derivada: boolean;
}

/**
 * A ação de HOJE: a etapa que a rota calculou para o atraso atual (`regua`);
 * sem ela, a gravada no caso; sem as duas, a régua roda aqui — e a linha diz
 * que foi derivada, para o operador saber que o motor ainda não gravou.
 */
export function etapaDaLinha(item: ItemDaFila, etapas: readonly Etapa[] | undefined): EtapaDaLinha {
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

export default function FilaPage() {
  const [caminho] = useLocation();
  const carteira = carteiraDaNavegacao(caminho, useSearch());
  return <FilaDaCarteira key={carteira} carteira={carteira} />;
}

function FilaDaCarteira({ carteira }: { carteira: Carteira }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [caminho] = useLocation();

  const [escopo, setEscopo] = useState<Escopo>("eu");
  const [contato, setContato] = useState<AlvoDoContato | null>(null);
  const hoje = useMemo(() => new Date(), []);

  const { data, isLoading, isError, error, refetch } = useQuery<unknown>({ queryKey: [`${API_FILA}?responsavel=${escopo}&carteira=${carteira}`], staleTime: 30_000 });
  const { data: regua } = useQuery<RespostaDaRegua>({ queryKey: [API_REGUA], staleTime: 300_000 });
  const mostrarSkeleton = useSkeletonAtrasado(isLoading);

  const fila = useMemo(() => lerRespostaDaFila(data), [data]);
  const itens = fila.itens;
  const kpis = fila.kpis;

  // "Pegar para mim": a rota deixa o operador se atribuir um caso da fila geral.
  const pegar = useMutation({
    mutationFn: async (casoId: number) => (await apiRequest("PATCH", `${API_CASOS}/${casoId}`, { responsavelUserId: user?.id })).json(),
    onSuccess: () => { invalidarCobranca(); toast({ title: "Caso é seu" }); },
    onError: (erro: Error) => toast({ title: "Não foi possível pegar o caso", description: mensagemDoErro(erro), variant: "destructive" }),
  });
  const { paraHoje, agendados } = useMemo(() => {
    const paraHojeLista: ItemDaFila[] = [];
    const agendadosLista: ItemDaFila[] = [];
    for (const item of itens) (PARA_HOJE.has(proximoContato(item.proximoContatoEm, hoje).urgencia) ? paraHojeLista : agendadosLista).push(item);
    return { paraHoje: paraHojeLista, agendados: agendadosLista };
  }, [itens, hoje]);

  const criticos = kpis?.criticos ?? null;
  const valorTotal = kpis?.emAberto ?? null;

  const abrirContato = (item: ItemDaFila) => {
    const { etapa } = etapaDaLinha(item, regua?.etapas);
    setContato({ casoId: item.id, clienteNome: item.cliente.nome, canalSugerido: etapa?.canalSugerido ?? null });
  };

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6" data-testid="cobranca-fila">
      <CabecalhoPainel
        titulo={`Fila do dia · ${NOME_DA_CARTEIRA[carteira]}`}
        descricao={`O que ${escopo === "eu" ? (user?.name ?? "você") : "a equipe"} tem para cobrar hoje: os casos atribuídos mais a fila geral, na ordem de prioridade e vencimento do contato.`}
        testIdTitulo="titulo-fila"
        acoes={
          <>
            <Segmentado opcoes={OPCOES_ESCOPO} valor={escopo} onChange={setEscopo} rotulo="Escopo da fila" />
            <Link href={caminhoNaCarteira(ROTA_KANBAN, carteira)} className={BOTAO_SECUNDARIO} data-testid="link-kanban">Kanban</Link>
            <Link href={retornoDaCarteira(carteira)} className={BOTAO_SECUNDARIO} data-testid="link-carteira">Carteira</Link>
          </>
        }
      />

      <NavegacaoCarteiras carteira={carteira} destino={caminho} />

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" aria-label="Indicadores" data-testid="kpis-fila">
        <Kpi icone={<ListTodo className="h-4 w-4" aria-hidden />} iconeCor="var(--brand-ink)" iconeBg="var(--brand-soft)" rotulo="na fila" valor={isLoading ? "…" : num(fila.total)} sub={escopo === "eu" ? "seus casos + fila geral" : "todos os casos vivos"} />
        <Kpi icone={<AlarmClock className="h-4 w-4" aria-hidden />} iconeCor={(kpis?.paraHoje ?? 0) > 0 ? "var(--gated)" : "var(--text-muted)"} iconeBg={(kpis?.paraHoje ?? 0) > 0 ? "var(--gated-bg)" : "var(--surface-inset)"} rotulo="para hoje" valor={isLoading ? "…" : num(kpis?.paraHoje)} sub="vencidos, de hoje ou sem data" />
        <Kpi icone={<AlarmClock className="h-4 w-4" aria-hidden />} iconeCor={(criticos ?? 0) > 0 ? "var(--danger)" : "var(--text-muted)"} iconeBg={(criticos ?? 0) > 0 ? "var(--danger-bg)" : "var(--surface-inset)"} rotulo="críticos" valor={isLoading ? "…" : num(criticos)} valorCor={(criticos ?? 0) > 0 ? "var(--danger)" : undefined} sub="prioridade crítica" />
        <Kpi icone={<HandCoins className="h-4 w-4" aria-hidden />} iconeCor="var(--money-neg)" iconeBg="var(--past-bg)" rotulo="valor na fila" valor={isLoading ? "…" : brl(valorTotal)} valorCor={(valorTotal ?? 0) > 0 ? "var(--money-neg)" : undefined} sub="soma do valor atual dos casos" />
      </section>

      {fila.total !== null && fila.total > itens.length && !isLoading && (
        <p className="text-[12px] text-[var(--text-muted)]" data-testid="fila-limitada">Exibindo {num(itens.length)} de {num(fila.total)} casos desta carteira. Os indicadores consideram a fila inteira; a lista prioriza os primeiros casos.</p>
      )}

      {fila.pausada && (
        <p className="flex items-center gap-2 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--text-2)]" data-testid="aviso-pausada">
          <Pause className="h-3.5 w-3.5 text-[var(--danger)]" aria-hidden />
          <span><b className="text-[var(--danger)]">Régua pausada</b>{fila.pausadaMotivo ? ` — ${fila.pausadaMotivo}` : ""}: os casos não mudam de etapa. A fila continua; retome em <Link href={caminhoNaCarteira(ROTA_REGUA, carteira)} className="underline">Régua e DNA</Link>.</span>
        </p>
      )}

      {isError ? (
        <AvisoNaoCarregou aoTentarDeNovo={() => refetch()} testId="erro-fila">Não foi possível carregar a fila: {mensagemDoErro(error)}</AvisoNaoCarregou>
      ) : mostrarSkeleton ? (
        <div className="space-y-2" aria-busy>{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[92px] rounded-lg" />)}</div>
      ) : !isLoading && itens.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <EstadoVazio Icone={ListTodo} titulo="Fila vazia" descricao={escopo === "eu" ? "Nenhum caso atribuído a você nem na fila geral. Os casos nascem na carteira, a partir da dívida que o ERP informa." : "Nenhum caso vivo na cobrança."} cta={<Link href={retornoDaCarteira(carteira)} className={BOTAO_MARCA}>Ir para a carteira</Link>} testId="fila-vazia" />
        </div>
      ) : (
        <>
          <Grupo titulo="para hoje" contagem={paraHoje.length} tom="gated" testId="grupo-hoje">
            {paraHoje.map(item => <LinhaDaFila key={item.id} item={item} etapas={regua?.etapas} hoje={hoje} onContato={() => abrirContato(item)} onPegar={item.responsavelUserId === null && user ? () => pegar.mutate(item.id) : undefined} pegando={pegar.isPending} />)}
            {paraHoje.length === 0 && <p className="px-3 py-3 text-[12px] text-[var(--text-muted)]">Nada vencido: tudo o que está na fila tem contato marcado para depois.</p>}
          </Grupo>
          {agendados.length > 0 && (
            <Grupo titulo="agendados" contagem={agendados.length} tom="neutro" testId="grupo-agendados">
              {agendados.map(item => <LinhaDaFila key={item.id} item={item} etapas={regua?.etapas} hoje={hoje} onContato={() => abrirContato(item)} onPegar={item.responsavelUserId === null && user ? () => pegar.mutate(item.id) : undefined} pegando={pegar.isPending} />)}
            </Grupo>
          )}
        </>
      )}

      <DialogoContato alvo={contato} aberto={contato !== null} onFechar={() => setContato(null)} />
    </div>
  );
}

function Grupo({ titulo, contagem, tom, children, testId }: { titulo: string; contagem: number; tom: "gated" | "neutro"; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId}>
      <header className="mb-1.5 flex items-center gap-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{titulo}</h2>
        <span className={cn("rounded px-1.5 font-mono text-[10.5px] font-semibold tabular-nums", tom === "gated" ? "bg-[var(--gated-bg)] text-[var(--gated)]" : "bg-[var(--surface-inset)] text-[var(--text-muted)]")}>{num(contagem)}</span>
      </header>
      <div className="divide-y divide-[var(--border-faint)] rounded-lg border border-[var(--border)] bg-[var(--surface)]" role="list">{children}</div>
    </section>
  );
}

function LinhaDaFila({ item, etapas, hoje, onContato, onPegar, pegando }: {
  item: ItemDaFila; etapas: readonly Etapa[] | undefined; hoje: Date; onContato: () => void; onPegar?: () => void; pegando?: boolean;
}) {
  const { cliente } = item;
  const { etapa, motivo, derivada } = etapaDaLinha(item, etapas);
  const contato = proximoContato(item.proximoContatoEm, hoje);
  const whatsapp = whatsappDe(cliente.telefone);
  // O tom de AGORA (a rota reclassifica a cada leitura); a foto gravada no caso é a rede.
  const tom = item.tomSugerido ?? item.tom;
  const quadrante = item.quadrante ?? item.quadranteDna;
  return (
    <article role="listitem" className="grid gap-3 px-3 py-3 lg:grid-cols-[minmax(220px,1.2fr)_minmax(240px,1.6fr)_minmax(150px,0.8fr)_auto]" data-testid={`fila-caso-${item.id}`}>
      <div className="flex min-w-0 items-start gap-2.5">
        <Avatar nome={cliente.nome} />
        <div className="min-w-0">
          <Link href={rotaDoCliente(cliente.id, item.carteira)} className={cn("block truncate text-[13px] font-semibold text-[var(--text)] hover:underline", FOCO)} data-testid={`fila-abrir-360-${item.id}`}>{cliente.nome}</Link>
          <p className="truncate font-mono text-[11px] tabular-nums text-[var(--text-muted)]">{cliente.cpfCnpj}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1 font-mono text-[11px] tabular-nums text-[var(--text-2)]">
            <PhoneCall className="h-3 w-3 text-[var(--text-faint)]" aria-hidden /> {cliente.telefone ?? TRACO}
            {whatsapp && <LinkWhatsapp whatsapp={whatsapp} nome={cliente.nome}><MessageCircle className="h-3.5 w-3.5" aria-hidden /></LinkWhatsapp>}
            {cliente.cidade && <span className="font-sans text-[var(--text-muted)]">· {cliente.bairro ? `${cliente.bairro}, ` : ""}{cliente.cidade}</span>}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1"><SeloCarteira carteira={item.carteira} /><SeloStatusCaso status={item.status} /><SeloPrioridade prioridade={item.prioridade} /></div>
        </div>
      </div>

      <div className="min-w-0">
        {etapa ? (
          <>
            <p className="text-[12.5px] font-semibold text-[var(--text)]">
              {etapa.rotulo} <span className="font-mono text-[10.5px] font-normal tabular-nums text-[var(--text-muted)]">{janelaDaEtapa(etapa)}</span>
              {derivada && <span className="ml-1 text-[10px] font-normal text-[var(--text-faint)]" title="O motor ainda não gravou a etapa neste caso; esta é a que a régua dá para o atraso de hoje">· derivada do atraso</span>}
            </p>
            <p className="mt-0.5 text-[12px] leading-4 text-[var(--text-2)]">{etapa.acao}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
              canal sugerido <b className="text-[var(--text-2)]">{ROTULO_CANAL[etapa.canalSugerido]}</b> · tom <SeloTom tom={tom} /> <SeloQuadrante quadrante={quadrante} />
            </p>
          </>
        ) : (
          <p className="text-[12px] text-[var(--text-muted)]">{motivo ?? <Traco />}</p>
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <dt className="text-[var(--text-faint)]">dívida</dt>
        <dd className="font-mono tabular-nums text-[var(--money-neg)]">{brl(item.valorAtual)}</dd>
        <dt className="text-[var(--text-faint)]">atraso</dt>
        <dd><PilulaAtraso dias={cliente.diasAtraso} /></dd>
        <dt className="flex items-center gap-1 text-[var(--text-faint)]"><UserRound className="h-3 w-3" aria-hidden /></dt>
        <dd className="truncate text-[var(--text-2)]">{item.responsavelNome ?? <span className="text-[var(--text-faint)]">fila geral</span>}</dd>
        <dt className="flex items-center gap-1 text-[var(--text-faint)]"><CalendarClock className="h-3 w-3" aria-hidden /></dt>
        <dd className={cn("font-mono tabular-nums", contato.urgencia === "vencido" ? "text-[var(--danger)]" : "text-[var(--text-2)]")} title={item.proximoContatoEm ? dataHoraBr(item.proximoContatoEm) : undefined}>{contato.texto}</dd>
        <dt className="text-[var(--text-faint)]">último</dt>
        <dd className="font-mono tabular-nums text-[var(--text-2)]">{item.ultimoContatoEm ? dataHoraBr(item.ultimoContatoEm) : "nenhum"}</dd>
      </dl>

      <div className="flex flex-row flex-wrap gap-2 lg:flex-col">
        <button type="button" className={BOTAO_MARCA} onClick={onContato} data-testid={`fila-contato-${item.id}`}><PhoneCall className="h-3.5 w-3.5" aria-hidden /> Registrar contato</button>
        {onPegar && <button type="button" className={BOTAO_SECUNDARIO} disabled={pegando} onClick={onPegar} data-testid={`fila-pegar-${item.id}`}><UserRound className="h-3.5 w-3.5" aria-hidden /> Pegar para mim</button>}
        <Link href={rotaDoCliente(cliente.id, item.carteira)} className={BOTAO_SECUNDARIO}>Cliente 360</Link>
      </div>
    </article>
  );
}
