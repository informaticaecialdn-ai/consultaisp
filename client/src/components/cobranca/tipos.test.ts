import { describe, it, expect } from "vitest";
import { EconomiaSchema, POLITICA_PADRAO, ROTULO_STATUS_DE_CASO } from "@shared/cobranca";
import {
  CAMPOS_DE_CUSTO, CICLO_MESES_PADRAO, ECONOMIA_PADRAO, frasesDoErro, lerRespostaDaFila,
  ROTULO_STATUS_DE_CASO_DA_TELA, rotuloDoStatusDeCaso,
} from "./tipos";

describe("frasesDoErro", () => {
  it("só a mensagem quando não há lista", () => {
    expect(frasesDoErro(new Error("Caso fechado"))).toEqual(["Caso fechado"]);
  });
  it("a mensagem e depois as violações, sem repetir a primeira", () => {
    const erro = Object.assign(new Error("Desconto excede o teto"), { erros: ["Desconto excede o teto", "Máximo de 6 parcelas"] });
    expect(frasesDoErro(erro)).toEqual(["Desconto excede o teto", "Máximo de 6 parcelas"]);
  });
  it("lixo na lista é ignorado; string solta vira frase; nada vira 'Falha desconhecida'", () => {
    const erro = Object.assign(new Error("x"), { erros: ["", 42, "  ok  "] });
    expect(frasesDoErro(erro)).toEqual(["x", "ok"]);
    expect(frasesDoErro("Sessão expirada")).toEqual(["Sessão expirada"]);
    expect(frasesDoErro(null)).toEqual(["Falha desconhecida"]);
    expect(frasesDoErro(new Error(""))).toEqual(["Falha desconhecida"]);
  });
});

describe("status de caso da tela", () => {
  it("em_contato e cancelamento têm rótulo antes de o vocabulário compartilhado os ter", () => {
    expect(rotuloDoStatusDeCaso("em_contato")).toBe("Em contato");
    expect(rotuloDoStatusDeCaso("cancelamento")).toBe("Cancelamento");
  });
  it("o compartilhado vence onde existe; desconhecido sai como veio; vazio é null", () => {
    for (const [status, rotulo] of Object.entries(ROTULO_STATUS_DE_CASO)) expect(ROTULO_STATUS_DE_CASO_DA_TELA[status]).toBe(rotulo);
    expect(rotuloDoStatusDeCaso("outra_coisa")).toBe("outra_coisa");
    expect(rotuloDoStatusDeCaso(null)).toBeNull();
  });
});

describe("economia da política na tela", () => {
  it("as nove caixas são exatamente os campos numéricos do vocabulário compartilhado", () => {
    const numericos = Object.keys(EconomiaSchema.shape).filter(k => k !== "confirmado").sort();
    expect([...CAMPOS_DE_CUSTO].sort()).toEqual(numericos);
  });
  it("o padrão é o compartilhado: custo zero, 36 meses, não confirmado", () => {
    expect(ECONOMIA_PADRAO).toBe(POLITICA_PADRAO.economia);
    expect(CICLO_MESES_PADRAO).toBe(36);
    expect(ECONOMIA_PADRAO.confirmado).toBe(false);
    for (const campo of CAMPOS_DE_CUSTO) if (campo !== "cicloMeses") expect(ECONOMIA_PADRAO[campo]).toBe(0);
  });
});

describe("lerRespostaDaFila", () => {
  it("itens, total e KPIs contados pela rota", () => {
    const r = lerRespostaDaFila({ itens: [{ id: 1 }], total: 7200, kpis: { casosVivos: 7200, paraHoje: 40, vencidos: "12", agendados: 5, emAberto: "4590000.50" }, pausada: true, pausadaMotivo: "auditoria" });
    expect(r.itens).toHaveLength(1);
    expect(r.total).toBe(7200);
    expect(r.kpis).toEqual({ casosVivos: 7200, paraHoje: 40, vencidos: 12, agendados: 5, emAberto: 4590000.5 });
    expect(r.pausada).toBe(true);
    expect(r.pausadaMotivo).toBe("auditoria");
  });
  it("o que a rota não mandou é null — a tela mostra traço, nunca soma a página", () => {
    const r = lerRespostaDaFila({ itens: [{ id: 1 }, { id: 2 }] });
    expect(r.total).toBeNull();
    expect(r.kpis).toBeNull();
    expect(lerRespostaDaFila({ itens: [], kpis: { casosVivos: 3 } }).kpis).toEqual({ casosVivos: 3, paraHoje: null, vencidos: null, agendados: null, emAberto: null });
  });
  it("lista crua ainda é aceita", () => {
    expect(lerRespostaDaFila([{ id: 1 }]).itens).toHaveLength(1);
  });
});
