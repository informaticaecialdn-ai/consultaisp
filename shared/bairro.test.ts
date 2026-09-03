import { describe, expect, it } from "vitest";
import { isSetorInterno, mostrarAvisoSetor, provedorUsaMk } from "./bairro";

describe("isSetorInterno", () => {
  it("reconhece a zona interna do MK em qualquer caixa e espacamento", () => {
    expect(isSetorInterno("Setor 3")).toBe(true);
    expect(isSetorInterno("SETOR 12")).toBe(true);
    expect(isSetorInterno("setor7")).toBe(true);
    expect(isSetorInterno("  Setor 01  ")).toBe(true);
  });

  it("nao confunde bairro real que comeca com Setor", () => {
    // Goiania e cheia de bairros "Setor <nome>" — sao bairros de verdade,
    // com match no IBGE. So o numero puro e zona interna.
    expect(isSetorInterno("Setor Bueno")).toBe(false);
    expect(isSetorInterno("Setor Oeste")).toBe(false);
    expect(isSetorInterno("Setor 3 Norte")).toBe(false);
    expect(isSetorInterno("Setor")).toBe(false);
  });

  it("ignora nome vazio ou ausente", () => {
    expect(isSetorInterno("")).toBe(false);
    expect(isSetorInterno("   ")).toBe(false);
    expect(isSetorInterno(null)).toBe(false);
    expect(isSetorInterno(undefined)).toBe(false);
  });

  it("nao aceita numero no meio nem prefixo diferente", () => {
    expect(isSetorInterno("Zona 3")).toBe(false);
    expect(isSetorInterno("Centro")).toBe(false);
    expect(isSetorInterno("3 Setor")).toBe(false);
  });
});

describe("provedorUsaMk", () => {
  it("so conta o MK quando esta ligado", () => {
    expect(provedorUsaMk([{ erpSource: "mk", isEnabled: true, status: "idle" }])).toBe(true);
    expect(provedorUsaMk([
      { erpSource: "ixc", isEnabled: true, status: "idle" },
      { erpSource: "mk", isEnabled: true, status: "idle" },
    ])).toBe(true);
  });

  it("MK desligado pelo suporte nao conta — a integracao foi encerrada", () => {
    expect(provedorUsaMk([{ erpSource: "mk", isEnabled: false, status: "idle" }])).toBe(false);
  });

  it("MK pausado por falhas ainda conta: o ERP continua sendo MK, so parou de sincronizar, e os 'Setor N' na tela vieram dele", () => {
    expect(provedorUsaMk([
      { erpSource: "mk", isEnabled: false, status: "pausado_por_falhas" },
    ])).toBe(true);
  });

  it("outro ERP ligado nao e MK", () => {
    expect(provedorUsaMk([{ erpSource: "ixc", isEnabled: true, status: "idle" }])).toBe(false);
    expect(provedorUsaMk([{ erpSource: "sgp", isEnabled: true, status: "idle" }])).toBe(false);
    expect(provedorUsaMk([])).toBe(false);
  });

  it("outro ERP pausado por falhas nao vira MK", () => {
    expect(provedorUsaMk([
      { erpSource: "ixc", isEnabled: false, status: "pausado_por_falhas" },
    ])).toBe(false);
  });

  it("lista ausente vale nao usa — a query pode estar carregando", () => {
    expect(provedorUsaMk(undefined)).toBe(false);
    expect(provedorUsaMk(null)).toBe(false);
  });
});

describe("mostrarAvisoSetor", () => {
  const semBases = { bairro: "Setor 3", hps: null, ucsVivas: null };

  it("avisa quando nada casou, o provedor usa MK e o nome e Setor N", () => {
    expect(mostrarAvisoSetor(semBases, true)).toBe(true);
  });

  it("provedor sem MK: 'Setor 3' pode ser bairro oficial de GO/TO — rotulo generico", () => {
    expect(mostrarAvisoSetor(semBases, false)).toBe(false);
  });

  it("se alguma base casou, o funil tem numero e o aviso mentiria", () => {
    expect(mostrarAvisoSetor({ bairro: "Setor 3", hps: 812, ucsVivas: null }, true)).toBe(false);
    expect(mostrarAvisoSetor({ bairro: "Setor 3", hps: null, ucsVivas: 640 }, true)).toBe(false);
    expect(mostrarAvisoSetor({ bairro: "Setor 3", hps: 812, ucsVivas: 640 }, true)).toBe(false);
  });

  it("bairro real sem match continua com o rotulo generico mesmo no MK", () => {
    expect(mostrarAvisoSetor({ bairro: "Setor Bueno", hps: null, ucsVivas: null }, true)).toBe(false);
    expect(mostrarAvisoSetor({ bairro: "Centro", hps: null, ucsVivas: null }, true)).toBe(false);
  });
});
