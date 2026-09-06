/**
 * A política de ACORDO por carteira: as faixas por dias de atraso, o clamp
 * contra o envelope geral, e as OFERTAS que o servidor autoriza.
 *
 * Três coisas se provam aqui porque falhar em qualquer uma delas custa
 * dinheiro de verdade: (1) sem `origemDaCobranca` nenhuma oferta tem desconto
 * — foi o que o dono decidiu para o portal do ex-cliente sair; (2) a soma da
 * entrada com as parcelas FECHA o valor negociado, centavo a centavo, em toda
 * combinação; (3) toda oferta gerada passa em `validarNegociacao` contra a
 * mesma política — a política de acordo nunca oferece o que o envelope geral
 * do provedor recusaria depois.
 */
import { describe, expect, it } from "vitest";
import {
  ACORDO_PADRAO,
  AcordoSchema,
  EXPLICACAO_ORIGEM_DA_COBRANCA,
  ORIGENS_DA_COBRANCA,
  ORIGEM_INDISPONIVEL,
  avaliarPedidoDeAcordo,
  clampAcordo,
  dataNaJanela,
  faixaDoAtraso,
  normalizarFaixas,
  ofertasDaPolitica,
  origemDisponivel,
  rotuloDaFaixa,
  somarDias,
  type Acordo,
  type FaixaDeAcordo,
} from "./acordo";
import { POLITICA_PADRAO, PoliticaSchema, brl, clampPolitica, gerarParcelas, pct, validarNegociacao, validarPolitica } from "./politica";

const HOJE = "2026-09-06";
const acordo = (): Acordo => structuredClone(ACORDO_PADRAO);
const negociacao = () => structuredClone(POLITICA_PADRAO.negociacao);

/** A política com a origem escolhida nas duas carteiras — o estado "configurado". */
function configurada(mudancas: Partial<Acordo["ativo"]> = {}, carteira: "ativo" | "ex_cliente" = "ex_cliente") {
  const a = acordo();
  a.ativo.origemDaCobranca = "asaas";
  a.ex_cliente.origemDaCobranca = "asaas";
  Object.assign(a[carteira], mudancas);
  return { acordo: a, negociacao: negociacao() };
}

/* ── O padrão ─────────────────────────────────────────────────────────── */

describe("o padrão", () => {
  it("nasce com a origem da cobrança NÃO DEFINIDA nas duas carteiras", () => {
    expect(ACORDO_PADRAO.ativo.origemDaCobranca).toBe("nao_definida");
    expect(ACORDO_PADRAO.ex_cliente.origemDaCobranca).toBe("nao_definida");
    expect(AcordoSchema.parse({})).toEqual(ACORDO_PADRAO);
  });

  it("as faixas padrão das duas carteiras cobrem de 1 dia ao infinito, sem buraco nem sobreposição", () => {
    for (const carteira of ["ativo", "ex_cliente"] as const) {
      const r = normalizarFaixas(ACORDO_PADRAO[carteira].faixas);
      expect(r.ok, carteira).toBe(true);
      if (!r.ok) continue;
      expect(r.faixas[0].acimaDeDias).toBe(0);
      expect(r.faixas.at(-1)?.ateDias).toBeNull();
      for (let dias = 1; dias <= 400; dias++) {
        const achadas = r.faixas.filter(f => dias > f.acimaDeDias && (f.ateDias === null || dias <= f.ateDias));
        expect(achadas, `${carteira} · ${dias} dias`).toHaveLength(1);
      }
    }
  });

  it("o cliente ATIVO em atraso recente não ganha desconto: quem ainda está na base paga o que deve", () => {
    expect(ACORDO_PADRAO.ativo.faixas[0]).toMatchObject({ ateDias: 30, descontoMaxPct: 0, maxParcelas: 1 });
  });

  it("nenhuma faixa padrão passa do envelope geral — o padrão é ponto fixo do clamp", () => {
    const r = clampAcordo(acordo(), POLITICA_PADRAO.negociacao);
    expect(r.ajustes).toEqual([]);
    expect(r.acordo).toEqual(ACORDO_PADRAO);
    // e pela política inteira, que é como a rota chama
    const p = validarPolitica({});
    expect(p.ok && p.ajustes).toEqual([]);
  });

  it("o ERP fica visível e indisponível com o motivo: nenhum conector escreve cobrança", () => {
    expect(ORIGENS_DA_COBRANCA).toContain("erp");
    expect(origemDisponivel("erp")).toBe(false);
    expect(ORIGEM_INDISPONIVEL.erp).toMatch(/nenhum conector/i);
    for (const origem of ["nao_definida", "asaas", "manual"] as const) expect(origemDisponivel(origem)).toBe(true);
  });

  it("a explicação do Asaas não promete emissão: nada emite cobrança de acordo ainda", () => {
    const asaas = EXPLICACAO_ORIGEM_DA_COBRANCA.asaas;
    expect(asaas).toMatch(/ainda não está ligada/i);
    // "nasce na conta Asaas" no presente prometia boleto automático; a frase
    // tem de ficar no futuro enquanto ninguém emitir nada.
    expect(asaas).not.toMatch(/\bnasce na conta\b/i);
  });
});

