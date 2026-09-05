import { describe, it, expect } from "vitest";
import { ETAPAS_PADRAO, PARCELAMENTO_POR_STATUS, POLITICA_PADRAO, PoliticaSchema, STATUS_DE_PARCELAMENTO } from "@shared/cobranca";
import {
  confirmarCustos, corpoDaPausa, corpoDoPut, economiaDoForm, editarCusto, editarEtapa, etapasParaConfig, formDaPolitica,
  lerPolitica, lerRespostaDoPut, ROTULO_PARCELAMENTO_POR_STATUS, adicionarPlano, editarPlano, precoPorPlanoDoForm, removerPlano } from "./politica-form";
import { ECONOMIA_PADRAO, type EconomiaDaPolitica } from "./tipos";

const padrao = PoliticaSchema.parse(POLITICA_PADRAO);
const economia: EconomiaDaPolitica = { cac: 120, capexInstalacao: 480, equipamentoResidual: 250, opexLink: 12.5, opexRedePop: 8, opexSuporte: 6, opexManutencaoNoc: 4, impostoReceitaPct: 12, cicloMeses: 36, confirmado: true, precoPorPlano: { "Fibra 300": 119.9 } };
/** A política gravada com custos confirmados — o que a tela lê depois de "Confirmar custos". */
const comEconomia = { ...padrao, economia };

describe("lerPolitica", () => {
  it("aceita a política crua, embrulhada e ausente", () => {
    expect(lerPolitica(padrao)).toEqual(padrao);
    expect(lerPolitica({ politica: padrao })).toEqual(padrao);
    expect(lerPolitica(null)).toEqual(padrao);
    expect(lerPolitica(undefined)).toEqual(padrao);
  });
  it("JSON de outra versão cai no padrão em vez de derrubar a tela", () => {
    expect(lerPolitica({ negociacao: { maxParcelas: "seis" } })).toEqual(padrao);
  });
});

describe("formDaPolitica / corpoDoPut", () => {
  it("vai e volta sem perder nada", () => {
    const form = formDaPolitica(padrao);
    expect(form.etapas.map(e => e.id)).toEqual(ETAPAS_PADRAO.map(e => e.id));
    const corpo = corpoDoPut(form, padrao);
    expect(PoliticaSchema.parse(corpo)).toEqual(padrao);
  });
  it("campo vazio ou lixo cai no que estava gravado, nunca em NaN", () => {
    const form = formDaPolitica(padrao);
    form.encargos.multaPct = "";
    form.negociacao.maxParcelas = "abc";
    form.janelaContato.horaFim = "19,5";
    const corpo = corpoDoPut(form, padrao);
    expect(corpo.encargos?.multaPct).toBe(2);
    expect(corpo.negociacao?.maxParcelas).toBe(6);
    expect(corpo.janelaContato?.horaFim).toBe(20);
  });
  it("vírgula decimal é aceita", () => {
    const form = formDaPolitica(padrao);
    form.negociacao.entradaMinimaPct = "12,5";
    expect(corpoDoPut(form, padrao).negociacao?.entradaMinimaPct).toBe(12.5);
  });
  it("motivo da pausa só vai quando pausada", () => {
    const form = formDaPolitica(padrao);
    form.pausadaMotivo = "férias";
    expect(corpoDoPut(form, padrao).pausadaMotivo).toBeNull();
    form.pausada = true;
    expect(corpoDoPut(form, padrao).pausadaMotivo).toBe("férias");
  });
});

describe("etapasParaConfig — só as mudanças do provedor", () => {
  it("catálogo intacto grava lista vazia", () => {
    expect(etapasParaConfig(ETAPAS_PADRAO)).toEqual([]);
  });
  it("cada campo mudado entra; o que voltou ao padrão sai", () => {
    let etapas = editarEtapa(ETAPAS_PADRAO, "lembrete_atraso", { acao: "Ligar hoje", responsavelUserId: 7, diaMax: "10" });
    expect(etapasParaConfig(etapas)).toEqual([{ id: "lembrete_atraso", diaMax: 10, acao: "Ligar hoje", responsavelUserId: 7 }]);
    etapas = editarEtapa(etapas, "lembrete_atraso", { acao: ETAPAS_PADRAO[1].acao, diaMax: "14" });
    expect(etapasParaConfig(etapas)).toEqual([{ id: "lembrete_atraso", responsavelUserId: 7 }]);
  });
  it("diaMax vazio na última etapa é 'sem teto'", () => {
    const etapas = editarEtapa(ETAPAS_PADRAO, "divida_antiga", { diaMax: "" });
    expect(etapas.find(e => e.id === "divida_antiga")?.diaMax).toBeNull();
    expect(etapasParaConfig(etapas)).toEqual([{ id: "divida_antiga", diaMax: null }]);
  });
  it("desligar a etapa grava ativa=false", () => {
    expect(etapasParaConfig(editarEtapa(ETAPAS_PADRAO, "aviso_suspensao", { ativa: false })))
      .toEqual([{ id: "aviso_suspensao", ativa: false }]);
  });
});

describe("corpoDaPausa", () => {
  it("reenvia a política gravada mudando só a pausa", () => {
    const corpo = corpoDaPausa(padrao, true, "  auditoria ");
    expect(corpo.pausada).toBe(true);
    expect(corpo.pausadaMotivo).toBe("auditoria");
    expect(corpo.negociacao).toEqual(padrao.negociacao);
    expect(corpoDaPausa(padrao, false, "x").pausadaMotivo).toBeNull();
  });
  it("leva a economia gravada — pausar a régua não apaga os custos confirmados", () => {
    expect(corpoDaPausa(comEconomia, true, "x").economia).toEqual(economia);
    expect(corpoDaPausa(padrao, true, "x").economia).toEqual(ECONOMIA_PADRAO);
  });
});

