import { describe, expect, it } from "vitest";
import { carteiraDaNavegacao, caminhoNaCarteira, retornoDaCarteira } from "./carteiras";

describe("contexto das carteiras", () => {
  it("a rota da carteira prevalece sobre um parametro antigo", () => {
    expect(carteiraDaNavegacao("/cobranca/ativos", "carteira=ex_cliente")).toBe("ativo");
    expect(carteiraDaNavegacao("/cobranca/ex-clientes", "carteira=ativo")).toBe("ex_cliente");
  });
  it("fila, quadro e ficha recuperam a carteira da URL; entrada sem contexto abre ativos", () => {
    for (const rota of ["/cobranca/fila", "/cobranca/kanban", "/cobranca/cliente/10"]) {
      expect(carteiraDaNavegacao(rota, "carteira=ex_cliente")).toBe("ex_cliente");
      expect(carteiraDaNavegacao(rota, "")).toBe("ativo");
    }
  });
  it("links mantem a carteira e a busca existente sem duplicar o parametro", () => {
    expect(caminhoNaCarteira("/cobranca/fila?responsavel=eu&carteira=ativo", "ex_cliente"))
      .toBe("/cobranca/fila?responsavel=eu&carteira=ex_cliente");
    expect(retornoDaCarteira("ex_cliente")).toBe("/cobranca/ex-clientes");
    expect(retornoDaCarteira("ativo")).toBe("/cobranca/ativos");
  });
});
