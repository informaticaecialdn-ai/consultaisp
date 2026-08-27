import { describe, expect, it } from "vitest";
import {
  avaliarRiscoDeFuga, rotuloDoAlerta, severidadeDoAlerta, parseDataContrato,
  type ClienteParaAvaliar,
} from "./antifraude-rules";

const HOJE = new Date("2026-08-27T12:00:00Z");
const outro = { consultanteEhDono: false, agora: HOJE };

const cliente = (over: Partial<ClienteParaAvaliar> = {}): ClienteParaAvaliar => ({
  totalOverdueAmount: 0,
  maxDaysOverdue: 0,
  ...over,
});

describe("o caso que motivou a correcao — devedor cronico nao e fuga", () => {
  // A tela mostrava dois registros com 2786 e 1640 dias de atraso rotulados
  // "DEVEDOR CRONICO". Sete e quatro anos de atraso nao descrevem um cliente
  // ativo prestes a migrar: descrevem baixa contabil que ficou na base.
  it("2786 dias de atraso sem status de contrato nao gera alerta", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 4644.71, maxDaysOverdue: 2786 }),
      outro,
    );
    expect(r.alerta).toBe(false);
    expect(r.descartadoPor).toBe("atraso_incompativel_com_cliente_ativo");
  });

  it("nem se o ERP jurar que esta ativo — ninguem fica 7 anos conectado sem pagar", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 4644.71, maxDaysOverdue: 2786, contractStatus: "active" }),
      outro,
    );
    expect(r.alerta).toBe(false);
    expect(r.descartadoPor).toBe("atraso_incompativel_com_cliente_ativo");
  });

  it("atraso longo mas dentro da janela ainda e fuga — 6 meses devendo e o perfil classico", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 600, maxDaysOverdue: 180, contractStatus: "suspended" }),
      outro,
    );
    expect(r.alerta).toBe(true);
    expect(r.motivos).toEqual(["divida_ativa"]);
  });

  it("consulta do proprio dono nunca e fuga", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 900, maxDaysOverdue: 40, contractStatus: "active" }),
      { consultanteEhDono: true, agora: HOJE },
    );
    expect(r.alerta).toBe(false);
    expect(r.descartadoPor).toBe("consulta_do_proprio_dono");
  });

  it("ex-cliente nao gera alerta, por maior que seja a divida", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 10_000, maxDaysOverdue: 200, contractStatus: "cancelled" }),
      outro,
    );
    expect(r.alerta).toBe(false);
    expect(r.descartadoPor).toBe("contrato_cancelado");
  });
});

describe("condicao (a) — cliente ativo com divida", () => {
  it("dispara com divida material e atraso real", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 180, maxDaysOverdue: 35, contractStatus: "active" }),
      outro,
    );
    expect(r.alerta).toBe(true);
    expect(r.motivos).toEqual(["divida_ativa"]);
  });

  it("suspenso por falta de pagamento AINDA e cliente — e o perfil que migra", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 180, maxDaysOverdue: 35, contractStatus: "suspended" }),
      outro,
    );
    expect(r.alerta).toBe(true);
  });

  it("residuo de fatura nao move ninguem de provedor", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 12.9, maxDaysOverdue: 40, contractStatus: "active" }),
      outro,
    );
    expect(r.alerta).toBe(false);
    expect(r.descartadoPor).toBe("sem_divida_nem_contrato_novo");
  });

  it("atraso de boleto de poucos dias nao e inadimplencia", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 300, maxDaysOverdue: 3, contractStatus: "active" }),
      outro,
    );
    expect(r.alerta).toBe(false);
  });

  it("cliente ativo e em dia, sendo consultado, nao e alerta", () => {
    const r = avaliarRiscoDeFuga(cliente({ contractStatus: "active" }), outro);
    expect(r.alerta).toBe(false);
    expect(r.descartadoPor).toBe("sem_divida_nem_contrato_novo");
  });
});

describe("condicao (b) — contrato com menos de 90 dias", () => {
  it("cliente novo em dia dispara mesmo sem divida", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ contractStatus: "active", contractStartDate: "2026-07-15" }),
      outro,
    );
    expect(r.alerta).toBe(true);
    expect(r.motivos).toEqual(["contrato_recente"]);
    expect(r.diasDeContrato).toBe(43);
  });

  it("contrato de 90 dias exatos ja saiu da janela", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ contractStatus: "active", contractStartDate: "2026-05-29" }),
      outro,
    );
    expect(r.diasDeContrato).toBe(90);
    expect(r.alerta).toBe(false);
  });

  it("cliente antigo em dia nao dispara", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ contractStatus: "active", contractStartDate: "2021-03-10" }),
      outro,
    );
    expect(r.alerta).toBe(false);
  });

  it("aceita data em formato brasileiro, que e o que o IXC devolve", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ contractStatus: "active", contractStartDate: "15/07/2026" }),
      outro,
    );
    expect(r.alerta).toBe(true);
    expect(r.diasDeContrato).toBe(43);
  });

  it("sem data de contrato a condicao (b) apenas nao dispara — nao vira falso positivo", () => {
    const r = avaliarRiscoDeFuga(cliente({ contractStatus: "active" }), outro);
    expect(r.alerta).toBe(false);
    expect(r.diasDeContrato).toBeUndefined();
  });
});

describe("data de contrato lixo nao derruba a avaliacao", () => {
  it.each(["", "0000-00-00", "nao informado", "31/31/2026"])("%s vira null", (v) => {
    expect(parseDataContrato(v)).toBeNull();
  });
});

describe("rotulo e severidade saem do motivo, nao do numero de dias", () => {
  it("contrato novo E devendo e o pior caso", () => {
    const c = cliente({ totalOverdueAmount: 200, maxDaysOverdue: 30, contractStatus: "active", contractStartDate: "2026-07-15" });
    const r = avaliarRiscoDeFuga(c, outro);
    expect(r.motivos).toEqual(["divida_ativa", "contrato_recente"]);
    expect(rotuloDoAlerta(r.motivos)).toBe("Fuga · dívida em contrato novo");
    expect(severidadeDoAlerta(r.motivos, c)).toBe("critical");
  });

  it("so contrato novo — rotulo proprio, nunca 'devedor cronico'", () => {
    expect(rotuloDoAlerta(["contrato_recente"])).toBe("Fuga · contrato recente");
  });

  it("divida alta em cliente antigo e alta, nao critica", () => {
    const c = cliente({ totalOverdueAmount: 900, maxDaysOverdue: 70, contractStatus: "active" });
    expect(severidadeDoAlerta(["divida_ativa"], c)).toBe("high");
  });
});
