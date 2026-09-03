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
  // O mesmo segredo com outro nome de chave: GET /api/admin/providers
  // publicava `erpToken` ("usuario:token" ja decifrado) e `erpUrl` para TODOS
  // os provedores. Os campos sairam de ProviderWithStats em 03/09/2026; ficam
  // aqui como cinto e suspensorio, porque a censura e por nome e quem
  // reintroduzir o campo por outro caminho nao vai lembrar disso.
  "erpToken", "erpUrl",
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

/**
 * As rotas cujo CORPO de resposta nunca vira linha de log.
 *
 * A censura por nome de chave e a rede fina; esta lista e a rede grossa, para
 * rota cujo retorno muda de forma sozinho. As duas fazem falta: `erpToken`
 * vazou em 03/09/2026 justamente porque era a mesma credencial sob um nome que
 * a lista de chaves nao conhecia, numa rota que ninguem tinha marcado aqui.
 *
 * Entrada de texto casa por PREFIXO — e assim que o GET do historico e o POST
 * da consulta ficam cobertos pela mesma linha. Entrada de expressao regular
 * existe para caminho com id no meio, onde prefixo cobriria demais.
 *
 * Morava em `server/index.ts`, que sobe o servidor ao ser importado; o teste
 * precisava ler o fonte como texto para conferi-la, e nao conseguia exercitar a
 * comparacao de verdade. Aqui ela e uma funcao, e o teste chama a funcao.
 */
export const ROTAS_SEM_CORPO_NO_LOG: Array<string | RegExp> = [
  "/api/isp-consultations",
  "/api/spc-consultations",
  /**
   * A consulta cadastral e a que devolve MAIS dado pessoal do sistema: nome,
   * nascimento, nome da mae, enderecos, telefones e o array `emails`, com
   * endereco em texto puro. `sanitizeForLog` nao a cobria: a lista tem "email"
   * no singular, e o que a BigDataCorp devolve e `emails`, `enderecos`,
   * `telefones` e `identidade` — nenhum bate. Consertar a lista de chaves nao
   * resolveria: o resultado muda de forma a cada dataset novo.
   */
  "/api/bigdata-consultations",
  "/api/public/titular-request",
  /**
   * A leitura de integracao do superadmin devolve a credencial de ERP
   * DECIFRADA — apiToken, apiUser, clientSecret, mkContraSenha e o extraConfig,
   * onde cada conector guarda o que so ele usa (o app do SGP, o client id do
   * Voalle). Nao da para cobrir por prefixo: o id do provedor fica no meio do
   * caminho, e cortar `/api/admin/providers` apagaria o log da area
   * administrativa inteira.
   *
   * O PUT que grava a credencial devolve a integracao decifrada pelo mesmo
   * motivo, e entra junto.
   */
  /^\/api\/admin\/providers\/\d+\/(integration|erp\/[^/]+(\/test)?)$/,
];

/** Se o corpo desta resposta pode virar linha de log. */
export function corpoEhSensivel(path: string): boolean {
  return ROTAS_SEM_CORPO_NO_LOG.some(r =>
    typeof r === "string" ? path.startsWith(r) : r.test(path),
  );
}
