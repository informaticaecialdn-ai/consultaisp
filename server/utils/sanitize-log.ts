/**
 * Limpeza do corpo de resposta antes de ele virar linha de log.
 *
 * Mora fora do `index.ts` porque aquele arquivo sobe o servidor ao ser
 * importado — e uma regra que decide o que e segredo precisa de teste.
 *
 * Dois grupos de campo: dado pessoal (LGPD) e credencial. A lista original so
 * tinha o primeiro, e o resultado apareceu no servidor de producao em
 * 27/08/2026: `PATCH /api/provider/erp-integrations/mk` devolve a integracao ja
 * DECIFRADA, e o log gravou o token e a contra-senha do MK de um provedor real
 * em texto puro — credencial de terceiro legivel por qualquer um com acesso ao
 * arquivo, e replicada em cada log rotacionado. O login fazia o mesmo com o
 * webhookToken.
 */

export const CHAVES_SENSIVEIS = new Set([
  // Dado pessoal
  "cpfCnpj", "customerName", "nome", "email", "phone", "telefone",
  "address", "cep", "nomeMae", "dataNascimento", "cpf_cnpj",
  "providerDetails", "addressMatches", "cadastralData", "restrictions",
  // Credenciais
  "apiToken", "apiUser", "mkContraSenha", "clientSecret", "clientId",
  "extraConfig", "webhookToken", "password", "senha", "token",
  "accessToken", "refreshToken", "apiKey", "secret", "authorization",
  "n8nAuthToken", "verificationToken",
]);

/**
 * Substitui por "[REDACTED]" todo campo sensivel, em qualquer profundidade.
 *
 * Arrays entram na recursao. A versao anterior parava neles (`!Array.isArray`),
 * entao um segredo dentro de uma lista escapava — e rota de listagem devolve
 * lista, que e exatamente onde as integracoes de ERP aparecem.
 */
export function sanitizeForLog(body: any): any {
  if (Array.isArray(body)) return body.map(sanitizeForLog);
  if (typeof body !== "object" || body === null) return body;

  const limpo: Record<string, any> = {};
  for (const chave of Object.keys(body)) {
    limpo[chave] = CHAVES_SENSIVEIS.has(chave) ? "[REDACTED]" : sanitizeForLog(body[chave]);
  }
  return limpo;
}
