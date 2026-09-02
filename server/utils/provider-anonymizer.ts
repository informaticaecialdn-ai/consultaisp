/**
 * CODIGO DE PROVEDOR PARCEIRO — pseudonimo pareado por observador.
 *
 * Quando um provedor ve dados de OUTRO provedor da rede (quem consultou o
 * cliente dele, de quem e a ocorrencia no relatorio), ele ve um codigo, nao o
 * nome:
 *
 *   codigo = HMAC-SHA256(chave, "v1:" + observador + ":" + parceiro) -> ISP-XXX-XXX
 *
 *   - PAREADO: o codigo depende de QUEM OLHA. O provedor A ve um codigo para
 *     Z; o provedor B ve outro. Dois provedores comparando telas nao descobrem
 *     que falam do mesmo terceiro, e "eu sou o ISP-..." nao existe — nao ha
 *     "o codigo de Z". E o `sub` pareado do OpenID Connect.
 *   - ESTAVEL dentro do par: A ve sempre o mesmo codigo para Z, em toda tela
 *     (alerta, relatorio, timeline). "O mesmo parceiro consultou tres
 *     clientes meus esta semana" continua legivel.
 *   - CHAVEADO: a chave vem do ambiente (PARTNER_CODE_SECRET ou, sem ele,
 *     SESSION_SECRET, via HKDF), nunca do fonte. O esquema anterior era
 *     sha256 de um salt fixo no codigo + id serial: com o fonte em maos, a
 *     tabela id -> codigo de 100 mil ids saia em menos de um segundo. E
 *     terminava com a INICIAL DO NOME do provedor — numa mesorregiao com 2 a
 *     10 provedores, uma letra isolava o parceiro.
 *   - NADA DO NOME entra. Nem inicial, nem hash do nome.
 *   - RESOLVIVEL so pelo controlador: com a chave e o observador, o superadmin
 *     recomputa o codigo para os candidatos da regiao (resolvePartnerCode).
 *     Pseudonimo reversivel pelo controlador e o que a LGPD chama de
 *     pseudonimizacao (art. 13, par. 4).
 *
 *   - "SEU CODIGO": cada provedor conhece um codigo proprio, para se
 *     identificar ao suporte, derivado em OUTRO dominio de chave
 *     (generateOwnCode). Nao e o que os parceiros veem para ele — logo, saber
 *     o proprio codigo nao ajuda dois vizinhos a se reconhecerem.
 *
 * HKDF, e nao o PBKDF2 de server/utils/crypto.ts: PBKDF2 estica senha de baixa
 * entropia; aqui o segredo e aleatorio e o que se quer e SEPARACAO DE DOMINIO
 * (info proprio), para a chave dos codigos nunca coincidir com a chave AES dos
 * tokens de ERP nem com a assinatura de cookie quando o ikm e o mesmo
 * SESSION_SECRET.
 *
 * Formato: "ISP-" + 6 simbolos Crockford Base32 em dois grupos de 3. Sem I, L,
 * O, U — nada que se confunda com 1/0 nem que soe como V ao telefone. 30 bits:
 * a unicidade so precisa valer dentro de um observador (2 a 10 parceiros por
 * regiao), e a privacidade nao vem do tamanho — vem da chave.
 */
import { createHmac, hkdfSync, timingSafeEqual } from "crypto";
import { logger } from "../logger";

export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PARTNER_CODE_REGEX = /^ISP-[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/;
export const PARTNER_DISPLAY_REGEX = /^Provedor Parceiro ISP-[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/;
/** Sem id do parceiro nao ha codigo — e nao ha fallback por nome: nome de empresa nao e segredo. */
export const ROTULO_SEM_ID = "Provedor da rede";

const HKDF_SALT = "consulta-isp-partner-code";
const HKDF_INFO = "consulta-isp/partner-code/v1";
/** Dominio do codigo PROPRIO ("seu codigo"): outra chave, nunca coincide com a pareada. */
const HKDF_INFO_PROPRIO = "consulta-isp/support-code/v1";
const TAMANHO_MINIMO_DO_SEGREDO = 32;

interface ChaveDeCodigo {
  label: string;
  key: Buffer;
}

let chaves: ChaveDeCodigo[] | null = null;
let chavesProprias: ChaveDeCodigo[] | null = null;
let avisouObservadorInvalido = false;

function derivar(ikm: string, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, HKDF_SALT, info, 32));
}

