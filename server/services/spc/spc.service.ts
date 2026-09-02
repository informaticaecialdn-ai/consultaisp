/**
 * Cliente do WebService de Consulta do SPC Brasil (SOAP 1.1 sobre HTTPS).
 *
 * Endpoints (documentacao v4.3):
 *   producao:    https://api.spc.org.br/spc/remoting/ws/consulta/consultaWebService
 *   treinamento: https://treinamento.spcbrasil.com.br/spc/remoting/ws/consulta/consultaWebService
 * Auth: HTTP Basic com operador e SENHA DE WEBSERVICE — que e diferente da
 * senha do site ("Informacoes importantes", item 1). SOAPAction vazio, como
 * no exemplo do manual.
 *
 * Operacoes usadas:
 *   consultar        — a consulta paga. Produto padrao 257 (SPC MIX TOP +),
 *                      configuravel por SPC_PRODUCT_CODE.
 *   listarProdutos   — gratuita, so em producao: o que o operador pode
 *                      consultar e que insumos cada produto devolve. Serve de
 *                      teste de credencial sem gastar.
 *   detalharProduto  — gratuita, um produto.
 *
 * Todo o XML e tratado em spc-parser.ts; aqui so rede, credencial, timeout,
 * circuito e classificacao de erro HTTP.
 */
import { logger } from "../../logger";
import { CircuitBreaker, withResilience } from "../../erp/resilience";
import {
  parseRespostaConsulta, parseProdutos, SpcError,
  type SpcResult, type ProdutoSpc,
} from "./spc-parser";

export { SpcError, type SpcResult, type ProdutoSpc, type RestricaoSpc } from "./spc-parser";

export const SPC_URL_PRODUCAO = "https://api.spc.org.br/spc/remoting/ws/consulta/consultaWebService";
export const SPC_URL_TREINAMENTO = "https://treinamento.spcbrasil.com.br/spc/remoting/ws/consulta/consultaWebService";
export const SPC_PRODUTO_PADRAO = 257;

const NS = "http://webservice.consulta.spcjava.spcbrasil.org/";
const TIMEOUT_MS = 30_000;

/**
 * Insumos OPCIONAIS pedidos em toda consulta (SPC_INSUMOS_OPCIONAIS, codigos
 * separados por virgula). No produto 257 (SPC MIX TOP +), medido em
 * 02/09/2026 com listarProdutos, o retorno padrao traz spc, cheque-lojista,
 * ccf, contra-ordem, contumacia, credito-concedido, consulta-realizada,
 * alerta-documento e consumidor; protesto (17), spc-score-12-meses (78),
 * spc-score-3-meses (77), score-cadastro-positivo (5228), spc-obito (3082),
 * renda-presumida-spc (5122) e limite-credito-sugerido (5142) so vem se
 * pedidos — e a entidade pode cobrar cada um. Vazio por padrao: quem decide
 * o que pagar e o dono, na env.
 */
export function insumosOpcionaisPadrao(): number[] {
  return (process.env.SPC_INSUMOS_OPCIONAIS || "")
    .split(",").map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n > 0);
}

/** Lido a cada chamada, nao no import: o teste seta a env depois de importar. */
function config() {
  const username = (process.env.SPC_USERNAME || "").trim();
  const password = process.env.SPC_PASSWORD || "";
  const url = (process.env.SPC_WSDL_URL || SPC_URL_PRODUCAO).replace(/\?wsdl$/i, "");
  const produto = parseInt(process.env.SPC_PRODUCT_CODE || "", 10) || SPC_PRODUTO_PADRAO;
  return { username, password, url, produto, configurado: !!(username && password) };
}

export function isSpcConfigured(): boolean {
  return config().configurado;
}

export function produtoSpcPadrao(): number {
  return config().produto;
}

const circuito = new CircuitBreaker({ maxFailures: 3, resetTimeMs: 60_000 });

/**
 * A camada de autenticacao do SPC responde texto puro "CS_AUT001.E1.x" —
 * em 401 e, no caso de operador bloqueado (E1.7), em 500. Tabela da doc
 * ("CODIGOS DE ERRO DO SISTEMA WS").
 */
