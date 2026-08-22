import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import MapaCarteira, { type PontoMapa } from "@/components/maps/MapaCarteira";

type Resposta = {
  origemArea: 'cidades' | 'meso' | 'uf' | 'nenhuma';
  semCoordenada: number;
  cidades: Array<{ cidade: string; clientes: number }>;
  pontos: PontoMapa[];
  bairros: Array<{
    bairro: string; cidade: string; clientes: number;
    inadimplentes: number; exComDivida: number;
    pctInadimplencia: number; dividaTotal: number;
  }>;
};

const ESTADOS = [
  { k: 'em_dia',      label: 'Ativo em dia',          token: '--ok' },
  { k: 'em_cobranca', label: 'Em cobrança',           token: '--gated' },
  { k: 'suspenso',    label: 'Suspenso',              token: '--brand' },
  { k: 'ex_divida',   label: 'Ex-cliente com dívida', token: '--danger' },
] as const;

const FAIXAS: Array<{ k: string; label: string; teste: (v: number) => boolean }> = [
  { k: 'todas',      label: 'Todas',        teste: () => true },
  { k: 'em_dia',     label: 'Em dia',       teste: v => v === 0 },
  { k: 'ate100',     label: 'até R$ 100',   teste: v => v > 0 && v <= 100 },
  { k: 'de100a300',  label: 'R$ 100–300',   teste: v => v > 100 && v <= 300 },
  { k: 'de300a1000', label: 'R$ 300–1.000', teste: v => v > 300 && v <= 1000 },
  { k: 'acima1000',  label: 'R$ 1.000+',    teste: v => v > 1000 },
];

