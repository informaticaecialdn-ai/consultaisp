/**
 * ERP Connector Engine — Rate Limiter
 *
 * Per-provider concurrency control.
 * Prevents a single provider from overwhelming an ERP API with concurrent requests.
 */

/** Simple concurrency limiter (no external dependency) */
function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (active < concurrency && queue.length > 0) {
      active++;
      const resolve = queue.shift()!;
      resolve();
    }
  }

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>(resolve => queue.push(resolve));
    } else {
      active++;
    }
    try {
      return await fn();
    } finally {
      active--;
      next();
    }
  };
}

type LimitFunction = ReturnType<typeof createLimiter>;

/** Internal map of limiters keyed by "providerId-erpSource" */
const limiters = new Map<string, LimitFunction>();

/**
 * Get or create a rate limiter for a specific provider + ERP source combination.
 */
export function getProviderLimiter(
  providerId: number,
  erpSource: string,
  concurrency = 3,
): LimitFunction {
  const key = `${providerId}-${erpSource}`;
  let limiter = limiters.get(key);

  if (!limiter) {
    limiter = createLimiter(concurrency);
    limiters.set(key, limiter);
  }

  return limiter;
}
