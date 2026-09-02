import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { MapPin, Banknote, Users, Satellite, Map as MapIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import MapaCarteira, {
  FAIXAS_OCORRENCIA,
  type PontoMapa, type BairroRede, type PontoRedeItem, type CidadeMapa,
  type ModoMapa, type SedeMapa,
} from "@/components/maps/MapaCarteira";
import { ESTADO_META, ESTADOS_NO_MAPA, type EstadoPonto } from "@/components/maps/estado-ponto";
import { geoAproximada } from "@shared/geo-precisao";
import {
  Chip, Kicker, Kpi, Camada, GrupoCamadas, Selo, MONO, CARD, brl, num, pct, TRACO,
} from "@/components/localizacao/ui";
import RankingBairros, {
  MIN_CLIENTES_RANKING, type BairroRanking, type OrdemRanking,
} from "@/components/localizacao/RankingBairros";
import RaioXBairro from "@/components/localizacao/RaioXBairro";
import PainelRede from "@/components/localizacao/PainelRede";

/**
 * Localização & mapa de inadimplência.
 *
 * Anatomia da referência (Provedor.ai · Cobrança · Localização v3): cabeçalho
 * com chips de cidade à direita, quatro KPIs, mapa e ranking de bairros na
 * mesma altura, raio-X do bairro embaixo. Uma diferença, deliberada: o mapa é
 * de bureau e SÓ plota quem tem fatura em aberto — cliente ativo em dia não
 * entra. O corte é no servidor (localizacao.storage.ts); aqui nem legenda nem
 * filtro conhecem o estado `em_dia`.
 */

type Sede = { cidade: string; uf: string | null; lat: number | null; lon: number | null; foraDaArea: boolean };

type Resposta = {
  origemArea: 'cidades' | 'meso' | 'uf' | 'nenhuma';
  sede: Sede | null;
  semCoordenada: number;
  /** Subconjunto de semCoordenada que a plotagem automática resolve sozinha. */
  plotaveis: number;
  coordenadaSuspeita: Array<{ id: number; cidade: string; lat: number; lon: number }>;
  cidades: CidadeMapa[];
  cidadesSemCliente: string[];
  /** Clientes que o recorte territorial deixou de fora do mapa. */
  foraDoMapa: number;
  cidadesForaDoMapa: Array<{ cidade: string; clientes: number; inadimplentes: number }>;
  /** Toda cidade da carteira, com o porque de estar ou nao no mapa. */
  catalogoCidades: Array<{
    cidade: string; clientes: number; inadimplentes: number;
    noMapa: boolean; motivo: 'massa' | 'poucos' | 'excluida';
  }>;
  pontos: PontoMapa[];
  bairros: BairroRanking[];
  porEstado: Record<EstadoPonto, number>;
  sincronizadoEm: string | null;
};

/** Só o estado do trabalho; as contagens vêm de /api/localizacao. */
type Plotagem = {
  emAndamento: boolean;
  geocoderIndisponivel: boolean;
  terminadoEm: string | null;
};

/**
 * Espelha MIN_CLIENTES_CIDADE de localizacao.storage.ts — quem decide o corte
 * e o servidor; aqui e so para o texto do aviso dizer o mesmo numero.
 */
const MIN_CLIENTES_CIDADE = 20;

const FAIXAS: Array<{ k: string; label: string; teste: (v: number) => boolean }> = [
  { k: 'todas',      label: 'Todas',        teste: () => true },
  // "Em dia" não existe: nenhum ponto do mapa tem dívida zero, então o filtro
  // só devolveria tela vazia. As faixas descrevem tamanho de dívida.
  { k: 'ate100',     label: 'até R$ 100',   teste: v => v > 0 && v <= 100 },
  { k: 'de100a300',  label: 'R$ 100–300',   teste: v => v > 100 && v <= 300 },
  { k: 'de300a1000', label: 'R$ 300–1.000', teste: v => v > 300 && v <= 1000 },
  { k: 'acima1000',  label: 'R$ 1.000+',    teste: v => v > 1000 },
];

const ALTURA_MAPA = 480;

const dataCurta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : null;

function LinhaFiltro({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Kicker style={{ width: 52, flexShrink: 0, color: "var(--text-faint)" }}>{rotulo}</Kicker>
      {children}
    </div>
  );
}

/** Linha da legenda sobre o mapa: swatch com traço branco, o mesmo do marcador. */
function LinhaLegenda({ cor, rotulo, n }: { cor: string; rotulo: React.ReactNode; n?: number }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7, marginTop: 4,
      fontSize: 11.5, color: "var(--text-2)", opacity: n === 0 ? 0.55 : 1,
    }}>
      <span style={{
        width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: cor,
        // Espelho do traço do marcador no canvas (branco literal): a legenda
        // tem de retratar o mapa em qualquer tema.
        border: "1.5px solid #fff", boxShadow: "0 0 0 .5px var(--border-strong)",
      }} />
      <span style={{ flex: 1, minWidth: 0 }}>{rotulo}</span>
      {n !== undefined && (
        <span style={{ ...MONO, color: "var(--text-muted)" }}>{num(n)}</span>
      )}
    </div>
  );
}

