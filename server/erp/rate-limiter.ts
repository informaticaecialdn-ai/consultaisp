/**
 * ERP Connector Engine — Rate Limiter
 *
 * Per-provider concurrency control using p-limit.
 * Prevents a single provider from overwhelming an ERP API with concurrent requests.
 */

import pLimit, { type LimitFunction } from "p-limit";

/** Internal map of limiters keyed by "providerId-erpSource" */
const limiters = new Map<string, LimitFunction>();

/**
 * Get or create a rate limiter for a specific provider + ERP source combination.
 *
 * @param providerId - The provider's database ID
 * @param erpSource - The ERP source identifier (e.g. "ixc", "mk", "hubsoft")
 * @param concurrency - Maximum concurrent requests (default: 3)
 * @returns A p-limit instance that constrains concurrency
 */
export function getProviderLimiter(
  providerId: number,
  erpSource: string,
  concurrency = 3,
): LimitFunction {
  const key = `${providerId}-${erpSource}`;
  let limiter = limiters.get(key);

  if (!limiter) {
    limiter = pLimit(concurrency);
    limiters.set(key, limiter);
  }

  return limiter;
}
