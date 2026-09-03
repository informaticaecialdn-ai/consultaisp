import { describe, it, expect, afterEach, vi } from "vitest";
import { copiarTexto, retornoDaCopia } from "./copiar";

const navegadorOriginal = (globalThis as any).navigator;

function comClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
  Object.defineProperty(globalThis, "navigator", {
    value: writeText ? { clipboard: { writeText } } : {},
    configurable: true, writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: navegadorOriginal, configurable: true, writable: true,
  });
});

describe("copiarTexto", () => {
  it("copia e confirma", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    comClipboard(writeText);
    await expect(copiarTexto("CI-2609-K7F3M2")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("CI-2609-K7F3M2");
  });

  it("devolve false quando o navegador nega a permissao — o botao nao pode mentir", async () => {
    comClipboard(vi.fn().mockRejectedValue(new Error("NotAllowedError")));
    await expect(copiarTexto("CI-2609-K7F3M2")).resolves.toBe(false);
  });

  it("devolve false onde nao ha clipboard — fora de contexto seguro ele simplesmente nao existe", async () => {
    comClipboard(undefined);
    await expect(copiarTexto("CI-2609-K7F3M2")).resolves.toBe(false);
  });

  it("nao chama o navegador com texto vazio", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    comClipboard(writeText);
    await expect(copiarTexto("")).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("retornoDaCopia", () => {
  const rotulo = "identificador desta consulta";

  it("no repouso convida a copiar e nao afirma nada", () => {
    const r = retornoDaCopia("parado", rotulo);
    expect(r.dito).toBeNull();
    expect(r.aria).toBe("Copiar identificador desta consulta");
    expect(r.cor).toBe("var(--text-muted)");
  });

  it("confirma a copia por escrito e no aria-label", () => {
    const r = retornoDaCopia("copiado", rotulo);
    expect(r.dito).toBe("copiado");
    expect(r.aria).toBe("identificador desta consulta copiado");
    expect(r.cor).toBe("var(--ok)");
  });

  it("na falha o botao NAO diz copiado — diz o que fazer", () => {
    const r = retornoDaCopia("falhou", rotulo);
    expect(r.dito).toBe("copie a mão");
    expect(r.dito).not.toContain("copiado");
    expect(r.aria).toContain("Não foi possível copiar");
    expect(r.cor).toBe("var(--danger)");
  });

  it("a falha fica mais tempo na tela que o sucesso — ela exige uma acao", () => {
    expect(retornoDaCopia("falhou", rotulo).duracaoMs)
      .toBeGreaterThan(retornoDaCopia("copiado", rotulo).duracaoMs);
  });

  it("o rotulo entra no aria-label — a tela tem dois codigos lado a lado", () => {
    expect(retornoDaCopia("parado", "protocolo em SPC Brasil").aria)
      .toBe("Copiar protocolo em SPC Brasil");
  });
});
