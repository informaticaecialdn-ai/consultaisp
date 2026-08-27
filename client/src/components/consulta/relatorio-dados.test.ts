/**
 * Trava as derivações do relatório — a conta que a TELA e o PAPEL compartilham.
 *
 * Existe porque o PDF reimplementava por conta própria o que a tela calculava, e
 * o resultado impresso dizia outra coisa. Estes testes são o contrato entre os
 * dois meios: se um deles precisar mudar a regra, o teste quebra primeiro.
 */
import { describe, it, expect } from "vitest";
import {
  isDelinquent, situacaoCurta, faixaDoScore, debitoEstimado,
  decisionSubtitle, decisaoDe, derivarRelatorio, brl, fmtCep,
} from "./relatorio-dados";
import type { ConsultaResult, ProviderDetail } from "./types";

const prov = (o: Partial<ProviderDetail> = {}): ProviderDetail => ({
  providerName: "Provedor X", isSameProvider: true, customerName: "Fulano",
  status: "Em dia", daysOverdue: 0, overdueInvoicesCount: 0,
  contractStartDate: "", contractAgeDays: 0,
  hasUnreturnedEquipment: false, unreturnedEquipmentCount: 0, ...o,
});

const res = (o: Partial<ConsultaResult> = {}): ConsultaResult => ({
  cpfCnpj: "12345678901", searchType: "cpf", score: 720,
  decisionReco: "Accept", providersFound: 1, providerDetails: [],
  alerts: [], recommendedActions: [], creditsCost: 0, ...o,
} as ConsultaResult);

describe("isDelinquent — três caminhos, perder um esconde ocorrência", () => {
  it("dias de atraso", () => expect(isDelinquent(prov({ daysOverdue: 30 }))).toBe(true));

  it("faixa de valor em PARCEIRO (o número exato nunca vem, por LGPD)", () => {
    expect(isDelinquent(prov({ isSameProvider: false, overdueAmountRange: "R$ 100 – R$ 500" }))).toBe(true);
  });

  it("faixa de valor no PRÓPRIO não conta — ali vem valor exato", () => {
    expect(isDelinquent(prov({ isSameProvider: true, overdueAmountRange: "R$ 100 – R$ 500" }))).toBe(false);
  });

  it("status textual do ERP", () => expect(isDelinquent(prov({ status: "Inadimplente (90+ dias)" }))).toBe(true));

  it("em dia é em dia", () => expect(isDelinquent(prov())).toBe(false));
});

describe("situacaoCurta", () => {
  it("corta o parêntese que só repete o atraso", () => {
    expect(situacaoCurta("Inadimplente (90+ dias)", "x")).toBe("Inadimplente");
    expect(situacaoCurta("Cancelado (120 dias)", "x")).toBe("Cancelado");
  });

  it("mantém parêntese que diz outra coisa", () => {
    expect(situacaoCurta("Cancelado (débito)", "x")).toBe("Cancelado (débito)");
  });

  it("cai no fallback quando vazio", () => {
    expect(situacaoCurta(undefined, "Em dia")).toBe("Em dia");
    expect(situacaoCurta("(90 dias)", "Em dia")).toBe("Em dia");
  });
});

describe("faixaDoScore — cinco faixas, fronteiras exatas", () => {
  it("as fronteiras", () => {
    expect(faixaDoScore(300).label).toBe("Crítico");
    expect(faixaDoScore(301).label).toBe("Risco alto");
    expect(faixaDoScore(500).label).toBe("Risco alto");
    expect(faixaDoScore(501).label).toBe("Risco médio");
    expect(faixaDoScore(700).label).toBe("Risco médio");
    expect(faixaDoScore(701).label).toBe("Bom");
    expect(faixaDoScore(850).label).toBe("Bom");
    expect(faixaDoScore(851).label).toBe("Excelente");
  });

  it("o 720 da captura de produção é Bom", () => expect(faixaDoScore(720).label).toBe("Bom"));
});

describe("debitoEstimado — soma sem subestimar o risco", () => {
  it("só próprio: valor exato", () => {
    const r = debitoEstimado([prov({ overdueAmount: 1500 })], []);
    expect(r.texto).toBe(brl(1500));
    expect(r.temDebito).toBe(true);
  });

  it("próprio + faixa de parceiro somam nos dois limites", () => {
    const r = debitoEstimado(
      [prov({ overdueAmount: 1000 })],
      [prov({ isSameProvider: false, overdueAmountRange: "R$ 500 - R$ 900" })],
    );
    expect(r.texto).toBe("R$ 1.500 – R$ 1.900");
  });

  it("duas faixas de parceiro somam entre si", () => {
    const r = debitoEstimado([], [
      prov({ isSameProvider: false, overdueAmountRange: "R$ 100 - R$ 200" }),
      prov({ isSameProvider: false, overdueAmountRange: "R$ 300 - R$ 400" }),
    ]);
    expect(r.texto).toBe("R$ 400 – R$ 600");
  });

  it("faixa que não parseia cai no conservador: mostra a faixa crua", () => {
    const r = debitoEstimado([], [prov({ isSameProvider: false, overdueAmountRange: "acima de mil" })]);
    expect(r.texto).toBe("acima de mil");
    expect(r.temDebito).toBe(true);
  });

  it("sem dívida nenhuma", () => {
    expect(debitoEstimado([prov()], []).temDebito).toBe(false);
    expect(debitoEstimado([prov()], []).texto).toBe("—");
  });
});

