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

/**
 * Os contratos de um cliente, somados: quantos existem e em que estado.
 *
 * `total` e o que decide a PORTEIRA DA BASE: cadastro com zero contratos — nem
 * ativo, nem cancelado — nao e cliente nem ex-cliente, e lead ou cadastro vazio
 * do MK, e nao entra em `customers`. Regra do dono (01/09/2026), a mesma que o
 * Provedor.ai aplica desde o inicio por minimizacao LGPD: sem contrato nao ha
 * execucao de contrato como base legal para reter a PII. Medido na NsLink em
 * 28/08/2026: 560 dos 754 cadastros "Ativo" nao tinham contrato nenhum.
 */
export interface ContratosDoCliente {
  total: number;
  ativos: number;
  suspensos: number;
  cancelados: number;
  /** undefined quando ha contrato mas o rotulo de estado e desconhecido. */
  status: "active" | "suspended" | "cancelled" | undefined;
  /** Plano do primeiro contrato ativo, ou do primeiro que houver. */
  plano?: string;
  /** Inicio do contrato escolhido, como o MK devolve (AAAA-MM-DD ou DD/MM/AAAA). */
  inicio?: string;
}

/** Chaves de envelope cujo NOME ja diz o estado, para item sem campo de status. */
const CHAVES_DE_ATIVO = new Set(["contratosativos"]);
const CHAVES_DE_INATIVO = new Set(["contratosinativos", "contratoscancelados", "contratosencerrados"]);

function estadoDoContrato(item: any, chaveDeOrigem: string | null): "ativo" | "suspenso" | "cancelado" | "outro" {
  // A V2 da NsLink entrega o estado em `status_contrato` (confirmado por probe
  // no Provedor.ai); `status` e `situacao` sao reserva para outras instalacoes.
  const s = String(
    item?.status_contrato ?? item?.StatusContrato ?? item?.status ?? item?.Status
    ?? item?.situacao ?? item?.Situacao ?? "",
  ).trim().toLowerCase();
  if (s) {
    if (s.startsWith("ativ") || s.startsWith("vigent") || s.startsWith("habilit")) return "ativo";
    if (s.startsWith("suspens") || s.startsWith("bloque")) return "suspenso";
    if (s.startsWith("cancel") || s.startsWith("inativ") || s.startsWith("encerr")
        || s.startsWith("desativ") || s.startsWith("desabilit") || s.startsWith("rescind")) return "cancelado";
    return "outro";
  }
  const k = (chaveDeOrigem ?? "").toLowerCase();
  if (CHAVES_DE_ATIVO.has(k)) return "ativo";
  if (CHAVES_DE_INATIVO.has(k)) return "cancelado";
  return "outro";
}

/**
 * Le a resposta de `WSMKContratosPorClienteV2` — ou de qualquer envelope da
 * mesma familia — e devolve o resumo. `null` quando o corpo NAO E LEGIVEL:
 * erro com HTTP 200, objeto sem nenhuma lista. Legivel e vazio e outra coisa,
 * e e justamente o caso que a porteira precisa distinguir.
 *
 * Soma TODAS as listas do envelope, seja qual for a chave: a V2 pode devolver
 * `Contratos[]` com todos os estados, ou `ContratosAtivos[]` e
 * `ContratosCancelados[]` separados. Contar so uma chave faria um cancelado
 * parecer "sem contrato" — e ele e o dado mais valioso que o bureau tem.
 */
export function classificarContratos(corpo: unknown): ContratosDoCliente | null {
  if (!corpo || typeof corpo !== "object") return null;

  const itens: Array<{ item: any; chave: string | null }> = [];
  if (Array.isArray(corpo)) {
    for (const it of corpo) itens.push({ item: it, chave: null });
  } else {
    const obj = corpo as Record<string, unknown>;
    // O MK responde erro com HTTP 200: `{CODIGO_ERRO, Mensagem, status: "ERRO"}`.
    if (String(obj.status ?? "").trim().toUpperCase() === "ERRO"
        || obj.CODIGO_ERRO !== undefined || obj["Num. ERRO"] !== undefined) return null;
    let algumaLista = false;
    for (const [k, v] of Object.entries(obj)) {
      if (!Array.isArray(v)) continue;
      algumaLista = true;
      for (const it of v) itens.push({ item: it, chave: k });
    }
    if (!algumaLista) return null;
  }

  const r: ContratosDoCliente = { total: 0, ativos: 0, suspensos: 0, cancelados: 0, status: undefined };
  const vistos = new Set<string>();
  let primeiro: any = null;
  let primeiroAtivo: any = null;
  for (const { item, chave } of itens) {
    if (!item || typeof item !== "object") continue;
    // O mesmo contrato pode vir em duas chaves; o codigo desduplica.
    const cod = String(item.codcontrato ?? item.CodContrato ?? item.codigo_contrato ?? item.codigo ?? "").trim();
    const marca = cod || `sem-codigo-${r.total}`;
    if (vistos.has(marca)) continue;
    vistos.add(marca);
    r.total++;
    const e = estadoDoContrato(item, chave);
    if (e === "ativo") { r.ativos++; primeiroAtivo ??= item; }
    else if (e === "suspenso") r.suspensos++;
    else if (e === "cancelado") r.cancelados++;
    primeiro ??= item;
  }

  r.status = r.ativos > 0 ? "active" : r.suspensos > 0 ? "suspended" : r.cancelados > 0 ? "cancelled" : undefined;
  const escolhido = primeiroAtivo ?? primeiro;
  if (escolhido) {
    const plano = escolhido.plano_acesso ?? escolhido.PlanoAcesso ?? escolhido.plano ?? escolhido.Plano;
    if (plano != null && String(plano).trim()) r.plano = String(plano).trim();
    const inicio = escolhido.adesao ?? escolhido.data_adesao ?? escolhido.data_ativacao
      ?? escolhido.DataAtivacao ?? escolhido.data_contrato ?? escolhido.DataContrato;
    if (inicio != null && String(inicio).trim()) r.inicio = String(inicio).trim();
  }
  return r;
}

