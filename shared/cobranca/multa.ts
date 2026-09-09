/**
 * A COBRANÇA DE SAÍDA dentro da dívida: multa contratual e equipamento não
 * devolvido, lidos da descrição da fatura que o ERP mandou.
 *
 * Por que existe (dono, 09/09/2026): "o provedor está cobrando R$ 719,86, que
 * seria a multa de cancelamento, essa multa é pelo equipamento... então está
 * somando 2x o mesmo valor". A Economia R24 já cobra a instalação e o
 * equipamento no investimento (CAPEX); a multa é a COBRANÇA dessa perda.
 * Somar as duas conta o mesmo equipamento duas vezes. Se a multa for paga um
 * dia, ela entra como receita recebida (0036) e abate a perda — o caminho
 * certo, e não a dívida.
 *
 * O que se lê, e de onde (produção, 09/09/2026):
 *   NsLink (MK):  "Proporcional 40 dias + multa 600,00 + equipamento 800,00"
 *                 "2 Mensalidades 199,80 + multa 1.083,33"
 *                 "2 Mensalidades + multa + juros"            (mistura SEM valores)
 *   NG (IXC):     "referente a multa de rescisão", "Ref. Valor de equipamento
 *                 não devolvido"                               (a fatura INTEIRA)
 *                 "referente a multa + parcela"               (mistura SEM valores)
 *                 "Referente aos dias de uso, não possui multa" (negação)
 *
 * Regras, nesta ordem (a revisão adversarial de 09/09/2026 acrescentou 3-6):
 *   1. negação ("não possui multa", "equipamento devolvido") → nada;
 *   2. valor nomeado ("multa 600,00", "equipamento 800,00", "800,00 equipamento")
 *      → esse valor, e só ele;
 *   3. "multa" ao lado de juros/mora/atraso, sem qualificador de saída
 *      (rescisão, cancelamento, fidelidade, contratual) é multa de MORA — não
 *      é cobrança de saída;
 *   4. um número só é dinheiro se não vier colado a unidade (dias, parcelas,
 *      %, x, mês…) — "multa 2 parcelas" não é R$ 2;
 *   5. palavra sem valor: a fatura inteira é a cobrança de saída SÓ quando a
 *      descrição não fala de mensalidade/parcela/dias/uso E não traz nenhum
 *      valor em dinheiro; se fala (ou traz um valor que não se soube amarrar),
 *      a mistura é INDETERMINADA — fica como dívida e a tela avisa. Se o OUTRO
 *      item tem valor nomeado, esse valor sai e o resto fica como dívida, sem
 *      marcar indeterminada (a parte sem nome já está na dívida);
 *   6. nunca acima do valor da fatura.
 * Sub-ler é seguro (vira dívida, como sempre foi); inventar valor não é.
 */
export interface CobrancaDeSaida {
  multa: number;
  equipamento: number;
  /** Faturas que misturam multa e mensalidade sem dizer os valores — contadas como dívida. */
  indeterminadas: number;
  /** Faturas vencidas lidas para este cliente (as que falam de multa/equipamento). */
  faturas: number;
}

export interface ParcelasDaFatura { multa: number; equipamento: number; indeterminada: boolean }

// UM vocabulario: o filtro do banco, o "fala de" e o "com valor" partem da mesma lista.
const MULTA_NOMES = String.raw`multas?|rescis\w*|fidelid\w*|quebra\s+de\s+contrato`;
const EQUIP_NOMES = String.raw`equipamentos?|roteador(?:es)?|onus?|modems?|comodato`;
/** O filtro do banco (`~*`, regex do Postgres): so a fatura cuja descricao fala nisso passa pelo parser. */
export const PADRAO_DE_COBRANCA_DE_SAIDA = String.raw`\m(multas?|rescis|fidelid|quebra de contrato|equipamentos?|roteador|onus?|modems?|comodato)`;

