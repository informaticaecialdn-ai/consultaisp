/**
 * A realidade mensal da carteira de ativos — as funções puras do seletor de
 * mês e dos quatro chips (Pagou · Inadimplente · A vencer · Sem fatura), no
 * molde do Provedor.ai. Regra de ouro: sem base de fatura, traço e motivo.
 */
import { describe, expect, it } from "vitest";
import { chipsDoMes, deslocarMes, ESPACO_META, linhasDoPrejuizo, mesAtual, rotuloDoMes } from "./carteira";
import type { RespostaDoPrejuizo } from "@/components/cobranca/tipos";
import { brl } from "@/components/localizacao/ui";
import type { RespostaDoMes } from "@/components/cobranca/tipos";

const semNbsp = (s: string | null) => (s ?? "").replace(/ /g, " ");

describe("seletor de mês", () => {
  it("mesAtual é AAAA-MM; rotuloDoMes é 'set/26'; deslocarMes vira o ano", () => {
    expect(mesAtual(new Date(2026, 8, 5))).toBe("2026-09");
    expect(rotuloDoMes("2026-09")).toBe("set/26");
    expect(deslocarMes("2026-01", -1)).toBe("2025-12");
    expect(deslocarMes("2026-12", 1)).toBe("2027-01");
  });
});

describe("chipsDoMes", () => {
  const resumo: RespostaDoMes = {
    live: true,
    motivo: null,
    resumo: {
      mes: "2026-09", base: true, faturado: 1000, recebido: 0, recebidoConfirmado: false, emConciliacao: 250,
      inadimplente: 300, numInadimplentes: 3, aVencer: 450, numAVencer: 5, semFatura: 12, clientes: { emDia: 500, inadimplentes: 24 }, atualizadoEm: null,
    },
  };

  it("com base: os quatro valores reais, e 'pagou' diz que é baixa no ERP sem valor confirmado", () => {
    const chips = chipsDoMes(resumo);
    expect(chips.map(c => c.id)).toEqual(["pago", "inadimplente", "a_vencer", "sem_fatura"]);
    expect(semNbsp(chips[0].valor)).toBe("R$ 250,00");
    expect(chips[0].sub).toContain("25% do faturado");
    expect(chips[0].sub).toContain("sem o valor pago confirmado");
    expect(semNbsp(chips[1].valor)).toBe("R$ 300,00");
    expect(chips[1].sub).toBe("3 faturas vencidas");
    expect(semNbsp(chips[2].valor)).toBe("R$ 450,00");
    expect(chips[3].valor).toBe("12");
  });

  it("sem base (ou sem resposta): traço em tudo, nunca zero", () => {
    for (const dados of [undefined, { live: false, motivo: "sem fatura do ERP", resumo: null } as RespostaDoMes]) {
      const chips = chipsDoMes(dados);
      expect(chips[0].valor).toBe("—");
      expect(chips[1].valor).toBe("—");
      expect(chips[2].valor).toBe("—");
      expect(chips[3].valor).toBeNull();
      expect(chips[0].sub).toBe("sem faturas no mês");
    }
  });
});

describe("os dois espaços", () => {
  it("ativos e ex têm carteira, rota e situação ERP próprias", () => {
    expect(ESPACO_META.ativos).toMatchObject({ carteira: "ativo", rota: "/cobranca/ativos", situacaoErp: "Ativo ou suspenso" });
    expect(ESPACO_META.ex).toMatchObject({ carteira: "ex_cliente", rota: "/cobranca/ex-clientes", situacaoErp: "Ex-cliente" });
  });
});

/**
 * O chip "Pagou o mês" mostra a SOMA dos dois baldes.
 *
 * Até 08/09/2026 ele mostrava um OU outro (`recebidoConfirmado ? recebido :
 * emConciliacao`). Enquanto o servidor cravava `recebidoConfirmado: false` o
 * ramo confirmado era código morto e ninguém viu; a entrega de recebimentos
 * ligou os dois lados ao mesmo tempo — passou a existir `status:'paid'` por
 * confirmação individual E o campo virou `recebido > 0`. A partir do primeiro
 * comprovante conferido, o card trocava de balde e escondia toda a conciliação
 * do mês, ao lado de uma porcentagem que continuava somando os dois.
 */
describe("Pagou o mês — número, porcentagem e lista têm de concordar", () => {
  const doMes = (recebido: number, emConciliacao: number, faturado = 1000) => chipsDoMes({
    live: true,
    resumo: { faturado, recebido, emConciliacao, recebidoConfirmado: recebido > 0, inadimplente: 0, aVencer: 0, semFatura: 0 },
  } as never)[0];

  it("soma confirmado e conciliação, em vez de escolher um", () => {
    expect(doMes(100, 45_000).valor).toBe(brl(45_100));
  });

  it("o primeiro comprovante conferido NÃO apaga a conciliação da tela", () => {
    const antes = doMes(0, 45_000).valor;
    const depois = doMes(100, 45_000).valor;
    expect(antes).toBe(brl(45_000));
    expect(depois).toBe(brl(45_100));
    // A regressão que existia: `depois` virava R$ 100,00.
    expect(depois).not.toBe(brl(100));
  });

  it("separa no texto o que é comprovado do que é apenas provável", () => {
    expect(doMes(100, 45_000).sub).toContain("confirmado, o resto baixado no ERP");
    expect(doMes(0, 45_000).sub).toContain("sem o valor pago confirmado");
    expect(doMes(100, 0).sub).toContain("confirmado com comprovante");
  });

  it("sem faturado no mês não inventa 0% — não há porcentagem a afirmar", () => {
    expect(doMes(0, 0, 0).sub).toContain("sem faturado no mês");
    expect(doMes(0, 0, 0).sub).not.toContain("0% do faturado");
  });
});

