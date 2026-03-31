/**
 * server/erp-connector.ts
 *
 * Motor de integração ERP nativo — substitui o proxy N8N.
 * Suporta: IXC Soft, MK Solutions, SGP, Hubsoft, Voalle, RBX ISP
 *
 * Uso:
 *   import { getConnector, ErpCustomer } from "./erp-connector";
 *   const connector = getConnector("ixc");
 *   const clientes = await connector.fetchDelinquents(config);
 */

// ─── Tipos compartilhados ────────────────────────────────────────────────────

export interface ErpConfig {
  apiUrl: string;
  apiUser?: string;
  apiToken: string;
  extra?: Record<string, string>;
  clientId?: string;
  clientSecret?: string;
  mkContraSenha?: string;
}

export interface ErpCustomer {
  cpfCnpj: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  cep?: string;
  totalOverdueAmount: number;
  maxDaysOverdue: number;
  overdueInvoicesCount: number;
  erpSource: string;
  contractStatus?: string;
  rawData?: Record<string, unknown>;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface ErpConnector {
  name: string;
  label: string;
  testConnection(config: ErpConfig): Promise<ConnectionTestResult>;
  fetchDelinquents(config: ErpConfig): Promise<ErpCustomer[]>;
  fetchCustomers?(config: ErpConfig): Promise<ErpCustomer[]>;
}

// ─── Utilitários internos ────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function basicAuth(user: string, password: string): string {
  return "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
}

