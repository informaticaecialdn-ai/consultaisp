/**
 * ERP Connector — Hubsoft
 *
 * Auth: OAuth2 (client_id, client_secret, username, password) -> Bearer Token
 * Token is cached with TTL and auto-refreshed on expiry.
 * On 401, token is invalidated and a single retry is attempted.
 *
 * Docs: https://docs.hubsoft.com.br/
 * GitHub: https://github.com/hubsoftbrasil/api
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

/** Cached token entry */
interface TokenEntry {
  token: string;
  expiresAt: number;
}

/** Safety buffer before token expiry — 60 seconds */
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

/** Default timeout for API calls */
const API_TIMEOUT_MS = 8_000;

class HubsoftConnector implements ErpConnector {
  readonly name = "hubsoft";
  readonly label = "Hubsoft";

  readonly configFields: ErpConfigField[] = [
    { key: "apiUrl", label: "URL da API", type: "url", required: true, placeholder: "https://seudominio.hubsoft.com.br/api" },
    { key: "apiUser", label: "Username", type: "text", required: true },
    { key: "apiToken", label: "Password", type: "password", required: true },
    { key: "extra.clientId", label: "Client ID", type: "text", required: true },
    { key: "extra.clientSecret", label: "Client Secret", type: "password", required: true },
  ];

  private tokenCache = new Map<string, TokenEntry>();
  private circuit = new CircuitBreaker({ maxFailures: 5, resetTimeMs: 30_000 });

  /**
   * Get a valid OAuth2 access token, using cache when possible.
   * Token fetch failures propagate immediately (not retried).
   */
  private async getAccessToken(config: ErpConnectionConfig): Promise<string> {
    const cacheKey = config.apiUrl;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
      return cached.token;
    }

    // Try JSON format first, fall back to form-urlencoded
    let response = await this.requestToken(config, "json");

