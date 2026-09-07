/**
 * /cobranca/cliente/:id — o Cliente 360, no molde LITERAL do Provedor.ai.
 *
 * Decisão do dono (05/09/2026): "os clientes precisam ter o cliente 360
 * exatamente igual no provedor.ai". A ordem, os rótulos e as fórmulas são os
 * de `modules/cobranca/cliente360/index.tsx` de lá: breadcrumb, Hero (nome ·
 * Fatura em aberto · Score de crédito · Economia R24 · Endereço · ações), os
 * três horizontes Passado/Recuperar · Presente/Defender · Futuro/Conquistar
 * com as 24 seções `<Let>`, a Economia R24 com o simulador de cancelamento,
 * e o Transversal (linha do tempo · compliance · memória).
 *
 * A REGRA DE OURO de lá vale aqui: todo campo tem origem real OU sai como
 * `—` / PENDENTE / A-CRIAR com o motivo — nunca zero disfarçado de medida.
 * O que muda é quem executa: o funcionário no lugar do agente. A ação da
 * régua é o "próximo passo", o responsável do caso é o "agente da vez", e o
 * gate de compliance é o administrador.
 *
 * Duas fontes: a ficha do banco (`/360`, com `ficha` já montada) e o ERP ao
 * vivo (`/360/ao-vivo`), que traz plano, data de contrato, motivo do corte e
 * aparelhos com MAC. Quando ele responde, a ficha é REMONTADA aqui com o
 * mesmo `montarFicha360` do servidor — uma fórmula, dois lugares.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "wouter";
import { carteiraDaNavegacao } from "@/components/cobranca/carteiras";
import {
  AlertTriangle, ArrowLeft, Ban, CheckCheck, ChevronRight, CircleDashed, Coins, FileSignature, FileText, GitBranch, Hammer, History,
  Info, Inbox, Lock, MapPin, MessageCircle, MessagesSquare, Milestone, PhoneCall, QrCode, RefreshCw, Settings, Shield, ShieldCheck, Sparkles,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  bandLabel, clienteStatusMeta, corDaBandaDeCredito, dnaToneOf, healthLabelMeta, montarFicha360,
  DIRETIVA_POR_TOM, PRIORIDADES, ROTULO_CANAL, ROTULO_MOTIVO_SEM_ETAPA, ROTULO_PRIORIDADE, ROTULO_STATUS_DE_CASO,
  ROTULO_STATUS_DE_NEGOCIACAO, ROTULO_STATUS_DE_PARCELA, ROTULO_TIPO_DE_NEGOCIACAO, STATUS_ABERTOS_DE_CASO, STATUS_FECHADOS_DE_CASO,
  TRANSICOES_DE_CASO, TRANSICOES_DE_NEGOCIACAO, janelaDaEtapa, negociacaoEncerrada, pct,
  type EconomiaLedger, type Ficha360, type MotivoSemEtapa, type Prioridade, type StatusDeCaso, type StatusDeNegociacao, type StatusDeParcela,
  type StatusFechadoDeCaso, type TipoDeNegociacao, type Tom, type Tom360,
} from "@shared/cobranca";
import { brl, Kicker, num, TRACO } from "@/components/localizacao/ui";
import { AvisoNaoCarregou, BOTAO_MARCA, BOTAO_SECUNDARIO, Campo, CONTROLE_CAMPO, CONTROLE_CAMPO_MULTILINHA, EstadoVazio, TabelaPainel, Td, Th } from "@/components/painel/ui";
import { DialogoAbrirCaso } from "@/components/cobranca/DialogoAbrirCaso";
import { DialogoContato, type AlvoDoContato } from "@/components/cobranca/DialogoContato";
import { DialogoNegociacao, type AlvoDaNegociacao } from "@/components/cobranca/DialogoNegociacao";
import { LinhaDoTempo } from "@/components/cobranca/LinhaDoTempo";
import { dataBr, dataCivilBr, dataHoraBr, deInputDataHora, paraInputDataHora, proximoContato, whatsappDe } from "@/components/cobranca/formatacao";
import { podeAdministrarCobranca } from "@/components/cobranca/permissoes";
import { lerPolitica } from "@/components/cobranca/politica-form";
import { ConversaDoChat } from "@/components/cobranca/ConversaDoChat";
import { IdentificacaoTecnica, origemDoSnapshot, SeloOrigem } from "@/components/cobranca/IdentificacaoTecnica";
import {
  API_CHAT_BULLQ, API_EQUIPE, API_POLITICA, api360, api360AoVivo, apiEnviarCasoParaChat, chatProntoParaEnviar, lerEquipe, lerIntegracaoDoChat, numero, ROTA_CARTEIRA_ATIVOS, ROTA_CARTEIRA_EX, ROTA_POLITICA, ROTA_REGUA,
  type CasoDetalhe, type Cliente360, type EquipamentoDoCliente, type NegociacaoDeCobranca, type SnapshotAoVivo,
} from "@/components/cobranca/tipos";
import {
  Avatar, invalidarCobranca, LinkWhatsapp, mensagemDoErro, SeloCobranca, SeloQuadrante, SeloStatusCaso, SeloPrioridade, Traco, useSkeletonAtrasado,
  type TomDeSelo,
} from "@/components/cobranca/ui";

/* ── Primitivos do Provedor.ai, no vocabulário de tokens daqui ─────────── */

/** Os seis tons de lá → os selos daqui (`now` = --info, `future` = --ok, `care` = --danger). */
const TOM: Record<Tom360, TomDeSelo> = { ok: "ok", now: "info", past: "past", gold: "gated", care: "danger", future: "ok" };
const COR_DO_HORIZONTE = { passado: "var(--past)", presente: "var(--info)", futuro: "var(--ok)" } as const;
const SELO_HORIZONTE = { passado: { tom: "past", rotulo: "Passado" }, presente: { tom: "info", rotulo: "Presente" }, futuro: { tom: "ok", rotulo: "Futuro" } } as const;
const DASH = "—";

function Pill({ tone, title, children, compact }: { tone: Tom360; title?: string; children: ReactNode; compact?: boolean }) {
  return <SeloCobranca tom={TOM[tone]} titulo={title} className={cn("normal-case tracking-normal", compact && "px-1.5 py-0.5")}>{children}</SeloCobranca>;
}

/** O `<Pendente>` do Provedor.ai: texto fixo, motivo no title. */
function Pendente({ motivo, ext }: { motivo: string; ext?: string }) {
  return (
    <SeloCobranca tom="gated" titulo={motivo + (ext ? ` · ${ext}` : "")} className="normal-case tracking-normal">
      <CircleDashed className="h-3 w-3" aria-hidden /> PENDENTE{ext ? ` · ${ext}` : ""}
    </SeloCobranca>
  );
}

/** O `<ACriar>` do Provedor.ai: sem backend ainda. */
function ACriar({ oque }: { oque: string }) {
  return (
    <SeloCobranca tom="neutro" titulo={`Sem backend ainda — A-CRIAR: ${oque}`} className="normal-case tracking-normal">
      <Hammer className="h-3 w-3" aria-hidden /> A-CRIAR
    </SeloCobranca>
  );
}

function Let({ k, children, testId }: { k: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{k}</span>
      <span className="text-[12.5px] leading-5 text-[var(--text-2)]">{children}</span>
    </div>
  );
}

const Divider = () => <div className="h-px bg-[var(--border-faint)]" />;

function HorizonteCol({ kind, titulo, sub, children, testId }: { kind: keyof typeof COR_DO_HORIZONTE; titulo: string; sub: string; children: ReactNode; testId?: string }) {
  const selo = SELO_HORIZONTE[kind];
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]" style={{ borderTop: `3px solid ${COR_DO_HORIZONTE[kind]}` }} data-testid={testId}>
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <SeloCobranca tom={selo.tom}>{selo.rotulo}</SeloCobranca>
        <h3 className="text-[15px] font-semibold text-[var(--text)]">{titulo}</h3>
        <span className="ml-auto text-[11.5px] text-[var(--text-muted)]">{sub}</span>
      </header>
      <div className="flex flex-col gap-3.5 px-4 py-3.5">{children}</div>
    </section>
  );
}

const H4 = "mb-3 font-mono text-[11px] font-semibold uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]";
const CARD = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4";
const SUBCARD = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4";
const NUM = "font-mono tabular-nums";

const money = (n: number | null | undefined) => brl(n ?? 0);

/* ── Estado do caso (o formulário do funcionário) ──────────────────────── */

/** Espelho de `STATUS_PELA_NEGOCIACAO` da rota: o storage grava esses três junto com a negociação, numa transação só. */
const STATUS_SO_PELA_NEGOCIACAO: ReadonlySet<string> = new Set(["aberto", "negociando", "acordo_ativo"]);

interface FormDoCaso { status: string; prioridade: string; responsavelUserId: string; proximoContatoEm: string }
const formDoCaso = (caso: CasoDetalhe | null): FormDoCaso => ({
  status: caso?.status ?? "",
  prioridade: caso?.prioridade ?? "normal",
  responsavelUserId: caso?.responsavelUserId ? String(caso.responsavelUserId) : "",
  proximoContatoEm: paraInputDataHora(caso?.proximoContatoEm),
});

/* ── Equipamento: banco ∪ ERP ao vivo ──────────────────────────────────── */

interface EquipamentoDaFicha { chave: string; tipo: string | null; marca: string | null; modelo: string | null; serie: string | null; mac: string | null; status: string; valor: number | null; fonte: "sync" | "erp ao vivo" }

