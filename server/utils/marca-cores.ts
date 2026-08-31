/**
 * Deriva a paleta de uma marca white label a partir de UMA cor.
 *
 * Por que uma cor so: pedir a um revendedor os quatro tons da familia (base,
 * hover, soft, ink) produz paleta ruim — ele escolhe o logo, nao um sistema de
 * design. A derivacao acerta sempre porque os quatro sao a MESMA cor em
 * luminosidades diferentes, que e exatamente como os tokens da plataforma foram
 * construidos (confira em client/src/index.css: --brand #4A4670, --brand-hover
 * #3C3860 e --brand-ink #3A3658 tem o mesmo matiz e saturacao).
 *
 * O trabalho de verdade aqui e CONTRASTE. `--brand` nao e so preenchimento de
 * botao: e cor de link, de aba ativa e de item de menu selecionado, sobre fundo
 * claro. Um revendedor que escolher amarelo #FFD700 fica com link ilegivel e
 * texto branco invisivel em cima do botao. Entao:
 *
 *  1. a cor e escurecida (ou clareada, no tema escuro) o minimo necessario ate
 *     passar 4.5:1 contra o fundo da pagina — e a UI avisa que ajustou, para a
 *     mudanca nao ser silenciosa;
 *  2. `textOnBrand` e escolhido por contraste, nao fixado em branco.
 *
 * Ninguem le um bureau de credito com link que some no fundo.
 */

export type Hsl = { h: number; s: number; l: number };

/** Fundos da pagina, de client/src/index.css. O contraste e medido contra eles. */
const FUNDO_CLARO = "#F6F6F9";
const FUNDO_ESCURO = "#131219";
const TINTA_CLARA = "#FFFFFF";
const TINTA_ESCURA = "#1F1D29";

/** Minimo da WCAG para texto normal. Nao negociavel (DESIGN_SYSTEM secao 7). */
const AA = 4.5;

export function corValida(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex ?? "");
}

function paraRgb(hex: string): [number, number, number] {
  if (!corValida(hex)) throw new Error(`cor invalida: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexParaHsl(hex: string): Hsl {
  const [r255, g255, b255] = paraRgb(hex);
  const r = r255 / 255, g = g255 / 255, b = b255 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;

  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslParaHex({ h, s, l }: Hsl): string {
  const sf = s / 100, lf = l / 100;
  const c = (1 - Math.abs(2 * lf - 1)) * sf;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lf - c / 2;
  const faixa = Math.floor(((h % 360) + 360) % 360 / 60);
  const [r1, g1, b1] = (
    [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]] as const
  )[faixa];
  const byte = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${byte(r1)}${byte(g1)}${byte(b1)}`;
}

/**
 * Tripla HSL do shadcn: "246 23% 36%".
 *
 * Existe porque a pele usa hex (--brand) e o shadcn usa HSL sem funcao
 * (--primary). Sobrescrever so um dos dois formatos deixa metade dos botoes na
 * cor antiga — foi por isso que este helper virou publico.
 */
export function tripletaHsl(hex: string): string {
  const { h, s, l } = hexParaHsl(hex);
  return `${h} ${s}% ${l}%`;
}

/** Luminancia relativa da WCAG 2.1. */
function luminancia(hex: string): number {
  const [r, g, b] = paraRgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a: string, b: string): number {
  const la = luminancia(a), lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Empurra a luminosidade de 1 em 1 ate passar o contraste, ou ate o fim da
 * escala. Devolve a cor original quando ela ja passa — a marca de quem ja
 * escolheu bem nao e tocada.
 */
function ateContrastar(hex: string, fundo: string, sentido: "escurecer" | "clarear"): string {
  if (contraste(hex, fundo) >= AA) return hex;
  const base = hexParaHsl(hex);
  const passo = sentido === "escurecer" ? -1 : 1;
  for (let l = base.l + passo; l >= 0 && l <= 100; l += passo) {
    const tentativa = hslParaHex({ ...base, l });
    if (contraste(tentativa, fundo) >= AA) return tentativa;
  }
  return sentido === "escurecer" ? "#000000" : "#FFFFFF";
}

export type Paleta = {
  brand: string;
  hover: string;
  soft: string;
  ink: string;
  textOnBrand: string;
  /** true quando a cor teve de ser ajustada para passar AA. A UI avisa. */
  ajustada: boolean;
};

/**
 * Paleta do tema claro.
 *
 * As distancias (-6 no hover, -8 no ink, soft em L=94) foram tiradas dos
 * proprios tokens da plataforma, nao inventadas.
 */
export function paletaClara(corBase: string): Paleta {
  const brand = ateContrastar(corBase, FUNDO_CLARO, "escurecer");
  const { h, s, l } = hexParaHsl(brand);
  return {
    brand,
    hover: hslParaHex({ h, s, l: Math.max(0, l - 6) }),
    ink: hslParaHex({ h, s, l: Math.max(0, l - 8) }),
    soft: hslParaHex({ h, s, l: 94 }),
    textOnBrand: contraste(TINTA_CLARA, brand) >= AA ? TINTA_CLARA : TINTA_ESCURA,
    ajustada: brand.toLowerCase() !== corBase.toLowerCase(),
  };
}

/**
 * Paleta do tema escuro.
 *
 * O DESIGN_SYSTEM manda: "semanticas clareiam no dark; nunca reuse o hex do
 * light". A plataforma faz exatamente isso — #4A4670 vira #A9A2D8, mesmo matiz,
 * saturacao acima e luminosidade em 74%. A derivacao repete a regra.
 *
 * `corEscuraExplicita` permite ao revendedor mandar a versao dele; sem ela, a
 * clara e convertida.
 */
export function paletaEscura(corBase: string, corEscuraExplicita?: string | null): Paleta {
  const partida = corEscuraExplicita && corValida(corEscuraExplicita)
    ? corEscuraExplicita
    : (() => {
        const { h, s } = hexParaHsl(corBase);
        return hslParaHex({ h, s: Math.min(60, Math.max(25, Math.round(s * 1.8))), l: 74 });
      })();

  const brand = ateContrastar(partida, FUNDO_ESCURO, "clarear");
  const { h, s, l } = hexParaHsl(brand);
  return {
    brand,
    hover: hslParaHex({ h, s, l: Math.min(100, l + 7) }),
    ink: hslParaHex({ h, s, l: Math.min(100, l + 9) }),
    soft: hslParaHex({ h, s: Math.max(0, s - 17), l: 20 }),
    textOnBrand: contraste(TINTA_ESCURA, brand) >= AA ? TINTA_ESCURA : TINTA_CLARA,
    ajustada: !corEscuraExplicita && brand !== partida,
  };
}
