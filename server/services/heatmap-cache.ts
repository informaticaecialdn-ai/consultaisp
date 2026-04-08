import { storage } from "../storage";
import { geocodeCity, geocodeCep } from "./geocoding";
import { getConnector, buildConnectorConfig, getProviderLimiter } from "../erp";

export type HeatPoint = {
  lat: number;
  lng: number;
  city: string;
  state: string;
  totalOverdueAmount: number;
  maxDaysOverdue: number;
  overdueCount: number;
  providerId: number;
  providerName: string;
  customerName: string;
};

type CacheEntry = {
  points: HeatPoint[];
  fetchedAt: Date;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date;
  providerName: string;
  status: "ok" | "error" | "empty" | "pending";
  errorMessage?: string;
};

const _cache = new Map<number, CacheEntry>();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let _refreshing = false;

export async function refreshProviderCache(
  providerId: number,
  providerName: string,
  erpSource: string,
  intg: {
    apiUrl: string | null;
    apiToken: string | null;
    apiUser?: string | null;
    clientId?: string | null;
    clientSecret?: string | null;
    extraConfig?: Record<string, string> | null;
  },
): Promise<void> {
  const connector = getConnector(erpSource);
  if (!connector) {
    const existing = _cache.get(providerId);
    if (!existing || existing.status !== "ok") {
      _cache.set(providerId, {
        points: existing?.points || [],
        fetchedAt: existing?.fetchedAt || new Date(),
        lastSuccessAt: existing?.lastSuccessAt || null,
        lastAttemptAt: new Date(),
        providerName,
        status: "empty",
        errorMessage: "ERP nao suportado pelo motor de conectores",
      });
    }
    return;
  }

  try {
    const config = buildConnectorConfig(intg);
    const limiter = getProviderLimiter(providerId, erpSource);
    const result = await limiter(() => connector.fetchDelinquents(config));

    if (!result.ok) {
      const existing = _cache.get(providerId);
      if (existing && existing.status === "ok" && existing.points.length > 0) {
        existing.lastAttemptAt = new Date();
        existing.errorMessage = result.message;
        console.warn(`[HeatmapCache] Falha ao atualizar ${providerName}, mantendo cache anterior com ${existing.points.length} pontos: ${result.message}`);
      } else {
        _cache.set(providerId, {
          points: existing?.points || [],
          fetchedAt: existing?.fetchedAt || new Date(),
          lastSuccessAt: existing?.lastSuccessAt || null,
          lastAttemptAt: new Date(),
          providerName,
          status: "error",
          errorMessage: result.message,
        });
      }
      return;
    }

    const points: HeatPoint[] = [];
    const citySet = new Map<string, [number, number] | null>();

    for (const d of result.customers) {
      let city = d.city || "";
      let state = d.state || "";

      if ((!city || !state) && d.cep) {
        const loc = await geocodeCep(d.cep);
        if (loc) {
          city = loc.city;
          state = loc.state;
        }
      }

      if (!city || !state) continue;

      const cityKey = `${city.toLowerCase()},${state.toLowerCase()}`;
      let coords: [number, number] | null = null;
      if (citySet.has(cityKey)) {
        coords = citySet.get(cityKey)!;
      } else {
        coords = await geocodeCity(city, state);
        citySet.set(cityKey, coords);
      }

      if (!coords) continue;

      const jitter = () => (Math.random() - 0.5) * 0.02;
      points.push({
        lat: coords[0] + jitter(),
        lng: coords[1] + jitter(),
        city,
        state,
        totalOverdueAmount: d.totalOverdueAmount,
        maxDaysOverdue: d.maxDaysOverdue,
        overdueCount: d.overdueInvoicesCount ?? 1,
        providerId,
        providerName,
        customerName: d.name || "",
      });
    }

    const now = new Date();
    _cache.set(providerId, {
      points,
      fetchedAt: now,
      lastSuccessAt: now,
      lastAttemptAt: now,
      providerName,
      status: points.length > 0 ? "ok" : "empty",
    });
    console.log(
      `[HeatmapCache] ${providerName} (${erpSource}) — ${points.length} pontos geocodificados de ${result.customers.length} inadimplentes`,
    );
  } catch (err: any) {
    const msg = err.message || "Erro desconhecido";
    const existing = _cache.get(providerId);
    if (existing && existing.status === "ok" && existing.points.length > 0) {
      existing.lastAttemptAt = new Date();
      existing.errorMessage = msg;
      console.warn(`[HeatmapCache] Erro ao atualizar ${providerName}, mantendo cache anterior com ${existing.points.length} pontos: ${msg}`);
    } else {
      _cache.set(providerId, {
        points: existing?.points || [],
        fetchedAt: existing?.fetchedAt || new Date(),
        lastSuccessAt: existing?.lastSuccessAt || null,
        lastAttemptAt: new Date(),
        providerName,
        status: "error",
        errorMessage: msg,
      });
      console.warn(`[HeatmapCache] Erro ao buscar ${providerName}: ${msg}`);
    }
  }
}

