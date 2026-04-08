/**
 * LGPD COMPLIANCE — Anonimizacao do nome do provedor de origem.
 *
 * Quando o Provedor B ve dados do Provedor A na rede colaborativa,
 * ele NAO deve saber que e o "NG Telecom" ou "Vivo Fibra" que tem aquela divida.
 *
 * O codigo do parceiro e gerado a partir do ID do provedor no banco,
 * garantindo unicidade (sem colisao de hash) e consistencia.
 *
 * Formato: ISP-XXXX (4 digitos zero-padded a partir do ID)
 * Exemplos: ISP-0001, ISP-0042, ISP-1234
 */

/**
 * Gera o codigo de parceiro a partir do ID do provedor.
 * Unico: cada provedor tem um codigo diferente (baseado no ID).
 * Legivel: formato ISP-XXXX, facil de referenciar.
 */
export function generatePartnerCode(providerId: number): string {
  return `ISP-${String(providerId).padStart(4, "0")}`
}

/**
 * Gera o nome anonimizado do provedor para exibicao na rede.
 * Usa o providerId quando disponivel, fallback para nome.
 */
export function anonymizeProvider(providerName: string, providerId?: number): string {
  if (providerId) {
    return `Provedor Parceiro ${generatePartnerCode(providerId)}`
  }
  // Fallback: usar nome hasheado (retrocompatibilidade)
  const hash = Array.from(providerName.toLowerCase().trim()).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
  const shortId = Math.abs(hash).toString(16).substring(0, 4).toUpperCase().padStart(4, "0")
  return `Provedor Parceiro #${shortId}`
}

/**
 * Retorna o nome do provedor conforme o contexto de exibicao.
 *
 * 'own':     operador vendo dados do PROPRIO provedor -> nome real
 * 'network': operador vendo dados de OUTRO provedor   -> ID anonimo
 */
export function getProviderDisplayName(
  providerName: string,
  isSameProvider: boolean,
  providerId?: number,
): string {
  if (isSameProvider) {
    return providerName
  }
  return anonymizeProvider(providerName, providerId)
}
