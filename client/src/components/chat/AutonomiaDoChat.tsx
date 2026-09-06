/**
 * A autonomia do chat, na aba Chat do painel: liga/desliga o assistente que
 * responde SOZINHO ao cliente, escolhe em quais conversas ele entra, quantas
 * rodadas pode dar e o que pode fazer sem um humano (segunda via, promessa
 * pelo valor integral, agendamento local). Mostra a fila por status, contada
 * no banco — quando a rota não responde, a tela mostra o traço, nunca zero.
 *
 * A execução fica no motor controlado do Consulta ISP: o LLM só escolhe a
 * intenção; texto, valor e data são do servidor. O que a IA NUNCA faz vem da
 * própria rota (`limites.nunca`) e é repetido aqui em português.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { BOTAO_MARCA, CONTROLE_CAMPO, LinhasSkeleton } from "@/components/painel/ui";
import { mensagemDoErro, SeloCobranca } from "@/components/cobranca/ui";
import { Kicker } from "@/components/localizacao/ui";
import { CATALOGO_DE_AGENTES, TIPOS_DE_AGENTE, type TipoDeAgente } from "@shared/chat-agentes";
import { lerConfigAutonomia, lerFilaDaAutonomia, O_QUE_A_IA_NUNCA_FAZ, ROTULOS_DA_FILA, STATUS_DA_FILA, type ConfigAutonomia } from "@shared/chat-autonomia";

export const API_AUTONOMIA = "/api/chat-bullq/autonomia";
export const API_AUTONOMIA_ESTADO = `${API_AUTONOMIA}/estado`;

const PERMISSOES: { chave: "permitirSegundaVia" | "permitirPromessa" | "permitirAgendamento"; rotulo: string; detalhe: string }[] = [
  { chave: "permitirSegundaVia", rotulo: "Enviar segunda via", detalhe: "o link e o valor vêm do ERP, nunca do modelo" },
  { chave: "permitirPromessa", rotulo: "Registrar promessa de pagamento integral", detalhe: "só pelo valor em aberto no ERP, em data citada pelo cliente e confirmada com “sim”" },
  { chave: "permitirAgendamento", rotulo: "Agendar devolução de equipamento", detalhe: "agendamento local para a equipe acompanhar; não confirma retirada nem baixa" },
];

/** Lê o que a rota devolveu; sem `limites.nunca` a lista cai no catálogo inteiro — o servidor é a fonte, a tela não afrouxa. */
function nuncaDaRota(estado: unknown): string[] {
  const nunca = (estado as { limites?: { nunca?: unknown } } | null)?.limites?.nunca;
  const chaves = Array.isArray(nunca) && nunca.every(n => typeof n === "string") ? (nunca as string[]) : Object.keys(O_QUE_A_IA_NUNCA_FAZ);
  return chaves.map(c => O_QUE_A_IA_NUNCA_FAZ[c] ?? c);
}

