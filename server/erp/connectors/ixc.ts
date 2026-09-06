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
  FaturaAbertaDoErp,
} from "../types.js";
import { CircuitBreaker, withResilience } from "../resilience.js";
import { normalizarPagamento } from "@shared/cobranca/pagamento-chat";
import { cleanCpfCnpj, cleanCep, cleanPhone, calculateDaysOverdue, diasDesdeVencimento, vencimentoIso, aggregateByCustomer } from "../normalize.js";

/**
 * As faturas em aberto de `fn_areceber`, agrupadas por `id_cliente` — VENCIDAS
 * e A VENCER, so as de data legivel.
 *
 * `ref` e o `id` da fatura no IXC (a chave da tabela `fn_areceber`); `valor` e
 * o mesmo campo que a divida soma (`valor`, com `valor_original` de reserva),
 * para que a soma das faturas do cliente bata com `totalOverdueAmount`. A
 * fatura nao carrega CPF — quem a liga ao cliente e `id_cliente`, o mesmo
 * mapeamento que os tres leitores desta classe ja usam.
 */
export function faturasAbertasPorCliente(rows: any[]): Map<string, FaturaAbertaDoErp[]> {
  const mapa = new Map<string, FaturaAbertaDoErp[]>();
  for (const row of rows) {
    const cid = String(row?.id_cliente || "");
    const ref = String(row?.id ?? "").trim();
    const vencimento = vencimentoIso(row?.data_vencimento);
    if (!cid || !ref || !vencimento) continue;
    const valor = parseFloat(row.valor || row.valor_original || "0") || 0;
    const obs = typeof row.obs === "string" && row.obs.trim() ? row.obs.trim() : null;
    const lista = mapa.get(cid);
    const fatura: FaturaAbertaDoErp = { ref, vencimento, valor, descricao: obs };
    if (row.linha_digitavel) fatura.pagamento = normalizarPagamento({ linhaDigitavel: row.linha_digitavel, valor, vencimento });
    if (lista) lista.push(fatura); else mapa.set(cid, [fatura]);
  }
  return mapa;
}

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

/**
 * As linhas de uma resposta do IXC — ou o motivo de ela nao ser do IXC.
 *
 * O envelope do IXC e `{ page, total, registros }`. Ler so `json?.registros ||
 * []` transformava QUALQUER 200 com JSON — o `{}` de um proxy, o corpo de outro
 * sistema no mesmo dominio — em "nenhum registro". No caminho do sync essa e a
 * forma mais perigosa de erro: lista vazia com `ok: true` vira prova NEGATIVA e
 * a baixa de divida apaga o debito da carteira inteira, como aconteceu na O L I
 * em 31/08/2026 por outro motivo. Sem envelope reconhecivel nao se afirma nada.
 *
 * `total`/`page`/`type` sozinhos ja identificam o IXC: a resposta sem nenhum
 * registro varia entre versoes e nem sempre traz o array.
 */
function linhasDoIxc(json: any): { ok: true; registros: any[] } | { ok: false; motivo: string } {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    if (Array.isArray(json.registros)) return { ok: true, registros: json.registros };
    if (json.total !== undefined || json.page !== undefined || json.type !== undefined) {
      return { ok: true, registros: [] };
    }
    return { ok: false, motivo: `objeto sem 'registros' (chaves: ${Object.keys(json).slice(0, 6).join(", ") || "nenhuma"})` };
  }
  return { ok: false, motivo: `resposta ${Array.isArray(json) ? "em array" : typeof json} sem envelope` };
}

/** grid_param filter entry */
interface IxcFilter {
  TB: string;
  OP: "=" | ">=" | ">" | "<=" | "<" | "L" | "!=";
  P: string;
  C: "AND" | "OR";
  G: string;
}

/**
 * O que e uma fatura EM ABERTO no IXC: status A e liberada.
 *
 * Status: A=aberta, R=recebida, C=cancelada. O `liberado = S` veio do conector
 * do Provedor.ai (a forma esta em tres SDKs independentes do IXC): fatura nao
 * liberada ainda nao foi apresentada ao cliente, e contar atraso dela num
 * bureau seria acusar sem ter cobrado.
 */
const FATURA_ABERTA: readonly IxcFilter[] = [
  { TB: "fn_areceber.status", OP: "=", P: "A", C: "AND", G: "" },
  { TB: "fn_areceber.liberado", OP: "=", P: "S", C: "AND", G: "" },
];

/** Os contratos de um cliente, resumidos — ver contratosPorClienteBulk. */
interface ContratoResumo {
  total: number;
  ativos: number;
  /** Algum contrato ativo com status_internet FA: cortado por atraso, ainda cliente. */
  algumFA: boolean;
  plano: string;
  inicio: string;
}

export class IxcConnector implements ErpConnector {
  readonly name = "ixc";
  readonly label = "IXC Soft";

  /** Unico conector que hoje traz comodato: fn_radpop_radio_cliente + fn_areceber. */
  readonly supportsEquipment = true;

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

      const envelope = linhasDoIxc(json);
      if (!envelope.ok) {
        throw new Error(`IXC ${tabela}: resposta 200 fora do formato do IXC — ${envelope.motivo}`);
      }

      const registros: any[] = envelope.registros;
      const total = parseInt(json?.total, 10) || 0;
      allRows.push(...registros);

      if (allRows.length >= total || registros.length < rp) break;
      page++;

      // Teto de paginas alcancado com o IXC ainda tendo o que entregar.
      //
      // Isto retornava em silencio: quem chamava recebia uma lista parcial
      // indistinguivel de uma completa. Com rp=200 e maxPages=50 o teto era
      // 10.000 linhas, e a O L I tem 42.883 faturas em aberto — a conta de
      // divida sairia truncada sem uma linha de log dizendo isso.
      if (page > maxPages) {
        console.warn(
          `[IXC] ${tabela}: TRUNCADO em ${allRows.length} de ${total} registros ` +
          `(teto de ${maxPages} paginas x ${rp}). O resultado esta INCOMPLETO.`,
        );
      }
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
      if (!response.ok) {
        return { ok: false, message: `IXC retornou HTTP ${response.status}`, latencyMs };
      }

