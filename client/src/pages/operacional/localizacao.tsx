import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { MapPin, Banknote, Users, Satellite, Map as MapIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import MapaCarteira, {
  FAIXAS_PONTO_REDE,
  type PontoMapa, type PontoRede, type BairroRede, type PontoRedeItem, type CidadeMapa,
  type ModoMapa, type SedeMapa,
} from "@/components/maps/MapaCarteira";
import { Chip, Kicker, Kpi, MONO, CARD, brl, num, pct, TRACO } from "@/components/localizacao/ui";
import RankingBairros, {
  MIN_CLIENTES_RANKING, type BairroRanking, type OrdemRanking,
} from "@/components/localizacao/RankingBairros";
import RaioXBairro from "@/components/localizacao/RaioXBairro";
import RankingRede from "@/components/localizacao/RankingRede";

type Sede = { cidade: string; uf: string | null; lat: number | null; lon: number | null; foraDaArea: boolean };
type EstadoCliente = PontoMapa["estado"];

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
  foraDaArea: number;
  cidadesForaDaArea: Array<{ cidade: string; clientes: number; inadimplentes: number }>;
  pontos: PontoMapa[];
  bairros: BairroRanking[];
  porEstado: Record<EstadoCliente, number>;
  sincronizadoEm: string | null;
};

/** Só o estado do trabalho; as contagens vêm de /api/localizacao. */
type Plotagem = {
  emAndamento: boolean;
  geocoderIndisponivel: boolean;
  terminadoEm: string | null;
};

/** Piso de k-anonimato para a camada de rede. */
const PISO_REDE = 5;

const ESTADOS: Array<{ k: EstadoCliente; label: string; token: string }> = [
  { k: 'em_dia',      label: 'Ativo em dia',          token: '--ok' },
  { k: 'em_cobranca', label: 'Em cobrança',           token: '--gated' },
  { k: 'suspenso',    label: 'Suspenso',              token: '--brand' },
  { k: 'ex_divida',   label: 'Ex-cliente com dívida', token: '--danger' },
];

const FAIXAS: Array<{ k: string; label: string; teste: (v: number) => boolean }> = [
  { k: 'todas',      label: 'Todas',        teste: () => true },
  { k: 'em_dia',     label: 'Em dia',       teste: v => v === 0 },
  { k: 'ate100',     label: 'até R$ 100',   teste: v => v > 0 && v <= 100 },
  { k: 'de100a300',  label: 'R$ 100–300',   teste: v => v > 100 && v <= 300 },
  { k: 'de300a1000', label: 'R$ 300–1.000', teste: v => v > 300 && v <= 1000 },
  { k: 'acima1000',  label: 'R$ 1.000+',    teste: v => v > 1000 },
];