const VALOR = String.raw`(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const NEGACAO_MULTA = /n[ãa]o\s+(?:ser[áa]\s+|foi\s+|est[áa]\s+)?(?:cobrad[ao]|possui|tem|h[áa]|cobra|cobrar|aplicad[ao])\s+(?:a\s+)?multa|sem\s+(?:cobran[çc]a\s+d[ea]\s+)?multa|isen(?:t[oa]|[çc][ãa]o)\s+d[ea]\s+multa|multa\s+(?:isenta|dispensada|zerada|n[ãa]o\s+(?:cobrada|aplicada|devida))/i;
const NEGACAO_EQUIP = new RegExp(String.raw`(?:${EQUIP_NOMES})\s+(?:j[áa]\s+|foi\s+|foram\s+)?(?:devolvid|retirad|recolhid|entregue|restituid)|sem\s+(?:${EQUIP_NOMES})\b|(?:inclui|incluso|inclusa|com)\s+(?:${EQUIP_NOMES})|(?:${EQUIP_NOMES})\s+(?:inclus[oa]|em\s+comodato)`, "i");
const MORA = /juros|\bmora\b|morat[óo]ri|atraso/i;
const SAIDA_QUALIFICADA = /rescis|cancelament|fidelid|contratual|quebra|desist|encerrament/i;
const FALA_DE_MULTA = new RegExp(String.raw`\b(?:${MULTA_NOMES})\b`, "i");
const FALA_DE_EQUIP = new RegExp(String.raw`\b(?:${EQUIP_NOMES})\b`, "i");
const FALA_DE_SERVICO = /mensalidade|parcela|\bdias?\b|proporcional|\buso\b|faturamento|ref\.?:|assinatura|internet|\bplano\b|servi[çc]o/i;
/** Qualquer coisa que pareca dinheiro: com centavos, ou com R$. */
const TEM_DINHEIRO = /\d+[.,]\d{2}\b|r\$\s*\d/i;
/** O que, logo depois de um numero, prova que ele NAO e dinheiro. */
const UNIDADE_DEPOIS = /^\s*(?:%|\/|x\b|×|[ªº°]|dias?\b|m[eê]s(?:es)?\b|parcelas?\b|mensalidades?\b|un(?:idades?)?\b|pontos?\b|vezes\b|[-./]\d)/i;

const MULTA_COM_VALOR = new RegExp(
  String.raw`\b(?:${MULTA_NOMES})(?:\s+(?:de\s+rescis[ãa]o|de\s+cancelamento|contratual|rescis[óo]ria|por\s+quebra(?:\s+de\s+contrato)?|de))?\s*:?\s*(?:no\s+valor\s+de\s+)?` + VALOR, "gi");
const VALOR_ANTES_DE_MULTA = new RegExp(VALOR + String.raw`\s*(?:de\s+|referente\s+[àa]\s+)?(?:${MULTA_NOMES})\b`, "gi");
// A palavra opcional ("quebrado", "danificado") e so de LETRAS: `\w+` engolia o
// "800" de "equipamento 800,00" e o valor virava "0,00".
const EQUIP_COM_VALOR = new RegExp(String.raw`\b(?:${EQUIP_NOMES})(?:\s+[a-zA-ZÀ-ÿ]+)?\s*:?\s*(?:no\s+valor\s+de\s+)?` + VALOR, "gi");
const VALOR_ANTES_DE_EQUIP = new RegExp(VALOR + String.raw`\s*(?:de\s+|em\s+|do\s+|referente\s+ao?\s+)?(?:${EQUIP_NOMES})\b`, "gi");

const centavos = (n: number) => Math.round(n * 100) / 100;

/** "1.083,33" → 1083.33 · "600,00" → 600 · "1.083" → 1083 · "800" → 800. */
export function valorBrasileiro(texto: string): number {
  const t = texto.trim();
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  return Number(t);
}

/**
 * O primeiro valor que a regex amarra E que e dinheiro de verdade: um inteiro
 * seguido de "dias", "parcelas", "%", "x"… e contagem, nao valor.
 */
function valorAmarrado(texto: string, ...regexes: RegExp[]): number | null {
  for (const re of regexes) {
    re.lastIndex = 0;
    for (const m of texto.matchAll(re)) {
      const token = m[1];
      const fim = (m.index ?? 0) + m[0].length;
      const inteiroSeco = /^\d+$/.test(token);
      if (inteiroSeco && UNIDADE_DEPOIS.test(texto.slice(fim))) continue;
      const v = valorBrasileiro(token);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

export function parcelasDaDescricao(descricao: string | null | undefined, valorDaFatura: number): ParcelasDaFatura {
  const d = (descricao ?? "").trim();
  const teto = Number.isFinite(valorDaFatura) && valorDaFatura > 0 ? centavos(valorDaFatura) : 0;
  const nada: ParcelasDaFatura = { multa: 0, equipamento: 0, indeterminada: false };
  if (!d || teto <= 0) return nada;

  // Multa de MORA (juros/atraso, sem qualificador de saida) nao e cobranca de
  // saida: "multa 2,00 + juros 1,20" fica na divida. Mas "2 Mensalidades +
  // multa + juros" (NsLink) e uma fatura de saida sem valores: ninguem sabe
  // a divisao, e a tela precisa avisar — indeterminada, nao invisivel.
  const multaDeMora = MORA.test(d) && !SAIDA_QUALIFICADA.test(d);
  const falaMultaBruto = FALA_DE_MULTA.test(d) && !NEGACAO_MULTA.test(d);
  const falaMulta = falaMultaBruto && !multaDeMora;
  const falaEquip = FALA_DE_EQUIP.test(d) && !NEGACAO_EQUIP.test(d);
  if (!falaMulta && !falaEquip) {
    const moraSemValorNaMistura = falaMultaBruto && multaDeMora && FALA_DE_SERVICO.test(d)
      && valorAmarrado(d, MULTA_COM_VALOR, VALOR_ANTES_DE_MULTA) === null;
    return moraSemValorNaMistura ? { ...nada, indeterminada: true } : nada;
  }

  const multaNomeada = falaMulta ? valorAmarrado(d, MULTA_COM_VALOR, VALOR_ANTES_DE_MULTA) : null;
  const equipNomeado = falaEquip ? valorAmarrado(d, EQUIP_COM_VALOR, VALOR_ANTES_DE_EQUIP) : null;
  let multa = multaNomeada ?? 0;
  let equipamento = equipNomeado ?? 0;
  let indeterminada = false;

  const multaSemValor = falaMulta && multaNomeada === null;
  const equipSemValor = falaEquip && equipNomeado === null;
  if (multaSemValor || equipSemValor) {
    if (multaNomeada !== null || equipNomeado !== null) {
      // O outro item tem valor: ele sai; a parte sem nome ja esta na divida.
    } else if (FALA_DE_SERVICO.test(d) || TEM_DINHEIRO.test(d)) {
      // Mistura com mensalidade, ou um valor que nao se soube amarrar: ninguem
      // sabe a divisao — fica como divida, e a tela avisa.
      indeterminada = true;
    } else if (multaSemValor) {
      multa = teto;            // "multa rescisória": a fatura e so isso (multa + equipamento sem valores: vai como multa)
    } else {
      equipamento = teto;      // "referente ao equipamento"
    }
  }
  multa = Math.min(Math.max(0, multa), teto);
  equipamento = Math.min(Math.max(0, equipamento), centavos(teto - multa));
  return { multa: centavos(multa), equipamento: centavos(equipamento), indeterminada };
}

/** Soma as parcelas de varias faturas de um cliente. */
export function somarCobrancaDeSaida(faturas: ReadonlyArray<{ descricao: string | null | undefined; valor: number }>): CobrancaDeSaida {
  const acc: CobrancaDeSaida = { multa: 0, equipamento: 0, indeterminadas: 0, faturas: 0 };
  for (const f of faturas) {
    const p = parcelasDaDescricao(f.descricao, f.valor);
    acc.faturas++;
    acc.multa = centavos(acc.multa + p.multa);
    acc.equipamento = centavos(acc.equipamento + p.equipamento);
    if (p.indeterminada) acc.indeterminadas++;
  }
  return acc;
}
