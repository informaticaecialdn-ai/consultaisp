/**
 * /cobranca — a carteira de cobrança: quem deve, quanto, há quanto tempo e em
 * que pé está a cobrança de cada um.
 *
 * Duas carteiras de peso igual — "Clientes (ativos)" e "Ex-clientes" —, cada
 * uma com a própria régua. KPIs em cima, a composição da base inteira, as
 * pílulas de filtro (todas server-side: um filtro que o servidor não recebe
 * mentiria o total do rodapé), e a lista em cards ou tabela. Os filtros
 * vivem na URL para a régua e o DNA apontarem para um recorte.
 *
 * Nada aqui calcula dívida, atraso ou DNA: a tela desenha o que
 * `GET /api/cobranca/carteira` mandou; o que não veio é "—".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ChevronLeft, ChevronRight, HandCoins, LayoutGrid, ListTodo, Route, Search, Users, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ROTULO_CARTEIRA, type Carteira } from "@shared/cobranca";
import { brl, Kpi, num, Segmentado, TRACO } from "@/components/localizacao/ui";
import {
  ABA, AvisoNaoCarregou, BOTAO_SECUNDARIO, BotaoIcone, CabecalhoPainel, CONTROLE_CAMPO, EstadoVazio, TabelaPainel, Th,
} from "@/components/painel/ui";
import { CardCliente, LinhaDoCliente } from "@/components/cobranca/CardCliente";
import {
  CHAVE_VISAO, FILTROS_INICIAIS, filtrosDaUrl, lerVisao, limparFiltros, mesmosFiltros, OPCOES_DIVIDA, OPCOES_ETAPA, OPCOES_QUADRANTE, OPCOES_SAUDE,
  OPCOES_STATUS, POR_PAGINA, queryDaCarteira, temFiltros, totalDePaginas, type FiltrosDaCarteira, type OpcaoDeFiltro, type VisaoDaCarteira,
} from "@/components/cobranca/filtros";
import { API_CARTEIRA, API_REGUA, ROTA_CARTEIRA, ROTA_FILA, ROTA_REGUA, rotaDoCliente, type RespostaDaCarteira, type RespostaDaRegua } from "@/components/cobranca/tipos";
import { BarraComposicao, FiltroPilula, mensagemDoErro, useSkeletonAtrasado } from "@/components/cobranca/ui";

const OPCOES_VISAO: Array<{ k: VisaoDaCarteira; rotulo: string }> = [
  { k: "cards", rotulo: "Cards" },
  { k: "tabela", rotulo: "Tabela" },
];

export default function CarteiraPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const [filtros, setFiltros] = useState<FiltrosDaCarteira>(() => filtrosDaUrl(search));
  const [buscaDigitada, setBuscaDigitada] = useState(filtros.busca);
  const [visao, setVisao] = useState<VisaoDaCarteira>(() => lerVisao(typeof localStorage === "undefined" ? null : localStorage));
  const hoje = useMemo(() => new Date(), []);

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
    const alvo = query === queryDaCarteira(FILTROS_INICIAIS) ? ROTA_CARTEIRA : `${ROTA_CARTEIRA}?${query}`;
    if (`${window.location.pathname}${window.location.search}` !== alvo) navigate(alvo, { replace: true });
  }, [query, navigate]);

  // E o inverso: a URL que muda POR FORA (item do menu, link do DNA "ver
  // carteira deste quadrante", botão voltar) vira estado. Sem isto a tela
  // ficava presa nos filtros da primeira montagem — o link do DNA abria a
  // mesma carteira de antes. Não há laço: o efeito acima só navega quando o
  // estado difere da URL, e este só muda o estado quando a URL difere dele.
  // A comparação é com os filtros ATUAIS (ref), não com a busca digitada: a
  // URL fica 350 ms atrás da caixa, e sincronizar a caixa pela URL apagaria
  // a letra que o operador acabou de digitar.
  const filtrosAtuais = useRef(filtros);
  filtrosAtuais.current = filtros;
  useEffect(() => {
    const daUrl = filtrosDaUrl(search);
    if (mesmosFiltros(filtrosAtuais.current, daUrl)) return;
    setFiltros(daUrl);
    setBuscaDigitada(daUrl.busca);
  }, [search]);

  const { data, isLoading, isError, error, refetch } = useQuery<RespostaDaCarteira>({
    queryKey: [`${API_CARTEIRA}?${query}`],
    staleTime: 30_000,
  });
  const { data: regua } = useQuery<RespostaDaRegua>({ queryKey: [API_REGUA], staleTime: 300_000 });
  const mostrarSkeleton = useSkeletonAtrasado(isLoading);

  const mudar = (mudanca: Partial<FiltrosDaCarteira>) => setFiltros(atual => ({ ...atual, ...mudanca, pagina: mudanca.pagina ?? 1 }));
  const trocarVisao = (v: VisaoDaCarteira) => {
    setVisao(v);
    try { localStorage.setItem(CHAVE_VISAO, v); } catch { /* sem storage: só não persiste */ }
  };

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

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6" data-testid="cobranca-carteira">
      <CabecalhoPainel
        titulo="Carteira de cobrança"
        descricao="Clientes ativos com dívida e ex-clientes, cada carteira com a própria régua. O tom vem do DNA; o quando, da régua."
        testIdTitulo="titulo-carteira"
        acoes={
          <>
            <Link href={ROTA_FILA} className={BOTAO_SECUNDARIO} data-testid="link-fila"><ListTodo className="h-3.5 w-3.5" aria-hidden /> Fila do dia</Link>
            <Link href={ROTA_REGUA} className={BOTAO_SECUNDARIO} data-testid="link-regua"><Route className="h-3.5 w-3.5" aria-hidden /> Régua e DNA</Link>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-5" aria-label="Indicadores" data-testid="kpis-carteira">
        <Kpi icone={<Users className="h-4 w-4" aria-hidden />} iconeCor="var(--gated)" iconeBg="var(--gated-bg)" rotulo="ativos com dívida" valor={valorKpi(kpis?.ativosComDivida)} sub="clientes atuais em atraso" titulo="customers ativos ou suspensos com dívida" />
        <Kpi icone={<Users className="h-4 w-4" aria-hidden />} iconeCor="var(--past)" iconeBg="var(--past-bg)" rotulo="ex-clientes com dívida" valor={valorKpi(kpis?.exClientesComDivida)} sub="saíram devendo" />
        <Kpi icone={<HandCoins className="h-4 w-4" aria-hidden />} iconeCor="var(--money-neg)" iconeBg="var(--past-bg)" rotulo="em aberto" valor={valorKpi(kpis?.emAberto, true)} valorCor={kpis?.emAberto ? "var(--money-neg)" : undefined} sub="dívida de hoje, segundo o ERP" />
        <Kpi icone={<ListTodo className="h-4 w-4" aria-hidden />} iconeCor="var(--brand-ink)" iconeBg="var(--brand-soft)" rotulo="contatados hoje" valor={valorKpi(kpis?.contatadosHoje)} sub="contatos registrados desde a meia-noite" />
        <Kpi icone={<HandCoins className="h-4 w-4" aria-hidden />} iconeCor="var(--ok)" iconeBg="var(--ok-bg)" rotulo="recuperado 30 d" valor={valorKpi(kpis?.recuperado30d, true)} sub="parcelas pagas + casos pagos" />
      </section>

      {data?.pausada && (
        <p className="rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--text-2)]" data-testid="aviso-pausada">
          <b className="text-[var(--danger)]">Régua pausada:</b> os casos não mudam de etapa até ela ser retomada em <Link href={ROTA_REGUA} className="underline">Régua e DNA</Link>.
        </p>
      )}

      <BarraComposicao composicao={data?.composicao} carregando={isLoading} testId="composicao-carteira" />

      {/* Trocar de aba limpa TUDO, inclusive o que está digitado na busca: o
          filtro já saía, mas o texto ficava na caixa fingindo estar aplicado. */}
      <Tabs value={filtros.carteira} onValueChange={v => { setBuscaDigitada(""); mudar({ ...limparFiltros(filtros), carteira: v as Carteira }); }}>
        <TabsList className="grid h-auto w-full max-w-[420px] grid-cols-2 rounded-md bg-[var(--surface-inset)] p-1" data-testid="abas-carteira">
          <TabsTrigger value="ativo" className={ABA} data-testid="aba-ativos">Clientes (ativos)</TabsTrigger>
          <TabsTrigger value="ex_cliente" className={ABA} data-testid="aba-ex-clientes">{ROTULO_CARTEIRA.ex_cliente}</TabsTrigger>
        </TabsList>
      </Tabs>

      <section className="flex flex-wrap items-center gap-2" aria-label="Filtros" data-testid="filtros-carteira">
        <div className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
          <input
            aria-label="Buscar por nome ou documento"
            placeholder="Nome ou CPF/CNPJ"
            className={cn(CONTROLE_CAMPO, "pl-8")}
            value={buscaDigitada}
            onChange={e => setBuscaDigitada(e.target.value)}
            data-testid="busca-carteira"
          />
        </div>
        <FiltroPilula rotulo="Quadrante DNA" valor={filtros.quadrante} opcoes={OPCOES_QUADRANTE} onChange={v => mudar({ quadrante: v })} testId="filtro-quadrante" />
        <FiltroPilula rotulo="Saúde" valor={filtros.saude} opcoes={OPCOES_SAUDE} onChange={v => mudar({ saude: v })} testId="filtro-saude" />
        <FiltroPilula rotulo="Etapa da régua" valor={filtros.etapa} opcoes={OPCOES_ETAPA} onChange={v => mudar({ etapa: v })} testId="filtro-etapa" />
        <FiltroPilula rotulo="Situação do caso" valor={filtros.status} opcoes={OPCOES_STATUS} onChange={v => mudar({ status: v })} testId="filtro-status" />
        <FiltroPilula rotulo="Bairro" valor={filtros.bairro} opcoes={opcoesBairro} onChange={v => mudar({ bairro: v })} testId="filtro-bairro" />
        <FiltroPilula rotulo="Dívida" valor={filtros.divida} opcoes={OPCOES_DIVIDA} onChange={v => mudar({ divida: v })} testId="filtro-divida" />
        {filtrado && (
          <button type="button" className={cn(BOTAO_SECUNDARIO, "border-transparent")} onClick={() => { setBuscaDigitada(""); setFiltros(limparFiltros(filtros)); }} data-testid="limpar-filtros">
            <X className="h-3.5 w-3.5" aria-hidden /> Limpar
          </button>
        )}
        <span className="ml-auto"><Segmentado opcoes={OPCOES_VISAO} valor={visao} onChange={trocarVisao} rotulo="Visão da carteira" /></span>
      </section>

      {isError ? (
        <AvisoNaoCarregou aoTentarDeNovo={() => refetch()} testId="erro-carteira">Não foi possível carregar a carteira: {mensagemDoErro(error)}</AvisoNaoCarregou>
      ) : mostrarSkeleton ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[236px] rounded-lg" />)}
        </div>
      ) : !isLoading && itens.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <EstadoVazio
            Icone={Users}
            titulo={filtrado ? "Nenhum cliente com estes filtros" : filtros.carteira === "ativo" ? "Nenhum cliente ativo com dívida" : "Nenhum ex-cliente com dívida"}
            descricao={filtrado ? "Ajuste a busca ou os filtros para ver mais clientes." : "A carteira nasce do sync do ERP: quando um cliente aparecer com fatura vencida, ele entra aqui sozinho."}
            cta={filtrado ? <button type="button" className={BOTAO_SECUNDARIO} onClick={() => { setBuscaDigitada(""); setFiltros(limparFiltros(filtros)); }}>Limpar filtros</button> : undefined}
            testId="carteira-vazia"
          />
        </div>
      ) : visao === "cards" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="grade-cards">
          {itens.map(item => (
            <CardCliente key={item.customerId} item={item} etapas={regua?.etapas} hoje={hoje} onAbrir={() => navigate(rotaDoCliente(item.customerId))} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <TabelaPainel testId="tabela-carteira">
            <thead>
              <tr>
                <Th>cliente</Th><Th>documento</Th><Th>plano</Th><Th>situação erp</Th>
                <Th alinhamento="direita">em aberto</Th><Th alinhamento="direita">atraso</Th>
                <Th>dna</Th><Th>crédito</Th><Th>etapa</Th><Th>responsável</Th><Th>próx. contato</Th><Th>caso</Th>
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
