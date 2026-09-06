/**
 * A política do provedor: o que passa, o que é puxado ao teto legal, o que a
 * rota recusa — e as regras de negociação e de parcela, centavo a centavo.
 */
import { describe, expect, it } from "vitest";
import {
  PARCELAMENTO_POR_STATUS,
  POLITICA_PADRAO,
  PoliticaSchema,
  TETOS_LEGAIS,
  brl,
  clampPolitica,
  derivarStatusParcelamento,
  etapasDaPolitica,
  gerarParcelas,
  pct,
  validarNegociacao,
  validarPolitica,
  valorAtualizado,
  type Politica,
} from "./politica";
import { ETAPAS_PADRAO } from "./regua";

const padrao = (): Politica => PoliticaSchema.parse({});

describe("validarPolitica — o padrão", () => {
  it("objeto vazio vira a política padrão, sem ajuste", () => {
    const r = validarPolitica({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ajustes).toEqual([]);
    expect(r.politica).toEqual(POLITICA_PADRAO);
  });

  it("o padrão já está nos tetos legais: multa 2%, juros 1% ao mês, contato 8h–20h e sábado até 14h", () => {
    expect(POLITICA_PADRAO.encargos).toEqual({ multaPct: 2, jurosMesPct: 1 });
    expect(POLITICA_PADRAO.janelaContato).toEqual({ horaInicio: 8, horaFim: 20, sabado: true, sabadoHoraFim: 14, domingo: false, feriado: false });
    expect(POLITICA_PADRAO.negociacao).toEqual({ maxParcelas: 6, entradaMinimaPct: 20, descontoMaxPct: 20, saldoMinimoParcelar: 150 });
  });

  it("a economia nasce zerada, com ciclo de 36 meses e NÃO confirmada — é o que liga o selo '≈ parâmetros padrão'", () => {
    expect(POLITICA_PADRAO.economia).toEqual({
      cac: 0, capexInstalacao: 0, equipamentoResidual: 0,
      opexLink: 0, opexRedePop: 0, opexSuporte: 0, opexManutencaoNoc: 0,
      impostoReceitaPct: 0, cicloMeses: 36, confirmado: false, precoPorPlano: {},
    });
  });
});

describe("economia — os custos do provedor", () => {
  const economia = (mudancas: Partial<Politica["economia"]>) => ({ ...POLITICA_PADRAO.economia, ...mudancas });

  it("custos reais confirmados passam sem ajuste", () => {
    const r = validarPolitica({ economia: economia({ cac: 180, capexInstalacao: 250, opexLink: 12.5, impostoReceitaPct: 18, cicloMeses: 48, confirmado: true }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ajustes).toEqual([]);
    expect(r.politica.economia).toMatchObject({ cac: 180, impostoReceitaPct: 18, cicloMeses: 48, confirmado: true });
  });

  it("imposto acima de 100% ou negativo é ajustado com aviso, não recusado", () => {
    const acima = validarPolitica({ economia: economia({ impostoReceitaPct: 120 }) });
    expect(acima.ok && acima.politica.economia.impostoReceitaPct).toBe(100);
    expect(acima.ok && acima.ajustes).toEqual([expect.stringMatching(/^Imposto sobre receita de 120% reduzido a 100%/)]);

    const abaixo = validarPolitica({ economia: economia({ impostoReceitaPct: -5 }) });
    expect(abaixo.ok && abaixo.politica.economia.impostoReceitaPct).toBe(0);
    expect(abaixo.ok && abaixo.ajustes).toEqual([expect.stringMatching(/^Imposto sobre receita de -5% ajustado a 0%/)]);
  });

  it("ciclo fora de 1..120 meses é ajustado com aviso", () => {
    const zero = validarPolitica({ economia: economia({ cicloMeses: 0 }) });
    expect(zero.ok && zero.politica.economia.cicloMeses).toBe(1);
    expect(zero.ok && zero.ajustes).toEqual([expect.stringMatching(/^Ciclo de 0 meses ajustado a 1/)]);

    const longo = validarPolitica({ economia: economia({ cicloMeses: 200 }) });
    expect(longo.ok && longo.politica.economia.cicloMeses).toBe(120);
    expect(longo.ok && longo.ajustes).toEqual([expect.stringMatching(/^Ciclo de 200 meses reduzido a 120/)]);
  });

  it("clampPolitica não muta a entrada", () => {
    const p = padrao();
    p.economia.impostoReceitaPct = 150;
    clampPolitica(p);
    expect(p.economia.impostoReceitaPct).toBe(150);
  });

  it("custo negativo e ciclo quebrado são dado errado, não teto: a rota recusa apontando o campo", () => {
    const negativo = validarPolitica({ economia: economia({ cac: -1 }) });
    expect(negativo.ok).toBe(false);
    if (!negativo.ok) expect(negativo.erros).toEqual(["economia.cac: mínimo 0"]);

    const quebrado = validarPolitica({ economia: economia({ cicloMeses: 36.5 }) });
    expect(quebrado.ok).toBe(false);
    if (!quebrado.ok) expect(quebrado.erros[0]).toMatch(/^economia\.cicloMeses: /);

    const semConfirmado = validarPolitica({ economia: { ...economia({}), confirmado: "sim" as unknown as boolean } });
    expect(semConfirmado.ok).toBe(false);
    if (!semConfirmado.ok) expect(semConfirmado.erros).toEqual(["economia.confirmado: esperava boolean, veio string"]);
  });

  it("economia parcial é recusada campo a campo — a tela 'Confirmar custos' manda o objeto inteiro", () => {
    const r = validarPolitica({ economia: { cac: 100 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros).toContain("economia.capexInstalacao: obrigatório");
  });
});

describe("clampPolitica — os tetos legais ajustam, não recusam", () => {
  it("multa acima de 2% volta a 2% e o admin lê o porquê", () => {
    const p = padrao();
    p.encargos.multaPct = 10;
    const r = clampPolitica(p);
    expect(r.politica.encargos.multaPct).toBe(TETOS_LEGAIS.multaPct);
    expect(r.ajustes).toEqual([expect.stringMatching(/Multa de 10% reduzida a 2%.*52/)]);
    // A entrada não é mutada.
    expect(p.encargos.multaPct).toBe(10);
  });

  it("juros acima de 1% ao mês voltam a 1%", () => {
    const p = padrao();
    p.encargos.jurosMesPct = 3;
    const r = clampPolitica(p);
    expect(r.politica.encargos.jurosMesPct).toBe(1);
    expect(r.ajustes[0]).toMatch(/406/);
  });

  it("mais de 48 parcelas vira 48", () => {
    const p = padrao();
    p.negociacao.maxParcelas = 60;
    expect(clampPolitica(p).politica.negociacao.maxParcelas).toBe(48);
  });

  it("janela de contato fora do CDC art. 42 é apertada campo a campo", () => {
    const p = padrao();
    p.janelaContato = { horaInicio: 7, horaFim: 22, sabado: true, sabadoHoraFim: 18, domingo: true, feriado: true };
    const r = clampPolitica(p);
    expect(r.politica.janelaContato).toEqual({ horaInicio: 8, horaFim: 20, sabado: true, sabadoHoraFim: 14, domingo: false, feriado: false });
    expect(r.ajustes).toHaveLength(5);
  });

  it("sábado desligado não gera ajuste de hora do sábado", () => {
    const p = padrao();
    p.janelaContato.sabado = false;
    p.janelaContato.sabadoHoraFim = 23;
    expect(clampPolitica(p).ajustes).toEqual([]);
  });

  it("dentro dos tetos nada muda", () => {
    const p = padrao();
    p.encargos = { multaPct: 1, jurosMesPct: 0.5 };
    p.negociacao.maxParcelas = 12;
    const r = clampPolitica(p);
    expect(r.ajustes).toEqual([]);
    expect(r.politica).toEqual(p);
  });
});

describe("validarPolitica — o que a rota recusa, em português", () => {
  it("tipo errado aponta o campo", () => {
    const r = validarPolitica({ negociacao: { maxParcelas: "seis", entradaMinimaPct: 20, descontoMaxPct: 20, saldoMinimoParcelar: 150 } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros).toEqual(["negociacao.maxParcelas: esperava number, veio string"]);
  });

  it("campo faltando é obrigatório; fora da faixa diz o limite", () => {
    const r = validarPolitica({ encargos: { multaPct: 2 }, janelaContato: { ...POLITICA_PADRAO.janelaContato, horaFim: 25 } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros).toContain("encargos.jurosMesPct: obrigatório");
    expect(r.erros).toContain("janelaContato.horaFim: máximo 23");
  });

  it("a política de acordo entra na política, com a origem não definida e o campo apontado quando quebra", () => {
    const r = validarPolitica({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.politica.acordo.ativo.origemDaCobranca).toBe("nao_definida");
    expect(r.politica.acordo.ex_cliente.faixas.at(-1)?.ateDias).toBeNull();

    const origem = validarPolitica({ acordo: { ativo: { origemDaCobranca: "pix_do_zap" } } });
    expect(origem.ok).toBe(false);
    if (!origem.ok) expect(origem.erros[0]).toMatch(/^acordo\.ativo\.origemDaCobranca: valor inválido; aceitos: /);

    const buraco = validarPolitica({
      acordo: { ex_cliente: { faixas: [{ ateDias: 30, descontoMaxPct: 5, maxParcelas: 1, entradaMinimaPct: 20 }, { acimaDeDias: 90, ateDias: null, descontoMaxPct: 10, maxParcelas: 2, entradaMinimaPct: 20 }] } },
    });
    expect(buraco.ok).toBe(false);
    if (!buraco.ok) expect(buraco.erros[0]).toBe("acordo.ex_cliente.faixas: nenhuma faixa cobre de 31 a 90 dias de atraso");
  });

  it("etapa repetida e etapa desconhecida caem aqui, não em silêncio na leitura", () => {
    const repetida = validarPolitica({ etapas: [{ id: "lembrete_atraso" }, { id: "lembrete_atraso" }] });
    expect(repetida.ok).toBe(false);
    if (!repetida.ok) expect(repetida.erros).toEqual(["etapas.1.id: etapa repetida: lembrete_atraso"]);

    const desconhecida = validarPolitica({ etapas: [{ id: "cobranca_judicial" }] });
    expect(desconhecida.ok).toBe(false);
    if (!desconhecida.ok) expect(desconhecida.erros[0]).toMatch(/^etapas\.0\.id: valor inválido; aceitos: /);
  });

  it("o motivo da pausa é aparado e limitado a 300 caracteres", () => {
    const ok = validarPolitica({ pausada: true, pausadaMotivo: "  auditoria interna  " });
    expect(ok.ok && ok.politica.pausadaMotivo).toBe("auditoria interna");
    expect(validarPolitica({ pausadaMotivo: "x".repeat(301) }).ok).toBe(false);
  });

  it("etapasDaPolitica devolve o catálogo inteiro, com as mudanças aplicadas", () => {
    expect(etapasDaPolitica(null)).toEqual([...ETAPAS_PADRAO]);
    const r = validarPolitica({ etapas: [{ id: "lembrete_atraso", responsavelUserId: 7 }] });
    if (!r.ok) throw new Error(r.erros.join("; "));
    expect(etapasDaPolitica(r.politica).find(e => e.id === "lembrete_atraso")?.responsavelUserId).toBe(7);
    expect(etapasDaPolitica(r.politica)).toHaveLength(ETAPAS_PADRAO.length);
  });
});

describe("validarNegociacao — quitação com desconto e baixa negociada", () => {
  const politica = padrao(); // desconto máximo 20%

  it("desconto até o teto passa; um décimo acima, não", () => {
    expect(validarNegociacao(politica, { tipo: "quitacao_desconto", valorOriginal: 1000, valorNegociado: 800 })).toEqual({ ok: true });
    const r = validarNegociacao(politica, { tipo: "baixa_negociada", valorOriginal: 1000, valorNegociado: 799 });
    expect(r).toEqual({ ok: false, violacoes: ["Desconto de 20,1% excede o teto de 20% da política."] });
  });

  it("sem desconto, ou com valor acima do original (encargos), passa", () => {
    expect(validarNegociacao(politica, { tipo: "quitacao_desconto", valorOriginal: 1000, valorNegociado: 1000 }).ok).toBe(true);
    expect(validarNegociacao(politica, { tipo: "quitacao_desconto", valorOriginal: 1000, valorNegociado: 1030 }).ok).toBe(true);
  });

  it("quitação é à vista: parcelas > 1 é recusado", () => {
    const r = validarNegociacao(politica, { tipo: "quitacao_desconto", valorOriginal: 1000, valorNegociado: 900, parcelas: 3 });
    expect(r).toEqual({ ok: false, violacoes: ["Quitação é à vista: para dividir o valor, use parcelamento."] });
    expect(validarNegociacao(politica, { tipo: "quitacao_desconto", valorOriginal: 1000, valorNegociado: 900, parcelas: 1 }).ok).toBe(true);
  });

  it("sem dívida, ou sem valor negociado, não há o que validar", () => {
    expect(validarNegociacao(politica, { tipo: "quitacao_desconto", valorOriginal: 0, valorNegociado: 100 })).toEqual({
      ok: false,
      violacoes: ["Não há dívida a negociar: o valor original precisa ser maior que zero."],
    });
    expect(validarNegociacao(politica, { tipo: "parcelamento", valorOriginal: 100, valorNegociado: 0, parcelas: 2 })).toEqual({
      ok: false,
      violacoes: ["O valor negociado precisa ser maior que zero."],
    });
  });
});

describe("validarNegociacao — parcelamento", () => {
  const politica = padrao(); // 6 parcelas, entrada 20%, saldo mínimo 150
  const base = { tipo: "parcelamento" as const, valorOriginal: 1000, valorNegociado: 1000 };

  it("dentro da política passa", () => {
    expect(validarNegociacao(politica, { ...base, entrada: 200, parcelas: 6 })).toEqual({ ok: true });
    expect(validarNegociacao(politica, { ...base, entrada: 200, parcelas: 1 })).toEqual({ ok: true });
  });

  it("parcelas: obrigatórias, inteiras, a partir de 1 e até o teto", () => {
    expect(validarNegociacao(politica, { ...base, entrada: 200 })).toEqual({ ok: false, violacoes: ["Informe o número de parcelas (no mínimo 1)."] });
    expect(validarNegociacao(politica, { ...base, entrada: 200, parcelas: 0 }).ok).toBe(false);
    expect(validarNegociacao(politica, { ...base, entrada: 200, parcelas: 2.5 }).ok).toBe(false);
    expect(validarNegociacao(politica, { ...base, entrada: 200, parcelas: 7 })).toEqual({
      ok: false,
      violacoes: ["Máximo de 6 parcelas pela política; pedido: 7."],
    });
  });

  it("entrada abaixo do mínimo, negativa ou maior que o negociado", () => {
    expect(validarNegociacao(politica, { ...base, entrada: 199.99, parcelas: 4 })).toEqual({
      ok: false,
      violacoes: ["Entrada mínima de R$ 200,00 (20% do negociado); informada: R$ 199,99."],
    });
    // Sem entrada informada é zero — e zero fica abaixo do mínimo.
    expect(validarNegociacao(politica, { ...base, parcelas: 4 }).ok).toBe(false);
    expect(validarNegociacao(politica, { ...base, entrada: -1, parcelas: 4 }).ok).toBe(false);
    const demais = validarNegociacao(politica, { ...base, entrada: 1100, parcelas: 4 });
    expect(demais.ok === false && demais.violacoes).toContain("A entrada não pode ser maior que o valor negociado.");
  });

  it("saldo abaixo do mínimo para parcelar manda cobrar à vista", () => {
    const r = validarNegociacao(politica, { tipo: "parcelamento", valorOriginal: 300, valorNegociado: 300, entrada: 200, parcelas: 2 });
    expect(r).toEqual({ ok: false, violacoes: ["Saldo de R$ 100,00 abaixo do mínimo de R$ 150,00 para parcelar: cobrar à vista."] });
    expect(validarNegociacao(politica, { tipo: "parcelamento", valorOriginal: 350, valorNegociado: 350, entrada: 200, parcelas: 2 }).ok).toBe(true);
  });

  it("desconto acima do teto também vale no parcelamento", () => {
    const r = validarNegociacao(politica, { tipo: "parcelamento", valorOriginal: 1000, valorNegociado: 700, entrada: 140, parcelas: 3 });
    expect(r.ok === false && r.violacoes).toEqual(["Desconto de 30% excede o teto de 20% da política."]);
  });

  it("com a mensalidade conhecida, menos de duas mensalidades de dívida é à vista", () => {
    const pedido = { ...base, valorOriginal: 150, valorNegociado: 150, entrada: 30, parcelas: 2 };
    // Saldo 120 < 150 também falha; o teste olha a violação do perfil.
    const r = validarNegociacao(politica, { ...pedido, valorOriginal: 400, valorNegociado: 400, entrada: 80 }, { valorMensalidade: 250 });
    expect(r.ok === false && r.violacoes).toEqual([
      "Dívida de menos de duas mensalidades: a política pede pagamento à vista (parcelamento a partir de duas mensalidades acumuladas).",
    ]);
    expect(validarNegociacao(politica, { ...base, valorOriginal: 500, valorNegociado: 500, entrada: 100, parcelas: 2 }, { valorMensalidade: 250 }).ok).toBe(true);
  });

  it("sem mensalidade (fase 1) o perfil não é avaliado — o saldo mínimo é a única trava", () => {
    const pedido = { ...base, valorOriginal: 400, valorNegociado: 400, entrada: 80, parcelas: 2 };
    expect(validarNegociacao(politica, pedido, {}).ok).toBe(true);
    expect(validarNegociacao(politica, pedido, { valorMensalidade: null }).ok).toBe(true);
    expect(validarNegociacao(politica, pedido, { valorMensalidade: 0 }).ok).toBe(true);
  });

  it("vulnerável (Lei 14.181) passa por entrada, saldo mínimo e perfil — mas não pelo teto de parcelas", () => {
    const pedido = { ...base, valorOriginal: 200, valorNegociado: 200, entrada: 0, parcelas: 6 };
    expect(validarNegociacao(politica, pedido, { valorMensalidade: 250 }).ok).toBe(false);
    expect(validarNegociacao(politica, pedido, { valorMensalidade: 250, vulneravel: true })).toEqual({ ok: true });
    expect(validarNegociacao(politica, { ...pedido, parcelas: 7 }, { vulneravel: true }).ok).toBe(false);
  });

  it("várias violações vêm juntas, para o formulário marcar todas de uma vez", () => {
    const r = validarNegociacao(politica, { tipo: "parcelamento", valorOriginal: 1000, valorNegociado: 700, entrada: 0, parcelas: 10 });
    expect(r.ok === false && r.violacoes).toHaveLength(3);
  });
});

describe("derivarStatusParcelamento — razão dívida/mensalidade", () => {
  it("as fronteiras do ADR 0020: meia mensalidade e duas mensalidades", () => {
    expect(derivarStatusParcelamento(0, 100)).toBe("ativo");
    expect(derivarStatusParcelamento(49.99, 100)).toBe("ativo");
    expect(derivarStatusParcelamento(50, 100)).toBe("inadimplente_recente");
    expect(derivarStatusParcelamento(199.99, 100)).toBe("inadimplente_recente");
    expect(derivarStatusParcelamento(200, 100)).toBe("acumulado_multi_mes");
  });

  it("mensalidade zero com dívida é recente — sem dado, o caminho conservador", () => {
    expect(derivarStatusParcelamento(100, 0)).toBe("inadimplente_recente");
  });

  it("só o acumulado parcela por padrão", () => {
    expect(PARCELAMENTO_POR_STATUS).toEqual({ ativo: false, inadimplente_recente: false, acumulado_multi_mes: true });
  });
});

describe("gerarParcelas — fecha ao centavo, a última absorve", () => {
  it("R$ 100 em 3 é 33,33 + 33,33 + 33,34", () => {
    expect(gerarParcelas(100, 3, 0, "2026-01-10")).toEqual([
      { numero: 1, valor: 33.33, vencimento: "2026-01-10" },
      { numero: 2, valor: 33.33, vencimento: "2026-02-10" },
      { numero: 3, valor: 33.34, vencimento: "2026-03-10" },
    ]);
  });

  it("a entrada sai do saldo e não vira parcela", () => {
    const parcelas = gerarParcelas(1000, 4, 200, "2026-03-05");
    expect(parcelas.map(p => p.valor)).toEqual([200, 200, 200, 200]);
    expect(parcelas.map(p => p.numero)).toEqual([1, 2, 3, 4]);
  });

  it("a soma bate com o saldo mesmo quando o float não ajuda; a última leva no máximo n-1 centavos a mais", () => {
    for (const [valor, n] of [[10.05, 3], [0.1, 3], [1234.56, 7], [999.99, 48]] as const) {
      const parcelas = gerarParcelas(valor, n, 0, "2026-01-01");
      const centavos = parcelas.map(p => Math.round(p.valor * 100));
      expect(centavos.reduce((acc, c) => acc + c, 0)).toBe(Math.round(valor * 100));
      expect(new Set(centavos.slice(0, -1)).size).toBe(1);
      expect(centavos[n - 1] - centavos[0]).toBeGreaterThanOrEqual(0);
      expect(centavos[n - 1] - centavos[0]).toBeLessThan(n);
    }
  });

  it("dia 31 cai no último dia do mês curto e volta ao 31 quando o mês tem", () => {
    expect(gerarParcelas(300, 3, 0, "2026-01-31").map(p => p.vencimento)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(gerarParcelas(200, 2, 0, "2024-01-31").map(p => p.vencimento)).toEqual(["2024-01-31", "2024-02-29"]);
  });

  it("vira o ano", () => {
    expect(gerarParcelas(300, 3, 0, "2026-11-15").map(p => p.vencimento)).toEqual(["2026-11-15", "2026-12-15", "2027-01-15"]);
  });

  it("uma parcela só é o saldo inteiro", () => {
    expect(gerarParcelas(250.5, 1, 50.5, "2026-06-01")).toEqual([{ numero: 1, valor: 200, vencimento: "2026-06-01" }]);
  });

  it("erro de programação lança, em vez de gerar lista torta", () => {
    expect(() => gerarParcelas(100, 0, 0, "2026-01-01")).toThrow(/inteiro a partir de 1/);
    expect(() => gerarParcelas(100, 1.5, 0, "2026-01-01")).toThrow(RangeError);
    expect(() => gerarParcelas(100, 2, 150, "2026-01-01")).toThrow(/entrada/i);
    expect(() => gerarParcelas(100, 2, 0, "01/01/2026")).toThrow(/AAAA-MM-DD/);
  });
});

describe("valorAtualizado — multa uma vez, juros pro rata", () => {
  const encargos = { multaPct: 2, jurosMesPct: 1 };

  it("30 dias: 2% de multa e 1% de juros", () => {
    expect(valorAtualizado(100, 30, encargos)).toEqual({ principal: 100, multa: 2, juros: 1, total: 103 });
  });

  it("15 dias: meio mês de juros; 60 dias: dois meses", () => {
    expect(valorAtualizado(100, 15, encargos).juros).toBe(0.5);
    expect(valorAtualizado(100, 60, encargos).juros).toBe(2);
  });

  it("sem atraso, nada é somado", () => {
    expect(valorAtualizado(100, 0, encargos)).toEqual({ principal: 100, multa: 0, juros: 0, total: 100 });
    expect(valorAtualizado(100, -3, encargos).total).toBe(100);
  });

  it("arredonda ao centavo", () => {
    expect(valorAtualizado(333.33, 45, encargos)).toEqual({ principal: 333.33, multa: 6.67, juros: 5, total: 345 });
  });
});

describe("formatação", () => {
  it("brl", () => {
    expect(brl(1234.56)).toBe("R$ 1.234,56");
    expect(brl(0.5)).toBe("R$ 0,50");
    expect(brl(1000000)).toBe("R$ 1.000.000,00");
    expect(brl(-12.3)).toBe("-R$ 12,30");
  });

  it("pct sem casa quando inteiro, uma casa quando não", () => {
    expect(pct(20)).toBe("20%");
    expect(pct(12.5)).toBe("12,5%");
    expect(pct(20.04)).toBe("20%");
    expect(pct(33.333)).toBe("33,3%");
  });
});
