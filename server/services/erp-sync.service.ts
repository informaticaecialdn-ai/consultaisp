/**
 * ERP Sync Service — Sincroniza inadimplentes do ERP para tabela customers
 * Roda periodicamente via scheduler. Dados ficam no banco local para:
 * - Mapa de calor (query instantanea)
 * - Consulta por endereco (cross-provider)
 */

import { storage } from "../storage";
import { getConnector, buildConnectorConfig, getProviderLimiter } from "../erp";
import { geocodeCity, geocodeCep, geocodeByCep, resolveIbgeCode } from "./geocoding";

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

  // Buscar cancelados com divida (I/N/FA) se disponivel, senao todos os inadimplentes
  const hasCancelled = typeof (connector as any).fetchCancelledDelinquents === "function";
  const result = await limiter(() =>
    hasCancelled
      ? (connector as any).fetchCancelledDelinquents(config)
      : connector.fetchDelinquents(config)
  );
  console.log(`[ERPSync] ${providerName}: usando ${hasCancelled ? "fetchCancelledDelinquents" : "fetchDelinquents"}`);

  if (!result.ok) {
    console.warn(`[ERPSync] Erro ao buscar ${providerName}: ${result.message}`);
    return { upserted: 0, errors: 1 };
  }

  let upserted = 0;
  let errors = 0;
  const total = result.customers.length;
  const startMs = Date.now();

  for (let idx = 0; idx < total; idx++) {
    const customer = result.customers[idx];
    if (idx > 0 && idx % 100 === 0) {
      const elapsed = Math.round((Date.now() - startMs) / 1000);
      console.log(`[ERPSync] ${providerName}: ${idx}/${total} upserted (${elapsed}s)`);
    }
    try {
      let city = customer.city || "";
      let state = customer.state || "";
      let address = customer.address || "";
      let lat: string | undefined;
      let lng: string | undefined;

      // IXC armazena cidade como codigo IBGE (numerico) — resolver via API IBGE
      if (/^\d+$/.test(city)) {
        const ibge = await resolveIbgeCode(city);
        if (ibge) {
          city = ibge.city;
          state = ibge.state;
        } else {
          city = "";
        }
      }

      // Resolver CEP → cidade/estado SOMENTE se o ERP nao forneceu.
      // ViaCEP serializa e pode levar 5s/req × 500+ clientes = 40+min de sync travado.
      if (customer.cep && (!city || !state)) {
        const loc = await geocodeCep(customer.cep);
        if (loc) {
          if (!city) city = loc.city;
          if (!state) state = loc.state;
          if (!address && loc.street) address = loc.street;
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

      // Geocodificar: CEP → bairro-level coords (cache por CEP unico, ~100 CEPs = ~100 calls).
      // Fallback: cidade → city-level com jitter.
      // LGPD: jitter ±200m no CEP, ±2km na cidade.
      if (customer.cep && city) {
        const cepCoords = await geocodeByCep(customer.cep, city, state);
        if (cepCoords) {
          lat = String(cepCoords[0] + (Math.random() - 0.5) * 0.004);
          lng = String(cepCoords[1] + (Math.random() - 0.5) * 0.004);
        }
      }
      if (!lat && city && state) {
        const cityCoords = await geocodeCity(city, state);
        if (cityCoords) {
          lat = String(cityCoords[0] + (Math.random() - 0.5) * 0.02);
          lng = String(cityCoords[1] + (Math.random() - 0.5) * 0.02);
        }
      }

      await storage.upsertFromErp({
        providerId,
        cpfCnpj: customer.cpfCnpj,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        addressNumber: customer.addressNumber,
        complement: customer.complement,
        neighborhood: customer.neighborhood,
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

export function startErpSyncScheduler(): void {
  console.log("[ERPSync] Scheduler iniciado — sync inicial em 15s, depois todo dia as 03:00");

  // Sync inicial 15s apos boot
  setTimeout(async () => {
    try {
      console.log("[ERPSync] Sync inicial...");
      await syncAllProviders();
    } catch (err: any) {
      console.warn("[ERPSync] Erro na sync inicial:", err.message);
    }
  }, 15000);

  // Agendar proximo sync para 03:00 da madrugada
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - now.getTime();
    console.log(`[ERPSync] Proximo sync agendado para ${next.toLocaleString("pt-BR")} (em ${Math.round(ms / 60000)} min)`);

    setTimeout(async () => {
      try {
        console.log("[ERPSync] Sync diario das 03:00 iniciado...");
        await syncAllProviders();
      } catch (err: any) {
        console.warn("[ERPSync] Erro no sync diario:", err.message);
      }
      scheduleNext(); // Agendar proximo dia
    }, ms);
  };

  scheduleNext();
}
