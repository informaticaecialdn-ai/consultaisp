/**
 * In-memory TTL cache for CPF consultation results.
 * LGPD compliant — data stays in memory only, never persisted.
 */

export interface CachedResult {
  result: any;
  consultation: any;
  cachedAt: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private cleanupTimer: ReturnType<typeof setInterval>;
  private maxSize: number;

  constructor(
    private ttlMs: number,
    cleanupIntervalMs: number = 60_000,
    maxSize: number = 10_000
  ) {
    this.maxSize = maxSize;
    this.cleanupTimer = setInterval(() => this._cleanup(), cleanupIntervalMs);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    let count = 0;
    const now = Date.now();
    for (const [, entry] of this.store) {
      if (now <= entry.expiresAt) count++;
    }
    return count;
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.store.clear();
  }

  private _cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

export class ConsultationCache {
  private cache: TtlCache<CachedResult>;

  constructor(ttlMs: number = 300_000) {
    this.cache = new TtlCache<CachedResult>(ttlMs);
  }

  buildKey(cpf: string, providerId: number, searchType: string): string {
    return `${cpf.replace(/\D/g, "")}:${providerId}:${searchType}`;
  }

  getResult(cpf: string, providerId: number, searchType: string): CachedResult | undefined {
    return this.cache.get(this.buildKey(cpf, providerId, searchType));
  }

  setResult(cpf: string, providerId: number, searchType: string, result: CachedResult): void {
    this.cache.set(this.buildKey(cpf, providerId, searchType), result);
  }

  hasResult(cpf: string, providerId: number, searchType: string): boolean {
    return this.cache.has(this.buildKey(cpf, providerId, searchType));
  }

  destroy(): void {
    this.cache.destroy();
  }
}

export const consultationCache = new ConsultationCache();
