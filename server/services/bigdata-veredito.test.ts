import { describe, it, expect } from "vitest";
import { decidirVeredito, rendaMinimaMensal, faixaRendaEmReais, type DadosCadastrais } from "./bigdata-veredito";

/** Payload normalizado de um CPF sem nenhum sinal ruim. */
const bom = (o: Partial<DadosCadastrais> = {}): DadosCadastrais => ({
  encontrado: true,
  taxIdStatus: "REGULAR",
  temObito: false,
  nascimentoValidadoNaReceita: true,
  homonimos: 0,
  enderecos: [{ ratificado: true, ativo: true, ultimaPassagem: "2026-08-01" }],
  badAddressPassages: 0,
  faixaRenda: "5 A 10 SM",
  ...o,
});

describe("rendaMinimaMensal", () => {
  it("converte faixa de salario minimo no piso em reais", () => {
    expect(rendaMinimaMensal("0 A 1 SM")).toBe(0);
    expect(rendaMinimaMensal("3 A 5 SM")).toBeGreaterThan(4000);
    expect(rendaMinimaMensal("ACIMA DE 20 SM")).toBeGreaterThan(28000);
  });

  it("devolve null quando a faixa e desconhecida ou vazia", () => {
    expect(rendaMinimaMensal("SEM INFORMACAO")).toBeNull();
    expect(rendaMinimaMensal(undefined)).toBeNull();
    expect(rendaMinimaMensal("QUALQUER COISA")).toBeNull();
  });
});

describe("decidirVeredito — CPF nao encontrado", () => {
  it("nao e recusa: e ausencia de informacao", () => {
    const v = decidirVeredito({ ...bom(), encontrado: false });
    expect(v.veredito).toBe("NAO_ENCONTRADO");
    expect(v.motivos[0]).toMatch(/nao encontrado|não encontrado/i);
  });
});

describe("decidirVeredito — RECUSAR", () => {
  it.each(["SUSPENSA", "CANCELADA", "TITULAR FALECIDO", "NULA", "PENDENTE DE REGULARIZACAO"])(
    'recusa quando TaxIdStatus e "%s"', (st) => {
      const v = decidirVeredito(bom({ taxIdStatus: st }));
      expect(v.veredito).toBe("RECUSAR");
    });

  it("recusa quando ha indicacao de obito, mesmo com CPF regular", () => {
    const v = decidirVeredito(bom({ temObito: true }));
    expect(v.veredito).toBe("RECUSAR");
    expect(v.motivos.join(" ")).toMatch(/óbito|obito/i);
  });

  it("recusa vence atencao quando os dois sinais aparecem juntos", () => {
    const v = decidirVeredito(bom({ taxIdStatus: "CANCELADA", badAddressPassages: 3 }));
    expect(v.veredito).toBe("RECUSAR");
    // O motivo do endereco continua listado: o operador ve o quadro inteiro.
    expect(v.motivos.length).toBeGreaterThan(1);
  });

  it("nao recusa por status em caixa diferente", () => {
    expect(decidirVeredito(bom({ taxIdStatus: "regular" })).veredito).toBe("APROVAR");
  });
});

describe("decidirVeredito — ATENCAO", () => {
  it("alerta quando nenhum endereco e ratificado", () => {
    const v = decidirVeredito(bom({
      enderecos: [{ ratificado: false, ativo: true, ultimaPassagem: "2026-08-01" }],
    }));
    expect(v.veredito).toBe("ATENCAO");
    expect(v.motivos.join(" ")).toMatch(/ratificad/i);
  });

  it("alerta quando o CPF nao tem nenhum endereco", () => {
    const v = decidirVeredito(bom({ enderecos: [] }));
    expect(v.veredito).toBe("ATENCAO");
  });

  it("alerta quando ha passagem de endereco suspeita", () => {
    const v = decidirVeredito(bom({ badAddressPassages: 1 }));
    expect(v.veredito).toBe("ATENCAO");
    expect(v.motivos.join(" ")).toMatch(/suspeit/i);
  });

  it("alerta quando a renda estimada nao cobre o plano", () => {
    // Piso de "0 A 1 SM" e zero; plano de R$ 120 nao cabe.
    const v = decidirVeredito(bom({ faixaRenda: "0 A 1 SM" }), { valorPlano: 120 });
    expect(v.veredito).toBe("ATENCAO");
    expect(v.motivos.join(" ")).toMatch(/renda/i);
  });

  it("nao alerta por renda quando a faixa cobre o plano", () => {
    const v = decidirVeredito(bom({ faixaRenda: "5 A 10 SM" }), { valorPlano: 120 });
    expect(v.veredito).toBe("APROVAR");
  });

  it("nao alerta por renda quando o valor do plano nao foi informado", () => {
    // Sem plano nao ha o que comparar — alertar seria inventar criterio.
    expect(decidirVeredito(bom({ faixaRenda: "0 A 1 SM" })).veredito).toBe("APROVAR");
  });

  it("nao alerta por renda quando a BigData nao tem a informacao", () => {
    const v = decidirVeredito(bom({ faixaRenda: "SEM INFORMACAO" }), { valorPlano: 500 });
    expect(v.veredito).toBe("APROVAR");
  });

  it("alerta quando o nome tem muitos homonimos", () => {
    const v = decidirVeredito(bom({ homonimos: 400 }));
    expect(v.veredito).toBe("ATENCAO");
    expect(v.motivos.join(" ")).toMatch(/homônimo|homonimo/i);
  });

  it("nao alerta por homonimo em quantidade normal", () => {
    expect(decidirVeredito(bom({ homonimos: 3 })).veredito).toBe("APROVAR");
  });

  it("alerta quando a data de nascimento nao confere na Receita", () => {
    const v = decidirVeredito(bom({ nascimentoValidadoNaReceita: false }));
    expect(v.veredito).toBe("ATENCAO");
  });
});

