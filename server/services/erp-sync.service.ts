/**
 * ERP Sync Service — Sincroniza inadimplentes do ERP para tabela customers
 * Roda periodicamente via scheduler. Dados ficam no banco local para:
 * - Mapa de calor (query instantanea)
 * - Consulta por endereco (cross-provider)
 */

import { storage } from "../storage";
import { getConnector, buildConnectorConfig, getProviderLimiter } from "../erp";
import { geocodeCity, geocodeCep } from "./geocoding";

let _syncing = false;

export function isSyncing(): boolean {
  return _syncing;
}

export async function syncProviderToDb(
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
): Promise<{ upserted: number; errors: number }> {
  const connector = getConnector(erpSource);
  if (!connector) {
    console.warn(`[ERPSync] Conector nao encontrado para ${erpSource}`);
    return { upserted: 0, errors: 0 };
  }

  const config = buildConnectorConfig(intg);
  console.log(`[ERPSync] Sincronizando ${providerName} (${erpSource}) id=${providerId}`);

  const limiter = getProviderLimiter(providerId, erpSource);
  const result = await limiter(() => connector.fetchDelinquents(config));

  if (!result.ok) {
    console.warn(`[ERPSync] Erro ao buscar ${providerName}: ${result.message}`);
    return { upserted: 0, errors: 1 };
  }

  let upserted = 0;
  let errors = 0;
  const cityGeoCache = new Map<string, { lat: string; lng: string } | null>();

  for (const customer of result.customers) {
    try {
      let city = customer.city || "";
      let state = customer.state || "";
      let lat: string | undefined;
      let lng: string | undefined;

      // IXC armazena cidade como codigo IBGE (numerico) — ignorar
      if (/^\d+$/.test(city)) city = "";

      // Geocodificar via CEP (prioridade)
      if (customer.cep) {
        const loc = await geocodeCep(customer.cep);
        if (loc) {
          city = loc.city;
          state = loc.state;
        }
      }

      // Fallback: cidade do provedor
      if (!city || !state) {
        try {
          const prov = await storage.getProvider(providerId);
          if (prov?.addressCity && prov?.addressState) {
            city = prov.addressCity;
            state = prov.addressState;
          }
        } catch {}
      }

      // Geocodificar cidade → lat/lng
      if (city && state) {
        const cacheKey = `${city.toLowerCase()},${state.toLowerCase()}`;
        if (cityGeoCache.has(cacheKey)) {
          const cached = cityGeoCache.get(cacheKey);
          if (cached) { lat = cached.lat; lng = cached.lng; }
        } else {
          const coords = await geocodeCity(city, state);
          if (coords) {
            // LGPD: jitter ±0.02° (~2km)
            const jLat = coords[0] + (Math.random() - 0.5) * 0.02;
            const jLng = coords[1] + (Math.random() - 0.5) * 0.02;
            lat = String(jLat);
            lng = String(jLng);
            cityGeoCache.set(cacheKey, { lat: String(coords[0]), lng: String(coords[1]) });
          } else {
            cityGeoCache.set(cacheKey, null);
          }
        }

        // Aplicar jitter individual se temos coordenadas base do cache
        if (!lat && cityGeoCache.get(`${city.toLowerCase()},${state.toLowerCase()}`)) {
          const base = cityGeoCache.get(`${city.toLowerCase()},${state.toLowerCase()}`)!;
          lat = String(parseFloat(base.lat) + (Math.random() - 0.5) * 0.02);
          lng = String(parseFloat(base.lng) + (Math.random() - 0.5) * 0.02);
        }
      }

      await storage.upsertFromErp({
        providerId,
        cpfCnpj: customer.cpfCnpj,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        city,
        state,
        cep: customer.cep,
        latitude: lat,
        longitude: lng,
        totalOverdueAmount: customer.totalOverdueAmount,
        maxDaysOverdue: customer.maxDaysOverdue,
        overdueInvoicesCount: customer.overdueInvoicesCount ?? 1,
        erpSource,
      });
      upserted++;
    } catch (err: any) {
      errors++;
      if (errors <= 3) {
        console.warn(`[ERPSync] Erro ao upsert ${customer.cpfCnpj}: ${err.message}`);
      }
    }
  }

  console.log(`[ERPSync] ${providerName}: ${upserted} upserted, ${errors} erros de ${result.customers.length} inadimplentes`);
  return { upserted, errors };
}

export async function syncAllProviders(): Promise<void> {
  if (_syncing) {
    console.log("[ERPSync] Sync ja em andamento, pulando");
    return;
  }
  _syncing = true;

  try {
    const integrations = await storage.getAllEnabledErpIntegrationsWithCredentials();
    for (const intg of integrations) {
      if (!intg.apiUrl || !intg.apiToken) continue;
      try {
        await syncProviderToDb(
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
      } catch (err: any) {
        console.warn(`[ERPSync] Erro no provider ${intg.providerId}: ${err.message}`);
      }
    }
  } finally {
    _syncing = false;
  }
}

const SYNC_INTERVAL = 6 * 60 * 60 * 1000; // 6 horas

export function startErpSyncScheduler(): void {
  console.log("[ERPSync] Scheduler iniciado — sincroniza a cada 6h");
  // Sync inicial 15s apos boot
  setTimeout(async () => {
    try {
      console.log("[ERPSync] Sync inicial...");
      await syncAllProviders();
    } catch (err: any) {
      console.warn("[ERPSync] Erro na sync inicial:", err.message);
    }
  }, 15000);

  setInterval(async () => {
    try {
      await syncAllProviders();
    } catch (err: any) {
      console.warn("[ERPSync] Erro no sync periodico:", err.message);
    }
  }, SYNC_INTERVAL);
}
