import { describe, expect, it } from "vitest";
import {
  avaliarRiscoDeFuga, rotuloDoAlerta, severidadeDoAlerta, parseDataContrato, motivosGravados,
  DIVIDA_MINIMA, DIAS_MINIMOS_ATRASO,
  type ClienteParaAvaliar,
} from "./antifraude-rules";
import { REGRAS_PADRAO, montarRegras, desmontarRegras, type RegrasAntiFraude } from "@shared/antifraude-regras";

/**
 * O conceito, nas palavras do dono (02/09/2026): o anti-fraude avisa quando
 * um cliente COM CONTRATO ATIVO e consultado por um provedor parceiro — e o
 * provedor escolhe QUAL cliente ativo (padrao: so quem esta devendo). Cada
 * bloco abaixo e uma fronteira desse conceito.
 */

const HOJE = new Date("2026-09-02T12:00:00Z");
const outro = { consultanteEhDono: false, agora: HOJE };

const cliente = (over: Partial<ClienteParaAvaliar> = {}): ClienteParaAvaliar => ({
  totalOverdueAmount: 0,
  maxDaysOverdue: 0,
  ...over,
});

const regras = (over: Partial<{ [K in keyof RegrasAntiFraude]: Partial<RegrasAntiFraude[K]> }> = {}): RegrasAntiFraude => ({
  ativo_inadimplente: { ...REGRAS_PADRAO.ativo_inadimplente, ...over.ativo_inadimplente },
  contrato_novo: { ...REGRAS_PADRAO.contrato_novo, ...over.contrato_novo },
  consultas_repetidas: { ...REGRAS_PADRAO.consultas_repetidas, ...over.consultas_repetidas },
  ativo_qualquer: { ...REGRAS_PADRAO.ativo_qualquer, ...over.ativo_qualquer },
});

describe("quem NAO e cliente nao gera alerta — nenhuma regra passa por cima disto", () => {
  const tudoLigado = regras({
    contrato_novo: { ativo: true },
    consultas_repetidas: { ativo: true },
    ativo_qualquer: { ativo: true },
  });

  it("status ausente nunca vira alerta — nao se presume que e cliente", () => {
    const r = avaliarRiscoDeFuga(cliente({ totalOverdueAmount: 800, maxDaysOverdue: 40 }), { ...outro, regras: tudoLigado, consultasDeOutros: 5 });
    expect(r.alerta).toBe(false);
    expect(r.descartadoPor).toBe("status_desconhecido");
  });

  it("ex-cliente nao gera alerta, por maior que seja a divida — isso e bureau, nao fuga", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 10_000, maxDaysOverdue: 200, contractStatus: "cancelled", contractStartDate: "2026-08-20" }),
      { ...outro, regras: tudoLigado, consultasDeOutros: 5 },
    );
    expect(r.alerta).toBe(false);
    expect(r.descartadoPor).toBe("contrato_cancelado");
  });

  it("consulta do proprio dono nunca e fuga", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 900, maxDaysOverdue: 40, contractStatus: "active" }),
      { consultanteEhDono: true, agora: HOJE, regras: tudoLigado },
    );
    expect(r.alerta).toBe(false);
    expect(r.descartadoPor).toBe("consulta_do_proprio_dono");
  });
});

