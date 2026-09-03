import { describe, it, expect } from "vitest";
import {
  CREDIT_PACKAGES,
  PLAN_CREDITS,
  PLAN_PRICES,
  TETO_CREDITO_CENTAVOS,
  formatarReais,
  validarPrecoDaMarca,
} from "./planos";
import * as schema from "./schema";

const PRECO_PLATAFORMA = 100; // R$ 1,00 por credito — a tabela de hoje

describe("validarPrecoDaMarca", () => {
  it("aceita o preco igual ao piso — o piso e a propria tabela da plataforma", () => {
    expect(validarPrecoDaMarca(PRECO_PLATAFORMA, PRECO_PLATAFORMA)).toEqual({ ok: true });
  });

  it("aceita um preco acima do piso e abaixo do teto", () => {
    expect(validarPrecoDaMarca(250, PRECO_PLATAFORMA)).toEqual({ ok: true });
  });

  it("aceita o preco exatamente no teto", () => {
    expect(validarPrecoDaMarca(TETO_CREDITO_CENTAVOS, PRECO_PLATAFORMA)).toEqual({ ok: true });
  });

  it("rejeita um centavo abaixo do piso", () => {
    const r = validarPrecoDaMarca(PRECO_PLATAFORMA - 1, PRECO_PLATAFORMA);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toContain("R$ 1,00");
  });

  it("rejeita um centavo acima do teto", () => {
    const r = validarPrecoDaMarca(TETO_CREDITO_CENTAVOS + 1, PRECO_PLATAFORMA);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toContain("R$ 5,00");
  });

  it("rejeita valor negativo", () => {
    expect(validarPrecoDaMarca(-100, PRECO_PLATAFORMA).ok).toBe(false);
  });

  it("rejeita zero", () => {
    expect(validarPrecoDaMarca(0, PRECO_PLATAFORMA).ok).toBe(false);
  });

  it("rejeita valor nao inteiro — centavo fracionado nao existe", () => {
    expect(validarPrecoDaMarca(150.5, PRECO_PLATAFORMA).ok).toBe(false);
  });

  it("rejeita NaN e Infinity", () => {
    expect(validarPrecoDaMarca(NaN, PRECO_PLATAFORMA).ok).toBe(false);
    expect(validarPrecoDaMarca(Infinity, PRECO_PLATAFORMA).ok).toBe(false);
  });

  it("rejeita quando o piso nao e um preco valido — sem piso confiavel nao ha o que validar", () => {
    expect(validarPrecoDaMarca(200, 0).ok).toBe(false);
    expect(validarPrecoDaMarca(200, NaN).ok).toBe(false);
  });

  /**
   * O motivo de existir: clampar em silencio faria o revendedor ver a tela
   * salvar e so descobrir o preco trocado na fatura do cliente dele.
   */
  it("nunca devolve um preco corrigido — so aceita ou recusa", () => {
    const r = validarPrecoDaMarca(1, PRECO_PLATAFORMA) as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(["motivo", "ok"]);
  });
});

describe("formatarReais", () => {
  it("formata centavos no padrao brasileiro", () => {
    expect(formatarReais(0)).toBe("R$ 0,00");
    expect(formatarReais(100)).toBe("R$ 1,00");
    expect(formatarReais(5000)).toBe("R$ 50,00");
    expect(formatarReais(123456)).toBe("R$ 1.234,56");
  });
});

describe("tabela da plataforma", () => {
  it("todo pacote tem rotulo coerente com o preco em centavos", () => {
    for (const pkg of CREDIT_PACKAGES) {
      expect(pkg.priceLabel).toBe(formatarReais(pkg.price));
      expect(pkg.perUnit).toBe(`${formatarReais(pkg.price / pkg.credits)}/crédito`);
    }
  });

  it("todo plano com preco tem creditos declarados", () => {
    for (const chave of Object.keys(PLAN_PRICES)) {
      expect(PLAN_CREDITS[chave]).toBeDefined();
    }
  });
});

/**
 * O re-export existe para nao renomear o import em dezenas de arquivos de
 * servidor. Se alguem redefinir a constante em schema.ts, a divergencia volta —
 * e volta calada, porque os dois nomes continuam existindo.
 */
describe("re-export de shared/schema", () => {
  it("entrega exatamente os mesmos objetos de shared/planos", () => {
    expect(schema.CREDIT_PACKAGES).toBe(CREDIT_PACKAGES);
    expect(schema.PLAN_PRICES).toBe(PLAN_PRICES);
    expect(schema.PLAN_CREDITS).toBe(PLAN_CREDITS);
    expect(schema.TETO_CREDITO_CENTAVOS).toBe(TETO_CREDITO_CENTAVOS);
    expect(schema.validarPrecoDaMarca).toBe(validarPrecoDaMarca);
  });
});
