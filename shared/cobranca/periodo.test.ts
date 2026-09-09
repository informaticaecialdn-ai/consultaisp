import { describe, expect, it } from "vitest";
import {
  deslocarPeriodo, dentroDoPeriodo, formatarPeriodo, janelaDoPeriodo, janelaDoPeriodoEmDias, mesDoDia,
  mesesDoPeriodo, parsePeriodo, periodoDaData, periodoDoMes, reenquadrar, rotuloDoPeriodo,
} from "./periodo";

describe("o texto canônico do período", () => {
  it("lê e escreve as quatro granularidades, e recusa o resto", () => {
    for (const t of ["2026-09", "2026-T3", "2026-S2", "2026"]) expect(formatarPeriodo(parsePeriodo(t)!)).toBe(t);
    expect(parsePeriodo("2026-09")).toEqual({ granularidade: "mes", ano: 2026, indice: 9 });
    expect(parsePeriodo("2026-T3")).toEqual({ granularidade: "trimestre", ano: 2026, indice: 3 });
    expect(parsePeriodo("2026-S2")).toEqual({ granularidade: "semestre", ano: 2026, indice: 2 });
    expect(parsePeriodo("2026")).toEqual({ granularidade: "ano", ano: 2026, indice: 1 });
    for (const ruim of ["2026-13", "2026-T5", "2026-S3", "26-09", "set/26", "", null, undefined, "2026-9", "2026-t3"]) {
      expect(parsePeriodo(ruim)).toBeNull();
    }
  });
  it("rotula como o Provedor.ai escreve: set/26 · T3/26 · S2/26 · 2026", () => {
    expect(rotuloDoPeriodo(parsePeriodo("2026-09")!)).toBe("set/26");
    expect(rotuloDoPeriodo(parsePeriodo("2026-T3")!)).toBe("T3/26");
    expect(rotuloDoPeriodo(parsePeriodo("2026-S2")!)).toBe("S2/26");
    expect(rotuloDoPeriodo(parsePeriodo("2026")!)).toBe("2026");
  });
});

describe("a janela [de, ate)", () => {
  it("vai do primeiro dia do período ao primeiro do seguinte", () => {
    const t3 = janelaDoPeriodo(parsePeriodo("2026-T3")!);
    expect(t3.de).toEqual(new Date(2026, 6, 1));
    expect(t3.ate).toEqual(new Date(2026, 9, 1));
    const s2 = janelaDoPeriodo(parsePeriodo("2026-S2")!);
    expect(s2.de).toEqual(new Date(2026, 6, 1));
    expect(s2.ate).toEqual(new Date(2027, 0, 1));
    const dez = janelaDoPeriodo(parsePeriodo("2026-12")!);
    expect(dez.ate).toEqual(new Date(2027, 0, 1));
  });
  it("dentroDoPeriodo: o último instante entra, o primeiro do seguinte não", () => {
    const p = parsePeriodo("2026-09")!;
    expect(dentroDoPeriodo(new Date(2026, 8, 30, 23, 59, 59), p)).toBe(true);
    expect(dentroDoPeriodo(new Date(2026, 9, 1), p)).toBe(false);
    expect(dentroDoPeriodo(new Date(2026, 7, 31), p)).toBe(false);
  });
});

describe("navegar e reenquadrar", () => {
  it("periodoDaData acha o período de qualquer dia", () => {
    const d = new Date(2026, 8, 9);
    expect(formatarPeriodo(periodoDaData(d, "mes"))).toBe("2026-09");
    expect(formatarPeriodo(periodoDaData(d, "trimestre"))).toBe("2026-T3");
    expect(formatarPeriodo(periodoDaData(d, "semestre"))).toBe("2026-S2");
    expect(formatarPeriodo(periodoDaData(d, "ano"))).toBe("2026");
  });
  it("deslocar vira o ano nas quatro granularidades", () => {
    expect(formatarPeriodo(deslocarPeriodo(parsePeriodo("2026-01")!, -1))).toBe("2025-12");
    expect(formatarPeriodo(deslocarPeriodo(parsePeriodo("2026-T1")!, -1))).toBe("2025-T4");
    expect(formatarPeriodo(deslocarPeriodo(parsePeriodo("2026-S1")!, -1))).toBe("2025-S2");
    expect(formatarPeriodo(deslocarPeriodo(parsePeriodo("2026")!, 1))).toBe("2027");
    expect(formatarPeriodo(deslocarPeriodo(parsePeriodo("2026-T4")!, 2))).toBe("2027-T2");
  });
  it("trocar a granularidade mantém o instante: set/26 está em T3/26, S2/26 e 2026", () => {
    const set = parsePeriodo("2026-09")!;
    expect(formatarPeriodo(reenquadrar(set, "trimestre"))).toBe("2026-T3");
    expect(formatarPeriodo(reenquadrar(set, "semestre"))).toBe("2026-S2");
    expect(formatarPeriodo(reenquadrar(set, "ano"))).toBe("2026");
    // E de volta ao mês: o PRIMEIRO mês do período maior.
    expect(formatarPeriodo(reenquadrar(parsePeriodo("2026-T3")!, "mes"))).toBe("2026-07");
  });
});

describe("a janela como dia de calendário — o que vai para o SQL", () => {
  it("é texto 'AAAA-MM-DD', sem Date e sem fuso, e vira o ano", () => {
    expect(janelaDoPeriodoEmDias(parsePeriodo("2026-T3")!)).toEqual({ de: "2026-07-01", ate: "2026-10-01" });
    expect(janelaDoPeriodoEmDias(parsePeriodo("2026-12")!)).toEqual({ de: "2026-12-01", ate: "2027-01-01" });
    expect(janelaDoPeriodoEmDias(parsePeriodo("2026-S2")!)).toEqual({ de: "2026-07-01", ate: "2027-01-01" });
    expect(janelaDoPeriodoEmDias(parsePeriodo("2026")!)).toEqual({ de: "2026-01-01", ate: "2027-01-01" });
    expect(janelaDoPeriodoEmDias(parsePeriodo("2026-T4")!)).toEqual({ de: "2026-10-01", ate: "2027-01-01" });
  });
  it("o mês de um dia e o período de um mês saem só de texto", () => {
    expect(mesDoDia("2026-09-01")).toBe("2026-09");
    expect(formatarPeriodo(periodoDoMes("2026-09", "trimestre")!)).toBe("2026-T3");
    expect(formatarPeriodo(periodoDoMes("2026-06", "semestre")!)).toBe("2026-S1");
    expect(formatarPeriodo(periodoDoMes("2026-01", "ano")!)).toBe("2026");
    expect(periodoDoMes("2026-T3", "ano")).toBeNull();
  });
  it("a série do período é a lista dos seus meses", () => {
    expect(mesesDoPeriodo(parsePeriodo("2026-T3")!)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(mesesDoPeriodo(parsePeriodo("2026-09")!)).toEqual(["2026-09"]);
    expect(mesesDoPeriodo(parsePeriodo("2026")!)).toHaveLength(12);
  });
});
