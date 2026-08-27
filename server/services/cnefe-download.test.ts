import { describe, expect, it } from "vitest";
import { resolverMunicipio } from "./cnefe-download.service";

/**
 * A resolução do município é o primeiro passo da carga, e é onde o operador
 * digita. Errar aqui carrega a base do município errado — e ninguém percebe,
 * porque o mapa continua desenhando: só que num lugar onde o provedor não
 * atende.
 */

describe("resolverMunicipio", () => {
  it("aceita o nome como o operador digita", () => {
    expect(resolverMunicipio("Londrina")).toMatchObject({ ibge: "4113700", uf: "PR" });
    expect(resolverMunicipio("londrina")).toMatchObject({ ibge: "4113700" });
    expect(resolverMunicipio("  Londrina  ")).toMatchObject({ ibge: "4113700" });
  });

  it("aceita com e sem acento", () => {
    expect(resolverMunicipio("Cambé")).toMatchObject({ ibge: "4103701" });
    expect(resolverMunicipio("Cambe")).toMatchObject({ ibge: "4103701" });
    expect(resolverMunicipio("Ibiporã")).toMatchObject({ ibge: "4109807" });
  });

  it("aceita o sufixo de UF que a área atendida usa", () => {
    expect(resolverMunicipio("Ibiporã - PR")).toMatchObject({ ibge: "4109807" });
    expect(resolverMunicipio("Londrina/PR")).toMatchObject({ ibge: "4113700" });
  });

  it("aceita o código IBGE direto", () => {
    expect(resolverMunicipio("4113700")).toMatchObject({ nome: "Londrina" });
  });

  it("cidade homônima exige UF em vez de escolher uma por conta própria", () => {
    // "Bom Jesus" existe em cinco estados. Escolher a primeira carregaria a
    // base de um município a mil quilômetros do provedor, sem erro nenhum.
    expect(() => resolverMunicipio("Bom Jesus")).toThrow(/informe a UF|c[óo]digo IBGE/i);
    expect(resolverMunicipio("Bom Jesus - SC")).toMatchObject({ uf: "SC" });
  });

  it("cidade inexistente devolve null, não um palpite", () => {
    expect(resolverMunicipio("Cidade Que Nao Existe")).toBeNull();
    expect(resolverMunicipio("9999999")).toBeNull();
  });

  it("a UF errada para uma cidade real também não casa", () => {
    expect(resolverMunicipio("Londrina - SP")).toBeNull();
  });
});