describe("padrao: cliente ativo e inadimplente, consultado por outro", () => {
  it("dispara com fatura vencida, sem precisar de regras gravadas", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 199.9, maxDaysOverdue: 12, contractStatus: "active" }),
      outro,
    );
    expect(r.alerta).toBe(true);
    expect(r.motivos).toEqual(["divida_ativa"]);
  });

  it("um dia de atraso ja e inadimplente — a regua e a mesma do mapa e do relatorio", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 99.9, maxDaysOverdue: DIAS_MINIMOS_ATRASO, contractStatus: "active" }),
      outro,
    );
    expect(r.alerta).toBe(true);
  });

  it("suspenso por falta de pagamento AINDA e cliente — e o perfil que migra", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 400, maxDaysOverdue: 45, contractStatus: "suspended" }),
      outro,
    );
    expect(r.alerta).toBe(true);
  });

  it("NAO ha teto de atraso: se o ERP diz que o contrato esta ativo, ha servico ligado e fuga a impedir", () => {
    for (const dias of [91, 207, 2786]) {
      const r = avaliarRiscoDeFuga(
        cliente({ totalOverdueAmount: 1531, maxDaysOverdue: dias, contractStatus: "active" }),
        outro,
      );
      expect(r.alerta, `${dias} dias`).toBe(true);
    }
  });

  it("residuo de fatura nao move ninguem de provedor", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: DIVIDA_MINIMA - 0.01, maxDaysOverdue: 40, contractStatus: "active" }),
      outro,
    );
    expect(r.alerta).toBe(false);
    expect(r.descartadoPor).toBe("nenhuma_regra");
  });

  it("cliente ativo e em dia, sendo consultado, nao e alerta no padrao", () => {
    const r = avaliarRiscoDeFuga(cliente({ contractStatus: "active" }), outro);
    expect(r.alerta).toBe(false);
    expect(r.descartadoPor).toBe("nenhuma_regra");
  });

  it("contrato novo EM DIA nao e alerta no padrao — a regra de cliente novo vem desligada", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ contractStatus: "active", contractStartDate: "2026-08-20" }),
      outro,
    );
    expect(r.alerta).toBe(false);
    expect(r.diasDeContrato).toBe(13);
  });
});

describe("as regras do provedor", () => {
  it("o provedor pode subir a regua da divida — abaixo dela nao ha aviso", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 150, maxDaysOverdue: 10, contractStatus: "active" }),
      { ...outro, regras: regras({ ativo_inadimplente: { valorMinimo: 200, diasMinimo: 15 } }) },
    );
    expect(r.alerta).toBe(false);
    const r2 = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 250, maxDaysOverdue: 20, contractStatus: "active" }),
      { ...outro, regras: regras({ ativo_inadimplente: { valorMinimo: 200, diasMinimo: 15 } }) },
    );
    expect(r2.motivos).toEqual(["divida_ativa"]);
  });

  it("com a regra de inadimplente desligada, a divida sozinha nao avisa", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ totalOverdueAmount: 900, maxDaysOverdue: 60, contractStatus: "active" }),
      { ...outro, regras: regras({ ativo_inadimplente: { ativo: false } }) },
    );
    expect(r.alerta).toBe(false);
  });

  it("cliente novo: dispara ate N dias de contrato, em dia ou nao", () => {
    const comNovo = regras({ contrato_novo: { ativo: true, diasMaximo: 90 } });
    const novo = avaliarRiscoDeFuga(cliente({ contractStatus: "active", contractStartDate: "2026-07-15" }), { ...outro, regras: comNovo });
    expect(novo.motivos).toEqual(["contrato_novo"]);
    const antigo = avaliarRiscoDeFuga(cliente({ contractStatus: "active", contractStartDate: "2026-05-01" }), { ...outro, regras: comNovo });
    expect(antigo.alerta).toBe(false);
  });

  it("cliente novo: sem data de contrato a regra NAO dispara — nao se presume", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ contractStatus: "active" }),
      { ...outro, regras: regras({ contrato_novo: { ativo: true } }) },
    );
    expect(r.alerta).toBe(false);
    expect(r.descartadoPor).toBe("nenhuma_regra");
  });

  it("consultas repetidas: conta provedores DIFERENTES do dono, em 30 dias", () => {
    const com = regras({ consultas_repetidas: { ativo: true, provedoresMinimos: 2 } });
    expect(avaliarRiscoDeFuga(cliente({ contractStatus: "active" }), { ...outro, regras: com, consultasDeOutros: 1 }).alerta).toBe(false);
    expect(avaliarRiscoDeFuga(cliente({ contractStatus: "active" }), { ...outro, regras: com, consultasDeOutros: 2 }).motivos).toEqual(["consultas_repetidas"]);
  });

  it("qualquer cliente ativo: todo cliente ativo consultado avisa", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ contractStatus: "active" }),
      { ...outro, regras: regras({ ativo_qualquer: { ativo: true } }) },
    );
    expect(r.motivos).toEqual(["cliente_ativo"]);
  });

  it("varias regras batendo: todos os motivos, na ordem de prioridade", () => {
    const r = avaliarRiscoDeFuga(
      cliente({ contractStatus: "active", contractStartDate: "2026-08-20", totalOverdueAmount: 120, maxDaysOverdue: 5 }),
      {
        ...outro,
        consultasDeOutros: 3,
        regras: regras({ contrato_novo: { ativo: true }, consultas_repetidas: { ativo: true }, ativo_qualquer: { ativo: true } }),
      },
    );
    expect(r.motivos).toEqual(["divida_ativa", "consultas_repetidas", "contrato_novo", "cliente_ativo"]);
  });
});

