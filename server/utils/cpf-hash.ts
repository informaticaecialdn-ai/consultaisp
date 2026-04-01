import { createHash } from 'crypto'

/**
 * LGPD COMPLIANCE — Hash irreversivel de CPF para a rede colaborativa.
 *
 * O ERP nao sabe nada sobre hash. O ERP fala CPF. O adapter faz a traducao.
 * Este utilitario e chamado APENAS no Network Service / consultation flow,
 * nunca nos ERP adapters diretamente.
 *
 * REGRA DE OURO:
 * - Consulta ao ERP do proprio provedor -> usa CPF real -> NAO usa este utilitario
 * - Qualquer dado que vai para a rede colaborativa -> SEMPRE usa hashCPFForNetwork()
 *
 * SOBRE O SALT:
 * O NETWORK_CPF_SALT e uma string secreta fixa definida no .env.
 * Garante que mesmo sabendo o CPF, nao se gera o mesmo hash sem o salt
 * (protecao contra rainbow table attacks).
 * NUNCA mude o salt apos producao — isso invalida TODOS os hashes da rede.
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
      'Minimo: 32 caracteres. NUNCA altere apos entrar em producao.'
    )
  }
  return NETWORK_SALT
}

/**
 * Gera hash SHA-256 do CPF limpo + salt.
 * Resultado: string hex de 64 caracteres, sempre consistente para o mesmo CPF.
 *
 * hashCPFForNetwork("119.984.739-96") -> "a3f9b2c1d4e5f6a7b8c9..."
 * hashCPFForNetwork("11984473996")    -> "a3f9b2c1d4e5f6a7b8c9..." (mesmo resultado)
 */
export function hashCPFForNetwork(cpf: string): string {
  const clean = cpf.replace(/\D/g, '')

  if (clean.length !== 11 && clean.length !== 14) {
    throw new Error(
      `[LGPD] CPF/CNPJ invalido para hash: esperado 11 ou 14 digitos, recebido ${clean.length}`
    )
  }

  return createHash('sha256')
    .update(clean + getSalt())
    .digest('hex')
}

/**
 * Verifica se um CPF corresponde a um hash armazenado na rede.
 */
export function cpfMatchesNetworkHash(cpf: string, storedHash: string): boolean {
  try {
    return hashCPFForNetwork(cpf) === storedHash
  } catch {
    return false
  }
}
