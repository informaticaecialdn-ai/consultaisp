import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: { windowMs: number; maxRequests: number }) {
  const { windowMs, maxRequests } = options;
  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup of expired entries
  const cleanup = setInterval(() => {
    const now = Date.now();
    store.forEach((entry, key) => {
      if (now >= entry.resetAt) {
        store.delete(key);
      }
    });
  }, 60_000);
  cleanup.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now >= entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;

    if (entry.count > maxRequests) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      const retryMin = Math.ceil(retryAfterSec / 60);
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        message: `Muitas tentativas. Tente novamente em ${retryMin} minuto(s).`,
      });
    }

    return next();
  };
}
