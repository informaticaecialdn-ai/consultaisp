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

  it("ex-cliente NAO ganha o bonus de bom pagador — era o furo que premiava sair", () => {
    // O motor tinha o campo `statusContrato` na ocorrencia e nunca o lia. Um CPF
    // que a rede so conhece como contrato CANCELADO tirava os +60 de "nunca
    // atrasou" e fechava em 760/excelente — MELHOR que os 700 de um CPF
    // totalmente desconhecido. Ser ex-cliente melhorava a nota.
    const exCliente = calcularScoreISP(rede([
      { diasAtraso: 0, faturasAtraso: 0, statusContrato: "cancelado" },
    ]));
    const desconhecido = calcularScoreISP(rede([]));

    expect(exCliente.composicao.bonus.some(b => b.motivo.includes("Nunca atrasou"))).toBe(false);
    // Neutro, nao penalizado: nada consta, nada comprova.
    expect(exCliente.score).toBe(desconhecido.score);
  });

  it("contrato nao comprovado tambem e neutro, nao bonificado", () => {
    // "unknown" e o que chega quando o ERP nao respondeu o contrato. Ausencia
    // de prova nao vira prova de bom pagador — mesma regra do equipamento.
    for (const status of ["unknown", "desconhecido", ""]) {
      const r = calcularScoreISP(rede([
        { diasAtraso: 0, faturasAtraso: 0, statusContrato: status },
      ]));
      expect(r.composicao.bonus.some(b => b.motivo.includes("Nunca atrasou"))).toBe(false);
    }
  });

  it("suspenso por atraso ainda e cliente, e conta para o bonus", () => {
    // Suspensao por falta de pagamento e um cliente que o provedor AINDA tem.
    const r = calcularScoreISP(rede([
      { diasAtraso: 0, faturasAtraso: 0, statusContrato: "suspenso" },
    ]));
    expect(r.composicao.bonus.some(b => b.motivo.includes("Nunca atrasou"))).toBe(true);
  });

  it("o bonus de tempo de casa tambem exige contrato vigente", () => {
    const cancelado = calcularScoreISP(rede([
      { diasAtraso: 0, faturasAtraso: 0, statusContrato: "cancelado", mesesComoCliente: 72 },
    ]));
    expect(cancelado.composicao.bonus.some(b => b.motivo.includes("meses de casa"))).toBe(false);
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
/**
 * DESLIGADO POR FALTA DE PAGAMENTO (04/09/2026).
 *
 * O motivo do corte vem do proprio ERP do provedor — "Financeiro" contra
 * "Administrativo" —, e ate esta data o bureau descartava o campo. Medido no
 * SGP da Amplinet: 222 clientes suspensos e 66 cancelados por motivo
 * financeiro, contra 206 cancelados a pedido. Os dois grupos chegavam ao score
 * identicos, porque so guardavamos "cancelado".
 *
 * O peso e o que estes casos fixam: mais que "atrasou e pagou" (-30), menos que
 * equipamento retido (-150) e que padrao de fraude por endereco (-250).
 */
describe("corte por falta de pagamento", () => {
  const base = (extra: Partial<OcorrenciaRede> = {}): ISPScoreInput => ({
    rede: {
      ocorrencias: [{ diasAtraso: 0, faturasAtraso: 0, statusContrato: "cancelado", ...extra }],
      totalProvedores: 1,
      consultasRecentes30d: 0,
      consultasRecentes90d: 0,
    },
  });

  it("corte recente pesa mais que corte antigo", () => {
    const recente = calcularScoreISP(base({ corteFinanceiro: true, cortadoHaMeses: 3 })).score;
    const antigo = calcularScoreISP(base({ corteFinanceiro: true, cortadoHaMeses: 40 })).score;

    expect(recente).toBeLessThan(antigo);
    // Antigo nao zera: num bureau, calote nao prescreve — so pesa menos.
    expect(antigo).toBeLessThan(calcularScoreISP(base()).score);
  });

  it("o corte mais RECENTE manda quando ha varios", () => {
    // Cortado ha tres meses num provedor e ha quatro anos noutro: o caso e
    // recente. Deixar o antigo mandar suavizaria justamente o que acabou de
    // acontecer.
    const misto = calcularScoreISP({
      rede: {
        ocorrencias: [
          { diasAtraso: 0, faturasAtraso: 0, statusContrato: "cancelado", corteFinanceiro: true, cortadoHaMeses: 48 },
          { diasAtraso: 0, faturasAtraso: 0, statusContrato: "cancelado", corteFinanceiro: true, cortadoHaMeses: 3 },
        ],
        totalProvedores: 2, consultasRecentes30d: 0, consultasRecentes90d: 0,
      },
    });
    const soAntigos = calcularScoreISP({
      rede: {
        ocorrencias: [
          { diasAtraso: 0, faturasAtraso: 0, statusContrato: "cancelado", corteFinanceiro: true, cortadoHaMeses: 48 },
          { diasAtraso: 0, faturasAtraso: 0, statusContrato: "cancelado", corteFinanceiro: true, cortadoHaMeses: 50 },
        ],
        totalProvedores: 2, consultasRecentes30d: 0, consultasRecentes90d: 0,
      },
    });

    expect(misto.score).toBeLessThan(soAntigos.score);
  });

  it("dois provedores que cortaram pesam mais que um", () => {
    const um = calcularScoreISP(base({ corteFinanceiro: true, cortadoHaMeses: 6 })).score;
    const dois = calcularScoreISP({
      rede: {
        ocorrencias: [
          { diasAtraso: 0, faturasAtraso: 0, statusContrato: "cancelado", corteFinanceiro: true, cortadoHaMeses: 6 },
          { diasAtraso: 0, faturasAtraso: 0, statusContrato: "cancelado", corteFinanceiro: true, cortadoHaMeses: 6 },
        ],
        totalProvedores: 2, consultasRecentes30d: 0, consultasRecentes90d: 0,
      },
    }).score;

    expect(dois).toBeLessThan(um);
  });

  it("cancelado a PEDIDO do cliente nao pontua contra ninguem", () => {
    // Sao 206 clientes na Amplinet. Quem mudou de endereco ou trocou de plano
    // nao pode carregar a marca de quem foi cortado por calote.
    expect(calcularScoreISP(base({ corteFinanceiro: false })).score)
      .toBe(calcularScoreISP(base()).score);
  });

  it("motivo AUSENTE nao pontua — silencio nao e culpa nem inocencia", () => {
    // Todo conector que nao e o SGP deixa o campo indefinido hoje. Se ausencia
    // pontuasse, a rede inteira levaria a penalidade por um campo que ninguem
    // preencheu.
    expect(calcularScoreISP(base({ corteFinanceiro: undefined })).score)
      .toBe(calcularScoreISP(base()).score);
  });

  it("pesa menos que equipamento retido e que fraude por endereco", () => {
    // A ordem entre as penalidades e o que este caso protege: corte por dinheiro
    // e inadimplencia grave, nao fraude.
    const corte = calcularScoreISP(base({ corteFinanceiro: true, cortadoHaMeses: 1 })).score;
    const equipamento = calcularScoreISP(base({ equipamentosDevolvidos: false })).score;
    const fraude = calcularScoreISP({
      endereco: { cpfsDistintosInadimplentes: 3, totalOcorrenciasEndereco: 3 },
    }).score;

    expect(corte).toBeGreaterThan(equipamento);
    expect(corte).toBeGreaterThan(fraude);
  });

  it("a composicao explica o corte em portugues, e diz de onde veio o motivo", () => {
    const r = calcularScoreISP(base({ corteFinanceiro: true, cortadoHaMeses: 5 }));
    const item = r.composicao?.deducoes?.find(d => /cortado por falta de pagamento/i.test(d.motivo));

    expect(item).toBeDefined();
    // O operador tem de saber que isto e o ERP falando, nao um palpite nosso.
    expect(String(item?.detalhe)).toMatch(/ERP do provedor/i);
  });
});