export default function LocalizacaoPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: plotagem } = useQuery<Plotagem>({
    queryKey: ["/api/localizacao/plotagem"],
    refetchInterval: q => ((q.state.data as Plotagem | undefined)?.emAndamento ? 5000 : false),
  });
  const plotando = plotagem?.emAndamento ?? false;

  const { data, isLoading } = useQuery<Resposta>({
    queryKey: ["/api/localizacao"],
    refetchInterval: plotando ? 15000 : false,
  });

  const rodavaAntes = useRef(false);
  useEffect(() => {
    if (rodavaAntes.current && !plotando) {
      queryClient.invalidateQueries({ queryKey: ["/api/localizacao"] });
    }
    rodavaAntes.current = plotando;
  }, [plotando]);

  const plotarAgora = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/localizacao/plotagem")).json(),
    onSuccess: (r: { iniciado: boolean; mensagem: string }) => {
      toast({ title: r.iniciado ? "Plotagem iniciada" : "Já em andamento", description: r.mensagem });
      queryClient.invalidateQueries({ queryKey: ["/api/localizacao/plotagem"] });
      queryClient.invalidateQueries({ queryKey: ["/api/localizacao"] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível iniciar", description: e.message, variant: "destructive" }),
  });

  // Só admin muda o recorte do mapa: é configuração da conta, não filtro de
  // sessão — o que um operador tira some para todos.
  const podeAdministrar = user?.role === 'admin' || user?.role === 'superadmin';
  const [cidadeMexendo, setCidadeMexendo] = useState<string | null>(null);
  const [escolherCidades, setEscolherCidades] = useState(false);

  const alternarCidade = useMutation({
    mutationFn: async ({ cidade, excluir }: { cidade: string; excluir: boolean }) =>
      (await apiRequest("PATCH", `/api/localizacao/cidades/${encodeURIComponent(cidade)}`, { excluir })).json(),
    onSuccess: (_r, v) => {
      queryClient.invalidateQueries({ queryKey: ["/api/localizacao"] });
      toast({ title: v.excluir ? `${v.cidade} saiu do mapa` : `${v.cidade} voltou ao mapa` });
    },
    onError: (e: Error) => toast({ title: "Não foi possível alterar", description: e.message, variant: "destructive" }),
    onSettled: () => setCidadeMexendo(null),
  });

  const [fCidade, setFCidade] = useState<string | null>(null);
  const [fEstado, setFEstado] = useState<EstadoPonto | "todos">("todos");
  const [fDivida, setFDivida] = useState("todas");
  // "Menor %" primeiro — pedido literal do dono na referência: dos menores
  // para os maiores.
  const [ordem, setOrdem] = useState<OrdemRanking>("menor");
  const [bairroSel, setBairroSel] = useState<string | null>(null);
  const [calor, setCalor] = useState(false);
  const [modo, setModo] = useState<ModoMapa>('carteira');
  // Duas leituras da mesma rede: a bolha diz quanto o bairro pesa, o ponto diz
  // como os casos se espalham dentro dele.
  const [redePorPonto, setRedePorPonto] = useState(false);

  // A rede: ex-clientes com dívida de TODOS os provedores nas cidades que este
  // provedor atende. É o desenho do modo regionalização, e só é buscado quando
  // esse modo está ligado.
  const { data: redeRegional, isFetching: redeRegionalCarregando } = useQuery<{
    bairros: BairroRede[]; pontos: PontoRedeItem[]; ocultas: number; semPonto?: number; semArea: boolean; minPorBairro: number;
  }>({
    queryKey: ["/api/localizacao/rede"],
    enabled: modo === 'regionalizacao',
  });
  const bairrosRede = useMemo(() => {
    const todos = redeRegional?.bairros ?? [];
    return fCidade ? todos.filter(b => b.cidade === fCidade) : todos;
  }, [redeRegional, fCidade]);
  const casosNaRede = useMemo(
    () => bairrosRede.reduce((s, b) => s + b.ocorrencias, 0), [bairrosRede]);
  const pontosRede = useMemo(() => {
    const todos = redeRegional?.pontos ?? [];
    return fCidade ? todos.filter(p => p.cidade === fCidade) : todos;
  }, [redeRegional, fCidade]);

  const naFila = data?.plotaveis ?? 0;
  const foraDaFila = (data?.semCoordenada ?? 0) - naFila;

  const todosPontos = data?.pontos ?? [];
  const todosBairros = data?.bairros ?? [];
  const cidades = data?.cidades ?? [];
  const semCliente = data?.cidadesSemCliente ?? [];
  const catalogo = data?.catalogoCidades ?? [];
  const noMapa = catalogo.filter(c => c.noMapa);
  const foraDoMapa = catalogo.filter(c => !c.noMapa);

  /* O chip de cidade conta DEVEDORES, não a carteira.
     O chip é um filtro do mapa, e o mapa só tem quem deve: "Londrina 161" com
     40 pontos aparecendo faria o operador procurar 121 pontos que não existem.
     A carteira por cidade continua visível no painel de cidades, onde ela é a
     informação certa, porque é ela que decide o corte de 20. */
  const devedoresPorCidade = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of todosPontos) m.set(p.cidade, (m.get(p.cidade) ?? 0) + 1);
    return m;
  }, [todosPontos]);

  /* O recorte de cidade vale para TUDO: mapa, ranking e raio-X respondem ao
     mesmo universo. Os filtros de estado e dívida, não — eles são lentes sobre
     o mapa, e o ranking anuncia que conta a carteira inteira. */
  const pontos = useMemo(
    () => (fCidade ? todosPontos.filter(p => p.cidade === fCidade) : todosPontos),
    [todosPontos, fCidade],
  );
  const bairros = useMemo(
    () => (fCidade ? todosBairros.filter(b => b.cidade === fCidade) : todosBairros),
    [todosBairros, fCidade],
  );

  const sede = data?.sede ?? null;
  const sedeNoMapa: SedeMapa | null =
    sede && sede.lat !== null && sede.lon !== null
      ? { cidade: sede.cidade, uf: sede.uf, lat: sede.lat, lon: sede.lon }
      : null;

  const faixa = FAIXAS.find(f => f.k === fDivida) ?? FAIXAS[0];
  const filtrados = useMemo(
    () => pontos.filter(p =>
      (fEstado === "todos" || p.estado === fEstado) &&
      faixa.teste(p.emAberto) &&
      (bairroSel === null || p.bairro === bairroSel)),
    [pontos, fEstado, faixa, bairroSel],
  );

  /* KPIs 1 e 2 leem a CARTEIRA do recorte, não o subconjunto filtrado: trocar a
     lente do mapa não pode mudar quanto o provedor tem a receber. */
  const campeao = useMemo(() => {
    const elegiveis = bairros.filter(b => b.clientes >= MIN_CLIENTES_RANKING);
    return elegiveis.reduce<BairroRanking | null>(
      (m, b) => (m === null || b.pctInadimplencia > m.pctInadimplencia ? b : m), null,
    );
  }, [bairros]);

  const vencidoNoMapa = useMemo(() => pontos.reduce((s, p) => s + p.emAberto, 0), [pontos]);

  /* A legenda descreve o MAPA: conta os pontos do recorte de cidade, antes das
     lentes de estado e dívida. Quem está sem coordenada tem KPI próprio. */
  const porEstadoNoMapa = useMemo(() => {
    const acc: Record<EstadoPonto, number> = { em_dia: 0, em_cobranca: 0, suspenso: 0, ex_divida: 0 };
    for (const p of pontos) acc[p.estado]++;
    return acc;
  }, [pontos]);
  /* Pontos que só afirmam o bairro — translúcidos no mapa, ditos na legenda. */
  const aproximados = useMemo(() => pontos.filter(p => geoAproximada(p.precisao)).length, [pontos]);

  const trocarCidade = (c: string | null) => { setFCidade(c); setBairroSel(null); };
  const trocarModo = () => {
    setModo(m => (m === 'carteira' ? 'regionalizacao' : 'carteira'));
    setBairroSel(null);
  };
  const sincronizado = dataCurta(data?.sincronizadoEm ?? null);

  const tituloLegenda = calor
    ? (modo === 'regionalizacao' ? 'Calor da rede' : 'Calor de dívida')
    : modo === 'regionalizacao'
      ? (redePorPonto ? 'Dívida na rede' : 'Casos na rede')
      : 'Estado do cliente';

  return (
    <div className="p-4 lg:p-6 space-y-4" data-testid="localizacao-page">
      {/* ── Cabeçalho: título à esquerda, chips de cidade à direita ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-medium tracking-[-0.02em] text-[var(--text)] leading-tight">
            Localização &amp; mapa de inadimplência
          </h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-1">
            Geomarketing da inadimplência: pontos reais geocodificados, calor de dívida e
            ranking de bairros. Só quem tem fatura em aberto entra no mapa — as taxas de
            bairro usam a carteira inteira como denominador.
          </p>
        </div>

        {cidades.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Kicker style={{ marginRight: 2 }}>Cidade</Kicker>
            <Chip ativo={fCidade === null} onClick={() => trocarCidade(null)} contagem={todosPontos.length}>
              Todas
            </Chip>
            {cidades.map(c => (
              <Chip
                key={c.cidade}
                ativo={fCidade === c.cidade}
                onClick={() => trocarCidade(fCidade === c.cidade ? null : c.cidade)}
                contagem={devedoresPorCidade.get(c.cidade) ?? 0}
              >
                {c.cidade}
              </Chip>
            ))}
            {/* O corte automático de cidades e a correção dele na mão vivem
                atrás deste botão: no fluxo do dia a dia a tela vai do título
                aos KPIs, como a referência. */}
            {catalogo.length > 1 && (
              <button
                type="button"
                onClick={() => setEscolherCidades(v => !v)}
                aria-expanded={escolherCidades}
                className="ds-ctl"
                title="Quais cidades da carteira entram no mapa"
                style={{
                  ...MONO, fontSize: 10, textTransform: "uppercase", letterSpacing: "var(--track-wide)",
                  color: "var(--brand)", background: "none", border: 0, cursor: "pointer",
                  padding: "0 6px", minHeight: 28,
                }}
                data-testid="escolher-cidades"
              >
                {escolherCidades ? "fechar" : "escolher"}
                {!escolherCidades && foraDoMapa.length > 0 && (
                  <span style={{ color: "var(--text-faint)" }}> · {num(foraDoMapa.length)} fora</span>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* O texto mudou junto com o comportamento: o mapa da CARTEIRA nunca
          dependeu da Regionalização e agora não depende mesmo — mostra a
          carteira inteira. Quem depende dela é a camada Rede, que traz dado
          de outros provedores e precisa de recorte. */}
      {data?.origemArea === 'nenhuma' && (
        <div className="rounded-lg bg-[var(--gated-bg)] px-4 py-3 text-[13px] text-[var(--gated)]">
          Sem cidades atendidas configuradas, a camada <strong>Rede</strong>{" "}
          — que mostra ex-clientes com dívida de outros provedores — fica vazia.
          A sua carteira aparece normalmente.{" "}
          <Link href="/configuracoes/regionalizacao" className="underline font-medium">
            Configurar Regionalização
          </Link>
        </div>
      )}

      {/* CIDADES NO MAPA — o corte automático, e a correção dele na mão.
          O piso de 20 clientes acerta na maioria e erra num caso comum: o
          endereço de cobrança numa capital junta dezenas de clientes, passa o
          piso e não é praça. Por isso a lista é operável, não só informativa. */}
      {escolherCidades && catalogo.length > 1 && (
        <div style={{ ...CARD }} className="px-4 py-3" data-testid="painel-cidades">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="text-[12.5px] text-[var(--text-2)]">
              <strong className="font-semibold text-[var(--text)]">
                {noMapa.length} cidade{noMapa.length === 1 ? "" : "s"} no mapa
              </strong>
              {foraDoMapa.length > 0 && (
                <span className="text-[var(--text-muted)]">
                  {" "}· {foraDoMapa.length} fora ({num(data!.foraDoMapa)} cliente{data!.foraDoMapa === 1 ? "" : "s"})
                </span>
              )}
            </span>
            <span className="text-[11.5px] text-[var(--text-muted)]">
              Cidade com menos de {MIN_CLIENTES_CIDADE} clientes fica fora sozinha —
              endereço avulso não é praça. As demais você escolhe.
            </span>
          </div>

          <div className="flex flex-col mt-2">
            {catalogo.map(c => {
              const emAndamento = alternarCidade.isPending && cidadeMexendo === c.cidade;
              return (
                <div
                  key={c.cidade}
                  className="flex items-center justify-between gap-3 py-2 border-b border-[var(--border-faint)] last:border-b-0"
                  data-testid={`cidade-${c.cidade}`}
                >
                  <div className="min-w-0 flex items-baseline gap-2">
                    <span className={`text-[13px] ${c.noMapa ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}>
                      {c.cidade}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                      {num(c.clientes)}
                    </span>
                    {c.inadimplentes > 0 && (
                      <span className="font-mono text-[10.5px] tabular-nums text-[var(--past)]">
                        {num(c.inadimplentes)} inad.
                      </span>
                    )}
                  </div>

                  {c.motivo === 'poucos' ? (
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--text-faint)] shrink-0">
                      poucos clientes
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={!podeAdministrar || emAndamento}
                      onClick={() => {
                        setCidadeMexendo(c.cidade);
                        alternarCidade.mutate({ cidade: c.cidade, excluir: c.noMapa });
                      }}
                      className="ds-ctl shrink-0 rounded border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.06em] disabled:opacity-50"
                      style={{
                        borderColor: c.noMapa ? "var(--border)" : "var(--brand)",
                        color: c.noMapa ? "var(--text-muted)" : "var(--brand)",
                        background: "var(--surface)",
                      }}
                      title={podeAdministrar
                        ? (c.noMapa ? "Tirar do mapa" : "Voltar ao mapa")
                        : "Só administradores mudam isto"}
                      data-testid={`toggle-cidade-${c.cidade}`}
                    >
                      {emAndamento ? "…" : c.noMapa ? "tirar do mapa" : "voltar ao mapa"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Os quatro KPIs ── */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[82px]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            icone={<MapPin size={16} strokeWidth={1.5} />}
            iconeCor="var(--danger)" iconeBg="var(--danger-bg)"
            rotulo="Bairro campeão · inadimplência"
            valor={campeao?.bairro ?? TRACO}
            valorMono={false}
            titulo={`Campeão só entre bairros com ${MIN_CLIENTES_RANKING}+ clientes — 100% com 1 cliente é ruído, não bússola.`}
            sub={campeao
              ? `${pct(campeao.pctInadimplencia)} · ${brl(campeao.dividaTotal)} · ${num(campeao.clientes)} clientes`
              : `sem bairro com ${MIN_CLIENTES_RANKING}+ clientes`}
            subMono={!!campeao}
          />
          <Kpi
            icone={<Banknote size={16} strokeWidth={1.5} />}
            iconeCor="var(--ok)" iconeBg="var(--ok-bg)"
            rotulo="R$ vencido no mapa"
            valor={brl(vencidoNoMapa)} valorCor="var(--money-neg)"
            sub={`${num(pontos.length)} devedores plotados`} subMono
          />
          <Kpi
            icone={<Users size={16} strokeWidth={1.5} />}
            iconeCor="var(--info)" iconeBg="var(--info-bg)"
            rotulo="Devedores no mapa"
            valor={num(pontos.length)}
            sub={`${num(filtrados.length)} visíveis com os filtros atuais`} subMono
          />
          <Kpi
            icone={<Satellite size={16} strokeWidth={1.5} />}
            iconeCor="var(--text-muted)" iconeBg="var(--surface-2)"
            rotulo="Sem coordenada"
            valor={num(data?.semCoordenada ?? 0)}
            sub="carteira sem geocodificação — fora do mapa"
          />
        </div>
      )}

      {/* Situação da plotagem: a tela diz o que está de fato acontecendo, e o
          número é o mesmo do KPI ao lado — sai da mesma varredura. */}
      {plotagem && naFila > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-[13px]"
          style={plotagem.geocoderIndisponivel
            ? { background: "var(--danger-bg)", borderColor: "var(--danger-border)", color: "var(--danger)" }
            : { background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-2)" }}
          data-testid="status-plotagem"
        >
          <span className="min-w-0 flex-1">
            {plotando ? (
              <>
                Plotando agora — {naFila === 1 ? "falta" : "faltam"}{" "}
                <span className="font-mono tabular-nums">{naFila}</span>{" "}
                {naFila === 1 ? "cliente" : "clientes"} na sua carteira.
              </>
            ) : plotagem.geocoderIndisponivel ? (
              <>
                O serviço de geocodificação não respondeu na última varredura.{" "}
                {naFila === 1 ? "O cliente continua" : (<>Os <span className="font-mono tabular-nums">{naFila}</span> clientes continuam</>)}{" "}
                na fila.
              </>
            ) : (
              <>
                <span className="font-mono tabular-nums">{naFila}</span>{" "}
                {naFila === 1 ? "cliente espera" : "clientes esperam"} plotagem. A varredura roda sozinha a cada
                6 horas.
                {foraDaFila > 0 && (foraDaFila === 1
                  ? <> Outro cliente não tem cidade nem CEP no cadastro.</>
                  : <> Outros <span className="font-mono tabular-nums">{foraDaFila}</span> não têm cidade nem CEP no cadastro.</>
                )}
              </>
            )}
          </span>
          {user?.role !== "user" && !plotando && (
            <button
              type="button"
              onClick={() => plotarAgora.mutate()}
              disabled={plotarAgora.isPending}
              className="ds-ctl rounded px-3 py-2 text-[12.5px] font-medium disabled:opacity-60"
              style={{ background: "var(--action)", color: "var(--text-on-brand)", minHeight: 36 }}
              data-testid="botao-plotar-agora"
            >
              {plotarAgora.isPending ? "Iniciando…" : "Plotar agora"}
            </button>
          )}
        </div>
      )}

      {/* ── Mapa + ranking, na mesma altura ── */}
      <div className="ds-mapa-grid">
        <div style={{ ...CARD, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* Cabeçalho do card: título à esquerda, camadas à direita num trilho
              só — o mesmo desenho das pills de camada da referência. */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--border-faint)]">
            <span className="flex items-center gap-2">
              <MapIcon size={14} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} />
              <Kicker>
                {modo === 'carteira' ? 'Mapa real da carteira' : 'Sua região'} · OpenStreetMap
              </Kicker>
            </span>
            <div className="flex flex-wrap items-center gap-2.5">
              <GrupoCamadas>
                <Camada
                  label="Rede"
                  dot="var(--past)"
                  ligada={modo === 'regionalizacao'}
                  onToggle={trocarModo}
                  titulo="Ex-clientes com dívida de todos os provedores nas suas cidades — a pergunta que só o bureau responde. Troca o mapa e o ranking."
                />
                {modo === 'regionalizacao' && !calor && (
                  <Camada
                    label={redePorPonto ? "Por ponto" : "Por bairro"}
                    dot="var(--past)"
                    ligada={redePorPonto}
                    onToggle={() => setRedePorPonto(v => !v)}
                    titulo="A bolha diz quanto o bairro pesa; o ponto diz como os casos se espalham dentro dele."
                  />
                )}
                <Camada
                  label="Mapa de calor"
                  dot="var(--danger)"
                  ligada={calor}
                  onToggle={() => setCalor(v => !v)}
                  titulo={modo === 'regionalizacao'
                    ? "Mancha ponderada pelo número de casos de cada bairro"
                    : "Mancha ponderada pelo valor em aberto de cada cliente"}
                />
                {/* As duas camadas de território dependem de bases públicas que
                    ainda não foram carregadas. Ficam à vista e desabilitadas: o
                    operador precisa saber que a camada existe e o que falta para
                    ela aparecer — sumir da tela seria pior. */}
                <Camada
                  label="Endereços IBGE"
                  dot="var(--info)"
                  ligada={false}
                  desabilitada
                  titulo="Requer a base de endereços do IBGE (CNEFE 2022) carregada para os municípios atendidos."
                />
                <Camada
                  label="UCs ANEEL"
                  dot="var(--brand)"
                  ligada={false}
                  desabilitada
                  titulo="Requer a base de unidades consumidoras da ANEEL (BDGD) carregada para a área atendida."
                />
              </GrupoCamadas>
              {sincronizado && (
                <Selo titulo="A tela mostra a carteira como estava na última sincronização com o ERP.">
                  ERP · {sincronizado}
                </Selo>
              )}
            </div>
          </div>

          {/* Filtros: estado contratual × faixa de dívida, lentes sobre o mapa. */}
          <div className="px-4 pt-2.5 pb-3 space-y-1.5 border-b border-[var(--border-faint)]">
            {modo === 'regionalizacao' ? (
              // O modo rede mostra gente que não é sua. Dizer exatamente o que
              // está no mapa e o que foi omitido não é rodapé jurídico: é o que
              // permite ao provedor usar a informação sem achar que pode bater
              // na porta de alguém.
              <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {redeRegional?.semArea ? (
                  <>
                    Configure as cidades atendidas para ver a rede — sem recorte, isto
                    seria a base inteira do país, não a sua região.{" "}
                    <Link href="/configuracoes/regionalizacao" className="underline font-medium">
                      Configurar Regionalização
                    </Link>
                  </>
                ) : (
                  <>
                    Ex-clientes com dívida de <strong>todos os provedores</strong> nas suas cidades.
                    Sem nome, sem documento e sem dizer de qual provedor veio cada ocorrência.{" "}
                    {redePorPonto && !calor ? (
                      <>
                        Cada ponto é uma ocorrência, com o local <strong>aproximado</strong> — a coordenada
                        é deslocada em até ~150m, o bastante para tirar o número da casa e manter a quadra.
                        Só aparecem bairros com {num(redeRegional?.minPorBairro ?? 3)} ou mais casos.
                        {(redeRegional?.semPonto ?? 0) > 0 && (
                          <> {num(redeRegional!.semPonto!)} {redeRegional!.semPonto === 1 ? "ocorrência não tem" : "ocorrências não têm"} coordenada
                          de procedência conhecida e {redeRegional!.semPonto === 1 ? "entra" : "entram"} só na bolha do bairro.</>
                        )}
                      </>
                    ) : (
                      <>
                        Somados <strong>por bairro</strong>: cada bolha fica no <strong>centro do bairro</strong> pelo
                        censo de endereços do IBGE, com área proporcional ao número de casos. Nenhum cliente
                        aparece sozinho, nenhum nome ou valor sai do servidor, e um bairro só entra com{" "}
                        {num(redeRegional?.minPorBairro ?? 3)} ou mais casos.
                      </>
                    )}
                  </>
                )}
              </p>
            ) : (
              <>
                <LinhaFiltro rotulo="Estado">
                  <Chip ativo={fEstado === "todos"} onClick={() => setFEstado("todos")}>Todos</Chip>
                  {ESTADOS_NO_MAPA.map(e => (
                    <Chip key={e} ativo={fEstado === e} onClick={() => setFEstado(e)}>
                      {ESTADO_META[e].curto}
                    </Chip>
                  ))}
                </LinhaFiltro>
                <LinhaFiltro rotulo="Dívida">
                  {FAIXAS.map(f => (
                    <Chip key={f.k} ativo={fDivida === f.k} onClick={() => setFDivida(f.k)}>{f.label}</Chip>
                  ))}
                </LinhaFiltro>
              </>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {bairroSel ? (
                <Chip ativo onClick={() => setBairroSel(null)} titulo="Clique para voltar à carteira inteira">
                  ✕ {bairroSel}
                </Chip>
              ) : <span />}
              <span style={{ ...MONO, fontSize: 12, color: "var(--text-muted)" }}>
                {modo === 'regionalizacao'
                  ? redeRegionalCarregando ? "carregando…"
                    : redePorPonto && !calor
                      ? <><b style={{ color: "var(--text)", fontWeight: 600 }}>{num(pontosRede.length)}</b> ocorrências no mapa</>
                      : <><b style={{ color: "var(--text)", fontWeight: 600 }}>{num(casosNaRede)}</b> casos em {num(bairrosRede.length)} bairros</>
                  : <><b style={{ color: "var(--text)", fontWeight: 600 }}>{num(filtrados.length)}</b> de {num(pontos.length)} pontos</>}
              </span>
            </div>
          </div>

          <div className="px-4 pt-3 pb-4 relative">
            {isLoading ? <Skeleton style={{ height: ALTURA_MAPA }} className="w-full" /> : (
              <>
                <MapaCarteira
                  pontos={filtrados}
                  bairrosRede={bairrosRede}
                  pontosRede={pontosRede}
                  redePorPonto={redePorPonto}
                  cidades={cidades}
                  sede={sedeNoMapa}
                  modo={modo}
                  calor={calor}
                  bairroFoco={modo === 'regionalizacao' ? null : bairroSel}
                  height={ALTURA_MAPA}
                />
                {/* Legenda sobre o mapa: quem olha o mapa não deveria ter de
                    procurar a chave das cores fora dele. */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    ...CARD, left: 28, bottom: 28, width: 218, padding: "9px 11px",
                    boxShadow: "0 0 0 1px var(--ring-subtle)", zIndex: 500,
                  }}
                  data-testid="legenda-mapa"
                >
                  <Kicker style={{ display: "block", color: "var(--text-faint)", marginBottom: 3 }}>
                    {tituloLegenda}
                  </Kicker>
                  {/* Com o calor ligado não existe marcador — manter a chave
                      das bolhas descreveria um desenho que não está na tela. */}
                  {calor ? (
                    <div style={{ marginTop: 4 }}>
                      <div style={{
                        width: 110, height: 8, borderRadius: 4,
                        background: "linear-gradient(90deg, #2b6cb0 0%, #38a169 40%, #ecc94b 70%, #e53e3e 100%)",
                      }} />
                      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5 }}>
                        {modo === 'regionalizacao' ? "densidade ∝ casos" : "densidade ∝ R$ vencido"}
                      </p>
                      <p style={{ ...MONO, fontSize: 10, color: "var(--text-faint)", marginTop: 3 }}>
                        {modo === 'regionalizacao'
                          ? `${num(casosNaRede)} casos em ${num(bairrosRede.length)} bairros`
                          : `${num(pontos.length)} devedores no mapa`}
                      </p>
                    </div>
                  ) : modo === 'regionalizacao' && redePorPonto ? (
                    <LinhaLegenda
                      cor="var(--past)"
                      rotulo="ex-cliente com dívida · local aproximado"
                      n={pontosRede.length}
                    />
                  ) : modo === 'regionalizacao' ? (
                    FAIXAS_OCORRENCIA.map(f => (
                      <LinhaLegenda
                        key={f.label}
                        cor={`var(${f.token})`}
                        rotulo={f.label}
                        n={bairrosRede.filter(b => f.teste(b.ocorrencias)).length}
                      />
                    ))
                  ) : (
                    <>
                      {ESTADOS_NO_MAPA.map(e => (
                        <LinhaLegenda
                          key={e}
                          cor={ESTADO_META[e].cor}
                          rotulo={ESTADO_META[e].label}
                          n={porEstadoNoMapa[e]}
                        />
                      ))}
                      {aproximados > 0 && (
                        <div
                          title="Ponto que só afirma o bairro: um endereço real do bairro, não a casa. Translúcido no mapa e dito no popup."
                          style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5, fontSize: 11, color: "var(--text-muted)" }}
                        >
                          <span style={{
                            width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
                            background: "var(--text-muted)", opacity: 0.45,
                            border: "1.5px solid #fff", boxShadow: "0 0 0 .5px var(--border-strong)",
                          }} />
                          <span style={{ flex: 1 }}>aproximados · bairro</span>
                          <span style={{ ...MONO }}>{num(aproximados)}</span>
                        </div>
                      )}
                    </>
                  )}
                  {sedeNoMapa && (
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5, fontSize: 11.5, color: "var(--text-2)" }}>
                      <i className="w-2 h-2 rotate-45 border-2 border-[var(--brand)] bg-[var(--surface)] flex-none" aria-hidden="true" />
                      <span style={{ flex: 1 }}>
                        Sede · {sedeNoMapa.cidade}
                        {sede?.foraDaArea && <span style={{ color: "var(--text-muted)" }}> (fora da área)</span>}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* O painel acompanha o mapa na MESMA altura: na carteira, os seus
            bairros com taxa de inadimplência; na rede, os bairros da cidade
            por número de casos. */}
        <div className="ds-ranking-lado">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : modo === 'regionalizacao' ? (
            <PainelRede
              casos={casosNaRede}
              bairros={bairrosRede.length}
              pontos={pontosRede.length}
              ocultas={redeRegional?.ocultas ?? 0}
              semPonto={redeRegional?.semPonto ?? 0}
              minPorBairro={redeRegional?.minPorBairro ?? 3}
              carregando={redeRegionalCarregando && !redeRegional}
              semArea={redeRegional?.semArea ?? false}
              porPonto={redePorPonto && !calor}
            />
          ) : (
            <RankingBairros
              bairros={bairros}
              selecionado={bairroSel}
              onSelect={setBairroSel}
              ordem={ordem}
              onOrdem={setOrdem}
              cidade={fCidade}
            />
          )}
        </div>
      </div>

      {/* ── Raio-X do bairro ── */}
      {!isLoading && (
        <RaioXBairro
          bairros={bairros}
          selecionado={bairroSel}
          onSelect={setBairroSel}
          cidade={fCidade}
        />
      )}

      {modo === 'regionalizacao' && semCliente.length > 0 && (
        <p className="text-[12px] text-[var(--text-muted)]">
          {num(semCliente.length)} cidades atendidas ainda sem cliente.
        </p>
      )}
    </div>
  );
}
