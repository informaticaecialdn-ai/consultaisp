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
 * Toda resposta passa por `lerJson`: neste conector nao se chama
 * `response.json()` direto. O motivo esta em `RespostaNaoEhSgp`, logo abaixo.
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
import { corteFinanceiro } from "@shared/motivo-corte";

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
 * Inicio da janela de vencimento pedida ao SGP.
 *
 * Nao e um recorte de politica — e o preco de usar o filtro: o SGP recusa
 * `data_vencimento_fim` sozinho e exige o par. A janela precisa entao comecar
 * antes de qualquer divida que possa existir na base, porque num bureau divida
 * antiga NAO prescreve para efeito de consulta: um calote de 2019 e exatamente
 * o que o provedor vizinho precisa enxergar. Medido: 2000 e 2015 devolvem o
 * mesmo total na base de demonstracao, ou seja, a janela nao esta cortando
 * nada — e e para continuar assim.
 */
const INICIO_DA_JANELA = "2000-01-01";

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

/**
 * Alguem respondeu, mas nao foi o SGP.
 *
 * O caso real, medido em 03/09/2026: o operador colou no campo de URL o
 * endereco para onde o SGP redireciona quem nao esta logado
 * (`.../accounts/login?next=/admin/`). O conector concatena o caminho da API
 * nesse endereco, o servidor devolve a PROPRIA TELA DE LOGIN com HTTP 200, e o
 * teste de conexao — que olhava so `response.ok` — respondeu "conexao ok, 216
 * ms". A URL certa, a origem, devolvia 403 com JSON dizendo que a credencial
 * estava errada.
 *
 * Por que isso nao e cosmetico: o teste de conexao e a unica prova que o
 * operador tem antes de ligar a integracao. Ligada, a varredura passa a ler uma
 * pagina HTML e nao encontra inadimplente nenhum — e o sync usa a lista vazia
 * como prova NEGATIVA, baixando a divida de quem nao esta nela. Um "ok"
 * mentiroso aqui limpa a inadimplencia de um provedor inteiro.
 *
 * Qualquer coisa responde 200: pagina de login, portal cativo de wifi, proxy
 * reverso mal apontado, pagina de erro amigavel de CDN, dominio parqueado. So a
 * FORMA da resposta prova quem atendeu.
 */
class RespostaNaoEhSgp extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RespostaNaoEhSgp";
  }
}

/**
 * Falta um campo de configuracao — nao e recusa do SGP.
 *
 * Separada de `RespostaNaoEhSgp` porque a acao e outra: aqui ninguem chegou a
 * falar com o SGP, e a mensagem tem de mandar preencher o campo em vez de
 * mandar conferir credencial. Ver `assegurarApp`.
 */
class ConfiguracaoIncompleta extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfiguracaoIncompleta";
  }
}

const MSG_NAO_E_JSON =
  "O endereco respondeu, mas nao com a API do SGP: veio uma pagina em vez de dados. " +
  "Provavelmente a URL aponta para a tela de login do SGP ou para outro sistema. " +
  "Informe apenas o endereco do servidor, sem caminho nem parametros.";

const MSG_FORMA_INESPERADA =
  "O endereco respondeu em JSON, mas sem os campos que a API do SGP devolve. " +
  "Provavelmente a URL aponta para outro sistema, ou ha um proxy no meio do caminho. " +
  "Confira o endereco do servidor.";

/**
 * A forma de /api/ura/titulos/: `{ paginacao: {...}, titulos: [...] }`.
 *
 * Conferir os dois campos e o que separa "e a API do SGP" de "e um JSON
 * qualquer" — um proxy que devolva `{}` ou `{"status":"ok"}` reprova aqui.
 */
function ehEnvelopeDeTitulos(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const j = json as { paginacao?: unknown; titulos?: unknown };
  return Array.isArray(j.titulos) && !!j.paginacao && typeof j.paginacao === "object";
}

/** A forma de /api/ura/consultacliente/: `{ msg, contratos: [...] }`. */
function ehRespostaDeCliente(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const j = json as { msg?: unknown; contratos?: unknown };
  // `msg` sozinho vale: o "Nenhum contrato localizado" pode vir sem a lista.
  return Array.isArray(j.contratos) || typeof j.msg === "string";
}

