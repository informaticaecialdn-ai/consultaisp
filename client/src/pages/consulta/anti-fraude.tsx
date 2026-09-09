import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, RefreshCw, Search, ArrowUpRight, Check, X, BellRing, Users, Clock, CircleDollarSign, Info } from "lucide-react";
import { resumirAlertas, valorSeguro, type AntiFraudAlert } from "./antifraude-metricas";
import "./antifraude.css";

const dinheiro = (v: number | string | null | undefined) => valorSeguro(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataHora = (d: string | null) => d && Number.isFinite(Date.parse(d)) ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Data não informada";
const contrato = (s?: string | null) => s === "active" ? "Ativo" : s === "suspended" ? "Suspenso" : s === "cancelled" ? "Encerrado" : "Não informado";
const motivos: Record<string, string> = { divida_ativa: "Pendência financeira", contrato_novo: "Contrato recente", consultas_repetidas: "Vários provedores consultaram", cliente_ativo: "Cliente ativo consultado" };
const prioridades: Record<string, string> = { critical: "Prioridade crítica", high: "Prioridade alta", medium: "Acompanhar", low: "Informativo" };

export default function AntiFraudePage() {
  const { toast } = useToast();
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [prioridade, setPrioridade] = useState("todas");
  const [ordem, setOrdem] = useState("prioridade");
  const { data: alerts = [], isLoading, isError, isFetching, refetch } = useQuery<AntiFraudAlert[]>({ queryKey: ["/api/anti-fraud/alerts"], staleTime: 30000 });
  const atualizar = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiRequest("PATCH", `/api/anti-fraud/alerts/${id}/status`, { status }),
    onSuccess: () => { setSelecionado(null); queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/alerts"] }); toast({ title: "Tratamento registrado" }); },
    onError: () => toast({ title: "Não foi possível atualizar o alerta", description: "Tente novamente. O status anterior foi mantido.", variant: "destructive" }),
  });
  const resumo = resumirAlertas(alerts);
  const aberto = (a: AntiFraudAlert) => !a.resolved && ["new", "active"].includes(a.status);
  const contagens: Record<string, number> = { active: alerts.filter(aberto).length, resolved: alerts.filter(a => a.status === "resolved").length, dismissed: alerts.filter(a => a.status === "dismissed").length, all: alerts.length };
  const termo = search.trim().toLocaleLowerCase("pt-BR");
  const peso: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
  const filtered = alerts.filter(a => (filter === "all" || (filter === "active" ? aberto(a) : a.status === filter))
    && (prioridade === "todas" || a.severity === prioridade)
    && (!termo || (a.customerName ?? "").toLocaleLowerCase("pt-BR").includes(termo) || (!!termo.replace(/\D/g, "") && (a.customerCpfCnpj ?? "").replace(/\D/g, "").includes(termo.replace(/\D/g, "")))))
    .sort((a,b) => ordem === "valor" ? valorSeguro(b.overdueAmount) - valorSeguro(a.overdueAmount) : ordem === "recentes" ? (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0) : (peso[b.severity] ?? 0) - (peso[a.severity] ?? 0) || (Date.parse(a.createdAt ?? "") || 0) - (Date.parse(b.createdAt ?? "") || 0));


  return <div className="af-page">
    <header className="af-hero">
      <div className="af-heading"><span className="af-emblem"><ShieldCheck size={25}/></span><div><span className="af-eyebrow">MONITORAMENTO DA CARTEIRA</span><h1>Anti-Fraude</h1><p>Consultas na rede que merecem sua atenção.</p></div></div>
      <div className="af-actions"><Button variant="outline" aria-label="Atualizar alertas" disabled={isFetching} onClick={() => refetch()}><RefreshCw size={15}/> Atualizar</Button></div>
    </header>
    <div className="af-context"><Info size={14}/><span>Alertas conforme as regras do Painel do Provedor. Consultas na rede são sinais para análise, não comprovação de fraude.</span></div>
    <section className="af-metrics" aria-label="Resumo dos alertas abertos">
      {[
        { label: "Em análise", value: resumo.abertos, note: "alertas abertos", icon: BellRing, tone: "purple" },
        { label: "Clientes", value: resumo.clientes, note: "sem repetir o mesmo cliente", icon: Users, tone: "blue" },
        { label: "Dívida identificada", value: dinheiro(resumo.divida), note: "último dado disponível por cliente", icon: CircleDollarSign, tone: "orange" },
        { label: "Prioritários", value: resumo.prioritarios, note: "alertas de prioridade alta ou crítica", icon: Clock, tone: "rose" },
      ].map(m => <div className={`af-metric af-${m.tone}`} key={m.label}><div><span>{m.label}</span><m.icon size={19}/></div><strong>{isLoading || isError ? "—" : m.value}</strong><small>{m.note}</small></div>)}
    </section>
    <section className="af-workspace">
      <div className="af-toolbar"><div className="af-tabs" aria-label="Situação do alerta">{Object.entries({ active: "Em análise", resolved: "Resolvidos", dismissed: "Descartados", all: "Todos" }).map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span>{contagens[key]}</span></button>)}</div><span className="af-counter">{filtered.length} {filtered.length === 1 ? "aviso" : "avisos"}</span></div>
      <div className="af-filters"><label className="af-search"><Search size={17}/><input aria-label="Buscar cliente ou documento" placeholder="Buscar cliente ou CPF/CNPJ" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="Filtrar prioridade" value={prioridade} onChange={e => setPrioridade(e.target.value)}><option value="todas">Todas as prioridades</option>{Object.entries(prioridades).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select><select aria-label="Ordenar alertas" value={ordem} onChange={e => setOrdem(e.target.value)}><option value="prioridade">Prioridade · antigos primeiro</option><option value="recentes">Mais recentes</option><option value="valor">Maior dívida no aviso</option></select></div>
      {isError ? <div className="af-empty" role="alert"><h2>Não foi possível carregar os avisos</h2><p>Os dados não estão disponíveis neste momento.</p><Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button></div> : isLoading ? <div className="af-list" data-testid="alerts-loading">{[1,2].map(i => <Skeleton key={i} className="h-64 rounded-xl"/>)}</div> : filtered.length === 0 ? <div className="af-empty" data-testid="alerts-empty"><ShieldCheck size={36}/><h2>Nenhum aviso neste recorte</h2><p>{alerts.length ? "Experimente outra situação, prioridade ou busca." : "As próximas consultas que atenderem às regras configuradas aparecerão aqui."}</p></div> : <div className="af-card-grid">{filtered.map(a => <Dialog key={a.id} open={selecionado === a.id} onOpenChange={open => setSelecionado(open ? a.id : null)}>
        <DialogTrigger asChild>
          <button className={`af-summary-card af-severity-${a.severity}`} aria-label={`Ver aviso de ${a.customerName || "cliente da carteira"}`}>
            <span className="af-summary-top"><span className="af-priority"><span/>{a.status === "resolved" ? "Resolvido" : a.status === "dismissed" ? "Descartado" : prioridades[a.severity] ?? "Acompanhar"}</span><time>{dataHora(a.createdAt).split(",")[0]}</time></span>
            <strong className="af-summary-name">{a.customerName || "Cliente da carteira"}</strong>
            <span className="af-summary-reason">{a.motivos?.map(m => motivos[m]).filter(Boolean).join(" · ") || "Consultado por outro provedor"}</span>
            <span className="af-summary-bottom"><span><b>{dinheiro(a.overdueAmount)}</b><small>{a.daysOverdue ?? "—"} dias de atraso</small></span><span className="af-summary-open">Ver detalhes <ArrowUpRight size={15}/></span></span>
          </button>
        </DialogTrigger>
        {selecionado === a.id && <DialogContent className="af-page af-modal">
          <DialogTitle className="sr-only">Aviso de {a.customerName || "cliente da carteira"}</DialogTitle>
          <DialogDescription className="sr-only">Detalhes da consulta, situação do cliente e ações para tratar este aviso.</DialogDescription>
          <Aviso alert={a} pendente={atualizar.isPending} tratar={status => atualizar.mutate({ id:a.id, status })}/>
        </DialogContent>}
      </Dialog>)}</div>}

    </section>
  </div>;
}