/* ── A origem indisponível: o gate é do SCHEMA, não do <select> ───────── */

describe("origem indisponível", () => {
  it("o schema RECUSA gravar `erp`, com a mesma frase que a tela mostra", () => {
    const r = AcordoSchema.safeParse({ ...ACORDO_PADRAO, ativo: { ...ACORDO_PADRAO.ativo, origemDaCobranca: "erp" } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const erro = r.error.issues.find(i => i.path.join(".") === "ativo.origemDaCobranca");
    expect(erro?.message).toBe(ORIGEM_INDISPONIVEL.erp);
  });

  it("pela política inteira — que é como o PUT chama — o campo recusado é apontado pelo caminho", () => {
    const p = structuredClone(POLITICA_PADRAO);
    p.acordo.ex_cliente.origemDaCobranca = "erp" as never;
    const r = validarPolitica(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros).toContain(`acordo.ex_cliente.origemDaCobranca: ${ORIGEM_INDISPONIVEL.erp}`);
  });

  it("as origens disponíveis continuam passando", () => {
    for (const origem of ["nao_definida", "asaas", "manual"] as const) {
      const r = AcordoSchema.safeParse({ ...ACORDO_PADRAO, ativo: { ...ACORDO_PADRAO.ativo, origemDaCobranca: origem } });
      expect(r.success, origem).toBe(true);
    }
  });

  it("uma política com `erp` montada em memória não gera desconto nenhum: só o valor integral", () => {
    const p = configurada();
    p.acordo.ex_cliente.origemDaCobranca = "erp";
    const r = ofertasDaPolitica({ saldo: 1000, diasAtraso: 200, carteira: "ex_cliente", hoje: HOJE }, p);
    expect(r.ofertas).toHaveLength(1);
    expect(r.ofertas[0]).toMatchObject({ tipo: "a_vista", valor: 1000, descontoPct: 0 });
    expect(r.motivo).toContain(ORIGEM_INDISPONIVEL.erp as string);
  });
});

/* ── Faixas ───────────────────────────────────────────────────────────── */

describe("normalizarFaixas", () => {
  const faixa = (ateDias: number | null, extra: Partial<FaixaDeAcordo> = {}): FaixaDeAcordo =>
    ({ ateDias, descontoMaxPct: 0, maxParcelas: 1, entradaMinimaPct: 0, ...extra });

  it("ordena e infere o piso de cada faixa a partir do teto da anterior", () => {
    const r = normalizarFaixas([faixa(null), faixa(30), faixa(60)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.faixas.map(f => [f.acimaDeDias, f.ateDias])).toEqual([[0, 30], [30, 60], [60, null]]);
  });

  it("recusa sobreposição, dizendo onde", () => {
    const r = normalizarFaixas([{ ...faixa(60), acimaDeDias: 0 }, { ...faixa(90), acimaDeDias: 30 }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros[0]).toMatch(/sobrep/);
  });

  it("recusa buraco: um atraso sem faixa nenhuma seria um cliente sem oferta", () => {
    const r = normalizarFaixas([faixa(30), { ...faixa(null), acimaDeDias: 45 }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros[0]).toBe("nenhuma faixa cobre de 31 a 45 dias de atraso");
  });

  it("recusa régua sem cauda: alguém sempre atrasa mais que o último teto", () => {
    const r = normalizarFaixas([faixa(30), faixa(60)]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros[0]).toMatch(/acima de 60 dias/);
  });

  it("recusa faixa vazia e lista vazia", () => {
    const vazia = normalizarFaixas([{ ...faixa(30), acimaDeDias: 30 }]);
    expect(vazia.ok).toBe(false);
    expect(normalizarFaixas([]).ok).toBe(false);
  });

  it("faixaDoAtraso escolhe pelos limites, e o rótulo é o da tela", () => {
    const r = normalizarFaixas(ACORDO_PADRAO.ativo.faixas);
    if (!r.ok) throw new Error("faixas padrão inválidas");
    expect(faixaDoAtraso(r.faixas, 1)?.ateDias).toBe(30);
    expect(faixaDoAtraso(r.faixas, 30)?.ateDias).toBe(30);
    expect(faixaDoAtraso(r.faixas, 31)?.ateDias).toBe(60);
    expect(faixaDoAtraso(r.faixas, 60)?.ateDias).toBe(60);
    expect(faixaDoAtraso(r.faixas, 61)?.ateDias).toBeNull();
    // Sem atraso ainda cai na primeira faixa: não existe "cliente sem faixa".
    expect(faixaDoAtraso(r.faixas, 0)?.ateDias).toBe(30);
    expect(r.faixas.map(rotuloDaFaixa)).toEqual(["até 30 dias", "de 31 a 60 dias", "acima de 60 dias"]);
  });
});

/* ── Clamp contra o envelope geral ────────────────────────────────────── */

describe("clampAcordo — o acordo nunca passa do envelope geral", () => {
  const geral = { maxParcelas: 6, entradaMinimaPct: 20, descontoMaxPct: 20, saldoMinimoParcelar: 150 };

  it("puxa desconto, parcelas e entrada, dizendo a carteira, a faixa e quem puxou", () => {
    const a = acordo();
    a.ex_cliente.faixas = [
      { acimaDeDias: 0, ateDias: 90, descontoMaxPct: 60, maxParcelas: 24, entradaMinimaPct: 0 },
      { acimaDeDias: 90, ateDias: null, descontoMaxPct: 10, maxParcelas: 3, entradaMinimaPct: 25 },
    ];
    const r = clampAcordo(a, geral);
    expect(r.acordo.ex_cliente.faixas[0]).toMatchObject({ descontoMaxPct: 20, maxParcelas: 6, entradaMinimaPct: 20 });
    expect(r.acordo.ex_cliente.faixas[1]).toMatchObject({ descontoMaxPct: 10, maxParcelas: 3, entradaMinimaPct: 25 });
    expect(r.ajustes).toEqual([
      "Ex-clientes, até 90 dias: desconto de 60% reduzido a 20% — o teto geral da negociação.",
      "Ex-clientes, até 90 dias: 24 parcelas reduzidas a 6 — o teto geral da negociação.",
      "Ex-clientes, até 90 dias: entrada mínima de 0% elevada a 20% — o mínimo geral da negociação.",
    ]);
  });

  it("nem com aprovação humana se passa do teto geral: a exceção também é puxada", () => {
    const a = acordo();
    a.ativo.tetoDeExcecaoPct = 90;
    a.ativo.parcelasDeExcecao = 36;
    const r = clampAcordo(a, geral);
    expect(r.acordo.ativo.tetoDeExcecaoPct).toBe(20);
    expect(r.acordo.ativo.parcelasDeExcecao).toBe(6);
    expect(r.ajustes.join(" ")).toMatch(/nem com aprovação/);
  });

  it("grava as faixas ordenadas e com o piso explícito", () => {
    const a = acordo();
    a.ativo.faixas = [
      { ateDias: null, descontoMaxPct: 10, maxParcelas: 3, entradaMinimaPct: 20 },
      { ateDias: 30, descontoMaxPct: 0, maxParcelas: 1, entradaMinimaPct: 100 },
    ];
    const r = clampAcordo(a, geral);
    expect(r.acordo.ativo.faixas.map(f => [f.acimaDeDias, f.ateDias])).toEqual([[0, 30], [30, null]]);
  });

  it("o clamp da política roda DEPOIS do teto legal: 12x na faixa cai para o que sobrou do geral", () => {
    const p = PoliticaSchema.parse({});
    p.negociacao.maxParcelas = 60;             // acima do teto legal de 48
    p.acordo.ex_cliente.faixas = [{ acimaDeDias: 0, ateDias: null, descontoMaxPct: 10, maxParcelas: 60, entradaMinimaPct: 20 }];
    const r = clampPolitica(p);
    expect(r.politica.negociacao.maxParcelas).toBe(48);
    expect(r.politica.acordo.ex_cliente.faixas[0].maxParcelas).toBe(48);
    expect(r.ajustes.some(a => /teto geral/.test(a))).toBe(true);
  });

  it("faixas inconsistentes não travam o clamp: quem recusa é o schema, na rota", () => {
    const a = acordo();
    a.ativo.faixas = [{ acimaDeDias: 0, ateDias: 30, descontoMaxPct: 99, maxParcelas: 1, entradaMinimaPct: 100 }];
    const r = clampAcordo(a, geral);
    expect(r.acordo.ativo.faixas[0].descontoMaxPct).toBe(20);
    expect(r.ajustes[0]).toMatch(/faixa 1/);
    const recusa = validarPolitica({ acordo: a });
    expect(recusa.ok).toBe(false);
  });
});

/* ── Ofertas ──────────────────────────────────────────────────────────── */

describe("ofertasDaPolitica — sem origem, sem desconto", () => {
  it("origem não definida: uma oferta só, valor integral, com o motivo escrito", () => {
    const r = ofertasDaPolitica({ saldo: 480, diasAtraso: 200, carteira: "ex_cliente", hoje: HOJE }, { acordo: acordo(), negociacao: negociacao() });
    expect(r.ofertas).toHaveLength(1);
    expect(r.ofertas[0]).toMatchObject({ tipo: "a_vista", valor: 480, descontoPct: 0, parcelas: 1, entrada: 0 });
    expect(r.origemDaCobranca).toBe("nao_definida");
    expect(r.motivo).toMatch(/segunda via/);
    expect(r.faixa).toBeNull();
  });

  it("saldo zerado não gera oferta nenhuma — nem uma de R$ 0,00", () => {
    const r = ofertasDaPolitica({ saldo: 0, diasAtraso: 90, carteira: "ativo", hoje: HOJE }, configurada());
    expect(r.ofertas).toEqual([]);
    expect(r.motivo).toMatch(/Não há saldo/);
  });

  it("faixas inconsistentes derrubam para o valor integral, com o motivo — nunca para um desconto chutado", () => {
    const p = configurada();
    p.acordo.ex_cliente.faixas = [{ acimaDeDias: 0, ateDias: 30, descontoMaxPct: 20, maxParcelas: 6, entradaMinimaPct: 20 }];
    const r = ofertasDaPolitica({ saldo: 900, diasAtraso: 200, carteira: "ex_cliente", hoje: HOJE }, p);
    expect(r.ofertas).toHaveLength(1);
    expect(r.ofertas[0].descontoPct).toBe(0);
    expect(r.ofertas[0].valor).toBe(900);
    expect(r.motivo).toMatch(/inconsistentes/);
  });
});

describe("ofertasDaPolitica — com a origem escolhida", () => {
  it("ex-cliente de 200 dias: à vista com o desconto da faixa e parcelado com a entrada da faixa", () => {
    const r = ofertasDaPolitica({ saldo: 1000, diasAtraso: 200, carteira: "ex_cliente", hoje: HOJE }, configurada());
    expect(r.faixa).toMatchObject({ acimaDeDias: 180, ateDias: null, descontoMaxPct: 20, maxParcelas: 6 });
    expect(r.ofertas.map(o => o.tipo)).toEqual(["a_vista", "parcelado"]);
    expect(r.ofertas[0]).toMatchObject({ valor: 800, descontoPct: 20, parcelas: 1, entrada: 0, vencimentos: [HOJE] });
    const parcelado = r.ofertas[1];
    expect(parcelado).toMatchObject({ valor: 800, entrada: 160, parcelas: 6 });
    expect(parcelado.vencimentos).toEqual(["2026-09-06", "2026-10-06", "2026-11-06", "2026-12-06", "2027-01-06", "2027-02-06"]);
    // 640 em 6x nao divide redondo: 106,66 nas cinco primeiras e 106,70 na ultima — e a soma fecha.
    expect(parcelado.valorParcela).toBe(106.66);
    expect(somaDaOferta(parcelado)).toBe(800);
  });

  it("cliente ativo com 10 dias: nenhum desconto e nada de parcelar — é o que a faixa diz", () => {
    const r = ofertasDaPolitica({ saldo: 300, diasAtraso: 10, carteira: "ativo", hoje: HOJE }, configurada({}, "ativo"));
    expect(r.ofertas).toHaveLength(1);
    expect(r.ofertas[0]).toMatchObject({ tipo: "a_vista", valor: 300, descontoPct: 0 });
    expect(r.motivo).toMatch(/à vista/);
  });

  it("saldo abaixo do mínimo para parcelar: só à vista, com o mínimo na frase", () => {
    const r = ofertasDaPolitica({ saldo: 150, diasAtraso: 200, carteira: "ex_cliente", hoje: HOJE }, configurada());
    expect(r.ofertas.map(o => o.tipo)).toEqual(["a_vista"]);
    expect(r.motivo).toMatch(/R\$ 150,00/);
  });

  it("a data da primeira parcela é do devedor, presa à janela do credor", () => {
    const politica = configurada({ janelaVencimentoDias: 10 });
    const dentro = ofertasDaPolitica({ saldo: 1000, diasAtraso: 200, carteira: "ex_cliente", hoje: HOJE, primeiroVencimento: "2026-09-12" }, politica);
    expect(dentro.ofertas[0].vencimentos[0]).toBe("2026-09-12");
    expect(dentro.vencimentoMaximo).toBe("2026-09-16");

    const depois = ofertasDaPolitica({ saldo: 1000, diasAtraso: 200, carteira: "ex_cliente", hoje: HOJE, primeiroVencimento: "2026-12-01" }, politica);
    expect(depois.ofertas[0].vencimentos[0]).toBe("2026-09-16");

    const passado = ofertasDaPolitica({ saldo: 1000, diasAtraso: 200, carteira: "ex_cliente", hoje: HOJE, primeiroVencimento: "2020-01-01" }, politica);
    expect(passado.ofertas[0].vencimentos[0]).toBe(HOJE);
  });

  it("dia 31 numa janela que cai em fevereiro vence no último dia do mês", () => {
    const politica = configurada({ janelaVencimentoDias: 60 });
    const r = ofertasDaPolitica({ saldo: 2000, diasAtraso: 300, carteira: "ex_cliente", hoje: "2026-12-31", primeiroVencimento: "2026-12-31" }, politica);
    expect(r.ofertas[1].vencimentos.slice(0, 4)).toEqual(["2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]);
  });
});

describe("ofertasDaPolitica — as propriedades que não podem falhar", () => {
  const saldos = [37.77, 99.99, 150, 150.01, 333.33, 1000, 1234.56, 7777.77, 20_000.01];
  const atrasos = [1, 15, 30, 31, 45, 60, 61, 90, 91, 120, 180, 181, 365, 900];
  const carteiras = ["ativo", "ex_cliente"] as const;

  it("a soma da entrada com as parcelas FECHA o valor negociado, em todo caso", () => {
    for (const saldo of saldos) for (const diasAtraso of atrasos) for (const carteira of carteiras) {
      const r = ofertasDaPolitica({ saldo, diasAtraso, carteira, hoje: HOJE }, configurada({}, carteira));
      for (const oferta of r.ofertas) {
        const centavos = Math.round(oferta.entrada * 100)
          + oferta.vencimentos.reduce((soma, _, i) => soma + Math.round(parcelaEm(oferta, i) * 100), 0);
        expect(centavos, `${carteira} ${saldo} ${diasAtraso} ${oferta.tipo}`).toBe(Math.round(oferta.valor * 100));
      }
    }
  });

  it("toda oferta passa em validarNegociacao contra a MESMA política: nunca se oferece o que o servidor recusaria", () => {
    for (const saldo of saldos) for (const diasAtraso of atrasos) for (const carteira of carteiras) {
      const politica = configurada({}, carteira);
      const r = ofertasDaPolitica({ saldo, diasAtraso, carteira, hoje: HOJE }, politica);
      for (const oferta of r.ofertas) {
        const veredito = validarNegociacao(
          { negociacao: politica.negociacao },
          oferta.tipo === "a_vista"
            ? { tipo: "quitacao_desconto", valorOriginal: saldo, valorNegociado: oferta.valor }
            : { tipo: "parcelamento", valorOriginal: saldo, valorNegociado: oferta.valor, entrada: oferta.entrada, parcelas: oferta.parcelas },
        );
        expect(veredito.ok, `${carteira} ${saldo} ${diasAtraso} ${oferta.tipo}: ${veredito.ok ? "" : veredito.violacoes.join(" ")}`).toBe(true);
      }
    }
  });

  it("nenhuma oferta passa do desconto nem das parcelas da faixa", () => {
    for (const saldo of saldos) for (const diasAtraso of atrasos) for (const carteira of carteiras) {
      const r = ofertasDaPolitica({ saldo, diasAtraso, carteira, hoje: HOJE }, configurada({}, carteira));
      for (const oferta of r.ofertas) {
        expect(oferta.descontoPct).toBeLessThanOrEqual(r.faixa?.descontoMaxPct ?? 0);
        expect(oferta.parcelas).toBeLessThanOrEqual(r.faixa?.maxParcelas ?? 1);
      }
    }
  });

  it("as parcelas da oferta são as MESMAS de gerarParcelas — as duas contas de dinheiro batem", () => {
    const politica = configurada({ janelaVencimentoDias: 0 });
    for (const saldo of saldos) {
      const r = ofertasDaPolitica({ saldo, diasAtraso: 200, carteira: "ex_cliente", hoje: HOJE }, politica);
      const parcelado = r.ofertas.find(o => o.tipo === "parcelado");
      if (!parcelado) continue;
      const esperadas = gerarParcelas(parcelado.valor, parcelado.parcelas, parcelado.entrada, HOJE);
      expect(parcelado.vencimentos).toEqual(esperadas.map(p => p.vencimento));
      expect(parcelado.valorParcela).toBe(esperadas[0].valor);
    }
  });
});

/** A oferta guarda só a primeira parcela; a última absorve a sobra dos centavos. */
function parcelaEm(oferta: { valor: number; entrada: number; parcelas: number; valorParcela: number }, indice: number): number {
  if (indice < oferta.parcelas - 1) return oferta.valorParcela;
  const total = Math.round((oferta.valor - oferta.entrada) * 100);
  return (total - Math.round(oferta.valorParcela * 100) * (oferta.parcelas - 1)) / 100;
}

/* ── O pedido manual ──────────────────────────────────────────────────── */

describe("avaliarPedidoDeAcordo — dentro, exceção e recusa", () => {
  const base = { carteira: "ex_cliente" as const, diasAtraso: 200, valorOriginal: 1000 };

  it("dentro da faixa passa sem cerimônia", () => {
    const r = avaliarPedidoDeAcordo({ ...base, valorNegociado: 850, parcelas: 1 }, { acordo: acordo() });
    expect(r.decisao).toBe("dentro");
  });

  it("acima da faixa e dentro do teto de exceção: entra, mas precisa de um humano", () => {
    const a = acordo();
    a.ex_cliente.faixas = [{ acimaDeDias: 0, ateDias: null, descontoMaxPct: 5, maxParcelas: 2, entradaMinimaPct: 20 }];
    const r = avaliarPedidoDeAcordo({ ...base, valorNegociado: 880, parcelas: 4, entrada: 200 }, { acordo: a });
    expect(r.decisao).toBe("excecao");
    if (r.decisao !== "excecao") return;
    expect(r.motivos[0]).toMatch(/Desconto de 12% acima dos 5%/);
    expect(r.motivos[1]).toMatch(/4 parcelas acima das 2x/);
  });

  it("acima do teto de exceção é recusa, e a frase diz o limite", () => {
    const a = acordo();
    a.ex_cliente.tetoDeExcecaoPct = 10;
    const r = avaliarPedidoDeAcordo({ ...base, valorNegociado: 700, parcelas: 1 }, { acordo: a });
    expect(r.decisao).toBe("recusado");
    if (r.decisao !== "recusado") return;
    expect(r.violacoes[0]).toMatch(/Desconto de 30% acima do teto de exceção de 10% para ex-clientes/);
    expect(r.violacoes[0]).toMatch(/acima de 180 dias/);
  });

  it("parcelas acima do limite de exceção também recusam", () => {
    const a = acordo();
    a.ex_cliente.parcelasDeExcecao = 6;
    const r = avaliarPedidoDeAcordo({ ...base, valorNegociado: 1000, parcelas: 12, entrada: 300 }, { acordo: a });
    expect(r.decisao).toBe("recusado");
    if (r.decisao !== "recusado") return;
    expect(r.violacoes[0]).toMatch(/12 parcelas acima do limite de exceção de 6x/);
  });

  it("entrada abaixo da faixa é exceção, não recusa: o envelope geral já barrou o que era grave", () => {
    const r = avaliarPedidoDeAcordo({ ...base, valorNegociado: 1000, parcelas: 3, entrada: 0 }, { acordo: acordo() });
    expect(r.decisao).toBe("excecao");
    if (r.decisao !== "excecao") return;
    expect(r.motivos[0]).toMatch(/Entrada de R\$ 0,00 abaixo dos 20%/);
  });

  it("a carteira MUDA o veredito: o mesmo pedido passa em ex-cliente e vira exceção em ativo", () => {
    const pedido = { valorOriginal: 1000, valorNegociado: 850, parcelas: 1, diasAtraso: 200 };
    expect(avaliarPedidoDeAcordo({ ...pedido, carteira: "ex_cliente" }, { acordo: acordo() }).decisao).toBe("dentro");
    expect(avaliarPedidoDeAcordo({ ...pedido, carteira: "ativo" }, { acordo: acordo() }).decisao).toBe("excecao");
  });

  it("a origem NÃO governa o funcionário: sem origem definida ele ainda registra o que fechou ao telefone", () => {
    const r = avaliarPedidoDeAcordo({ ...base, valorNegociado: 850, parcelas: 1 }, { acordo: acordo() });
    expect(ACORDO_PADRAO.ex_cliente.origemDaCobranca).toBe("nao_definida");
    expect(r.decisao).toBe("dentro");
  });

  it("faixas inconsistentes não viram recusa do operador — a política quebrada é problema do admin", () => {
    const a = acordo();
    a.ativo.faixas = [{ acimaDeDias: 0, ateDias: 30, descontoMaxPct: 0, maxParcelas: 1, entradaMinimaPct: 100 }];
    const r = avaliarPedidoDeAcordo({ carteira: "ativo", diasAtraso: 200, valorOriginal: 1000, valorNegociado: 500 }, { acordo: a });
    expect(r.decisao).toBe("dentro");
    expect(r.faixa).toBeNull();
  });
});

/* ── Datas e formatação ───────────────────────────────────────────────── */

describe("datas e formatação", () => {
  it("somarDias atravessa mês e ano sem fuso", () => {
    expect(somarDias("2026-09-06", 10)).toBe("2026-09-16");
    expect(somarDias("2026-12-28", 5)).toBe("2027-01-02");
    expect(somarDias("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("dataNaJanela prende a escolha do devedor entre hoje e o teto", () => {
    expect(dataNaJanela(undefined, HOJE, "2026-09-16")).toBe(HOJE);
    expect(dataNaJanela("lixo", HOJE, "2026-09-16")).toBe(HOJE);
    expect(dataNaJanela("2026-09-10", HOJE, "2026-09-16")).toBe("2026-09-10");
    expect(dataNaJanela("2026-09-30", HOJE, "2026-09-16")).toBe("2026-09-16");
  });

  it("as frases de dinheiro e de percentual são as da política — mesma forma, um idioma só", () => {
    const a = acordo();
    a.ex_cliente.faixas = [{ acimaDeDias: 0, ateDias: null, descontoMaxPct: 12.5, maxParcelas: 1, entradaMinimaPct: 20 }];
    const r = avaliarPedidoDeAcordo({ carteira: "ex_cliente", diasAtraso: 10, valorOriginal: 1000, valorNegociado: 1000, parcelas: 2, entrada: 0 }, { acordo: a });
    expect(r.decisao).toBe("excecao");
    if (r.decisao !== "excecao") return;
    expect(r.motivos.join(" ")).toContain(brl(0));
    expect(r.motivos.join(" ")).toContain(pct(20));
    const oferta = ofertasDaPolitica({ saldo: 1234.56, diasAtraso: 10, carteira: "ex_cliente", hoje: HOJE }, { acordo: { ...a, ex_cliente: { ...a.ex_cliente, origemDaCobranca: "manual" } }, negociacao: negociacao() });
    expect(oferta.motivo).toContain(pct(12.5));
  });
});

/** Entrada + todas as parcelas, em centavos — o total que o cliente paga. */
function somaDaOferta(oferta: { valor: number; entrada: number; parcelas: number; valorParcela: number }): number {
  const centavos = Math.round(oferta.entrada * 100)
    + Array.from({ length: oferta.parcelas }, (_, i) => Math.round(parcelaEm(oferta, i) * 100)).reduce((a, b) => a + b, 0);
  return centavos / 100;
}
