/**
 * Codificacao dos corpos que os ERPs devolvem.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE (medido em 17/09/2026, producao) ────────────
 *
 * 150 nomes de cliente do provider 1 (NsLink, MK) estavam gravados com o
 * caractere de substituicao U+FFFD: o dono viu "GENY SERET GON<invalido>ALVES"
 * na tela do quadro. O mesmo nome vai para a mensagem de WhatsApp da
 * funcionaria digital e para o e-mail; na identidade ele NAO e a resposta do
 * desafio (desde 17/09/2026 sao so os 4 ultimos digitos do CPF), mas entra no
 * `cadastroHash` que valida a confirmacao e na triagem que reconhece terceiro
 * ("nao sou o Joao") — com o nome quebrado, nenhuma das duas fecha. Nome
 * quebrado nao e cosmetico.
 *
 * A causa esta na ENTRADA, e e uma so:
 *
 *   `Response.json()` e, por especificacao, `JSON.parse(UTF-8 decode(bytes))`.
 *   Esse decode IGNORA o charset do Content-Type e, diante de um byte que nao
 *   forma sequencia UTF-8 valida, troca o byte por U+FFFD ANTES de o
 *   `JSON.parse` rodar. Depois disso a informacao nao existe mais no objeto.
 *
 * O MK monta o JSON tratando a string UTF-8 como se fosse latin-1 e escapando
 * como `\u00XX` todo byte que, nessa leitura errada, cai na faixa de controle
 * C1 (0x80-0x9F). O resto ele manda cru. Consequencia do mapa do UTF-8:
 *
 *   `ç` U+00E7 -> C3 A7 · 2o byte 0xA7, fora de 80-9F -> vai cru      -> INTACTO
 *   `Ç` U+00C7 -> C3 87 · 2o byte 0x87, dentro de 80-9F -> escapado   -> QUEBRA
 *
 * ou seja: TODA acentuada MAIUSCULA (U+00C0-U+00DF) chega como o byte solto
 * `C3` seguido do texto ASCII `\u0087`. Como os nomes do MK sao todos em caixa
 * alta, 100% dos nomes com acento quebravam. As minusculas nunca quebraram.
 *
 * ── O QUE ESTE MODULO FAZ ───────────────────────────────────────────────────
 *
 * Decodifica UMA VEZ, na entrada, a partir dos BYTES — nunca "conserta string
 * depois". Sao tres passos, nesta ordem:
 *
 *   1. `repararContinuacaoEscapada` — no BUFFER, antes de qualquer decode,
 *      devolve ao lugar o byte de continuacao que o ERP mandou como escape
 *      ASCII. So age quando a sequencia UTF-8 esta comprovadamente TRUNCADA
 *      (ver a maquina de estado na propria funcao): e o que garante que um
 *      `°` legitimo do IXC, ou um `ç` ja correto do SGP, passem intactos.
 *   2. `decodificarCorpoDoErp` — escolhe o charset. Honra o do Content-Type
 *      quando ele existe E os bytes concordam com ele; quando o cabecalho
 *      mente, os bytes vencem (o MK declara `charset=iso-8859-1` e manda
 *      UTF-8 — obedecer o cabecalho produziria mojibake em 100% dos acentos).
 *   3. `JSON.parse` sobre o texto ja correto.
 *
 * ── O QUE CADA ERP MANDA (medido, 17/09/2026) ───────────────────────────────
 *
 * | ERP | Content-Type              | corpo                    | precisa reparo |
 * |-----|---------------------------|--------------------------|----------------|
 * | MK  | text/plain;charset=iso-8859-1 (MENTE) | UTF-8 com o 2o byte das MAIUSCULAS escapado | SIM |
 * | IXC | text/x-json; charset=utf-8 | ASCII puro, tudo em `\u00XX` | nao (no-op) |
 * | SGP | application/json (sem charset) | UTF-8 cru e valido    | nao (no-op) |
 *
 * Os tres passam por aqui de proposito: o IXC e o SGP estao corretos HOJE, e o
 * unico jeito de saber que continuam corretos amanha e ter os bytes deles
 * atravessando o mesmo caminho, com teste. O reparo e um no-op provado para os
 * dois (ver `codificacao.test.ts`).
 */