describe("data de contrato", () => {
  it("aceita ISO e BR, e e so informativa", () => {
    expect(avaliarRiscoDeFuga(cliente({ contractStatus: "active", contractStartDate: "15/07/2026" }), outro).diasDeContrato).toBe(49);
    expect(avaliarRiscoDeFuga(cliente({ contractStatus: "active", contractStartDate: "2026-07-15" }), outro).diasDeContrato).toBe(49);
  });

  it.each(["", "0000-00-00", "nao informado", "31/31/2026"])("%s vira null", (v) => {
    expect(parseDataContrato(v)).toBeNull();
  });
});

describe("rotulo e severidade", () => {
  it("o rotulo diz o que o alerta e, pelo motivo principal", () => {
    expect(rotuloDoAlerta(["divida_ativa"])).toBe("Fuga · cliente ativo com dívida");
    expect(rotuloDoAlerta(["cliente_ativo", "contrato_novo"])).toBe("Cliente novo consultado por outro provedor");
    expect(rotuloDoAlerta(["cliente_ativo", "consultas_repetidas"])).toBe("Cliente ativo consultado por vários provedores");
    expect(rotuloDoAlerta(["cliente_ativo"])).toBe("Cliente ativo consultado por outro provedor");
  });

  it("severidade sobe com o prejuizo em jogo", () => {
    expect(severidadeDoAlerta(["divida_ativa"], { totalOverdueAmount: 99, maxDaysOverdue: 5 })).toBe("medium");
    expect(severidadeDoAlerta(["divida_ativa"], { totalOverdueAmount: 250, maxDaysOverdue: 5 })).toBe("high");
    expect(severidadeDoAlerta(["divida_ativa"], { totalOverdueAmount: 99, maxDaysOverdue: 35 })).toBe("high");
    expect(severidadeDoAlerta(["divida_ativa"], { totalOverdueAmount: 900, maxDaysOverdue: 5 })).toBe("critical");
    expect(severidadeDoAlerta(["divida_ativa"], { totalOverdueAmount: 99, maxDaysOverdue: 70 })).toBe("critical");
  });

  it("sem divida, insistencia pesa mais que retencao", () => {
    expect(severidadeDoAlerta(["consultas_repetidas"], { totalOverdueAmount: 0, maxDaysOverdue: 0 })).toBe("high");
    expect(severidadeDoAlerta(["contrato_novo"], { totalOverdueAmount: 0, maxDaysOverdue: 0 })).toBe("medium");
    expect(severidadeDoAlerta(["cliente_ativo"], { totalOverdueAmount: 0, maxDaysOverdue: 0 })).toBe("medium");
  });

  it("le de volta os motivos gravados em riskFactors, ignorando o resto", () => {
    expect(motivosGravados(["consulta_outro_provedor", "contrato_novo", "erp_ao_vivo", "divida_ativa"])).toEqual(["divida_ativa", "contrato_novo"]);
    expect(motivosGravados(null)).toEqual([]);
  });
});

describe("montar e desmontar regras", () => {
  it("sem linha gravada vale o padrao", () => {
    expect(montarRegras([])).toEqual(REGRAS_PADRAO);
  });

  it("linha gravada vence o padrao; parametro invalido cai no padrao", () => {
    const r = montarRegras([
      { tipo: "ativo_inadimplente", ativo: true, parametros: { valorMinimo: 150, diasMinimo: "x" } },
      { tipo: "contrato_novo", ativo: true, parametros: null },
    ]);
    expect(r.ativo_inadimplente).toEqual({ ativo: true, valorMinimo: 150, diasMinimo: 1 });
    expect(r.contrato_novo).toEqual({ ativo: true, diasMaximo: 90 });
    expect(r.ativo_qualquer.ativo).toBe(false);
  });

  it("desmontar e montar e identidade", () => {
    const custom = regras({ ativo_inadimplente: { valorMinimo: 75 }, ativo_qualquer: { ativo: true } });
    expect(montarRegras(desmontarRegras(custom))).toEqual(custom);
  });
});
