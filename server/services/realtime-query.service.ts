/**
 * Realtime Query Service — Consulta direta aos ERPs regionais.
 *
 * Consulta direta aos ERPs regionais. Cada consulta vai direto ao ERP
 * do provedor, em paralelo, com timeout individual.
 *
 * LGPD: dados do ERP nunca sao armazenados. Trafegam em memoria,
 * sao mascarados e retornados ao operador na mesma requisicao.
 */

import { getConnector } from "../erp/registry.js";
import "../erp/index.js"; // ensure connectors are registered
import type { ErpConnectionConfig, ErpFetchResult } from "../erp/types.js";
import type { ErpIntegration } from "@shared/schema";
import { logger } from "../logger.js";

const ERP_QUERY_TIMEOUT_MS = 30_000; // 30s per ERP — increased for multi-format CPF search

export interface RealtimeQueryResult {
  providerId: number;
  providerName: string;
  erpSource: string;
  ok: boolean;
  error?: string;
  timedOut?: boolean;  // true if this ERP was skipped due to timeout
  customers: Array<{
    cpfCnpj: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    addressNumber?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    cep?: string;
    latitude?: string;
    longitude?: string;
    status?: string;
    totalOverdueAmount: number;
    maxDaysOverdue: number;
    overdueInvoicesCount: number;
    serviceAgeMonths?: number;
    planName?: string;
    hasUnreturnedEquipment?: boolean;
    registrationDate?: string;
  }>;
  latencyMs: number;
}

function buildErpConfig(intg: ErpIntegration): ErpConnectionConfig {
  const apiUrl = (intg.apiUrl || "").replace(/\/+$/, "");
  const apiToken = intg.apiToken || "";

  // Step 8: Validate ERP config
  if (!apiUrl) {
    throw new Error(`URL do ERP nao configurada para o provedor ${intg.providerId}`);
  }
  try {
    new URL(apiUrl);
  } catch {
    throw new Error(`URL do ERP invalida para o provedor ${intg.providerId}: ${apiUrl}`);
  }
  if (!apiToken) {
    throw new Error(`Token do ERP nao configurado para o provedor ${intg.providerId}`);
  }

  return {
    apiUrl,
    apiToken,
    apiUser: intg.apiUser || undefined,
    clientId: undefined,
    clientSecret: undefined,
    extra: { providerId: String(intg.providerId) },
  };
}

/**
 * Query a single ERP for a CPF/CNPJ document.
 * Uses the specific connector's fetchDelinquents + fetchCustomerByCpf methods.
 */