/** Decodificador UTF-8 tolerante: byte invalido vira U+FFFD em vez de lancar. */
const UTF8 = new TextDecoder("utf-8");

const BARRA = 0x5c; // \
const U_MINUSCULO = 0x75; // u
const ZERO = 0x30; // 0

/**
 * ISO-8859-1 e byte-a-byte — o codepoint E o valor do byte. Feito a mao para
 * nao depender do ICU do Node (`TextDecoder("latin1")` lanca em build
 * small-icu) nem de `Buffer`, que este modulo nao precisa conhecer.
 */
function decodificarLatin1(bytes: Uint8Array): string {
  let saida = "";
  const PEDACO = 8192;
  for (let i = 0; i < bytes.length; i += PEDACO) {
    saida += String.fromCharCode(...bytes.subarray(i, Math.min(i + PEDACO, bytes.length)));
  }
  return saida;
}

/** Valor de um digito hexadecimal ASCII, ou -1 se o byte nao for hexadecimal. */
function valorHex(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30; // 0-9
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10; // a-f
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10; // A-F
  return -1;
}

/** Quantos bytes de continuacao um byte lider de UTF-8 ainda exige. */
function continuacoesExigidas(b: number): number {
  if (b >= 0xc2 && b <= 0xdf) return 1;
  if (b >= 0xe0 && b <= 0xef) return 2;
  if (b >= 0xf0 && b <= 0xf4) return 3;
  return 0;
}

/**
 * Devolve ao buffer o byte de continuacao que o ERP mandou como escape ASCII
 * `\u00XX`, quando — e SOMENTE quando — a sequencia UTF-8 em curso esta
 * truncada.
 *
 * A maquina de estado e a trava de seguranca inteira. `faltam` conta quantos
 * bytes de continuacao a sequencia atual ainda exige:
 *
 *   - `faltam > 0` e o byte e continuacao (0x80-0xBF) -> consome, `faltam--`
 *   - byte ASCII (inclusive a barra `\`) -> `faltam = 0`
 *   - byte lider -> `faltam` = o que ele exige
 *
 * Um escape `\u00XX` com XX em 0x80-0xBF so vira byte cru se `faltam > 0`.
 * Isso separa exatamente os dois casos que se parecem:
 *
 *   MK quebrado: `C3` (faltam=1) + `\u0087`  -> vira `C3 87` = `Ç`      ✔ reparado
 *   IXC correto: `°` sem lider aberto (faltam=0) -> intacto = `°`  ✔ preservado
 *   SGP correto: `C3 A7` ja fecha (faltam=0); `\u00a0` seguinte intacto ✔ preservado
 *
 * Tambem cobre sequencia de 3 e 4 bytes (`E2` + `\u0080` + `\u0099`), porque
 * `faltam` decrementa a cada escape absorvido.
 *
 * Nao aloca nada quando nao ha o que reparar: devolve o proprio buffer.
 */
export function repararContinuacaoEscapada(bytes: Uint8Array): Uint8Array {
  const saida = new Uint8Array(bytes.length);
  let escritos = 0;
  let faltam = 0;
  let mudou = false;

  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;

    // Candidato a continuacao escapada: `\u00XX`, 6 bytes, dentro de uma
    // sequencia UTF-8 truncada.
    if (
      faltam > 0 &&
      b === BARRA &&
      i + 5 < bytes.length &&
      bytes[i + 1] === U_MINUSCULO &&
      bytes[i + 2] === ZERO &&
      bytes[i + 3] === ZERO
    ) {
      const alto = valorHex(bytes[i + 4]!);
      const baixo = valorHex(bytes[i + 5]!);
      if (alto >= 0 && baixo >= 0) {
        const valor = alto * 16 + baixo;
        if (valor >= 0x80 && valor <= 0xbf) {
          saida[escritos++] = valor;
          faltam -= 1;
          mudou = true;
          i += 6;
          continue;
        }
      }
    }

    saida[escritos++] = b;
    i += 1;

    if (faltam > 0 && b >= 0x80 && b <= 0xbf) faltam -= 1;
    else faltam = continuacoesExigidas(b);
  }

  if (!mudou) return bytes;
  return saida.subarray(0, escritos);
}

