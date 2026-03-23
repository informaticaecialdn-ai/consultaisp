import { storage } from "./storage";

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
};

type CacheEntry = {
  points: HeatPoint[];
  fetchedAt: Date;
  providerName: string;
  status: "ok" | "error" | "empty" | "pending";
  errorMessage?: string;
};

const _cache = new Map<number, CacheEntry>();
const _cityGeo = new Map<string, [number, number] | null>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let _refreshing = false;

async function geocodeCity(city: string, state: string): Promise<[number, number] | null> {
  const key = `${city.toLowerCase()},${state.toLowerCase()}`;
  if (_cityGeo.has(key)) return _cityGeo.get(key)!;
  try {
    const q = `${city}, ${state}, Brazil`;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
    const r = await fetch(url, {
      headers: { "User-Agent": "ConsultaISP/1.0 heatmap@consultaisp.com.br" },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const data: any[] = await r.json();
      if (data[0]) {
        const coords: [number, number] = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        _cityGeo.set(key, coords);
        return coords;
      }
    }
  } catch {}
  _cityGeo.set(key, null);
  return null;
}

async function geocodeCep(cep: string): Promise<{ city: string; state: string } | null> {
  if (!cep || cep.length < 8) return null;
  try {
    const cleaned = cep.replace(/\D/g, "").padEnd(8, "0").slice(0, 8);
    const r = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`, {
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const data = await r.json();
      if (data.localidade && data.uf) return { city: data.localidade, state: data.uf };
    }
  } catch {}
  return null;
}

async function fetchIxcDelinquents(apiUrl: string, apiUser: string, apiToken: string): Promise<{
  cpfCnpj: string;
  name: string;
  city: string;
  state: string;
  cep: string;
  amount: number;
  daysOverdue: number;
}[]> {
  const basicAuth = Buffer.from(`${apiUser}:${apiToken}`).toString("base64");
  const base = apiUrl.startsWith("http") ? apiUrl : `https://${apiUrl}`;
  const endpoint = `${base}/webservice/v1/fn_areceber`;
  const headers = {
    Authorization: `Basic ${basicAuth}`,
    "Content-Type": "application/json",
    ixcsoft: "listar",
  };

  const byClient = new Map<string, { name: string; city: string; state: string; cep: string; amount: number; daysOverdue: number }>();
  const today = new Date();
  const PAGE_SIZE = 500;
  let page = 1;
  let totalFetched = 0;

  while (true) {
    const body = {
      qtype: "fn_areceber.status",
      query: "A",
      oper: "=",
      page: String(page),
      rp: String(PAGE_SIZE),
      sortname: "fn_areceber.id",
      sortorder: "asc",
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (text.includes("IP") && text.includes("liberado")) {
        throw new Error(`IP não liberado no IXC — libere o IP do servidor de produção nas configurações do IXC`);
      }
      throw new Error(`IXC retornou ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();

    if (data.type === "error" || (typeof data.message === "string" && data.message.includes("IP"))) {
      throw new Error(`IP não liberado no IXC — libere o IP do servidor de produção nas configurações do IXC`);
    }

    const rows: any[] = data.registros || data.rows || (Array.isArray(data) ? data : []);
    if (rows.length === 0) break;

    for (const r of rows) {
      const cpf = (r.cpf_cnpj || r.cnpj || r.id_cliente || "").toString().replace(/\D/g, "");
      if (!cpf) continue;
      const amount = parseFloat(r.valor || r.valor_original || "0") || 0;
      const due = r.vencimento || r.data_vencimento;
      const daysOverdue = due ? Math.max(0, Math.floor((today.getTime() - new Date(due).getTime()) / 86400000)) : 0;
      const existing = byClient.get(cpf);
      if (existing) {
        existing.amount += amount;
        if (daysOverdue > existing.daysOverdue) existing.daysOverdue = daysOverdue;
      } else {
        byClient.set(cpf, {
          name: r.razao || r.nome || r.name || cpf,
          city: r.cidade || r.city || "",
          state: r.uf || r.state || "",
          cep: (r.cep || "").replace(/\D/g, ""),
          amount,
          daysOverdue,
        });
      }
    }

    totalFetched += rows.length;

    const total = parseInt(data.total || data.count || "0", 10);
    if (total > 0 && totalFetched >= total) break;
    if (rows.length < PAGE_SIZE) break;

    page++;
  }

  return Array.from(byClient.entries()).map(([cpf, v]) => ({
    cpfCnpj: cpf,
    ...v,
  }));
}

export async function refreshProviderCache(
  providerId: number,
  providerName: string,
  erpSource: string,
  apiUrl: string,
  apiUser: string,
  apiToken: string,
): Promise<void> {
  if (erpSource !== "ixc") {
    _cache.set(providerId, { points: [], fetchedAt: new Date(), providerName, status: "empty", errorMessage: `ERP ${erpSource} não suportado` });
    return;
  }

  try {
    const delinquents = await fetchIxcDelinquents(apiUrl, apiUser, apiToken);
    const points: HeatPoint[] = [];

    const citySet = new Map<string, [number, number] | null>();

    for (const d of delinquents) {
      let city = d.city;
      let state = d.state;

      if ((!city || !state) && d.cep) {
        const loc = await geocodeCep(d.cep);
        if (loc) { city = loc.city; state = loc.state; }
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
        totalOverdueAmount: d.amount,
        maxDaysOverdue: d.daysOverdue,
        overdueCount: 1,
        providerId,
        providerName,
      });
    }

    _cache.set(providerId, { points, fetchedAt: new Date(), providerName, status: points.length > 0 ? "ok" : "empty" });
    console.log(`[HeatmapCache] ${providerName} — ${points.length} pontos geocodificados de ${delinquents.length} inadimplentes`);
  } catch (err: any) {
    const msg = err.message || "Erro desconhecido";
    _cache.set(providerId, { points: [], fetchedAt: new Date(), providerName, status: "error", errorMessage: msg });
    console.warn(`[HeatmapCache] Erro ao buscar ${providerName}: ${msg}`);
  }
}

export async function refreshAllProviders(): Promise<void> {
  if (_refreshing) return;
  _refreshing = true;
  const processed = new Set<number>();
  try {
    // 1. Provedores com credenciais IXC diretas (n8n_enabled = true, n8nWebhookUrl = IXC host)
    const n8nProviders = await storage.getAllProvidersWithN8n();
    for (const prov of n8nProviders) {
      if (!prov.n8nWebhookUrl || !prov.n8nAuthToken) continue;
      const parts = prov.n8nAuthToken.split(":");
      const apiUser = parts[0] || "";
      const apiPass = parts.slice(1).join(":") || "";
      await refreshProviderCache(
        prov.id,
        prov.name,
        prov.n8nErpProvider || "ixc",
        prov.n8nWebhookUrl,
        apiUser,
        apiPass,
      );
      processed.add(prov.id);
    }

    // 2. Integrações ERP locais cadastradas (erp_integrations table) — evita duplicar
    const integrations = await storage.getAllEnabledErpIntegrationsWithCredentials();
    for (const intg of integrations) {
      if (processed.has(intg.providerId)) continue;
      if (!intg.apiUrl || !intg.apiToken) continue;
      await refreshProviderCache(
        intg.providerId,
        (intg as any).providerName || `Provider ${intg.providerId}`,
        intg.erpSource,
        intg.apiUrl,
        intg.apiUser || "",
        intg.apiToken,
      );
      processed.add(intg.providerId);
    }
  } finally {
    _refreshing = false;
  }
}

export async function refreshProviderIfStale(providerId: number): Promise<void> {
  const entry = _cache.get(providerId);
  if (entry && Date.now() - entry.fetchedAt.getTime() < CACHE_TTL_MS) return;
  const integrations = await storage.getAllEnabledErpIntegrationsWithCredentials();
  const intg = integrations.find(i => i.providerId === providerId);
  if (!intg || !intg.apiUrl || !intg.apiToken) return;
  await refreshProviderCache(
    intg.providerId,
    (intg as any).providerName || `Provider ${intg.providerId}`,
    intg.erpSource,
    intg.apiUrl,
    intg.apiUser || "",
    intg.apiToken,
  );
}

export function getProviderPoints(providerId: number): HeatPoint[] {
  return _cache.get(providerId)?.points || [];
}

export function getAllPoints(): HeatPoint[] {
  const all: HeatPoint[] = [];
  for (const entry of _cache.values()) {
    all.push(...entry.points);
  }
  return all;
}

export function getCacheStatus(): {
  providerId: number;
  providerName: string;
  points: number;
  fetchedAt: Date | null;
  isStale: boolean;
  status: string;
  errorMessage?: string;
}[] {
  return Array.from(_cache.entries()).map(([pid, entry]) => ({
    providerId: pid,
    providerName: entry.providerName,
    points: entry.points.length,
    fetchedAt: entry.fetchedAt,
    isStale: Date.now() - entry.fetchedAt.getTime() > CACHE_TTL_MS,
    status: entry.status,
    errorMessage: entry.errorMessage,
  }));
}

export function isRefreshing(): boolean {
  return _refreshing;
}

export function startHeatmapCacheScheduler(): void {
  console.log("[HeatmapCache] Scheduler iniciado — atualiza a cada 24 horas");
  setTimeout(async () => {
    console.log("[HeatmapCache] Carga inicial do cache de mapa de calor...");
    await refreshAllProviders();
  }, 8000);
  setInterval(refreshAllProviders, CACHE_TTL_MS);
}
