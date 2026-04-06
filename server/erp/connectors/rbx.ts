/**
 * ERP Connector — RBX ISP (RBXSoft / RouterBox)
 *
 * Auth: ChaveIntegracao sent in POST body (not headers).
 * Every API call is a POST to a single endpoint URL with different modulo/acao.
 * Filters use SQL-like WHERE clauses.
 *
 * Base URL: https://[dominio]/routerbox/ws/rbx_server_json.php
 * Config: Empresa -> Parametros -> Web Services
 * Docs: https://www.developers.rbxsoft.com/
 */

import type {
  ErpConnector,
  ErpConfigField,
  ErpConnectionConfig,
  ErpTestResult,
  ErpFetchResult,
  NormalizedErpCustomer,
} from "../types.js";
import { CircuitBreaker, withResilience } from "../resilience.js";
import {
  cleanCpfCnpj,
  cleanCep,
  cleanPhone,
  calculateDaysOverdue,
  aggregateByCustomer,
} from "../normalize.js";
import { registerConnector } from "../registry.js";

/** Default timeout for API calls */
const API_TIMEOUT_MS = 8_000;

/** Data fetch timeout */
const FETCH_TIMEOUT_MS = 30_000;

/** RBX request body structure */
interface RbxRequestBody {
  chave_integracao: string;
  modulo: string;
  acao: string;
  filtros?: {
    condicao?: string;
    limit?: number;
    [key: string]: unknown;
  };
}

class RbxConnector implements ErpConnector {
  readonly name = "rbx";
  readonly label = "RBX ISP";

  readonly configFields: ErpConfigField[] = [
    {
      key: "apiUrl",
      label: "URL da API",
      type: "url",
      required: true,
      placeholder: "https://seudominio.com.br/routerbox/ws/rbx_server_json.php",
    },
    { key: "apiToken", label: "Chave de Integracao", type: "password", required: true },
  ];

  private circuit = new CircuitBreaker({ maxFailures: 5, resetTimeMs: 30_000 });

