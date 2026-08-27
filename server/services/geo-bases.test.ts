import { describe, expect, it } from "vitest";
import { agregarCnefe, agregarAneel } from "./geo-bases.service";

/**
 * Parsers de dois formatos que não são nossos e não avisam quando mudam.
 *
 * O erro que mais importa travar aqui é o de contagem: se o filtro de espécie
 * deixar passar comércio, a contagem de domicílios sobe, o denominador da
 * penetração incha e todo bairro parece mal atendido. O número certo é
 * silenciosamente diferente do errado — só um teste separa os dois.
 */

const CAB_CNEFE = "COD_UNICO_ENDERECO;COD_UF;COD_MUNICIPIO;CEP;DSC_LOCALIDADE;LATITUDE;LONGITUDE;COD_ESPECIE";
const linhaCnefe = (localidade: string, especie: string, municipio = "4109807") =>
  `1;41;${municipio};86200000;${localidade};-23.27;-51.04;${especie}`;

describe("CNEFE — só domicílio conta como HP", () => {
  it("espécie 1 e 2 entram; o resto fica de fora", () => {
    const { porBairro } = agregarCnefe([
      CAB_CNEFE,
      linhaCnefe("CENTRO", "1"),   // domicílio particular
      linhaCnefe("CENTRO", "2"),   // domicílio coletivo
      linhaCnefe("CENTRO", "6"),   // estabelecimento comercial
      linhaCnefe("CENTRO", "7"),   // equipamento público
    ].join("\n"));

    expect(porBairro.get("CENTRO")).toBe(2);
  });

  it("agrupa as grafias do mesmo bairro numa contagem só", () => {
    const { porBairro } = agregarCnefe([
      CAB_CNEFE,
      linhaCnefe("Jardim Bandeirantes", "1"),
      linhaCnefe("JARDIM BANDEIRANTES", "1"),
      linhaCnefe("jardim  bandeirantes", "1"),
    ].join("\n"));

    expect(porBairro.get("JARDIM BANDEIRANTES")).toBe(3);
    expect(porBairro.size).toBe(1);
  });

  it("tira o código do município da própria linha", () => {
    const { municipioIbge } = agregarCnefe([CAB_CNEFE, linhaCnefe("CENTRO", "1", "4113700")].join("\n"));
    expect(municipioIbge).toBe("4113700");
  });

  it("endereço sem localidade não vira bairro vazio", () => {
    const { porBairro } = agregarCnefe([
      CAB_CNEFE,
      linhaCnefe("", "1"),
      linhaCnefe("   ", "1"),
      linhaCnefe("CENTRO", "1"),
    ].join("\n"));
    expect(porBairro.size).toBe(1);
    expect(porBairro.has("")).toBe(false);
  });

  it("arquivo sem nenhum domicílio é erro, não zero silencioso", () => {
    expect(() => agregarCnefe([CAB_CNEFE, linhaCnefe("CENTRO", "6")].join("\n")))
      .toThrow(/nenhum domic/i);
  });

  it("cabeçalho fora do esperado é erro explícito", () => {
    expect(() => agregarCnefe("A;B;C\n1;2;3")).toThrow(/COD_MUNICIPIO/);
  });

  it("aceita CRLF — o arquivo do IBGE vem do Windows", () => {
    const { porBairro } = agregarCnefe(`${CAB_CNEFE}\r\n${linhaCnefe("CENTRO", "1")}\r\n`);
    expect(porBairro.get("CENTRO")).toBe(1);
  });
});

describe("ANEEL — UCs vivas por bairro", () => {
  const CAB = "mun;bairro;uc_re_ativas";

  it("separa por município e soma por bairro", () => {
    const m = agregarAneel([
      CAB,
      "4109807;CENTRO;4231",
      "4109807;SAN RAFAEL;1141",
      "4113700;CENTRO;9000",
    ].join("\n"));

    expect(m.get("4109807")!.get("CENTRO")).toBe(4231);
    expect(m.get("4109807")!.get("SAN RAFAEL")).toBe(1141);
    expect(m.get("4113700")!.get("CENTRO")).toBe(9000);
  });

  it("linhas repetidas do mesmo bairro somam — a base vem por transformador", () => {
    const m = agregarAneel([CAB, "4109807;CENTRO;100", "4109807;Centro;50"].join("\n"));
    expect(m.get("4109807")!.get("CENTRO")).toBe(150);
  });

  it("linha sem número utilizável é descartada, não vira zero", () => {
    const m = agregarAneel([CAB, "4109807;CENTRO;", "4109807;CENTRO;x", "4109807;CENTRO;7"].join("\n"));
    expect(m.get("4109807")!.get("CENTRO")).toBe(7);
  });

  it("cabeçalho fora do esperado é erro explícito", () => {
    expect(() => agregarAneel("a;b;c\n1;2;3")).toThrow(/mun/);
  });
});
