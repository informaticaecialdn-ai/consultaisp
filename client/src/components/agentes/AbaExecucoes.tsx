/**
 * A aba Execuções e a Visão geral.
 *
 * Uma execução que "concluiu" pode ter chamado uma skill que devolveu erro — e
 * é essa a falha cara: o agente responde ao cliente com o que ele achava que
 * era o dado. Por isso a falha de ferramenta é coluna própria e tem filtro
 * "só com erro", em vez de ficar escondida dentro do status.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, BarChart3, Coins, Timer } from "lucide-react";
import { CartaoMetrica, EstadoVazio, LinhasSkeleton } from "@/components/painel/ui";
import { mensagemDoErro, SeloCobranca } from "@/components/cobranca/ui";
import { cn } from "@/lib/utils";
import {
  PERIODOS, ROTULO_DO_DESFECHO, ROTULO_DO_STATUS,
  type ExecucaoDoAgente, type PeriodoDoConsole, type ResumoDoConsole,
} from "@shared/chat-console";
import { API_EXECUCOES, API_RESUMO, textoDeDolar, textoDeDuracao, textoDeMilhar, textoDeQuando } from "./tipos";

const ROTULO_DO_PERIODO: Record<PeriodoDoConsole, string> = { "24h": "24 horas", "7d": "7 dias", "30d": "30 dias" };
const PILULA = "rounded-[14px] border px-2.5 py-1 font-mono text-[11.5px] tabular-nums motion-safe:transition-colors";

function Periodos({ valor, onChange }: { valor: PeriodoDoConsole; onChange: (p: PeriodoDoConsole) => void }) {
  return (
    <div role="radiogroup" aria-label="Período" className="flex flex-wrap gap-1.5">
      {PERIODOS.map(p => (
        <button key={p} role="radio" aria-checked={valor === p} onClick={() => onChange(p)}
          className={cn(PILULA, valor === p
            ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-ink)]"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]")}
          data-testid={`console-periodo-${p}`}>
          {ROTULO_DO_PERIODO[p]}
        </button>
      ))}
    </div>
  );
}

export function AbaResumo() {
  const [periodo, setPeriodo] = useState<PeriodoDoConsole>("7d");
  // A chave e a URL INTEIRA numa peca so: o queryFn padrao faz `queryKey.join("/")`,
  // entao ["/…/resumo","7d"] viraria `/…/resumo/7d` — rota que nao existe.
  const resumo = useQuery<ResumoDoConsole>({ queryKey: [`${API_RESUMO}?periodo=${periodo}`], staleTime: 30_000, retry: false });
  const d = resumo.data;

  return (
    <section className="space-y-4" data-testid="console-aba-resumo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-[12.5px] leading-5 text-[var(--text-2)]">
          O que os agentes fizeram no período: quantas conversas eles rodaram, quanto custou e onde falharam.
        </p>
        <Periodos valor={periodo} onChange={setPeriodo} />
      </div>

      {resumo.isError ? <p role="alert" className="text-[12.5px] text-[var(--danger)]">{mensagemDoErro(resumo.error)}</p> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <CartaoMetrica rotulo="execuções" Icone={Activity} carregando={resumo.isLoading}
              valor={textoDeMilhar(d?.execucoes.total ?? 0)}
              sub={d ? `${textoDeMilhar(d.execucoes.concluidas)} concluídas · ${textoDeMilhar(d.execucoes.falhas)} falharam` : undefined}
              testId="console-kpi-execucoes" />
            <CartaoMetrica rotulo="taxa de sucesso" Icone={BarChart3} carregando={resumo.isLoading}
              valor={d?.execucoes.taxaSucesso === null || d === undefined ? "—" : `${Math.round(d.execucoes.taxaSucesso * (d.execucoes.taxaSucesso <= 1 ? 100 : 1))}%`}
              sub={d && d.execucoes.total === 0 ? "nenhuma execução no período" : undefined}
              testId="console-kpi-sucesso" />
            <CartaoMetrica rotulo="custo" Icone={Coins} carregando={resumo.isLoading}
              valor={textoDeDolar(d?.custoUsd ?? 0)}
              sub={d ? `${textoDeMilhar(d.tokens)} tokens · ${textoDeDolar(d.custoMedioUsd)} por execução` : undefined}
              testId="console-kpi-custo" />
            <CartaoMetrica rotulo="latência p95" Icone={Timer} carregando={resumo.isLoading}
              valor={textoDeDuracao(d?.latencia.p95 ?? null)}
              sub={d?.latencia.p50 !== null && d ? `mediana ${textoDeDuracao(d.latencia.p50)}` : undefined}
              testId="console-kpi-latencia" />
          </div>

          {resumo.isLoading ? <LinhasSkeleton linhas={3} /> : d && d.execucoes.total === 0 ? (
            <EstadoVazio Icone={Activity} titulo="Nenhuma execução no período"
              descricao="Os agentes só rodam quando estão ligados a um canal e uma conversa chega. Confira a aba Agentes." />
          ) : d && (
            <div className="grid gap-3 lg:grid-cols-2">
              <Bloco titulo="por agente">
                {d.porAgente.length === 0 ? <Vazio /> : d.porAgente.map(a => (
                  <LinhaDeBarra key={a.agenteId} rotulo={a.nome} valor={textoDeMilhar(a.execucoes)}
                    nota={textoDeDolar(a.custoUsd)} proporcao={a.execucoes / Math.max(1, d.execucoes.total)} />
                ))}
              </Bloco>
              <Bloco titulo="desfecho">
                {Object.keys(d.porDesfecho).length === 0 ? <Vazio /> : Object.entries(d.porDesfecho).map(([chave, n]) => (
                  <LinhaDeBarra key={chave} rotulo={ROTULO_DO_DESFECHO[chave] ?? chave} valor={textoDeMilhar(n)}
                    proporcao={n / Math.max(1, d.execucoes.total)} />
                ))}
              </Bloco>
              <Bloco titulo="skills mais chamadas" className="lg:col-span-2">
                {d.ferramentas.length === 0 ? <Vazio /> : d.ferramentas.map(f => (
                  <LinhaDeBarra key={f.nome} rotulo={f.nome} mono valor={textoDeMilhar(f.chamadas)}
                    proporcao={f.chamadas / Math.max(1, d.ferramentas[0]?.chamadas ?? 1)} />
                ))}
              </Bloco>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Bloco({ titulo, children, className }: { titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5", className)}>
      <h3 className="mb-2.5 font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{titulo}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Vazio() {
  return <p className="text-[12px] text-[var(--text-muted)]">Nada no período.</p>;
}

function LinhaDeBarra({ rotulo, valor, nota, proporcao, mono }: {
  rotulo: string; valor: string; nota?: string; proporcao: number; mono?: boolean;
}) {
  const largura = Math.max(2, Math.min(100, Math.round(proporcao * 100)));
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
      <span className={cn("truncate text-[12px] text-[var(--text-2)]", mono && "font-mono text-[11.5px]")} title={rotulo}>{rotulo}</span>
      <span className="font-mono text-[12px] tabular-nums text-[var(--text)]">
        {valor}{nota && <span className="ml-2 text-[10.5px] text-[var(--text-faint)]">{nota}</span>}
      </span>
      <span className="col-span-2 h-1 rounded-full bg-[var(--surface-inset)]" aria-hidden>
        <span className="block h-1 rounded-full bg-[var(--brand)]" style={{ width: `${largura}%` }} />
      </span>
    </div>
  );
}

export function AbaExecucoes() {
  const [soComErro, setSoComErro] = useState(false);
  const [periodo, setPeriodo] = useState<PeriodoDoConsole>("7d");
  const execucoes = useQuery<{ execucoes: ExecucaoDoAgente[] }>({
    queryKey: [`${API_EXECUCOES}?periodo=${periodo}&soComErro=${soComErro ? "1" : "0"}`],
    staleTime: 15_000, retry: false,
  });
  const lista = execucoes.data?.execucoes ?? [];

  return (
    <section className="space-y-4" data-testid="console-aba-execucoes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-[12.5px] leading-5 text-[var(--text-2)]">
          Cada linha é uma vez em que um agente pensou numa conversa. A coluna de falhas mostra skill que
          devolveu erro — a execução conclui do mesmo jeito, e é aí que a resposta sai errada.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Periodos valor={periodo} onChange={setPeriodo} />
          <button
            role="switch" aria-checked={soComErro} onClick={() => setSoComErro(v => !v)}
            className={cn(PILULA, soComErro
              ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]")}
            data-testid="console-so-com-erro">
            só com erro
          </button>
        </div>
      </div>

      {execucoes.isLoading ? <LinhasSkeleton linhas={4} />
        : execucoes.isError ? <p role="alert" className="text-[12.5px] text-[var(--danger)]">{mensagemDoErro(execucoes.error)}</p>
        : lista.length === 0 ? (
          <EstadoVazio Icone={Activity} titulo={soComErro ? "Nenhuma falha no período" : "Nenhuma execução no período"}
            descricao={soComErro
              ? "Nenhuma skill devolveu erro nas execuções deste período."
              : "Os agentes só rodam quando estão ligados a um canal e uma conversa chega."} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-[var(--surface-2)]">
                  {["quando", "agente", "status", "desfecho", "skills", "tokens", "custo", "tempo"].map(h => (
                    <th key={h} className="border-b border-[var(--border)] px-3 py-2 text-left font-mono text-[9.5px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.map(e => (
                  <tr key={e.id} className="border-b border-[var(--border-faint)] last:border-0" data-testid={`console-execucao-${e.id}`}>
                    <td className="px-3 py-2 font-mono text-[11.5px] tabular-nums text-[var(--text-muted)]">{textoDeQuando(e.iniciadaEm)}</td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-[var(--text)]" title={e.agenteNome}>{e.agenteNome}</td>
                    <td className="px-3 py-2">
                      <SeloCobranca tom={e.status === "FAILED" ? "danger" : e.status === "COMPLETED" ? "ok" : "neutro"}>
                        {ROTULO_DO_STATUS[e.status] ?? e.status}
                      </SeloCobranca>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-2)]">{e.desfecho ? ROTULO_DO_DESFECHO[e.desfecho] ?? e.desfecho : "—"}</td>
                    <td className="px-3 py-2">
                      {e.chamadas.length === 0 ? <span className="text-[var(--text-faint)]">—</span> : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="font-mono text-[11.5px] tabular-nums text-[var(--text-2)]">{e.chamadas.length}</span>
                          {e.falhasDeFerramenta > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--danger)]"
                              title={e.chamadas.filter(c => c.falhou).map(c => `${c.ferramenta}: ${c.erro ?? "resposta de erro"}`).join("\n")}>
                              <AlertTriangle className="h-3 w-3" aria-hidden />
                              {e.falhasDeFerramenta} com erro
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums text-[var(--text-2)]">{textoDeMilhar(e.tokens)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-[var(--text-2)]">{textoDeDolar(e.custoUsd)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-[var(--text-muted)]">{textoDeDuracao(e.duracaoMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}
