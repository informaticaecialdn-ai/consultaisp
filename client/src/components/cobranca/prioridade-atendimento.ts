/** Explainable work ordering; never sends a message or changes the case. */
export interface CasoParaPriorizar {
  id: number;
  valorAtual: number;
  prioridade: string;
  proximoContatoEm: string | null;
  ultimoContatoEm: string | null;
}
const diaBrasil = (data: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(data);
const peso: Record<string, number> = { critica: 0, alta: 1, normal: 2, baixa: 3 };
export function recomendarAtendimento(casos: readonly CasoParaPriorizar[], agora: Date) {
  return casos.flatMap(c => {
    if (!Number.isFinite(c.valorAtual) || c.valorAtual <= 0) return [];
    const proximo = c.proximoContatoEm ? new Date(c.proximoContatoEm) : null;
    const ultimo = c.ultimoContatoEm ? new Date(c.ultimoContatoEm) : null;
    if (proximo && (!Number.isFinite(proximo.getTime()) || proximo > agora)) return [];
    if (ultimo && (!Number.isFinite(ultimo.getTime()) || ultimo > agora || diaBrasil(ultimo) === diaBrasil(agora))) return [];
    return [{ id: c.id, motivo: proximo ? "Contato com prazo vencido ou chegando agora" : "Caso sem proximo contato agendado", prazo: proximo?.getTime() ?? Number.MAX_SAFE_INTEGER, prioridade: peso[c.prioridade] ?? 2, valor: c.valorAtual }];
  }).sort((a,b)=>a.prazo-b.prazo || a.prioridade-b.prioridade || b.valor-a.valor || a.id-b.id);
}
