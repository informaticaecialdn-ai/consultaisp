/**
 * Equipamento não devolvido, lido da descrição da fatura.
 *
 * Descoberto medindo a instalação real da NsLink em 27/08/2026. O endpoint de
 * inventário do MK (`/pessoas/inventory`, release 74) volta vazio — a core-api
 * em Node não está instalada lá, e não estará na maioria das instalações. Mas o
 * dado existe, em outro lugar: o provedor **cobra** o equipamento retido como
 * item da fatura de rescisão. Três faturas reais, textualmente:
 *
 *   "Proporcional 40 dias + multa 150,00 + roteador 800,00 + smart box 250,00"
 *   "Proporcional 40 dias + multa de 550,00 + roteador 800,00 + smart box 350,00"
 *   "Proporcional 40 dias + multa 600,00 + roteador 800,00 + smart box 250,00"
 *
 * Roteador de R$ 800 e smart box de R$ 250 não são multa: são o equipamento que
 * ficou com o cliente, valorado pelo próprio provedor. Num bureau de ISP esse
 * número costuma pesar mais que a mensalidade atrasada.
 *
 * A leitura é conservadora de propósito — só conta o que vem acompanhado de
 * valor e de um termo de equipamento conhecido. "multa 125,00" e "proporcional
 * 40 dias" ficam de fora, que é o comportamento certo: é melhor não afirmar um
 * equipamento do que afirmar um que não existe.
 */

/** Termos de equipamento de ISP, já normalizados (sem acento, minúsculos). */
// O sufixo `(?:es|s)?` cobre o plural, que aparece quando o provedor cobra mais
// de uma peça ("2 roteadores 800,00"). `onu` e `ont` ficam SEM plural de
// propósito: "onus" normalizado é a palavra "ônus", que aparece em texto de
// cobrança e viraria um equipamento inexistente.
const TERMOS: Array<{ regex: RegExp; tipo: string }> = [
  { regex: /\bsmart\s*box(?:es)?\b|\btv\s*box(?:es)?\b|\bdecodificador(?:es)?\b|\bdeco\b|\breceptor(?:es)?\b/, tipo: "TV BOX" },
  { regex: /\broteador(?:es)?\b|\brouter(?:s)?\b/, tipo: "ROTEADOR" },
  { regex: /\bonu\b|\bont\b/, tipo: "ONU" },
  { regex: /\bmodem(?:s)?\b/, tipo: "MODEM" },
  { regex: /\brepetidor(?:es)?\b|\bextensor(?:es)?\b|\bmesh\b/, tipo: "REPETIDOR" },
  { regex: /\bantena(?:s)?\b|\bradio(?:s)?\b/, tipo: "ANTENA" },
  { regex: /\bconversor(?:es)?\b|\bswitch(?:es)?\b/, tipo: "CONVERSOR" },
  { regex: /\bfonte(?:s)?\b|\bcarregador(?:es)?\b/, tipo: "FONTE" },
];

export interface EquipamentoCobrado {
  tipo: string;
  valor: number;
  /** O trecho que originou a leitura — para auditoria, não para exibir cru. */
  trecho: string;
}

function normalizar(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** "800,00" · "800.00" · "1.359,73" · "800" → number */
function valorBR(bruto: string): number | null {
  const limpo = bruto.trim().replace(/\s/g, "");
  // Com vírgula decimal: ponto é separador de milhar.
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Extrai os equipamentos cobrados numa descrição de fatura.
 *
 * A descrição vem como itens separados por "+". Cada pedaço é avaliado
 * isoladamente: separar antes evita que "multa 150,00 + roteador 800,00" case o
 * termo de um item com o valor do outro.
 */
export function equipamentosNaDescricao(descricao: string | null | undefined): EquipamentoCobrado[] {
  const texto = normalizar(descricao ?? "");
  if (!texto) return [];

  const achados: EquipamentoCobrado[] = [];
  for (const pedaco of texto.split(/[+;]/)) {
    const trecho = pedaco.trim();
    if (!trecho) continue;

    const termo = TERMOS.find(t => t.regex.test(trecho));
    if (!termo) continue;

    // Último número do pedaço: em "roteador 800,00" é o valor; em
    // "2 roteadores 800,00" o primeiro número é quantidade, não preço.
    const numeros = trecho.match(/\d[\d.]*(?:,\d{1,2})?/g);
    if (!numeros || numeros.length === 0) continue;

    const valor = valorBR(numeros[numeros.length - 1]);
    if (valor === null) continue;

    achados.push({ tipo: termo.tipo, valor, trecho });
  }
  return achados;
}

/**
 * Agrega os equipamentos de várias faturas do mesmo cliente.
 *
 * Deduplicado por tipo+valor: a mesma cobrança costuma se repetir quando a
 * fatura é reemitida, e contar duas vezes inflaria o prejuízo.
 */
export function agregarEquipamentosCobrados(descricoes: Array<string | null | undefined>): {
  itens: EquipamentoCobrado[];
  total: number;
} {
  const vistos = new Map<string, EquipamentoCobrado>();
  for (const d of descricoes) {
    for (const e of equipamentosNaDescricao(d)) {
      vistos.set(`${e.tipo}|${e.valor}`, e);
    }
  }
  const itens = Array.from(vistos.values());
  return { itens, total: itens.reduce((s, e) => s + e.valor, 0) };
}
