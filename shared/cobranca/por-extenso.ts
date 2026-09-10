/**
 * Valor por extenso, como a Cláusula 2ª da confissão exige ("R$ 719,86
 * (setecentos e dezenove reais e oitenta e seis centavos)"). Puro.
 */
const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ateNovecentosENoventaENove(n: number): string {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto > 0 && resto < 20) partes.push(UNIDADES[resto]);
  else if (resto >= 20) {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
  }
  return partes.join(" e ");
}

const ESCALAS: Array<[number, string, string]> = [
  [1_000_000_000, "bilhão", "bilhões"],
  [1_000_000, "milhão", "milhões"],
  [1_000, "mil", "mil"],
];

export function numeroPorExtenso(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error("numeroPorExtenso: só inteiro não negativo");
  if (n === 0) return "zero";
  const grupos: string[] = [];
  let resto = n;
  for (const [valor, singular, plural] of ESCALAS) {
    const q = Math.floor(resto / valor);
    if (!q) continue;
    resto -= q * valor;
    if (valor === 1_000) grupos.push(q === 1 ? "mil" : `${ateNovecentosENoventaENove(q)} mil`);
    else grupos.push(`${ateNovecentosENoventaENove(q)} ${q === 1 ? singular : plural}`);
  }
  if (resto) grupos.push(ateNovecentosENoventaENove(resto));
  // O "e" antes do último grupo: "mil e cem", "dois mil e vinte", "um milhão e
  // duzentos mil"; sem ele quando o último grupo já é composto: "mil duzentos e cinquenta".
  if (grupos.length > 1) {
    const ultimoEhSimples = resto === 0 || resto < 100 || resto % 100 === 0;
    if (ultimoEhSimples) grupos[grupos.length - 1] = `e ${grupos[grupos.length - 1]}`;
  }
  return grupos.join(" ");
}

export function valorPorExtenso(valor: number): string {
  if (!Number.isFinite(valor)) throw new Error("valorPorExtenso: valor não numérico");
  // A magnitude por extenso: o sinal é do contexto, nunca do texto.
  const centavosTotais = Math.round(Math.abs(valor) * 100);
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;
  const partes: string[] = [];
  if (reais > 0) {
    const redonda = reais >= 1_000_000 && reais % 1_000_000 === 0;
    partes.push(`${numeroPorExtenso(reais)} ${redonda ? "de " : ""}${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos > 0) partes.push(`${numeroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  return partes.length ? partes.join(" e ") : "zero real";
}
