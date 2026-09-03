/**
 * O identificador da consulta, do lado da tela.
 *
 * Ate aqui a tela inventava o proprio "protocolo": `#CI-2026-00123`, derivado
 * de `consultation.id` — a chave sequencial da tabela. Tres problemas, e
 * nenhum deles cosmetico:
 *
 * 1. A chave e GLOBAL a plataforma. Duas consultas de um provedor saindo como
 *    `#CI-2026-00123` e `#CI-2026-00131` contam a ele quantas consultas todos
 *    os outros fizeram no intervalo. E vazamento entre tenants por subtracao.
 * 2. Ela so existe quando ha linha gravada. No erro — que e justamente quando
 *    o provedor precisa de um numero para dar ao suporte — nao havia nada.
 * 3. Ela nao existe no banco com esse formato, entao o suporte nao tinha o que
 *    procurar: ninguem consulta `isp_consultations` por "#CI-2026-00123".
 *
 * O identificador de verdade e sorteado no servidor (`CI-2609-K7F3M2`), vem na
 * resposta — inclusive nas de erro — e esta gravado na coluna `consulta_id`.
 * Este modulo so o LE. Nunca o gera: um codigo inventado aqui mandaria o
 * suporte procurar uma linha que nao existe, que e o defeito que se veio
 * corrigir.
 */

/**
 * Espelho de `FORMATO_DO_IDENTIFICADOR` em `server/services/identificador-consulta.ts`.
 *
 * Duplicar uma regex e sempre ruim, e aqui e o menor dos males: o modulo do
 * servidor importa `crypto`, e arrasta-lo para o bundle do navegador so para
 * validar um formato seria pagar caro por seis caracteres. O alfabeto e o
 * mesmo de la, sem `0 1 I O U`.
 */
const FORMATO = /^CI-\d{4}-[23456789ABCDEFGHJKLMNPQRSTVWXYZ]{6}$/;
const SEM_TRACOS = /^CI\d{4}[23456789ABCDEFGHJKLMNPQRSTVWXYZ]{6}$/;

export interface ProtocoloDaOrigem {
  /** Quem emitiu: "SPC Brasil", "BigDataCorp". */
  origem: string;
  /** O numero como a origem o escreveu — nunca reformatado. */
  protocolo: string;
}

export interface IdentificacaoDaConsulta {
  /** `CI-2609-K7F3M2`, ou `null` quando a consulta nasceu antes desta versao. */
  consultaId: string | null;
  /** O numero que o bureau de origem entende, quando existe um. */
  protocoloDaOrigem: ProtocoloDaOrigem | null;
}

/**
 * O codigo pronto para a tela, ou `null`.
 *
 * Aceita minuscula, espaco e a forma sem tracos porque o valor as vezes chega
 * de um campo digitado. O que NAO se faz e consertar caractere parecido: o
 * alfabeto nao tem `0` nem `O`, entao um codigo com eles esta errado de
 * verdade, e mostrar "—" e melhor que exibir um codigo que o suporte nao vai
 * encontrar.
 */
export function normalizarCodigo(entrada: unknown): string | null {
  if (typeof entrada !== "string") return null;
  const cru = entrada.trim().toUpperCase().replace(/[\s.]/g, "");
  if (!cru) return null;
  if (FORMATO.test(cru)) return cru;
  if (SEM_TRACOS.test(cru)) return `${cru.slice(0, 2)}-${cru.slice(2, 6)}-${cru.slice(6)}`;
  return null;
}

/** Objeto navegavel? Evita `null`, array e primitivo virarem `Record`. */
function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `caminho("a.b", obj)` sem estourar quando um degrau do meio nao existe. */
function noCaminho(fonte: unknown, caminho: string): unknown {
  let atual: unknown = fonte;
  for (const passo of caminho.split(".")) {
    if (!ehObjeto(atual)) return undefined;
    atual = atual[passo];
  }
  return atual;
}

/**
 * Onde o codigo pode estar na resposta.
 *
 * Sao tres rotas com envelopes diferentes — a ISP devolve
 * `{ consultation, result }`, a SPC devolve `{ result }`, a cadastral devolve
 * o proprio resultado —, e o codigo e UM por requisicao. Procurar nos tres
 * lugares custa nada e evita que a tela dependa de qual envelope a rota
 * escolheu: a resposta certa e "o codigo desta consulta", venha de onde vier.
 */