function normalizeCpfCnpj(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

function calcDaysOverdue(dueDateStr: string): number {
  if (!dueDateStr) return 0;
  const due = new Date(dueDateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

async function safeFetch(
  url: string,
  options: RequestInit,
  timeout = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── IXC Soft ────────────────────────────────────────────────────────────────

class IxcConnector implements ErpConnector {
  name = "ixc";
  label = "IXC Soft (IXC Provedor)";

  private headers(config: ErpConfig, action = "listar"): Record<string, string> {
    const auth = config.apiUser
      ? basicAuth(config.apiUser, config.apiToken)
      : `Basic ${config.apiToken}`;
    return {
      Authorization: auth,
      ixcsoft: action,
      "Content-Type": "application/json",
    };
  }

  private async listAll(
    config: ErpConfig,
    endpoint: string,
    body: Record<string, unknown>,
    maxPages = 50
  ): Promise<unknown[]> {
    const base = `${normalizeUrl(config.apiUrl)}/webservice/v1/${endpoint}`;
    const results: unknown[] = [];
    let page = 1;
    const rp = 200;

    while (page <= maxPages) {
      const payload = { ...body, page: String(page), rp: String(rp) };
      const res = await safeFetch(base, {
        method: "POST",
        headers: this.headers(config),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`IXC ${endpoint} HTTP ${res.status}: ${text}`);
      }

      const data = (await res.json()) as { registros?: unknown[]; total?: number };
      const registros = data.registros ?? [];
      results.push(...registros);

      if (results.length >= Number(data.total ?? 0) || registros.length < rp) break;
      page++;
    }

    return results;
  }

  async testConnection(config: ErpConfig): Promise<ConnectionTestResult> {
    try {
      const base = `${normalizeUrl(config.apiUrl)}/webservice/v1/cliente`;
      const res = await safeFetch(
        base,
        {
          method: "POST",
          headers: this.headers(config),
          body: JSON.stringify({ qtype: "id", query: "1", oper: "=", page: "1", rp: "1" }),
        },
        10000
      );
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        return { ok: true, message: `Conexao OK — IXC Soft (${data.total ?? "?"} registros)` };
      }
      return { ok: false, message: `IXC retornou HTTP ${res.status}` };
    } catch (e: unknown) {
      return { ok: false, message: `Erro: ${(e as Error).message}` };
    }
  }

  async fetchDelinquents(config: ErpConfig): Promise<ErpCustomer[]> {
    const faturas = await this.listAll(config, "fn_areceber", {
      qtype: "fn_areceber.status",
      query: "A",
      oper: "=",
      orderby: "fn_areceber.data_vencimento",
      sort: "asc",
    });

    const mapa = new Map<string, ErpCustomer>();

    for (const f of faturas as Record<string, string>[]) {
      const cpfCnpj = normalizeCpfCnpj(f.cpf_cnpj ?? f.documento ?? "");
      if (!cpfCnpj) continue;

      const daysOverdue = calcDaysOverdue(f.data_vencimento);
      if (daysOverdue <= 0) continue;

      const valor = parseFloat(f.valor ?? "0");
      const existing = mapa.get(cpfCnpj);

      if (existing) {
        existing.totalOverdueAmount += valor;
        existing.overdueInvoicesCount += 1;
        if (daysOverdue > existing.maxDaysOverdue) existing.maxDaysOverdue = daysOverdue;
      } else {
        mapa.set(cpfCnpj, {
          cpfCnpj,
          name: f.razao ?? f.nome ?? "",
          email: f.email ?? "",
          phone: f.fone ?? f.celular ?? "",
          city: f.cidade ?? "",
          state: f.estado ?? f.uf ?? "",
          cep: f.cep ?? "",
          address: f.endereco ?? "",
          totalOverdueAmount: valor,
          maxDaysOverdue: daysOverdue,
          overdueInvoicesCount: 1,
          erpSource: "ixc",
          contractStatus: "inadimplente",
        });
      }
    }

    return Array.from(mapa.values());
  }

  async fetchCustomers(config: ErpConfig): Promise<ErpCustomer[]> {
    const clientes = (await this.listAll(config, "cliente", {
      qtype: "id", query: "0", oper: ">",
    })) as Record<string, string>[];

    return clientes
      .filter((c) => c.cpf_cnpj || c.documento)
      .map((c) => ({
        cpfCnpj: normalizeCpfCnpj(c.cpf_cnpj ?? c.documento ?? ""),
        name: c.razao ?? c.nome ?? "",
        email: c.email ?? "",
        phone: c.fone ?? c.celular ?? "",
        address: c.endereco ?? "",
        city: c.cidade ?? "",
        state: c.estado ?? c.uf ?? "",
        cep: c.cep ?? "",
        totalOverdueAmount: 0,
        maxDaysOverdue: 0,
        overdueInvoicesCount: 0,
        erpSource: "ixc",
      }));
  }
}

// ─── MK Solutions ────────────────────────────────────────────────────────────

class MkConnector implements ErpConnector {
  name = "mk";
  label = "MK Solutions (MK Auth)";

  private async authenticate(config: ErpConfig, cdServico: number): Promise<string> {
    const base = normalizeUrl(config.apiUrl);
    const contraSenha = config.mkContraSenha ?? config.extra?.mkContraSenha ?? "";
    const url =
      `${base}/mk/WSAutenticacao.rule?sys=MK0` +
      `&token=${encodeURIComponent(config.apiToken)}` +
      `&password=${encodeURIComponent(contraSenha)}` +
      `&cd_servico=${cdServico}`;

    const res = await safeFetch(url, { method: "GET" }, 10000);
    if (!res.ok) throw new Error(`MK Auth HTTP ${res.status}`);

    const data = (await res.json()) as { token_acesso?: string; erro?: string };
    if (data.erro) throw new Error(`MK Auth erro: ${data.erro}`);
    if (!data.token_acesso) throw new Error("MK nao retornou token_acesso");

    return data.token_acesso;
  }

  async testConnection(config: ErpConfig): Promise<ConnectionTestResult> {
    try {
      const token = await this.authenticate(config, 7);
      return { ok: !!token, message: token ? "Conexao OK — MK Solutions" : "Token vazio" };
    } catch (e: unknown) {
      return { ok: false, message: `Erro: ${(e as Error).message}` };
    }
  }

  async fetchDelinquents(config: ErpConfig): Promise<ErpCustomer[]> {
    const tokenAcesso = await this.authenticate(config, 7);
    const base = normalizeUrl(config.apiUrl);
    const url = `${base}/mk/WSFinanceiroInadimplente.rule?sys=MK0&token_acesso=${encodeURIComponent(tokenAcesso)}`;

    const res = await safeFetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`MK faturas HTTP ${res.status}`);

    const data = (await res.json()) as unknown;
    const registros = Array.isArray(data) ? data : ((data as Record<string, unknown[]>).registros ?? []);

    const mapa = new Map<string, ErpCustomer>();

    for (const r of registros as Record<string, string>[]) {
      const cpfCnpj = normalizeCpfCnpj(r.cpf ?? r.cnpj ?? r.cpf_cnpj ?? "");
      if (!cpfCnpj) continue;

      const valor = parseFloat(r.valor ?? r.vl_total ?? "0");
      const daysOverdue = calcDaysOverdue(r.dt_vencimento ?? r.data_vencimento ?? "");

      const existing = mapa.get(cpfCnpj);
      if (existing) {
        existing.totalOverdueAmount += valor;
        existing.overdueInvoicesCount += 1;
        if (daysOverdue > existing.maxDaysOverdue) existing.maxDaysOverdue = daysOverdue;
      } else {
        mapa.set(cpfCnpj, {
          cpfCnpj,
          name: r.nome ?? r.razao_social ?? "",
          email: r.email ?? "",
          phone: r.fone ?? r.celular ?? r.telefone ?? "",
          city: r.cidade ?? "",
          state: r.uf ?? r.estado ?? "",
          cep: r.cep ?? "",
          address: r.endereco ?? "",
          totalOverdueAmount: valor,
          maxDaysOverdue: daysOverdue,
          overdueInvoicesCount: 1,
          erpSource: "mk",
          contractStatus: "inadimplente",
        });
      }
    }

    return Array.from(mapa.values());
  }
}

// ─── SGP ─────────────────────────────────────────────────────────────────────

class SgpConnector implements ErpConnector {
  name = "sgp";
  label = "SGP (Sistema Gerencial de Provedores)";

  private authMethod(config: ErpConfig): "token" | "basic" {
    return (config.extra?.sgpAuthMethod as "token" | "basic") ?? "token";
  }

  private requestInit(config: ErpConfig): { headers: Record<string, string>; body?: string } {
    if (this.authMethod(config) === "basic") {
      return {
        headers: {
          Authorization: basicAuth(config.apiUser ?? "", config.apiToken),
          "Content-Type": "application/json",
        },
      };
    }
    return {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: config.apiToken,
        app: config.extra?.sgpApp ?? "consultaisp",
      }).toString(),
    };
  }

  async testConnection(config: ErpConfig): Promise<ConnectionTestResult> {
    try {
      const base = normalizeUrl(config.apiUrl);
      const init = this.requestInit(config);
      const res = await safeFetch(`${base}/api/clientes?limit=1`, { method: "POST", ...init }, 10000);
      if (res.ok) return { ok: true, message: "Conexao OK — SGP" };
      return { ok: false, message: `SGP retornou HTTP ${res.status}` };
    } catch (e: unknown) {
      return { ok: false, message: `Erro: ${(e as Error).message}` };
    }
  }

  async fetchDelinquents(config: ErpConfig): Promise<ErpCustomer[]> {
    const base = normalizeUrl(config.apiUrl);
    const init = this.requestInit(config);

    const res = await safeFetch(`${base}/api/financeiro/inadimplentes?limit=2000`, { method: "POST", ...init });
    if (!res.ok) throw new Error(`SGP inadimplentes HTTP ${res.status}`);

    const raw = (await res.json()) as unknown;
    const lista = Array.isArray(raw) ? raw : ((raw as Record<string, unknown[]>).data ?? []);
    const mapa = new Map<string, ErpCustomer>();

    for (const r of lista as Record<string, string>[]) {
      const cpfCnpj = normalizeCpfCnpj(r.cpf_cnpj ?? r.cpf ?? r.cnpj ?? r.documento ?? "");
      if (!cpfCnpj) continue;

      const valor = parseFloat(r.valor ?? r.valor_total ?? r.saldo_devedor ?? "0");
      const daysOverdue = calcDaysOverdue(r.data_vencimento ?? r.vencimento ?? r.dt_vencimento ?? "");

      const existing = mapa.get(cpfCnpj);
      if (existing) {
        existing.totalOverdueAmount += valor;
        existing.overdueInvoicesCount += 1;
        if (daysOverdue > existing.maxDaysOverdue) existing.maxDaysOverdue = daysOverdue;
      } else {
        mapa.set(cpfCnpj, {
          cpfCnpj,
          name: r.nome ?? r.razao_social ?? r.cliente ?? "",
          email: r.email ?? "",
          phone: r.fone ?? r.celular ?? r.telefone ?? "",
          city: r.cidade ?? "",
          state: r.estado ?? r.uf ?? "",
          cep: r.cep ?? "",
          address: `${r.logradouro ?? r.rua ?? ""} ${r.numero ?? ""}`.trim(),
          totalOverdueAmount: valor,
          maxDaysOverdue: daysOverdue,
          overdueInvoicesCount: 1,
          erpSource: "sgp",
          contractStatus: "inadimplente",
        });
      }
    }

    try {
      const resCanc = await safeFetch(`${base}/api/contratos?status=cancelado&limit=2000`, { method: "POST", ...init });
      if (resCanc.ok) {
        const rawC = (await resCanc.json()) as unknown;
        const listaC = Array.isArray(rawC) ? rawC : ((rawC as Record<string, unknown[]>).data ?? []);
        for (const r of listaC as Record<string, string>[]) {
          const cpfCnpj = normalizeCpfCnpj(r.cpf_cnpj ?? r.cpf ?? r.cnpj ?? "");
          if (!cpfCnpj || mapa.has(cpfCnpj)) continue;
          mapa.set(cpfCnpj, {
            cpfCnpj, name: r.nome ?? r.razao_social ?? "",
            email: r.email ?? "", phone: r.fone ?? r.celular ?? "",
            city: r.cidade ?? "", state: r.estado ?? r.uf ?? "",
            cep: r.cep ?? "", address: `${r.logradouro ?? ""} ${r.numero ?? ""}`.trim(),
            totalOverdueAmount: 0, maxDaysOverdue: 0, overdueInvoicesCount: 0,
            erpSource: "sgp", contractStatus: "cancelado",
          });
        }
      }
    } catch { /* endpoint opcional */ }

    return Array.from(mapa.values());
  }

  async fetchCustomers(config: ErpConfig): Promise<ErpCustomer[]> {
    const base = normalizeUrl(config.apiUrl);
    const init = this.requestInit(config);
    const res = await safeFetch(`${base}/api/clientes?limit=5000`, { method: "POST", ...init });
    if (!res.ok) throw new Error(`SGP clientes HTTP ${res.status}`);
    const raw = (await res.json()) as unknown;
    const lista = Array.isArray(raw) ? raw : ((raw as Record<string, unknown[]>).data ?? []);
    return (lista as Record<string, string>[])
      .filter((r) => r.cpf_cnpj || r.cpf || r.cnpj)
      .map((r) => ({
        cpfCnpj: normalizeCpfCnpj(r.cpf_cnpj ?? r.cpf ?? r.cnpj ?? ""),
        name: r.nome ?? r.razao_social ?? "",
        email: r.email ?? "", phone: r.fone ?? r.celular ?? "",
        city: r.cidade ?? "", state: r.estado ?? r.uf ?? "",
        cep: r.cep ?? "", address: `${r.logradouro ?? ""} ${r.numero ?? ""}`.trim(),
        totalOverdueAmount: 0, maxDaysOverdue: 0, overdueInvoicesCount: 0, erpSource: "sgp",
      }));
  }
}

