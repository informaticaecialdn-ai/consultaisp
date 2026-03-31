/**
 * SGP (Sistema Gerencial de Provedores) — ERP Connector
 *
 * Authentication: Token/App via body (x-www-form-urlencoded)
 *   Body: token={apiToken}&app={sgpApp}
 *
 * Endpoints:
 *   - POST /api/financeiro/inadimplentes?limit=2000
 *   - POST /api/contratos?status=cancelado&limit=2000 (optional)
 *
 * @see https://bookstack.sgp.net.br/books/api
 */

import type {
  ErpConnector,
  ErpConfigField,
  ErpConnectionConfig,
  ErpTestResult,
  ErpFetchResult,
} from "../types.js";
import { CircuitBreaker, withResilience } from "../resilience.js";
import { cleanCpfCnpj, cleanPhone, calculateDaysOverdue, aggregateByCustomer } from "../normalize.js";

export class SgpConnector implements ErpConnector {
  readonly name = "sgp";
  readonly label = "SGP";

  readonly configFields: ErpConfigField[] = [
    { key: "apiToken", label: "Token SGP", type: "password", required: true },
    { key: "extra.sgpApp", label: "Nome do App", type: "text", required: true, placeholder: "consultaisp" },
  ];

  private readonly circuit = new CircuitBreaker();

  private baseUrl(config: ErpConnectionConfig): string {
    return config.apiUrl.replace(/\/+$/, "");
  }

  private buildBody(config: ErpConnectionConfig): string {
    const sgpApp = config.extra?.sgpApp || "consultaisp";
    return `token=${encodeURIComponent(config.apiToken)}&app=${encodeURIComponent(sgpApp)}`;
  }

  async testConnection(config: ErpConnectionConfig): Promise<ErpTestResult> {
    const base = this.baseUrl(config);
    const start = Date.now();
    try {
      const response = await withResilience(
        () => fetch(`${base}/api/financeiro/inadimplentes?limit=1`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: this.buildBody(config),
          signal: AbortSignal.timeout(8000),
        }),
        { retries: 1, minTimeout: 500, circuit: this.circuit },
      );
      const latencyMs = Date.now() - start;
      if (response.ok) return { ok: true, message: "Conexao com SGP estabelecida com sucesso", latencyMs };
      return { ok: false, message: `SGP respondeu com status ${response.status}`, latencyMs };
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, latencyMs };
    }
  }

  async fetchDelinquents(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    const base = this.baseUrl(config);
    try {
      const response = await withResilience(
        () => fetch(`${base}/api/financeiro/inadimplentes?limit=2000`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: this.buildBody(config),
          signal: AbortSignal.timeout(30000),
        }),
        { retries: 3, minTimeout: 1000, circuit: this.circuit },
      );

      if (!response.ok) return { ok: false, message: `SGP respondeu com status ${response.status}`, customers: [], totalRecords: 0 };

      const json: any = await response.json();
      const rows: any[] = Array.isArray(json) ? json : json?.data || [];

      const invoices = rows
        .map((r: any) => {
          const cpfCnpj = cleanCpfCnpj(r.cpf_cnpj || r.cpf || r.cnpj || r.documento || "");
          if (!cpfCnpj) return null;
          const dueDate = r.data_vencimento || r.vencimento || r.dt_vencimento || null;
          return {
            cpfCnpj,
            name: r.nome || r.razao_social || r.cliente || "",
            email: r.email || undefined,
            phone: r.fone || r.celular || r.telefone ? cleanPhone(r.fone || r.celular || r.telefone) : undefined,
            address: ((r.logradouro || r.rua || "") + " " + (r.numero || "")).trim() || undefined,
            city: r.cidade || undefined,
            state: r.estado || r.uf || undefined,
            cep: r.cep || undefined,
            amount: parseFloat(r.valor || r.valor_total || r.saldo_devedor || "0") || 0,
            daysOverdue: calculateDaysOverdue(dueDate),
            erpSource: "sgp" as const,
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null && c.daysOverdue > 0);

      const customers = aggregateByCustomer(invoices);

      // Optional: cancelled contracts
      try {
        const cancelRes = await fetch(`${base}/api/contratos?status=cancelado&limit=2000`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: this.buildBody(config),
          signal: AbortSignal.timeout(15000),
        });
        if (cancelRes.ok) {
          const cancelJson: any = await cancelRes.json();
          const cancelRows: any[] = Array.isArray(cancelJson) ? cancelJson : cancelJson?.data || [];
          const existingCpfs = new Set(customers.map(c => c.cpfCnpj));
          for (const r of cancelRows) {
            const cpfCnpj = cleanCpfCnpj(r.cpf_cnpj || r.cpf || r.cnpj || r.documento || "");
            if (cpfCnpj && !existingCpfs.has(cpfCnpj)) {
              customers.push({
                cpfCnpj, name: r.nome || r.razao_social || r.cliente || "",
                totalOverdueAmount: parseFloat(r.valor || r.saldo_devedor || "0") || 0,
                maxDaysOverdue: 0, erpSource: "sgp",
              });
              existingCpfs.add(cpfCnpj);
            }
          }
        }
      } catch { /* ignore */ }

      return { ok: true, message: `${customers.length} inadimplentes encontrados`, customers, totalRecords: customers.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  async fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    const base = this.baseUrl(config);
    try {
      const response = await withResilience(
        () => fetch(`${base}/api/clientes?limit=2000`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: this.buildBody(config),
          signal: AbortSignal.timeout(30000),
        }),
        { retries: 3, minTimeout: 1000, circuit: this.circuit },
      );

      if (!response.ok) return { ok: false, message: `SGP respondeu com status ${response.status}`, customers: [], totalRecords: 0 };

      const json: any = await response.json();
      const rows: any[] = Array.isArray(json) ? json : json?.data || [];
      const customers = rows
        .map((r: any) => {
          const cpfCnpj = cleanCpfCnpj(r.cpf_cnpj || r.cpf || r.cnpj || r.documento || "");
          if (!cpfCnpj) return null;
          return {
            cpfCnpj, name: r.nome || r.razao_social || r.cliente || "",
            email: r.email || undefined,
            phone: r.fone || r.celular ? cleanPhone(r.fone || r.celular) : undefined,
            address: ((r.logradouro || r.rua || "") + " " + (r.numero || "")).trim() || undefined,
            city: r.cidade || undefined, state: r.estado || r.uf || undefined, cep: r.cep || undefined,
            totalOverdueAmount: 0, maxDaysOverdue: 0, erpSource: "sgp" as const,
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      return { ok: true, message: `${customers.length} clientes encontrados`, customers, totalRecords: customers.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }
}
