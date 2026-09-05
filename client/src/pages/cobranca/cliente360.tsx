/**
 * /cobranca/cliente/:id — a ficha 360 do cliente na cobrança.
 *
 * O molde é o Cliente 360 do Provedor.ai: cabeçalho de identidade, o
 * cluster de números (fatura em aberto · score · endereço · régua), as ações
 * do funcionário e as três colunas Passado/Recuperar · Presente/Defender ·
 * Futuro/Conquistar, com a linha do tempo no fim.
 *
 * O que a fase 1 não tem (fatura a fatura, NPS, CSAT, LTV, propensão) fica
 * marcado "fase 2" no lugar em que vai morar — nunca preenchido com zero.
 * Toda mudança de estado do caso passa pelas máquinas de
 * `shared/cobranca/estados.ts`: o select só oferece o que a transição permite.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  ArrowLeft, Ban, CheckCheck, Coins, FileText, HandCoins, History, MapPin, MessageCircle, Milestone, PhoneCall, Route, ShieldCheck,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  CRONICO_DIAS_ATRASO_ACIMA_DE, CRONICO_FATURAS_ABERTAS_MIN, DIRETIVA_POR_TOM, PRIORIDADES, ROTULO_CONFIABILIDADE, ROTULO_FIDELIDADE,
  ROTULO_MOTIVO_SEM_ETAPA, ROTULO_PRIORIDADE, ROTULO_STATUS_DE_CASO, ROTULO_STATUS_DE_NEGOCIACAO, ROTULO_STATUS_DE_PARCELA,
  ROTULO_TIPO_DE_NEGOCIACAO, STATUS_ABERTOS_DE_CASO, STATUS_FECHADOS_DE_CASO, TRANSICOES_DE_CASO, TRANSICOES_DE_NEGOCIACAO,
  janelaDaEtapa, negociacaoEncerrada, pct, prescrita,
  type Confiabilidade, type Fidelidade, type MotivoSemEtapa, type Prioridade, type StatusDeCaso, type StatusDeNegociacao, type StatusDeParcela,
  type StatusFechadoDeCaso, type TipoDeNegociacao, type Tom,
} from "@shared/cobranca";
import { brl, Kicker, num, TRACO } from "@/components/localizacao/ui";
import {
  AvisoNaoCarregou, BOTAO_MARCA, BOTAO_SECUNDARIO, CabecalhoPainel, Campo, CONTROLE_CAMPO, CONTROLE_CAMPO_MULTILINHA, EstadoVazio, TabelaPainel, Td, Th,
} from "@/components/painel/ui";
import { DialogoAbrirCaso } from "@/components/cobranca/DialogoAbrirCaso";
import { DialogoContato, type AlvoDoContato } from "@/components/cobranca/DialogoContato";
import { DialogoNegociacao, type AlvoDaNegociacao } from "@/components/cobranca/DialogoNegociacao";
import { LinhaDoTempo } from "@/components/cobranca/LinhaDoTempo";
import { dataBr, dataCivilBr, dataHoraBr, deInputDataHora, faixaDoScore, paraInputDataHora, proximoContato, tempoDeCasa, whatsappDe } from "@/components/cobranca/formatacao";
import { podeAdministrarCobranca } from "@/components/cobranca/permissoes";
import { lerPolitica } from "@/components/cobranca/politica-form";
import { API_EQUIPE, API_POLITICA, api360, lerEquipe, numero, ROTA_CARTEIRA, ROTA_REGUA, type CasoDetalhe, type Cliente360, type NegociacaoDeCobranca } from "@/components/cobranca/tipos";
import {
  Avatar, BarraDeScore, Cartao, GRADE_LINHAS, invalidarCobranca, Linha, LinkWhatsapp, mensagemDoErro, PilulaAtraso, SeloCarteira, SeloCobranca, SeloErp, SeloFase2,
  SeloPrioridade, SeloQuadrante, SeloStatusCaso, SeloTom, Traco, useSkeletonAtrasado,
} from "@/components/cobranca/ui";

const COR_DO_HORIZONTE = { passado: "var(--past)", presente: "var(--info)", futuro: "var(--ok)" } as const;

/** Espelho de `STATUS_PELA_NEGOCIACAO` da rota: o storage grava esses três junto com a negociação, numa transação só. */
const STATUS_SO_PELA_NEGOCIACAO: ReadonlySet<string> = new Set(["aberto", "negociando", "acordo_ativo"]);

function Coluna({ horizonte, verbo, sub, children, testId }: { horizonte: keyof typeof COR_DO_HORIZONTE; verbo: string; sub: string; children: ReactNode; testId?: string }) {
  const rotulo = horizonte === "passado" ? "Passado" : horizonte === "presente" ? "Presente" : "Futuro";
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]" style={{ borderTop: `3px solid ${COR_DO_HORIZONTE[horizonte]}` }} data-testid={testId}>
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <SeloCobranca tom={horizonte === "passado" ? "past" : horizonte === "presente" ? "info" : "ok"}>{rotulo}</SeloCobranca>
        <h2 className="text-[14px] font-semibold text-[var(--text)]">{verbo}</h2>
        <span className="ml-auto text-[11px] text-[var(--text-muted)]">{sub}</span>
      </header>
      <div className="flex flex-col gap-3.5 px-4 py-3.5">{children}</div>
    </section>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <Kicker>{rotulo}</Kicker>
      <div className="mt-1 text-[12.5px] text-[var(--text-2)]">{children}</div>
    </div>
  );
}

