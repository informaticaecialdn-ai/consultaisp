/**
 * /cobranca/ativos e /cobranca/ex-clientes — os dois ESPAÇOS da carteira de
 * cobrança, separados como no Provedor.ai (pedido do dono, 05/09/2026: "tudo
 * junto cria muita confusão e dúvida; os valores com mais chance de
 * recuperação são os quentes, recentes").
 *
 * O molde é a tela "Sua carteira" do Provedor.ai (apps/workspace/modules/
 * cobranca/clientes/index.tsx): cabeçalho com o total, quatro KPIs, a
 * composição da carteira, a REALIDADE MENSAL (só no espaço de ativos: o
 * seletor de mês e os quatro chips Pagou · Inadimplente · A vencer · Sem
 * fatura, que também filtram a lista), a barra de filtros com a situação ERP
 * fixada pelo espaço, e a lista em cards ou tabela.
 *
 * Nada aqui calcula dívida, atraso, DNA ou o mês: a tela desenha o que
 * `GET /api/cobranca/carteira` e `GET /api/cobranca/carteira/mes` mandaram;
 * o que não veio é "—" (regra de ouro do Provedor.ai, e a do dono).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ChevronLeft, ChevronRight, LayoutGrid, ListTodo, Route, Search, Users, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { brl, num, Segmentado, TRACO } from "@/components/localizacao/ui";
import {
  AvisoNaoCarregou, BOTAO_SECUNDARIO, BotaoIcone, CabecalhoPainel, CONTROLE_CAMPO, EstadoVazio, TabelaPainel, Th,
} from "@/components/painel/ui";
import { CardCliente, LinhaDoCliente } from "@/components/cobranca/CardCliente";
import {
  CHAVE_VISAO, FILTROS_INICIAIS, filtrosDaUrl, lerVisao, limparFiltros, mesmosFiltros, OPCOES_DIVIDA, OPCOES_ETAPA, OPCOES_QUADRANTE, OPCOES_SAUDE,
  OPCOES_STATUS, POR_PAGINA, queryDaCarteira, temFiltros, totalDePaginas, type FiltrosDaCarteira, type GrupoDoMes, type OpcaoDeFiltro, type VisaoDaCarteira,
} from "@/components/cobranca/filtros";
import {
  API_CARTEIRA, API_CARTEIRA_MES, API_REGUA, ROTA_CARTEIRA_ATIVOS, ROTA_CARTEIRA_EX, ROTA_FILA, ROTA_REGUA, rotaDoCliente,
  type RespostaDaCarteira, type RespostaDaRegua, type RespostaDoMes,
} from "@/components/cobranca/tipos";
import { BarraComposicao, FiltroPilula, mensagemDoErro, useSkeletonAtrasado } from "@/components/cobranca/ui";

export type EspacoDaCarteira = "ativos" | "ex";

/** O que muda entre os dois espaços — os mesmos textos do ESPACO_META do Provedor.ai. */
export const ESPACO_META: Record<EspacoDaCarteira, {
  carteira: "ativo" | "ex_cliente"; rota: string; titulo: string; subtitulo: string; kpiClientes: string; labelAberto: string; situacaoErp: string; vazio: string;
}> = {
  ativos: {
    carteira: "ativo",
    rota: ROTA_CARTEIRA_ATIVOS,
    titulo: "Clientes ativos",
    subtitulo: "situação ERP fixada pelo espaço: Ativo · por dívida / bairro / etapa da régua",
    kpiClientes: "Clientes ativos",
    labelAberto: "Vencido em ativos",
    situacaoErp: "Ativo",
    vazio: "Nenhum cliente ativo",
  },
  ex: {
    carteira: "ex_cliente",
    rota: ROTA_CARTEIRA_EX,
    titulo: "Ex-clientes com dívida",
    subtitulo: "situação ERP fixada pelo espaço: Ex-cliente · por dívida / bairro / etapa da régua",
    kpiClientes: "Ex-clientes com dívida",
    labelAberto: "Saldo vencido",
    situacaoErp: "Ex-cliente",
    vazio: "Nenhum ex-cliente com dívida",
  },
};

