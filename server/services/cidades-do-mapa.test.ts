import { describe, expect, it } from "vitest";
import { cidadesNoMapa, MIN_CLIENTES_CIDADE } from "./cidades-do-mapa";

/**
 * A regra que decide quais cidades o mapa da carteira mostra.
 *
 * Ela vivia dentro de `localizacao.storage.ts`. Saiu de lá quando a medição de
 * cobertura da base de endereços passou a contar quem está fora do mapa e a
 * virar FILA DE DOWNLOAD do IBGE: com duas cópias, os dois números da mesma
 * página descreviam universos diferentes, e a fila começava pela capital que o
 * provedor tinha tirado do mapa à mão — o CNEFE mais pesado do país, baixado
 * para clientes que ninguém ia plotar.
 */

describe("cidadesNoMapa", () => {
  it("cidade com massa entra; abaixo do piso, não", () => {
    const dentro = cidadesNoMapa([
      ["embu guacu", 96],
      ["itapecerica da serra", MIN_CLIENTES_CIDADE],
      ["campinas", MIN_CLIENTES_CIDADE - 1],
    ]);

    expect(dentro.has("embu guacu")).toBe(true);
    // O piso é inclusivo: 20 clientes é praça.
    expect(dentro.has("itapecerica da serra")).toBe(true);
    // Endereço avulso — cliente que mudou, cobrança com endereço de escritório.
    expect(dentro.has("campinas")).toBe(false);
  });

  it("a escolha do provedor vence o corte automático", () => {
    // O caso real: o endereço de cobrança numa capital junta dezenas de
    // clientes, passa o piso e não é praça (na NsLink é Curitiba, 43 clientes e
    // zero inadimplentes). Sem esta linha, é ela que encabeça o download.
    const dentro = cidadesNoMapa([["curitiba", 43], ["londrina", 800]], ["Curitiba"]);

    expect(dentro.has("curitiba")).toBe(false);
    expect(dentro.has("londrina")).toBe(true);
  });

  it("a exclusão é comparada normalizada dos dois lados", () => {
    // O provedor grava o nome como digitou; a contagem chega normalizada. Sem
    // normalizar aqui dentro, uma ponta compararia cru e a outra não — e a
    // exclusão simplesmente não teria efeito.
    for (const escrito of ["Embu-Guaçu", "EMBU GUACU", "  embu  guaçu  ", "Embu-Guaçu - SP"]) {
      expect(cidadesNoMapa([["embu guacu", 96]], [escrito]).size, escrito).toBe(0);
    }
  });

  it("chave vazia e exclusão vazia não atrapalham", () => {
    const dentro = cidadesNoMapa([["", 500], ["londrina", 800]], ["", null, undefined]);
    expect([...dentro]).toEqual(["londrina"]);
  });
});
