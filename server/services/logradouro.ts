/**
 * Normalização de logradouro — o que faz o endereço do ERP encontrar o do IBGE.
 *
 * O cadastro do provedor tem "R. Dezenove de Dezembro", "Rua 19 de Dezembro",
 * "AV BRASIL"; o CNEFE tem "RUA DEZENOVE DE DEZEMBRO" e "AVENIDA BRASIL". Sem
 * pôr os dois na mesma régua, o casamento falha para a maioria dos endereços e
 * o cliente cai no centro da cidade — que é o defeito que estamos consertando.
 *
 * A cascata é a mesma validada no Provedor.ai: caixa alta sem acento, tipo de
 * logradouro expandido só no primeiro token, honorífico expandido em qualquer
 * posição.
 */

/** Caixa alta, sem acento, sem pontuação, espaços colapsados. */
export function normalizarTexto(s: string | null | undefined): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tipo de logradouro abreviado no ERP → forma extensa do CNEFE. */
const TIPO_ABREV: Record<string, string> = {
  R: "RUA", RU: "RUA",
  AV: "AVENIDA", AVN: "AVENIDA", AVE: "AVENIDA",
  TV: "TRAVESSA", TRAV: "TRAVESSA",
  AL: "ALAMEDA", ALM: "ALAMEDA",
  PC: "PRACA", PCA: "PRACA", PR: "PRACA",
  ROD: "RODOVIA",
  ESTR: "ESTRADA", EST: "ESTRADA",
  LG: "LARGO",
  JD: "JARDIM",
  VL: "VILA",
};

/** Honoríficos abreviados, em qualquer posição do nome. */
const HONORIFICO_ABREV: Record<string, string> = {
  DR: "DOUTOR", DRA: "DOUTORA",
  PROF: "PROFESSOR", PROFA: "PROFESSORA",
  STA: "SANTA", STO: "SANTO",
  SAO: "SAO",
  PE: "PADRE",
  CEL: "CORONEL",
  GAL: "GENERAL",
  ENG: "ENGENHEIRO",
  DES: "DESEMBARGADOR",
  PRES: "PRESIDENTE",
  MAL: "MARECHAL",
  VER: "VEREADOR",
  SEN: "SENADOR",
  DEP: "DEPUTADO",
};

/**
 * Chave de logradouro para comparação. O tipo só é expandido no PRIMEIRO token:
 * "RUA PRACA DA SE" existe, e expandir "PRACA" no meio criaria uma rua que não
 * é a mesma.
 */
export function chaveLogradouro(logradouro: string | null | undefined): string {
  const n = normalizarTexto(logradouro);
  if (!n) return "";
  return n
    .split(" ")
    .map((t, i) => (i === 0 && TIPO_ABREV[t] !== undefined ? TIPO_ABREV[t] : HONORIFICO_ABREV[t] ?? t))
    .join(" ");
}

/**
 * Número da casa como inteiro. Zero e vazio contam como "sem número" — no ERP
 * o "0" é o que se digita quando não se sabe, não um endereço na esquina.
 */
export function numeroDoEndereco(numero: string | null | undefined): number | null {
  const digitos = String(numero ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digitos) return null;
  const n = parseInt(digitos, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Separa o número que às vezes vem grudado no logradouro: o ERP guarda
 * "Rua Brasil, 1234" num campo só em boa parte dos cadastros.
 */
export function separarLogradouroENumero(
  endereco: string | null | undefined,
  numeroSeparado?: string | null,
): { logradouro: string; numero: number | null } {
  const numeroExplicito = numeroDoEndereco(numeroSeparado);
  const bruto = (endereco || "").trim();
  if (!bruto) return { logradouro: "", numero: numeroExplicito };

  // "Rua Brasil, 1234" · "Rua Brasil 1234" · "Rua Brasil, 1234 - apto 2"
  const m = bruto.match(/^(.*?)[,\s]+(\d{1,6})\s*(?:[-–,].*)?$/);
  if (m) {
    const numeroNoTexto = numeroDoEndereco(m[2]);
    // O campo próprio manda: quando os dois existem e divergem, o número
    // digitado num campo de número é o mais confiável.
    return { logradouro: chaveLogradouro(m[1]), numero: numeroExplicito ?? numeroNoTexto };
  }
  return { logradouro: chaveLogradouro(bruto), numero: numeroExplicito };
}
