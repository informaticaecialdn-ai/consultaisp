import { useState } from "react";
import { avaliarRiscoDeFuga } from "@shared/antifraude-avaliacao";
import { CATALOGO_DE_REGRAS, type RegrasAntiFraude, type TipoDeRegra } from "@shared/antifraude-regras";
import { Input } from "@/components/ui/input";

export function SimuladorAntiFraude({ regras }: { regras: RegrasAntiFraude }) {
  const [idade, setIdade] = useState("60");
  const [valor, setValor] = useState("100");
  const [atraso, setAtraso] = useState("5");
  const [provedores, setProvedores] = useState("1");
  const [status, setStatus] = useState<"active" | "suspended" | "cancelled">("active");
  const [proprio, setProprio] = useState(false);
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - Number(idade) * 86400000);
  const r = avaliarRiscoDeFuga({ contractStatus: status, contractStartDate: idade.trim() && Number.isFinite(inicio.getTime()) ? inicio.toISOString() : undefined, totalOverdueAmount: Number(valor), maxDaysOverdue: Number(atraso) }, { consultanteEhDono: proprio, agora: hoje, consultasDeOutros: Number(provedores), regras });
  return <details className="rounded-xl border p-4 bg-card" data-testid="simulador-antifraude"><summary className="cursor-pointer font-semibold text-sm">Testar regras em um cenário de exemplo</summary><p className="text-xs text-muted-foreground mt-2">Usa os critérios em edição. Não salva, não consulta clientes e não envia avisos.</p>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">{[{ label:"Dias de contrato (vazio = desconhecido)", value:idade, set:setIdade },{ label:"Dívida vencida (R$)", value:valor, set:setValor },{ label:"Dias de atraso", value:atraso, set:setAtraso },{ label:"Outros provedores em 30 dias", value:provedores, set:setProvedores }].map(c=><label key={c.label} className="text-xs space-y-2"><span>{c.label}</span><Input type="number" min="0" aria-label={c.label} value={c.value} onChange={e=>c.set(e.target.value)}/></label>)}</div>
    <div className="flex flex-wrap gap-4 items-center mt-4 text-xs"><label>Contrato <select aria-label="Contrato no cenário" className="border rounded p-2 bg-background" value={status} onChange={e=>setStatus(e.target.value as typeof status)}><option value="active">Ativo</option><option value="suspended">Suspenso</option><option value="cancelled">Encerrado</option></select></label><label className="flex gap-2"><input type="checkbox" checked={proprio} onChange={e=>setProprio(e.target.checked)}/>Consulta feita pelo próprio provedor</label></div>
    <div aria-live="polite" className={`mt-4 rounded-lg p-3 text-sm ${r.alerta ? "bg-emerald-500/10" : "bg-muted"}`}><strong>{r.alerta ? "Geraria um alerta" : "Não geraria alerta"}</strong><p className="text-xs mt-1">{r.descartadoPor === "consulta_do_proprio_dono" ? "Consultas próprias não acionam o monitoramento." : r.descartadoPor === "contrato_cancelado" ? "Contrato encerrado pertence à carteira de ex-clientes." : regras.combinacao === "todas" ? "Todos os critérios ligados precisam ser atendidos." : "Basta um dos critérios ligados ser atendido."}</p>{r.criterios?.map(c=><p key={c.tipo} className="text-xs mt-1">{c.atendido ? "✓" : "—"} {CATALOGO_DE_REGRAS[c.tipo as TipoDeRegra].titulo}: {c.atendido ? "atendido" : "não atendido ou dado ausente"}</p>)}</div>
  </details>;
}
