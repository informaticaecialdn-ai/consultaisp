/**
 * O resultado GRAVADO de uma consulta (isp_consultations.result, JSONB) sai
 * cru no historico do proprio provedor. Ate 02/09/2026 ele guardava, em
 * texto, o codigo GLOBAL do parceiro com a inicial do nome no fim (ISP-#XXXXL)
 * e, dentro de addressSearch.addressGroups, o providerId CRU do parceiro —
 * que ligava o codigo ao id sem precisar de hash nenhum.
 *
 * Nada disso se recalcula na leitura: o id do parceiro nao fica nas entradas
 * mascaradas. Entao o historico sai LIMPO ao ser servido, em vez de reescrito
 * no banco: entradas de parceiro perdem o id e, quando trazem o codigo antigo,
 * ganham um rotulo fixo; erpLatencies e addressGroups (contexto de
 * diagnostico que nenhuma tela renderiza do historico) saem inteiros.
 *
 * Resultados novos ja nascem sem nada disso e com o codigo pareado — que
 * pertence ao proprio observador — e passam intactos.
 */
/**
 * Os tres formatos que ja existiram antes do codigo pareado, todos
 * reversiveis: "ISP-#XXXXL" (salt fixo + inicial do nome), "ISP-0042" (o id
 * cru, formatado) e "#A3F9" (sha256 do nome, sem salt — basta hashear os
 * nomes da regiao). O formato novo, ISP-XXX-XXX, nao casa com nenhum.
 */
// Sem \b antes do "#": espaco e "#" sao ambos nao-palavra, nao ha fronteira ali.
const CODIGO_ANTIGO = /(\bISP-#|\bISP-\d{4}\b|#[0-9A-F]{4}\b)/;
const ROTULO_LEGADO = "Provedor parceiro";
/** O texto do migrador citava o provedor onde o contrato foi cancelado. */
const MIGRADOR_ONDE = /(contrato cancelado em )([^,]+)/;
const MIGRADOR_ROTULO = "provedor da rede ISP";

function limparEntradaDeParceiro(entrada: unknown): unknown {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return entrada;
  const e = entrada as Record<string, unknown>;
  if (e.isSameProvider === true) return entrada;
  const { providerId: _id, ...resto } = e;
  if (typeof resto.providerName === "string" && CODIGO_ANTIGO.test(resto.providerName)) {
    resto.providerName = ROTULO_LEGADO;
  }
  return resto;
}

function limparMigrador(migrador: unknown): unknown {
  if (!migrador || typeof migrador !== "object" || Array.isArray(migrador)) return migrador;
  const m = migrador as Record<string, unknown>;
  if (typeof m.message !== "string") return migrador;
  const message = m.message.replace(MIGRADOR_ONDE, (_tudo, prefixo: string, onde: string) =>
    onde.trim() === MIGRADOR_ROTULO ? `${prefixo}${onde}` : `${prefixo}${MIGRADOR_ROTULO}`);
  return { ...m, message };
}

export function sanitizarResultadoGravado<T>(result: T): T {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const r: Record<string, unknown> = { ...(result as Record<string, unknown>) };

  if (Array.isArray(r.providerDetails)) r.providerDetails = r.providerDetails.map(limparEntradaDeParceiro);
  if (Array.isArray(r.addressMatches)) r.addressMatches = r.addressMatches.map(limparEntradaDeParceiro);
  if (r.migratorAlert) r.migratorAlert = limparMigrador(r.migratorAlert);
  if (r.addressSearch && typeof r.addressSearch === "object" && !Array.isArray(r.addressSearch)) {
    const { addressGroups: _grupos, ...resto } = r.addressSearch as Record<string, unknown>;
    r.addressSearch = resto;
  }
  delete r.erpLatencies;

  return r as T;
}
