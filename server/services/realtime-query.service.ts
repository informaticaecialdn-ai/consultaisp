/**
 * Realtime Query Service — Consulta direta aos ERPs regionais.
 *
 * Substitui o endpoint N8N central. Cada consulta vai direto ao ERP
 * do provedor, em paralelo, com timeout individual.
 *
 * LGPD: dados do ERP nunca sao armazenados. Trafegam em memoria,
 * sao mascarados e retornados ao operador na mesma requisicao.
 */

import { getConnector } from "../erp/registry.js";
import "../erp/index.js"; // ensure connectors are registered
import type { ErpConnectionConfig, ErpFetchResult } from "../erp/types.js";
import type { ErpIntegration } from "@shared/schema";
import { IxcConnector } from "../erp/connectors/ixc.js";

const ERP_QUERY_TIMEOUT_MS = 15_000; // 15s per ERP

export interface RealtimeQueryResult {
  providerId: number;
  providerName: string;
  erpSource: string;
  ok: boolean;
  error?: string;
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
  return {
    apiUrl: (intg.apiUrl || "").replace(/\/+$/, ""),
    apiToken: intg.apiToken || "",
    apiUser: intg.apiUser || undefined,
    clientId: undefined,
    clientSecret: undefined,
    extra: {},
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
      // Address search — use fetchCustomersByAddress if available (IXC)
      if (connector instanceof IxcConnector) {
        const result = await Promise.race([
          connector.fetchCustomersByAddress(config, { cep: document }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), ERP_QUERY_TIMEOUT_MS)
          ),
        ]);
        if (result.ok) {
          customers = result.customers.map(normalizeCustomer);
        }
      } else {
        // Fallback: fetch all delinquents and filter by CEP
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
      // CPF/CNPJ search — try fetchCustomerByCpf first (IXC has it), fallback to fetchDelinquents
      if (connector instanceof IxcConnector) {
        // IXC: busca o cliente + faturas abertas em paralelo
        const [clientResult, delinqResult] = await Promise.all([
          Promise.race([
            connector.fetchCustomerByCpf(config, document),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Timeout")), ERP_QUERY_TIMEOUT_MS)
            ),
          ]),
          Promise.race([
            connector.fetchDelinquents(config),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Timeout")), ERP_QUERY_TIMEOUT_MS)
            ),
          ]),
        ]);

        const cleanDoc = document.replace(/\D/g, "");

        if (clientResult.ok && clientResult.customer) {
          const c = clientResult.customer;
          // Find matching delinquent record for overdue data
          const delinquent = delinqResult.ok
            ? delinqResult.customers.find(d => d.cpfCnpj.replace(/\D/g, "") === cleanDoc)
            : null;

          customers = [{
            cpfCnpj: c.cpfCnpj,
            name: c.name,
            email: c.email || undefined,
            phone: c.phone || undefined,
            address: c.address || undefined,
            addressNumber: c.number || undefined,
            complement: c.complement || undefined,
            neighborhood: c.neighborhood || undefined,
            city: c.city || undefined,
            state: c.state || undefined,
            cep: c.cep || undefined,
            status: c.status || "unknown",
            totalOverdueAmount: delinquent?.totalOverdueAmount || 0,
            maxDaysOverdue: delinquent?.maxDaysOverdue || 0,
            overdueInvoicesCount: delinquent?.overdueInvoicesCount || 0,
            registrationDate: c.registrationDate || undefined,
          }];
        } else if (delinqResult.ok) {
          // Client not found by CPF, but check delinquents
          const match = delinqResult.customers.find(
            d => d.cpfCnpj.replace(/\D/g, "") === cleanDoc
          );
          if (match) {
            customers = [normalizeCustomer(match)];
          }
        }
      } else {
        // Other ERPs: fetch delinquents and filter by document
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
    console.warn(`[RT-QUERY] ${intg.providerName} (${intg.erpSource}) falhou: ${msg}`);
    return {
      providerId: intg.providerId,
      providerName: intg.providerName,
      erpSource: intg.erpSource,
      ok: false,
      error: msg,
      customers: [],
      latencyMs: Date.now() - start,
    };
  }
}

function normalizeCustomer(c: any): RealtimeQueryResult["customers"][0] {
  return {
    cpfCnpj: c.cpfCnpj || "",
    name: c.name || "",
    email: c.email || undefined,
    phone: c.phone || undefined,
    address: c.address || undefined,
    city: c.city || undefined,
    state: c.state || undefined,
    cep: c.cep || undefined,
    totalOverdueAmount: c.totalOverdueAmount || 0,
    maxDaysOverdue: c.maxDaysOverdue || 0,
    overdueInvoicesCount: c.overdueInvoicesCount || 0,
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

  console.log(`[RT-QUERY] Consultando ${integrations.length} ERP(s) para ${searchType} ${document.slice(0, 4)}***`);

  const results = await Promise.allSettled(
    integrations.map(intg => querySingleErp(intg, document, searchType))
  );

  return results.map((r, i) => {
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
}