export function AutonomiaDoChat({ podeAdministrar }: { podeAdministrar: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const estado = useQuery<unknown>({ queryKey: [API_AUTONOMIA], staleTime: 30_000, retry: false });
  const fila = useQuery<unknown>({ queryKey: [API_AUTONOMIA_ESTADO], staleTime: 15_000, refetchInterval: 30_000, retry: false });
  const [config, setConfig] = useState<ConfigAutonomia>(() => lerConfigAutonomia(null));
  useEffect(() => { if (estado.data) setConfig(lerConfigAutonomia((estado.data as { config?: unknown }).config)); }, [estado.dataUpdatedAt]);

  const salvar = useMutation({
    mutationFn: async () => (await apiRequest("PUT", API_AUTONOMIA, config)).json(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [API_AUTONOMIA] });
      await qc.invalidateQueries({ queryKey: [API_AUTONOMIA_ESTADO] });
      toast({ title: config.ativa ? "Autonomia ligada" : "Autonomia desligada", description: config.ativa ? "O assistente responde sozinho dentro das permissões marcadas." : "Toda resposta do cliente vai para a equipe." });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar a autonomia", description: mensagemDoErro(e), variant: "destructive" }),
    retry: false,
  });

  const filaLida = fila.data ? lerFilaDaAutonomia(fila.data) : null;
  const configDaRota = estado.data ? lerConfigAutonomia((estado.data as { config?: unknown }).config) : null;
  const bloqueado = !podeAdministrar || estado.isPending || estado.isError || salvar.isPending;
  const alternarTipo = (tipo: TipoDeAgente, ligado: boolean) => setConfig(c => ({ ...c, tipos: ligado ? [...new Set([...c.tipos, tipo])] : c.tipos.filter(t => t !== tipo) }));

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5" aria-label="Autonomia do assistente" data-testid="chat-autonomia">
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="h-4 w-4 text-[var(--brand)]" aria-hidden />
        <h3 className="text-sm font-semibold text-[var(--text)]">Autonomia do assistente</h3>
        {estado.isPending ? null
          : estado.isError ? <SeloCobranca tom="danger" titulo={mensagemDoErro(estado.error)} testId="selo-autonomia">não carregou</SeloCobranca>
          : <SeloCobranca tom={configDaRota?.ativa ? "ok" : "neutro"} testId="selo-autonomia">{configDaRota?.ativa ? "ligada" : "desligada"}</SeloCobranca>}
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--text-2)]">
        Com a autonomia ligada, o assistente continua a conversa depois da primeira resposta do cliente, sem esperar a equipe. A execução é do Consulta ISP: o modelo só escolhe a intenção; texto, valor e data são do servidor, e tudo que sai da política vai ao atendente.
      </p>

      {estado.isPending ? <div className="mt-4"><LinhasSkeleton linhas={3} /></div> : (
        <fieldset disabled={bloqueado} className="mt-4 space-y-4 disabled:opacity-60">
          <label className="flex items-center gap-2 text-sm text-[var(--text)]">
            <input type="checkbox" checked={config.ativa} onChange={e => setConfig(c => ({ ...c, ativa: e.target.checked }))} data-testid="autonomia-ativa" />
            Ativar respostas autônomas
          </label>

          <div>
            <Kicker>tipos de conversa</Kicker>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--text-2)]">
              {TIPOS_DE_AGENTE.map(tipo => (
                <label key={tipo} className="flex items-center gap-2">
                  <input type="checkbox" checked={config.tipos.includes(tipo)} onChange={e => alternarTipo(tipo, e.target.checked)} data-testid={`autonomia-tipo-${tipo}`} />
                  {CATALOGO_DE_AGENTES[tipo].nome}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-4 text-[var(--text-faint)]">O agente da carteira precisa estar pronto e habilitado; sem ele, a conversa vai ao atendente.</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs text-[var(--text-2)]">
              <span className="block">Máximo de rodadas por conversa (1 a 20)</span>
              <input type="number" min={1} max={20} value={config.maxTurnos} onChange={e => setConfig(c => ({ ...c, maxTurnos: Number(e.target.value) }))} className={cn(CONTROLE_CAMPO, "w-full font-mono tabular-nums")} data-testid="autonomia-max-turnos" />
              <span className="block text-[11px] leading-4 text-[var(--text-faint)]">No limite, a conversa passa ao atendente com o histórico.</span>
            </label>
          </div>

          <div>
            <Kicker>o que a ia pode fazer sozinha</Kicker>
            <div className="mt-2 space-y-2">
              {PERMISSOES.map(p => (
                <label key={p.chave} className="flex items-start gap-2 text-xs text-[var(--text-2)]">
                  <input type="checkbox" className="mt-0.5" checked={config[p.chave]} onChange={e => setConfig(c => ({ ...c, [p.chave]: e.target.checked }))} data-testid={`autonomia-${p.chave}`} />
                  <span><span className="text-[var(--text)]">{p.rotulo}</span> <span className="text-[var(--text-faint)]">· {p.detalhe}</span></span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => salvar.mutate()} className={BOTAO_MARCA} data-testid="autonomia-salvar">{salvar.isPending ? "Salvando…" : "Salvar autonomia"}</button>
            {!podeAdministrar && <span className="text-[11px] text-[var(--text-faint)]">só o administrador configura a autonomia</span>}
          </div>
        </fieldset>
      )}
      {estado.isError && <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{mensagemDoErro(estado.error)}</p>}

      <div className="mt-5 border-t border-[var(--border)] pt-4" data-testid="autonomia-fila">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Kicker>fila do assistente</Kicker>
          <span className="font-mono text-[11px] tabular-nums text-[var(--text-faint)]">
            {fila.isError ? "fila indisponível" : filaLida?.lidoEm ? `lida às ${new Date(filaLida.lidoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
        </div>
        <dl className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-6">
          {STATUS_DA_FILA.map(s => (
            <div key={s} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
              <dt className="font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{ROTULOS_DA_FILA[s]}</dt>
              <dd className="mt-1 font-mono text-[18px] font-medium tabular-nums text-[var(--text)]" data-testid={`autonomia-fila-${s}`}>{filaLida ? filaLida.porStatus[s] : "—"}</dd>
            </div>
          ))}
        </dl>
        {fila.isError && <p role="alert" className="mt-2 text-[11px] text-[var(--danger)]">{mensagemDoErro(fila.error)}</p>}
      </div>

      <div className="mt-5 rounded border border-[var(--gated-border)] bg-[var(--gated-bg)] px-4 py-3" data-testid="autonomia-nunca">
        <p className="text-xs font-semibold text-[var(--gated)]">O que a IA nunca faz, ligada ou não</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-5 text-[var(--text-2)]">
          {nuncaDaRota(estado.data).map(item => <li key={item}>{item}</li>)}
        </ul>
        <p className="mt-2 text-[11px] leading-4 text-[var(--text-muted)]">Negativar, dar baixa e desconto fora da política são decisões do atendente. Pedido de humano, contestação, pagamento informado, Procon, advogado, SPC ou Serasa na mensagem do cliente tiram a conversa da IA na hora.</p>
      </div>
    </section>
  );
}
