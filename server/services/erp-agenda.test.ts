import { describe, it, expect } from "vitest";
import {
  agendaDoAmbiente, proximaExecucao, ultimaExecucaoAgendada, descreverAgenda,
  DIAS_PADRAO, HORA_PADRAO,
} from "./erp-agenda";

// 2026-08-27 e uma QUINTA (dia 4).
const quinta1600 = new Date(2026, 7, 27, 16, 0, 0);

describe("agendaDoAmbiente", () => {
  it("sem env, cai no padrao seg/qua/sex as 03:00", () => {
    const a = agendaDoAmbiente({} as any);
    expect(a.dias).toEqual(DIAS_PADRAO);
    expect(a.hora).toBe(HORA_PADRAO);
  });

  it("le, ordena e deduplica os dias do env", () => {
    expect(agendaDoAmbiente({ ERP_SYNC_DIAS: "5,1,3,1" } as any).dias).toEqual([1, 3, 5]);
  });

  it("ignora lixo e valor fora da faixa, sem quebrar", () => {
    expect(agendaDoAmbiente({ ERP_SYNC_DIAS: "9,-1,abc" } as any).dias).toEqual(DIAS_PADRAO);
    expect(agendaDoAmbiente({ ERP_SYNC_HORA: "99" } as any).hora).toBe(HORA_PADRAO);
    expect(agendaDoAmbiente({ ERP_SYNC_HORA: "0" } as any).hora).toBe(0);
  });
});

describe("proximaExecucao", () => {
  it("de quinta 16h, a proxima e sexta 03:00", () => {
    const p = proximaExecucao(quinta1600, [1, 3, 5], 3);
    expect(p.getDay()).toBe(5);
    expect(p.getDate()).toBe(28);
    expect(p.getHours()).toBe(3);
  });

  it("de sexta 04h (janela recem-passada), pula para segunda", () => {
    const p = proximaExecucao(new Date(2026, 7, 28, 4, 0, 0), [1, 3, 5], 3);
    expect(p.getDay()).toBe(1);
    expect(p.getDate()).toBe(31);
  });

  it("de sexta 02h, ainda pega a propria sexta", () => {
    const p = proximaExecucao(new Date(2026, 7, 28, 2, 0, 0), [1, 3, 5], 3);
    expect(p.getDay()).toBe(5);
    expect(p.getDate()).toBe(28);
  });

  it("e sempre ESTRITAMENTE depois de agora — nunca devolve o instante atual", () => {
    const emCima = new Date(2026, 7, 28, 3, 0, 0); // sexta 03:00 exata
    expect(proximaExecucao(emCima, [1, 3, 5], 3).getTime()).toBeGreaterThan(emCima.getTime());
  });

  it("atravessa a virada de mes", () => {
    // 2026-08-31 e segunda; a proxima e quarta 02/09.
    const p = proximaExecucao(new Date(2026, 7, 31, 5, 0, 0), [1, 3, 5], 3);
    expect(p.getMonth()).toBe(8);
    expect(p.getDate()).toBe(2);
  });
});

describe("ultimaExecucaoAgendada", () => {
  it("de quinta 16h, a ultima foi quarta 03:00", () => {
    const u = ultimaExecucaoAgendada(quinta1600, [1, 3, 5], 3);
    expect(u.getDay()).toBe(3);
    expect(u.getDate()).toBe(26);
  });

  it("de sexta 02h, a ultima ainda e quarta — a de sexta nao chegou", () => {
    const u = ultimaExecucaoAgendada(new Date(2026, 7, 28, 2, 0, 0), [1, 3, 5], 3);
    expect(u.getDate()).toBe(26);
  });

  it("de sexta 04h, a ultima ja e a propria sexta", () => {
    const u = ultimaExecucaoAgendada(new Date(2026, 7, 28, 4, 0, 0), [1, 3, 5], 3);
    expect(u.getDate()).toBe(28);
  });

  /**
   * O par que define o comportamento de recuperacao: um sync feito DEPOIS da
   * ultima janela dispensa o boot; um feito ANTES obriga a rodar, que e o caso
   * do processo que estava fora do ar na madrugada agendada.
   */
  it("decide o boot: sync depois da janela dispensa, antes obriga", () => {
    const agora = new Date(2026, 7, 28, 10, 0, 0); // sexta 10h
    const janela = ultimaExecucaoAgendada(agora, [1, 3, 5], 3); // sexta 03:00
    const sincronizouDepois = new Date(2026, 7, 28, 3, 40, 0);
    const sincronizouAntes = new Date(2026, 7, 27, 22, 0, 0);
    expect(sincronizouDepois >= janela).toBe(true);
    expect(sincronizouAntes >= janela).toBe(false);
  });

  it("nunca devolve data futura", () => {
    const agora = new Date(2026, 7, 27, 1, 0, 0);
    expect(ultimaExecucaoAgendada(agora, [1, 3, 5], 3).getTime()).toBeLessThanOrEqual(agora.getTime());
  });
});

describe("descreverAgenda", () => {
  it("descreve em portugues", () => {
    expect(descreverAgenda([1, 3, 5], 3)).toBe("segunda, quarta, sexta as 03:00");
  });
});