describe("decidirVeredito — APROVAR", () => {
  it("aprova quando nenhum sinal ruim aparece", () => {
    const v = decidirVeredito(bom());
    expect(v.veredito).toBe("APROVAR");
    expect(v.motivos).toHaveLength(0);
  });

  it("aprova com um endereco ratificado entre varios nao ratificados", () => {
    const v = decidirVeredito(bom({
      enderecos: [
        { ratificado: false, ativo: false, ultimaPassagem: "2019-01-01" },
        { ratificado: true, ativo: true, ultimaPassagem: "2026-08-01" },
      ],
    }));
    expect(v.veredito).toBe("APROVAR");
  });
});

describe("decidirVeredito — payload incompleto", () => {
  it("nao quebra com campos ausentes", () => {
    const v = decidirVeredito({ encontrado: true } as DadosCadastrais);
    expect(["APROVAR", "ATENCAO", "RECUSAR"]).toContain(v.veredito);
  });

  it("trata status ausente como nao verificavel, nao como recusa", () => {
    const v = decidirVeredito(bom({ taxIdStatus: undefined }));
    expect(v.veredito).not.toBe("RECUSAR");
  });

  it("todo veredito diferente de APROVAR carrega ao menos um motivo", () => {
    const casos = [
      bom({ taxIdStatus: "CANCELADA" }),
      bom({ temObito: true }),
      bom({ badAddressPassages: 2 }),
      bom({ enderecos: [] }),
      { ...bom(), encontrado: false },
    ];
    for (const c of casos) {
      const v = decidirVeredito(c);
      expect(v.motivos.length, `veredito ${v.veredito} sem motivo`).toBeGreaterThan(0);
    }
  });
});

describe("faixaRendaEmReais", () => {
  it("traduz intervalo para reais por mes", () => {
    expect(faixaRendaEmReais("3 A 5 SM")).toMatch(/R\$ 4\.554.*R\$ 7\.590.*mês/);
  });

  it("traduz o teto aberto", () => {
    expect(faixaRendaEmReais("ACIMA DE 20 SM")).toMatch(/acima de R\$ 30\.360/);
  });

  it("traduz o piso aberto", () => {
    expect(faixaRendaEmReais("ATE 2 SM")).toMatch(/até R\$ 3\.036/);
  });

  it("devolve null quando nao ha informacao", () => {
    expect(faixaRendaEmReais("SEM INFORMACAO")).toBeNull();
    expect(faixaRendaEmReais(undefined)).toBeNull();
    expect(faixaRendaEmReais("QUALQUER COISA")).toBeNull();
  });
});

describe("decidirVeredito — rastro de mercado", () => {
  it("alerta quando o CPF e consultado demais em 30 dias", () => {
    const v = decidirVeredito(bom({ consultas30d: 15 }));
    expect(v.veredito).toBe("ATENCAO");
    expect(v.motivos.join(" ")).toMatch(/15 vezes/);
  });

  it("nao alerta com consulta em volume normal", () => {
    expect(decidirVeredito(bom({ consultas30d: 4 })).veredito).toBe("APROVAR");
  });

  it("alerta em mudanca de nome, mas nao recusa", () => {
    const v = decidirVeredito(bom({ mudancasNome: 1 }));
    expect(v.veredito).toBe("ATENCAO");
    expect(v.motivos.join(" ")).toMatch(/documento/);
  });

  it("cobranca ativa pesa mais que historico e aparece sozinha", () => {
    const v = decidirVeredito(bom({ emCobrancaAgora: true, cobrancas365d: 3 }));
    expect(v.motivos.filter(m => /cobran/i.test(m))).toHaveLength(1);
  });

  it("execucao como reu alerta; sem execucao, so o volume de processos", () => {
    expect(decidirVeredito(bom({ temExecucao: true })).motivos.join(" ")).toMatch(/Execução/);
    expect(decidirVeredito(bom({ processosComoReu: 6 })).motivos.join(" ")).toMatch(/6 processos/);
    expect(decidirVeredito(bom({ processosComoReu: 2 })).veredito).toBe("APROVAR");
  });

  it("divida ativa entra com o valor formatado", () => {
    const v = decidirVeredito(bom({ dividaAtiva: 15000 }));
    expect(v.motivos.join(" ")).toMatch(/15.000,00/);
  });

  it("nenhum sinal de inadimplencia recusa sozinho", () => {
    const v = decidirVeredito(bom({
      emCobrancaAgora: true, temExecucao: true, dividaAtiva: 99999,
      consultas30d: 50, buscaCredito: "A",
    }));
    expect(v.veredito).toBe("ATENCAO");
  });
});

