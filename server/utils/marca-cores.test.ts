/**
 * A derivacao de paleta nao pode ser "quase certa".
 *
 * Dois riscos concretos:
 *  1. a conversao hex->HSL alimenta o --primary do shadcn. Errar um ponto
 *     percentual deixa o botao do revendedor num tom diferente do resto da pele;
 *  2. um revendedor escolhe amarelo. Sem o ajuste de contraste, o link some no
 *     fundo e o texto branco some no botao — num bureau de credito, ilegivel.
 *
 * As ancoras sao os valores REAIS de client/src/index.css: se a conversao
 * reproduz a marca da plataforma, ela esta certa.
 */
import { describe, it, expect } from "vitest";
import {
  hexParaHsl, hslParaHex, tripletaHsl, contraste, corValida,
  paletaClara, paletaEscura,
} from "./marca-cores";

const FUNDO_CLARO = "#F6F6F9";
const FUNDO_ESCURO = "#131219";
const AA = 4.5;

describe("conversao hex <-> hsl", () => {
  it("reproduz o --primary da plataforma no tema claro", () => {
    // index.css: --brand #4A4670 e --primary: 246 23% 36%
    expect(hexParaHsl("#4A4670")).toEqual({ h: 246, s: 23, l: 36 });
    expect(tripletaHsl("#4A4670")).toBe("246 23% 36%");
  });

  it("reproduz o --primary da plataforma no tema escuro", () => {
    // index.css .dark: --brand #A9A2D8 e --primary: 248 41% 74%
    expect(hexParaHsl("#A9A2D8")).toEqual({ h: 248, s: 41, l: 74 });
    expect(tripletaHsl("#A9A2D8")).toBe("248 41% 74%");
  });

  it("ida e volta nao desloca a cor de forma perceptivel", () => {
    for (const hex of ["#4A4670", "#F26201", "#58C48C", "#B3261E", "#131219", "#FFFFFF"]) {
      const volta = hslParaHex(hexParaHsl(hex));
      const [r1, g1, b1] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      const [r2, g2, b2] = [1, 3, 5].map(i => parseInt(volta.slice(i, i + 2), 16));
      // arredondar para inteiro em H/S/L custa alguns niveis de 0-255; 4 e o teto aceitavel
      expect(Math.max(Math.abs(r1 - r2), Math.abs(g1 - g2), Math.abs(b1 - b2))).toBeLessThanOrEqual(4);
    }
  });

  it("cinza puro nao inventa matiz", () => {
    expect(hexParaHsl("#808080")).toEqual({ h: 0, s: 0, l: 50 });
  });

  it("recusa o que nao e cor", () => {
    expect(corValida("#4A4670")).toBe(true);
    expect(corValida("#4a4670")).toBe(true);
    for (const lixo of ["4A4670", "#ABC", "#GGGGGG", "red", "", "#4A467"]) {
      expect(corValida(lixo as string)).toBe(false);
    }
  });
});

describe("contraste WCAG", () => {
  it("preto sobre branco e 21:1", () => {
    expect(contraste("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
  });
  it("e simetrico", () => {
    expect(contraste("#4A4670", "#FFFFFF")).toBeCloseTo(contraste("#FFFFFF", "#4A4670"), 6);
  });
});

describe("paleta clara", () => {
  it("nao mexe na cor de quem ja escolheu bem", () => {
    const p = paletaClara("#4A4670");
    expect(p.brand).toBe("#4A4670");
    expect(p.ajustada).toBe(false);
  });

  it("escurece o amarelo ate o link ficar legivel, e avisa", () => {
    // #FFD700 tem ~1.4:1 contra o fundo claro: como cor de link, invisivel.
    expect(contraste("#FFD700", FUNDO_CLARO)).toBeLessThan(AA);
    const p = paletaClara("#FFD700");
    expect(p.ajustada).toBe(true);
    expect(contraste(p.brand, FUNDO_CLARO)).toBeGreaterThanOrEqual(AA);
  });

  it("todo brand derivado passa AA contra o fundo da pagina", () => {
    for (const cor of ["#FFD700", "#00FF00", "#FF0000", "#4A4670", "#000000", "#FFFFFF", "#F26201"]) {
      expect(contraste(paletaClara(cor).brand, FUNDO_CLARO)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("o texto sobre o botao e escolhido por contraste, nao fixado em branco", () => {
    for (const cor of ["#FFD700", "#00FF00", "#4A4670", "#000000", "#F26201"]) {
      const p = paletaClara(cor);
      expect(contraste(p.textOnBrand, p.brand)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("ink e mais escuro que brand, e soft e claro o bastante para ser fundo", () => {
    const p = paletaClara("#4A4670");
    expect(hexParaHsl(p.ink).l).toBeLessThan(hexParaHsl(p.brand).l);
    expect(hexParaHsl(p.soft).l).toBeGreaterThanOrEqual(90);
    // ink existe para ser lido SOBRE soft — e essa e a unica coisa que importa nele
    expect(contraste(p.ink, p.soft)).toBeGreaterThanOrEqual(AA);
  });
});

describe("paleta escura", () => {
  it("clareia a marca em vez de reusar o hex do tema claro", () => {
    const p = paletaEscura("#4A4670");
    expect(hexParaHsl(p.brand).l).toBeGreaterThan(hexParaHsl("#4A4670").l);
    expect(contraste(p.brand, FUNDO_ESCURO)).toBeGreaterThanOrEqual(AA);
  });

  it("respeita a cor escura que o revendedor mandou", () => {
    const p = paletaEscura("#4A4670", "#A9A2D8");
    expect(p.brand).toBe("#A9A2D8");
  });

  it("todo brand derivado passa AA contra o fundo escuro", () => {
    for (const cor of ["#FFD700", "#00FF00", "#FF0000", "#4A4670", "#000000", "#FFFFFF", "#F26201"]) {
      expect(contraste(paletaEscura(cor).brand, FUNDO_ESCURO)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("o texto sobre o botao continua legivel no escuro", () => {
    for (const cor of ["#FFD700", "#4A4670", "#000000", "#F26201"]) {
      const p = paletaEscura(cor);
      expect(contraste(p.textOnBrand, p.brand)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("soft escuro e escuro de verdade — e fundo de item ativo, nao preenchimento", () => {
    const p = paletaEscura("#4A4670");
    expect(hexParaHsl(p.soft).l).toBeLessThanOrEqual(25);
    expect(contraste(p.ink, p.soft)).toBeGreaterThanOrEqual(AA);
  });
});
