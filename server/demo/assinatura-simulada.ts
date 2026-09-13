/**
 * A assinatura eletrônica de mentira da demonstração pública.
 *
 * A confissão de dívida (CPC 784, III) só se emite pela conta ZapSign do
 * PROVEDOR, que o superadmin cadastra em `assinatura_integracoes`. O sandbox
 * de um visitante nunca tem essa linha — e não pode ter: seria um token de
 * verdade numa página pública. Sem ela, o 360 desligava "Emitir confissão" em
 * todos os clientes e a aba Integração dizia "não configurada".
 *
 * Por que imitar o HTTP em vez de dublar os serviços (o mesmo desenho do chat
 * simulado): `clienteZapSign` faz toda chamada por `fetchImpl`. Entregando a
 * ele este `fetch` local, a demonstração exercita o cliente REAL — o Zod da
 * resposta, a recusa por status, o mesmo `ErroDeConfissao` — e a emissão, o
 * retorno e o cancelar seguem o caminho de produção até o banco local. Aqui
 * nada chama `globalThis.fetch`; rota que o simulado não conhece é 404 local.
 *
 * Três garantias que valem mais que a tela:
 * - SEMPRE SANDBOX. A conta simulada é `ambiente: "sandbox"` e todo documento
 *   responde `sandbox: true`, até num pedido ao host de produção — uma linha de
 *   produção que chegasse aqui cairia no "ambiente divergente" do retorno. Na
 *   demonstração nada vira título executivo: o selo de título assinado e a
 *   interrupção da prescrição só existem para a assinada de PRODUÇÃO
 *   (`confissaoDoSelo`); a de sandbox é o selo "TESTE — sem validade jurídica".
 * - NINGUÉM ASSINA. O documento fica `pending`, sem link de assinatura
 *   (`sign_url: null` — um link inventado mandaria o visitante a uma página de
 *   terceiro) e sem arquivo assinado. O reenvio responde zero entregas.
 * - O RETORNO NÃO ALCANÇA. O webhook público do ZapSign autentica pelo segredo
 *   gravado em `assinatura_integracoes`. O segredo daqui nasce aleatório no
 *   processo e nunca é gravado, então todo retorno a um sandbox é o 401 uniforme.
 *
 * Sem memória: o token do documento carrega o id da confissão e os papéis dos
 * signatários, e a reconsulta remonta o mesmo documento a partir dele. Assim a
 * reconciliação do WORKER (outro processo) enxerga o que a API criou, e não há
 * `Map` para encher nem para limpar quando o sandbox é apagado — as linhas de
 * `cobranca_confissoes` que o visitante emitir já saem em `apagarSandbox`.
 */
import { randomBytes } from "node:crypto";
import { AUTH_MODE_PADRAO, PRAZO_PADRAO_DE_ASSINATURA_DIAS } from "@shared/cobranca/confissao";
import type { IntegracaoComCredencial } from "../storage/assinatura.storage";

const SEGREDO_DO_WEBHOOK_SIMULADO = randomBytes(32).toString("base64url");

/** A prova do representante do provedor é a mesma que a emissão pede ao ZapSign (`confissao-emissao.service.ts`). */
const AUTH_MODE_DO_PROVEDOR = "assinaturaTela-tokenEmail";

/**
 * A conta ZapSign do sandbox, montada em memória — nunca lida nem gravada em
 * `assinatura_integracoes`. Modelo padrão sem parecer jurídico (o texto sai
 * com os dois avisos) e só o devedor assina, como a integração nasce.
 */
export function integracaoDaAssinaturaSimulada(providerId: number): IntegracaoComCredencial {
  return {
    id: 0,
    providerId,
    fornecedor: "zapsign",
    apiToken: "demo-assinatura-simulada",
    ambiente: "sandbox",
    templateId: null,
    signatarioNome: null,
    signatarioCpf: null,
    signatarioEmail: null,
    signatarioTelefone: null,
    provedorAssina: false,
    authModeCliente: AUTH_MODE_PADRAO,
    exigirSelfie: false,
    prazoAssinaturaDias: PRAZO_PADRAO_DE_ASSINATURA_DIAS,
    enviarArquivoAssinadoWhatsapp: false,
    modeloRevisadoEm: null,
    modeloRevisadoPorUserId: null,
    webhookSecret: SEGREDO_DO_WEBHOOK_SIMULADO,
    isEnabled: true,
    ativadaEm: null,
    createdAt: null,
    updatedAt: null,
  };
}

// ---------------------------------------------------------------------------
// O documento, remontado do token
// ---------------------------------------------------------------------------

type Papel = "cliente" | "provedor" | "sem-id";
interface DocumentoSimulado { token: string; papeis: Papel[] }

/** `demo-doc-<confissão>~<papéis>` — ex.: `demo-doc-77~provedor.cliente`. */
const TOKEN_DO_DOCUMENTO = /^demo-doc-([a-z0-9]+)~((?:cliente|provedor|sem-id)(?:\.(?:cliente|provedor|sem-id))*)$/;

/** Só os dois `external_id` que a emissão manda; o signatário do modelo do ZapSign vem sem. */
const papelDe = (externalId: unknown): Papel => (externalId === "cliente" || externalId === "provedor" ? externalId : "sem-id");

function lerDocumento(token: string): DocumentoSimulado | null {
  const m = TOKEN_DO_DOCUMENTO.exec(token);
  return m ? { token, papeis: m[2].split(".") as Papel[] } : null;
}

function assinante(docToken: string, papel: Papel, sufixo: string) {
  return {
    token: `${docToken}~${sufixo}`,
    status: "new",
    sign_url: null,
    signed_at: null,
    auth_mode: papel === "provedor" ? AUTH_MODE_DO_PROVEDOR : AUTH_MODE_PADRAO,
    external_id: papel === "sem-id" ? null : papel,
  };
}

