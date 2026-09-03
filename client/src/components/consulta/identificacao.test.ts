import { describe, it, expect } from "vitest";
import {
  normalizarCodigo, lerIdentificacao, lerErroDeConsulta,
} from "./identificacao";

describe("normalizarCodigo", () => {
  it("aceita o codigo como o servidor o emite", () => {
    expect(normalizarCodigo("CI-2609-K7F3M2")).toBe("CI-2609-K7F3M2");
  });

  it("aceita minuscula, espaco e a forma sem tracos — e como o codigo volta colado de um chamado", () => {
    expect(normalizarCodigo("ci-2609-k7f3m2")).toBe("CI-2609-K7F3M2");
    expect(normalizarCodigo("  CI-2609-K7F3M2  ")).toBe("CI-2609-K7F3M2");
    expect(normalizarCodigo("CI2609K7F3M2")).toBe("CI-2609-K7F3M2");
  });

  it("recusa codigo com caractere fora do alfabeto em vez de adivinhar", () => {
    // O alfabeto nao tem 0 nem O: trocar um pelo outro faria a tela exibir um
    // codigo que o suporte nao encontra.
    expect(normalizarCodigo("CI-2609-K7F3M0")).toBeNull();
    expect(normalizarCodigo("CI-2609-K7F3MO")).toBeNull();
    expect(normalizarCodigo("CI-2609-K7F3MI")).toBeNull();
  });

  it("recusa o que nao e codigo — inclusive o protocolo derivado antigo", () => {
    expect(normalizarCodigo("#CI-2026-00123")).toBeNull();
    expect(normalizarCodigo("")).toBeNull();
    expect(normalizarCodigo(null)).toBeNull();
    expect(normalizarCodigo(undefined)).toBeNull();
    expect(normalizarCodigo(123)).toBeNull();
    expect(normalizarCodigo({ consultaId: "CI-2609-K7F3M2" })).toBeNull();
  });
});

describe("lerIdentificacao", () => {
  it("le o codigo no topo da resposta", () => {
    expect(lerIdentificacao({ consultaId: "CI-2609-K7F3M2" }).consultaId).toBe("CI-2609-K7F3M2");
  });

  it("le o codigo dentro de result, de consultation e de resultado — os tres envelopes das rotas", () => {
    expect(lerIdentificacao({ result: { consultaId: "CI-2609-AAAAAA" } }).consultaId).toBe("CI-2609-AAAAAA");
    expect(lerIdentificacao({ consultation: { consultaId: "CI-2609-BBBBBB" } }).consultaId).toBe("CI-2609-BBBBBB");
    expect(lerIdentificacao({ resultado: { consultaId: "CI-2609-CCCCCC" } }).consultaId).toBe("CI-2609-CCCCCC");
  });

  it("devolve null quando a consulta nasceu antes desta versao", () => {
    // Consulta antiga nao tem codigo. A tela mostra um traco; inventar um aqui
    // mandaria o suporte procurar linha inexistente.
    expect(lerIdentificacao({ consultation: { id: 123 }, result: {} }).consultaId).toBeNull();
    expect(lerIdentificacao(null).consultaId).toBeNull();
    expect(lerIdentificacao(undefined).consultaId).toBeNull();
    expect(lerIdentificacao("CI-2609-K7F3M2").consultaId).toBeNull();
  });

  it("nunca deriva o codigo do id sequencial", () => {
    const r = lerIdentificacao({ consultation: { id: 123, createdAt: "2026-09-03T12:00:00Z" } });
    expect(r.consultaId).toBeNull();
  });

  it("le o protocolo da origem com quem o emitiu", () => {
    const r = lerIdentificacao({
      consultaId: "CI-2609-K7F3M2",
      protocoloDaOrigem: { origem: "SPC Brasil", protocolo: "20260903-0001" },
    });
    expect(r.protocoloDaOrigem).toEqual({ origem: "SPC Brasil", protocolo: "20260903-0001" });
  });

  it("recusa protocolo pela metade — origem sem numero nao identifica nada", () => {
    expect(lerIdentificacao({ protocoloDaOrigem: { origem: "SPC Brasil" } }).protocoloDaOrigem).toBeNull();
    expect(lerIdentificacao({ protocoloDaOrigem: { protocolo: "123" } }).protocoloDaOrigem).toBeNull();
    expect(lerIdentificacao({ protocoloDaOrigem: "123" }).protocoloDaOrigem).toBeNull();
  });

  it("usa a origem informada quando so ha o protocolo cru — o caso do SPC de hoje", () => {
    const r = lerIdentificacao({ result: { protocolo: "776655" } }, "SPC Brasil");
    expect(r.protocoloDaOrigem).toEqual({ origem: "SPC Brasil", protocolo: "776655" });
  });

  it("nao inventa origem para protocolo cru quando nao lhe disseram qual e", () => {
    expect(lerIdentificacao({ result: { protocolo: "776655" } }).protocoloDaOrigem).toBeNull();
  });

  it("o par explicito vence a origem padrao", () => {
    const r = lerIdentificacao(
      { protocoloDaOrigem: { origem: "BigDataCorp", protocolo: "uuid-1" }, protocolo: "776655" },
      "SPC Brasil",
    );
    expect(r.protocoloDaOrigem).toEqual({ origem: "BigDataCorp", protocolo: "uuid-1" });
  });
});

describe("lerErroDeConsulta", () => {
  it("desembrulha o status e o JSON que o apiRequest concatena", () => {
    const erro = new Error('402: {"message":"Créditos insuficientes","consultaId":"CI-2609-K7F3M2"}');
    expect(lerErroDeConsulta(erro)).toEqual({
      mensagem: "Créditos insuficientes",
      consultaId: "CI-2609-K7F3M2",
    });
  });

  it("aceita erro sem codigo — nem toda falha chega a ganhar um", () => {
    const erro = new Error('500: {"message":"Falha interna"}');
    expect(lerErroDeConsulta(erro)).toEqual({ mensagem: "Falha interna", consultaId: null });
  });

  it("aceita corpo em texto puro, que e o erro de rede comum", () => {
    expect(lerErroDeConsulta(new Error("503: Service Unavailable"))).toEqual({
      mensagem: "Service Unavailable",
      consultaId: null,
    });
  });

  it("nao deixa a tela mostrar JSON cru quando o corpo nao tem message", () => {
    const r = lerErroDeConsulta(new Error('500: {"erro":"x"}'));
    expect(r.consultaId).toBeNull();
    expect(r.mensagem).toBe('{"erro":"x"}');
  });

  it("tem mensagem mesmo quando o erro chega vazio", () => {
    expect(lerErroDeConsulta(new Error("")).mensagem).toBe("Falha ao consultar.");
    expect(lerErroDeConsulta(null).mensagem).toBe("Falha ao consultar.");
    expect(lerErroDeConsulta(undefined).mensagem).toBe("Falha ao consultar.");
  });

  it("aceita a string solta, nao so o Error", () => {
    expect(lerErroDeConsulta('402: {"message":"Sem saldo","consultaId":"CI-2609-ZZZZZZ"}')).toEqual({
      mensagem: "Sem saldo",
      consultaId: "CI-2609-ZZZZZZ",
    });
  });
});