const ERROS_AUTENTICACAO: Record<string, string> = {
  "E1.2": "operador ou senha inválidos",
  "E1.2.1": "caracteres informados não coincidem",
  "E1.3": "operador não possui acesso ao dispositivo Web Service",
  "E1.4.1": "operador inativo",
  "E1.4.2": "operador bloqueado",
  "E1.5.2": "associado inativo",
  "E1.5.3": "entidade inativa",
  "E1.5.6": "associado suspenso",
  "E1.5.7": "entidade suspensa",
  "E1.6": "conexão não autorizada (IP não liberado)",
  "E1.6.1": "conexão não autorizada (IP internacional)",
  "E1.7": "operador bloqueado por excesso de tentativas",
  "E1.8": "operador expirou",
  "E1.9": "senha expirou",
  "E1.10": "fora do horário permitido para acesso",
  "E1.12": "operador não possui acesso ao dispositivo",
  "E1.15": "erro de autenticação",
  "E1.17": "operador/senha inválido",
  "E1.18": "operador/senha sem acesso",
};

export function mensagemDeAutenticacao(corpo: string): { codigo: string; mensagem: string } | null {
  const m = corpo.match(/CS_AUT001\.(E\d+(?:\.\d+)*|E\d+\.[XY]|E[23])\b/);
  if (!m) return null;
  return { codigo: `CS_AUT001.${m[1]}`, mensagem: ERROS_AUTENTICACAO[m[1]] ?? `erro de autenticação ${m[1]}` };
}

/**
 * TRAVA ANTI-BLOQUEIO. O SPC bloqueia o operador por excesso de tentativas
 * (CS_AUT001.E1.7) — aconteceu em 02/09/2026 depois de poucas chamadas com a
 * senha errada. Uma credencial recusada nao muda no proximo clique: depois
 * de uma recusa, nenhuma chamada sai por TRAVA_CREDENCIAL_MS, e a rota
 * responde 503 na hora, sem tocar o SPC.
 */
export const TRAVA_CREDENCIAL_MS = 15 * 60_000;
let credencialRecusadaAte = 0;
let motivoDaRecusa = "";

function travarCredencial(motivo: string): void {
  credencialRecusadaAte = Date.now() + TRAVA_CREDENCIAL_MS;
  motivoDaRecusa = motivo;
  logger.warn({ motivo, minutos: TRAVA_CREDENCIAL_MS / 60_000 }, "[SPC] credencial recusada — trava de novas tentativas");
}

export function credencialTravada(): { ate: number; motivo: string } | null {
  return Date.now() < credencialRecusadaAte ? { ate: credencialRecusadaAte, motivo: motivoDaRecusa } : null;
}