// ─── Hubsoft ─────────────────────────────────────────────────────────────────

class HubsoftConnector implements ErpConnector {
  name = "hubsoft";
  label = "Hubsoft";

  private tokenCache = new Map<string, { token: string; expiresAt: number }>();

  private cacheKey(config: ErpConfig): string {
    return `${config.apiUrl}::${config.clientId}`;
  }

  private async getToken(config: ErpConfig): Promise<string> {
    const key = this.cacheKey(config);
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const base = normalizeUrl(config.apiUrl);
    const res = await safeFetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: config.clientId ?? config.extra?.clientId ?? "",
        client_secret: config.clientSecret ?? config.extra?.clientSecret ?? "",
        username: config.apiUser ?? "",
        password: config.apiToken,
      }).toString(),
    }, 15000);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Hubsoft OAuth HTTP ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error("Hubsoft nao retornou access_token");

    this.tokenCache.set(key, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    return data.access_token;
  }

  private bearerHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };
  }

  async testConnection(config: ErpConfig): Promise<ConnectionTestResult> {
    try {
      const token = await this.getToken(config);
      return { ok: !!token, message: "Conexao OK — Hubsoft" };
    } catch (e: unknown) {
      return { ok: false, message: `Erro: ${(e as Error).message}` };
    }
  }

  async fetchDelinquents(config: ErpConfig): Promise<ErpCustomer[]> {
    const token = await this.getToken(config);
    const base = normalizeUrl(config.apiUrl);
    const res = await safeFetch(`${base}/api/financeiro/titulos?status=vencido&per_page=2000`, { method: "GET", headers: this.bearerHeaders(token) });
    if (!res.ok) throw new Error(`Hubsoft titulos HTTP ${res.status}`);

    const data = (await res.json()) as unknown;
    const lista = Array.isArray(data) ? data : ((data as Record<string, unknown[]>).data ?? []);
    const mapa = new Map<string, ErpCustomer>();

    for (const r of lista as Record<string, string>[]) {
      const cpfCnpj = normalizeCpfCnpj(r.cpf_cnpj ?? r.cpf ?? r.cnpj ?? r.cliente_cpf_cnpj ?? "");
      if (!cpfCnpj) continue;

      const valor = parseFloat(r.valor ?? r.valor_original ?? "0");
      const daysOverdue = calcDaysOverdue(r.data_vencimento ?? r.vencimento ?? "");

      const existing = mapa.get(cpfCnpj);
      if (existing) {
        existing.totalOverdueAmount += valor;
        existing.overdueInvoicesCount += 1;
        if (daysOverdue > existing.maxDaysOverdue) existing.maxDaysOverdue = daysOverdue;
      } else {
        mapa.set(cpfCnpj, {
          cpfCnpj, name: r.cliente_nome ?? r.nome ?? r.razao_social ?? "",
          email: r.email ?? r.cliente_email ?? "",
          phone: r.fone ?? r.telefone ?? r.celular ?? "",
          city: r.cidade ?? "", state: r.uf ?? r.estado ?? "",
          cep: r.cep ?? "", address: `${r.logradouro ?? r.endereco ?? ""} ${r.numero ?? ""}`.trim(),
          totalOverdueAmount: valor, maxDaysOverdue: daysOverdue, overdueInvoicesCount: 1,
          erpSource: "hubsoft", contractStatus: "inadimplente",
        });
      }
    }
    return Array.from(mapa.values());
  }
}

