import { describe, expect, it } from "vitest";
import { resolverMunicipio, urlDoZipNoIndice } from "./cnefe-download.service";

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

/**
 * O endereço do zip sai do ÍNDICE do diretório da UF no FTP do IBGE, e o
 * índice já traz o href CODIFICADO: "Marilândia do Sul" aparece como
 * `4114906_MARIL%c3%82NDIA_DO_SUL.zip`. Passar isso por `encodeURI` de novo
 * transformava o `%` em `%25` e dava 404 — toda cidade com "Â" no nome ficava
 * sem cobertura geo, com um warn no log e nada mais (worker de produção,
 * 10/09/2026). O IBGE tira quase todo acento do nome (CAMBE, MARINGA,
 * SAO_PAULO), mas mantém o "Â": 11 cidades no PR, várias em SP.
 *
 * Os hrefs abaixo foram copiados dos índices reais de 41_PR e 35_SP.
 */
describe("urlDoZipNoIndice", () => {
  const DIR_PR = "https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/Censo_Demografico_2022/Arquivos_CNEFE/CSV/Municipio/41_PR";
  const DIR_SP = DIR_PR.replace("41_PR", "35_SP");
  const indice = (...hrefs: string[]) =>
    `<html><body><pre>${hrefs.map(h => `<a href="${h}">${h}</a>`).join("\n")}</pre></body></html>`;

  it("Marilândia do Sul: o href já codificado sai codificado UMA vez", () => {
    const html = indice("4114900_MARIALVA.zip", "4114906_MARIL%c3%82NDIA_DO_SUL.zip", "4115002_MARILENA.zip");
    const url = urlDoZipNoIndice(DIR_PR, html, "4114906");
    expect(url).toBe(`${DIR_PR}/4114906_MARIL%c3%82NDIA_DO_SUL.zip`);
    expect(url).not.toContain("%25");
  });

  it("São Paulo: o IBGE publica sem acento, e o endereço sai como está", () => {
    const html = indice("3550209_SAO_PAULO_DO_POTENGI.zip", "3550308_SAO_PAULO.zip");
    expect(urlDoZipNoIndice(DIR_SP, html, "3550308")).toBe(`${DIR_SP}/3550308_SAO_PAULO.zip`);
  });

  it("cidade sem acento: Londrina", () => {
    const html = indice("4113700_LONDRINA.zip");
    expect(urlDoZipNoIndice(DIR_PR, html, "4113700")).toBe(`${DIR_PR}/4113700_LONDRINA.zip`);
  });

  it("se o IBGE um dia servir o acento cru, ele é codificado uma vez só", () => {
    const html = indice("4114906_MARILÂNDIA_DO_SUL.zip");
    const url = urlDoZipNoIndice(DIR_PR, html, "4114906");
    expect(url).toBe(`${DIR_PR}/4114906_MARIL%C3%82NDIA_DO_SUL.zip`);
    expect(url).not.toContain("%25");
  });

  it("o código casa até o sublinhado — 4114906 não pega 41149060", () => {
    const html = indice("41149060_OUTRA.zip", "4114906_MARIL%c3%82NDIA_DO_SUL.zip");
    expect(urlDoZipNoIndice(DIR_PR, html, "4114906")).toBe(`${DIR_PR}/4114906_MARIL%c3%82NDIA_DO_SUL.zip`);
  });

  it("município fora do índice devolve null — quem chama decide o erro", () => {
    expect(urlDoZipNoIndice(DIR_PR, indice("4113700_LONDRINA.zip"), "4114906")).toBeNull();
  });
});
