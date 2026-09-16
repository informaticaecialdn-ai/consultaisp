import { storage } from "../../storage";

/** Cursor estável: casos que exigem humano não escondem elegíveis depois dos primeiros 100. */
export async function listarCandidatosDoChat(providerId: number) {
  const cobranca: Awaited<ReturnType<typeof storage.candidatosAoPrimeiroContato>>["cobranca"] = [];
  let equipamentos: { id: number }[] = [];
  let aposId = 0;
  for (let pagina = 0; pagina < 50; pagina++) {
    const lote = await storage.candidatosAoPrimeiroContato(providerId, aposId);
    if (pagina === 0) equipamentos = lote.equipamentos;
    cobranca.push(...lote.cobranca);
    if (!lote.proximoId) return { cobranca, equipamentos, limitado: false };
    if (lote.proximoId <= aposId) throw new Error("Cursor da fila de cobrança não avançou");
    aposId = lote.proximoId;
  }
  return { cobranca, equipamentos, limitado: true };
}

export interface CandidatoOrdenavel {
  id: number;
  carteira: string | null;
  proximoContatoEm?: Date | string | null;
  prioridade?: string | null;
  valorAtual?: number | string | null;
}

const ORDEM_DA_CARTEIRA: Record<string, number> = { ativo: 0, ex_cliente: 1 };
const ORDEM_DA_PRIORIDADE: Record<string, number> = { critica: 0, alta: 1, normal: 2 };

/**
 * A ordem da coluna "A iniciar" do Kanban, para o contato automático (pedido do
 * dono, 16/09/2026): quem a gestão de cobrança mostra primeiro é quem o
 * assistente chama primeiro. Clientes ativos antes de ex-clientes; dentro da
 * carteira, a faixa do dia (contato vencido → hoje → sem data → agendado), o
 * contato mais antigo, a prioridade do caso (crítica → alta → normal), o maior
 * valor e o id — os mesmos cortes de `ordemDoKanban` em cobranca.storage.ts.
 * `inicioDoDia` é o começo do dia da janela de contato (fuso de Brasília).
 */
export function ordenarCandidatosComoOKanban<T extends CandidatoOrdenavel>(candidatos: readonly T[], inicioDoDia: Date): T[] {
  const inicioDeAmanha = inicioDoDia.getTime() + 24 * 60 * 60 * 1000;
  const faixa = (c: CandidatoOrdenavel): number => {
    if (!c.proximoContatoEm) return 2;
    const t = new Date(c.proximoContatoEm).getTime();
    if (!Number.isFinite(t)) return 2;
    return t < inicioDoDia.getTime() ? 0 : t < inicioDeAmanha ? 1 : 3;
  };
  const instante = (c: CandidatoOrdenavel): number => (c.proximoContatoEm ? new Date(c.proximoContatoEm).getTime() || 0 : 0);
  const valor = (c: CandidatoOrdenavel): number => Number(c.valorAtual ?? 0) || 0;
  return [...candidatos].sort((a, b) =>
    (ORDEM_DA_CARTEIRA[a.carteira ?? ""] ?? 9) - (ORDEM_DA_CARTEIRA[b.carteira ?? ""] ?? 9)
    || faixa(a) - faixa(b)
    || instante(a) - instante(b)
    || (ORDEM_DA_PRIORIDADE[a.prioridade ?? ""] ?? 3) - (ORDEM_DA_PRIORIDADE[b.prioridade ?? ""] ?? 3)
    || valor(b) - valor(a)
    || a.id - b.id);
}
