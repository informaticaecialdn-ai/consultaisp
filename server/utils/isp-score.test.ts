import { describe, expect, it } from "vitest";
import { calcularScoreISP, type ISPScoreInput } from "./isp-score";

const rede = (ocorrencias: any[], extra: Partial<NonNullable<ISPScoreInput["rede"]>> = {}) => ({
  rede: { ocorrencias, totalProvedores: 1, consultasRecentes30d: 0, consultasRecentes90d: 0, ...extra },
});

describe("caso real que motivou o v2 — divida ativa de R$ 10 mil", () => {
  // Cliente da NG Telecom, inadimplente, R$ 10.100+ em aberto. O motor antigo
  // dava 410 "ANALISE MANUAL" porque o valor nao pontuava e ausencia de dado
  // rendia 200 pontos gratis.
  const leandro = calcularScoreISP(rede([{
    diasAtraso: 400, faturasAtraso: 8, statusContrato: "suspenso",
    valorAtraso: 10150,
  }]));

  it("caloteiro ativo de valor alto e REJEITAR, nao analise manual", () => {
    expect(leandro.score).toBeLessThanOrEqual(300);
    expect(leandro.sugestaoIA).toBe("REJEITAR");
    expect(leandro.corIndicador).toBe("vermelho");
  });

  it("a conta explica: tempo, valor e faturas como deducoes nomeadas", () => {
    const motivos = leandro.composicao.deducoes.map(d => d.motivo).join(" | ");
    expect(motivos).toMatch(/há 400 dias/);
    expect(motivos).toMatch(/10\.150/);
    expect(motivos).toMatch(/8 faturas/);
  });

  it("teto registrado com motivo — o guarda-corpo aparece na conta", () => {
    expect(leandro.composicao.teto?.valor).toBe(300);
    expect(leandro.composicao.teto?.motivo).toMatch(/relevante/);
  });
});

describe("o valor da divida pesa", () => {
  const com = (valorAtraso?: number) =>
    calcularScoreISP(rede([{ diasAtraso: 45, faturasAtraso: 1, statusContrato: "ativo", valorAtraso }]));

  it("dever R$ 5.000 pontua pior que dever R$ 100", () => {
    expect(com(5001).score).toBeLessThan(com(100).score);
  });

  it("atraso sem valor informado nao e inocencia", () => {
    const semValor = com(undefined);
    expect(semValor.composicao.deducoes.some(d => d.motivo.includes("não informado"))).toBe(true);
    expect(semValor.score).toBeLessThan(calcularScoreISP(rede([])).score);
  });
});

describe("guarda-corpos", () => {
  it("qualquer divida ativa impede APROVAR, mesmo com muito bonus possivel", () => {
    const r = calcularScoreISP(rede([
      { diasAtraso: 10, faturasAtraso: 1, statusContrato: "ativo", valorAtraso: 80, mesesComoCliente: 120 },
    ]));
    expect(r.score).toBeLessThanOrEqual(450);
    expect(r.sugestaoIA).not.toBe("APROVAR");
    // bonus bloqueado: divida ativa nao e lavada por tempo de casa
    expect(r.composicao.bonus).toEqual([]);
  });

  it("divida pequena mas velha (>60 dias) tambem rejeita", () => {
    const r = calcularScoreISP(rede([
      { diasAtraso: 90, faturasAtraso: 1, statusContrato: "ativo", valorAtraso: 100 },
    ]));
    expect(r.composicao.teto?.valor).toBe(300);
  });

  it("equipamento retido tem teto proprio e nunca sai limpo", () => {
    const r = calcularScoreISP(rede([
      { diasAtraso: 0, faturasAtraso: 0, statusContrato: "cancelado", equipamentosDevolvidos: false, mesesComoCliente: 60 },
    ]));
    expect(r.score).toBeLessThanOrEqual(400);
    expect(r.alertas).toContain("Equipamentos nao devolvidos registrados na rede");
    expect(r.condicoesSugeridas).toContain("Revisar a ocorrencia validada de equipamento antes de fornecer novo comodato");
    expect(r.composicao.bonus).toEqual([]);
  });

  it("3+ CPFs inadimplentes no endereco derruba para faixa de rejeicao", () => {
    const r = calcularScoreISP({ ...rede([]), endereco: { cpfsDistintosInadimplentes: 3, totalOcorrenciasEndereco: 5 } });
    expect(r.score).toBeLessThanOrEqual(300);
    expect(r.sugestaoIA).toBe("REJEITAR");
  });
});