// ─── Voalle ──────────────────────────────────────────────────────────────────

class VoalleConnector implements ErpConnector {
  name = "voalle";
  label = "Voalle ERP";

  private tokenCache = new Map<string, { token: string; expiresAt: number }>();

  private async getToken(config: ErpConfig): Promise<string> {
    const key = config.apiUrl;
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const base = normalizeUrl(config.apiUrl);
    const clientId = config.extra?.voalleClientId ?? "tger";

    const res = await safeFetch(`${base}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: clientId,
        username: config.apiUser ?? "",
        password: config.apiToken,
        scope: "er",
      }).toString(),
    }, 15000);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Voalle OAuth HTTP ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error("Voalle nao retornou access_token");

    this.tokenCache.set(key, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    return data.access_token;
  }

  async testConnection(config: ErpConfig): Promise<ConnectionTestResult> {
    try {
      const token = await this.getToken(config);
      return { ok: !!token, message: "Conexao OK — Voalle" };
    } catch (e: unknown) {
      return { ok: false, message: `Erro: ${(e as Error).message}` };
    }
  }

  async fetchDelinquents(config: ErpConfig): Promise<ErpCustomer[]> {
    const token = await this.getToken(config);
    const base = normalizeUrl(config.apiUrl);
    const res = await safeFetch(`${base}/api/financeiro/titulos?situacao=vencido&pagina=1&por_pagina=2000`, {
      method: "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Voalle titulos HTTP ${res.status}`);

    const data = (await res.json()) as unknown;
    const lista = Array.isArray(data) ? data : ((data as Record<string, unknown[]>).items ?? (data as Record<string, unknown[]>).data ?? []);
    const mapa = new Map<string, ErpCustomer>();

    for (const r of lista as Record<string, string>[]) {
      const cpfCnpj = normalizeCpfCnpj(r.cpf_cnpj ?? r.cpf ?? r.cnpj ?? r.documento ?? "");
      if (!cpfCnpj) continue;

      const valor = parseFloat(r.valor ?? r.valor_total ?? "0");
      const daysOverdue = calcDaysOverdue(r.data_vencimento ?? r.vencimento ?? "");

      const existing = mapa.get(cpfCnpj);
      if (existing) {
        existing.totalOverdueAmount += valor;
        existing.overdueInvoicesCount += 1;
        if (daysOverdue > existing.maxDaysOverdue) existing.maxDaysOverdue = daysOverdue;
      } else {
        mapa.set(cpfCnpj, {
          cpfCnpj, name: r.nome ?? r.razao_social ?? r.nome_pessoa ?? "",
          email: r.email ?? "", phone: r.fone ?? r.celular ?? r.telefone ?? "",
          city: r.cidade ?? "", state: r.uf ?? r.estado ?? "",
          cep: r.cep ?? "", address: `${r.logradouro ?? r.endereco ?? ""} ${r.numero ?? ""}`.trim(),
          totalOverdueAmount: valor, maxDaysOverdue: daysOverdue, overdueInvoicesCount: 1,
          erpSource: "voalle", contractStatus: "inadimplente",
        });
      }
    }
    return Array.from(mapa.values());
  }
}