export async function refreshAllProviders(): Promise<void> {
  if (_refreshing) return;
  _refreshing = true;
  try {
    const integrations = await storage.getAllEnabledErpIntegrationsWithCredentials();
    for (const intg of integrations) {
      if (!intg.apiUrl || !intg.apiToken) continue;
      await refreshProviderCache(
        intg.providerId,
        (intg as any).providerName || `Provider ${intg.providerId}`,
        intg.erpSource,
        {
          apiUrl: intg.apiUrl,
          apiToken: intg.apiToken,
          apiUser: intg.apiUser,
          clientId: intg.clientId,
          clientSecret: intg.clientSecret,
          extraConfig: intg.extraConfig as Record<string, string> | null,
        },
      );
    }
  } finally {
    _refreshing = false;
  }
}

export async function refreshProviderIfStale(providerId: number): Promise<void> {
  const entry = _cache.get(providerId);
  if (entry && entry.lastSuccessAt) {
    if (Date.now() - entry.lastSuccessAt.getTime() < CACHE_TTL_MS) return;
  }
  const integrations = await storage.getAllEnabledErpIntegrationsWithCredentials();
  const intg = integrations.find(i => i.providerId === providerId);
  if (!intg || !intg.apiUrl || !intg.apiToken) return;
  await refreshProviderCache(
    intg.providerId,
    (intg as any).providerName || `Provider ${intg.providerId}`,
    intg.erpSource,
    {
      apiUrl: intg.apiUrl,
      apiToken: intg.apiToken,
      apiUser: intg.apiUser,
      clientId: intg.clientId,
      clientSecret: intg.clientSecret,
      extraConfig: intg.extraConfig as Record<string, string> | null,
    },
  );
}

export function getProviderPoints(providerId: number): HeatPoint[] {
  return _cache.get(providerId)?.points || [];
}

export function getAllPoints(): HeatPoint[] {
  const all: HeatPoint[] = [];
  _cache.forEach(entry => {
    all.push(...entry.points);
  });
  return all;
}

export function getCacheStatus(): {
  providerId: number;
  providerName: string;
  points: number;
  fetchedAt: Date | null;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  isStale: boolean;
  status: string;
  errorMessage?: string;
}[] {
  return Array.from(_cache.entries()).map(([pid, entry]) => ({
    providerId: pid,
    providerName: entry.providerName,
    points: entry.points.length,
    fetchedAt: entry.fetchedAt,
    lastSuccessAt: entry.lastSuccessAt,
    lastAttemptAt: entry.lastAttemptAt,
    isStale: !entry.lastSuccessAt || Date.now() - entry.lastSuccessAt.getTime() > CACHE_TTL_MS,
    status: entry.status,
    errorMessage: entry.errorMessage,
  }));
}

export function isRefreshing(): boolean {
  return _refreshing;
}

export function startHeatmapCacheScheduler(): void {
  console.log("[HeatmapCache] Scheduler iniciado — atualiza a cada 7 dias");
  setTimeout(async () => {
    try {
      console.log("[HeatmapCache] Carga inicial do cache de mapa de calor...");
      await refreshAllProviders();
    } catch (err: any) {
      console.warn("[HeatmapCache] Erro na carga inicial do scheduler:", err.message || err);
    }
  }, 8000);
  setInterval(async () => {
    try {
      await refreshAllProviders();
    } catch (err: any) {
      console.warn("[HeatmapCache] Erro no refresh periodico do scheduler:", err.message || err);
    }
  }, CACHE_TTL_MS);
}
