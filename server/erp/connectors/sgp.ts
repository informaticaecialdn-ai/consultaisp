/**
 * SGP (Sistema Gerencial de Provedores / TSMX) — conector ERP.
 *
 * A versao anterior deste arquivo falava com tres endpoints que NAO EXISTEM na
 * API do SGP: `/api/financeiro/inadimplentes`, `/api/contratos` e
 * `/api/clientes`. Nenhum provedor nunca teve SGP funcionando, entao o erro
 * nunca apareceu como bug — aparecia como timeout na consulta ao vivo.
 *
 * Os caminhos abaixo vem da colecao Postman publica da TSMX (api.sgp.net.br,
 * que redireciona para o documenter), conferidos endpoint a endpoint:
 *
 *   POST /api/ura/consultacliente/  — cliente + contratos por CPF/CNPJ
 *   POST /api/ura/titulos/          — faturas, com paginacao (limit max 250)
 *   POST /api/ura/listacontrato/    — contratos com status e endereco
 *   POST /api/ura/clientes/         — clientes, com paginacao (limit max 100)
 *
 * Autenticacao: `token` + `app` no CORPO da requisicao, form-urlencoded (metodo
 * 02 da doc). O SGP tambem aceita Basic Auth com usuario e senha do sistema,
 * mas token e revogavel sem mexer em usuario — e o que a tela pede.
 *
 * @see https://bookstack.sgp.net.br/books/api/page/autenticacoes-via-api
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
import { cleanCpfCnpj, cleanPhone, diasDesdeVencimento, aggregateByCustomer } from "../normalize.js";

/** Teto documentado de `limit` em /api/ura/titulos/. Pedir mais nao traz mais. */
const LIMITE_TITULOS = 250;
/** Teto documentado de `limit` em /api/ura/clientes/. */
const LIMITE_CLIENTES = 100;
/**
 * Freio de paginacao. Com 250 por pagina isso cobre 100 mil faturas; alem
 * disso e mais provavel que a paginacao do SGP esteja se repetindo do que que
 * o provedor realmente tenha tudo isso em aberto. Ao bater no teto a leitura
 * volta marcada como parcial, e o sync deixa de usar a lista como prova
 * negativa (ver `leituraParcial` em ../types.ts).
 */
const MAX_PAGINAS = 400;

/**
 * Status de contrato do SGP, como a propria doc os enumera:
 * 1 Ativo · 2 Inativo · 3 Cancelado · 4 Suspenso · 5 Inviabilidade Tecnica ·
 * 6 Novo · 7 Ativo V. Reduzida.
 *
 * `6 = Novo` fica de fora de proposito, virando `undefined`. Contrato novo
 * ainda nao instalado nao e cliente ativo, e tambem nao e ex-cliente — e
 * "ainda nao sei". A regra do anti-fraude trata ausencia de prova como
 * ausencia: ninguem e avisado por causa de um contrato que ainda nao existe
 * na pratica.
 */
const STATUS_POR_CODIGO: Record<number, NormalizedErpCustomer["contractStatus"]> = {
  1: "active",
  2: "cancelled",
  3: "cancelled",
  4: "suspended",
  5: "cancelled",
  7: "active",
};

/** Sem acento, sem caixa, sem espaco nas pontas — o display vem como " Ativo ". */
function achatar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Traduz o status do contrato do SGP para o vocabulario do bureau.
 *
 * Aceita o codigo numerico (`contratoStatus`) e o texto (`contratoStatusDisplay`
 * no consultacliente, `status` no listacontrato). Devolve `undefined` para o
 * que nao reconhece — nunca chuta "active", porque um contrato dado como ativo
 * sem prova dispara alerta de anti-fraude para um provedor que talvez nem
 * tenha mais o cliente.
 */
