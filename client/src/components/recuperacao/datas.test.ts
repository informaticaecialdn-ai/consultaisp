import { describe, expect, it } from "vitest";
import { dataBr, dataCurta, dataHoraBr, deInputDataHora, ehDataCivil, hojeInput, paraInputDataHora } from "./datas";

/**
 * O bug que este módulo existe para impedir: rescisão gravada como
 * 2026-08-16T00:00:00.000Z exibida como 15/08 num navegador em UTC-3, com o
 * kanban contando dias a partir de 16/08. Os testes não dependem do fuso da
 * máquina: a data civil tem que sair igual em qualquer lugar.
 */
describe("data civil (meia-noite UTC) sai no dia certo em qualquer fuso", () => {
  it("reconhece a meia-noite UTC exata como data civil, e só ela", () => {
    expect(ehDataCivil("2026-08-16T00:00:00.000Z")).toBe(true);
    expect(ehDataCivil("2026-08-16T03:00:00.000Z")).toBe(false);
    expect(ehDataCivil("2026-09-03T02:04:02.289Z")).toBe(false);
  });

  it("dataBr e dataCurta formatam a data civil em UTC", () => {
    expect(dataBr("2026-08-16T00:00:00.000Z")).toBe("16/08/2026");
    expect(dataCurta("2026-08-16T00:00:00.000Z")).toBe("16/08");
    expect(dataBr("2026-01-01T00:00:00.000Z")).toBe("01/01/2026");
  });

  it("dataHoraBr não inventa hora para data civil", () => {
    expect(dataHoraBr("2026-08-16T00:00:00.000Z")).toBe("16/08/2026");
  });

  it("instante real sai com hora", () => {
    expect(dataHoraBr("2026-09-03T02:04:02.289Z")).toMatch(/^\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}$/);
  });

  it("vazio vira traço", () => {
    expect(dataBr(null)).toBe("—");
    expect(dataHoraBr(undefined)).toBe("—");
  });
});

describe("hoje e o input datetime-local no calendário do operador", () => {
  it("hojeInput usa o dia local, não o dia UTC", () => {
    const d = new Date(2026, 8, 2, 22, 30); // 2 de setembro, 22h30 locais
    expect(hojeInput(d)).toBe("2026-09-02");
  });

  it("paraInputDataHora e deInputDataHora são inversas no fuso local", () => {
    const iso = new Date(2026, 8, 5, 14, 30).toISOString();
    expect(paraInputDataHora(iso)).toBe("2026-09-05T14:30");
    expect(deInputDataHora("2026-09-05T14:30")).toBe(iso);
    expect(paraInputDataHora(null)).toBe("");
    expect(paraInputDataHora("nada")).toBe("");
  });
});
