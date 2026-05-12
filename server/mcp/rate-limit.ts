/**
 * Spec 008.5 Batch 3 — Rate limit in-memory por providerId.
 *
 * Janela deslizante de 60s, max 300 req (read) ou 60 req (write).
 * Implementação fixed-window simples — suficiente pra MVP single-process.
 * Quando escalar para multi-process, trocar por Redis (ioredis + script Lua).
 *
 * NB: nas tools do MCP server, todas são leitura no MVP — então 1 limite
 * único de 300/min serve. Se adicionarmos mutations em Spec 008.6+,
 * passa a discriminar.
 */

import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<number, Bucket>();
const WINDOW_MS = 60_000; // 1 minuto
const DEFAULT_LIMIT = 300; // requests por minuto

/** Cleanup de buckets expirados a cada 5 minutos (evita memory leak). */
const CLEANUP_INTERVAL_MS = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  // Array.from evita "downlevelIteration" warning em targets ES5
  for (const [key, bucket] of Array.from(buckets.entries())) {
    if (bucket.resetAt < now) {
      buckets.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref?.(); // unref pra não bloquear shutdown

export interface RateLimitOptions {
  limit?: number;
}

export function rateLimitByProvider(opts: RateLimitOptions = {}) {
  const limit = opts.limit ?? DEFAULT_LIMIT;

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    const providerId = req.mcpAuth?.providerId;
    if (providerId == null) {
      // Sem mcpAuth — middleware de auth precisa rodar antes. Reject.
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal: rateLimit requires requireMcpAuth first" },
      });
      return;
    }

    const now = Date.now();
    let bucket = buckets.get(providerId);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(providerId, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, limit - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        jsonrpc: "2.0",
        error: {
          code: -32029,
          message: "Rate limit exceeded",
          data: { limit, retryAfterSeconds: retryAfter },
        },
      });
      return;
    }

    next();
  };
}
