import { describe, it, expect } from "vitest";
import { erroDaResposta } from "./queryClient";

/**
 * O contrato do erro que as telas recebem. Antes só `message` sobrevivia:
 * uma negociação recusada por três regras chegava ao toast com uma.
 */
describe("erroDaResposta", () => {
  it("mensagem, status e código continuam como eram", () => {
    const erro = erroDaResposta(409, JSON.stringify({ message: "Caso fechado", code: "CASO_FECHADO" }));
    expect(erro.message).toBe("Caso fechado");
    expect(erro.status).toBe(409);
    expect(erro.codigo).toBe("CASO_FECHADO");
  });

  it("anexa o corpo inteiro, já como JSON", () => {
    const erro = erroDaResposta(422, JSON.stringify({ message: "x", acessos: 3 }));
    expect(erro.corpo).toEqual({ message: "x", acessos: 3 });
  });

  it("achata `violacoes` (422 da negociação) em `erros`", () => {
    const violacoes = ["Desconto de 30% excede o teto de 20% da política.", "Máximo de 6 parcelas pela política; pedido: 12."];
    const erro = erroDaResposta(422, JSON.stringify({ message: violacoes[0], violacoes }));
    expect(erro.erros).toEqual(violacoes);
  });

  it("achata `errors` por campo (400 da política) sem repetir frase", () => {
    const corpo = { message: "Dados invalidos", errors: { "encargos.multaPct": ["máximo 100"], "janelaContato.horaFim": ["máximo 23", "máximo 23"] } };
    const erro = erroDaResposta(400, JSON.stringify(corpo));
    expect(erro.erros).toEqual(["máximo 100", "máximo 23"]);
  });

  it("corpo que não é JSON vai cru, sem lista", () => {
    const erro = erroDaResposta(502, "<html>Bad gateway</html>");
    expect(erro.message).toBe("<html>Bad gateway</html>");
    expect(erro.corpo).toBe("<html>Bad gateway</html>");
    expect(erro.erros).toBeUndefined();
  });

  it("sem frase nenhuma, a mensagem é o status", () => {
    expect(erroDaResposta(500, "").message).toBe("Erro 500");
  });
});