describe("neutralidade e bonus", () => {
  it("desconhecido da rede parte de 700 — nada consta, nada comprova", () => {
    const r = calcularScoreISP(rede([]));
    expect(r.score).toBe(700);
    expect(r.composicao.base).toBe(700);
    expect(r.sugestaoIA).toBe("APROVAR COM ATENCAO");
  });

  it("ausencia de consultas e endereco NAO soma ponto — era o furo dos 200 gratis", () => {
    const semNada = calcularScoreISP(rede([]));
    expect(semNada.composicao.bonus).toEqual([]);
    expect(semNada.composicao.deducoes).toEqual([]);
  });

  it("cliente exemplar comprovado chega a 1000", () => {
    const r = calcularScoreISP(rede([
      { diasAtraso: 0, faturasAtraso: 0, statusContrato: "ativo", mesesComoCliente: 72, equipamentosDevolvidos: true },
    ]));
    expect(r.score).toBe(1000);
    expect(r.sugestaoIA).toBe("APROVAR");
    const motivos = r.composicao.bonus.map(b => b.motivo).join(" | ");
    expect(motivos).toMatch(/72 meses/);
    expect(motivos).toMatch(/Nunca atrasou/);
  });

  it("devolucao desconhecida nao ganha o bonus de equipamento", () => {
    const semConfirmacao = calcularScoreISP(rede([
      { diasAtraso: 0, faturasAtraso: 0, statusContrato: "ativo", mesesComoCliente: 12, equipamentosDevolvidos: undefined },
    ]));
    expect(semConfirmacao.composicao.bonus.some(b => b.motivo.includes("Equipamentos"))).toBe(false);
  });

  it("atraso passado quitado desconta pouco e nao trava aprovacao", () => {
    const r = calcularScoreISP(rede([
      { diasAtraso: 0, faturasAtraso: 2, statusContrato: "ativo", mesesComoCliente: 30 },
    ]));
    expect(r.composicao.deducoes.some(d => d.motivo.includes("hoje em dia"))).toBe(true);
    expect(r.score).toBeGreaterThan(500);
  });
});

describe("migrador serial", () => {
  it("divida em varios provedores soma a deducao de credor extra", () => {
    const r = calcularScoreISP(rede([
      { diasAtraso: 40, faturasAtraso: 1, statusContrato: "suspenso", valorAtraso: 150 },
      { diasAtraso: 70, faturasAtraso: 2, statusContrato: "cancelado", valorAtraso: 300 },
    ], { totalProvedores: 2 }));
    expect(r.composicao.deducoes.some(d => d.motivo.includes("2 provedores ao mesmo tempo"))).toBe(true);
    expect(r.sugestaoIA).toBe("REJEITAR");
  });

  it("consultas em rajada pontuam contra", () => {
    const r = calcularScoreISP(rede([], { consultasRecentes30d: 5, consultasRecentes90d: 12 }));
    expect(r.score).toBeLessThanOrEqual(700 - 120 - 60);
    expect(r.alertas.join(" ")).toMatch(/5\+ consultas/);
  });
});

describe("a conta fecha", () => {
  it("score = base + bonus + deducoes, limitado pelo teto", () => {
    const casos: ISPScoreInput[] = [
      rede([]),
      rede([{ diasAtraso: 400, faturasAtraso: 8, statusContrato: "suspenso", valorAtraso: 10150 }]),
      rede([{ diasAtraso: 0, faturasAtraso: 0, statusContrato: "ativo", mesesComoCliente: 72, equipamentosDevolvidos: true }]),
      { ...rede([]), endereco: { cpfsDistintosInadimplentes: 2, totalOcorrenciasEndereco: 3 } },
    ];
    for (const caso of casos) {
      const r = calcularScoreISP(caso);
      const soma = r.composicao.base
        + r.composicao.bonus.reduce((s, b) => s + b.pontos, 0)
        + r.composicao.deducoes.reduce((s, d) => s + d.pontos, 0);
      const esperado = Math.max(0, Math.min(1000, r.composicao.teto ? Math.min(soma, r.composicao.teto.valor) : soma));
      expect(r.score).toBe(esperado);
    }
  });
});