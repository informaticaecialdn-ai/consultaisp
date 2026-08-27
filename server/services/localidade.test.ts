import { describe, expect, it } from "vitest";
import {
  normalizarLocalidade, nucleoLocalidade, levenshtein, criarAgrupadorDeBairro,
} from "./localidade";

/**
 * O ranking de bairros só descreve a realidade se as variações do mesmo nome
 * caírem na mesma linha. "Jd. Bandeirantes" e "JARDIM BANDEIRANTES" separados
 * dão dois bairros com metade da carteira cada — e um deles aparece com 100%
 * de inadimplência porque ficou com um único cliente.
 */

describe("normalizarLocalidade", () => {
  it("tira acento, pontuação e caixa", () => {
    expect(normalizarLocalidade("Jardim Bandeirantes")).toBe("JARDIM BANDEIRANTES");
    expect(normalizarLocalidade("Ibiporã")).toBe("IBIPORA");
    expect(normalizarLocalidade("Vila São João")).toBe("VILA SAO JOAO");
  });

  it("colapsa espaço e ponto em separador", () => {
    expect(normalizarLocalidade("Jd.  Bandeirantes")).toBe("JD BANDEIRANTES");
    expect(normalizarLocalidade("  Centro  ")).toBe("CENTRO");
  });

  it("nulo e vazio viram string vazia, não quebram", () => {
    expect(normalizarLocalidade(null)).toBe("");
    expect(normalizarLocalidade(undefined)).toBe("");
    expect(normalizarLocalidade("   ")).toBe("");
  });
});

describe("nucleoLocalidade", () => {
  it("descasca prefixo de loteamento, inclusive composto", () => {
    expect(nucleoLocalidade("JARDIM BANDEIRANTES")).toBe("BANDEIRANTES");
    expect(nucleoLocalidade("CONJUNTO HABITACIONAL SANTIAGO II")).toBe("SANTIAGO II");
    expect(nucleoLocalidade("VILA NOVA")).toBe("NOVA");
  });

  it("descasca em cadeia", () => {
    expect(nucleoLocalidade("JARDIM RESIDENCIAL PARQUE DAS FLORES")).toBe("DAS FLORES");
  });

  it("nome sem prefixo fica intacto", () => {
    expect(nucleoLocalidade("CENTRO")).toBe("CENTRO");
    expect(nucleoLocalidade("ANTONIO FREDERICO")).toBe("ANTONIO FREDERICO");
  });
});

describe("levenshtein", () => {
  it("mede diferença pequena e desiste de diferença grande", () => {
    expect(levenshtein("BANDEIRANTES", "BANDEIRANTE")).toBe(1);
    expect(levenshtein("CENTRO", "CENTRO")).toBe(0);
    expect(levenshtein("CENTRO", "JARDIMDASFLORES")).toBe(99);
  });
});

describe("agrupador — o caso que motivou o módulo", () => {
  it("junta as três grafias do mesmo bairro numa linha só", () => {
    const a = criarAgrupadorDeBairro();
    const primeiro = a.agrupar("Jardim Bandeirantes");
    const segundo = a.agrupar("JARDIM BANDEIRANTES");
    const terceiro = a.agrupar("Jd. Bandeirantes");

    expect(segundo!.chave).toBe(primeiro!.chave);
    expect(terceiro!.chave).toBe(primeiro!.chave);
    // O rótulo exibido é o primeiro nome visto, não a chave em caixa alta.
    expect(terceiro!.rotulo).toBe("Jardim Bandeirantes");
  });

  it("prefixo de loteamento diferente, mesmo bairro", () => {
    const a = criarAgrupadorDeBairro();
    const x = a.agrupar("Conjunto Habitacional Santiago II");
    const y = a.agrupar("Santiago II");
    expect(y!.chave).toBe(x!.chave);
    expect(y!.tier).toBe("nucleo");
  });

  it("erro de digitação cai no mesmo grupo", () => {
    const a = criarAgrupadorDeBairro();
    const x = a.agrupar("Bandeirantes");
    const y = a.agrupar("Bandeirante");
    expect(y!.chave).toBe(x!.chave);
    expect(y!.tier).toBe("fuzzy");
  });

  it("bairros de verdade diferentes NÃO se misturam", () => {
    const a = criarAgrupadorDeBairro();
    const centro = a.agrupar("Centro");
    const universidade = a.agrupar("Universidade");
    const aurora = a.agrupar("Aurora");
    expect(new Set([centro!.chave, universidade!.chave, aurora!.chave]).size).toBe(3);
  });

  it("nomes curtos não se atraem por contenção", () => {
    const a = criarAgrupadorDeBairro();
    const sul = a.agrupar("Jardim Sul");
    const azul = a.agrupar("Jardim Azul");
    // SUL e AZUL têm distância 2 — o caso limite. O que não pode acontecer é
    // "SUL" ser engolido por qualquer nome longo que o contenha.
    const paulista = a.agrupar("Jardim Paulista");
    expect(paulista!.chave).not.toBe(sul!.chave);
    expect(paulista!.chave).not.toBe(azul!.chave);
  });

  it("bairro vazio não vira grupo", () => {
    const a = criarAgrupadorDeBairro();
    expect(a.agrupar("")).toBeNull();
    expect(a.agrupar(null)).toBeNull();
    expect(a.agrupar("  ")).toBeNull();
  });
});
