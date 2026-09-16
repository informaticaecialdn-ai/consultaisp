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
