import { describe, expect, it } from "vitest";
import {
  dataDeAbertura,
  SEGMENTOS,
  site,
  siteComEsquemaAceito,
  TIPOS_SOCIETARIOS,
  umaDasOpcoes,
} from "./cadastro-regras";

/**
 * A regua do cadastro, testada onde ela mora.
 *
 * Estas mesmas regras sao exercitadas pelas duas rotas
 * (`server/routes/provider-perfil.test.ts` e `server/routes/admin.routes.test.ts`),
 * e e de proposito: la se prova que a ficha CHAMA a regra e que o cadastro
 * legado nao tranca ninguem; aqui se prova o julgamento em si, valor a valor,
 * sem servidor no meio.
 */

describe("umaDasOpcoes", () => {
  const tipo = umaDasOpcoes(TIPOS_SOCIETARIOS, "O tipo societário");

  it("aceita uma das opcoes", () => {
    expect(tipo("LTDA")).toEqual({ ok: true, valor: "LTDA" });
  });

  // Apagar um campo opcional e escolha valida; quem decide se o campo pode ficar
  // vazio e a ficha, nao a regra de formato.
  it("aceita null", () => {
    expect(tipo(null)).toEqual({ ok: true, valor: null });
  });

  // O valor que mais aparece na coluna: a natureza juridica crua da Receita,
  // com o codigo do IBGE na frente.
  it("recusa a natureza juridica crua da Receita, enumerando o que vale", () => {
    const veredito = tipo("206-2 - Sociedade Empresaria Limitada");

    expect(veredito.ok).toBe(false);
    expect(veredito.ok === false && veredito.frase).toMatch(/LTDA/);
    expect(veredito.ok === false && veredito.frase).toMatch(/tipo societário/);
  });

  it("a lista de segmentos tem a mesma disciplina", () => {
    const segmento = umaDasOpcoes(SEGMENTOS, "O segmento de atuação");

    expect(segmento("ISP / Provedor de Internet").ok).toBe(true);
    // O CNAE por extenso, que o import do CNPJ traz.
    expect(segmento("Serviços de comunicação multimídia").ok).toBe(false);
  });

  // Caixa e espaco nao sao "quase igual": o valor vai para uma coluna que a tela
  // le de volta num `<select>` de comparacao exata.
  it("nao normaliza caixa nem espaco", () => {
    expect(tipo("ltda").ok).toBe(false);
    expect(tipo(" LTDA").ok).toBe(false);
  });
});

describe("dataDeAbertura", () => {
  it("aceita ISO", () => {
    expect(dataDeAbertura("2014-03-21")).toEqual({ ok: true, valor: "2014-03-21" });
  });

  it("aceita null", () => {
    expect(dataDeAbertura(null)).toEqual({ ok: true, valor: null });
  });

  // O formato que esta gravado em producao, e o motivo de a regra existir.
  it("recusa o formato brasileiro dizendo qual e o formato", () => {
    const veredito = dataDeAbertura("17/05/2017");

    expect(veredito.ok).toBe(false);
    expect(veredito.ok === false && veredito.frase).toMatch(/AAAA-MM-DD/);
  });

  // Casa com o regex e nao existe: o `Date` em UTC transborda para 03/03.
  it("recusa data que casa com o formato mas nao existe no calendario", () => {
    const veredito = dataDeAbertura("2017-02-31");

    expect(veredito.ok).toBe(false);
    expect(veredito.ok === false && veredito.frase).toMatch(/não existe no calendário/);
  });

  it("aceita 29 de fevereiro de ano bissexto e recusa o de ano comum", () => {
    expect(dataDeAbertura("2016-02-29").ok).toBe(true);
    expect(dataDeAbertura("2017-02-29").ok).toBe(false);
  });

  it("recusa ISO com hora junto: a coluna e so-data", () => {
    expect(dataDeAbertura("2014-03-21T00:00:00Z").ok).toBe(false);
  });
});

/**
 * O defeito consertado em 05/09/2026: com o ponto na classe do nome de esquema,
 * `[a-z0-9+.-]*`, o regex lia "meuisp.net.br" como esquema e recusava um
 * endereco com PORTA — e, como o formulario e tudo-ou-nada, o provedor perdia o
 * Salvar dos outros quinze campos junto.
 */
describe("siteComEsquemaAceito", () => {
  it("aceita endereco com porta, que era o que a regra recusava", () => {
    expect(siteComEsquemaAceito("meuisp.net.br:8080")).toBe(true);
    expect(siteComEsquemaAceito("meuisp.net.br:443")).toBe(true);
    expect(siteComEsquemaAceito("www.meuisp.com.br:8080/painel")).toBe(true);
  });

  it("continua barrando o que a regra existe para barrar", () => {
    expect(siteComEsquemaAceito("javascript:alert(1)")).toBe(false);
    // Caixa alta e o disfarce mais barato que existe.
    expect(siteComEsquemaAceito("JavaScript:alert(1)")).toBe(false);
    expect(siteComEsquemaAceito("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(siteComEsquemaAceito("vbscript:msgbox(1)")).toBe(false);
  });

  it("aceita http e https, com ou sem caixa", () => {
    expect(siteComEsquemaAceito("https://nslink.com.br")).toBe(true);
    expect(siteComEsquemaAceito("HTTP://nslink.com.br")).toBe(true);
  });

  it("aceita o endereco sem esquema, como o provedor digitou", () => {
    expect(siteComEsquemaAceito("www.exemplo.com.br")).toBe(true);
    expect(siteComEsquemaAceito("exemplo.com.br/contato")).toBe(true);
  });
});

describe("site", () => {
  it("nao reescreve o que foi digitado: nada de prefixar https://", () => {
    expect(site("www.exemplo.com.br")).toEqual({ ok: true, valor: "www.exemplo.com.br" });
  });

  it("recusa esquema proibido com frase que diz o que fazer", () => {
    const veredito = site("javascript:alert(1)");

    expect(veredito.ok).toBe(false);
    expect(veredito.ok === false && veredito.frase).toMatch(/http:\/\/ ou https:\/\//);
  });

  it("recusa acima do teto da coluna", () => {
    expect(site(`www.${"a".repeat(500)}.com.br`).ok).toBe(false);
  });

  it("aceita null", () => {
    expect(site(null)).toEqual({ ok: true, valor: null });
  });
});