      // Status 200 nao prova que quem respondeu e o IXC. Pagina de login, portal
      // cativo e proxy mal apontado respondem 200 — e um teste que diz "ok" para
      // eles e pior que nenhum teste: o operador liga a integracao, a varredura
      // roda contra a pagina errada, nao acha ninguem e a lista vazia vira prova
      // de que ninguem deve.
      const corpo = await response.text();
      let data: any;
      try {
        data = JSON.parse(corpo);
      } catch {
        return {
          ok: false,
          message: "O endereco respondeu, mas nao com JSON do IXC (veio uma pagina). Informe a raiz do sistema IXC, sem caminho nem parametros.",
          latencyMs,
        };
      }

      // O IXC devolve {"type":"error"} com HTTP 200 em erro de token e de IP nao
      // liberado. `listAll` sempre tratou isso; o teste de conexao nao, e por
      // isso IP bloqueado no painel do IXC aparecia na tela como "Conexao OK".
      if (data?.type === "error") {
        return {
          ok: false,
          message: `IXC recusou: ${data.message || "erro sem descricao"}. Confira o token e se o IP do servidor esta liberado no painel do IXC.`,
          latencyMs,
        };
      }

      const envelope = linhasDoIxc(data);
      if (!envelope.ok) {
        return {
          ok: false,
          message: `Respondeu 200, mas nao no formato do IXC — ${envelope.motivo}. Confirme a URL do servidor IXC.`,
          latencyMs,
        };
      }

