import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Quem paga a conta do limite.
 *
 * A chave era so `providerId || ip`. Todo usuario SEM provedor caia no mesmo
 * balde: um deles gastava a cota de todos os outros, e o balde ficava sem dono
 * identificavel. Com o white label esse caso deixa de ser exotico, entao o
 * usuario responde por si — o prefixo separa o espaco de `p:` e `u:`, que sao
 * ids de tabelas diferentes e colidiriam se fossem numeros crus.
 *
 * Sem sessao (login, cadastro, rotas publicas) continua valendo o IP.
 */
export function chaveDoLimite(req: Request): string {
  const sessao = (req.session as any) || {};
  if (sessao.providerId && sessao.providerId > 0) return `p:${sessao.providerId}`;
  if (sessao.userId) return `u:${sessao.userId}`;
  return `ip:${req.ip || "unknown"}`;
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
    const key = chaveDoLimite(req);
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now >= entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
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
