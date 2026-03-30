/**
 * IXC Soft (IXCSoft/IXC Provedor) — ERP Connector
 *
 * Authentication: Basic Auth (Base64 user:token)
 * Method: POST with header ixcsoft: "listar"
 * Endpoints: /webservice/v1/fn_areceber (invoices), /webservice/v1/cliente (customers)
 * Pagination: page + rp (records per page)
 * Response: { registros: [...], total: N }
 *
 * @see https://wikiapiprovedor.ixcsoft.com.br/
 */

import type {
  ErpConnector,
  ErpConfigField,
  ErpConnectionConfig,
  ErpTestResult,
  ErpFetchResult,
} from "../types.js";
import { CircuitBreaker, withResilience } from "../resilience.js";
import { cleanCpfCnpj, cleanCep, cleanPhone, calculateDaysOverdue, aggregateByCustomer } from "../normalize.js";

export class IxcConnector implements ErpConnector {
  readonly name = "ixc";
  readonly label = "IXC Soft";

  readonly configFields: ErpConfigField[] = [
    { key: "apiUser", label: "Usuario API", type: "text", required: true },
    { key: "apiToken", label: "Token API", type: "password", required: true },
  ];

  private readonly circuit = new CircuitBreaker();

  /** Build standard IXC headers (Basic Auth + ixcsoft listar) */
  private buildHeaders(config: ErpConnectionConfig): Record<string, string> {
    const auth = Buffer.from(`${config.apiUser ?? ""}:${config.apiToken}`).toString("base64");
    return {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      ixcsoft: "listar",
    };
  }

  /** Normalize the API URL base — strip trailing slashes */
  private baseUrl(config: ErpConnectionConfig): string {
    return config.apiUrl.replace(/\/+$/, "");
  }

  async testConnection(config: ErpConnectionConfig): Promise<ErpTestResult> {
    const base = this.baseUrl(config);
    const headers = this.buildHeaders(config);
    const start = Date.now();

    try {
      const response = await withResilience(
        () =>
          fetch(`${base}/webservice/v1/fn_areceber`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              qtype: "fn_areceber.id",
              query: "1",
              oper: "=",
              page: "1",
              rp: "1",
              sortname: "fn_areceber.id",
              sortorder: "asc",
            }),
            signal: AbortSignal.timeout(8000),
          }),
        { retries: 1, minTimeout: 500, circuit: this.circuit },
      );

      const latencyMs = Date.now() - start;

      if (response.ok || response.status === 200) {
        return { ok: true, message: "Conexao com IXC Soft estabelecida com sucesso", latencyMs };
      }

      return { ok: false, message: `IXC respondeu com status ${response.status}`, latencyMs };
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      if (err instanceof Error && err.name === "TimeoutError") {
        return { ok: false, message: "Timeout: IXC nao respondeu em 8 segundos", latencyMs };
      }
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro de conexao: ${msg}`, latencyMs };
    }
  }

  async fetchDelinquents(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    const base = this.baseUrl(config);
    const headers = this.buildHeaders(config);

    try {
      const allRows: any[] = [];
      let page = 1;
      let totalRecords = 0;

      // Paginate through fn_areceber with status "A" (aberto)
      do {
        const response = await withResilience(
          () =>
            fetch(`${base}/webservice/v1/fn_areceber`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                qtype: "fn_areceber.status",
                query: "A",
                oper: "=",
                page: String(page),
                rp: "1000",
                sortname: "fn_areceber.id",
                sortorder: "asc",
              }),
              signal: AbortSignal.timeout(30000),
            }),
          { retries: 3, minTimeout: 1000, circuit: this.circuit },
        );

        if (!response.ok) {
          return {
            ok: false,
            message: `IXC respondeu com status ${response.status}`,
            customers: [],
            totalRecords: 0,
          };
        }

        const json: any = await response.json();
        const rows: any[] = json?.registros || json?.records || [];
        totalRecords = parseInt(json?.total, 10) || 0;
        allRows.push(...rows);

        page++;
      } while (allRows.length < totalRecords && page <= 50); // Safety limit: 50 pages

      // Filter only overdue rows and map to invoice format for aggregation
      const now = new Date();
      const invoices = allRows
        .filter((row: any) => {
          const dueDate = row.vencimento || row.data_vencimento;
          return dueDate && new Date(dueDate) < now;
        })
        .map((row: any) => {
          const cpfCnpj = cleanCpfCnpj(row.cpf_cnpj || row.cnpj_cpf || "");
          const dueDate = row.vencimento || row.data_vencimento || null;

          return {
            cpfCnpj,
            name: row.razao || row.nome || "",
            email: row.email || undefined,
            phone: row.fone_celular || row.telefone ? cleanPhone(row.fone_celular || row.telefone) : undefined,
            address: row.endereco || row.logradouro || undefined,
            city: row.cidade || undefined,
            state: row.uf || undefined,
            cep: row.cep ? cleanCep(row.cep) : undefined,
            amount: parseFloat(row.valor || row.valor_original || "0") || 0,
            daysOverdue: calculateDaysOverdue(dueDate),
            erpSource: "ixc" as const,
          };
        })
        .filter((inv) => inv.cpfCnpj.length > 0);

      // Aggregate invoice rows by customer (same CPF/CNPJ)
      const customers = aggregateByCustomer(invoices);

      return {
        ok: true,
        message: `${customers.length} inadimplentes encontrados (${allRows.length} registros processados)`,
        customers,
        totalRecords: customers.length,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "TimeoutError") {
        return { ok: false, message: "Timeout: IXC nao respondeu em 30 segundos", customers: [] };
      }
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro de conexao: ${msg}`, customers: [] };
    }
  }

  async fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    const base = this.baseUrl(config);
    const headers = this.buildHeaders(config);

    try {
      const allRows: any[] = [];
      let page = 1;
      let totalRecords = 0;

      do {
        const response = await withResilience(
          () =>
            fetch(`${base}/webservice/v1/cliente`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                qtype: "cliente.id",
                query: "",
                oper: ">",
                page: String(page),
                rp: "1000",
                sortname: "cliente.id",
                sortorder: "asc",
              }),
              signal: AbortSignal.timeout(30000),
            }),
          { retries: 3, minTimeout: 1000, circuit: this.circuit },
        );

        if (!response.ok) {
          return {
            ok: false,
            message: `IXC respondeu com status ${response.status}`,
            customers: [],
            totalRecords: 0,
          };
        }

        const json: any = await response.json();
        const rows: any[] = json?.registros || json?.records || [];
        totalRecords = parseInt(json?.total, 10) || 0;
        allRows.push(...rows);

        page++;
      } while (allRows.length < totalRecords && page <= 50);

      const customers = allRows
        .map((row: any) => {
          const cpfCnpj = cleanCpfCnpj(row.cpf_cnpj || row.cnpj_cpf || "");
          if (!cpfCnpj) return null;

          return {
            cpfCnpj,
            name: row.razao || row.nome || "",
            email: row.email || undefined,
            phone: row.fone_celular || row.telefone ? cleanPhone(row.fone_celular || row.telefone) : undefined,
            address: row.endereco || row.logradouro || undefined,
            city: row.cidade || undefined,
            state: row.uf || undefined,
            cep: row.cep ? cleanCep(row.cep) : undefined,
            totalOverdueAmount: 0,
            maxDaysOverdue: 0,
            erpSource: "ixc" as const,
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
        return { ok: false, message: "Timeout: IXC nao respondeu em 30 segundos", customers: [] };
      }
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro de conexao: ${msg}`, customers: [] };
    }
  }
}