async function querySingleErp(
  intg: ErpIntegration & { providerName: string },
  document: string,
  searchType: "cpf" | "cnpj" | "cep",
): Promise<RealtimeQueryResult> {
  const start = Date.now();
  const config = buildErpConfig(intg);
  const connector = getConnector(intg.erpSource);

  if (!connector) {
    return {
      providerId: intg.providerId,
      providerName: intg.providerName,
      erpSource: intg.erpSource,
      ok: false,
      error: `Conector ${intg.erpSource} nao disponivel`,
      customers: [],
      latencyMs: Date.now() - start,
    };
  }

  try {
    let customers: RealtimeQueryResult["customers"] = [];

    if (searchType === "cep") {
      if (typeof connector.fetchCustomersByCep === "function") {
        // Optimized path — query filtered by CEP directly at the ERP API
        const result = await Promise.race([
          connector.fetchCustomersByCep(config, document),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), ERP_QUERY_TIMEOUT_MS)
          ),
        ]);
        if (result.ok) {
          customers = result.customers.map(normalizeCustomer);
        } else {
          // Optimized CEP path failed — fallback to fetchDelinquents + in-memory CEP filter
          logger.warn({ providerId: intg.providerId, erpSource: intg.erpSource, error: result.message }, "RT-QUERY fetchCustomersByCep falhou, tentando fallback");
          const fallback = await Promise.race([
            connector.fetchDelinquents(config),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Timeout")), ERP_QUERY_TIMEOUT_MS)
            ),
          ]);
          if (fallback.ok) {
            customers = fallback.customers
              .filter(c => c.cep && c.cep.replace(/\D/g, "").startsWith(document.slice(0, 5)))
              .map(normalizeCustomer);
          } else {
            // Both paths failed — propagate error
            return {
              providerId: intg.providerId,
              providerName: intg.providerName,
              erpSource: intg.erpSource,
              ok: false,
              error: `CEP query falhou: ${result.message}`,
              customers: [],
              latencyMs: Date.now() - start,
            };
          }
        }
      } else {
        // Fallback — fetch all delinquents and filter by CEP in memory
        const result = await Promise.race([
          connector.fetchDelinquents(config),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), ERP_QUERY_TIMEOUT_MS)
          ),
        ]);
        if (result.ok) {
          customers = result.customers
            .filter(c => c.cep && c.cep.replace(/\D/g, "").startsWith(document.slice(0, 5)))
            .map(normalizeCustomer);
        }
      }
    } else {
      // CPF/CNPJ search — use fetchCustomerByCpf if available, fallback to fetchDelinquents
      if (typeof connector.fetchCustomerByCpf === "function") {
        const result = await Promise.race([
          connector.fetchCustomerByCpf(config, document),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), ERP_QUERY_TIMEOUT_MS)
          ),
        ]);
        if (result.ok && result.customers.length > 0) {
          customers = result.customers.map(normalizeCustomer);
        }
      } else {
        // Fallback: fetch all delinquents and filter by document
        const result = await Promise.race([
          connector.fetchDelinquents(config),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), ERP_QUERY_TIMEOUT_MS)
          ),
        ]);
        if (result.ok) {
          const cleanDoc = document.replace(/\D/g, "");
          const match = result.customers.find(
            c => c.cpfCnpj.replace(/\D/g, "") === cleanDoc
          );
          if (match) {
            customers = [normalizeCustomer(match)];
          }
        }
      }
    }

    return {
      providerId: intg.providerId,
      providerName: intg.providerName,
      erpSource: intg.erpSource,
      ok: true,
      customers,
      latencyMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    const isTimeout = msg === "Timeout" || msg.includes("timeout");
    logger.warn({ providerId: intg.providerId, erpSource: intg.erpSource, doc: document.slice(0, 4) + "***", error: msg }, "RT-QUERY ERP falhou");
    return {
      providerId: intg.providerId,
      providerName: intg.providerName,
      erpSource: intg.erpSource,
      ok: false,
      error: isTimeout ? `Timeout (${ERP_QUERY_TIMEOUT_MS / 1000}s)` : msg,
      timedOut: isTimeout,
      customers: [],
      latencyMs: Date.now() - start,
    };
  }
}

function normalizeCustomer(c: any): RealtimeQueryResult["customers"][0] {
  console.log(`[RT] normalizeCustomer: name=${c.name}, maxDaysOverdue=${c.maxDaysOverdue}, totalOverdueAmount=${c.totalOverdueAmount}, overdueInvoicesCount=${c.overdueInvoicesCount}`);
  return {
    cpfCnpj: c.cpfCnpj || "",
    name: c.name || "",
    email: c.email || undefined,
    phone: c.phone || undefined,
    address: c.address || undefined,
    addressNumber: c.addressNumber || c.number || undefined,
    complement: c.complement || undefined,
    neighborhood: c.neighborhood || undefined,
    city: c.city || undefined,
    state: c.state || undefined,
    cep: c.cep || undefined,
    latitude: c.latitude || undefined,
    longitude: c.longitude || undefined,
    totalOverdueAmount: c.totalOverdueAmount || 0,
    maxDaysOverdue: c.maxDaysOverdue || 0,
    overdueInvoicesCount: c.overdueInvoicesCount || 0,
    serviceAgeMonths: c.serviceAgeMonths || undefined,
    planName: c.planName || undefined,
    hasUnreturnedEquipment: c.hasUnreturnedEquipment || false,
  };
}

/**
 * Query multiple ERPs in parallel for a document (CPF/CNPJ/CEP).
 * Each ERP has its own timeout. Failed ERPs don't block others.
 */
export async function queryRegionalErps(
  integrations: Array<ErpIntegration & { providerName: string }>,
  document: string,
  searchType: "cpf" | "cnpj" | "cep",
): Promise<RealtimeQueryResult[]> {
  if (integrations.length === 0) return [];

  logger.info({ count: integrations.length, searchType, doc: document.slice(0, 4) + "***" }, "RT-QUERY consultando ERPs");

  const results = await Promise.allSettled(
    integrations.map(intg => querySingleErp(intg, document, searchType))
  );

  const finalResults = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      providerId: integrations[i].providerId,
      providerName: integrations[i].providerName,
      erpSource: integrations[i].erpSource,
      ok: false,
      error: r.reason?.message || "Promise rejected",
      customers: [],
      latencyMs: 0,
    };
  });

  const successful = finalResults.filter(r => r.ok).length;
  const failed = finalResults.filter(r => !r.ok).length;
  logger.info({ successful, failed, total: integrations.length }, "RT-QUERY concluido");

  return finalResults;
}
