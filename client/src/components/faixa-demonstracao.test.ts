import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tempoRestanteEmTexto } from "./FaixaDemonstracao";

const RAIZ = resolve(__dirname, "../../..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const faixa = ler("client/src/components/FaixaDemonstracao.tsx");
const app = ler("client/src/App.tsx");

describe("faixa de demonstracao", () => {
  it("diz que o dado e ficticio, com essas palavras", () => {
    expect(faixa).toContain("Demonstração — dados fictícios");
  });

  it("mostra quanto falta para o sandbox expirar", () => {
    expect(faixa).toMatch(/expira em/i);
  });

  it("leva ao cadastro do site real", () => {
    expect(faixa).toContain("https://consultaisp.com.br/login?mode=register");
    expect(faixa).toContain("Quero no meu provedor");
  });

  it("so tokens do design system — nada de paleta default nem pill", () => {
    expect(faixa).not.toMatch(/\b(bg|text|border)-(slate|gray|blue|emerald|red|amber|zinc)-\d{2,3}\b/);
    expect(faixa).not.toContain("rounded-full");
    expect(faixa).toMatch(/var\(--/);
  });

  it("monta na coluna de conteudo, junto da faixa de suporte REAL (nao nas 3 telas de loading/redirecionamento que tambem tem <FaixaSuporte />)", () => {
    // `<FaixaSuporte />` aparece 4 vezes em App.tsx: 3 sao skeleton dentro de
    // guardas de redirecionamento (early returns antes do shell autenticado);
    // so a QUARTA, dentro do shell (`data-module="consulta"`), fica montada
    // o tempo todo. `indexOf()` sem ancora acha a PRIMEIRA — a errada.
    expect(app).toContain("<FaixaDemonstracao />");
    const ancoraDoShell = app.indexOf('data-module="consulta"');
    expect(ancoraDoShell, "shell autenticado (data-module=\"consulta\") nao encontrado").toBeGreaterThan(-1);
    const posFaixaSuporte = app.indexOf("<FaixaSuporte />", ancoraDoShell);
    expect(posFaixaSuporte, "<FaixaSuporte /> do shell autenticado nao encontrada").toBeGreaterThan(-1);
    const posFaixaDemonstracao = app.indexOf("<FaixaDemonstracao />");
    expect(posFaixaDemonstracao).toBeGreaterThan(posFaixaSuporte);
    expect(posFaixaDemonstracao).toBeLessThan(posFaixaSuporte + 400);
  });
});

describe("tempoRestanteEmTexto", () => {
  it("zero ou negativo: a qualquer momento — nunca minuto negativo na tela", () => {
    expect(tempoRestanteEmTexto(0)).toBe("a qualquer momento");
    expect(tempoRestanteEmTexto(-1)).toBe("a qualquer momento");
    expect(tempoRestanteEmTexto(-60_000)).toBe("a qualquer momento");
    expect(tempoRestanteEmTexto(-999_999_999)).toBe("a qualquer momento");
  });

  it("menos de uma hora: so minutos", () => {
    expect(tempoRestanteEmTexto(1 * 60_000)).toBe("1 min");
    expect(tempoRestanteEmTexto(5 * 60_000)).toBe("5 min");
    expect(tempoRestanteEmTexto(59 * 60_000)).toBe("59 min");
  });

  it("uma hora ou mais: horas e minutos, minutos sempre com dois digitos", () => {
    expect(tempoRestanteEmTexto(60 * 60_000)).toBe("1 h 00 min");
    expect(tempoRestanteEmTexto((60 + 5) * 60_000)).toBe("1 h 05 min");
    expect(tempoRestanteEmTexto((23 * 60 + 42) * 60_000)).toBe("23 h 42 min");
  });

  it("arredonda para baixo dentro do minuto — nao antecipa a virada", () => {
    // 89.9s ainda e "1 min", nao "2 min"
    expect(tempoRestanteEmTexto(89_900)).toBe("1 min");
  });
});
