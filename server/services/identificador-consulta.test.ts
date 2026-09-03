import { describe, expect, it } from "vitest";
import {
  ehIdentificadorDeConsulta,
  FORMATO_DO_IDENTIFICADOR,
  gerarIdentificadorDeConsulta,
  normalizarIdentificador,
  protocoloDaOrigem,
} from "./identificador-consulta";

describe("gerarIdentificadorDeConsulta", () => {
  it("sai no formato CI-AAMM-XXXXXX", () => {
    expect(gerarIdentificadorDeConsulta(new Date("2026-09-03T12:00:00Z"))).toMatch(FORMATO_DO_IDENTIFICADOR);
  });

  it("carrega o ano e o mes da consulta", () => {
    expect(gerarIdentificadorDeConsulta(new Date("2026-09-03T12:00:00Z")).slice(0, 8)).toBe("CI-2609-");
    expect(gerarIdentificadorDeConsulta(new Date("2027-01-15T12:00:00Z")).slice(0, 8)).toBe("CI-2701-");
  });

  /**
   * A VPS roda em UTC. As 21h do dia 30 em Brasilia ja e dia 1 do mes seguinte
   * em UTC — e o mes embutido no codigo existe justamente para orientar a busca
   * do suporte, entao apontar para o mes errado destroi a unica utilidade dele.
   */
  it("usa o mes de Brasilia, nao o do servidor em UTC", () => {
    // 30/09/2026 as 21h em Brasilia = 01/10/2026 as 00h em UTC.
    expect(gerarIdentificadorDeConsulta(new Date("2026-10-01T00:00:00Z")).slice(0, 8)).toBe("CI-2609-");
  });

  it("nao usa caractere ambiguo: sem 0, 1, I, O nem U", () => {
    const sorteios = Array.from({ length: 400 }, () => gerarIdentificadorDeConsulta().slice(8)).join("");
    expect(sorteios).not.toMatch(/[01IOU]/);
  });

  it("cada chamada devolve um codigo diferente", () => {
    const agora = new Date("2026-09-03T12:00:00Z");
    const mil = new Set(Array.from({ length: 1000 }, () => gerarIdentificadorDeConsulta(agora)));
    expect(mil.size).toBe(1000);
  });

  /**
   * `byte % 31` pareceria suficiente: 256 nao e multiplo de 31, entao os
   * primeiros simbolos sairiam ~14% mais que os ultimos. Nao e falha de
   * seguranca aqui, e e sinal de sorteio mal feito — este teste trava a
   * correcao (descarte da faixa que sobra) no lugar.
   */
  it("o sorteio nao favorece o comeco do alfabeto", () => {
    const contagem = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      for (const c of gerarIdentificadorDeConsulta().slice(8)) {
        contagem.set(c, (contagem.get(c) ?? 0) + 1);
      }
    }
    const valores = [...contagem.values()];
    const esperado = (3000 * 6) / 31;
    // Cada simbolo dentro de 30% do esperado; com vies de modulo a diferenca
    // entre o primeiro e o ultimo passaria de 14% de forma sistematica.
    for (const v of valores) {
      expect(v).toBeGreaterThan(esperado * 0.7);
      expect(v).toBeLessThan(esperado * 1.3);
    }
    expect(contagem.size).toBe(31);
  });
});

describe("normalizarIdentificador", () => {
  it("aceita o codigo como e", () => {
    expect(normalizarIdentificador("CI-2609-K7F3M2")).toBe("CI-2609-K7F3M2");
  });

  // Quem cola no suporte cola torto; recusar obriga a pessoa a acertar a
  // digitacao de um codigo que ela nao escolheu.
  it("aceita minuscula, espaco e sem traco", () => {
    expect(normalizarIdentificador("ci-2609-k7f3m2")).toBe("CI-2609-K7F3M2");
    expect(normalizarIdentificador("  CI-2609-K7F3M2  ")).toBe("CI-2609-K7F3M2");
    expect(normalizarIdentificador("CI2609K7F3M2")).toBe("CI-2609-K7F3M2");
    expect(normalizarIdentificador("ci 2609 k7f3m2")).toBe("CI-2609-K7F3M2");
  });

  /**
   * O alfabeto nao tem 0, 1, I, O nem U. Um codigo com eles esta errado — e
   * dizer isso e melhor do que "corrigir" para um codigo que existe e e de
   * outra consulta.
   */
  it("nao adivinha caractere parecido", () => {
    expect(normalizarIdentificador("CI-2609-K7F3MO")).toBeNull();
    expect(normalizarIdentificador("CI-2609-K7F3M0")).toBeNull();
    expect(normalizarIdentificador("CI-2609-K7F3MI")).toBeNull();
  });

  it("recusa o que nao e identificador", () => {
    for (const lixo of ["", "   ", null, undefined, "12345678900", "CI-269-K7F3M2", "XX-2609-K7F3M2", "CI-2609-K7F3M"]) {
      expect(normalizarIdentificador(lixo as any)).toBeNull();
      expect(ehIdentificadorDeConsulta(lixo as any)).toBe(false);
    }
  });

  it("todo codigo gerado passa pela propria validacao", () => {
    for (let i = 0; i < 200; i++) expect(ehIdentificadorDeConsulta(gerarIdentificadorDeConsulta())).toBe(true);
  });
});

/**
 * Os protocolos da origem estavam gravados e invisiveis. Os exemplos abaixo
 * sao a forma real encontrada no banco: a BigDataCorp devolve um UUID em
 * `bruto.QueryId`; o SPC, um numero com digito em `protocolo`.
 */
describe("protocoloDaOrigem", () => {
  it("acha o QueryId da BigDataCorp onde ele realmente fica", () => {
    const resultado = { dados: {}, bruto: { QueryId: "84f8f8a2-fdca-4076-8dff-7a8541ce17d5", QueryDate: "2026-09-03T03:05:49Z" } };
    expect(protocoloDaOrigem("cadastral", resultado)).toEqual({
      origem: "BigDataCorp", protocolo: "84f8f8a2-fdca-4076-8dff-7a8541ce17d5",
    });
  });

  it("acha o protocolo do SPC", () => {
    expect(protocoloDaOrigem("spc", { score: 700, protocolo: "15270310995-7" })).toEqual({
      origem: "SPC Brasil", protocolo: "15270310995-7",
    });
  });

  // A consulta ISP nao tem origem externa: o score e calculado aqui.
  it("consulta ISP nao tem protocolo de origem", () => {
    expect(protocoloDaOrigem("isp", { score: 82, riskTier: "baixo" })).toBeNull();
  });

  it("resultado sem o campo, vazio ou de outro tipo devolve null", () => {
    expect(protocoloDaOrigem("cadastral", { bruto: {} })).toBeNull();
    expect(protocoloDaOrigem("cadastral", { bruto: { QueryId: "   " } })).toBeNull();
    expect(protocoloDaOrigem("spc", { protocolo: 15270310995 })).toBeNull();
    expect(protocoloDaOrigem("cadastral", null)).toBeNull();
    expect(protocoloDaOrigem("spc", "texto")).toBeNull();
  });
});
