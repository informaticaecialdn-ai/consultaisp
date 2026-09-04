import { describe, it, expect } from "vitest";
import { canonizarCidadeDoCadastro } from "./cidade-canonica.service";

/**
 * As grafias abaixo são as MEDIDAS na carteira da Amplinet (provedor 6) em
 * 04/09/2026, quando 184 clientes estavam fora do mapa. Não são exemplos
 * inventados: cada uma existe no cadastro do ERP dele.
 */

describe("canonizarCidadeDoCadastro", () => {
  it("as grafias da mesma cidade viram o nome oficial", () => {
    // As grafias que a tela de Localização mostrava como filtros diferentes,
    // uma ao lado da outra, para a mesma cidade.
    for (const grafia of [
      "EMBU-GUAÇU", "EMBU GUACU", "EMBUGUAÇU", "embu-guacu",
      "EMBU  GUAÇU", "EMBU-GUACU,", "Embu Guaçu",
    ]) {
      const r = canonizarCidadeDoCadastro(grafia, "SP");
      expect(r.city, grafia).toBe("Embu-Guaçu");
      expect(r.state).toBe("SP");
      expect(r.municipio?.ibge).toBe("3515103");
    }
  });

  it("a UF minúscula do cadastro sai como sigla", () => {
    expect(canonizarCidadeDoCadastro("sao paulo", "sp")).toMatchObject({
      city: "São Paulo", state: "SP",
    });
  });

  it("nome parecido NÃO vira município: semelhança não grava", () => {
    /*
     * A canonização herdava a expansão por prefixo do resolvedor, que existe
     * para escolher qual base do IBGE baixar — lá o pior caso é um download
     * desperdiçado. Aqui ela decidia o que gravar em `customers.city`, sem
     * caminho de volta, e o plotador levava o cliente para a cidade inventada.
     * São 2.763 expansões distintas no país; estas cinco são as mais cruéis, e
     * o cadastro medido da Amplinet já tinha truncamento ("ITAP DA SERRA").
     */
    for (const [cidade, uf, oQueViraria] of [
      ["CAMPINA", "SP", "Campina do Monte Alegre"],
      ["AGUA", "BA", "Água Fria"],
      ["ABREU", "PE", "Abreu e Lima"],
      ["JANDAIA", "PR", "Jandaia do Sul"],
      ["SANTA BARBARA", "SP", "Santa Bárbara d'Oeste"],
    ] as const) {
      const r = canonizarCidadeDoCadastro(cidade, uf);
      expect(r.city, `${cidade} viraria ${oQueViraria}`).toBe(cidade);
      expect(r.municipio, cidade).toBeNull();
    }
  });

  it("o que não é cidade nenhuma passa intacto", () => {
    // Erro de digitação e bairro no campo de cidade. Adivinhar por semelhança
    // plantaria o cliente na cidade errada sem ninguém desconfiar.
    for (const lixo of ["EMBU GAUCU", "SÃO PAUYLO", "ITAP DA SERRA", "PARQUE JANDAIA"]) {
      const r = canonizarCidadeDoCadastro(lixo, "SP");
      expect(r.city, lixo).toBe(lixo);
      expect(r.state).toBe("SP");
      expect(r.municipio).toBeNull();
      expect(r.motivo).toBe("nao_encontrada");
    }
  });

  it("UF que contradiz a cidade é obedecida, não corrigida", () => {
    // Quatro cadastros de uma carteira toda de SP dizem RN, SE e SC. Uma linha
    // sozinha não tem a maioria que a medição da carteira enxerga, então ela
    // passa intacta e a correção é pedida ao provedor.
    for (const uf of ["RN", "SE", "SC"]) {
      const r = canonizarCidadeDoCadastro("ITAPECERICA DA SERRA", uf);
      expect(r.city, uf).toBe("ITAPECERICA DA SERRA");
      expect(r.state).toBe(uf);
      expect(r.municipio).toBeNull();
      // E o relatório manda olhar o campo CERTO: o nome está escrito
      // perfeitamente, quem não bate é o estado. Antes isto saía como
      // "erro de digitação ou bairro no campo de cidade".
      expect(r.motivo, uf).toBe("uf_nao_bate");
      expect(r.candidato).toMatchObject({ nome: "Itapecerica da Serra", uf: "SP" });
    }
  });

  it("nome escrito pela metade não vira “estado errado”", () => {
    // "ITAPECERICA"/SP é prefixo de Itapecerica da Serra, que existe em SP: o
    // estado está certo e o nome é que está truncado. Apontar "Itapecerica/MG"
    // como candidato mandaria o provedor mudar o cliente de estado.
    for (const [cidade, uf] of [["ITAPECERICA", "SP"], ["JANDAIA", "PR"], ["CAMPINA", "SP"]] as const) {
      const r = canonizarCidadeDoCadastro(cidade, uf);
      expect(r.motivo, cidade).toBe("nao_encontrada");
      expect(r.candidato, cidade).toBeNull();
    }
  });

  it("a sigla escrita junto do nome supre o campo de estado vazio", () => {
    expect(canonizarCidadeDoCadastro("ITAPECERICA DA SERRA SP", null)).toMatchObject({
      city: "Itapecerica da Serra", state: "SP",
    });
    expect(canonizarCidadeDoCadastro("STRING:SAO PAULO/SP", "")).toMatchObject({
      city: "São Paulo", state: "SP",
    });
  });

  it("a sigla do nome NÃO derruba um estado que o ERP preencheu", () => {
    /*
     * Este era o buraco: com `porCampo ?? porNome`, um cadastro que dizia RJ no
     * campo de estado e "MS" grudado no nome era gravado em MS — o RJ do ERP
     * desaparecia sem ninguém pedir. A promessa do arquivo é "nunca troca uma
     * UF do ERP por outra", e ela só é verdadeira com este caso recusado.
     */
    for (const [cidade, uf] of [
      ["CAMPO GRANDE MS", "RJ"],
      ["SAO PAULO SP", "MG"],
      ["ITAPECERICA DA SERRA SP", "RN"],
    ] as const) {
      const r = canonizarCidadeDoCadastro(cidade, uf);
      expect(r.city, cidade).toBe(cidade);
      expect(r.state, cidade).toBe(uf);
      expect(r.motivo, cidade).toBe("uf_em_conflito");
    }
  });

  it("nome inteiro sem a UF do campo aponta o município e pede o estado", () => {
    // "SENTO SE" sem campo de estado: a sigla lida do nome é SE, e não há Sento
    // Sé em Sergipe. O nome está certo — falta dizer que é BA.
    const r = canonizarCidadeDoCadastro("SENTO SE", null);
    expect(r.municipio).toBeNull();
    expect(r.motivo).toBe("uf_nao_bate");
    expect(r.candidato).toMatchObject({ nome: "Sento Sé", uf: "BA" });
  });

  it("nada é canonizado quando as duas leituras dão municípios diferentes", () => {
    // Há um Bom Jesus em SC e outro no PI. Canonizar mudaria o cliente de
    // estado por causa de qual campo o código leu primeiro.
    const r = canonizarCidadeDoCadastro("BOM JESUS SC", "PI");
    expect(r.city).toBe("BOM JESUS SC");
    expect(r.state).toBe("PI");
    expect(r.motivo).toBe("uf_em_conflito");
  });

  it("nome legítimo terminado em sigla de UF continua sendo canonizado", () => {
    // "Sento Sé"/BA termina em SE, que é UF de verdade. O conflito é entre
    // MUNICÍPIOS, e a leitura pela SE não resolve nada — então a BA vale.
    expect(canonizarCidadeDoCadastro("SENTO SE", "BA")).toMatchObject({
      city: "Sento Sé", state: "BA",
    });
    // E os outros nove municípios que terminam em palavra de duas letras não
    // podem ser mutilados pela limpeza do nome.
    expect(canonizarCidadeDoCadastro("SANTA FE", "PR")).toMatchObject({ city: "Santa Fé" });
    expect(canonizarCidadeDoCadastro("PEDRO II", "PI")).toMatchObject({ city: "Pedro II" });
    expect(canonizarCidadeDoCadastro("XANGRI-LA", "RS")).toMatchObject({ city: "Xangri-lá" });
  });

  it("sem UF nenhuma não se resolve, e o motivo diz isso", () => {
    // "ITAPECERICA" é nome único no país (Itapecerica/MG), e casar por ele
    // plotaria a 500 km da casa do cliente de Itapecerica DA SERRA/SP.
    const r = canonizarCidadeDoCadastro("ITAPECERICA", null);
    expect(r.city).toBe("ITAPECERICA");
    expect(r.municipio).toBeNull();
    expect(r.motivo).toBe("sem_uf");
  });

  it("UF que não é sigla nenhuma não vira UF", () => {
    // "São Paulo" no campo de estado não resolve; e como não há sigla no nome,
    // a linha passa intacta em vez de ser adivinhada.
    const r = canonizarCidadeDoCadastro("EMBU-GUAÇU", "São Paulo");
    expect(r.city).toBe("EMBU-GUAÇU");
    expect(r.state).toBe("São Paulo");
    expect(r.motivo).toBe("sem_uf");
  });

  it("campo vazio não vira cidade", () => {
    expect(canonizarCidadeDoCadastro(null, "SP")).toMatchObject({ city: null, motivo: "sem_cidade" });
    expect(canonizarCidadeDoCadastro("   ", "SP")).toMatchObject({ city: null, motivo: "sem_cidade" });
  });
});