const CAMINHOS_DO_CODIGO = [
  "consultaId",
  "result.consultaId",
  "consultation.consultaId",
  "resultado.consultaId",
];

const CAMINHOS_DO_PROTOCOLO = [
  "protocoloDaOrigem",
  "result.protocoloDaOrigem",
  "consultation.protocoloDaOrigem",
  "resultado.protocoloDaOrigem",
];

function lerProtocolo(valor: unknown): ProtocoloDaOrigem | null {
  if (!ehObjeto(valor)) return null;
  const origem = typeof valor.origem === "string" ? valor.origem.trim() : "";
  const protocolo = typeof valor.protocolo === "string" ? valor.protocolo.trim() : "";
  return origem && protocolo ? { origem, protocolo } : null;
}

/**
 * A identificacao de uma consulta a partir da resposta da rota.
 *
 * `origemPadrao` cobre o caso do SPC, que ja devolvia `result.protocolo` cru
 * muito antes de existir `protocoloDaOrigem`: sem ele o numero do SPC sumiria
 * da tela enquanto o servidor nao passa a mandar o par completo. O rotulo da
 * origem nunca e adivinhado — quem chama e que sabe com qual bureau falou.
 */
export function lerIdentificacao(fonte: unknown, origemPadrao?: string): IdentificacaoDaConsulta {
  let consultaId: string | null = null;
  for (const caminho of CAMINHOS_DO_CODIGO) {
    consultaId = normalizarCodigo(noCaminho(fonte, caminho));
    if (consultaId) break;
  }

  let protocoloDaOrigem: ProtocoloDaOrigem | null = null;
  for (const caminho of CAMINHOS_DO_PROTOCOLO) {
    protocoloDaOrigem = lerProtocolo(noCaminho(fonte, caminho));
    if (protocoloDaOrigem) break;
  }

  if (!protocoloDaOrigem && origemPadrao) {
    const cru = noCaminho(fonte, "protocolo") ?? noCaminho(fonte, "result.protocolo");
    if (typeof cru === "string" && cru.trim()) {
      protocoloDaOrigem = { origem: origemPadrao, protocolo: cru.trim() };
    }
  }

  return { consultaId, protocoloDaOrigem };
}

export interface ErroDeConsulta {
  /** A mensagem em portugues, ja sem o `503:` que o `apiRequest` prefixa. */
  mensagem: string;
  /** O codigo da consulta que falhou, quando o servidor o devolveu. */
  consultaId: string | null;
}

/**
 * A falha da consulta, legivel e com o codigo.
 *
 * `apiRequest` lanca `Error("503: {json}")` — status colado no corpo. Cada
 * tela desembrulhava isso do seu jeito (ou nem desembrulhava, e o operador via
 * "500: {"message":..." na tela). Aqui isso acontece uma vez, e de quebra o
 * `consultaId` da resposta de erro chega a tela: e o unico momento em que o
 * codigo tem serventia imediata para quem esta olhando.
 */
export function lerErroDeConsulta(erro: unknown): ErroDeConsulta {
  // `Error` primeiro, e sem `||` para cair fora: um `Error("")` tem mensagem
  // vazia, e `String(erro)` devolveria a palavra "Error" — que iria para a tela
  // como se fosse a explicacao da falha.
  const cru = ehObjeto(erro) && typeof erro.message === "string"
    ? erro.message
    : typeof erro === "string" ? erro : "";
  const bruto = cru.replace(/^\d{3}:\s*/, "").trim();

  if (!bruto) return { mensagem: "Falha ao consultar.", consultaId: null };

  try {
    const corpo = JSON.parse(bruto);
    if (ehObjeto(corpo)) {
      const mensagem = typeof corpo.message === "string" && corpo.message.trim()
        ? corpo.message.trim()
        : bruto;
      return { mensagem, consultaId: lerIdentificacao(corpo).consultaId };
    }
  } catch {
    /* Texto puro — o caminho comum de erro de rede. */
  }

  return { mensagem: bruto, consultaId: null };
}