describe("decisaoDe", () => {
  it("os três desfechos", () => {
    expect(decisaoDe(res({ decisionReco: "Accept" })).curto).toBe("Aprovar");
    expect(decisaoDe(res({ decisionReco: "Reject" })).curto).toBe("Rejeitar");
    expect(decisaoDe(res({ decisionReco: "Review" })).curto).toBe("Analisar");
  });

  it("valor desconhecido cai em Analisar, nunca em Aprovar", () => {
    expect(decisaoDe(res({ decisionReco: "qualquer-outro" } as any)).curto).toBe("Analisar");
  });
});

describe("decisionSubtitle", () => {
  it("sem sinal nenhum, afirma a ausência", () => {
    expect(decisionSubtitle(res(), 0, 0)).toMatch(/^Sem restrições na rede ISP colaborativa/);
  });

  it("junta ocorrência, equipamento e migração", () => {
    const r = res({
      providerDetails: [prov({ daysOverdue: 90, overdueAmount: 500 })],
      migratorAlert: { detected: true } as any,
    });
    const s = decisionSubtitle(r, 1, 2);
    expect(s).toContain("1 ocorrência de inadimplência ativa na rede");
    expect(s).toContain("2 equipamentos em comodato não devolvidos");
    expect(s).toContain("padrão de migração entre provedores");
  });

  it("plural correto no singular", () => {
    const s = decisionSubtitle(res({ providerDetails: [prov({ daysOverdue: 1 })] }), 1, 1);
    expect(s).toContain("1 equipamento em comodato não devolvido");
    expect(s).not.toContain("equipamentos");
  });
});

describe("derivarRelatorio", () => {
  it("separa próprio de parceiro e conta as ocorrências", () => {
    const d = derivarRelatorio(res({
      providerDetails: [
        prov({ isSameProvider: true, daysOverdue: 30 }),
        prov({ isSameProvider: false, providerName: "Parceiro", overdueAmountRange: "R$ 100 - R$ 200" }),
      ],
    }));
    expect(d.proprios).toHaveLength(1);
    expect(d.parceiros).toHaveLength(1);
    expect(d.ativas).toBe(2);
  });

  it("nunca deixa a tabela 03 vazia: dois lados, duas linhas de vazio", () => {
    const d = derivarRelatorio(res({ providerDetails: [] }));
    expect(d.ocorrencias).toHaveLength(2);
    expect(d.ocorrencias[0].cliente).toBe("— nada consta —");
    expect(d.ocorrencias[1].cliente).toBe("— nada consta na rede —");
  });

  it("mascara o parceiro: nome restrito e contagem achatada em 2+", () => {
    const d = derivarRelatorio(res({
      providerDetails: [prov({
        isSameProvider: false, customerName: "", hasUnreturnedEquipment: true,
        unreturnedEquipmentCount: 5,
      })],
    }));
    const linha = d.ocorrencias.find(o => o.cliente === "Dados restritos")!;
    expect(linha).toBeDefined();
    expect(linha.sub).toContain("2+ equipamentos retidos");
    expect(linha.sub).not.toContain("5");
  });

  it("04 e 05 sempre têm DUAS linhas, mesmo sem ocorrência", () => {
    const d = derivarRelatorio(res({ providerDetails: [] }));
    expect(d.equipamentoLinhas).toHaveLength(2);
    expect(d.enderecoLinhas).toHaveLength(2);
    expect(d.equipamentoLinhas[0].chip).toBe("Sem ocorrência");
  });

  it("distingue 'Nada consta' de 'Cruzamento não realizado'", () => {
    const semCruzar = derivarRelatorio(res({ autoAddressCrossRef: false }));
    expect(semCruzar.enderecoLinhas[1].nome).toBe("Cruzamento não realizado");
    const cruzou = derivarRelatorio(res({ autoAddressCrossRef: true }));
    expect(cruzou.enderecoLinhas[1].nome).toBe("Nada consta");
  });

  it("numerador e denominador: consultados vs com registro", () => {
    const d = derivarRelatorio(res({
      providersFound: 1,
      providerDetails: [prov({ isSameProvider: true })],
      erpSummary: { total: 2, responded: 2, failed: 0, timedOut: 0 } as any,
    }));
    expect(d.provedoresConsultados).toBe(2);
    expect(d.provedoresComRegistro).toBe(1);
    expect(d.parceirosConsultados).toBe(1);
  });

  it("score é clampado nos dois extremos", () => {
    expect(derivarRelatorio(res({ score: -50 })).score).toBe(0);
    expect(derivarRelatorio(res({ score: 5000 })).score).toBe(1000);
  });

  it("busca por CEP é sinalizada — 03 e 04 somem no consumidor", () => {
    expect(derivarRelatorio(res({ searchType: "cep" })).ehBuscaPorCep).toBe(true);
    expect(derivarRelatorio(res({ searchType: "cpf" })).ehBuscaPorCep).toBe(false);
  });

  it("só os matches COM dívida entram na lista de endereço", () => {
    const d = derivarRelatorio(res({
      addressMatches: [
        { hasDebt: true, customerName: "A", isSameProvider: false } as any,
        { hasDebt: false, customerName: "B", isSameProvider: false } as any,
      ],
    }));
    expect(d.enderecoComDivida).toHaveLength(1);
    expect(d.enderecoComDivida[0].customerName).toBe("A");
  });
});

describe("fmtCep", () => {
  it("formata 8 dígitos e devolve o resto intacto", () => {
    expect(fmtCep("86010180")).toBe("86010-180");
    expect(fmtCep("86010-180")).toBe("86010-180");
    expect(fmtCep("123")).toBe("123");
  });
});
