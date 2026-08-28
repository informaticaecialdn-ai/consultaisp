/**
 * Cruzamento de domicílio — e o portão de LGPD que ele carrega.
 *
 * Metade destes testes existe para provar uma AUSÊNCIA: que sem coincidência
 * com o endereço de instalação, nenhum logradouro e nenhum nome de terceiro
 * saem do servidor. É o tipo de regressão que passa despercebida, porque a tela
 * continua bonita quando o servidor manda dado demais.
 */
import { describe, it, expect } from "vitest";
import { cruzarDomicilio, lerEnderecosRelacionados, mascararDocumento } from "./bigdata-domicilio";

/** Forma real do bloco, reduzida. `Type` embute o CPF, como a API devolve. */
const enderecos = {
  RelatedPeopleAddresses: [
    {
      RelationshipType: "SPOUSE", Typology: "AV",
      AddressMain: "TIRADENTES", Number: "1435", Complement: "",
      Neighborhood: "CENTRO", ZipCode: "86020000", City: "LONDRINA", State: "PR",
      Type: "RELATED - 77115210900 - SPOUSE - HOME",
      HouseholdCode: "69924E5BDAF8482F5",
    },
    {
      RelationshipType: "BROTHER", Typology: "R",
      AddressMain: "DAS FLORES", Number: "12",
      Neighborhood: "JARDIM NOVO", ZipCode: "83430000", City: "QUATRO BARRAS", State: "PR",
      Type: "RELATED - 08272801906 - BROTHER - HOME",
      HouseholdCode: "E080A1785E16",
    },
  ],
};

const relacionados = {
  RelatedPeople: {
    PersonalRelationships: [
      { RelatedEntityTaxIdNumber: "77115210900", RelatedEntityName: "MARIA DA SILVA", RelationshipType: "SPOUSE" },
      { RelatedEntityTaxIdNumber: "08272801906", RelatedEntityName: "JOAO DA SILVA", RelationshipType: "BROTHER" },
    ],
  },
};

/** O imóvel do cônjuge, escrito como o operador digitaria — não como a API. */
const instalacaoQueBate = {
  address: "Av. Tiradentes", addressNumber: "1435",
  city: "Londrina", state: "PR",
};

describe("cruzarDomicilio · o portão de LGPD", () => {
  it("sem endereço de instalação, devolve contagem e nada mais", () => {
    const c = cruzarDomicilio(enderecos, relacionados, null);
    expect(c.cruzou).toBe(false);
    expect(c.totalComEndereco).toBe(2);
    expect(c.coincidencias).toEqual([]);
    // O que não pode vazar: nenhum logradouro em lugar nenhum do retorno.
    expect(JSON.stringify(c)).not.toMatch(/TIRADENTES|FLORES/i);
    expect(JSON.stringify(c)).not.toMatch(/MARIA|JOAO/i);
  });

  it("com endereço que NÃO bate, continua sem revelar terceiro", () => {
    const c = cruzarDomicilio(enderecos, relacionados, {
      address: "Rua Inexistente", addressNumber: "99", city: "Londrina", state: "PR",
    });
    expect(c.cruzou).toBe(true);
    expect(c.bateComInstalacao).toBe(false);
    expect(c.coincidencias).toEqual([]);
    expect(JSON.stringify(c)).not.toMatch(/TIRADENTES|MARIA/i);
  });

  it("a coincidência é o que abre o dado — e só o que coincidiu", () => {
    const c = cruzarDomicilio(enderecos, relacionados, instalacaoQueBate);
    expect(c.bateComInstalacao).toBe(true);
    expect(c.coincidencias).toHaveLength(1);

    const [x] = c.coincidencias;
    expect(x.vinculo).toBe("SPOUSE");
    expect(x.nome).toBe("MARIA DA SILVA");
    expect(x.logradouro).toBe("AV TIRADENTES");

    // O irmão, que mora noutro imóvel, segue fechado.
    expect(JSON.stringify(c)).not.toMatch(/FLORES|JOAO/i);
  });

  it("o CPF do parente nunca sai inteiro, nem na coincidência", () => {
    const c = cruzarDomicilio(enderecos, relacionados, instalacaoQueBate);
    expect(c.coincidencias[0].documentoMascarado).toBe("771.***.***-00");
    expect(JSON.stringify(c)).not.toContain("77115210900");
  });
});

