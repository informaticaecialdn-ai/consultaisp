import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { providers } from "@shared/schema";

/**
 * O que um visitante da demonstração NUNCA pode ver: o sandbox de OUTRO
 * visitante, nem nada tirado dele.
 *
 * Cada visitante ganha um provedor descartável cujo subdomínio começa por
 * `sandbox-` (`PREFIXO_SANDBOX`, em server/demo/sandbox.service.ts). A rede que
 * todos devem ver é a dos cinco provedores fictícios (`rede-1`..`rede-5`). Toda
 * leitura que cruza provedores — contagem, benchmark, mapa, linha do tempo,
 * alerta — precisa tirar os sandboxes dos outros visitantes; senão os números da
 * "rede" crescem com o tráfego da demonstração. Medido no ar em 12/09/2026: a
 * Localização dizia "12 outros provedores" com oito sandboxes vivos, num mundo
 * de cinco.
 *
 * Em produção não existe sandbox — o cadastro recusa o prefixo —, então estes
 * predicados não tiram ninguém de lá.
 *
 * Mora aqui, e não em server/demo, porque quem usa são leituras do núcleo
 * (storage e serviços): importar o módulo do sandbox arrastaria o gerador do
 * mundo fictício para dentro delas.
 */

/** `PREFIXO_SANDBOX` seguido de `%`. A igualdade com o prefixo de verdade está presa em `server/demo/sandbox.service.test.ts`. */
export const PADRAO_DE_SANDBOX_NO_SQL = "sandbox-%";

/**
 * Para lista que já veio do banco (filtro em memória): o subdomínio é de um
 * sandbox de demonstração. Derivado do padrão, para o prefixo não ser digitado
 * duas vezes.
 */
export function ehSubdominioDeSandbox(subdomain: string | null | undefined): boolean {
  return (subdomain ?? "").toLowerCase().startsWith(PADRAO_DE_SANDBOX_NO_SQL.slice(0, -1));
}

/**
 * Para consulta que JÁ lê a tabela `providers` (no FROM ou num JOIN): a linha não
 * é sandbox — ou, com `observadorId`, é o sandbox do próprio observador.
 *
 * `subdomain` aceita nulo, e `NULL NOT LIKE ...` dá NULL, que o WHERE trata como
 * falso: sem o `IS NULL OR`, todo provedor sem subdomínio sumiria da leitura.
 */
export function provedorForaDeSandboxAlheio(observadorId?: number): SQL {
  if (observadorId === undefined) {
    return sql`(${providers.subdomain} IS NULL OR ${providers.subdomain} NOT LIKE ${PADRAO_DE_SANDBOX_NO_SQL})`;
  }
  return sql`(${providers.subdomain} IS NULL OR ${providers.subdomain} NOT LIKE ${PADRAO_DE_SANDBOX_NO_SQL} OR ${providers.id} = ${observadorId})`;
}

/**
 * Para consulta sobre uma tabela com `provider_id` que NÃO junta `providers`
 * (clientes, por exemplo): o dono da linha não é sandbox de outro visitante.
 * Subconsulta, e não JOIN, para não mudar o formato da linha que a função devolve.
 *
 * `NOT IN` com subconsulta vazia é verdadeiro, então em produção a cláusula
 * deixa tudo passar. A subconsulta só devolve `id`, que nunca é nulo — o
 * `NOT IN` não cai na armadilha do NULL.
 */
export function doProvedorForaDeSandboxAlheio(colunaProviderId: AnyPgColumn, observadorId?: number): SQL {
  if (observadorId === undefined) {
    return sql`${colunaProviderId} NOT IN (SELECT ${providers.id} FROM ${providers} WHERE ${providers.subdomain} LIKE ${PADRAO_DE_SANDBOX_NO_SQL})`;
  }
  return sql`${colunaProviderId} NOT IN (SELECT ${providers.id} FROM ${providers} WHERE ${providers.subdomain} LIKE ${PADRAO_DE_SANDBOX_NO_SQL} AND ${providers.id} <> ${observadorId})`;
}
