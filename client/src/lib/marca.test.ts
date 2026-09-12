import { describe, it, expect, afterEach } from "vitest";
import { marcaAtual, esquecerMarcaMemorizada } from "./marca";

/**
 * `demoMode` em `MarcaCliente` (item 6 do plano de 2026-09-11): o único sinal
 * disponível ANTES do primeiro render que diz "este host é a demonstração
 * pública" — sem ele, um visitante cujo sandbox expirou via o LOGIN da
 * plataforma (`LoginDaPlataforma`), um formulário que ele nunca tem como
 * preencher.
 *
 * `marcaAtual()` memoriza o resultado num módulo-nível (`memoria`) — cada
 * teste chama `esquecerMarcaMemorizada()` antes de mexer em
 * `window.__MARCA__`, senão o segundo teste leria o cache do primeiro.
 *
 * O ambiente de teste deste projeto é Node puro (sem jsdom — ver
 * `vitest.config.ts`), então `window` não existe por padrão; ele é montado
 * manualmente aqui e desmontado no `afterEach`, para não vazar para outro
 * arquivo de teste.
 */
afterEach(() => {
  esquecerMarcaMemorizada();
  delete (globalThis as { window?: unknown }).window;
});

describe("demoMode em MarcaCliente", () => {
  it("sem window.__MARCA__ (build antigo, teste), demoMode e false", () => {
    expect(marcaAtual().demoMode).toBe(false);
  });

  it("window.__MARCA__.demoMode:true chega intacto", () => {
    (globalThis as any).window = { __MARCA__: { contexto: "tenant", demoMode: true } };
    expect(marcaAtual().demoMode).toBe(true);
  });

  it("qualquer valor que nao seja o booleano true vira false — nunca truthy por acidente", () => {
    for (const valor of [undefined, null, "true", 1, 0, "false"]) {
      esquecerMarcaMemorizada();
      (globalThis as any).window = { __MARCA__: { contexto: "tenant", demoMode: valor } };
      expect(marcaAtual().demoMode, `valor=${JSON.stringify(valor)}`).toBe(false);
    }
  });
});