/** Escala de concentração da rede no bairro — espelha FAIXAS_OCORRENCIA do mapa. */
const FAIXAS_REDE: Array<{ label: string; token: string; teste: (n: number) => boolean }> = [
  { label: '3 a 9 casos',   token: '--gated',  teste: n => n < 10 },
  { label: '10 a 24 casos', token: '--past',   teste: n => n >= 10 && n < 25 },
  { label: '25+ casos',     token: '--danger', teste: n => n >= 25 },
];

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

  const [fCidade, setFCidade] = useState<string | null>(null);
  const [fEstado, setFEstado] = useState<EstadoCliente | "todos">("todos");
  const [fDivida, setFDivida] = useState("todas");
  const [ordem, setOrdem] = useState<OrdemRanking>("maior");
  const [bairroSel, setBairroSel] = useState<string | null>(null);
  const [calor, setCalor] = useState(false);
  const [modo, setModo] = useState<ModoMapa>('carteira');
  const [verRede, setVerRede] = useState(false);
  // Duas leituras da mesma rede: a bolha diz quanto o bairro pesa, o ponto diz
  // como os casos se espalham dentro dele.
  const [redePorPonto, setRedePorPonto] = useState(false);

  const { data: rede = [], isFetching: redeCarregando } = useQuery<PontoRede[]>({
    queryKey: ["/api/heatmap/regional"],
    enabled: verRede,
  });

  // A rede: ex-clientes com dívida de TODOS os provedores nas cidades que este
  // provedor atende. É o desenho do modo regionalização, e só é buscado quando
  // esse modo está ligado.
  const { data: redeRegional, isFetching: redeRegionalCarregando } = useQuery<{
    bairros: BairroRede[]; pontos: PontoRedeItem[]; ocultas: number; semArea: boolean; minPorBairro: number;
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

  // O endpoint agrega todos os provedores em celulas de 0,01 grau (~1km) sem piso
  // de contagem: uma celula com 1 cliente e praticamente um endereco identificavel
  // de outro provedor. Filtramos aqui para nao expor isso na tela.
  const redeVisivel = useMemo(() => rede.filter(r => r.count >= PISO_REDE), [rede]);

  const naFila = data?.plotaveis ?? 0;
  const foraDaFila = (data?.semCoordenada ?? 0) - naFila;

  const todosPontos = data?.pontos ?? [];
  const todosBairros = data?.bairros ?? [];
  const cidades = data?.cidades ?? [];
  const semCliente = data?.cidadesSemCliente ?? [];
  const cidadesPlotaveis = cidades.filter(c => c.lat !== null && c.lon !== null);
  const cidadesAtendidas = cidades.length + semCliente.length;
  const totalCarteira = cidades.reduce((s, c) => s + c.clientes, 0);

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
  const devedoresPlotados = useMemo(() => pontos.filter(p => p.emAberto > 0).length, [pontos]);

  /* A legenda conta a carteira INTEIRA do recorte, inclusive quem está fora do
     mapa: a pergunta "quantos ex-clientes com dívida eu tenho" não muda porque
     o cadastro de alguns não tem coordenada. */
  const porEstado = useMemo(() => {
    if (!fCidade) return data?.porEstado ?? { em_dia: 0, em_cobranca: 0, suspenso: 0, ex_divida: 0 };
    const acc: Record<EstadoCliente, number> = { em_dia: 0, em_cobranca: 0, suspenso: 0, ex_divida: 0 };
    for (const p of pontos) acc[p.estado]++;
    return acc;
  }, [data?.porEstado, fCidade, pontos]);

  const trocarCidade = (c: string | null) => { setFCidade(c); setBairroSel(null); };
  const sincronizado = dataCurta(data?.sincronizadoEm ?? null);

  return (
    <div className="p-4 lg:p-6 space-y-4" data-testid="localizacao-page">
      {/* ── Cabeçalho ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-medium tracking-[-0.02em] text-[var(--text)] leading-tight">
            Localização &amp; mapa de inadimplência
          </h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-1">
            Geomarketing territorial da carteira — pontos reais geocodificados, calor de dívida e
            ranking de bairros.
          </p>
        </div>

        {cidades.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Kicker style={{ marginRight: 2 }}>Cidade</Kicker>
            <Chip ativo={fCidade === null} onClick={() => trocarCidade(null)} contagem={totalCarteira}>
              Todas
            </Chip>
            {cidades.map(c => (
              <Chip
                key={c.cidade}
                ativo={fCidade === c.cidade}
                onClick={() => trocarCidade(c.cidade)}
                contagem={c.clientes}
              >
                {c.cidade}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {data?.origemArea === 'nenhuma' && (
        <div className="rounded-lg bg-[var(--gated-bg)] px-4 py-3 text-[13px] text-[var(--gated)]">
          Você ainda não configurou as cidades atendidas, então o mapa mostra toda a base.{" "}
          <Link href="/configuracoes/regionalizacao" className="underline font-medium">
            Configurar Regionalização
          </Link>
        </div>
      )}

      {/* O RECORTE TEM DE SE DECLARAR.
          Sem este aviso o mapa dizia "1.272 de 1.272 pontos" — afirmando estar
          completo — enquanto 1.667 clientes de uma cidade não declarada ficavam
          de fora. O provedor leu aquilo como "não tenho cliente lá". Filtro
          silencioso vira conclusão de negócio errada. */}
      {(data?.foraDaArea ?? 0) > 0 && (
        <div className="rounded-lg border border-[var(--gated-border)] bg-[var(--gated-bg)] px-4 py-3.5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-[13px] text-[var(--gated)] leading-relaxed">
                <strong className="font-semibold">
                  {num(data!.foraDaArea)} cliente{data!.foraDaArea === 1 ? "" : "s"} fora do mapa
                </strong>
                {" "}— estão em cidades que não constam da sua Regionalização, então
                não entram em nenhum número desta tela.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {(data?.cidadesForaDaArea ?? []).slice(0, 6).map(c => (
                  <span
                    key={c.cidade}
                    className="inline-flex items-center gap-1.5 rounded border border-[var(--gated-border)] bg-[var(--surface)] px-2 py-1 font-mono text-[10.5px] tabular-nums text-[var(--text-2)]"
                    title={`${c.inadimplentes} inadimplente(s)`}
                  >
                    {c.cidade}
                    <strong className="font-semibold text-[var(--text)]">{num(c.clientes)}</strong>
                  </span>
                ))}
                {(data?.cidadesForaDaArea?.length ?? 0) > 6 && (
                  <span className="inline-flex items-center px-2 py-1 font-mono text-[10.5px] text-[var(--text-muted)]">
                    +{(data!.cidadesForaDaArea.length - 6)} cidade(s)
                  </span>
                )}
              </div>
            </div>
            <Link
              href="/configuracoes/regionalizacao"
              className="shrink-0 inline-flex items-center rounded-md border border-[var(--gated-border)] bg-[var(--surface)] px-3 py-2 text-[12.5px] font-semibold text-[var(--gated)]"
              data-testid="link-ajustar-regionalizacao"
            >
              Ajustar Regionalização
            </Link>
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
            sub={`${num(devedoresPlotados)} devedores plotados`} subMono
          />
          <Kpi
            icone={<Users size={16} strokeWidth={1.5} />}
            iconeCor="var(--info)" iconeBg="var(--info-bg)"
            rotulo="Clientes plotados"
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

      {/* ── Mapa + ranking ── */}
      <div className="ds-mapa-grid">
        <div style={{ ...CARD, overflow: "hidden" }}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--border-faint)]">
            <span className="flex items-center gap-2">
              <MapIcon size={14} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} />
              <Kicker>
                {modo === 'carteira' ? 'Mapa real da carteira' : 'Sua região'} · OpenStreetMap
              </Kicker>
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip ativo={modo === 'carteira'} onClick={() => setModo('carteira')}>Carteira</Chip>
              <Chip ativo={modo === 'regionalizacao'} onClick={() => setModo('regionalizacao')}>Regionalização</Chip>
              {modo === 'regionalizacao' && !calor && (
                <Chip
                  ativo={redePorPonto}
                  onClick={() => setRedePorPonto(v => !v)}
                  titulo="A bolha diz quanto o bairro pesa; o ponto diz como os casos se espalham dentro dele."
                >
                  {redePorPonto ? "Por ponto" : "Por bairro"}
                </Chip>
              )}
              <Chip
                ativo={calor}
                onClick={() => setCalor(v => !v)}
                titulo={modo === 'regionalizacao'
                  ? "Mancha ponderada pelo número de casos de cada bairro"
                  : "Mancha ponderada pelo valor em aberto de cada cliente"}
              >
                Mapa de calor
              </Chip>
              {/* As duas camadas de território dependem de bases públicas que
                  ainda não foram carregadas. Ficam à vista e desabilitadas: o
                  operador precisa saber que a camada existe e o que falta para
                  ela aparecer — some da tela seria pior. */}
              <Chip ativo={false} desabilitado titulo="Requer a base de endereços do IBGE (CNEFE 2022) carregada para os municípios atendidos.">
                Endereços IBGE
              </Chip>
              <Chip ativo={false} desabilitado titulo="Requer a base de unidades consumidoras da ANEEL (BDGD) carregada para a área atendida.">
                UCs ANEEL
              </Chip>
              {sincronizado && (
                <span title="A tela mostra a carteira como estava na última sincronização com o ERP." style={{
                  ...MONO, fontSize: 10, padding: "3px 7px", borderRadius: 4,
                  background: "var(--surface-inset)", color: "var(--text-muted)",
                }}>
                  ERP · {sincronizado}
                </span>
              )}
            </div>
          </div>

          <div className="px-4 py-3 space-y-2 border-b border-[var(--border-faint)]">
            {/* O modo rede mostra gente que não é sua. Dizer exatamente o que
                está no mapa e o que foi omitido não é rodapé jurídico: é o que
                permite ao provedor usar a informação sem achar que pode bater
                na porta de alguém. */}
            {modo === 'regionalizacao' && (
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
                      </>
                    ) : (
                      <>
                        Somados <strong>por bairro</strong>: cada bolha é o conjunto do bairro, nenhum
                        cliente aparece sozinho, e um bairro só entra com{" "}
                        {num(redeRegional?.minPorBairro ?? 3)} ou mais casos.
                      </>
                    )}
                  </>
                )}
              </p>
            )}
            {modo === 'carteira' && (
              <>
                <LinhaFiltro rotulo="Estado">
                  <Chip ativo={fEstado === "todos"} onClick={() => setFEstado("todos")}>Todos</Chip>
                  {ESTADOS.map(e => (
                    <Chip key={e.k} ativo={fEstado === e.k} onClick={() => setFEstado(e.k)}>{e.label}</Chip>
                  ))}
                </LinhaFiltro>
                <LinhaFiltro rotulo="Dívida">
                  {FAIXAS.map(f => (
                    <Chip key={f.k} ativo={fDivida === f.k} onClick={() => setFDivida(f.k)}>{f.label}</Chip>
                  ))}
                </LinhaFiltro>
              </>
            )}
            <LinhaFiltro rotulo="Rede">
              <Chip ativo={verRede} onClick={() => setVerRede(v => !v)}>
                Concentração da rede
                {verRede && (
                  <span style={{ ...MONO, opacity: 0.7 }}>
                    {redeCarregando ? "…" : num(redeVisivel.length)}
                  </span>
                )}
              </Chip>
              <span className="text-[11px] text-[var(--text-faint)]">
                {!verRede
                  ? `agregado de todos os provedores, mínimo de ${PISO_REDE} clientes por célula`
                  : redeCarregando
                    ? "carregando…"
                    : redeVisivel.length > 0
                      ? `${num(redeVisivel.length)} concentrações na região`
                      : `nenhuma concentração com ${PISO_REDE}+ clientes na região`}
              </span>
            </LinhaFiltro>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {bairroSel ? (
                <Chip ativo onClick={() => setBairroSel(null)} titulo="Clique para voltar à carteira inteira">
                  Bairro: {bairroSel} ✕
                </Chip>
              ) : <span />}
              <span style={{ ...MONO, fontSize: 11, color: "var(--text-muted)" }}>
                {modo === 'regionalizacao'
                  ? redeRegionalCarregando ? "carregando…"
                    : redePorPonto && !calor
                      ? `${num(pontosRede.length)} ocorrências no mapa`
                      : `${num(casosNaRede)} casos em ${num(bairrosRede.length)} bairros`
                  : `${num(filtrados.length)} de ${num(pontos.length)} pontos`}
              </span>
            </div>
          </div>

          <div className="p-3 relative">
            {isLoading ? <Skeleton className="h-[480px] w-full" /> : (
              <>
                <MapaCarteira
                  pontos={filtrados}
                  bairrosRede={bairrosRede}
                  pontosRede={pontosRede}
                  redePorPonto={redePorPonto}
                  cidades={cidades}
                  sede={sedeNoMapa}
                  modo={modo}
                  rede={verRede ? redeVisivel : undefined}
                  calor={calor}
                  bairroFoco={bairroSel}
                />
                {/* Legenda sobre o mapa: quem olha o mapa não deveria ter de
                    procurar a chave das cores fora dele. */}
                <div
                  className="absolute left-6 bottom-6 pointer-events-none"
                  style={{
                    ...CARD, background: "var(--surface)", padding: "9px 11px",
                    boxShadow: "0 0 0 1px var(--ring-subtle)", zIndex: 500,
                  }}
                >
                  <Kicker>
                    {calor ? (modo === 'regionalizacao' ? 'Calor da rede' : 'Calor de dívida')
                      : modo === 'regionalizacao'
                        ? (redePorPonto ? 'Dívida na rede' : 'Casos na rede')
                        : 'Estado do cliente'}
                  </Kicker>
                  <div className="mt-2 space-y-1">
                    {/* Com o calor ligado não existe marcador — manter a chave
                        das bolhas descreveria um desenho que não está na tela. */}
                    {calor ? (
                      <div style={{ width: 148 }}>
                        <div style={{
                          height: 7, borderRadius: 4,
                          background: "linear-gradient(90deg, #2b6cb0 0%, #38a169 40%, #ecc94b 70%, #e53e3e 100%)",
                        }} />
                        <p style={{ ...MONO, fontSize: 10, color: "var(--text-muted)", marginTop: 5 }}>
                          {modo === 'regionalizacao' ? "densidade ∝ casos" : "densidade ∝ R$ vencido"}
                        </p>
                        <p style={{ ...MONO, fontSize: 10, color: "var(--text-faint)", marginTop: 3 }}>
                          {modo === 'regionalizacao'
                            ? `${num(casosNaRede)} casos em ${num(bairrosRede.length)} bairros`
                            : `${num(devedoresPlotados)} devedores no mapa`}
                        </p>
                      </div>
                    ) : modo === 'regionalizacao' && redePorPonto
                      ? (Object.entries(FAIXAS_PONTO_REDE) as Array<[PontoRedeItem["faixa"], { label: string; token: string }]>).map(([k, f]) => (
                          <span key={k} className="flex items-center gap-2 text-[11.5px] text-[var(--text-2)]">
                            <i className="w-2 h-2 rounded-full flex-none" style={{ background: `var(${f.token})` }} />
                            <span className="flex-1 pr-3">{f.label}</span>
                            <b style={{ ...MONO, fontWeight: 500, color: "var(--text)" }}>
                              {num(pontosRede.filter(p => p.faixa === k).length)}
                            </b>
                          </span>
                        ))
                      : modo === 'regionalizacao'
                      ? FAIXAS_REDE.map(f => (
                          <span key={f.label} className="flex items-center gap-2 text-[11.5px] text-[var(--text-2)]">
                            <i className="w-2 h-2 rounded-full flex-none" style={{ background: `var(${f.token})` }} />
                            <span className="flex-1 pr-3">{f.label}</span>
                            <b style={{ ...MONO, fontWeight: 500, color: "var(--text)" }}>
                              {num(bairrosRede.filter(b => f.teste(b.ocorrencias)).length)}
                            </b>
                          </span>
                        ))
                      : ESTADOS.map(e => (
                          <span key={e.k} className="flex items-center gap-2 text-[11.5px] text-[var(--text-2)]">
                            <i className="w-2 h-2 rounded-full flex-none" style={{ background: `var(${e.token})` }} />
                            <span className="flex-1 pr-3">{e.label}</span>
                            <b style={{ ...MONO, fontWeight: 500, color: "var(--text)" }}>{num(porEstado[e.k])}</b>
                          </span>
                        ))}
                    {sedeNoMapa && (
                      <span className="flex items-center gap-2 text-[11.5px] text-[var(--text-2)]">
                        <i className="w-2 h-2 rotate-45 border-2 border-[var(--brand)] bg-[var(--surface)] flex-none" aria-hidden="true" />
                        <span className="flex-1">
                          Sede · {sedeNoMapa.cidade}
                          {sede?.foraDaArea && <span className="text-[var(--text-muted)]"> (fora da área)</span>}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* O painel acompanha o mapa: na carteira, os seus bairros com taxa de
            inadimplência; na rede, os bairros da cidade por número de casos. */}
        {isLoading ? (
          <Skeleton className="h-[560px] w-full" />
        ) : modo === 'regionalizacao' ? (
          <RankingRede
            bairros={bairrosRede}
            selecionado={bairroSel}
            onSelect={setBairroSel}
            ocultas={redeRegional?.ocultas ?? 0}
            minPorBairro={redeRegional?.minPorBairro ?? 3}
            carregando={redeRegionalCarregando && !redeRegional}
            semArea={redeRegional?.semArea ?? false}
          />
        ) : (
          <RankingBairros
            bairros={bairros}
            selecionado={bairroSel}
            onSelect={setBairroSel}
            ordem={ordem}
            onOrdem={setOrdem}
          />
        )}
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