describe("economia (R24) no formulário", () => {
  it("sem economia gravada, o form nasce com o padrão (ciclo 36, não confirmado)", () => {
    const form = formDaPolitica(padrao);
    expect(form.economia.cicloMeses).toBe("36");
    expect(form.economia.confirmado).toBe(false);
    expect(corpoDoPut(form, padrao).economia).toEqual(ECONOMIA_PADRAO);
  });
  it("vai e volta sem perder nada, e o PUT manda `economia`", () => {
    const form = formDaPolitica(comEconomia);
    expect(form.economia.opexLink).toBe("12.5");
    expect(corpoDoPut(form, comEconomia).economia).toEqual(economia);
    expect(PoliticaSchema.parse(corpoDoPut(form, comEconomia))).toEqual(comEconomia);
  });
  it("caixa vazia, lixo ou negativo cai no gravado; ciclo é inteiro e no mínimo 1; vírgula é aceita", () => {
    const form = formDaPolitica(comEconomia);
    form.economia.cac = "";
    form.economia.opexSuporte = "abc";
    form.economia.opexLink = "-3";
    form.economia.opexRedePop = "9,75";
    form.economia.cicloMeses = "0";
    const e = economiaDoForm(form.economia, economia);
    expect(e.cac).toBe(120);
    expect(e.opexSuporte).toBe(6);
    expect(e.opexLink).toBe(12.5);
    expect(e.opexRedePop).toBe(9.75);
    expect(e.cicloMeses).toBe(1);
  });
  it("mudar um custo DESCONFIRMA; confirmar liga de novo", () => {
    const form = formDaPolitica(comEconomia);
    const editado = editarCusto(form, "cac", "150");
    expect(editado.economia.cac).toBe("150");
    expect(editado.economia.confirmado).toBe(false);
    expect(confirmarCustos(editado).economia.confirmado).toBe(true);
    // O form original não muda: são objetos novos.
    expect(form.economia.confirmado).toBe(true);
  });
  it("a economia volta na resposta do PUT como parte da política; sem ela, o padrão", () => {
    expect(lerRespostaDoPut({ politica: comEconomia, ajustes: [] }).politica.economia).toEqual(economia);
    expect(lerPolitica({ politica: padrao }).economia).toEqual(ECONOMIA_PADRAO);
  });
});

describe("ROTULO_PARCELAMENTO_POR_STATUS", () => {
  it("todo perfil tem rótulo em português, sem o enum cru", () => {
    for (const s of STATUS_DE_PARCELAMENTO) {
      expect(ROTULO_PARCELAMENTO_POR_STATUS[s]).toBeTruthy();
      expect(ROTULO_PARCELAMENTO_POR_STATUS[s]).not.toContain("_");
    }
    expect(Object.keys(ROTULO_PARCELAMENTO_POR_STATUS).sort()).toEqual(Object.keys(PARCELAMENTO_POR_STATUS).sort());
  });
});

describe("lerRespostaDoPut", () => {
  it("traz os ajustes do clamp e a política gravada", () => {
    const r = lerRespostaDoPut({ politica: padrao, ajustes: ["Multa de 5% reduzida a 2%"] });
    expect(r.ajustes).toEqual(["Multa de 5% reduzida a 2%"]);
    expect(r.politica).toEqual(padrao);
    expect(lerRespostaDoPut(padrao).ajustes).toEqual([]);
  });
});

describe("preço por plano (ARPU) no formulário", () => {
  it("vai e volta: o mapa gravado vira linhas e as linhas voltam ao mapa", () => {
    const form = formDaPolitica(comEconomia);
    expect(form.economia.planos).toEqual([{ nome: "Fibra 300", preco: "119.9" }]);
    expect(economiaDoForm(form.economia, economia).precoPorPlano).toEqual({ "Fibra 300": 119.9 });
  });
  it("linha sem nome, sem preço, com lixo, zero ou negativo não entra; vírgula é aceita; nome repetido, a última vence", () => {
    expect(precoPorPlanoDoForm([
      { nome: "  Fibra  500 ", preco: "149,90" },
      { nome: "", preco: "99" },
      { nome: "Vazio", preco: "" },
      { nome: "Lixo", preco: "abc" },
      { nome: "Zero", preco: "0" },
      { nome: "Negativo", preco: "-5" },
      { nome: "Fibra 500", preco: "159.9" },
    ])).toEqual({ "Fibra 500": 159.9 });
  });
  it("adicionar, editar e remover linha; mexer no preço NÃO desconfirma os custos", () => {
    let form = formDaPolitica(comEconomia);
    form = adicionarPlano(form);
    expect(form.economia.planos).toHaveLength(2);
    form = editarPlano(form, 1, "nome", "Giga 1000");
    form = editarPlano(form, 1, "preco", "249,9");
    expect(form.economia.planos[1]).toEqual({ nome: "Giga 1000", preco: "249,9" });
    expect(form.economia.confirmado).toBe(true);
    form = removerPlano(form, 0);
    expect(economiaDoForm(form.economia, economia).precoPorPlano).toEqual({ "Giga 1000": 249.9 });
  });
});
