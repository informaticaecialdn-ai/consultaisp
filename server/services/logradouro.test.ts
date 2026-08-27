import { describe, expect, it } from "vitest";
import { chaveLogradouro, numeroDoEndereco, separarLogradouroENumero } from "./logradouro";

/**
 * Esta normalização é o que faz o endereço do ERP encontrar o do IBGE. Quando
 * ela erra, o cliente não some nem dá erro: ele cai no fallback de bairro ou de
 * cidade e aparece no mapa a quilômetros de onde mora. É o defeito mais caro do
 * módulo justamente por ser silencioso.
 */

describe("chaveLogradouro — o ERP e o censo na mesma régua", () => {
  it("expande o tipo abreviado, que é como o ERP escreve", () => {
    expect(chaveLogradouro("R. Dezenove de Dezembro")).toBe("RUA DEZENOVE DE DEZEMBRO");
    expect(chaveLogradouro("Av Brasil")).toBe("AVENIDA BRASIL");
    expect(chaveLogradouro("Trav. das Flores")).toBe("TRAVESSA DAS FLORES");
    expect(chaveLogradouro("Pça da Sé")).toBe("PRACA DA SE");
  });

  it("expande honorífico em qualquer posição", () => {
    expect(chaveLogradouro("Rua Dr. Souza")).toBe("RUA DOUTOR SOUZA");
    expect(chaveLogradouro("Av. Prof Faria")).toBe("AVENIDA PROFESSOR FARIA");
    expect(chaveLogradouro("R Sta Rita")).toBe("RUA SANTA RITA");
  });

  it("o tipo só é expandido no PRIMEIRO token", () => {
    // "PRACA" no meio é nome de rua, não tipo — expandir criaria outra rua.
    expect(chaveLogradouro("Rua Praca Velha")).toBe("RUA PRACA VELHA");
    expect(chaveLogradouro("Avenida Rua Nova")).toBe("AVENIDA RUA NOVA");
  });

  it("tira acento, caixa e pontuação", () => {
    expect(chaveLogradouro("rua joão pessoa")).toBe("RUA JOAO PESSOA");
    expect(chaveLogradouro("RUA  JOÃO   PESSOA")).toBe("RUA JOAO PESSOA");
    expect(chaveLogradouro("Rua João-Pessoa")).toBe("RUA JOAO PESSOA");
  });

  it("vazio não vira chave", () => {
    expect(chaveLogradouro("")).toBe("");
    expect(chaveLogradouro(null)).toBe("");
    expect(chaveLogradouro("   ")).toBe("");
  });
});

describe("numeroDoEndereco", () => {
  it("lê o número e descarta o resto", () => {
    expect(numeroDoEndereco("1234")).toBe(1234);
    expect(numeroDoEndereco("1234-A")).toBe(1234);
    expect(numeroDoEndereco(" 0042 ")).toBe(42);
  });

  it("zero e vazio são 'sem número', não o número zero", () => {
    // No ERP o "0" é o que se digita quando não se sabe.
    expect(numeroDoEndereco("0")).toBeNull();
    expect(numeroDoEndereco("000")).toBeNull();
    expect(numeroDoEndereco("")).toBeNull();
    expect(numeroDoEndereco("S/N")).toBeNull();
    expect(numeroDoEndereco(null)).toBeNull();
  });
});

describe("separarLogradouroENumero — o número que vem grudado", () => {
  it("separa 'Rua X, 1234'", () => {
    expect(separarLogradouroENumero("Rua Brasil, 1234")).toEqual({ logradouro: "RUA BRASIL", numero: 1234 });
  });

  it("separa sem vírgula", () => {
    expect(separarLogradouroENumero("Rua Brasil 1234")).toEqual({ logradouro: "RUA BRASIL", numero: 1234 });
  });

  it("ignora o complemento depois do número", () => {
    expect(separarLogradouroENumero("Rua Brasil, 1234 - apto 12"))
      .toEqual({ logradouro: "RUA BRASIL", numero: 1234 });
  });

  it("o campo próprio de número manda sobre o que está no texto", () => {
    expect(separarLogradouroENumero("Rua Brasil, 1234", "5678"))
      .toEqual({ logradouro: "RUA BRASIL", numero: 5678 });
  });

  it("rua sem número fica sem número — não inventa zero", () => {
    expect(separarLogradouroENumero("Rua Brasil")).toEqual({ logradouro: "RUA BRASIL", numero: null });
  });

  it("rua cujo nome termina em número não perde o nome", () => {
    // "Rua 25 de Março" tem número no meio; o final é que conta.
    expect(separarLogradouroENumero("Rua 25 de Março, 100"))
      .toEqual({ logradouro: "RUA 25 DE MARCO", numero: 100 });
  });

  it("endereço vazio com número no campo próprio devolve só o número", () => {
    expect(separarLogradouroENumero("", "500")).toEqual({ logradouro: "", numero: 500 });
    expect(separarLogradouroENumero(null, null)).toEqual({ logradouro: "", numero: null });
  });
});