/** O signatário pelo token dele: `<documento>~<posição>` ou `<documento>~mais-<papel>` (o acrescentado depois). */
function assinanteDoToken(token: string) {
  const corte = token.lastIndexOf("~");
  const doc = corte > 0 ? lerDocumento(token.slice(0, corte)) : null;
  if (!doc) return null;
  const sufixo = token.slice(corte + 1);
  const papel = /^\d+$/.test(sufixo) ? doc.papeis[Number(sufixo)] : /^mais-(cliente|provedor|sem-id)$/.exec(sufixo)?.[1] as Papel | undefined;
  return papel ? assinante(doc.token, papel, sufixo) : null;
}

function documento(doc: DocumentoSimulado) {
  return {
    token: doc.token,
    status: "pending",
    signed_at: null,
    signed_file: null,
    original_file: null,
    deleted: false,
    sandbox: true,
    signers: doc.papeis.map((papel, i) => assinante(doc.token, papel, String(i))),
  };
}

// ---------------------------------------------------------------------------
// Roteador
// ---------------------------------------------------------------------------

interface Resposta { status: number; corpo?: unknown }
type Rota = readonly [metodo: string, padrao: RegExp, tratar: (corpo: Record<string, unknown>, params: string[]) => Resposta];

const ok = (corpo: unknown): Resposta => ({ status: 200, corpo });
const naoEncontrado = (): Resposta => ({ status: 404, corpo: { message: "Este documento não existe na assinatura simulada da demonstração" } });
const comDocumento = (token: string, tratar: (doc: DocumentoSimulado) => Resposta): Resposta => {
  const doc = lerDocumento(token);
  return doc ? tratar(doc) : naoEncontrado();
};

function criar(externalId: unknown, papeis: Papel[]): Resposta {
  if (papeis.length === 0) return { status: 400, corpo: { message: "Documento sem signatário" } };
  // O id da confissão (`confissao:<id>`) é único no banco; sem ele, um sufixo aleatório.
  const chave = typeof externalId === "string" ? /^confissao:(\d+)$/.exec(externalId)?.[1] : undefined;
  return ok(documento({ token: `demo-doc-${chave ?? randomBytes(6).toString("hex")}~${papeis.join(".")}`, papeis }));
}

/** As rotas de `server/assinatura/zapsign.ts`, sem o prefixo `/api/v1`. */
const ROTAS: readonly Rota[] = [
  ["GET", /^\/docs\/$/, () => ok({ count: 0, results: [] })],
  ["POST", /^\/docs\/$/, corpo => criar(corpo.external_id, Array.isArray(corpo.signers) ? corpo.signers.map(s => papelDe((s as { external_id?: unknown } | null)?.external_id)) : [])],
  ["POST", /^\/models\/create-doc\/$/, corpo => criar(corpo.external_id, ["sem-id"])],
  ["GET", /^\/docs\/([^/]+)\/$/, (_corpo, [token]) => comDocumento(token, doc => ok(documento(doc)))],
  ["DELETE", /^\/docs\/([^/]+)\/$/, (_corpo, [token]) => comDocumento(token, () => ({ status: 200 }))],
  ["POST", /^\/docs\/([^/]+)\/add-signer\/$/, (corpo, [token]) => comDocumento(token, doc => ok(assinante(doc.token, papelDe(corpo.external_id), `mais-${papelDe(corpo.external_id)}`)))],
  ["POST", /^\/docs\/([^/]+)\/resend-notifications-bulk\/$/, (_corpo, [token]) => comDocumento(token, () => ok({ sent_count: 0, failed_count: 0 }))],
  ["POST", /^\/signers\/([^/]+)\/$/, (_corpo, [token]) => { const s = assinanteDoToken(token); return s ? ok(s) : naoEncontrado(); }],
  // O `url` e o cabeçalho do webhook são descartados: não há ZapSign para chamá-lo de volta.
  ["POST", /^\/user\/company\/webhook\/$/, corpo => (typeof corpo.doc_token === "string" && lerDocumento(corpo.doc_token) ? ok({ id: `demo-webhook-${corpo.doc_token}` }) : naoEncontrado())],
  ["DELETE", /^\/user\/company\/webhook\/delete\/$/, () => ({ status: 200 })],
];

function lerCorpo(body: unknown): Record<string, unknown> {
  if (typeof body !== "string" || !body) return {};
  try {
    const v = JSON.parse(body);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function responder(r: Resposta): Response {
  return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
}

const doZapSign = (host: string) => host === "zapsign.com.br" || host.endsWith(".zapsign.com.br");

/** O `fetch` que `clienteZapSign` recebe na demonstração. Nunca lança e nunca sai do processo. */
export const fetchDaAssinaturaSimulada: typeof fetch = async (entrada, init) => {
  try {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    const metodo = (init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
    // Download de arquivo assinado (link S3) e qualquer outro host: não existe aqui.
    if (doZapSign(url.hostname) && url.pathname.startsWith("/api/v1/")) {
      const caminho = url.pathname.slice("/api/v1".length);
      for (const [verbo, padrao, tratar] of ROTAS) {
        if (verbo !== metodo) continue;
        const m = padrao.exec(caminho);
        if (m) return responder(tratar(lerCorpo(init?.body), m.slice(1).map(decodeURIComponent)));
      }
    }
    return responder({ status: 404, corpo: { message: "Esta rota não existe na assinatura simulada da demonstração" } });
  } catch {
    return responder({ status: 500, corpo: { message: "A assinatura simulada da demonstração não conseguiu responder" } });
  }
};
