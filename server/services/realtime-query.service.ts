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
import { buildConnectorConfig } from "../erp/config.js";
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
    unreturnedEquipmentCount?: number;
    equipmentCategories?: string[];
    equipmentPendingValue?: number;
    registrationDate?: string;
    /** Inicio do contrato como o ERP devolve — ISO ou DD/MM/AAAA. */
    contractStartDate?: string;
  }>;
  latencyMs: number;
}

/**
 * Monta a config do conector para a consulta ao vivo.
 *
 * Usa o MESMO `buildConnectorConfig` do sync, e não uma cópia. A cópia que
 * existia aqui fixava `clientId`/`clientSecret` em `undefined` e montava
 * `extra` só com o providerId, jogando fora `mkContraSenha`, `extra.clientId`,
 * `extra.clientSecret`, `extra.sgpApp` e `extra.voalleClientId`. O efeito era
 * silencioso e por ERP: MK autenticava sem contra-senha, Hubsoft pedia OAuth
 * sem client_id e SGP ia sem nome de app — os três recusavam a credencial, e a
 * consulta reportava "ERP falhou" como se fosse indisponibilidade do provedor.
 * Só IXC e RBX passavam, porque precisam apenas de url + token (+ usuário).
 */
function buildErpConfig(intg: ErpIntegration): ErpConnectionConfig {
  const apiUrl = (intg.apiUrl || "").replace(/\/+$/, "");

  if (!apiUrl) {
    throw new Error(`URL do ERP nao configurada para o provedor ${intg.providerId}`);
  }
  try {
    new URL(apiUrl);
  } catch {
    throw new Error(`URL do ERP invalida para o provedor ${intg.providerId}: ${apiUrl}`);
  }
  if (!intg.apiToken) {
    throw new Error(`Token do ERP nao configurado para o provedor ${intg.providerId}`);
  }

  const config = buildConnectorConfig({ ...intg, apiUrl });
  // O rate limiter e alguns conectores leem o provedor de dentro do extra.
  config.extra = { ...config.extra, providerId: String(intg.providerId) };
  return config;
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
    /* Sinais de CONTRATO. Ficavam de fora e morriam aqui: o conector podia
       preencher, mas nada chegava do outro lado. Sem eles o anti-fraude nao
       distingue cliente ativo de ex-cliente, e `statusContrato` chegava
       "unknown" no motor de score. */
    status: c.contractStatus || c.status || undefined,
    contractStartDate: c.contractStartDate || undefined,
    registrationDate: c.contractStartDate || c.registrationDate || undefined,
    serviceAgeMonths: c.serviceAgeMonths || undefined,
    planName: c.contractPlan || c.planName || undefined,
    hasUnreturnedEquipment: typeof c.hasUnreturnedEquipment === "boolean"
      ? c.hasUnreturnedEquipment
      : undefined,
    unreturnedEquipmentCount: Number.isFinite(Number(c.unreturnedEquipmentCount))
      ? Number(c.unreturnedEquipmentCount)
      : undefined,
    equipmentCategories: Array.isArray(c.equipmentDetails)
      ? Array.from(new Set(c.equipmentDetails.map((item: any) => item.type).filter(Boolean))) as string[]
      : undefined,
    equipmentPendingValue: Array.isArray(c.equipmentDetails)
      ? c.equipmentDetails.reduce((total: number, item: any) => total + Number(item.value || 0), 0)
      : undefined,
  };
}

/**
 * Query multiple ERPs in parallel for a document (CPF/CNPJ/CEP).
 * Each ERP has its own timeout. Failed ERPs don't block others.
 */
export interface EnderecoConsulta {
  logradouro: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
}

/**
 * Consulta os ERPs da regiao por ENDERECO — o cruzamento da consulta.
 *
 * O insumo vem do proprio resultado do CPF/CNPJ: achou o titular, tem o
 * endereco dele, e a pergunta seguinte e "quem mais neste imovel tem
 * pendencia". O operador nao digita nada.
 *
 * Substitui a busca por CEP, que era a unica forma e deixava de fora 39% da
 * carteira da NsLink (medido em 27/08/2026) por falta de CEP de 8 digitos.
 * Conector que ainda nao implementa `fetchCustomersByAddress` cai no CEP quando
 * ha um; sem CEP, ele fica de fora daquele cruzamento — e aparece no `error`,
 * em vez de sumir.
 */
export async function queryRegionalErpsByAddress(
  integrations: Array<ErpIntegration & { providerName: string }>,
  endereco: EnderecoConsulta,
): Promise<RealtimeQueryResult[]> {
  if (integrations.length === 0) return [];

  logger.info(
    { count: integrations.length, cidade: endereco.cidade, temCep: !!endereco.cep },
    "RT-QUERY cruzando endereco nos ERPs",
  );

  const um = async (intg: ErpIntegration & { providerName: string }): Promise<RealtimeQueryResult> => {
    const start = Date.now();
    const base = {
      providerId: intg.providerId,
      providerName: intg.providerName,
      erpSource: intg.erpSource,
    };
    try {
      const config = buildErpConfig(intg);
      const connector = getConnector(intg.erpSource);
      if (!connector) {
        return { ...base, ok: false, error: `Conector ${intg.erpSource} nao disponivel`, customers: [], latencyMs: Date.now() - start };
      }

      const comTimeout = <T>(p: Promise<T>) => Promise.race([
        p,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Timeout")), ERP_QUERY_TIMEOUT_MS)),
      ]);

      let resultado: ErpFetchResult;
      if (typeof connector.fetchCustomersByAddress === "function") {
        resultado = await comTimeout(connector.fetchCustomersByAddress(config, endereco));
      } else if (endereco.cep && typeof connector.fetchCustomersByCep === "function") {
        resultado = await comTimeout(connector.fetchCustomersByCep(config, endereco.cep));
      } else {
        return {
          ...base, ok: false,
          error: `${intg.erpSource} nao busca por endereco e o cadastro nao tem CEP`,
          customers: [], latencyMs: Date.now() - start,
        };
      }

      if (!resultado.ok) {
        return { ...base, ok: false, error: resultado.message, customers: [], latencyMs: Date.now() - start };
      }
      return { ...base, ok: true, customers: resultado.customers.map(normalizeCustomer), latencyMs: Date.now() - start };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      const isTimeout = msg === "Timeout" || msg.includes("timeout");
      logger.warn({ providerId: intg.providerId, erpSource: intg.erpSource, error: msg }, "RT-QUERY endereco falhou");
      return { ...base, ok: false, error: isTimeout ? `Timeout (${ERP_QUERY_TIMEOUT_MS / 1000}s)` : msg, timedOut: isTimeout, customers: [], latencyMs: Date.now() - start };
    }
  };

  const results = await Promise.allSettled(integrations.map(um));
  return results.map((r, i) => r.status === "fulfilled" ? r.value : {
    providerId: integrations[i].providerId,
    providerName: integrations[i].providerName,
    erpSource: integrations[i].erpSource,
    ok: false,
    error: (r.reason as any)?.message || "Promise rejected",
    customers: [],
    latencyMs: 0,
  });
}

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