/**
 * Mensagem de falha para o operador.
 *
 * Quando ja sabemos explicar o que aconteceu, a explicacao vai crua. So o que
 * sobra sem diagnostico leva o prefixo tecnico.
 */
function mensagemDeFalha(err: unknown): string {
  if (err instanceof RespostaNaoEhSgp) return err.message;
  // A frase ja e a instrucao; prefixar "Erro:" so afasta o operador dela.
  if (err instanceof ConfiguracaoIncompleta) return err.message;
  return `Erro: ${err instanceof Error ? err.message : "Erro desconhecido"}`;
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

  /**
   * token + app + os filtros da chamada, no formato que o SGP le.
   *
   * O nome do app sai EXATAMENTE como foi gravado — sem aparar, sem rebaixar
   * caixa, sem palpite. O SGP casa a string inteira: "Consultaisp" e
   * "consultaisp" sao aplicacoes diferentes para ele, e a segunda nao existe.
   *
   * Havia aqui um `|| "consultaisp"` para o caso de o campo faltar. Ele
   * transformava "voce nao configurou o nome do app" em "o SGP recusou a
   * credencial": o palpite ia junto do token bom, o SGP nao achava o par, e o
   * operador lia uma mensagem sobre credencial errada e ia mexer no token.
   * Faltar o nome e erro de configuracao e tem de aparecer como tal — a
   * validacao esta em `configFields`, e `assegurarApp` e a rede embaixo dela.
   */
  private corpo(config: ErpConnectionConfig, campos: Record<string, string | number> = {}): string {
    const p = new URLSearchParams();
    p.set("token", config.apiToken ?? "");
    p.set("app", this.assegurarApp(config));
    for (const [k, v] of Object.entries(campos)) p.set(k, String(v));
    return p.toString();
  }

  /** O nome do app como esta gravado, ou a recusa que diz o que fazer. */
  private assegurarApp(config: ErpConnectionConfig): string {
    const app = config.extra?.sgpApp;
    if (typeof app === "string" && app.length > 0) return app;
    throw new ConfiguracaoIncompleta(
      "O Nome do App do SGP nao esta preenchido. Ele e gerado junto com o token em Administracao > Integracoes > Tokens, e precisa ser copiado da lista Aplicacoes com as mesmas maiusculas.",
    );
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
   * Le o corpo exigindo que ele seja JSON de verdade, e nao qualquer coisa com
   * status 200.
   *
   * Nunca chame `response.json()` direto neste conector: alem de deixar passar
   * a checagem de content-type, o erro dele ("Unexpected token '<'") chega ao
   * operador sem dizer o que fazer. Ver `RespostaNaoEhSgp`.
   */
  private async lerJson(response: Response): Promise<unknown> {
    const tipo = (response.headers?.get("content-type") ?? "").toLowerCase();
    const corpo = await response.text();
    if (!tipo.includes("json")) throw new RespostaNaoEhSgp(MSG_NAO_E_JSON);
    try {
      return JSON.parse(corpo);
    } catch {
      throw new RespostaNaoEhSgp(MSG_NAO_E_JSON);
    }
  }

  /**
   * O `detail` que o SGP manda junto do 401/403.
   *
   * Corpo ilegivel aqui nao e erro: quem chama ja tem o status para explicar o
   * basico, e o detalhe so refina a mensagem.
   */
  private async detalheDoErro(response: Response): Promise<string | undefined> {
    try {
      // `erro` entra ao lado de `detail`: o SGP usa chaves DIFERENTES conforme a
      // camada que recusou. A autenticacao (Django REST) responde `detail`; a
      // validacao de parametro responde `erro` — foi assim que o 400 de
      // `data_vencimento_inicio` chegou como "SGP respondeu com status 400",
      // escondendo a frase que dizia exatamente o que faltava.
      const json = JSON.parse(await response.text()) as {
        detail?: unknown; message?: unknown; erro?: unknown;
      };
      return texto(json?.detail) ?? texto(json?.erro) ?? texto(json?.message);
    } catch {
      return undefined;
    }
  }

  private async mensagemDeErro(response: Response): Promise<string> {
    return this.erroDeHttp(response.status, await this.detalheDoErro(response));
  }

  /**
   * Traduz o status HTTP em algo que o provedor consiga agir.
   *
   * "SGP respondeu com status 403" nao diz a ninguem que o token esta errado
   * ou que o host nao esta na lista permitida do token — e as duas coisas se
   * resolvem em telas diferentes do SGP.
   */
  private erroDeHttp(status: number, detalhe?: string): string {
    /**
     * As duas frases saem do MESMO 403 e significam coisas OPOSTAS. Ate
     * 04/09/2026 este bloco as tinha TROCADAS, e a tela passou dois dias
     * mandando o provedor conferir o nome do app justamente quando o nome
     * estava certo — ele trocou o token duas vezes e mexeu na permissao do
     * usuario atras de um erro que nao era nenhum dos dois.
     *
     * O experimento que desfez a confusao (SGP real da Amplinet, do IP
     * liberado, uma variavel por vez): com o par gravado, `app="Consultaisp"`
     * devolve "nao foram fornecidas"; TODA outra grafia — "consultaisp",
     * "CONSULTAISP", "ConsultaISP", sem app — devolve "incorretas". Se a
     * segunda frase saisse de par valido bloqueado, ela nao mudaria conforme
     * a grafia. Logo:
     *
     *   · "incorretas"          = AuthenticationFailed. O par token+app NAO
     *                             EXISTE. Erro de digitacao ou token revogado.
     *   · "nao foram fornecidas" = NotAuthenticated. O autenticador ACHOU o
     *                             par e mesmo assim desistiu — host fora da
     *                             lista, token inativo, ou o usuario ligado ao
     *                             token sem permissao/inativo.
     *
     * A frase generica do Django engana porque parece dizer "voce nao mandou
     * credencial". Ela quer dizer "nenhum autenticador produziu um usuario".
     */
    if (status === 401 || status === 403) {
      const d = achatar(detalhe ?? "");
      if (d.includes("incorretas")) {
        return `O SGP nao encontrou este par token + nome do app (${status}). O Nome do App e sensivel a maiusculas: copie-o da lista Aplicacoes em Administracao > Integracoes > Tokens em vez de digitar. Confira tambem se o token nao foi revogado.`;
      }
      if (d.includes("nao foram fornecidas")) {
        return `O SGP reconheceu o token e o nome do app, e ainda assim recusou (${status}). O par esta certo — o bloqueio esta nas restricoes do token ou no usuario ligado a ele. Em Administracao > Integracoes > Tokens, abra este token e confira: "Hosts permitidos" vazio ou com o IP de saida do nosso servidor; o token ativo; e o usuario vinculado ativo e com permissao de listar cliente, contrato e titulo.`;
      }
    }
    if (status === 401) return "Token ou nome do app recusado pelo SGP (401). Confira em Administracao > Integracoes > Tokens.";
    if (status === 403) return "O SGP recusou o acesso (403). O token pode estar inativo ou restrito a outros hosts/rotas.";
    if (status === 404) return "Endereco nao encontrado no SGP (404). Confira a URL do servidor.";
    if (status >= 500) return `O servidor SGP respondeu com erro interno (${status}).`;
    // Quando o SGP explica a recusa, a explicacao DELE vale mais que o numero.
    // O 400 de parametro e o caso vivo: "SGP respondeu com status 400" nao diz
    // nada, enquanto o corpo trazia "[data_vencimento_inicio] obrigatoria caso
    // [data_vencimento_fim] informada" — a frase que resolvia o problema.
    if (detalhe) return `SGP respondeu com status ${status}: ${detalhe}`;
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
      if (!response.ok) return { ok: false, message: await this.mensagemDeErro(response), latencyMs };

      // Status 200 nao prova nada — ver `RespostaNaoEhSgp`. O que prova e a
      // resposta ter a forma do endpoint chamado.
      const json = await this.lerJson(response);
      if (!ehEnvelopeDeTitulos(json)) return { ok: false, message: MSG_FORMA_INESPERADA, latencyMs };

      return { ok: true, message: "Conexao com SGP estabelecida com sucesso", latencyMs };
    } catch (err: unknown) {
      return { ok: false, message: mensagemDeFalha(err), latencyMs: Date.now() - start };
    }
  }

  /**
   * Uma pagina de listagem: ou o lote lido, ou a explicacao de por que a
   * resposta nao serve.
   *
   * Resposta que nao entendemos NUNCA vira lista vazia. Essa lista e usada pelo
   * sync como prova negativa — quem nao aparece nela tem a divida baixada —,
   * entao "nao consegui ler" e "ninguem deve nada" nao podem terminar na mesma
   * resposta.
   */
  private async lerPagina(
    response: Response,
    campo: "titulos" | "clientes",
  ): Promise<{ itens: unknown[]; total: number } | { erro: string }> {
    if (!response.ok) return { erro: await this.mensagemDeErro(response) };

    let json: unknown;
    try {
      json = await this.lerJson(response);
    } catch (err: unknown) {
      return { erro: mensagemDeFalha(err) };
    }

    const itens = (json as Record<string, unknown> | null)?.[campo];
    if (!Array.isArray(itens)) return { erro: MSG_FORMA_INESPERADA };

    return { itens, total: Number((json as { paginacao?: { total?: unknown } })?.paginacao?.total) };
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

      const pg = await this.lerPagina(response, "titulos");
      if ("erro" in pg) return { titulos, parcial: true, erro: pg.erro };

      const lote = pg.itens as TituloSgp[];
      titulos.push(...lote);

      const total = pg.total;
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
    /** Texto CRU do `motivo_status` do contrato. Ver shared/motivo-corte.ts. */
    motivoCorte?: string;
    /** `data_status`: quando o contrato passou a este status. */
    cortadoEm?: string;
    dados: Partial<NormalizedErpCustomer>;
  }>> {
    const mapa = new Map<string, {
      contractStatus: NormalizedErpCustomer["contractStatus"];
      contractStartDate?: string;
      /** Texto CRU do `motivo_status` do contrato. Ver shared/motivo-corte.ts. */
      motivoCorte?: string;
      /** `data_status`: quando o contrato passou a este status. */
      cortadoEm?: string;
      dados: Partial<NormalizedErpCustomer>;
    }>();

    const response = await this.post(config, "/api/ura/listacontrato/", { exibir_endereco: 1 }, { timeoutMs: 60000, retries: 1 });
    if (!response.ok) return mapa;

    let json: unknown;
    try {
      json = await this.lerJson(response);
    } catch {
      // Cadastro ilegivel deixa o status em "nao sei", que e inofensivo: o
      // anti-fraude so avisa com prova de contrato ativo. Derrubar a lista de
      // inadimplentes por causa do cadastro seria trocar um dado ausente por
      // um dado perdido.
      return mapa;
    }
    const linhas: any[] = Array.isArray(json) ? json : ((json as any)?.contratos ?? []);

    for (const c of linhas) {
      const cpfCnpj = cleanCpfCnpj(String(c?.cpfcnpj ?? ""));
      if (!cpfCnpj) continue;

      const status = statusDoContratoSgp(c?.status, c?.status);
      const e = c?.endereco ?? {};
      const registro = {
        contractStatus: status,
        contractStartDate: texto(c?.data_cadastro),
        /**
         * POR QUE o contrato acabou, e QUANDO.
         *
         * Estes dois campos ja vinham nesta mesma resposta e eram descartados.
         * Medido na Amplinet em 04/09/2026: 214 contratos cancelados por motivo
         * administrativo (o cliente pediu para sair) contra 66 por financeiro
         * (o provedor cortou por falta de pagamento) — e na nossa base os dois
         * grupos ficavam identicos, porque so guardavamos "cancelled".
         *
         * O texto vai CRU. A traducao para as duas familias mora em
         * shared/motivo-corte.ts, e um conector nao e lugar de decidir o que
         * "Financeiro - SPC" significa para o score.
         */
        motivoCorte: texto(c?.motivo_status),
        cortadoEm: texto(c?.data_status),
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
        /**
         * O MOTIVO segue a regra OPOSTA a do status, de proposito.
         *
         * O status vigente vence porque a pergunta e "ele e cliente hoje?". O
         * motivo do corte vence pelo PIOR, porque a pergunta e outra: "ja houve
         * calote?". Um cliente com um contrato encerrado a pedido e outro
         * cortado por falta de pagamento TEM historico de inadimplencia, e
         * deixar o administrativo sobrescrever apagaria justamente o que o
         * bureau existe para lembrar.
         *
         * Por isso o registro que entra no mapa herda o motivo financeiro que
         * ja estava la, em vez de perde-lo.
         */
        const financeiroAnterior = corteFinanceiro(anterior?.motivoCorte);
        mapa.set(cpfCnpj, financeiroAnterior && !corteFinanceiro(registro.motivoCorte)
          ? { ...registro, motivoCorte: anterior!.motivoCorte, cortadoEm: anterior!.cortadoEm }
          : registro);
      } else if (corteFinanceiro(registro.motivoCorte) && !corteFinanceiro(anterior.motivoCorte)) {
        // O contrato perdedor traz a prova de calote que o vencedor nao tem.
        mapa.set(cpfCnpj, { ...anterior, motivoCorte: registro.motivoCorte, cortadoEm: registro.cortadoEm });
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
      //
      // As DUAS datas vao juntas porque o SGP exige o par. Mandar so o fim
      // devolve `400 {"erro":"[data_vencimento_inicio] obrigatória caso
      // [data_vencimento_fim] informada"}` — e era o que este conector fazia:
      // a varredura completa falhava em TODO provedor, sempre, e como nenhum
      // tinha SGP ligado ninguem viu. Medido contra o SGP de demonstracao da
      // TSMX em 03/09/2026. A colecao Postman lista os dois parametros e nao
      // diz que um exige o outro; so a API real ensina.
      //
      // O ganho de filtrar continua valendo: na mesma base medida, o par de
      // datas levou 7.033 titulos abertos para 6.535 — as 498 que sairam sao
      // faturas em aberto que ainda NAO venceram, que nao sao inadimplencia.
      const { titulos, parcial, erro } = await this.paginarTitulos(config, {
        status: "abertos",
        data_vencimento_inicio: INICIO_DA_JANELA,
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
        // Por que o contrato acabou, e quando. Sem isto, quem pediu para sair
        // fica indistinguivel de quem foi cortado por falta de pagamento.
        c.motivoCorte = info.motivoCorte;
        c.cortadoEm = info.cortadoEm;
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
      return { ok: false, message: mensagemDeFalha(err), customers: [] };
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
        return { ok: false, message: await this.mensagemDeErro(resCliente), customers: [] };
      }

      const json = await this.lerJson(resCliente);
      // Sem a forma do endpoint, "sem contrato" seria indistinguivel de "nao
      // falei com o SGP" — e num bureau isso vira "nada consta" sobre quem deve.
      if (!ehRespostaDeCliente(json)) throw new RespostaNaoEhSgp(MSG_FORMA_INESPERADA);
      const contratos = Array.isArray((json as { contratos?: unknown })?.contratos)
        ? ((json as { contratos: any[] }).contratos)
        : [];
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
      return { ok: false, message: mensagemDeFalha(err), customers: [] };
    }
  }

  /**
   * A coordenada da instalacao, na ficha do cliente.
   *
   * O SGP guarda a mesma informacao em dois lugares e nao os mantem iguais:
   * `/api/ura/clientes/` traz `endereco.latitude` e `endereco.longitude`, e
   * `/api/ura/consultacliente/` traz `endereco_ll` ("lat,lng") por contrato.
   * Medido na Amplinet em 04/09/2026: no lote de 100 cadastros, 64 tinham
   * latitude e 60 longitude — e entre os clientes que continuavam FORA DO MAPA,
   * 9 de 25 tinham `endereco_ll` preenchido aqui, com a listagem em lote vazia.
   *
   * Sao ~36% dos que a plotagem estava tentando adivinhar pelo nome da rua. E
   * adivinhar era mesmo o caso: dos 145 enderecos pendentes, so 21 existiam na
   * base do IBGE — o resto e viela, estrada e chacara que o censo nao nomeia
   * igual. A coordenada do ERP e o ponto da instalacao, nao um palpite.
   *
   * Uma requisicao por cliente. Fica fora de `fetchCustomers` por isso — ver a
   * nota em `ErpConnector.fetchCoordenadaPorCpf`.
   */
  async fetchCoordenadaPorCpf(
    config: ErpConnectionConfig,
    cpfCnpj: string,
  ): Promise<{ latitude: string; longitude: string } | null> {
    const doc = cleanCpfCnpj(cpfCnpj);
    if (!doc) return null;
    try {
      const response = await this.post(
        config, "/api/ura/consultacliente/", { cpfcnpj: doc },
        { timeoutMs: 15000, retries: 1 },
      );
      if (!response.ok) return null;

      const json = await this.lerJson(response);
      const contratos = (json as any)?.contratos;
      if (!Array.isArray(contratos)) return null;

      // O primeiro contrato que TIVER coordenada. Um cliente com mais de um
      // contrato pode ter a instalacao georreferenciada em so um deles, e
      // desistir no primeiro vazio perderia o dado que existe.
      for (const ct of contratos) {
        const c = coordenadas(ct?.endereco_ll);
        if (c.latitude && c.longitude) return { latitude: c.latitude, longitude: c.longitude };
      }
      return null;
    } catch {
      // Falha aqui nao e defeito: quem chama segue para a geocodificacao, que e
      // o que acontecia antes deste metodo existir.
      return null;
    }
  }

  async fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    try {
      const customers: NormalizedErpCustomer[] = [];
      const vistos = new Set<string>();
      let offset = 0;
      let parcial = false;
      /** Cadastros que o SGP provou nao ter contrato. Ver o bloco no laco. */
      let semContrato = 0;

      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const response = await this.post(
          config,
          "/api/ura/clientes/",
          // Titulos e contatos sao o grosso do payload e nao entram aqui:
          // a divida vem de fetchDelinquents, que le os titulos direito.
          { limit: LIMITE_CLIENTES, offset, omitir_titulos: 1 },
          { timeoutMs: 30000, retries: 2 },
        );

        const pg = await this.lerPagina(response, "clientes");
        if ("erro" in pg) {
          if (customers.length === 0) {
            return { ok: false, message: pg.erro, customers: [], totalRecords: 0 };
          }
          parcial = true;
          break;
        }

        const lote = pg.itens as any[];
        if (lote.length === 0) break;

        for (const c of lote) {
          const cpfCnpj = cleanCpfCnpj(String(c?.cpfcnpj ?? ""));
          if (!cpfCnpj || vistos.has(cpfCnpj)) continue;
          vistos.add(cpfCnpj);

          const e = c?.endereco ?? {};

          /**
           * CADASTRO SEM CONTRATO NAO ENTRA — regra do dono.
           *
           * A distincao entre as duas linhas abaixo e o ponto todo: um array
           * VAZIO e prova de que este cadastro nao tem contrato nenhum; um
           * campo AUSENTE e "o SGP nao contou", e pular nesse caso esvaziaria a
           * carteira. O codigo anterior colapsava os dois em `[]` e seguia
           * adiante, entao "nao sei" chegava ao storage como `contractStatus:
           * undefined` — e la, em customers.storage.ts, cliente novo sem status
           * nasce "active".
           *
           * O estrago, medido na Amplinet em 04/09/2026: dos 937 clientes
           * gravados, 71 nao tinham contrato nenhum no SGP e os 71 estavam
           * ATIVOS. Isso infla a carteira que o dono le e, pior, "ativo + fatura
           * vencida" e exatamente a condicao que dispara o anti-fraude — avisar
           * um provedor sobre alguem que nunca foi cliente dele e o falso
           * positivo mais caro que este produto pode cometer.
           *
           * Medido no SGP da Amplinet: em 100 cadastros, `contratos` veio array
           * em 100 e VAZIO em 8. O campo e confiavel, entao a prova existe.
           *
           * O IXC e o MK ja faziam isto (`if (contratos.lidos && !resumo)`); o
           * SGP ficou de fora quando o conector foi reescrito em 03/09.
           */
          const contratosLidos = Array.isArray(c?.contratos);
          const contratos: any[] = contratosLidos ? c.contratos : [];
          if (contratosLidos && contratos.length === 0) {
            semContrato++;
            continue;
          }

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
        const total = pg.total;
        if (Number.isFinite(total) && offset >= total) break;
        if (!Number.isFinite(total) && lote.length < LIMITE_CLIENTES) break;
        if (pagina === MAX_PAGINAS - 1) parcial = true;
      }

      return {
        ok: true,
        // O descartado sai na mensagem porque ele explica a diferenca entre o
        // numero que o provedor ve no SGP e o que ele ve aqui. Sem essa linha, a
        // carteira menor parece perda de dado.
        message:
          `${customers.length} clientes encontrados` +
          (semContrato > 0 ? `, ${semContrato} cadastro(s) sem contrato ignorados` : ""),
        customers,
        totalRecords: customers.length,
        ...(parcial ? { leituraParcial: true } : {}),
      };
    } catch (err: unknown) {
      return { ok: false, message: mensagemDeFalha(err), customers: [] };
    }
  }
}
