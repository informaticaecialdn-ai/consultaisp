import { describe, expect, it } from "vitest";
import {
  linkDePagamentoSeguro,
  mensagemDePagamento,
  normalizarPagamento,
} from "./pagamento-chat";
describe("instrumentos de pagamento no chat", () => {
  it("preserva valores corrigidos com milhares e centavos sem aceitar números ambíguos", () => {
    for (const valor of [1234.56, "1234.56", "1.234,56", "1234,56"])
      expect(normalizarPagamento({ valor }).valor).toBe(1234.56);
    for (const valor of [" ", "1,2,3", -10, Infinity])
      expect(normalizarPagamento({ valor }).valor).toBeNull();
  });
  it("não expõe URL executável nem credencial de integração", () => {
    for (const u of [
      "javascript:alert(1)",
      "https://erp.example/x?token=segredo",
      "https://user:senha@erp.example/x",
    ])
      expect(linkDePagamentoSeguro(u)).toBeNull();
    expect(linkDePagamentoSeguro("https://erp.example/boleto/123-abc")).toBe(
      "https://erp.example/boleto/123-abc",
    );
  });
  it("mantém o PIX completo e usa o valor/vencimento devolvidos pelo ERP", () => {
    const d = normalizarPagamento({
      pix: "000201-TESTE",
      valor: "102,45",
      vencimento: "2026-09-10",
      link: "https://erp.example/f/1",
    });
    const m = mensagemDePagamento(d);
    expect(m).toContain("000201-TESTE");
    expect(m).toContain("102,45");
    expect(m).toContain("10/09/2026");
  });
  it("não prepara cobrança sem instrumento e não trunca códigos grandes", () => {
    expect(() => mensagemDePagamento(normalizarPagamento({}))).toThrow(
      "não informou",
    );
    expect(() =>
      mensagemDePagamento(normalizarPagamento({ pix: "0".repeat(2200) })),
    ).toThrow("excedem");
  });
});