describe("linhasDoPrejuizo — o card fala do eixo, da cobertura e do número real", () => {
  const base: RespostaDoPrejuizo = {
    live: true, motivo: null, eixo: "devem_desde", confirmado: false, atualizadoEm: "2026-09-09T06:05:00.000Z",
    periodo: { texto: "2026-09", rotulo: "set/26", granularidade: "mes", de: "2026-09-01", ate: "2026-10-01" },
    serie: [],
    resumo: {
      devedores: 21, avaliados: 17, noPrejuizo: 15, prejuizo: 12430, dividaAvaliada: 2720, instalacaoNaoRecuperada: 9890, abatida: 180,
      dividaDoRecorte: 3120, dividaDaCarteira: 9176.47, devedoresDaCarteira: 21, fatiaDaCarteira: 34,
      motivosDoTraco: [{ motivo: "sem mensalidade: este cliente não tem fatura vinda do ERP, e o plano dele não chegou do sync", clientes: 4, divida: 400 }],
      semData: { clientes: 0, divida: 0 },
      multaForaDoPrejuizo: 0, multasIndeterminadas: 0, estimados: 0,
    },
  };
  it("ativos: projeção com cobertura na mesma linha, a dívida real ao lado, e a decomposição que fecha", () => {
    const l = linhasDoPrejuizo(base, "ativos");
    expect(l.kicker).toBe("Prejuízo acumulado · devem desde set/26");
    expect(semNbsp(l.principal)).toBe("R$ 12.430,00");
    expect(l.cobertura).toBe("· 17 de 21");
    expect(l.sub).toMatch(/17 de 21 clientes que devem desde set\/26 · projeção/);
    expect(l.sub).toMatch(/último sync/);
    expect(l.sub).not.toMatch(/hoje/);
    expect(l.real).toMatchObject({ rotulo: "dívida vencida", sub: "segundo o ERP · 21 clientes · 34% do vencido da carteira" });
    expect(l.instalacao?.sub).toBe("instalação e aquisição não recuperadas · 17 avaliados");
    expect(l.abatida).toMatch(/abate/);
    expect(l.motivos).toEqual(["4 sem economia: sem mensalidade: este cliente não tem fatura vinda do ERP, e o plano dele não chegou do sync"]);
    expect(l.acao).toBeNull();
    expect(l.titulo).toMatch(/Não é data de cancelamento/);
  });
  it("ex-clientes sem avaliado: traço no principal com o motivo, e a dívida deixada é o número", () => {
    const ex: RespostaDoPrejuizo = { ...base, periodo: { ...base.periodo, texto: "2026-T1", rotulo: "T1/26", granularidade: "trimestre", de: "2026-01-01", ate: "2026-04-01" },
      resumo: { ...base.resumo, devedores: 64, avaliados: 0, noPrejuizo: 0, prejuizo: null, instalacaoNaoRecuperada: null, abatida: 0, dividaAvaliada: 0, dividaDoRecorte: 37737.6, fatiaDaCarteira: 4.6,
        motivosDoTraco: [{ motivo: "ex-cliente sem histórico de pagamento sincronizado — a economia realizada é a soma dos pagamentos reais, não fórmula", clientes: 64, divida: 37737.6 }] } };
    const l = linhasDoPrejuizo(ex, "ex");
    expect(l.principal).toBe("—");
    expect(l.cobertura).toBeNull();
    expect(l.sub).toBe("64 ex-clientes devem desde T1/26 · Economia: — em 64 de 64");
    expect(l.real.rotulo).toBe("dívida deixada");
    expect(l.real.sub).toBe("segundo o ERP · 64 ex-clientes · 4,6% do vencido da carteira");
    expect(l.instalacao).toBeNull();
    expect(l.acao).toBeNull();
  });
  it("sem base ou sem resposta: traço em tudo, com o motivo; sem devedor no período: diz que é o período, não ausência de dado", () => {
    expect(linhasDoPrejuizo(undefined, "ativos")).toMatchObject({ principal: "—", sub: "Lendo a base…", real: { valor: "—" } });
    expect(linhasDoPrejuizo({ ...base, live: false, motivo: "O ERP ainda não mandou fatura a fatura" }, "ex")).toMatchObject({ principal: "—", sub: "sem fatura do ERP" });
    const vazio = linhasDoPrejuizo({ ...base, resumo: { ...base.resumo, devedores: 0, avaliados: 0, prejuizo: 0, instalacaoNaoRecuperada: 0, dividaDoRecorte: 0, motivosDoTraco: [] } }, "ex");
    expect(semNbsp(vazio.principal)).toBe("R$ 0,00");
    expect(vazio.sub).toMatch(/nenhum ex-cliente com fatura vencida mais antiga em set\/26/);
  });
  it("quando é a Política que falta, o card leva até ela; o balde sem data aparece com o valor", () => {
    const semCustos = linhasDoPrejuizo({ ...base, resumo: { ...base.resumo, avaliados: 0, prejuizo: null, instalacaoNaoRecuperada: null,
      motivosDoTraco: [{ motivo: "faltam os custos do provedor: CAC, instalação e o custo mensal de servir um assinante (Política > Economia)", clientes: 21, divida: 3120 }],
      semData: { clientes: 3, divida: 250 } } }, "ativos");
    expect(semCustos.acao).toEqual({ rotulo: "Informar os custos" });
    expect(semNbsp(semCustos.semData)).toBe("3 sem fatura vencida gravada ficam fora de qualquer período · R$ 250,00");
  });
});