describe("bureau de mercado", () => {
  it("negativacao no mercado alerta, mas nao recusa sozinha", () => {
    const v = decidirVeredito(bom({ negativadoNoMercado: true }));
    expect(v.veredito).toBe("ATENCAO");
    expect(v.motivos.join(" ")).toMatch(/negativação/i);
  });

  it("negativado false nao gera motivo", () => {
    expect(decidirVeredito(bom({ negativadoNoMercado: false })).veredito).toBe("APROVAR");
  });

  it("dataset nao habilitado (undefined) nao gera motivo", () => {
    const v = decidirVeredito(bom({ negativadoNoMercado: undefined, scoreMercado: undefined }));
    expect(v.veredito).toBe("APROVAR");
    expect(v.motivos).toEqual([]);
  });

  it("score de mercado baixo alerta; score alto passa", () => {
    expect(decidirVeredito(bom({ scoreMercado: 180 })).motivos.join(" ")).toMatch(/180 de 999/);
    expect(decidirVeredito(bom({ scoreMercado: 700 })).veredito).toBe("APROVAR");
  });

  it("score zero e dado valido, nao ausencia de dado", () => {
    expect(decidirVeredito(bom({ scoreMercado: 0 })).veredito).toBe("ATENCAO");
  });
});

describe("estabilidade de renda", () => {
  it("muitas trocas de emprego em 10 anos alertam", () => {
    const v = decidirVeredito(bom({ trocasEmprego10Anos: 6 }));
    expect(v.veredito).toBe("ATENCAO");
    expect(v.motivos.join(" ")).toMatch(/6 trocas de emprego/);
  });

  it("vinculos curtos alertam mesmo com poucas trocas", () => {
    const v = decidirVeredito(bom({ trocasEmprego10Anos: 2, mediaAnosPorVinculo: 0.5 }));
    expect(v.motivos.join(" ")).toMatch(/Vínculos de trabalho curtos/);
  });

  it("carreira estavel nao gera motivo", () => {
    const v = decidirVeredito(bom({ trocasEmprego10Anos: 1, mediaAnosPorVinculo: 8 }));
    expect(v.veredito).toBe("APROVAR");
  });

  it("media curta sem nenhuma troca recente nao alerta", () => {
    const v = decidirVeredito(bom({ trocasEmprego10Anos: 0, mediaAnosPorVinculo: 0.5 }));
    expect(v.veredito).toBe("APROVAR");
  });
});

describe("detalhe da negativacao", () => {
  it("negativacoes ativas descrevem melhor que o booleano", () => {
    const v = decidirVeredito(bom({
      negativadoNoMercado: true, negativacoesAtivas: 2, dividaMercado: 1240,
    }));
    const txt = v.motivos.join(" ");
    expect(txt).toMatch(/2 negativação\(ões\) ativa\(s\)/);
    expect(txt).toMatch(/1\.240,00/);
    // Nao repete o motivo generico quando ja deu o especifico.
    expect(txt).not.toMatch(/Indício de negativação/);
  });

  it("negativacao quitada nao vira pendencia", () => {
    const v = decidirVeredito(bom({ negativacoesAtivas: 0, negativadoNoMercado: false }));
    expect(v.veredito).toBe("APROVAR");
  });

  it("protesto em cartorio alerta", () => {
    expect(decidirVeredito(bom({ protestos: 3 })).motivos.join(" ")).toMatch(/3 protesto/);
  });

  it("muitas consultas de credito em 30 dias alertam", () => {
    const v = decidirVeredito(bom({ consultasCredito30d: 12 }));
    expect(v.motivos.join(" ")).toMatch(/12 consultas de crédito/);
  });

  it("poucas consultas de credito nao alertam", () => {
    expect(decidirVeredito(bom({ consultasCredito30d: 2 })).veredito).toBe("APROVAR");
  });

  it("nada de bureau habilitado continua sem motivo", () => {
    const v = decidirVeredito(bom({
      negativacoesAtivas: undefined, protestos: undefined,
      consultasCredito30d: undefined, dividaMercado: undefined,
    }));
    expect(v.veredito).toBe("APROVAR");
    expect(v.motivos).toEqual([]);
  });
});
