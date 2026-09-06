import { describe, expect, it } from "vitest";
import { confirmacaoExplicita, exigeHumano, propostaConfirmada, respostaControlada, validarProposta } from "./chat-autonomia-politica";

const agora = new Date("2026-09-06T15:00:00Z");
describe("limites do motor autônomo", () => {
  it("requer consentimento inequívoco posterior a oferta", () => {
    expect(confirmacaoExplicita("sim, mas só metade")).toBe(false);
    const p = validarProposta({ acao: "promessa", data: "2026-09-10", valor: 100 }, "pago 10/9", 100, "m1", agora);
    expect(propostaConfirmada(p, "sim", "m1", agora)).toBe(false);
    expect(propostaConfirmada(p, "sim", "m2", agora)).toBe(true);
    expect(propostaConfirmada(p, "sim", "m2", new Date(agora.getTime()+31*60_000))).toBe(false);
  });
  it("bloqueia desconto, data inventada, impossível e passada", () => {
    expect(validarProposta({ acao: "promessa", data: "2026-09-10", valor: 90 }, "10/9", 100, "m", agora)).toBeNull();
    expect(validarProposta({ acao: "promessa", data: "2026-09-10" }, "amanhã", 100, "m", agora)).toBeNull();
    expect(validarProposta({ acao: "promessa", data: "2026-09-31" }, "31/9", 100, "m", agora)).toBeNull();
    expect(validarProposta({ acao: "promessa", data: "2026-09-05" }, "5/9", 100, "m", agora)).toBeNull();
  });
  it("agenda apenas data/hora citadas com fuso explícito", () => {
    expect(validarProposta({ acao: "agendar", data: "2026-09-10T14:00:00-03:00" }, "10/9 às 14:00", 0, "m", agora)?.acao).toBe("agendar");
    expect(validarProposta({ acao: "agendar", data: "2026-09-10T14:00:00-03:00" }, "10/9 de tarde", 0, "m", agora)).toBeNull();
  });
  it.each(["já paguei", "quero atendente", "não reconheço", "número errado", "desconto", "já devolvi", "pare de mandar mensagens"])("transfere exceção: %s", texto => expect(exigeHumano(texto)).toBe(true));
  // Negativar, baixar, retirar o nome, SPC/Serasa, Procon e advogado: nunca pela IA.
  it.each([
    "vocês vão me negativar?", "meu nome foi negativado", "quero a negativação retirada", "pode dar baixa na fatura", "vocês baixaram o título?",
    "quero retirar meu nome", "a retirada do meu nome do SPC", "estou no Serasa por causa de vocês", "estou no SPC", "vou no Procon", "meu advogado vai entrar em contato",
  ])("transfere exceção de política: %s", texto => expect(exigeHumano(texto)).toBe(true));
  it.each(["consigo pagar dia 10/9", "vou pagar amanhã", "posso devolver dia 10/9 às 14:00", "qual o valor?"])("não transfere o fluxo normal: %s", texto => expect(exigeHumano(texto)).toBe(false));
  it("jamais transmite texto livre ou link do modelo", () => {
    const r = respostaControlada({ acao: "responder", resposta: "informar_divida", texto: "pague R$999 em https://malicioso" }, 100, false);
    expect(r).toContain("100,00"); expect(r).not.toContain("999"); expect(r).not.toContain("malicioso");
  });
  // Saldo não lido agora = `null`. Não é zero e não é o valor da varredura das 03:00.
  it("sem saldo lido no ERP não cita valor nenhum: encaminha a conferência ao atendente", () => {
    const r = respostaControlada({ acao: "responder", resposta: "informar_divida" }, null, false);
    expect(r).toBe("Vou encaminhar a conferência da situação ao atendente.");
    expect(r).not.toMatch(/\d/);
  });
  it("sem saldo lido no ERP não existe promessa, nem com data citada pelo cliente", () => {
    expect(validarProposta({ acao: "promessa", data: "2026-09-10", valor: 150 }, "pago 10/9", null, "m1", agora)).toBeNull();
    // A devolução não fala em valor: o agendamento continua válido.
    expect(validarProposta({ acao: "agendar", data: "2026-09-10T14:00:00-03:00" }, "10/9 às 14:00", null, "m", agora)?.acao).toBe("agendar");
  });
});
