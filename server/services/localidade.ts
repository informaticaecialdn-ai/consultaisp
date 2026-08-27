/**
 * Normalização de bairro — a chave que faz o ranking somar direito.
 *
 * O bairro chega do ERP como texto livre, digitado por gente diferente ao longo
 * de anos: "Jd. Bandeirantes", "JARDIM BANDEIRANTES", "Jardim  Bandeirantes".
 * Agrupar por `bairro.toUpperCase()` transforma um bairro em três linhas do
 * ranking, cada uma com um terço da carteira e uma taxa de inadimplência que
 * não descreve lugar nenhum — e é justamente o bairro fatiado que aparece com
 * "100%" no topo por ter um único cliente inadimplente.
 *
 * A cascata é a mesma validada no Provedor.ai (packages/geo/src/bairro.ts), que
 * mediu ~97% de cobertura em Ibiporã e ~93% em Londrina:
 *   1. exato  — string normalizada idêntica
 *   2. núcleo — sem o prefixo de loteamento (JARDIM, VILA, CONJUNTO...)
 *   3. fuzzy  — Levenshtein ≤ 2 no núcleo, ou contenção entre núcleos longos
 *
 * O rótulo mostrado na tela continua sendo o que o ERP mandou; a normalização
 * serve só para decidir o que é o mesmo bairro.
 */

/** Caixa alta, sem acento e sem pontuação, com espaços colapsados. */
export function normalizarLocalidade(s: string | null | undefined): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prefixos de tipo de loteamento, removidos iterativamente para chegar ao
 * núcleo do nome ("CONJUNTO HABITACIONAL SANTIAGO II" → "SANTIAGO II").
 * A ordem importa: compostos antes dos simples.
 */
const PREFIXOS_LOTEAMENTO = [
  "CONJUNTO HABITACIONAL",
  "NUCLEO HABITACIONAL",
  "PARQUE RESIDENCIAL",
  "JARDIM RESIDENCIAL",
  "CONJUNTO RESIDENCIAL",
  "MORADIAS",
  "RESIDENCIAL",
  "CONJUNTO",
  "JARDIM",
  "PARQUE",
  "VILA",
  "LOTEAMENTO",
  "CHACARAS",
  "CHACARA",
  "RECANTO",
  "GLEBA",
] as const;

/** Núcleo de um nome JÁ normalizado — sem os prefixos de loteamento. */
export function nucleoLocalidade(nomeNormalizado: string): string {
  let r = nomeNormalizado;
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const p of PREFIXOS_LOTEAMENTO) {
      if (r.startsWith(`${p} `)) {
        r = r.slice(p.length + 1);
        mudou = true;
      }
    }
  }
  return r;
}

/**
 * Levenshtein com saída antecipada: diferença de tamanho acima de 2 já está
 * fora do raio, e não vale pagar O(m·n) para descobrir isso.
 */
export function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array<number>(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return d[m][n];
}

export type TierBairro = "exato" | "nucleo" | "fuzzy";

/**
 * Agrupador de bairros de uma carteira.
 *
 * Diferente do matcher do Provedor.ai, que casa contra uma lista canônica do
 * CNEFE, aqui não há base canônica: o universo é o que o próprio ERP mandou.
 * Então o primeiro nome visto de cada grupo vira o rótulo, e as variações
 * seguintes são atraídas para ele.
 */
export function criarAgrupadorDeBairro() {
  interface Grupo { rotulo: string; norm: string; nucleo: string; nucleoSq: string }
  const grupos: Grupo[] = [];
  const porNorm = new Map<string, Grupo>();

  return {
    /** Devolve a chave canônica do bairro — e o rótulo a exibir. */
    agrupar(bairro: string | null | undefined): { chave: string; rotulo: string; tier: TierBairro } | null {
      const norm = normalizarLocalidade(bairro);
      if (!norm) return null;

      const exato = porNorm.get(norm);
      if (exato) return { chave: exato.norm, rotulo: exato.rotulo, tier: "exato" };

      const nucleo = nucleoLocalidade(norm);
      const nucleoSq = nucleo.replace(/ /g, "");

      const porNucleo = grupos.find(g => g.nucleo === nucleo);
      if (porNucleo) {
        porNorm.set(norm, porNucleo);
        return { chave: porNucleo.norm, rotulo: porNucleo.rotulo, tier: "nucleo" };
      }

      // Contenção só entre núcleos longos: "SUL" dentro de "JARDIM SUL" casaria
      // qualquer coisa curta com qualquer coisa.
      const porFuzzy = grupos.find(g =>
        levenshtein(g.nucleoSq, nucleoSq) <= 2 ||
        (nucleo.length >= 6 && (g.nucleo.includes(nucleo) || (nucleo.includes(g.nucleo) && g.nucleo.length >= 6))),
      );
      if (porFuzzy) {
        porNorm.set(norm, porFuzzy);
        return { chave: porFuzzy.norm, rotulo: porFuzzy.rotulo, tier: "fuzzy" };
      }

      const novo: Grupo = { rotulo: (bairro || "").trim(), norm, nucleo, nucleoSq };
      grupos.push(novo);
      porNorm.set(norm, novo);
      return { chave: norm, rotulo: novo.rotulo, tier: "exato" };
    },
  };
}