  /**
   * Send a POST request to the RBX single-endpoint API.
   * All requests go to the same URL; modulo + acao differentiate operations.
   */
  private async rbxRequest(
    config: ErpConnectionConfig,
    body: RbxRequestBody,
    timeoutMs = FETCH_TIMEOUT_MS,
  ): Promise<unknown> {
    const url = config.apiUrl.replace(/\/+$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const err = new Error(`RBX API ${response.status}: ${errorText}`);
        (err as any).status = response.status;
        throw err;
      }

      const data = await response.json();

      // RBX may return error in the response body
      if (data && typeof data === "object" && (data as any).erro) {
        throw new Error(`RBX erro: ${(data as any).erro}`);
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection(config: ErpConnectionConfig): Promise<ErpTestResult> {
    const start = Date.now();
    try {
      await this.rbxRequest(
        config,
        {
          chave_integracao: config.apiToken,
          modulo: "Clientes",
          acao: "listar",
          filtros: { limit: 1 },
        },
        API_TIMEOUT_MS,
      );

      return {
        ok: true,
        message: "Conexao com RBX ISP estabelecida",
        latencyMs: Date.now() - start,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      return {
        ok: false,
        message: `Falha na conexao com RBX: ${msg}`,
        latencyMs: Date.now() - start,
      };
    }
  }

  async fetchDelinquents(config: ErpConnectionConfig, _lastDays?: number): Promise<ErpFetchResult> {
    try {
      const data = await withResilience(
        () =>
          this.rbxRequest(config, {
            chave_integracao: config.apiToken,
            modulo: "Financeiro",
            acao: "listar_inadimplentes",
            filtros: {
              condicao: "status = 'vencido'",
            },
          }),
        { retries: 2, minTimeout: 1000, circuit: this.circuit },
      );

      const records = extractArray(data);
      if (records.length === 0 && data && typeof data === "object") {
        // May need a different acao — try "pendencias_financeiras"
        try {
          const fallbackData = await withResilience(
            () =>
              this.rbxRequest(config, {
                chave_integracao: config.apiToken,
                modulo: "Financeiro",
                acao: "pendencias_financeiras",
              }),
            { retries: 1, minTimeout: 1000, circuit: this.circuit },
          );
          const fallbackRecords = extractArray(fallbackData);
          if (fallbackRecords.length > 0) {
            return this.normalizeDelinquents(fallbackRecords);
          }
        } catch {
          // Fallback also failed, return empty with message
        }

        return {
          ok: false,
          message: "RBX: formato de resposta inesperado. Verifique a configuracao do Web Service.",
          customers: [],
        };
      }

      return this.normalizeDelinquents(records);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      return { ok: false, message: `RBX inadimplentes: ${msg}`, customers: [] };
    }
  }

  private normalizeDelinquents(records: any[]): ErpFetchResult {
    const invoices = records.map((rec: any) => ({
      cpfCnpj: cleanCpfCnpj(String(rec.cpf_cnpj ?? rec.documento ?? rec.cpf ?? "")),
      name: String(rec.nome ?? rec.razao_social ?? rec.cliente ?? ""),
      email: rec.email ? String(rec.email) : undefined,
      phone: rec.telefone ? cleanPhone(String(rec.telefone)) : (rec.celular ? cleanPhone(String(rec.celular)) : undefined),
      address: rec.endereco ? String(rec.endereco) : undefined,
      city: rec.cidade ? String(rec.cidade) : undefined,
      state: rec.uf ?? rec.estado ? String(rec.uf ?? rec.estado) : undefined,
      cep: rec.cep ? cleanCep(String(rec.cep)) : undefined,
      amount: parseFloat(rec.valor ?? rec.valor_total ?? rec.valor_aberto ?? "0") || 0,
      daysOverdue: calculateDaysOverdue(rec.data_vencimento ?? rec.vencimento ?? null),
      erpSource: "rbx" as const,
    }));

    const customers = aggregateByCustomer(invoices);

    return {
      ok: true,
      message: `${customers.length} inadimplentes obtidos do RBX`,
      customers,
      totalRecords: customers.length,
    };
  }

  async fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    try {
      const data = await withResilience(
        () =>
          this.rbxRequest(config, {
            chave_integracao: config.apiToken,
            modulo: "Clientes",
            acao: "listar",
          }),
        { retries: 2, minTimeout: 1000, circuit: this.circuit },
      );

      const records = extractArray(data);
      if (records.length === 0 && data && typeof data === "object") {
        return {
          ok: false,
          message: "RBX: formato de resposta inesperado para clientes.",
          customers: [],
        };
      }

      const customers: NormalizedErpCustomer[] = records.map((rec: any) => ({
        cpfCnpj: cleanCpfCnpj(String(rec.cpf_cnpj ?? rec.documento ?? rec.cpf ?? "")),
        name: String(rec.nome ?? rec.razao_social ?? ""),
        email: rec.email ? String(rec.email) : undefined,
        phone: rec.telefone ? cleanPhone(String(rec.telefone)) : (rec.celular ? cleanPhone(String(rec.celular)) : undefined),
        address: rec.endereco ? String(rec.endereco) : undefined,
        city: rec.cidade ? String(rec.cidade) : undefined,
        state: rec.uf ?? rec.estado ? String(rec.uf ?? rec.estado) : undefined,
        cep: rec.cep ? cleanCep(String(rec.cep)) : undefined,
        totalOverdueAmount: 0,
        maxDaysOverdue: 0,
        erpSource: "rbx",
      }));

      return {
        ok: true,
        message: `${customers.length} clientes obtidos do RBX`,
        customers,
        totalRecords: customers.length,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      return { ok: false, message: `RBX clientes: ${msg}`, customers: [] };
    }
  }
}

/**
 * Extract array from various response shapes.
 * RBX may return { dados: [...] }, { registros: [...] }, or plain [...]
 */
function extractArray(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.dados)) return obj.dados;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.registros)) return obj.registros;
    if (Array.isArray(obj.results)) return obj.results;
  }
  return [];
}

// Register connector on import
const rbxConnector = new RbxConnector();
registerConnector(rbxConnector);

export { RbxConnector };
export default rbxConnector;
