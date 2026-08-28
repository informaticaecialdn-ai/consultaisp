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
import { agregarEquipamentosCobrados } from "../equipamento-na-fatura.js";
import { chaveLogradouro } from "../../services/logradouro.js";
import { normalizarLocalidade } from "../../services/localidade.js";
import { cleanCpfCnpj, cleanPhone, calculateDaysOverdue, diasDesdeVencimento, aggregateByCustomer } from "../normalize.js";

// Token cache for MK auth
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * `Situacao` do CLIENTE no MK -> status do contrato. Assimetrica de proposito.
 *
 * ── O QUE A MEDICAO MOSTROU (28/08/2026, base da NsLink) ───────────────────
 *
 * `WSMKConsultaClientes` devolve 785 cadastros: 754 "Ativo" e 31 "Inativo".
 * Desses 754 "Ativo", 560 NAO TEM CONTRATO NENHUM e 194 tem contratos sem
 * nenhum ativo. Ou seja: "Ativo" ali descreve o CADASTRO da pessoa, nao o
 * vinculo. O provedor cancela o contrato e o cadastro segue ativo para
 * cobranca, historico e recontratacao.
 *
 * Por isso "Ativo" devolve `undefined` — nao e evidencia de contrato vigente.
 * Tratar como se fosse carimbaria `active` em 560 ex-clientes, incluindo os
 * cortados por calote, que e exatamente o defeito que se quer corrigir. Quem
 * afirma contrato ativo e `WSMKContratosPorCliente` (ContratosAtivos), e so ele.
 *
 * "Inativo" no cadastro, ao contrario, E evidencia: ninguem inativa cadastro de
 * cliente que esta na base. Esse lado vale.
 *
 * A assimetria e a decisao central desta funcao: no bureau, afirmar vinculo sem
 * prova entrega caloteiro como cliente limpo ao provedor vizinho; afirmar
 * ex-cliente a mais custa uma conferencia.
 */
