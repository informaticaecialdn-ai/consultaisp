import { db } from "../db";
import { providers } from "@shared/schema";
import { eq, sql, and, ne } from "drizzle-orm";

export async function getRegionalProviders(providerId: number) {
  // Step 1: Get the requesting provider's cidadesAtendidas
  const [provider] = await db.select({
    id: providers.id,
    cidadesAtendidas: providers.cidadesAtendidas,
  }).from(providers).where(eq(providers.id, providerId));

  if (!provider?.cidadesAtendidas?.length) return [];

  // Step 2: Find all other active providers whose cidadesAtendidas overlaps
  // Uses PostgreSQL array overlap operator (&&)
  const regional = await db.select({
    id: providers.id,
    name: providers.name,
    cidadesAtendidas: providers.cidadesAtendidas,
  }).from(providers).where(
    and(
      ne(providers.id, providerId),
      eq(providers.status, "active"),
      sql`${providers.cidadesAtendidas} && ${provider.cidadesAtendidas}`
    )
  );

  return regional;
}
