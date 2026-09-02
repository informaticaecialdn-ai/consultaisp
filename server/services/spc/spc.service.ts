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
      if (r.status === 401 || r.status === 403) {
        // Com `status` 4xx o withResilience NAO repete: a credencial nao vai
        // mudar no proximo segundo, e insistir pode bloquear o operador.
        throw new SpcError("SPC recusou o operador ou a senha de WebService", `HTTP_${r.status}`, "credencial", r.status);
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
  const t0 = Date.now();
  logger.info({ doc: doc.slice(0, 3) + "***", produto }, "[SPC] consulta iniciada");

  const xml = await chamar(montarFiltroConsulta(produto, doc, opcoes.insumosOpcionais), "consultar");
  const resultado = parseRespostaConsulta(xml, doc, { guardarXml: opcoes.guardarXml });

  logger.info(
    { doc: doc.slice(0, 3) + "***", produto, protocolo: resultado.protocolo, restricao: resultado.restricao, restricoes: resultado.restrictions.length, score: resultado.score, ms: Date.now() - t0 },
    "[SPC] consulta concluída",
  );
  return resultado;
}

/** Gratuita (so em producao): os produtos que o operador pode consultar. */
export async function listarProdutosSpc(): Promise<ProdutoSpc[]> {
  const xml = await chamar(envelope("<web:listarProdutos/>"), "listarProdutos");
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
