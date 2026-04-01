import { createHash } from 'crypto'

/**
 * LGPD COMPLIANCE — Anonimizacao do nome do provedor de origem.
 *
 * Quando o Provedor B ve dados do Provedor A na rede colaborativa,
 * ele NAO deve saber que e o "NG Telecom" ou "Vivo Fibra" que tem aquela divida.
 * Isso e dado pessoal do titular (com quem ele tem relacao comercial).
 *
 * O ID anonimo e CONSISTENTE: mesmo provedor = mesmo ID sempre.
 * Isso permite que o operador identifique padroes (ex: "esse provedor #A3F9
 * sempre tem clientes problematicos") sem saber quem e o provedor.
 */

/**
 * Gera um ID anonimo de 4 caracteres para um provedor.
 * Consistente: mesmo nome sempre gera mesmo ID.
 * Irreversivel: nao e possivel descobrir o nome pelo ID.
 *
 * anonymizeProvider("NG Telecom")  -> "Provedor Parceiro #A3F9"
 * anonymizeProvider("Vivo Fibra")  -> "Provedor Parceiro #C7D2"
 */
export function anonymizeProvider(providerName: string): string {
  const hash = createHash('sha256')
    .update(providerName.toLowerCase().trim())
    .digest('hex')

  const shortId = hash.substring(0, 4).toUpperCase()
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
  isSameProvider: boolean
): string {
  if (isSameProvider) {
    return providerName
  }
  return anonymizeProvider(providerName)
}
