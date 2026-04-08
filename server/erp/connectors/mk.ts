/**
 * MK Solutions (MK Auth / MK30) — ERP Connector
 *
 * Authentication: 2-step
 *   1. GET WSAutenticacao.rule?sys=MK0&token={apiToken}&password={mkContraSenha}&cd_servico=9999
 *      Response: { tokenRetornoAutenticacao: "..." } or { token_acesso: "..." } or { Token: "..." }
 *   2. Use token in subsequent calls via `token=` parameter
 *
 * Real documented endpoints:
 *   - GET WSMKConsultaDoc.rule?sys=MK0&token={token}&doc={cpf}       — find customer by CPF/CNPJ
 *   - GET WSMKFaturasPendentes.rule?sys=MK0&token={token}&cd_cliente={id} — pending invoices
 *   - GET WSMKConsultaClientes.rule?sys=MK0&token={token}            — list/search customers
 *   - GET WSMKFaturas.rule?sys=MK0&token={token}                     — invoices with filters
 *
 * @see https://mkloud.atlassian.net/wiki/spaces/MK30/pages/48699908/APIs+gerais
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

/** Pick the first non-null, non-undefined, non-empty-string value from an invoice row, preserving numeric 0. */
function pickAmount(row: any): number {
  const fields = ["Saldo", "saldo", "ValorTotal", "valor_total", "Valor", "valor", "Total", "vl_total", "value"];
  for (const key of fields) {
    const v = row[key];
    if (v !== null && v !== undefined && v !== "") {
      const n = parseFloat(v);
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

export class MkConnector implements ErpConnector {
  readonly name = "mk";
  readonly label = "MK Solutions";

  readonly configFields: ErpConfigField[] = [
    { key: "apiToken", label: "Token do Usuario MK", type: "password", required: true },
    { key: "mkContraSenha", label: "Contra-Senha Webservice", type: "password", required: true },
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
    // Strip trailing slashes and /mk suffix (endpoints add /mk/ themselves)
    return config.apiUrl.replace(/\/+$/, "").replace(/\/mk$/i, "");
  }

  /** Step 1: Authenticate via WSAutenticacao to get session token */
  private async authenticate(config: ErpConnectionConfig): Promise<string> {
    const base = this.baseUrl(config);
    const cacheKey = `${base}::${config.apiToken}`;

    // Check cache
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    // MK uses apiUser field to store the contra-senha (webservice password)
    const mkContraSenha = config.mkContraSenha || config.apiUser || config.extra?.mkContraSenha || "";
    const url = `${base}/mk/WSAutenticacao.rule?sys=MK0&token=${encodeURIComponent(config.apiToken)}&password=${encodeURIComponent(mkContraSenha)}&cd_servico=9999`;

    console.log(`[MK] Autenticando em ${base}/mk/WSAutenticacao.rule (cd_servico=9999)`);

    const response = await withResilience(
      () => fetch(url, { method: "GET", signal: AbortSignal.timeout(10000) }),
      { retries: 2, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
    );

    if (!response.ok) {
      throw new Error(`Autenticacao MK falhou: status ${response.status}`);
    }

    const json: any = await response.json();
    console.log(`[MK] Resposta autenticacao:`, JSON.stringify(json).substring(0, 200));

    // Try multiple token field names — MK API varies between versions
    const tokenAcesso =
      json?.tokenRetornoAutenticacao ||
      json?.token_acesso ||
      json?.Token ||
      json?.access_token;

    if (!tokenAcesso) {
      throw new Error("MK nao retornou token na autenticacao. Campos recebidos: " + Object.keys(json || {}).join(", "));
    }

    // Cache for 30 minutes
    tokenCache.set(cacheKey, { token: tokenAcesso, expiresAt: Date.now() + 30 * 60 * 1000 });
    console.log(`[MK] Token obtido e cacheado com sucesso`);
    return tokenAcesso;
  }

  async testConnection(config: ErpConnectionConfig): Promise<ErpTestResult> {
    const start = Date.now();
    try {
      // Step 1: Authenticate — already validates credentials
      const tokenAuth = await this.authenticate(config);
      const base = this.baseUrl(config);

      // Step 2: Call WSMKConsultaDoc with dummy CPF to validate the endpoint works
      const testUrl = `${base}/mk/WSMKConsultaDoc.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&doc=00000000000`;
      console.log(`[MK] Testando conexao com WSMKConsultaDoc (doc dummy)`);

      const response = await withResilience(
        () => fetch(testUrl, { method: "GET", signal: AbortSignal.timeout(8000) }),
        { retries: 1, minTimeout: 500, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
      );

      const latencyMs = Date.now() - start;

      // Any response (even 404/not found for dummy CPF) means the API is reachable
      if (response.ok || response.status === 404) {
        return { ok: true, message: "Conexao com MK Solutions estabelecida com sucesso", latencyMs };
      }

      // If WSMKConsultaDoc returned error, auth still worked — consider it a success
      console.log(`[MK] WSMKConsultaDoc retornou status ${response.status}, mas autenticacao funcionou`);
      return { ok: true, message: "Autenticacao MK OK (endpoint de consulta retornou status " + response.status + ")", latencyMs };
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, latencyMs };
    }
  }

  async fetchCustomerByCpf(config: ErpConnectionConfig, cpfCnpj: string): Promise<ErpFetchResult> {
    try {
      const tokenAuth = await this.authenticate(config);
      const base = this.baseUrl(config);
      const cleanDoc = cpfCnpj.replace(/\D/g, "");

      // Step 1: Find customer by CPF/CNPJ using WSMKConsultaDoc
      const consultaUrl = `${base}/mk/WSMKConsultaDoc.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&doc=${encodeURIComponent(cleanDoc)}`;
      console.log(`[MK] Buscando cliente por CPF via WSMKConsultaDoc: ${cleanDoc}`);

      const consultaResponse = await withResilience(
        () => fetch(consultaUrl, { method: "GET", signal: AbortSignal.timeout(15000) }),
        { retries: 2, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
      );

      if (!consultaResponse.ok) {
        return { ok: false, message: `MK WSMKConsultaDoc respondeu com status ${consultaResponse.status}`, customers: [] };
      }

      const consultaJson: any = await consultaResponse.json();
      console.log(`[MK] Resposta WSMKConsultaDoc:`, JSON.stringify(consultaJson).substring(0, 300));

      // Extract customer data — response could be object or array
      const customerData = Array.isArray(consultaJson)
        ? consultaJson[0]
        : consultaJson?.registros?.[0] || consultaJson?.data?.[0] || consultaJson;

      // Check if customer was found
      const cdCliente = customerData?.CodigoPessoa || customerData?.cd_cliente || customerData?.codigo || customerData?.id;
      const nome = customerData?.Nome || customerData?.nome || customerData?.razao_social || customerData?.name || "";

      if (!cdCliente && !nome) {
        console.log(`[MK] Cliente nao encontrado para CPF ${cleanDoc}`);
        return { ok: true, message: "Cliente nao encontrado no MK", customers: [], totalRecords: 0 };
      }

      console.log(`[MK] Cliente encontrado: cd_cliente=${cdCliente}, nome=${nome}`);

      // Step 2: Get pending invoices using WSMKFaturasPendentes
      let totalOverdueAmount = 0;
      let maxDaysOverdue = 0;
      let overdueInvoicesCount = 0;

      if (cdCliente) {
        const faturasUrl = `${base}/mk/WSMKFaturasPendentes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdCliente)}`;
        console.log(`[MK] Buscando faturas pendentes via WSMKFaturasPendentes para cd_cliente=${cdCliente}`);

        try {
          const faturasResponse = await withResilience(
            () => fetch(faturasUrl, { method: "GET", signal: AbortSignal.timeout(15000) }),
            { retries: 2, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
          );

          if (faturasResponse.ok) {
            const faturasJson: any = await faturasResponse.json();
            // DEBUG: log raw response structure to diagnose field names
            const rawStr = JSON.stringify(faturasJson);
            console.log(`[MK] WSMKFaturasPendentes resposta bruta (${rawStr.length} chars): ${rawStr.substring(0, 500)}`);
            if (typeof faturasJson === "object" && faturasJson !== null && !Array.isArray(faturasJson)) {
              console.log(`[MK] WSMKFaturasPendentes chaves raiz: ${Object.keys(faturasJson).join(", ")}`);
            }

            let faturas: any[] = Array.isArray(faturasJson)
              ? faturasJson
              : faturasJson?.FaturasPendentes || faturasJson?.Faturas || faturasJson?.faturas || faturasJson?.registros || faturasJson?.data || faturasJson?.Itens || faturasJson?.itens || faturasJson?.resultado || faturasJson?.Resultado || [];

            // Fallback: if faturas is empty but response is an object, search for any nested array
            if ((!faturas || faturas.length === 0) && typeof faturasJson === "object" && faturasJson !== null && !Array.isArray(faturasJson)) {
              for (const val of Object.values(faturasJson)) {
                if (Array.isArray(val) && val.length > 0) {
                  console.log(`[MK] Fallback: encontrou array em chave nao mapeada com ${val.length} items`);
                  faturas = val;
                  break;
                }
              }
            }

            if (faturas.length > 0) {
              console.log(`[MK] Campos da primeira fatura:`, Object.keys(faturas[0]).join(", "));
              console.log(`[MK] Primeira fatura completa:`, JSON.stringify(faturas[0]).substring(0, 500));
            }
            console.log(`[MK] ${faturas.length} fatura(s) pendente(s) encontrada(s)`);

            for (const f of faturas) {
              const valor = pickAmount(f);
              // Try every known date field name from MK API variations
              const dueDate = f.DataVencimento || f.data_vencimento || f.DtVencimento || f.dt_vencimento
                || f.Vencimento || f.vencimento || f.dt_vencto || f.DtVencto || f.vencto || f.Vencto
                || f.data_vencto || f.DataVencto || f.dtVencimento || f.dtVencto || null;
              const days = calculateDaysOverdue(dueDate);

              if (days > 0) {
                totalOverdueAmount += valor;
                maxDaysOverdue = Math.max(maxDaysOverdue, days);
                overdueInvoicesCount++;
              } else if (!dueDate) {
                // WSMKFaturasPendentes only returns pending invoices — if date is unknown,
                // assume at least 1 day overdue (the API already filtered for us)
                console.log(`[MK] WARN: fatura sem data de vencimento reconhecida. Campos: ${Object.keys(f).join(", ")}. Valores: ${JSON.stringify(f).substring(0, 300)}`);
                totalOverdueAmount += valor;
                maxDaysOverdue = Math.max(maxDaysOverdue, 1);
                overdueInvoicesCount++;
              }
            }
          } else {
            console.log(`[MK] WSMKFaturasPendentes retornou status ${faturasResponse.status}`);
          }
        } catch (fatErr) {
          console.log(`[MK] Erro ao buscar faturas pendentes: ${fatErr instanceof Error ? fatErr.message : fatErr}`);
        }

        // Fallback: If WSMKFaturasPendentes returned 0 invoices, try WSMKFaturas with liquidado=false
        if (overdueInvoicesCount === 0) {
          try {
            const faturasAltUrl = `${base}/mk/WSMKFaturas.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&codigo_cliente=${encodeURIComponent(cdCliente)}&liquidado=false&quantidade_meses=12`;
            console.log(`[MK] Fallback: buscando via WSMKFaturas (liquidado=false) para cd_cliente=${cdCliente}`);

            const altResponse = await withResilience(
              () => fetch(faturasAltUrl, { method: "GET", signal: AbortSignal.timeout(15000) }),
              { retries: 1, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
            );

            if (altResponse.ok) {
              const altJson: any = await altResponse.json();
              const altRaw = JSON.stringify(altJson);
              console.log(`[MK] WSMKFaturas resposta bruta (${altRaw.length} chars): ${altRaw.substring(0, 500)}`);

              let altFaturas: any[] = Array.isArray(altJson)
                ? altJson
                : altJson?.Faturas || altJson?.faturas || altJson?.registros || altJson?.data || altJson?.Itens || altJson?.itens || altJson?.resultado || altJson?.Resultado || [];

              // Fallback: find any nested array
              if ((!altFaturas || altFaturas.length === 0) && typeof altJson === "object" && altJson !== null && !Array.isArray(altJson)) {
                for (const val of Object.values(altJson)) {
                  if (Array.isArray(val) && val.length > 0) {
                    altFaturas = val;
                    break;
                  }
                }
              }

              if (altFaturas.length > 0) {
                console.log(`[MK] WSMKFaturas campos:`, Object.keys(altFaturas[0]).join(", "));
                console.log(`[MK] WSMKFaturas primeira fatura:`, JSON.stringify(altFaturas[0]).substring(0, 500));
              }
              console.log(`[MK] WSMKFaturas: ${altFaturas.length} fatura(s) nao liquidada(s)`);

              for (const f of altFaturas) {
                const valor = pickAmount(f);
                const dueDate = f.DataVencimento || f.data_vencimento || f.DtVencimento || f.dt_vencimento
                  || f.Vencimento || f.vencimento || f.dt_vencto || f.DtVencto || f.vencto || f.Vencto
                  || f.data_vencto || f.DataVencto || f.dtVencimento || f.dtVencto || null;
                const days = calculateDaysOverdue(dueDate);

                if (days > 0) {
                  totalOverdueAmount += valor;
                  maxDaysOverdue = Math.max(maxDaysOverdue, days);
                  overdueInvoicesCount++;
                } else if (!dueDate) {
                  console.log(`[MK] WARN WSMKFaturas: fatura sem data. Campos: ${Object.keys(f).join(", ")}`);
                  totalOverdueAmount += valor;
                  maxDaysOverdue = Math.max(maxDaysOverdue, 1);
                  overdueInvoicesCount++;
                }
              }
            } else {
              console.log(`[MK] WSMKFaturas retornou status ${altResponse.status}`);
            }
          } catch (altErr) {
            console.log(`[MK] WSMKFaturas fallback erro: ${altErr instanceof Error ? altErr.message : altErr}`);
          }
        }
      }

      // MK returns address as "Rua X, 123 - Bairro, Cidade" — extract parts
      const rawAddr = customerData?.Endereco || customerData?.endereco || customerData?.logradouro || "";
      const addrParts = rawAddr.split(",").map((s: string) => s.trim());
      const streetPart = addrParts[0] || "";
      const numberMatch = addrParts[1]?.match(/^(\d+)/);
      const addressNumber = numberMatch ? numberMatch[1] : undefined;
      const neighborhoodMatch = rawAddr.match(/- ([^,]+)/);
      const neighborhood = neighborhoodMatch ? neighborhoodMatch[1].trim() : undefined;
      // Last part after last comma is usually city
      const cityFromAddr = addrParts.length > 2 ? addrParts[addrParts.length - 1] : undefined;

      const customer: NormalizedErpCustomer = {
        cpfCnpj: cleanDoc,
        name: nome,
        email: customerData?.Email || customerData?.email || undefined,
        phone: customerData?.Fone || customerData?.fone || customerData?.celular || customerData?.telefone
          ? cleanPhone(customerData.Fone || customerData.fone || customerData.celular || customerData.telefone)
          : undefined,
        address: streetPart || rawAddr || undefined,
        addressNumber,
        neighborhood,
        city: customerData?.cidade || customerData?.municipio || cityFromAddr || undefined,
        state: customerData?.uf || customerData?.estado || undefined,
        cep: customerData?.CEP || customerData?.cep || undefined,
        totalOverdueAmount,
        maxDaysOverdue,
        overdueInvoicesCount,
        erpSource: "mk",
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

  async fetchDelinquents(config: ErpConnectionConfig, _lastDays?: number): Promise<ErpFetchResult> {
    try {
      const tokenAuth = await this.authenticate(config);
      const base = this.baseUrl(config);

      // Try the old endpoint first — some MK30 versions may support it
      let rows: any[] | null = null;

      try {
        const oldUrl = `${base}/mk/WSFinanceiroInadimplente.rule?sys=MK0&token_acesso=${encodeURIComponent(tokenAuth)}`;
        console.log(`[MK] Tentando WSFinanceiroInadimplente.rule (endpoint legado)`);

        const oldResponse = await withResilience(
          () => fetch(oldUrl, { method: "GET", signal: AbortSignal.timeout(30000) }),
          { retries: 1, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
        );

        if (oldResponse.ok) {
          const oldJson: any = await oldResponse.json();
          const parsed: any[] = Array.isArray(oldJson) ? oldJson : oldJson?.registros || oldJson?.data || [];

          // Check if it's a valid response with actual data
          if (parsed.length > 0) {
            console.log(`[MK] WSFinanceiroInadimplente.rule retornou ${parsed.length} registro(s)`);
            rows = parsed;
          }
        } else {
          console.log(`[MK] WSFinanceiroInadimplente.rule retornou status ${oldResponse.status}, usando fallback`);
        }
      } catch (oldErr) {
        console.log(`[MK] WSFinanceiroInadimplente.rule falhou: ${oldErr instanceof Error ? oldErr.message : oldErr}, usando fallback`);
      }

      // If old endpoint worked, use aggregation directly
      if (rows !== null && rows.length > 0) {
        const invoices = rows
          .map((r: any) => {
            const cpfCnpj = cleanCpfCnpj(r.cpf || r.cnpj || r.cpf_cnpj || r.doc || r.Doc || r.CPF || r.CNPJ || "");
            if (!cpfCnpj) return null;
            const dueDate = r.DataVencimento || r.data_vencimento || r.DtVencimento || r.dt_vencimento
              || r.Vencimento || r.vencimento || r.dt_vencto || r.DtVencto || r.vencto || r.Vencto
              || r.data_vencto || r.DataVencto || r.dtVencimento || r.dtVencto || null;
            const days = calculateDaysOverdue(dueDate);
            return {
              cpfCnpj,
              name: r.Nome || r.nome || r.razao_social || "",
              email: r.Email || r.email || undefined,
              phone: r.Fone || r.fone || r.celular || r.telefone ? cleanPhone(r.Fone || r.fone || r.celular || r.telefone) : undefined,
              address: r.Endereco || r.endereco || undefined,
              city: r.Cidade || r.cidade || undefined,
              state: r.UF || r.uf || r.estado || undefined,
              cep: r.CEP || r.cep || undefined,
              amount: pickAmount(r),
              daysOverdue: days > 0 ? days : (dueDate ? 0 : 1), // no date = assume 1 day overdue
              erpSource: "mk" as const,
            };
          })
          .filter((c): c is NonNullable<typeof c> => c !== null && c.daysOverdue > 0);

        const customers = aggregateByCustomer(invoices);

        return {
          ok: true,
          message: `${customers.length} inadimplentes encontrados (via WSFinanceiroInadimplente)`,
          customers,
          totalRecords: customers.length,
        };
      }

      // Fallback: Use WSMKConsultaClientes + WSMKFaturasPendentes per customer
      console.log(`[MK] Fallback: buscando clientes via WSMKConsultaClientes + faturas pendentes`);

      const clientesUrl = `${base}/mk/WSMKConsultaClientes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}`;
      const clientesResponse = await withResilience(
        () => fetch(clientesUrl, { method: "GET", signal: AbortSignal.timeout(30000) }),
        { retries: 3, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
      );

      if (!clientesResponse.ok) {
        return { ok: false, message: `MK WSMKConsultaClientes respondeu com status ${clientesResponse.status}`, customers: [], totalRecords: 0 };
      }

      const clientesJson: any = await clientesResponse.json();
      const allClientes: any[] = Array.isArray(clientesJson)
        ? clientesJson
        : clientesJson?.registros || clientesJson?.data || [];

      // Limit to 200 customers to avoid overwhelming the MK server
      const clientesToProcess = allClientes.slice(0, 200);
      console.log(`[MK] Processando ${clientesToProcess.length} de ${allClientes.length} clientes para verificar inadimplencia`);

      // Process in batches of 5 concurrent requests
      const CONCURRENCY = 5;
      const allInvoices: Array<{
        cpfCnpj: string;
        name: string;
        email?: string;
        phone?: string;
        address?: string;
        city?: string;
        state?: string;
        cep?: string;
        amount: number;
        daysOverdue: number;
        erpSource: string;
      }> = [];

      for (let i = 0; i < clientesToProcess.length; i += CONCURRENCY) {
        const batch = clientesToProcess.slice(i, i + CONCURRENCY);

        const batchResults = await Promise.all(
          batch.map(async (cliente: any) => {
            const cdCliente = cliente.CodigoPessoa || cliente.cd_cliente || cliente.codigo || cliente.id;
            if (!cdCliente) return [];

            try {
              const faturasUrl = `${base}/mk/WSMKFaturasPendentes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdCliente)}`;
              const faturasResp = await fetch(faturasUrl, { method: "GET", signal: AbortSignal.timeout(10000) });

              if (!faturasResp.ok) return [];

              const faturasJson: any = await faturasResp.json();
              const faturas: any[] = Array.isArray(faturasJson)
                ? faturasJson
                : faturasJson?.FaturasPendentes || faturasJson?.Faturas || faturasJson?.faturas || faturasJson?.registros || faturasJson?.data || faturasJson?.Itens || faturasJson?.itens || faturasJson?.resultado || faturasJson?.Resultado || [];

              if (faturas.length > 0) {
                console.log(`[MK] Campos da fatura:`, Object.keys(faturas[0]).join(", "));
              }

              const cpfCnpj = cleanCpfCnpj(cliente.Doc || cliente.doc || cliente.cpf || cliente.cnpj || cliente.cpf_cnpj || "");
              if (!cpfCnpj) return [];

              return faturas
                .map((f: any) => {
                  const dueDate = f.DataVencimento || f.data_vencimento || f.DtVencimento || f.dt_vencimento
                    || f.Vencimento || f.vencimento || f.dt_vencto || f.DtVencto || f.vencto || f.Vencto
                    || f.data_vencto || f.DataVencto || f.dtVencimento || f.dtVencto || null;
                  const days = calculateDaysOverdue(dueDate);
                  // If WSMKFaturasPendentes returned it and date is unparseable, assume 1 day overdue
                  if (days <= 0 && dueDate) return null;

                  return {
                    cpfCnpj,
                    name: cliente.Nome || cliente.nome || cliente.razao_social || "",
                    email: cliente.email || undefined,
                    phone: cliente.fone || cliente.celular || cliente.telefone
                      ? cleanPhone(cliente.fone || cliente.celular || cliente.telefone)
                      : undefined,
                    address: cliente.endereco || undefined,
                    city: cliente.cidade || undefined,
                    state: cliente.uf || cliente.estado || undefined,
                    cep: cliente.cep || undefined,
                    amount: pickAmount(f),
                    daysOverdue: days > 0 ? days : 1, // pending invoice with no date = 1 day
                    erpSource: "mk" as const,
                  };
                })
                .filter((inv): inv is NonNullable<typeof inv> => inv !== null);
            } catch {
              return [];
            }
          }),
        );

        for (const result of batchResults) {
          allInvoices.push(...result);
        }
      }

      const customers = aggregateByCustomer(allInvoices);
      console.log(`[MK] Fallback concluido: ${customers.length} inadimplentes encontrados`);

      return {
        ok: true,
        message: `${customers.length} inadimplentes encontrados (via consulta individual)`,
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
      const tokenAuth = await this.authenticate(config);
      const base = this.baseUrl(config);

      const url = `${base}/mk/WSMKConsultaClientes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}`;
      console.log(`[MK] Buscando clientes via WSMKConsultaClientes`);

      const response = await withResilience(
        () => fetch(url, { method: "GET", signal: AbortSignal.timeout(30000) }),
        { retries: 3, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
      );

      if (!response.ok) {
        return { ok: false, message: `MK WSMKConsultaClientes respondeu com status ${response.status}`, customers: [], totalRecords: 0 };
      }

      const json: any = await response.json();
      const rows: any[] = Array.isArray(json) ? json : json?.registros || json?.data || [];

      console.log(`[MK] WSMKConsultaClientes retornou ${rows.length} registro(s)`);

      const customers: NormalizedErpCustomer[] = rows
        .map((r: any) => {
          const cpfCnpj = cleanCpfCnpj(r.doc || r.cpf || r.cnpj || r.cpf_cnpj || "");
          if (!cpfCnpj) return null;
          return {
            cpfCnpj,
            name: r.nome || r.razao_social || "",
            email: r.email || undefined,
            phone: r.fone || r.celular || r.telefone ? cleanPhone(r.fone || r.celular || r.telefone) : undefined,
            address: r.endereco || r.logradouro || undefined,
            city: r.cidade || r.municipio || undefined,
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

  async fetchCustomersByCep(config: ErpConnectionConfig, cep: string): Promise<ErpFetchResult> {
    try {
      const tokenAuth = await this.authenticate(config);
      const base = this.baseUrl(config);
      const cleanCepValue = cep.replace(/\D/g, "");

      // Step 1: Get all customers
      const url = `${base}/mk/WSMKConsultaClientes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}`;
      console.log(`[MK] Buscando clientes por CEP ${cleanCepValue} via WSMKConsultaClientes`);

      const response = await withResilience(
        () => fetch(url, { method: "GET", signal: AbortSignal.timeout(30000) }),
        { retries: 2, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
      );

      if (!response.ok) {
        return { ok: false, message: `MK WSMKConsultaClientes respondeu com status ${response.status}`, customers: [] };
      }

      const json: any = await response.json();
      const rows: any[] = Array.isArray(json) ? json : json?.registros || json?.data || [];

      // Step 2: Filter by CEP prefix in code (MK may return PascalCase or lowercase)
      const matchingClientes = rows.filter((r: any) => {
        const customerCep = (r.CEP || r.cep || "").replace(/\D/g, "");
        return customerCep.startsWith(cleanCepValue);
      });

      // Limit to 50 to avoid excessive API calls
      const limitedClientes = matchingClientes.slice(0, 50);
      console.log(`[MK] ${matchingClientes.length} clientes com CEP ${cleanCepValue}, processando ${limitedClientes.length}`);

      if (limitedClientes.length === 0) {
        return { ok: true, message: "Nenhum cliente encontrado com este CEP", customers: [], totalRecords: 0 };
      }

      // Step 3: For matches, fetch overdue data
      const CONCURRENCY = 5;
      const results: NormalizedErpCustomer[] = [];

      for (let i = 0; i < limitedClientes.length; i += CONCURRENCY) {
        const batch = limitedClientes.slice(i, i + CONCURRENCY);

        const batchResults = await Promise.all(
          batch.map(async (cliente: any) => {
            const cpfCnpj = cleanCpfCnpj(cliente.Doc || cliente.doc || cliente.cpf || cliente.cnpj || cliente.cpf_cnpj || "");
            if (!cpfCnpj) return null;

            let totalOverdueAmount = 0;
            let maxDaysOverdue = 0;
            let overdueInvoicesCount = 0;

            const cdCliente = cliente.CodigoPessoa || cliente.cd_cliente || cliente.codigo || cliente.id;
            if (cdCliente) {
              try {
                const faturasUrl = `${base}/mk/WSMKFaturasPendentes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdCliente)}`;
                const faturasResp = await fetch(faturasUrl, { method: "GET", signal: AbortSignal.timeout(10000) });

                if (faturasResp.ok) {
                  const faturasJson: any = await faturasResp.json();
                  const faturas: any[] = Array.isArray(faturasJson)
                    ? faturasJson
                    : faturasJson?.FaturasPendentes || faturasJson?.Faturas || faturasJson?.faturas || faturasJson?.registros || faturasJson?.data || faturasJson?.Itens || faturasJson?.itens || faturasJson?.resultado || faturasJson?.Resultado || [];

                  if (faturas.length > 0) {
                    console.log(`[MK] Campos da fatura:`, Object.keys(faturas[0]).join(", "));
                  }

                  for (const f of faturas) {
                    const valor = pickAmount(f);
                    const dueDate = f.DataVencimento || f.data_vencimento || f.DtVencimento || f.dt_vencimento
                      || f.Vencimento || f.vencimento || f.dt_vencto || f.DtVencto || f.vencto || f.Vencto
                      || f.data_vencto || f.DataVencto || f.dtVencimento || f.dtVencto || null;
                    const days = calculateDaysOverdue(dueDate);

                    if (days > 0) {
                      totalOverdueAmount += valor;
                      maxDaysOverdue = Math.max(maxDaysOverdue, days);
                      overdueInvoicesCount++;
                    } else if (!dueDate) {
                      // Pending invoice with no recognized date field — assume overdue
                      console.log(`[MK] WARN: fatura sem data reconhecida. Campos: ${Object.keys(f).join(", ")}`);
                      totalOverdueAmount += valor;
                      maxDaysOverdue = Math.max(maxDaysOverdue, 1);
                      overdueInvoicesCount++;
                    }
                  }
                }
              } catch {
                // Ignore individual invoice fetch errors
              }
            }

            return {
              cpfCnpj,
              name: cliente.Nome || cliente.nome || cliente.razao_social || "",
              email: cliente.Email || cliente.email || undefined,
              phone: cliente.Fone || cliente.fone || cliente.Celular || cliente.celular || cliente.Telefone || cliente.telefone
                ? cleanPhone(cliente.Fone || cliente.fone || cliente.Celular || cliente.celular || cliente.Telefone || cliente.telefone)
                : undefined,
              address: cliente.Endereco || cliente.endereco || cliente.Logradouro || cliente.logradouro || undefined,
              city: cliente.Cidade || cliente.cidade || cliente.Municipio || cliente.municipio || undefined,
              state: cliente.UF || cliente.uf || cliente.Estado || cliente.estado || undefined,
              cep: cliente.CEP || cliente.cep || undefined,
              totalOverdueAmount,
              maxDaysOverdue,
              overdueInvoicesCount,
              erpSource: "mk",
            } as NormalizedErpCustomer;
          }),
        );

        for (const r of batchResults) {
          if (r) results.push(r);
        }
      }

      return {
        ok: true,
        message: `${results.length} cliente(s) encontrado(s) no CEP ${cleanCepValue}`,
        customers: results,
        totalRecords: results.length,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }
}
