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

  private readonly circuit = new CircuitBreaker();

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
        { retries: 3, minTimeout: 1000, circuit: this.circuit },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`IXC ${tabela} HTTP ${response.status}: ${text}`);
      }

      const json: any = await response.json();
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
        { retries: 1, minTimeout: 500, circuit: this.circuit },
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
      const invoices = allRows
        .filter((row: any) => {
          const dueDate = row.data_vencimento;
          return dueDate && new Date(dueDate) < now;
        })
        .map((row: any) => ({
          cpfCnpj: cleanCpfCnpj(row.cpf_cnpj || row.cnpj_cpf || row.documento || ""),
          name: row.razao || row.nome || "",
          email: row.email || undefined,
          phone: row.fone || row.celular || row.fone_celular ? cleanPhone(row.fone || row.celular || row.fone_celular) : undefined,
          address: row.endereco || row.logradouro || undefined,
          city: row.cidade || undefined,
          state: row.uf || row.estado || undefined,
          cep: row.cep ? cleanCep(row.cep) : undefined,
          amount: parseFloat(row.valor || row.valor_original || "0") || 0,
          daysOverdue: calculateDaysOverdue(row.data_vencimento),
          erpSource: "ixc" as const,
        }))
        .filter((inv) => inv.cpfCnpj.length > 0);

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
   * Busca cliente por CPF/CNPJ.
   * Retorna dados completos do cadastro.
   */
  async fetchCustomerByCpf(config: ErpConnectionConfig, cpfCnpj: string): Promise<{
    ok: boolean;
    message: string;
    customer: any | null;
  }> {
    try {
      const clean = cleanCpfCnpj(cpfCnpj);
      const rows = await this.listAll(config, "cliente", {
        qtype: "cliente.cpf_cnpj",
        query: clean,
        oper: "=",
      }, 10, 1);

      if (rows.length === 0) {
        return { ok: true, message: "Cliente nao encontrado", customer: null };
      }

      const r = rows[0];
      return {
        ok: true,
        message: "Cliente encontrado",
        customer: {
          id: String(r.id || ""),
          cpfCnpj: cleanCpfCnpj(r.cpf_cnpj || r.documento || ""),
          name: r.razao || r.nome || "",
          email: r.email || "",
          phone: r.fone || r.celular || "",
          address: r.endereco || "",
          number: r.numero || "",
          complement: r.complemento || "",
          neighborhood: r.bairro || "",
          city: r.cidade || "",
          state: r.uf || r.estado || "",
          cep: r.cep || "",
          status: r.status || "",
          registrationDate: r.data_cadastro || "",
          personType: r.tipo_pessoa || "",
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customer: null };
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