      return { ok: true, message: `Conexao OK — IXC Soft (${data.total ?? "?"} clientes)`, latencyMs };
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro de conexao: ${msg}`, latencyMs };
    }
  }

  /**
   * Inadimplentes pelas faturas em aberto e vencidas — ATIVOS e ex-clientes.
   *
   * A fatura (`fn_areceber`) NAO carrega CPF nem nome: o campo `documento` e o
   * numero do boleto. A versao anterior lia o documento DA FATURA, e desde que
   * `cleanCpfCnpj` passou a recusar numero de boleto (29/08/2026) ela devolvia
   * ZERO inadimplentes ativos com `ok: true` — e o passo 3 do sync, lendo a
   * lista curta como completa, baixava a divida de quem estava gravado como
   * devedor ativo. O devedor ainda conectado, que e o que mais interessa a
   * quem cobra, sumia do bureau a cada sync. Agora o CPF vem do cadastro
   * (`cliente.cnpj_cpf`), buscado em LOTE — a versao anterior fazia uma
   * requisicao por cliente, milhares na base da O L I.
   *
   * `lastDays` NAO tem valor padrao: sem ele, nao ha recorte de data e o valor
   * devolvido e a divida inteira. O padrao de 365 dias descartava toda fatura
   * vencida ha mais de um ano — justamente a do devedor antigo, que e quem mais
   * importa para o bureau. Medido na O L I: ha atraso chegando a 6.397 dias,
   * ou seja 17 anos, que o recorte jogava fora.
   *
   * Paginacao rp=500 x 200 paginas (100.000 faturas), a mesma de
   * `fetchCancelledDelinquents`; so a O L I tem 42.883 faturas em aberto.
   */
  async fetchDelinquents(config: ErpConnectionConfig, lastDays?: number): Promise<ErpFetchResult> {
    try {
      const filtros: IxcFilter[] = [...FATURA_ABERTA];
      if (lastDays && lastDays > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - lastDays);
        filtros.push({
          TB: "fn_areceber.data_vencimento", OP: ">=",
          P: cutoffDate.toISOString().split("T")[0], C: "AND", G: "",
        });
      }

      const allRows = await this.listWithFilter(config, "fn_areceber", filtros, 500, 200);

      // 1. Divida por cliente. Vencida = ao menos UM DIA de atraso, contado por
      // dia de calendario: `new Date(dueDate) < now` sobre o AAAA-MM-DD do IXC
      // comparava meia-noite UTC com o instante local e a fatura que vence HOJE
      // ja contava. Fatura sem data legivel fica de fora, nunca vira "1 dia".
      const porCliente = new Map<string, { totalAmount: number; maxDays: number; count: number }>();
      let semData = 0;
      for (const row of allRows) {
        const dias = diasDesdeVencimento(row.data_vencimento);
        if (dias === null) { semData++; continue; }
        if (dias <= 0) continue;
        const cid = String(row.id_cliente || "");
        if (!cid) continue;
        const amount = parseFloat(row.valor || row.valor_original || "0") || 0;
        const e = porCliente.get(cid);
        if (e) {
          e.totalAmount += amount;
          if (dias > e.maxDays) e.maxDays = dias;
          e.count++;
        } else {
          porCliente.set(cid, { totalAmount: amount, maxDays: dias, count: 1 });
        }
      }
      console.log(
        `[IXC] fetchDelinquents: ${allRows.length} faturas abertas, ${porCliente.size} clientes com fatura vencida`
        + (semData > 0 ? `, ${semData} sem data legivel` : ""),
      );

      if (porCliente.size === 0) {
        return { ok: true, message: `Nenhuma fatura vencida em aberto (${allRows.length} faturas abertas)`, customers: [], totalRecords: 0 };
      }

      // 2. Cadastro, cidade e contratos — tudo em lote.
      const clienteMap = await this.clientesPorId(config, new Set(porCliente.keys()), "fetchDelinquents");
      const cidadeMap = await this.bulkResolveCidadeUf(config);
      const contratos = await this.contratosPorClienteBulk(config);
      // As faturas do devedor, uma a uma (vencidas e a vencer) — das mesmas
      // linhas ja lidas, sem ida a mais ao IXC.
      const abertasPorCliente = faturasAbertasPorCliente(allRows);

      let semCadastro = 0;
      let semDocumento = 0;
      let semContrato = 0;
      const customers: NormalizedErpCustomer[] = [];
      for (const [cid, overdue] of Array.from(porCliente.entries())) {
        const c = clienteMap.get(cid);
        if (!c) { semCadastro++; continue; }
        // `cnpj_cpf` e o nome REAL do campo na tabela `cliente` do IXC.
        const cpfCnpj = cleanCpfCnpj(c.cnpj_cpf || c.cpf_cnpj || "");
        if (!cpfCnpj) { semDocumento++; continue; }
        // A porteira: cadastro sem contrato nenhum nao entra na base, nem
        // devendo — fatura sem contrato e taxa de quem desistiu, nao divida de
        // cliente. So com a tabela de contratos lida; sem ela nao se afirma.
        const resumo = contratos.mapa.get(cid);
        if (contratos.lidos && !resumo) { semContrato++; continue; }
        const loc = this.resolveCityState(c, cidadeMap);
        customers.push({
          cpfCnpj,
          name: c.razao || c.nome || "",
          email: c.email || undefined,
          phone: c.fone || c.celular ? cleanPhone(c.fone || c.celular) : undefined,
          address: c.endereco || c.logradouro || undefined,
          addressNumber: extractNumberFromAddress(c.endereco, c.numero),
          complement: c.complemento || undefined,
          neighborhood: c.bairro || undefined,
          city: loc.city,
          state: loc.state,
          cep: c.cep ? cleanCep(c.cep) : undefined,
          latitude: c.latitude != null && String(c.latitude).trim() ? String(c.latitude).trim() : undefined,
          longitude: c.longitude != null && String(c.longitude).trim() ? String(c.longitude).trim() : undefined,
          totalOverdueAmount: Math.round(overdue.totalAmount * 100) / 100,
          maxDaysOverdue: overdue.maxDays,
          overdueInvoicesCount: overdue.count,
          faturasAbertas: abertasPorCliente.get(cid),
          contractStatus: this.statusDoContrato(resumo),
          contractPlan: resumo?.plano || undefined,
          contractStartDate: resumo?.inicio || undefined,
          erpSource: "ixc",
        });
      }

      const notas = [
        semCadastro > 0 ? `${semCadastro} sem cadastro` : "",
        semDocumento > 0 ? `${semDocumento} sem CPF/CNPJ` : "",
        semContrato > 0 ? `${semContrato} sem contrato ignorados` : "",
      ].filter(Boolean);
      console.log(`[IXC] fetchDelinquents: ${customers.length} inadimplentes` + (notas.length ? ` (${notas.join(", ")})` : ""));

      // A trava contra o que aconteceu em 31/08/2026 na O L I: 12.640 faturas
      // vencidas de 6.383 clientes viraram ZERO inadimplentes com `ok: true`
      // (o CPF era lido do boleto), e o sync, tomando a lista vazia por prova
      // de que ninguem devia, baixou a divida dos ativos em atraso da base
      // inteira. Fatura vencida sem nenhum devedor identificavel nao e "ninguem
      // deve": e leitura que nao serviu, e nao pode servir de prova negativa.
      const leituraParcial = porCliente.size > 0 && customers.length === 0;
      if (leituraParcial) {
        console.warn(`[IXC] fetchDelinquents: ${porCliente.size} clientes com fatura vencida e NENHUM identificado — leitura parcial, a baixa de divida nao pode rodar`);
      }

      return {
        ok: true,
        message: `${customers.length} inadimplentes encontrados (${allRows.length} faturas abertas)`
          + (notas.length ? `, ${notas.join(", ")}` : "")
          + (leituraParcial ? " — nenhum devedor identificado: leitura parcial" : ""),
        customers,
        totalRecords: customers.length,
        // Quem tem fatura vencida e cujo cadastro nao veio esta devendo — so
        // nao deu para nomear. Contado para o sync nao baixar divida com lista
        // curta.
        leiturasFalhas: semCadastro,
        ...(leituraParcial ? { leituraParcial: true } : {}),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  /**
   * Busca clientes com contrato cancelado/inativo E faturas em aberto.
   * Status buscados: I (Inativo), N (Negativado), status_internet FA (Financeiro em atraso)
   * Otimizado: 3 queries bulk (contratos I + N + FA) + 1 query faturas + cruzamento em memoria.
   * Usado pelo mapa de calor e consulta ISP.
   */
  async fetchCancelledDelinquents(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    try {
      // 1-3. Contratos I (Inativo), N (Negativado) e status_internet FA
      // (Financeiro em atraso).
      //
      // As tres leituras engoliam qualquer erro com `.catch(() => [])`, e com as
      // tres vazias esta funcao devolvia `ok: true` com lista vazia — o formato
      // exato da prova negativa: o sync leria "ninguem deve" de uma leitura que
      // nao aconteceu. Falha isolada ainda passa (uma das tres basta para haver
      // o que dizer); as tres falhando NAO podem virar resposta positiva.
      const falhas: string[] = [];
      const contratosPorStatus = async (filtro: IxcFilter, rotulo: string): Promise<any[]> => {
        try {
          return await this.listWithFilter(config, "cliente_contrato", [filtro], 500, 200);
        } catch (e) {
          falhas.push(`${rotulo}: ${e instanceof Error ? e.message : e}`);
          return [];
        }
      };

      const inativoContracts = await contratosPorStatus({ TB: "cliente_contrato.status", OP: "=", P: "I", C: "AND", G: "" }, "status I");
      const negativadoContracts = await contratosPorStatus({ TB: "cliente_contrato.status", OP: "=", P: "N", C: "AND", G: "" }, "status N");
      const faContracts = await contratosPorStatus({ TB: "cliente_contrato.status_internet", OP: "=", P: "FA", C: "AND", G: "" }, "status_internet FA");

      if (falhas.length === 3) {
        return {
          ok: false,
          message: `IXC nao respondeu nenhuma das buscas de contrato: ${falhas[0]}`,
          customers: [],
        };
      }

      // Mapear id_cliente → info do contrato (status, datas)
      const contractMap = new Map<string, { status: string; statusInternet: string; plan: string; startDate: string; endDate: string; contractId: string }>();
      const allContracts = [...inativoContracts, ...negativadoContracts, ...faContracts];

      for (const c of allContracts) {
        const cid = String(c.id_cliente || "");
        if (!cid) continue;
        // Manter o pior status se duplicado
        if (!contractMap.has(cid)) {
          contractMap.set(cid, {
            status: c.status || "",
            statusInternet: c.status_internet || "",
            plan: c.contrato || c.descricao || "",
            startDate: c.data_inicio || "",
            endDate: c.data_final || "",
            contractId: String(c.id || ""),
          });
        }
      }

      const cancelledClientIds = new Set(contractMap.keys());

      console.log(`[IXC] fetchCancelledDelinquents: I=${inativoContracts.length} N=${negativadoContracts.length} FA=${faContracts.length} → ${cancelledClientIds.size} clientes unicos`);

      if (cancelledClientIds.size === 0) {
        return { ok: true, message: "Nenhum contrato cancelado encontrado", customers: [], totalRecords: 0 };
      }

      // 4. BULK FETCH: buscar todas as faturas abertas (status=A) de uma vez,
      // filtrar localmente pelos clientes cancelados. Antes era 1 query per cliente
      // (15326 x 0.18s = 46 min). Agora e ~10-20 paginas de 500.
      const overdueByClient = new Map<string, { totalAmount: number; maxDays: number; count: number }>();
      const clienteIdArray = Array.from(cancelledClientIds);

      console.log(`[IXC] fetchCancelledDelinquents: bulk fetch de todas faturas abertas e liberadas...`);
      const bulkStart = Date.now();
      let allInvoices: any[] = [];
      try {
        allInvoices = await this.listWithFilter(config, "fn_areceber", [...FATURA_ABERTA], 500, 500);
      } catch (e) {
        // Sem as faturas nao ha divida nenhuma para somar, e o retorno seria
        // "nenhum cancelado com divida" — uma afirmacao que esta leitura nao
        // pode fazer. Recusa explicita em vez de lista vazia com ok:true.
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[IXC] Bulk fn_areceber falhou: ${msg}`);
        return { ok: false, message: `IXC nao respondeu as faturas em aberto: ${msg}`, customers: [] };
      }
      console.log(`[IXC] fetchCancelledDelinquents: bulk retornou ${allInvoices.length} faturas em ${Math.round((Date.now() - bulkStart) / 1000)}s`);

      // Filtrar faturas dos clientes cancelados e agregar
      for (const inv of allInvoices) {
        const cid = String(inv.id_cliente || "");
        if (!cid || !cancelledClientIds.has(cid)) continue;
        const dueDate = inv.data_vencimento;
        // Vencida = ao menos UM DIA de atraso, contado por dia de calendario.
        // `new Date(dueDate) < now` sobre o AAAA-MM-DD do IXC comparava meia-noite
        // UTC com o instante local: em Brasilia isso e 21h do dia ANTERIOR, entao a
        // fatura que vence HOJE ja contava como inadimplencia — o mesmo defeito que
        // punha 641 clientes do MK com "1 dia de atraso" que nao existia.
        if ((diasDesdeVencimento(dueDate) ?? -1) <= 0) continue;  // so vencidas
        const amount = parseFloat(inv.valor || inv.valor_original || "0") || 0;
        const days = calculateDaysOverdue(dueDate);
        const existing = overdueByClient.get(cid);
        if (existing) {
          existing.totalAmount += amount;
          if (days > existing.maxDays) existing.maxDays = days;
          existing.count++;
        } else {
          overdueByClient.set(cid, { totalAmount: amount, maxDays: days, count: 1 });
        }
      }

      console.log(`[IXC] fetchCancelledDelinquents: ${overdueByClient.size} cancelados com faturas vencidas de ${clienteIdArray.length} total`);
      const abertasPorCliente = faturasAbertasPorCliente(allInvoices);

      // 5. Cadastro em LOTE — ver clientesPorId.
      const clientsWithDebt = Array.from(overdueByClient.keys());
      const clienteMap = await this.clientesPorId(config, new Set(clientsWithDebt), "fetchCancelledDelinquents");

      // Resolver FK cidade/uf via metodos reutilizaveis
      const cidadeMap = await this.bulkResolveCidadeUf(config);
      console.log(`[IXC] fetchCancelledDelinquents: cidadeMap size=${cidadeMap.size}`);

      console.log(`[IXC] fetchCancelledDelinquents: ${clientsWithDebt.length} cancelados com divida, ${clienteMap.size} com dados cadastrais`);

      // Montar resultado normalizado
      const customers: NormalizedErpCustomer[] = clientsWithDebt
        .map(cid => {
          const c = clienteMap.get(cid);
          const overdue = overdueByClient.get(cid)!;
          const cpfCnpj = c ? cleanCpfCnpj(c.cpf_cnpj || c.cnpj_cpf || c.documento || "") : "";
          if (!cpfCnpj) return null;
          const loc = this.resolveCityState(c, cidadeMap);
          const contrato = contractMap.get(cid);
          // status_internet FA = bloqueado por atraso, mas AINDA e cliente.
          // I/N = inativo/negativado, ou seja, ex-cliente.
          // Sem isto o sync gravava `status: "active"` para TODO mundo desta
          // funcao — que busca justamente contratos cancelados. Era o dado
          // invertido que enchia o anti-fraude de "devedor cronico" de anos.
          const contractStatus: NormalizedErpCustomer["contractStatus"] =
            contrato?.statusInternet === "FA" && contrato?.status === "A"
              ? "suspended"
              : "cancelled";
          return {
            cpfCnpj,
            name: c?.razao || c?.nome || "",
            email: c?.email || undefined,
            phone: c?.fone || c?.celular ? cleanPhone(c.fone || c.celular) : undefined,
            address: c?.endereco || c?.logradouro || undefined,
            addressNumber: extractNumberFromAddress(c?.endereco, c?.numero),
            neighborhood: c?.bairro || undefined,
            city: loc.city,
            state: loc.state,
            cep: c?.cep ? cleanCep(c.cep) : undefined,
            totalOverdueAmount: overdue.totalAmount,
            maxDaysOverdue: overdue.maxDays,
            overdueInvoicesCount: overdue.count,
            faturasAbertas: abertasPorCliente.get(cid),
            contractStatus,
            contractStartDate: contrato?.startDate || undefined,
            contractPlan: contrato?.plan || undefined,
            erpSource: "ixc" as const,
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      return {
        ok: true,
        message: `${customers.length} cancelados com divida (I=${inativoContracts.length} N=${negativadoContracts.length} FA=${faContracts.length}, ${cancelledClientIds.size} clientes)`,
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
      // rp=500, maxPages=200 → ate 100.000 clientes (vs default 10.000)
      const allRows = await this.listAll(config, "cliente", {
        qtype: "cliente.id",
        query: "0",
        oper: ">",
        sortname: "cliente.id",
        sortorder: "asc",
      }, 500, 200);

      // Bulk resolve cidade/uf FK (mesma logica do fetchCancelledDelinquents)
      const cidadeMap = await this.bulkResolveCidadeUf(config);

      // Contratos em lote: dao o status (ativo/suspenso/cancelado) que o passo
      // 1 do sync grava para a carteira inteira — ate aqui o IXC nao mandava
      // status nenhum por este caminho, e ex-cliente so virava "cancelled" se
      // aparecesse devendo — e fecham a porteira: cadastro sem contrato nenhum
      // nao entra na base.
      const contratos = await this.contratosPorClienteBulk(config);
      let semContrato = 0;

      // As faturas em aberto da CARTEIRA INTEIRA, em lote — e por aqui que a
      // mensalidade a vencer de quem esta em dia chega a `invoices`;
      // `fetchDelinquents` so devolve quem deve. Uma leitura a mais de
      // `fn_areceber` por varredura (os dois leitores de inadimplente ja a
      // fazem). Se falhar, a carteira segue sem fatura e a resposta avisa
      // (`faturasNaoLidas`): "sem fatura" aqui seria mentira, e o sync nao
      // pode baixar nada com base nela.
      let abertasPorCliente = new Map<string, FaturaAbertaDoErp[]>();
      let faturasNaoLidas = false;
      try {
        const abertas = await this.listWithFilter(config, "fn_areceber", [...FATURA_ABERTA], 500, 200);
        abertasPorCliente = faturasAbertasPorCliente(abertas);
        console.log(`[IXC] fetchCustomers: ${abertas.length} faturas em aberto de ${abertasPorCliente.size} clientes`);
      } catch (e) {
        faturasNaoLidas = true;
        console.warn(`[IXC] fetchCustomers: faturas em aberto nao lidas (${e instanceof Error ? e.message : e}) — carteira segue sem fatura, nada sera baixado`);
      }

      const customers: NormalizedErpCustomer[] = allRows
        .map((row: any) => {
          const cpfCnpj = cleanCpfCnpj(row.cnpj_cpf || row.cpf_cnpj || row.documento || "");
          if (!cpfCnpj) return null;
          const resumo = contratos.mapa.get(String(row.id || ""));
          if (contratos.lidos && !resumo) { semContrato++; return null; }
          const loc = this.resolveCityState(row, cidadeMap);
          return {
            cpfCnpj,
            name: row.razao || row.nome || "",
            email: row.email || undefined,
            phone: row.fone || row.celular ? cleanPhone(row.fone || row.celular) : undefined,
            address: row.endereco || row.logradouro || undefined,
            addressNumber: extractNumberFromAddress(row.endereco, row.numero),
            neighborhood: row.bairro || undefined,
            city: loc.city,
            state: loc.state,
            cep: row.cep ? cleanCep(row.cep) : undefined,
            latitude: row.latitude != null && String(row.latitude).trim() ? String(row.latitude).trim() : undefined,
            longitude: row.longitude != null && String(row.longitude).trim() ? String(row.longitude).trim() : undefined,
            totalOverdueAmount: 0,
            maxDaysOverdue: 0,
            faturasAbertas: abertasPorCliente.get(String(row.id || "")),
            contractStatus: this.statusDoContrato(resumo),
            contractPlan: resumo?.plano || undefined,
            contractStartDate: resumo?.inicio || undefined,
            erpSource: "ixc",
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      console.log(`[IXC] fetchCustomers: ${customers.length} clientes totais` + (semContrato > 0 ? `, ${semContrato} cadastro(s) sem contrato nenhum ignorados` : ""));
      return {
        ok: true,
        message: `${customers.length} clientes encontrados` + (semContrato > 0 ? `, ${semContrato} sem contrato ignorados` : ""),
        customers,
        totalRecords: customers.length,
        ...(faturasNaoLidas ? { faturasNaoLidas: true } : {}),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  /**
   * Linhas da tabela `cliente` para um conjunto de ids, em LOTE.
   *
   * Uma requisicao por cliente custava milhares de idas ao IXC (5.977 x ~100ms
   * = 10 min na O L I). Varrer a tabela em paginas de 500 e filtrar em memoria
   * sai em ~12 paginas. Se o lote falhar, cai no um-a-um so para os ids
   * pedidos — pior que o lote, melhor que devolver ninguem.
   */
  private async clientesPorId(config: ErpConnectionConfig, ids: Set<string>, rotulo: string): Promise<Map<string, any>> {
    const mapa = new Map<string, any>();
    if (ids.size === 0) return mapa;
    try {
      const rows = await this.listAll(config, "cliente", {
        qtype: "cliente.id", query: "0", oper: ">", sortname: "cliente.id", sortorder: "asc",
      }, 500, 200);
      for (const r of rows) {
        const id = String(r.id || "");
        if (id && ids.has(id)) mapa.set(id, r);
      }
      console.log(`[IXC] ${rotulo}: cadastro em lote — ${rows.length} clientes lidos, ${mapa.size} de ${ids.size} casados`);
    } catch (e) {
      console.log(`[IXC] ${rotulo}: lote de clientes falhou, caindo no um-a-um: ${e instanceof Error ? e.message : e}`);
      for (const cid of Array.from(ids)) {
        try {
          const rows = await this.listAll(config, "cliente", { qtype: "cliente.id", query: cid, oper: "=" }, 1, 1);
          if (rows.length > 0) mapa.set(cid, rows[0]);
        } catch {}
      }
    }
    return mapa;
  }

  /** Teto da varredura de contratos: rp x paginas. Acima disso a leitura e parcial. */
  private static readonly TETO_CONTRATOS = 500 * 400;

  /**
   * Todos os contratos, em lote, resumidos por cliente.
   *
   * Status IXC: A=ativo, I=inativo, N=negativado, C=cancelado, D=desistiu.
   * `status_internet` FA = bloqueado por atraso — cortado, mas AINDA cliente.
   *
   * `lidos: false` quando a tabela nao pode ser lida inteira: ai nao se afirma
   * nada sobre o contrato de ninguem, e a porteira de "sem contrato" nao fecha
   * — errar para o lado de manter e barato, errar para o lado de descartar
   * apaga cliente de verdade.
   */
  private async contratosPorClienteBulk(config: ErpConnectionConfig): Promise<{ lidos: boolean; mapa: Map<string, ContratoResumo> }> {
    const mapa = new Map<string, ContratoResumo>();
    try {
      const rows = await this.listAll(config, "cliente_contrato", {
        qtype: "cliente_contrato.id", query: "0", oper: ">", sortname: "cliente_contrato.id", sortorder: "asc",
      }, 500, 400);
      for (const c of rows) {
        const cid = String(c.id_cliente || "");
        if (!cid) continue;
        const r = mapa.get(cid) ?? { total: 0, ativos: 0, algumFA: false, plano: "", inicio: "" };
        r.total++;
        const st = String(c.status || "").toUpperCase();
        const plano = String(c.contrato || c.descricao || "").trim();
        const inicio = String(c.data_ativacao || c.data_inicio || "").trim();
        if (st === "A") {
          // O contrato ativo manda no plano e na data; o primeiro ativo vence.
          if (r.ativos === 0) { r.plano = plano; r.inicio = inicio; }
          r.ativos++;
          if (String(c.status_internet || "").toUpperCase() === "FA") r.algumFA = true;
        } else if (r.ativos === 0 && !r.plano) {
          r.plano = plano;
          r.inicio = inicio;
        }
        mapa.set(cid, r);
      }
      const completo = rows.length < IxcConnector.TETO_CONTRATOS;
      console.log(`[IXC] contratos em lote: ${rows.length} contratos de ${mapa.size} clientes` + (completo ? "" : " — TRUNCADO, leitura parcial"));
      return { lidos: completo, mapa };
    } catch (e) {
      console.warn(`[IXC] contratos em lote falharam — sem status de contrato nesta passada: ${e instanceof Error ? e.message : e}`);
      return { lidos: false, mapa };
    }
  }

  /** Ativo (cortado por atraso = suspenso), ex-cliente, ou nada a afirmar. */
  private statusDoContrato(r: ContratoResumo | undefined): NormalizedErpCustomer["contractStatus"] {
    if (!r) return undefined;
    if (r.ativos > 0) return r.algumFA ? "suspended" : "active";
    return r.total > 0 ? "cancelled" : undefined;
  }

  /** Bulk resolve cidade/uf FK tables — reusado por fetchCustomers e fetchCancelledDelinquents */
  private async bulkResolveCidadeUf(config: ErpConnectionConfig): Promise<Map<string, { nome: string; uf: string }>> {
    const cidadeMap = new Map<string, { nome: string; uf: string }>();
    try {
      const cidades = await this.listAll(config, "cidade", {
        qtype: "cidade.id", query: "0", oper: ">", sortname: "cidade.id", sortorder: "asc",
      }, 500, 50);
      const ufs = await this.listAll(config, "uf", {
        qtype: "uf.id", query: "0", oper: ">", sortname: "uf.id", sortorder: "asc",
      }, 200, 5).catch(() => [] as any[]);
      const ufMap = new Map<string, string>();
      for (const u of ufs) {
        const id = String(u.id || "");
        const sigla = String(u.uf || u.sigla || u.nome || "");
        if (id && sigla) ufMap.set(id, sigla);
      }
      for (const c of cidades) {
        const id = String(c.id || "");
        const nome = String(c.nome || c.cidade || "");
        const ufId = String(c.uf || c.id_uf || "");
        const uf = ufMap.get(ufId) || ufId;
        if (id && nome) cidadeMap.set(id, { nome, uf });
      }
    } catch {}
    return cidadeMap;
  }

  /** Resolve FK cidade/uf de um row cliente usando cidadeMap */
  /**
   * Resolve UMA cidade pelo id interno do IXC, com cache.
   *
   * O campo `cliente.cidade` guarda o id da cidade, nao o nome — medido contra a
   * API em 27/08/2026, um cliente de Londrina volta com `cidade: "4101"`. Os
   * caminhos em lote ja resolviam isso com `bulkResolveCidadeUf`, mas a consulta
   * de UM cliente (`fetchCustomerByCpf`) devolvia o numero cru. O efeito ia
   * longe: esse "4101" virava a cidade da chave de endereco e o cruzamento
   * comparava "4101" com "Londrina" nos outros ERPs, sem casar nada.
   *
   * Uma cidade por requisicao, em vez das 5.579 do bulk: a consulta e de um
   * cliente so, e puxar o municipio inteiro do estado para descobrir um nome
   * seria caro no caminho que precisa ser rapido.
   */
  private async resolverCidadePorId(
    config: ErpConnectionConfig,
    id: string,
  ): Promise<{ nome: string; uf: string } | null> {
    const chave = `${this.baseUrl(config)}::${id}`;
    if (IxcConnector.cacheCidade.has(chave)) return IxcConnector.cacheCidade.get(chave)!;
    try {
      const linhas = await this.listAll(config, "cidade", {
        qtype: "cidade.id", query: id, oper: "=",
      }, 1, 1);
      const c = linhas[0];
      const nome = c ? String(c.nome || c.cidade || "") : "";
      const resultado = nome ? { nome, uf: String(c.uf || c.sigla || "") } : null;
      IxcConnector.cacheCidade.set(chave, resultado);
      return resultado;
    } catch {
      // Sem o nome, segue com o id — pior que resolver, melhor que falhar.
      return null;
    }
  }

  private static cacheCidade = new Map<string, { nome: string; uf: string } | null>();

  private resolveCityState(c: any, cidadeMap: Map<string, { nome: string; uf: string }>): { city?: string; state?: string } {
    const rawCidade = c?.cidade;
    const rawUf = c?.uf || c?.estado;
    if (rawCidade && !/^\d+$/.test(String(rawCidade))) {
      return { city: String(rawCidade), state: rawUf ? String(rawUf) : undefined };
    }
    if (rawCidade && cidadeMap.has(String(rawCidade))) {
      const resolved = cidadeMap.get(String(rawCidade))!;
      return { city: resolved.nome, state: resolved.uf || (rawUf ? String(rawUf) : undefined) };
    }
    return { city: undefined, state: rawUf && !/^\d+$/.test(String(rawUf)) ? String(rawUf) : undefined };
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
      const customerIds = Array.from(new Set(contracts.map(c => c.customerId).filter(Boolean)));
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
  /**
   * Busca clientes por ENDERECO, com a divida em aberto agregada.
   *
   * Substitui uma versao anterior deste metodo que devolvia so o cadastro, sem
   * divida, e que nao tinha um unico chamador — para o cruzamento da consulta,
   * saber QUEM mora no endereco sem saber quem deve nao responde nada.
   *
   * O filtro e deliberadamente FROUXO: logradouro por LIKE, sem numero. O
   * numero no IXC as vezes vem grudado no campo `endereco` e as vezes no campo
   * `numero`, e filtra-lo no servidor perderia metade dos vizinhos. O casamento
   * fino fica com `services/endereco-chave.ts`, que aplica a mesma regua a todos
   * os ERPs. Devolver a mais e deixar o casador cortar; devolver a menos esconde
   * pendencia.
   */
  async fetchCustomersByAddress(
    config: ErpConnectionConfig,
    endereco: { logradouro: string; numero?: string; bairro?: string; cidade?: string; uf?: string; cep?: string },
  ): Promise<ErpFetchResult> {
    try {
      const filters: IxcFilter[] = [];

      // O logradouro do ERP costuma trazer o tipo ("Rua", "Av.") e as vezes o
      // numero. Busca pelo nucleo do nome, sem o tipo, para casar as grafias.
      const nucleo = endereco.logradouro
        .replace(/^\s*(r\.?|rua|av\.?|avenida|tv\.?|travessa|al\.?|alameda|pc\.?|praca)\s+/i, "")
        .replace(/[,\d].*$/, "")
        .trim();

      if (nucleo.length >= 3) {
        filters.push({ TB: "cliente.endereco", OP: "L", P: `%${nucleo}%`, C: "AND", G: "" });
      } else if (endereco.cep) {
        filters.push({ TB: "cliente.cep", OP: "L", P: `${cleanCep(endereco.cep).slice(0, 5)}%`, C: "AND", G: "" });
      } else {
        return { ok: false, message: "Endereco sem logradouro utilizavel", customers: [] };
      }

      if (endereco.bairro) {
        filters.push({ TB: "cliente.bairro", OP: "L", P: `%${endereco.bairro}%`, C: "AND", G: "" });
      }

      const clienteRows = await this.listWithFilter(config, "cliente", filters, 500, 20);
      if (clienteRows.length === 0) {
        return { ok: true, message: "Nenhum cliente encontrado neste endereco", customers: [], totalRecords: 0 };
      }

      const customers = await this.enriquecerComDivida(config, clienteRows);
      return {
        ok: true,
        message: `${customers.length} cliente(s) no logradouro`,
        customers,
        totalRecords: customers.length,
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
      let faturasAbertas: FaturaAbertaDoErp[] | undefined;
      let totalOverdueAmount = 0;
      let maxDaysOverdue = 0;
      let overdueInvoicesCount = 0;

      if (customerId) {
        const invoiceRows = await this.listWithFilter(config, "fn_areceber", [
          { TB: "fn_areceber.id_cliente", OP: "=", P: customerId, C: "AND", G: "" },
          ...FATURA_ABERTA,
        ], 200, 5);

        faturasAbertas = faturasAbertasPorCliente(invoiceRows).get(customerId) ?? [];

        for (const inv of invoiceRows) {
          const dueDate = inv.data_vencimento;
          // Vencida = ao menos UM DIA de atraso, contado por dia de calendario.
          // `new Date(dueDate) < now` sobre o AAAA-MM-DD do IXC comparava meia-noite
          // UTC com o instante local: em Brasilia isso e 21h do dia ANTERIOR, entao a
          // fatura que vence HOJE ja contava como inadimplencia — o mesmo defeito que
          // punha 641 clientes do MK com "1 dia de atraso" que nao existia.
          if ((diasDesdeVencimento(dueDate) ?? -1) > 0) {
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

      // ── CONTRATO: status e data de inicio ───────────────────────────────
      // O anti-fraude precisa saber se o cliente AINDA e do provedor e ha
      // quanto tempo. Sem isto o alerta de fuga nao consegue distinguir um
      // cliente ativo prestes a migrar de uma baixa contabil de anos atras.
      // Custo: uma query por consulta, filtrada por id_cliente.
      let contractStatus: NormalizedErpCustomer["contractStatus"];
      let contractStartDate: string | undefined;
      let contractPlan: string | undefined;

      if (customerId) {
        try {
          const contratos = await this.listWithFilter(config, "cliente_contrato", [
            { TB: "cliente_contrato.id_cliente", OP: "=", P: customerId, C: "AND", G: "" },
          ], 50, 1);

          if (contratos.length > 0) {
            // Status IXC: A=ativo, I=inativo, N=negativado, D=desistiu.
            // status_internet FA = financeiro em atraso (bloqueado, mas AINDA cliente).
            const ativo = contratos.find((c: any) => String(c.status || "").toUpperCase() === "A");
            const escolhido = ativo || contratos[0];
            const st = String(escolhido.status || "").toUpperCase();
            const stInternet = String(escolhido.status_internet || "").toUpperCase();

            contractStatus = st === "A"
              ? (stInternet === "FA" ? "suspended" : "active")
              : "cancelled";
            contractStartDate = escolhido.data_ativacao || escolhido.data_inicio || undefined;
            contractPlan = escolhido.contrato || escolhido.descricao || undefined;
          }
        } catch {
          // Instancia sem a tabela ou sem permissao: segue sem o sinal de
          // contrato. A regra do anti-fraude trata undefined explicitamente.
        }
      }

      // `cliente.cidade` guarda o ID da cidade, nao o nome. Sem resolver, o
      // "4101" seguia como cidade ate a chave de endereco e o cruzamento
      // comparava numero com nome, sem casar nada.
      let cidadeNome = r.cidade ? String(r.cidade) : undefined;
      let ufSigla = r.uf || r.estado || undefined;
      if (cidadeNome && /^\d+$/.test(cidadeNome)) {
        const resolvida = await this.resolverCidadePorId(config, cidadeNome);
        if (resolvida) {
          cidadeNome = resolvida.nome;
          if (!ufSigla || /^\d+$/.test(String(ufSigla))) ufSigla = resolvida.uf || ufSigla;
        }
      }

      const radius = customerId ? await this.fetchRadiusStatus(config, customerId) : null;
      const customer: NormalizedErpCustomer = {
        cpfCnpj: clean,
        name: r.razao || r.nome || "",
        email: r.email || undefined,
        phone: r.fone || r.celular ? cleanPhone(r.fone || r.celular) : undefined,
        address: r.endereco || r.logradouro || undefined,
        addressNumber: extractNumberFromAddress(r.endereco, r.numero),
        complement: r.complemento || undefined,
        neighborhood: r.bairro || undefined,
        city: cidadeNome,
        state: ufSigla,
        cep: r.cep ? cleanCep(r.cep) : undefined,
        totalOverdueAmount,
        maxDaysOverdue,
        overdueInvoicesCount,
        hasUnreturnedEquipment,
        unreturnedEquipmentCount,
        equipmentDetails: equipmentDetails.length > 0 ? equipmentDetails : undefined,
        autenticacoes: radius?.ok ? radius.connections.map(c => ({ login: c.login || null, mac: c.mac || null, ip: c.ip || null, online: c.online, contrato: null, serial: null, fonte: "ixc_radius" })) : undefined,
        faturasAbertas,
        contractStatus,
        contractStartDate,
        contractPlan,
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
  /**
   * Dado um conjunto de linhas da tabela `cliente`, agrega a divida em aberto
   * de cada uma e devolve no formato normalizado.
   *
   * Extraido de `fetchCustomersByCep` para servir tambem a busca por endereco:
   * as duas fazem a mesma coisa depois de escolher QUAIS clientes olhar, e
   * duplicar o calculo de divida seria pedir para os dois caminhos divergirem.
   */
  private async enriquecerComDivida(
    config: ErpConnectionConfig,
    clienteRows: any[],
  ): Promise<NormalizedErpCustomer[]> {
    const customerIds = clienteRows.map((r: any) => String(r.id)).filter(Boolean);
    const customerIdSet = new Set(customerIds);

    // Lotes para nao montar um filtro gigante numa requisicao so.
    const BATCH_SIZE = 50;
    const overdueByCustomer = new Map<string, { totalAmount: number; maxDays: number; count: number }>();

    for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
      const batch = customerIds.slice(i, i + BATCH_SIZE);

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
      filters.push(...FATURA_ABERTA);

      const invoiceRows = await this.listWithFilter(config, "fn_areceber", filters, 200, 10);

      for (const inv of invoiceRows) {
        const dueDate = inv.data_vencimento;
        // Vencida = ao menos UM DIA de atraso, contado por dia de calendario.
        // `new Date(dueDate) < now` sobre o AAAA-MM-DD do IXC comparava meia-noite
        // UTC com o instante local: em Brasilia isso e 21h do dia ANTERIOR, entao a
        // fatura que vence HOJE ja contava como inadimplencia — o mesmo defeito que
        // punha 641 clientes do MK com "1 dia de atraso" que nao existia.
        if ((diasDesdeVencimento(dueDate) ?? -1) <= 0) continue;
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

    // As cidades vem como ID e precisam virar nome, senao a chave de endereco
    // deste caminho ("4101") nunca casa com a do `fetchCustomerByCpf`
    // ("LONDRINA") e o cruzamento devolve o imovel certo sem reconhece-lo.
    // Resolve so os IDs distintos — uma rua costuma ter um municipio so — em vez
    // do bulk de 5.579 linhas.
    const idsCidade = Array.from(new Set(
      clienteRows.map((r: any) => String(r.cidade ?? "")).filter(id => /^\d+$/.test(id)),
    ));
    const nomesCidade = new Map<string, { nome: string; uf: string }>();
    for (const id of idsCidade) {
      const c = await this.resolverCidadePorId(config, id);
      if (c) nomesCidade.set(id, c);
    }

    return clienteRows
      .map((r: any) => {
        // `cnpj_cpf` — nessa ordem — e o nome REAL do campo na tabela `cliente`
        // do IXC, verificado contra a API em 27/08/2026. Esta linha tentava so
        // `cpf_cnpj || documento`, os dois inexistentes, e portanto descartava
        // TODOS os clientes: `fetchCustomersByCep` devolvia zero desde sempre e
        // o cruzamento de endereco da consulta nunca produziu nada — sem erro,
        // sem log, so uma lista vazia que parecia "ninguem mais neste endereco".
        // As outras tres montagens do arquivo (linhas 287, 450, 516) ja tinham
        // o `cnpj_cpf`; esta ficou para tras.
        const cpfCnpj = cleanCpfCnpj(r.cnpj_cpf || r.cpf_cnpj || r.documento || "");
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
          city: nomesCidade.get(String(r.cidade ?? ""))?.nome ?? (r.cidade || undefined),
          state: nomesCidade.get(String(r.cidade ?? ""))?.uf || r.uf || r.estado || undefined,
          cep: r.cep ? cleanCep(r.cep) : undefined,
          totalOverdueAmount: overdue?.totalAmount ?? 0,
          maxDaysOverdue: overdue?.maxDays ?? 0,
          overdueInvoicesCount: overdue?.count ?? 0,
          erpSource: "ixc" as const,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
  }

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

      const customers = await this.enriquecerComDivida(config, clienteRows);

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
