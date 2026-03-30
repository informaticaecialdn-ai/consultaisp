/**
 * SGP (Sistema Gerencial de Provedores) — ERP Connector
 *
 * Authentication: Bearer Token (optionally with app_name query param)
 * Method: GET/POST with Authorization: Bearer <token>
 * Endpoints: /api/clientes, /api/financeiro/inadimplentes
 *
 * @see https://bookstack.sgp.net.br/books/api
 * @see https://bookstack.sgp.net.br/books/api/page/autenticacoes-via-api
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
import { cleanCpfCnpj, cleanPhone } from "../normalize.js";

export class SgpConnector implements ErpConnector {
  readonly name = "sgp";
  readonly label = "SGP";

  readonly configFields: ErpConfigField[] = [
    { key: "apiToken", label: "Token API", type: "password", required: true },
    { key: "apiUser", label: "App Name (opcional)", type: "text", required: false },
  ];

  private readonly circuit = new CircuitBreaker();

  /** Build standard SGP headers (Bearer Token) */
  private buildHeaders(config: ErpConnectionConfig): Record<string, string> {
    return {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  /** Normalize the API URL base */
  private baseUrl(config: ErpConnectionConfig): string {
    return config.apiUrl.replace(/\/+$/, "");
  }

  /** Append app_name query parameter if configured */
  private appendAppName(url: string, config: ErpConnectionConfig): string {
    if (config.apiUser) {
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}app_name=${encodeURIComponent(config.apiUser)}`;
    }
    return url;
  }

  async testConnection(config: ErpConnectionConfig): Promise<ErpTestResult> {
    const base = this.baseUrl(config);
    const headers = this.buildHeaders(config);
    const url = this.appendAppName(`${base}/api/clientes?limit=1`, config);
    const start = Date.now();

    try {
      const response = await withResilience(
        () =>
          fetch(url, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(8000),
          }),
        { retries: 1, minTimeout: 500, circuit: this.circuit },
      );

      const latencyMs = Date.now() - start;

      if (response.ok) {
        return { ok: true, message: "Conexao com SGP estabelecida com sucesso", latencyMs };
      }

      return { ok: false, message: `SGP respondeu com status ${response.status}`, latencyMs };
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      if (err instanceof Error && err.name === "TimeoutError") {
        return { ok: false, message: "Timeout: SGP nao respondeu em 8 segundos", latencyMs };
      }
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro de conexao: ${msg}`, latencyMs };
    }
  }

  async fetchDelinquents(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    const base = this.baseUrl(config);
    const headers = this.buildHeaders(config);
    const url = this.appendAppName(`${base}/api/financeiro/inadimplentes?limit=1000`, config);

    try {
      const response = await withResilience(
        () =>
          fetch(url, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(30000),
          }),
        { retries: 3, minTimeout: 1000, circuit: this.circuit },
      );

      if (!response.ok) {
        return {
          ok: false,
          message: `SGP respondeu com status ${response.status}`,
          customers: [],
          totalRecords: 0,
        };
      }

      const json: any = await response.json();
      const rows: any[] = Array.isArray(json) ? json : json?.data || json?.clientes || json?.registros || [];

      const customers: NormalizedErpCustomer[] = rows
        .map((row: any) => {
          const cpfCnpj = cleanCpfCnpj(row.cpf_cnpj || row.cpf || row.cnpj || "");
          if (!cpfCnpj) return null;

          return {
            cpfCnpj,
            name: row.nome || row.razao_social || row.razao || "",
            email: row.email || undefined,
            phone: row.telefone || row.fone || row.celular
              ? cleanPhone(row.telefone || row.fone || row.celular)
              : undefined,
            address: row.endereco || row.logradouro || undefined,
            city: row.cidade || undefined,
            state: row.uf || row.estado || undefined,
            cep: row.cep ? row.cep.replace(/\D/g, "").padStart(8, "0") : undefined,
            totalOverdueAmount: parseFloat(row.valor_total || row.saldo_devedor || row.valor || "0") || 0,
            maxDaysOverdue: parseInt(row.dias_atraso || row.atraso_dias || "0", 10) || 0,
            overdueInvoicesCount: row.qtd_titulos ? parseInt(row.qtd_titulos, 10) : undefined,
            erpSource: "sgp",
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      return {
        ok: true,
        message: `${customers.length} inadimplentes encontrados`,
        customers,
        totalRecords: customers.length,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "TimeoutError") {
        return { ok: false, message: "Timeout: SGP nao respondeu em 30 segundos", customers: [] };
      }
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro de conexao: ${msg}`, customers: [] };
    }
  }

  async fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    const base = this.baseUrl(config);
    const headers = this.buildHeaders(config);
    const url = this.appendAppName(`${base}/api/clientes?limit=1000`, config);

    try {
      const response = await withResilience(
        () =>
          fetch(url, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(30000),
          }),
        { retries: 3, minTimeout: 1000, circuit: this.circuit },
      );

      if (!response.ok) {
        return {
          ok: false,
          message: `SGP respondeu com status ${response.status}`,
          customers: [],
          totalRecords: 0,
        };
      }

      const json: any = await response.json();
      const rows: any[] = Array.isArray(json) ? json : json?.data || json?.clientes || json?.registros || [];

      const customers: NormalizedErpCustomer[] = rows
        .map((row: any) => {
          const cpfCnpj = cleanCpfCnpj(row.cpf_cnpj || row.cpf || row.cnpj || "");
          if (!cpfCnpj) return null;

          return {
            cpfCnpj,
            name: row.nome || row.razao_social || row.razao || "",
            email: row.email || undefined,
            phone: row.telefone || row.fone || row.celular
              ? cleanPhone(row.telefone || row.fone || row.celular)
              : undefined,
            address: row.endereco || row.logradouro || undefined,
            city: row.cidade || undefined,
            state: row.uf || row.estado || undefined,
            cep: row.cep ? row.cep.replace(/\D/g, "").padStart(8, "0") : undefined,
            totalOverdueAmount: 0,
            maxDaysOverdue: 0,
            erpSource: "sgp",
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      return {
        ok: true,
        message: `${customers.length} clientes encontrados`,
        customers,
        totalRecords: customers.length,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "TimeoutError") {
        return { ok: false, message: "Timeout: SGP nao respondeu em 30 segundos", customers: [] };
      }
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro de conexao: ${msg}`, customers: [] };
    }
  }
}