const OPCOES_VISAO: Array<{ k: VisaoDaCarteira; rotulo: string }> = [
  { k: "cards", rotulo: "Cards" },
  { k: "tabela", rotulo: "Tabela" },
];

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "AAAA-MM" do mês corrente. */
export function mesAtual(hoje: Date = new Date()): string {
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

/** "set/26" — como o Provedor.ai escreve o mês no seletor. */
export function rotuloDoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  return `${MESES[(m ?? 1) - 1]}/${String(ano ?? 0).slice(2)}`;
}

/** O mês deslocado em N (−1 = anterior, +1 = seguinte). */
export function deslocarMes(mes: string, delta: number): string {
  const [ano, m] = mes.split("-").map(Number);
  const d = new Date(ano ?? 2026, (m ?? 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ── KPI no molde do KpiCard do Provedor.ai ───────────────────────────── */

function KpiCarteira({ rotulo, valor, negativo, sub, carregando, testId }: {
  rotulo: string; valor: string; negativo?: boolean; sub?: string; carregando: boolean; testId?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-[15px] py-[13px]" data-testid={testId}>
      <div className="font-mono text-[10px] font-medium uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{rotulo}</div>
      <div className={cn("mt-[7px] font-mono text-[23px] font-semibold tabular-nums tracking-[-0.02em]", negativo ? "text-[var(--money-neg)]" : "text-[var(--text)]")}>
        {carregando ? <Skeleton className="h-5 w-[55%]" /> : valor}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-[var(--text-faint)]">{sub}</div>}
    </div>
  );
}

/* ── Realidade mensal: seletor de mês + quatro chips que filtram ───────── */

interface ChipDoMes { id: GrupoDoMes; rotulo: string; valor: string | null; sub: string; cor: string }

export function chipsDoMes(dados: RespostaDoMes | undefined): ChipDoMes[] {
  const r = dados?.live ? dados.resumo : null;
  const pct = r && r.faturado > 0 ? Math.round(((r.recebido + r.emConciliacao) / r.faturado) * 100) : null;
  return [
    {
      id: "pago",
      rotulo: "Pagou o mês",
      valor: r ? brl(r.recebidoConfirmado ? r.recebido : r.emConciliacao) : TRACO,
      sub: r ? (r.recebidoConfirmado ? `${pct ?? 0}% do faturado` : `${pct ?? 0}% do faturado · baixadas no ERP, sem o valor pago confirmado`) : "sem faturas no mês",
      cor: "var(--ok)",
    },
    {
      id: "inadimplente",
      rotulo: "Inadimplente do mês",
      valor: r ? brl(r.inadimplente) : TRACO,
      sub: r ? `${num(r.numInadimplentes)} ${r.numInadimplentes === 1 ? "fatura vencida" : "faturas vencidas"}` : TRACO,
      cor: "var(--money-neg)",
    },
    {
      id: "a_vencer",
      rotulo: "A vencer no mês",
      valor: r ? brl(r.aVencer) : TRACO,
      sub: "ainda não venceu — não é inadimplência",
      cor: "var(--now)",
    },
    {
      id: "sem_fatura",
      rotulo: "Sem fatura no mês",
      valor: r ? num(r.semFatura) : null,
      // O sync so ve fatura ABERTA: quem pagou o mes antes da leitura tambem cai aqui ate a conciliacao
      // (fatura vista aberta e depois sumida) existir. O texto diz isso; nada de "buraco" como certeza.
      sub: "ativo sem fatura do mês vista pelo sync — buraco de faturamento ou paga antes da leitura",
      cor: "var(--gated)",
    },
  ];
}

function FaixaDoMes({ mes, onMes, grupo, onGrupo, dados, carregando }: {
  mes: string; onMes: (m: string) => void; grupo: string; onGrupo: (g: string) => void; dados: RespostaDoMes | undefined; carregando: boolean;
}) {
  const chips = chipsDoMes(dados);
  const botao = "grid h-[26px] w-[26px] place-items-center rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]";
  return (
    <section
      className="flex flex-wrap items-stretch gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5"
      aria-label="Realidade mensal"
      data-testid="faixa-do-mes"
      title={dados && !dados.live ? (dados.motivo ?? "Sem fatura a fatura do ERP") : undefined}
    >
      <div className="flex items-center gap-1.5 border-r border-[var(--border)] pr-2.5">
        <button type="button" className={botao} aria-label="Mês anterior" onClick={() => onMes(deslocarMes(mes, -1))} data-testid="mes-anterior">‹</button>
        <span className="min-w-[52px] text-center font-mono text-[12.5px] font-semibold capitalize tabular-nums" data-testid="mes-atual">{rotuloDoMes(mes)}</span>
        <button type="button" className={botao} aria-label="Próximo mês" onClick={() => onMes(deslocarMes(mes, 1))} data-testid="mes-seguinte">›</button>
      </div>
      {chips.map(ch => {
        const ativo = grupo === ch.id;
        return (
          <button
            key={ch.id}
            type="button"
            aria-pressed={ativo}
            onClick={() => onGrupo(ativo ? "" : ch.id)}
            title={ativo ? "clique para limpar o filtro" : "clique para filtrar a lista por este grupo do mês"}
            className={cn(
              "min-w-[150px] flex-[1_1_150px] rounded-md border px-3 py-2 text-left motion-safe:transition-[border-color,box-shadow]",
              ativo ? "bg-[var(--surface-3)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]",
            )}
            style={ativo ? { borderColor: ch.cor, borderWidth: 1.5 } : undefined}
            data-testid={`mes-${ch.id}`}
          >
            <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]">
              <span
                aria-hidden
                className="h-2.5 w-2.5 flex-none rounded-full"
                style={{ border: `1.5px solid ${ativo ? ch.cor : "var(--text-muted)"}`, background: ativo ? ch.cor : "transparent", boxShadow: ativo ? "inset 0 0 0 1.5px var(--surface-3)" : "none" }}
              />
              {ch.rotulo}
            </span>
            <span className="mt-0.5 block font-mono text-[15px] font-semibold tabular-nums" style={{ color: ch.cor }}>
              {carregando ? "…" : (ch.valor ?? " ")}
            </span>
            <span className="mt-px block text-[10.5px] text-[var(--text-muted)]">{ch.sub}</span>
          </button>
        );
      })}
      {grupo && (
        <span className="self-center text-[11.5px] text-[var(--text-2)]" data-testid="mes-filtro-ligado">
          lista filtrada: <b>{chips.find(c => c.id === grupo)?.rotulo}</b> · {rotuloDoMes(mes)}
        </span>
      )}
      {dados && !dados.live && !carregando && (
        <span className="basis-full text-[11px] text-[var(--text-muted)]" data-testid="mes-sem-base">{dados.motivo ?? "O ERP ainda não mandou fatura a fatura; a faixa mostra “—”."}</span>
      )}
    </section>
  );
}

/* ── A tela ───────────────────────────────────────────────────────────── */

export default function CarteiraPage({ espaco = "ativos" }: { espaco?: EspacoDaCarteira }) {
  const meta = ESPACO_META[espaco];
  const [, navigate] = useLocation();
  const search = useSearch();
  const [filtros, setFiltros] = useState<FiltrosDaCarteira>(() => ({ ...filtrosDaUrl(search), carteira: meta.carteira }));
  const [buscaDigitada, setBuscaDigitada] = useState(filtros.busca);
  const [visao, setVisao] = useState<VisaoDaCarteira>(() => lerVisao(typeof localStorage === "undefined" ? null : localStorage));
  const hoje = useMemo(() => new Date(), []);
  const mes = filtros.mes || mesAtual(hoje);

  // A carteira é do espaço: trocar de rota troca o recorte inteiro.
  useEffect(() => {
    setFiltros(atual => (atual.carteira === meta.carteira ? atual : { ...limparFiltros(atual), carteira: meta.carteira }));
  }, [meta.carteira]);

  // A busca vai ao servidor depois de 350 ms parada — cada tecla é uma query.
  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros(atual => (atual.busca === buscaDigitada.trim() ? atual : { ...atual, busca: buscaDigitada.trim(), pagina: 1 }));
    }, 350);
    return () => clearTimeout(t);
  }, [buscaDigitada]);

  // A URL espelha os filtros (replace: cada pílula não vira um passo no histórico).
  const query = queryDaCarteira(filtros);
  useEffect(() => {
    const limpa = queryDaCarteira({ ...FILTROS_INICIAIS, carteira: meta.carteira });
    const alvo = query === limpa ? meta.rota : `${meta.rota}?${query}`;
    if (`${window.location.pathname}${window.location.search}` !== alvo) navigate(alvo, { replace: true });
  }, [query, navigate, meta.rota, meta.carteira]);

  // E o inverso: a URL que muda POR FORA (link do DNA, botão voltar) vira
  // estado. Comparada com os filtros ATUAIS (ref), não com a busca digitada.
  const filtrosAtuais = useRef(filtros);
  filtrosAtuais.current = filtros;
  useEffect(() => {
    const daUrl = { ...filtrosDaUrl(search), carteira: meta.carteira };
    if (mesmosFiltros(filtrosAtuais.current, daUrl)) return;
    setFiltros(daUrl);
    setBuscaDigitada(daUrl.busca);
  }, [search, meta.carteira]);

  const { data, isLoading, isError, error, refetch } = useQuery<RespostaDaCarteira>({
    queryKey: [`${API_CARTEIRA}?${query}${filtros.mesStatus && !filtros.mes ? `&mes=${mes}` : ""}`],
    staleTime: 30_000,
  });
  const { data: regua } = useQuery<RespostaDaRegua>({ queryKey: [API_REGUA], staleTime: 300_000 });
  const { data: doMes, isLoading: carregandoMes } = useQuery<RespostaDoMes>({
    queryKey: [`${API_CARTEIRA_MES}?mes=${mes}`],
    staleTime: 60_000,
    enabled: espaco === "ativos",
  });
  const mostrarSkeleton = useSkeletonAtrasado(isLoading);

  const mudar = (mudanca: Partial<FiltrosDaCarteira>) => setFiltros(atual => ({ ...atual, ...mudanca, pagina: mudanca.pagina ?? 1 }));
  const trocarVisao = (v: VisaoDaCarteira) => {
    setVisao(v);
    try { localStorage.setItem(CHAVE_VISAO, v); } catch { /* sem storage: só não persiste */ }
  };
  const limpar = () => { setBuscaDigitada(""); setFiltros({ ...limparFiltros(filtros), carteira: meta.carteira }); };

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;
  const paginas = totalDePaginas(total);
  const filtrado = temFiltros(filtros);

  // Sem `bairros` na resposta, o filtro oferece os bairros da página — é o que existe, e o title diz isso.
  const opcoesBairro: OpcaoDeFiltro[] = useMemo(() => {
    if (data?.bairros?.length) return data.bairros.map(b => ({ valor: b.bairro, rotulo: `${b.bairro} (${num(b.total)})`, chip: b.bairro }));
    const vistos = new Set<string>();
    for (const i of itens) if (i.bairro) vistos.add(i.bairro);
    if (filtros.bairro) vistos.add(filtros.bairro);
    return Array.from(vistos).sort().map(b => ({ valor: b, rotulo: b }));
  }, [data?.bairros, itens, filtros.bairro]);

  const kpis = data?.kpis ?? null;
  const valorKpi = (v: number | null | undefined, dinheiro = false) => (v === null || v === undefined ? TRACO : dinheiro ? brl(v) : num(v));
  const clientesNoEspaco = espaco === "ativos" ? (filtrado ? total : (data?.total ?? null)) : kpis?.exClientesComDivida;

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6" data-testid={`cobranca-carteira-${espaco}`}>
      <CabecalhoPainel
        titulo={meta.titulo}
        descricao={isLoading ? "carregando…" : `${num(total)} ${espaco === "ativos" ? "clientes ativos" : "ex-clientes com dívida"} · ${meta.subtitulo}`}
        testIdTitulo="titulo-carteira"
        acoes={
          <>
            <Link href={espaco === "ativos" ? ROTA_CARTEIRA_EX : ROTA_CARTEIRA_ATIVOS} className={BOTAO_SECUNDARIO} data-testid="link-outro-espaco">
              <Users className="h-3.5 w-3.5" aria-hidden /> {espaco === "ativos" ? "Ex-clientes" : "Clientes ativos"}
            </Link>
            <Link href={ROTA_FILA} className={BOTAO_SECUNDARIO} data-testid="link-fila"><ListTodo className="h-3.5 w-3.5" aria-hidden /> Fila do dia</Link>
            <Link href={ROTA_REGUA} className={BOTAO_SECUNDARIO} data-testid="link-regua"><Route className="h-3.5 w-3.5" aria-hidden /> Régua e DNA</Link>
          </>
        }
      />

      {/* KPIs — o mesmo quarteto do CarteiraKpis do Provedor.ai; sem fonte, "—". */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Indicadores" data-testid="kpis-carteira">
        <KpiCarteira rotulo={meta.kpiClientes} valor={valorKpi(clientesNoEspaco)} carregando={isLoading} testId="kpi-clientes" />
        <KpiCarteira rotulo="Em aberto (carteira)" valor={valorKpi(kpis?.emAberto, true)} negativo={Boolean(kpis?.emAberto)} sub="dívida vencida de hoje, segundo o ERP · as duas carteiras" carregando={isLoading} testId="kpi-em-aberto" />
        <KpiCarteira rotulo="Contatados hoje" valor={valorKpi(kpis?.contatadosHoje)} sub="contatos registrados desde a meia-noite" carregando={isLoading} testId="kpi-contatados" />
        <KpiCarteira rotulo="Recuperado 30 d" valor={valorKpi(kpis?.recuperado30d, true)} sub="parcelas pagas + casos pagos" carregando={isLoading} testId="kpi-recuperado" />
      </section>

      {data?.pausada && (
        <p className="rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--text-2)]" data-testid="aviso-pausada">
          <b className="text-[var(--danger)]">Régua pausada:</b> os casos não mudam de etapa até ela ser retomada em <Link href={ROTA_REGUA} className="underline">Régua e DNA</Link>.
        </p>
      )}

      <BarraComposicao composicao={data?.composicao} carregando={isLoading} testId="composicao-carteira" />

      {/* Realidade mensal — só faz sentido para quem AINDA é cliente. */}
      {espaco === "ativos" && (
        <FaixaDoMes
          mes={mes}
          onMes={m => mudar({ mes: m === mesAtual(hoje) ? "" : m })}
          grupo={filtros.mesStatus}
          onGrupo={g => mudar({ mesStatus: g })}
          dados={doMes}
          carregando={carregandoMes}
        />
      )}

      <section className="flex flex-wrap items-center gap-2" aria-label="Filtros" data-testid="filtros-carteira">
        <div className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
          <input
            aria-label="Buscar por nome ou documento"
            placeholder="Buscar por nome ou CPF/CNPJ…"
            className={cn(CONTROLE_CAMPO, "pl-8")}
            value={buscaDigitada}
            onChange={e => setBuscaDigitada(e.target.value)}
            data-testid="busca-carteira"
          />
        </div>
        <FiltroPilula rotulo="Quadrante DNA" valor={filtros.quadrante} opcoes={OPCOES_QUADRANTE} onChange={v => mudar({ quadrante: v })} testId="filtro-quadrante" />
        <FiltroPilula rotulo="Saúde" valor={filtros.saude} opcoes={OPCOES_SAUDE} onChange={v => mudar({ saude: v })} testId="filtro-saude" />
        <FiltroPilula rotulo="Etapa da régua" valor={filtros.etapa} opcoes={OPCOES_ETAPA} onChange={v => mudar({ etapa: v })} testId="filtro-etapa" />
        {/* Situação ERP fixada pelo espaço — como o rail do Provedor.ai. */}
        <span
          className="inline-flex h-8 items-center gap-1.5 rounded border border-[var(--past-border)] bg-[var(--past-bg)] px-2.5 text-[12px] font-medium text-[var(--past)] opacity-80"
          title={`Fixado pelo espaço ${meta.titulo}`}
          data-testid="filtro-situacao-erp"
        >
          Situação ERP: {meta.situacaoErp}
        </span>
        <FiltroPilula rotulo="Situação do caso" valor={filtros.status} opcoes={OPCOES_STATUS} onChange={v => mudar({ status: v })} testId="filtro-status" />
        <FiltroPilula rotulo="Bairro" valor={filtros.bairro} opcoes={opcoesBairro} onChange={v => mudar({ bairro: v })} testId="filtro-bairro" />
        <FiltroPilula rotulo="Dívida" valor={filtros.divida} opcoes={OPCOES_DIVIDA} onChange={v => mudar({ divida: v })} testId="filtro-divida" />
        {filtrado && (
          <button type="button" className={cn(BOTAO_SECUNDARIO, "border-transparent")} onClick={limpar} data-testid="limpar-filtros">
            <X className="h-3.5 w-3.5" aria-hidden /> Limpar
          </button>
        )}
        <span className="ml-auto"><Segmentado opcoes={OPCOES_VISAO} valor={visao} onChange={trocarVisao} rotulo="Visão da carteira" /></span>
      </section>

      {isError ? (
        <AvisoNaoCarregou aoTentarDeNovo={() => refetch()} testId="erro-carteira">Não foi possível carregar a carteira: {mensagemDoErro(error)}</AvisoNaoCarregou>
      ) : mostrarSkeleton ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy>
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[236px] rounded-lg" />)}
        </div>
      ) : !isLoading && itens.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <EstadoVazio
            Icone={Users}
            titulo={filtrado ? "Nenhum cliente com estes filtros" : meta.vazio}
            descricao={filtrado ? "Ajuste a busca ou os filtros para ver mais clientes." : "A carteira nasce do sync do ERP: quando um cliente aparecer, ele entra aqui sozinho."}
            cta={filtrado ? <button type="button" className={BOTAO_SECUNDARIO} onClick={limpar}>Limpar filtros</button> : undefined}
            testId="carteira-vazia"
          />
        </div>
      ) : visao === "cards" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="grade-cards">
          {itens.map(item => (
            <CardCliente key={item.customerId} item={item} etapas={regua?.etapas} hoje={hoje} onAbrir={() => navigate(rotaDoCliente(item.customerId))} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <TabelaPainel testId="tabela-carteira">
            <thead>
              <tr>
                <Th>cliente</Th><Th>cpf / cnpj</Th><Th>plano</Th><Th alinhamento="direita">mrr</Th>
                <Th alinhamento="direita">em aberto</Th><Th alinhamento="direita">atraso</Th>
                <Th>dna</Th><Th>saúde</Th><Th alinhamento="direita">crédito</Th><Th alinhamento="direita">propensão</Th>
                <Th>etapa</Th><Th>responsável</Th><Th>próx. contato</Th><Th>status</Th>
              </tr>
            </thead>
            <tbody>
              {itens.map(item => (
                <LinhaDoCliente key={item.customerId} item={item} etapas={regua?.etapas} hoje={hoje} onAbrir={() => navigate(rotaDoCliente(item.customerId))} />
              ))}
            </tbody>
          </TabelaPainel>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-[var(--text-muted)]" data-testid="rodape-carteira">
        <span>
          Mostrando <b className="font-mono tabular-nums text-[var(--text)]">{isLoading ? "…" : num(itens.length)}</b> de{" "}
          <b className="font-mono tabular-nums text-[var(--text)]">{isLoading ? "…" : num(total)}</b> · documento mascarado (LGPD) · o que o ERP não informou é "—"
        </span>
        <span className="inline-flex items-center gap-2">
          <BotaoIcone Icone={ChevronLeft} rotulo="Página anterior" disabled={isLoading || filtros.pagina <= 1} onClick={() => mudar({ pagina: filtros.pagina - 1 })} />
          <span className="font-mono tabular-nums">página {num(filtros.pagina)} de {isLoading ? "…" : num(paginas)}</span>
          <BotaoIcone Icone={ChevronRight} rotulo="Próxima página" disabled={isLoading || filtros.pagina >= paginas} onClick={() => mudar({ pagina: filtros.pagina + 1 })} />
          <span className="text-[var(--text-faint)]">· {POR_PAGINA} por página</span>
        </span>
        <span className="inline-flex items-center gap-1"><LayoutGrid className="h-3.5 w-3.5" aria-hidden /> clique no card ou na linha para abrir o cliente 360</span>
      </footer>
    </div>
  );
}
