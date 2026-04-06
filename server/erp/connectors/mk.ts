/**
 * MK Solutions (MK Auth / MK30) — ERP Connector
 *
 * Authentication: 2-step
 *   1. GET WSAutenticacao.rule?sys=MK0&token={apiToken}&password={mkContraSenha}&cd_servico=7
 *      Response: { token_acesso: "..." }
 *   2. Use token_acesso in subsequent calls
 *
 * Endpoints:
 *   - GET WSFinanceiroInadimplente.rule?sys=MK0&token_acesso={token}
 *   - GET WSClientes.rule?sys=MK0&token_acesso={token}
 *
 * @see https://mkloud.atlassian.net/wiki/spaces/MK30/pages/48699908/APIs+gerais
 * @see https://postman.mk-auth.com.br/
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

// Token cache for MK auth
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export class MkConnector implements ErpConnector {
  readonly name = "mk";
  readonly label = "MK Solutions";

  readonly configFields: ErpConfigField[] = [
    { key: "apiToken", label: "Token do Usuario MK", type: "password", required: true },
    { key: "mkContraSenha", label: "Contra-Senha Webservice", type: "password", required: true },
  ];

  private readonly circuit = new CircuitBreaker();

  private baseUrl(config: ErpConnectionConfig): string {
    return config.apiUrl.replace(/\/+$/, "");
  }

  /** Step 1: Authenticate via WSAutenticacao to get token_acesso */
  private async authenticate(config: ErpConnectionConfig): Promise<string> {
    const base = this.baseUrl(config);
    const cacheKey = `${base}::${config.apiToken}`;

    // Check cache
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const mkContraSenha = config.mkContraSenha || config.extra?.mkContraSenha || "";
    const url = `${base}/mk/WSAutenticacao.rule?sys=MK0&token=${encodeURIComponent(config.apiToken)}&password=${encodeURIComponent(mkContraSenha)}&cd_servico=7`;

    const response = await withResilience(
      () => fetch(url, { method: "GET", signal: AbortSignal.timeout(10000) }),
      { retries: 2, minTimeout: 1000, circuit: this.circuit },
    );

    if (!response.ok) {
      throw new Error(`Autenticacao MK falhou: status ${response.status}`);
    }

    const json: any = await response.json();
    const tokenAcesso = json?.token_acesso || json?.Token || json?.access_token;

    if (!tokenAcesso) {
      throw new Error("MK nao retornou token_acesso na autenticacao");
    }

    // Cache for 30 minutes
    tokenCache.set(cacheKey, { token: tokenAcesso, expiresAt: Date.now() + 30 * 60 * 1000 });
    return tokenAcesso;
  }

  async testConnection(config: ErpConnectionConfig): Promise<ErpTestResult> {
    const start = Date.now();
    try {
      const tokenAcesso = await this.authenticate(config);
      const base = this.baseUrl(config);

      const response = await withResilience(
        () => fetch(`${base}/mk/WSClientes.rule?sys=MK0&token_acesso=${encodeURIComponent(tokenAcesso)}&limit=1`, {
          method: "GET",
          signal: AbortSignal.timeout(8000),
        }),
        { retries: 1, minTimeout: 500, circuit: this.circuit },
      );

      const latencyMs = Date.now() - start;
      if (response.ok) {
        return { ok: true, message: "Conexao com MK Solutions estabelecida com sucesso", latencyMs };
      }
      return { ok: false, message: `MK respondeu com status ${response.status}`, latencyMs };
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, latencyMs };
    }
  }

  async fetchDelinquents(config: ErpConnectionConfig, _lastDays?: number): Promise<ErpFetchResult> {
    try {
      const tokenAcesso = await this.authenticate(config);
      const base = this.baseUrl(config);

      const response = await withResilience(
        () => fetch(`${base}/mk/WSFinanceiroInadimplente.rule?sys=MK0&token_acesso=${encodeURIComponent(tokenAcesso)}`, {
          method: "GET",
          signal: AbortSignal.timeout(30000),
        }),
        { retries: 3, minTimeout: 1000, circuit: this.circuit },
      );

      if (!response.ok) {
        return { ok: false, message: `MK respondeu com status ${response.status}`, customers: [], totalRecords: 0 };
      }

      const json: any = await response.json();
      const rows: any[] = Array.isArray(json) ? json : json?.registros || json?.data || [];

      const invoices = rows
        .map((r: any) => {
          const cpfCnpj = cleanCpfCnpj(r.cpf || r.cnpj || r.cpf_cnpj || "");
          if (!cpfCnpj) return null;
          const dueDate = r.dt_vencimento || r.data_vencimento || null;
          return {
            cpfCnpj,
            name: r.nome || r.razao_social || "",
            email: r.email || undefined,
            phone: r.fone || r.celular || r.telefone ? cleanPhone(r.fone || r.celular || r.telefone) : undefined,
            address: r.endereco || undefined,
            city: r.cidade || undefined,
            state: r.uf || r.estado || undefined,
            cep: r.cep || undefined,
            amount: parseFloat(r.valor || r.vl_total || "0") || 0,
            daysOverdue: calculateDaysOverdue(dueDate),
            erpSource: "mk" as const,
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null && c.daysOverdue > 0);

      const customers = aggregateByCustomer(invoices);

      return {
        ok: true,
        message: `${customers.length} inadimplentes encontrados`,
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
      const tokenAcesso = await this.authenticate(config);
      const base = this.baseUrl(config);

      const response = await withResilience(
        () => fetch(`${base}/mk/WSClientes.rule?sys=MK0&token_acesso=${encodeURIComponent(tokenAcesso)}&limit=2000`, {
          method: "GET",
          signal: AbortSignal.timeout(30000),
        }),
        { retries: 3, minTimeout: 1000, circuit: this.circuit },
      );

      if (!response.ok) {
        return { ok: false, message: `MK respondeu com status ${response.status}`, customers: [], totalRecords: 0 };
      }

      const json: any = await response.json();
      const rows: any[] = Array.isArray(json) ? json : json?.registros || json?.data || [];

      const customers: NormalizedErpCustomer[] = rows
        .map((r: any) => {
          const cpfCnpj = cleanCpfCnpj(r.cpf || r.cnpj || r.cpf_cnpj || "");
          if (!cpfCnpj) return null;
          return {
            cpfCnpj,
            name: r.nome || r.razao_social || "",
            email: r.email || undefined,
            phone: r.fone || r.celular || r.telefone ? cleanPhone(r.fone || r.celular || r.telefone) : undefined,
            address: r.endereco || undefined,
            city: r.cidade || undefined,
            state: r.uf || r.estado || undefined,
            cep: r.cep || undefined,
            totalOverdueAmount: 0,
            maxDaysOverdue: 0,
            erpSource: "mk",
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
