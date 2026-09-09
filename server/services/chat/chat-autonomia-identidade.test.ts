import { describe, expect, it } from "vitest";
import { avaliarIdentidade, protegerHistorico } from "./chat-autonomia-identidade";

const agora = new Date("2026-09-08T15:00:00Z");
const vinculo = { providerId: 42, conversationId: "c1", customerId: 7, telefone: "5543999990000" };
const cadastro = { nome: "Maria de Souza", documento: "12345678909" };
const avaliar = (estado: Parameters<typeof avaliarIdentidade>[0], texto: string, id = "m2", tempo = agora, vinc = vinculo) => avaliarIdentidade(estado, vinc, cadastro, texto, id, tempo);

describe("identidade do cliente validada pelo servidor", () => {
  it("cumprimento ou confirmação do modelo não liberam identidade; desafio não revela cadastro", () => {
    const r = avaliar(null, "sou eu", "m1");
    expect(r.acao).toBe("desafiar");
    expect(r.mensagem).toContain("últimos 4");
    expect(JSON.stringify(r)).not.toContain("12345678909");
    expect(JSON.stringify(r)).not.toContain("Maria de Souza");
  });
  it("exige nome completo e apenas os últimos quatro dígitos em outra mensagem", () => {
    const desafio = avaliar(null, "oi", "m1").estado;
    expect(avaliar(desafio, "8909").acao).toBe("desafiar");
    expect(avaliar(desafio, "Maria de Souza 8909").acao).toBe("confirmada");
    expect(avaliar(desafio, "Maria de Souza 12345678909").acao).toBe("desafiar");
    expect(avaliar(desafio, "Maria de Souza 8909", "m1").acao).not.toBe("confirmada");
  });
  it("limita três erros e não reinicia tentativas ao expirar desafio", () => {
    let e = avaliar(null, "oi", "m1").estado;
    e = avaliar(e, "Maria 0000", "m2").estado;
    e = avaliar(e, "Maria 0000", "m3").estado;
    expect(avaliar(e, "Maria 0000", "m4", new Date(agora.getTime() + 6 * 60_000)).acao).toBe("humano");
  });
  it("confirmação vence em 15 minutos e não atravessa cliente, telefone, provedor ou conversa", () => {
    const e = avaliar(avaliar(null, "oi", "m1").estado, "Maria de Souza 8909").estado;
    expect(avaliar(e, "boleto", "m3").acao).toBe("confirmada");
    expect(avaliar(e, "boleto", "m3", new Date(agora.getTime() + 15 * 60_000)).acao).toBe("desafiar");
    for (const alterado of [{ customerId: 8 }, { telefone: "5543988880000" }, { providerId: 43 }, { conversationId: "c2" }]) {
      expect(avaliar(e, "boleto", "m3", agora, { ...vinculo, ...alterado }).acao).not.toBe("confirmada");
    }
  });
  it("cadastro incompleto não inventa desafio e documentos ficam fora do planejador", () => {
    expect(avaliarIdentidade(null, vinculo, { nome: "Maria", documento: "" }, "oi", "m1", agora).acao).toBe("humano");
    expect(avaliarIdentidade(null, vinculo, { ...cadastro, documento: "00000000000" }, "oi", "m1", agora).acao).toBe("humano");
    expect(protegerHistorico("Meu CPF 123.456.789-09, final 8909", cadastro.documento)).not.toMatch(/123|8909/);
  });
});