interface FormDoCaso {
  status: string;
  prioridade: string;
  responsavelUserId: string;
  proximoContatoEm: string;
}

const formDoCaso = (caso: CasoDetalhe | null): FormDoCaso => ({
  status: caso?.status ?? "",
  prioridade: caso?.prioridade ?? "normal",
  responsavelUserId: caso?.responsavelUserId ? String(caso.responsavelUserId) : "",
  proximoContatoEm: paraInputDataHora(caso?.proximoContatoEm),
});

export default function Cliente360Page() {
  const { id } = useParams<{ id: string }>();
  const customerId = Number(id);
  const { toast } = useToast();
  const { user, personificando } = useAuth();
  const podeAdministrar = podeAdministrarCobranca(user, personificando);
  const hoje = useMemo(() => new Date(), []);

  const { data, isLoading, isError, error, refetch } = useQuery<Cliente360>({
    queryKey: [api360(customerId)],
    enabled: Number.isFinite(customerId) && customerId > 0,
    staleTime: 15_000,
  });
  const { data: politicaCrua } = useQuery<unknown>({ queryKey: [API_POLITICA], staleTime: 300_000 });
  const politica = useMemo(() => (politicaCrua === undefined ? null : lerPolitica(politicaCrua)), [politicaCrua]);
  const { data: equipeCrua } = useQuery<unknown>({ queryKey: [API_EQUIPE], staleTime: 300_000 });
  const equipe = useMemo(() => lerEquipe(equipeCrua), [equipeCrua]);
  const mostrarSkeleton = useSkeletonAtrasado(isLoading);

  const cliente = data?.cliente ?? null;
  const caso = data?.caso ?? null;
  const [form, setForm] = useState<FormDoCaso>(() => formDoCaso(null));
  // Só quando troca de caso: o refetch não pode apagar o que o operador está editando.
  useEffect(() => { setForm(formDoCaso(caso)); }, [caso?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [contato, setContato] = useState<AlvoDoContato | null>(null);
  const [negociacao, setNegociacao] = useState<AlvoDaNegociacao | null>(null);
  const [abrirCaso, setAbrirCaso] = useState(false);
  const [fechar, setFechar] = useState<{ status: StatusFechadoDeCaso; motivo: string } | null>(null);

  const salvarCaso = useMutation({
    mutationFn: async () => {
      if (!caso) throw new Error("Sem caso aberto");
      const corpo: Record<string, unknown> = {};
      if (form.status && form.status !== caso.status) corpo.status = form.status;
      if (form.prioridade !== caso.prioridade) corpo.prioridade = form.prioridade;
      const responsavelAtual = caso.responsavelUserId ? String(caso.responsavelUserId) : "";
      if (form.responsavelUserId !== responsavelAtual) corpo.responsavelUserId = form.responsavelUserId ? Number(form.responsavelUserId) : null;
      const proximo = deInputDataHora(form.proximoContatoEm);
      if ((proximo ?? null) !== (caso.proximoContatoEm ? new Date(caso.proximoContatoEm).toISOString() : null)) corpo.proximoContatoEm = proximo;
      if (Object.keys(corpo).length === 0) throw new Error("Nada mudou para salvar");
      return (await apiRequest("PATCH", `/api/cobranca/casos/${caso.id}`, corpo)).json();
    },
    onSuccess: () => { invalidarCobranca(); toast({ title: "Caso atualizado" }); },
    onError: (erro: Error) => toast({ title: "Não foi possível salvar o caso", description: mensagemDoErro(erro), variant: "destructive" }),
  });

  const fecharCaso = useMutation({
    mutationFn: async () => {
      if (!caso || !fechar) throw new Error("Sem caso aberto");
      return (await apiRequest("PATCH", `/api/cobranca/casos/${caso.id}`, { status: fechar.status, ...(fechar.motivo.trim() ? { motivo: fechar.motivo.trim() } : {}) })).json();
    },
    onSuccess: () => { invalidarCobranca(); toast({ title: `Caso ${ROTULO_STATUS_DE_CASO[fechar!.status].toLowerCase()}` }); setFechar(null); },
    onError: (erro: Error) => toast({ title: "Não foi possível fechar o caso", description: mensagemDoErro(erro), variant: "destructive" }),
  });

  // O storage só acha negociação e parcela pelo caso: `casoId`/`negociacaoId` vão no corpo.
  const mudarNegociacao = useMutation({
    mutationFn: async ({ id: negociacaoId, casoId, status }: { id: number; casoId: number; status: StatusDeNegociacao }) =>
      (await apiRequest("PATCH", `/api/cobranca/negociacoes/${negociacaoId}`, { casoId, status })).json(),
    onSuccess: (_d, v) => { invalidarCobranca(); toast({ title: `Negociação ${ROTULO_STATUS_DE_NEGOCIACAO[v.status].toLowerCase()}` }); },
    onError: (erro: Error) => toast({ title: "Não foi possível mudar a negociação", description: mensagemDoErro(erro), variant: "destructive" }),
  });

  const pagarParcela = useMutation({
    mutationFn: async ({ id: parcelaId, negociacaoId, valor }: { id: number; negociacaoId: number; valor: number }) =>
      (await apiRequest("POST", `/api/cobranca/parcelas/${parcelaId}/pagar`, { negociacaoId, valorPago: valor, pagoEm: new Date().toISOString() })).json(),
    onSuccess: () => { invalidarCobranca(); toast({ title: "Parcela paga" }); },
    onError: (erro: Error) => toast({ title: "Não foi possível baixar a parcela", description: mensagemDoErro(erro), variant: "destructive" }),
  });

  if (!Number.isFinite(customerId) || customerId <= 0) {
    return <div className="p-6"><AvisoNaoCarregou>Endereço inválido: falta o cliente.</AvisoNaoCarregou></div>;
  }

  const exCliente = cliente?.carteira === "ex_cliente";
  const casa = cliente ? tempoDeCasa(cliente.contractStartDate, hoje, exCliente) : null;
  const score = cliente?.ispScore ?? null;
  const faixa = score !== null ? faixaDoScore(score) : null;
  const whatsapp = cliente ? (cliente.whatsapp ?? whatsappDe(cliente.telefone)) : null;
  const regua = data?.regua ?? null;
  const dna = data?.dna ?? null;
  const tom = (caso?.tom ?? dna?.tom ?? dna?.abordagem ?? null) as Tom | null;
  const statusDoCaso = caso?.status as StatusDeCaso | undefined;
  // Aberto, negociando e acordo ativo só mudam PELA negociação (a rota recusa
  // o PATCH direto): no select sobra o que o funcionário declara — negativar.
  const transicoesVivas = statusDoCaso
    ? TRANSICOES_DE_CASO[statusDoCaso].filter(s => (STATUS_ABERTOS_DE_CASO as readonly string[]).includes(s) && !STATUS_SO_PELA_NEGOCIACAO.has(s))
    : [];
  const responsavelDeOutro = !!caso && caso.responsavelUserId !== null && caso.responsavelUserId !== user?.id;
  const transicoesFechadas = statusDoCaso ? TRANSICOES_DE_CASO[statusDoCaso].filter(s => (STATUS_FECHADOS_DE_CASO as readonly string[]).includes(s)) as StatusFechadoDeCaso[] : [];
  const contatoProximo = caso ? proximoContato(caso.proximoContatoEm, hoje) : null;
  const dividaPrescrita = cliente ? prescrita(cliente.diasAtraso) : false;

  const alvoDoContato = (): AlvoDoContato | null => (caso && cliente ? { casoId: caso.id, clienteNome: cliente.nome, canalSugerido: regua?.etapa?.canalSugerido ?? null } : null);

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6" data-testid="cobranca-cliente-360">
      <Link href={ROTA_CARTEIRA} className="inline-flex w-fit items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]" data-testid="voltar-carteira">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> carteira de cobrança
      </Link>

      {isError ? (
        <AvisoNaoCarregou aoTentarDeNovo={() => refetch()} testId="erro-360">Não foi possível carregar o cliente: {mensagemDoErro(error)}</AvisoNaoCarregou>
      ) : mostrarSkeleton || !cliente ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-[132px] rounded-lg" />
          <div className="grid gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[92px] rounded-lg" />)}</div>
          <div className="grid gap-3 lg:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-[320px] rounded-lg" />)}</div>
        </div>
      ) : (
        <>
          {/* Cabeçalho de identidade */}
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4" data-testid="cabecalho-360">
            <div className="flex flex-wrap items-start gap-4">
              <Avatar nome={cliente.nome} tamanho="lg" />
              <div className="min-w-[240px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[21px] font-medium leading-tight tracking-[var(--track-tight)] text-[var(--text)]" data-testid="nome-cliente">{cliente.nome}</h1>
                  <SeloErp status={cliente.statusErp} />
                  <SeloCarteira carteira={cliente.carteira} />
                  <SeloQuadrante quadrante={dna?.quadrante ?? caso?.quadranteDna ?? null} />
                  <SeloTom tom={tom} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[var(--text-muted)]">
                  <span title="O sync do ERP não traz o plano — fase 2">plano {cliente.plano ? <b className="text-[var(--text-2)]">{cliente.plano}</b> : <Traco />}</span>
                  <span className="font-mono tabular-nums" title="Em claro só na ficha: aqui o operador confere a identidade" data-testid="documento-cliente">{cliente.documento ?? cliente.documentoMascarado}</span>
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                    <PhoneCall className="h-3 w-3" aria-hidden /> {cliente.telefone ?? TRACO}
                    {whatsapp && <LinkWhatsapp whatsapp={whatsapp} nome={cliente.nome}><MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp</LinkWhatsapp>}
                  </span>
                  <span data-testid="tempo-de-casa">{casa ?? <span title="Sem data de contrato no ERP">cliente há <Traco /></span>}</span>
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden /> {cliente.cidade ?? TRACO}{cliente.uf ? `/${cliente.uf}` : ""}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2" data-testid="acoes-360">
                {caso ? (
                  <>
                    <button type="button" className={BOTAO_MARCA} onClick={() => setContato(alvoDoContato())} data-testid="acao-registrar-contato"><PhoneCall className="h-3.5 w-3.5" aria-hidden /> Registrar contato</button>
                    <button type="button" className={BOTAO_SECUNDARIO} disabled={dividaPrescrita} title={dividaPrescrita ? ROTULO_MOTIVO_SEM_ETAPA.prescrita : undefined} onClick={() => setNegociacao({ casoId: caso.id, clienteNome: cliente.nome, valorAtual: caso.valorAtual })} data-testid="acao-abrir-negociacao"><HandCoins className="h-3.5 w-3.5" aria-hidden /> Abrir negociação</button>
                  </>
                ) : (
                  <button type="button" className={BOTAO_MARCA} onClick={() => setAbrirCaso(true)} data-testid="acao-abrir-caso"><Milestone className="h-3.5 w-3.5" aria-hidden /> Abrir caso</button>
                )}
                <Link href={`${ROTA_REGUA}?carteira=${cliente.carteira}`} className={BOTAO_SECUNDARIO} data-testid="acao-ver-regua"><Route className="h-3.5 w-3.5" aria-hidden /> Ver na régua</Link>
                <a href="#linha-do-tempo" className={BOTAO_SECUNDARIO} data-testid="acao-historico"><History className="h-3.5 w-3.5" aria-hidden /> Histórico</a>
              </div>
            </div>
          </section>

          {/* O cluster de números */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="cluster-360">
            <Cartao kicker="fatura em aberto" testId="card-divida">
              <p className={cn("font-mono text-[24px] font-light tabular-nums tracking-[-0.028em]", cliente.dividaAtual > 0 ? "text-[var(--money-neg)]" : "text-[var(--ok)]")} data-testid="valor-divida">
                {cliente.dividaAtual > 0 ? brl(cliente.dividaAtual) : "em dia"}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--text-muted)]">
                <PilulaAtraso dias={cliente.diasAtraso} />
                <span className="font-mono tabular-nums">{cliente.faturasAbertas !== null ? `${num(cliente.faturasAbertas)} fatura${cliente.faturasAbertas === 1 ? "" : "s"} vencida${cliente.faturasAbertas === 1 ? "" : "s"}` : TRACO}</span>
              </div>
              {data?.divida?.atualizado && data.divida.atualizado.total > data.divida.atualizado.principal && (
                <p className="mt-1.5 font-mono text-[11px] tabular-nums text-[var(--text-muted)]" title="Principal + multa + juros pro rata, pela política do provedor" data-testid="valor-atualizado">
                  atualizada <b className="text-[var(--text)]">{brl(data.divida.atualizado.total)}</b> · multa {brl(data.divida.atualizado.multa)} · juros {brl(data.divida.atualizado.juros)}
                </p>
              )}
              {dividaPrescrita && <p className="mt-1.5 text-[11px] text-[var(--danger)]">{ROTULO_MOTIVO_SEM_ETAPA.prescrita} (5 anos)</p>}
            </Cartao>
            <Cartao kicker="score de crédito" testId="card-score">
              <p className="font-mono text-[24px] font-light tabular-nums tracking-[-0.028em]" style={{ color: faixa?.cor ?? "var(--text-faint)" }} data-testid="valor-score">
                {score !== null ? score : TRACO}<span className="ml-1 text-[12px] text-[var(--text-faint)]">/1000</span>
              </p>
              <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-[var(--text-muted)]">
                <BarraDeScore score={score} cor={faixa?.cor ?? "var(--border-strong)"} />
                <span>{faixa?.rotulo ?? "sem score"}</span>
              </div>
              {cliente.riskTier && <p className="mt-1 text-[11px] text-[var(--text-faint)]">risco {cliente.riskTier}</p>}
            </Cartao>
            <Cartao kicker="endereço" testId="card-endereco">
              <p className="text-[12.5px] leading-5 text-[var(--text-2)]">
                {cliente.endereco ?? <Traco />}<br />
                {[cliente.bairro, cliente.cidade && (cliente.uf ? `${cliente.cidade}/${cliente.uf}` : cliente.cidade)].filter(Boolean).join(" · ") || TRACO}
                {cliente.cep && <span className="ml-1 font-mono tabular-nums text-[var(--text-muted)]">· {cliente.cep}</span>}
              </p>
            </Cartao>
            <Cartao kicker="régua" testId="card-regua">
              {regua?.etapa ? (
                <>
                  <p className="text-[13.5px] font-semibold text-[var(--text)]">{regua.etapa.rotulo} <span className="font-mono text-[11px] font-normal tabular-nums text-[var(--text-muted)]">{janelaDaEtapa(regua.etapa)}</span></p>
                  <p className="mt-1 text-[11.5px] leading-4 text-[var(--text-2)]">{regua.etapa.acao}</p>
                </>
              ) : (
                <p className="text-[12.5px] text-[var(--text-muted)]">{regua?.motivoRotulo ?? (regua?.motivo ? (ROTULO_MOTIVO_SEM_ETAPA[regua.motivo as MotivoSemEtapa] ?? regua.motivo) : <Traco titulo="A rota não informou a etapa" />)}</p>
              )}
            </Cartao>
          </section>

          {/* Três horizontes */}
          <div className="grid gap-3 lg:grid-cols-3">
            <Coluna horizonte="passado" verbo="Recuperar" sub="dívida & acordos" testId="coluna-passado">
              <Item rotulo="dívida de hoje">
                {cliente.dividaAtual > 0 ? <><b className="font-mono tabular-nums text-[var(--money-neg)]">{brl(cliente.dividaAtual)}</b> · a fatura mais antiga com <span className="font-mono tabular-nums">{cliente.diasAtraso}</span> dias</> : <span className="text-[var(--ok)]">sem dívida</span>}
                {caso && caso.valorAbertura !== caso.valorAtual && <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">na abertura do caso: <span className="font-mono tabular-nums">{brl(caso.valorAbertura)}</span> · {caso.diasAtrasoAbertura} dias</p>}
              </Item>
              <Item rotulo="faturas vencidas, uma a uma"><SeloFase2 /> <span className="text-[11px] text-[var(--text-faint)]">o sync grava só o agregado</span></Item>

              <Item rotulo={`negociações (${num(data?.negociacoes.length ?? 0)})`}>
                {(data?.negociacoes.length ?? 0) === 0 ? <span className="text-[var(--text-faint)]">nenhuma proposta ainda</span> : (
                  <div className="flex flex-col gap-2" data-testid="lista-negociacoes">
                    {data!.negociacoes.map(n => (
                      <CartaoNegociacao key={n.id} n={n} onStatus={status => mudarNegociacao.mutate({ id: n.id, casoId: n.casoId, status })} onPagar={(parcelaId, valor) => pagarParcela.mutate({ id: parcelaId, negociacaoId: n.id, valor })} ocupado={mudarNegociacao.isPending || pagarParcela.isPending} />
                    ))}
                  </div>
                )}
              </Item>

              <Item rotulo={`equipamentos (${num(data?.equipamentos.length ?? 0)})`}>
                {(data?.equipamentos.length ?? 0) === 0 ? <span className="text-[var(--text-faint)]">nenhum equipamento em comodato</span> : (
                  <ul className="space-y-1" data-testid="lista-equipamentos">
                    {data!.equipamentos.map(e => (
                      <li key={e.id} className="flex items-baseline justify-between gap-2">
                        <span>{[e.tipo, e.marca, e.modelo].filter(Boolean).join(" ")} <span className="font-mono text-[10.5px] tabular-nums text-[var(--text-muted)]">{e.serie ?? e.mac ?? ""}</span></span>
                        <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">{e.status}{e.valor !== null ? ` · ${brl(e.valor)}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Item>

              {(data?.recuperacao?.length ?? 0) > 0 && (
                <Item rotulo="recuperação de equipamento em curso">
                  <ul className="space-y-1" data-testid="lista-recuperacao">
                    {data!.recuperacao!.map(r => (
                      <li key={r.id} className="flex items-center justify-between gap-2">
                        <span>{[r.equipamento.tipo, r.equipamento.marca, r.equipamento.modelo].filter(Boolean).join(" ")} <span className="font-mono text-[10.5px] tabular-nums text-[var(--text-muted)]">{r.equipamento.serie ?? ""}</span></span>
                        <Link href="/recuperacao" className="font-mono text-[11px] tabular-nums text-[var(--brand)] hover:underline">{r.status} · prazo {dataBr(r.prazoEm)}</Link>
                      </li>
                    ))}
                  </ul>
                </Item>
              )}

              {(data?.casosAnteriores.length ?? 0) > 0 && (
                <Item rotulo={`casos anteriores (${num(data!.casosAnteriores.length)})`}>
                  <ul className="space-y-1" data-testid="casos-anteriores">
                    {data!.casosAnteriores.map(c => (
                      <li key={c.id} className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2"><SeloStatusCaso status={c.status} /> <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">{dataBr(c.abertoEm)} → {dataBr(c.encerradoEm)}</span></span>
                        <span className="font-mono text-[11px] tabular-nums">{brl(c.valorAbertura)}</span>
                      </li>
                    ))}
                  </ul>
                </Item>
              )}
            </Coluna>

            <Coluna horizonte="presente" verbo="Defender" sub="caso & régua" testId="coluna-presente">
              {!caso ? (
                <EstadoVazio Icone={Milestone} titulo="Sem caso de cobrança aberto" descricao={cliente.dividaAtual > 0 ? "A régua só cobra quem tem caso: abra o caso para o cliente entrar na fila com a foto de hoje." : "Sem dívida não há o que cobrar."} cta={cliente.dividaAtual > 0 ? <button type="button" className={BOTAO_MARCA} onClick={() => setAbrirCaso(true)}>Abrir caso</button> : undefined} testId="sem-caso" />
              ) : (
                <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); salvarCaso.mutate(); }} data-testid="form-caso">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeloStatusCaso status={caso.status} testId="status-caso" />
                    <SeloPrioridade prioridade={caso.prioridade} />
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--text-muted)]">caso #{caso.id} · aberto {dataBr(caso.abertoEm)}</span>
                  </div>
                  <dl className={cn(GRADE_LINHAS, "rounded-lg bg-[var(--surface-2)] px-3 py-2")}>
                    <Linha rotulo="próximo contato" mono>
                      <span className={contatoProximo?.urgencia === "vencido" ? "text-[var(--danger)]" : undefined}>{caso.proximoContatoEm ? `${dataHoraBr(caso.proximoContatoEm)} · ${contatoProximo?.texto}` : "sem data — está na fila"}</span>
                    </Linha>
                    <Linha rotulo="último contato" mono>{caso.ultimoContatoEm ? dataHoraBr(caso.ultimoContatoEm) : "nenhum ainda"}</Linha>
                    <Linha rotulo="responsável">{caso.responsavelNome ?? <span className="text-[var(--text-faint)]">fila geral</span>}</Linha>
                  </dl>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo rotulo="situação">
                      <select className={CONTROLE_CAMPO} value={form.status} onChange={e => setForm(a => ({ ...a, status: e.target.value }))} data-testid="select-status-caso">
                        <option value={caso.status}>{ROTULO_STATUS_DE_CASO[statusDoCaso!] ?? caso.status}</option>
                        {transicoesVivas.map(s => <option key={s} value={s}>→ {ROTULO_STATUS_DE_CASO[s]}</option>)}
                      </select>
                    </Campo>
                    <Campo rotulo="prioridade">
                      <select className={CONTROLE_CAMPO} value={form.prioridade} onChange={e => setForm(a => ({ ...a, prioridade: e.target.value }))} data-testid="select-prioridade">
                        {PRIORIDADES.map(p => <option key={p} value={p}>{ROTULO_PRIORIDADE[p as Prioridade]}</option>)}
                      </select>
                    </Campo>
                    <Campo rotulo="responsável">
                      {/* Operador só pega o caso para si ou o devolve à fila quando é dele — o que a rota permite. */}
                      <select className={CONTROLE_CAMPO} value={form.responsavelUserId} disabled={!podeAdministrar && responsavelDeOutro} title={podeAdministrar ? undefined : responsavelDeOutro ? "Caso de outro operador: só o administrador reatribui" : "Pegue o caso para você ou devolva à fila geral"} onChange={e => setForm(a => ({ ...a, responsavelUserId: e.target.value }))} data-testid="select-responsavel">
                        <option value="">fila geral</option>
                        {podeAdministrar
                          ? equipe.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)
                          : user && <option value={user.id}>{user.name} (eu)</option>}
                      </select>
                    </Campo>
                    <Campo rotulo="próximo contato">
                      <input type="datetime-local" className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")} value={form.proximoContatoEm} onChange={e => setForm(a => ({ ...a, proximoContatoEm: e.target.value }))} data-testid="input-proximo-contato" />
                    </Campo>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className={BOTAO_MARCA} disabled={salvarCaso.isPending} data-testid="salvar-caso">{salvarCaso.isPending ? "Salvando…" : "Salvar caso"}</button>
                    {transicoesFechadas.map(s => (
                      <button key={s} type="button" className={cn(BOTAO_SECUNDARIO, s === "pago" && "text-[var(--ok)]")} onClick={() => setFechar({ status: s, motivo: "" })} data-testid={`fechar-${s}`}>
                        {s === "pago" ? <CheckCheck className="h-3.5 w-3.5" aria-hidden /> : <Ban className="h-3.5 w-3.5" aria-hidden />} {ROTULO_STATUS_DE_CASO[s]}
                      </button>
                    ))}
                  </div>
                </form>
              )}

              <Item rotulo="dna — como falar">
                {dna ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2"><SeloQuadrante quadrante={dna.quadrante} /> <span>{ROTULO_FIDELIDADE[dna.fidelidade as Fidelidade] ?? dna.fidelidade} · {ROTULO_CONFIABILIDADE[dna.confiabilidade as Confiabilidade] ?? dna.confiabilidade}</span> <SeloTom tom={tom} /></div>
                    {tom && <p className="mt-1.5 text-[12px] leading-4">{DIRETIVA_POR_TOM[tom]}</p>}
                    {dna.historicoInsuficiente && <p className="mt-1 text-[10.5px] text-[var(--text-faint)]">confiabilidade só do atraso atual ({CRONICO_FATURAS_ABERTAS_MIN}+ faturas ou &gt;{CRONICO_DIAS_ATRASO_ACIMA_DE} d = crônico) — sem histórico de faturas pagas na fase 1</p>}
                  </>
                ) : (
                  <span className="text-[var(--text-faint)]">sem DNA: o ERP não informou a data do contrato</span>
                )}
              </Item>
              <Item rotulo="saúde do relacionamento (NPS · CSAT)"><SeloFase2 motivo="NPS e CSAT não existem no schema — fase 2" /></Item>
            </Coluna>

            <Coluna horizonte="futuro" verbo="Conquistar" sub="o que vem depois" testId="coluna-futuro">
              <Item rotulo="plano atual → próximo">{cliente.plano ? <>{cliente.plano} → <Traco /></> : <><Traco titulo="O sync não traz o plano" /> <span className="text-[11px] text-[var(--text-faint)]">plano não vem do sync</span></>}</Item>
              <Item rotulo="pagou o mês · a vencer · sem fatura"><SeloFase2 /> <span className="text-[11px] text-[var(--text-faint)]">precisa de fatura a fatura</span></Item>
              <Item rotulo="propensão a pagar / upsell"><SeloFase2 motivo="Propensão não existe no schema — fase 2" /></Item>
              <Item rotulo="ltv · unit economics"><SeloFase2 motivo="LTV precisa do plano e das faturas pagas — fase 2" /></Item>
              {(data?.pendentes?.length ?? 0) > 0 && (
                <Item rotulo="o que esta base ainda não tem">
                  <ul className="space-y-0.5 text-[11px] text-[var(--text-muted)]" data-testid="lista-pendentes">
                    {data!.pendentes!.map(p => <li key={p.campo}><span className="font-mono text-[var(--text-2)]">{p.campo}</span> · {p.motivo}</li>)}
                  </ul>
                </Item>
              )}
              <Item rotulo="indicação · rede colaborativa">
                <span className="inline-flex items-center gap-1 text-[12px]"><ShieldCheck className="h-3.5 w-3.5 text-[var(--brand)]" aria-hidden /> a dívida em aberto já entra no score da rede Consulta ISP</span>
              </Item>
            </Coluna>
          </div>

          <section id="linha-do-tempo" className="scroll-mt-4" data-testid="secao-linha-do-tempo">
            <div className="mb-2 flex items-center justify-between">
              <Kicker>linha do tempo</Kicker>
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">{num(data?.eventos.length ?? 0)} eventos</span>
            </div>
            <LinhaDoTempo eventos={data?.eventos ?? []} testId="linha-do-tempo" />
          </section>
        </>
      )}

      <DialogoContato alvo={contato} aberto={contato !== null} onFechar={() => setContato(null)} />
      <DialogoNegociacao alvo={negociacao} politica={politica} aberto={negociacao !== null} onFechar={() => setNegociacao(null)} />
      <DialogoAbrirCaso
        cliente={cliente ? { customerId: cliente.id, nome: cliente.nome, carteira: cliente.carteira, dividaAtual: cliente.dividaAtual, diasAtraso: cliente.diasAtraso } : null}
        equipe={equipe}
        podeAtribuir={podeAdministrar}
        usuarioAtual={user ? { id: user.id, nome: user.name } : null}
        aberto={abrirCaso}
        onFechar={() => setAbrirCaso(false)}
      />

      <Dialog open={fechar !== null} onOpenChange={open => { if (!open) setFechar(null); }}>
        <DialogContent className="sm:max-w-[460px]" data-testid="dialogo-fechar-caso">
          <DialogHeader>
            <DialogTitle>{fechar ? `Marcar como ${ROTULO_STATUS_DE_CASO[fechar.status].toLowerCase()}?` : ""}</DialogTitle>
            <DialogDescription>Caso fechado é definitivo: para voltar a cobrar, abre-se um caso novo.</DialogDescription>
          </DialogHeader>
          <Campo rotulo="motivo (opcional)">
            <textarea className={CONTROLE_CAMPO_MULTILINHA} value={fechar?.motivo ?? ""} onChange={e => setFechar(a => (a ? { ...a, motivo: e.target.value } : a))} placeholder={fechar?.status === "pago" ? "Ex.: pagou o PIX na ligação" : "Ex.: valor abaixo do custo de cobrar"} />
          </Campo>
          <DialogFooter>
            <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setFechar(null)}>Cancelar</button>
            <button type="button" className={BOTAO_MARCA} disabled={fecharCaso.isPending} onClick={() => fecharCaso.mutate()} data-testid="confirmar-fechar">{fecharCaso.isPending ? "Fechando…" : "Confirmar"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Uma negociação com as parcelas e as transições que a máquina de estado permite. */
function CartaoNegociacao({ n, onStatus, onPagar, ocupado }: {
  n: NegociacaoDeCobranca;
  onStatus: (status: StatusDeNegociacao) => void;
  onPagar: (parcelaId: number, valor: number) => void;
  ocupado: boolean;
}) {
  const status = n.status as StatusDeNegociacao;
  // "Cumprida" nasce da última parcela paga, nunca de um botão: a rota recusa.
  const proximas = (TRANSICOES_DE_NEGOCIACAO[status] ?? []).filter(s => s !== "cumprida");
  const encerrada = negociacaoEncerrada(n.status);
  const tomDoStatus = status === "cumprida" || status === "ativa" || status === "aceita" ? "ok" : status === "quebrada" ? "danger" : status === "cancelada" ? "neutro" : "gated";
  const valorOriginal = numero(n.valorOriginal) ?? 0;
  const valorNegociado = numero(n.valorNegociado) ?? 0;
  const entrada = numero(n.entrada) ?? 0;
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", encerrada ? "border-[var(--border)] bg-[var(--surface-2)]" : "border-[var(--gated-border)] bg-[var(--gated-bg)]/40")} data-testid={`negociacao-${n.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[12.5px] text-[var(--text)]">{ROTULO_TIPO_DE_NEGOCIACAO[n.tipo as TipoDeNegociacao] ?? n.tipo}</b>
        <SeloCobranca tom={tomDoStatus}>{ROTULO_STATUS_DE_NEGOCIACAO[status] ?? n.status}</SeloCobranca>
        <span className="ml-auto font-mono text-[10.5px] tabular-nums text-[var(--text-muted)]">{dataBr(n.createdAt)}</span>
      </div>
      <p className="mt-1 font-mono text-[12px] tabular-nums text-[var(--text-2)]">
        {brl(valorOriginal)} → <b className="text-[var(--text)]">{brl(valorNegociado)}</b> · desconto {pct(numero(n.descontoPct) ?? 0)}
        {n.tipo === "parcelamento" && <> · entrada {brl(entrada)} · {n.parcelas}× {n.valorParcela !== null ? brl(numero(n.valorParcela) ?? 0) : ""}</>}
      </p>
      {n.parcelamento.length > 0 && (
        <TabelaPainel className="mt-2">
          <thead><tr><Th>parcela</Th><Th>vencimento</Th><Th alinhamento="direita">valor</Th><Th>situação</Th><Th /></tr></thead>
          <tbody>
            {n.parcelamento.map(p => {
              const valor = numero(p.valor) ?? 0;
              const pendente = p.status === "pendente" || p.status === "atrasada";
              return (
                <tr key={p.id}>
                  <Td num alinhamento="esquerda">{p.numero}/{n.parcelamento.length}</Td>
                  <Td num alinhamento="esquerda">{dataCivilBr(p.vencimento)}</Td>
                  <Td num>{brl(valor)}</Td>
                  <Td><SeloCobranca tom={p.status === "paga" ? "ok" : p.status === "atrasada" ? "danger" : p.status === "cancelada" ? "neutro" : "gated"}>{ROTULO_STATUS_DE_PARCELA[p.status as StatusDeParcela] ?? p.status}</SeloCobranca>{p.pagoEm && <span className="ml-1 font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{dataBr(p.pagoEm)}</span>}</Td>
                  <Td alinhamento="direita">{pendente && !encerrada && <button type="button" className={cn(BOTAO_SECUNDARIO, "!min-h-7 px-2 text-[11px]")} disabled={ocupado} onClick={() => onPagar(p.id, valor)} data-testid={`pagar-parcela-${p.id}`}><Coins className="h-3 w-3" aria-hidden /> pagar</button>}</Td>
                </tr>
              );
            })}
          </tbody>
        </TabelaPainel>
      )}
      {proximas.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {proximas.map(s => (
            <button key={s} type="button" className={cn(BOTAO_SECUNDARIO, "!min-h-7 px-2 text-[11px]", s === "quebrada" && "text-[var(--danger)]")} disabled={ocupado} onClick={() => onStatus(s)} data-testid={`negociacao-${n.id}-${s}`}>
              {s === "aceita" ? "cliente aceitou" : s === "ativa" ? "começou a pagar" : s === "quebrada" ? "quebrou o acordo" : "cancelar"}
            </button>
          ))}
        </div>
      )}
      <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-[var(--text-faint)]"><FileText className="h-3 w-3" aria-hidden /> {n.aceitaEm ? `aceita em ${dataBr(n.aceitaEm)}` : "proposta"}{n.quebradaEm ? ` · quebrada em ${dataBr(n.quebradaEm)}` : ""}{n.primeiroVencimento ? ` · 1º vencimento ${dataCivilBr(n.primeiroVencimento)}` : ""}</p>
    </div>
  );
}
