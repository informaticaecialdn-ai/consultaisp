/**
 * O formulário da política de acordo: ida e volta sem perder número, caixa
 * vazia caindo no gravado (nunca em NaN), o "sem teto" da última faixa, e os
 * avisos que o admin lê ANTES de gravar.
 */
import { describe, expect, it } from "vitest";
import { ACORDO_PADRAO, type Acordo } from "@shared/cobranca";
import {
  acordoDoForm,
  adicionarFaixa,
  avisosDasFaixas,
  editarCarteira,
  editarFaixa,
  formDoAcordo,
  removerFaixa,
  rotulosDasFaixas,
} from "./acordo-form";

const gravado = (): Acordo => structuredClone(ACORDO_PADRAO);

describe("formDoAcordo · acordoDoForm", () => {
  it("ida e volta não muda nada — só o `acimaDeDias`, que a tela não edita e o servidor infere", () => {
    const a = gravado();
    const volta = acordoDoForm(formDoAcordo(a), a);
    for (const carteira of ["ativo", "ex_cliente"] as const) {
      expect(volta[carteira].origemDaCobranca).toBe(a[carteira].origemDaCobranca);
      expect(volta[carteira].faixas).toEqual(a[carteira].faixas.map(({ acimaDeDias: _, ...resto }) => resto));
      expect(volta[carteira].janelaVencimentoDias).toBe(a[carteira].janelaVencimentoDias);
    }
  });

  it("vazio no teto da última faixa é `sem teto`, não zero", () => {
    const a = gravado();
    const form = formDoAcordo(a);
    expect(form.ativo.faixas.at(-1)?.ateDias).toBe("");
    expect(acordoDoForm(form, a).ativo.faixas.at(-1)?.ateDias).toBeNull();
  });

  it("caixa vazia ou com lixo cai no valor gravado, nunca em NaN", () => {
    const a = gravado();
    let form = formDoAcordo(a);
    form = editarFaixa(form, "ex_cliente", 0, "descontoMaxPct", "");
    form = editarFaixa(form, "ex_cliente", 0, "maxParcelas", "três");
    form = editarCarteira(form, "ativo", { janelaVencimentoDias: "" });
    const volta = acordoDoForm(form, a);
    expect(volta.ex_cliente.faixas[0].descontoMaxPct).toBe(a.ex_cliente.faixas[0].descontoMaxPct);
    expect(volta.ex_cliente.faixas[0].maxParcelas).toBe(a.ex_cliente.faixas[0].maxParcelas);
    expect(volta.ativo.janelaVencimentoDias).toBe(a.ativo.janelaVencimentoDias);
  });

  it("aceita vírgula decimal, como o resto da tela", () => {
    const a = gravado();
    const form = editarFaixa(formDoAcordo(a), "ex_cliente", 0, "descontoMaxPct", "12,5");
    expect(acordoDoForm(form, a).ex_cliente.faixas[0].descontoMaxPct).toBe(12.5);
  });

  it("a origem é escolha, não número: viaja como está", () => {
    const a = gravado();
    const form = editarCarteira(formDoAcordo(a), "ex_cliente", { origemDaCobranca: "asaas" });
    expect(acordoDoForm(form, a).ex_cliente.origemDaCobranca).toBe("asaas");
    expect(acordoDoForm(form, a).ativo.origemDaCobranca).toBe("nao_definida");
  });
});

describe("faixas — o que a tela deixa mexer", () => {
  it("a faixa nova entra ANTES da cauda, que continua sem teto", () => {
    const a = gravado();
    const form = adicionarFaixa(formDoAcordo(a), "ativo");
    expect(form.ativo.faixas).toHaveLength(4);
    expect(form.ativo.faixas.at(-1)?.ateDias).toBe("");
    expect(form.ativo.faixas[2].ateDias).toBe("90");
  });

  it("a cauda não pode ser removida: alguém sempre atrasa mais que o último teto", () => {
    const a = gravado();
    const form = formDoAcordo(a);
    expect(removerFaixa(form, "ativo", 2)).toBe(form);
    expect(removerFaixa(form, "ativo", 0).ativo.faixas).toHaveLength(2);
  });

  it("avisa antes de gravar quando uma faixa do MEIO fica sem teto — duas caudas nao existem", () => {
    const a = gravado();
    const form = editarFaixa(formDoAcordo(a), "ativo", 0, "ateDias", "");
    const avisos = avisosDasFaixas(form, a);
    expect(avisos.ativo?.[0]).toMatch(/sem teto tem de ser a última/);
    expect(avisos.ex_cliente).toBeUndefined();
  });

  it("mexer so no teto nao cria buraco: a faixa seguinte comeca onde a anterior parou", () => {
    const a = gravado();
    const form = editarFaixa(formDoAcordo(a), "ativo", 0, "ateDias", "10");
    expect(avisosDasFaixas(form, a)).toEqual({});
    expect(rotulosDasFaixas(form, "ativo", a)).toEqual(["até 10 dias", "de 11 a 60 dias", "acima de 60 dias"]);
  });

  it("sem aviso quando a régua fecha, e os rótulos são os da política", () => {
    const a = gravado();
    expect(avisosDasFaixas(formDoAcordo(a), a)).toEqual({});
    expect(rotulosDasFaixas(formDoAcordo(a), "ex_cliente", a)).toEqual(["até 90 dias", "de 91 a 180 dias", "acima de 180 dias"]);
  });
});
