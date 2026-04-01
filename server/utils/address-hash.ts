import { createHash } from 'crypto'

/**
 * LGPD COMPLIANCE + ANTI-FRAUDE — Hash de endereco de instalacao.
 *
 * O endereco de instalacao nao e dado da PESSOA — e dado do IMOVEL.
 * Um imovel pode ter multiplos CPFs com historico de inadimplencia
 * (golpistas que trocam de CPF e voltam ao mesmo endereco).
 *
 * O hash do endereco resolve dois problemas:
 * 1. LGPD: endereco nao trafega em texto na rede colaborativa
 * 2. Normalizacao: "Rua X, 452" e "R. X 452" geram o mesmo hash
 *
 * CHAVE DO IMOVEL: CEP (8 digitos) + numero do imovel
 * - CEP e preciso e sem ambiguidade
 * - Numero identifica a unidade dentro do CEP
 * - Nome da rua tem variacoes de abreviacao que quebram o hash
 *
 * Usa o mesmo NETWORK_CPF_SALT do .env.
 */

let NETWORK_SALT: string | undefined

function getSalt(): string {
  if (!NETWORK_SALT) {
    NETWORK_SALT = process.env.NETWORK_CPF_SALT
  }
  if (!NETWORK_SALT || NETWORK_SALT.length < 32) {
    throw new Error(
      '[LGPD] NETWORK_CPF_SALT ausente ou muito curto no .env.\n' +
      'Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
      'Minimo: 32 caracteres.'
    )
  }
  return NETWORK_SALT
}

/**
 * Limpa e normaliza o CEP para 8 digitos numericos.
 * "86085-123" -> "86085123"
 */
function cleanCEP(cep: string): string {
  const clean = cep.replace(/\D/g, '')
  if (clean.length !== 8) {
    throw new Error(
      `[Anti-fraude] CEP invalido: esperado 8 digitos, recebido ${clean.length} (${cep})`
    )
  }
  return clean
}

/**
 * Limpa o numero do imovel: so digitos e letras (ex: "452A" -> "452A").
 */
function cleanNumber(numero: string): string {
  return numero
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/**
 * Gera hash SHA-256 do endereco para uso na rede colaborativa.
 *
 * hashAddressForNetwork("86085-123", "452")        -> "f7a3b2c1..."
 * hashAddressForNetwork("86085123", "452")         -> "f7a3b2c1..." (mesmo)
 * hashAddressForNetwork("86085-123", "452", "Ap3") -> "d9e1f2a3..." (diferente — apto)
 */
export function hashAddressForNetwork(
  cep: string,
  numero: string,
  complemento?: string
): string {
  const cleanedCEP = cleanCEP(cep)
  const cleanedNum = cleanNumber(numero)

  if (!cleanedNum) {
    throw new Error('[Anti-fraude] Numero do imovel e obrigatorio para hash de endereco')
  }

  const key = complemento
    ? `${cleanedCEP}:${cleanedNum}:${cleanNumber(complemento)}`
    : `${cleanedCEP}:${cleanedNum}`

  return createHash('sha256')
    .update(key + getSalt())
    .digest('hex')
}

/**
 * Verifica se um endereco (CEP + numero) corresponde a um hash armazenado.
 */
export function addressMatchesHash(
  cep: string,
  numero: string,
  storedHash: string,
  complemento?: string
): boolean {
  try {
    return hashAddressForNetwork(cep, numero, complemento) === storedHash
  } catch {
    return false
  }
}
