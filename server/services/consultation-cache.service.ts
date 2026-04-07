/**
 * In-memory TTL cache for CPF consultation results.
 * LGPD compliant — data stays in memory only, never persisted.
 */

/** Typed consultation result shape */
export interface ConsultationResult {
  cpfCnpj: string;
  searchType: string;
  notFound: boolean;
  score: number;
  score100?: number;
  faixa: string;
  nivelRisco: string;
  corIndicador: string;
  sugestaoIA: string;
  fatoresScore?: unknown;
  riskTier: string;
  riskLabel: string;
  recommendation: string;
  decisionReco: string;
  providersFound: number;
  providerDetails: unknown[];
  alerts: string[];
  recommendedActions: string[];
  creditsCost: number;
  isOwnCustomer: boolean;
  addressSearch?: unknown;
  addressMatches?: unknown[];
  migratorAlert?: unknown;
  addressSource?: string | null;
  addressUsed?: string | null;
  autoAddressCrossRef?: boolean;
  source: string;
  erpLatencies?: unknown[];
  erpSummary?: { total: number; responded: number; failed: number; timedOut: number };
  baseLegal?: string;
  finalidadeConsulta?: string;
  controlador?: string;
}

/** Typed consultation record shape */
export interface ConsultationRecord {
  id: number;
  providerId: number;
  userId: number;
  cpfCnpj: string;
  cpfCnpjHash?: string | null;
  searchType: string;
  result: unknown;
  score: number | null;
  decisionReco: string | null;
  cost: number | null;
  approved: boolean | null;
  createdAt?: string | Date | null;
}

export interface CachedResult {
  result: ConsultationResult & Record<string, unknown>;
  consultation: Partial<ConsultationRecord> & Record<string, unknown>;
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

/** Raw ERP result before LGPD masking — cached by region */
export interface RawRegionalResult {
  erpResults: unknown[];
  cachedAt: number;
}

export class ConsultationCache {
  private cache: TtlCache<CachedResult>;
  private regionalCache: TtlCache<RawRegionalResult>;

  constructor(ttlMs: number = 300_000) {
    this.cache = new TtlCache<CachedResult>(ttlMs);
    this.regionalCache = new TtlCache<RawRegionalResult>(ttlMs);
  }

  buildKey(cpf: string, providerId: number, searchType: string): string {
    return `${cpf.replace(/\D/g, "")}:${providerId}:${searchType}`;
  }

  buildRegionalKey(cpf: string, mesoregiao: string, searchType: string): string {
    return `erp_raw:${cpf.replace(/\D/g, "")}:${mesoregiao}:${searchType}`;
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

  getRawResult(cpf: string, mesoregiao: string, searchType: string): RawRegionalResult | undefined {
    return this.regionalCache.get(this.buildRegionalKey(cpf, mesoregiao, searchType));
  }

  setRawResult(cpf: string, mesoregiao: string, searchType: string, erpResults: unknown[]): void {
    this.regionalCache.set(this.buildRegionalKey(cpf, mesoregiao, searchType), {
      erpResults,
      cachedAt: Date.now(),
    });
  }

  destroy(): void {
    this.cache.destroy();
    this.regionalCache.destroy();
  }
}

export const consultationCache = new ConsultationCache();
