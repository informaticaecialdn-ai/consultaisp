/**
 * Voalle ERP — ERP Connector
 *
 * Authentication: OAuth 2.0 Resource Owner Password Credentials
 *   POST {base}/connect/token
 *   Body: grant_type=password&client_id={voalleClientId}&username={apiUser}&password={apiToken}&scope=er
 *   Response: { access_token: "...", expires_in: 3600 }
 *
 * Endpoints:
 *   - GET /api/financeiro/titulos?situacao=vencido&pagina=1&por_pagina=2000
 *
 * @see https://wiki.grupovoalle.com.br/APIs
 * @see https://documenter.getpostman.com/view/16282829/TzzBqFw1
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
import { cleanCpfCnpj, cleanPhone, calculateDaysOverdue, aggregateByCustomer } from "../normalize.js";

// Token cache
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export class VoalleConnector implements ErpConnector {
  readonly name = "voalle";
  readonly label = "Voalle";

  readonly configFields: ErpConfigField[] = [
    { key: "apiUser", label: "Usuario de Integracao", type: "text", required: true },
    { key: "apiToken", label: "Senha", type: "password", required: true },
    { key: "extra.voalleClientId", label: "Client ID (opcional)", type: "text", required: false, placeholder: "tger" },
  ];

  private circuitMap = new Map<string, CircuitBreaker>();

  private getCircuit(providerId: string): CircuitBreaker {
    let circuit = this.circuitMap.get(providerId);
    if (!circuit) {
      circuit = new CircuitBreaker();
      this.circuitMap.set(providerId, circuit);
    }
    return circuit;
  }

  private baseUrl(config: ErpConnectionConfig): string {
    return config.apiUrl.replace(/\/+$/, "");
  }

  /** Authenticate via /connect/token */
  private async authenticate(config: ErpConnectionConfig): Promise<string> {
    const base = this.baseUrl(config);
    const cacheKey = base;

    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const clientId = config.extra?.voalleClientId || "tger";
    const body = `grant_type=password&client_id=${encodeURIComponent(clientId)}&username=${encodeURIComponent(config.apiUser || "")}&password=${encodeURIComponent(config.apiToken)}&scope=er`;

    const response = await withResilience(
      () => fetch(`${base}/connect/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(10000),
      }),
      { retries: 2, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
    );

    if (!response.ok) {
      throw new Error(`Autenticacao Voalle falhou: status ${response.status}`);
    }

    const json: any = await response.json();
    const accessToken = json?.access_token;
    const expiresIn = parseInt(json?.expires_in || "3600", 10);

    if (!accessToken) {
      throw new Error("Voalle nao retornou access_token");
    }

    tokenCache.set(cacheKey, { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 });
    return accessToken;
  }

  async testConnection(config: ErpConnectionConfig): Promise<ErpTestResult> {
    const start = Date.now();
    try {
      const token = await this.authenticate(config);
      const base = this.baseUrl(config);

      const response = await fetch(`${base}/api/financeiro/titulos?situacao=vencido&pagina=1&por_pagina=1`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });

      const latencyMs = Date.now() - start;
      if (response.ok) return { ok: true, message: "Conexao com Voalle estabelecida com sucesso", latencyMs };
      return { ok: false, message: `Voalle respondeu com status ${response.status}`, latencyMs };
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, latencyMs };
    }
  }

  async fetchDelinquents(config: ErpConnectionConfig, _lastDays?: number): Promise<ErpFetchResult> {
    try {
      const token = await this.authenticate(config);
      const base = this.baseUrl(config);

      const response = await withResilience(
        () => fetch(`${base}/api/financeiro/titulos?situacao=vencido&pagina=1&por_pagina=2000`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30000),
        }),
        { retries: 3, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
      );

      if (!response.ok) return { ok: false, message: `Voalle respondeu com status ${response.status}`, customers: [], totalRecords: 0 };

      const json: any = await response.json();
      const rows: any[] = Array.isArray(json) ? json : json?.items || json?.data || [];

      const invoices = rows
        .map((r: any) => {
          const cpfCnpj = cleanCpfCnpj(r.cpf_cnpj || r.cpf || r.cnpj || r.documento || "");
          if (!cpfCnpj) return null;
          const dueDate = r.data_vencimento || r.vencimento || null;
          return {
            cpfCnpj,
            name: r.nome || r.razao_social || r.nome_pessoa || "",
            email: r.email || undefined,
            phone: r.fone || r.celular || r.telefone ? cleanPhone(r.fone || r.celular || r.telefone) : undefined,
            address: ((r.logradouro || r.endereco || "") + " " + (r.numero || "")).trim() || undefined,
            city: r.cidade || undefined,
            state: r.uf || r.estado || undefined,
            cep: r.cep || undefined,
            amount: parseFloat(r.valor || r.valor_total || "0") || 0,
            daysOverdue: calculateDaysOverdue(dueDate),
            erpSource: "voalle" as const,
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null && c.daysOverdue > 0);

      const customers = aggregateByCustomer(invoices);

      return { ok: true, message: `${customers.length} inadimplentes encontrados`, customers, totalRecords: customers.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  async fetchCustomerByCpf(config: ErpConnectionConfig, cpfCnpj: string): Promise<ErpFetchResult> {
    try {
      const token = await this.authenticate(config);
      const base = this.baseUrl(config);
      const cleanDoc = cpfCnpj.replace(/\D/g, "");

      const response = await withResilience(
        () => fetch(`${base}/api/financeiro/titulos?situacao=vencido&cpf_cnpj=${encodeURIComponent(cleanDoc)}&pagina=1&por_pagina=100`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15000),
        }),
        { retries: 2, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
      );

      if (!response.ok) return { ok: false, message: `Voalle respondeu com status ${response.status}`, customers: [] };

      const json: any = await response.json();
      const rows: any[] = Array.isArray(json) ? json : json?.items || json?.data || [];

      const invoices = rows
        .filter((r: any) => {
          const rowCpf = cleanCpfCnpj(r.cpf_cnpj || r.cpf || r.cnpj || r.documento || "");
          return rowCpf === cleanDoc;
        })
        .map((r: any) => {
          const dueDate = r.data_vencimento || r.vencimento || null;
          return {
            cpfCnpj: cleanDoc,
            name: r.nome || r.razao_social || r.nome_pessoa || "",
            email: r.email || undefined,
            phone: r.fone || r.celular || r.telefone ? cleanPhone(r.fone || r.celular || r.telefone) : undefined,
            address: ((r.logradouro || r.endereco || "") + " " + (r.numero || "")).trim() || undefined,
            city: r.cidade || undefined,
            state: r.uf || r.estado || undefined,
            cep: r.cep || undefined,
            amount: parseFloat(r.valor || r.valor_total || "0") || 0,
            daysOverdue: calculateDaysOverdue(dueDate),
            erpSource: "voalle" as const,
          };
        })
        .filter((c) => c.daysOverdue > 0);

      const customers = aggregateByCustomer(invoices);

      return {
        ok: true,
        message: customers.length > 0 ? `Cliente encontrado com ${invoices.length} fatura(s) vencida(s)` : "Cliente sem inadimplencia",
        customers,
        totalRecords: customers.length,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  async fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    try {
      const token = await this.authenticate(config);
      const base = this.baseUrl(config);

      const response = await withResilience(
        () => fetch(`${base}/api/clientes?pagina=1&por_pagina=2000`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30000),
        }),
        { retries: 3, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
      );

      if (!response.ok) return { ok: false, message: `Voalle respondeu com status ${response.status}`, customers: [], totalRecords: 0 };

      const json: any = await response.json();
      const rows: any[] = Array.isArray(json) ? json : json?.items || json?.data || [];
      const customers: NormalizedErpCustomer[] = rows
        .map((r: any) => {
          const cpfCnpj = cleanCpfCnpj(r.cpf_cnpj || r.cpf || r.cnpj || r.documento || "");
          if (!cpfCnpj) return null;
          return {
            cpfCnpj, name: r.nome || r.razao_social || r.nome_pessoa || "",
            email: r.email || undefined,
            phone: r.fone || r.celular ? cleanPhone(r.fone || r.celular) : undefined,
            address: ((r.logradouro || r.endereco || "") + " " + (r.numero || "")).trim() || undefined,
            city: r.cidade || undefined, state: r.uf || r.estado || undefined, cep: r.cep || undefined,
            totalOverdueAmount: 0, maxDaysOverdue: 0, erpSource: "voalle",
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
