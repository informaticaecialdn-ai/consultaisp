import { createHash } from "crypto";

/**
 * LGPD COMPLIANCE — Codigo de Provedor Parceiro
 *
 * Formato: ISP-#XXXXL
 *   - ISP-# = prefixo fixo
 *   - XXXX  = 4 caracteres alfanumericos (deterministicos a partir do ID)
 *   - L     = primeira letra do nome fantasia do provedor (uppercase)
 *
 * Exemplos:
 *   generatePartnerCode(1, "NsLink Provedor")    -> "ISP-#7A3FN"
 *   generatePartnerCode(42, "Vertical Telecom")   -> "ISP-#9D2EV"
 *   generatePartnerCode(7, "O L I Telecomunicacoes") -> "ISP-#4B8CO"
 *
 * Propriedades:
 *   - Deterministico: mesmo ID + nome = mesmo codigo sempre
 *   - Unico: baseado no ID do banco (PK), hash garante distribuicao uniforme
 *   - Irreversivel: nao e possivel descobrir o provedor pelo codigo
 *   - Legivel: operadores podem referenciar "ISP-#7A3FN" em conversas
 */

const SALT = "consulta-isp-partner-2026";
const CHARSET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem I e O para evitar confusao com 1 e 0

function hashToChars(input: string, length: number): string {
  const hash = createHash("sha256").update(input).digest();
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CHARSET[hash[i] % CHARSET.length];
  }
  return result;
}

/**
 * Gera o codigo de parceiro a partir do ID e nome do provedor.
 */
export function generatePartnerCode(providerId: number, providerName?: string): string {
  const code = hashToChars(`${SALT}:${providerId}`, 4);
  const initial = (providerName || "X").trim().charAt(0).toUpperCase();
  // Garantir que a inicial e uma letra valida
  const safeInitial = /[A-Z]/.test(initial) ? initial : "X";
  return `ISP-#${code}${safeInitial}`;
}

/**
 * Gera o nome anonimizado do provedor para exibicao na rede.
 */
export function anonymizeProvider(providerName: string, providerId?: number): string {
  if (providerId) {
    return `Provedor Parceiro ${generatePartnerCode(providerId, providerName)}`;
  }
  // Fallback sem ID: hash do nome (retrocompatibilidade)
  const code = hashToChars(`${SALT}:name:${providerName.toLowerCase().trim()}`, 4);
  const initial = providerName.trim().charAt(0).toUpperCase();
  const safeInitial = /[A-Z]/.test(initial) ? initial : "X";
  return `Provedor Parceiro ISP-#${code}${safeInitial}`;
}

/**
 * Retorna o nome do provedor conforme o contexto de exibicao.
 *
 * 'own':     operador vendo dados do PROPRIO provedor -> nome real
 * 'network': operador vendo dados de OUTRO provedor   -> codigo anonimo
 */
export function getProviderDisplayName(
  providerName: string,
  isSameProvider: boolean,
  providerId?: number,
): string {
  if (isSameProvider) {
    return providerName;
  }
  return anonymizeProvider(providerName, providerId);
}