function unirEquipamentos(doBanco: EquipamentoDoCliente[], snapshot: SnapshotAoVivo | undefined): EquipamentoDaFicha[] {
  const lista: EquipamentoDaFicha[] = doBanco.map(e => ({ chave: `db-${e.id}`, tipo: e.tipo, marca: e.marca, modelo: e.modelo, serie: e.serie, mac: e.mac, status: e.status, valor: e.valor, fonte: "sync" }));
  const chaves = new Set(lista.flatMap(e => [e.serie, e.mac].filter(Boolean).map(x => String(x).toUpperCase())));
  for (const e of snapshot?.cliente?.equipamentos ?? []) {
    const ids = [e.serie, e.mac].filter(Boolean).map(x => String(x).toUpperCase());
    if (ids.some(id => chaves.has(id))) {
      // O aparelho já está no banco: o MAC ao vivo completa o que o sync não tinha.
      const alvo = lista.find(x => [x.serie, x.mac].filter(Boolean).map(v => String(v).toUpperCase()).some(v => ids.includes(v)));
      if (alvo && !alvo.mac && e.mac) alvo.mac = e.mac;
      continue;
    }
    lista.push({ chave: `erp-${ids[0] ?? lista.length}`, tipo: e.tipo, marca: e.marca, modelo: e.modelo, serie: e.serie, mac: e.mac, status: e.emRecuperacao ? "em_cobranca" : "em_comodato", valor: e.valor, fonte: "erp ao vivo" });
  }
  return lista;
}

/* ── A página ──────────────────────────────────────────────────────────── */

