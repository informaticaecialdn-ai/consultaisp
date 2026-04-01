import { db } from "../db";
import { providers } from "@shared/schema";
import { eq, sql, and, ne } from "drizzle-orm";

/**
 * Find providers whose cidadesAtendidas overlap with the requesting provider.
 * Uses PostgreSQL array overlap operator (&&).
 */
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
      sql`${providers.cidadesAtendidas} && ${provider.cidadesAtendidas}`
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

  const regional = await db.select({
    id: providers.id,
    name: providers.name,
    mesorregioes: providers.mesorregioes,
  }).from(providers).where(
    and(
      ne(providers.id, providerId),
      eq(providers.status, "active"),
      sql`${providers.mesorregioes} && ${provider.mesorregioes}`
    )
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