/** O `charset=` do Content-Type, em minusculas, ou `null` se nao houver. */
export function charsetDeclarado(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  const achado = /charset\s*=\s*"?([^";,\s]+)"?/i.exec(contentType);
  if (!achado) return null;
  return achado[1]!.trim().toLowerCase();
}

const ROTULOS_UTF8 = new Set(["utf-8", "utf8", "unicode-1-1-utf-8", "utf_8"]);

/**
 * Os bytes se comportam como UTF-8?
 *
 * Serve para decidir quando o Content-Type mente. Conta sequencias multibyte
 * bem formadas contra bytes altos que nao formam nenhuma. Corpo sem byte alto
 * e ambiguo por definicao (ASCII e igual nos dois) e responde `true`, que e o
 * padrao do JSON (RFC 8259).
 */
export function pareceUtf8(bytes: Uint8Array): boolean {
  let validas = 0;
  let invalidos = 0;

  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    if (b < 0x80) {
      i += 1;
      continue;
    }
    const exige = continuacoesExigidas(b);
    if (exige === 0) {
      invalidos += 1;
      i += 1;
      continue;
    }
    let completa = true;
    for (let k = 1; k <= exige; k += 1) {
      const c = bytes[i + k];
      if (c === undefined || c < 0x80 || c > 0xbf) {
        completa = false;
        break;
      }
    }
    if (completa) {
      validas += 1;
      i += exige + 1;
    } else {
      invalidos += 1;
      i += 1;
    }
  }

  if (validas === 0 && invalidos === 0) return true; // ASCII puro
  return validas > invalidos;
}

/**
 * Decodifica o corpo de um ERP para texto, uma unica vez e a partir dos bytes.
 *
 * Regra do charset, nesta ordem:
 *   1. reparo de continuacao escapada (no buffer, antes de qualquer decode);
 *   2. Content-Type diz UTF-8, ou nao diz nada  -> UTF-8 (padrao do JSON);
 *   3. Content-Type diz outra coisa             -> so obedece se os bytes
 *      concordarem; se os bytes sao UTF-8, os BYTES vencem o cabecalho.
 *
 * O passo 3 nao e teimosia: o MK declara `text/plain;charset=iso-8859-1` e
 * manda UTF-8. Obedecer o cabecalho dele transformaria `Ç` em `Ã‡` — trocaria
 * 150 nomes quebrados por 3.222 nomes mojibake.
 */
export function decodificarCorpoDoErp(
  bytes: Uint8Array,
  contentType?: string | null,
): string {
  const reparados = repararContinuacaoEscapada(bytes);
  const rotulo = charsetDeclarado(contentType);

  if (rotulo === null || ROTULOS_UTF8.has(rotulo)) return UTF8.decode(reparados);
  if (pareceUtf8(reparados)) return UTF8.decode(reparados);

  // Cabecalho nao-UTF-8 E bytes que nao se comportam como UTF-8: e latin-1 de
  // verdade. Decodifica o buffer ORIGINAL — o reparo so faz sentido em UTF-8.
  return decodificarLatin1(bytes);
}

/** Le o corpo como texto, decodificando os bytes na codificacao certa. */
export async function lerTextoDoErp(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return decodificarCorpoDoErp(bytes, response.headers?.get("content-type"));
}

/**
 * O substituto de `response.json()` para corpo de ERP.
 *
 * Mesma assinatura util do original — rejeita quando o corpo nao e JSON, entao
 * o `.catch(() => null)` de quem chama continua valendo — mas decodifica pelos
 * BYTES em vez de assumir UTF-8 as cegas.
 *
 * Sobre o desvio do fim: em producao `response` e sempre o retorno de `fetch`,
 * e `Response` SEMPRE expoe `arrayBuffer()` — o caminho de bytes e o unico que
 * roda. Um objeto que nao expoe bytes nao tem corpo para decodificar: ele ja
 * entrega o valor parseado, nao ha sequencia truncada para reparar e `json()`
 * responde exatamente o mesmo. Isso nao e uma porta de fuga para o conserto —
 * `codificacao.test.ts` dirige o conector com `Response` de verdade, montado a
 * partir dos bytes que o MK manda, e e esse teste que prova o reparo.
 */
export async function lerJsonDoErp(response: Response): Promise<unknown> {
  if (typeof response?.arrayBuffer !== "function") return await response.json();
  return JSON.parse(await lerTextoDoErp(response));
}