export function _resetTravaCredencialParaTestes(): void {
  credencialRecusadaAte = 0;
  motivoDaRecusa = "";
  circuito.reset();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function envelope(corpo: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="${NS}">` +
    `<soapenv:Header/><soapenv:Body>${corpo}</soapenv:Body></soapenv:Envelope>`;
}

export function montarFiltroConsulta(codigoProduto: number, documento: string, insumosOpcionais: number[] = []): string {
  const doc = documento.replace(/\D/g, "");
  const tipo = doc.length === 11 ? "F" : "J";
  const opcionais = insumosOpcionais.map(c => `<codigo-insumo-opcional>${c}</codigo-insumo-opcional>`).join("");
  return envelope(
    `<web:filtro><codigo-produto>${codigoProduto}</codigo-produto>` +
    `<tipo-consumidor>${tipo}</tipo-consumidor>` +
    `<documento-consumidor>${esc(doc)}</documento-consumidor>${opcionais}</web:filtro>`,
  );
}

async function chamar(corpo: string, operacao: string): Promise<string> {
  const { username, password, url, configurado } = config();
  if (!configurado) {
    throw new SpcError("SPC não configurado: defina SPC_USERNAME e SPC_PASSWORD", "NAO_CONFIGURADO", "credencial");
  }
  const auth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  const trava = credencialTravada();
  if (trava) {
    const minutos = Math.max(1, Math.ceil((trava.ate - Date.now()) / 60_000));
    throw new SpcError(
      `SPC recusou a credencial de WebService há pouco (${trava.motivo}). Nova tentativa só em ${minutos} min, para não bloquear o operador.`,
      "TRAVA_CREDENCIAL", "credencial", 401,
    );
  }

  return withResilience(
    async () => {
      let r: Response;
      try {
        r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/xml;charset=UTF-8", Authorization: auth, SOAPAction: '""' },
          body: corpo,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err: any) {
        const motivo = err?.name === "TimeoutError" ? "tempo esgotado" : "falha de rede";
        throw new SpcError(`SPC indisponível (${motivo})`, "REDE", "indisponivel");
      }
      const xml = await r.text();
      // Recusa de credencial: pelo status OU pelo codigo CS_AUT001 no corpo
      // (E1.7 chega com HTTP 500). Com `status` 4xx o withResilience NAO
      // repete, e a trava segura as proximas chamadas.
      const aut = mensagemDeAutenticacao(xml);
      if (aut || r.status === 401 || r.status === 403) {
        const motivo = aut?.mensagem ?? "operador ou senha recusados";
        travarCredencial(motivo);
        throw new SpcError(`SPC recusou a credencial de WebService: ${motivo}`, aut?.codigo ?? `HTTP_${r.status}`, "credencial", 401);
      }
      if (r.status >= 500) {
        throw new SpcError(`SPC indisponível (HTTP ${r.status})`, `HTTP_${r.status}`, "indisponivel", r.status);
      }
      // 200 com Fault e 400/404 com Fault: o parser classifica pelo texto.
      if (r.status !== 200 && !/<(\w+:)?Fault>/.test(xml)) {
        throw new SpcError(`SPC respondeu HTTP ${r.status} em ${operacao}`, `HTTP_${r.status}`, "resposta", r.status);
      }
      return xml;
    },
    // So rede e 5xx repetem, uma vez; o resto sai na primeira.
    { retries: 1, minTimeout: 1500, circuit: circuito },
  );
}

/**
 * A consulta paga. `documento` e CPF (11) ou CNPJ (14). O parser decide se e
 * restrito; o veredito e regra escrita (spc-parser.ts, `risco`).
 */
export async function consultarSpc(
  documento: string,
  opcoes: { codigoProduto?: number; insumosOpcionais?: number[]; guardarXml?: boolean } = {},
): Promise<SpcResult> {
  const doc = documento.replace(/\D/g, "");
  if (doc.length !== 11 && doc.length !== 14) {
    throw new SpcError("Documento precisa ser CPF (11 dígitos) ou CNPJ (14)", "DOCUMENTO", "documento");
  }
  const produto = opcoes.codigoProduto ?? config().produto;
  const insumos = opcoes.insumosOpcionais ?? insumosOpcionaisPadrao();
  const t0 = Date.now();
  logger.info({ doc: doc.slice(0, 3) + "***", produto, insumosOpcionais: insumos }, "[SPC] consulta iniciada");

  const xml = await chamar(montarFiltroConsulta(produto, doc, insumos), "consultar");
  const resultado = parseRespostaConsulta(xml, doc, { guardarXml: opcoes.guardarXml });

  logger.info(
    { doc: doc.slice(0, 3) + "***", produto, protocolo: resultado.protocolo, restricao: resultado.restricao, restricoes: resultado.restrictions.length, score: resultado.score, ms: Date.now() - t0 },
    "[SPC] consulta concluída",
  );
  return resultado;
}

/**
 * Gratuita (so em producao): os produtos que o operador pode consultar.
 * A operacao NAO tem parte de entrada no WSDL: o Body vai VAZIO (e o
 * template do SoapUI da doc). Com <web:listarProdutos/> o servidor devolve
 * "Cannot find the declaration of element" — medido em 02/09/2026.
 */
export async function listarProdutosSpc(): Promise<ProdutoSpc[]> {
  const xml = await chamar(envelope(""), "listarProdutos");
  return parseProdutos(xml);
}

/** Gratuita: os parametros e insumos de um produto. null se o operador nao o tem. */
export async function detalharProdutoSpc(codigo: number): Promise<ProdutoSpc | null> {
  try {
    const xml = await chamar(envelope(`<web:codigo-produto>${codigo}</web:codigo-produto>`), "detalharProduto");
    return parseProdutos(xml)[0] ?? null;
  } catch (err) {
    if (err instanceof SpcError && err.categoria === "produto") return null;
    throw err;
  }
}

/** Status HTTP que a rota devolve para cada categoria de erro do SPC. */
export function statusHttpParaErroSpc(err: SpcError): number {
  switch (err.categoria) {
    case "documento": return 400;
    case "credencial":
    case "produto": return 503;
    case "indisponivel": return 502;
    default: return 502;
  }
}