/** De onde veio a leitura de contratos. Importa para a porteira: so a V2 prova "nenhum contrato". */
type LeituraDeContratos = { contratos: ContratosDoCliente; fonte: "v2" | "v1" };

/**
 * A porteira: `true` quando o cadastro NAO deve entrar na base.
 *
 * Exige prova positiva — a V2 respondeu e a lista veio vazia. A V1 so conhece
 * os ativos, entao "nenhum ativo" nela nao diz nada sobre cancelados.
 *
 * A situacao do cadastro e a segunda tranca: "Inativo" e evidencia de que a
 * pessoa foi cliente (ninguem inativa cadastro de quem nunca contratou), e
 * nesse caso o ex-cliente fica, mesmo que a V2 desta instalacao nao liste
 * contratos cancelados. Errar para o lado de manter o ex-cliente custa uma
 * conferencia; errar para o lado de descarta-lo apaga o dado mais valioso do
 * bureau.
 */
export function cadastroSemContrato(leitura: LeituraDeContratos | null | undefined, situacao: unknown): boolean {
  if (!leitura || leitura.fonte !== "v2" || leitura.contratos.total > 0) return false;
  return situacaoParaStatus(situacao) === undefined;
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

/**
 * A varredura da carteira nao terminou — um lote nao respondeu.
 *
 * Tem tipo proprio porque precisa NAO cair no fallback. `fetchDelinquents`
 * captura qualquer erro do V2 e tenta o caminho legado; para um erro comum isso
 * e o certo, mas para este e desastroso: o legado devolve `ok: true` sem
 * qualquer marca de incompletude, entao o sync trata a lista curta como leitura
 * boa e `baixarDividaQuitada` apaga a divida de quem ficou de fora. O abort que
 * existe justamente para impedir isso seria lavado pelo fallback.
 */
class VarreduraIncompleta extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VarreduraIncompleta";
  }
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
      // Fatura sem data legivel nao vira atraso — e contada para aparecer na
      // resposta, em vez de sumir em silencio.
      let faturasSemData = 0;
      // Conexao cortada: so o ESTADO, nunca uma divida inventada.
      let conexaoBloqueada = false;
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
              // Fatura a vencer nao e atraso, e fatura sem data legivel nao
              // vira "1 dia". Esta consulta ao vivo ainda fazia o que a
              // varredura deixou de fazer em 28/08/2026: "pelo menos 1 dia se
              // tem fatura pendente" — a mensalidade do mes, emitida dia 01 e
              // vencendo dia 20, virava inadimplencia na hora da consulta.
              const dias = diasDesdeVencimento(dueDate);
              if (dias === null) {
                faturasSemData++;
                console.log(`[MK] Fatura sem data de vencimento legivel, ignorada. Campos: ${Object.keys(f).join(", ")}`);
                continue;
              }
              if (dias <= 0) continue;
              totalOverdueAmount += valor;
              maxDaysOverdue = Math.max(maxDaysOverdue, dias);
              overdueInvoicesCount++;
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
                // Mesma regra do laco acima: nada de atraso inventado.
                const dias = diasDesdeVencimento(dueDate);
                if (dias === null) {
                  faturasSemData++;
                  console.log(`[MK] WSMKFaturas: fatura sem data legivel, ignorada. Campos: ${Object.keys(f).join(", ")}`);
                  continue;
                }
                if (dias <= 0) continue;
                totalOverdueAmount += valor;
                maxDaysOverdue = Math.max(maxDaysOverdue, dias);
                overdueInvoicesCount++;
              }
            } else {
              console.log(`[MK] WSMKFaturas retornou status ${altResponse.status}`);
            }
          } catch (altErr) {
            console.log(`[MK] WSMKFaturas fallback erro: ${altErr instanceof Error ? altErr.message : altErr}`);
          }
        }

        // Conexao bloqueada — so o ESTADO do servico. A versao anterior lia
        // bloqueio como "inadimplente ha 30 dias" e inventava uma fatura sem
        // valor: bloqueio pode ser a pedido, por fraude ou por outro motivo, e
        // num bureau atraso inventado nega instalacao a quem nao deve. Quem diz
        // se ha debito e a fatura pendente; a conexao so diz se esta cortado,
        // que vira "suspenso" no contrato mais abaixo.
        conexaoBloqueada = (await this.conexaoBloqueada(base, tokenAuth, String(cdCliente))) === true;
      }
      if (faturasSemData > 0) {
        console.log(`[MK] ${faturasSemData} fatura(s) sem data de vencimento legivel ficaram fora da conta`);
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
      // souber que o contrato esta vigente e ha quanto tempo. A V2 traz todos
      // os estados e a data de adesao; a V1 e a reserva (ver
      // lerContratosDoCliente). Cadastro sem contrato NENHUM fica sem sinal:
      // nao e "contrato encerrado", nunca houve um.
      let contractStatus: NormalizedErpCustomer["contractStatus"];
      let contractStartDate: string | undefined;
      let contractPlan: string | undefined;

      if (cdCliente) {
        const leitura = await this.lerContratosDoCliente(base, tokenAuth, String(cdCliente));
        if (leitura) {
          contractStatus = leitura.contratos.status;
          contractStartDate = leitura.contratos.inicio;
          contractPlan = leitura.contratos.plano;
        }
      }
      // A conexao cortada e o que diz "suspenso": a Situacao do cadastro so
      // sabe Ativo/Inativo, e o contrato segue "Ativo" enquanto esta cortado.
      if (conexaoBloqueada && contractStatus === "active") contractStatus = "suspended";

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
        message: (overdueInvoicesCount > 0
          ? `Cliente encontrado com ${overdueInvoicesCount} fatura(s) vencida(s)`
          : "Cliente encontrado sem inadimplencia")
          + (faturasSemData > 0 ? ` (${faturasSemData} fatura(s) sem data legivel, fora da conta)` : ""),
        customers: [customer],
        totalRecords: 1,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  /**
   * Alguma conexao do cliente esta bloqueada? `null` quando o MK nao respondeu
   * de forma legivel.
   *
   * `WSMKConexoesPorCliente` devolve `Conexoes[]` com `bloqueada` ('Sim'/'Não')
   * e `motivo_bloqueio`. E o que o Cobranca do Provedor.ai le para dizer
   * "suspenso": a Situacao do cadastro so sabe Ativo/Inativo e o contrato
   * continua "Ativo" enquanto esta cortado, entao sem isto todo devedor ativo
   * do MK aparecia como "em cobranca", conectado ou nao.
   *
   * Bloqueio NAO e divida. A conexao pode estar bloqueada a pedido ou por
   * outro motivo; quem diz se ha debito e a fatura pendente. Aqui so se le o
   * estado do servico.
   */
  private async conexaoBloqueada(base: string, tokenAuth: string, cd: string): Promise<boolean | null> {
    try {
      const url = `${base}/mk/WSMKConexoesPorCliente.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cd)}`;
      const resp = await fetch(url, { method: "GET", signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return null;
      const j: any = await resp.json().catch(() => null);
      if (!j || typeof j !== "object") return null;
      // Erro com HTTP 200 nao e "nenhuma conexao".
      if (String(j.status ?? "").trim().toUpperCase() === "ERRO" || j.CODIGO_ERRO !== undefined) return null;
      const conexoes: unknown = Array.isArray(j) ? j : (j.Conexoes ?? j.conexoes ?? j.registros ?? j.data);
      if (!Array.isArray(conexoes)) return null;
      return conexoes.some((c: any) => {
        const b = String(c?.bloqueada ?? c?.Bloqueada ?? c?.bloqueado ?? c?.Bloqueado ?? c?.blocked ?? "").trim().toLowerCase();
        return b === "sim" || b === "s" || b === "true" || b === "1";
      });
    } catch {
      return null;
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
    // Clientes cuja fatura nao pode ser lida. Sair da lista por nao dever e sair
    // Quem nao pode ser lido. Sair da lista por nao dever e sair por o MK nao
    // ter respondido davam o mesmo `null`, e quem chama nao tinha como separar
    // os dois — o sync tratava silencio como "esta em dia" e a baixa apagava o
    // debito de quem so nao foi lido.
    //
    // Quando o documento e conhecido ele vai para `naoLidos` e o sync o protege
    // individualmente; so o que nem da para nomear entra no contador, que
    // desliga a limpeza inteira.
    const naoLidos = new Set<string>();
    let leiturasFalhas = 0;
    // Cadastro sem contrato nenhum, mesmo com fatura pendente: nao entra na
    // base — ver cadastroSemContrato. Contado para aparecer no log do sync.
    let semContrato = 0;
    const naoLi = (cliente: any) => {
      const doc = String(cliente?.CPF_CNPJ ?? cliente?.cpf_cnpj ?? cliente?.CPF ?? cliente?.cpf ?? "").replace(/[^0-9]/g, "");
      if (doc) naoLidos.add(doc); else leiturasFalhas++;
      return null;
    };

    for (let i = 0; i < clientes.length; i += CONCURRENCY) {
      const batch = clientes.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (cliente: any) => {
          const cdPessoa = String(cliente.CodigoPessoa ?? cliente.codigopessoa ?? cliente.cd_pessoa ?? "");
          if (!cdPessoa) return naoLi(cliente);

          // 1. Faturas pendentes
          let faturas: any[] = [];
          try {
            const fpUrl = `${base}/mk/WSMKFaturasPendentes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`;
            const fpResp = await fetch(fpUrl, { method: "GET", signal: AbortSignal.timeout(15000) });
            if (!fpResp.ok) return naoLi(cliente);
            const fpJson: any = await fpResp.json().catch(() => null);
            // Envelope ausente e resposta ilegivel, nao "cliente sem fatura":
            // o MK devolve erro com HTTP 200.
            if (!fpJson || typeof fpJson !== "object") return naoLi(cliente);
            const pendentes = fpJson.FaturasPendentes ?? fpJson.faturas_pendentes;
            if (!Array.isArray(pendentes)) return naoLi(cliente);
            faturas = pendentes;
          } catch {
            return naoLi(cliente);
          }

          if (faturas.length === 0) return null; // nao deve nada — resposta boa
          processed++;

          // 2. Contrato vigente? So o endpoint de contratos responde isso —
          // a V2, com todos os estados; a V1 de reserva.
          //
          // O padrao NAO pode ser "cancelled": com ele, um timeout de 15s ou
          // um 500 do MK rebaixava cliente pagante a ex-cliente com divida —
          // exatamente a lista que o provedor usa para negar instalacao. Sem
          // resposta legivel a resposta certa e nao afirmar nada: o upsert so
          // grava status quando ele vem.
          //
          // E a porteira: cadastro que a V2 diz nao ter contrato NENHUM nao
          // entra, nem devendo. Fatura pendente sem contrato e taxa de
          // instalacao de quem desistiu, nao divida de cliente.
          const leitura = await this.lerContratosDoCliente(base, tokenAuth, cdPessoa);
          const situacao = cliente.Situacao ?? cliente.situacao;
          if (cadastroSemContrato(leitura, situacao)) { semContrato++; return null; }
          let contractStatus = leitura?.contratos.status ?? situacaoParaStatus(situacao);
          const contractPlan = leitura?.contratos.plano;
          const contractStartDate = leitura?.contratos.inicio;

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

          // Fatura ilegivel conta sempre, nao so quando derruba o cliente
          // inteiro: quem tem uma vencida e outra sem data ficava com o valor
          // incompleto e nada aparecia no diagnostico.
          if (semData > 0) semDataIgnoradas += semData;

          // Sem nenhuma fatura vencida o cliente nao e inadimplente. Ele
          // continua sendo atualizado pelo fetchCustomers, que varre a
          // carteira inteira — some desta lista, nao da base.
          if (vencidas === 0) return null;

          withPending++;

          // 3b. Cortado ou ainda conectado? So a conexao responde. Uma chamada
          // a mais, e so para quem deve — e a diferenca entre "em cobranca" e
          // "suspenso" no mapa, que para quem cobra e a que importa.
          if (contractStatus === "active") {
            const bloqueada = await this.conexaoBloqueada(base, tokenAuth, cdPessoa);
            if (bloqueada) contractStatus = "suspended";
          }

          // 4. Endereco de INSTALACAO — onde o servico foi montado, e o mesmo
          // que a varredura da carteira usa. O primeiro da lista as vezes e o
          // de COBRANCA, e o mesmo cliente mudava de bairro entre os dois
          // passos do sync.
          const ends = this.enderecosDoCliente(cliente);
          const end = ends.find(e => String(e.tipo ?? e.Tipo ?? "").toUpperCase() === "INSTALACAO") ?? ends[0] ?? null;
          const coordDe = (o: any): [string, string] | null => {
            const la = o?.Latitude ?? o?.latitude;
            const lo = o?.Longitude ?? o?.longitude;
            return la != null && String(la).trim() && lo != null && String(lo).trim()
              ? [String(la).trim(), String(lo).trim()] : null;
          };
          const coord = coordDe(cliente) ?? coordDe(end);

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
            latitude: coord?.[0],
            longitude: coord?.[1],
            totalOverdueAmount: totalAmount,
            maxDaysOverdue: maxDays,
            overdueInvoicesCount: vencidas,
            contractStatus,
            contractPlan,
            contractStartDate,
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
    const totalNaoLidos = naoLidos.size + leiturasFalhas;
    if (totalNaoLidos > 0) {
      console.log(
        `[MK v2] ${totalNaoLidos} clientes nao puderam ser lidos `
        + `(${naoLidos.size} identificados, ${leiturasFalhas} sem documento)`,
      );
    }
    if (semContrato > 0) {
      console.log(`[MK v2] ${semContrato} cadastro(s) com fatura pendente mas sem contrato nenhum — nao entram na base`);
    }
    const notas = [
      totalNaoLidos > 0 ? `${totalNaoLidos} clientes nao lidos` : "",
      semContrato > 0 ? `${semContrato} sem contrato ignorados` : "",
    ].filter(Boolean);
    return {
      ok: true,
      message: `${results.length} inadimplentes encontrados (v2 per-customer)`
        + (notas.length ? `, ${notas.join(", ")}` : ""),
      customers: results,
      docsNaoLidos: Array.from(naoLidos),
      leiturasFalhas,
      totalRecords: results.length,
    };
  }

  async fetchDelinquents(config: ErpConnectionConfig, _lastDays?: number): Promise<ErpFetchResult> {
    // V2 — estratégia per-customer (datas reais + status contrato).
    // Substituiu o WSMKFaturasAbertas porque aquele endpoint retorna lixo
    // (Status=Cancelado, sem data) — confirmado em prod.
    try {
      const v2Result = await this.fetchDelinquentsV2(config);
      // `ok` basta: LISTA VAZIA E RESPOSTA, nao ausencia de resposta.
      //
      // A condicao antes exigia `customers.length > 0`, e isso era inofensivo
      // enquanto o V2 forcava "1 dia" para qualquer fatura pendente e portanto
      // nunca devolvia zero. Agora que fatura a vencer nao conta como atraso,
      // uma carteira em dia devolve zero legitimamente — e cair no legado por
      // causa disso troca a resposta certa (ninguem esta em atraso) pelo
      // endpoint que o comentario acima descreve como lixo.
      if (v2Result.ok) {
        return v2Result;
      }
      console.log(`[MK] V2 recusou (${v2Result.message}), caindo p/ legacy WSMKFaturasAbertas`);
    } catch (err) {
      // Varredura abortada NAO cai no fallback.
      //
      // O legado devolve `ok: true` sem marca de incompletude, entao o sync
      // trataria a lista curta como leitura boa e a baixa apagaria a divida de
      // quem ficou de fora — o mesmo estrago que o abort existe para impedir,
      // so que entrando pela porta dos fundos.
      if (err instanceof VarreduraIncompleta) {
        console.warn(`[MK] ${err.message} — nao vou tentar o legado com base parcial`);
        return { ok: false, message: err.message, customers: [] };
      }
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
              // Fatura a vencer nao e atraso, e fatura sem data legivel nao
              // vira "1 dia". Era a fabricacao que punha 641 dos 935
              // inadimplentes da NsLink com exatamente 1 dia — todos com a
              // mensalidade do mes ainda no prazo. `days <= 0 && dueDate`
              // deixava passar justamente a fatura SEM data, que e a que o
              // WSMKFaturasAbertas mais devolve.
              const dias = diasDesdeVencimento(dueDate);
              if (dias === null || dias <= 0) continue;

              allInvoices.push({
                ...customerData,
                phone: customerData.phone ? cleanPhone(customerData.phone) : undefined,
                amount: pickAmount(f),
                daysOverdue: dias,
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
        // LEITURA PARCIAL, declarada.
        //
        // `WSMKFaturasAbertas` devolve FATURAS de um periodo, nao clientes.
        // Por isso ela nao serve de prova NEGATIVA: o sync nao pode baixar a
        // divida de quem nao aparece aqui, porque "nao aparece" nao significa
        // "nao deve". Sem esta marca, qualquer queda para o legado devolvia
        // `ok: true` sem sinal de incompletude e a baixa apagava debito real —
        // a mesma falha que o abort da varredura evita no caminho principal,
        // entrando por aqui.
        leituraParcial: true,
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
   *
   * LANCA na primeira falha de lote, em vez de seguir com o que deu. Devolver
   * carteira parcial com cara de completa e pior do que nao devolver nada — ver
   * o comentario no corpo do laco.
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
      let motivoDaFalha: string | undefined;
      try {
        const resp = await fetch(url, { method: "GET", signal: AbortSignal.timeout(120000) });
        if (resp.status === 404 || resp.status === 204) { vazios++; }
        else if (!resp.ok) { motivoDaFalha = `HTTP ${resp.status}`; }
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
      } catch (err: unknown) {
        motivoDaFalha = err instanceof Error ? err.message : "erro de rede";
      }

      // Falha de lote DERRUBA a varredura, e de proposito.
      //
      // A primeira versao disto contava timeout e HTTP 500 no mesmo contador de
      // "lote vazio", "porque o resto da base vale mais do que nada". Vale menos
      // do que nada: tres blips seguidos faziam a funcao devolver meia carteira
      // com cara de carteira inteira, e quem chama nao tinha como saber. O passo
      // 3 do sync entao rodava `baixarDividaQuitada` com a lista curta e ZERAVA
      // a divida de todo devedor ativo que ficou de fora — no bureau, "nada
      // consta" para quem deve. Esse UPDATE nunca tinha rodado de verdade
      // (estava quebrado por um bind de array ate hoje), entao a combinacao e
      // nova e nao foi observada em producao; e a razao de abortar alto aqui.
      if (motivoDaFalha) {
        throw new VarreduraIncompleta(
          `WSMKConsultaClientes falhou na faixa ${ini}-${fim} (${motivoDaFalha}) — `
          + `varredura abortada com ${porId.size} clientes lidos, para nao passar `
          + `carteira parcial como completa`,
        );
      }
      if (vazios >= VAZIOS_SEGUIDOS) break;
    }

    console.log(`[MK] listarTodosClientes: ${porId.size} clientes (varredura por faixa de codigo)`);
    return Array.from(porId.values());
  }

  /**
   * Contratos de UM cliente: pela V2 e, se ela nao existir nesta instalacao,
   * pela V1. `null` quando nenhuma das duas respondeu de forma legivel.
   *
   * A V2 (`WSMKContratosPorClienteV2`) devolve contratos de TODOS os estados
   * com `status_contrato` — e a unica que distingue "nunca teve contrato" de
   * "teve e cancelou". A V1 so lista os ativos: serve para afirmar "ativo" e
   * para dizer "nenhum ativo", nunca "nenhum contrato". A porteira da base so
   * fecha com a V2; ver `cadastroSemContrato`.
   *
   * O envelope precisa ESTAR la. O MK responde erro com HTTP 200 —
   * `{"CODIGO_ERRO":"004","Mensagem":"...","status":"ERRO"}` — e ler esse corpo
   * como "zero contratos" rebaixava cliente pagante a ex-cliente com divida,
   * que e a lista usada para negar instalacao.
   *
   * `tentarV2` desliga a V2 para a passada inteira quando ela se mostrou
   * inexistente: instalacao antiga responderia 404 para cada um dos milhares
   * de clientes, dobrando o custo da varredura para nada.
   */
  private async lerContratosDoCliente(
    base: string,
    tokenAuth: string,
    cd: string,
    tentarV2 = true,
  ): Promise<LeituraDeContratos | null> {
    const ler = async (rule: string): Promise<unknown> => {
      try {
        const url = `${base}/mk/${rule}?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cd)}`;
        const resp = await fetch(url, { method: "GET", signal: AbortSignal.timeout(15000) });
        if (!resp.ok) return null;
        return await resp.json().catch(() => null);
      } catch {
        return null;
      }
    };

    if (tentarV2) {
      const v2 = classificarContratos(await ler("WSMKContratosPorClienteV2.rule"));
      if (v2) return { contratos: v2, fonte: "v2" };
    }

    const j1: any = await ler("WSMKContratosPorCliente.rule");
    const ativos = j1?.ContratosAtivos;
    if (!Array.isArray(ativos)) return null;
    const plano = ativos[0]?.plano_acesso ?? ativos[0]?.PlanoAcesso;
    return {
      fonte: "v1",
      contratos: {
        total: ativos.length, ativos: ativos.length, suspensos: 0, cancelados: 0,
        status: ativos.length > 0 ? "active" : "cancelled",
        plano: plano != null && String(plano).trim() ? String(plano).trim() : undefined,
      },
    };
  }

  /**
   * Contratos por cliente, perguntados um a um.
   *
   * `WSMKConsultaClientes` devolve `Situacao`, que descreve o CADASTRO e nao o
   * vinculo: medido na NsLink em 28/08/2026, 560 cadastros "Ativo" nao tinham
   * contrato nenhum. Por isso `situacaoParaStatus` se recusa a ler "Ativo" como
   * contrato vigente — mas com isso ela tambem nao consegue AFIRMAR que alguem
   * deixou de ser cliente, e 54 ex-clientes seguiam ativos no bureau porque nao
   * tinham fatura pendente e por isso nunca chegavam ao passo que checa contrato.
   *
   * Quem responde e o endpoint de contratos, e so ele. Uma chamada por cliente
   * e caro (3.226 na NsLink, ~3 min a 8 de concorrencia), mas `fetchCustomers` e
   * varredura de lote, roda 3x por semana e e o unico ponto que ve a carteira
   * inteira. A consulta ao vivo nao passa por aqui — usa `fetchCustomerByCpf`.
   *
   * NAO troque isto pelo array `contratos` que vem embutido em cada cliente da
   * lista — a tentacao e obvia, porque economizaria as 3.226 chamadas. Ele e
   * incompleto: conferidos 40 clientes da NsLink contra o endpoint dedicado, 2
   * tinham contrato ativo e array embutido vazio (544 contra 580 no total). O
   * erro cai para o lado ruim — ex-cliente inventado a partir de quem paga.
   *
   * Cliente sem resposta legivel fica de fora do mapa, e quem chama decide o
   * que fazer com ele.
   */
  private async contratosPorCliente(
    base: string,
    tokenAuth: string,
    codigos: string[],
  ): Promise<Map<string, LeituraDeContratos>> {
    const CONCORRENCIA = 8;
    const AMOSTRA_V2 = 16;
    const mapa = new Map<string, LeituraDeContratos>();
    let semResposta = 0;
    let porV2 = 0;
    let porV1 = 0;
    let tentarV2 = true;

    for (let i = 0; i < codigos.length; i += CONCORRENCIA) {
      const lote = codigos.slice(i, i + CONCORRENCIA);
      await Promise.all(lote.map(async (cd) => {
        const leitura = await this.lerContratosDoCliente(base, tokenAuth, cd, tentarV2);
        if (!leitura) { semResposta++; return; }
        if (leitura.fonte === "v2") porV2++; else porV1++;
        mapa.set(cd, leitura);
      }));
      // Amostra inicial sem nenhuma V2 e com V1 respondendo: esta instalacao
      // nao tem a V2. Para de tentar.
      if (tentarV2 && i + CONCORRENCIA >= AMOSTRA_V2 && porV2 === 0 && porV1 > 0) {
        tentarV2 = false;
        console.warn(`[MK] WSMKContratosPorClienteV2 indisponivel nesta instalacao — seguindo pela V1, que nao distingue cadastro sem contrato de ex-cliente`);
      }
    }

    console.log(`[MK] contratosPorCliente: ${mapa.size} respondidos (${porV2} pela V2, ${porV1} pela V1), ${semResposta} sem resposta`);
    return mapa;
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

      // Contrato vigente e pergunta separada — ver contratosPorCliente.
      const codigos = allClients
        .map(r => String(r?.CodigoPessoa ?? r?.codigopessoa ?? r?.cd_pessoa ?? r?.id ?? ""))
        .filter(Boolean);
      const contratos = await this.contratosPorCliente(base, tokenAuth, codigos);

      // Nenhum cliente com resposta de contrato e o endpoint fora do ar, nao
      // uma carteira sem contratos. Importar tudo as cegas abriria a porteira
      // para os cadastros sem contrato; nao importar ninguem com `ok: true`
      // seria lido como "este provedor nao tem cliente". Falha alto.
      if (codigos.length > 0 && contratos.size === 0) {
        return {
          ok: false,
          message: `WSMKContratosPorCliente nao respondeu para nenhum dos ${codigos.length} clientes — carteira nao importada`,
          customers: [],
        };
      }

      let semContrato = 0;
      let semResposta = 0;

      const customers: NormalizedErpCustomer[] = allClients
        .map(row => {
          const cpfCnpj = cleanCpfCnpj(row.CPF_CNPJ || row.cpf_cnpj || row.CPF || row.cpf || "");
          if (!cpfCnpj) return null;

          const cd = String(row.CodigoPessoa ?? row.codigopessoa ?? row.cd_pessoa ?? row.id ?? "");
          const leitura = contratos.get(cd);
          const situacao = row.Situacao ?? row.situacao;

          // A PORTEIRA. Cadastro sem contrato nenhum nao entra na base —
          // ver cadastroSemContrato. E quem nao respondeu tambem fica de fora
          // desta passada: sem prova de contrato nao ha o que importar, e a
          // linha que ja existe nao e apagada por isso. So perde um refresh.
          if (cadastroSemContrato(leitura, situacao)) { semContrato++; return null; }
          if (!leitura) { semResposta++; return null; }

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
            // O endpoint de contratos e a autoridade; a Situacao do cadastro
            // e a reserva para quando ele nao soube dizer — e mesmo assim so
            // consegue dizer "cancelado", nunca "ativo".
            contractStatus: leitura.contratos.status ?? situacaoParaStatus(situacao),
            contractPlan: leitura.contratos.plano,
            contractStartDate: leitura.contratos.inicio,
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

      if (semContrato > 0) {
        console.log(`[MK] fetchCustomers: ${semContrato} cadastro(s) sem contrato nenhum — nao entram na base`);
      }
      if (semResposta > 0) {
        console.warn(`[MK] fetchCustomers: ${semResposta} cliente(s) sem resposta de contrato — ficam para a proxima passada`);
      }
      const notas = [
        semContrato > 0 ? `${semContrato} sem contrato ignorados` : "",
        semResposta > 0 ? `${semResposta} sem resposta de contrato` : "",
      ].filter(Boolean);

      return {
        ok: true,
        message: `${customers.length} clientes encontrados` + (notas.length ? `, ${notas.join(", ")}` : ""),
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

            // `CPF_CNPJ` e o nome do campo no MK; o resto e tolerancia a outras
            // instalacoes.
            const cpfCnpj = cleanCpfCnpj(
              cliente.CPF_CNPJ || cliente.cpf_cnpj || cliente.CPF || cliente.cpf
              || cliente.CNPJ || cliente.cnpj || cliente.Doc || cliente.doc || cliente.documento || "",
            );
            if (!cpfCnpj) return [];

            return faturas
              .map((f: any) => {
                // Aliases expandidos — cobre todas variantes conhecidas do MK
                const dueDate = f.data_vencimento || f.DataVencimento || f.dt_vencimento || f.DtVencimento
                  || f.vencimento || f.Vencimento || f.dt_venc || f.dtVenc
                  || f.dt_vencto || f.DtVencto || f.vencto || f.Vencto
                  || f.data_vencto || f.DataVencto || f.dtVencimento || f.dtVencto
                  || f.data_venc || f.DataVenc || f.dataVencimento || null;
                // Mesma regra do sitio acima: nada de atraso inventado.
                const dias = diasDesdeVencimento(dueDate);
                if (dias === null || dias <= 0) return null;
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
                  daysOverdue: dias,
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
      // LEITURA PARCIAL, declarada.
      //
      // Este caminho descarta cliente em silencio quando a fatura nao responde.
      // Por isso ela nao serve de prova NEGATIVA: o sync nao pode baixar a
      // divida de quem nao aparece aqui, porque "nao aparece" nao significa
      // "nao deve". Sem esta marca, qualquer queda para o legado devolvia
      // `ok: true` sem sinal de incompletude e a baixa apagava debito real —
      // a mesma falha que o abort da varredura evita no caminho principal,
      // entrando por aqui.
      leituraParcial: true,
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
    /**
     * Devolve O ENDERECO que casou, ou `null` quando o cliente nao serve.
     *
     * Nao e booleano de proposito: o predicado procura em TODOS os enderecos
     * do cliente (instalacao e cobranca), e o mapeamento pegava sempre o
     * `[0]`. O casamento acontecia na instalacao e a resposta saia com o
     * endereco de cobranca — outra rua, as vezes outra cidade.
     */
    filtro: (linha: any) => Record<string, any> | null,
    rotulo: string,
  ): Promise<ErpFetchResult> {
    try {
      const tokenAuth = await this.authenticate(config);
      const base = this.baseUrl(config);

      // A carteira inteira, pela varredura por faixa.
      //
      // O que havia aqui era `WSMKConsultaClientes.rule?sys=MK0&token=...` e mais
      // nada. O MK recusa: HTTP 200 com corpo
      // `{"CODIGO_ERRO":"004","Mensagem":"Pelo menos um parametro deve ser
      // informado."}`. Como o status e 200, `response.ok` passava, o parse nao
      // achava lista e a funcao respondia "Nenhum cliente encontrado" — uma
      // resposta limpa, confiante e errada. Consulta por endereco e por CEP
      // contra o MK nunca devolveram nada. Verificado na NsLink em 28/08/2026.
      console.log(`[MK] Buscando clientes (${rotulo}) via varredura por faixa`);
      const rows = await this.listarTodosClientes(base, tokenAuth);
      if (rows.length === 0) {
        return { ok: false, message: "MK nao devolveu nenhum cliente na varredura", customers: [] };
      }

      const matchingClientes = rows
        .map(r => ({ cliente: r, enderecoCasado: filtro(r) }))
        .filter(x => x.enderecoCasado !== null);

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
          batch.map(async ({ cliente, enderecoCasado }: any) => {
            // `CPF_CNPJ` primeiro: e o nome do campo no MK. A lista antiga
            // (Doc/doc/cpf/cnpj/cpf_cnpj) nao continha nenhum campo existente
            // neste payload, entao todo casamento virava null — a busca por
            // endereco achava gente na rua e devolvia zero.
            const cpfCnpj = cleanCpfCnpj(
              cliente.CPF_CNPJ || cliente.cpf_cnpj || cliente.CPF || cliente.cpf
              || cliente.CNPJ || cliente.cnpj || cliente.Doc || cliente.doc || "",
            );
            if (!cpfCnpj) return null;

            // O endereco que o predicado casou, nao o primeiro da lista.
            const end = enderecoCasado ?? this.enderecosDoCliente(cliente)[0] ?? {};

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
                    // Mesma regra do fetchDelinquentsV2: fatura a vencer nao e
                    // atraso, e fatura sem data legivel nao vira "1 dia".
                    const dias = diasDesdeVencimento(dueDate);
                    if (dias !== null && dias > 0) {
                      totalOverdueAmount += valor;
                      maxDaysOverdue = Math.max(maxDaysOverdue, dias);
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
              address: end.logradouro ?? end.Logradouro ?? undefined,
              addressNumber: end.numero != null && end.numero !== "" ? String(end.numero) : undefined,
              neighborhood: end.bairro ?? end.Bairro ?? undefined,
              city: end.cidade ?? end.Cidade ?? cliente.Cidade ?? cliente.cidade ?? undefined,
              state: end.estado ?? end.uf ?? cliente.UF ?? cliente.uf ?? undefined,
              cep: end.cep ?? end.CEP ?? undefined,
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
  /**
   * Os enderecos de um cliente, seja qual for a forma que o MK usou.
   *
   * `WSMKConsultaClientes` devolve `endereco` como ARRAY de objetos — um por
   * tipo (INSTALACAO, COBRANCA) — com logradouro, numero, bairro, cidade, cep.
   * Os predicados de busca liam `r.CEP` e `r.endereco` como se fossem texto na
   * raiz, campos que nao existem nesse payload: a busca por CEP e por endereco
   * varria os 3.226 clientes e casava zero. Outras instalacoes devolvem objeto
   * unico ou texto corrido, entao as tres formas continuam aceitas.
   */
  private enderecosDoCliente(r: any): Array<Record<string, any>> {
    const bruto = r?.endereco ?? r?.Endereco ?? r?.enderecos ?? r?.Enderecos;
    if (Array.isArray(bruto)) return bruto.filter(e => e && typeof e === "object");
    if (bruto && typeof bruto === "object") return [bruto];
    // Texto corrido ("Rua Mato Grosso, 1435 - Centro, Londrina") vira um objeto
    // so com logradouro; o resto dos campos fica indefinido de proposito.
    if (typeof bruto === "string" && bruto.trim()) return [{ logradouro: bruto }];
    const solto = r?.Logradouro ?? r?.logradouro;
    return solto ? [{ logradouro: solto, cidade: r?.Cidade ?? r?.cidade, cep: r?.CEP ?? r?.cep }] : [];
  }

  async fetchCustomersByCep(config: ErpConnectionConfig, cep: string): Promise<ErpFetchResult> {
    const alvo = cep.replace(/\D/g, "");
    return this.clientesPorFiltro(
      config,
      (r: any) => this.enderecosDoCliente(r).find(e =>
        String(e.cep ?? e.CEP ?? "").replace(/[^0-9]/g, "").startsWith(alvo)) ?? null,
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
      (r: any) => this.enderecosDoCliente(r).find(e => {
        const bruto = e.logradouro ?? e.Logradouro ?? e.endereco ?? e.Endereco ?? "";
        // O logradouro pode vir com o numero grudado; corta no primeiro
        // separador antes de comparar.
        const rua = chaveLogradouro(String(bruto).split(/[,-]/)[0]);
        if (!rua || rua !== ruaAlvo) return false;

        if (!cidadeAlvo) return true;
        const cidade = normalizarLocalidade(
          e.cidade ?? e.Cidade ?? e.municipio ?? e.Municipio ?? r.Cidade ?? r.cidade ?? "",
        );
        // Cidade ausente no cadastro nao descarta: cadastro incompleto nao e
        // prova de que e outra cidade.
        return !cidade || cidade === cidadeAlvo;
      }) ?? null,
      `${ruaAlvo}${cidadeAlvo ? ` / ${cidadeAlvo}` : ""}`,
    );
  }

}