// ─── RBX ISP ─────────────────────────────────────────────────────────────────

class RbxConnector implements ErpConnector {
  name = "rbx";
  label = "RBX ISP (RBXSoft)";

  private endpoint(config: ErpConfig): string {
    const base = normalizeUrl(config.apiUrl);
    if (base.endsWith("rbx_server_json.php")) return base;
    return `${base}/routerbox/ws/rbx_server_json.php`;
  }

  async testConnection(config: ErpConfig): Promise<ConnectionTestResult> {
    try {
      const res = await safeFetch(this.endpoint(config), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ChaveIntegracao: config.apiToken, Acao: "ListarClientes", Filtro: "", Pagina: 1, RegistrosPorPagina: 1 }),
      }, 10000);
      if (res.ok) return { ok: true, message: "Conexao OK — RBX ISP" };
      return { ok: false, message: `RBX retornou HTTP ${res.status}` };
    } catch (e: unknown) {
      return { ok: false, message: `Erro: ${(e as Error).message}` };
    }
  }

  async fetchDelinquents(config: ErpConfig): Promise<ErpCustomer[]> {
    const res = await safeFetch(this.endpoint(config), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ChaveIntegracao: config.apiToken, Acao: "PendenciasFinanceiras", Filtro: "STATUS = 'VENCIDO'", Pagina: 1, RegistrosPorPagina: 2000 }),
    });
    if (!res.ok) throw new Error(`RBX pendencias HTTP ${res.status}`);

    const data = (await res.json()) as unknown;
    const lista = Array.isArray(data) ? data : ((data as Record<string, unknown[]>).Registros ?? (data as Record<string, unknown[]>).dados ?? []);
    const mapa = new Map<string, ErpCustomer>();

    for (const r of lista as Record<string, string>[]) {
      const cpfCnpj = normalizeCpfCnpj(r.CPF ?? r.CNPJ ?? r.CPF_CNPJ ?? r.Documento ?? "");
      if (!cpfCnpj) continue;

      const valor = parseFloat(r.Valor ?? r.ValorTotal ?? r.VALOR ?? "0");
      const daysOverdue = calcDaysOverdue(r.DataVencimento ?? r.VENCIMENTO ?? r.Data_Vencimento ?? "");

      const existing = mapa.get(cpfCnpj);
      if (existing) {
        existing.totalOverdueAmount += valor;
        existing.overdueInvoicesCount += 1;
        if (daysOverdue > existing.maxDaysOverdue) existing.maxDaysOverdue = daysOverdue;
      } else {
        mapa.set(cpfCnpj, {
          cpfCnpj, name: r.Nome ?? r.NOME ?? r.RazaoSocial ?? "",
          email: r.Email ?? r.EMAIL ?? "", phone: r.Fone ?? r.Celular ?? r.FONE ?? "",
          city: r.Cidade ?? r.CIDADE ?? "", state: r.UF ?? r.Estado ?? "",
          cep: r.CEP ?? r.Cep ?? "", address: `${r.Endereco ?? r.ENDERECO ?? ""} ${r.Numero ?? ""}`.trim(),
          totalOverdueAmount: valor, maxDaysOverdue: daysOverdue, overdueInvoicesCount: 1,
          erpSource: "rbx", contractStatus: "inadimplente",
        });
      }
    }
    return Array.from(mapa.values());
  }
}