    if (!response.ok) {
      // Some Hubsoft instances require form-urlencoded
      response = await this.requestToken(config, "form");
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Hubsoft OAuth falhou (${response.status}): ${errorText}`);
    }

    const data = await response.json() as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
    };

    if (!data.access_token) {
      throw new Error("Hubsoft OAuth: resposta sem access_token");
    }

    const expiresIn = data.expires_in ?? 3600; // default 1 hour
    const entry: TokenEntry = {
      token: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    this.tokenCache.set(cacheKey, entry);
    return entry.token;
  }

  /** Send OAuth2 token request in the specified format */
  private async requestToken(
    config: ErpConnectionConfig,
    format: "json" | "form",
  ): Promise<Response> {
    const url = `${config.apiUrl.replace(/\/+$/, "")}/oauth/token`;
    const params = {
      grant_type: "password",
      client_id: config.extra.clientId ?? "",
      client_secret: config.extra.clientSecret ?? "",
      username: config.apiUser ?? "",
      password: config.apiToken,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      if (format === "json") {
        return await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          signal: controller.signal,
        });
      } else {
        const body = new URLSearchParams(params);
        return await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          signal: controller.signal,
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Invalidate cached token for a given API URL */
  private clearToken(apiUrl: string): void {
    this.tokenCache.delete(apiUrl);
  }

  /**
   * Make an authenticated API request with automatic 401 retry.
   * On 401, the token is cleared and one retry is attempted.
   */
  private async authenticatedRequest(
    config: ErpConnectionConfig,
    path: string,
    options?: { method?: string; body?: unknown },
  ): Promise<unknown> {
    const baseUrl = config.apiUrl.replace(/\/+$/, "");
    const url = `${baseUrl}${path}`;
    const method = options?.method ?? "GET";

    const makeRequest = async (retryOnAuth: boolean): Promise<unknown> => {
      const token = await this.getAccessToken(config);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      try {
        const fetchOptions: RequestInit = {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          signal: controller.signal,
        };

        if (options?.body) {
          fetchOptions.body = JSON.stringify(options.body);
        }

        const response = await fetch(url, fetchOptions);

        if (response.status === 401 && retryOnAuth) {
          this.clearToken(config.apiUrl);
          return makeRequest(false);
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          const err = new Error(`Hubsoft API ${response.status}: ${errorText}`);
          (err as any).status = response.status;
          throw err;
        }

        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    };

    return makeRequest(true);
  }

  async testConnection(config: ErpConnectionConfig): Promise<ErpTestResult> {
    const start = Date.now();
    try {
      await this.getAccessToken(config);
      return {
        ok: true,
        message: "Conexao com Hubsoft estabelecida via OAuth2",
        latencyMs: Date.now() - start,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      return {
        ok: false,
        message: `Falha na conexao com Hubsoft: ${msg}`,
        latencyMs: Date.now() - start,
      };
    }
  }

  async fetchDelinquents(config: ErpConnectionConfig, _lastDays?: number): Promise<ErpFetchResult> {
    try {
      const data = await withResilience(
        () => this.authenticatedRequest(config, "/financeiro/inadimplentes"),
        { retries: 2, minTimeout: 1000, circuit: this.circuit },
      );

      const records = extractArray(data);
      const invoices = records.map((rec: any) => ({
        cpfCnpj: cleanCpfCnpj(String(rec.cpf_cnpj ?? rec.documento ?? "")),
        name: String(rec.nome ?? rec.razao_social ?? rec.cliente ?? ""),
        email: rec.email ? String(rec.email) : undefined,
        phone: rec.telefone ? cleanPhone(String(rec.telefone)) : undefined,
        address: rec.endereco ? String(rec.endereco) : undefined,
        city: rec.cidade ? String(rec.cidade) : undefined,
        state: rec.uf ?? rec.estado ? String(rec.uf ?? rec.estado) : undefined,
        cep: rec.cep ? cleanCep(String(rec.cep)) : undefined,
        amount: parseFloat(rec.valor ?? rec.valor_total ?? rec.valor_aberto ?? "0") || 0,
        daysOverdue: calculateDaysOverdue(rec.data_vencimento ?? rec.vencimento ?? null),
        erpSource: "hubsoft" as const,
      }));

      const customers = aggregateByCustomer(invoices);

      return {
        ok: true,
        message: `${customers.length} inadimplentes obtidos do Hubsoft`,
        customers,
        totalRecords: customers.length,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      return { ok: false, message: `Hubsoft inadimplentes: ${msg}`, customers: [] };
    }
  }

  async fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    try {
      const data = await withResilience(
        () => this.authenticatedRequest(config, "/clientes"),
        { retries: 2, minTimeout: 1000, circuit: this.circuit },
      );

      const records = extractArray(data);
      const customers: NormalizedErpCustomer[] = records.map((rec: any) => ({
        cpfCnpj: cleanCpfCnpj(String(rec.cpf_cnpj ?? rec.documento ?? "")),
        name: String(rec.nome ?? rec.razao_social ?? ""),
        email: rec.email ? String(rec.email) : undefined,
        phone: rec.telefone ? cleanPhone(String(rec.telefone)) : undefined,
        address: rec.endereco ? String(rec.endereco) : undefined,
        city: rec.cidade ? String(rec.cidade) : undefined,
        state: rec.uf ?? rec.estado ? String(rec.uf ?? rec.estado) : undefined,
        cep: rec.cep ? cleanCep(String(rec.cep)) : undefined,
        totalOverdueAmount: 0,
        maxDaysOverdue: 0,
        erpSource: "hubsoft",
      }));

      return {
        ok: true,
        message: `${customers.length} clientes obtidos do Hubsoft`,
        customers,
        totalRecords: customers.length,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      return { ok: false, message: `Hubsoft clientes: ${msg}`, customers: [] };
    }
  }
}

/**
 * Extract array from various response shapes.
 * Hubsoft may return { data: [...] }, { registros: [...] }, or plain [...]
 */
function extractArray(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.registros)) return obj.registros;
    if (Array.isArray(obj.results)) return obj.results;
    if (Array.isArray(obj.items)) return obj.items;
  }
  return [];
}

// Register connector on import
const hubsoftConnector = new HubsoftConnector();
registerConnector(hubsoftConnector);

export { HubsoftConnector };
export default hubsoftConnector;