export default function Cliente360Page() {
  const { id } = useParams<{ id: string }>();
  const customerId = Number(id);
  const carteiraDeOrigem = carteiraDaNavegacao(`/cobranca/cliente/${id}`, useSearch());
  const { toast } = useToast();
  const { user, personificando } = useAuth();
  const podeAdministrar = podeAdministrarCobranca(user, personificando);
  const hoje = useMemo(() => new Date(), []);
  const idValido = Number.isFinite(customerId) && customerId > 0;

  const { data, isLoading, isError, error, refetch } = useQuery<Cliente360>({ queryKey: [api360(customerId)], enabled: idValido, staleTime: 15_000 });
  const { data: snapshot, isFetching: lendoErp, refetch: relerErp } = useQuery<SnapshotAoVivo>({ queryKey: [api360AoVivo(customerId)], enabled: idValido && !!data, staleTime: 10 * 60_000 });
  const { data: politicaCrua } = useQuery<unknown>({ queryKey: [API_POLITICA], staleTime: 300_000 });
  const politica = useMemo(() => (politicaCrua === undefined ? null : lerPolitica(politicaCrua)), [politicaCrua]);
  const { data: equipeCrua } = useQuery<unknown>({ queryKey: [API_EQUIPE], staleTime: 300_000 });
  const equipe = useMemo(() => lerEquipe(equipeCrua), [equipeCrua]);
  const mostrarSkeleton = useSkeletonAtrasado(isLoading);
  const { data: integracaoCrua } = useQuery<unknown>({ queryKey: [`${API_CHAT_BULLQ}/integracao`], staleTime: 300_000 });
  const integracaoDoChat = useMemo(() => lerIntegracaoDoChat(integracaoCrua), [integracaoCrua]);
  const chatPronto = chatProntoParaEnviar(integracaoDoChat);

  const cliente = data?.cliente ?? null;
  const caso = data?.caso ?? null;
  const vivo = snapshot?.ok && snapshot.encontrado ? snapshot.cliente : null;

  // A ficha REMONTADA com o que o ERP disse agora — o mesmo montarFicha360 do servidor.
  const ficha: Ficha360 | null = useMemo(() => {
    if (!data?.ficha) return null;
    if (!data.fichaEntrada || !vivo) return data.ficha;
    return montarFicha360({
      ...data.fichaEntrada,
      hoje,
      statusErp: vivo.statusContrato ?? data.fichaEntrada.statusErp,
      contractStartDate: data.fichaEntrada.contractStartDate ?? vivo.contractStartDate,
      cortadoEm: data.fichaEntrada.cortadoEm ?? vivo.cortadoEm,
      plano: vivo.plano,
      economia: politica?.economia ?? null,
      historicoPagamento: null,
    });
  }, [data, vivo, politica, hoje]);

  const plano = vivo?.plano ?? cliente?.plano ?? null;
  const contractStartDate = cliente?.contractStartDate ?? vivo?.contractStartDate ?? null;
  const equipamentos = useMemo(() => unirEquipamentos(data?.equipamentos ?? [], snapshot), [data?.equipamentos, snapshot]);

  const [form, setForm] = useState<FormDoCaso>(() => formDoCaso(null));
  useEffect(() => { setForm(formDoCaso(caso)); }, [caso?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [contato, setContato] = useState<AlvoDoContato | null>(null);
  const [negociacao, setNegociacao] = useState<AlvoDaNegociacao | null>(null);
  const [abrirCaso, setAbrirCaso] = useState(false);
  const [fechar, setFechar] = useState<{ status: StatusFechadoDeCaso; motivo: string } | null>(null);
  const [confissao, setConfissao] = useState(false);

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
  const mudarNegociacao = useMutation({
    mutationFn: async ({ id: negociacaoId, casoId, status }: { id: number; casoId: number; status: StatusDeNegociacao }) =>
      (await apiRequest("PATCH", `/api/cobranca/negociacoes/${negociacaoId}`, { casoId, status })).json(),
    onSuccess: (_d, v) => { invalidarCobranca(); toast({ title: `Negociação ${ROTULO_STATUS_DE_NEGOCIACAO[v.status].toLowerCase()}` }); },
    onError: (erro: Error) => toast({ title: "Não foi possível mudar a negociação", description: mensagemDoErro(erro), variant: "destructive" }),
  });
  const enviarParaChat = useMutation({
    mutationFn: async () => {
      if (!caso) throw new Error("Sem caso aberto");
      return (await apiRequest("POST", apiEnviarCasoParaChat(caso.id), { acaoDaEtapa: data?.regua?.etapa?.acao ?? undefined })).json();
    },
    onSuccess: (r: { reaproveitada?: boolean }) => { invalidarCobranca(); toast({ title: r.reaproveitada ? "Conversa existente aberta" : "Primeiro contato enviado pelo chat" }); },
    onError: (erro: Error) => toast({ title: "Não foi possível enviar para o chat", description: mensagemDoErro(erro), variant: "destructive" }),
  });
  const pagarParcela = useMutation({
    mutationFn: async ({ id: parcelaId, negociacaoId, valor }: { id: number; negociacaoId: number; valor: number }) =>
      (await apiRequest("POST", `/api/cobranca/parcelas/${parcelaId}/pagar`, { negociacaoId, valorPago: valor, pagoEm: new Date().toISOString() })).json(),
    onSuccess: () => { invalidarCobranca(); toast({ title: "Parcela paga" }); },
    onError: (erro: Error) => toast({ title: "Não foi possível baixar a parcela", description: mensagemDoErro(erro), variant: "destructive" }),
  });

  if (!idValido) return <div className="p-6"><AvisoNaoCarregou>Endereço inválido: falta o cliente.</AvisoNaoCarregou></div>;

  const regua = data?.regua ?? null;
  const dna = data?.dna ?? null;
  const tom = (caso?.tom ?? dna?.tom ?? dna?.abordagem ?? null) as Tom | null;
  const statusDoCaso = caso?.status as StatusDeCaso | undefined;
  const transicoesVivas = statusDoCaso ? TRANSICOES_DE_CASO[statusDoCaso].filter(s => (STATUS_ABERTOS_DE_CASO as readonly string[]).includes(s) && !STATUS_SO_PELA_NEGOCIACAO.has(s)) : [];
  const transicoesFechadas = statusDoCaso ? (TRANSICOES_DE_CASO[statusDoCaso].filter(s => (STATUS_FECHADOS_DE_CASO as readonly string[]).includes(s)) as StatusFechadoDeCaso[]) : [];
  const responsavelDeOutro = !!caso && caso.responsavelUserId !== null && caso.responsavelUserId !== user?.id;
  const contatoProximo = caso ? proximoContato(caso.proximoContatoEm, hoje) : null;
  const whatsapp = cliente ? (cliente.whatsapp ?? whatsappDe(cliente.telefone)) : null;
  const vencido = cliente?.dividaAtual ?? 0;
  const atraso = cliente?.diasAtraso ?? 0;
  const faturasAbertas = cliente?.faturasAbertas ?? null;
  const situacao = ficha?.situacaoReal ?? null;
  const exCliente = cliente
    ? situacao === "ex-cliente" || cliente.carteira === "ex_cliente"
    : carteiraDeOrigem === "ex_cliente";
  const statusMeta = clienteStatusMeta(situacao ?? cliente?.statusErp ?? null);
  const negociacaoAtiva = (data?.negociacoes ?? []).find(n => !negociacaoEncerrada(n.status)) ?? null;
  const encargos = data?.divida?.atualizado ? Math.max(0, data.divida.atualizado.total - data.divida.atualizado.principal) : 0;
  const economia = ficha?.economia ?? null;
  const economiaPendente = ficha?.economiaPendente ?? null;
  const confirmado = !!(politica?.economia.confirmado && economia);
  // A rota do 360 manda `erpSource` e `lastSyncAt` do `customers`; o tipo do
  // client ainda não os declara, então são lidos aqui sem inventar valor.
  const varredura = cliente as unknown as { erpSource?: string | null; lastSyncAt?: string | null } | null;
  // O selo do cabeçalho: "Dados reais" SÓ com leitura ao vivo que encontrou o
  // cliente. Sem ela, diz "Base sincronizada" com a data da varredura — e o
  // title lembra que valor e atraso vêm da varredura de qualquer jeito.
  const origemDoCabecalho = origemDoSnapshot(
    snapshot,
    { erpSource: varredura?.erpSource, lidoEm: varredura?.lastSyncAt },
    "Valor em aberto e dias de atraso vêm sempre da varredura gravada em customers; a leitura ao vivo traz plano, contrato, corte e aparelhos.",
  );
  const alvoDoContato = (): AlvoDoContato | null => (caso && cliente ? { casoId: caso.id, clienteNome: cliente.nome, canalSugerido: regua?.etapa?.canalSugerido ?? null } : null);
  const abrirNegociacao = () => {
    if (!cliente) return;
    if (caso) setNegociacao({ casoId: caso.id, clienteNome: cliente.nome, valorAtual: caso.valorAtual });
    else setAbrirCaso(true);
  };

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6" data-testid="cobranca-cliente-360">
      {/* 0 · Breadcrumb */}
      <nav className="flex items-center gap-1 text-[12px] text-[var(--text-muted)]" aria-label="Caminho">
        <Link href={exCliente ? ROTA_CARTEIRA_EX : ROTA_CARTEIRA_ATIVOS} className="inline-flex items-center gap-1 hover:text-[var(--text)]" data-testid="voltar-carteira"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Voltar</Link>
        <ChevronRight className="h-3 w-3" aria-hidden />
        <Link href={exCliente ? ROTA_CARTEIRA_EX : ROTA_CARTEIRA_ATIVOS} className="underline decoration-1 underline-offset-2 hover:text-[var(--brand-ink)]">{exCliente ? "Ex-clientes" : "Clientes ativos"}</Link>
        <ChevronRight className="h-3 w-3" aria-hidden />
        <span className="text-[var(--text)]">{isLoading ? "…" : cliente?.nome ?? DASH}</span>
      </nav>

      {isError ? (
        <div className="flex items-center gap-2 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-[13px] text-[var(--danger)]" data-testid="erro-360">
          <AlertTriangle className="h-4 w-4" aria-hidden /> Erro ao carregar o dossiê real — {mensagemDoErro(error)}.
          <button type="button" className={cn(BOTAO_SECUNDARIO, "ml-auto h-8")} onClick={() => refetch()}>Tentar de novo</button>
        </div>
      ) : mostrarSkeleton || !cliente || !ficha ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-[220px] rounded-lg" />
          <div className="grid gap-3 lg:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-[480px] rounded-lg" />)}</div>
          <Skeleton className="h-[360px] rounded-lg" />
        </div>
      ) : (
        <>
          {/* 1 · HERO */}
          <section className={cn(CARD, "bg-[linear-gradient(180deg,var(--surface-2),var(--surface))]")} data-testid="cabecalho-360">
            <div className="flex flex-wrap items-start gap-4">
              <Avatar nome={cliente.nome} tamanho="lg" />
              <div className="min-w-[260px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[23px] font-semibold leading-tight tracking-[var(--track-tight)] text-[var(--text)]" data-testid="nome-cliente">{cliente.nome}</h1>
                  <SeloOrigem origem={origemDoCabecalho} testId="selo-origem-360" />
                  <Pendente motivo="não há coluna de vulnerabilidade (Lei 14.181) — a régua não pausa sozinha por vulnerabilidade" ext="Vulnerável" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--text-muted)]">
                  <span>{plano ? <b className="text-[var(--text-2)]">{plano}</b> : <Traco titulo={snapshot && !snapshot.ok ? snapshot.erro ?? "" : "plano vem do ERP ao vivo"} />}</span>
                  <span className={NUM} title="CPF/CNPJ do cliente, como está no cadastro do ERP" data-testid="documento-cliente">{cliente.documento || TRACO}</span>
                  <span className={cn("inline-flex items-center gap-1", NUM)}>Tel. {cliente.telefone ?? DASH}{whatsapp && <LinkWhatsapp whatsapp={whatsapp} nome={cliente.nome}><MessageCircle className="h-3.5 w-3.5" aria-hidden /></LinkWhatsapp>}</span>
                  <span data-testid="tempo-de-casa">{exCliente ? "Adesão há" : "Cliente há"} {ficha.anosCliente !== null ? <b className={cn("text-[var(--text-2)]", NUM)}>{num(ficha.anosCliente)} {ficha.anosCliente === 1 ? "ano" : "anos"}</b> : <Traco titulo="Sem data de contrato no ERP" />}</span>
                  <span>Cidade <b className="text-[var(--text-2)]">{cliente.cidade ?? DASH}</b></span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {statusMeta ? <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill> : <SeloCobranca tom="neutro">Status —</SeloCobranca>}
                  {dna ? <Pill tone={dnaToneOf(dna.quadrante)} title={dna.abordagem ? `Abordagem: ${dna.abordagem}` : undefined}>{dna.quadrante} · quadrante DNA</Pill> : <SeloCobranca tom="neutro" titulo="Sem DNA: o ERP não informou a data do contrato">DNA —</SeloCobranca>}
                  {ficha.selo && <Pill tone={ficha.selo.tom} title={ficha.selo.motivo}>{ficha.selo.rotulo}</Pill>}
                </div>
                {ficha.resumo && <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-[1.45] text-[var(--text-2)]" data-testid="resumo-executivo"><Sparkles className="mt-0.5 h-3 w-3 flex-none text-[var(--text-muted)]" aria-hidden /> {ficha.resumo}</p>}
              </div>

              {/* 1a · Fatura em aberto */}
              <div className="min-w-[210px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 lg:ml-auto" data-testid="card-divida">
                <Kicker>Fatura em aberto</Kicker>
                {vencido > 0 ? (
                  <>
                    <p className={cn(NUM, "mt-1 text-[32px] font-bold leading-none tracking-[-0.03em] text-[var(--money-neg)]")} data-testid="valor-divida">{money(vencido)}</p>
                    <p className={cn(NUM, "mt-1.5 text-[11.5px] text-[var(--text-muted)]")}>{num(atraso)} d</p>
                  </>
                ) : (
                  <p className="mt-1 text-[15px] font-semibold leading-[1.35] text-[var(--ok)]" data-testid="valor-divida">Sem débitos · em dia</p>
                )}
              </div>

              {/* 1b · Score de crédito */}
              <ScoreMini score={ficha.scores.credito} band={ficha.scores.credito_band} />

              {/* 1c · Economia do cliente · R24 */}
              <EconomiaMini economia={economia} pendente={economiaPendente} exCliente={exCliente} confirmado={confirmado} />
            </div>

            {/* 1d · Endereço */}
            <div className="mt-3 border-t border-[var(--border)] pt-3 text-[12.5px] text-[var(--text-2)]" data-testid="card-endereco">
              <div className="mb-1 flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden /><Kicker>Endereço</Kicker></div>
              {cliente.endereco || cliente.bairro || cliente.cidade || cliente.cep ? (
                <p>{cliente.endereco ?? DASH} · {cliente.bairro ?? DASH} · {cliente.cidade ?? DASH}{cliente.uf ? ` / ${cliente.uf}` : ""} · CEP <span className={NUM}>{cliente.cep ?? DASH}</span></p>
              ) : (
                <Pendente motivo="endereço vazio para este cliente (o sync do ERP não preencheu)" />
              )}
            </div>

            {/* 1e · Ações */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3" data-testid="acoes-360">
              <button type="button" className={cn(BOTAO_SECUNDARIO, "opacity-60")} disabled title="PIX à vista standalone — A-CRIAR (ramo Asaas)"><QrCode className="h-3.5 w-3.5" aria-hidden /> Gerar PIX à vista</button>
              <ACriar oque="POST PIX à vista standalone (Asaas)" />
              {caso ? (
                <button type="button" className={BOTAO_MARCA} onClick={abrirNegociacao} data-testid="acao-abrir-negociacao"><MessagesSquare className="h-3.5 w-3.5" aria-hidden /> Abrir negociação</button>
              ) : (
                <button type="button" className={BOTAO_MARCA} onClick={() => setAbrirCaso(true)} data-testid="acao-abrir-caso"><Milestone className="h-3.5 w-3.5" aria-hidden /> Abrir caso</button>
              )}
              {caso && <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setContato(alvoDoContato())} data-testid="acao-registrar-contato"><PhoneCall className="h-3.5 w-3.5" aria-hidden /> Registrar contato</button>}
              {caso && chatPronto && !data?.chat && (
                <button type="button" className={BOTAO_SECUNDARIO} disabled={enviarParaChat.isPending} onClick={() => enviarParaChat.mutate()} title="Abre a conversa do cliente no WhatsApp do provedor com a mensagem da etapa" data-testid="acao-enviar-chat">
                  <MessagesSquare className="h-3.5 w-3.5" aria-hidden /> {enviarParaChat.isPending ? "Enviando…" : "Enviar para cobrança"}
                </button>
              )}
              <button type="button" className={cn(BOTAO_SECUNDARIO, "opacity-60")} disabled title="Confissão de dívida (CPC 784) — GATED: sem assinatura eletrônica nem parecer jurídico do modelo"><FileSignature className="h-3.5 w-3.5" aria-hidden /> Confissão de dívida</button>
              <Pendente motivo="sem assinatura eletrônica (ZapSign) nem parecer jurídico do modelo" ext="GATED" />
              <Link href={`${ROTA_REGUA}?carteira=${cliente.carteira}`} className={BOTAO_SECUNDARIO} data-testid="acao-ver-regua"><GitBranch className="h-3.5 w-3.5" aria-hidden /> Ver na Régua DNA</Link>
              <a href="#linha-do-tempo" className={BOTAO_SECUNDARIO} data-testid="acao-historico"><History className="h-3.5 w-3.5" aria-hidden /> Histórico completo</a>
              <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-[var(--gated)]"><Lock className="h-3.5 w-3.5" aria-hidden /> Escritas sensíveis passam pelo administrador (gate de compliance)</span>
            </div>
            {faturasAbertas !== null && faturasAbertas > 1 && <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">{num(faturasAbertas)} faturas vencidas em aberto — detalhe na coluna Passado.</p>}
            {snapshot && !snapshot.ok && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-faint)]"><RefreshCw className={cn("h-3 w-3", lendoErp && "animate-spin")} aria-hidden /> ERP ao vivo: {snapshot.erro} <button type="button" className="underline" onClick={() => relerErp()}>tentar de novo</button></p>
            )}
          </section>

          {/* 1f · CONEXÃO — a identificação da instalação, no porte dos outros cartões */}
          <IdentificacaoTecnica
            snapshot={snapshot}
            equipamentos={data?.equipamentos ?? []}
            varredura={{ erpSource: varredura?.erpSource, lidoEm: varredura?.lastSyncAt }}
            statusContrato={vivo?.statusContrato ?? cliente.statusErp}
          />

          {/* 2–4 · Tri-horizonte */}
          <div className="grid gap-3.5 lg:grid-cols-3">
            {/* ── PASSADO ── */}
            <HorizonteCol kind="passado" titulo="Recuperar" sub="dívida & ativos" testId="coluna-passado">
              <Let k="Faturas vencidas">
                {vencido > 0
                  ? <span title="só faturas vencidas — a-vencer listadas à parte"><b className={NUM}>{money(vencido)}</b> em {faturasAbertas !== null ? <>{num(faturasAbertas)} fatura{faturasAbertas === 1 ? "" : "s"}</> : "— faturas"}</span>
                  : <span className="text-[var(--ok)]">sem faturas em aberto</span>}
                {vencido > 0 && <p className="mt-1 text-[11px] text-[var(--text-faint)]"><Pendente motivo="fatura a fatura (número, vencimento, PIX copia-e-cola, 2ª via) ainda não sincronizada do ERP — fase 2" ext="SYNC" /> <span className="ml-1">o sync grava só o agregado</span></p>}
              </Let>
              <Let k="A vencer (no prazo · não é inadimplência)"><Pendente motivo="faturas a vencer ainda não sincronizadas do ERP — fase 2" ext="SYNC" /></Let>
              <Let k="Encargos (CDC 52 · transparente)">
                {vencido > 0 && encargos > 0 ? <>multa + juros <b className={NUM}>{money(encargos)}</b> — já no valor atualizado (<span className={NUM}>{money(data?.divida?.atualizado.total)}</span>)</>
                  : vencido > 0 ? <>sem encargos aplicados ainda — valor atualizado = original</>
                  : <Traco />}
              </Let>
              <Divider />
              <Let k="Negociação ativa">
                {negociacaoAtiva ? (
                  <><b>{ROTULO_TIPO_DE_NEGOCIACAO[negociacaoAtiva.tipo as TipoDeNegociacao] ?? negociacaoAtiva.tipo}{negociacaoAtiva.parcelas > 1 ? ` · ${negociacaoAtiva.parcelas}x` : ""}{negociacaoAtiva.valorParcela ? ` de ${money(numero(negociacaoAtiva.valorParcela))}` : ""}</b> <span className="text-[var(--text-muted)]">· {ROTULO_STATUS_DE_NEGOCIACAO[negociacaoAtiva.status as StatusDeNegociacao] ?? negociacaoAtiva.status}</span></>
                ) : <span className="text-[var(--text-muted)]">nenhuma negociação em curso</span>}
                {(data?.negociacoes.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-col gap-2" data-testid="lista-negociacoes">
                    {data!.negociacoes.map(n => (
                      <CartaoNegociacao key={n.id} n={n} onStatus={status => mudarNegociacao.mutate({ id: n.id, casoId: n.casoId, status })} onPagar={(parcelaId, valor) => pagarParcela.mutate({ id: parcelaId, negociacaoId: n.id, valor })} ocupado={mudarNegociacao.isPending || pagarParcela.isPending} />
                    ))}
                  </div>
                )}
              </Let>
              <div className="flex flex-col gap-1" data-testid="confissao-cpc-784">
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-mono text-[10px] font-semibold uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]" data-k="Confissão CPC 784">{"Confissão CPC 784"}</span>
                  <Switch checked={confissao} onCheckedChange={v => { setConfissao(v); toast({ title: v ? "Confissão de dívida habilitada" : "Confissão de dívida desabilitada" }); }} aria-label="Habilitar confissão de dívida" />
                  <span className={cn("text-[11px] font-semibold", confissao ? "text-[var(--ok)]" : "text-[var(--text-muted)]")}>{confissao ? "habilitada" : "desabilitada"}</span>
                </div>
                <span className="text-[12px] leading-4 text-[var(--text-2)]">{confissao ? "habilitada nesta sessão — a emissão do título executivo (CPC 784) depende de assinatura eletrônica e parecer jurídico; a habilitação por cliente ainda não persiste" : "habilite para ofertar o título executivo ao cliente"}</span>
                <span><ACriar oque="habilitação de confissão POR CLIENTE (campo não existe no schema) + emissão com assinatura eletrônica" /></span>
              </div>
              <Let k="Comodato a recuperar" testId="lista-equipamentos">
                {equipamentos.length === 0 ? <span className="text-[var(--text-muted)]">nenhum equipamento registrado para este cliente (sync do ERP)</span> : (
                  <ul className="space-y-1">
                    {equipamentos.slice(0, 4).map(e => {
                      const devolvido = e.status === "devolvido" || e.status === "recuperado" || e.status === "concluido";
                      const pendente = e.status === "em_cobranca" || e.status === "retirada_pendente" || e.status === "prazo_expirado";
                      return (
                        <li key={e.chave} className="flex flex-wrap items-center gap-1.5">
                          <b className="capitalize text-[var(--text)]">{e.tipo ?? "equipamento"}</b>{e.modelo ? ` ${e.modelo}` : e.marca ? ` ${e.marca}` : ""}
                          <span className={cn(NUM, "text-[11px] text-[var(--text-muted)]")}>· {e.mac ?? e.serie ?? DASH}</span>
                          <Pill tone={devolvido ? "ok" : pendente ? "past" : "gold"} compact title={`fonte: ${e.fonte}`}>{devolvido ? "devolvido" : pendente ? "a recuperar" : "em comodato"}</Pill>
                        </li>
                      );
                    })}
                    {equipamentos.length > 4 && <li className="text-[11.5px] text-[var(--text-muted)]">+{equipamentos.length - 4} equipamento(s)</li>}
                  </ul>
                )}
                {(data?.recuperacao?.length ?? 0) > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11.5px]" data-testid="lista-recuperacao">
                    {data!.recuperacao!.map(r => <li key={r.id}><Link href="/recuperacao" className="text-[var(--brand)] hover:underline">retirada em curso · {r.status} · prazo {dataBr(r.prazoEm)}</Link></li>)}
                  </ul>
                )}
              </Let>
              <Let k="Prescrição (CC 206 §5)">
                {ficha.prescricao ? (ficha.prescricao.prescrita
                  ? <SeloCobranca tom="danger">dívida prescrita</SeloCobranca>
                  : <>prescreve em <b className={NUM}>{dataCivilBr(ficha.prescricao.data_prescricao)}</b> <span className="text-[var(--text-muted)]">· <span className={NUM}>{num(ficha.prescricao.dias_restantes)}</span> dias restantes</span></>)
                  : <span className="text-[var(--text-muted)]">sem dívida vencida — nada a prescrever</span>}
              </Let>
              <Let k="Histórico de pagamento"><Pendente motivo="faturas liquidadas ainda não sincronizadas — habilitar fatura a fatura no ERP e rodar o histórico (fase 2)" ext="SYNC" /></Let>
              <Let k="Pontualidade · últimos 12 meses">
                <div className="grid grid-cols-12 gap-1" aria-hidden>{Array.from({ length: 12 }, (_, i) => <div key={i} className="h-[18px] rounded border border-[var(--border-faint)]" />)}</div>
                <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">nenhuma fatura sincronizada nos últimos 12 meses <Pendente motivo="a grade lê fatura a fatura — fase 2" ext="SYNC" /></p>
              </Let>
              <Let k="Histórico (suspensões · negativações)">
                <HistoricoExecucao cliente={cliente} casosAnteriores={data?.casosAnteriores ?? []} vivo={vivo} />
              </Let>
            </HorizonteCol>

            {/* ── PRESENTE ── */}
            <HorizonteCol kind="presente" titulo="Defender" sub="saúde & régua" testId="coluna-presente">
              <Let k="Health Score" testId="health-score">
                <div className="flex items-center gap-2">
                  <span className={cn(NUM, "text-[18px] font-bold text-[var(--text)]")}>{num(ficha.scores.health)}</span>
                  <Pill tone={healthLabelMeta(ficha.scores.health, ficha.scores.health_band).tone} compact title={`banda: ${bandLabel(ficha.scores.health_band)}`}>{healthLabelMeta(ficha.scores.health, ficha.scores.health_band).label}</Pill>
                </div>
                <span className="mt-1.5 block h-2 overflow-hidden rounded-sm bg-[var(--surface-3)]"><span className="block h-full rounded-sm" style={{ width: `${Math.max(0, Math.min(100, ficha.scores.health))}%`, background: corDoHealth(ficha.scores.health_band) }} /></span>
                <p className={cn(NUM, "mt-1 text-[10.5px] text-[var(--text-faint)]")}>financeiro {ficha.scores.health_detalhe.financeiro} · técnico {ficha.scores.health_detalhe.tecnico}{ficha.scores.health_detalhe.tecnicoNeutro ? " (neutro: sem equipamento)" : ""} · relacionamento {ficha.scores.health_detalhe.relacionamento} (neutro: sem NPS/CSAT)</p>
              </Let>
              <Let k="NPS (relacionamento)"><ACriar oque="pesquisa NPS por cliente" /></Let>
              <Divider />
              <Let k="CSAT · satisfação por evento"><ACriar oque="CSAT por evento (instalação, suporte, cobrança)" /></Let>
              <Let k="Pior CSAT · últimos 90 dias"><ACriar oque="CSAT por evento" /></Let>
              <div className="flex gap-2.5">
                <ScoreBox label={ficha.scores.credito_band ? `Crédito · banda ${bandLabel(ficha.scores.credito_band)}` : "Crédito"} value={ficha.scores.credito} />
                <ScoreBox label="Propensão a pagar" value={ficha.scores.propensao} emDia={ficha.scores.propensao_em_dia} />
              </div>
              <Divider />
              <Let k="Abordagem (DNA 3×3)">
                {dna?.abordagem ? <><b>{dna.abordagem.replace(/_/g, " ")}</b>{tom && <span className="text-[var(--text-muted)]"> · {DIRETIVA_POR_TOM[tom]}</span>}</> : <Traco titulo="Sem DNA: o ERP não informou a data do contrato" />}
                {dna && <span className="mt-1 block"><SeloQuadrante quadrante={dna.quadrante} /></span>}
              </Let>
              <Let k="Régua atual">
                {regua?.etapa ? <><b className="capitalize">{regua.etapa.rotulo}</b> <span className="text-[var(--text-muted)]">· <span className={NUM}>{janelaDaEtapa(regua.etapa)}</span> · dia <span className={NUM}>D{atraso > 0 ? `+${atraso}` : atraso}</span> · {caso?.responsavelNome ?? "fila geral"}</span></>
                  : vencido > 0 ? <span className="text-[var(--text-muted)]">{regua?.motivoRotulo ?? (regua?.motivo ? (ROTULO_MOTIVO_SEM_ETAPA[regua.motivo as MotivoSemEtapa] ?? regua.motivo) : "fora da régua")}</span>
                  : <span className="text-[var(--text-muted)]">fora da régua — sem fatura aberta</span>}
              </Let>
              <Let k="Próximo vencimento · risco de atraso"><Pendente motivo="sem fatura a vencer sincronizada nem histórico de pagamento — fase 2" /></Let>
              <Let k="Próximo passo (NBA)" testId="proximo-passo">
                {regua?.etapa ? (
                  <>
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-[var(--ok)]" title="a régua decide; o funcionário executa" /><b className="text-[var(--text)]">{regua.etapa.acao}</b></span>
                    <span className="mt-0.5 block text-[12px] text-[var(--text-muted)]">canal sugerido <b>{ROTULO_CANAL[regua.etapa.canalSugerido]}</b> · executor <b>{caso?.responsavelNome ?? "fila geral"}</b>{regua.etapa.baseLegal ? ` · ${regua.etapa.baseLegal}` : ""}</span>
                  </>
                ) : <span className="text-[var(--text-muted)]">a régua não tem ação para hoje</span>}
              </Let>
              <Let k="Agente da vez">
                <span className="inline-flex items-center gap-2">
                  {caso?.responsavelNome ? <><Avatar nome={caso.responsavelNome} tamanho="sm" /><b>{caso.responsavelNome}</b></> : <Traco titulo="Caso na fila geral, sem responsável" />}
                  {caso && <button type="button" className="text-[12px] font-semibold text-[var(--brand)] hover:underline" onClick={() => setContato(alvoDoContato())}>abrir contato →</button>}
                </span>
              </Let>

              {/* O caso de cobrança: o que o funcionário decide — aqui não há agente. */}
              {!caso ? (
                <EstadoVazio Icone={Milestone} titulo="Sem caso de cobrança aberto" descricao={vencido > 0 ? "A régua só cobra quem tem caso: abra o caso para o cliente entrar na fila com a foto de hoje." : "Sem dívida não há o que cobrar."} cta={vencido > 0 ? <button type="button" className={BOTAO_MARCA} onClick={() => setAbrirCaso(true)} data-testid="acao-abrir-caso-vazio">Abrir caso</button> : undefined} testId="sem-caso" />
              ) : (
                <form className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3" onSubmit={e => { e.preventDefault(); salvarCaso.mutate(); }} data-testid="form-caso">
                  <div className="flex flex-wrap items-center gap-2">
                    <Kicker>caso de cobrança</Kicker>
                    <SeloStatusCaso status={caso.status} testId="status-caso" />
                    <SeloPrioridade prioridade={caso.prioridade} />
                    <span className={cn(NUM, "ml-auto text-[11px] text-[var(--text-muted)]")}>#{caso.id} · aberto {dataBr(caso.abertoEm)}</span>
                  </div>
                  <p className={cn(NUM, "text-[11.5px] text-[var(--text-2)]")}>próximo contato: <span className={contatoProximo?.urgencia === "vencido" ? "text-[var(--danger)]" : undefined}>{caso.proximoContatoEm ? `${dataHoraBr(caso.proximoContatoEm)} · ${contatoProximo?.texto}` : "sem data — está na fila"}</span> · último: {caso.ultimoContatoEm ? dataHoraBr(caso.ultimoContatoEm) : "nenhum ainda"}</p>
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
                      <select className={CONTROLE_CAMPO} value={form.responsavelUserId} disabled={!podeAdministrar && responsavelDeOutro} title={podeAdministrar ? undefined : responsavelDeOutro ? "Caso de outro operador: só o administrador reatribui" : "Pegue o caso para você ou devolva à fila geral"} onChange={e => setForm(a => ({ ...a, responsavelUserId: e.target.value }))} data-testid="select-responsavel">
                        <option value="">fila geral</option>
                        {podeAdministrar ? equipe.map(u => <option key={u.id} value={u.id}>{u.nome}</option>) : user && <option value={user.id}>{user.name} (eu)</option>}
                      </select>
                    </Campo>
                    <Campo rotulo="próximo contato">
                      <input type="datetime-local" className={cn(CONTROLE_CAMPO, NUM)} value={form.proximoContatoEm} onChange={e => setForm(a => ({ ...a, proximoContatoEm: e.target.value }))} data-testid="input-proximo-contato" />
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
              {caso && (data?.chat || chatPronto) && (
                <ConversaDoChat chat={data?.chat ?? null} onEnviar={!data?.chat ? () => enviarParaChat.mutate() : undefined} enviando={enviarParaChat.isPending} />
              )}
              <Let k="Chamados técnicos"><Pendente motivo="sem integração de chamados — o ERP expõe atendimentos/OS mas o sync não traz" ext="EXT" /></Let>
              <Let k="Opt-out / DND"><ACriar oque="registro de opt-out por canal (CDC art. 42 / Lei 14.181)" /></Let>
            </HorizonteCol>

            {/* ── FUTURO ── */}
            <HorizonteCol kind="futuro" titulo="Conquistar" sub="upside" testId="coluna-futuro">
              <div className="rounded-lg border border-[var(--ok-border)] bg-[var(--ok-bg)] px-3 py-2.5">
                <Kicker>Propensão a upsell</Kicker>
                <p className="mt-1 text-[12.5px] text-[var(--text-2)]">não existe no read model — a propensão calculada é a de PAGAR</p>
                <p className="mt-1"><Pendente motivo="Futuro (upsell/indicação/expansão) não existe no schema" ext="EXT" /></p>
              </div>
              <Let k="Plano atual → próximo">{plano ? <><b>{plano}</b> → <Traco /></> : <Traco titulo="O ERP ao vivo não informou o plano" />}</Let>
              <Divider />
              <Let k="Indicação · MGM"><Traco /></Let>
              <Let k="Expansão geográfica"><Traco /></Let>
              <Let k="Rede colaborativa" testId="rede-colaborativa">
                {data?.rede ? (
                  data.rede.consultasOutros90d > 0 ? (
                    <><ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-[var(--brand)]" aria-hidden />consultado por <b className={NUM}>{num(data.rede.provedoresDistintos90d)}</b> provedor{data.rede.provedoresDistintos90d === 1 ? "" : "es"} nos últimos 90 dias <span className="text-[var(--text-muted)]">· <span className={NUM}>{num(data.rede.consultasOutros30d)}</span> em 30 dias{data.rede.ultimaConsultaEm ? ` · última ${dataBr(data.rede.ultimaConsultaEm)}` : ""}</span></>
                  ) : <span className="text-[var(--text-muted)]">nenhuma consulta de outro provedor em 90 dias — a dívida em aberto já entra no score da rede</span>
                ) : <Traco />}
                {(data?.alertas?.length ?? 0) > 0 && <p className="mt-1 text-[11.5px] text-[var(--text-muted)]"><span className={NUM}>{num(data!.alertas!.length)}</span> alerta{data!.alertas!.length === 1 ? "" : "s"} anti-fraude sobre este cliente · {num(data!.alertas!.filter(a => !a.resolvido).length)} em aberto</p>}
              </Let>
            </HorizonteCol>
          </div>

          {/* 5 · R24 */}
          <SecaoR24 economia={economia} pendente={economiaPendente} exCliente={exCliente} confirmado={confirmado} politicaConfirmada={!!politica?.economia.confirmado} />

          {/* 6 · Transversal */}
          <Transversal data={data!} />
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

/* ── Hero: sub-cards ───────────────────────────────────────────────────── */

function corDoHealth(band: string): string {
  if (band === "saudavel") return "var(--ok)";
  if (band === "atencao") return "var(--gated)";
  if (band === "risco") return "var(--past)";
  return "var(--danger)";
}

function ScoreMini({ score, band }: { score: number | null; band: string | null }) {
  const familia = corDaBandaDeCredito(score, band);
  const cor = familia === "success" ? "var(--ok)" : familia === "warning" ? "var(--gated)" : familia === "danger" ? "var(--danger)" : "var(--text-muted)";
  const largura = score != null ? Math.max(0, Math.min(100, (score / 1000) * 100)) : 0;
  return (
    <div className="min-w-[230px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5" data-testid="card-score">
      <Kicker>Score de crédito</Kicker>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={cn(NUM, "text-[30px] font-bold leading-none tracking-[-0.02em]")} style={{ color: cor }} data-testid="valor-score">{score != null ? num(score) : DASH}</span>
        <span className="text-[12px] text-[var(--text-muted)]">/ 1000</span>
        {band && <SeloCobranca tom={familia === "success" ? "ok" : familia === "warning" ? "gated" : familia === "danger" ? "danger" : "neutro"} className="ml-auto normal-case tracking-normal">{bandLabel(band)}</SeloCobranca>}
      </div>
      <span className="mt-2 block h-[7px] overflow-hidden rounded-sm bg-[var(--surface-3)]"><span className="block h-full rounded-sm" style={{ width: `${largura}%`, background: cor }} /></span>
      <div className={cn(NUM, "mt-1 flex justify-between text-[10px] text-[var(--text-muted)]")}><span>0</span><span>500</span><span>1000</span></div>
    </div>
  );
}

function EconomiaMini({ economia, pendente, exCliente, confirmado }: { economia: EconomiaLedger | null; pendente: string | null; exCliente: boolean; confirmado: boolean }) {
  const kpis: Array<{ k: string; v: string; cor?: string }> = economia
    ? [
        { k: "MRR", v: money(economia.arpu) },
        { k: "Margem bruta", v: money(economia.margem_mes), cor: economia.margem_mes >= 0 ? "var(--ok)" : "var(--money-neg)" },
        { k: "Payback", v: economia.payback_meses !== null ? `${economia.payback_meses} meses${economia.mes_atual >= economia.payback_meses ? " ✓" : ""}` : "nunca", cor: economia.payback_meses !== null ? "var(--ok)" : undefined },
        { k: "LTV realizado", v: economia.ltv_realizado !== null ? money(economia.ltv_realizado) : DASH },
        { k: "LTV projetado", v: money(economia.ltv_receita) },
        { k: "LTV:CAC", v: economia.ltv_cac !== null ? `${economia.ltv_cac.toLocaleString("pt-BR")}×` : DASH, cor: economia.ltv_cac !== null && economia.ltv_cac >= 3 ? "var(--ok)" : "var(--gated)" },
      ]
    : ["MRR", "Margem bruta", "Payback", "LTV realizado", "LTV projetado", "LTV:CAC"].map(k => ({ k, v: DASH }));
  return (
    <div className="min-w-[280px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5" data-testid="card-economia">
      <div className="flex items-center justify-between gap-2">
        <Kicker>Economia do cliente · R24</Kicker>
        <a href="#c360-fin" className="text-[11px] font-semibold text-[var(--brand)] hover:underline">ver detalhe ↓</a>
      </div>
      <p className={cn(NUM, "mt-1 text-[26px] font-bold leading-none tracking-[-0.02em]")} style={{ color: economia ? (economia.lucro_acumulado >= 0 ? "var(--ok)" : "var(--danger)") : "var(--text-muted)" }}>{economia ? money(economia.lucro_acumulado) : DASH}</p>
      <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">lucro acumulado{economia ? ` · mês ${economia.mes_atual}` : ""}</p>
      {!economia && pendente && <p className="mt-1"><Pendente motivo={pendente} ext={exCliente ? undefined : "R24"} /></p>}
      {economia && !confirmado && <p className="mt-1"><SeloCobranca tom="gated" className="normal-case tracking-normal"><Sparkles className="h-3 w-3" aria-hidden /> ≈ parâmetros padrão</SeloCobranca></p>}
      <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 border-t border-[var(--border)] pt-2">
        {kpis.map(x => (
          <div key={x.k}><span className="block font-mono text-[9.5px] font-semibold uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{x.k}</span><span className={cn(NUM, "text-[13px] font-semibold")} style={{ color: economia ? x.cor : "var(--text-muted)" }}>{x.v}</span></div>
        ))}
      </div>
      {economia && economia.perda_se_cancelar > 0 && (
        <div className={cn(NUM, "mt-2 grid grid-cols-3 gap-x-3 border-t border-dashed border-[var(--border)] pt-2 text-[11px]")}>
          <span title="Margem futura em risco se cancelar agora — teto racional de retenção"><span className="block text-[9.5px] uppercase text-[var(--text-muted)]">Perda se cancelar</span>{money(economia.perda_se_cancelar)}</span>
          <span title="Custo da oferta de retenção padrão (desconto 50% × 3 meses)"><span className="block text-[9.5px] uppercase text-[var(--text-muted)]">Custo da oferta</span>{money(economia.custo_oferta_retencao)}</span>
          {economia.roi_retencao !== null && <span title="ROI de reter = perda evitada ÷ custo da oferta (≥1 = vale reter)" style={{ color: economia.roi_retencao >= 1 ? "var(--ok)" : "var(--gated)" }}><span className="block text-[9.5px] uppercase text-[var(--text-muted)]">ROI retenção</span>{economia.roi_retencao.toLocaleString("pt-BR")}×</span>}
        </div>
      )}
    </div>
  );
}

function ScoreBox({ label, value, emDia }: { label: string; value: number | null; emDia?: boolean }) {
  const mostraEmDia = value == null && emDia === true;
  return (
    <div className="flex-1 rounded-lg border border-[var(--border)] px-2.5 py-2 text-center">
      <p className={cn(NUM, "font-bold", mostraEmDia ? "text-[13px] text-[var(--ok)]" : "text-[18px] text-[var(--text)]")}>{value != null ? num(value) : mostraEmDia ? "Em dia" : DASH}</p>
      <p className="text-[10px] text-[var(--text-muted)]">{label}</p>
    </div>
  );
}

function HistoricoExecucao({ cliente, casosAnteriores, vivo }: { cliente: Cliente360["cliente"]; casosAnteriores: CasoDetalhe[]; vivo: SnapshotAoVivo["cliente"] | null }) {
  const itens: Array<{ tipo: "suspensao" | "negativacao"; descricao: string; data: string | null }> = [];
  const statusErp = vivo?.statusContrato ?? cliente.statusErp;
  const motivo = vivo?.motivoCorte ?? cliente.motivoCorte;
  const quando = vivo?.cortadoEm ?? cliente.cortadoEm;
  if (statusErp === "suspended" || statusErp === "cancelled") itens.push({ tipo: "suspensao", descricao: `${statusErp === "suspended" ? "suspenso" : "cancelado"} no ERP${motivo ? ` · ${motivo}` : ""}`, data: quando });
  for (const c of casosAnteriores) if (c.status === "negativado") itens.push({ tipo: "negativacao", descricao: `caso #${c.id} negativado`, data: c.encerradoEm ?? c.abertoEm });
  if (itens.length === 0) return <span className="text-[var(--text-muted)]">nenhuma suspensão ou negativação registrada</span>;
  return (
    <ul className="space-y-1">
      {itens.slice(0, 4).map((h, i) => (
        <li key={i} className="flex flex-wrap items-center gap-1.5"><SeloCobranca tom={h.tipo === "negativacao" ? "danger" : "gated"}>{h.tipo}</SeloCobranca> <span>{h.descricao}</span> {h.data && <span className={cn(NUM, "text-[var(--text-muted)]")}>· {dataBr(h.data)}</span>}</li>
      ))}
    </ul>
  );
}

/* ── 5 · R24 ───────────────────────────────────────────────────────────── */

const FIN_CUSTO: Array<{ cat: EconomiaLedger["opex_breakdown"][number]["categoria"]; rotulo: string; cor: string }> = [
  { cat: "link_transporte", rotulo: "Link / transporte (banda, IP)", cor: "var(--past)" },
  { cat: "rateio_rede_pop", rotulo: "Rateio rede & POP (energia, infra)", cor: "var(--past-border)" },
  { cat: "suporte_atendimento", rotulo: "Suporte & atendimento", cor: "var(--gated)" },
  { cat: "manutencao_noc", rotulo: "Manutenção & NOC", cor: "var(--gated-border)" },
  { cat: "impostos_receita", rotulo: "Impostos s/ receita", cor: "var(--text-faint)" },
];

function SecaoR24({ economia, pendente, exCliente, confirmado, politicaConfirmada }: { economia: EconomiaLedger | null; pendente: string | null; exCliente: boolean; confirmado: boolean; politicaConfirmada: boolean }) {
  const [mesSim, setMesSim] = useState<number | null>(null);
  const e = economia;
  const ciclo = e?.ciclo_meses ?? 84;
  const hoje = e?.mes_atual ?? 0;
  const cicloEfetivo = e?.ciclo_efetivo ?? Math.max(ciclo, hoje);
  const encerrado = e?.ciclo_encerrado === true;
  const fimGrafico = encerrado ? Math.max(hoje, 1) : hoje >= cicloEfetivo ? hoje + 12 : cicloEfetivo;
  const mesMax = encerrado ? hoje : fimGrafico;
  const mes = Math.min(mesSim ?? hoje, mesMax);

  // Sem curva de pagamentos reais (fase 2): projeção pura, como o Provedor.ai sem `receita_acumulada_mensal`.
  const sim = e ? { receita: e.arpu * mes, custo: e.investimento + e.opex_mes * mes, resultado: e.margem_mes * mes - e.investimento, real: false, piorCaso: e.margem_mes * mes - e.investimento - e.equipamento_residual } : null;
  const geo = e ? (() => {
    const projFinal = e.margem_mes * fimGrafico - e.investimento;
    const minR = -e.investimento;
    const maxR = Math.max(projFinal, minR + 1);
    const yOf = (r: number) => 210 - ((r - minR) / (maxR - minR)) * 180;
    const xOf = (m: number) => 44 + (m / fimGrafico) * 576;
    return { yOf, xOf, y0: yOf(0), be: e.payback_meses };
  })() : null;

  const stats: Array<{ k: string; s: string; v: string; tone?: "pos" | "neg" }> = [
    { k: "ARPU · mensalidade", s: "mensalidade do plano", v: e ? money(e.arpu) : DASH },
    { k: "CAC · aquisição", s: "custo de adquirir o cliente", v: e ? money(e.cac) : DASH },
    { k: "CAPEX · instalação", s: "equipamento + instalação", v: e ? money(e.capex) : DASH },
    { k: "OPEX · custo de servir/mês", s: "rede + suporte + impostos", v: e ? money(e.opex_mes) : DASH },
    { k: "Margem de contribuição", s: "ARPU − OPEX", v: e ? `${money(e.margem_mes)} · ${num(e.margem_pct)}%` : DASH, tone: e ? (e.margem_mes >= 0 ? "pos" : "neg") : undefined },
    { k: "Payback / equilíbrio", s: e ? "investimento ÷ margem" : "investimento ÷ margem", v: e ? (e.payback_meses !== null ? `${e.payback_meses} meses` : e.ciclo_encerrado ? "nunca cruzou" : "nunca") : DASH },
    { k: "Lucro acumulado", s: e ? (e.fonte_receita === "recebida" ? `receita RECEBIDA real (${money(e.receita_recebida ?? 0)})` : e.inadimplencia_aberta > 0 ? `projeção · −${money(e.inadimplencia_aberta)} dívida aberta` : "projeção (plano × meses)") : "desde a instalação", v: e ? money(e.lucro_acumulado) : DASH, tone: e ? (e.lucro_acumulado >= 0 ? "pos" : "neg") : undefined },
    { k: "LTV (receita)", s: e ? (e.ciclo_encerrado ? `receita total da vida · ${e.mes_atual} meses` : e.ciclo_efetivo > e.mes_atual ? `ticket × ${e.ciclo_meses}m de permanência (est.)` : `ticket × ${e.mes_atual}m de casa · veterano (atualiza mês a mês)`) : "ticket × permanência", v: e ? money(e.ltv_receita) : DASH },
  ];

  return (
    <section id="c360-fin" className={cn(CARD, "scroll-mt-4")} data-testid="secao-r24">
      <header className="flex flex-wrap items-center gap-2">
        <SeloCobranca tom="ok">R24</SeloCobranca>
        <h2 className="text-[16px] font-semibold text-[var(--text)]">Economia do cliente · visão financeira</h2>
        <span className="text-[12px] text-[var(--text-muted)]">unit economics deste assinante — quanto custa, quanto retorna, e o que acontece se cancelar</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {!e && pendente && <Pendente motivo={pendente} ext={exCliente ? undefined : "R24"} />}
          {e?.ciclo_encerrado && <SeloCobranca tom="neutro" className="normal-case tracking-normal">ciclo encerrado · 100% realizado</SeloCobranca>}
          {e && confirmado ? <SeloCobranca tom="ok" className="normal-case tracking-normal">confirmado</SeloCobranca> : (
            <span title="números calculados com os parâmetros vigentes (padrão) — confirme os custos do seu provedor na política de cobrança" className="inline-flex items-center gap-2">
              {!politicaConfirmada && <SeloCobranca tom="gated" className="normal-case tracking-normal"><Sparkles className="h-3 w-3" aria-hidden /> ≈ parâmetros padrão</SeloCobranca>}
              <Link href={`${ROTA_POLITICA}#economia`} className={cn(BOTAO_SECUNDARIO, "h-8 text-[11.5px]")}><Settings className="h-3.5 w-3.5" aria-hidden /> Confirmar custos</Link>
            </span>
          )}
        </span>
      </header>

      <div className="my-3.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-testid="r24-stats">
        {stats.map(s => (
          <div key={s.k} className="rounded-lg border border-[var(--border)] px-3 py-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{s.k}</p>
            <p className={cn(NUM, "mt-1 text-[19px] font-bold tracking-[-0.02em]")} style={{ color: !e ? "var(--text-muted)" : s.tone === "pos" ? "var(--ok)" : s.tone === "neg" ? "var(--money-neg)" : "var(--text)" }}>{s.v}</p>
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{s.s}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3.5 lg:grid-cols-2">
        {/* 5b · custo mensal */}
        <div className={SUBCARD}>
          <h4 className={H4}>Para onde vai a mensalidade · custo mensal</h4>
          {e ? (
            <div className="mb-3 flex h-[34px] overflow-hidden rounded border border-[var(--border)]">
              {e.opex_breakdown.map(b => { const meta = FIN_CUSTO.find(f => f.cat === b.categoria)!; return <div key={b.categoria} style={{ width: `${Math.max(b.pct, 0)}%`, background: meta.cor }} title={`${meta.rotulo}: ${money(b.valor)} (${num(b.pct)}%)`} />; })}
              <div className={cn(NUM, "flex flex-1 items-center justify-center bg-[var(--ok)] text-[11px] font-bold text-white")} title={`Margem de contribuição: ${money(e.margem_mes)} (${num(e.margem_pct)}%)`}>Margem · {num(e.margem_pct)}%</div>
            </div>
          ) : (
            <div className="mb-3 flex h-[34px] items-center justify-center rounded border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)] text-[11px] font-semibold text-[var(--text-muted)]">sem dados de custo — unit economics PENDENTE</div>
          )}
          <table className="w-full text-[12px]">
            <tbody>
              {FIN_CUSTO.map(f => { const b = e?.opex_breakdown.find(x => x.categoria === f.cat); return (
                <tr key={f.cat} className="border-b border-[var(--border-faint)]">
                  <td className="py-1.5"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: b ? f.cor : "var(--surface-3)", border: b ? undefined : "1px solid var(--border-strong)" }} />{f.rotulo}</td>
                  <td className={cn(NUM, "py-1.5 text-right")}>{b ? money(b.valor) : DASH}</td>
                  <td className={cn(NUM, "py-1.5 pl-3 text-right text-[var(--text-muted)]")}>{b ? `${num(b.pct)}%` : DASH}</td>
                </tr>
              ); })}
              <tr className="border-t border-[var(--border)] font-semibold"><td className="py-1.5">= Custo de servir (OPEX)</td><td className={cn(NUM, "py-1.5 text-right")}>{e ? money(e.opex_mes) : DASH}</td><td className={cn(NUM, "py-1.5 pl-3 text-right text-[var(--text-muted)]")}>{e ? `${num(Math.round((100 - e.margem_pct) * 10) / 10)}%` : DASH}</td></tr>
              <tr className="font-semibold"><td className="py-1.5"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-[var(--ok)] align-middle" />Margem de contribuição</td><td className={cn(NUM, "py-1.5 text-right")}>{e ? money(e.margem_mes) : DASH}</td><td className={cn(NUM, "py-1.5 pl-3 text-right text-[var(--text-muted)]")}>{e ? `${num(e.margem_pct)}%` : DASH}</td></tr>
            </tbody>
          </table>
        </div>

        {/* 5c · simulador */}
        <div className={SUBCARD}>
          <h4 className={H4}>Ponto de equilíbrio & simulador de cancelamento</h4>
          <svg viewBox="0 0 640 240" role="img" aria-label={e && geo ? `Resultado acumulado por mês de cancelamento — projeção; equilíbrio no mês ${geo.be ?? "—"}` : "Ponto de equilíbrio — indisponível (sem unit economics)"} className="w-full">
            {e && geo && sim ? (
              <>
                <rect x={44} y={30} width={576} height={Math.max(geo.y0 - 30, 0)} fill="var(--ok-bg)" />
                <rect x={44} y={geo.y0} width={576} height={Math.max(210 - geo.y0, 0)} fill="var(--past-bg)" />
                <line x1={44} x2={620} y1={geo.y0} y2={geo.y0} stroke="var(--border-strong)" strokeWidth={1} />
                <line x1={geo.xOf(0)} y1={geo.yOf(-e.investimento)} x2={geo.xOf(fimGrafico)} y2={geo.yOf(e.margem_mes * fimGrafico - e.investimento)} stroke="var(--text-2)" strokeWidth={2.5} strokeLinecap="round" />
                {geo.be !== null && geo.be <= fimGrafico && (
                  <>
                    <line x1={geo.xOf(geo.be)} x2={geo.xOf(geo.be)} y1={30} y2={210} stroke="var(--gated)" strokeWidth={1.5} strokeDasharray="3 3" />
                    <circle cx={geo.xOf(geo.be)} cy={geo.y0} r={3.5} fill="var(--gated)" />
                    <text x={geo.xOf(geo.be) + 6} y={geo.y0 - 8} fontSize={10} fontWeight={600} fill="var(--gated)">equilíbrio · mês {geo.be}</text>
                  </>
                )}
                <line x1={geo.xOf(mes)} x2={geo.xOf(mes)} y1={30} y2={210} stroke="var(--brand-ink)" strokeWidth={1.5} />
                <circle cx={geo.xOf(mes)} cy={geo.yOf(sim.resultado)} r={5.5} fill="var(--brand-ink)" stroke="var(--surface)" strokeWidth={2} />
                <text x={500} y={46} fontSize={11} fontWeight={600} fill="var(--ok)">lucro</text>
                <text x={50} y={204} fontSize={11} fontWeight={600} fill="var(--money-neg)">prejuízo</text>
              </>
            ) : (
              <>
                <line x1={44} x2={620} y1={184.6} y2={184.6} stroke="var(--border-strong)" strokeWidth={1} />
                <text x={500} y={92} fontSize={11} fontWeight={600} fill="var(--ok)">lucro</text>
                <text x={50} y={199} fontSize={11} fontWeight={600} fill="var(--money-neg)">prejuízo</text>
                <text x={332} y={120} fontSize={12} fontWeight={600} fill="var(--text-muted)" textAnchor="middle">simulador indisponível — sem unit economics (ARPU + custos)</text>
              </>
            )}
            {[0, 0.285, 0.57, 1].map(f => <text key={f} x={44 + f * 576} y={226} fontSize={9.5} fill="var(--text-faint)" fontFamily="var(--font-mono)" textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}>{f === 0 ? "0" : `${Math.round(fimGrafico * f)}m`}</text>)}
          </svg>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-[var(--text-2)]">{encerrado ? "Arraste: resultado se tivesse saído no →" : "Arraste: e se cancelar no →"}</span>
            <span className={cn(NUM, "text-[17px] font-bold")} style={{ color: e ? "var(--brand-ink)" : "var(--text-muted)" }}>mês {e ? mes : DASH}</span>
          </div>
          <input type="range" min={0} max={mesMax} step={1} value={e ? mes : 0} disabled={!e} onChange={ev => setMesSim(Number(ev.target.value))} aria-label={e ? "Mês de cancelamento simulado" : "Mês de cancelamento — indisponível sem unit economics"} title={e ? `simulando cancelamento no mês ${mes}` : "Simulador desabilitado — sem ARPU/OPEX/investimento reais"} className="mt-1 w-full accent-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-60" data-testid="simulador-cancelamento" />
          <div className={cn(NUM, "flex justify-between text-[10px] text-[var(--text-faint)]")}>
            <span>{encerrado ? "início · mês 0" : "cancela já · mês 0"}</span>
            {e && !encerrado && <span>hoje · mês {hoje}</span>}
            <span>{encerrado ? `cancelou ≈ mês ${hoje}` : `${fimGrafico > cicloEfetivo ? "cenário futuro · " : "fim do ciclo · "}${fimGrafico}`}</span>
          </div>
          <div className="mt-3.5 grid grid-cols-[1fr_1fr_1.2fr] gap-2.5">
            {[
              { k: "Receita acumulada", v: sim ? money(sim.receita) : null, main: false, sub: sim ? "projeção (plano × meses)" : null },
              { k: "Custo acumulado", v: sim ? money(sim.custo) : null, main: false, sub: sim ? "projetado" : null },
              { k: "Resultado", v: sim ? `${sim.resultado < 0 ? "− " : "+ "}${money(Math.abs(sim.resultado))}` : null, main: true, sub: sim ? "projetado" : null },
            ].map(c => {
              const lucro = sim ? sim.resultado >= 0 : false;
              const isMain = c.main && sim != null;
              return (
                <div key={c.k} className="rounded-lg px-3 py-2.5" style={{ border: `1px solid ${isMain ? (lucro ? "var(--ok-border)" : "var(--past-border)") : "var(--border)"}`, background: isMain ? (lucro ? "var(--ok-bg)" : "var(--past-bg)") : "var(--surface-2)" }}>
                  <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{c.k}</p>
                  <p className={cn(NUM, "mt-1 text-[18px] font-bold")} style={{ color: !c.v ? "var(--text-muted)" : isMain ? (lucro ? "var(--ok)" : "var(--past)") : "var(--text)" }}>{c.v ?? DASH}</p>
                  {c.sub && <p className="mt-0.5 text-[10px] font-semibold text-[var(--text-muted)]">{c.sub}</p>}
                </div>
              );
            })}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
            <AlertTriangle className="h-3.5 w-3.5 text-[var(--gated)]" aria-hidden />
            Pior caso, sem devolução do equipamento{e ? ` (−${money(e.equipamento_residual)})` : ""}:
            <b className={NUM} style={{ color: sim && sim.piorCaso < 0 ? "var(--money-neg)" : undefined }}>{sim ? `${money(Math.abs(sim.piorCaso))}${sim.piorCaso < 0 ? " de prejuízo" : " de lucro"}` : DASH}</b>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── 6 · Transversal ───────────────────────────────────────────────────── */

function Transversal({ data }: { data: Cliente360 }) {
  const sensiveis = data.eventos.filter(ev => ev.tipo === "encerramento" || ev.tipo === "cancelamento" || ev.tipo === "negativacao" || ev.tipo === "responsavel_mudou");
  const contatos = data.eventos.filter(ev => ev.tipo === "contato" || ev.tipo === "promessa" || ev.tipo === "nota").slice(0, 8);
  return (
    <section data-testid="secao-transversal">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <SeloCobranca tom="past">Passado</SeloCobranca><SeloCobranca tom="info">Presente</SeloCobranca><SeloCobranca tom="ok">Futuro</SeloCobranca>
        <h2 className="text-[16px] font-semibold text-[var(--text)]">Transversal · os 3 horizontes juntos</h2>
        <span className="text-[12px] text-[var(--text-muted)]">linha do tempo, compliance e memória — o que costura o cliente</span>
      </header>
      <div className="grid gap-3.5 lg:grid-cols-[1.6fr_1fr]">
        <div className={CARD} id="linha-do-tempo">
          <h4 className={H4}>Linha do tempo integrada</h4>
          <div className="mb-3">
            <p className="text-[12.5px] text-[var(--text-muted)]">sem eventos financeiros registrados</p>
            <p className="mt-1 text-[10.5px] text-[var(--text-faint)]">pagamentos, atrasos, acordos, ativação e negativação aparecem aqui quando existirem no ERP — nada é fabricado</p>
          </div>
          <LinhaDoTempo eventos={data.eventos} testId="linha-do-tempo" />
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"><Info className="h-3 w-3" aria-hidden /> Só eventos reais: a linha operacional do caso (contatos, promessas, negociações, etapas da régua, encerramentos).</p>
        </div>
        <div className="flex flex-col gap-3.5">
          <div className={CARD}>
            <h4 className={H4}>Compliance · gate do administrador</h4>
            {sensiveis.length === 0 ? (
              <EstadoVazio Icone={Shield} titulo="Sem decisões sensíveis" descricao="Nenhum encerramento, negativação ou cancelamento neste cliente ainda. Toda escrita sensível passa pelo administrador." />
            ) : (
              <ul>
                {sensiveis.slice(0, 6).map(ev => (
                  <li key={ev.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--border-faint)] py-2 last:border-0">
                    <span className={cn("inline-block h-2 w-2 rounded-full", ev.tipo === "negativacao" ? "bg-[var(--danger)]" : ev.tipo === "cancelamento" ? "bg-[var(--past)]" : "bg-[var(--gated)]")} />
                    <b className="text-[12.5px]">{ev.tipo === "responsavel_mudou" ? "reatribuição" : ev.tipo}</b>
                    <span className={cn(NUM, "ml-auto text-[11px] text-[var(--text-muted)]")}>{dataHoraBr(ev.ocorridoEm)}</span>
                    {ev.notas && <span className="w-full text-[12px] text-[var(--text-2)]">{ev.notas}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"><Lock className="h-3 w-3 text-[var(--gated)]" aria-hidden /> Gate sempre visível — nenhum desfecho às cegas.</p>
          </div>
          <div className={CARD}>
            <h4 className={H4}>Memória da equipe · o que sabemos</h4>
            <p className="mb-2.5 text-[12.5px] leading-[1.5] text-[var(--text-2)]">Atividade real dos funcionários nos contatos com este cliente.</p>
            {contatos.length === 0 ? <Pendente motivo="nenhum contato registrado com este cliente ainda" /> : (
              <ul>
                {contatos.map(ev => (
                  <li key={ev.id} className="flex items-center gap-2 border-b border-[var(--border-faint)] py-1.5 text-[12.5px] last:border-0">
                    <Avatar nome={ev.usuarioNome ?? "sistema"} tamanho="sm" /><span>{ev.usuarioNome ?? "sistema"}</span>
                    <span className={cn(NUM, "ml-auto text-[11px] text-[var(--text-muted)]")}>{ev.resultado ?? ev.tipo}{ev.canal ? ` · ${ev.canal}` : ""} · {dataHoraBr(ev.ocorridoEm)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Negociação (como antes) ───────────────────────────────────────────── */

function CartaoNegociacao({ n, onStatus, onPagar, ocupado }: { n: NegociacaoDeCobranca; onStatus: (status: StatusDeNegociacao) => void; onPagar: (parcelaId: number, valor: number) => void; ocupado: boolean }) {
  const status = n.status as StatusDeNegociacao;
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
        <span className={cn(NUM, "ml-auto text-[10.5px] text-[var(--text-muted)]")}>{dataBr(n.createdAt)}</span>
      </div>
      <p className={cn(NUM, "mt-1 text-[12px] text-[var(--text-2)]")}>
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
                  <Td><SeloCobranca tom={p.status === "paga" ? "ok" : p.status === "atrasada" ? "danger" : p.status === "cancelada" ? "neutro" : "gated"}>{ROTULO_STATUS_DE_PARCELA[p.status as StatusDeParcela] ?? p.status}</SeloCobranca>{p.pagoEm && <span className={cn(NUM, "ml-1 text-[10px] text-[var(--text-muted)]")}>{dataBr(p.pagoEm)}</span>}</Td>
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

/* Sem uso direto, mas mantém o contrato visível para quem ler a ficha: o inbox vazio do Provedor.ai. */
export const ICONE_VAZIO_TIMELINE = Inbox;