describe("cruzarDomicilio · identidade do imóvel", () => {
  it("casa apesar de abreviação, caixa e pontuação diferentes", () => {
    // "Av. Tiradentes" do operador contra "AVENIDA TIRADENTES" da API.
    expect(cruzarDomicilio(enderecos, relacionados, instalacaoQueBate).bateComInstalacao).toBe(true);
  });

  it("número diferente é outro imóvel", () => {
    const c = cruzarDomicilio(enderecos, relacionados, {
      ...instalacaoQueBate, addressNumber: "1437",
    });
    expect(c.bateComInstalacao).toBe(false);
  });

  it("cidade diferente é outro imóvel, mesmo com rua e número iguais", () => {
    const c = cruzarDomicilio(enderecos, relacionados, {
      ...instalacaoQueBate, city: "Maringá",
    });
    expect(c.bateComInstalacao).toBe(false);
  });

  it("ausência de bairro no lado do operador não separa", () => {
    // Cadastro incompleto é comum; separar por isso esconderia a coincidência,
    // que é o pior erro possível aqui.
    const c = cruzarDomicilio(enderecos, relacionados, instalacaoQueBate);
    expect(c.bateComInstalacao).toBe(true);
  });

  it("bairro declarado e divergente separa", () => {
    const c = cruzarDomicilio(enderecos, relacionados, {
      ...instalacaoQueBate, neighborhood: "Jardim Bandeirantes",
    });
    expect(c.bateComInstalacao).toBe(false);
  });

  it("endereço de instalação sem número não cruza — não inventa", () => {
    const c = cruzarDomicilio(enderecos, relacionados, {
      address: "Av. Tiradentes", city: "Londrina", state: "PR",
    });
    expect(c.cruzou).toBe(false);
    expect(c.coincidencias).toEqual([]);
  });
});

describe("cruzarDomicilio · contagens", () => {
  it("conta os domicílios distintos pelo HouseholdCode", () => {
    expect(cruzarDomicilio(enderecos, relacionados, null).domiciliosDistintos).toBe(2);
  });

  it("conta quantos relacionados estão na cidade da instalação", () => {
    const c = cruzarDomicilio(enderecos, relacionados, instalacaoQueBate);
    expect(c.naMesmaCidade).toBe(1);
  });

  it("bloco ausente devolve zeros, não quebra", () => {
    const c = cruzarDomicilio(undefined, undefined, instalacaoQueBate);
    expect(c.totalComEndereco).toBe(0);
    expect(c.bateComInstalacao).toBe(false);
    expect(c.cruzou).toBe(true);
  });
});

describe("leitura do bloco", () => {
  it("aceita o array cru e o envelope nomeado", () => {
    expect(lerEnderecosRelacionados(enderecos)).toHaveLength(2);
    expect(lerEnderecosRelacionados(enderecos.RelatedPeopleAddresses)).toHaveLength(2);
    expect(lerEnderecosRelacionados(null)).toEqual([]);
  });

  it("extrai o CPF que a API embute no campo Type", () => {
    const [a] = lerEnderecosRelacionados(enderecos);
    expect(a.documento).toBe("77115210900");
  });

  it("sem vínculo declarado, cai em RELATED em vez de string vazia", () => {
    const [a] = lerEnderecosRelacionados([{ AddressMain: "RUA X", Number: "1", City: "LONDRINA" }]);
    expect(a.vinculo).toBe("RELATED");
  });
});

describe("mascararDocumento", () => {
  it("mostra as pontas e esconde o meio", () => {
    expect(mascararDocumento("12345678901")).toBe("123.***.***-01");
  });

  it("documento fora do formato não vira máscara enganosa", () => {
    expect(mascararDocumento("123")).toBeUndefined();
    expect(mascararDocumento(undefined)).toBeUndefined();
  });
});

describe("composição do logradouro · o tipo vem em campo separado", () => {
  // A BigData devolve Typology "R" com AddressMain "JANDAIA"; o ViaCEP e o
  // operador escrevem "Rua Jandaia". Sem recompor, nunca casam.
  const comTypology = [{
    RelationshipType: "SPOUSE", Typology: "R", AddressMain: "JANDAIA",
    Number: "303", Neighborhood: "JARDIM ALVORADA", City: "LONDRINA", State: "PR",
    ZipCode: "86060380", Type: "RELATED - 77115210900 - SPOUSE - HOME",
  }];
  const instalacao = {
    address: "Rua Jandaia", addressNumber: "303",
    neighborhood: "Jardim Alvorada", city: "Londrina", state: "PR",
  };

  it("casa o endereço da API com o que o ViaCEP devolve", () => {
    const c = cruzarDomicilio(comTypology, {}, instalacao);
    expect(c.bateComInstalacao).toBe(true);
  });

  it("aceita a abreviação de avenida", () => {
    const c = cruzarDomicilio(
      [{ ...comTypology[0], Typology: "AV", AddressMain: "TIRADENTES" }], {},
      { ...instalacao, address: "Avenida Tiradentes" },
    );
    expect(c.bateComInstalacao).toBe(true);
  });

  it("não duplica o tipo quando o nome já o traz", () => {
    const [a] = lerEnderecosRelacionados([{ Typology: "RUA", AddressMain: "RUA JANDAIA" }]);
    expect(a.logradouro).toBe("RUA JANDAIA");
  });

  it("sem Typology, usa o nome como veio", () => {
    const [a] = lerEnderecosRelacionados([{ AddressMain: "JANDAIA" }]);
    expect(a.logradouro).toBe("JANDAIA");
  });

  it("tipo diferente é rua diferente — não casa avenida com rua", () => {
    const c = cruzarDomicilio(
      [{ ...comTypology[0], Typology: "AV" }], {},
      { ...instalacao, address: "Rua Jandaia" },
    );
    expect(c.bateComInstalacao).toBe(false);
  });
});