function Aviso({ alert: a, pendente, tratar }: { alert: AntiFraudAlert; pendente: boolean; tratar: (status:string) => void }) {
  const encerrado = a.resolved || ["resolved", "dismissed"].includes(a.status);
  const mudou = a.atual && (valorSeguro(a.atual.overdueAmount) !== valorSeguro(a.overdueAmount) || a.atual.contractStatus === "cancelled");
  const itens = a.motivos?.filter(m => motivos[m]) ?? [];
  return <article className={`af-aviso af-severity-${a.severity}`}>
    <div className="af-aviso-top"><span className="af-priority"><span/>{encerrado ? a.status === "dismissed" ? "Descartado" : "Resolvido" : prioridades[a.severity] ?? "Acompanhar"}</span><time>{dataHora(a.createdAt)}</time></div>
    <div className="af-aviso-body"><div className="af-client"><span className="af-avatar">{(a.customerName ?? "Cliente").split(" ").slice(0,2).map(n=>n[0]).join("")}</span><div><h2>{a.customerName || "Cliente da carteira"}</h2><span>{a.customerCpfCnpj || "Documento não informado"}</span></div></div>
      <div className="af-reason"><span className="af-eyebrow">POR QUE VOCÊ RECEBEU ESTE AVISO</span><p>Outro provedor consultou este cliente.</p><div className="af-chips">{itens.length ? itens.map(m => <span key={m}><Check size={12}/>{motivos[m]}</span>) : <span>Critério registrado no aviso</span>}</div></div>
      <div className="af-facts"><div><span>Dívida no aviso</span><strong>{dinheiro(a.overdueAmount)}</strong></div><div><span>Atraso no aviso</span><strong>{a.daysOverdue ?? "—"} dias</strong></div><div><span>Contrato atual</span><strong>{contrato(a.atual?.contractStatus)}</strong></div><div><span>Idade no aviso</span><strong>{a.diasDeContrato == null ? "Não informada" : `${a.diasDeContrato} dias`}</strong></div></div>
      {mudou && <div className="af-update" data-testid="alerta-mudou"><Check size={16}/><span><strong>Situação atualizada:</strong> {contrato(a.atual?.contractStatus)} · {dinheiro(a.atual?.overdueAmount)} vencidos. Confira antes de encerrar o caso.</span></div>}
      <details className="af-details"><summary>Ver contexto da consulta</summary><dl><div><dt>Origem</dt><dd>{a.consultingProviderName || "Outro provedor da rede"}</dd></div><div><dt>Provedores distintos em 30 dias, no aviso</dt><dd>{a.recentConsultations ?? "Não informado"}</dd></div><div><dt>Equipamentos registrados</dt><dd>{a.equipmentNotReturned ?? 0} · {dinheiro(a.equipmentValue)}</dd></div><div><dt>Atualização do contrato</dt><dd>{a.atual ? "Última sincronização disponível" : "Sem dado atual disponível"}</dd></div></dl><p>Os valores são registros disponíveis, não uma previsão de prejuízo. Nenhum custo de instalação é presumido.</p></details>
      <div className="af-next"><span>PRÓXIMO PASSO</span><p>{a.atual?.contractStatus === "cancelled" ? "Confira a carteira de ex-clientes e registre o tratamento deste aviso." : valorSeguro(a.atual ? a.atual.overdueAmount : a.overdueAmount) > 0 ? "Confira as faturas e o histórico antes de abordar o cliente sobre a pendência." : "Revise o relacionamento e avalie se há necessidade de contato."}</p></div>
    </div>
    <footer className="af-aviso-footer"><Link href={`/consulta-isp${a.customerCpfCnpj ? `?doc=${encodeURIComponent(a.customerCpfCnpj.replace(/\D/g, ""))}` : ""}`}><Button variant="outline" className="gap-2">Analisar cliente<ArrowUpRight size={15}/></Button></Link>{!encerrado && <div><Button variant="ghost" disabled={pendente} onClick={() => tratar("dismissed")} className="gap-1"><X size={15}/>Descartar</Button><Button disabled={pendente} onClick={() => tratar("resolved")} className="gap-1"><Check size={15}/>Resolvido</Button></div>}</footer>
  </article>;
}
