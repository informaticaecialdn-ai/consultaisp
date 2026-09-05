import { describe, it, expect } from "vitest";
import { POLITICA_PADRAO } from "@shared/cobranca";
import { corpoDaNegociacao, formInicial, lerDinheiro, pedidoDoForm, previaDaNegociacao, violacoesDoErro } from "./negociacao-form";

describe("lerDinheiro", () => {
  it("aceita o jeito brasileiro e o jeito do teclado numérico", () => {
    expect(lerDinheiro("1.234,56")).toBe(1234.56);
    expect(lerDinheiro("1234,5")).toBe(1234.5);
    expect(lerDinheiro("1234.56")).toBe(1234.56);
    expect(lerDinheiro("1,234.56")).toBe(1234.56);
  });
  it("vazio e lixo são null, não zero — zero seria 'negociar por nada'", () => {
    expect(lerDinheiro("")).toBeNull();
    expect(lerDinheiro("abc")).toBeNull();
  });
});

describe("pedidoDoForm", () => {
  const base = formInicial(500, "2026-10-05");
  it("quitação não leva parcelas nem entrada", () => {
    const r = pedidoDoForm({ ...base, valorNegociado: "400,00" }, 500);
    expect(r).toEqual({ ok: true, pedido: { tipo: "quitacao_desconto", valorOriginal: 500, valorNegociado: 400 } });
  });
  it("parcelamento exige parcelas e vencimento", () => {
    const r = pedidoDoForm({ ...base, tipo: "parcelamento", parcelas: "0" }, 500);
    expect(r).toEqual({ ok: false, erro: "Informe o número de parcelas." });
    const s = pedidoDoForm({ ...base, tipo: "parcelamento", parcelas: "3", primeiroVencimento: "" }, 500);
    expect(s.ok).toBe(false);
  });
  it("entrada vazia é zero; entrada com lixo é erro", () => {
    const ok = pedidoDoForm({ ...base, tipo: "parcelamento", parcelas: "2", entrada: "" }, 500);
    expect(ok.ok && ok.pedido.entrada).toBe(0);
    const erro = pedidoDoForm({ ...base, tipo: "parcelamento", parcelas: "2", entrada: "x" }, 500);
    expect(erro.ok).toBe(false);
  });
});

describe("previaDaNegociacao", () => {
  const base = formInicial(500, "2026-10-31");
  it("calcula o desconto e as parcelas com a política que a tela leu", () => {
    const p = previaDaNegociacao({ ...base, tipo: "parcelamento", valorNegociado: "450", entrada: "90", parcelas: "3" }, 500, POLITICA_PADRAO);
    expect(p.erro).toBeNull();
    expect(p.descontoPct).toBe(10);
    expect(p.violacoes).toEqual([]);
    expect(p.parcelas?.map(x => x.valor)).toEqual([120, 120, 120]);
    // 31/10 → 30/11: o mês sem o dia cai no último dia.
    expect(p.parcelas?.map(x => x.vencimento)).toEqual(["2026-10-31", "2026-11-30", "2026-12-31"]);
  });
  it("mostra a violação da política antes do envio", () => {
    const p = previaDaNegociacao({ ...base, valorNegociado: "300" }, 500, POLITICA_PADRAO);
    expect(p.violacoes.some(v => v.includes("40%"))).toBe(true);
  });
  it("sem política não julga — julgar contra o padrão diria 'ok' ao que o provedor recusa", () => {
    const p = previaDaNegociacao({ ...base, valorNegociado: "300" }, 500, null);
    expect(p.violacoes).toEqual([]);
    expect(p.descontoPct).toBe(40);
  });
  it("campo faltando trava a prévia", () => {
    expect(previaDaNegociacao({ ...base, valorNegociado: "" }, 500, POLITICA_PADRAO).erro).toBe("Informe o valor negociado.");
  });
});

describe("corpoDaNegociacao", () => {
  const base = formInicial(500, "2026-10-05");
  it("quitação vai enxuta; parcelamento vai com entrada, parcelas e vencimento", () => {
    expect(corpoDaNegociacao({ ...base, valorNegociado: "400", aceita: true }, 500))
      .toEqual({ tipo: "quitacao_desconto", valorOriginal: 500, valorNegociado: 400, aceita: true });
    expect(corpoDaNegociacao({ ...base, tipo: "parcelamento", valorNegociado: "450", entrada: "90", parcelas: "3" }, 500))
      .toEqual({ tipo: "parcelamento", valorOriginal: 500, valorNegociado: 450, entrada: 90, parcelas: 3, primeiroVencimento: "2026-10-05", aceita: false });
  });
  it("formulário inválido não vira corpo", () => {
    expect(corpoDaNegociacao({ ...base, valorNegociado: "" }, 500)).toBeNull();
  });
});

describe("violacoesDoErro", () => {
  it("lê o 422 nas duas formas em que o erro chega", () => {
    expect(violacoesDoErro({ status: 422, violacoes: ["a", "b"] })).toEqual(["a", "b"]);
    expect(violacoesDoErro({ status: 422, message: JSON.stringify({ violacoes: ["c"] }) })).toEqual(["c"]);
  });
  it("no 422 sem lista, a mensagem (a primeira violação, que apiRequest guarda) é a lista", () => {
    expect(violacoesDoErro({ status: 422, message: "Desconto de 40% excede o teto de 20% da política." }))
      .toEqual(["Desconto de 40% excede o teto de 20% da política."]);
  });
  it("erro comum não tem violações — vai para o toast, não para a lista", () => {
    expect(violacoesDoErro(new Error("Sessão expirada"))).toEqual([]);
    expect(violacoesDoErro({ status: 409, message: "A dívida mudou" })).toEqual([]);
    expect(violacoesDoErro(null)).toEqual([]);
  });
});
