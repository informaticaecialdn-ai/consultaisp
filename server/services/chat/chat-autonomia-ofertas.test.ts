import { describe, expect, it } from "vitest";
import { POLITICA_PADRAO } from "@shared/cobranca/politica";
import { calcularOfertasAutonomia, escolherOfertaAutonomia, ofertaAindaValida, pedidoForaDaFaixa, textoDasOfertas } from "./chat-autonomia-ofertas";
const politica = structuredClone(POLITICA_PADRAO);
politica.acordo.ex_cliente.origemDaCobranca = "manual";
const entrada = { customerId: 7, carteira: "ex_cliente" as const, saldo: 400, diasAtraso: 200, mensalidade: 100, vulneravel: false };
const agora = new Date("2026-09-08T15:00:00Z");
describe("ofertas autônomas calculadas por carteira", () => {
  it("gera oferta pela faixa e envelope e preserva centavos e vencimentos", () => {
    const o = calcularOfertasAutonomia(entrada, politica, "m1", agora);
    expect(o.ofertas[0]).toMatchObject({ valor: 320, descontoPct: 20, parcelas: 1 });
    expect(o.ofertas[1]).toMatchObject({ valor: 320, parcelas: 6, entrada: 64 });
    const texto = textoDasOfertas(o);
    expect(texto).toContain("320,00"); expect(texto).toContain("entrada"); expect(texto).toContain("opção");
  });
  it("não oferece parcelamento abaixo de duas mensalidades e sem origem não oferece desconto", () => {
    expect(calcularOfertasAutonomia({ ...entrada, mensalidade: 300 }, politica, "m1", agora).ofertas.every(o => o.parcelas === 1)).toBe(true);
    expect(calcularOfertasAutonomia(entrada, POLITICA_PADRAO, "m1", agora).ofertas).toMatchObject([{ valor: 400, descontoPct: 0 }]);
  });
  it("seleção precisa opção e data expressas, válidas, dentro da janela; nem modelo nem sim selecionam", () => {
    const o = calcularOfertasAutonomia(entrada, politica, "m1", agora);
    expect(escolherOfertaAutonomia(o, "sim", "m2", entrada, politica, agora)).toBeNull();
    expect(escolherOfertaAutonomia(o, "opção 2 para 31/09", "m2", entrada, politica, agora)).toBeNull();
    expect(escolherOfertaAutonomia(o, "opção 2 para 30/09", "m2", entrada, politica, agora)).toBeNull();
    const escolhida = escolherOfertaAutonomia(o, "opção 2 para 09/09", "m2", entrada, politica, agora);
    expect(escolhida?.selecionada).toBe(1); expect(escolhida?.ofertas[1].vencimentos[0]).toBe("2026-09-09");
  });
  it("revalida saldo, carteira, cliente, política, data e expiração antes da persistência", () => {
    const o = escolherOfertaAutonomia(calcularOfertasAutonomia(entrada, politica, "m1", agora), "opção 1 para 09/09", "m2", entrada, politica, agora)!;
    expect(ofertaAindaValida(o, entrada, politica, agora)).toBe(true);
    expect(ofertaAindaValida(o, { ...entrada, saldo: 401 }, politica, agora)).toBe(false);
    expect(ofertaAindaValida(o, { ...entrada, customerId: 8 }, politica, agora)).toBe(false);
    expect(ofertaAindaValida(o, { ...entrada, carteira: "ativo" }, politica, agora)).toBe(false);
    const mudada = structuredClone(politica); mudada.negociacao.descontoMaxPct = 10;
    expect(ofertaAindaValida(o, entrada, mudada, agora)).toBe(false);
    expect(ofertaAindaValida(o, entrada, politica, new Date(agora.getTime() + 31 * 60_000))).toBe(false);
  });
  it("pedido expresso acima da faixa vai ao humano", () => {
    const o = calcularOfertasAutonomia(entrada, politica, "m1", agora);
    expect(pedidoForaDaFaixa("quero desconto de 99%", o)).toBe(true);
    expect(pedidoForaDaFaixa("parcela em 48 vezes", o)).toBe(true);
    expect(pedidoForaDaFaixa("tem desconto?", o)).toBe(false);
  });
});
