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
      // DEBUG completo — log resposta inteira para diagnosticar problemas de endereço
      const fullResp = JSON.stringify(consultaJson);
      console.log(`[MK] Resposta WSMKConsultaDoc (${fullResp.length} chars):`, fullResp.substring(0, 1500));

      // Extract customer data — response could be object or array
      let customerData = Array.isArray(consultaJson)
        ? consultaJson[0]
        : consultaJson?.registros?.[0] || consultaJson?.data?.[0] || consultaJson;

      // MK retorna dados principais no root e cadastros adicionais em "Outros"[]
      // Se o root nao tem endereco mas Outros[0] tem, usar Outros[0] que geralmente
      // é o cadastro ativo mais recente
      if (customerData && Array.isArray(customerData.Outros) && customerData.Outros.length > 0) {
        const rootHasAddress = customerData.Endereco || customerData.endereco || customerData.CEP || customerData.cep;
        if (!rootHasAddress) {
          // Preferir o primeiro "Ativo" dos Outros
          const ativo = customerData.Outros.find((o: any) =>
            String(o.Situacao || o.situacao || "").toLowerCase() === "ativo"
          ) || customerData.Outros[0];
          console.log(`[MK] Root sem endereco, usando Outros[${ativo === customerData.Outros[0] ? 0 : "ativo"}]`);
          customerData = { ...customerData, ...ativo };
        }
      }

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

        // Strategy 3: Check if connection is blocked (WSMKConexoesPorCliente) — blocked = delinquent
        if (overdueInvoicesCount === 0) {
          try {
            const conexoesUrl = `${base}/mk/WSMKConexoesPorCliente.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdCliente)}`;
            console.log(`[MK] Strategy 3: verificando conexoes bloqueadas via WSMKConexoesPorCliente`);

            const conexoesResponse = await withResilience(
              () => fetch(conexoesUrl, { method: "GET", signal: AbortSignal.timeout(15000) }),
              { retries: 1, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
            );

            if (conexoesResponse.ok) {
              const conexoesJson: any = await conexoesResponse.json();
              const rawConexoes = JSON.stringify(conexoesJson);
              console.log(`[MK] WSMKConexoesPorCliente resposta (${rawConexoes.length} chars): ${rawConexoes.substring(0, 500)}`);

              let conexoes: any[] = Array.isArray(conexoesJson)
                ? conexoesJson
                : conexoesJson?.Conexoes || conexoesJson?.conexoes || conexoesJson?.registros || conexoesJson?.data || [];

              if ((!conexoes || conexoes.length === 0) && typeof conexoesJson === "object" && conexoesJson !== null && !Array.isArray(conexoesJson)) {
                for (const val of Object.values(conexoesJson)) {
                  if (Array.isArray(val) && val.length > 0) { conexoes = val; break; }
                }
              }

              // Check for blocked connections — indicates financial issues
              for (const c of conexoes) {
                const bloqueada = c.Bloqueada || c.bloqueada || c.Bloqueado || c.bloqueado || c.blocked || "";
                const motivoBloqueio = c.MotivoBloqueio || c.motivo_bloqueio || c.MotivoBloqueioCodigo || "";
                console.log(`[MK] Conexao: bloqueada=${bloqueada}, motivo=${motivoBloqueio}`);

                if (String(bloqueada).toUpperCase() === "S" || String(bloqueada).toUpperCase() === "SIM" || String(bloqueada) === "true" || String(bloqueada) === "1") {
                  console.log(`[MK] Conexao BLOQUEADA detectada — marcando como inadimplente`);
                  // Blocked connection = at least 30 days overdue (typical MK behavior: block after 30d)
                  maxDaysOverdue = Math.max(maxDaysOverdue, 30);
                  overdueInvoicesCount = Math.max(overdueInvoicesCount, 1);
                  break;
                }
              }
            }
          } catch (conErr) {
            console.log(`[MK] WSMKConexoesPorCliente erro: ${conErr instanceof Error ? conErr.message : conErr}`);
          }
        }
      }

      // MK retorna endereco no formato: "Rua X, 123 - Bairro, Cidade"
      // Ex: "Rua A, 0 - Centro, Jacobina" ou "RUA SENADOR SALGADO FILHO, 121 - Avenida, Santa Cruz do Sul"
      const rawAddr = customerData?.Endereco || customerData?.endereco || customerData?.logradouro || "";
      let streetPart: string | undefined;
      let addressNumber: string | undefined;
      let neighborhood: string | undefined;
      let cityFromAddr: string | undefined;

      if (rawAddr) {
        // Split em virgula: ["Rua X", "123 - Bairro", "Cidade"]
        const parts = rawAddr.split(",").map((s: string) => s.trim()).filter(Boolean);
        streetPart = parts[0] || undefined;

        // Meio: "{numero} - {bairro}"
        if (parts.length >= 2) {
          const middle = parts[1];
          const numBairroMatch = middle.match(/^(\d+(?:[A-Za-z]?)?)\s*-\s*(.+)$/);
          if (numBairroMatch) {
            addressNumber = numBairroMatch[1];
            neighborhood = numBairroMatch[2].trim();
          } else if (/^\d+$/.test(middle)) {
            addressNumber = middle;
          } else {
            neighborhood = middle;
          }
        }

        // Ultimo: cidade
        if (parts.length >= 3) {
          cityFromAddr = parts[parts.length - 1];
        }
      }

      // MK as vezes retorna lat/lng diretamente
      const rawLat = customerData?.Latitude || customerData?.latitude;
      const rawLng = customerData?.Longitude || customerData?.longitude;
      const hasValidCoords = rawLat && rawLng && String(rawLat).trim() !== "" && String(rawLng).trim() !== "";

      console.log(`[MK] RESULTADO FINAL fetchCustomerByCpf: overdue=${overdueInvoicesCount}, maxDays=${maxDaysOverdue}, totalAmount=${totalOverdueAmount}, addr="${streetPart}", num=${addressNumber}, bairro=${neighborhood}, cidade=${cityFromAddr}, cep=${customerData?.CEP || customerData?.cep}, lat=${rawLat}, lng=${rawLng}`);

      const customer: NormalizedErpCustomer = {
        cpfCnpj: cleanDoc,
        name: nome,
        email: customerData?.Email || customerData?.email || undefined,
        phone: customerData?.Fone || customerData?.fone || customerData?.celular || customerData?.telefone
          ? cleanPhone(customerData.Fone || customerData.fone || customerData.celular || customerData.telefone)
          : undefined,
        address: streetPart || undefined,
        addressNumber,
        neighborhood,
        city: customerData?.cidade || customerData?.municipio || cityFromAddr || undefined,
        state: customerData?.uf || customerData?.estado || undefined,
        cep: customerData?.CEP || customerData?.cep || undefined,
        latitude: hasValidCoords ? String(rawLat) : undefined,
        longitude: hasValidCoords ? String(rawLng) : undefined,
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

      // Strategy: WSMKFaturasAbertas.rule (release 72+) — single call returns all
      // overdue invoices in a date range. Much faster than iterating customers.
      // Date format: DD/MM/AAAA. Range: 2 years back to yesterday.
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
      const formatBR = (d: Date) =>
        `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
      const dtInicio = formatBR(twoYearsAgo);
      const dtFim = formatBR(yesterday);

      const faturasAbertasUrl = `${base}/mk/WSMKFaturasAbertas.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&dt_venc_inicio=${dtInicio}&dt_venc_fim=${dtFim}`;
      console.log(`[MK] Buscando faturas abertas de ${dtInicio} a ${dtFim} via WSMKFaturasAbertas`);

      const faturasResponse = await withResilience(
        () => fetch(faturasAbertasUrl, { method: "GET", signal: AbortSignal.timeout(60000) }),
        { retries: 2, minTimeout: 2000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
      );

      if (!faturasResponse.ok) {
        console.log(`[MK] WSMKFaturasAbertas retornou status ${faturasResponse.status}, tentando fallback`);
        return await this.fetchDelinquentsFallback(config, tokenAuth, base);
      }

      const faturasJson: any = await faturasResponse.json();
      const rawPreview = JSON.stringify(faturasJson).substring(0, 600);
      console.log(`[MK] WSMKFaturasAbertas resposta (preview): ${rawPreview}`);

      // Extract invoice array — MK may wrap in various keys
      let faturas: any[] = Array.isArray(faturasJson)
        ? faturasJson
        : faturasJson?.ListaFaturasAbertas || faturasJson?.FaturasAbertas || faturasJson?.Faturas
        || faturasJson?.faturas || faturasJson?.registros || faturasJson?.data
        || faturasJson?.Itens || faturasJson?.itens || faturasJson?.resultado || faturasJson?.Resultado || [];

      // Fallback: scan any nested array in the response
      if ((!faturas || faturas.length === 0) && typeof faturasJson === "object" && faturasJson !== null && !Array.isArray(faturasJson)) {
        for (const val of Object.values(faturasJson)) {
          if (Array.isArray(val) && val.length > 0) {
            console.log(`[MK] Encontrou ${val.length} items em chave nao mapeada`);
            faturas = val;
            break;
          }
        }
      }

      if (faturas.length === 0) {
        console.log(`[MK] WSMKFaturasAbertas nao retornou faturas, tentando fallback`);
        return await this.fetchDelinquentsFallback(config, tokenAuth, base);
      }

      console.log(`[MK] WSMKFaturasAbertas retornou ${faturas.length} faturas. Campos da primeira: ${Object.keys(faturas[0]).join(", ")}`);

      // Prefetch all customers in ONE call via WSMKConsultaClientes with wide date filter.
      // This endpoint returns CPF_CNPJ + enderecos[] (logradouro, numero, bairro, cidade, cep, estado)
      // + Latitude/Longitude — everything we need to enrich the sparse faturas.
      const clientsByCodPessoa = new Map<string, any>();
      // Try TWO prefetches to cover both active and cancelled clients:
      // 1) data_alteracao_inicio=01/01/2000 — returns active/recently-edited
      // 2) cd_cliente_inicio=0&cd_cliente_fim=999999999 — range query, often bypasses status filter
      const prefetchUrls = [
        `${base}/mk/WSMKConsultaClientes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&data_alteracao_inicio=01/01/2000`,
        `${base}/mk/WSMKConsultaClientes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente_inicio=0&cd_cliente_fim=999999999`,
      ];
      for (const [idx, url] of prefetchUrls.entries()) {
        try {
          console.log(`[MK] Prefetch WSMKConsultaClientes #${idx + 1}`);
          const clientesResp = await fetch(url, { method: "GET", signal: AbortSignal.timeout(180000) });
          if (!clientesResp.ok) {
            console.log(`[MK] Prefetch #${idx + 1} retornou status ${clientesResp.status}`);
            continue;
          }
          const cj: any = await clientesResp.json();
          const list: any[] = Array.isArray(cj) ? cj
            : cj?.Clientes || cj?.clientes || cj?.registros || cj?.data || [];
          let added = 0;
          for (const row of list) {
            const cd = String(row.CodigoPessoa || row.codigopessoa || row.cd_pessoa || row.codpessoa || row.id || "");
            if (cd && !clientsByCodPessoa.has(cd)) {
              clientsByCodPessoa.set(cd, row);
              added++;
            }
          }
          console.log(`[MK] Prefetch #${idx + 1}: ${list.length} clientes retornados, ${added} novos adicionados (total acumulado: ${clientsByCodPessoa.size})`);
          if (idx === 0 && list.length > 0) {
            console.log(`[MK] Campos do primeiro cliente: ${Object.keys(list[0]).join(", ")}`);
            const sampleEnd = list[0].endereco ?? list[0].Endereco ?? list[0].enderecos;
            console.log(`[MK] Sample endereco: ${JSON.stringify(sampleEnd)?.slice(0, 400)}`);
          }
        } catch (err) {
          console.log(`[MK] Prefetch #${idx + 1} falhou: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Helper to extract customer data from a full WSMKConsultaClientes row.
      // MK varies: `enderecos[]` array, or `endereco` object, or `endereco` flat string.
      const extractFromClienteFull = (row: any) => {
        let address: string | undefined;
        let addressNumber: string | undefined;
        let neighborhood: string | undefined;
        let city: string | undefined;
        let state: string | undefined;
        let cep: string | undefined;

        const enderecosArr = row.enderecos || row.Enderecos;
        const enderecoField = row.endereco ?? row.Endereco;

        const pickFromObj = (p: any) => {
          address = p.logradouro || p.Logradouro || p.endereco || p.Endereco || undefined;
          addressNumber = p.numero != null && p.numero !== "" ? String(p.numero) : undefined;
          neighborhood = p.bairro || p.Bairro || undefined;
          city = p.cidade || p.Cidade || p.municipio || undefined;
          state = p.estado || p.Estado || p.sigla_estado || p.siglaestado || p.uf || p.UF || undefined;
          cep = p.cep || p.CEP || undefined;
        };

        if (Array.isArray(enderecosArr) && enderecosArr.length > 0) {
          pickFromObj(enderecosArr[0]);
        } else if (Array.isArray(enderecoField) && enderecoField.length > 0) {
          pickFromObj(enderecoField[0]);
        } else if (enderecoField && typeof enderecoField === "object") {
          pickFromObj(enderecoField);
        } else if (typeof enderecoField === "string" && enderecoField.trim()) {
          address = enderecoField.trim();
        }

        // CEP/cidade/estado podem tambem vir na raiz do cliente
        cep = cep || row.CEP || row.cep || undefined;
        city = city || row.cidade || row.Cidade || row.municipio || undefined;
        state = state || row.estado || row.Estado || row.uf || row.UF || undefined;

        return {
          cpfCnpj: cleanCpfCnpj(row.CPF_CNPJ || row.cpf_cnpj || row.CPF || row.cpf || row.CNPJ || row.cnpj || row.documento || ""),
          name: row.Nome || row.nome || row.nome_cliente || row.razao_social || "",
          email: row.Email || row.email || undefined,
          phone: row.Fone || row.fone || row.telefone || row.celular || undefined,
          address,
          addressNumber,
          neighborhood,
          city,
          state,
          cep,
        };
      };

      // Group invoices by cd_pessoa to minimize customer lookups
      const invoicesByPerson = new Map<string, any[]>();
      for (const f of faturas) {
        const cdPessoa = String(f.cd_pessoa || f.CodigoPessoa || f.codpessoa || f.codigo_pessoa || f.cdPessoa || "");
        if (!cdPessoa) continue;
        const arr = invoicesByPerson.get(cdPessoa) || [];
        arr.push(f);
        invoicesByPerson.set(cdPessoa, arr);
      }

      console.log(`[MK] Faturas agrupadas em ${invoicesByPerson.size} clientes unicos`);

      // Helper to extract customer data from an invoice row (MK often inlines customer fields)
      const extractFromInvoice = (inv: any) => ({
        cpfCnpj: cleanCpfCnpj(inv.documento || inv.Documento || inv.cpf || inv.cnpj || inv.cpf_cnpj || inv.doc || inv.Doc || inv.CPF || inv.CNPJ || ""),
        name: inv.nome || inv.Nome || inv.nome_cliente || inv.razao_social || inv.cliente || inv.Cliente || "",
        email: inv.email || inv.Email || undefined,
        phone: inv.fone || inv.Fone || inv.celular || inv.telefone || inv.Telefone || undefined,
        address: inv.endereco || inv.Endereco || inv.logradouro || inv.Logradouro || undefined,
        addressNumber: inv.numero || inv.Numero || inv.numero_logradouro || undefined,
        neighborhood: inv.bairro || inv.Bairro || undefined,
        city: inv.cidade || inv.Cidade || inv.municipio || undefined,
        state: inv.uf || inv.UF || inv.estado || inv.siglaestado || inv.sigla_estado || undefined,
        cep: inv.cep || inv.CEP || undefined,
      });

      // Build invoice list for aggregation, enriching with customer lookup if needed
      const allInvoices: Array<{
        cpfCnpj: string;
        name: string;
        email?: string;
        phone?: string;
        address?: string;
        addressNumber?: string;
        neighborhood?: string;
        city?: string;
        state?: string;
        cep?: string;
        amount: number;
        daysOverdue: number;
        erpSource: string;
      }> = [];

      // Determine if invoices already include customer details
      const sampleInvoice = faturas[0];
      const hasInlineCustomerData = !!(sampleInvoice.nome || sampleInvoice.Nome || sampleInvoice.cliente || sampleInvoice.Cliente);
      console.log(`[MK] Faturas contem dados inline do cliente: ${hasInlineCustomerData}`);

      // Customer detail cache (cd_pessoa -> details)
      const customerCache = new Map<string, any>();

      // Diagnostic counters
      const stats = { fromPrefetch: 0, fromFallback: 0, fallbackFailed: 0, withCep: 0, withAddress: 0 };
      let fallbackSampleLogged = false;

      const CONCURRENCY = 8;
      const personIds = Array.from(invoicesByPerson.keys());

      for (let i = 0; i < personIds.length; i += CONCURRENCY) {
        const batch = personIds.slice(i, i + CONCURRENCY);

        await Promise.all(
          batch.map(async (cdPessoa) => {
            const personInvoices = invoicesByPerson.get(cdPessoa) || [];
            if (personInvoices.length === 0) return;

            let customerData = extractFromInvoice(personInvoices[0]);

            // Primary enrichment: use prefetched bulk data (has CPF + structured endereco)
            const prefetched = clientsByCodPessoa.get(cdPessoa);
            if (prefetched) {
              stats.fromPrefetch++;
              const full = extractFromClienteFull(prefetched);
              customerData = {
                cpfCnpj: customerData.cpfCnpj || full.cpfCnpj,
                name: customerData.name || full.name,
                email: customerData.email || full.email,
                phone: customerData.phone || full.phone,
                address: customerData.address || full.address,
                addressNumber: customerData.addressNumber || full.addressNumber,
                neighborhood: customerData.neighborhood || full.neighborhood,
                city: customerData.city || full.city,
                state: customerData.state || full.state,
                cep: customerData.cep || full.cep,
              };
            }

            // Fallback per-client: only if prefetch didn't have this cd_pessoa AND we still lack CPF
            if (!customerData.cpfCnpj) {
              try {
                const altUrl = `${base}/mk/WSMKConsultaClientes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`;
                const altResp = await fetch(altUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
                if (altResp.ok) {
                  const altJson: any = await altResp.json();
                  if (!fallbackSampleLogged) {
                    fallbackSampleLogged = true;
                    console.log(`[MK] Sample fallback response (cd_cliente=${cdPessoa}): ${JSON.stringify(altJson)?.slice(0, 600)}`);
                  }
                  const row = Array.isArray(altJson) ? altJson[0]
                    : altJson?.Clientes?.[0] || altJson?.registros?.[0] || altJson?.data?.[0]
                    || (typeof altJson === "object" ? altJson : null);
                  if (row) {
                    stats.fromFallback++;
                    customerCache.set(cdPessoa, row);
                    const full = extractFromClienteFull(row);
                    customerData = {
                      cpfCnpj: customerData.cpfCnpj || full.cpfCnpj,
                      name: customerData.name || full.name,
                      email: customerData.email || full.email,
                      phone: customerData.phone || full.phone,
                      address: customerData.address || full.address,
                      addressNumber: customerData.addressNumber || full.addressNumber,
                      neighborhood: customerData.neighborhood || full.neighborhood,
                      city: customerData.city || full.city,
                      state: customerData.state || full.state,
                      cep: customerData.cep || full.cep,
                    };
                  } else {
                    stats.fallbackFailed++;
                  }
                } else {
                  stats.fallbackFailed++;
                }
              } catch (e) {
                stats.fallbackFailed++;
                console.log(`[MK] Fallback enriquecer cd_pessoa=${cdPessoa} falhou: ${e instanceof Error ? e.message : e}`);
              }
            }

            // Skip if still no CPF (cannot identify customer for cross-provider lookup)
            if (!customerData.cpfCnpj) {
              console.log(`[MK] Skipping cd_pessoa=${cdPessoa} (sem CPF) - nome=${customerData.name || "?"}`);
              return;
            }

            if (customerData.cep) stats.withCep++;
            if (customerData.address) stats.withAddress++;

            for (const f of personInvoices) {
              const dueDate = f.data_vencimento || f.DataVencimento || f.dt_vencimento || f.DtVencimento
                || f.vencimento || f.Vencimento || f.dt_venc || f.dtVenc || null;
              const days = calculateDaysOverdue(dueDate);
              if (days <= 0 && dueDate) continue; // not overdue yet

              allInvoices.push({
                ...customerData,
                phone: customerData.phone ? cleanPhone(customerData.phone) : undefined,
                amount: pickAmount(f),
                daysOverdue: days > 0 ? days : 1,
                erpSource: "mk",
              });
            }
          }),
        );
      }

      const customers = aggregateByCustomer(allInvoices);
      console.log(`[MK] Enriquecimento stats: prefetch=${stats.fromPrefetch} fallback=${stats.fromFallback} fallbackFail=${stats.fallbackFailed} withCep=${stats.withCep} withAddress=${stats.withAddress}`);
      console.log(`[MK] WSMKFaturasAbertas: ${customers.length} inadimplentes normalizados`);

      return {
        ok: true,
        message: `${customers.length} inadimplentes encontrados via WSMKFaturasAbertas`,
        customers,
        totalRecords: customers.length,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      console.log(`[MK] fetchDelinquents erro: ${msg}`);
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  /** Fallback: iterate WSMKConsultaClientes + WSMKFaturasPendentes per customer. */
  private async fetchDelinquentsFallback(config: ErpConnectionConfig, tokenAuth: string, base: string): Promise<ErpFetchResult> {
    console.log(`[MK] Fallback: buscando via WSMKConsultaClientes com data_alteracao`);

    // WSMKConsultaClientes requires at least one filter — use date from 10 years ago
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    const isoDate = tenYearsAgo.toISOString().split("T")[0];

    const clientesUrl = `${base}/mk/WSMKConsultaClientes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&data_alteracao_inicio=${isoDate}`;
    const clientesResponse = await fetch(clientesUrl, { method: "GET", signal: AbortSignal.timeout(60000) });

    if (!clientesResponse.ok) {
      return { ok: false, message: `MK WSMKConsultaClientes status ${clientesResponse.status}`, customers: [], totalRecords: 0 };
    }

    const clientesJson: any = await clientesResponse.json();
    let allClientes: any[] = Array.isArray(clientesJson)
      ? clientesJson
      : clientesJson?.Clientes || clientesJson?.registros || clientesJson?.data || [];

    if ((!allClientes || allClientes.length === 0) && typeof clientesJson === "object" && clientesJson !== null) {
      for (const val of Object.values(clientesJson)) {
        if (Array.isArray(val) && val.length > 0) { allClientes = val; break; }
      }
    }

    console.log(`[MK] Fallback: ${allClientes.length} clientes retornados`);

    const clientesToProcess = allClientes.slice(0, 500);
    const CONCURRENCY = 8;
    const allInvoices: any[] = [];

    for (let i = 0; i < clientesToProcess.length; i += CONCURRENCY) {
      const batch = clientesToProcess.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (cliente: any) => {
          const cdCliente = cliente.CodigoPessoa || cliente.cd_cliente || cliente.codigo || cliente.id;
          if (!cdCliente) return [];
          try {
            const faturasUrl = `${base}/mk/WSMKFaturasPendentes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdCliente)}`;
            const resp = await fetch(faturasUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
            if (!resp.ok) return [];
            const fj: any = await resp.json();
            const faturas: any[] = Array.isArray(fj)
              ? fj
              : fj?.FaturasPendentes || fj?.Faturas || fj?.faturas || fj?.registros || fj?.data || [];

            const cpfCnpj = cleanCpfCnpj(cliente.Doc || cliente.doc || cliente.cpf || cliente.cnpj || cliente.cpf_cnpj || cliente.documento || "");
            if (!cpfCnpj) return [];

            return faturas
              .map((f: any) => {
                const dueDate = f.data_vencimento || f.DataVencimento || f.vencimento || f.Vencimento || null;
                const days = calculateDaysOverdue(dueDate);
                if (days <= 0 && dueDate) return null;
                return {
                  cpfCnpj,
                  name: cliente.Nome || cliente.nome || cliente.razao_social || "",
                  email: cliente.Email || cliente.email || undefined,
                  phone: cliente.Fone || cliente.fone || cliente.celular ? cleanPhone(cliente.Fone || cliente.fone || cliente.celular) : undefined,
                  address: cliente.Endereco || cliente.endereco || undefined,
                  city: cliente.cidade || cliente.Cidade || undefined,
                  state: cliente.uf || cliente.UF || undefined,
                  cep: cliente.CEP || cliente.cep || undefined,
                  amount: pickAmount(f),
                  daysOverdue: days > 0 ? days : 1,
                  erpSource: "mk" as const,
                };
              })
              .filter((x: any) => x !== null);
          } catch {
            return [];
          }
        }),
      );
      for (const r of results) allInvoices.push(...r);
    }

    const customers = aggregateByCustomer(allInvoices);
    console.log(`[MK] Fallback concluido: ${customers.length} inadimplentes`);
    return {
      ok: true,
      message: `${customers.length} inadimplentes encontrados (fallback)`,
      customers,
      totalRecords: customers.length,
    };
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