// ─── Registry ────────────────────────────────────────────────────────────────

const connectors: Record<string, ErpConnector> = {
  ixc: new IxcConnector(),
  mk: new MkConnector(),
  sgp: new SgpConnector(),
  hubsoft: new HubsoftConnector(),
  voalle: new VoalleConnector(),
  rbx: new RbxConnector(),
};

export function getConnector(erpSource: string): ErpConnector {
  const connector = connectors[erpSource.toLowerCase()];
  if (!connector) {
    throw new Error(`ERP "${erpSource}" nao suportado. Disponiveis: ${Object.keys(connectors).join(", ")}`);
  }
  return connector;
}

export function listAvailableErps(): { name: string; label: string }[] {
  return Object.values(connectors).map((c) => ({ name: c.name, label: c.label }));
}

// ─── Campos de configuração por ERP ──────────────────────────────────────────

export const ERP_CONFIG_FIELDS: Record<string, {
  field: string;
  label: string;
  type: "text" | "password" | "url";
  required: boolean;
  placeholder?: string;
  helpText?: string;
}[]> = {
  ixc: [
    { field: "apiUrl", label: "URL do Servidor IXC", type: "url", required: true, placeholder: "https://suainstancia.ixcsoft.com.br" },
    { field: "apiUser", label: "ID do Usuario (numerico)", type: "text", required: true, placeholder: "123" },
    { field: "apiToken", label: "Token do Usuario", type: "password", required: true, helpText: "Gerado em Configuracoes > Usuarios > campo Token" },
  ],
  mk: [
    { field: "apiUrl", label: "URL do Servidor MK", type: "url", required: true, placeholder: "http://192.168.1.100:8311" },
    { field: "apiToken", label: "Token do Usuario MK", type: "password", required: true, helpText: "Token cadastrado no usuario de integracao" },
    { field: "mkContraSenha", label: "Contra-Senha do Perfil Webservice", type: "password", required: true, helpText: "Criada em Integradores > Gerenciador de Webservices" },
  ],
  sgp: [
    { field: "apiUrl", label: "URL do Servidor SGP", type: "url", required: true, placeholder: "http://192.168.1.100" },
    { field: "apiToken", label: "Token SGP", type: "password", required: true, helpText: "Obtido com o suporte da SGP" },
    { field: "sgpApp", label: "Nome do App", type: "text", required: true, placeholder: "consultaisp", helpText: "app_name configurado na integracao SGP" },
  ],
  hubsoft: [
    { field: "apiUrl", label: "URL da API Hubsoft", type: "url", required: true, placeholder: "https://api.seudominio.com.br" },
    { field: "clientId", label: "Client ID", type: "text", required: true, helpText: "Gerado no painel de integracoes Hubsoft" },
    { field: "clientSecret", label: "Client Secret", type: "password", required: true },
    { field: "apiUser", label: "Usuario (e-mail)", type: "text", required: true, placeholder: "api@seudominio.com.br" },
    { field: "apiToken", label: "Senha da conta de integracao", type: "password", required: true },
  ],
  voalle: [
    { field: "apiUrl", label: "URL do Voalle ERP", type: "url", required: true, placeholder: "https://erp.seudominio.com.br" },
    { field: "apiUser", label: "Usuario de Integracao", type: "text", required: true, helpText: "Usuario do tipo Integracao criado no Voalle" },
    { field: "apiToken", label: "Senha", type: "password", required: true },
  ],
  rbx: [
    { field: "apiUrl", label: "URL do RBX ISP", type: "url", required: true, placeholder: "https://erp.seudominio.com.br" },
    { field: "apiToken", label: "Chave de Integracao", type: "password", required: true, helpText: "Empresa > Parametros > Web Services no RBX" },
  ],
};
