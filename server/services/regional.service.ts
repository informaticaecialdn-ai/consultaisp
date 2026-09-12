import { db, pool } from "../db";
import { providers } from "@shared/schema";
import { eq, sql, and, ne, arrayOverlaps } from "drizzle-orm";

/**
 * Find providers whose cidadesAtendidas overlap with the requesting provider.
 * Uses PostgreSQL array overlap operator (&&).
 */
/**
 * "As cidades deste provedor cruzam com as do outro" — em SQL.
 *
 * ── O 500 que isto conserta ────────────────────────────────────────────────
 * `GET /api/regional/providers` respondia 500 em producao com
 * `operator does not exist: text[] && record`, medido no log de 04/09/2026
 * (13:51 e 14:03). A linha era escrita a mao:
 *
 *     sql`${providers.cidadesAtendidas} && ${provider.cidadesAtendidas}`
 *
 * e um array de JavaScript interpolado num template `sql` do Drizzle NAO vira
 * um parametro de array: vira uma LISTA de parametros entre parenteses. O texto
 * que chegava ao Postgres era `"cidades_atendidas" && ($1, $2)` — e `($1, $2)`
 * e um construtor de linha, ou seja, um `record`. Nao existe
 * `text[] && record`, e a consulta morria antes de tocar em uma linha.
 *
 * Conferido renderizando as tres formas com o mesmo dialeto de producao:
 *   ${cidades}              -> `&& ($1, $2)`      params ["A","B"]     QUEBRA
 *   ${sql.param(cidades)}   -> `&& $1::text[]`    params [["A","B"]]   ok
 *   arrayOverlaps(col, arr) -> `&& $1`            params ['{"A","B"}'] ok
 *
 * Um `::text[]` colado no fim do template NAO resolve — viraria
 * `($1, $2)::text[]`, que e o mesmo record com outra mensagem de erro. Por isso
 * aqui esta o operador do proprio Drizzle, que serializa o literal de array e
 * manda UM parametro so.
 *
 * A funcao irma logo abaixo (`getProvidersByMesoregion`) ja tinha esbarrado
 * nisto e escapou por outro caminho — SQL cru com `$2::text[]` —, e o
 * comentario dela diz "to avoid Drizzle type issues" sem dizer qual era. Era
 * esta.
 *
 * Exportada para ser conferivel em teste: a diferenca entre a rota responder e
 * a rota dar 500 e invisivel na leitura da linha.
 */
export function sobreposicaoDeCidades(cidades: string[]) {
  return arrayOverlaps(providers.cidadesAtendidas, cidades);
}

/**
 * O padrão SQL de sandbox de demonstração: `PREFIXO_SANDBOX`
 * (`server/demo/sandbox.service.ts`) seguido de `%`.
 *
 * Escrito aqui como texto, e não importado de lá, de propósito: este serviço é
 * núcleo (benchmark, rota regional, superadmin), e o módulo do sandbox arrasta
 * meio schema e o gerador do mundo fictício junto. A igualdade com o prefixo de
 * verdade está presa em teste (`server/demo/sandbox.service.test.ts`).
 */
export const PADRAO_DE_SANDBOX_NO_SQL = "sandbox-%";

/**
 * "Não é o sandbox de OUTRO visitante" — em SQL.
 *
 * Achado ao pôr a demonstração no ar (12/09/2026): a busca regional casava
 * qualquer provedor ativo da mesma região, e todo sandbox nasce na MESMA
 * região do mundo fictício. Com a região preenchida, cada visitante veria os
 * outros visitantes como "provedores parceiros", e o benchmark regional
 * misturaria a atividade deles. A consulta na rede já fazia essa exclusão
 * (`server/routes/consultas.routes.ts`); aqui ela passa a valer para toda
 * busca regional, na query, e não em cada rota que a chama. O próprio
 * provedor já sai pelo `id != ...` de cada busca.
 *
 * `subdomain` aceita nulo, e `NULL NOT LIKE ...` dá NULL — que o WHERE trata
 * como falso. Sem o `IS NULL OR`, todo provedor sem subdomínio sumiria da
 * região. Em produção não existe sandbox (o cadastro recusa o prefixo), então
 * lá o efeito é nenhum.
 */
export function foraDeSandboxAlheio() {
  return sql`(${providers.subdomain} IS NULL OR ${providers.subdomain} NOT LIKE ${PADRAO_DE_SANDBOX_NO_SQL})`;
}

export async function getRegionalProviders(providerId: number) {
  const [provider] = await db.select({
    id: providers.id,
    cidadesAtendidas: providers.cidadesAtendidas,
  }).from(providers).where(eq(providers.id, providerId));

  if (!provider?.cidadesAtendidas?.length) return [];

  const regional = await db.select({
    id: providers.id,
    name: providers.name,
    cidadesAtendidas: providers.cidadesAtendidas,
    mesorregioes: providers.mesorregioes,
  }).from(providers).where(
    and(
      ne(providers.id, providerId),
      eq(providers.status, "active"),
      sobreposicaoDeCidades(provider.cidadesAtendidas),
      foraDeSandboxAlheio(),
    )
  );

  return regional;
}

/**
 * Find all active providers that share at least one mesoregion with the given provider.
 * This is the core function for limiting ERP queries to the same macro-region.
 *
 * Example: Provider in Londrina (mesoregion "Norte Central Paranaense")
 * → returns all providers whose mesorregioes array includes "Norte Central Paranaense"
 * → does NOT return providers from Curitiba ("Metropolitana de Curitiba")
 */
export async function getProvidersByMesoregion(providerId: number) {
  const [provider] = await db.select({
    id: providers.id,
    mesorregioes: providers.mesorregioes,
  }).from(providers).where(eq(providers.id, providerId));

  if (!provider?.mesorregioes?.length) return [];

  // Use raw SQL with proper array parameter to avoid Drizzle type issues.
  // A ultima linha e a mesma exclusao de `foraDeSandboxAlheio`, acima, escrita
  // no SQL cru desta funcao — com o `IS NULL OR` pelo mesmo motivo. E esta a
  // busca do benchmark regional e do card "Provedores parceiros" do painel.
  const { rows: regional } = await pool.query(
    `SELECT id, name, mesorregioes FROM providers
     WHERE id != $1 AND status = 'active'
     AND mesorregioes && $2::text[]
     AND (subdomain IS NULL OR subdomain NOT LIKE $3)`,
    [providerId, provider.mesorregioes, PADRAO_DE_SANDBOX_NO_SQL]
  );

  return regional;
}

/**
 * Get the provider IDs that share the same mesoregion as the requesting provider.
 * Used by the consultation route to filter which ERPs to query.
 */
export async function getRegionalProviderIds(providerId: number): Promise<number[]> {
  const regional = await getProvidersByMesoregion(providerId);
  return regional.map(r => r.id);
}
