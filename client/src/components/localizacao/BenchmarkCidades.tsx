import { brl, num, pct } from "./ui";
import { ROTULO_CARTEIRA_MAPA, type CarteiraMapa, type ResumoCidadeMapa } from "./metricas";

export function BenchmarkCidades({ cidades, carteira, onCidade }: { cidades: ResumoCidadeMapa[]; carteira: CarteiraMapa; onCidade: (cidade: string) => void }) {
  return <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="benchmark-cidades">
    <h2 className="font-semibold text-sm">Comparativo por cidade · {ROTULO_CARTEIRA_MAPA[carteira]}</h2>
    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">Sua taxa usa todos os clientes desta carteira na cidade, inclusive sem coordenadas. O benchmark é a taxa ponderada da amostra de outros provedores participantes, na mesma carteira; não representa toda a população da cidade.</p>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs">
      <thead><tr className="border-b border-[var(--border)]">{["Cidade", "Clientes da carteira", "Com dívida vencida", "Sua taxa", "Benchmark da amostra", "Diferença", "Dívida vencida", "Devedores no mapa"].map(c => <th key={c} className="px-2 py-3 font-medium whitespace-nowrap">{c}</th>)}</tr></thead>
      <tbody>{cidades.map(c => {
        const taxa = c.clientes > 0 ? c.inadimplentes / c.clientes * 100 : null;
        const benchmark = c.benchmarkPct ?? c.benchmark?.pct ?? null;
        const delta = taxa === null || benchmark === null ? null : taxa - benchmark;
        return <tr key={c.cidade} className="border-b border-[var(--border-faint)]">
          <td className="px-2"><button className="min-h-[44px] text-left text-[var(--brand)] underline underline-offset-2" onClick={() => onCidade(c.cidade)}>{c.cidade}</button></td>
          <td className="px-2 font-mono tabular-nums">{num(c.clientes)}</td><td className="px-2 font-mono tabular-nums">{num(c.inadimplentes)}</td>
          <td className="px-2 font-mono tabular-nums">{taxa === null ? "—" : pct(taxa)}</td>
          <td className="px-2">{benchmark === null ? <span className="text-[var(--text-muted)]">Sem benchmark disponível</span> : <><span className="font-mono tabular-nums">{pct(benchmark)}</span>{c.benchmark && <small className="block text-[var(--text-muted)]">{num(c.benchmark.provedores)} outros provedores · {num(c.benchmark.clientes)} clientes</small>}</>}</td>
          <td className={`px-2 font-mono tabular-nums ${delta !== null && delta > 0 ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>{delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toLocaleString("pt-BR",{maximumFractionDigits:1})} p.p.`}</td>
          <td className="px-2 whitespace-nowrap font-mono tabular-nums">{brl(c.dividaTotal)}</td>
          <td className="px-2 whitespace-nowrap font-mono tabular-nums">{c.pontosNoMapa === undefined ? "—" : `${num(c.pontosNoMapa)} / ${num(c.inadimplentes)}`}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {cidades.length === 0 && <p className="mt-3 text-xs text-[var(--text-muted)]">Nenhuma cidade com clientes neste recorte.</p>}
    <p className="mt-3 text-xs text-[var(--text-muted)]">Comparação exige UF confirmada, pelo menos 3 outros provedores elegíveis e 30 clientes na amostra. Seu provedor não entra no benchmark. Sem esses dados, a comparação fica indisponível.</p>
  </section>;
}
