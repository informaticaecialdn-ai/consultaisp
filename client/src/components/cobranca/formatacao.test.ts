import { describe, it, expect } from "vitest";
import {
  agoraInput, dataCivilBr, faixaDoAtraso, faixaDoScore, hojeInput, MOTIVO_CONTATO_NO_PASSADO, proximoContato, rotuloDoAtraso,
  rotuloDoRiskTier, situacaoDoErp, tempoDeCasa, validarProximoContato, whatsappDe, TRACO, deInputDataHora, paraInputDataHora,
} from "./formatacao";

describe("dataCivilBr", () => {
  it("lê a coluna DATE sem passar por new Date — o dia 1 não vira dia 30", () => {
    expect(dataCivilBr("2026-03-01")).toBe("01/03/2026");
    expect(dataCivilBr("2026-03-01T00:00:00.000Z")).toBe("01/03/2026");
  });
  it("sem data é traço, nunca 'Invalid Date'", () => {
    expect(dataCivilBr(null)).toBe(TRACO);
    expect(dataCivilBr("ontem")).toBe(TRACO);
  });
});

describe("faixaDoAtraso", () => {
  /** As faixas acompanham as janelas da régua padrão, não a escala do Provedor.ai. */
  it("acompanha as janelas da régua", () => {
    expect(faixaDoAtraso(1)).toEqual({ tom: "ok", rotulo: "recente" });
    expect(faixaDoAtraso(14)).toEqual({ tom: "ok", rotulo: "recente" });
    expect(faixaDoAtraso(15)).toEqual({ tom: "gated", rotulo: "alerta" });
    expect(faixaDoAtraso(29)).toEqual({ tom: "gated", rotulo: "alerta" });
    expect(faixaDoAtraso(30)).toEqual({ tom: "past", rotulo: "crítico" });
    expect(faixaDoAtraso(89)).toEqual({ tom: "past", rotulo: "crítico" });
    expect(faixaDoAtraso(90)).toEqual({ tom: "danger", rotulo: "grave" });
  });
  it("rotula como a régua", () => {
    expect(rotuloDoAtraso(0)).toBe("D0");
    expect(rotuloDoAtraso(45)).toBe("D+45");
  });
});

describe("tempoDeCasa", () => {
  const hoje = new Date(2026, 8, 5);
  it("anos, meses e menos de um mês", () => {
    expect(tempoDeCasa("2023-01-10", hoje)).toBe("cliente há 3 anos");
    expect(tempoDeCasa("2026-01-10", hoje)).toBe("cliente há 7 meses");
    expect(tempoDeCasa("2025-09-05", hoje)).toBe("cliente há 1 ano");
    expect(tempoDeCasa("2026-08-20", hoje)).toBe("cliente há menos de um mês");
  });
  it("ex-cliente não é 'cliente há' — é adesão", () => {
    expect(tempoDeCasa("2023-01-10", hoje, true)).toBe("adesão há 3 anos");
  });
  it("sem data de contrato não há antiguidade a inventar", () => {
    expect(tempoDeCasa(null, hoje)).toBeNull();
  });
});

describe("situacaoDoErp", () => {
  it("os quatro status do sync têm rótulo e tom", () => {
    expect(situacaoDoErp("active")).toEqual({ rotulo: "Ativo", tom: "ok" });
    expect(situacaoDoErp("suspended")).toEqual({ rotulo: "Suspenso", tom: "gated" });
    expect(situacaoDoErp("cancelled").tom).toBe("past");
    expect(situacaoDoErp("inactive").tom).toBe("past");
  });
  it("status desconhecido sai como veio, em tom neutro — nunca chuta 'Ativo'", () => {
    expect(situacaoDoErp("bloqueado")).toEqual({ rotulo: "bloqueado", tom: "neutro" });
    expect(situacaoDoErp(null).rotulo).toBe(TRACO);
  });
});

