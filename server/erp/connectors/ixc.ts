/**
 * IXC Soft (IXCSoft/IXC Provedor) — ERP Connector
 *
 * Authentication: Basic Auth — Base64(userId:token)
 * Headers: Authorization, ixcsoft ("listar"|"obter"), Content-Type
 * Method: POST for all operations
 * URL: {base}/webservice/v1/{tabela}
 * Pagination: page + rp (records per page)
 * Response: { page, total, registros: [...] }
 *
 * Tabelas usadas:
 * - fn_areceber: contas a receber (faturas)
 * - cliente: cadastro de clientes
 * - cliente_contrato: contratos
 * - radusuarios: conexoes PPPoE/Radius
 *
 * grid_param format (filtros compostos):
 * [{ TB: "tabela.campo", OP: "=", P: "valor", C: "AND", G: "" }]
 * OP: = | >= | > | <= | < | L (like) | !=
 * C: AND | OR
 *
 * @see https://wikiapiprovedor.ixcsoft.com.br/
 * @see https://github.com/isacna/ixc-soft-api
 * @see https://github.com/CesarBGF/ixc-utils
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
import { cleanCpfCnpj, cleanCep, cleanPhone, calculateDaysOverdue, aggregateByCustomer } from "../normalize.js";

/**
 * Extracts address number from the endereco field when numero is empty.
 * IXC often stores full address including number in endereco (e.g., "RUA AMÉLIA WIESEL ROSE, 4101")
 * while leaving numero empty.
 */
function extractNumberFromAddress(endereco: string | undefined, numero: string | undefined): string | undefined {
  if (numero && numero.trim()) return numero.trim();
  if (!endereco) return undefined;
  // Match a number after comma/space near the end: "RUA X, 4101" or "AV BRASIL 1500"
  // Skip if the last segment is very short (likely a complement like ", 3")
  const match = endereco.match(/,?\s+(\d{2,})\s*(?:,\s*\S+)?$/);
  return match ? match[1] : undefined;
}

/** grid_param filter entry */
interface IxcFilter {
  TB: string;
  OP: "=" | ">=" | ">" | "<=" | "<" | "L" | "!=";
  P: string;
  C: "AND" | "OR";
  G: string;
}

export class IxcConnector implements ErpConnector {
  readonly name = "ixc";
  readonly label = "IXC Soft";

  readonly configFields: ErpConfigField[] = [
    { key: "apiUser", label: "ID do Usuario (numerico)", type: "text", required: true, placeholder: "45" },
    { key: "apiToken", label: "Token do Usuario", type: "password", required: true },
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

  /** Build IXC headers (Basic Auth + ixcsoft action) */
  private buildHeaders(config: ErpConnectionConfig, action = "listar"): Record<string, string> {
    const auth = Buffer.from(`${config.apiUser ?? ""}:${config.apiToken}`).toString("base64");
    return {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      ixcsoft: action,
    };
  }

  private baseUrl(config: ErpConnectionConfig): string {
    return config.apiUrl.replace(/\/+$/, "");
  }

  /**
   * Generic paginated list from any IXC table.
   * Handles pagination automatically (page++ until all records fetched).
   */
  private async listAll(
    config: ErpConnectionConfig,
    tabela: string,
    body: Record<string, unknown>,
    rp = 200,
    maxPages = 50
  ): Promise<any[]> {
    const url = `${this.baseUrl(config)}/webservice/v1/${tabela}`;
    const headers = this.buildHeaders(config, "listar");
    const allRows: any[] = [];
    let page = 1;

    do {
      const payload = { ...body, page: String(page), rp: String(rp) };
      const response = await withResilience(
        () => fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000),
        }),
        { retries: 1, minTimeout: 500, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`IXC ${tabela} HTTP ${response.status}: ${text}`);
      }

      const json: any = await response.json();

      // IXC returns {"type":"error","message":"..."} on auth/IP errors with HTTP 200
      if (json?.type === "error") {
        throw new Error(`IXC API error: ${json.message || "Erro desconhecido"}`);
      }

      const registros: any[] = json?.registros || [];
      const total = parseInt(json?.total, 10) || 0;
      allRows.push(...registros);

