import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity, ArrowRight, Bot, CheckCircle2, CirclePause, RefreshCw, Users, Wifi } from "lucide-react";
import type { OperacaoChat } from "@shared/chat-operacao";
import type { DiagnosticoDoChat } from "@shared/chat-diagnostico";

const nomeCarteira = (c: string) => c === "ativo" ? "Clientes ativos" : "Ex-clientes";
export function OperacaoDaCobranca({ podeAdministrar }: { podeAdministrar: boolean }) {
  const operacao = useQuery<OperacaoChat>({ queryKey: ["/api/chat-bullq/operacao"], staleTime: 15_000, refetchInterval: 30_000, retry: false });
  const transporte = useQuery<DiagnosticoDoChat>({ queryKey: ["/api/chat-bullq/integracao/diagnostico"], staleTime: 30_000, retry: false });
  const modelos = useQuery<{ configured: boolean }>({ queryKey: ["/api/chat-bullq/integracao/agentes/modelos"], enabled: podeAdministrar && transporte.data?.servicoDisponivel === true, staleTime: 60_000, retry: false });
  const d = operacao.data;
  const atualizar = () => { void Promise.all([operacao.refetch(), transporte.refetch(), ...(podeAdministrar && transporte.data?.servicoDisponivel === true ? [modelos.refetch()] : [])]); };
  const status = [
    { Icon: Activity, titulo: "Motor de atendimento", ok: d?.processo.online && d.processo.modo === "envio", texto: !d ? "Verificando…" : !d.processo.online ? "Sem atividade detectada" : d.processo.modo === "ensaio" ? "Em ensaio · sem envios" : "Processo ativo" },
    { Icon: Wifi, titulo: "WhatsApp", ok: transporte.data?.codigo === "PRONTO", texto: transporte.data?.codigo === "PRONTO" ? "Conexão confirmada" : transporte.data?.mensagem ?? (transporte.isError ? "Verificação indisponível" : "Verificando…") },
    { Icon: Bot, titulo: "Inteligência artificial", ok: modelos.data?.configured === true, texto: !podeAdministrar ? "Verificação disponível ao administrador" : modelos.data ? modelos.data.configured ? "Credencial configurada" : "Credencial não configurada" : modelos.isError ? "Verificação indisponível" : transporte.data?.servicoDisponivel !== true ? "Conecte o serviço de chat para verificar" : "Verificando…" },
  ];
  return <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]" aria-labelledby="operacao-cobranca-titulo">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
      <div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--brand)]">Operação da cobrança</p><h3 id="operacao-cobranca-titulo" className="mt-1 text-lg font-semibold">Pronta para iniciar?</h3><p className="mt-1 text-xs text-[var(--text-muted)]">Veja os requisitos e confira a fila antes de ativar os contatos.</p></div>
      <button onClick={atualizar} disabled={operacao.isFetching} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs disabled:opacity-50"><RefreshCw size={14} />Atualizar diagnóstico</button>
    </div>
    <div className="grid gap-px bg-[var(--border)] md:grid-cols-3">{status.map(({ Icon, titulo, texto, ok }) => <div key={titulo} className="flex gap-3 bg-[var(--surface)] p-5"><span className={`h-fit rounded-lg p-2 ${ok ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}><Icon size={18} /></span><div><h4 className="text-xs font-semibold">{titulo}</h4><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{texto}</p></div></div>)}</div>
    {operacao.isError && <p role="alert" className="m-5 rounded-lg bg-amber-500/10 p-3 text-sm">Não foi possível ler a fila. Atualize o diagnóstico para tentar novamente.</p>}
    {d && <div className="space-y-5 p-5">
      <div className="grid gap-3 md:grid-cols-2">{d.carteiras.map(c => <Link key={c.carteira} href={`/cobranca/regua?carteira=${c.carteira}`} className="group rounded-lg border border-[var(--border)] p-4 transition-colors hover:bg-[var(--surface-inset)]">
        <div className="flex items-center gap-2 text-sm font-semibold"><Users size={16} className={c.carteira === "ativo" ? "text-blue-600" : "text-violet-600"} />{nomeCarteira(c.carteira)}<ArrowRight size={14} className="ml-auto text-[var(--text-muted)]" /></div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2"><p><strong className="text-2xl tabular-nums">{c.elegiveis.toLocaleString("pt-BR")}</strong><span className="ml-2 text-xs text-[var(--text-muted)]">elegíveis pela régua</span></p><p className="text-xs text-[var(--text-muted)]">{c.revisao.toLocaleString("pt-BR")} aguardando ou em revisão</p></div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">{c.carteira === "ativo" ? "Regularização do contrato vigente." : "Recuperação de valores do contrato encerrado."}</p>
      </Link>)}</div>
      <p className="text-xs leading-5 text-[var(--text-muted)]">Prévia de casos abertos, com dívida e sem contato anterior ou conversa em andamento. Elegibilidade não confirma envio: canal, agentes e limites são conferidos novamente ao executar. {d.limitado && "Recorte limitado aos primeiros 10 mil casos pendentes."}</p>
      {d.bloqueios.length > 0 && <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4"><h4 className="flex items-center gap-2 text-sm font-semibold"><CirclePause size={16} className="text-amber-600" />O que impede o primeiro contato agora</h4><ul className="mt-2 grid gap-2 text-xs leading-5 md:grid-cols-2">{d.bloqueios.map(b => <li key={b}>• {b}</li>)}</ul></div>}
      {d.etapas.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="mb-2 text-left text-sm font-semibold">Próximas abordagens por carteira</caption><thead className="text-[var(--text-muted)]"><tr><th className="py-2 font-medium">Carteira</th><th className="font-medium">Etapa</th><th className="font-medium">Abordagem</th><th className="text-right font-medium">Casos</th></tr></thead><tbody>{d.etapas.map(e => <tr key={e.carteira+e.etapa} className="border-t border-[var(--border)]"><td className="py-3 pr-3">{nomeCarteira(e.carteira)}</td><td className="pr-3">{e.etapa}</td><td className="pr-3">{e.agente}</td><td className="text-right tabular-nums">{e.quantidade}</td></tr>)}</tbody></table></div>}
      {d.motivos.length > 0 && <details className="rounded-lg border border-[var(--border)] p-3"><summary className="cursor-pointer text-xs font-medium">Por que alguns casos não entram na fila?</summary><ul className="mt-3 space-y-2 text-xs text-[var(--text-muted)]">{d.motivos.map(m => <li key={m.motivo} className="flex justify-between gap-4"><span>{m.motivo}</span><b>{m.quantidade}</b></li>)}</ul></details>}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-muted)]"><span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} />{d.usadosHoje} / {d.limiteDiario} contatos usados ou reservados hoje</span><span>Respostas autônomas: {d.respostaAutonoma ? "habilitadas conforme permissões" : "desligadas · atendimento humano"}</span><Link href="/painel-provedor?tab=chat" className="ml-auto text-[var(--brand)] underline underline-offset-2">Configurar WhatsApp</Link></div>
    </div>}
  </section>;
}