describe("proximoContato", () => {
  const hoje = new Date(2026, 8, 5, 15, 0);
  it("conta em dias civis, não em 24h", () => {
    // 23h59 de ontem é ontem, mesmo a 15 horas de distância.
    expect(proximoContato(new Date(2026, 8, 4, 23, 59).toISOString(), hoje)).toEqual({ urgencia: "vencido", texto: "vencido há 1 dia" });
    expect(proximoContato(new Date(2026, 8, 5, 8, 0).toISOString(), hoje)).toEqual({ urgencia: "hoje", texto: "hoje" });
    expect(proximoContato(new Date(2026, 8, 8, 8, 0).toISOString(), hoje)).toEqual({ urgencia: "futuro", texto: "em 3 dias" });
  });
  it("sem data é 'sem data' — está na fila, não vencido", () => {
    expect(proximoContato(null, hoje).urgencia).toBe("sem_data");
  });
});

describe("whatsappDe", () => {
  it("põe o 55 e tira tudo que não é dígito", () => {
    expect(whatsappDe("(34) 99876-5432")).toBe("5534998765432");
    expect(whatsappDe("5534998765432")).toBe("5534998765432");
  });
  it("telefone curto demais não vira link", () => {
    expect(whatsappDe("1234")).toBeNull();
    expect(whatsappDe(null)).toBeNull();
  });
});

describe("faixaDoScore — os cortes de --score-* do DESIGN_SYSTEM", () => {
  it("701+ alto, 501–700 médio, 301–500 baixo, até 300 crítico", () => {
    expect(faixaDoScore(701).faixa).toBe("alto");
    expect(faixaDoScore(700).faixa).toBe("medio");
    expect(faixaDoScore(501).faixa).toBe("medio");
    expect(faixaDoScore(500).faixa).toBe("baixo");
    expect(faixaDoScore(300).faixa).toBe("critico");
  });
});

describe("rotuloDoRiskTier", () => {
  it("os quatro níveis de customers.risk_tier em português", () => {
    expect(rotuloDoRiskTier("low")).toBe("baixo");
    expect(rotuloDoRiskTier("medium")).toBe("médio");
    expect(rotuloDoRiskTier("high")).toBe("alto");
    expect(rotuloDoRiskTier("critical")).toBe("crítico");
  });
  it("desconhecido sai como veio; vazio é null, nunca 'baixo'", () => {
    expect(rotuloDoRiskTier("x")).toBe("x");
    expect(rotuloDoRiskTier(null)).toBeNull();
    expect(rotuloDoRiskTier("")).toBeNull();
  });
});

describe("próximo contato: agora como piso", () => {
  const agora = new Date(2026, 8, 5, 14, 30, 45);
  it("agoraInput é o minuto de agora no formato do datetime-local", () => {
    expect(agoraInput(agora)).toBe("2026-09-05T14:30");
  });
  it("vazio passa (não há agendamento); futuro passa; passado é recusado com o motivo", () => {
    expect(validarProximoContato("", agora)).toBeNull();
    expect(validarProximoContato("2026-09-05T14:31", agora)).toBeNull();
    expect(validarProximoContato("2026-09-05T14:29", agora)).toBe(MOTIVO_CONTATO_NO_PASSADO);
    expect(validarProximoContato("2025-01-01T08:00", agora)).toBe(MOTIVO_CONTATO_NO_PASSADO);
  });
  it("data inválida também é recusada", () => {
    expect(validarProximoContato("ontem", agora)).toMatch(/inválida/);
  });
});

describe("datas de input", () => {
  it("hojeInput é o dia LOCAL, não o UTC", () => {
    expect(hojeInput(new Date(2026, 0, 31, 23, 30))).toBe("2026-01-31");
  });
  it("datetime-local vai e volta no fuso do navegador", () => {
    const iso = deInputDataHora("2026-09-05T14:30");
    expect(iso).not.toBeNull();
    expect(paraInputDataHora(iso)).toBe("2026-09-05T14:30");
    expect(deInputDataHora("")).toBeNull();
  });
});