/**
 * As chaves conhecidas, na ordem de tentativa do resolvedor: a atual, as
 * anteriores (PARTNER_CODE_SECRET_PREVIOUS, separadas por virgula) e, por
 * ultimo, a derivada do SESSION_SECRET — cobre o periodo em que o fallback
 * esteve em uso. So a primeira GERA codigos. Lida uma vez por processo, na
 * primeira chamada, nunca no import.
 */
function carregarChaves(info: string): ChaveDeCodigo[] {
  const dedicado = (process.env.PARTNER_CODE_SECRET || "").trim();
  const sessao = (process.env.SESSION_SECRET || "").trim();
  if (!dedicado && !sessao) {
    throw new Error("[LGPD] PARTNER_CODE_SECRET/SESSION_SECRET ausente — nao ha como gerar codigo de parceiro");
  }
  if (dedicado && dedicado.length < TAMANHO_MINIMO_DO_SEGREDO) {
    throw new Error(
      `[LGPD] PARTNER_CODE_SECRET precisa ter pelo menos ${TAMANHO_MINIMO_DO_SEGREDO} caracteres. ` +
      `Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  const lista: ChaveDeCodigo[] = [{ label: "current", key: derivar(dedicado || sessao, info) }];
  (process.env.PARTNER_CODE_SECRET_PREVIOUS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .forEach((s, i) => lista.push({ label: `previous-${i}`, key: derivar(s, info) }));
  if (dedicado && sessao) lista.push({ label: "session-fallback", key: derivar(sessao, info) });
  return lista;
}

function getPartnerKeys(): ChaveDeCodigo[] {
  if (!chaves) chaves = carregarChaves(HKDF_INFO);
  return chaves;
}

function getOwnKeys(): ChaveDeCodigo[] {
  if (!chavesProprias) chavesProprias = carregarChaves(HKDF_INFO_PROPRIO);
  return chavesProprias;
}

export function _resetPartnerKeysForTests(): void {
  chaves = null;
  chavesProprias = null;
  avisouObservadorInvalido = false;
}

/** 30 bits do MAC -> 6 simbolos de 5 bits, do mais significativo para o menos. Sem vies de modulo. */
function encode30(mac: Buffer): string {
  const u32 = mac.readUInt32BE(0);
  let simbolos = "";
  for (let k = 0; k < 6; k++) simbolos += CROCKFORD[(u32 >>> (27 - 5 * k)) & 31];
  return `ISP-${simbolos.slice(0, 3)}-${simbolos.slice(3)}`;
}

function codigoCom(key: Buffer, viewerProviderId: number, subjectProviderId: number): string {
  // Ordem importa: observador primeiro. (1,2) != (2,1). Separador ":" evita 1|23 vs 12|3.
  const msg = `v1:${viewerProviderId}:${subjectProviderId}`;
  return encode30(createHmac("sha256", key).update(msg).digest());
}

function codigoProprioCom(key: Buffer, providerId: number): string {
  return encode30(createHmac("sha256", key).update(`v1:self:${providerId}`).digest());
}

const observadorValido = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

/** O codigo que o OBSERVADOR ve para o PARCEIRO. */
export function generatePartnerCode(viewerProviderId: number, subjectProviderId: number): string {
  return codigoCom(getPartnerKeys()[0].key, viewerProviderId, subjectProviderId);
}

/**
 * "Seu codigo": o que o PROPRIO provedor conhece, para se identificar ao
 * suporte da plataforma. Outro dominio de chave: nao e o que nenhum parceiro
 * ve para ele (cada parceiro ve o codigo pareado). Cada provedor sabe o seu,
 * e saber o seu nao ajuda dois vizinhos a se reconhecerem.
 */
export function generateOwnCode(providerId: number): string {
  return codigoProprioCom(getOwnKeys()[0].key, providerId);
}

/**
 * O texto de exibicao no lugar do nome do parceiro. Sem id do parceiro, ou sem
 * observador valido, cai no rotulo fixo: nunca um "observador anonimo" (0, -1,
 * undefined), que abriria um espaco global pela porta dos fundos.
 */
export function anonymizeProvider(viewerProviderId: number, subjectProviderId: number | null | undefined): string {
  if (subjectProviderId == null || !Number.isInteger(subjectProviderId)) return ROTULO_SEM_ID;
  if (!observadorValido(viewerProviderId)) {
    if (!avisouObservadorInvalido) {
      avisouObservadorInvalido = true;
      logger.warn({ viewerProviderId }, "anonymizeProvider sem observador valido — devolvendo rotulo fixo");
    }
    return ROTULO_SEM_ID;
  }
  return `Provedor Parceiro ${generatePartnerCode(viewerProviderId, subjectProviderId)}`;
}

/**
 * Nome real para o proprio provedor; codigo pareado para qualquer outro. O
 * nome NAO participa do codigo — so aparece quando e o proprio.
 */
export function getProviderDisplayName(
  providerName: string | null | undefined,
  viewerProviderId: number,
  subjectProviderId: number | null | undefined,
): string {
  if (subjectProviderId != null && subjectProviderId === viewerProviderId) {
    return (providerName || "").trim() || "Seu provedor";
  }
  return anonymizeProvider(viewerProviderId, subjectProviderId);
}

/**
 * Entrada do suporte -> forma canonica. Aceita minusculas, espacos, sem hifen,
 * com "#", e corrige o que o ouvido troca (O -> 0, I/L -> 1). Codigo do esquema
 * antigo (ISP-#XXXXL) nao normaliza: devolve null.
 */
export function normalizePartnerCode(input: string): string | null {
  let s = (input || "").toUpperCase().replace(/[\s\-#]/g, "");
  if (s.startsWith("ISP")) s = s.slice(3);
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
  const code = `ISP-${s.slice(0, 3)}-${s.slice(3)}`;
  return PARTNER_CODE_REGEX.test(code) ? code : null;
}

/**
 * So o controlador: dado o observador e os candidatos (os provedores da regiao
 * dele), recomputa o codigo com cada chave conhecida e diz quem e. Nunca tenta
 * contra outros observadores — isso transformaria o resolvedor em oraculo.
 */
export function resolvePartnerCode(
  viewerProviderId: number,
  code: string,
  candidateIds: number[],
): { subjectProviderId: number; keyVersion: string } | null {
  const alvo = normalizePartnerCode(code);
  if (!alvo || !observadorValido(viewerProviderId)) return null;
  const alvoBuf = Buffer.from(alvo);
  for (const chave of getPartnerKeys()) {
    for (const id of candidateIds) {
      const tentativa = Buffer.from(codigoCom(chave.key, viewerProviderId, id));
      if (tentativa.length === alvoBuf.length && timingSafeEqual(tentativa, alvoBuf)) {
        return { subjectProviderId: id, keyVersion: chave.label };
      }
    }
  }
  return null;
}
/** Resolve "seu codigo" (o proprio) entre os candidatos, com todas as chaves conhecidas. */
export function resolveOwnCode(
  code: string,
  candidateIds: number[],
): { providerId: number; keyVersion: string } | null {
  const alvo = normalizePartnerCode(code);
  if (!alvo) return null;
  const alvoBuf = Buffer.from(alvo);
  for (const chave of getOwnKeys()) {
    for (const id of candidateIds) {
      const tentativa = Buffer.from(codigoProprioCom(chave.key, id));
      if (tentativa.length === alvoBuf.length && timingSafeEqual(tentativa, alvoBuf)) {
        return { providerId: id, keyVersion: chave.label };
      }
    }
  }
  return null;
}