const brl = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[12px] px-2.5 py-1 rounded border motion-safe:transition-colors ${
        ativo
          ? "border-[var(--brand)] text-[var(--brand-ink)] bg-[var(--brand-soft)] font-medium"
          : "border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)]"
      }`}
    >
      {children}
    </button>
  );
}

function Kpi({ label, valor, sub }: { label: string; valor: string; sub?: string }) {
  return (
    <div className="bg-[var(--surface)] rounded-lg px-[14px] py-3 border border-[var(--border)]">
      <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {label}
      </span>
      <p className="mt-1.5 font-mono text-[21px] font-medium tracking-[-0.02em] text-[var(--text)] tabular-nums">
        {valor}
      </p>
      {sub && <p className="text-[12px] text-[var(--text-muted)] mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

export default function LocalizacaoPage() {
  const { data, isLoading } = useQuery<Resposta>({ queryKey: ["/api/localizacao"] });

  const [fCidade, setFCidade] = useState("todas");
  const [fEstado, setFEstado] = useState("todos");
  const [fDivida, setFDivida] = useState("todas");
  const [ordem, setOrdem] = useState<'menor' | 'maior' | 'divida' | 'clientes'>('maior');

  const pontos = data?.pontos ?? [];
  const bairros = data?.bairros ?? [];

  const faixa = FAIXAS.find(f => f.k === fDivida) ?? FAIXAS[0];
  const pontosFiltrados = pontos.filter(p =>
    (fCidade === "todas" || p.cidade === fCidade) &&
    (fEstado === "todos" || p.estado === fEstado) &&
    faixa.teste(p.emAberto)
  );

  const contagem = ESTADOS.map(e => ({ ...e, n: pontosFiltrados.filter(p => p.estado === e.k).length }));
  const totalVencido = bairros.reduce((s, b) => s + b.dividaTotal, 0);
  const totalDevedores = bairros.reduce((s, b) => s + b.inadimplentes, 0);
  const campeao = [...bairros].filter(b => b.clientes > 0)
    .sort((a, b) => b.pctInadimplencia - a.pctInadimplencia)[0];

  const bairrosOrdenados = [...bairros].sort((a, b) => {
    if (ordem === 'menor') return a.pctInadimplencia - b.pctInadimplencia;
    if (ordem === 'maior') return b.pctInadimplencia - a.pctInadimplencia;
    if (ordem === 'divida') return b.dividaTotal - a.dividaTotal;
    return b.clientes - a.clientes;
  });

  return (
    <div className="p-4 lg:p-6 space-y-4" data-testid="localizacao-page">
      <div>
        <h1 className="text-[19px] font-medium tracking-[-0.02em] text-[var(--text)] leading-tight">
          Localização
        </h1>
        <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
          Mapa da carteira, calor de inadimplência e ranking de bairros
        </p>
      </div>

      {data?.origemArea === 'nenhuma' && (
        <div className="rounded-lg bg-[var(--gated-bg)] px-4 py-3 text-[13px] text-[var(--gated)]">
          Você ainda não configurou as cidades atendidas, então o mapa mostra toda a base.{" "}
          <Link href="/configuracoes/regionalizacao">
            <a className="underline font-medium">Configurar Regionalização</a>
          </Link>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[74px]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <Kpi
            label="Bairro campeão"
            valor={campeao ? `${campeao.pctInadimplencia.toFixed(1)}%` : "—"}
            sub={campeao ? `${campeao.bairro} · ${campeao.cidade}` : undefined}
          />
          <Kpi label="R$ vencido no mapa" valor={brl(totalVencido)} sub={`${totalDevedores} devedores`} />
          <Kpi label="Clientes plotados" valor={String(pontosFiltrados.length)} sub={`de ${pontos.length} com coordenada`} />
          <Kpi label="Sem coordenada" valor={String(data?.semCoordenada ?? 0)} sub="fora do mapa" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 items-start">
        {/* Mapa */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--border-faint)]">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Mapa real da carteira · OpenStreetMap
            </span>
            <span className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
              {pontosFiltrados.length} de {pontos.length} pontos
            </span>
          </div>

          <div className="px-4 py-3 space-y-2 border-b border-[var(--border-faint)]">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)] w-[52px]">Cidade</span>
              <Chip ativo={fCidade === "todas"} onClick={() => setFCidade("todas")}>Todas</Chip>
              {(data?.cidades ?? []).map(c => (
                <Chip key={c.cidade} ativo={fCidade === c.cidade} onClick={() => setFCidade(c.cidade)}>
                  {c.cidade} <span className="font-mono tabular-nums opacity-70">{c.clientes}</span>
                </Chip>
              ))}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)] w-[52px]">Estado</span>
              <Chip ativo={fEstado === "todos"} onClick={() => setFEstado("todos")}>Todos</Chip>
              {ESTADOS.map(e => (
                <Chip key={e.k} ativo={fEstado === e.k} onClick={() => setFEstado(e.k)}>{e.label}</Chip>
              ))}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)] w-[52px]">Dívida</span>
              {FAIXAS.map(f => (
                <Chip key={f.k} ativo={fDivida === f.k} onClick={() => setFDivida(f.k)}>{f.label}</Chip>
              ))}
            </div>
          </div>

          <div className="p-3">
            {isLoading ? <Skeleton className="h-[520px] w-full" /> : <MapaCarteira pontos={pontosFiltrados} />}
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2 px-4 py-3 border-t border-[var(--border-faint)]">
            {contagem.map(e => (
              <span key={e.k} className="flex items-center gap-2 text-[12px] text-[var(--text-2)]">
                <i className="w-2 h-2 rounded-full" style={{ background: `var(${e.token})` }} />
                {e.label}
                <b className="font-mono tabular-nums text-[var(--text)]">{e.n}</b>
              </span>
            ))}
          </div>
        </div>

        {/* Ranking de bairros */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-[var(--border-faint)]">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Bairros por inadimplência
            </span>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              Universo = carteira na área atendida, incluindo quem está sem coordenada.
            </p>
          </div>
          <div className="flex gap-1.5 px-4 py-2 border-b border-[var(--border-faint)] flex-wrap">
            <Chip ativo={ordem === 'menor'} onClick={() => setOrdem('menor')}>Menor %</Chip>
            <Chip ativo={ordem === 'maior'} onClick={() => setOrdem('maior')}>Maior %</Chip>
            <Chip ativo={ordem === 'divida'} onClick={() => setOrdem('divida')}>Dívida</Chip>
            <Chip ativo={ordem === 'clientes'} onClick={() => setOrdem('clientes')}>Clientes</Chip>
          </div>
          <ul className="overflow-y-auto max-h-[620px]">
            {bairrosOrdenados.map((b, i) => (
              <li key={`${b.cidade}-${b.bairro}`} className="px-4 py-3 border-b border-[var(--border-faint)] last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[11px] text-[var(--text-faint)] tabular-nums">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium text-[var(--text)] truncate">{b.bairro}</span>
                      <span className="block text-[11px] text-[var(--text-muted)] truncate">{b.cidade}</span>
                    </span>
                  </span>
                  <span className={`font-mono text-[11px] tabular-nums px-2 py-0.5 rounded flex-none ${
                    b.pctInadimplencia >= 18 ? "bg-[var(--danger-bg)] text-[var(--danger)]"
                    : b.pctInadimplencia >= 8 ? "bg-[var(--gated-bg)] text-[var(--gated)]"
                    : "bg-[var(--ok-bg)] text-[var(--ok)]"
                  }`}>
                    {b.pctInadimplencia.toFixed(1)}%
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                  {brl(b.dividaTotal)} · {b.clientes} clientes · {b.inadimplentes} inad. · {b.exComDivida} ex
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