export function statusDoContratoSgp(
  codigo: unknown,
  texto?: unknown,
): NormalizedErpCustomer["contractStatus"] {
  const n = typeof codigo === "number" ? codigo : Number.parseInt(String(codigo ?? ""), 10);
  if (Number.isFinite(n) && STATUS_POR_CODIGO[n]) return STATUS_POR_CODIGO[n];

  const t = achatar(String(texto ?? ""));
  if (!t) return undefined;
  // "Ativo V. Reduzida" tambem cai aqui, e continua sendo cliente.
  if (t.startsWith("ativo")) return "active";
  if (t.startsWith("suspenso") || t.startsWith("bloqueado")) return "suspended";
  if (t.startsWith("cancelado") || t.startsWith("cancelada") || t.startsWith("inativo")) return "cancelled";
  if (t.startsWith("inviabilidade")) return "cancelled";
  return undefined;
}

/** "-25.4284,-49.2733" → { latitude, longitude }. Qualquer outra coisa → {}. */
function coordenadas(ll: unknown): { latitude?: string; longitude?: string } {
  const partes = String(ll ?? "").split(",");
  if (partes.length !== 2) return {};
  const lat = Number(partes[0]);
  const lng = Number(partes[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  if (lat === 0 && lng === 0) return {};
  return { latitude: partes[0].trim(), longitude: partes[1].trim() };
}

/** Primeiro item nao vazio de um array que o SGP devolve como lista de strings. */
function primeiro(lista: unknown): string | undefined {
  if (!Array.isArray(lista)) return undefined;
  for (const item of lista) {
    const s = String(item ?? "").trim();
    if (s) return s;
  }
  return undefined;
}

function texto(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return s && s !== "None" && s !== "null" ? s : undefined;
}

function numero(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Um titulo como /api/ura/titulos/ o devolve. */
interface TituloSgp {
  clienteNome?: string;
  clienteCpfcnpj?: string;
  clienteContrato?: number;
  status?: string;
  valor?: number;
  valorCorrigido?: number;
  valorPago?: number;
  valorPagoParcial?: number;
  dataVencimento?: string;
}

export class SgpConnector implements ErpConnector {
  readonly name = "sgp";
  readonly label = "SGP";

  readonly configFields: ErpConfigField[] = [
    { key: "apiUrl", label: "URL do Servidor SGP", type: "url", required: true, placeholder: "https://provedor.sgp.net.br" },
    { key: "apiToken", label: "Token SGP", type: "password", required: true },
    { key: "extra.sgpApp", label: "Nome do App", type: "text", required: true, placeholder: "consultaisp" },
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

  /** token + app + os filtros da chamada, no formato que o SGP le. */
  private corpo(config: ErpConnectionConfig, campos: Record<string, string | number> = {}): string {
    const p = new URLSearchParams();
    p.set("token", config.apiToken ?? "");
    p.set("app", config.extra?.sgpApp || "consultaisp");
    for (const [k, v] of Object.entries(campos)) p.set(k, String(v));
    return p.toString();
  }

  private async post(
    config: ErpConnectionConfig,
    caminho: string,
    campos: Record<string, string | number>,
    opcoes: { timeoutMs: number; retries: number },
  ): Promise<Response> {
    return withResilience(
      () => fetch(`${this.baseUrl(config)}${caminho}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: this.corpo(config, campos),
        signal: AbortSignal.timeout(opcoes.timeoutMs),
      }),
      {
        retries: opcoes.retries,
        minTimeout: 1000,
        circuit: this.getCircuit(config.extra?.providerId ?? "default"),
      },
    );
  }

  /**
   * Traduz o status HTTP em algo que o provedor consiga agir.
   *
   * "SGP respondeu com status 403" nao diz a ninguem que o token esta errado
   * ou que o host nao esta na lista permitida do token — e as duas coisas se
   * resolvem em telas diferentes do SGP.
   */
  private erroDeHttp(status: number): string {
    if (status === 401) return "Token ou nome do app recusado pelo SGP (401). Confira em Administracao > Integracoes > Tokens.";
    if (status === 403) return "O SGP recusou o acesso (403). O token pode estar inativo ou restrito a outros hosts/rotas.";
    if (status === 404) return "Endereco nao encontrado no SGP (404). Confira a URL do servidor.";
    if (status >= 500) return `O servidor SGP respondeu com erro interno (${status}).`;
    return `SGP respondeu com status ${status}.`;
  }

  async testConnection(config: ErpConnectionConfig): Promise<ErpTestResult> {
    const start = Date.now();
    try {
      // /api/ura/titulos/ com limit=1: a chamada mais barata que ainda prova
      // que token+app valem para a familia /api/ura/, que e a que o conector
      // usa. `auth/info` seria mais barata ainda, mas so aceita Basic Auth.
      const response = await this.post(config, "/api/ura/titulos/", { limit: 1 }, { timeoutMs: 8000, retries: 1 });
      const latencyMs = Date.now() - start;
      if (!response.ok) return { ok: false, message: this.erroDeHttp(response.status), latencyMs };
      return { ok: true, message: "Conexao com SGP estabelecida com sucesso", latencyMs };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, latencyMs: Date.now() - start };
    }
  }

  /**
   * Percorre /api/ura/titulos/ ate acabar, respeitando `paginacao.total`.
   *
   * Devolve `parcial: true` quando parou sem ter certeza de ter lido tudo —
   * seja por bater no freio de paginas, seja porque uma pagina falhou. Quem
   * chama precisa disso: a lista de inadimplentes e usada como prova NEGATIVA
   * pelo sync, e meia lista baixaria a divida de quem so nao foi lido.
   */
  private async paginarTitulos(
    config: ErpConnectionConfig,
    filtros: Record<string, string | number>,
  ): Promise<{ titulos: TituloSgp[]; parcial: boolean; erro?: string }> {
    const titulos: TituloSgp[] = [];
    let offset = 0;

    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const response = await this.post(
        config,
        "/api/ura/titulos/",
        { ...filtros, limit: LIMITE_TITULOS, offset },
        { timeoutMs: 30000, retries: 2 },
      );
      if (!response.ok) {
        return { titulos, parcial: true, erro: this.erroDeHttp(response.status) };
      }

      const json = (await response.json()) as { titulos?: TituloSgp[]; paginacao?: { total?: number; limit?: number } };
      const lote = Array.isArray(json?.titulos) ? json.titulos : [];
      titulos.push(...lote);

      const total = Number(json?.paginacao?.total);
      // O SGP pode devolver menos que o limite pedido (ele impoe o teto dele).
      // Avancar pelo tamanho do lote, e nao por LIMITE_TITULOS, evita pular
      // registros silenciosamente quando isso acontece.
      if (lote.length === 0) break;
      offset += lote.length;
      if (Number.isFinite(total) && offset >= total) break;
      // Sem `total` confiavel, para quando o lote veio incompleto.
      if (!Number.isFinite(total) && lote.length < LIMITE_TITULOS) break;

      if (pagina === MAX_PAGINAS - 1) return { titulos, parcial: true };
    }

    return { titulos, parcial: false };
  }

  /**
   * Converte titulos em faturas vencidas, ja com o valor em aberto correto.
   *
   * Usa `valor` (o principal) e nao `valorCorrigido`: o corrigido embute juros
   * e multa, que variam por provedor e inflariam a divida na comparacao entre
   * ERPs diferentes dentro do mesmo bureau. O que ja foi pago parcialmente sai
   * da conta.
   */
  private faturasVencidas(titulos: TituloSgp[]): Array<{
    cpfCnpj: string; name: string; amount: number; daysOverdue: number; erpSource: string;
  }> {
    const faturas = [];
    for (const t of titulos) {
      const cpfCnpj = cleanCpfCnpj(String(t.clienteCpfcnpj ?? ""));
      if (!cpfCnpj) continue;

      const situacao = achatar(String(t.status ?? ""));
      // "aberto" e o que a doc devolve; "atrasado"/"vencido" entram por
      // seguranca, caso a instalacao use outro rotulo para o mesmo estado.
      if (situacao && !["aberto", "atrasado", "vencido", "pendente"].includes(situacao)) continue;

      const dias = diasDesdeVencimento(t.dataVencimento ?? null);
      // `null` = vencimento ilegivel. Fatura sem data nao vira atraso de zero
      // dia nem de mil: ela sai da conta.
      if (dias === null || dias <= 0) continue;

      const emAberto = numero(t.valor) - numero(t.valorPagoParcial) - numero(t.valorPago);
      if (emAberto <= 0) continue;

      faturas.push({
        cpfCnpj,
        name: texto(t.clienteNome) ?? "",
        amount: emAberto,
        daysOverdue: dias,
        erpSource: "sgp",
      });
    }
    return faturas;
  }

  /**
   * Contratos por CPF/CNPJ, com status e endereco.
   *
   * Uma chamada so para a base inteira: /api/ura/listacontrato/ nao tem
   * paginacao documentada, e devolve o array cru.
   */
  private async contratosPorDocumento(
    config: ErpConnectionConfig,
  ): Promise<Map<string, {
    contractStatus: NormalizedErpCustomer["contractStatus"];
    contractStartDate?: string;
    dados: Partial<NormalizedErpCustomer>;
  }>> {
    const mapa = new Map<string, {
      contractStatus: NormalizedErpCustomer["contractStatus"];
      contractStartDate?: string;
      dados: Partial<NormalizedErpCustomer>;
    }>();

    const response = await this.post(config, "/api/ura/listacontrato/", { exibir_endereco: 1 }, { timeoutMs: 60000, retries: 1 });
    if (!response.ok) return mapa;

    const json = (await response.json()) as unknown;
    const linhas: any[] = Array.isArray(json) ? json : ((json as any)?.contratos ?? []);

    for (const c of linhas) {
      const cpfCnpj = cleanCpfCnpj(String(c?.cpfcnpj ?? ""));
      if (!cpfCnpj) continue;

      const status = statusDoContratoSgp(c?.status, c?.status);
      const e = c?.endereco ?? {};
      const registro = {
        contractStatus: status,
        contractStartDate: texto(c?.data_cadastro),
        dados: {
          name: texto(c?.nome),
          email: texto(c?.email),
          phone: texto(c?.telefone) ? cleanPhone(String(c.telefone)) : undefined,
          address: texto(e?.logradouro),
          addressNumber: texto(e?.numero),
          complement: texto(e?.complemento),
          neighborhood: texto(e?.bairro),
          city: texto(e?.cidade),
          state: texto(e?.uf),
          cep: texto(e?.cep),
          latitude: texto(e?.latitude),
          longitude: texto(e?.longitude),
        } as Partial<NormalizedErpCustomer>,
      };

      const anterior = mapa.get(cpfCnpj);
      // Um cliente pode ter varios contratos. O ativo manda: se QUALQUER
      // contrato dele esta vigente, ele e cliente do provedor — e essa e a
      // condicao que o anti-fraude testa.
      if (!anterior || (anterior.contractStatus !== "active" && registro.contractStatus === "active")) {
        mapa.set(cpfCnpj, registro);
      }
    }

    return mapa;
  }

  async fetchDelinquents(config: ErpConnectionConfig, _lastDays?: number): Promise<ErpFetchResult> {
    try {
      const hoje = new Date();
      const ate = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

      // Filtra no servidor pelo que ja venceu, e confere de novo aqui pela
      // data. O corte no servidor e por economia de paginas; a decisao de
      // "esta vencida" continua sendo local, com o mesmo calculo dos outros
      // conectores.
      const { titulos, parcial, erro } = await this.paginarTitulos(config, {
        status: "abertos",
        data_vencimento_fim: ate,
      });

      if (titulos.length === 0 && erro) {
        return { ok: false, message: erro, customers: [], totalRecords: 0 };
      }

      const customers = aggregateByCustomer(this.faturasVencidas(titulos));

      // Status e endereco vem do cadastro de contratos. Se essa chamada
      // falhar, os inadimplentes continuam validos — so ficam sem status, que
      // e lido como "nao sei" e nao dispara anti-fraude.
      const contratos = await this.contratosPorDocumento(config);
      for (const c of customers) {
        const info = contratos.get(c.cpfCnpj);
        if (!info) continue;
        c.contractStatus = info.contractStatus;
        c.contractStartDate = info.contractStartDate;
        for (const [k, v] of Object.entries(info.dados)) {
          if (v && !(c as any)[k]) (c as any)[k] = v;
        }
      }

      return {
        ok: true,
        message: parcial
          ? `${customers.length} inadimplentes encontrados (leitura incompleta)`
          : `${customers.length} inadimplentes encontrados`,
        customers,
        totalRecords: customers.length,
        ...(parcial ? { leituraParcial: true } : {}),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  /**
   * A consulta ao vivo: um documento, duas chamadas.
   *
   * A versao anterior baixava a base inteira de inadimplentes e filtrava o CPF
   * em memoria — por isso a consulta estourava o tempo. `consultacliente`
   * aceita o CPF direto e devolve contrato, status, endereco e data de
   * cadastro; `titulos` filtrado pelo mesmo CPF traz os vencimentos.
   */
  async fetchCustomerByCpf(config: ErpConnectionConfig, cpfCnpj: string): Promise<ErpFetchResult> {
    const doc = cpfCnpj.replace(/\D/g, "");
    try {
      const [resCliente, faturas] = await Promise.all([
        this.post(config, "/api/ura/consultacliente/", { cpfcnpj: doc }, { timeoutMs: 15000, retries: 1 }),
        this.paginarTitulos(config, { cpfcnpj: doc, status: "abertos" }),
      ]);

      if (!resCliente.ok) {
        // 404 aqui e "esse CPF nao esta na base", nao falha de integracao.
        if (resCliente.status === 404) {
          return { ok: true, message: "Cliente nao encontrado no SGP", customers: [], totalRecords: 0 };
        }
        return { ok: false, message: this.erroDeHttp(resCliente.status), customers: [] };
      }

      const json = (await resCliente.json()) as { contratos?: any[] };
      const contratos = Array.isArray(json?.contratos) ? json.contratos : [];
      if (contratos.length === 0) {
        return { ok: true, message: "Cliente nao encontrado no SGP", customers: [], totalRecords: 0 };
      }

      // O contrato que representa o cliente e o ATIVO, se houver algum. Sem
      // isso, um ex-contrato cancelado de 2019 poderia responder por alguem
      // que hoje e cliente — e o bureau diria "ex-cliente" para quem esta na
      // rede agora.
      const ordenados = [...contratos].sort((a, b) => {
        const sa = statusDoContratoSgp(a?.contratoStatus, a?.contratoStatusDisplay);
        const sb = statusDoContratoSgp(b?.contratoStatus, b?.contratoStatusDisplay);
        const peso = (s: NormalizedErpCustomer["contractStatus"]) =>
          s === "active" ? 0 : s === "suspended" ? 1 : s === "cancelled" ? 3 : 2;
        return peso(sa) - peso(sb);
      });
      const principal = ordenados[0];

      const emAberto = this.faturasVencidas(faturas.titulos);
      const totalOverdueAmount = emAberto.reduce((s, f) => s + f.amount, 0);
      const maxDaysOverdue = emAberto.reduce((m, f) => Math.max(m, f.daysOverdue), 0);

      const documento = cleanCpfCnpj(String(principal?.cpfCnpj ?? doc)) || doc;

      const cliente: NormalizedErpCustomer = {
        cpfCnpj: documento,
        name: texto(principal?.razaoSocial) ?? "",
        email: primeiro(principal?.emails),
        phone: primeiro(principal?.telefones) ? cleanPhone(primeiro(principal.telefones)!) : undefined,
        address: texto(principal?.endereco_logradouro),
        addressNumber: texto(principal?.endereco_numero),
        complement: texto(principal?.endereco_complemento),
        neighborhood: texto(principal?.endereco_bairro),
        city: texto(principal?.endereco_cidade),
        state: texto(principal?.endereco_uf),
        cep: texto(principal?.endereco_cep),
        ...coordenadas(principal?.endereco_ll),
        totalOverdueAmount,
        maxDaysOverdue,
        overdueInvoicesCount: emAberto.length,
        contractStatus: statusDoContratoSgp(principal?.contratoStatus, principal?.contratoStatusDisplay),
        contractPlan: texto(principal?.planointernet) ?? texto(principal?.servico_plano),
        contractStartDate: texto(principal?.dataCadastro),
        erpSource: "sgp",
      };

      return {
        ok: true,
        message: emAberto.length > 0
          ? `Cliente encontrado com ${emAberto.length} fatura(s) vencida(s)`
          : "Cliente encontrado, sem faturas vencidas",
        customers: [cliente],
        totalRecords: 1,
        // A leitura das faturas pode ter parado no meio. Sem isso, um cliente
        // com divida apareceria como "nada consta" — o pior erro possivel num
        // bureau de credito.
        ...(faturas.parcial ? { leituraParcial: true } : {}),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }

  async fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    try {
      const customers: NormalizedErpCustomer[] = [];
      const vistos = new Set<string>();
      let offset = 0;
      let parcial = false;

      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const response = await this.post(
          config,
          "/api/ura/clientes/",
          // Titulos e contatos sao o grosso do payload e nao entram aqui:
          // a divida vem de fetchDelinquents, que le os titulos direito.
          { limit: LIMITE_CLIENTES, offset, omitir_titulos: 1 },
          { timeoutMs: 30000, retries: 2 },
        );

        if (!response.ok) {
          if (customers.length === 0) {
            return { ok: false, message: this.erroDeHttp(response.status), customers: [], totalRecords: 0 };
          }
          parcial = true;
          break;
        }

        const json = (await response.json()) as { clientes?: any[]; paginacao?: { total?: number } };
        const lote = Array.isArray(json?.clientes) ? json.clientes : [];
        if (lote.length === 0) break;

        for (const c of lote) {
          const cpfCnpj = cleanCpfCnpj(String(c?.cpfcnpj ?? ""));
          if (!cpfCnpj || vistos.has(cpfCnpj)) continue;
          vistos.add(cpfCnpj);

          const e = c?.endereco ?? {};
          const contratos: any[] = Array.isArray(c?.contratos) ? c.contratos : [];
          const ativo = contratos.find(k => statusDoContratoSgp(k?.status, k?.status) === "active");
          const escolhido = ativo ?? contratos[0];

          customers.push({
            cpfCnpj,
            name: texto(c?.nome) ?? "",
            address: texto(e?.logradouro),
            addressNumber: texto(e?.numero),
            complement: texto(e?.complemento),
            neighborhood: texto(e?.bairro),
            city: texto(e?.cidade),
            state: texto(e?.uf),
            cep: texto(e?.cep),
            latitude: texto(e?.latitude),
            longitude: texto(e?.longitude),
            totalOverdueAmount: 0,
            maxDaysOverdue: 0,
            contractStatus: escolhido ? statusDoContratoSgp(escolhido?.status, escolhido?.status) : undefined,
            contractStartDate: texto(escolhido?.dataCadastro),
            erpSource: "sgp",
          });
        }

        offset += lote.length;
        const total = Number(json?.paginacao?.total);
        if (Number.isFinite(total) && offset >= total) break;
        if (!Number.isFinite(total) && lote.length < LIMITE_CLIENTES) break;
        if (pagina === MAX_PAGINAS - 1) parcial = true;
      }

      return {
        ok: true,
        message: `${customers.length} clientes encontrados`,
        customers,
        totalRecords: customers.length,
        ...(parcial ? { leituraParcial: true } : {}),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { ok: false, message: `Erro: ${msg}`, customers: [] };
    }
  }
}
