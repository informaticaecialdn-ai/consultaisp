/**
 * ERP Connector — Voalle
 *
 * Auth: Integration User (Usuario tipo "Integracao") with Bearer token.
 * The integration user is created in Voalle's admin panel with API access.
 *
 * NOTE: Voalle documentation is limited. Endpoint paths are best-effort
 * guesses based on available Postman collection and wiki references.
 * If endpoints return errors, providers should report the issue.
 *
 * Docs: https://wiki.grupovoalle.com.br/APIs
 * Postman: https://documenter.getpostman.com/view/16282829/TzzBqFw1
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

/** Data fetch timeout (larger datasets) */
const FETCH_TIMEOUT_MS = 30_000;

class VoalleConnector implements ErpConnector {
  readonly name = "voalle";
  readonly label = "Voalle";

  readonly configFields: ErpConfigField[] = [
    { key: "apiUrl", label: "URL da API", type: "url", required: true, placeholder: "https://seudominio.voalle.com.br" },
    { key: "apiUser", label: "Usuario Integracao", type: "text", required: true },
    { key: "apiToken", label: "Token/Senha", type: "password", required: true },
  ];

  private circuit = new CircuitBreaker({ maxFailures: 5, resetTimeMs: 30_000 });

  /**
   * Get auth headers. Voalle may use:
   * 1. Direct Bearer token (apiToken is the token itself)
   * 2. Session-based auth (POST /auth with credentials first)
   * We try Bearer first; if that fails, attempt session auth.
   */
  private async getAuthHeaders(config: ErpConnectionConfig): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /**
   * Attempt session-based auth if direct Bearer fails.
   * LOW CONFIDENCE: endpoint path may differ per Voalle version.
   */
  private async attemptSessionAuth(config: ErpConnectionConfig): Promise<string | null> {
    const baseUrl = config.apiUrl.replace(/\/+$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch(`${baseUrl}/api/v1/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: config.apiUser,
          password: config.apiToken,
        }),
        signal: controller.signal,
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { token?: string; access_token?: string };
      return data.token ?? data.access_token ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Make an authenticated request. Tries Bearer token first,
   * falls back to session auth on 401.
   */
  private async authenticatedRequest(
    config: ErpConnectionConfig,
    path: string,
    timeoutMs = FETCH_TIMEOUT_MS,
  ): Promise<unknown> {
    const baseUrl = config.apiUrl.replace(/\/+$/, "");
    const url = `${baseUrl}${path}`;

    const doRequest = async (headers: Record<string, string>): Promise<Response> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    // First attempt with direct Bearer
    let headers = await this.getAuthHeaders(config);
    let response = await doRequest(headers);

    // On 401, try session-based auth
    if (response.status === 401) {
      const sessionToken = await this.attemptSessionAuth(config);
      if (sessionToken) {
        headers = {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        };
        response = await doRequest(headers);
      }
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const err = new Error(`Voalle API ${response.status}: ${errorText}`);
      (err as any).status = response.status;
      throw err;
    }

    return await response.json();
  }

  async testConnection(config: ErpConnectionConfig): Promise<ErpTestResult> {
    const start = Date.now();
    try {
      // LOW CONFIDENCE: endpoint path may vary
      await this.authenticatedRequest(config, "/api/v1/clientes?limit=1", API_TIMEOUT_MS);
      return {
        ok: true,
        message: "Conexao com Voalle estabelecida",
        latencyMs: Date.now() - start,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      return {
        ok: false,
        message: `Falha na conexao com Voalle: ${msg}`,
        latencyMs: Date.now() - start,
      };
    }
  }

  async fetchDelinquents(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    try {
      // LOW CONFIDENCE: Voalle may use different endpoint paths
      // Try primary endpoint first, fall back to titulos query
      let data: unknown;
      try {
        data = await withResilience(
          () => this.authenticatedRequest(config, "/api/v1/financeiro/inadimplentes?limit=1000"),
          { retries: 2, minTimeout: 1000, circuit: this.circuit },
        );
      } catch {
        // Fallback: query overdue titles
        data = await withResilience(
          () => this.authenticatedRequest(config, "/api/v1/titulos?status=vencido&limit=1000"),
          { retries: 2, minTimeout: 1000, circuit: this.circuit },
        );
      }

      const records = extractArray(data);
      if (records.length === 0 && data && typeof data === "object") {
        return {
          ok: false,
          message: "Voalle: formato de resposta inesperado. Verifique os endpoints da API.",
          customers: [],
        };
      }

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
        erpSource: "voalle" as const,
      }));

      const customers = aggregateByCustomer(invoices);

      return {
        ok: true,
        message: `${customers.length} inadimplentes obtidos do Voalle`,
        customers,
        totalRecords: customers.length,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      return { ok: false, message: `Voalle inadimplentes: ${msg}`, customers: [] };
    }
  }

  async fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    try {
      // LOW CONFIDENCE: endpoint path may vary
      const data = await withResilience(
        () => this.authenticatedRequest(config, "/api/v1/clientes?limit=1000"),
        { retries: 2, minTimeout: 1000, circuit: this.circuit },
      );

      const records = extractArray(data);
      if (records.length === 0 && data && typeof data === "object") {
        return {
          ok: false,
          message: "Voalle: formato de resposta inesperado para clientes.",
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
        erpSource: "voalle",
      }));

      return {
        ok: true,
        message: `${customers.length} clientes obtidos do Voalle`,
        customers,
        totalRecords: customers.length,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      return { ok: false, message: `Voalle clientes: ${msg}`, customers: [] };
    }
  }
}

/**
 * Extract array from various response shapes.
 */
function extractArray(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.registros)) return obj.registros;
    if (Array.isArray(obj.results)) return obj.results;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.rows)) return obj.rows;
  }
  return [];
}

// Register connector on import
const voalleConnector = new VoalleConnector();
registerConnector(voalleConnector);

export { VoalleConnector };
export default voalleConnector;