export function situacaoParaStatus(
  situacao: unknown,
): "cancelled" | "suspended" | undefined {
  const s = String(situacao ?? "").trim().toLowerCase();
  if (!s) return undefined;
  if (s.startsWith("suspens") || s.startsWith("bloque")) return "suspended";
  if (s.startsWith("cancel") || s.startsWith("inativ") || s.startsWith("desativ")
      || s.startsWith("desabilit") || s.startsWith("encerrad")) return "cancelled";
  // "Ativo" cai aqui, e e o ponto: cadastro ativo nao prova contrato vigente.
  return undefined;
}

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

  /**
   * Inventario de equipamentos em comodato com o cliente.
   *
   * Endpoint da documentacao do MK (release 74):
   *   GET /pessoas/inventory?token=&id=
   *
   * Duas ressalvas que moldam o codigo:
   *
   * 1. E da "core-api" do MK — Node.js instalado no servidor do provedor, um
   *    pre-requisito que a propria documentacao destaca. Nem toda instalacao
   *    tem. Por isso a falha e SILENCIOSA e devolve lista vazia: o provedor que
   *    nao expoe o inventario nao pode ver a consulta inteira falhar por causa
   *    disso.
   * 2. A documentacao nao fixa o prefixo — ela mostra `/pessoas/...` e
   *    `/core-api/pessoas/...` em paginas diferentes. Tenta os dois.
   *
   * "Retido" e o item ainda em posse do cliente. Sem um campo de devolucao
   * explicito, item presente no inventario conta como retido — que e a leitura
   * conservadora certa aqui: o inventario lista o que esta COM o cliente.
   */
  private async buscarInventario(
    base: string,
    tokenAuth: string,
    cdCliente: string,
  ): Promise<{ itens: NonNullable<NormalizedErpCustomer["equipmentDetails"]>; retidos: number }> {
    const vazio = { itens: [] as NonNullable<NormalizedErpCustomer["equipmentDetails"]>, retidos: 0 };
    const caminhos = ["/core-api/pessoas/inventory", "/pessoas/inventory"];

    for (const caminho of caminhos) {
      try {
        const url = `${base}${caminho}?token=${encodeURIComponent(tokenAuth)}&id=${encodeURIComponent(cdCliente)}`;
        const resp = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10000) });
        if (!resp.ok) continue;

        const json: any = await resp.json();
        const lista: any[] = Array.isArray(json) ? json
          : json?.inventory ?? json?.Inventario ?? json?.itens ?? json?.data ?? [];
        if (!Array.isArray(lista) || lista.length === 0) continue;

        // "Devolvido" e o unico estado que tira o item da conta. Sem campo de
        // status, item presente no inventario conta como retido: o inventario
        // lista o que esta COM o cliente, e a leitura conservadora e a certa
        // num bureau — nao afirmar devolucao sem prova dela.
        const devolvido = (e: any) =>
          String(e.status ?? e.situacao ?? "").toLowerCase().includes("devolv");

        const itens = lista.map((e: any) => ({
          type: String(e.tipo ?? e.type ?? e.descricao ?? e.produto ?? "EQUIPAMENTO"),
          brand: String(e.marca ?? e.brand ?? ""),
          model: String(e.modelo ?? e.model ?? ""),
          serialNumber: String(e.numero_serie ?? e.serial ?? e.serialNumber ?? e.mac ?? ""),
          value: String(Number(e.valor ?? e.value ?? e.preco ?? 0) || 0),
          inRecoveryProcess: !devolvido(e),
        }));
        const retidos = lista.filter(e => !devolvido(e)).length;

        console.log(`[MK] Inventario de ${cdCliente}: ${itens.length} item(ns), ${retidos} retido(s) — via ${caminho}`);
        return { itens, retidos };
      } catch {
        // Proximo caminho.
      }
    }
    return vazio;
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

      // Step 1.5: Enrich with structured address from WSMKConsultaClientes.
      // WSMKConsultaDoc returns Endereco as flat string ("Rua X, 123 - Bairro, Cidade") with no CEP/UF.
      // WSMKConsultaClientes returns endereco[] array with {cep, estado, cidade, bairro, logradouro, numero}
      // — needed for the mini-map on Consulta ISP page.
      let enrichedEndereco: any = null;
      if (cdCliente) {
        try {
          const clientesUrl = `${base}/mk/WSMKConsultaClientes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdCliente)}`;
          const clientesResp = await fetch(clientesUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
          if (clientesResp.ok) {
            const cj: any = await clientesResp.json();
            const row = Array.isArray(cj) ? cj[0]
              : cj?.Clientes?.[0] || cj?.clientes?.[0] || cj?.registros?.[0] || cj?.data?.[0]
              || (typeof cj === "object" ? cj : null);
            if (row) {
              const enderecos = row.enderecos || row.Enderecos || row.endereco || row.Endereco;
              if (Array.isArray(enderecos) && enderecos.length > 0) {
                // Preferir endereco de INSTALACAO, fallback pro primeiro
                enrichedEndereco = enderecos.find((e: any) =>
                  String(e.tipo || e.Tipo || "").toUpperCase() === "INSTALACAO"
                ) || enderecos[0];
                console.log(`[MK] Enriquecimento endereco: cep=${enrichedEndereco?.cep}, cidade=${enrichedEndereco?.cidade}, estado=${enrichedEndereco?.estado}`);
              }
              // Se lat/lng do row (raiz) estiver populado, usar
              if (row.Latitude && row.Longitude && !customerData.Latitude) {
                customerData.Latitude = row.Latitude;
                customerData.Longitude = row.Longitude;
              }
            }
          }
        } catch (e) {
          console.log(`[MK] Enriquecimento endereco falhou: ${e instanceof Error ? e.message : e}`);
        }
      }

      // Step 2: Get pending invoices using WSMKFaturasPendentes
      let totalOverdueAmount = 0;
      let maxDaysOverdue = 0;
      let overdueInvoicesCount = 0;
      // A descricao da fatura e onde o equipamento retido aparece nesta
      // instalacao — ver equipamento-na-fatura.ts.
      const descricoesDeFatura: Array<string | null> = [];

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
              descricoesDeFatura.push(f.descricao ?? f.Descricao ?? f.contas ?? f.Contas ?? null);
            }

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

      // ── CONTRATO: status e data de inicio ───────────────────────────────
      // Mesmo motivo do IXC: o anti-fraude so distingue fuga de baixa antiga se
      // souber que o contrato esta vigente e ha quanto tempo. O fetchDelinquents
      // ja fazia esta chamada; o caminho de consulta em tempo real nao fazia.
      let contractStatus: NormalizedErpCustomer["contractStatus"];
      let contractStartDate: string | undefined;
      let contractPlan: string | undefined;

      if (cdCliente) {
        try {
          const ctUrl = `${base}/mk/WSMKContratosPorCliente.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdCliente)}`;
          const ctResp = await fetch(ctUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
          if (ctResp.ok) {
            const ctJson: any = await ctResp.json();
            const ativos: any[] = ctJson?.ContratosAtivos ?? [];
            const inativos: any[] = ctJson?.ContratosInativos ?? ctJson?.ContratosCancelados ?? [];
            const escolhido = ativos[0] ?? inativos[0];
            contractStatus = ativos.length > 0 ? "active" : (inativos.length > 0 ? "cancelled" : undefined);
            if (escolhido) {
              contractStartDate = escolhido.data_ativacao || escolhido.DataAtivacao
                || escolhido.data_contrato || escolhido.DataContrato || undefined;
              contractPlan = escolhido.plano_acesso || escolhido.PlanoAcesso || undefined;
            }
          }
        } catch {
          // Sem o endpoint de contratos, segue sem o sinal — a regra trata undefined.
        }
      }

      // ── EQUIPAMENTO EM COMODATO ─────────────────────────────────────────
      // O conector do MK nao trazia NADA de equipamento — medido contra a API
      // deles em 27/08/2026, `hasUnreturnedEquipment` voltava `undefined` em
      // toda consulta a NsLink, enquanto o IXC ja devolvia o dado. Numa decisao
      // de credito de ISP o equipamento retido costuma valer mais que a divida:
      // uma ONU nao devolvida e R$ 200-800 de prejuizo direto.
      // Duas fontes, nesta ordem:
      //  1. o inventario da core-api, quando o provedor a tem instalada;
      //  2. a DESCRICAO DA FATURA, que e onde o dado realmente esta na
      //     instalacao medida — o provedor cobra o equipamento retido como item
      //     da fatura de rescisao ("roteador 800,00 + smart box 250,00").
      // A segunda nao substitui a primeira: ela cobre o caso, comum, de a
      // core-api nao existir.
      let inventario = cdCliente
        ? await this.buscarInventario(base, tokenAuth, String(cdCliente))
        : { itens: [] as NonNullable<NormalizedErpCustomer["equipmentDetails"]>, retidos: 0 };

      if (inventario.itens.length === 0 && descricoesDeFatura.length > 0) {
        const cobrados = agregarEquipamentosCobrados(descricoesDeFatura);
        if (cobrados.itens.length > 0) {
          console.log(`[MK] Equipamento lido da fatura: ${cobrados.itens.map(e => `${e.tipo} R$${e.valor}`).join(", ")}`);
          inventario = {
            itens: cobrados.itens.map(e => ({
              type: e.tipo, brand: "", model: "", serialNumber: "",
              value: String(e.valor), inRecoveryProcess: true,
            })),
            retidos: cobrados.itens.length,
          };
        }
      }

      const customer: NormalizedErpCustomer = {
        cpfCnpj: cleanDoc,
        name: nome,
        email: customerData?.Email || customerData?.email || undefined,
        phone: customerData?.Fone || customerData?.fone || customerData?.celular || customerData?.telefone
          ? cleanPhone(customerData.Fone || customerData.fone || customerData.celular || customerData.telefone)
          : undefined,
        // Prefer structured enriched data (WSMKConsultaClientes) over parsed flat string (WSMKConsultaDoc)
        address: enrichedEndereco?.logradouro || streetPart || undefined,
        addressNumber: enrichedEndereco?.numero != null && enrichedEndereco?.numero !== ""
          ? String(enrichedEndereco.numero)
          : addressNumber,
        neighborhood: enrichedEndereco?.bairro || neighborhood,
        city: enrichedEndereco?.cidade || customerData?.cidade || customerData?.municipio || cityFromAddr || undefined,
        state: enrichedEndereco?.estado || customerData?.uf || customerData?.estado || undefined,
        cep: enrichedEndereco?.cep || customerData?.CEP || customerData?.cep || undefined,
        latitude: hasValidCoords ? String(rawLat) : undefined,
        longitude: hasValidCoords ? String(rawLng) : undefined,
        totalOverdueAmount,
        maxDaysOverdue,
        overdueInvoicesCount,
        contractStatus,
        contractStartDate,
        contractPlan,
        hasUnreturnedEquipment: inventario.itens.length > 0 ? inventario.retidos > 0 : undefined,
        unreturnedEquipmentCount: inventario.itens.length > 0 ? inventario.retidos : undefined,
        equipmentDetails: inventario.itens.length > 0 ? inventario.itens : undefined,
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

  /**
   * V2 — Estratégia per-customer descoberta via probe-mk-endpoints.ts em 2026-05-13.
   *
   * 1. Lista todos clientes via WSMKConsultaClientes (1 call, retorna ~742 clientes
   *    com Nome + CPF + endereco[] + Situacao)
   * 2. Por cliente em paralelo (concurrency=8):
   *    a) Chama WSMKFaturasPendentes — esse SIM tem data_vencimento DD/MM/AAAA + valor_total
   *    b) Se vazio, skip (não é inadimplente real)
   *    c) Se tem fatura, chama WSMKContratosPorCliente — ContratosAtivos.length > 0 → ativo
   * 3. Monta inadimplente rico: dias reais, status contrato (active/cancelled), plano
   *
   * Performance estimada: 742 clientes × 2 calls × ~300ms / concurrency 8 ≈ 1-2 min
   * Bem mais rápido que parecia — concorrência ajuda muito.
   *
   * Por que substituiu o WSMKFaturasAbertas: aquele endpoint retorna lixo (todos
   * Status=Cancelado, sem data), produzindo "1 dia" pra TODOS inadimplentes.
   * Confirmado em prod 2026-05-13.
   */
  private async fetchDelinquentsV2(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    const tokenAuth = await this.authenticate(config);
    const base = this.baseUrl(config);

    console.log(`[MK v2] Listando clientes via WSMKConsultaClientes...`);
    const clientes: any[] = await this.listarTodosClientes(base, tokenAuth);
    if (clientes.length === 0) {
      return { ok: false, message: "WSMKConsultaClientes nao devolveu nenhum cliente", customers: [] };
    }

    console.log(`[MK v2] ${clientes.length} clientes retornados. Iterando WSMKFaturasPendentes per-customer (concorrência 8)...`);

    const CONCURRENCY = 8;
    const results: NormalizedErpCustomer[] = [];
    let processed = 0;
    let withPending = 0;
    let semDataIgnoradas = 0;

    for (let i = 0; i < clientes.length; i += CONCURRENCY) {
      const batch = clientes.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (cliente: any) => {
          const cdPessoa = String(cliente.CodigoPessoa ?? cliente.codigopessoa ?? cliente.cd_pessoa ?? "");
          if (!cdPessoa) return null;

          // 1. Faturas pendentes
          let faturas: any[] = [];
          try {
            const fpUrl = `${base}/mk/WSMKFaturasPendentes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`;
            const fpResp = await fetch(fpUrl, { method: "GET", signal: AbortSignal.timeout(15000) });
            if (!fpResp.ok) return null;
            const fpJson: any = await fpResp.json();
            faturas = fpJson?.FaturasPendentes ?? fpJson?.faturas_pendentes ?? [];
          } catch {
            return null;
          }

          if (!Array.isArray(faturas) || faturas.length === 0) return null; // não é inadimplente
          processed++;

          // 2. Contrato vigente? So WSMKContratosPorCliente responde isso.
          //
          // O padrao NAO pode ser "cancelled": com ele, um timeout de 15s ou
          // um 500 do MK rebaixava cliente pagante a ex-cliente com divida —
          // exatamente a lista que o provedor usa para negar instalacao. Sem
          // resposta legivel a resposta certa e nao afirmar nada: o upsert so
          // grava status quando ele vem.
          let contractStatus: "active" | "cancelled" | undefined;
          let contractPlan: string | undefined;
          try {
            const ctUrl = `${base}/mk/WSMKContratosPorCliente.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`;
            const ctResp = await fetch(ctUrl, { method: "GET", signal: AbortSignal.timeout(15000) });
            if (ctResp.ok) {
              const ctJson: any = await ctResp.json();
              const ativos: any[] = ctJson?.ContratosAtivos ?? [];
              if (ativos.length > 0) {
                contractStatus = "active";
                contractPlan = ativos[0]?.plano_acesso || ativos[0]?.PlanoAcesso || undefined;
              } else {
                // Resposta boa e sem contrato ativo: ai sim e ex-cliente, e a
                // divida dele e o dado mais valioso que o bureau tem.
                contractStatus = "cancelled";
              }
            }
          } catch {}

          // 3. Atraso e valor VENCIDO — nao "em aberto".
          //
          // WSMKFaturasPendentes devolve tambem a fatura que ainda nem
          // venceu: a mensalidade do mes, emitida dia 01 e com vencimento dia
          // 20. O codigo antigo somava tudo, media 0 dia de atraso e forcava
          // esse 0 para 1 ("pelo menos 1 dia se tem fatura pendente"), o que
          // criava um inadimplente do nada. Medido na NsLink em 28/08/2026:
          // 153 dos 440 inadimplentes tinham exatamente 1 dia de atraso, e a
          // planilha do provedor mostrava essas faturas com status Normal,
          // vencendo entre 10 e 20/08.
          //
          // Num bureau esse e o erro mais caro do lado de fora: o cliente em
          // dia leva a negativa de instalacao no proximo provedor. Fatura a
          // vencer nao entra no valor, nao entra no prazo, e sozinha nao
          // coloca ninguem nesta lista.
          let totalAmount = 0;
          let maxDays = 0;
          let vencidas = 0;
          let semData = 0;
          for (const f of faturas) {
            const dueDate = f.data_vencimento || f.DataVencimento || f.vencimento || f.Vencimento || null;
            const valor = parseFloat(f.valor_total ?? f.valor ?? f.Valor ?? 0) || 0;
            const dias = diasDesdeVencimento(dueDate);
            if (dias === null) { semData++; continue; }
            if (dias <= 0) continue;
            vencidas++;
            totalAmount += valor;
            if (dias > maxDays) maxDays = dias;
          }

          // Sem nenhuma fatura vencida o cliente nao e inadimplente. Ele
          // continua sendo atualizado pelo fetchCustomers, que varre a
          // carteira inteira — some desta lista, nao da base.
          if (vencidas === 0) {
            if (semData > 0) semDataIgnoradas += semData;
            return null;
          }

          withPending++;

          // 4. Extrai endereço (primeiro endereco[] do cliente)
          const enderecos = cliente.endereco || cliente.enderecos || [];
          const end = Array.isArray(enderecos) && enderecos.length > 0 ? enderecos[0] : null;

          const cpfCnpj = cleanCpfCnpj(cliente.CPF_CNPJ || cliente.cpf_cnpj || cliente.documento || "");
          if (!cpfCnpj) return null;

          const phone = cliente.Fone || cliente.fone || cliente.celular;
          return {
            cpfCnpj,
            name: cliente.Nome || cliente.nome || "",
            email: cliente.Email || cliente.email || undefined,
            phone: phone ? cleanPhone(phone) : undefined,
            address: end?.logradouro || end?.endereco || undefined,
            addressNumber: end?.numero != null ? String(end.numero) : undefined,
            neighborhood: end?.bairro || undefined,
            city: end?.cidade || cliente.cidade || undefined,
            state: end?.estado || end?.uf || cliente.UF || cliente.uf || undefined,
            cep: end?.cep || cliente.CEP || cliente.cep || undefined,
            latitude: cliente.Latitude && String(cliente.Latitude).trim() ? String(cliente.Latitude) : undefined,
            longitude: cliente.Longitude && String(cliente.Longitude).trim() ? String(cliente.Longitude) : undefined,
            totalOverdueAmount: totalAmount,
            maxDaysOverdue: maxDays,
            overdueInvoicesCount: vencidas,
            contractStatus,
            contractPlan,
            erpSource: "mk" as const,
          } as NormalizedErpCustomer;
        }),
      );

      for (const r of batchResults) {
        if (r) results.push(r);
      }

      if ((i + CONCURRENCY) % 80 === 0 || i + CONCURRENCY >= clientes.length) {
        console.log(`[MK v2] Progresso: ${Math.min(i + CONCURRENCY, clientes.length)}/${clientes.length} clientes processados, ${withPending} inadimplentes`);
      }
    }

    console.log(`[MK v2] CONCLUIDO: ${results.length} inadimplentes reais (de ${clientes.length} clientes consultados)`);
    if (semDataIgnoradas > 0) {
      // Fatura sem data legivel nao da para julgar. Fica de fora e aparece
      // aqui — silenciar seria esconder inadimplente de verdade.
      console.log(`[MK v2] ${semDataIgnoradas} faturas ignoradas por vencimento ilegivel`);
    }
    return {
      ok: true,
      message: `${results.length} inadimplentes encontrados (v2 per-customer)`,
      customers: results,
      totalRecords: results.length,
    };
  }

  async fetchDelinquents(config: ErpConnectionConfig, _lastDays?: number): Promise<ErpFetchResult> {
    // V2 — estratégia per-customer (datas reais + status contrato).
    // Substituiu o WSMKFaturasAbertas porque aquele endpoint retorna lixo
    // (Status=Cancelado, sem data) — confirmado em prod.
    try {
      const v2Result = await this.fetchDelinquentsV2(config);
      if (v2Result.ok && v2Result.customers.length > 0) {
        return v2Result;
      }
      console.log(`[MK] V2 retornou 0 inadimplentes, caindo p/ legacy WSMKFaturasAbertas`);
    } catch (err) {
      console.log(`[MK] V2 falhou: ${err instanceof Error ? err.message : err} — tentando legacy`);
    }

    // ─── Legacy fallback: WSMKFaturasAbertas + fallback (mantido por seguranca) ───
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

      // Prefetch de TODOS os clientes: WSMKConsultaClientes devolve CPF_CNPJ +
      // enderecos[] + Latitude/Longitude, que e o que enriquece as faturas magras.
      // Varredura por faixa de codigo (ver listarTodosClientes) no lugar das duas
      // tentativas que havia aqui — o filtro por data trazia 785 de 3.226.
      const clientsByCodPessoa = new Map<string, any>();
      for (const row of await this.listarTodosClientes(base, tokenAuth)) {
        const cd = String(row.CodigoPessoa || row.codigopessoa || row.cd_pessoa || row.codpessoa || row.id || "");
        if (cd && !clientsByCodPessoa.has(cd)) clientsByCodPessoa.set(cd, row);
      }
      console.log(`[MK] Prefetch: ${clientsByCodPessoa.size} clientes indexados por CodigoPessoa`);

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

  /**
   * TODOS os clientes, varrendo `cd_cliente` em lotes.
   *
   * ── POR QUE NAO O FILTRO POR DATA ──────────────────────────────────────────
   *
   * `data_alteracao_inicio` parece devolver a base inteira e nao devolve: medido
   * na NsLink em 28/08/2026, ele traz SEMPRE 785 cadastros, com qualquer data —
   * 01/01/2000 e 01/01/2020 dao o mesmo numero. A carteira tem 3.226.
   *
   * A consequencia era o defeito central do sync: ex-cliente cortado por calote
   * nao estava nos 785, entao nenhuma passada o alcancava e o status dele nunca
   * era corrigido. Do lado do provedor isso aparecia como 659 de 870 cancelados
   * por inadimplencia constando "ativo" no bureau.
   *
   * A faixa unica gigante (`cd_cliente_inicio=0&cd_cliente_fim=999999999`), que
   * o codigo tentava como alternativa, tambem nao resolve — o MK trunca. O que
   * funciona e LOTE: 500 codigos por chamada, ate o teto.
   *
   * Estrategia copiada da integracao do Provedor.ai contra o mesmo ERP, onde ja
   * estava resolvida (packages/erp-mk/src/client.ts, fetchClientes).
   *
   * O teto e generoso e o custo de exagerar e baixo: lote vazio responde rapido.
   * Para de varrer depois de VAZIOS_SEGUIDOS lotes sem nada, que e onde a base
   * acabou — sem isso, uma base pequena pagaria dezenas de chamadas inuteis.
   */
  private async listarTodosClientes(base: string, tokenAuth: string): Promise<any[]> {
    const LOTE = 500;
    const TETO = 50_000;
    const VAZIOS_SEGUIDOS = 3;

    const porId = new Map<string, any>();
    let vazios = 0;

    for (let ini = 1; ini <= TETO; ini += LOTE) {
      const fim = ini + LOTE - 1;
      const url = `${base}/mk/WSMKConsultaClientes.rule?sys=MK0`
        + `&token=${encodeURIComponent(tokenAuth)}`
        + `&cd_cliente_inicio=${ini}&cd_cliente_fim=${fim}`;
      try {
        const resp = await fetch(url, { method: "GET", signal: AbortSignal.timeout(120000) });
        if (resp.status === 404 || resp.status === 204) { vazios++; }
        else if (!resp.ok) { vazios++; }
        else {
          const cj: any = await resp.json().catch(() => null);
          const lista: any[] = Array.isArray(cj)
            ? cj
            : (cj?.Clientes ?? cj?.clientes ?? cj?.registros ?? cj?.data ?? []);
          if (lista.length === 0) vazios++;
          else {
            vazios = 0;
            for (const row of lista) {
              const cd = String(row?.CodigoPessoa ?? row?.codigopessoa ?? row?.cd_pessoa ?? row?.id ?? "");
              if (cd && !porId.has(cd)) porId.set(cd, row);
            }
          }
        }
      } catch {
        // Falha de rede num lote nao derruba a varredura: o resto da base ainda
        // vale mais do que nada. Conta como vazio para o corte de parada.
        vazios++;
      }
      if (vazios >= VAZIOS_SEGUIDOS) break;
    }

    console.log(`[MK] listarTodosClientes: ${porId.size} clientes (varredura por faixa de codigo)`);
    return Array.from(porId.values());
  }

  /** Buscar TODOS os clientes (ativos + inativos) para total por bairro */
  async fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    try {
      const tokenAuth = await this.authenticate(config);
      const base = this.baseUrl(config);

      // Varredura por faixa de codigo — ver listarTodosClientes. As duas
      // chamadas que estavam aqui (data_alteracao + faixa unica gigante) davam
      // 785 cadastros de uma carteira de 3.226.
      const allClients: any[] = await this.listarTodosClientes(base, tokenAuth);

      console.log(`[MK] fetchCustomers: ${allClients.length} clientes totais`);

      const customers: NormalizedErpCustomer[] = allClients
        .map(row => {
          const cpfCnpj = cleanCpfCnpj(row.CPF_CNPJ || row.cpf_cnpj || row.CPF || row.cpf || "");
          if (!cpfCnpj) return null;

          // Extrair endereco do array endereco[]
          const enderecos = row.enderecos || row.Enderecos || row.endereco || row.Endereco;
          let address: string | undefined;
          let addressNumber: string | undefined;
          let neighborhood: string | undefined;
          let city: string | undefined;
          let state: string | undefined;
          let cep: string | undefined;
          // A coordenada da INSTALACAO e o melhor ponto que existe: e onde o
          // tecnico montou o servico. O MK a devolve no proprio endereco, e as
          // vezes na raiz do cliente. Este caminho — a carteira inteira — nao a
          // lia, entao so os inadimplentes chegavam ao mapa.
          let latitude: string | undefined;
          let longitude: string | undefined;
          const coord = (o: any) => {
            const la = o?.latitude ?? o?.Latitude;
            const lo = o?.longitude ?? o?.Longitude;
            if (la != null && String(la).trim() && lo != null && String(lo).trim()) {
              latitude = String(la).trim();
              longitude = String(lo).trim();
            }
          };

          if (Array.isArray(enderecos) && enderecos.length > 0) {
            const p = enderecos.find((e: any) => String(e.tipo || "").toUpperCase() === "INSTALACAO") || enderecos[0];
            address = p.logradouro || p.Logradouro;
            addressNumber = p.numero != null ? String(p.numero) : undefined;
            neighborhood = p.bairro || p.Bairro;
            city = p.cidade || p.Cidade;
            state = p.estado || p.Estado || p.uf;
            cep = p.cep || p.CEP;
            coord(p);
          } else if (enderecos && typeof enderecos === "object" && !Array.isArray(enderecos)) {
            address = enderecos.logradouro || enderecos.Logradouro;
            neighborhood = enderecos.bairro || enderecos.Bairro;
            city = enderecos.cidade || enderecos.Cidade;
            state = enderecos.estado || enderecos.Estado;
            cep = enderecos.cep || enderecos.CEP;
            coord(enderecos);
          }
          if (!latitude) coord(row);

          return {
            cpfCnpj,
            // A SITUACAO do cliente vinha no payload e ninguem a lia — mas ela
            // so vale para o lado NEGATIVO. Ver situacaoParaStatus: "Ativo" no
            // cadastro nao prova contrato vigente (560 dos 754 "Ativo" da
            // NsLink nao tem contrato nenhum), entao "Ativo" devolve undefined
            // e nada e escrito. "Inativo" sim: ninguem inativa cadastro de
            // cliente que esta na base.
            //
            // Sem ela, `status` so era escrito para quem aparecia na lista de
            // inadimplentes, e ninguem podia ser REBAIXADO para cancelado:
            // cliente cortado por calote cujas faturas o MK ja nao lista como
            // pendentes ficava marcado ativo para sempre. Medido em 28/08/2026
            // na NsLink: 659 de 870 cancelados por inadimplencia constavam como
            // ativos, e no bureau isso inverte a leitura — "ativo devendo 3
            // dias" no lugar de "cortado por calote".
            //
            // Situacao desconhecida devolve undefined de proposito: o upsert so
            // escreve status quando ele vem, e nao inventa nada.
            contractStatus: situacaoParaStatus(row.Situacao ?? row.situacao),
            name: row.Nome || row.nome || "",
            email: row.Email || row.email || undefined,
            phone: row.Fone || row.fone ? cleanPhone(row.Fone || row.fone) : undefined,
            address,
            addressNumber,
            neighborhood,
            city,
            state,
            cep,
            latitude,
            longitude,
            totalOverdueAmount: 0,
            maxDaysOverdue: 0,
            overdueInvoicesCount: 0,
            erpSource: "mk",
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

  /** Fallback: iterate WSMKConsultaClientes + WSMKFaturasPendentes per customer. */
  private async fetchDelinquentsFallback(config: ErpConnectionConfig, tokenAuth: string, base: string): Promise<ErpFetchResult> {
    console.log(`[MK] Fallback: buscando via WSMKConsultaClientes (varredura por faixa)`);

    const allClientes: any[] = await this.listarTodosClientes(base, tokenAuth);
    if (allClientes.length === 0) {
      return { ok: false, message: "MK WSMKConsultaClientes nao devolveu clientes", customers: [], totalRecords: 0 };
    }
    console.log(`[MK] Fallback: ${allClientes.length} clientes retornados`);
    if (allClientes.length > 0) {
      console.log(`[MK] FALLBACK DIAG primeiro cliente campos: ${Object.keys(allClientes[0]).join(", ")}`);
      console.log(`[MK] FALLBACK DIAG primeiro cliente JSON: ${JSON.stringify(allClientes[0]).slice(0, 800)}`);
    }

    const clientesToProcess = allClientes;
    const CONCURRENCY = 8;
    const allInvoices: any[] = [];
    let firstFaturaDiagDumped = false;

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

            if (!firstFaturaDiagDumped && faturas.length > 0) {
              firstFaturaDiagDumped = true;
              console.log(`[MK] FALLBACK DIAG primeira FATURA campos: ${Object.keys(faturas[0]).join(", ")}`);
              console.log(`[MK] FALLBACK DIAG primeira FATURA JSON: ${JSON.stringify(faturas[0]).slice(0, 800)}`);
              if (faturas.length > 1) {
                console.log(`[MK] FALLBACK DIAG segunda FATURA JSON: ${JSON.stringify(faturas[1]).slice(0, 800)}`);
              }
            }

            const cpfCnpj = cleanCpfCnpj(cliente.Doc || cliente.doc || cliente.cpf || cliente.cnpj || cliente.cpf_cnpj || cliente.documento || "");
            if (!cpfCnpj) return [];

            return faturas
              .map((f: any) => {
                // Aliases expandidos — cobre todas variantes conhecidas do MK
                const dueDate = f.data_vencimento || f.DataVencimento || f.dt_vencimento || f.DtVencimento
                  || f.vencimento || f.Vencimento || f.dt_venc || f.dtVenc
                  || f.dt_vencto || f.DtVencto || f.vencto || f.Vencto
                  || f.data_vencto || f.DataVencto || f.dtVencimento || f.dtVencto
                  || f.data_venc || f.DataVenc || f.dataVencimento || null;
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

  /**
   * Lista clientes que casam um predicado, com a divida agregada.
   *
   * O MK nao filtra no servidor — `WSMKConsultaClientes` devolve a base e o
   * corte e feito aqui. Por isso o predicado e parametro: busca por CEP e por
   * endereco compartilham a mesma varredura e o mesmo calculo de divida, em vez
   * de duas copias que divergiriam com o tempo.
   */
  private async clientesPorFiltro(
    config: ErpConnectionConfig,
    filtro: (linha: any) => boolean,
    rotulo: string,
  ): Promise<ErpFetchResult> {
    try {
      const tokenAuth = await this.authenticate(config);
      const base = this.baseUrl(config);

      // Step 1: Get all customers
      const url = `${base}/mk/WSMKConsultaClientes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}`;
      console.log(`[MK] Buscando clientes (${rotulo}) via WSMKConsultaClientes`);

      const response = await withResilience(
        () => fetch(url, { method: "GET", signal: AbortSignal.timeout(30000) }),
        { retries: 2, minTimeout: 1000, circuit: this.getCircuit(config.extra?.providerId ?? "default") },
      );

      if (!response.ok) {
        return { ok: false, message: `MK WSMKConsultaClientes respondeu com status ${response.status}`, customers: [] };
      }

      const json: any = await response.json();
      const rows: any[] = Array.isArray(json) ? json : json?.registros || json?.data || [];

      const matchingClientes = rows.filter(filtro);

      // Limit to 50 to avoid excessive API calls
      const limitedClientes = matchingClientes.slice(0, 50);
      console.log(`[MK] ${matchingClientes.length} clientes casam ${rotulo}, processando ${limitedClientes.length}`);

      if (limitedClientes.length === 0) {
        return { ok: true, message: `Nenhum cliente encontrado (${rotulo})`, customers: [], totalRecords: 0 };
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
        message: `${results.length} cliente(s) encontrado(s) (${rotulo})`,
        customers: results,
        totalRecords: results.length,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }
  async fetchCustomersByCep(config: ErpConnectionConfig, cep: string): Promise<ErpFetchResult> {
    const alvo = cep.replace(/\D/g, "");
    return this.clientesPorFiltro(
      config,
      (r: any) => (r.CEP || r.cep || "").replace(/\D/g, "").startsWith(alvo),
      `CEP ${alvo}`,
    );
  }

  /**
   * Busca clientes por ENDERECO — o cruzamento da consulta.
   *
   * O MK devolve o endereco de formas diferentes conforme o endpoint: as vezes
   * campos separados, as vezes tudo num texto so ("Rua Mato Grosso, 1435 -
   * Centro, Londrina", medido contra a instalacao da NsLink). `chaveLogradouro`
   * poe os dois na mesma regua, junto com "Av." vs "Avenida".
   *
   * Casa por LOGRADOURO e cidade, sem exigir numero: o numero e o bairro ficam
   * para `services/endereco-chave.ts`, que aplica a mesma regra a todos os ERPs.
   * Devolver a mais e deixar o casador cortar; devolver a menos esconde
   * pendencia.
   */
  async fetchCustomersByAddress(
    config: ErpConnectionConfig,
    endereco: { logradouro: string; numero?: string; bairro?: string; cidade?: string; uf?: string; cep?: string },
  ): Promise<ErpFetchResult> {
    const ruaAlvo = chaveLogradouro(endereco.logradouro);
    if (!ruaAlvo) {
      return { ok: false, message: "Endereco sem logradouro utilizavel", customers: [] };
    }
    const cidadeAlvo = normalizarLocalidade(endereco.cidade);

    return this.clientesPorFiltro(
      config,
      (r: any) => {
        const bruto = r.Endereco || r.endereco || r.Logradouro || r.logradouro || "";
        // O logradouro pode vir com o numero grudado; corta no primeiro
        // separador antes de comparar.
        const rua = chaveLogradouro(String(bruto).split(/[,\-]/)[0]);
        if (!rua || rua !== ruaAlvo) return false;

        if (!cidadeAlvo) return true;
        const cidade = normalizarLocalidade(
          r.Cidade || r.cidade || r.Municipio || r.municipio || "",
        );
        // Cidade ausente no cadastro nao descarta: cadastro incompleto nao e
        // prova de que e outra cidade.
        return !cidade || cidade === cidadeAlvo;
      },
      `${ruaAlvo}${cidadeAlvo ? ` / ${cidadeAlvo}` : ""}`,
    );
  }

}