describe("a linha da multa no card — o que ficou fora do prejuízo, dito na tela", () => {
  const base: RespostaDoPrejuizo = {
    live: true, motivo: null, eixo: "devem_desde", confirmado: false, atualizadoEm: "2026-09-09T06:05:00.000Z",
    periodo: { texto: "2026-09", rotulo: "set/26", granularidade: "mes", de: "2026-09-01", ate: "2026-10-01" },
    serie: [],
    resumo: {
      devedores: 3, avaliados: 3, noPrejuizo: 2, prejuizo: 1200, dividaAvaliada: 240, instalacaoNaoRecuperada: 960, abatida: 0,
      dividaDoRecorte: 1440, dividaDaCarteira: 1440, devedoresDaCarteira: 3, fatiaDaCarteira: 100,
      motivosDoTraco: [], semData: { clientes: 0, divida: 0 }, multaForaDoPrejuizo: 1200, multasIndeterminadas: 0, estimados: 0,
    },
  };
  it("multa e equipamento fora do prejuízo aparecem com o valor e a razão; sem nada, a linha não existe", () => {
    const l = linhasDoPrejuizo(base, "ativos");
    expect(semNbsp(l.multa ?? "")).toBe("multa e equipamento R$ 1.200,00 cobrados à parte não entram no prejuízo — o equipamento já está no investimento que a Economia cobra");
    expect(linhasDoPrejuizo({ ...base, resumo: { ...base.resumo, multaForaDoPrejuizo: 0 } }, "ativos").multa).toBeNull();
  });
  it("faturas indeterminadas entram na mesma linha, com plural certo", () => {
    const uma = linhasDoPrejuizo({ ...base, resumo: { ...base.resumo, multaForaDoPrejuizo: 0, multasIndeterminadas: 1 } }, "ex");
    expect(uma.multa).toBe("1 fatura mistura multa e mensalidade sem valores: contada como dívida");
    const duas = linhasDoPrejuizo({ ...base, resumo: { ...base.resumo, multasIndeterminadas: 2 } }, "ex");
    expect(duas.multa).toMatch(/não entram no prejuízo — o equipamento já está no investimento que a Economia cobra · 2 faturas misturam multa e mensalidade sem valores: contadas como dívida$/);
  });
});

describe("os estimados no card — o ex-cliente sem fatura paga entra, e a tela diz quantos", () => {
  const base: RespostaDoPrejuizo = {
    live: true, motivo: null, eixo: "devem_desde", confirmado: false, atualizadoEm: "2026-09-09T06:05:00.000Z",
    periodo: { texto: "2026-09", rotulo: "set/26", granularidade: "mes", de: "2026-09-01", ate: "2026-10-01" },
    serie: [],
    resumo: {
      devedores: 5, avaliados: 4, noPrejuizo: 3, prejuizo: 2200, dividaAvaliada: 400, instalacaoNaoRecuperada: 2200, abatida: 0,
      dividaDoRecorte: 500, dividaDaCarteira: 500, devedoresDaCarteira: 5, fatiaDaCarteira: 100,
      motivosDoTraco: [], semData: { clientes: 0, divida: 0 }, multaForaDoPrejuizo: 0, multasIndeterminadas: 0, estimados: 3,
    },
  };
  it("ex-clientes: o subtitulo fala em resultado do contrato, e a linha dos estimados diz de onde vem o numero", () => {
    const l = linhasDoPrejuizo(base, "ex");
    expect(l.sub).toContain("resultado do contrato pela Economia do cliente");
    expect(l.estimados).toBe("3 de 4 estimados: sem fatura paga do ERP, receita = mensalidades do ciclo − saldo devedor");
    expect(linhasDoPrejuizo({ ...base, resumo: { ...base.resumo, estimados: 0 } }, "ex").estimados).toBeNull();
    expect(linhasDoPrejuizo(base, "ativos").sub).toContain("projeção pela Economia do cliente");
  });
});