      if (allRows.length >= total || registros.length < rp) break;
      page++;
    } while (page <= maxPages);

    return allRows;
  }

  /**
   * List with grid_param (complex filters).
   * grid_param: [{ TB: "tabela.campo", OP: "=", P: "valor", C: "AND", G: "" }]
   */
  private async listWithFilter(
    config: ErpConnectionConfig,
    tabela: string,
    filters: IxcFilter[],
    rp = 200,
    maxPages = 50
  ): Promise<any[]> {
    return this.listAll(config, tabela, {
      qtype: "",
      query: "",
      oper: "",
      grid_param: JSON.stringify(filters),
    }, rp, maxPages);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ErpConnector interface
  // ═══════════════════════════════════════════════════════════════════════════

  async testConnection(config: ErpConnectionConfig): Promise<ErpTestResult> {
    const start = Date.now();
    try {
      const response = await withResilience(
        () => fetch(`${this.baseUrl(config)}/webservice/v1/cliente`, {
          method: "POST",
          headers: this.buildHeaders(config),
          body: JSON.stringify({ qtype: "cliente.id", query: "1", oper: "=", page: "1", rp: "1" }),
          signal: AbortSignal.timeout(8000),
        }),
        { retries: 1, minTimeout: 500, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
      );

      const latencyMs = Date.now() - start;
      if (response.ok) {
        const data: any = await response.json();
        return { ok: true, message: `Conexao OK — IXC Soft (${data.total ?? "?"} clientes)`, latencyMs };
      }
      return { ok: false, message: `IXC retornou HTTP ${response.status}`, latencyMs };
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro de conexao: ${msg}`, latencyMs };
    }
  }

  /**
   * Busca inadimplentes: fn_areceber com status="A" (aberto) e vencidas.
   * Agrupa por CPF/CNPJ: soma valor, conta faturas, pega max dias atraso.
   * Cruza com tabela "cliente" para obter endereco (cidade, uf, cep).
   */
  async fetchDelinquents(config: ErpConnectionConfig, lastDays = 365): Promise<ErpFetchResult> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - lastDays);
      const cutoff = cutoffDate.toISOString().split("T")[0]; // YYYY-MM-DD

      const allRows = await this.listWithFilter(config, "fn_areceber", [
        { TB: "fn_areceber.status", OP: "=", P: "A", C: "AND", G: "" },
        { TB: "fn_areceber.data_vencimento", OP: ">=", P: cutoff, C: "AND", G: "" },
      ]);

      const now = new Date();
      const overdueRows = allRows.filter((row: any) => {
        const dueDate = row.data_vencimento;
        return dueDate && new Date(dueDate) < now;
      });

      // Coletar id_cliente unicos para buscar enderecos na tabela "cliente"
      const clienteIds = [...new Set(
        overdueRows.map((r: any) => String(r.id_cliente || "")).filter(Boolean)
      )];

      // Buscar dados de endereco da tabela "cliente" em lotes
      const clienteMap = new Map<string, { cidade: string; uf: string; cep: string; endereco: string; numero: string }>();
      for (const cid of clienteIds) {
        try {
          const rows = await this.listAll(config, "cliente", {
            qtype: "cliente.id",
            query: cid,
            oper: "=",
          }, 1, 1);
          if (rows.length > 0) {
            const c = rows[0];
            clienteMap.set(cid, {
              cidade: c.cidade || "",
              uf: c.uf || c.estado || "",
              cep: c.cep || "",
              endereco: c.endereco || c.logradouro || "",
              numero: c.numero || "",
            });
          }
        } catch {
          // Cliente nao encontrado, seguir
        }
      }

      console.log(`[IXC] fetchDelinquents: ${overdueRows.length} faturas vencidas, ${clienteMap.size} clientes com endereco de ${clienteIds.length} unicos`);

      const invoices = overdueRows.map((row: any) => {
        const cid = String(row.id_cliente || "");
        const cliente = clienteMap.get(cid);
        return {
          cpfCnpj: cleanCpfCnpj(row.cpf_cnpj || row.cnpj_cpf || row.documento || ""),
          name: row.razao || row.nome || "",
          email: row.email || undefined,
          phone: row.fone || row.celular || row.fone_celular ? cleanPhone(row.fone || row.celular || row.fone_celular) : undefined,
          address: cliente?.endereco || row.endereco || row.logradouro || undefined,
          addressNumber: extractNumberFromAddress(cliente?.endereco || row.endereco, cliente?.numero || row.numero),
          city: cliente?.cidade || row.cidade || undefined,
          state: cliente?.uf || row.uf || row.estado || undefined,
          cep: (cliente?.cep || row.cep) ? cleanCep(cliente?.cep || row.cep) : undefined,
          amount: parseFloat(row.valor || row.valor_original || "0") || 0,
          daysOverdue: calculateDaysOverdue(row.data_vencimento),
          erpSource: "ixc" as const,
        };
      }).filter((inv) => inv.cpfCnpj.length > 0);

      const customers = aggregateByCustomer(invoices);

      return {
        ok: true,
        message: `${customers.length} inadimplentes encontrados (${allRows.length} faturas processadas)`,
        customers,
        totalRecords: customers.length,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  /**
   * Busca clientes com contrato CANCELADO (ativo=N) e faturas em aberto nos ultimos 365 dias.
   * Usado exclusivamente pelo mapa de calor — NAO mostra clientes ativos.
   */
  async fetchCancelledDelinquents(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 365);
      const cutoff = cutoffDate.toISOString().split("T")[0];

      // Buscar faturas abertas de clientes inativos (cancelados) nos ultimos 365 dias
      const allRows = await this.listWithFilter(config, "fn_areceber", [
        { TB: "fn_areceber.status", OP: "=", P: "A", C: "AND", G: "" },
        { TB: "fn_areceber.data_vencimento", OP: ">=", P: cutoff, C: "AND", G: "" },
        { TB: "fn_areceber.ativo", OP: "=", P: "N", C: "AND", G: "" },
      ]);

      const now = new Date();
      const overdueRows = allRows.filter((row: any) => {
        const dueDate = row.data_vencimento;
        return dueDate && new Date(dueDate) < now;
      });

      // Buscar enderecos da tabela "cliente" (fn_areceber nao retorna cidade/uf/cep)
      const clienteIds = [...new Set(
        overdueRows.map((r: any) => String(r.id_cliente || "")).filter(Boolean)
      )];
      const clienteMap = new Map<string, { cidade: string; uf: string; cep: string; endereco: string; numero: string }>();
      for (const cid of clienteIds) {
        try {
          const rows = await this.listAll(config, "cliente", {
            qtype: "cliente.id",
            query: cid,
            oper: "=",
          }, 1, 1);
          if (rows.length > 0) {
            const c = rows[0];
            clienteMap.set(cid, {
              cidade: c.cidade || "",
              uf: c.uf || c.estado || "",
              cep: c.cep || "",
              endereco: c.endereco || c.logradouro || "",
              numero: c.numero || "",
            });
          }
        } catch {}
      }

      console.log(`[IXC] fetchCancelledDelinquents: ${overdueRows.length} faturas canceladas vencidas, ${clienteMap.size} clientes com endereco`);

      const invoices = overdueRows.map((row: any) => {
        const cid = String(row.id_cliente || "");
        const cliente = clienteMap.get(cid);
        return {
          cpfCnpj: cleanCpfCnpj(row.cpf_cnpj || row.cnpj_cpf || row.documento || ""),
          name: row.razao || row.nome || "",
          email: row.email || undefined,
          phone: row.fone || row.celular || row.fone_celular ? cleanPhone(row.fone || row.celular || row.fone_celular) : undefined,
          address: cliente?.endereco || row.endereco || row.logradouro || undefined,
          addressNumber: extractNumberFromAddress(cliente?.endereco || row.endereco, cliente?.numero || row.numero),
          city: cliente?.cidade || row.cidade || undefined,
          state: cliente?.uf || row.uf || row.estado || undefined,
          cep: (cliente?.cep || row.cep) ? cleanCep(cliente?.cep || row.cep) : undefined,
          amount: parseFloat(row.valor || row.valor_original || "0") || 0,
          daysOverdue: calculateDaysOverdue(row.data_vencimento),
          erpSource: "ixc" as const,
        };
      }).filter((inv) => inv.cpfCnpj.length > 0);

      const customers = aggregateByCustomer(invoices);

      return {
        ok: true,
        message: `${customers.length} cancelados com divida (${allRows.length} faturas)`,
        customers,
        totalRecords: customers.length,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  /**
   * Busca todos os clientes.
   */
  async fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    try {
      const allRows = await this.listAll(config, "cliente", {
        qtype: "cliente.id",
        query: "0",
        oper: ">",
        sortname: "cliente.id",
        sortorder: "asc",
      });

      const customers: NormalizedErpCustomer[] = allRows
        .map((row: any) => {
          const cpfCnpj = cleanCpfCnpj(row.cpf_cnpj || row.cnpj_cpf || row.documento || "");
          if (!cpfCnpj) return null;
          return {
            cpfCnpj,
            name: row.razao || row.nome || "",
            email: row.email || undefined,
            phone: row.fone || row.celular ? cleanPhone(row.fone || row.celular) : undefined,
            address: row.endereco || row.logradouro || undefined,
            addressNumber: extractNumberFromAddress(row.endereco, row.numero),
            city: row.cidade || undefined,
            state: row.uf || row.estado || undefined,
            cep: row.cep ? cleanCep(row.cep) : undefined,
            totalOverdueAmount: 0,
            maxDaysOverdue: 0,
            erpSource: "ixc",
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
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Metodos extras para Consulta ISP (alem da interface ErpConnector)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Busca contratos cancelados (ultimos N dias).
   * Tabela: cliente_contrato, status="C" (cancelado)
   * Usado para detectar migradores seriais.
   */
  async fetchCancelledContracts(config: ErpConnectionConfig, lastDays = 90): Promise<{
    ok: boolean;
    message: string;
    contracts: Array<{
      cpfCnpj: string;
      name: string;
      contractId: string;
      plan: string;
      startDate: string;
      endDate: string;
      cancelReason: string;
      customerId: string;
    }>;
  }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - lastDays);
      const cutoff = cutoffDate.toISOString().split("T")[0]; // YYYY-MM-DD

      // Filtro composto: status=C AND data_final >= cutoffDate
      const rows = await this.listWithFilter(config, "cliente_contrato", [
        { TB: "cliente_contrato.status", OP: "=", P: "C", C: "AND", G: "" },
        { TB: "cliente_contrato.data_final", OP: ">=", P: cutoff, C: "AND", G: "" },
      ]);

      // Para cada contrato, buscar dados do cliente
      const contracts = rows.map((r: any) => ({
        cpfCnpj: "", // preenchido depois
        name: "",
        contractId: String(r.id || ""),
        plan: r.contrato || r.descricao || r.tipo || "",
        startDate: r.data_inicio || "",
        endDate: r.data_final || "",
        cancelReason: r.motivo_cancelamento || r.observacao || "",
        customerId: String(r.id_cliente || ""),
      }));

      // Buscar CPF/nome dos clientes em lote
      const customerIds = [...new Set(contracts.map(c => c.customerId).filter(Boolean))];
      if (customerIds.length > 0) {
        const clienteRows = await this.listWithFilter(config, "cliente", [
          { TB: "cliente.id", OP: "=", P: customerIds.join(","), C: "AND", G: "" },
        ]);
        const clienteMap = new Map<string, { cpf: string; nome: string }>();
        for (const cl of clienteRows) {
          clienteMap.set(String(cl.id), {
            cpf: cleanCpfCnpj(cl.cpf_cnpj || cl.documento || ""),
            nome: cl.razao || cl.nome || "",
          });
        }
        for (const c of contracts) {
          const cl = clienteMap.get(c.customerId);
          if (cl) {
            c.cpfCnpj = cl.cpf;
            c.name = cl.nome;
          }
        }
      }

      return {
        ok: true,
        message: `${contracts.length} contratos cancelados nos ultimos ${lastDays} dias`,
        contracts: contracts.filter(c => c.cpfCnpj),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, contracts: [] };
    }
  }

  /**
   * Busca clientes por endereco (CEP ou logradouro).
   * Tabela: cliente com filtro por cep ou endereco (like)
   * Usado para verificacao de risco por endereco.
   */
  async fetchCustomersByAddress(config: ErpConnectionConfig, options: {
    cep?: string;
    street?: string;
    city?: string;
  }): Promise<{
    ok: boolean;
    message: string;
    customers: Array<{
      cpfCnpj: string;
      name: string;
      address: string;
      number: string;
      city: string;
      state: string;
      cep: string;
      status: string;
      customerId: string;
    }>;
  }> {
    try {
      const filters: IxcFilter[] = [];

      if (options.cep) {
        filters.push({ TB: "cliente.cep", OP: "=", P: cleanCep(options.cep), C: "AND", G: "" });
      }
      if (options.street) {
        filters.push({ TB: "cliente.endereco", OP: "L", P: `%${options.street}%`, C: "AND", G: "" });
      }
      if (options.city) {
        filters.push({ TB: "cliente.cidade", OP: "=", P: options.city, C: "AND", G: "" });
      }

      if (filters.length === 0) {
        return { ok: false, message: "Informe CEP, endereco ou cidade para buscar", customers: [] };
      }

      const rows = await this.listWithFilter(config, "cliente", filters);

      const customers = rows
        .map((r: any) => ({
          cpfCnpj: cleanCpfCnpj(r.cpf_cnpj || r.documento || ""),
          name: r.razao || r.nome || "",
          address: r.endereco || r.logradouro || "",
          number: r.numero || "",
          city: r.cidade || "",
          state: r.uf || r.estado || "",
          cep: r.cep ? cleanCep(r.cep) : "",
          status: r.status || "",
          customerId: String(r.id || ""),
        }))
        .filter(c => c.cpfCnpj);

      return {
        ok: true,
        message: `${customers.length} clientes encontrados no endereco`,
        customers,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  /**
   * Busca historico completo de contratos de um cliente.
   * Tabela: cliente_contrato filtrado por id_cliente.
   * Retorna todos os contratos (ativos, cancelados, suspensos).
   */
  async fetchContractHistory(config: ErpConnectionConfig, customerId: string): Promise<{
    ok: boolean;
    message: string;
    contracts: Array<{
      id: string;
      plan: string;
      value: string;
      startDate: string;
      endDate: string;
      status: string;
      cancelReason: string;
    }>;
  }> {
    try {
      const rows = await this.listAll(config, "cliente_contrato", {
        qtype: "cliente_contrato.id_cliente",
        query: customerId,
        oper: "=",
        sortname: "cliente_contrato.data_inicio",
        sortorder: "desc",
      });

      const contracts = rows.map((r: any) => ({
        id: String(r.id || ""),
        plan: r.contrato || r.descricao || r.tipo || "",
        value: r.valor_contrato || r.valor || "0",
        startDate: r.data_inicio || "",
        endDate: r.data_final || "",
        status: r.status || "",
        cancelReason: r.motivo_cancelamento || "",
      }));

      return {
        ok: true,
        message: `${contracts.length} contratos encontrados`,
        contracts,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, contracts: [] };
    }
  }

  /**
   * Busca cliente por CPF/CNPJ com dados de inadimplencia agregados.
   * Retorna ErpFetchResult com 0 ou 1 clientes.
   * Queries both cliente (customer data) and fn_areceber (overdue invoices) filtered by customer.
   */
  async fetchCustomerByCpf(config: ErpConnectionConfig, cpfCnpj: string): Promise<ErpFetchResult> {
    try {
      const clean = cleanCpfCnpj(cpfCnpj);

      // IXC stores CPF/CNPJ with formatting (041.179.829-40) — try formatted first, fallback to raw
      const formatted = clean.length === 11
        ? `${clean.slice(0,3)}.${clean.slice(3,6)}.${clean.slice(6,9)}-${clean.slice(9)}`
        : clean.length === 14
        ? `${clean.slice(0,2)}.${clean.slice(2,5)}.${clean.slice(5,8)}/${clean.slice(8,12)}-${clean.slice(12)}`
        : clean;

      // Single query with formatted CPF (most common IXC format)
      let clienteRows = await this.listAll(config, "cliente", {
        qtype: "cliente.cnpj_cpf",
        query: formatted,
        oper: "=",
      }, 10, 1);

      // Fallback: try without formatting (some IXC instances store raw digits)
      if (clienteRows.length === 0 && formatted !== clean) {
        clienteRows = await this.listAll(config, "cliente", {
          qtype: "cliente.cnpj_cpf",
          query: clean,
          oper: "=",
        }, 10, 1);
      }

      if (clienteRows.length === 0) {
        return { ok: true, message: "Cliente nao encontrado", customers: [], totalRecords: 0 };
      }

      const r = clienteRows[0];
      const customerId = String(r.id || "");

      // Fetch overdue invoices for this specific customer
      let totalOverdueAmount = 0;
      let maxDaysOverdue = 0;
      let overdueInvoicesCount = 0;

      if (customerId) {
        const now = new Date();
        const invoiceRows = await this.listWithFilter(config, "fn_areceber", [
          { TB: "fn_areceber.id_cliente", OP: "=", P: customerId, C: "AND", G: "" },
          { TB: "fn_areceber.status", OP: "=", P: "A", C: "AND", G: "" },
        ], 200, 5);

        for (const inv of invoiceRows) {
          const dueDate = inv.data_vencimento;
          if (dueDate && new Date(dueDate) < now) {
            const amount = parseFloat(inv.valor || inv.valor_original || "0") || 0;
            const days = calculateDaysOverdue(dueDate);
            totalOverdueAmount += amount;
            if (days > maxDaysOverdue) maxDaysOverdue = days;
            overdueInvoicesCount++;
          }
        }
      }

      // Fetch equipment in comodato (unreturned)
      let hasUnreturnedEquipment = false;
      let unreturnedEquipmentCount = 0;
      const equipmentDetails: NormalizedErpCustomer["equipmentDetails"] = [];

      if (customerId) {
        try {
          // Try "comodatos" table first, then "patrimonio", then "fibra_onu"
          const tables = ["comodatos", "patrimonio", "fibra_onu"];
          for (const table of tables) {
            try {
              const eqRows = await this.listWithFilter(config, table, [
                { TB: `${table}.id_cliente`, OP: "=", P: customerId, C: "AND", G: "" },
              ], 50, 1);

              if (eqRows.length > 0) {
                console.log(`[IXC] Equipamentos encontrados em "${table}": ${eqRows.length}. Campos: ${Object.keys(eqRows[0]).join(", ")}`);

                for (const eq of eqRows) {
                  const status = (eq.status || eq.situacao || "").toLowerCase();
                  // Equipamento nao devolvido: qualquer status diferente de "devolvido"
                  const isUnreturned = status !== "devolvido" && status !== "returned" && status !== "baixa";

                  if (isUnreturned) {
                    hasUnreturnedEquipment = true;
                    unreturnedEquipmentCount++;
                    equipmentDetails.push({
                      type: eq.tipo || eq.descricao || eq.nome || "Equipamento",
                      brand: eq.marca || eq.fabricante || "",
                      model: eq.modelo || "",
                      serialNumber: eq.numero_serie || eq.serial || eq.mac || "",
                      value: String(parseFloat(eq.valor || eq.valor_equipamento || "0") || 290),
                      inRecoveryProcess: status === "em cobranca" || status === "retido" || status === "em_cobranca",
                    });
                  }
                }
                break; // Found equipment in this table, stop trying others
              }
            } catch {
              // Table doesn't exist in this IXC instance, try next
            }
          }
        } catch (eqErr) {
          console.log(`[IXC] Erro ao buscar equipamentos: ${eqErr instanceof Error ? eqErr.message : eqErr}`);
        }
      }

      const customer: NormalizedErpCustomer = {
        cpfCnpj: clean,
        name: r.razao || r.nome || "",
        email: r.email || undefined,
        phone: r.fone || r.celular ? cleanPhone(r.fone || r.celular) : undefined,
        address: r.endereco || r.logradouro || undefined,
        addressNumber: extractNumberFromAddress(r.endereco, r.numero),
        complement: r.complemento || undefined,
        neighborhood: r.bairro || undefined,
        city: r.cidade || undefined,
        state: r.uf || r.estado || undefined,
        cep: r.cep ? cleanCep(r.cep) : undefined,
        totalOverdueAmount,
        maxDaysOverdue,
        overdueInvoicesCount,
        hasUnreturnedEquipment,
        unreturnedEquipmentCount,
        equipmentDetails: equipmentDetails.length > 0 ? equipmentDetails : undefined,
        erpSource: "ixc",
      };

      return {
        ok: true,
        message: overdueInvoicesCount > 0
          ? `Cliente encontrado com ${overdueInvoicesCount} fatura(s) vencida(s)`
          : "Cliente encontrado sem inadimplencia",
        customers: [customer],
        totalRecords: 1,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  /**
   * Busca clientes por prefixo de CEP com dados de inadimplencia agregados.
   * Filtra clientes na API do IXC pelo CEP (LIKE prefix 5 digitos),
   * depois busca faturas vencidas para cada cliente encontrado.
   * Retorna ErpFetchResult compativel com a interface ErpConnector.
   */
  async fetchCustomersByCep(config: ErpConnectionConfig, cep: string): Promise<ErpFetchResult> {
    try {
      const cepPrefix = cleanCep(cep).slice(0, 5);
      if (cepPrefix.length < 5) {
        return { ok: false, message: "CEP deve ter pelo menos 5 digitos", customers: [] };
      }

      // Busca clientes cujo CEP comeca com o prefixo
      const clienteRows = await this.listWithFilter(config, "cliente", [
        { TB: "cliente.cep", OP: "L", P: `${cepPrefix}%`, C: "AND", G: "" },
      ]);

      if (clienteRows.length === 0) {
        return { ok: true, message: "Nenhum cliente encontrado para este CEP", customers: [], totalRecords: 0 };
      }

      // Busca faturas vencidas em aberto apenas para os clientes encontrados por CEP
      const customerIds = clienteRows.map((r: any) => String(r.id)).filter(Boolean);
      const customerIdSet = new Set(customerIds);
      const now = new Date();

      // Batch customer IDs to avoid overly large filters — query invoices per batch
      const BATCH_SIZE = 50;
      const overdueByCustomer = new Map<string, { totalAmount: number; maxDays: number; count: number }>();

      for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
        const batch = customerIds.slice(i, i + BATCH_SIZE);

        // Build OR-grouped filters for each customer ID in the batch
        const filters: IxcFilter[] = [];
        for (let j = 0; j < batch.length; j++) {
          filters.push({
            TB: "fn_areceber.id_cliente",
            OP: "=",
            P: batch[j],
            C: j === 0 ? "AND" : "OR",
            G: "invoiceCustomers",
          });
        }
        filters.push({ TB: "fn_areceber.status", OP: "=", P: "A", C: "AND", G: "" });

        const invoiceRows = await this.listWithFilter(config, "fn_areceber", filters, 200, 10);

        for (const inv of invoiceRows) {
          const dueDate = inv.data_vencimento;
          if (!dueDate || new Date(dueDate) >= now) continue;
          const custId = String(inv.id_cliente || "");
          if (!custId || !customerIdSet.has(custId)) continue;

          const amount = parseFloat(inv.valor || inv.valor_original || "0") || 0;
          const days = calculateDaysOverdue(dueDate);
          const existing = overdueByCustomer.get(custId);
          if (existing) {
            existing.totalAmount += amount;
            if (days > existing.maxDays) existing.maxDays = days;
            existing.count++;
          } else {
            overdueByCustomer.set(custId, { totalAmount: amount, maxDays: days, count: 1 });
          }
        }
      }

      // Monta resultado normalizado
      const customers: NormalizedErpCustomer[] = clienteRows
        .map((r: any) => {
          const cpfCnpj = cleanCpfCnpj(r.cpf_cnpj || r.documento || "");
          if (!cpfCnpj) return null;
          const custId = String(r.id || "");
          const overdue = overdueByCustomer.get(custId);
          return {
            cpfCnpj,
            name: r.razao || r.nome || "",
            email: r.email || undefined,
            phone: r.fone || r.celular ? cleanPhone(r.fone || r.celular) : undefined,
            address: r.endereco || r.logradouro || undefined,
            addressNumber: extractNumberFromAddress(r.endereco, r.numero),
            complement: r.complemento || undefined,
            neighborhood: r.bairro || undefined,
            city: r.cidade || undefined,
            state: r.uf || r.estado || undefined,
            cep: r.cep ? cleanCep(r.cep) : undefined,
            totalOverdueAmount: overdue?.totalAmount ?? 0,
            maxDaysOverdue: overdue?.maxDays ?? 0,
            overdueInvoicesCount: overdue?.count ?? 0,
            erpSource: "ixc" as const,
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      return {
        ok: true,
        message: `${customers.length} clientes encontrados no CEP ${cepPrefix}xxx`,
        customers,
        totalRecords: customers.length,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  /**
   * Busca conexoes Radius/PPPoE de um cliente.
   * Tabela: radusuarios filtrado por id_cliente.
   */
  async fetchRadiusStatus(config: ErpConnectionConfig, customerId: string): Promise<{
    ok: boolean;
    connections: Array<{
      login: string;
      online: boolean;
      active: boolean;
      ip: string;
      mac: string;
      plan: string;
    }>;
  }> {
    try {
      const rows = await this.listAll(config, "radusuarios", {
        qtype: "radusuarios.id_cliente",
        query: customerId,
        oper: "=",
      }, 50, 1);

      const connections = rows.map((r: any) => ({
        login: r.login || "",
        online: r.online === "S" || r.online === "s",
        active: r.ativo === "S" || r.ativo === "s",
        ip: r.ip || "",
        mac: r.mac || "",
        plan: r.plano || "",
      }));

      return { ok: true, connections };
    } catch (err: unknown) {
      return { ok: false, connections: [] };
    }
  }
}
